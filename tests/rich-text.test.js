import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RICH_TEXT_LIMITS, validateRichText, validateRuns, formatRuns, applyFormatting,
  applyLink, clearFormatting, selectionHasMark, transformRuns, renderRichText,
  safeRichHref, isTextBoundary
} from '../src/rich-text.js';
import { installRichTextToolbar } from '../src/rich-text-ui.js';
import { createDocument, addItem, addCustomSection, validateDocument, parseDocument, serialiseDocument } from '../src/model.js';

test('version 1 plain text needs no formatting metadata', () => {
  assert.deepEqual(validateRichText(undefined), {});
  assert.deepEqual(validateRuns('Plain CV'), []);
  assert.deepEqual(formatRuns('Plain CV'), [{ start: 0, end: 8, text: 'Plain CV' }]);
});

test('validated metadata detaches, canonicalises and resolves existing text', () => {
  const original = { 'profile.summary': [{ start: 0, end: 2, bold: true }, { start: 2, end: 4, bold: true }] };
  const result = validateRichText(original, field => field === 'profile.summary' ? 'Text' : undefined);
  assert.deepEqual(result, { 'profile.summary': [{ start: 0, end: 4, bold: true }] });
  result['profile.summary'][0].end = 1;
  assert.equal(original['profile.summary'][1].end, 4);
  assert.throws(() => validateRichText({ 'coverLetter.body': [] }, () => undefined), /unavailable field/);
  assert.throws(() => validateRichText({ 'profile.summary': [] }, () => { throw Error('private detail'); }), /^Error: Text formatting refers to an unavailable field\.$/);
});

test('JSON persistence preserves composed marks, links and exact plain source', () => {
  const text = 'A😀 detailed CV';
  let runs = applyFormatting(text, [], 1, 3, 'bold');
  runs = applyLink(text, runs, 4, text.length, 'https://example.com/cv');
  const saved = JSON.parse(JSON.stringify({ text, richText: { 'profile.summary': runs } }));
  const restored = validateRichText(saved.richText, field => field === 'profile.summary' ? saved.text : undefined);
  assert.deepEqual(restored['profile.summary'], runs);
  assert.equal(formatRuns(saved.text, restored['profile.summary']).map(run => run.text).join(''), text);
});

test('composition cannot exceed the field cap or mutate existing formatting', () => {
  const text = 'x'.repeat(512);
  const runs = Array.from({ length: 256 }, (_, index) => ({ start: index * 2 + 1, end: index * 2 + 2, bold: true }));
  const original = JSON.stringify(runs);
  assert.throws(() => applyFormatting(text, runs, 0, 1, 'italic'), /too much formatting/);
  assert.equal(JSON.stringify(runs), original);
});

test('metadata and run getters are rejected without invocation', () => {
  let calls = 0;
  const map = {};
  Object.defineProperty(map, 'profile.summary', { enumerable: true, get() { calls++; return []; } });
  const run = { start: 0, end: 1 };
  Object.defineProperty(run, 'bold', { enumerable: true, get() { calls++; return true; } });
  const list = [];
  Object.defineProperty(list, '0', { enumerable: true, get() { calls++; return { start: 0, end: 1, bold: true }; } });
  list.length = 1;
  const href = { start: 0, end: 1, bold: true };
  Object.defineProperty(href, 'href', { enumerable: true, get() { calls++; return 'https://example.com'; } });
  for (const value of [map]) assert.throws(() => validateRichText(value, () => 'Text'));
  for (const value of [[run], list, [href]]) assert.throws(() => validateRuns('Text', value));
  assert.equal(calls, 0);
});

test('metadata rejects inherited, invisible, symbolic and dangerous field keys', () => {
  const hidden = {}; Object.defineProperty(hidden, 'profile.summary', { value: [] });
  const symbolic = { [Symbol('field')]: [] };
  const inherited = Object.create({ 'profile.summary': [] });
  const prototype = { constructor: [] };
  const polluted = JSON.parse('{"__proto__":[]}');
  for (const value of [hidden, symbolic, inherited, prototype, polluted, [], null]) assert.throws(() => validateRichText(value, () => 'Text'));
  assert.equal({}.polluted, undefined);
});

