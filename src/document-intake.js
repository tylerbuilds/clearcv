// Local text interchange only. No document content enters a DOM, executes, or
// fetches resources. The original file remains the authority during review.
import {extractDocx, normalisePlainText, crc32, safeImportedLink} from './formats.js';
import {extractPdf} from './pdf-import.js';

export const DOCUMENT_BYTE_LIMIT = 2_000_000;
export const DOCUMENT_TEXT_LIMIT = 50_000;
const ZIP_ENTRY_LIMIT = 512;
const ZIP_EXPANDED_LIMIT = 8_000_000;
const XML_DEPTH_LIMIT = 128;
const utf8 = new TextDecoder('utf-8', {fatal:true});
const encoder = new TextEncoder();
const ODF = {
  office:'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  text:'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table:'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw:'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  manifest:'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
};
const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const REVIEW_WARNING = 'Formatting, images and embedded objects are not imported. Review the extracted text before applying it.';
const checkAbort = signal => { if(signal?.aborted) throw new DOMException('Import cancelled.','AbortError'); };
const isBytes = (bytes, signature, offset=0) => signature.every((byte, i) => bytes[offset+i] === byte);
const extensionOf = name => String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';

function decodeText(bytes) {
  let encoding = 'utf-8', offset = 0;
  if(isBytes(bytes,[0xff,0xfe])) { encoding='utf-16le'; offset=2; }
  else if(isBytes(bytes,[0xfe,0xff])) { encoding='utf-16be'; offset=2; }
  else if(isBytes(bytes,[0xef,0xbb,0xbf])) offset=3;
  // BOM-less UTF-16 is accepted only when alternating NUL bytes provide a
  // strong signature. Other binary data never falls back to a lossy decoder.
  else if(bytes.length>=8 && bytes.length%2===0) {
    const sample=bytes.subarray(0,Math.min(bytes.length,256));
    let evenZero=0, oddZero=0;
    for(let i=0;i<sample.length;i+=2) { if(sample[i]===0) evenZero++; if(sample[i+1]===0) oddZero++; }
    if(oddZero>=sample.length/4 && evenZero===0) encoding='utf-16le';
    else if(evenZero>=sample.length/4 && oddZero===0) encoding='utf-16be';
  }
  let text;
  try { text=new TextDecoder(encoding,{fatal:true}).decode(bytes.subarray(offset)); }
  catch { throw new Error('This file is not valid UTF-8 or UTF-16 text. Save a Unicode text copy before importing.'); }
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/u.test(text)) throw new Error('This appears to be binary data rather than a readable document.');
  return text.replace(/^\uFEFF/,'');
}

function zipDirectory(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) {
    if(view.getUint32(i,true)===0x06054b50 && i+22+view.getUint16(i+20,true)===bytes.length) { end=i; break; }
  }
  if(end<0 || view.getUint16(end+4,true)!==0 || view.getUint16(end+6,true)!==0) throw new Error('Choose a complete, single-volume document archive.');
  const count=view.getUint16(end+10,true), size=view.getUint32(end+12,true), start=view.getUint32(end+16,true);
  if(!count || count>ZIP_ENTRY_LIMIT || view.getUint16(end+8,true)!==count || start+size!==end) throw new Error('The archive exceeds the supported 512 entries or has an invalid directory.');
  const entries=new Map(), ranges=[];
  let cursor=start, expandedTotal=0;
  for(let i=0;i<count;i++) {
    if(cursor+46>end || view.getUint32(cursor,true)!==0x02014b50) throw new Error('The document archive directory is malformed.');
    const flags=view.getUint16(cursor+8,true), method=view.getUint16(cursor+10,true);
    const crc=view.getUint32(cursor+16,true), packed=view.getUint32(cursor+20,true), expanded=view.getUint32(cursor+24,true);
    const nameSize=view.getUint16(cursor+28,true), extra=view.getUint16(cursor+30,true), comment=view.getUint16(cursor+32,true);
    const local=view.getUint32(cursor+42,true);
    if(cursor+46+nameSize+extra+comment>end || view.getUint16(cursor+34,true)!==0) throw new Error('The document archive directory is truncated or split.');
    let name;
    try { name=utf8.decode(bytes.subarray(cursor+46,cursor+46+nameSize)); }
    catch { throw new Error('The archive contains an unsupported path encoding.'); }
    if(!name || entries.has(name) || /[\\\u0000-\u001f]/u.test(name) || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(part=>part==='..' || part==='.')) throw new Error('The archive contains unsafe or duplicate paths.');
    if(flags&0x41 || ![0,8].includes(method) || packed===0xffffffff || expanded===0xffffffff || local===0xffffffff) throw new Error('Encrypted, ZIP64 or unsupported document archives cannot be imported.');
    expandedTotal+=expanded;
    if(expandedTotal>ZIP_EXPANDED_LIMIT) throw new Error('The document archive expands beyond the supported 8 MB.');
    if(local+30>start || view.getUint32(local,true)!==0x04034b50) throw new Error('The archive contains an invalid local entry.');
    const localNameSize=view.getUint16(local+26,true), localExtra=view.getUint16(local+28,true);
    const dataStart=local+30+localNameSize+localExtra, dataEnd=dataStart+packed;
    if(dataStart>start || dataEnd>start || view.getUint16(local+6,true)!==flags || view.getUint16(local+8,true)!==method || utf8.decode(bytes.subarray(local+30,local+30+localNameSize))!==name) throw new Error('The document archive contains conflicting entries.');
    if(!(flags&8) && (view.getUint32(local+14,true)!==crc || view.getUint32(local+18,true)!==packed || view.getUint32(local+22,true)!==expanded)) throw new Error('The document archive contains conflicting sizes or checksums.');
    if(method===0 && packed!==expanded) throw new Error('A stored archive entry has conflicting sizes.');
    ranges.push([local,dataEnd]);
    entries.set(name,{name,method,crc,packed,expanded,dataStart});
    cursor+=46+nameSize+extra+comment;
  }
  if(cursor!==end) throw new Error('The document archive directory is malformed.');
  ranges.sort((a,b)=>a[0]-b[0]);
  if(ranges.some((range,i)=>i && range[0]<ranges[i-1][1])) throw new Error('The document archive contains overlapping entries.');
  return entries;
}

