import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWriting, getAiStatus } from '../../src/ai-client.js';
import { checkText } from '../../src/spellcheck.js';
import { createCloudClient, readShareLink, shareLink } from '../../src/cloud-client.mjs';
import { createCloudUI } from '../../src/cloud-ui.js';
import { createDocumentImportUI } from '../../src/import-ui.js';
import { createDocument } from '../../src/model.js';
import { createWorkspace, serialiseWorkspace } from '../../src/workspace.js';

const id = 'a46ba2c3-b437-4d11-81be-e5080d555609', token = 'A'.repeat(43);
const link = `https://cv.example/#workspace=${id}&token=${token}`;
const writingRequest = { task: 'summary', content: 'Fictitious supplied experience.', context: '' };
const savedFetch = new WeakMap(), savedWorkers = new WeakMap();
async function withFetch(t, callback) {
  if (!savedFetch.has(t)) {
    const previous = globalThis.fetch; savedFetch.set(t, previous);
    t.after(() => { globalThis.fetch = previous; savedFetch.delete(t); });
  }
  globalThis.fetch = callback;
}

test('AI text requests prevent redirects, ambient credentials and referrer leakage', async t => {
  // Regression: default browser fetch could forward private source through a redirect.
  await withFetch(t, async (url, options) => {
    assert.equal(url, './api/ai'); assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.cache, 'no-store'); assert.deepEqual(JSON.parse(options.body), writingRequest);
    return new Response(JSON.stringify({ text: 'A checked candidate.', model: 'test' }));
  });
  assert.deepEqual(await generateWriting(writingRequest), { text: 'A checked candidate.', model: 'test' });
});

test('AI client rejects malformed service bodies with a useful error, without accepting empty text', async t => {
  for (const value of [null, [], 1, true, 'wrong', { text: null }, { text: '' }, { text: '   ' }]) {
    await withFetch(t, async () => new Response(JSON.stringify(value)));
    await assert.rejects(generateWriting(writingRequest), /AI service.*text|AI service.*respond/);
  }
});

test('AI client rejects oversized text and response bodies before exposing a candidate', async t => {
  await withFetch(t, async () => new Response(JSON.stringify({ text: 'x'.repeat(24_001) })));
  await assert.rejects(generateWriting(writingRequest), /AI service.*text|AI service.*large/);
  let cancelled = false;
  await withFetch(t, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(128_001)); setTimeout(() => { if (!cancelled) controller.close(); }, 20); },
    cancel() { cancelled = true; }
  })));
  await assert.rejects(generateWriting(writingRequest), /AI service.*large/);
  assert.equal(cancelled, true);
});

test('AI errors ignore object-shaped error messages and preserve plain text candidates inertly', async t => {
  await withFetch(t, async () => new Response(JSON.stringify({ error: { private: 'not a message' } }), { status: 502 }));
  await assert.rejects(generateWriting(writingRequest), /AI service.*text/);
  const text = '<script>window.pwned=true</script>\n£42,000 and Zoë';
  await withFetch(t, async () => new Response(JSON.stringify({ text, model: { object: true } })));
  assert.deepEqual(await generateWriting(writingRequest), { text });
});

test('AI client cancels invalid-encoding streams and treats non-JSON content as a connection error', async t => {
  let cancelled = false;
  await withFetch(t, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Uint8Array.of(0xff)); setTimeout(() => { if (!cancelled) controller.close(); }, 20); },
    cancel() { cancelled = true; }
  })));
  await assert.rejects(generateWriting(writingRequest), /AI service.*respond/);
  assert.equal(cancelled, true);
  await withFetch(t, async () => new Response('<html>Server unavailable</html>', { status: 503 }));
  await assert.rejects(generateWriting(writingRequest), /AI service.*respond/);
});

test('AI aborts do not become a suggestion and disabled status remains fail closed', async t => {
  const controller = new AbortController(); controller.abort();
  await withFetch(t, async (_url, { signal }) => { assert.equal(signal.aborted, true); throw new DOMException('Cancelled', 'AbortError'); });
  await assert.rejects(generateWriting(writingRequest, { signal: controller.signal }), error => error.name === 'AbortError');
  for (const value of [null, [], { enabled: 'true' }, { enabled: false }]) {
    await withFetch(t, async () => new Response(JSON.stringify(value)));
    assert.deepEqual(await getAiStatus(), { enabled: false });
  }
});

