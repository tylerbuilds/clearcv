import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, sampleDocument } from '../../src/model.js';
import { createWorkspace, validateWorkspace, saveSnapshot, restoreSnapshot, addDocument, duplicateDocument, addApplication, addApplicationTask, captureApplicationSubmission, mergeWorkspace, parseWorkspace, parseImport, serialiseWorkspace, updateApplication, MAX_WORKSPACE_BYTES } from '../../src/workspace.js';
import { mergeReviewedDocument, createReviewedImport } from '../../src/import-workspace.js';
import { initialWorkspace, addNewCV } from '../../src/new-cv.js';
import { persistWorkspace, WorkspaceConflictError } from '../../src/storage.js';
import { filterApplications, applicationAnalytics, applicationsToCsv } from '../../src/tracker.js';

const blank = () => createWorkspace(createDocument());
const careers = () => {
  const doc = createDocument();
  doc.experience = [{ id: 'career', title: 'Stored career', organisation: 'Example', location: '', dates: '', description: 'A fact the user supplied.' }];
  return doc;
};

// Regression: workspace cloning previously ran accessors and erased hidden
// metadata before the stricter document/tracker validators could inspect it.
test('workspace records reject accessors without executing them', () => {
  for (const locate of [ws => [ws, 'activeId'], ws => [ws.documents[0], 'name'], ws => [ws.masterProfile, 'name'], ws => [ws.applications[0], 'company']]) {
    const ws = addApplication(blank(), 'job');
    const [record, key] = locate(ws);
    let reads = 0;
    Object.defineProperty(record, key, { enumerable: true, get() { reads++; return key === 'activeId' ? 'initial-cv' : ''; } });
    assert.throws(() => validateWorkspace(ws), /unsupported/);
    assert.equal(reads, 0, 'a rejected record cannot execute an accessor');
  }
});

test('duplication validates the workspace before reading its active document', () => {
  const ws = blank();
  let reads = 0;
  Object.defineProperty(ws.documents[0], 'document', { enumerable: true, get() { reads++; return createDocument(); } });
  assert.throws(() => duplicateDocument(ws, 'copy', 'Copy'), /unsupported/);
  assert.equal(reads, 0);
});

test('workspace rejects invisible unsupported properties instead of losing them on clone', () => {
  for (const locate of [ws => ws, ws => ws.documents[0], ws => ws.applications[0]]) {
    for (const hidden of ['symbol', 'non-enumerable']) {
      const ws = addApplication(blank(), 'job');
      const record = locate(ws);
      if (hidden === 'symbol') record[Symbol('unsupported')] = 'unexpected';
      else Object.defineProperty(record, 'unsupported', { value: true });
      assert.throws(() => validateWorkspace(ws), /unsupported/);
    }
  }
});

test('workspace list annotations and accessors are rejected before clone or iteration', () => {
  for (const locate of [ws => ws.documents, ws => ws.documents[0].versions, ws => ws.applications]) {
    const ws = addApplication(blank(), 'job');
    const list = locate(ws);
    list.extra = 'cannot be represented by a JSON backup';
    assert.throws(() => validateWorkspace(ws), /list/);
  }
  const ws = blank();
  let reads = 0;
  Object.defineProperty(ws.documents, '0', { enumerable: true, get() { reads++; return { id: 'initial-cv' }; } });
  assert.throws(() => validateWorkspace(ws), /list/);
  assert.equal(reads, 0);
});

// Regression: Date.parse normalises impossible calendar dates and 24:00.
test('snapshots reject impossible or non-canonical saved timestamps atomically', () => {
  const ws = blank(), before = serialiseWorkspace(ws);
  for (const date of ['2026-02-30T00:00:00.000Z', '1900-02-29T00:00:00.000Z', '2026-10-10T24:00:00.000Z', '2026-10-10T00:00:00Z', '2026-10-10T01:00:00.000+01:00']) {
    assert.throws(() => saveSnapshot(ws, 'bad', 'Snapshot', date), /date/);
    assert.equal(serialiseWorkspace(ws), before);
  }
  assert.equal(saveSnapshot(ws, 'leap', 'Leap day', '2000-02-29T00:00:00.000Z').documents[0].versions.length, 1);
});

