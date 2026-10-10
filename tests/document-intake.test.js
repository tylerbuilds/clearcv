import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {extractDocument,DOCUMENT_BYTE_LIMIT,DOCUMENT_TEXT_LIMIT} from '../src/document-intake.js';
import {exportDocx,crc32,extractDocx} from '../src/formats.js';
import {sampleDocument} from '../src/model.js';

const encode=text=>new TextEncoder().encode(text);
const rtf=text=>Buffer.from(text,'latin1');
const ODT='application/vnd.oasis.opendocument.text';
const odtXml=body=>`<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
const manifest=body=>`<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">${body}</manifest:manifest>`;

// Real ZIP records, CRCs and raw-deflate payloads; these are generated test
// documents, not mocked extractor return values.
function zip(files,{compressed=true}={}) {
  const locals=[],central=[];
  let offset=0;
  for(const [path,value] of Object.entries(files)) {
    const name=Buffer.from(path),body=typeof value==='string' ? Buffer.from(value) : Buffer.from(value);
    const method=compressed && path!=='mimetype' ? 8 : 0,packed=method===8 ? deflateRawSync(body) : body;
    const crc=crc32(body),local=Buffer.alloc(30),directory=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(method,8);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
    directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(method,10);
    directory.writeUInt32LE(crc,16);directory.writeUInt32LE(packed.length,20);directory.writeUInt32LE(body.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
    locals.push(local,name,packed);central.push(directory,name);offset+=30+name.length+packed.length;
  }
  const end=Buffer.alloc(22),directory=Buffer.concat(central);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
const odt=(body,options={})=>zip({mimetype:ODT,'content.xml':odtXml(body),...options.files},options);
function entries(bytes) {
  const result=[];
  let offset=bytes.readUInt32LE(bytes.length-6);
  for(let index=0;index<bytes.readUInt16LE(bytes.length-12);index++) {
    const nameSize=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32);
    result.push({name:bytes.subarray(offset+46,offset+46+nameSize).toString(),central:offset,local:bytes.readUInt32LE(offset+42)});
    offset+=46+nameSize+extra+comment;
  }
  return result;
}
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P='http://schemas.openxmlformats.org/package/2006/relationships';
const paragraph=text=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const wordPart=(root,body)=>`<w:${root} xmlns:w="${W}" xmlns:r="${R}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:v="urn:schemas-microsoft-com:vml">${body}</w:${root}>`;
const relationships=body=>`<Relationships xmlns="${P}">${body}</Relationships>`;
function multipartDocx(overrides={}) {
  const body=paragraph('Engineer')+'<w:p><w:hyperlink r:id="portfolio"><w:r><w:t>Portfolio</w:t></w:r></w:hyperlink></w:p>'+paragraph('Measured 32% improvement.')+'<w:p><w:r><w:t>Before box</w:t></w:r><mc:AlternateContent><mc:Choice Requires="v"><w:pict><v:shape><v:textbox><w:txbxContent>'+paragraph('Phone: +44 7700 900123')+'</w:txbxContent></v:textbox></v:shape></w:pict></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>'+paragraph('Phone: +44 7700 900123')+'</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent><w:r><w:t>After box</w:t></w:r></w:p>'+'<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden secret</w:t></w:r><w:r><w:rPr><w:vanish w:val="false"/></w:rPr><w:t>Visible fact</w:t></w:r><w:del><w:r><w:t>Deleted secret</w:t></w:r></w:del></w:p>'+'<w:p><w:fldSimple w:instr="HYPERLINK &quot;https://github.com/alex&quot;"><w:r><w:t>Code</w:t></w:r></w:fldSimple></w:p>'+'<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>HYPERLINK "https://linkedin.com/in/alex"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>LinkedIn</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'+'<w:p><w:r><w:footnoteReference w:id="1"/><w:endnoteReference w:id="1"/></w:r></w:p><w:sectPr><w:headerReference r:id="header"/><w:footerReference r:id="footer"/></w:sectPr>';
  return zip({
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/contact-area.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/notes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/></Types>',
    '_rels/.rels':relationships(`<Relationship Id="document" Type="${R}/officeDocument" Target="word/document.xml"/>`),
    'word/document.xml':wordPart('document',`<w:body>${body}</w:body>`),
    'word/_rels/document.xml.rels':relationships(`<Relationship Id="header" Type="${R}/header" Target="contact-area.xml"/><Relationship Id="footer" Type="${R}/footer" Target="footer1.xml"/><Relationship Id="footnotes" Type="${R}/footnotes" Target="notes.xml"/><Relationship Id="endnotes" Type="${R}/endnotes" Target="endnotes.xml"/><Relationship Id="portfolio" Type="${R}/hyperlink" Target="https://portfolio.example/alex?a=1&amp;b=2" TargetMode="External"/>`),
    'word/contact-area.xml':wordPart('hdr',paragraph('Alex Morgan')+'<w:p><w:hyperlink r:id="email"><w:r><w:t>Email</w:t></w:r></w:hyperlink></w:p>'),
    'word/_rels/contact-area.xml.rels':relationships(`<Relationship Id="email" Type="${R}/hyperlink" Target="mailto:alex@example.com" TargetMode="External"/>`),
    'word/footer1.xml':wordPart('ftr',paragraph('Footer contact: Bristol')),
    'word/notes.xml':wordPart('footnotes','<w:footnote w:type="separator" w:id="-1">'+paragraph('Separator secret')+'</w:footnote><w:footnote w:id="1">'+paragraph('Relevant footnote evidence')+'</w:footnote>'),
    'word/endnotes.xml':wordPart('endnotes','<w:endnote w:id="1">'+paragraph('Relevant endnote evidence')+'</w:endnote>'),
    ...overrides,
  });
}

test('Unicode text and Markdown retain evidence without guessing fields',async()=>{
  assert.deepEqual(await extractDocument(encode('\uFEFFAlex\r\nEngineer\rMeasured 32% improvement.'),{name:'CV.TXT'}),{text:'Alex\nEngineer\nMeasured 32% improvement.',format:'txt',warnings:[]});
  const markdown='# Alex\n\n- Built café tools\n- Reduced waste by **32%**';
  assert.deepEqual(await extractDocument(encode(markdown),{name:'cv.md'}),{text:markdown,format:'md',warnings:[]});
  assert.equal((await extractDocument(encode('Résumé'),{mime:'text/markdown; charset=utf-8'})).format,'md');
});

test('UTF-16 little/big endian with and without BOM preserves surrogate pairs',async()=>{
  const source='Alex 🌱\r\nEvidence café';
  const le=Buffer.from(source,'utf16le'),be=Buffer.from(le).swap16();
  for(const input of [Buffer.concat([Buffer.from([0xff,0xfe]),le]),Buffer.concat([Buffer.from([0xfe,0xff]),be]),le,be]) {
    assert.equal((await extractDocument(input,{name:'cv.txt'})).text,'Alex 🌱\nEvidence café');
  }
  await assert.rejects(extractDocument(Buffer.from([0xff,0xfe,0x41]),{name:'cv.txt'}),/UTF-8 or UTF-16/);
  await assert.rejects(extractDocument(Buffer.from([0xff,0xfe,0x00,0xd8]),{name:'cv.txt'}),/UTF-8 or UTF-16/);
});

test('genuine DOCX extraction uses the existing interchange and warns on misleading extensions',async()=>{
  const doc=sampleDocument();doc.profile.name='Alex Résumé';
  const result=await extractDocument(exportDocx(doc),{name:'cv.txt',mime:'text/plain'});
  assert.equal(result.format,'docx');assert.ok(result.text.startsWith(doc.profile.name));assert.ok(result.text.includes(doc.profile.summary));
  assert.ok(result.warnings.some(text=>text.includes('.txt')));
  assert.ok(result.warnings.some(text=>text.includes('headers, body, footnotes, endnotes')));
  await assert.rejects(extractDocument(encode('Alex Engineer'),{name:'cv.docx'}),/do not match|truncated/);
});

test('multipart DOCX retains header contacts, visible textboxes, notes, footer facts and actual hyperlink targets',async()=>{
  const result=await extractDocument(multipartDocx(),{name:'cv.docx'});
  assert.equal(result.format,'docx');assert.ok(result.text.startsWith('Alex Morgan\nEmail (alex@example.com)\nEngineer'));
  for(const fact of ['Phone: +44 7700 900123','Before box','After box','Visible fact','Measured 32% improvement.','Portfolio (https://portfolio.example/alex?a=1&b=2)','Code (https://github.com/alex)','LinkedIn (https://linkedin.com/in/alex)','Relevant footnote evidence','Relevant endnote evidence','Footer contact: Bristol']) assert.ok(result.text.includes(fact),`Missing supplied fact: ${fact}`);
  assert.equal(result.text.split('Phone: +44 7700 900123').length-1,1);
  assert.ok(!/Hidden secret|Deleted secret|Separator secret/.test(result.text));
  assert.ok(result.text.indexOf('Relevant footnote')>result.text.indexOf('Engineer'));
  assert.ok(result.text.indexOf('Relevant endnote')>result.text.indexOf('Relevant footnote'));
  assert.ok(result.text.indexOf('Footer contact')>result.text.indexOf('Relevant endnote'));
  assert.ok(result.warnings.some(text=>text.includes('reading order')));
});

test('DOCX preserves strict namespace/default prefixes and DrawingML textbox facts in source order',async()=>{
  const strict='http://purl.oclc.org/ooxml/wordprocessingml/main';
  const xml=`<document xmlns="${strict}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><body><p><r><t>Alex</t></r></p><p><r><drawing><a:p><a:r><a:t>alex@example.com</a:t></a:r></a:p></drawing></r></p></body></document>`;
  const bytes=zip({'word/document.xml':xml});
  assert.equal(await extractDocx(bytes),'Alex\nalex@example.com');
});

test('DOCX never fetches external relationships; unsafe hyperlink targets stay absent',async()=>{
  const doc=wordPart('document','<w:body><w:p><w:hyperlink r:id="bad"><w:r><w:t>Visible label</w:t></w:r></w:hyperlink><w:hyperlink r:id="email"><w:r><w:t>alex@example.com</w:t></w:r></w:hyperlink></w:p></w:body>');
  for(const target of ['javascript:alert(1)','file:///private/secret','https://user:password@outside.invalid/','data:text/html,secret']) {
    const rels=relationships(`<Relationship Id="bad" Type="${R}/hyperlink" Target="${target}" TargetMode="External"/><Relationship Id="email" Type="${R}/hyperlink" Target="mailto:alex@example.com" TargetMode="External"/>`);
    const originalFetch=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw new Error('No fetch is allowed.');};
    try { assert.equal(await extractDocx(zip({'word/document.xml':doc,'word/_rels/document.xml.rels':rels})),'Visible labelalex@example.com');assert.equal(calls,0); }
    finally {globalThis.fetch=originalFetch;}
  }
  await assert.rejects(extractDocx(multipartDocx({'word/_rels/document.xml.rels':relationships(`<Relationship Id="header" Type="${R}/header" Target="https://outside.invalid/header.xml" TargetMode="External"/>`)})),/links to external text/);
  await assert.rejects(extractDocx(multipartDocx({'word/_rels/document.xml.rels':relationships(`<Relationship Id="header" Type="${R}/header" Target="../../private.xml"/>`)})),/points outside the document/);
});

