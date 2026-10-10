import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { extractDocument, DOCUMENT_BYTE_LIMIT } from '../../src/document-intake.js';
import { extractDocx, extractWordXml, exportDocx, normalisePlainText, safeImportedLink, crc32 } from '../../src/formats.js';
import { extractLegacyDoc, isLegacyDoc } from '../../src/legacy-doc.js';
import { analyseCVText } from '../../src/structured-import.js';
import { extractPdf } from '../../src/pdf-import.js';
import { extractOcr, detectOcrType, boundedOcrSize, checkDeclaredRasterSize, OCR_LIMITS } from '../../src/ocr-import.js';
import { safeContactHref } from '../../src/links.js';
import { createDocument, parseDocument, validateDocument, serialiseDocument, addCustomSection, plainTextDocument } from '../../src/model.js';

// All eight categories are exercised below. Extraction and document edits use
// generated in-memory fixtures only. There is no database, filesystem writer,
// shell interpreter or SQL engine in these modules, so database/SQL/write-lock
// attacks cannot occur here. Async import cancellation and independent calls
// cover their actual race surface; native decoder/worker interactions are
// stubbed only where a browser is required. No external APIs are contacted.
const encode = text => new TextEncoder().encode(text);
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const word = content => `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${content}</w:t></w:r></w:p></w:body></w:document>`;
const odt = content => `<o:document-content xmlns:o="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:t="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><o:body><o:text><t:p>${content}</t:p></o:text></o:body></o:document-content>`;
const odtMime = 'application/vnd.oasis.opendocument.text';
function archive(files, compressed = true) {
  const locals = [], central = []; let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path), bytes = Buffer.from(text), packed = compressed ? deflateRawSync(bytes) : bytes;
    const local = Buffer.alloc(30), entry = Buffer.alloc(46), method = compressed ? 8 : 0, crc = crc32(bytes);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, name, packed); central.push(entry, name); offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('regression: section IDs and accent never accept JSON type coercion', () => {
  for (const id of [123, true, ['section']]) {
    const doc = createDocument(); doc.customSections.push({ id, title: 'Projects', content: 'Evidence' }); doc.sectionOrder.push(id);
    assert.throws(() => parseDocument(JSON.stringify(doc)), /ID|text|section/i, `ID ${JSON.stringify(id)}`);
  }
  for (const accent of [['#ffffff'], { colour: '#ffffff' }]) {
    const doc = createDocument(); doc.style.accent = accent;
    assert.throws(() => parseDocument(JSON.stringify(doc)), /colour|text/i);
  }
});

test('regression: record accessors are refused without invoking caller code', () => {
  for (const path of ['root', 'profile', 'style', 'layout', 'coverLetter', 'custom']) {
    const doc = addCustomSection(createDocument(), 'projects'); let calls = 0;
    const record = path === 'root' ? doc : path === 'custom' ? doc.customSections[0] : doc[path];
    const key = path === 'root' ? 'schema' : path === 'profile' ? 'name' : path === 'style' ? 'accent' : path === 'layout' ? 'margin' : path === 'coverLetter' ? 'body' : 'content';
    const value = record[key]; Object.defineProperty(record, key, { enumerable: true, get() { calls++; return value; } });
    assert.throws(() => validateDocument(doc), /field|object|plain|accessor/i, path);
    assert.equal(calls, 0, path);
  }
});

test('regression: invisible object fields cannot disappear during validation', () => {
  for (const invisible of ['non-enumerable', 'symbol']) {
    const doc = createDocument();
    if (invisible === 'non-enumerable') Object.defineProperty(doc.profile, 'hiddenPayload', { value: 'unexpected', enumerable: false });
    else doc.profile[Symbol('hiddenPayload')] = 'unexpected';
    assert.throws(() => validateDocument(doc), /field|object|plain/i, invisible);
  }
});

