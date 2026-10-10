import test from 'node:test';
import assert from 'node:assert/strict';
import { PORTRAIT_LIMITS, checkPortraitSize, checkDeclaredRasterSize } from '../src/raster-size.js';

const join = (...parts) => Uint8Array.from(parts.flatMap(part => Array.from(part)));
const word = text => Uint8Array.from(text, letter => letter.charCodeAt(0));
const u16 = value => Uint8Array.of(value >>> 8, value & 255);
const u24 = value => Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255);
const u32 = value => Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24);
const png = (width, height) => {
  const bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  view.setUint32(8, 13); bytes.set(word('IHDR'), 12);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
};
const segment = (marker, payload) => join([255, marker], u16(payload.length + 2), payload);
const sof = (width, height, marker = 0xc0) => segment(marker, join([8], u16(height), u16(width), [1, 1, 0x11, 0]));
const jpeg = (...segments) => join([255, 216], ...segments, [255, 217]);
const chunk = (name, payload) => join(word(name), u32(payload.length), payload, payload.length & 1 ? [0] : []);
const webp = (...chunks) => {
  const payload = join(word('WEBP'), ...chunks);
  return join(word('RIFF'), u32(payload.length), payload);
};
const vp8x = (width, height) => chunk('VP8X', join([0, 0, 0, 0], u24(width - 1), u24(height - 1)));
const vp8l = (width, height) => chunk('VP8L', join([0x2f], u32((width - 1) | ((height - 1) << 14))));
const vp8 = (width, height) => chunk('VP8 ', [0, 0, 0, 0x9d, 1, 0x2a, width & 255, width >>> 8, height & 255, height >>> 8]);
const frame = (width, height, ...chunks) => chunk('ANMF', join([0, 0, 0, 0, 0, 0], u24(width - 1), u24(height - 1), [0, 0, 0, 0], ...chunks));
const guard = bytes => checkDeclaredRasterSize(bytes, 'image/png');
const oversized = bytes => assert.throws(() => guard(bytes), /40 megapixels|16,384/);

test('decoded dimensions have integer, edge and area bounds', () => {
  assert.equal(Object.isFrozen(PORTRAIT_LIMITS), true);
  assert.deepEqual(PORTRAIT_LIMITS, { edge: 16384, pixels: 40000000 });
  for (const [width, height] of [[1, 1], [16384, 1], [1, 16384], [8000, 5000]]) {
    assert.deepEqual(checkPortraitSize(width, height), { width, height });
  }
  for (const value of [0, -1, 0.5, '1', NaN, Infinity, null, undefined]) {
    assert.throws(() => checkPortraitSize(value, 1), /invalid dimensions/);
    assert.throws(() => checkPortraitSize(1, value), /invalid dimensions/);
  }
  for (const size of [[16385, 1], [1, 16385], [8001, 5000]]) assert.throws(() => checkPortraitSize(...size), /40 megapixels/);
});

test('PNG reads unsigned dimensions behind its full signature and IHDR', () => {
  assert.deepEqual(guard(png(8000, 5000)), { width: 8000, height: 5000 });
  for (const size of [[16385, 1], [1, 16385], [8001, 5000], [0x80000000, 1]]) oversized(png(...size));
  assert.equal(guard(png(0, 10)), null);
  assert.equal(guard(png(10, 0)), null);
  const wrongSignature = png(20000, 1); wrongSignature[7] = 0;
  assert.equal(guard(wrongSignature), null);
  const wrongChunk = png(20000, 1); wrongChunk[12] = 0;
  assert.equal(guard(wrongChunk), null);
  assert.equal(guard(png(20000, 1).subarray(0, 23)), null);
  const wrongLength = png(10, 10); new DataView(wrongLength.buffer).setUint32(8, 12);
  assert.equal(guard(wrongLength), null);
});

test('known overlarge edges are rejected even when the other edge is zero', () => {
  oversized(png(20000, 0));
  oversized(jpeg(sof(20000, 0)));
  oversized(jpeg(sof(0, 20000)));
  assert.equal(guard(jpeg(sof(10, 0))), null);
});

test('JPEG inspects every supported SOF marker and hierarchical dimensions', () => {
  for (const marker of [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf, 0xde]) {
    assert.deepEqual(guard(jpeg(sof(640, 480, marker))), { width: 640, height: 480 });
    oversized(jpeg(sof(16385, 1, marker)));
  }
});

test('a later JPEG frame cannot bypass a safe first frame', () => {
  oversized(jpeg(sof(240, 240), segment(0xe1, [1, 2, 3]), sof(8001, 5000, 0xc2)));
  assert.deepEqual(guard(jpeg(sof(320, 240), sof(640, 480))), { width: 320, height: 240 });
});