test('DOCX multipart bounds, corrupt additional text, unsafe XML and missing relationships fail atomically',async()=>{
  const damaged=multipartDocx(),header=entries(damaged).find(entry=>entry.name==='word/contact-area.xml');
  damaged[header.local+30+Buffer.byteLength(header.name)+5]^=1;await assert.rejects(extractDocx(damaged));
  await assert.rejects(extractDocx(multipartDocx({'word/contact-area.xml':'<!DOCTYPE w:hdr [<!ENTITY x "huge">]>'+wordPart('hdr',paragraph('Alex'))})),/unsupported/);
  await assert.rejects(extractDocx(multipartDocx({'word/_rels/document.xml.rels':relationships(`<Relationship Id="header" Type="${R}/header" Target="missing.xml"/>`)})),/missing/);
  await assert.rejects(extractDocx(multipartDocx({'word/_rels/document.xml.rels':relationships(`<Relationship Id="header" Type="${R}/header" Target="contact-area.xml"/><Relationship Id="header" Type="${R}/header" Target="contact-area.xml"/>`)})),/links between text parts.*repeated/);
  await assert.rejects(extractDocx(multipartDocx({'word/contact-area.xml':wordPart('hdr',paragraph('x'.repeat(30000))),'word/document.xml':wordPart('document','<w:body>'+paragraph('y'.repeat(30000))+'<w:sectPr><w:headerReference r:id="header"/></w:sectPr></w:body>')})),/50,000/);
  const tooMany={'word/document.xml':wordPart('document','<w:body>'+paragraph('Evidence')+'</w:body>')};
  let headerReferences='',headerRelationships='';
  for(let i=0;i<64;i++) {
    tooMany[`word/header${i}.xml`]=wordPart('hdr',paragraph('Contact'));
    headerReferences+=`<w:headerReference r:id="header${i}"/>`;
    headerRelationships+=`<Relationship Id="header${i}" Type="${R}/header" Target="header${i}.xml"/>`;
  }
  tooMany['word/document.xml']=wordPart('document','<w:body>'+paragraph('Evidence')+'<w:sectPr>'+headerReferences+'</w:sectPr></w:body>');
  tooMany['word/_rels/document.xml.rels']=relationships(headerRelationships);
  await assert.rejects(extractDocx(zip(tooMany)),/64 supported text parts/);
});