test('non-HTTP share links, duplicate capability fields and malformed identifiers are rejected before fetch', () => {
  for (const protocol of ['javascript:', 'data:', 'file:', 'ftp:']) assert.equal(readShareLink(`${protocol}//cv.example/#workspace=${id}&token=${token}`), null);
  assert.equal(readShareLink(`${link}&token=${token}`), null);
  assert.equal(readShareLink(link.replace(id, '../../../etc/passwd')), null);
  assert.equal(readShareLink(link.replace(token, 'A'.repeat(100_000))), null);
  assert.deepEqual(readShareLink(link), { id, token });
  assert.equal(new URL(shareLink({ id, token, baseURL: 'https://cv.example/' })).hash.slice(1), new URL(link).hash.slice(1));
});

test('cloud success cannot return corrupt primitive JSON and remains same-origin with capability only in its header', async () => {
  for (const payload of [null, [], false, 'corrupt']) {
    const client = createCloudClient({ fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      assert.equal(options.headers['X-Workspace-Token'], token);
      return new Response(JSON.stringify(payload));
    } });
    await assert.rejects(client.open({ id, token }), error => error.code === 'invalid_response');
  }
  let calls = 0;
  const client = createCloudClient({ fetchImpl: async url => { calls++; assert.equal(url.includes(token), false); return new Response('{}'); } });
  assert.throws(() => client.open({ id: '../../../etc/passwd', token }), /invalid/);
  assert.equal(calls, 0);
});

test('cloud polling ignores an in-flight response after stop and a pre-aborted watch never reads', async () => {
  let finish, calls = 0, changes = 0;
  const client = createCloudClient({ fetchImpl: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const stop = client.watch({ id, token, revision: 1, onChange: () => { changes++; } });
  assert.equal(calls, 1); stop(); finish(new Response(JSON.stringify({ workspace: { revision: 2 } })));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(changes, 0);
  const controller = new AbortController(); controller.abort();
  client.watch({ id, token, revision: 1, signal: controller.signal, onChange: () => { changes++; } });
  assert.equal(calls, 1);
});

test('cloud readers reject and cancel oversized response streams before parsing', async () => {
  let cancelled = false;
  const client = createCloudClient({ fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(42 * 1024 * 1024 + 1)); setTimeout(() => { if (!cancelled) controller.close(); }, 20); },
    cancel() { cancelled = true; }
  })) });
  await assert.rejects(client.open({ id, token }), error => error.code === 'response_too_large');
  assert.equal(cancelled, true);
});

test('cloud byte budgets still allow the shared server full-history contract', async () => {
  const text = 'x'.repeat(24 * 1024 * 1024);
  const client = createCloudClient({ fetchImpl: async () => new Response(JSON.stringify({ revisions: [{ revision: 1, document: { text } }] })) });
  const result = await client.revisions({ id, token });
  assert.equal(result.revisions[0].document.text, text);
});

