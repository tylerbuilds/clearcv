import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, sampleDocument, validateDocument, parseDocument, serialiseDocument, addItem, updateItem, moveItem, removeItem, keywordFeedback, tokenise } from '../src/model.js';

test('JSON round trip preserves user text and detaches state', () => {
  const original = sampleDocument();
  original.profile.summary = '<script>alert("x")</script> — café & résumé';
  const restored = parseDocument(serialiseDocument(original));
  assert.deepEqual(restored, original);
  restored.profile.name = 'Changed';
  assert.equal(original.profile.name, 'Alex Morgan');
});
test('add, edit, reorder and remove preserve immutable state and IDs', () => {
  const original = createDocument();
  const first = addItem(original, 'experience', 'first');
  const second = addItem(first, 'experience', 'second');
  const edited = updateItem(second, 'experience', 'first', 'title', 'Engineer');
  const moved = moveItem(edited, 'experience', 'first', 1);
  assert.deepEqual(moved.experience.map(item => item.id), ['second', 'first']);
  assert.equal(moved.experience[1].title, 'Engineer');
  assert.equal(second.experience[0].title, '');
  assert.equal(original.experience.length, 0);
  assert.deepEqual(removeItem(moved, 'experience', 'second').experience.map(item => item.id), ['first']);
  assert.deepEqual(moveItem(moved, 'experience', 'second', -1), moved);
  assert.throws(() => updateItem(moved, 'experience', 'missing', 'title', 'x'), /not found/);
  assert.throws(() => updateItem(moved, 'experience', 'first', 'id', 'x'), /field/);
  assert.throws(() => addItem(moved, 'experience', 'first'), /invalid or repeated entry ID/);
});
test('imports reject malformed or unexpected documents before replacing user work', () => {
  assert.throws(() => parseDocument('{'), /valid JSON/);
  assert.throws(() => parseDocument('null'), /object/);
  for (const mutate of [
    doc => { doc.version = 2; },
    doc => { doc.profile.name = 7; },
    doc => { doc.style.accent = 'red; background:url(https://example.com)'; },
    doc => { doc.style.template = 'external'; },
    doc => { doc.experience = {}; },
    doc => { doc.skills[0].id = doc.experience[0].id; },
    doc => { doc.profile.__proto__ = { injected: 'x' }; },
    doc => { doc.profile.name = 'x'.repeat(301); },
    doc => { doc.jobAd = 'x'.repeat(50001); },
    doc => { doc.extra = true; }
  ]) {
    const doc = sampleDocument(); mutate(doc);
    assert.throws(() => validateDocument(doc));
  }
  const malicious = serialiseDocument(sampleDocument()).replace('"name": "Alex Morgan"', '"__proto__": {"polluted": true}, "name": "Alex Morgan"');
  assert.throws(() => parseDocument(malicious), /unsupported field/);
  assert.equal({}.polluted, undefined);
});
test('section limits fail with actionable errors', () => {
  let doc = createDocument();
  for (let i = 0; i < 60; i++) doc = addItem(doc, 'skills', `skill-${i}`);
  assert.throws(() => addItem(doc, 'skills', 'one-more'), /up to 60/);
  assert.throws(() => parseDocument('x'.repeat(1_000_001)), /smaller than 1 MB/);
});
test('keyword comparison is case-insensitive exact token overlap, not substring or an ATS score', () => {
  const doc = createDocument();
  doc.profile.summary = 'Design JavaScript accessibility café UI.';
  const result = keywordFeedback(doc, 'JavaScript JAVASCRIPT accessibility accessible café UI hiring');
  assert.deepEqual(result.found, ['javascript', 'accessibility', 'café', 'ui']);
  assert.ok(result.missing.includes('accessible'));
  assert.equal(result.percentage, 67);
  assert.equal(keywordFeedback(doc, 'and the').percentage, null);
  assert.deepEqual(tokenise('C++ C# Figma, UX and the 123'), ['c++', 'c#', 'figma', 'ux']);
});

test('every accepted document fits the same UTF-8 import and export limit', () => {
  const oversized = createDocument();
  for (const collection of ['experience', 'education']) {
    for (let i = 0; i < 60; i++) {
      oversized[collection].push({ id: `${collection}-${i}`, title: '', organisation: '', location: '', dates: '', description: 'x'.repeat(10000) });
    }
  }
  assert.throws(() => validateDocument(oversized), /too large/);
  assert.throws(() => serialiseDocument(oversized), /too large/);
  const unicode = sampleDocument();
  unicode.profile.summary = '🪴'.repeat(2500);
  assert.deepEqual(parseDocument(serialiseDocument(unicode)), unicode);
  const json = JSON.stringify(unicode).replace(unicode.profile.summary, '🪴'.repeat(260000));
  assert.ok(json.length < 1_000_000);
  assert.throws(() => parseDocument(json), /smaller than 1 MB/);
});