test('DOCX stale orphan headers and unreferenced note IDs cannot become current candidate facts',async()=>{
  const body=wordPart('document','<w:body>'+paragraph('Current Candidate')+paragraph('Engineer')+'</w:body>');
  const oldHeader=wordPart('hdr',paragraph('Previous Client')+paragraph('previous@example.com'));
  const orphan=zip({'word/document.xml':body,'word/header1.xml':oldHeader});
  assert.equal(await extractDocx(orphan),'Current Candidate\nEngineer');
  const unusedRelationship=zip({'word/document.xml':body,'word/header1.xml':oldHeader,'word/_rels/document.xml.rels':relationships(`<Relationship Id="old" Type="${R}/header" Target="header1.xml"/>`)});
  assert.equal(await extractDocx(unusedRelationship),'Current Candidate\nEngineer');
  const main=wordPart('document','<w:body>'+paragraph('Current Candidate')+'<w:p><w:r><w:t>Evidence</w:t><w:footnoteReference w:id="1"/></w:r></w:p></w:body>');
  const rels=relationships(`<Relationship Id="notes" Type="${R}/footnotes" Target="footnotes.xml"/>`);
  const notes=wordPart('footnotes','<w:footnote w:id="1">'+paragraph('Current evidence')+'</w:footnote><w:footnote w:id="2">'+paragraph('Previous Client previous@example.com')+'</w:footnote>');
  assert.equal(await extractDocx(zip({'word/document.xml':main,'word/_rels/document.xml.rels':rels,'word/footnotes.xml':notes})),'Current Candidate\nEvidence\nCurrent evidence');
  await assert.rejects(extractDocx(zip({'word/document.xml':main,'word/_rels/document.xml.rels':rels,'word/footnotes.xml':wordPart('footnotes','<w:footnote w:id="2">'+paragraph('Other evidence')+'</w:footnote>')})),/linked Word footnote.*missing/);
});