test('valid existing reserved-looking entry and custom IDs can receive formatting', () => {
  for (const id of ['constructor', 'prototype', '__proto__']) {
    for (const collection of ['experience', 'customSections']) {
      const fresh = createDocument();
      const original = collection === 'experience' ? addItem(fresh, collection, id) : addCustomSection(fresh, id, 'Notes');
      const field = collection === 'experience' ? 'description' : 'content';
      original[collection][0][field] = 'Facts';
      // Mimic a clean version 1 save predating optional formatting/columns.
      delete original.richText; delete original.sectionColumns;
      delete original.layout.columns; delete original.layout.columnRatio;
      const restored = parseDocument(JSON.stringify(original));
      const key = collection + '.' + id + '.' + field;
      restored.richText[key] = [{ start: 0, end: 5, bold: true }];
      const checked = validateDocument(restored);
      assert.deepEqual(checked.richText[key], [{ start: 0, end: 5, bold: true }]);
      assert.deepEqual(parseDocument(serialiseDocument(checked)).richText, checked.richText);
      assert.equal(Object.getPrototypeOf(checked.richText), Object.prototype);
    }
  }
});

test('whole dangerous keys and unsupported pseudo paths cannot pollute metadata', () => {
  let resolved = 0;
  const resolve = () => { resolved++; return 'Facts'; };
  for (const key of ['constructor', 'prototype', '__proto__']) {
    const metadata = JSON.parse('{"' + key + '":[{"start":0,"end":5,"bold":true}]}');
    assert.throws(() => validateRichText(metadata, resolve), /invalid field name/);
  }
  assert.equal(resolved, 0);
  const doc = createDocument();
  doc.richText['profile.__proto__.bold'] = [{ start: 0, end: 1, bold: true }];
  assert.throws(() => validateDocument(doc), /unavailable field/);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
  assert.equal(Object.hasOwn(Object.prototype, 'bold'), false);
  assert.throws(() => validateRuns('Facts', [JSON.parse('{"start":0,"end":5,"bold":true,"__proto__":{}}')]), /unsupported field/);
});

test('run arrays and records reject non-plain shapes', () => {
  const valid = { start: 0, end: 1, bold: true };
  const sparse = Array(1);
  const extra = [valid]; extra.note = 'hidden content';
  const symbolic = [valid]; symbolic[Symbol('run')] = true;
  const recordSymbol = { ...valid, [Symbol('hidden')]: true };
  const recordHidden = { ...valid }; Object.defineProperty(recordHidden, 'note', { value: 'hidden' });
  const customPrototype = Object.assign(Object.create({}), valid);
  class Runs extends Array {}
  for (const value of [sparse, extra, symbolic, new Runs(valid), [recordSymbol], [recordHidden], [customPrototype], [{ ...valid, html: '<b>Text</b>' }]]) assert.throws(() => validateRuns('Text', value));
});

test('caps apply before field resolution, including runs that could merge', () => {
  let resolved = 0;
  const resolve = () => { resolved++; return 'x'.repeat(512); };
  const fields = Object.fromEntries(Array.from({ length: 257 }, (_, index) => ['field.' + index, []]));
  assert.throws(() => validateRichText(fields, resolve), /too many fields/);
  const many = Array.from({ length: 257 }, (_, index) => ({ start: index, end: index + 1, bold: true }));
  assert.throws(() => validateRichText({ 'profile.summary': many }, resolve));
  const runs = Array.from({ length: 256 }, (_, index) => ({ start: index, end: index + 1, bold: true }));
  const total = Object.fromEntries(Array.from({ length: 8 }, (_, index) => ['field.' + index, runs]));
  total.last = [{ start: 0, end: 1, bold: true }];
  assert.throws(() => validateRichText(total, resolve), /too many formatting ranges/);
  assert.equal(resolved, 0);
  delete total.last;
  assert.equal(Object.keys(validateRichText(total, resolve)).length, 8);
  assert.equal(resolved, 8);
  assert.throws(() => validateRuns('x'.repeat(RICH_TEXT_LIMITS.text + 1), []), /50,000/);
});

test('runs reject invalid offsets, empty styles, false marks and overlap', () => {
  for (const run of [
    { start: 0, end: 0, bold: true }, { start: -1, end: 1, bold: true },
    { start: 1, end: 0, bold: true }, { start: 0, end: 5, bold: true },
    { start: 0.5, end: 1, bold: true }, { start: NaN, end: 1, bold: true },
    { start: 0, end: Infinity, bold: true }, { start: 0, end: 1 },
    { start: 0, end: 1, bold: false }
  ]) assert.throws(() => validateRuns('Text', [run]));
  assert.throws(() => validateRuns('Text', [{ start: 1, end: 3, bold: true }, { start: 0, end: 1, italic: true }]), /ordered/);
  assert.throws(() => validateRuns('Text', [{ start: 0, end: 3, bold: true }, { start: 2, end: 4, italic: true }]), /overlap/);
});

