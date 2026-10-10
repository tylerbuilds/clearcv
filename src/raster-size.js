// Resource bounds only: the browser still validates and decodes the full image.
// This module has no model/import dependencies, so saved photos can use it too.
export const PORTRAIT_LIMITS = Object.freeze({ edge: 16_384, pixels: 40_000_000 });
const MAX_SOURCE_BYTES = 5_000_000;
const MAX_SCAN_STEPS = 131_072;
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const tooLarge = () => new Error('Choose a photo no larger than 40 megapixels or 16,384 pixels on either side.');

export function checkPortraitSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('This photo has invalid dimensions. Choose another photo.');
  }
  if (width > PORTRAIT_LIMITS.edge || height > PORTRAIT_LIMITS.edge || width * height > PORTRAIT_LIMITS.pixels) throw tooLarge();
  return { width, height };
}

// MIME is informational: image decoders can sniff a different supported format.
// Malformed/unknown small legacy payloads return null rather than being removed.
export function checkDeclaredRasterSize(bytes, type) {
  if (!(bytes instanceof Uint8Array)) return null;
  const ascii = (at, word) => {
    if (at + word.length > bytes.length) return false;
    for (let i = 0; i < word.length; i++) if (bytes[at + i] !== word.charCodeAt(i)) return false;
    return true;
  };
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
  const jpeg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  const webp = bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP');
  if (!png && !jpeg && !webp) return null;
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error('Choose a photo no larger than 5 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let steps = 0, dimensions = null;
  const step = () => {
    if (++steps > MAX_SCAN_STEPS) throw new Error('This photo has too many image headers. Choose another photo.');
  };
  const declared = (width, height, record = true) => {
    // JPEG may defer a zero height until a later DNL. A known giant edge must
    // still be rejected even when the other edge is zero or unavailable.
    if (width > PORTRAIT_LIMITS.edge || height > PORTRAIT_LIMITS.edge || width * height > PORTRAIT_LIMITS.pixels) throw tooLarge();
    if (width < 1 || height < 1) return null;
    const size = checkPortraitSize(width, height);
    if (record) dimensions ??= size;
    return size;
  };
  if (png) {
    if (bytes.length < 24 || !ascii(12, 'IHDR')) return null;
    const size = declared(view.getUint32(16), view.getUint32(20));
    return view.getUint32(8) === 13 ? size : null;
  }
  if (jpeg) {
    let pendingWidth = 0;
    for (let p = 2; p < bytes.length;) {
      step();
      if (bytes[p++] !== 0xff) return null;
      while (p < bytes.length && bytes[p] === 0xff) { step(); p++; }
      if (p >= bytes.length) return null;
      const marker = bytes[p++];
      if (marker === 0xda || marker === 0xd9) return dimensions;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (marker === 0 || p + 2 > bytes.length) return null;
      const length = view.getUint16(p);
      // DHP has the same declared dimensions as SOF for hierarchical JPEGs.
      const frame = SOF.has(marker) || marker === 0xde;
      if (frame && length >= 7 && p + 7 <= bytes.length) {
        declared(view.getUint16(p + 5), view.getUint16(p + 3), false);
      } else if (marker === 0xdc && length >= 4 && p + 4 <= bytes.length) {
        declared(pendingWidth, view.getUint16(p + 2), false);
      }
      if (length < 2 || p + length > bytes.length) return null;
      if (frame) {
        if (length < 8 || bytes[p + 7] === 0 || length !== 8 + 3 * bytes[p + 7]) return null;
        const width = view.getUint16(p + 5), height = view.getUint16(p + 3);
        declared(width, height);
        pendingWidth = height === 0 ? width : 0;
      } else if (marker === 0xdc) {
        if (length !== 4) return null;
        if (pendingWidth) declared(pendingWidth, view.getUint16(p + 2));
      }
      p += length;
    }
    return dimensions;
  }
  const uint24 = at => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65_536;
  const declaredEnd = view.getUint32(4, true) + 8;
  // Inspect actual bytes, even when a lying RIFF size hides a later header.
  // Container validity remains the decoder's responsibility.
  const end = bytes.length;
  const chunks = (start, limit, inFrame = false) => {
    for (let p = start; p < limit;) {
      step();
      if (p + 8 > limit) return false;
      const length = view.getUint32(p + 4, true), data = p + 8, next = data + length + (length & 1);
      // Read a present declared header even when the rest is truncated. This
      // rejects a known oversized image without pretending its file is valid.
      if (ascii(p, 'VP8X') && length >= 10 && data + 10 <= limit) {
        declared(uint24(data + 4) + 1, uint24(data + 7) + 1);
      } else if (ascii(p, 'VP8L') && length >= 5 && data + 5 <= limit && bytes[data] === 0x2f) {
        const bits = view.getUint32(data + 1, true);
        declared((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      } else if (ascii(p, 'VP8 ') && length >= 10 && data + 10 <= limit && bytes[data + 3] === 0x9d && bytes[data + 4] === 1 && bytes[data + 5] === 0x2a) {
        declared(view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff);
      } else if (ascii(p, 'ANMF') && length >= 16 && data + 16 <= limit) {
        declared(uint24(data + 6) + 1, uint24(data + 9) + 1);
        if (data + length > limit || inFrame) return false;
        // ANMF contains one level of image/alpha chunks, not nested animation.
        if (!chunks(data + 16, data + length, true)) return false;
      }
      if (next > limit) return false;
      p = next;
    }
    return true;
  };
  const complete = chunks(12, end);
  return complete && declaredEnd >= 12 && declaredEnd <= bytes.length ? dimensions : null;
}