test('compressed and stored ODT preserve paragraphs, lists, inline Unicode and table cells',async()=>{
  const body='<text:h>Alex &amp; Co</text:h><text:p>Engineer<text:s text:c="2"/>at <text:span>caf&#233;</text:span><text:tab/>Bristol<text:line-break/>Evidence</text:p><text:list><text:list-item><text:p>Measured 32% improvement.</text:p></text:list-item><text:list-item><text:p>Built tools.</text:p><text:p>Second paragraph.</text:p></text:list-item></text:list><table:table><table:table-row><table:table-cell><text:p>Role</text:p></table:table-cell><table:table-cell><text:p>Company</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>Engineer</text:p></table:table-cell><table:table-cell><text:p>Example Ltd</text:p></table:table-cell></table:table-row></table:table>';
  for(const compressed of [true,false]) {
    const result=await extractDocument(odt(body,{compressed}),{name:'cv.odt'});
    assert.equal(result.format,'odt');
    assert.equal(result.text,'Alex & Co\nEngineer  at café\tBristol\nEvidence\n• Measured 32% improvement.\n• Built tools.\nSecond paragraph.\nRole\tCompany\nEngineer\tExample Ltd');
    assert.ok(result.warnings.length);
  }
});

test('ODT namespace aliases and default office namespace work; metadata and drawing text stay excluded',async()=>{
  const xml='<document-content xmlns="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:t="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:d="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><body><text><t:p>Visible<t:span> evidence</t:span><annotation><t:p>Private comment</t:p></annotation><t:note><t:note-body><t:p>Footnote body</t:p></t:note-body></t:note><d:frame><d:text-box><t:p>Drawing</t:p></d:text-box></d:frame></t:p><t:tracked-changes><t:deletion><t:p>Deleted text</t:p></t:deletion></t:tracked-changes><t:p><![CDATA[Literal <text> & evidence]]></t:p></text></body></document-content>';
  assert.equal((await extractDocument(zip({mimetype:ODT,'content.xml':xml}),{name:'cv.odt'})).text,'Visible evidence\nLiteral <text> & evidence');
  const repeated='<table:table><table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2"><text:p>Evidence</text:p></table:table-cell></table:table-row></table:table>';
  assert.equal((await extractDocument(odt(repeated),{name:'cv.odt'})).text,'Evidence\tEvidence\nEvidence\tEvidence');
});

