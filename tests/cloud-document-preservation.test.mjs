import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceHandler } from '../scripts/workspace-backend.mjs';
import { createDocument, validateDocument, MAX_DOCUMENT_BYTES } from '../src/model.js';
import { createWorkspace, addDocument, activeEntry, updateActiveDocument, addApplication, updateApplication, addApplicationTask, updateApplicationTask, addApplicationCustomField, updateApplicationCustomField, captureApplicationSubmission, serialiseWorkspace, parseWorkspace } from '../src/workspace.js';

async function service(t) {
  const directory = await mkdtemp(join(tmpdir(), 'clearcv-private-scope-'));
  const handler = await createWorkspaceHandler({ dataDirectory: directory, validators: { clearcv: validateDocument, 'stencil-studio': () => { throw new Error('Another app.'); } } });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await handler.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (route, { token, method = 'GET', body } = {}) => {
    const response = await fetch(`${origin}/api/workspaces${route}`, { method, headers: {
      ...(token ? { 'X-Workspace-Token': token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Workspace-Client': '1', Origin: origin })
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, payload: await response.json() };
  };
  return { directory, request };
}

function privateWorkspace() {
  const master = createDocument(); master.profile.name = 'PRIVATE_MASTER_PROFILE';
  let workspace = createWorkspace(master, 'private-master', 'Master');
  const active = createDocument(); active.profile.name = 'Shared CV'; active.profile.summary = 'PRIVATE_SUBMISSION_CONTENT';
  active.coverLetter.body = 'A shared cover letter'; active.jobAd = 'A deliberately shared job description';
  workspace = addDocument(workspace, active, 'shared-active', 'Active CV');
  workspace = addApplication(workspace, 'private-job');
  workspace = updateApplication(workspace, 'private-job', 'notes', 'PRIVATE_JOB_TRACKER_NOTE');
  workspace = addApplicationTask(workspace, 'private-job', 'private-task');
  workspace = updateApplicationTask(workspace, 'private-job', 'private-task', 'title', 'PRIVATE_TASK_TITLE');
  workspace = addApplicationCustomField(workspace, 'private-job', 'private-custom');
  workspace = updateApplicationCustomField(workspace, 'private-job', 'private-custom', 'value', 'PRIVATE_CUSTOM_FIELD_VALUE');
  workspace = captureApplicationSubmission(workspace, 'private-job', 'private-submission', 'PRIVATE_SUBMISSION_LABEL', '2026-10-10T12:00:00.000Z');
  workspace = updateApplication(workspace, 'private-job', 'archived', true);
  const shared = structuredClone(activeEntry(workspace).document); shared.profile.summary = 'A deliberately shared current summary';
  return updateActiveDocument(workspace, shared);
}

test('sharing the active CV retains its complete document while new tracker fields and submitted copies stay private', async t => {
  const f = await service(t), workspace = privateWorkspace(), before = serialiseWorkspace(workspace);
  assert.deepEqual(parseWorkspace(before), workspace);
  const active = validateDocument(activeEntry(workspace).document);
  const created = await f.request('', { method: 'POST', body: { kind: 'clearcv', title: 'Shared active CV', document: active } });
  assert.equal(created.status, 201); assert.deepEqual(created.payload.workspace.document, active);
  const id = created.payload.workspace.id, token = created.payload.tokens.view;
  const viewer = await f.request(`/${id}`, { token });
  assert.equal(viewer.status, 200); assert.deepEqual(viewer.payload.workspace.document, active);
  assert.equal(viewer.payload.workspace.document.coverLetter.body, 'A shared cover letter');
  assert.equal(viewer.payload.workspace.document.jobAd, 'A deliberately shared job description');
  const durable = await readFile(join(f.directory, `${id}.json`), 'utf8');
  for (const privateText of ['PRIVATE_MASTER_PROFILE', 'PRIVATE_JOB_TRACKER_NOTE', 'PRIVATE_TASK_TITLE', 'PRIVATE_CUSTOM_FIELD_VALUE', 'PRIVATE_SUBMISSION_LABEL', 'PRIVATE_SUBMISSION_CONTENT']) {
    assert.equal(durable.includes(privateText), false);
    assert.ok(before.includes(privateText));
  }
  assert.equal(serialiseWorkspace(workspace), before);
  assert.equal(MAX_DOCUMENT_BYTES, 1_000_000);
});

test('whole workspace or tracker-contaminated CV writes fail without changing the existing shared document', async t => {
  const f = await service(t), workspace = privateWorkspace(), active = validateDocument(activeEntry(workspace).document);
  const created = await f.request('', { method: 'POST', body: { kind: 'clearcv', document: active } });
  assert.equal(created.status, 201);
  const id = created.payload.workspace.id, token = created.payload.tokens.owner, record = join(f.directory, `${id}.json`), before = await readFile(record, 'utf8');
  const invalidDocuments = [workspace, ...['applications', 'archived', 'tasks', 'customFields', 'submissions', 'masterDocument', 'documents', 'versions'].map(field => ({ ...structuredClone(active), [field]: field === 'archived' ? true : workspace.applications }))];
  const nested = structuredClone(active); nested.profile.tasks = workspace.applications[0].tasks; invalidDocuments.push(nested);
  for (const document of invalidDocuments) {
    const rejected = await f.request(`/${id}`, { method: 'PUT', token, body: { baseRevision: 1, document } });
    assert.equal(rejected.status, 400); assert.equal(rejected.payload.error.code, 'invalid_document');
    assert.equal(await readFile(record, 'utf8'), before);
  }
  const read = await f.request(`/${id}`, { token });
  assert.equal(read.payload.workspace.revision, 1); assert.deepEqual(read.payload.workspace.document, active);
});