// Regression: inherited sectionModes could silently remove current entries.
test('reviewed import rejects inherited modes without removing stored career facts', () => {
  const current = careers(), before = structuredClone(current);
  const sectionModes = Object.create({ experience: 'replace' });
  assert.throws(() => mergeReviewedDocument(current, createDocument(), { sectionModes }), /add, replace or keep/);
  assert.deepEqual(current, before);
});

test('reviewed import defaults cannot read inherited Object.prototype options', () => {
  const current = careers();
  const inherited = Object.getOwnPropertyDescriptor(Object.prototype, 'experience');
  try {
    Object.defineProperty(Object.prototype, 'experience', { configurable: true, value: 'replace' });
    const next = mergeReviewedDocument(current, createDocument());
    assert.deepEqual(next.experience, current.experience);
  } finally {
    if (inherited) Object.defineProperty(Object.prototype, 'experience', inherited);
    else delete Object.prototype.experience;
  }
});

test('reviewed import rejects mode getters and unsupported invisible fields without invocation', () => {
  const current = careers();
  for (const hidden of ['getter', 'symbol', 'non-enumerable']) {
    const sectionModes = {};
    let reads = 0;
    if (hidden === 'getter') Object.defineProperty(sectionModes, 'experience', { enumerable: true, get() { reads++; return 'replace'; } });
    if (hidden === 'symbol') sectionModes[Symbol('extra')] = 'replace';
    if (hidden === 'non-enumerable') Object.defineProperty(sectionModes, 'experience', { value: 'replace' });
    assert.throws(() => mergeReviewedDocument(current, createDocument(), { sectionModes }), /add, replace or keep/);
    assert.equal(reads, 0);
  }
});

test('reviewed import top-level options require plain data records', () => {
  const current = careers(), incoming = createDocument();
  const inherited = Object.create({ profileFields: ['name'] });
  assert.throws(() => mergeReviewedDocument(current, incoming, inherited), /options/);
  let reads = 0;
  const getter = {};
  Object.defineProperty(getter, 'mode', { enumerable: true, get() { reads++; return 'new'; } });
  assert.throws(() => createReviewedImport(blank(), incoming, getter), /options/);
  assert.equal(reads, 0);
});

test('profile selections require a dense bounded plain list', () => {
  const current = careers(), incoming = createDocument();
  const annotated = ['name']; annotated.extra = true;
  const symbolic = ['name']; symbolic[Symbol('extra')] = true;
  for (const profileFields of [new Array(1), annotated, symbolic, Array(100001).fill('name')]) {
    assert.throws(() => mergeReviewedDocument(current, incoming, { profileFields }), /supported profile field once/);
  }
});

test('workspace parser rejects corruption, truncation, appended bytes and wrong top-level types', () => {
  const valid = serialiseWorkspace(blank());
  for (const raw of [valid.slice(0, -1), `${valid}\u0000`, `${valid}{}`, 'null', '[]', 'true', '{"schema":"clearcv.workspace"}', 'SQL SELECT * FROM users', '\uFEFF' + valid]) {
    assert.throws(() => parseWorkspace(raw), Error);
  }
  assert.deepEqual(parseWorkspace(valid), blank());
});

test('oversized raw imports fail before schema parsing and preserve supplied inputs', () => {
  for (const raw of ['x'.repeat(MAX_WORKSPACE_BYTES + 1), `{"note":"${'日本語'.repeat(500000)}"}`]) {
    assert.throws(() => parseImport(raw), /smaller than 4 MB/);
  }
  for (const raw of [null, undefined, NaN, Infinity, new Uint8Array(20)]) assert.throws(() => parseImport(raw), /smaller than 4 MB/);
});

test('huge application lists reject before invoking nested application getters', () => {
  const ws = blank();
  let reads = 0;
  const entry = { get company() { reads++; return 'must not be touched'; } };
  ws.applications = Array(100001).fill(entry);
  assert.throws(() => validateWorkspace(ws), /150/);
  assert.equal(reads, 0);
});

test('deep unknown structures fail the schema without recursion or state writes', () => {
  const ws = blank();
  let nested = {};
  for (let index = 0; index < 150; index++) nested = { next: nested };
  ws.extra = nested;
  assert.throws(() => validateWorkspace(ws), /unsupported/);
  ws.extra = ws;
  assert.throws(() => validateWorkspace(ws), /unsupported/);
});