test('ODT rejects malformed XML, unsafe entities and wrong media type without partial output',async()=>{
  const xml=odtXml('<text:p>Evidence</text:p>');
  for(const bad of [xml.replace('</text:p>','</text:h>'),xml.slice(0,-8),xml.replace('Evidence','&unknown;'),xml.replace('Evidence','&#0;'),'<!DOCTYPE office:document-content [<!ENTITY x "outside">]>'+xml,xml.replace('xmlns:text=','xmlns:bad='),xml.replace('<text:p>','<text:p text:id="1" text:id="2">'),xml.replace('<text:p>','<text:p text:id="a&b">')]) {
    await assert.rejects(extractDocument(zip({mimetype:ODT,'content.xml':bad}),{name:'cv.odt'}),/formatting|character code|unknown format|text setting|document start|incomplete|damaged/);
  }
  await assert.rejects(extractDocument(zip({mimetype:'application/vnd.oasis.opendocument.spreadsheet','content.xml':xml}),{name:'cv.odt'}),/ODT text document/);
  await assert.rejects(extractDocument(zip({'content.xml':xml}),{name:'cv.odt'}),/missing its file type/);
  await assert.rejects(extractDocument(zip({mimetype:ODT,'content.xml':xml.replace('<text:p>','<text:p xmlns:alias="urn:oasis:names:tc:opendocument:xmlns:text:1.0" text:id="one" alias:id="two">')}),{name:'cv.odt'}),/text setting is repeated/);
  await assert.rejects(extractDocument(zip({mimetype:ODT,'content.xml':xml.replace('<text:p>','<text:1>').replace('</text:p>','</text:1>')}),{name:'cv.odt'}),/unknown format/);
});

test('ODT rejects package/manifest encryption and malformed manifests',async()=>{
  const encrypted=odt('<text:p>Evidence</text:p>',{files:{'META-INF/manifest.xml':manifest('<manifest:file-entry manifest:full-path="content.xml"><manifest:encryption-data/></manifest:file-entry>')}});
  await assert.rejects(extractDocument(encrypted,{name:'cv.odt'}),/ODT file is encrypted/);
  const zipEncrypted=odt('<text:p>Evidence</text:p>'),entry=entries(zipEncrypted).find(entry=>entry.name==='content.xml');
  zipEncrypted.writeUInt16LE(0x801,entry.central+8);zipEncrypted.writeUInt16LE(0x801,entry.local+6);
  await assert.rejects(extractDocument(zipEncrypted,{name:'cv.odt'}),/encrypted/);
  await assert.rejects(extractDocument(odt('<text:p>Evidence</text:p>',{files:{'META-INF/manifest.xml':'<bad/>'}}),{name:'cv.odt'}),/list of contents/);
});