test('UTF-16 selections preserve complete surrogate pairs', () => {
  const text = 'A😀B';
  assert.equal(text.length, 4);
  assert.equal(isTextBoundary(text, 2), false);
  assert.equal(isTextBoundary(text, 1), true);
  assert.equal(isTextBoundary(text, 3), true);
  assert.throws(() => applyFormatting(text, [], 1, 2, 'bold'), /valid text selection/);
  assert.throws(() => validateRuns(text, [{ start: 2, end: 3, bold: true }]), /valid text selection/);
  assert.deepEqual(applyFormatting(text, [], 1, 3, 'bold'), [{ start: 1, end: 3, bold: true }]);
});

test('overlapping selections safely compose independent marks', () => {
  const text = 'abcdefghij';
  let runs = applyFormatting(text, [], 0, 6, 'bold');
  runs = applyFormatting(text, runs, 3, 9, 'italic');
  runs = applyFormatting(text, runs, 5, 8, 'underline');
  assert.deepEqual(runs, [
    { start: 0, end: 3, bold: true },
    { start: 3, end: 5, bold: true, italic: true },
    { start: 5, end: 6, bold: true, italic: true, underline: true },
    { start: 6, end: 8, italic: true, underline: true },
    { start: 8, end: 9, italic: true }
  ]);
  assert.equal(formatRuns(text, runs).map(segment => segment.text).join(''), text);
});

test('mark toggles remove only the selected mark and canonicalise neighbours', () => {
  const text = 'abcdef';
  const runs = [{ start: 0, end: 6, bold: true, italic: true }];
  assert.equal(selectionHasMark(text, runs, 1, 5, 'bold'), true);
  assert.deepEqual(applyFormatting(text, runs, 1, 5, 'bold'), [
    { start: 0, end: 1, bold: true, italic: true },
    { start: 1, end: 5, italic: true },
    { start: 5, end: 6, bold: true, italic: true }
  ]);
  assert.deepEqual(applyFormatting(text, [{ start: 0, end: 2, bold: true }], 0, 4, 'bold'), [{ start: 0, end: 4, bold: true }]);
  assert.throws(() => applyFormatting(text, [], 0, 2, 'strike'));
  assert.throws(() => applyFormatting(text, [], 0, 2, 'bold', 'true'));
  assert.deepEqual(runs, [{ start: 0, end: 6, bold: true, italic: true }]);
});

test('an empty slice and selection have no segments or active marks', () => {
  const runs = [{ start: 0, end: 3, bold: true }];
  assert.deepEqual(formatRuns('abc', runs, { start: 1, end: 1 }), []);
  assert.equal(selectionHasMark('abc', runs, 1, 1, 'bold'), false);
  assert.throws(() => applyFormatting('abc', runs, 1, 1, 'bold'), /Select some text/);
  assert.throws(() => applyLink('abc', runs, 1, 1, 'https://example.com'), /Select some text/);
});

test('line slices keep absolute positions and exact source text', () => {
  const text = 'first\nsecond\nthird';
  const runs = [{ start: 3, end: 9, bold: true }, { start: 9, end: 15, href: 'https://example.com' }];
  const segments = formatRuns(text, runs, { start: 6, end: 12 });
  assert.deepEqual(segments, [
    { start: 6, end: 9, text: 'sec', bold: true },
    { start: 9, end: 12, text: 'ond', href: 'https://example.com/' }
  ]);
});

test('safe links accept websites and single-address emails without confusing @ URLs', () => {
  assert.equal(safeRichHref('example.com'), 'https://example.com/');
  assert.equal(safeRichHref('HTTP://example.com/path'), 'http://example.com/path');
  assert.equal(safeRichHref('mailto:alex+cv@example.com'), 'mailto:alex%2Bcv@example.com');
  assert.equal(safeRichHref('alex+cv@example.com'), 'mailto:alex%2Bcv@example.com');
  assert.equal(safeRichHref('mailto:alex%2Bcv@example.com'), 'mailto:alex%2Bcv@example.com');
  assert.equal(safeRichHref('mastodon.social/@tyler'), 'https://mastodon.social/@tyler');
  assert.equal(safeRichHref('example.com/path?user=alex@example.com'), 'https://example.com/path?user=alex@example.com');
  assert.equal(safeRichHref('http://localhost:4201'), 'http://localhost:4201/');
});

