import test from 'node:test';
import assert from 'node:assert/strict';
import { serialiseWorkspace } from '../src/workspace.js';
import { initialWorkspace, addNewCV } from '../src/new-cv.js';
import { persistWorkspace, WorkspaceConflictError } from '../src/storage.js';

function store(initial = null) {
  let durable = initial, writes = 0;
  return { getItem() { return durable; }, setItem(key, raw) { durable = raw; writes++; }, get writes() { return writes; } };
}

test('successful saves return the exact durable baseline for the next ordinary edit', () => {
  const first = initialWorkspace(null, null).workspace, storage = store();
  const raw = persistWorkspace(storage, 'library', first, null);
  assert.equal(raw, serialiseWorkspace(first)); assert.equal(storage.getItem(), raw);
  const next = addNewCV(first, 'new');
  const second = persistWorkspace(storage, 'library', next, raw);
  assert.equal(storage.getItem(), second); assert.equal(storage.writes, 2);
});

test('an older tab cannot replace a newer saved library, while both RAM copies remain intact', () => {
  const first = initialWorkspace(null, null).workspace, baseline = serialiseWorkspace(first), storage = store(baseline);
  const newer = addNewCV(first, 'newer'), stale = addNewCV(first, 'older-open');
  const saved = persistWorkspace(storage, 'library', newer, baseline);
  const oldRAM = serialiseWorkspace(stale);
  assert.throws(() => persistWorkspace(storage, 'library', stale, baseline), WorkspaceConflictError);
  assert.equal(storage.getItem(), saved); assert.equal(storage.writes, 1);
  assert.equal(serialiseWorkspace(stale), oldRAM);
  assert.ok(JSON.parse(oldRAM).documents.some(entry => entry.id === 'older-open'));
  assert.ok(JSON.parse(saved).documents.some(entry => entry.id === 'newer'));
});

test('external removal, empty data and malformed data are changes rather than permission to overwrite', () => {
  const first = initialWorkspace(null, null).workspace, baseline = serialiseWorkspace(first);
  for (const changed of [null, '', '{broken']) {
    const storage = store(changed);
    assert.throws(() => persistWorkspace(storage, 'library', first, baseline), WorkspaceConflictError);
    assert.equal(storage.getItem(), changed); assert.equal(storage.writes, 0);
  }
  const empty = store('');
  const raw = persistWorkspace(empty, 'library', first, '');
  assert.equal(empty.getItem(), raw, 'an explicitly protected original may be replaced only against its exact known baseline');
});

test('quota and read failures do not mutate the input or pretend a successful save', () => {
  const first = initialWorkspace(null, null).workspace, baseline = serialiseWorkspace(first), before = structuredClone(first);
  const denied = { getItem: () => baseline, setItem: () => { throw new Error('Quota denied'); } };
  assert.throws(() => persistWorkspace(denied, 'library', first, baseline), /Quota denied/);
  const unavailable = { getItem: () => { throw new Error('Storage unavailable'); }, setItem: () => assert.fail('must not write') };
  assert.throws(() => persistWorkspace(unavailable, 'library', first, baseline), /Storage unavailable/);
  assert.deepEqual(first, before);
});