async function unpack(bytes, entry, {limit=DOCUMENT_BYTE_LIMIT,signal}={}) {
  checkAbort(signal);
  if(!entry || entry.expanded>limit) throw new Error('The document text expands beyond its supported size.');
  const packed=bytes.subarray(entry.dataStart,entry.dataStart+entry.packed);
  let result=packed;
  if(entry.method===8) {
    if(typeof DecompressionStream!=='function') throw new Error('This browser cannot extract compressed documents. Use a current browser or import plain text.');
    let stream;
    try { stream=new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
    catch { throw new Error('This browser cannot extract compressed documents. Use a current browser or import plain text.'); }
    const reader=stream.getReader(), parts=[];
    let length=0;
    const abort=()=>{ void reader.cancel().catch(()=>{}); };
    signal?.addEventListener('abort',abort,{once:true});
    try {
      while(true) {
        checkAbort(signal);
        const {done,value}=await reader.read();
        checkAbort(signal);
        if(done) break;
        length+=value.length;
        if(length>limit || length>entry.expanded) throw new Error('The document text expands beyond its supported size.');
        parts.push(value);
      }
      result=new Uint8Array(length);
      let offset=0;
      for(const part of parts) { result.set(part,offset); offset+=part.length; }
    } catch(error) { await reader.cancel().catch(()=>{}); throw error; }
    finally { signal?.removeEventListener('abort',abort); reader.releaseLock(); }
  }
  if(result.length!==entry.expanded || crc32(result)!==entry.crc) throw new Error('The document archive text is damaged or truncated.');
  checkAbort(signal);
  return result;
}

function xmlEntities(text) {
  return text.replace(/&([^;\s]+);|&/g,(whole,entity)=>{
    const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if(Object.hasOwn(named,entity)) return named[entity];
    if(/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity || '')) {
      const code=entity[1].toLowerCase()==='x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
      if([9,10,13].includes(code) || code>=32 && code<=0x10ffff && !(code>=0xd800 && code<=0xdfff) && ![0xfffe,0xffff].includes(code)) return String.fromCodePoint(code);
    }
    throw new Error('The OpenDocument contains an invalid XML entity.');
  });
}