test('unsafe protocols, credentials, controls and email header injection never become links', () => {
  for (const value of [
    null, 42, {}, '', 'javascript:alert(1)', 'data:text/html,<script>x</script>',
    'file:///etc/passwd', '//example.com', 'https://user:password@example.com',
    'https://user@example.com', 'https://example.com\\@evil.com',
    '\nhttps://example.com', 'https://example.com\t', 'https://example.com/\0',
    'mailto:alex@example.com?subject=x', 'mailto:alex@example.com#x',
    'mailto:alex%0a@example.com', 'mailto:alex%zz@example.com',
    'https://example.com/' + 'x'.repeat(2048), 'https://a.co/' + 'é'.repeat(400)
  ]) {
    assert.equal(safeRichHref(value), null, String(value));
    assert.throws(() => validateRuns('Text', [{ start: 0, end: 4, href: value }]));
  }
});

test('links coexist with marks and removal preserves those marks', () => {
  const text = 'Click here';
  const original = [{ start: 0, end: 10, bold: true }];
  const linked = applyLink(text, original, 6, 10, 'https://example.com');
  assert.deepEqual(linked, [{ start: 0, end: 6, bold: true }, { start: 6, end: 10, bold: true, href: 'https://example.com/' }]);
  assert.deepEqual(applyLink(text, linked, 6, 10, null), original);
  assert.deepEqual(clearFormatting(text, linked, 2, 8), [
    { start: 0, end: 2, bold: true }, { start: 8, end: 10, bold: true, href: 'https://example.com/' }
  ]);
  assert.throws(() => applyLink(text, original, 0, 5, ''), /valid website/);
});

test('edit transforms shift suffixes, preserve prefixes and drop touched runs', () => {
  const before = [{ start: 0, end: 2, bold: true }, { start: 2, end: 4, italic: true }, { start: 4, end: 6, underline: true }];
  assert.deepEqual(transformRuns('abcdef', 'abXYcdef', before), [
    { start: 0, end: 2, bold: true }, { start: 4, end: 6, italic: true }, { start: 6, end: 8, underline: true }
  ]);
  assert.deepEqual(transformRuns('abcdef', 'abef', before), [
    { start: 0, end: 2, bold: true }, { start: 2, end: 4, underline: true }
  ]);
  assert.deepEqual(transformRuns('abcdef', 'abXdef', [{ start: 1, end: 4, bold: true }]), []);
  assert.deepEqual(transformRuns('abcdef', '', before), []);
  assert.deepEqual(before, [{ start: 0, end: 2, bold: true }, { start: 2, end: 4, italic: true }, { start: 4, end: 6, underline: true }]);
});

test('insertion at boundaries never extends formatting over the new text', () => {
  const runs = [{ start: 1, end: 3, bold: true }];
  assert.deepEqual(transformRuns('abcd', 'aXbcd', runs), [{ start: 2, end: 4, bold: true }]);
  assert.deepEqual(transformRuns('abcd', 'abcXd', runs), runs);
  assert.deepEqual(transformRuns('abcd', 'abXcd', runs), []);
  const noChange = transformRuns('abcd', 'abcd', runs); noChange[0].end = 2;
  assert.equal(runs[0].end, 3);
});

test('emoji replacement and newly paired lone surrogates cannot split ranges', () => {
  const runs = [{ start: 0, end: 1, bold: true }, { start: 1, end: 3, italic: true }, { start: 3, end: 4, underline: true }];
  assert.deepEqual(transformRuns('A😀B', 'A😁B', runs), [{ start: 0, end: 1, bold: true }, { start: 3, end: 4, underline: true }]);
  assert.deepEqual(transformRuns('\ud83dB', '😀B', [{ start: 0, end: 1, bold: true }, { start: 1, end: 2, italic: true }]), [{ start: 2, end: 3, italic: true }]);
});