test('workspace document, application and snapshot IDs remain unique with atomic failure', () => {
  let ws = addApplication(blank(), 'job');
  ws = saveSnapshot(ws, 'snapshot', 'Checkpoint', '2026-10-10T00:00:00.000Z');
  const before = serialiseWorkspace(ws);
  for (const action of [() => addDocument(ws, createDocument(), 'initial-cv', 'Duplicate'), () => addApplication(ws, 'job'), () => saveSnapshot(ws, 'snapshot', 'Again'), () => restoreSnapshot(ws, 'snapshot', 'snapshot')]) assert.throws(action, /Duplicate/);
  assert.equal(serialiseWorkspace(ws), before);
});

test('failed merge ID generation cannot overwrite the source or linked tracker entries', () => {
  const target = addApplication(blank(), 'job'), incoming = addDocument(addApplication(blank(), 'incoming'), createDocument(), 'second-incoming', 'Second incoming');
  const before = serialiseWorkspace(target), other = serialiseWorkspace(incoming);
  for (const makeId of [() => 'initial-cv', () => 'same', () => '../../../etc/passwd', () => null]) assert.throws(() => mergeWorkspace(target, incoming, makeId), Error);
  assert.equal(serialiseWorkspace(target), before);
  assert.equal(serialiseWorkspace(incoming), other);
});

test('restoring out-of-order timestamps preserves actual current data and does not depend on monotonic clocks', () => {
  let ws = createWorkspace(careers());
  ws = saveSnapshot(ws, 'later-clock', 'Earlier content', '2026-10-10T23:00:00.000Z');
  ws.documents[0].document.profile.name = 'Current unsent changes';
  const restored = restoreSnapshot(ws, 'later-clock', 'recovery', '1970-01-01T00:00:00.000Z');
  assert.equal(restored.documents[0].document.profile.name, '');
  assert.equal(restored.documents[0].versions.at(-1).document.profile.name, 'Current unsent changes');
  assert.equal(ws.documents[0].document.profile.name, 'Current unsent changes');
});

test('the tenth snapshot is allowed and restore capacity fails without losing edits', () => {
  let ws = blank();
  for (let index = 0; index < 10; index++) ws = saveSnapshot(ws, `s-${index}`, `Snapshot ${index}`, '1970-01-01T00:00:00.000Z');
  ws.documents[0].document.profile.name = 'Current';
  const before = serialiseWorkspace(ws);
  assert.throws(() => restoreSnapshot(ws, 's-0', 'overflow'), /Remove a snapshot/);
  assert.throws(() => saveSnapshot(ws, 'overflow', 'Overflow'), /at most 10/);
  assert.equal(serialiseWorkspace(ws), before);
});

test('literal injection strings survive backup round-trip without changing IDs or structure', () => {
  const payload = '<script>alert(1)</script>\n---\n$(echo injected)\n../../etc/passwd\n\u0000\u202E日本語';
  let ws = addApplication(blank(), 'job');
  ws = updateApplication(ws, 'job', 'notes', payload);
  ws.documents[0].document.profile.summary = payload;
  const parsed = parseWorkspace(serialiseWorkspace(ws));
  assert.equal(parsed.applications[0].notes, payload);
  assert.equal(parsed.documents[0].document.profile.summary, payload);
  assert.deepEqual(Object.keys(parsed), Object.keys(ws));
});

test('type-confused tracker values fail without changing snapshots or source documents', () => {
  const ws = addApplication(blank(), 'job'), before = serialiseWorkspace(ws);
  for (const [field, value] of [['company', 0], ['status', NaN], ['archived', 'false'], ['cvId', {}], ['followUpDate', false], ['notes', ['text']]]) assert.throws(() => updateApplication(ws, 'job', field, value), Error);
  assert.equal(serialiseWorkspace(ws), before);
});

test('tracker exported cells contain literal spreadsheet formulas and quotes as one neutralised field', () => {
  let ws = addApplication(blank(), 'job');
  ws = updateApplication(ws, 'job', 'company', '\u202E =HYPERLINK("https://example.invalid","x,y")');
  const csv = applicationsToCsv(ws.applications);
  assert.ok(csv.includes('"\'\u202E =HYPERLINK(""https://example.invalid"",""x,y"")"'));
  assert.equal(csv.split('\r\n').length, 3);
});

