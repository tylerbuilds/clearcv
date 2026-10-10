/**
 * Original bounded MS-CFB/MS-DOC main-story reader. No network, macros, objects
 * or document code are executed. Layout and non-body stories are not imported.
 * Format references: Microsoft's MS-CFB §2 and MS-DOC §2.4.1 / §2.9.73.
 * https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/53989ce4-7b05-4f8d-829b-d08d6148375b
 * https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/01d5d8c4-cf9c-4ef9-80fd-439e763cfe01
 * https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/aa2e55a2-f4f2-4795-bab5-6d9d7a0ed249
 * The MIT-licensed morungos/node-word-extractor was consulted independently;
 * this implementation does not include its Node-only stream/dependency code.
 */
import { normalisePlainText } from './formats.js';

export const LEGACY_DOC_BYTE_LIMIT = 2_000_000;
const TEXT_LIMIT = 50_000;
const MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREE = 0xffffffff, END = 0xfffffffe, FAT_SECTOR = 0xfffffffd, DIF_SECTOR = 0xfffffffc;
const invalid = detail => { throw new Error(`The legacy Word document is malformed or unsupported: ${detail}. Save a DOCX or Unicode text copy.`); };
const checkAbort = signal => { if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError'); };
const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const utf16 = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true });

function inputBytes(input) {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes || bytes.length < 512) invalid('a complete OLE compound file is required');
  if (bytes.length > LEGACY_DOC_BYTE_LIMIT) throw new Error('Choose a legacy Word DOC file smaller than 2 MB.');
  if (!MAGIC.every((byte, index) => bytes[index] === byte)) invalid('invalid OLE signature');
  return new Uint8Array(bytes);
}