test('regression: all document arrays are dense, plain data without invisible entries', () => {
  for (const key of ['experience', 'education', 'skills', 'customSections', 'sectionOrder', 'hiddenSections']) {
    for (const mutate of [
      array => Object.defineProperty(array, 'extra', { value: 'unexpected', enumerable: false }),
      array => { array[Symbol('extra')] = 'unexpected'; },
      array => { array.length++; },
    ]) {
      const doc = createDocument(); mutate(doc[key]);
      assert.throws(() => validateDocument(doc), /array|list|entries|field|section|plain/i, key);
    }
  }
  const doc = createDocument(); let calls = 0;
  Object.defineProperty(doc.sectionOrder, '0', { enumerable: true, get() { calls++; return 'profile'; } });
  assert.throws(() => validateDocument(doc), /array|list|field|section|plain/i); assert.equal(calls, 0);
});

test('regression: extreme OCR aspect ratios stay within the advertised render budget', () => {
  for (const [width, height] of [[1, 32_000_000], [32_000_000, 1], [2, 16_000_000], [16_000_000, 2], [1.25, 25_600_000]]) {
    const result = boundedOcrSize(width, height);
    assert(result.width * result.height <= OCR_LIMITS.renderPixels, JSON.stringify({ width, height, result }));
    assert(result.width >= 1 && result.height >= 1);
  }
});