// A bounded XML scanner avoids DOM parsing, entity expansion and active content.
function scanXml(xml, visitor) {
  if(encoder.encode(xml).length>DOCUMENT_BYTE_LIMIT || /<!DOCTYPE|<!ENTITY/i.test(xml) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(xml)) throw new Error('Unsupported or oversized OpenDocument XML.');
  const tokenPattern=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>|[^<]+/g;
  const stack=[];
  let cursor=0,root=false,closed=false,tokens=0;
  for(const match of xml.matchAll(tokenPattern)) {
    if(match.index!==cursor || ++tokens>100000) throw new Error('The OpenDocument contains malformed or overly complex XML.');
    const token=match[0]; cursor+=token.length;
    if(token.startsWith('<!--')) { if(token.slice(4,-3).includes('--')) throw new Error('The OpenDocument contains a malformed XML comment.'); continue; }
    if(token.startsWith('<?')) continue;
    if(token.startsWith('<![CDATA[')) { if(!stack.length) throw new Error('Malformed OpenDocument XML.'); visitor.text?.(token.slice(9,-3),stack,true); continue; }
    if(!token.startsWith('<')) {
      if(token.includes(']]>')) throw new Error('Malformed OpenDocument XML.');
      const text=xmlEntities(token);
      if(!stack.length && text.trim()) throw new Error('Malformed OpenDocument XML.');
      visitor.text?.(text,stack,false); continue;
    }
    const closing=token.startsWith('</'), selfClosing=token.endsWith('/>'), name=token.match(/^<\/?([\w:.-]+)/)[1];
    if(closing) {
      if(!/^<\/[\w:.-]+\s*>$/.test(token) || stack.at(-1)?.name!==name) throw new Error('The OpenDocument contains unbalanced XML.');
      visitor.close?.(stack.at(-1),stack);
      stack.pop(); if(!stack.length) closed=true;
      continue;
    }
    if(!stack.length) { if(root || closed) throw new Error('The OpenDocument contains multiple XML roots.'); root=true; }
    const attributes=new Map(), namespaces=Object.assign(Object.create(null),stack.at(-1)?.namespaces || {xml:'http://www.w3.org/XML/1998/namespace'});
    for(const attribute of token.matchAll(/\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g)) {
      if(attributes.has(attribute[1])) throw new Error('The OpenDocument contains duplicate XML attributes.');
      const value=xmlEntities(attribute[2] ?? attribute[3]);
      attributes.set(attribute[1],value);
      if(attribute[1]==='xmlns') namespaces['']=value;
      else if(attribute[1].startsWith('xmlns:')) {
        const prefix=attribute[1].slice(6);
        if(prefix.includes(':') || prefix==='xmlns' || prefix==='xml' && value!=='http://www.w3.org/XML/1998/namespace') throw new Error('The OpenDocument contains invalid XML namespaces.');
        namespaces[prefix]=value;
      }
    }
    const parts=name.split(':');
    if(parts.length>2 || parts.some(part=>!/^[A-Za-z_][\w.-]*$/.test(part)) || parts.length===2 && !namespaces[parts[0]]) throw new Error('The OpenDocument contains an invalid or unbound XML namespace.');
    const node={name,local:parts.at(-1),uri:namespaces[parts.length===2 ? parts[0] : ''] || '',attributes,namespaces};
    node.attribute=(uri,local)=>{
      for(const [key,value] of attributes) {
        const parts=key.split(':');
        if(parts.length===2 && namespaces[parts[0]]===uri && parts[1]===local) return value;
      }
      return undefined;
    };
    const attributeNames=new Set();
    for(const key of attributes.keys()) {
      if(key==='xmlns' || key.startsWith('xmlns:')) continue;
      const parts=key.split(':');
      if(parts.length>2 || parts.some(part=>!/^[A-Za-z_][\w.-]*$/.test(part)) || parts.length===2 && !namespaces[parts[0]]) throw new Error('The OpenDocument contains an invalid or unbound XML attribute.');
      const expandedName=`${parts.length===2 ? namespaces[parts[0]] : ''}\u0000${parts.at(-1)}`;
      if(attributeNames.has(expandedName)) throw new Error('The OpenDocument contains duplicate XML attributes.');
      attributeNames.add(expandedName);
    }
    stack.push(node);
    if(stack.length>XML_DEPTH_LIMIT) throw new Error('The OpenDocument XML is nested too deeply.');
    visitor.open?.(node,stack);
    if(selfClosing) { visitor.close?.(node,stack); stack.pop(); if(!stack.length) closed=true; }
  }
  if(cursor!==xml.length || stack.length || !root || !closed) throw new Error('The OpenDocument contains incomplete XML.');
}