function compoundStreams(input, signal) {
  checkAbort(signal);
  const bytes = inputBytes(input), header = viewOf(bytes);
  const major = header.getUint16(26, true), shift = header.getUint16(30, true);
  if (![3, 4].includes(major) || shift !== (major === 3 ? 9 : 12) || header.getUint16(28, true) !== 0xfffe || header.getUint16(32, true) !== 6 || header.getUint32(56, true) !== 4096) invalid('invalid compound header');
  if (bytes.slice(8, 24).some(Boolean) || bytes.slice(34, 40).some(Boolean)) invalid('reserved compound header fields');
  const sectorSize = 2 ** shift, sectorCount = bytes.length / sectorSize - 1;
  if (!Number.isInteger(sectorCount) || sectorCount < 2 || (major === 4 && bytes.slice(512, sectorSize).some(Boolean))) invalid('truncated compound sectors');
  const directoryCount = header.getUint32(40, true), fatCount = header.getUint32(44, true), miniCount = header.getUint32(64, true), difCount = header.getUint32(72, true);
  if ((major === 3 && directoryCount !== 0) || (major === 4 && (!directoryCount || directoryCount > sectorCount)) || !fatCount || fatCount > sectorCount || miniCount > sectorCount || difCount > sectorCount) invalid('invalid allocation counts');
  const occupied = new Set(), miniOccupied = new Set();
  const sector = id => {
    if (!Number.isInteger(id) || id < 0 || id >= sectorCount) invalid('out-of-range sector');
    return bytes.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);
  };
  const claim = (id, set = occupied) => {
    if (set.has(id)) invalid('cyclic or overlapping sector chains');
    set.add(id);
  };
  const fatIds = [];
  const addFat = id => { if (id !== FREE) { sector(id); claim(id); fatIds.push(id); } };
  for (let index = 0; index < 109; index++) addFat(header.getUint32(76 + index * 4, true));
  let difId = header.getUint32(68, true);
  const difIds = [];
  for (let index = 0; index < difCount; index++) {
    checkAbort(signal); const part = viewOf(sector(difId)); claim(difId); difIds.push(difId);
    for (let offset = 0; offset < sectorSize - 4; offset += 4) addFat(part.getUint32(offset, true));
    difId = part.getUint32(sectorSize - 4, true);
  }
  if (difId !== END || fatIds.length !== fatCount) invalid('invalid DIFAT chain');
  const fat = new Uint32Array(fatCount * sectorSize / 4);
  fatIds.forEach((id, index) => { const part = viewOf(sector(id)); for (let offset = 0; offset < sectorSize; offset += 4) fat[index * sectorSize / 4 + offset / 4] = part.getUint32(offset, true); });
  if (fat.length < sectorCount || fatIds.some(id => fat[id] !== FAT_SECTOR) || difIds.some(id => fat[id] !== DIF_SECTOR)) invalid('invalid FAT markers');

  function chain(start, table, capacity, count, mini = false) {
    if (count === 0) { if (start !== END && start !== FREE) invalid('non-empty zero-sized chain'); return []; }
    const result = []; let id = start;
    while (id !== END) {
      checkAbort(signal);
      if (!Number.isInteger(id) || id < 0 || id >= capacity || id >= table.length || result.length >= capacity || (count !== null && result.length >= count)) invalid('invalid or oversized allocation chain');
      claim(id, mini ? miniOccupied : occupied); result.push(id); id = table[id];
    }
    if (count !== null && result.length !== count) invalid('truncated allocation chain');
    return result;
  }
  function join(ids, size, miniStream) {
    const unit = miniStream ? 64 : sectorSize, result = new Uint8Array(size);
    ids.forEach((id, index) => {
      const part = miniStream ? miniStream.subarray(id * 64, (id + 1) * 64) : sector(id);
      result.set(part.subarray(0, Math.min(unit, size - index * unit)), index * unit);
    });
    return result;
  }
  const dirIds = chain(header.getUint32(48, true), fat, sectorCount, major === 4 ? directoryCount : null);
  if (!dirIds.length) invalid('missing directory');
  const directory = join(dirIds, dirIds.length * sectorSize), dir = viewOf(directory), entries = [];
  for (let offset = 0; offset < directory.length; offset += 128) {
    checkAbort(signal);
    const type = directory[offset + 66];
    if (type === 0) { entries.push(null); continue; }
    const nameSize = dir.getUint16(offset + 64, true);
    if (![1, 2, 5].includes(type) || nameSize < 2 || nameSize > 64 || nameSize % 2 || dir.getUint16(offset + nameSize - 2, true) !== 0 || directory[offset + 67] > 1) invalid('invalid directory entry');
    let name;
    try { name = utf16.decode(directory.subarray(offset, offset + nameSize - 2)); } catch { invalid('invalid directory name'); }
    if (!name || /[\u0000\\/:!]/u.test(name)) invalid('invalid directory name');
    const high = dir.getUint32(offset + 124, true), low = dir.getUint32(offset + 120, true);
    if (major === 4 && high !== 0) invalid('oversized stream');
    if (low > bytes.length || (type === 1 && low !== 0)) invalid('oversized stream');
    entries.push({ name, type, left: dir.getUint32(offset + 68, true), right: dir.getUint32(offset + 72, true), child: dir.getUint32(offset + 76, true), start: dir.getUint32(offset + 116, true), size: low });
  }
  const root = entries[0];
  if (!root || root.type !== 5 || root.left !== FREE || root.right !== FREE) invalid('missing compound root');
  const reachable = new Set([0]), rootStreams = new Map(), stack = [[root.child, 0]];
  while (stack.length) {
    checkAbort(signal); const [index, parent] = stack.pop(); if (index === FREE) continue;
    if (index >= entries.length || reachable.has(index) || !entries[index] || entries[index].type === 5) invalid('cyclic or invalid directory tree');
    reachable.add(index); const entry = entries[index];
    stack.push([entry.left, parent], [entry.right, parent]);
    if (entry.type === 1) stack.push([entry.child, index]);
    else if (entry.child !== FREE) invalid('stream with a child directory');
    if (parent === 0) {
      const key = entry.name.toUpperCase(); if (rootStreams.has(key)) invalid('duplicate root stream name');
      rootStreams.set(key, entry);
    }
  }
  if (entries.some((entry, index) => entry && !reachable.has(index))) invalid('unreachable directory entry');
  const miniIds = chain(header.getUint32(60, true), fat, sectorCount, miniCount);
  const miniBytes = join(miniIds, miniCount * sectorSize), miniView = viewOf(miniBytes), miniFat = new Uint32Array(miniBytes.length / 4);
  for (let offset = 0; offset < miniBytes.length; offset += 4) miniFat[offset / 4] = miniView.getUint32(offset, true);
  const rootIds = chain(root.start, fat, sectorCount, Math.ceil(root.size / sectorSize));
  const miniStream = join(rootIds, root.size), miniCapacity = Math.floor(miniStream.length / 64);
  const wanted = new Map();
  for (const entry of entries) {
    if (!entry || entry.type !== 2) continue;
    const small = entry.size < 4096;
    const ids = chain(entry.start, small ? miniFat : fat, small ? miniCapacity : sectorCount, Math.ceil(entry.size / (small ? 64 : sectorSize)), small);
    const key = entry.name.toUpperCase();
    if (rootStreams.get(key) === entry && ['WORDDOCUMENT', '0TABLE', '1TABLE'].includes(key)) wanted.set(key, join(ids, entry.size, small ? miniStream : undefined));
  }
  return wanted;
}