test('the cloud client own 15-second deadline cancels a stalled body and reports a retryable error', async t => {
  const previous = AbortSignal.timeout; let cancelled = false, deadline;
  AbortSignal.timeout = milliseconds => {
    deadline = milliseconds; const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Synthetic deadline', 'TimeoutError')), 10);
    return controller.signal;
  };
  t.after(() => { AbortSignal.timeout = previous; });
  const client = createCloudClient({ fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
  await assert.rejects(client.open({ id, token }), error => error.status === 408 && error.code === 'request_timeout');
  assert.equal(deadline, 15_000); assert.equal(cancelled, true);
});

test('cloud cancellation settles even when a stalled response body ignores fetch signals', async () => {
  let cancelled = false, bodyController, requestSignal;
  const controller = new AbortController();
  const client = createCloudClient({ fetchImpl: async (_url, options) => {
    requestSignal = options.signal;
    return new Response(new ReadableStream({ start(value) { bodyController = value; }, cancel() { cancelled = true; } }));
  } });
  const pending = client.open({ id, token, signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  const outcome = await Promise.race([pending.then(() => ({ name: 'UnexpectedSuccess' }), error => error), new Promise(resolve => setTimeout(() => resolve({ name: 'StillPending' }), 80))]);
  try { assert.equal(outcome.name, 'AbortError'); }
  finally { if (!cancelled) bodyController.close(); }
  assert.notEqual(requestSignal, controller.signal);
  assert.equal(cancelled, true);
});

for (const cleanup of ['never-settles', 'rejects']) {
  for (const scenario of [
    { name: 'AI oversized', client: 'ai', chunk: () => new Uint8Array(128_001), message: /AI service response is too large/ },
    { name: 'AI invalid UTF-8', client: 'ai', chunk: () => Uint8Array.of(0xff), message: /AI service.*respond/ },
    { name: 'sharing oversized', client: 'cloud', chunk: () => new Uint8Array(42 * 1024 * 1024 + 1), code: 'response_too_large' },
    { name: 'sharing invalid UTF-8', client: 'cloud', chunk: () => Uint8Array.of(0xff), code: 'invalid_response' }
  ]) {
    test(`response rejection settles: ${scenario.name} when cancellation ${cleanup}`, async t => {
      // Regression: awaiting an underlying source's faulty cancellation
      // stranded rejection. Native fetch normally cancels promptly; this
      // generated Response exercises the reader's independent cleanup contract.
      let cancellations = 0;
      const response = new Response(new ReadableStream({
        start(controller) { controller.enqueue(scenario.chunk()); },
        cancel() { cancellations++; return cleanup === 'never-settles' ? new Promise(() => {}) : Promise.reject(new Error('Synthetic cleanup failed')); }
      }));
      let request;
      if (scenario.client === 'ai') {
        await withFetch(t, async () => response); request = generateWriting(writingRequest);
      } else request = createCloudClient({ fetchImpl: async () => response }).open({ id, token });
      let timer;
      const deadline = new Promise(resolve => { timer = setTimeout(() => resolve({ pending: true }), 250); });
      const outcome = await Promise.race([request.then(() => ({ unexpectedSuccess: true }), error => ({ error })), deadline]);
      clearTimeout(timer);
      assert.ok(outcome.error, `rejection must settle independently of cancellation: ${JSON.stringify(outcome)}`);
      if (scenario.message) assert.match(outcome.error.message, scenario.message);
      if (scenario.code) assert.equal(outcome.error.code, scenario.code);
      assert.equal(cancellations, 1); assert.equal(response.body.locked, false);
    });
  }
}

test('a pasted capability for another server is rejected without forwarding its bearer token', async t => {
  const previousLocation = globalThis.location; globalThis.location = new URL('https://cv.example/');
  t.after(() => { if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation; });
  const calls = [], notices = [];
  await withFetch(t, async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.endsWith('/status') ? { enabled: true } : { error: { message: 'Unknown shared CV' } }), { status: url.endsWith('/status') ? 200 : 404 });
  });
  const element = (tag, options = {}, children = []) => ({ tag, ...options, children, append(...nodes) { this.children.push(...nodes); } });
  let linkInput;
  const field = () => { linkInput = { addEventListener(_kind, callback) { this.input = callback; } }; return { querySelector: () => linkInput }; };
  const ui = createCloudUI({ element, field, sectionTitle: () => element('h2'), notify: message => notices.push(message), rerender() {}, getLocalId: () => 'local' });
  await ui.initialise(); const container = element('section'); ui.render(container);
  linkInput.input({ target: { value: link.replace('cv.example', 'other-server.example') } });
  await container.children.find(node => node.id === 'cloud-open').onClick();
  assert.equal(calls.length, 1, 'only the already-configured status request is allowed');
  assert.match(notices.at(-1), /another server/);
});

async function mockWorker(t, produce) {
  if (!savedWorkers.has(t)) {
    const previous = globalThis.Worker; savedWorkers.set(t, previous);
    t.after(() => { globalThis.Worker = previous; savedWorkers.delete(t); });
  }
  let worker;
  class FixtureWorker {
    constructor() { worker = this; this.terminated = false; this.handlerError = null; }
    terminate() { this.terminated = true; }
    postMessage() { produce(this); }
  }
  globalThis.Worker = FixtureWorker;
  return () => worker;
}
function sendResult(worker, data) {
  queueMicrotask(() => {
    try { worker.onmessage({ data }); }
    catch (error) { worker.handlerError = error; worker.onerror(); }
  });
}

test('malformed spelling rows cannot throw from the message handler or leave the worker running', async t => {
  // Regression: null issues crashed the handler and stranded a spelling check.
  const get = await mockWorker(t, worker => sendResult(worker, { checkedWords: 1, limitReached: false, issues: [null] }));
  await assert.rejects(checkText('experiance'), /invalid result|no longer matches/);
  assert.equal(get().handlerError, null); assert.equal(get().terminated, true);
});

test('spelling rejects non-finite counters, empty offsets and unbounded suggestions', async t => {
  for (const result of [
    { checkedWords: NaN, limitReached: false, issues: [] },
    { checkedWords: Infinity, limitReached: false, issues: [] },
    { checkedWords: -1, limitReached: false, issues: [] },
    { checkedWords: 4001, limitReached: false, issues: [] },
    { checkedWords: 1, limitReached: 'false', issues: [] },
    { checkedWords: 1, limitReached: false, issues: [{ word: '', start: 0, end: 0, suggestions: [] }] },
    { checkedWords: 1, limitReached: false, issues: [{ word: 'experiance', start: 0, end: 10, suggestions: Array(100_000).fill('experience') }] }
  ]) {
    const get = await mockWorker(t, worker => sendResult(worker, result));
    await assert.rejects(checkText('experiance'), /invalid result|no longer matches/);
    assert.equal(get().terminated, true); assert.equal(get().handlerError, null);
  }
});

test('a failed spelling postMessage terminates its worker immediately', async t => {
  // Regression: a synchronous postMessage failure rejected but retained a timer and worker.
  const get = await mockWorker(t, () => { throw new DOMException('Could not send', 'DataCloneError'); });
  await assert.rejects(checkText('experiance'), /dictionary couldn’t|could not start/);
  assert.equal(get().terminated, true);
});

test('late spelling results cannot resolve after cancellation, and boundary empty text starts no worker', async t => {
  const get = await mockWorker(t, () => {});
  assert.deepEqual(await checkText(' \n '), { issues: [], checkedWords: 0, limitReached: false });
  assert.equal(get(), undefined);
  const controller = new AbortController(), pending = checkText('experiance', { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, error => error.name === 'AbortError');
  sendResult(get(), { checkedWords: 1, limitReached: false, issues: [] });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(get().terminated, true);
});

function importFixture() {
  let workspace = createWorkspace(createDocument(), 'initial', 'Fictitious CV'), mutations = 0;
  const ui = createDocumentImportUI({ getWorkspace: () => workspace,
    changeWorkspace: next => { mutations++; workspace = next; return true; },
    switchTab() {}, announce() {}, isActive: () => false });
  const file = (name, promise) => ({ name, size: 2000, text: () => promise });
  return { ui, file, get mutations() { return mutations; }, get workspace() { return workspace; } };
}

test('duplicate async backup intake applies only the latest intent and cancellation preserves the current library', async () => {
  const fixture = importFixture(); const doc = createDocument(); doc.profile.name = 'Fictitious newest CV';
  let finishOld;
  const old = fixture.ui.openFile(fixture.file('old.json', new Promise(resolve => { finishOld = resolve; })));
  await fixture.ui.openFile(fixture.file('new.json', Promise.resolve(JSON.stringify(doc))));
  finishOld(JSON.stringify(createDocument())); await old;
  assert.equal(fixture.mutations, 1); assert.equal(fixture.workspace.documents.length, 2);
  assert.equal(fixture.workspace.documents.at(-1).document.profile.name, doc.profile.name);
  const before = serialiseWorkspace(fixture.workspace); let finishCancelled;
  const pending = fixture.ui.openFile(fixture.file('cancelled.json', new Promise(resolve => { finishCancelled = resolve; })));
  fixture.ui.cancelPending(); finishCancelled(JSON.stringify(createDocument())); await pending;
  assert.equal(serialiseWorkspace(fixture.workspace), before); assert.equal(fixture.mutations, 1);
});
