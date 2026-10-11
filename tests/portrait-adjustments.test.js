import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPhotoSettings, normalisePhotoSettings } from '../src/model.js';
import { portraitCropGeometry, drawPortraitCrop, preparePortrait, renderPortrait } from '../src/portrait.js';

// Header fixtures and fake canvases exercise ownership and guards only. Real
// image pixels, metadata removal and PDF appearance require native browser QA.
function jpeg(width, height) {
  const bytes = Buffer.from([255,216,255,192,0,11,8,0,0,0,0,1,1,17,0,255,218,0,2,255,217]);
  bytes.writeUInt16BE(height, 7); bytes.writeUInt16BE(width, 9); return bytes;
}
const source = (width = 960, height = 640) => `data:image/jpeg;base64,${jpeg(width, height).toString('base64')}`;
const file = () => new Blob([jpeg(3000, 2000)], { type: 'image/jpeg' });
function bitmap(width = 3000, height = 2000) { return { width, height, closes: 0, close() { this.closes++; } }; }
function canvases(encode = canvas => source(canvas.width, canvas.height)) {
  const allocated = [];
  const factory = () => {
    const calls = [], context = Object.fromEntries(['save', 'restore', 'fillRect', 'scale', 'translate', 'rotate', 'drawImage'].map(name => [name, (...args) => calls.push([name, ...args])]));
    const canvas = { width: 0, height: 0, calls, context, getContext: () => context, toDataURL(type, quality) { calls.push(['encode', type, quality, this.width, this.height]); return encode(this, quality); } };
    allocated.push(canvas); return canvas;
  };
  return { allocated, factory };
}

test('wide and tall crops centre correctly, zoom in without uncovered space, and move to either edge', () => {
  assert.deepEqual(portraitCropGeometry(900, 300), { rotatedWidth: 900, rotatedHeight: 300, cropSize: 300, cropX: 300, cropY: 0, rotation: 0 });
  assert.deepEqual(portraitCropGeometry(300, 900), { rotatedWidth: 300, rotatedHeight: 900, cropSize: 300, cropX: 0, cropY: 300, rotation: 0 });
  assert.deepEqual(portraitCropGeometry(900, 300, { zoom: 2, x: 100, y: 0 }), { rotatedWidth: 900, rotatedHeight: 300, cropSize: 150, cropX: 750, cropY: 0, rotation: 0 });
  for (const rotation of [0, 90, 180, 270]) for (const zoom of [1, 1.5, 4]) for (const x of [0, 50, 100]) for (const y of [0, 50, 100]) {
    const crop = portraitCropGeometry(900, 300, { rotation, zoom, x, y });
    assert.ok(crop.cropSize > 0 && crop.cropX >= 0 && crop.cropY >= 0);
    assert.ok(crop.cropX + crop.cropSize <= crop.rotatedWidth && crop.cropY + crop.cropSize <= crop.rotatedHeight);
  }
});

test('quarter turns swap image bounds and preserve crop position in the rotated image', () => {
  for (const rotation of [90, 270]) assert.deepEqual(portraitCropGeometry(900, 300, { rotation, zoom: 2, x: 0, y: 100 }), { rotatedWidth: 300, rotatedHeight: 900, cropSize: 150, cropX: 0, cropY: 750, rotation });
  assert.throws(() => portraitCropGeometry(20000, 1), /pixels/);
  assert.throws(() => portraitCropGeometry(300, 200, { zoom: 0 }), /zoom/);
  assert.throws(() => portraitCropGeometry(300, 200, { get x() { throw new Error('Getter executed'); } }), /plain values/);
});

test('drawing paints a white square and restores context even if native drawing fails', () => {
  const recording = canvases(); const canvas = recording.factory(), image = bitmap(900, 300);
  const geometry = drawPortraitCrop(canvas.context, image, { zoom: 2, x: 100, y: 0, rotation: 90 }, 288);
  assert.equal(geometry.rotatedWidth, 300); assert.equal(geometry.cropSize, 150);
  assert.deepEqual(canvas.calls[1], ['fillRect', 0, 0, 288, 288]);
  assert.ok(canvas.calls.some(call => call[0] === 'rotate' && call[1] === Math.PI / 2));
  assert.deepEqual(canvas.calls.at(-1), ['restore']); assert.equal(image.closes, 0, 'the UI owns its preview bitmap');
  canvas.context.drawImage = () => { throw new Error('Native draw failed'); };
  assert.throws(() => drawPortraitCrop(canvas.context, image), /Native draw failed/);
  assert.deepEqual(canvas.calls.at(-1), ['restore']);
  assert.throws(() => drawPortraitCrop(canvas.context, image, {}, 961), /preview size/);
});

test('preparing an upload retains an uncropped reduced source and a separate 240px square, closing all owned resources', async () => {
  const image = bitmap(), recording = canvases();
  const prepared = await preparePortrait(file(), { decode: async () => image, canvasFactory: recording.factory });
  assert.equal(prepared.source, source(960, 640)); assert.equal(prepared.photo, source(240, 240));
  assert.deepEqual(prepared.settings, { ...defaultPhotoSettings(), source: prepared.source });
  assert.equal(normalisePhotoSettings(prepared.settings).source, prepared.source);
  assert.equal(image.closes, 1);
  assert.equal(recording.allocated.length, 2);
  assert.ok(recording.allocated.every(canvas => canvas.width === 0 && canvas.height === 0));
  const sourceDraw = recording.allocated[0].calls.find(call => call[0] === 'drawImage');
  assert.deepEqual(sourceDraw.slice(2), [0, 0, 960, 640]);
});