test('per-character semantic oracle checks independent add/remove composition', () => {
  const text = 'abcdefghijklmnop';
  let runs = [], seed = 7182;
  const oracle = Array.from(text, () => ({}));
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let step = 0; step < 200; step++) {
    const start = random(text.length), end = start + 1 + random(text.length - start);
    const mark = ['bold', 'italic', 'underline'][random(3)], enabled = !!random(2);
    runs = applyFormatting(text, runs, start, end, mark, enabled);
    for (let index = start; index < end; index++) if (enabled) oracle[index][mark] = true; else delete oracle[index][mark];
    const observed = Array.from(text, () => ({}));
    for (const run of runs) for (let index = run.start; index < run.end; index++) for (const mark of ['bold', 'italic', 'underline']) if (run[mark]) observed[index][mark] = true;
    assert.deepEqual(observed, oracle);
    assert.equal(formatRuns(text, runs).map(segment => segment.text).join(''), text);
  }
});

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type, values = {}) {
    const event = { key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...values };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
  listenerCount() { return [...this.listeners.values()].reduce((total, values) => total + values.size, 0); }
}
class Node extends Events {
  constructor(tagName, document, text = '') {
    super(); this.tagName = tagName.toUpperCase(); this.ownerDocument = document; this.children = []; this.attributes = {};
    this._text = text; this.value = ''; this.selectionStart = this.selectionEnd = 0; this.isConnected = true;
    this.disabled = this.readOnly = false;
  }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  set innerHTML(_) { throw Error('Unsafe HTML insertion'); }
  before(node) { node.parentNode = this.parentNode; const index = this.parentNode.children.indexOf(this); this.parentNode.children.splice(index, 0, node); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.isConnected = false; }
  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}
class Document extends Events {
  createElement(tagName) { return new Node(tagName, this); }
  createTextNode(text) { return new Node('#text', this, text); }
  createDocumentFragment() { return new Node('#fragment', this); }
}
const descendants = node => [node, ...node.children.flatMap(descendants)];
const find = (node, text) => descendants(node).find(child => child.tagName === 'BUTTON' && child.textContent === text);
function editorFixture({ transformOnInput = false } = {}) {
  const document = new Document(), root = document.createElement('div'), textarea = document.createElement('textarea');
  textarea.value = 'abcdef'; root.append(textarea); textarea.setSelectionRange(1, 4);
  let text = textarea.value, runs = [], calls = [];
  const announcements = [], errors = [];
  const toolbar = installRichTextToolbar(textarea, {
    transformOnInput, getText: () => text, getRuns: () => runs,
    setRuns: (next, context) => { runs = next; text = context.text; calls.push(context); },
    announce: message => announcements.push(message), onError: error => errors.push(error.message)
  });
  return { document, root, textarea, toolbar, calls, announcements, errors,
    get runs() { return runs; }, set runs(value) { runs = value; },
    set text(value) { text = value; } };
}

test('DOM renderer uses only text nodes and safe semantic wrappers', () => {
  const text = '<img src=x onerror=alert(1)>\n& emoji 😀';
  const document = new Document();
  const fragment = renderRichText(text, [{ start: 0, end: text.length, bold: true, italic: true, underline: true, href: 'https://example.com/"quoted' }], { document });
  assert.equal(fragment.textContent, text);
  const nodes = descendants(fragment);
  assert.deepEqual(nodes.filter(node => node.tagName !== '#TEXT' && node.tagName !== '#FRAGMENT').map(node => node.tagName), ['A', 'STRONG', 'EM', 'U']);
  const anchor = nodes.find(node => node.tagName === 'A');
  assert.equal(anchor.attributes.href, 'https://example.com/%22quoted');
  assert.equal(anchor.attributes.rel, 'noopener noreferrer');
  assert.equal(anchor.attributes.target, '_blank');
  assert.throws(() => renderRichText(text, [{ start: 0, end: 2, href: 'javascript:alert(1)' }], { document }));
  const email = renderRichText('Email', [{ start: 0, end: 5, href: 'alex@example.com' }], { document });
  assert.equal(email.children[0].attributes.href, 'mailto:alex@example.com');
  assert.equal(email.children[0].attributes.target, undefined);
});

test('toolbar formats selected text, preserves selection and exposes toggle state', () => {
  const f = editorFixture(), bold = find(f.toolbar.element, 'Bold');
  assert.equal(bold.emit('pointerdown').defaultPrevented, true);
  bold.emit('click');
  assert.deepEqual(f.runs, [{ start: 1, end: 4, bold: true }]);
  assert.equal(bold.attributes['aria-pressed'], 'true');
  assert.equal(f.textarea.selectionStart, 1); assert.equal(f.textarea.selectionEnd, 4);
  bold.emit('click'); assert.deepEqual(f.runs, []);
  assert.deepEqual(f.calls.map(call => call.reason), ['format', 'format']);
  assert.deepEqual(f.errors, []);
});