function odtContent(xml) {
  let text='', hasBody=false;
  const append=value=>{ text+=value; if(text.length>DOCUMENT_TEXT_LIMIT+2) throw new Error('Imported text must contain at most 50,000 characters.'); };
  const line=()=>{ if(text && !text.endsWith('\n') && !text.endsWith('\t')) append('\n'); };
  const count=(node,name)=>{
    const value=node.attribute(ODF.table,name) ?? '1';
    if(!/^[1-9]\d*$/.test(value) || Number(value)>10000) throw new Error('The OpenDocument contains an excessive or invalid table repetition.');
    return Number(value);
  };
  scanXml(xml,{
    open(node,stack) {
      const parent=stack.at(-2);
      if(stack.length===1 && (node.uri!==ODF.office || !['document-content','document'].includes(node.local))) throw new Error('This is not an OpenDocument text document.');
      node.inBody=parent?.inBody || node.uri===ODF.office && node.local==='text' && parent?.uri===ODF.office && parent.local==='body';
      if(node.inBody) hasBody=true;
      node.skip=Boolean(parent?.skip || node.uri===ODF.office && ['annotation','scripts'].includes(node.local) || node.uri===ODF.draw || node.uri===ODF.text && ['note-body','ruby-text','tracked-changes','deletion'].includes(node.local));
      if(!node.inBody || node.skip) return;
      if(node.uri===ODF.text && ['p','h'].includes(node.local)) {
        line(); node.paragraph=true;
        const item=stack.slice(0,-1).findLast(item=>item.uri===ODF.text && item.local==='list-item');
        if(item && !item.hasParagraph) { append('• '); item.hasParagraph=true; }
      }
      if(node.uri===ODF.text && node.local==='s') {
        const value=node.attribute(ODF.text,'c') || '1';
        if(!/^[1-9]\d*$/.test(value) || Number(value)>DOCUMENT_TEXT_LIMIT) throw new Error('The OpenDocument contains an invalid space repetition.');
        append(' '.repeat(Number(value)));
      }
      if(node.uri===ODF.text && node.local==='tab') append('\t');
      if(node.uri===ODF.text && node.local==='line-break') append('\n');
      if(node.uri===ODF.table && ['table-cell','covered-table-cell','table-row'].includes(node.local)) {
        node.start=text.length;
        node.repeat=count(node,node.local==='table-row' ? 'number-rows-repeated' : 'number-columns-repeated');
      }
    },
    text(value,stack,cdata) {
      const node=stack.at(-1);
      if(node?.inBody && !node.skip && stack.some(item=>item.paragraph)) append(cdata ? value : value.replace(/[\t\r\n ]+/g,' '));
    },
    close(node) {
      if(!node.inBody || node.skip) return;
      if(node.paragraph) append('\n');
      if(node.uri===ODF.table && ['table-cell','covered-table-cell'].includes(node.local)) {
        text=text.replace(/\n+$/,''); append('\t');
        const segment=text.slice(node.start);
        if(segment.length*node.repeat>DOCUMENT_TEXT_LIMIT) throw new Error('Imported text must contain at most 50,000 characters.');
        if(node.repeat>1) append(segment.repeat(node.repeat-1));
      }
      if(node.uri===ODF.table && node.local==='table-row') {
        text=text.replace(/\t+$/,''); append('\n');
        const segment=text.slice(node.start);
        if(segment.length*node.repeat>DOCUMENT_TEXT_LIMIT) throw new Error('Imported text must contain at most 50,000 characters.');
        if(node.repeat>1) append(segment.repeat(node.repeat-1));
      }
    },
  });
  if(!hasBody) throw new Error('This OpenDocument has no text body.');
  return normalisePlainText(text);
}

async function extractOdt(bytes,entries,signal) {
  if(!entries.has('content.xml') || !entries.has('mimetype')) throw new Error('This archive has no OpenDocument text content or media type.');
  const mime=utf8.decode(await unpack(bytes,entries.get('mimetype'),{limit:200,signal}));
  if(mime!==ODT_MIME) throw new Error('Choose an OpenDocument text (.odt) file.');
  if(entries.has('META-INF/manifest.xml')) {
    const manifest=utf8.decode(await unpack(bytes,entries.get('META-INF/manifest.xml'),{signal}));
    scanXml(manifest,{open(node,stack) {
      if(stack.length===1 && (node.uri!==ODF.manifest || node.local!=='manifest')) throw new Error('The OpenDocument package manifest is malformed.');
      if(node.uri===ODF.manifest && ['encryption-data','encrypted-key'].includes(node.local)) throw new Error('Encrypted OpenDocument files cannot be imported. Export an unlocked copy first.');
    }});
  }
  return odtContent(decodeText(await unpack(bytes,entries.get('content.xml'),{signal})));
}

const RTF_DESTINATIONS=new Set(['fonttbl','colortbl','stylesheet','info','annotation','pict','object','objdata','objclass','objname','fldinst','datafield','themedata','colorschememapping','datastore','xmlnstbl','listtable','listoverridetable','filetbl','rsidtbl','generator','shp','shpinst','shppict','nonshppict','pn','xe','tc','bkmkstart','bkmkend','htmltag','mhtmltag']);
const RTF_VISIBLE_DESTINATIONS=new Set(['header','headerl','headerr','headerf','footer','footerl','footerr','footerf','footnote']);
const RTF_CHARSET={0:1252,1:1252,77:10000,128:932,129:949,134:936,136:950,161:1253,162:1254,163:1258,177:1255,178:1256,186:1257,204:1251,222:874,238:1250};
const RTF_ENCODINGS={874:'windows-874',932:'shift_jis',936:'gbk',949:'euc-kr',950:'big5',10000:'macintosh',65001:'utf-8'};
function rtfDecoder(codepage) {
  if(typeof codepage==='string') throw new Error(`The RTF font character set ${codepage} is unsupported. Save a Unicode DOCX or text copy first.`);
  const label=RTF_ENCODINGS[codepage] || (codepage>=1250 && codepage<=1258 ? `windows-${codepage}` : '');
  if(!label) throw new Error(`The RTF code page ${codepage} is unsupported. Save a Unicode DOCX or text copy first.`);
  try { return new TextDecoder(label,{fatal:true}); }
  catch { throw new Error(`This browser cannot decode RTF code page ${codepage}. Save a Unicode text copy first.`); }
}

