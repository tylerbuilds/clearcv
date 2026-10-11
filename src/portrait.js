import { checkDeclaredRasterSize, checkPortraitSize } from './raster-size.js';
import { defaultPhotoSettings, normalisePhotoSettings } from './model.js';

const PHOTO_EDGE = 240;
const SOURCE_EDGE = 960;
const MAX_ENCODED_CHARACTERS = 250000;
const createCanvas = () => document.createElement('canvas');

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

/** The crop is expressed in the clockwise-rotated image's coordinate space. */
export function portraitCropGeometry(width, height, settings = {}) {
  checkPortraitSize(width, height);
  // The image bytes are validated once when decoding, rather than on each drag.
  // Inspect descriptors before copying so this helper cannot invoke accessors.
  if (!settings || Object.getPrototypeOf(settings) !== Object.prototype || Reflect.ownKeys(settings).some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(settings, key);
    return typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
  })) throw new Error('Photo settings must contain plain values.');
  const current = normalisePhotoSettings({ ...settings, source: '' });
  const sideways = current.rotation === 90 || current.rotation === 270;
  const rotatedWidth = sideways ? height : width, rotatedHeight = sideways ? width : height;
  const cropSize = Math.min(rotatedWidth, rotatedHeight) / current.zoom;
  return {
    rotatedWidth, rotatedHeight, cropSize,
    cropX: (rotatedWidth - cropSize) * current.x / 100,
    cropY: (rotatedHeight - cropSize) * current.y / 100,
    rotation: current.rotation
  };
}

/** Paint a filled square without allocating another full-size rotated image.
 * The caller owns the supplied context and bitmap; this helper closes neither.
 */
export function drawPortraitCrop(context, bitmap, settings = {}, outputSize = PHOTO_EDGE) {
  if (!Number.isInteger(outputSize) || outputSize < 1 || outputSize > SOURCE_EDGE) throw new Error('Choose a photo preview size between 1 and 960 pixels.');
  const geometry = portraitCropGeometry(bitmap.width, bitmap.height, settings);
  const scale = outputSize / geometry.cropSize;
  context.save();
  try {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, outputSize, outputSize);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.scale(scale, scale);
    context.translate(-geometry.cropX, -geometry.cropY);
    if (geometry.rotation === 90) context.translate(bitmap.height, 0);
    else if (geometry.rotation === 180) context.translate(bitmap.width, bitmap.height);
    else if (geometry.rotation === 270) context.translate(0, bitmap.width);
    context.rotate(geometry.rotation * Math.PI / 180);
    context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
  } finally { context.restore(); }
  return geometry;
}

function canvasContext(canvas, width, height) {
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Your browser could not prepare this photo. Try another photo.');
  return context;
}
function releaseCanvas(canvas) { canvas.width = 0; canvas.height = 0; }
function encodedJPEG(canvas, quality) {
  const result = canvas.toDataURL('image/jpeg', quality);
  if (typeof result !== 'string' || !result.startsWith('data:image/jpeg;base64,')) throw new Error('Your browser could not prepare this photo. Try another photo.');
  return result;
}
function cropBitmap(bitmap, settings, canvasFactory) {
  const canvas = canvasFactory();
  try {
    drawPortraitCrop(canvasContext(canvas, PHOTO_EDGE, PHOTO_EDGE), bitmap, settings);
    const photo = encodedJPEG(canvas, .86);
    if (photo.length > MAX_ENCODED_CHARACTERS) throw new Error('This photo could not be reduced enough to save. Choose another photo.');
    return photo;
  } finally { releaseCanvas(canvas); }
}

/** Make a metadata-free editable source and initial baked square from an upload.
 * This helper owns and always closes its decoded bitmap. Stale work returns null.
 */
export async function preparePortrait(file, { isCurrent = () => true, decode, canvasFactory = createCanvas } = {}) {
  const bitmap = await decodePortrait(file, { isCurrent, decode });
  if (!bitmap) return null;
  let canvas;
  try {
    canvas = canvasFactory();
    for (let edge = SOURCE_EDGE; edge >= 120; edge = Math.floor(edge * .75)) {
      if (!isCurrent()) return null;
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvasContext(canvas, width, height);
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [.86, .76, .65, .54, .42, .3]) {
        if (!isCurrent()) return null;
        const source = encodedJPEG(canvas, quality);
        if (source.length > MAX_ENCODED_CHARACTERS) continue;
        if (!isCurrent()) return null;
        const settings = normalisePhotoSettings({ ...defaultPhotoSettings(), source });
        const photo = cropBitmap(bitmap, settings, canvasFactory);
        return isCurrent() ? { source, photo, settings } : null;
      }
    }
    throw new Error('This photo could not be reduced enough to save. Choose another photo.');
  } finally { bitmap.close(); if (canvas) releaseCanvas(canvas); }
}

/** Bake the current crop into the existing 240px photo format for preview/PDF.
 * No URLs, network calls or object URLs are used. This helper owns the bitmap.
 */
export async function renderPortrait(source, settings = {}, { isCurrent = () => true, decode, canvasFactory = createCanvas } = {}) {
  const current = normalisePhotoSettings(settings);
  const validated = normalisePhotoSettings({ ...current, source });
  if (!validated.source) throw new Error('Choose a photo before adjusting it.');
  if (!isCurrent()) return null;
  const type = source.slice(5, source.indexOf(';'));
  const encoded = atob(source.slice(source.indexOf(',') + 1));
  const file = new Blob([Uint8Array.from(encoded, character => character.charCodeAt(0))], { type });
  const bitmap = await decodePortrait(file, { isCurrent, decode });
  if (!bitmap) return null;
  try {
    if (!isCurrent()) return null;
    const photo = cropBitmap(bitmap, validated, canvasFactory);
    return isCurrent() ? photo : null;
  } finally { bitmap.close(); }
}