test('tracker due filters and analytics distinguish epoch leap day and future tasks', () => {
  let ws = addApplication(blank(), 'job');
  ws = updateApplication(ws, 'job', 'appliedDate', '1970-01-01');
  ws = updateApplication(ws, 'job', 'followUpDate', '2000-02-29');
  assert.equal(filterApplications(ws.applications, { followUp: 'due', today: '2000-02-28' }).length, 0);
  assert.equal(filterApplications(ws.applications, { followUp: 'due', today: '2000-02-29' }).length, 1);
  const stats = applicationAnalytics(ws.applications, { today: '1970-01-01' });
  assert.equal(stats.last7DaysApplied, 1);
  assert.equal(stats.followUps.upcoming, 1);
});

test('sequential interleaved tabs refuse stale write and allow an explicit reload before retry', () => {
  const ws = blank(); let raw = serialiseWorkspace(ws), writes = 0;
  const storage = { getItem: () => raw, setItem(key, next) { raw = next; writes++; } };
  const baseline = raw;
  const newer = addNewCV(ws, 'newer');
  persistWorkspace(storage, 'fake-library', newer, baseline);
  assert.throws(() => persistWorkspace(storage, 'fake-library', addNewCV(ws, 'stale'), baseline), WorkspaceConflictError);
  assert.equal(writes, 1);
  const reloaded = parseWorkspace(raw), reloadedRaw = raw;
  persistWorkspace(storage, 'fake-library', addNewCV(reloaded, 'after-reload'), reloadedRaw);
  assert.equal(writes, 2);
  assert.equal(parseWorkspace(raw).documents.length, 3);
});

test('storage refusal and invalid source state never perform a mock durable write', () => {
  const ws = blank(); let writes = 0;
  const store = { getItem: () => null, setItem() { writes++; throw new Error('Mock quota exhausted'); } };
  const before = serialiseWorkspace(ws);
  assert.throws(() => persistWorkspace(store, 'fake-library', ws, null), /Mock quota exhausted/);
  assert.equal(writes, 1);
  assert.equal(serialiseWorkspace(ws), before);
  ws.activeId = 'missing';
  assert.throws(() => persistWorkspace(store, 'fake-library', ws, null), /active CV/);
  assert.equal(writes, 1);
});

test('corrupted saved state never silently migrates or replaces a retained legacy CV', () => {
  const legacy = JSON.stringify(sampleDocument());
  for (const saved of ['', '{broken', 'null', '[]']) assert.throws(() => initialWorkspace(saved, legacy), Error);
  assert.equal(initialWorkspace(null, legacy).workspace.documents[0].document.profile.name, 'Alex Morgan');
  assert.equal(initialWorkspace(null, null).workspace.documents[0].document.profile.name, '');
});

test('reviewed imports keep hidden original evidence and reject disappearance of target IDs', () => {
  const source = careers(), incoming = createDocument();
  incoming.customSections = [{ id: 'source', title: 'Imported source', content: 'Supplied hidden source\u0000' }];
  incoming.sectionOrder.push('source'); incoming.hiddenSections.push('source');
  const ws = createWorkspace(source), before = serialiseWorkspace(ws);
  assert.throws(() => createReviewedImport(ws, incoming, { id: 'new', name: 'New', mode: 'merge', targetId: 'deleted' }), /no longer/);
  const merged = createReviewedImport(ws, incoming, { id: 'new', name: 'New', mode: 'merge', targetId: 'initial-cv' });
  assert.equal(merged.documents.at(-1).document.customSections[0].content, incoming.customSections[0].content);
  assert.equal(merged.documents.at(-1).document.hiddenSections.length, 1);
  assert.equal(serialiseWorkspace(ws), before);
});

test('submitted copies retain their frozen content through later original edits and repeated independent reads', () => {
  let ws = addApplication(createWorkspace(careers()), 'job');
  ws = addApplicationTask(ws, 'job', 'task');
  ws = captureApplicationSubmission(ws, 'job', 'sent', 'Submitted', '1970-01-01T00:00:00.000Z');
  const source = structuredClone(ws.applications[0].submissions[0].document);
  ws.documents[0].document.experience[0].description = 'Edited later';
  const validated = validateWorkspace(ws);
  validated.applications[0].submissions[0].document.experience[0].description = 'Caller mutation';
  assert.deepEqual(ws.applications[0].submissions[0].document, source);
});
