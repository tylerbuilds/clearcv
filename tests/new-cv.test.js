import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, sampleDocument, serialiseDocument } from '../src/model.js';
import { createWorkspace, addDocument, validateWorkspace, MAX_WORKSPACE_BYTES, addApplication, saveSnapshot, captureApplicationSubmission, addApplicationTask, addApplicationCustomField, updateApplicationTask, updateApplicationCustomField, serialiseWorkspace } from '../src/workspace.js';
import { initialWorkspace, isBlankCV, isFirstBlankWorkspace, addNewCV } from '../src/new-cv.js';

test('fresh storage starts a genuinely blank CV and master rather than saving example facts', () => {
  const { workspace, migrated } = initialWorkspace(null, null);
  assert.equal(migrated, false);
  assert.equal(workspace.documents.length, 1);
  assert.deepEqual(workspace.documents[0].document, createDocument());
  assert.deepEqual(workspace.masterDocument, createDocument());
  assert.equal(workspace.documents[0].name, 'Untitled CV');
  assert.ok(isFirstBlankWorkspace(workspace));
  assert.doesNotMatch(serialiseWorkspace(workspace), /Alex Morgan|Northstar|Fieldwork/);
});

test('existing saved and legacy CVs are loaded unchanged and present malformed values never count as fresh', () => {
  const existing = createWorkspace(sampleDocument(), 'original', 'Existing');
  assert.deepEqual(initialWorkspace(serialiseWorkspace(existing), null).workspace, existing);
  const legacy = initialWorkspace(null, serialiseDocument(sampleDocument()));
  assert.equal(legacy.migrated, true);
  assert.deepEqual(legacy.workspace.documents[0].document, sampleDocument());
  assert.throws(() => initialWorkspace('', null));
  assert.throws(() => initialWorkspace(null, ''));
  assert.throws(() => initialWorkspace('{bad json', serialiseDocument(sampleDocument())));
});

test('independent blank creation keeps every old document, version, letter, master and tracked attachment untouched', () => {
  const doc = sampleDocument(); doc.coverLetter.body = 'Supplied letter £30.'; doc.jobAd = 'Literal role context.';
  doc.customSections = [{ id: 'source', title: 'Source', content: 'Hidden original source.' }]; doc.sectionOrder.push('source'); doc.hiddenSections.push('source');
  let workspace = createWorkspace(doc, 'old', 'Original');
  workspace = saveSnapshot(workspace, 'version', 'Before edit', '2026-10-10T00:00:00.000Z');
  workspace = addApplication(workspace, 'job');
  workspace = addApplicationTask(workspace, 'job', 'task');
  workspace = updateApplicationTask(workspace, 'job', 'task', 'title', 'Follow up with recruiter');
  workspace = addApplicationCustomField(workspace, 'job', 'custom');
  workspace = updateApplicationCustomField(workspace, 'job', 'custom', 'value', 'Private note');
  workspace = captureApplicationSubmission(workspace, 'job', 'sent', 'Submitted', '2026-10-10T00:00:00.000Z');
  const before = structuredClone(workspace), next = addNewCV(workspace, 'blank');
  assert.deepEqual(workspace, before);
  assert.deepEqual(next.documents.slice(0, -1), before.documents);
  assert.deepEqual(next.masterDocument, before.masterDocument);
  assert.deepEqual(next.masterProfile, before.masterProfile);
  assert.deepEqual(next.applications, before.applications);
  assert.equal(next.activeId, 'blank');
  assert.deepEqual(next.documents.at(-1).document, createDocument());
  assert.equal(next.documents.at(-1).versions.length, 0);
  assert.ok(isBlankCV(next.documents.at(-1).document));
  next.documents.at(-1).document.profile.name = 'New author';
  assert.deepEqual(workspace, before);
});

