import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleDocument, createDocument, validateDocument, parseDocument, serialiseDocument, addCustomSection, moveSection, removeCustomSection, plainTextDocument, keywordFeedback } from '../src/model.js';
import { createWorkspace, validateWorkspace, activeEntry, updateActiveDocument, duplicateDocument, deleteDocument, saveSnapshot, restoreSnapshot, addApplication, updateApplication, serialiseWorkspace, parseWorkspace, mergeWorkspace } from '../src/workspace.js';

test('original release v1 document migrates without losing literal or Unicode content', () => {
  const legacy = { schema: 'clearcv', version: 1, profile: { name: 'Zoë', headline: 'Engineer', email: 'zoe@example.com', phone: '', location: 'Bristol', website: '', summary: '<script>literal</script> café' }, experience: [], education: [], skills: [{ id: 'unicode-skill', name: '日本語' }], style: { template: 'studio', accent: '#a94f2e' }, jobAd: 'Engineer design' };
  const doc = parseDocument(JSON.stringify(legacy));
  for (const key of Object.keys(legacy)) assert.deepEqual(doc[key], legacy[key]);
  assert.deepEqual(doc.sectionOrder, ['profile', 'experience', 'education', 'skills']);
  assert.deepEqual(parseDocument(serialiseDocument(doc)), doc);
});
test('custom section order and visibility are validated and affect export/feedback', () => {
  let doc = addCustomSection(sampleDocument(), 'projects', 'Projects');
  doc.customSections[0].content = 'Rust compiler';
  doc = moveSection(doc, 'projects', -1);
  assert.equal(doc.sectionOrder.at(-2), 'projects');
  assert.match(plainTextDocument(doc), /Projects\nRust compiler/);
  doc.hiddenSections = ['projects', 'experience'];
  assert.doesNotMatch(plainTextDocument(doc), /Rust compiler|Northstar/);
  assert.deepEqual(keywordFeedback(doc, 'rust').found, []);
  assert.throws(() => validateDocument({ ...doc, sectionOrder: ['profile'] }), /every section/);
  assert.throws(() => validateDocument({ ...doc, photo: 'https://tracking.example/photo.png' }), /embedded/);
  assert.throws(() => validateDocument({ ...doc, layout: { ...doc.layout, fontSize: Infinity } }), /between/);
  const removed = removeCustomSection(doc, 'projects');
  assert.ok(!removed.sectionOrder.includes('projects') && !removed.hiddenSections.includes('projects'));
});
test('CV copies and snapshots remain independent and restores preserve the current CV', () => {
  const original = createWorkspace(sampleDocument());
  let ws = duplicateDocument(original, 'copy', 'Role-specific CV');
  ws = updateActiveDocument(ws, { ...activeEntry(ws).document, profile: { ...activeEntry(ws).document.profile, name: 'Changed' } });
  assert.equal(original.documents[0].document.profile.name, 'Alex Morgan');
  assert.equal(ws.documents[0].document.profile.name, 'Alex Morgan');
  ws = saveSnapshot(ws, 'snapshot', 'Before edit', '2026-10-09T12:00:00.000Z');
  ws = updateActiveDocument(ws, { ...activeEntry(ws).document, profile: { ...activeEntry(ws).document.profile, name: 'Later' } });
  ws = restoreSnapshot(ws, 'snapshot', 'recovery', '2026-10-09T12:30:00.000Z');
  assert.equal(activeEntry(ws).document.profile.name, 'Changed');
  assert.equal(activeEntry(ws).versions.at(-1).document.profile.name, 'Later');
  assert.equal(activeEntry(ws).versions[0].document.profile.name, 'Changed');
  assert.deepEqual(parseWorkspace(serialiseWorkspace(ws)), ws);
});
test('tracker links follow CV deletion and reject unsafe or impossible fields', () => {
  let ws = duplicateDocument(createWorkspace(sampleDocument()), 'copy', 'Copy');
  ws = addApplication(ws, 'job');
  ws = updateApplication(ws, 'job', 'status', 'interview');
  ws = updateApplication(ws, 'job', 'appliedDate', '2026-10-09');
  ws = updateApplication(ws, 'job', 'url', 'https://example.com/role');
  assert.equal(ws.applications[0].cvId, 'copy');
  assert.throws(() => updateApplication(ws, 'job', 'url', 'javascript:alert(1)'), /http/);
  assert.throws(() => updateApplication(ws, 'job', 'appliedDate', '2026-02-30'), /valid date/);
  assert.throws(() => updateApplication(ws, 'job', 'cvId', 'missing'), /exist/);
  assert.throws(() => updateApplication(ws, 'job', 'status', 'invented'), /status/);
  const removed = deleteDocument(ws, 'copy');
  assert.equal(removed.applications[0].cvId, '');
  assert.equal(removed.applications[0].status, 'interview');
  assert.equal(removed.activeId, 'initial-cv');
  assert.throws(() => deleteDocument(removed, 'initial-cv'), /at least one/);
});
test('workspace import merges and remaps links without overwriting master or existing IDs', () => {
  const target = createWorkspace(sampleDocument());
  let incoming = createWorkspace(createDocument());
  incoming = addApplication(incoming, 'incoming-job');
  let id = 0;
  const merged = mergeWorkspace(target, incoming, () => `import-${++id}`);
  assert.equal(merged.documents.length, 2);
  assert.equal(merged.activeId, target.activeId);
  assert.deepEqual(merged.masterProfile, target.masterProfile);
  assert.equal(merged.applications[0].cvId, 'import-1');
  assert.equal(merged.applications[0].id, 'import-2');
  assert.deepEqual(target, createWorkspace(sampleDocument()));
  assert.throws(() => validateWorkspace({ ...merged, extra: true }), /unsupported/);
  assert.throws(() => validateWorkspace({ ...merged, activeId: 'lost' }), /active CV/);
});

test('provided invalid master documents are rejected rather than silently defaulted', () => {
  const ws = createWorkspace(sampleDocument());
  for (const value of [null, false, '', []]) assert.throws(() => validateWorkspace({ ...ws, masterDocument: value }), /object/);
  const legacy = structuredClone(ws); delete legacy.masterDocument;
  assert.deepEqual(validateWorkspace(legacy).masterDocument, ws.masterDocument);
});