test('archive corruption, conflicting entries, traversal and truncation fail closed',async()=>{
  const damaged=odt('<text:p>Evidence</text:p>'),main=entries(damaged).find(entry=>entry.name==='content.xml');
  damaged[main.local+30+Buffer.byteLength('content.xml')+5]^=1;
  await assert.rejects(extractDocument(damaged,{name:'cv.odt'}));
  const conflict=odt('<text:p>Evidence</text:p>'),conflictEntry=entries(conflict).find(entry=>entry.name==='content.xml');
  conflict.writeUInt32LE(0,conflictEntry.local+14);
  await assert.rejects(extractDocument(conflict,{name:'cv.odt'}),/conflicting/);
  await assert.rejects(extractDocument(zip({mimetype:ODT,'content.xml':odtXml('<text:p>Evidence</text:p>'),'../private.txt':'secret'}),{name:'cv.odt'}),/unsafe/);
  const truncated=odt('<text:p>Evidence</text:p>').subarray(0,-2);
  await assert.rejects(extractDocument(truncated,{name:'cv.odt'}),/complete/);
  await assert.rejects(extractDocument(zip({mimetype:ODT,'content.xml':odtXml('<text:p>Evidence</text:p>'),'word/document.xml':'<x/>'}),{name:'cv.odt'}),/conflicting document formats/);
});

test('aggregate expansion, entry count, lying inflate size and ODT text/repetition are bounded',async()=>{
  const huge=odt('<text:p>Evidence</text:p>',{files:{'unused-a.bin':Buffer.alloc(4_000_001),'unused-b.bin':Buffer.alloc(4_000_001)}});
  assert.ok(huge.length<DOCUMENT_BYTE_LIMIT);
  await assert.rejects(extractDocument(huge,{name:'cv.odt'}),/8 MB/);
  const many={mimetype:ODT,'content.xml':odtXml('<text:p>Evidence</text:p>')};
  for(let i=0;i<511;i++) many[`unused/${i}`]='';
  await assert.rejects(extractDocument(zip(many),{name:'cv.odt'}),/512 entries/);
  const lie=odt('<text:p>'+ 'Evidence '.repeat(1000)+'</text:p>'),entry=entries(lie).find(entry=>entry.name==='content.xml');
  lie.writeUInt32LE(1,entry.central+24);lie.writeUInt32LE(1,entry.local+22);
  await assert.rejects(extractDocument(lie,{name:'cv.odt'}),/expands/);
  await assert.rejects(extractDocument(odt('<text:p>'+ 'x'.repeat(DOCUMENT_TEXT_LIMIT+1)+'</text:p>'),{name:'cv.odt'}),/50,000/);
  await assert.rejects(extractDocument(odt('<text:p><text:s text:c="1000000000"/>Evidence</text:p>'),{name:'cv.odt'}),/count of repeated spaces/);
  await assert.rejects(extractDocument(odt('<table:table><table:table-row table:number-rows-repeated="9999999"><table:table-cell><text:p>Evidence</text:p></table:table-cell></table:table-row></table:table>'),{name:'cv.odt'}),/table.*repeat count/);
});

test('RTF text preserves scoped Unicode fallbacks, escapes, structure and code-page bytes',async()=>{
  const document=String.raw`{\rtf1\ansi\ansicpg1252\uc1 Alex \'e9\par Engineer\tab Evidence\line \u233? {\uc2\u945??} \u946? \{tools\} \\ path\par \bullet\tab Measured 32%.}`;
  const result=await extractDocument(rtf(document),{name:'cv.rtf'});
  assert.equal(result.format,'rtf');
  assert.equal(result.text,'Alex é\nEngineer\tEvidence\né α β {tools} \\ path\n•\tMeasured 32%.');
  assert.equal((await extractDocument(rtf(String.raw`{\rtf1\ansi\uc1 \u-10179?\u-8638?}`),{name:'cv.rtf'})).text,'🙂');
  assert.equal((await extractDocument(rtf(String.raw`{\rtf1\ansi\uc1 \u233\'e9vidence}`),{name:'cv.rtf'})).text,'évidence');
});

test('RTF font code pages and multibyte hexadecimal runs avoid mojibake',async()=>{
  const document=String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fcharset0 Arial;}{\f1\fcharset204 Cyrillic;}{\f2\fcharset128 Japanese;}{\f3\fcharset2 Symbol;}}\f0 Alex \f1 \'cf\'f0\'e8\'e2\'e5\'f2\f2 \'93\'fa\'96\'7b\f0 Evidence}`;
  assert.equal((await extractDocument(rtf(document),{name:'cv.rtf'})).text,'Alex Привет日本Evidence');
  assert.equal((await extractDocument(rtf(String.raw`{\rtf1\ansi\ansicpg1251{\fonttbl{\f0\fcharset0 Arial;}}\f0 \'cf\'f0\'e8\'e2\'e5\'f2}`),{name:'cv.rtf'})).text,'Привет');
  await assert.rejects(extractDocument(rtf(document.replace('Evidence','\u005cf3 Symbol text')),{name:'cv.rtf'}),/font character set/);
  await assert.rejects(extractDocument(rtf(String.raw`{\rtf1\ansi\ansicpg9999 Evidence}`),{name:'cv.rtf'}),/code page/);
});

