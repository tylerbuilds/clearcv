import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, defaultPhotoSettings, normalisePhotoSettings, validateDocument, parseDocument, serialiseDocument, applyTemplate, TEMPLATES } from '../src/model.js';
import { createWorkspace, activeEntry, duplicateDocument, updateActiveDocument, saveSnapshot, restoreSnapshot, parseWorkspace, serialiseWorkspace } from '../src/workspace.js';

function jpeg(width = 960, height = 640, trailingBytes = 0) {
  const bytes = Buffer.concat([Buffer.from([255,216,255,192,0,11,8,0,0,0,0,1,1,17,0,255,218,0,2,255,217]), Buffer.alloc(trailingBytes)]);
  bytes.writeUInt16BE(height, 7); bytes.writeUInt16BE(width, 9);
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

test('legacy headshots keep exact baked bytes and template sizing without recropping on import', () => {
  for (const photo of [jpeg(240, 240), 'data:image/png;base64,A', '']) {
    const legacy = createDocument(); delete legacy.photoSettings; legacy.photo = photo;
    const before = JSON.stringify(legacy), restored = parseDocument(before);
    assert.equal(restored.photo, photo);
    assert.deepEqual(restored.photoSettings, defaultPhotoSettings());
    assert.equal(restored.photoSettings.source, '', 'legacy bytes stay in photo, rather than being duplicated into the library');
    assert.equal(JSON.stringify(legacy), before);
  }
});

test('settings defaults are fresh and partial settings retain the default crop', () => {
  const first = defaultPhotoSettings(); first.size = 120;
  assert.equal(defaultPhotoSettings().size, 0);
  assert.deepEqual(normalisePhotoSettings({ size: 96 }), { source: '', size: 96, zoom: 1, x: 50, y: 50, rotation: 0 });
  assert.notEqual(createDocument().photoSettings, createDocument().photoSettings);
});

test('adjusted source, crop and page size survive JSON, every preset, and detached copies', () => {
  const document = createDocument(); document.photo = jpeg(240, 240);
  document.photoSettings = { source: jpeg(), size: 136, zoom: 2.5, x: 12.75, y: 82.25, rotation: 270 };
  assert.deepEqual(parseDocument(serialiseDocument(document)), document);
  for (const template of TEMPLATES) {
    const selected = applyTemplate(document, template);
    assert.equal(selected.photo, document.photo);
    assert.deepEqual(selected.photoSettings, document.photoSettings);
    selected.photoSettings.x = 0;
    assert.equal(document.photoSettings.x, 12.75);
  }
});

test('library copies and snapshots retain their own source/crop/size, including recovery before restore', () => {
  const document = createDocument(); document.photo = jpeg(240, 240);
  document.photoSettings = { source: jpeg(), size: 48, zoom: 1.5, x: 15, y: 70, rotation: 90 };
  let workspace = createWorkspace(document);
  workspace = saveSnapshot(workspace, 'before', 'Original crop', '2026-10-11T01:00:00.000Z');
  const changed = structuredClone(activeEntry(workspace).document);
  changed.photoSettings = { source: jpeg(800, 600), size: 144, zoom: 4, x: 100, y: 0, rotation: 180 };
  changed.photo = jpeg(239, 239);
  workspace = updateActiveDocument(workspace, changed);
  const copy = duplicateDocument(workspace, 'copy', 'Another crop');
  assert.deepEqual(activeEntry(copy).document, changed);
  workspace = restoreSnapshot(workspace, 'before', 'recovery', '2026-10-11T01:01:00.000Z');
  assert.deepEqual(activeEntry(workspace).document, document);
  assert.deepEqual(activeEntry(workspace).versions.at(-1).document, changed);
  assert.deepEqual(parseWorkspace(serialiseWorkspace(workspace)), workspace);
  activeEntry(workspace).document.photoSettings.size = 80;
  assert.equal(activeEntry(workspace).versions[0].document.photoSettings.size, 48);
});

test('invalid crop and page size values are rejected without changing original data', () => {
  const invalid = [
    ['size', -1], ['size', 47], ['size', 145], ['size', 96.5], ['size', '96'],
    ['zoom', 0.99], ['zoom', 4.01], ['zoom', NaN], ['zoom', Infinity], ['zoom', '2'],
    ['x', -0.01], ['x', 100.01], ['x', NaN], ['y', -1], ['y', Infinity], ['y', '50'],
    ['rotation', 45], ['rotation', 360], ['rotation', '90'], ['rotation', null]
  ];
  for (const [key, value] of invalid) {
    const document = createDocument(); document.photoSettings[key] = value;
    const before = structuredClone(document);
    assert.throws(() => validateDocument(document), /Photo/);
    assert.deepEqual(document, before);
  }
  for (const settings of [null, [], Object.create(null), { extra: true }, { get zoom() { throw new Error('Getter executed'); } }]) {
    assert.throws(() => normalisePhotoSettings(settings), /Photo settings/);
  }
});

test('editable sources reject external URLs, SVG, invalid headers, MIME disguises and excessive data', () => {
  const sourceJPEG = jpeg();
  const invalid = [
    'https://example.com/photo.jpg', 'blob:example', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,A', 'data:image/jpeg;base64,AAAA',
    sourceJPEG.replace('image/jpeg', 'image/png'),
    'data:image/jpeg;base64,' + 'A'.repeat(250000), jpeg(10000, 5000), jpeg(16385, 1)
  ];
  for (const source of invalid) {
    const document = createDocument(); document.photoSettings.source = source;
    const before = structuredClone(document);
    assert.throws(() => validateDocument(document), /Photo|photo|pixels|megapixels/);
    assert.deepEqual(document, before);
    assert.throws(() => parseDocument(JSON.stringify(document)), /Photo|photo|pixels|megapixels/);
  }
  assert.equal(normalisePhotoSettings({ source: sourceJPEG }).source, sourceJPEG);
});

test('editable source bytes count towards the existing 1 MB CV and 4 MB library limits', () => {
  const document = createDocument(); document.photoSettings.source = jpeg(960, 640, 180000);
  document.photo = jpeg(240, 240, 180000);
  for (let index = 0; index < 52; index++) document.experience.push({ id: `item-${index}`, title: '', organisation: '', location: '', dates: '', description: 'x'.repeat(10000) });
  assert.throws(() => validateDocument(document), /too large.*1 MB/);
  const small = createDocument(); small.photoSettings.source = jpeg(960, 640, 180000); small.photo = jpeg(240, 240, 180000);
  let workspace = createWorkspace(small);
  for (let index = 0; index < 6; index++) workspace = duplicateDocument(workspace, `copy-${index}`, `Copy ${index}`);
  assert.throws(() => duplicateDocument(workspace, 'over-limit', 'Too much'), /over 4 MB/);
});