test('JPEG skips segment payloads and stops at scan data or image end', () => {
  const fake = sof(20000, 1);
  assert.deepEqual(guard(jpeg(segment(0xe1, fake), sof(640, 480))), { width: 640, height: 480 });
  const behindScan = join([255, 216], sof(640, 480), [255, 218], fake);
  assert.deepEqual(guard(behindScan), { width: 640, height: 480 });
  assert.deepEqual(guard(join(jpeg(sof(640, 480)), fake)), { width: 640, height: 480 });
  for (const marker of [0xc4, 0xc8, 0xcc]) assert.equal(guard(jpeg(sof(20000, 1, marker))), null);
});

test('JPEG fill bytes and standalone markers retain alignment', () => {
  const bytes = join([255, 216, 255, 255, 1, 255, 208, 255, 216, 255], sof(640, 480).subarray(1), [255, 217]);
  assert.deepEqual(guard(bytes), { width: 640, height: 480 });
  oversized(join([255, 216, 255, 255], sof(20000, 1).subarray(1)));
});

test('small malformed JPEGs return null while present oversize headers still reject', () => {
  for (const bytes of [[255, 216], [255, 216, 255], [255, 216, 1], [255, 216, 255, 0], [255, 216, 255, 224, 0, 1], [255, 216, 255, 224, 0, 20, 1]]) {
    assert.equal(guard(Uint8Array.from(bytes)), null);
  }
  const truncated = jpeg(sof(20000, 1)); new DataView(truncated.buffer).setUint16(4, 500);
  oversized(truncated);
});

test('malformed safe SOFs return null without hiding declared oversized edges', () => {
  assert.equal(guard(Uint8Array.from([255, 216, 255, 192, 0, 7, 8, 0, 240, 0, 240])), null);
  const noComponents = jpeg(sof(240, 240)); noComponents[11] = 0;
  assert.equal(guard(noComponents), null);
  const mismatchedComponents = jpeg(sof(240, 240)); mismatchedComponents[11] = 2;
  assert.equal(guard(mismatchedComponents), null);
  noComponents[9] = 0x4e; noComponents[10] = 0x20;
  oversized(noComponents);
});

test('pre-SOS JPEG DNL declarations check a deferred height before decode', () => {
  assert.deepEqual(guard(jpeg(sof(240, 0), segment(0xdc, u16(240)))), { width: 240, height: 240 });
  oversized(jpeg(sof(240, 0), segment(0xdc, u16(20000))));
  oversized(jpeg(sof(8001, 0), segment(0xdc, u16(5000))));
  oversized(jpeg(segment(0xdc, u16(20000))));
  assert.equal(guard(jpeg(segment(0xdc, u16(240)))), null);
});

test('WebP canvas, lossless and lossy headers have edge and area bounds', () => {
  for (const header of [vp8x, vp8l, vp8]) {
    assert.deepEqual(guard(webp(header(8000, 5000))), { width: 8000, height: 5000 });
    oversized(webp(header(8001, 5000)));
  }
  oversized(webp(vp8x(16385, 1)));
  assert.deepEqual(guard(webp(vp8l(16384, 1))), { width: 16384, height: 1 });
  assert.equal(guard(webp(vp8(0, 10))), null);
});

test('every later WebP image or canvas header is checked', () => {
  for (const header of [vp8x, vp8l, vp8]) oversized(webp(vp8x(240, 240), header(8001, 5000)));
  assert.deepEqual(guard(webp(vp8x(640, 480), vp8l(320, 240))), { width: 640, height: 480 });
});

test('WebP skips unknown payloads and honours odd chunk padding', () => {
  assert.deepEqual(guard(webp(chunk('JUNK', vp8x(20000, 1)), vp8x(640, 480))), { width: 640, height: 480 });
  oversized(webp(chunk('JUNK', [1]), vp8x(20000, 1)));
  assert.deepEqual(guard(webp(chunk('JUNK', [1, 2, 3]), vp8x(640, 480))), { width: 640, height: 480 });
});

test('WebP animation checks frame dimensions and every nested image header', () => {
  oversized(webp(vp8x(240, 240), frame(20000, 1, vp8l(240, 240))));
  for (const header of [vp8l, vp8]) oversized(webp(vp8x(240, 240), frame(240, 240, header(8001, 5000))));
  oversized(webp(vp8x(240, 240), frame(240, 240, vp8l(240, 240), vp8l(8001, 5000))));
  oversized(webp(vp8x(240, 240), frame(240, 240, chunk('ALPH', [0]), vp8l(8001, 5000))));
  assert.deepEqual(guard(webp(vp8x(640, 480), frame(320, 240, vp8l(320, 240)))), { width: 640, height: 480 });
});

