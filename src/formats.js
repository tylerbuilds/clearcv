// Original, dependency-free OOXML text interchange. Imported content is reviewed
// by the user; this module does not infer achievements or execute Word content.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const DOCX_LIMIT = 2_000_000;
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const esc = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[char]));
const crcTable = Array.from({ length:256 }, (_, i) => {
  let crc = i;
  for (let bit=0; bit<8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset=0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function header(size) { const bytes = new Uint8Array(size); return [bytes, new DataView(bytes.buffer)]; }
function zip(files) {
  const locals=[], directory=[];
  let offset=0;
  for (const [path, text] of Object.entries(files)) {
    const name=encoder.encode(path), bytes=encoder.encode(text), crc=crc32(bytes);
    const [local,l]=header(30);
    l.setUint32(0,0x04034b50,true); l.setUint16(4,20,true); l.setUint16(6,0x800,true);
    l.setUint32(14,crc,true); l.setUint32(18,bytes.length,true); l.setUint32(22,bytes.length,true); l.setUint16(26,name.length,true);
    locals.push(local,name,bytes);
    const [central,c]=header(46);
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x800,true);
    c.setUint32(16,crc,true); c.setUint32(20,bytes.length,true); c.setUint32(24,bytes.length,true);
    c.setUint16(28,name.length,true); c.setUint32(42,offset,true);
    directory.push(central,name); offset += local.length+name.length+bytes.length;
  }
  const cd=concat(directory), [end,e]=header(22);
  e.setUint32(0,0x06054b50,true); e.setUint16(8,Object.keys(files).length,true); e.setUint16(10,Object.keys(files).length,true);
  e.setUint32(12,cd.length,true); e.setUint32(16,offset,true);
  return concat([...locals,cd,end]);
}
const paragraph = (text, style='Normal') => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
const lines = (text, style='Normal') => String(text || '').split(/\r?\n/).map(line => paragraph(line,style)).join('');
export function exportDocx(doc, {kind='cv'}={}) {
  if (!doc?.profile || !['cv','letter'].includes(kind)) throw new Error('Choose a CV or cover letter to export.');
  let body='';
  if (kind === 'letter') {
    const letter=doc.coverLetter || {};
    body += paragraph(doc.profile.name,'Title');
    body += paragraph([doc.profile.email,doc.profile.phone,doc.profile.location,doc.profile.website].filter(Boolean).join(' · '));
    body += [letter.date,letter.recipient,letter.company,letter.subject || letter.role,letter.salutation].filter(Boolean).map(text => lines(text)).join('');
    body += lines(letter.body);
    body += lines(letter.closing || 'Kind regards,');
    body += paragraph(doc.profile.name);
  } else {
    body += paragraph(doc.profile.name,'Title')+paragraph(doc.profile.headline,'Subtitle');
    body += paragraph([doc.profile.email,doc.profile.phone,doc.profile.location,doc.profile.website].filter(Boolean).join(' · '));
    const sections=doc.sectionOrder || ['profile','experience','education','skills'];
    for (const section of sections) {
      if ((doc.hiddenSections || []).includes(section)) continue;
      if (section === 'profile') {
        if(doc.profile.summary) body += paragraph(doc.sectionTitles?.profile || 'Summary','Heading1')+lines(doc.profile.summary);
      } else if (section === 'skills') {
        if (doc.skills.length) body += paragraph(doc.sectionTitles?.skills || 'Skills','Heading1')+paragraph(doc.skills.map(item => item.name).filter(Boolean).join(' · '));
      } else if (['experience','education'].includes(section)) {
        if (!doc[section].length) continue;
        body += paragraph(doc.sectionTitles?.[section] || (section === 'experience' ? 'Experience' : 'Education'),'Heading1');
        for (const item of doc[section]) {
          body += paragraph([item.title,item.organisation].filter(Boolean).join(' · '),'Heading2');
          body += paragraph([item.dates,item.location].filter(Boolean).join(' · '),'Subtitle');
          body += lines(item.description);
        }
      } else {
        const custom=(doc.customSections || []).find(item => item.id === section);
        if (custom) body += paragraph(custom.title,'Heading1')+lines(custom.content);
      }
    }
  }
  const layout=doc.layout || {}, font={sans:'Arial',serif:'Georgia',mono:'Courier New'}[layout.font] || 'Arial';
  const size=Math.round(Math.max(8,Math.min(16,Number(layout.fontSize) || 11))*2);
  const margin=Math.round(Math.max(20,Math.min(80,Number(layout.margin) || 46))*15);
  const letterPage=layout.pageSize === 'Letter';
  const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WORD_NS}"><w:body>${body}<w:sectPr><w:pgSz w:w="${letterPage ? 12240 : 11906}" w:h="${letterPage ? 15840 : 16838}"/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles=`<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/><w:sz w:val="${size}"/></w:rPr></w:rPrDefault></w:docDefaults>${[['Normal',size],['Title',size+20],['Subtitle',size],['Heading1',size+5],['Heading2',size+2]].map(([name,points]) => `<w:style w:type="paragraph" w:styleId="${name}"${name==='Normal' ? ' w:default="1"' : ''}><w:name w:val="${name}"/><w:pPr><w:spacing w:after="120"/>${name.startsWith('Heading') ? '<w:keepNext/>' : ''}</w:pPr><w:rPr><w:sz w:val="${points}"/>${name.startsWith('Heading') ? '<w:b/>' : ''}</w:rPr></w:style>`).join('')}</w:styles>`;
  return zip({
    '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':xml,
    'word/styles.xml':styles,
    'word/_rels/document.xml.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
  });
}
export function normalisePlainText(text) {
  if (typeof text !== 'string') throw new Error('Choose a text document.');
  const result=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim();
  if (!result) throw new Error('The document contains no readable text.');
  if (result.length > 50000) throw new Error('Imported text must contain at most 50,000 characters.');
  return result;
}
function decodeEntities(text) {
  return text.replace(/&([^;\s]+);|&/g,(whole,entity) => {
    const known={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if (Object.hasOwn(known,entity)) return known[entity];
    if (/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity || '')) {
      const code=entity[1].toLowerCase()==='x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
      if ([9,10,13].includes(code) || code>=32 && code<=0x10ffff && !(code>=0xd800 && code<=0xdfff) && ![0xfffe,0xffff].includes(code)) return String.fromCodePoint(code);
    }
    throw new Error('The Word document contains an unsupported XML entity.');
  });
}
export function extractWordXml(xml) {
  if (typeof xml !== 'string' || encoder.encode(xml).length > DOCX_LIMIT || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported or oversized Word XML.');
  // The scanner checks balanced XML without a DOM dependency. Only Word text,
  // tabs and breaks are emitted; relationships, fields and embedded objects are ignored.
  const tokens=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>|[^<]+/g;
  const stack=[], paragraphs=[];
  let cursor=0, prefix='', root=false, closed=false, current='', inText=false;
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== cursor) throw new Error('The Word document contains malformed XML.');
    const token=match[0]; cursor += token.length;
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { if(inText) current += token.slice(9,-3); continue; }
    if (!token.startsWith('<')) { if(inText) current += decodeEntities(token); else if(!stack.length && token.trim()) throw new Error('Malformed Word XML.'); continue; }
    const closing=token.startsWith('</'), selfClosing=token.endsWith('/>'), tag=token.match(/^<\/?([\w:.-]+)/)[1];
    if (closing) {
      if (!/^<\/[\w:.-]+\s*>$/.test(token) || stack.pop() !== tag) throw new Error('The Word document contains unbalanced XML.');
      if (tag===`${prefix}:t`) inText=false;
      if (tag===`${prefix}:p`) { paragraphs.push(current); current=''; }
      if (!stack.length) closed=true;
      continue;
    }
    if (!stack.length) {
      if (root || closed || !tag.endsWith(':document')) throw new Error('Choose a supported Word document.');
      prefix=tag.split(':')[0];
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(prefix)) throw new Error('Unsupported Word namespace prefix.');
      const ns=token.match(new RegExp(`\\bxmlns:${prefix}\\s*=\\s*["']([^"']*)["']`));
      if (!ns || ns[1] !== WORD_NS) throw new Error('Choose a supported Word document.');
      root=true;
    }
    if (tag===`${prefix}:t`) { if(inText) throw new Error('Malformed Word text.'); inText=!selfClosing; }
    if ([`${prefix}:tab`,`${prefix}:br`,`${prefix}:cr`].includes(tag)) current += tag.endsWith(':tab') ? '\t' : '\n';
    if (!selfClosing) stack.push(tag);
    if (stack.length>128 || paragraphs.length>10000 || current.length>50000) throw new Error('The Word document is too complex or contains too much text.');
  }
  if (cursor!==xml.length || stack.length || !root) throw new Error('The Word document contains incomplete XML.');
  return normalisePlainText(paragraphs.join('\n'));
}
async function inflate(bytes, expected) {
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot extract compressed Word documents. Use a current browser or import plain text.');
  let stream;
  try { stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')); } catch { throw new Error('This browser cannot extract compressed Word documents. Import plain text instead.'); }
  const reader=stream.getReader(), parts=[];
  let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read(); if(done) break;
      size += value.length;
      if(size>DOCX_LIMIT || size>expected) throw new Error('The Word document expands beyond its supported size.');
      parts.push(value);
    }
  } catch(error) { await reader.cancel().catch(()=>{}); throw new Error(`Unable to extract Word document: ${error.message}`); }
  return concat(parts);
}
export async function extractDocx(input) {
  const bytes=input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length<22 || bytes.length>DOCX_LIMIT) throw new Error('Choose a DOCX file smaller than 2 MB.');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) {
    if(v.getUint32(i,true)===0x06054b50 && i+22+v.getUint16(i+20,true)===bytes.length) { end=i; break; }
  }
  if(end<0 || v.getUint16(end+4,true)!==0 || v.getUint16(end+6,true)!==0) throw new Error('Choose a supported single-file DOCX archive.');
  const count=v.getUint16(end+10,true), cdSize=v.getUint32(end+12,true), cdStart=v.getUint32(end+16,true);
  if(!count || count>512 || v.getUint16(end+8,true)!==count || cdStart+cdSize!==end) throw new Error('The Word archive has an unsupported directory.');
  const names=new Set(); let cursor=cdStart, documentEntry;
  for(let i=0;i<count;i++) {
    if(cursor+46>end || v.getUint32(cursor,true)!==0x02014b50) throw new Error('The Word archive directory is malformed.');
    const flags=v.getUint16(cursor+8,true), method=v.getUint16(cursor+10,true), crc=v.getUint32(cursor+16,true);
    const compressed=v.getUint32(cursor+20,true), expanded=v.getUint32(cursor+24,true), nameLength=v.getUint16(cursor+28,true);
    const extra=v.getUint16(cursor+30,true), comment=v.getUint16(cursor+32,true), local=v.getUint32(cursor+42,true);
    if(cursor+46+nameLength+extra+comment>end) throw new Error('The Word archive directory is truncated.');
    const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength));
    if(names.has(name) || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || name.includes('\0')) throw new Error('The Word archive contains invalid or duplicate paths.');
    names.add(name);
    if(name==='word/document.xml') documentEntry={flags,method,crc,compressed,expanded,local};
    cursor += 46+nameLength+extra+comment;
  }
  if(cursor!==end || !documentEntry) throw new Error('This archive has no Word document text.');
  const entry=documentEntry, {local}=entry;
  if(entry.flags&1 || ![0,8].includes(entry.method) || entry.expanded>DOCX_LIMIT || local+30>cdStart || v.getUint32(local,true)!==0x04034b50) throw new Error('Encrypted, oversized or unsupported Word documents cannot be imported.');
  const localFlags=v.getUint16(local+6,true), localMethod=v.getUint16(local+8,true), nameLength=v.getUint16(local+26,true), extra=v.getUint16(local+28,true);
  const start=local+30+nameLength+extra;
  if(localFlags!==entry.flags || localMethod!==entry.method || start>cdStart || start+entry.compressed>cdStart || decoder.decode(bytes.subarray(local+30,local+30+nameLength))!=='word/document.xml') throw new Error('The Word document archive contains conflicting entries.');
  const packed=bytes.subarray(start,start+entry.compressed), unpacked=entry.method===0 ? packed : await inflate(packed,entry.expanded);
  if(unpacked.length!==entry.expanded || crc32(unpacked)!==entry.crc) throw new Error('The Word document text is damaged.');
  return extractWordXml(decoder.decode(unpacked));
}