test('small uploads retain their original aspect ratio without upscaling the editable source', async () => {
  const image = bitmap(150, 100), recording = canvases();
  const prepared = await preparePortrait(file(), { decode: async () => image, canvasFactory: recording.factory });
  assert.equal(prepared.source, source(150, 100)); assert.equal(prepared.photo, source(240, 240));
  assert.equal(image.closes, 1);
});

test('a complex source tries lower JPEG quality and smaller dimensions until it meets the retained byte cap', async () => {
  const image = bitmap(), oversized = 'data:image/jpeg;base64,' + 'A'.repeat(250001);
  const recording = canvases((canvas, quality) => canvas.width !== 240 && (canvas.width > 540 || quality > .65) ? oversized : source(canvas.width, canvas.height));
  const prepared = await preparePortrait(file(), { decode: async () => image, canvasFactory: recording.factory });
  assert.equal(prepared.source, source(540, 360)); assert.ok(prepared.source.length <= 250000);
  assert.ok(recording.allocated[0].calls.filter(call => call[0] === 'encode').some(call => call[2] < .86));
  assert.equal(image.closes, 1);
});

test('source encoding failures and missing canvas contexts close the bitmap and release canvases', async () => {
  for (const kind of ['factory', 'context', 'encoding']) {
    const image = bitmap(), recording = canvases();
    const canvasFactory = () => {
      if (kind === 'factory') throw new Error('Canvas unavailable');
      const canvas = recording.factory();
      if (kind === 'context') canvas.getContext = () => null;
      if (kind === 'encoding') canvas.toDataURL = () => { throw new Error('Canvas encoding failed'); };
      return canvas;
    };
    await assert.rejects(preparePortrait(file(), { decode: async () => image, canvasFactory }), /Canvas|prepare/);
    assert.equal(image.closes, 1);
    assert.ok(recording.allocated.every(canvas => canvas.width === 0 && canvas.height === 0));
  }
});

test('a cancelled upload closes a late native bitmap without allocating a canvas or returning old-document work', async () => {
  let current = true, resolveDecode;
  const image = bitmap(), recording = canvases();
  const pending = preparePortrait(file(), { isCurrent: () => current, decode: () => new Promise(resolve => { resolveDecode = resolve; }), canvasFactory: recording.factory });
  await new Promise(resolve => setImmediate(resolve)); current = false; resolveDecode(image);
  assert.equal(await pending, null); assert.equal(image.closes, 1); assert.equal(recording.allocated.length, 0);
});

test('a crop cancelled during encoding never returns a baked update and closes its owned bitmap', async () => {
  let current = true; const image = bitmap(960, 640);
  const recording = canvases(canvas => { current = false; return source(canvas.width, canvas.height); });
  const rendered = await renderPortrait(source(), { zoom: 2, x: 20, y: 70, rotation: 270 }, { isCurrent: () => current, decode: async () => image, canvasFactory: recording.factory });
  assert.equal(rendered, null); assert.equal(image.closes, 1);
  assert.ok(recording.allocated.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test('rendering a retained crop produces only the baked square and owns the native decoder resource', async () => {
  const image = bitmap(960, 640), recording = canvases();
  let decodedFile;
  const rendered = await renderPortrait(source(), { zoom: 2.5, x: 5, y: 85, rotation: 180, size: 144 }, { decode: async file => { decodedFile = file; return image; }, canvasFactory: recording.factory });
  assert.equal(rendered, source(240, 240)); assert.equal(image.closes, 1);
  assert.equal(decodedFile.type, 'image/jpeg'); assert.deepEqual(Buffer.from(await decodedFile.arrayBuffer()), jpeg(960, 640));
  assert.equal(recording.allocated.length, 1, 'page size changes neither native crop pixels nor source quality');
});

test('crop rendering refuses external/invalid source and settings before invoking a native decoder', async () => {
  let decodes = 0; const decode = async () => { decodes++; throw new Error('Unexpected decode'); };
  for (const invalid of ['https://example.com/photo.jpg', 'data:image/png;base64,A', source(20000, 1), '']) await assert.rejects(renderPortrait(invalid, {}, { decode }), /Photo|photo|pixels/);
  await assert.rejects(renderPortrait(source(), { zoom: 9 }, { decode }), /zoom/);
  assert.equal(decodes, 0);
  assert.equal(await renderPortrait(source(), {}, { isCurrent: () => false, decode }), null);
  assert.equal(decodes, 0);
});

test('failed crop canvas allocation still closes the decoded source bitmap', async () => {
  const image = bitmap(960, 640);
  await assert.rejects(renderPortrait(source(), {}, { decode: async () => image, canvasFactory: () => { throw new Error('Canvas unavailable'); } }), /Canvas unavailable/);
  assert.equal(image.closes, 1);
});