test('malformed WebP frames do not recurse into arbitrary nested animations', () => {
  assert.equal(guard(webp(frame(240, 240, frame(240, 240, vp8l(240, 240))))), null);
  oversized(webp(frame(240, 240, frame(20000, 1))));
});

test('malformed and partial small WebP headers remain recoverable', () => {
  const wrongMagic = webp(vp8l(10, 10)); wrongMagic[20] = 0;
  assert.equal(guard(wrongMagic), null);
  assert.equal(guard(webp(chunk('VP8X', [0, 0]))), null);
  const missingPadding = webp(vp8l(10, 10)).subarray(0, 25);
  assert.equal(guard(missingPadding), null);
  const oversizedChunkClaim = webp(vp8x(10, 10)); new DataView(oversizedChunkClaim.buffer).setUint32(16, 100, true);
  assert.equal(guard(oversizedChunkClaim), null);
  const oversizedPresent = webp(vp8x(20000, 1)); new DataView(oversizedPresent.buffer).setUint32(16, 100, true);
  oversized(oversizedPresent);
  const truncatedRiff = webp(vp8x(10, 10)); new DataView(truncatedRiff.buffer).setUint32(4, 100, true);
  assert.equal(guard(truncatedRiff), null);
});

test('an understated RIFF size cannot hide a later oversized image or frame', () => {
  for (const bytes of [webp(vp8x(20000, 1)), webp(vp8x(240, 240), vp8l(8001, 5000)), webp(vp8x(240, 240), frame(20000, 1))]) {
    new DataView(bytes.buffer).setUint32(4, 4, true);
    oversized(bytes);
  }
  const malformedSmall = webp(vp8x(240, 240)); new DataView(malformedSmall.buffer).setUint32(4, 0, true);
  assert.equal(guard(malformedSmall), null);
});

test('MIME labels cannot hide an actual recognised oversized image', () => {
  for (const bytes of [png(20000, 1), jpeg(sof(20000, 1)), webp(vp8x(20000, 1))]) {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', undefined]) {
      assert.throws(() => checkDeclaredRasterSize(bytes, mime), /40 megapixels/);
    }
  }
});

test('typed byte views use their own offset and never mutate source bytes', () => {
  for (const bytes of [png(640, 480), jpeg(sof(640, 480)), webp(vp8x(640, 480))]) {
    const padded = join([255, 255, 255], bytes, [0, 0]);
    const before = Uint8Array.from(padded);
    assert.deepEqual(guard(padded.subarray(3, 3 + bytes.length)), { width: 640, height: 480 });
    assert.deepEqual(padded, before);
  }
  const padded = join([1, 2, 3], png(20000, 1)); oversized(padded.subarray(3));
});

test('unrecognised legacy bytes and unsupported inputs return null', () => {
  for (const value of [undefined, null, [], {}, new ArrayBuffer(2), Uint8Array.of(0), Uint8Array.of(0, 0, 0)]) assert.equal(guard(value), null);
  assert.equal(guard(new Uint8Array(5_000_001)), null);
});

test('recognised sources above 5 MB reject before scanning', () => {
  for (const head of [png(10, 10), jpeg(sof(10, 10)), webp(vp8x(10, 10))]) {
    const bytes = new Uint8Array(5_000_001); bytes.set(head);
    assert.throws(() => guard(bytes), /5 MB/);
  }
});

test('JPEG marker and WebP chunk scan exhaustion rejects rather than bypassing', () => {
  const fill = new Uint8Array(131_073).fill(255);
  assert.throws(() => guard(join([255, 216], fill, sof(20000, 1).subarray(1))), /too many image headers/);
  const emptyChunk = chunk('JUNK', []), repeated = new Uint8Array(emptyChunk.length * 131_073);
  for (let i = 0; i < 131_073; i++) repeated.set(emptyChunk, i * emptyChunk.length);
  assert.throws(() => guard(webp(repeated, vp8x(20000, 1))), /too many image headers/);
});

test('WebP nested and top-level chunks share one scan budget', () => {
  const repeated = new Uint8Array(8 * 65_536);
  for (let i = 0; i < 65_536; i++) repeated.set(chunk('JUNK', []), i * 8);
  assert.throws(() => guard(webp(repeated, frame(10, 10, repeated, vp8l(10, 10)))), /too many image headers/);
});
