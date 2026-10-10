import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { checkText } from '../src/spellcheck.js';

async function actualWorker(text, ignored = []) {
  const workerPath = new URL('../src/spellcheck-worker.js', import.meta.url);
  let resolve;
  const result = new Promise(done => { resolve = done; });
  const context = vm.createContext({ URL, Set, console, self: { location: { href: workerPath.href }, postMessage: resolve } });
  context.fetch = async url => new Response(await readFile(fileURLToPath(url)));
  const typo = await readFile(new URL('../public/vendor/spellcheck/typo.js', import.meta.url), 'utf8');
  context.importScripts = () => vm.runInContext(typo, context);
  vm.runInContext(await readFile(workerPath, 'utf8'), context);
  await context.self.onmessage({ data: { text, ignored } });
  return result;
}
test('real pinned Hunspell dictionary accepts British spellings and proposes actual corrections', async () => {
  const result = await actualWorker('I analysed the organisation and improved colour. I have experiance and achievments.');
  assert(!result.error, result.error);
  assert.deepEqual(Array.from(result.issues, issue => issue.word), ['experiance', 'achievments']);
  assert(result.issues[0].suggestions.includes('experience')); assert(result.issues[1].suggestions.includes('achievements'));
  assert.equal(result.limitReached, false);
});
test('real dictionary exceptions preserve unknown names and worker offsets exactly', async () => {
  const text = 'Zoë works with Qzxbrand and experiance.';
  const result = await actualWorker(text, ['Qzxbrand', 'Zoë']);
  assert.deepEqual(Array.from(result.issues, issue => issue.word), ['experiance']);
  for (const issue of result.issues) assert.equal(text.slice(issue.start, issue.end), issue.word);
});
test('spelling client rejects over-limit text and invalid exceptions before starting a worker', async () => {
  await assert.rejects(checkText('x'.repeat(50001)), /50,000/);
  await assert.rejects(checkText('word', { ignored: ['x'.repeat(41)] }), /short/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(checkText('word', { signal: controller.signal }), error => error.name === 'AbortError');
});
test('spelling client abort terminates an actual pending worker boundary without result application', async () => {
  const OriginalWorker = globalThis.Worker; let instance;
  class PendingWorker { constructor() { instance = this; this.terminated = false; } postMessage() {} terminate() { this.terminated = true; } }
  globalThis.Worker = PendingWorker;
  try { const controller = new AbortController(), pending = checkText('experiance', { signal: controller.signal }); controller.abort(); await assert.rejects(pending, error => error.name === 'AbortError'); assert.equal(instance.terminated, true); }
  finally { globalThis.Worker = OriginalWorker; }
});
test('spelling client rejects corrupt offsets and terminates the worker', async () => {
  const OriginalWorker = globalThis.Worker; let instance;
  class InvalidWorker { constructor() { instance = this; } postMessage() { queueMicrotask(() => this.onmessage({ data: { checkedWords: 1, issues: [{ word: 'other', start: 0, end: 5, suggestions: [] }] } })); } terminate() { this.terminated = true; } }
  globalThis.Worker = InvalidWorker;
  try { await assert.rejects(checkText('word'), /no longer matches the text/); assert.equal(instance.terminated, true); }
  finally { globalThis.Worker = OriginalWorker; }
});