function fib(word) {
  if (!word || word.length < 32) invalid('missing WordDocument stream');
  const view = viewOf(word);
  if (view.getUint16(0, true) !== 0xa5ec) invalid('invalid Word FIB signature');
  const version = view.getUint16(2, true), flags = view.getUint16(10, true);
  if (version < 0xc1) throw new Error('Word files older than Word 97 are unsupported. Save a DOCX or Unicode text copy.');
  if (![0xc1, 0xd9, 0x101, 0x10c, 0x112].includes(version)) invalid('unsupported Word FIB version');
  if (flags & 0x100) throw new Error('Encrypted or password-protected legacy Word documents cannot be imported. Save an unencrypted DOCX or text copy.');
  const range = (offset, size) => { if (offset < 0 || offset + size > word.length) invalid('truncated Word FIB'); };
  range(32, 2); const csw = view.getUint16(32, true);
  if (csw !== 14) invalid('unsupported FIB word fields');
  const cslwOffset = 34 + csw * 2; range(cslwOffset, 2);
  const cslw = view.getUint16(cslwOffset, true), lwOffset = cslwOffset + 2;
  if (cslw !== 22) invalid('unsupported FIB long fields');
  range(lwOffset, cslw * 4 + 2);
  const cbMac = view.getUint32(lwOffset, true), bodyLength = view.getUint32(lwOffset + 3 * 4, true);
  if (!bodyLength) throw new Error('The legacy Word document contains no readable main-body text.');
  if (bodyLength > TEXT_LIMIT) throw new Error('Imported text must contain at most 50,000 characters.');
  const countOffset = lwOffset + cslw * 4, count = view.getUint16(countOffset, true), fcOffset = countOffset + 2;
  if (count < 93 || count > 183) invalid('unsupported FIB offsets');
  range(fcOffset, count * 8 + 2);
  const newOffset = fcOffset + count * 8, newCount = view.getUint16(newOffset, true);
  if (![0, 2, 5].includes(newCount)) invalid('unsupported extended FIB fields');
  range(newOffset + 2, newCount * 2);
  const fibEnd = newOffset + 2 + newCount * 2;
  if (cbMac < fibEnd || cbMac > word.length) invalid('invalid meaningful WordDocument length');
  const effectiveVersion = newCount ? view.getUint16(newOffset + 2, true) : version;
  const expected = new Map([[0xc1, [93, 0]], [0xd9, [108, 2]], [0x101, [136, 2]], [0x10c, [164, 2]], [0x112, [183, 5]]]).get(effectiveVersion);
  // LibreOffice's genuine Word 97 export omits the optional newer FIB block
  // (cswNew=0) even with a known later base version. Its counted offsets still
  // identify the format unambiguously; no guessed text offsets are used.
  if (!expected || count !== expected[0] || (newCount !== 0 && newCount !== expected[1])) invalid('unsupported effective FIB version or counts');
  const fcClx = view.getUint32(fcOffset + 33 * 8, true), lcbClx = view.getUint32(fcOffset + 33 * 8 + 4, true);
  return { cbMac, fibEnd, bodyLength, tableName: flags & 0x200 ? '1TABLE' : '0TABLE', fcClx, lcbClx };
}

// MS-DOC FcCompressed overrides; unlisted bytes map to their Unicode value.
const COMPRESSED = new Map([
  [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e], [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021],
  [0x88, 0x02c6], [0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152],
  [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201c], [0x94, 0x201d], [0x95, 0x2022],
  [0x96, 0x2013], [0x97, 0x2014], [0x98, 0x02dc], [0x99, 0x2122], [0x9a, 0x0161],
  [0x9b, 0x203a], [0x9c, 0x0153], [0x9f, 0x0178]
]);