test('regression: a maximum-size short-line CV completes within a bounded process budget', () => {
  // The previous block classifier rescanned every prior row twice. A legal
  // 49,991-character import required hundreds of millions of regex operations.
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { analyseCVText } from './src/structured-import.js';
    const source = 'Experience\\n' + 'x\\n'.repeat(24990);
    const result = analyseCVText(source);
    if (result.sourceText !== source || result.document.customSections.filter(s => result.document.hiddenSections.includes(s.id)).map(s => s.content).join('') !== source) process.exit(2);
    process.stdout.write('complete');
  `], { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8', timeout: 10000, maxBuffer: 4096 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, 'complete');
});

test('malformed byte inputs and misleading content types fail before imports start', async () => {
  for (const value of [null, undefined, 100, NaN, false, [], {}, new ArrayBuffer(4), 'Text']) await assert.rejects(extractDocument(value), /bytes/);
  await assert.rejects(extractDocument(new Uint8Array()), /non-empty/);
  await assert.rejects(extractDocument(new Uint8Array(DOCUMENT_BYTE_LIMIT + 1)), /2 MB/);
  for (const name of ['cv.pdf', 'cv.rtf', 'cv.odt', 'cv.docx']) await assert.rejects(extractDocument(encode('Readable words'), { name }), /do not match/);
  await assert.rejects(extractDocument(encode('Readable words'), { mime: 'image/png' }), /image file/);
  await assert.rejects(extractDocument(encode('Readable words'), { name: 'cv.exe' }), /unsupported/);
});

test('bounded Unicode text is literal and encoding corruption is rejected', async () => {
  const literal = 'Café 🌱\n$(touch secret) ; DROP TABLE users; ../../../etc/passwd\n<script>literal</script>';
  assert.equal((await extractDocument(encode(literal), { name: 'cv.txt' })).text, literal);
  for (const bytes of [Uint8Array.from([0xff, 0x41]), encode('Text\u0000binary'), Uint8Array.from([0xff, 0xfe, 0x00, 0xd8])]) await assert.rejects(extractDocument(bytes));
  assert.equal(normalisePlainText(' \uFEFFEvidence\r\nRow\rNext '), 'Evidence\nRow\nNext');
  assert.equal((await extractDocument(encode('x'.repeat(50_000)), { name: 'cv.txt' })).text.length, 50_000);
  await assert.rejects(extractDocument(encode('x'.repeat(50_001)), { name: 'cv.txt' }), /50,000/);
});

test('archive truncation, CRC corruption and extra bytes cannot import partial text', async () => {
  const bytes = archive({ 'word/document.xml': word('Evidence') });
  for (const bad of [bytes.subarray(0, bytes.length - 1), Buffer.concat([bytes, Buffer.from('extra')])]) await assert.rejects(extractDocx(bad));
  const corrupt = Buffer.from(bytes); corrupt[35 + 'word/document.xml'.length] ^= 1;
  await assert.rejects(extractDocx(corrupt));
  const excessive = archive(Object.fromEntries(Array.from({ length: 513 }, (_, i) => [`entry-${i}`, ''])));
  await assert.rejects(extractDocument(excessive), /512/);
  const zipBomb = archive({ 'word/document.xml': word('x'.repeat(2_000_001)) });
  await assert.rejects(extractDocx(zipBomb), /oversized/);
});

test('archive traversal and ambiguous format containers are never interpreted', async () => {
  for (const path of ['../secret.xml', '/secret.xml', 'word/../secret.xml', 'C:/secret.xml', 'word\\secret.xml']) {
    await assert.rejects(extractDocx(archive({ 'word/document.xml': word('Evidence'), [path]: 'secret' })), /invalid|duplicate/);
  }
  await assert.rejects(extractDocument(archive({ 'word/document.xml': word('Evidence'), 'content.xml': odt('Other') })), /conflicting document formats/);
});

test('XML and ODT entity expansion, deep nesting and invalid Unicode never escape the text boundary', async () => {
  for (const xml of [word('&madeup;'), word('&#xD800;'), '<!DOCTYPE w:document [<!ENTITY x "secret">]>' + word('&x;'), word('Evidence').replace('</w:r>', '</w:p>')]) assert.throws(() => extractWordXml(xml));
  assert.throws(() => extractWordXml(word('x'.repeat(100_001))), /too complex/);
  const deep = `<w:document xmlns:w="${W}">` + '<w:p>'.repeat(129) + '<w:r><w:t>Evidence</w:t></w:r>' + '</w:p>'.repeat(129) + '</w:document>';
  assert.throws(() => extractWordXml(deep), /complex/);
  const makeOdt = xml => archive({ mimetype: odtMime, 'content.xml': xml }, false);
  assert.equal((await extractDocument(makeOdt(odt('Café &amp; 🌱')))).text, 'Café & 🌱');
  for (const xml of [odt('&#xD800;'), '<!DOCTYPE o:document-content>' + odt('Evidence'), odt('Evidence').replace('</t:p>', '</o:text>')]) await assert.rejects(extractDocument(makeOdt(xml)));
});

test('HTML injection and hidden payloads become inert text without network calls', async () => {
  const html = '<html><head><link href="https://invalid.example/a"></head><body><script>fetch("https://invalid.example")</script><style>body{display:none}</style><p hidden>Secret</p><iframe src="https://invalid.example">Hidden iframe</iframe><p>Visible &lt;script&gt;literal&lt;/script&gt;</p><a href="javascript:alert(1)">Label</a><a href="https://invalid.example/safe">Portfolio</a></body></html>';
  const result = await extractDocument(encode(html), { name: 'cv.html' });
  assert.equal(result.text, 'Visible <script>literal</script>\nLabelPortfolio (https://invalid.example/safe)');
  assert(!/fetch|Secret|Hidden iframe|display:none|javascript/.test(result.text));
  await assert.rejects(extractDocument(encode('<p>broken<'), { name: 'cv.html' }), /incomplete/);
  await assert.rejects(extractDocument(encode('<script>missing ending'), { name: 'cv.html' }), /incomplete/);
});

test('RTF binary destinations, field instructions and cancelled imports remain inert', async () => {
  const bytes = encode('{\\rtf1 Visible {\\*\\generator hidden}{\\field{\\*\\fldinst HYPERLINK "javascript:alert(1)"}{\\fldrslt Label}}\\par End}');
  assert.equal((await extractDocument(bytes)).text, 'Visible Label\nEnd');
  for (const raw of ['{\\rtf1 incomplete', '{\\rtf1 bad \\' + 'a'.repeat(40) + '}', '{\\rtf1 \\bin99999999999 x}', '{\\rtf1 ' + '{'.repeat(129) + 'x' + '}'.repeat(129) + '}']) await assert.rejects(extractDocument(encode(raw)));
  const controller = new AbortController(); controller.abort();
  for (const run of [() => extractDocument(bytes, { signal: controller.signal }), () => extractDocx(exportDocx(createDocument()), { signal: controller.signal }), () => extractPdf(encode('%PDF-1.7'), { signal: controller.signal }), () => extractOcr(encode('%PDF-1.7'), { signal: controller.signal })]) await assert.rejects(run(), { name: 'AbortError' });
});

test('parallel text and compressed document imports retain independent source and warnings', async () => {
  const sources = Array.from({ length: 64 }, (_, i) => `Applicant ${i} — café 🌱`);
  const files = sources.map((text, i) => i % 2 ? archive({ 'word/document.xml': word(text) }) : encode(text));
  const results = await Promise.all(files.map(file => extractDocument(file, { name: 'cv.txt' })));
  assert.deepEqual(results.map(result => result.text), sources);
  for (const [i, result] of results.entries()) assert.equal(result.warnings.some(warning => warning.includes('despite')), Boolean(i % 2));
  results[1].warnings.push('Changed'); assert(!results[3].warnings.includes('Changed'));
});

test('structured import source is exact despite duplicate skills, overflow and hostile literal text', () => {
  const source = 'Name: Alex Example\r\nSkills\r\n' + Array.from({ length: 70 }, (_, i) => `Skill${i}`).join(', ') + '\r\nSkill1\r\nProjects\r\n<script>literal</script> ../../../etc/passwd $(noop)\r\n';
  const result = analyseCVText(source, { idPrefix: 'adversarial' });
  assert.equal(result.document.skills.length, 60); assert.equal(new Set(result.document.skills.map(item => item.name)).size, 60);
  assert.equal(result.document.customSections.filter(section => result.document.hiddenSections.includes(section.id)).map(section => section.content).join(''), source.replace(/\r\n/g, '\n'));
  assert(result.unmappedText.includes('Skill69')); assert(result.warnings.some(warning => warning.includes('60')));
  assert(result.document.customSections.some(section => section.content.includes('<script>literal</script>')));
  for (const value of [null, false, 99, [], {}, 'x\uD800', 'x\u0000']) assert.throws(() => analyseCVText(value));
  assert.throws(() => analyseCVText('x'.repeat(50_001)), /50,000/);
  assert.throws(() => analyseCVText('Name: Alex', { idPrefix: '../../escape' }), /prefix/);
});

test('validated backup limits, duplicate IDs and nested unsupported fields fail without mutating valid state', () => {
  const doc = addCustomSection(createDocument(), 'projects'); doc.profile.name = '<script>literal</script>'; doc.customSections[0].content = 'Evidence';
  const json = serialiseDocument(doc); assert.deepEqual(parseDocument(json), doc);
  const restored = parseDocument(json); restored.customSections[0].content = 'changed'; assert.equal(doc.customSections[0].content, 'Evidence');
  for (const mutate of [copy => { copy.customSections.push({ ...copy.customSections[0] }); copy.sectionOrder.push('projects'); }, copy => { copy.profile.unrecognised = 'x'; }, copy => { copy.layout.margin = Infinity; }, copy => { copy.hiddenSections = ['projects', 'projects']; }, copy => { copy.sectionOrder.reverse(); copy.sectionOrder.push('profile'); }]) {
    const copy = structuredClone(doc); mutate(copy); assert.throws(() => validateDocument(copy));
  }
  assert.equal(plainTextDocument(doc).includes('<script>literal</script>'), true);
  assert.throws(() => parseDocument('[]'), /object/); assert.throws(() => parseDocument('{"schema":"clearcv"}\nextra'), /valid JSON/);
});

test('link sanitisation refuses control characters, active schemes and credentials', () => {
  for (const value of [null, false, 12, ['https://example.com'], 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'https://user:password@example.com', 'https://example.com\\escape', 'https://example.com\n?header=bad']) {
    assert.equal(safeImportedLink(value), null); assert.equal(safeContactHref('website', value), null);
  }
  assert.equal(safeImportedLink('https://example.com/path?name=%3Cscript%3E'), 'https://example.com/path?name=%3Cscript%3E');
  assert.equal(safeContactHref('email', 'alex?injection@example.com'), 'mailto:alex%3Finjection@example.com');
  assert.equal(safeImportedLink('mailto:alex%0ABcc:secret@example.com'), null);
});

test('legacy compound sniffing rejects corruption, fake filenames and type confusion without allocating oversized streams', () => {
  for (const value of [null, undefined, 100, false, {}, [], new Uint8Array(511), new Uint8Array(512), new Uint8Array(2_000_001)]) {
    assert.equal(isLegacyDoc(value), false); assert.throws(() => extractLegacyDoc(value));
  }
  const bytes = new Uint8Array(512); bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.equal(isLegacyDoc(bytes), false); assert.throws(() => extractLegacyDoc(bytes), /damaged/);
});

test('OCR finite source bounds and advertised raster dimensions are checked before decoding', () => {
  for (const pair of [[0, 1], [-1, 1], [NaN, 1], [Infinity, 1], ['100', 100], [100000, 100000]]) assert.throws(() => boundedOcrSize(...pair));
  const png = new Uint8Array(24), view = new DataView(png.buffer); png.set(encode('IHDR'), 12); view.setUint32(16, 0); view.setUint32(20, 200);
  assert.throws(() => checkDeclaredRasterSize(png, 'image/png'));
  view.setUint32(16, 6000); view.setUint32(20, 6000); assert.throws(() => checkDeclaredRasterSize(png, 'image/png'), /32 megapixels/);
  assert.throws(() => detectOcrType(encode('<svg><script>bad</script></svg>')), /choose PNG/);
  assert.throws(() => detectOcrType(new Uint8Array(OCR_LIMITS.bytes + 1)), /10 MiB/);
});

test('regression: byte readers reject array-like values without executing element getters', async () => {
  let reads = 0;
  const input = { length: 30, get 0() { reads++; return 137; }, get 1() { reads++; return 80; }, get 2() { reads++; return 78; }, get 3() { reads++; return 71; } };
  assert.throws(() => detectOcrType(input));
  await assert.rejects(extractDocx(input)); await assert.rejects(extractPdf(input)); await assert.rejects(extractOcr(input));
  assert.equal(reads, 0);
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(detectOcrType(png.buffer), 'image/png');
  for (const value of [30, [137, 80, 78, 71, 13, 10, 26, 10], new Uint16Array([137, 80, 78, 71])]) assert.throws(() => detectOcrType(value));
});

test('regression: async DOCX intake snapshots the supplied view before returning control', async () => {
  const doc = createDocument(); doc.profile.name = 'Original evidence';
  const input = exportDocx(doc), expected = await extractDocx(input);
  // The source's owner may reuse its buffer while the reader is awaiting a
  // relationship part. The already accepted document must remain consistent.
  const pending = extractDocx(input); input.fill(0);
  assert.equal(await pending, expected);
  assert(input.every(byte => byte === 0));
  const buffer = exportDocx(doc).buffer, buffered = extractDocx(buffer); new Uint8Array(buffer).fill(0);
  assert.equal(await buffered, expected);
});

test('regression: document intake snapshots ODT and a nonzero-offset view before awaits', async () => {
  const original = archive({ mimetype: odtMime, 'content.xml': odt('Original ODT evidence') }, false);
  const padded = new Uint8Array(original.length + 20); padded.set(original, 10);
  const input = padded.subarray(10, 10 + original.length);
  const pending = extractDocument(input, { name: 'cv.odt' }); padded.fill(0);
  assert.equal((await pending).text, 'Original ODT evidence');
  assert(padded.every(byte => byte === 0));
});
