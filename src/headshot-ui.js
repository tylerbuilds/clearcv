import { defaultPhotoSettings, normalisePhotoSettings } from './model.js';
import { decodePortrait, drawPortraitCrop, portraitCropGeometry, renderPortrait } from './portrait.js';

/** A staged crop editor. Only Apply passes new photo bytes to the document. */
export function openHeadshotEditor({ element, source, settings, isCurrent, onApply, onClose, restoreFocus }) {
  let staged = normalisePhotoSettings(settings), bitmap = null, closed = false, busy = false, drag = null;
  const dialog = element('dialog', { id: 'headshot-editor', class: 'headshot-editor', 'aria-labelledby': 'headshot-editor-title', 'aria-describedby': 'headshot-editor-hint' });
  const status = element('p', { id: 'headshot-editor-status', class: 'headshot-editor-status', role: 'status', 'aria-live': 'polite', text: 'Opening your photo…' });
  const canvas = element('canvas', { id: 'headshot-crop', width: '288', height: '288', tabindex: '0', role: 'img', 'aria-label': 'Headshot crop. Drag the photo or use the position controls below.', 'aria-describedby': 'headshot-editor-hint' });
  const frame = element('div', { class: 'headshot-crop-frame' }, [canvas, element('span', { class: 'headshot-crop-guide', 'aria-hidden': 'true' })]);
  const inputs = {};
  const control = (key, label, min, max, step, format) => {
    const id = `headshot-${key}`, output = element('output', { for: id, text: format(staged[key]) });
    const input = element('input', { id, type: 'range', min, max, step, value: staged[key], disabled: true });
    inputs[key] = { input, output, format };
    input.addEventListener('input', () => update({ [key]: Number(input.value) }));
    return element('div', { class: 'headshot-crop-control' }, [element('label', { for: id, text: label }), output, input]);
  };
  const controls = element('div', { class: 'headshot-crop-controls' }, [
    control('zoom', 'Zoom', 1, 4, .01, value => `${Math.round(value * 100)}%`),
    control('x', 'Horizontal position', 0, 100, 1, value => `${Math.round(value)}%`),
    control('y', 'Vertical position', 0, 100, 1, value => `${Math.round(value)}%`)
  ]);
  const rotation = element('output', { id: 'headshot-rotation', text: `${staged.rotation}°` });
  const left = element('button', { id: 'headshot-rotate-left', type: 'button', class: 'button button-quiet', text: 'Rotate left', disabled: true, onClick: () => update({ rotation: (staged.rotation + 270) % 360 }) });
  const right = element('button', { id: 'headshot-rotate-right', type: 'button', class: 'button button-quiet', text: 'Rotate right', disabled: true, onClick: () => update({ rotation: (staged.rotation + 90) % 360 }) });
  const reset = element('button', { id: 'headshot-reset-crop', type: 'button', class: 'text-button', text: 'Reset crop', disabled: true, onClick: () => update({ ...defaultPhotoSettings(), source: staged.source, size: staged.size }) });
  const cancel = element('button', { id: 'headshot-cancel', type: 'button', class: 'button button-quiet', text: 'Cancel', onClick: () => dialog.close() });
  const apply = element('button', { id: 'headshot-apply', type: 'button', class: 'button button-primary', text: 'Apply photo', disabled: true, onClick: () => void commit() });
  const adjustable = [...Object.values(inputs).map(item => item.input), left, right, reset];

  function current() { return !closed && dialog.open && isCurrent(); }
  function update(patch) {
    if (!current() || !bitmap || busy) return;
    // Source bytes were admitted when opening; pointer moves only change numbers.
    const retainedSource = staged.source;
    staged = { ...normalisePhotoSettings({ ...staged, ...patch, source: '' }), source: retainedSource };
    drawPortraitCrop(canvas.getContext('2d'), bitmap, staged, canvas.width);
    for (const [key, item] of Object.entries(inputs)) { item.input.value = staged[key]; item.output.textContent = item.format(staged[key]); }
    const geometry = portraitCropGeometry(bitmap.width, bitmap.height, staged);
    inputs.x.input.disabled = geometry.rotatedWidth - geometry.cropSize < .01;
    inputs.y.input.disabled = geometry.rotatedHeight - geometry.cropSize < .01;
    rotation.textContent = `${staged.rotation}°`;
  }
  async function commit() {
    if (!current() || !bitmap || busy) return;
    busy = true;
    for (const input of adjustable) input.disabled = true;
    apply.disabled = true; apply.textContent = 'Applying…'; status.textContent = 'Updating your headshot…';
    try {
      const photo = await renderPortrait(source, staged, { isCurrent: current });
      if (!photo || !current()) return;
      const saved = onApply(photo, normalisePhotoSettings({ ...staged, source }));
      if (!closed) dialog.close();
      return saved;
    } catch (error) {
      if (current()) status.textContent = error.message;
    } finally {
      if (current()) {
        busy = false; for (const input of adjustable) input.disabled = false;
        apply.disabled = false; apply.textContent = 'Apply photo'; update({});
      }
    }
  }
  canvas.addEventListener('pointerdown', event => {
    if (!current() || !bitmap || busy || !event.isPrimary || event.button !== 0) return;
    event.preventDefault(); canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: staged.x, y: staged.y, geometry: portraitCropGeometry(bitmap.width, bitmap.height, staged), side: canvas.getBoundingClientRect().width };
    frame.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id || !current() || busy) return;
    const { geometry, side } = drag;
    const horizontal = geometry.rotatedWidth - geometry.cropSize, vertical = geometry.rotatedHeight - geometry.cropSize;
    update({
      x: Math.max(0, Math.min(100, horizontal > .01 ? drag.x - (event.clientX - drag.clientX) / side * geometry.cropSize / horizontal * 100 : staged.x)),
      y: Math.max(0, Math.min(100, vertical > .01 ? drag.y - (event.clientY - drag.clientY) / side * geometry.cropSize / vertical * 100 : staged.y))
    });
  });
  const stopDrag = () => { drag = null; frame.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', stopDrag); canvas.addEventListener('pointercancel', stopDrag); canvas.addEventListener('lostpointercapture', stopDrag);
  canvas.addEventListener('keydown', event => {
    const step = event.shiftKey ? 10 : 1;
    const patch = { ArrowLeft: { x: Math.min(100, staged.x + step) }, ArrowRight: { x: Math.max(0, staged.x - step) }, ArrowUp: { y: Math.min(100, staged.y + step) }, ArrowDown: { y: Math.max(0, staged.y - step) } }[event.key];
    if (patch) { event.preventDefault(); update(patch); }
  });
  dialog.append(
    element('h2', { id: 'headshot-editor-title', text: 'Adjust your photo' }),
    element('p', { id: 'headshot-editor-hint', text: 'Drag to frame your face. You can also use the position controls or arrow keys. Your CV changes when you apply.' }),
    frame, controls,
    element('div', { class: 'headshot-rotate-actions' }, [left, right, rotation, reset]),
    status, element('div', { class: 'dialog-actions' }, [cancel, apply])
  );
  dialog.addEventListener('close', () => {
    if (closed) return;
    closed = true; stopDrag(); bitmap?.close(); bitmap = null; dialog.remove(); onClose(); restoreFocus();
  }, { once: true });
  document.body.append(dialog); dialog.showModal(); cancel.focus({ preventScroll: true });
  void (async () => {
    try {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(source);
      if (!match) throw new Error('Choose your photo again to adjust it.');
      const binary = atob(match[2]), bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const decoded = await decodePortrait(new Blob([bytes], { type: match[1] }), { isCurrent: current });
      if (!decoded || !current()) { decoded?.close(); return; }
      bitmap = decoded;
      for (const input of adjustable) input.disabled = false;
      apply.disabled = false; update({}); status.textContent = 'Your photo stays available for future edits.';
    } catch (error) { if (current()) status.textContent = error.message; }
  })();
  return { close: () => { if (!closed) dialog.close(); } };
}