test('toolbar ignores collapsed, disabled, readonly and detached fields', () => {
  const f = editorFixture(), bold = find(f.toolbar.element, 'Bold');
  f.textarea.setSelectionRange(2, 2); f.toolbar.refresh(); assert.equal(bold.disabled, true); bold.emit('click');
  f.textarea.setSelectionRange(1, 3); f.textarea.readOnly = true; bold.emit('click');
  f.textarea.readOnly = false; f.textarea.disabled = true; bold.emit('click');
  f.textarea.disabled = false; f.textarea.isConnected = false; bold.emit('click');
  assert.equal(f.calls.length, 0);
});

test('toolbar supports Ctrl/Cmd shortcuts only for a valid selection', () => {
  const f = editorFixture();
  assert.equal(f.textarea.emit('keydown', { key: 'b', ctrlKey: true }).defaultPrevented, true);
  assert.equal(f.textarea.emit('keydown', { key: 'i', metaKey: true }).defaultPrevented, true);
  assert.deepEqual(f.runs, [{ start: 1, end: 4, bold: true, italic: true }]);
  assert.equal(f.textarea.emit('keydown', { key: 'i', ctrlKey: true, shiftKey: true }).defaultPrevented, false);
  f.textarea.setSelectionRange(0, 0);
  assert.equal(f.textarea.emit('keydown', { key: 'u', ctrlKey: true }).defaultPrevented, false);
});

test('toolbar link editor validates links and restores the original selection', () => {
  const f = editorFixture();
  find(f.toolbar.element, 'Link').emit('click');
  const input = descendants(f.toolbar.element).find(node => node.tagName === 'INPUT');
  input.value = 'javascript:alert(1)'; find(f.toolbar.element, 'Save link').emit('click');
  assert.equal(f.calls.length, 0); assert.match(f.errors[0], /valid website/);
  input.value = 'https://example.com'; input.emit('keydown', { key: 'Enter' });
  assert.deepEqual(f.runs, [{ start: 1, end: 4, href: 'https://example.com/' }]);
  assert.equal(f.document.activeElement, f.textarea); assert.equal(f.textarea.selectionStart, 1);
  find(f.toolbar.element, 'Link').emit('click'); find(f.toolbar.element, 'Remove link').emit('click');
  assert.deepEqual(f.runs, []);
});

test('a stale link selection cannot format changed text', () => {
  const f = editorFixture(); find(f.toolbar.element, 'Link').emit('click');
  const input = descendants(f.toolbar.element).find(node => node.tagName === 'INPUT');
  f.textarea.value = 'changed'; f.text = 'changed'; input.value = 'https://example.com';
  find(f.toolbar.element, 'Save link').emit('click');
  assert.equal(f.calls.length, 0); assert.deepEqual(f.runs, []);
});

test('central input handling can turn off automatic range transforms', () => {
  const f = editorFixture({ transformOnInput: false });
  f.runs = [{ start: 2, end: 4, bold: true }];
  f.textarea.value = 'Xabcdef'; f.textarea.emit('input');
  assert.equal(f.calls.length, 0);
  f.runs = transformRuns('abcdef', f.textarea.value, f.runs); f.text = f.textarea.value;
  f.toolbar.refresh(); assert.deepEqual(f.runs, [{ start: 3, end: 5, bold: true }]);
  assert.deepEqual(f.errors, []);
});

test('standalone toolbar sends new text and transformed ranges atomically', () => {
  const f = editorFixture({ transformOnInput: true });
  f.runs = [{ start: 2, end: 4, bold: true }];
  f.textarea.value = 'Xabcdef'; f.textarea.emit('input');
  assert.deepEqual(f.runs, [{ start: 3, end: 5, bold: true }]);
  assert.equal(f.calls[0].reason, 'input'); assert.equal(f.calls[0].text, 'Xabcdef'); assert.equal(f.calls[0].previousText, 'abcdef');
});

test('disposal removes textarea/document listeners and stops stale controls', () => {
  const f = editorFixture(), bold = find(f.toolbar.element, 'Bold');
  assert.ok(f.document.listenerCount() > 0); assert.ok(f.textarea.listenerCount() > 0);
  f.toolbar.dispose(); f.toolbar.dispose();
  assert.equal(f.document.listenerCount(), 0); assert.equal(f.textarea.listenerCount(), 0);
  bold.emit('click'); f.textarea.emit('keydown', { key: 'b', ctrlKey: true }); f.document.emit('selectionchange');
  assert.equal(f.calls.length, 0); assert.equal(f.toolbar.element.isConnected, false);
});