function mainText(word, table, info, signal) {
  const { fcClx, lcbClx, bodyLength, cbMac, fibEnd } = info;
  if (!table || !lcbClx || fcClx + lcbClx > table.length) invalid('missing or truncated piece table');
  const clx = table.subarray(fcClx, fcClx + lcbClx), view = viewOf(clx);
  let cursor = 0;
  while (cursor < clx.length && clx[cursor] === 1) {
    checkAbort(signal);
    if (cursor + 3 > clx.length) invalid('truncated piece formatting');
    const length = view.getInt16(cursor + 1, true);
    if (length < 0 || length > 0x3fa2) invalid('invalid piece formatting length');
    cursor += 3 + length;
    if (cursor > clx.length) invalid('truncated piece formatting');
  }
  if (cursor + 5 > clx.length || clx[cursor] !== 2) invalid('missing piece descriptor');
  const size = view.getUint32(cursor + 1, true), start = cursor + 5;
  if (size < 16 || (size - 4) % 12 || start + size !== clx.length) invalid('invalid piece-table length');
  const count = (size - 4) / 12;
  if (count > 16_384) invalid('too many text pieces');
  const cp = [], descriptors = start + (count + 1) * 4;
  for (let index = 0; index <= count; index++) {
    const position = view.getUint32(start + index * 4, true);
    if (position > 0x7fffffff || (index === 0 && position !== 0) || (index > 0 && position <= cp[index - 1])) invalid('invalid character positions');
    cp.push(position);
  }
  if (cp[count] < bodyLength) invalid('piece table does not cover the main body');
  const chunks = [];
  for (let index = 0; index < count; index++) {
    checkAbort(signal);
    const raw = view.getUint32(descriptors + index * 8 + 2, true), compressed = Boolean(raw & 0x40000000), encodedOffset = raw & 0x3fffffff;
    if (compressed && encodedOffset % 2) invalid('unaligned compressed piece');
    const offset = compressed ? encodedOffset / 2 : encodedOffset, length = cp[index + 1] - cp[index], byteLength = length * (compressed ? 1 : 2);
    // Conservative supported-input policy: text cannot alias the known FIB
    // allocation. This is not a claimed additional MS-DOC normative fcMin rule.
    if (offset < fibEnd) invalid('text piece overlaps counted FIB allocation');
    if (offset + byteLength > cbMac) invalid('text piece exceeds meaningful WordDocument stream');
    const take = Math.max(0, Math.min(cp[index + 1], bodyLength) - cp[index]);
    if (!take) continue;
    const part = word.subarray(offset, offset + take * (compressed ? 1 : 2));
    if (compressed) {
      chunks.push(Array.from(part, byte => String.fromCharCode(COMPRESSED.get(byte) ?? byte)).join(''));
    } else {
      // Keep UTF-16 code units across piece boundaries: a surrogate pair may be
      // split between two descriptors. Validate Unicode after concatenation.
      const units = viewOf(part), text = [];
      for (let at = 0; at < part.length; at += 2) text.push(String.fromCharCode(units.getUint16(at, true)));
      chunks.push(text.join(''));
    }
  }
  const rawText = chunks.join('');
  if (rawText.length !== bodyLength || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(rawText)) invalid('invalid Unicode text');
  // Field instructions (e.g. HYPERLINK targets) are not visible text. Keep only
  // each field's displayed result, including nested fields, and never evaluate.
  const fields = [], result = [];
  let hiddenFields = 0;
  for (const char of rawText) {
    if (char === '\x13') { if (fields.length >= 128) invalid('excessive nested fields'); fields.push(false); hiddenFields++; continue; }
    if (char === '\x14') { if (!fields.length || fields[fields.length - 1]) invalid('invalid field separator'); fields[fields.length - 1] = true; hiddenFields--; continue; }
    if (char === '\x15') { if (!fields.length) invalid('invalid field ending'); if (!fields.pop()) hiddenFields--; continue; }
    if (hiddenFields) continue;
    if (char === '\x07') result.push('\t'); // Table-cell / row delimiters.
    else if (['\r', '\x0b', '\x0c', '\x0e'].includes(char)) result.push('\n');
    else if (char === '\x1e') result.push('\u2011');
    else if (char === '\x1f') result.push('\u00ad');
    else if (char === '\t' || char === '\n' || char.charCodeAt(0) >= 32) result.push(char);
  }
  if (fields.length) invalid('unterminated document field');
  return normalisePlainText(result.join(''));
}

/** Strict content sniff; malformed, encrypted and unsupported files return false. */
export function isLegacyDoc(bytes) {
  try { extractLegacyDoc(bytes); return true; }
  catch { return false; }
}

/** Returns reviewed plain main-body text; rejects encryption, pre-97 and corruption. */
export function extractLegacyDoc(bytes, { signal } = {}) {
  checkAbort(signal);
  const streams = compoundStreams(bytes, signal), word = streams.get('WORDDOCUMENT'), info = fib(word);
  const text = mainText(word, streams.get(info.tableName), info, signal);
  checkAbort(signal);
  return text;
}