test('example creation is explicit, additive and leaves a blank master intact', () => {
  const first = initialWorkspace(null, null).workspace, next = addNewCV(first, 'example', 'example');
  assert.deepEqual(next.documents[0], first.documents[0]);
  assert.deepEqual(next.masterDocument, createDocument());
  assert.deepEqual(next.documents[1].document, sampleDocument());
  assert.equal(next.activeId, 'example');
  assert.equal(isFirstBlankWorkspace(next), false);
});

test('new CV names distinguish repeated creations and input validation rejects atomically at capacity', () => {
  let workspace = initialWorkspace(null, null).workspace;
  workspace = addNewCV(workspace, 'second'); assert.equal(workspace.documents.at(-1).name, 'Untitled CV 2');
  workspace = addNewCV(workspace, 'third'); assert.equal(workspace.documents.at(-1).name, 'Untitled CV 3');
  const validBefore = serialiseWorkspace(workspace);
  assert.throws(() => addNewCV(workspace, 'bad id'), /Invalid workspace entry ID/);
  assert.throws(() => addNewCV(workspace, 'initial-cv'), /Duplicate CV library ID/);
  assert.throws(() => addNewCV(workspace, 'new', 'invented'), /Choose a blank CV or an example/);
  assert.equal(serialiseWorkspace(workspace), validBefore);
  for (let count = workspace.documents.length; count < 25; count++) workspace = addNewCV(workspace, `cv-${count}`);
  const before = serialiseWorkspace(workspace);
  assert.throws(() => addNewCV(workspace, 'overflow'), /between 1 and 25/);
  assert.equal(serialiseWorkspace(workspace), before);
});

test('welcome eligibility does not mistake stored career, letter or history for a fresh empty workspace', () => {
  const first = initialWorkspace(null, null).workspace;
  for (const change of [ws => { ws.documents[0].document.profile.name = 'Author'; }, ws => { ws.masterDocument.profile.summary = 'Career history'; }, ws => { ws.documents[0].document.coverLetter.body = 'Existing letter'; }, ws => { ws.documents[0].document.coverLetter.salutation = 'Dear Ruth,'; }, ws => { ws.documents[0].document.coverLetter.closing = 'Yours sincerely,'; }, ws => { ws.documents[0].document.skills.push({ id: 'empty-skill', name: '' }); }]) {
    const next = structuredClone(first); change(next); assert.equal(isFirstBlankWorkspace(next), false);
  }
  const snapshot = saveSnapshot(first, 'checkpoint', 'Blank checkpoint', '2026-10-10T00:00:00.000Z');
  assert.equal(isFirstBlankWorkspace(snapshot), false);
});


test('new CV rejects the shared byte limit without altering old entries or their active selection', () => {
  const first = initialWorkspace(null, null).workspace;
  const large = createDocument();
  large.customSections = Array.from({ length: 20 }, (_, index) => ({ id: `source-${index}`, title: 'Retained source', content: 'x'.repeat(27000) }));
  large.sectionOrder.push(...large.customSections.map(section => section.id));
  let workspace = first;
  for (let index = 0; index < 7; index++) workspace = addDocument(workspace, large, `large-${index}`, 'Retained CV');
  const candidate = structuredClone(workspace);
  const bytes = new TextEncoder().encode(serialiseWorkspace(candidate)).length;
  const remaining = MAX_WORKSPACE_BYTES - bytes;
  // Fill existing sections up to the byte boundary, without approaching their schema limit.
  let needed = remaining;
  for (const section of candidate.documents.flatMap(entry => entry.document.customSections)) {
    const extra = Math.min(needed, 30000 - section.content.length);
    section.content += 'x'.repeat(extra); needed -= extra;
  }
  assert.equal(needed, 0, 'fixture reaches the workspace byte boundary');
  workspace = validateWorkspace(candidate);
  assert.equal(new TextEncoder().encode(serialiseWorkspace(workspace)).length, MAX_WORKSPACE_BYTES);
  const before = serialiseWorkspace(workspace);
  assert.throws(() => addNewCV(workspace, 'another-blank'), /over 4 MB/);
  assert.equal(serialiseWorkspace(workspace), before);
  assert.equal(workspace.activeId, candidate.activeId);
});