function extractRtf(bytes,signal) {
  let source='';
  for(let i=0;i<bytes.length;i+=8192) source+=String.fromCharCode(...bytes.subarray(i,i+8192));
  source=source.replace(/^\u00ef\u00bb\u00bf/,'');
  if(!/^\s*\{\\rtf1(?=[\\\s}])/.test(source)) throw new Error('Choose a supported RTF version 1 document.');
  const stack=[], fonts=new Map(), explicitFontPages=new Set();
  let state=null,text='',pending=[],pendingPage=1252,defaultPage=1252,defaultFont=0,skipFallback=0,closed=false,cursor=0,steps=0;
  const append=value=>{ text+=value; if(text.length>DOCUMENT_TEXT_LIMIT+2) throw new Error('Imported text must contain at most 50,000 characters.'); };
  const flush=()=>{
    if(!pending.length) return;
    try { append(rtfDecoder(pendingPage).decode(new Uint8Array(pending))); }
    catch(error) { if(/code page|font character set/.test(error.message)) throw error; throw new Error('The RTF contains damaged text for its declared code page.'); }
    pending=[];
  };
  const emitByte=byte=>{
    if(skipFallback) { skipFallback--; return; }
    if(state.skip || state.hidden || state.deleted) return;
    const page=fonts.get(state.font) ?? state.codepage;
    if(pending.length && pendingPage!==page) flush();
    pendingPage=page; pending.push(byte);
    if(pending.length>DOCUMENT_TEXT_LIMIT*4) throw new Error('Imported text must contain at most 50,000 characters.');
  };
  const emit=value=>{
    if(skipFallback) { skipFallback--; return; }
    flush(); if(!state.skip && !state.hidden && !state.deleted) append(value);
  };
  while(cursor<source.length) {
    if(++steps%2048===0) checkAbort(signal);
    const char=source[cursor++];
    if(!state && /\s/.test(char)) continue;
    if(closed) throw new Error('The RTF contains text after its closing group.');
    if(char==='{') {
      flush(); skipFallback=0;
      if(stack.length>=XML_DEPTH_LIMIT) throw new Error('The RTF is nested too deeply.');
      const parent=state;
      const branch=parent?.upr ? ++parent.uprChildren : 0;
      state={...(parent || {skip:false,hidden:false,deleted:false,uc:1,codepage:defaultPage,font:defaultFont,fontTable:false}),star:false,first:true,upr:false,uprChildren:0,allowUd:branch===2,inheritedSkip:Boolean(parent?.skip),fontDefinition:null,visibleDestination:false};
      if(branch===1) state.skip=true;
      stack.push(state); continue;
    }
    if(char==='}') {
      if(!state || !stack.length) throw new Error('The RTF contains an unmatched closing group.');
      flush();
      if(state.visibleDestination && !state.skip && !state.hidden && !state.deleted && text && !text.endsWith('\n')) append('\n');
      skipFallback=0; stack.pop(); state=stack.at(-1) || null;
      if(!state) closed=true;
      continue;
    }
    if(!state) throw new Error('The RTF contains text outside its document group.');
    if(char==='\r' || char==='\n') continue;
    if(char!=='\\') { state.first=false; emitByte(char.charCodeAt(0)); continue; }
    if(cursor>=source.length) throw new Error('The RTF ends inside an escape sequence.');
    const next=source[cursor++];
    if(next==="'") {
      const hex=source.slice(cursor,cursor+2);
      if(!/^[0-9a-f]{2}$/i.test(hex)) throw new Error('The RTF contains a malformed hexadecimal escape.');
      cursor+=2; emitByte(parseInt(hex,16)); state.first=false; continue;
    }
    if(!/[a-zA-Z]/.test(next)) {
      if(next==='*') { state.star=true; continue; }
      if(next==='{' || next==='}' || next==='\\') emitByte(next.charCodeAt(0));
      else if(next==='~') emit('\u00a0');
      else if(next==='-') emit('\u00ad');
      else if(next==='_') emit('\u2011');
      else if(next==='\n' || next==='\r') { if(next==='\r' && source[cursor]==='\n') cursor++; emit('\n'); }
      state.first=false; continue;
    }
    let word=next;
    while(/[a-zA-Z]/.test(source[cursor] || '') && cursor<source.length) word+=source[cursor++];
    if(word.length>32) throw new Error('The RTF contains an excessively long control word.');
    let numberText='';
    if(source[cursor]==='-') numberText+=source[cursor++];
    while(/[0-9]/.test(source[cursor] || '') && cursor<source.length) numberText+=source[cursor++];
    if(numberText==='-' || numberText.length>11) throw new Error('The RTF contains an invalid control value.');
    const value=numberText ? Number(numberText) : undefined;
    if(source[cursor]===' ') cursor++;
    if(word==='bin') {
      flush();
      if(!Number.isSafeInteger(value) || value<0 || value>DOCUMENT_BYTE_LIMIT || cursor+value>source.length) throw new Error('The RTF contains truncated binary data.');
      cursor+=value; if(skipFallback) skipFallback--; state.first=false; continue;
    }
    if(skipFallback) { skipFallback--; continue; }
    flush();
    if(state.star) {
      if(word==='ud' && state.allowUd) state.skip=state.inheritedSkip;
      else state.skip=true;
      state.star=false;
    }
    if(RTF_DESTINATIONS.has(word)) { state.skip=true; if(word==='fonttbl') state.fontTable=true; }
    if(RTF_VISIBLE_DESTINATIONS.has(word)) {
      state.visibleDestination=true;
      if(!state.skip && !state.hidden && !state.deleted && text && !text.endsWith('\n')) append('\n');
    }
    if(word==='upr') { state.upr=true; state.uprChildren=0; }
    if(word==='ansicpg') { rtfDecoder(value); defaultPage=value; state.codepage=value; }
    if(word==='mac') { defaultPage=10000; state.codepage=10000; }
    if(word==='pc' || word==='pca') throw new Error('This RTF uses an unsupported DOS code page. Save a Unicode text copy first.');
    if(word==='deff') { if(!Number.isInteger(value) || value<0) throw new Error('The RTF has an invalid default font.'); defaultFont=value; state.font=value; }
    if(word==='f') {
      if(!Number.isInteger(value) || value<0) throw new Error('The RTF has an invalid font reference.');
      state.font=value;
      if(state.fontTable) { state.fontDefinition=value; if(!fonts.has(value)) fonts.set(value,defaultPage); }
    }
    if(state.fontTable && ['fcharset','cpg'].includes(word)) {
      const page=word==='cpg' ? value : [0,1].includes(value) ? defaultPage : RTF_CHARSET[value] ?? String(value);
      if(state.fontDefinition!==null && (word==='cpg' || !explicitFontPages.has(state.fontDefinition))) fonts.set(state.fontDefinition,page);
      if(word==='cpg' && state.fontDefinition!==null) explicitFontPages.add(state.fontDefinition);
    }
    if(word==='uc') {
      if(!Number.isInteger(value) || value<0 || value>32) throw new Error('The RTF contains an invalid Unicode fallback length.');
      state.uc=value;
    }
    if(word==='u') {
      if(!Number.isInteger(value) || value<-32768 || value>65535) throw new Error('The RTF contains an invalid Unicode escape.');
      if(!state.skip && !state.hidden && !state.deleted) append(String.fromCharCode(value<0 ? value+65536 : value));
      skipFallback=state.uc;
    }
    if(word==='v') state.hidden=value!==0;
    if(word==='deleted') state.deleted=value!==0;
    if(word==='plain') { state.hidden=false; state.deleted=false; state.font=defaultFont; }
    const characters={par:'\n',line:'\n',tab:'\t',cell:'\t',nestcell:'\t',row:'\n',nestrow:'\n',page:'\n',sect:'\n',bullet:'•',emdash:'—',endash:'–',lquote:'‘',rquote:'’',ldblquote:'“',rdblquote:'”',enspace:'\u2002',emspace:'\u2003',qmspace:'\u2005'};
    if(Object.hasOwn(characters,word) && !state.skip && !state.hidden && !state.deleted) append(characters[word]);
    state.first=false;
  }
  flush(); checkAbort(signal);
  if(stack.length || !closed) throw new Error('The RTF contains an incomplete or unbalanced document group.');
  if(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) throw new Error('The RTF contains an incomplete Unicode character.');
  return normalisePlainText(text);
}

