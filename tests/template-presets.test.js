import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTemplate, sampleDocument, parseDocument, serialiseDocument, validateDocument, plainTextDocument } from '../src/model.js';
import { TEMPLATE_CHOICES, TEMPLATE_DESCRIPTIONS, FONT_FAMILIES } from '../src/layout.js';
import { createWorkspace, updateActiveDocument, activeEntry, parseWorkspace, serialiseWorkspace, saveSnapshot } from '../src/workspace.js';
import { exportDocx, extractDocx } from '../src/formats.js';

const portrait = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1oAAAAASUVORK5CYII=';
const originalIds = ['studio', 'classic', 'compact', 'folio', 'ledger'];
const addedIds = ['atlas', 'letterpress', 'signal', 'outline', 'typewriter', 'margin'];
function populatedCV() {
  const doc = sampleDocument();
  doc.profile.name = 'Morgan Example'; doc.profile.summary = 'I design useful services.';
  doc.photo = portrait; doc.style.accent = '#245b4c';
  doc.richText['profile.summary'] = [{ start: 9, end: 15, bold: true }];
  doc.sectionColumns = { profile: 'main', education: 'side' };
  return doc;
}

test('new choices extend the existing v1 template keys without removing old saves', () => {
  assert.deepEqual(TEMPLATE_CHOICES.map(([id]) => id), [...originalIds, ...addedIds]);
  assert.equal(new Set(TEMPLATE_CHOICES.map(([id]) => id)).size, 11);
  for (const [id] of TEMPLATE_CHOICES) assert.ok(TEMPLATE_DESCRIPTIONS[id]?.trim(), `${id} needs an accessible description`);
  for (const id of originalIds) {
    const doc = populatedCV(); doc.style.template = id;
    assert.deepEqual(parseDocument(serialiseDocument(doc)), doc);
  }
});

for (const [id, , columns] of TEMPLATE_CHOICES) {
  test(`${id} changes design while preserving CV facts, headshot, marks, saved copies and exports`, async () => {
    const source = populatedCV(), original = structuredClone(source);
    const selected = applyTemplate(source, id);
    assert.deepEqual(source, original, 'choosing a preset must not mutate its source');
    assert.equal(selected.style.template, id); assert.equal(selected.layout.columns, columns);
    assert.equal(selected.style.accent, source.style.accent);
    for (const key of ['profile', 'experience', 'education', 'skills', 'photo', 'richText', 'sectionOrder', 'sectionColumns', 'hiddenSections']) assert.deepEqual(selected[key], source[key], key);
    assert.deepEqual(parseDocument(serialiseDocument(selected)), selected);
    let workspace = saveSnapshot(createWorkspace(source), 'before-style', 'Before choosing a layout', '2026-10-10T12:00:00.000Z');
    workspace = updateActiveDocument(workspace, selected);
    const roundtrip = parseWorkspace(serialiseWorkspace(workspace));
    assert.deepEqual(activeEntry(roundtrip).document, selected);
    assert.deepEqual(activeEntry(roundtrip).versions[0].document, source);
    assert.deepEqual(roundtrip.masterDocument, source);
    assert.equal(plainTextDocument(selected), plainTextDocument(source), 'design cannot alter text export');
    const bytes = exportDocx(selected), text = await extractDocx(bytes);
    assert.ok(text.includes('Morgan Example')); assert.ok(text.includes('I design useful services.'));
    assert.ok(text.includes(source.experience[0].description.split('\n')[0]));
    const xml = new TextDecoder().decode(bytes);
    assert.ok(xml.includes(`w:ascii="${FONT_FAMILIES[selected.layout.font].word}"`), 'Word retains the selected font family');
    assert.ok(xml.includes('<w:b/>'), 'safe inline formatting remains exported');
  });
}

test('the original five template choices retain customised type and spacing', () => {
  const doc = populatedCV(); doc.layout = { ...doc.layout, font: 'book', fontSize: 12.5, lineHeight: 1.9, spacing: 24, margin: 55, columnRatio: 'balanced', pageSize: 'Letter' };
  for (const id of originalIds) {
    const selected = applyTemplate(doc, id);
    assert.deepEqual({ ...selected.layout, columns: doc.layout.columns }, doc.layout);
  }
});

test('new layouts start with readable body sizes on paper, without changing saved custom sizes', () => {
  // Browser sheets use CSS pixels: 96px/in, compared with 72pt/in on paper.
  for (const id of addedIds) {
    const selected = applyTemplate(populatedCV(), id);
    const expectedPoints = ['atlas', 'outline', 'typewriter'].includes(id) ? 10.5 : 10.875;
    assert.equal(selected.layout.fontSize * 72 / 96, expectedPoints, `${id} printed body size`);
    selected.layout.fontSize = 12.5;
    assert.equal(parseDocument(serialiseDocument(selected)).layout.fontSize, 12.5);
    assert.equal(parseWorkspace(serialiseWorkspace(createWorkspace(selected))).documents[0].document.layout.fontSize, 12.5);
  }
});

test('a saved new layout keeps later personal adjustments instead of reapplying defaults on import', () => {
  const selected = applyTemplate(populatedCV(), 'atlas');
  selected.layout = { ...selected.layout, font: 'serif', fontSize: 12, spacing: 25, margin: 50, columns: 1, pageSize: 'Letter' };
  const saved = serialiseDocument(selected);
  assert.deepEqual(parseDocument(saved), selected);
  assert.equal(parseWorkspace(serialiseWorkspace(createWorkspace(selected))).documents[0].document.layout.columns, 1);
});

test('invalid choices and unsafe headshots are rejected before design selection mutates data', () => {
  const doc = populatedCV(), before = structuredClone(doc);
  for (const id of ['unknown', '__proto__', null, { name: 'atlas' }]) assert.throws(() => applyTemplate(doc, id), /supported template/);
  assert.deepEqual(doc, before);
  const unsafe = structuredClone(doc), bytes = Buffer.from(portrait.split(',')[1], 'base64');
  bytes.writeUInt32BE(16385, 16); unsafe.photo = 'data:image/png;base64,' + bytes.toString('base64');
  assert.throws(() => applyTemplate(unsafe, 'atlas'), /too (large|wide)|16,384|16384/i);
  assert.throws(() => validateDocument(unsafe));
  assert.equal(unsafe.style.template, doc.style.template);
});
