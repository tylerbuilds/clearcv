import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, validateDocument, parseDocument } from '../src/model.js';
import { createWorkspace, parseWorkspace } from '../src/workspace.js';
import { initialWorkspace } from '../src/new-cv.js';
import { persistWorkspace } from '../src/storage.js';
import { decodePortrait } from '../src/portrait.js';

// These fixtures describe dimensions in ordinary image headers. No native
// image decoder is involved: the guard must reject them before that stage.
function png(width, height) {
  const bytes = Buffer.alloc(33); bytes.set([137,80,78,71,13,10,26,10]);
  bytes.writeUInt32BE(13,8); bytes.write('IHDR',12); bytes.writeUInt32BE(width,16); bytes.writeUInt32BE(height,20);
  bytes[24] = 8; bytes[25] = 6; return bytes;
}
function jpeg(width, height) {
  const bytes = Buffer.from([255,216,255,192,0,11,8,0,0,0,0,1,1,17,0,255,218,0,2,255,217]);
  bytes.writeUInt16BE(height,7); bytes.writeUInt16BE(width,9); return bytes;
}
function webp(width, height) {
  const bytes = Buffer.alloc(30); bytes.write('RIFF'); bytes.writeUInt32LE(22,4); bytes.write('WEBPVP8X',8); bytes.writeUInt32LE(10,16);
  bytes.writeUIntLE(width-1,24,3); bytes.writeUIntLE(height-1,27,3); return bytes;
}
function gif(width, height) {
  const bytes = Buffer.alloc(13); bytes.write('GIF89a'); bytes.writeUInt16LE(width,6); bytes.writeUInt16LE(height,8); return bytes;
}
function bmp(width, height) {
  const bytes = Buffer.alloc(54); bytes.write('BM'); bytes.writeUInt32LE(54,2); bytes.writeUInt32LE(54,10); bytes.writeUInt32LE(40,14);
  bytes.writeInt32LE(width,18); bytes.writeInt32LE(height,22); bytes.writeUInt16LE(1,26); bytes.writeUInt16LE(24,28); return bytes;
}
const asPhoto = (mime, bytes) => `data:${mime};base64,${bytes.toString('base64')}`;
test('embedded portraits reject declared oversized dimensions before JSON can reach image rendering', () => {
  for (const [mime, make] of [['image/png',png],['image/jpeg',jpeg],['image/webp',webp]]) {
    for (const [width,height] of [[16385,1],[1,16385],[10000,5000]]) {
      const doc = createDocument(); doc.photo = asPhoto(mime,make(width,height)); const before = structuredClone(doc);
      assert.throws(() => validateDocument(doc), /photo|image|pixels|megapixels/i, `${mime} ${width}x${height}`);
      assert.deepEqual(doc,before);
      assert.throws(() => parseDocument(JSON.stringify(doc)), /photo|image|pixels|megapixels/i);
    }
    // Browser decoders inspect the bytes even if a data URL names another type.
    const mislabeled = createDocument(); mislabeled.photo = asPhoto(mime === 'image/png' ? 'image/webp' : 'image/png', make(10000,5000));
    assert.throws(() => validateDocument(mislabeled), /photo|image|pixels|megapixels/i);
  }
});
test('older saved oversized portraits fail closed while the raw legacy and workspace strings remain recoverable', () => {
  const valid = createWorkspace(createDocument()); const oversized = structuredClone(valid);
  oversized.documents[0].document.photo = asPhoto('image/png',png(20000,20000));
  const raw = JSON.stringify(oversized), legacy = JSON.stringify(oversized.documents[0].document);
  const stored = new Map([['clearcv.workspace.v1',raw],['clearcv.document.v1',legacy]]);
  const storage = {getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
  assert.throws(() => initialWorkspace(storage.getItem('clearcv.workspace.v1'),null));
  assert.throws(() => initialWorkspace(null,storage.getItem('clearcv.document.v1')));
  assert.throws(() => parseWorkspace(raw));
  assert.throws(() => persistWorkspace(storage,'clearcv.workspace.v1',oversized,raw));
  assert.equal(storage.getItem('clearcv.workspace.v1'),raw);
  assert.equal(storage.getItem('clearcv.document.v1'),legacy);
});
test('small existing portrait values and regular header dimensions remain compatible', () => {
  for (const [mime,bytes] of [['image/png',png(240,240)],['image/jpeg',jpeg(240,240)],['image/webp',webp(240,240)],['image/png',Buffer.from([0])]]) {
    const doc = createDocument(); doc.photo = asPhoto(mime,bytes);
    assert.equal(validateDocument(doc).photo,doc.photo);
    assert.equal(initialWorkspace(null,JSON.stringify(doc)).workspace.documents[0].document.photo,doc.photo);
  }
  const incomplete = createDocument(); incomplete.photo = 'data:image/png;base64,A';
  assert.equal(validateDocument(incomplete).photo,incomplete.photo);
});
test('portrait upload refuses oversized or unreadable headers without calling the native decoder', async () => {
  let decodes = 0;
  const decode = async () => { decodes++; throw new Error('Decoder must not run'); };
  for (const [mime,make] of [['image/png',png],['image/jpeg',jpeg],['image/webp',webp]]) {
    await assert.rejects(decodePortrait(new Blob([make(10000,5000)],{type:mime}),{decode}),/pixels|megapixels/i);
  }
  await assert.rejects(decodePortrait(new Blob([Buffer.from([0])],{type:'image/png'}),{decode}),/readable/);
  assert.equal(decodes,0);
});
test('portrait upload checks decoded dimensions and closes oversized or stale bitmaps before cropping', async () => {
  const file = new Blob([png(240,240)],{type:'image/png'});
  let closes = 0;
  await assert.rejects(decodePortrait(file,{decode:async()=>({width:20000,height:20000,close(){closes++;}})}),/pixels|megapixels/i);
  assert.equal(closes,1);
  let current = true;
  const result = await decodePortrait(file,{isCurrent:()=>current,decode:async()=>{current=false;return {width:240,height:240,close(){closes++;}};}});
  assert.equal(result,null); assert.equal(closes,2);
  let decodes = 0;
  assert.equal(await decodePortrait(file,{isCurrent:()=>false,decode:async()=>{decodes++;}}),null);
  assert.equal(decodes,0);
  const bitmap = {width:240,height:240,close(){closes++;}};
  assert.equal(await decodePortrait(file,{decode:async()=>bitmap}),bitmap);
  assert.equal(closes,2,'the successful caller owns and later closes its bitmap');
});
for (const [format,make] of [['GIF',gif],['BMP',bmp]]) {
  test(`a ${format} header cannot reach saved portrait rendering by claiming to be a PNG`, () => {
    for (const [width,height] of [[10000,5000],[1,1]]) {
      const doc = createDocument(); doc.photo = asPhoto('image/png',make(width,height));
      const raw = JSON.stringify(doc), before = structuredClone(doc);
      assert.throws(() => validateDocument(doc), /photo|PNG|JPEG|WebP/i);
      assert.throws(() => initialWorkspace(null,raw), /photo|PNG|JPEG|WebP/i);
      assert.deepEqual(doc,before);
    }
  });
}
test('mislabeled GIF and BMP uploads are refused without any native decoder call', async () => {
  let decodes = 0;
  const decode = async () => { decodes++; throw new Error('Decoder must not run'); };
  for (const make of [gif,bmp]) {
    await assert.rejects(decodePortrait(new Blob([make(10000,5000)],{type:'image/png'}),{decode}),/photo|PNG|JPEG|WebP/i);
  }
  assert.equal(decodes,0);
});