const HTML_ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',copy:'©',reg:'®',trade:'™',hellip:'…',ndash:'–',mdash:'—',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',bull:'•',middot:'·',euro:'€',pound:'£',cent:'¢',laquo:'«',raquo:'»'};
function htmlEntities(text,warnings) {
  return text.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi,(whole,entity)=>{
    if(entity[0]==='#') {
      const code=entity[1].toLowerCase()==='x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
      if(code>0 && code<=0x10ffff && !(code>=0xd800 && code<=0xdfff)) return String.fromCodePoint(code);
      throw new Error('The HTML contains an invalid character entity.');
    }
    if(Object.hasOwn(HTML_ENTITIES,entity)) return HTML_ENTITIES[entity];
    if(!warnings.includes('Some named HTML entities are preserved literally. Review these characters.')) warnings.push('Some named HTML entities are preserved literally. Review these characters.');
    return whole;
  });
}

function extractHtml(html,warnings,signal) {
  const tokens=/<!--[\s\S]*?-->|<!doctype\s+html[^>]*>|<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s+(?:[^\s<>="'`]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s<>"'=`]+))?)*\s*\/?>|[^<]+/gi;
  const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const excluded=new Set(['head','script','style','iframe','object','embed','template','noscript','svg','math','canvas','audio','video']);
  const blocks=new Set(['p','div','section','article','main','header','footer','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','tr','table','address','dl','dt','dd']);
  const stack=[];
  let text='',cursor=0,steps=0;
  const append=value=>{ text+=value; if(text.length>DOCUMENT_TEXT_LIMIT+2) throw new Error('Imported text must contain at most 50,000 characters.'); };
  const line=()=>{ if(text && !text.endsWith('\n')) append('\n'); };
  let match;
  while((match=tokens.exec(html))) {
    if(match.index!==cursor) throw new Error('The HTML contains malformed markup. Save a plain text copy instead.');
    cursor+=match[0].length;
    if(++steps%2048===0) checkAbort(signal);
    const token=match[0];
    if(token.startsWith('<!--') || /^<!doctype/i.test(token)) continue;
    if(!token.startsWith('<')) {
      if(!stack.at(-1)?.skip) append(htmlEntities(token,warnings).replace(stack.some(item=>item.tag==='pre') ? /\r\n?/g : /[\t\r\n ]+/g,stack.some(item=>item.tag==='pre') ? '\n' : ' '));
      continue;
    }
    const tag=token.match(/^<\/?([\w:-]+)/)[1].toLowerCase(), closing=token.startsWith('</');
    if(closing) {
      const index=stack.findLastIndex(item=>item.tag===tag);
      if(index<0) { if(voidTags.has(tag)) continue; throw new Error('The HTML contains unmatched closing markup. Save a plain text copy instead.'); }
      const visible=!stack[index].skip;
      const anchor=stack[index];
      if(visible && anchor.linkTarget) {
        const target=anchor.linkTarget.startsWith('mailto:') ? anchor.linkTarget.slice(7) : anchor.linkTarget;
        const needle=target.replace(/^https?:\/\//i,'').replace(/\/$/,'').toLowerCase();
        if(!text.slice(anchor.linkStart).toLowerCase().includes(needle)) append(` (${target})`);
      }
      stack.splice(index);
      if(visible && blocks.has(tag)) line();
      if(visible && ['td','th'].includes(tag)) append('\t');
      continue;
    }
    // Raw script/style bodies may contain '<' without forming HTML tokens.
    // Skip their entire source range before scanning resumes.
    if(['script','style'].includes(tag)) {
      const end=new RegExp(`</${tag}\\s*>`,'ig'); end.lastIndex=cursor;
      const closing=end.exec(html);
      if(!closing) throw new Error('The HTML contains an incomplete script or style element.');
      tokens.lastIndex=end.lastIndex; cursor=end.lastIndex;
      continue;
    }
    const attrs=new Map();
    for(const attribute of token.matchAll(/\s+([^\s<>="'`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>"'=`]+)))?/g)) attrs.set(attribute[1].toLowerCase(),attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    const style=attrs.get('style') || '';
    const skip=Boolean(stack.at(-1)?.skip || excluded.has(tag) || attrs.has('hidden') || attrs.get('aria-hidden')?.toLowerCase()==='true' || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/i.test(style));
    if(!skip) {
      if(blocks.has(tag)) line();
      if(tag==='li') append('• ');
      if(tag==='br' || tag==='hr') append('\n');
    }
    if(!voidTags.has(tag) && !token.endsWith('/>')) stack.push({tag,skip,linkStart:text.length,linkTarget:tag==='a' ? safeImportedLink(htmlEntities(attrs.get('href') || '',warnings)) : null});
    if(stack.length>XML_DEPTH_LIMIT) throw new Error('The HTML is nested too deeply.');
  }
  if(cursor!==html.length) throw new Error('The HTML contains incomplete markup.');
  // HTML permits omitted end tags. Any remaining excluded or hidden content
  // stays excluded, and only already emitted visible text is returned.
  return normalisePlainText(text.replace(/[ \t]+\n/g,'\n'));
}

function imageSignature(bytes) {
  return isBytes(bytes,[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]) || isBytes(bytes,[0xff,0xd8,0xff]) || isBytes(bytes,[0x47,0x49,0x46,0x38]) || isBytes(bytes,[0x42,0x4d]) || isBytes(bytes,[0x49,0x49,0x2a,0]) || isBytes(bytes,[0x4d,0x4d,0,0x2a]) || isBytes(bytes,[0x52,0x49,0x46,0x46]) && isBytes(bytes,[0x57,0x45,0x42,0x50],8) || isBytes(bytes,[0x66,0x74,0x79,0x70],4) && /^(?:avif|avis|heic|heix|hevc|hevx|mif1)$/.test(String.fromCharCode(...bytes.subarray(8,12)));
}

export async function extractDocument(input,{name='',mime='',signal,password}={}) {
  if(!(input instanceof Uint8Array)) throw new Error('Read the document as bytes before importing.');
  if(!input.length || input.length>DOCUMENT_BYTE_LIMIT) throw new Error('Choose a non-empty document no larger than 2 MB.');
  checkAbort(signal);
  const bytes=input, extension=extensionOf(name), mediaType=String(mime).split(';')[0].trim().toLowerCase(), warnings=[];
  let format,text;
  if(isBytes(bytes,[0x25,0x50,0x44,0x46,0x2d])) { format='pdf'; text=await extractPdf(bytes,{signal,password}); }
  else if(isBytes(bytes,[0x50,0x4b,0x03,0x04]) || isBytes(bytes,[0x50,0x4b,0x05,0x06])) {
    const entries=zipDirectory(bytes);
    if(entries.has('word/document.xml') && entries.has('content.xml')) throw new Error('This document archive contains conflicting document formats.');
    if(entries.has('word/document.xml')) {
      format='docx';
      // Preflight bounds all entries; the existing extractor owns Word XML.
      if(entries.get('word/document.xml').expanded>DOCUMENT_BYTE_LIMIT) throw new Error('The Word document text expands beyond its supported size.');
      text=await extractDocx(bytes,{signal});
    } else if(entries.has('content.xml')) { format='odt'; text=await extractOdt(bytes,entries,signal); }
    else throw new Error('This ZIP archive is not a supported DOCX or ODT document.');
  } else if(isBytes(bytes,[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])) {
    const {extractLegacyDoc}=await import('./legacy-doc.js');
    checkAbort(signal);format='doc';text=extractLegacyDoc(bytes,{signal});
  } else if(imageSignature(bytes)) {
    throw new Error('This is an image. Choose image OCR in the import dialog to recognise its text.');
  } else {
    // RTF carries legacy bytes, so sniff its ASCII header before UTF decoding.
    const prefix=String.fromCharCode(...bytes.subarray(0,40)).replace(/^\u00ef\u00bb\u00bf/,'');
    if(/^\s*\{\\rtf/.test(prefix)) { format='rtf'; text=extractRtf(bytes,signal); }
    else {
      if(/^(?:png|jpe?g|gif|webp|bmp|tiff?|heic|avif)$/.test(extension) || mediaType.startsWith('image/')) throw new Error('This file is labelled as an image but has no supported image signature. Choose a genuine image for OCR.');
      if(['docx','odt','pdf','rtf'].includes(extension) || ['application/pdf','application/rtf','text/rtf',ODT_MIME,'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mediaType)) throw new Error('The file contents do not match its document type, or the document is truncated.');
      const decoded=decodeText(bytes);
      if(/^\s*(?:<!doctype\s+html\b|<html\b|<(?:body|head|p|div|section|article|h[1-6]|ul|ol|table)\b)/i.test(decoded) || ['html','htm','xhtml'].includes(extension) || mediaType==='text/html' || mediaType==='application/xhtml+xml') {
        format='html'; text=extractHtml(decoded,warnings,signal);
        warnings.push('Scripts, styles, hidden content and linked resources are excluded. Visible link labels and safe HTTP, HTTPS or email targets are kept as text.');
      } else {
        if(extension==='doc' || mediaType==='application/msword') throw new Error('Legacy Word (.doc) files need conversion to DOCX, ODT or Unicode text before import.');
        if(extension && !['txt','text','md','markdown','log','csv'].includes(extension)) throw new Error('This file type is unsupported. Choose PDF, DOCX, ODT, RTF, text, Markdown or HTML.');
        if(mediaType && !['text/plain','text/markdown','text/x-markdown','text/csv','application/octet-stream'].includes(mediaType)) throw new Error('This file type is unsupported. Choose a supported document or Unicode text.');
        format=['md','markdown'].includes(extension) || ['text/markdown','text/x-markdown'].includes(mediaType) ? 'md' : 'txt';
        text=normalisePlainText(decoded);
      }
    }
  }
  checkAbort(signal);
  if(extension && !({pdf:['pdf'],doc:['doc'],docx:['docx'],odt:['odt'],rtf:['rtf'],html:['html','htm','xhtml'],txt:['txt','text','log','csv'],md:['md','markdown']}[format] || []).includes(extension)) warnings.push(`Detected ${format.toUpperCase()} content despite the .${extension} filename. Review the extracted document.`);
  if(format==='docx') warnings.push('Referenced Word text is read as headers, body, footnotes, endnotes, then footers. Text boxes follow XML source order; repeated page variants may repeat. Unused parts are excluded. Check the original reading order.');
  if(format==='doc') warnings.push('Only the main body of this legacy Word document is imported. Headers, footers, footnotes, text boxes, comments and other non-body stories are excluded. Hidden or deleted revision formatting is not resolved; check the original for contact details and current facts.');
  if(format==='rtf') warnings.push('Visible headers, footers and footnotes are included in source order and may repeat. Comments, hidden text and field instructions are excluded.');
  if(format==='odt') warnings.push('Comments, footnote bodies, tracked deletions and text inside drawings are excluded. Check the original for contact details and other facts.');
  if(['pdf','doc','docx','odt','rtf','html'].includes(format)) warnings.push(REVIEW_WARNING);
  return {text:normalisePlainText(text),format,warnings};
}
