import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, sampleDocument } from '../src/model.js';
import { createWorkspace, saveSnapshot, addApplication } from '../src/workspace.js';
import { mergeReviewedDocument, createReviewedImport } from '../src/import-workspace.js';

function imported() {
  const doc = createDocument();
  doc.profile = { ...doc.profile, name: 'Zoë Patel', email: 'zoe@example.com', summary: 'Supplied original fact.' };
  doc.experience = [{ id: 'exp-1', title: 'Engineer', organisation: 'Mira', location: '', dates: '2021–2024', description: 'Reduced actual latency by 20%.' }];
  doc.skills = [{ id: 'skill-1', name: 'TypeScript' }];
  doc.customSections = [{ id: 'original', title: 'Original imported source', content: '<script>literal supplied source</script>\nZoë Patel' }];
  doc.sectionOrder.push('original'); doc.hiddenSections.push('original');
  return doc;
}
test('upgraded copy preserves original CV, snapshots, master and linked jobs byte for byte', () => {
  let ws = createWorkspace(sampleDocument(), 'old', 'Original');
  ws = saveSnapshot(ws, 'past', 'Earlier', '2026-01-01T00:00:00.000Z'); ws = addApplication(ws, 'job');
  const before = structuredClone(ws), candidate = imported();
  const result = createReviewedImport(ws, candidate, { id: 'upgraded', name: 'Upgraded', mode: 'merge', targetId: 'old', profileFields: ['email'], sectionModes: { experience: 'append', education: 'keep', skills: 'replace' } });
  assert.deepEqual(ws, before); assert.deepEqual(result.documents[0], before.documents[0]);
  assert.deepEqual(result.masterDocument, before.masterDocument); assert.deepEqual(result.applications, before.applications);
  assert.equal(result.activeId, 'upgraded'); assert.equal(result.documents[1].document.profile.name, before.documents[0].document.profile.name);
  assert.equal(result.documents[1].document.profile.email, 'zoe@example.com'); assert.equal(result.documents[1].document.experience.length, 3);
  assert.equal(result.documents[1].document.skills[0].name, 'TypeScript');
  assert.equal(result.documents[1].document.customSections[0].content, candidate.customSections[0].content);
  assert.deepEqual(candidate, imported());
});
test('new import keeps all reviewed fields and original library untouched', () => {
  const ws = createWorkspace(sampleDocument(), 'old', 'Original'), before = JSON.stringify(ws);
  const result = createReviewedImport(ws, imported(), { id: 'new', name: 'Imported' });
  assert.deepEqual(result.documents[1].document, imported()); assert.equal(JSON.stringify(ws), before);
});
test('merge remaps colliding entry and section IDs and only skips exact career duplicates', () => {
  const current = imported(), candidate = imported(); candidate.experience[0].description += '\nAnother distinct supplied fact.';
  const merged = mergeReviewedDocument(current, candidate, { idPrefix: 'distinct' });
  assert.equal(merged.experience.length, 2); assert.notEqual(merged.experience[0].id, merged.experience[1].id);
  assert.equal(merged.skills.length, 1); assert.equal(merged.customSections.length, 1);
  assert.equal(merged.hiddenSections.length, 1);
});
test('section replacement and explicit profile clearing only affect the separate copy', () => {
  const current = imported(), candidate = createDocument();
  const merged = mergeReviewedDocument(current, candidate, { profileFields: ['email'], sectionModes: { experience: 'replace', skills: 'keep' } });
  assert.equal(merged.profile.email, ''); assert.equal(merged.experience.length, 0); assert.equal(merged.skills.length, 1);
  assert.equal(current.profile.email, 'zoe@example.com'); assert.equal(current.experience.length, 1);
});
test('malformed options, unavailable merge targets and capacity reject atomically', () => {
  const ws = createWorkspace(sampleDocument(), 'old', 'Original'), before = JSON.stringify(ws);
  assert.throws(() => createReviewedImport(ws, imported(), { id: 'new', name: 'New', mode: 'merge', targetId: 'gone' }), /no longer/);
  assert.throws(() => mergeReviewedDocument(sampleDocument(), imported(), { profileFields: ['password'] }), /supported/);
  assert.throws(() => mergeReviewedDocument(sampleDocument(), imported(), { profileFields: ['name', 'name'] }), /once/);
  assert.throws(() => mergeReviewedDocument(sampleDocument(), imported(), { sectionModes: { experience: 'invent' } }), /add, replace or keep/);
  const full = imported(); full.skills = Array.from({ length: 60 }, (_, i) => ({ id: `s-${i}`, name: `Skill ${i}` }));
  assert.throws(() => mergeReviewedDocument(full, imported()), /at most 60/);
  assert.equal(JSON.stringify(ws), before);
});

test('case and line-break differences are distinct reviewed facts, not duplicate entries', () => {
  const current = imported(), candidate = imported();
  current.skills[0].name = 'US tax'; candidate.skills[0].name = 'us tax';
  current.experience[0].description = 'First line\nSecond line'; candidate.experience[0].description = 'First line Second line';
  const merged = mergeReviewedDocument(current, candidate);
  assert.deepEqual(merged.skills.map(item => item.name), ['US tax', 'us tax']);
  assert.deepEqual(merged.experience.map(item => item.description), ['First line\nSecond line', 'First line Second line']);
});