test('RTF hidden/destination/binary content is excluded, while field results and Unicode alternatives survive',async()=>{
  const document=String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}{\info{\author Private author}}Visible {\*\unknown Private unknown}{\pict\bin5 a{}\b}{\object{\objdata Private object}}{\v Secret}{\deleted Old text}{\field{\*\fldinst HYPERLINK "https://outside.invalid"}{\fldrslt Evidence}}\par {\upr{ANSI fallback}{\*\ud Unicode \u233?}}\par Done}`;
  assert.equal((await extractDocument(rtf(document),{name:'cv.rtf'})).text,'Visible Evidence\nUnicode é\nDone');
  assert.equal((await extractDocument(rtf(String.raw`{\rtf1 Visible {\deleted\v Secret\v0 Still deleted\deleted0 Restored}}`),{name:'cv.rtf'})).text,'Visible Restored');
});

test('RTF visible header contact facts, footer text and footnotes survive without importing metadata',async()=>{
  const result=await extractDocument(rtf(String.raw`{\rtf1\ansi{\info{\author Private metadata}}{\header Alex Morgan\par alex@example.com}{\footer Portfolio: example.com}Engineer\par Measured 32%.{\footnote Relevant footnote}}`),{name:'cv.rtf'});
  assert.equal(result.text,'Alex Morgan\nalex@example.com\nPortfolio: example.com\nEngineer\nMeasured 32%.\nRelevant footnote');
  assert.ok(result.warnings.some(text=>text.includes('source order')));
  const disguised=await extractDocument(rtf(String.raw`{\rtf1 Alex\par Engineer}`),{name:'cv.png',mime:'image/png'});
  assert.equal(disguised.format,'rtf');assert.ok(disguised.warnings.some(text=>text.includes('.png')));
});

test('RTF malformed groups/escapes/binary/Unicode and text/depth limits reject partial text',async()=>{
  for(const bad of [String.raw`{\rtf1 Evidence`,String.raw`{\rtf1 Evidence}}`,String.raw`{\rtf1 Evidence}trailing`,String.raw`{\rtf1 Evidence \'g0}`,String.raw`{\rtf1 Evidence \bin100 short}`,String.raw`{\rtf1 Evidence \uc-1\u233?}`,String.raw`{\rtf1 Evidence \u999999?}`,String.raw`{\rtf1\uc0 \u-10179}`]) {
    await assert.rejects(extractDocument(rtf(bad),{name:'cv.rtf'}),/RTF/);
  }
  await assert.rejects(extractDocument(rtf('{\\rtf1 '+ 'x'.repeat(DOCUMENT_TEXT_LIMIT+1)+'}'),{name:'cv.rtf'}),/50,000/);
  await assert.rejects(extractDocument(rtf('{\\rtf1 '+ '{'.repeat(129)+'Evidence'+'}'.repeat(130)),{name:'cv.rtf'}),/nested/);
});

test('HTML keeps visible text, lists and tables without creating a DOM or fetching resources',async()=>{
  const html='<!DOCTYPE html><html><head><title>Metadata</title><script>fetch("https://outside.invalid"); if (a < b) { alert("<p>script</p>"); }</script><style>body { background:url(https://outside.invalid/a) }</style></head><body><h1>Alex &amp; Co</h1><p>Engineer &pound;100<br>Evidence &#x1f331;</p><ul><li>Measured 32%.</li><li>Built tools.</li></ul><table><tr><td>Role</td><td>Company</td></tr></table><a href="https://outside.invalid">Visible link</a><img src="https://outside.invalid/image" onerror="alert(1)"><iframe src="https://outside.invalid">Frame secret</iframe><div hidden>Hidden secret</div><p aria-hidden="true">Aria secret</p><span style="display:none !important">CSS secret</span><template><p>Template secret</p></template></body></html>';
  const originalFetch=globalThis.fetch;
  let calls=0;globalThis.fetch=()=>{ calls++; throw new Error('No external calls are allowed.'); };
  try {
    const result=await extractDocument(encode(html),{name:'cv.html'});
    assert.equal(result.format,'html');assert.equal(result.text,'Alex & Co\nEngineer £100\nEvidence 🌱\n• Measured 32%.\n• Built tools.\nRole\tCompany\nVisible link (https://outside.invalid/)');assert.equal(calls,0);
    assert.ok(result.warnings.some(text=>text.includes('Scripts')));
  } finally {globalThis.fetch=originalFetch;}
});

