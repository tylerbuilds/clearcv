import { checkDeclaredRasterSize, checkPortraitSize } from './raster-size.js';

/** Validate before native allocation; the caller owns the returned bitmap. */
export async function decodePortrait(file, { isCurrent = () => true, decode = file => createImageBitmap(file) } = {}) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5_000_000) throw new Error('Choose a PNG, JPEG or WebP photo smaller than 5 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isCurrent()) return null;
  if (!checkDeclaredRasterSize(bytes, file.type)) throw new Error('Choose a readable PNG, JPEG or WebP photo.');
  const bitmap = await decode(file);
  try {
    if (!isCurrent()) { bitmap.close(); return null; }
    checkPortraitSize(bitmap.width, bitmap.height);
    return bitmap;
  } catch (error) { bitmap.close(); throw error; }
}
