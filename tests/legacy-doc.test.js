import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { extractLegacyDoc, isLegacyDoc, LEGACY_DOC_BYTE_LIMIT } from '../src/legacy-doc.js';

// The two compressed fixtures below are actual app-saved OLE Word documents,
// rather than just mocked piece tables. The first is original MIT test content
// exported by LibreOffice's "MS Word 97" filter using an empty isolated profile.
// The second is the public one-sentence Word 97-SR2 fixture from:
// https://github.com/morungos/node-word-extractor/tree/d971d9f69056245ae129bd2ce31436d518293854
// __tests__/data/test05.doc. Copyright (c) 2016-2021 Stuart Watt. MIT licence:
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
const REAL_UNICODE = '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';
const REAL_WORD97 = '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';
const fixture = value => new Uint8Array(inflateSync(Buffer.from(value, 'base64')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = 'Jordan Example\nSoftware engineer — original synthetic fixture\nProfile\nBuilt reliable tools for teams. Café, naïve and Zürich.\nUnicode checks: 日本語, Ελληνικά and 🌱.\nExperience\nExample Studio | 2021–2024\nDesigned an offline editor.\nPreserved literal <script>example</script> text.\nSkills\nJavaScript, Python, testing\nLanguage\tLevel\t\tEnglish\tFluent';
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// Spec-built adversarial containers exercise alternate encodings and story
// boundaries. Genuine app-saved fixtures above are separately tested first.
function compound(pieces, { bodyLength, flags = 0x1000, version = 0xc1, newVersion, formatting = [] } = {}) {
  const word = new Uint8Array(4096), table = new Uint8Array(4096), w = view(word), t = view(table);
  w.setUint16(0, 0xa5ec, true); w.setUint16(2, version, true); w.setUint16(10, flags, true);
  w.setUint16(32, 14, true); w.setUint16(62, 22, true); w.setUint32(64, word.length, true);
  const effective = newVersion ?? version, counts = { [0xc1]: 93, [0xd9]: 108, [0x101]: 136, [0x10c]: 164, [0x112]: 183 };
  const pairs = counts[effective] ?? 93; w.setUint16(152, pairs, true);
  const newAt = 154 + pairs * 8, newCount = newVersion ? (effective === 0x112 ? 5 : 2) : 0;
  w.setUint16(newAt, newCount, true); if (newCount) w.setUint16(newAt + 2, effective, true);
  let fileOffset = 2048, cp = 0, cursor = 0;
  for (const bytes of formatting) { table[cursor] = 1; t.setUint16(cursor + 1, bytes.length, true); table.set(bytes, cursor + 3); cursor += 3 + bytes.length; }
  table[cursor] = 2; const plcSize = 4 + pieces.length * 12;
  t.setUint32(cursor + 1, plcSize, true); const cpAt = cursor + 5, pcdAt = cpAt + (pieces.length + 1) * 4;
  pieces.forEach((piece, index) => {
    t.setUint32(cpAt + index * 4, cp, true);
    const bytes = piece.compressed ? Uint8Array.from(piece.units) : Uint8Array.from(piece.units.flatMap(unit => [unit & 255, unit >>> 8]));
    word.set(bytes, fileOffset); t.setUint32(pcdAt + index * 8 + 2, piece.compressed ? 0x40000000 + fileOffset * 2 : fileOffset, true);
    fileOffset += bytes.length; cp += piece.units.length;
  });
  t.setUint32(cpAt + pieces.length * 4, cp, true); w.setUint32(76, bodyLength ?? cp, true);
  w.setUint32(418, 0, true); w.setUint32(422, cursor + 5 + plcSize, true);
  const result = new Uint8Array(19 * 512), h = view(result), dir = result.subarray(17 * 512, 18 * 512), d = view(dir), fat = view(result.subarray(18 * 512));
  result.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  h.setUint16(24, 0x3e, true); h.setUint16(26, 3, true); h.setUint16(28, 0xfffe, true); h.setUint16(30, 9, true); h.setUint16(32, 6, true);
  h.setUint32(44, 1, true); h.setUint32(48, 16, true); h.setUint32(56, 4096, true); h.setUint32(60, 0xfffffffe, true); h.setUint32(68, 0xfffffffe, true);
  for (let index = 0; index < 109; index++) h.setUint32(76 + index * 4, index === 0 ? 17 : 0xffffffff, true);
  for (let index = 0; index < 128; index++) fat.setUint32(index * 4, 0xffffffff, true);
  for (let index = 0; index < 16; index++) fat.setUint32(index * 4, index === 7 || index === 15 ? 0xfffffffe : index + 1, true);
  fat.setUint32(16 * 4, 0xfffffffe, true); fat.setUint32(17 * 4, 0xfffffffd, true);
  function entry(index, name, type, start, size, { right = 0xffffffff, child = 0xffffffff } = {}) {
    const at = index * 128;
    Array.from(name).forEach((char, offset) => d.setUint16(at + offset * 2, char.charCodeAt(0), true));
    d.setUint16(at + 64, (name.length + 1) * 2, true); dir[at + 66] = type; dir[at + 67] = 1;
    d.setUint32(at + 68, 0xffffffff, true); d.setUint32(at + 72, right, true); d.setUint32(at + 76, child, true);
    d.setUint32(at + 116, start, true); d.setUint32(at + 120, size, true);
  }
  entry(0, 'Root Entry', 5, 0xfffffffe, 0, { child: 1 });
  entry(1, 'WordDocument', 2, 0, 4096, { right: 2 });
  entry(2, flags & 0x200 ? '1Table' : '0Table', 2, 8, 4096);
  result.set(word, 512); result.set(table, 9 * 512);
  return result;
}
const unicode = text => ({ units: Array.from({ length: text.length }, (_, index) => text.charCodeAt(index)), compressed: false });
const ansi = units => ({ units: typeof units === 'string' ? Array.from(units, char => char.charCodeAt(0)) : units, compressed: true });
const wordAt = offset => 512 + offset, tableAt = offset => 9 * 512 + offset;

test('actual LibreOffice Word97 binary extracts Unicode and table text exactly and leaves original bytes untouched', () => {
  const bytes = fixture(REAL_UNICODE), before = new Uint8Array(bytes);
  assert.equal(bytes.length, 11264); assert.equal(hash(bytes), 'd234791dfa520f368452c4124a4079edc73c1b29f9b8acea27eb9beb92283482');
  assert.equal(isLegacyDoc(bytes), true); assert.equal(extractLegacyDoc(bytes), expected);
  assert.equal(extractLegacyDoc(bytes.buffer), expected); assert.deepEqual(bytes, before);
  const padded = new Uint8Array(bytes.length + 10); padded.set(bytes, 5);
  assert.equal(extractLegacyDoc(padded.subarray(5, bytes.length + 5)), expected);
});

test('actual Microsoft Word97-SR2 binary fixture parses independently of the generated fixture', () => {
  const bytes = fixture(REAL_WORD97);
  assert.equal(bytes.length, 19456); assert.equal(hash(bytes), '4876e828e62d490fa188c7c4e47013e2e0dfdf02f5903dfd374bc0d2b2049ca1');
  assert.equal(isLegacyDoc(bytes), true); assert.equal(extractLegacyDoc(bytes), 'This is a simple file created with Word 97-SR2.');
});

test('CFB version4 uses4096-byte sectors and exact directory counts instead of512-byte assumptions', () => {
  const base = compound([unicode('Version four container\r')]);
  const bytes = new Uint8Array(5 * 4096), h = view(bytes);
  bytes.set(base.subarray(0, 512));
  h.setUint16(26, 4, true); h.setUint16(30, 12, true); h.setUint32(40, 1, true);
  h.setUint32(48, 2, true); h.setUint32(76, 3, true);
  bytes.set(base.subarray(512, 4608), 4096);
  bytes.set(base.subarray(4608, 8704), 8192);
  bytes.set(base.subarray(17 * 512, 18 * 512), 3 * 4096);
  h.setUint32(3 * 4096 + 2 * 128 + 116, 1, true);
  for (let index = 0; index < 1024; index++) h.setUint32(4 * 4096 + index * 4, index < 3 ? 0xfffffffe : index === 3 ? 0xfffffffd : 0xffffffff, true);
  assert.equal(extractLegacyDoc(bytes), 'Version four container');
  const padding = new Uint8Array(bytes); padding[512] = 1;
  assert.throws(() => extractLegacyDoc(padding), /sectors/);
  const size = new Uint8Array(bytes); view(size).setUint32(3 * 4096 + 128 + 124, 1, true);
  assert.throws(() => extractLegacyDoc(size), /oversized stream/);
  const count = new Uint8Array(bytes); view(count).setUint32(40, 2, true);
  assert.throws(() => extractLegacyDoc(count), /chain/);
});

test('mixed compressed ANSI and Unicode pieces follow CP order and ignore bytes outside main-story pieces', () => {
  const bytes = compound([ansi('Caf'), ansi([0xe9, 0x20, 0x97, 0x20]), unicode('日本語\r'), ansi('HEADER FOOTNOTE SECRET')], { bodyLength: 11 });
  assert.equal(extractLegacyDoc(bytes), 'Café — 日本語');
  const altered = new Uint8Array(bytes); altered.set(new TextEncoder().encode('RAW BINARY DECOY'), wordAt(3500));
  assert.equal(extractLegacyDoc(altered), 'Café — 日本語');
});

test('compressed byte mapping uses the exact MS-DOC overrides instead of guessing a code page', () => {
  assert.equal(extractLegacyDoc(compound([ansi([0x82, 0x91, 0x92, 0x9f, 0x80, 0x8e, 0x9e, 0x0d])])), '\u201a\u2018\u2019\u0178\u0080\u008e\u009e');
});

test('surrogate pairs split across UTF16 descriptors remain exact; invalid Unicode is rejected', () => {
  assert.equal(extractLegacyDoc(compound([{ units: [0xd83c], compressed: false }, { units: [0xdf31, 13], compressed: false }])), '🌱');
  assert.throws(() => extractLegacyDoc(compound([{ units: [0xd83c, 13], compressed: false }])), /Unicode/);
});

test('field instructions are discarded, nested displayed results remain literal and nothing is executed', () => {
  const raw = 'Before \x13HYPERLINK "https://example.test/secret"\x14shown <script>literal</script>\x15 after\r';
  assert.equal(extractLegacyDoc(compound([unicode(raw)])), 'Before shown <script>literal</script> after');
  assert.equal(extractLegacyDoc(compound([unicode('\x13OUTER\x14a\x13INNER\x14b\x15c\x15\r')])), 'abc');
  for (const raw of ['\x13instruction', '\x14orphan', '\x15orphan', '\x13a\x14b\x14c\x15', '\x13'.repeat(129) + 'a' + '\x15'.repeat(129)]) assert.throws(() => extractLegacyDoc(compound([unicode(raw)])), /field/i);
});

test('main-story markers become readable paragraph/tab/break text without invented content', () => {
  assert.equal(extractLegacyDoc(compound([unicode('First\rSecond\x0bLine\x0cPage\x07Cell\x1ejoin\x1fsoft\x01\r')])), 'First\nSecond\nLine\nPage\tCell‑join\u00adsoft');
});

test('table stream selection, formatting records, incremental saves and supported effective FIB versions are explicit', () => {
  assert.equal(extractLegacyDoc(compound([ansi('First table\r')], { flags: 0x1004, formatting: [[1, 2, 3], []] })), 'First table');
  assert.equal(extractLegacyDoc(compound([unicode('Second table\r')], { flags: 0x1200 })), 'Second table');
  for (const version of [0xc1, 0xd9, 0x101, 0x10c, 0x112]) assert.equal(extractLegacyDoc(compound([ansi('Known format\r')], { version })), 'Known format');
  for (const newVersion of [0xd9, 0x101, 0x10c, 0x112]) assert.equal(extractLegacyDoc(compound([ansi('Newer format\r')], { version: 0xc1, newVersion })), 'Newer format');
});

test('encryption/XOR and pre97 formats fail honestly; read-only and write-reservation flags do not imply encryption', () => {
  for (const flags of [0x1100, 0x9100]) { const bytes = compound([ansi('Secret\r')], { flags }); assert.throws(() => extractLegacyDoc(bytes), /Encrypted|password/i); assert.equal(isLegacyDoc(bytes), false); }
  for (const flags of [0x1400, 0x1800, 0x9000]) assert.equal(extractLegacyDoc(compound([ansi('Readable\r')], { flags })), 'Readable');
  assert.throws(() => extractLegacyDoc(compound([ansi('Old format\r')], { version: 0xbf })), /older than Word 97/);
  assert.throws(() => extractLegacyDoc(compound([ansi('Unknown\r')], { version: 0x200 })), /version/);
});

test('OLE magic, headers and directory identity reject foreign/nonWord and truncated files without heuristics', () => {
  const base = compound([ansi('Main body\r')]);
  for (const value of [null, 'Main body', [], new Uint8Array(511), new Uint8Array(1024)]) { assert.throws(() => extractLegacyDoc(value)); assert.equal(isLegacyDoc(value), false); }
  for (const [offset, value, size] of [[26, 5, 2], [28, 0xfeff, 2], [30, 12, 2], [32, 5, 2], [56, 2048, 4], [44, 0, 4], [wordAt(0), 0x1234, 2], [wordAt(32), 13, 2], [wordAt(62), 21, 2], [wordAt(152), 92, 2]]) {
    const bytes = new Uint8Array(base), v = view(bytes); size === 2 ? v.setUint16(offset, value, true) : v.setUint32(offset, value, true);
    assert.throws(() => extractLegacyDoc(bytes)); assert.equal(isLegacyDoc(bytes), false);
  }
  assert.throws(() => extractLegacyDoc(base.subarray(0, base.length - 1)), /sectors/);
  const foreign = new Uint8Array(base); foreign[wordAt(0)] = 0;
  assert.equal(isLegacyDoc(foreign), false);
});

test('sector/directory cycles, root aliases, overlaps and false stream lengths are bounded failures', () => {
  const base = compound([ansi('Main body\r')]), dir = 17 * 512, fat = 18 * 512;
  for (const [offset, value] of [[fat, 0], [dir + 128 + 72, 1], [dir + 128 + 116, 8], [dir + 128 + 120, 4097], [dir + 76, 999], [fat + 17 * 4, 0xfffffffe], [60, 0], [68, 0]]) {
    const bytes = new Uint8Array(base); view(bytes).setUint32(offset, value, true);
    assert.throws(() => extractLegacyDoc(bytes)); assert.equal(isLegacyDoc(bytes), false);
  }
  const orphan = new Uint8Array(base); view(orphan).setUint32(dir + 128 + 72, 0xffffffff, true);
  assert.throws(() => extractLegacyDoc(orphan), /unreachable/);
});

test('piece counts, CP order, stream offsets and formatting lengths are checked before decoding', () => {
  const base = compound([ansi('Main body\r')]);
  for (const [offset, value] of [[wordAt(418), 4090], [wordAt(422), 4097], [tableAt(1), 15], [tableAt(5), 1], [tableAt(9), 3], [tableAt(15), 0x40000001], [tableAt(15), 4090], [wordAt(154 + 93 * 8), 6]]) {
    const bytes = new Uint8Array(base); view(bytes).setUint32(offset, value, true); assert.throws(() => extractLegacyDoc(bytes));
  }
  const formatted = compound([ansi('Body\r')], { formatting: [[1]] }); view(formatted).setInt16(tableAt(1), -1, true);
  assert.throws(() => extractLegacyDoc(formatted), /formatting length/);
  const brokenTable = new Uint8Array(base); view(brokenTable).setUint16(wordAt(10), 0x1200, true);
  assert.throws(() => extractLegacyDoc(brokenTable), /piece table/);
});

test('cbMac meaningful stream boundary excludes padding from text pieces even when the OLE stream is larger', () => {
  const base = compound([ansi('Meaningful body\r')]);
  const end = 2048 + 'Meaningful body\r'.length;
  view(base).setUint32(wordAt(64), end, true);
  assert.equal(extractLegacyDoc(base), 'Meaningful body');
  for (const value of [0, 154, 2048, end - 1, 4097]) {
    const bytes = new Uint8Array(base); view(bytes).setUint32(wordAt(64), value, true);
    assert.throws(() => extractLegacyDoc(bytes), /meaningful WordDocument/);
    assert.equal(isLegacyDoc(bytes), false);
  }
});

test('conservative supported-input policy rejects text aliased into the counted FIB allocation', () => {
  for (const compressed of [true, false]) {
    const bytes = compound([compressed ? ansi('Body\r') : unicode('Body\r')]);
    view(bytes).setUint32(tableAt(15), compressed ? 0x40000000 : 0, true);
    assert.throws(() => extractLegacyDoc(bytes), /overlaps counted FIB/);
    assert.equal(isLegacyDoc(bytes), false);
  }
});

test('input/output caps, cancellation and no-readable-mainbody errors never return partial candidates', () => {
  assert.throws(() => extractLegacyDoc(new Uint8Array(LEGACY_DOC_BYTE_LIMIT + 1)), /2 MB/);
  const oversized = compound([ansi('Small\r')]); view(oversized).setUint32(wordAt(76), 50001, true);
  assert.throws(() => extractLegacyDoc(oversized), /50,000/);
  const empty = compound([ansi('\r')], { bodyLength: 0 }); assert.throws(() => extractLegacyDoc(empty), /no readable/);
  assert.throws(() => extractLegacyDoc(compound([ansi('\r')])), /no readable/);
  const signal = AbortSignal.abort(); assert.throws(() => extractLegacyDoc(fixture(REAL_UNICODE), { signal }), { name: 'AbortError' });
  let checks = 0; const during = { get aborted() { return ++checks > 8; } };
  assert.throws(() => extractLegacyDoc(fixture(REAL_UNICODE), { signal: during }), { name: 'AbortError' });
});
