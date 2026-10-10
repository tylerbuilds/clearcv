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
    throw new Error('A text character code in this Word file is unsupported. Save a fresh DOCX or text copy.');
  });
}
const WORD_URIS=new Set([WORD_NS,'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const DRAWING_URIS=new Set(['http://schemas.openxmlformats.org/drawingml/2006/main','http://purl.oclc.org/ooxml/drawingml/main']);
const RELATIONSHIP_URIS=new Set(['http://schemas.openxmlformats.org/officeDocument/2006/relationships','http://purl.oclc.org/ooxml/officeDocument/relationships']);
const PACKAGE_RELS='http://schemas.openxmlformats.org/package/2006/relationships';
const MC_NS='http://schemas.openxmlformats.org/markup-compatibility/2006';

export function safeImportedLink(value) {
  if(typeof value!=='string') return null;
  const text=value.trim();
  if(!text || /[\u0000-\u0020\u007f\\]/u.test(text)) return null;
  if(/^mailto:/i.test(text)) {
    let email;
    try { email=decodeURIComponent(text.slice(7).split('?')[0]); } catch { return null; }
    return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(email) && !email.includes('..') ? `mailto:${email}` : null;
  }
  if(!/^https?:\/\//i.test(text)) return null;
  try {
    const url=new URL(text);
    if(!url.hostname || url.username || url.password || url.hostname.includes('..')) return null;
    return url.href;
  } catch { return null; }
}
function linkSuffix(label,target) {
  if(!target) return '';
  const display=target.startsWith('mailto:') ? target.slice(7) : target;
  const needle=display.replace(/^https?:\/\//i,'').replace(/\/$/,'').toLowerCase();
  return needle && label.toLowerCase().includes(needle) ? '' : ` (${display})`;
}
function scanWordXml(xml,visitor) {
  if(typeof xml!=='string' || encoder.encode(xml).length>DOCX_LIMIT || /<!DOCTYPE|<!ENTITY/i.test(xml) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(xml)) throw new Error('This Word file uses unsupported formatting or contains too much text. Save a shorter DOCX or text copy.');
  const tokens=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>|[^<]+/g;
  const stack=[];
  let cursor=0,root=false,closed=false,count=0;
  for(const match of xml.matchAll(tokens)) {
    if(match.index!==cursor || ++count>100000) throw new Error('The text formatting in this Word file is damaged or too complicated to read. Save a fresh DOCX or text copy.');
    const token=match[0];cursor+=token.length;
    if(token.startsWith('<!--')) { if(token.slice(4,-3).includes('--')) throw new Error('A comment in this Word file is damaged. Save a fresh DOCX or text copy.'); continue; }
    if(token.startsWith('<?')) continue;
    if(token.startsWith('<![CDATA[')) { if(!stack.length) throw new Error('The text formatting in this Word file is damaged. Save a fresh DOCX or text copy.'); visitor.text?.(token.slice(9,-3),stack); continue; }
    if(!token.startsWith('<')) {
      if(token.includes(']]>')) throw new Error('The text formatting in this Word file is damaged. Save a fresh DOCX or text copy.');
      const text=decodeEntities(token);
      if(!stack.length && text.trim()) throw new Error('The text formatting in this Word file is damaged. Save a fresh DOCX or text copy.');
      visitor.text?.(text,stack);continue;
    }
    const closing=token.startsWith('</'),selfClosing=token.endsWith('/>'),name=token.match(/^<\/?([\w:.-]+)/)[1];
    if(closing) {
      if(!/^<\/[\w:.-]+\s*>$/.test(token) || stack.at(-1)?.name!==name) throw new Error('The text formatting in this Word file is incomplete. Save a fresh DOCX or text copy.');
      visitor.close?.(stack.at(-1),stack);stack.pop();if(!stack.length) closed=true;continue;
    }
    if(!stack.length) { if(root || closed) throw new Error('This file has more than one document start. Save a fresh DOCX or text copy.');root=true; }
    const attributes=new Map(),namespaces=Object.assign(Object.create(null),stack.at(-1)?.namespaces || {xml:'http://www.w3.org/XML/1998/namespace'});
    for(const match of token.matchAll(/\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g)) {
      if(attributes.has(match[1])) throw new Error('A text setting is repeated inside this Word file. Save a fresh DOCX or text copy.');
      const value=decodeEntities(match[2] ?? match[3]);attributes.set(match[1],value);
      if(match[1]==='xmlns') namespaces['']=value;
      else if(match[1].startsWith('xmlns:')) {
        const prefix=match[1].slice(6);
        if(!/^[A-Za-z_][\w.-]*$/.test(prefix) || prefix==='xmlns' || prefix==='xml' && value!=='http://www.w3.org/XML/1998/namespace') throw new Error('Some text in this Word file uses an unknown format. Save a fresh DOCX or text copy.');
        namespaces[prefix]=value;
      }
    }
    const parts=name.split(':');
    if(parts.length>2 || parts.some(part=>!/^[A-Za-z_][\w.-]*$/.test(part)) || parts.length===2 && !namespaces[parts[0]]) throw new Error('Some text in this Word file uses an unknown format. Save a fresh DOCX or text copy.');
    const node={name,local:parts.at(-1),uri:namespaces[parts.length===2 ? parts[0] : ''] || '',attributes,namespaces};
    node.attribute=(uris,local)=>{
      const allowed=typeof uris==='string' ? new Set([uris]) : uris;
      for(const [key,value] of attributes) {
        const parts=key.split(':');
        if(parts.length===2 && allowed.has(namespaces[parts[0]]) && parts[1]===local) return value;
      }
      return undefined;
    };
    const expandedNames=new Set();
    for(const key of attributes.keys()) {
      if(key==='xmlns' || key.startsWith('xmlns:')) continue;
      const parts=key.split(':');
      if(parts.length>2 || parts.some(part=>!/^[A-Za-z_][\w.-]*$/.test(part)) || parts.length===2 && !namespaces[parts[0]]) throw new Error('A text setting inside this Word file is invalid. Save a fresh DOCX or text copy.');
      const expanded=`${parts.length===2 ? namespaces[parts[0]] : ''}\0${parts.at(-1)}`;
      if(expandedNames.has(expanded)) throw new Error('A text setting is repeated inside this Word file. Save a fresh DOCX or text copy.');expandedNames.add(expanded);
    }
    stack.push(node);if(stack.length>128) throw new Error('This file is too complex or contains too much text. Try a shorter document or a text copy.');
    visitor.open?.(node,stack);
    if(selfClosing) { visitor.close?.(node,stack);stack.pop();if(!stack.length) closed=true; }
  }
  if(cursor!==xml.length || stack.length || !root || !closed) throw new Error('The text formatting in this Word file is incomplete. Save a fresh DOCX or text copy.');
}
export function extractWordXml(xml,{relationships=new Map(),allowEmpty=false,roots=['document','hdr','ftr','footnotes','endnotes'],references,noteIds}={}) {
  let text='',paragraphs=0;
  const fields=[],foundNotes=new Set();
  const append=value=>{ text+=value;if(text.length>50002) throw new Error('This file is too complex or contains too much text. Try a shorter document or a text copy.'); };
  const line=()=>{ if(text && !text.endsWith('\n') && !text.endsWith('\t')) append('\n'); };
  const visible=stack=>!stack.some(node=>node.skip || node.run && node.hidden);
  const fieldTarget=instruction=>safeImportedLink(instruction.match(/^\s*HYPERLINK\s+(?:"([^"]*)"|(\S+))/i)?.slice(1).find(Boolean));
  scanWordXml(xml,{
    open(node,stack) {
      const parent=stack.at(-2),word=WORD_URIS.has(node.uri),drawing=DRAWING_URIS.has(node.uri);
      if(stack.length===1 && (!word || !roots.includes(node.local))) throw new Error('This Word file uses an unsupported text format. Save a fresh DOCX or text copy.');
      node.skip=Boolean(parent?.skip || word && ['del','moveFrom'].includes(node.local));
      if(word && ['footnote','endnote'].includes(node.local) && ['separator','continuationSeparator','continuationNotice'].includes(node.attribute(WORD_URIS,'type'))) node.skip=true;
      if(word && ['footnote','endnote'].includes(node.local) && noteIds && !noteIds.has(node.attribute(WORD_URIS,'id'))) node.skip=true;
      if(word && ['footnote','endnote'].includes(node.local) && noteIds && !node.skip) foundNotes.add(node.attribute(WORD_URIS,'id'));
      if(node.uri===MC_NS && ['Choice','Fallback'].includes(node.local)) {
        const alternative=parent?.uri===MC_NS && parent.local==='AlternateContent' ? parent : null;
        if(alternative) {
          if(node.local==='Choice') { node.skip||=Boolean(alternative.choiceSeen);alternative.choiceSeen=true;node.alternative=alternative;node.start=text.length; }
          else node.skip||=Boolean(alternative.choiceText);
        }
      }
      if(word && node.local==='r') node.run=true;
      if(word && ['vanish','webHidden'].includes(node.local)) {
        const run=stack.findLast(item=>item.run);
        if(run) run.hidden=!['0','false','off'].includes(node.attribute(WORD_URIS,'val') || '1');
      }
      if(references && word && visible(stack)) {
        if(['headerReference','footerReference'].includes(node.local) && stack.some(item=>WORD_URIS.has(item.uri) && item.local==='sectPr')) {
          const kind=node.local==='headerReference' ? 'header' : 'footer',id=node.attribute(RELATIONSHIP_URIS,'id');
          if(!id) throw new Error('A header or footer link in this Word file is missing. Save a fresh DOCX or text copy.');
          references[kind].push(id);
        }
        if(['footnoteReference','endnoteReference'].includes(node.local)) {
          const id=node.attribute(WORD_URIS,'id');
          if(!/^-?\d+$/.test(id || '')) throw new Error('A footnote or endnote link in this Word file is invalid. Save a fresh DOCX or text copy.');
          references[node.local==='footnoteReference' ? 'footnotes' : 'endnotes'].add(id);
        }
      }
      if((word || drawing) && node.local==='p' && visible(stack)) {
        if(++paragraphs>10000) throw new Error('This file is too complex or contains too much text. Try a shorter document or a text copy.');
        line();node.paragraph=true;
      }
      if(word && ['hyperlink','fldSimple'].includes(node.local)) {
        node.linkStart=text.length;
        node.linkTarget=node.local==='hyperlink' ? safeImportedLink(relationships.get(node.attribute(RELATIONSHIP_URIS,'id'))) : fieldTarget(node.attribute(WORD_URIS,'instr') || '');
      }
      if(word && node.local==='fldChar' && visible(stack)) {
        const type=node.attribute(WORD_URIS,'fldCharType');
        if(type==='begin') { if(fields.length>=32) throw new Error('This file has too many fields inside other fields. Save a fresh DOCX or text copy.');fields.push({instruction:'',start:text.length,stage:'instruction'}); }
        else if(type==='separate' && fields.length) { fields.at(-1).stage='result';fields.at(-1).start=text.length; }
        else if(type==='end' && fields.length) { const field=fields.pop();if(field.stage==='result') append(linkSuffix(text.slice(field.start),fieldTarget(field.instruction))); }
      }
      if(word && ['tab','br','cr'].includes(node.local) && visible(stack)) append(node.local==='tab' ? '\t' : '\n');
    },
    text(value,stack) {
      const node=stack.at(-1);
      if(!node || !visible(stack)) return;
      if(WORD_URIS.has(node.uri) && node.local==='instrText' && fields.length && fields.at(-1).stage==='instruction') {
        fields.at(-1).instruction+=value;if(fields.at(-1).instruction.length>4096) throw new Error('A field command in this Word file is too long. Save a fresh DOCX or text copy.');
      }
      if((WORD_URIS.has(node.uri) || DRAWING_URIS.has(node.uri)) && node.local==='t') append(value);
    },
    close(node,stack) {
      if(node.alternative && text.slice(node.start).trim()) node.alternative.choiceText=true;
      if(!visible(stack)) return;
      if(node.linkStart!==undefined) append(linkSuffix(text.slice(node.linkStart),node.linkTarget));
      if(node.paragraph) append('\n');
      if(WORD_URIS.has(node.uri) && node.local==='tc') { text=text.replace(/\n+$/,'');append('\t'); }
      if(WORD_URIS.has(node.uri) && node.local==='tr') { text=text.replace(/\t+$/,'');append('\n'); }
    },
  });
  if(noteIds && [...noteIds].some(id=>!foundNotes.has(id))) throw new Error('A linked Word footnote or endnote is missing. Save a fresh DOCX or text copy.');
  if(allowEmpty && !text.trim()) return '';
  return normalisePlainText(text);
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
      if(size>DOCX_LIMIT || size>expected) throw new Error('The text in this Word file expands beyond the supported size. Try a shorter document or a text copy.');
      parts.push(value);
    }
  } catch(error) { await reader.cancel().catch(()=>{}); throw new Error(`Unable to extract Word document: ${error.message}`); }
  return concat(parts);
}
function wordArchive(bytes) {
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) {
    if(v.getUint32(i,true)===0x06054b50 && i+22+v.getUint16(i+20,true)===bytes.length) { end=i;break; }
  }
  if(end<0 || v.getUint16(end+4,true)!==0 || v.getUint16(end+6,true)!==0) throw new Error('This isn’t a complete DOCX file. Save a fresh DOCX or text copy.');
  const count=v.getUint16(end+10,true),cdSize=v.getUint32(end+12,true),cdStart=v.getUint32(end+16,true);
  if(!count || count>512 || v.getUint16(end+8,true)!==count || cdStart+cdSize!==end) throw new Error('The list of parts in this Word file uses an unsupported format. Save a fresh DOCX or text copy.');
  const entries=new Map(),ranges=[];
  let cursor=cdStart,expandedTotal=0;
  for(let i=0;i<count;i++) {
    if(cursor+46>end || v.getUint32(cursor,true)!==0x02014b50) throw new Error('The list of parts in this Word file is damaged. Save a fresh DOCX or text copy.');
    const flags=v.getUint16(cursor+8,true),method=v.getUint16(cursor+10,true),crc=v.getUint32(cursor+16,true);
    const compressed=v.getUint32(cursor+20,true),expanded=v.getUint32(cursor+24,true),nameLength=v.getUint16(cursor+28,true);
    const extra=v.getUint16(cursor+30,true),comment=v.getUint16(cursor+32,true),local=v.getUint32(cursor+42,true);
    if(cursor+46+nameLength+extra+comment>end || v.getUint16(cursor+34,true)!==0) throw new Error('The list of parts in this Word file is incomplete or split between files. Save a fresh DOCX or text copy.');
    const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength));
    if(!name || entries.has(name) || /[\\\u0000-\u001f]/u.test(name) || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(part=>part==='..' || part==='.')) throw new Error('This file has invalid or duplicate part names. Save a fresh DOCX or text copy.');
    if(flags&0x41 || ![0,8].includes(method) || compressed===0xffffffff || expanded===0xffffffff || local===0xffffffff) throw new Error('Encrypted, oversized or unsupported Word documents cannot be imported.');
    if(name==='word/document.xml' && expanded>DOCX_LIMIT) throw new Error('Encrypted, oversized or unsupported Word documents cannot be imported.');
    expandedTotal+=expanded;if(expandedTotal>8_000_000) throw new Error('This file expands beyond the supported 8 MB. Try a smaller document or save a text copy.');
    if(local+30>cdStart || v.getUint32(local,true)!==0x04034b50) throw new Error('A part of this Word file is damaged. Save a fresh DOCX or text copy.');
    const localFlags=v.getUint16(local+6,true),localMethod=v.getUint16(local+8,true),localNameLength=v.getUint16(local+26,true),localExtra=v.getUint16(local+28,true);
    const dataStart=local+30+localNameLength+localExtra,dataEnd=dataStart+compressed;
    if(localFlags!==flags || localMethod!==method || dataStart>cdStart || dataEnd>cdStart || decoder.decode(bytes.subarray(local+30,local+30+localNameLength))!==name) throw new Error('Parts of this Word file have conflicting names or contents. Save a fresh DOCX or text copy.');
    if(!(flags&8) && (v.getUint32(local+14,true)!==crc || v.getUint32(local+18,true)!==compressed || v.getUint32(local+22,true)!==expanded)) throw new Error('Parts of this Word file expand beyond their declared size or have conflicting entries. Save a fresh DOCX or text copy.');
    if(method===0 && compressed!==expanded) throw new Error('Parts of this Word file have conflicting sizes. Save a fresh DOCX or text copy.');
    ranges.push([local,dataEnd]);entries.set(name,{name,method,crc,compressed,expanded,dataStart});
    cursor+=46+nameLength+extra+comment;
  }
  if(cursor!==end || !entries.has('word/document.xml')) throw new Error('This archive has no Word document text.');
  ranges.sort((a,b)=>a[0]-b[0]);
  if(ranges.some((range,index)=>index && range[0]<ranges[index-1][1])) throw new Error('Parts of this Word file overlap, so the file is damaged. Save a fresh DOCX or text copy.');
  return entries;
}
async function readWordPart(bytes,entry,signal) {
  if(signal?.aborted) throw new DOMException('Import cancelled.','AbortError');
  if(!entry) throw new Error('A linked text part in this Word file is missing. Save a fresh DOCX or text copy.');
  if(entry.expanded>DOCX_LIMIT) throw new Error('A text part in this Word file is oversized. Save a shorter document or a text copy.');
  const packed=bytes.subarray(entry.dataStart,entry.dataStart+entry.compressed),unpacked=entry.method===0 ? packed : await inflate(packed,entry.expanded);
  if(unpacked.length!==entry.expanded || crc32(unpacked)!==entry.crc) throw new Error('The text in this Word file is damaged. Save a fresh DOCX or text copy.');
  if(signal?.aborted) throw new DOMException('Import cancelled.','AbortError');
  return decoder.decode(unpacked);
}
function relationshipPath(part) {
  const slash=part.lastIndexOf('/');return `${part.slice(0,slash+1)}_rels/${part.slice(slash+1)}.rels`;
}
function resolveWordTarget(part,target) {
  if(typeof target!=='string' || /[\\\u0000-\u0020?#]/u.test(target) || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) throw new Error('A text link in this Word file points to an unsafe location. Save a fresh DOCX or text copy.');
  let decoded;
  try { decoded=decodeURIComponent(target); } catch { throw new Error('A text link in this Word file points to an invalid location. Save a fresh DOCX or text copy.'); }
  if(/[\\\u0000-\u001f?#]/u.test(decoded)) throw new Error('A text link in this Word file points to an unsafe location. Save a fresh DOCX or text copy.');
  const parts=target.startsWith('/') ? [] : part.split('/').slice(0,-1);
  for(const segment of decoded.replace(/^\//,'').split('/')) {
    if(!segment || segment==='.') continue;
    if(segment==='..') { if(!parts.length) throw new Error('A text link in this Word file points outside the document. Save a fresh DOCX or text copy.');parts.pop(); }
    else parts.push(segment);
  }
  return parts.join('/');
}
function wordRelationships(xml,part) {
  const links=new Map(),parts=[],ids=new Set();
  scanWordXml(xml,{open(node,stack) {
    if(stack.length===1 && (node.uri!==PACKAGE_RELS || node.local!=='Relationships')) throw new Error('The links between text parts in this Word file are damaged. Save a fresh DOCX or text copy.');
    if(node.uri!==PACKAGE_RELS || node.local!=='Relationship') return;
    const id=node.attributes.get('Id'),type=node.attributes.get('Type'),target=node.attributes.get('Target'),mode=node.attributes.get('TargetMode') || 'Internal';
    if(!id || ids.has(id) || !type || target===undefined) throw new Error('The links between text parts in this Word file are damaged or repeated. Save a fresh DOCX or text copy.');
    ids.add(id);
    const match=type.match(/^(?:http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships|http:\/\/purl\.oclc\.org\/ooxml\/officeDocument\/relationships)\/(header|footer|footnotes|endnotes|hyperlink)$/);
    if(!match) return;
    if(match[1]==='hyperlink') { if(mode==='External') { const link=safeImportedLink(target);if(link) links.set(id,link); } return; }
    if(mode!=='Internal') throw new Error('This Word file links to external text. Save a self-contained DOCX copy.');
    parts.push({id,kind:match[1],path:resolveWordTarget(part,target)});
  }});
  return {links,parts};
}
export async function extractDocx(input,{signal}={}) {
  const source=input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if(!source || source.length<22 || source.length>DOCX_LIMIT) throw new Error('Choose a DOCX file smaller than 2 MB.');
  if(signal?.aborted) throw new DOMException('Import cancelled.','AbortError');
  // Retain the accepted document even if its caller later reuses the buffer.
  const bytes=new Uint8Array(source);
  const entries=wordArchive(bytes),main='word/document.xml',relationCache=new Map();
  const relationships=async part=>{
    if(!relationCache.has(part)) {
      const entry=entries.get(relationshipPath(part));
      relationCache.set(part,entry ? wordRelationships(await readWordPart(bytes,entry,signal),part) : {links:new Map(),parts:[]});
    }
    return relationCache.get(part);
  };
  const mainRelationships=await relationships(main),references={header:[],footer:[],footnotes:new Set(),endnotes:new Set()};
  const body=extractWordXml(await readWordPart(bytes,entries.get(main),signal),{relationships:mainRelationships.links,allowEmpty:true,roots:['document'],references});
  const groups={header:[],document:[main],footnotes:[],endnotes:[],footer:[]},seen=new Set([main]);
  const add=reference=>{
    if(!entries.has(reference.path)) throw new Error('A linked text part in this Word file is missing. Save a fresh DOCX or text copy.');
    if(!seen.has(reference.path)) { groups[reference.kind].push(reference.path);seen.add(reference.path); }
  };
  for(const kind of ['header','footer']) {
    for(const id of references[kind]) {
      const reference=mainRelationships.parts.find(part=>part.id===id && part.kind===kind);
      if(!reference) throw new Error('A header or footer link in this Word file is missing. Save a fresh DOCX or text copy.');
      add(reference);
    }
  }
  for(const kind of ['footnotes','endnotes']) {
    if(!references[kind].size) continue;
    const parts=mainRelationships.parts.filter(part=>part.kind===kind);
    if(parts.length!==1) throw new Error('A note link in this Word file is missing or points to more than one note. Save a fresh DOCX or text copy.');
    add(parts[0]);
  }
  if(seen.size>64) throw new Error('This file contains more than 64 supported text parts. Save a simpler document or a text copy.');
  const text=[];
  let length=0;
  for(const kind of ['header','document','footnotes','endnotes','footer']) {
    for(const part of groups[kind]) {
      if(kind==='document') {
        if(body) { length+=body.length+(text.length ? 1 : 0);if(length>50000) throw new Error('Imported text must contain at most 50,000 characters.');text.push(body); }
        continue;
      }
      const rels=await relationships(part),xml=await readWordPart(bytes,entries.get(part),signal);
      const value=extractWordXml(xml,{relationships:rels.links,allowEmpty:true,roots:[{header:'hdr',footer:'ftr',footnotes:'footnotes',endnotes:'endnotes'}[kind]],noteIds:references[kind] instanceof Set ? references[kind] : undefined});
      if(!value) continue;
      length+=value.length+(text.length ? 1 : 0);if(length>50000) throw new Error('Imported text must contain at most 50,000 characters.');
      text.push(value);
    }
  }
  return normalisePlainText(text.join('\n'));
}