test('HTML preserves unfamiliar entities literally with a warning and rejects truncated active markup',async()=>{
  const result=await extractDocument(encode('<p>Alex &eacute; &#233;</p>'),{mime:'text/html'});
  assert.equal(result.text,'Alex &eacute; é');assert.ok(result.warnings.some(text=>text.includes('character codes were left as written')));
  for(const html of ['<p>Evidence</p><script>truncated','<p>Evidence</p><img src="truncated','<p>Evidence</p><!ENTITY external "outside">','<p>Evidence</p><div>&#x110000;</div>']) await assert.rejects(extractDocument(encode(html),{name:'cv.html'}),/HTML/);
  await assert.rejects(extractDocument(encode('<p>'+ 'x'.repeat(DOCUMENT_TEXT_LIMIT+1)+'</p>'),{name:'cv.html'}),/50,000/);
});

test('HTML useful anchor destinations survive as inert text and unsafe targets never do',async()=>{
  const html='<p><a href="https://portfolio.example/alex?a=1&amp;b=2">Portfolio</a> · <a href="mailto:alex@example.com?subject=Role">Email</a></p><p><a href="https://portfolio.example/">portfolio.example</a> · <a href="javascript:alert(1)">Unsafe label</a> · <a href="https://user:password@outside.invalid">Credential label</a></p>';
  assert.equal((await extractDocument(encode(html),{name:'cv.html'})).text,'Portfolio (https://portfolio.example/alex?a=1&b=2) · Email (alex@example.com)\nportfolio.example · Unsafe label · Credential label');
});

test('binary and unsupported files cannot be silently imported as text',async()=>{
  for(const binary of [Buffer.from([0x00,0x01,0x02,0x03]),Buffer.from([0xff,0xff,0x80,0x80]),Buffer.from([0x41,0x00,0x42,0x01])]) await assert.rejects(extractDocument(binary,{name:'cv.txt'}),/binary|UTF-8 or UTF-16/);
  const ole=Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);
  await assert.rejects(extractDocument(ole,{name:'cv.txt'}),/old Word file is damaged/i);
  await assert.rejects(extractDocument(encode('Plain-looking legacy file'),{name:'cv.doc'}),/Legacy Word/);
  for(const [name,bytes] of [['cv.txt',Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])],['scan.jpg',encode('wrong bytes')]]) await assert.rejects(extractDocument(bytes,{name}),/image.*(Import CV|damaged)/i);
  await assert.rejects(extractDocument(encode('Evidence'),{name:'cv.exe'}),/unsupported/);
  await assert.rejects(extractDocument(zip({'notes.txt':'Evidence'}),{name:'cv.zip'}),/not a supported DOCX or ODT/);
});

test('the async boundary rejects oversized/empty inputs and cancellation without accepting partial text',async()=>{
  await assert.rejects(extractDocument('text',{name:'cv.txt'}),/bytes/);
  await assert.rejects(extractDocument(new Uint8Array()),/non-empty/);
  await assert.rejects(extractDocument(new Uint8Array(DOCUMENT_BYTE_LIMIT+1)),/2 MB/);
  await assert.rejects(extractDocument(encode('x'.repeat(DOCUMENT_TEXT_LIMIT+1)),{name:'cv.txt'}),/50,000/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(extractDocument(odt('<text:p>Evidence</text:p>'),{name:'cv.odt',signal:controller.signal}),{name:'AbortError'});
  assert.equal((await extractDocument(encode('x'.repeat(DOCUMENT_TEXT_LIMIT)),{name:'cv.txt'})).text.length,DOCUMENT_TEXT_LIMIT);
});
