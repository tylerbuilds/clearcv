import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { exportDocx,extractDocx,extractWordXml,normalisePlainText,crc32,DOCX_LIMIT } from '../src/formats.js';
import { sampleDocument } from '../src/model.js';
const word='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Résumé &amp; café</w:t><w:tab/><w:t>Engineer</w:t></w:r></w:p><w:p><w:r><w:t>Measured 32% improvement.</w:t></w:r></w:p></w:body></w:document>';
function compressedFixture(xml) {
  const name=Buffer.from('word/document.xml'), body=Buffer.from(xml), packed=deflateRawSync(body), crc=crc32(body);
  const local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(8,8);
  local.writeUInt32LE(crc,14); local.writeUInt32LE(packed.length,18); local.writeUInt32LE(body.length,22); local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(8,10);
  central.writeUInt32LE(crc,16); central.writeUInt32LE(packed.length,20); central.writeUInt32LE(body.length,24); central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length+name.length,12); end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}
test('editable DOCX exports preserve visible ordered text without HTML or external relationships',async()=>{
  const doc=sampleDocument();
  doc.profile.name='A <script> & café';
  doc.customSections=[{id:'projects',title:'Projects',content:'Built a garden\nReduced waste by 20%'}];
  doc.sectionOrder=['profile','projects','education','experience','skills'];
  doc.hiddenSections=['education'];
  const bytes=exportDocx(doc),text=await extractDocx(bytes);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
  assert.ok(text.startsWith(doc.profile.name));
  assert.ok(text.includes('Reduced waste by 20%'));
  assert.ok(text.indexOf('Projects')<text.indexOf('Experience'));
  assert.ok(!text.includes('University of the West'));
  const archive=new TextDecoder().decode(bytes);
  assert.ok(archive.includes('&lt;script&gt;'));
  assert.ok(!archive.includes('TargetMode="External"'));
});
test('cover letters export applicant and letter text, without including the CV work history',async()=>{
  const doc=sampleDocument();
  doc.coverLetter={...doc.coverLetter,company:'Example Ltd',recipient:'Hiring team',date:'9 October 2026',subject:'Design role',salutation:'Dear team,',body:'My experience is relevant.\nI would welcome a conversation.',closing:'Yours sincerely,'};
  const text=await extractDocx(exportDocx(doc,{kind:'letter'}));
  assert.ok(text.includes(doc.coverLetter.body));
  assert.ok(text.includes('Example Ltd'));
  assert.ok(!text.includes('Northstar Studio'));
});
test('hiding or moving the summary keeps the applicant header and contacts in the exported CV',async()=>{
  const doc=sampleDocument();doc.hiddenSections=['profile'];doc.sectionOrder=['skills','profile','experience','education'];
  const text=await extractDocx(exportDocx(doc));
  assert.ok(text.startsWith(doc.profile.name));assert.ok(text.includes(doc.profile.email));assert.ok(!text.includes(doc.profile.summary));
});
test('extracts genuine raw-deflate ZIP text including runs, Unicode, tabs and XML entities',async()=>{
  assert.equal(await extractDocx(compressedFixture(word)),'Résumé & café\tEngineer\nMeasured 32% improvement.');
  assert.equal(extractWordXml(word.replace('Résumé &amp; café','&#x1F331; &#233;')),'🌱 é\tEngineer\nMeasured 32% improvement.');
});
test('damaged, encrypted, oversized and conflicting archive entries fail before import',async()=>{
  await assert.rejects(extractDocx(new Uint8Array(DOCX_LIMIT+1)),/smaller than 2 MB/);
  await assert.rejects(extractDocx(Buffer.from('This is not Word data')),/DOCX|archive/);
  const damaged=compressedFixture(word); damaged[50]^=1;
  await assert.rejects(extractDocx(damaged));
  const encrypted=compressedFixture(word),start=encrypted.readUInt32LE(encrypted.length-6);
  encrypted.writeUInt16LE(1,6); encrypted.writeUInt16LE(1,start+8);
  await assert.rejects(extractDocx(encrypted),/Encrypted/);
  const huge=compressedFixture(word),cd=huge.readUInt32LE(huge.length-6);
  huge.writeUInt32LE(DOCX_LIMIT+1,cd+24);
  await assert.rejects(extractDocx(huge),/oversized/);
  const conflicting=compressedFixture(word); conflicting.writeUInt16LE(0,8);
  await assert.rejects(extractDocx(conflicting),/conflicting/);
  const bomb=compressedFixture(word),bombCd=bomb.readUInt32LE(bomb.length-6);
  bomb.writeUInt32LE(1,bombCd+24);
  await assert.rejects(extractDocx(bomb),/expand beyond their declared size/);
});
test('XML extraction rejects entity declarations, malformed nesting and excessive text',()=>{
  assert.throws(()=>extractWordXml('<!DOCTYPE w:document [<!ENTITY x "huge">]>'+word),/unsupported/);
  assert.throws(()=>extractWordXml(word.replace('</w:r>','</w:t>')),/formatting.*incomplete/);
  assert.throws(()=>extractWordXml(word.replace('Résumé &amp; café','&unknown;')),/character code/);
  assert.throws(()=>extractWordXml(word.replace('Résumé &amp; café','x'.repeat(50001))),/too complex/);
  assert.throws(()=>extractWordXml(word.slice(0,-10)),/incomplete|damaged/);
  assert.throws(()=>extractWordXml(word.replace('Résumé &amp; café','&#0;')),/character code/);
});
test('plain-text review normalises line endings and bounds input without inventing semantic fields',()=>{
  assert.equal(normalisePlainText('\uFEFFAlex\r\nEngineer\rEvidence\0'),'Alex\nEngineer\nEvidence');
  assert.throws(()=>normalisePlainText('  '),/no readable text/);
  assert.throws(()=>normalisePlainText('x'.repeat(50001)),/50,000/);
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
});
