import { safeContactHref } from './links.js';

// Offsets are half-open UTF-16 code-unit positions, matching textarea selections.
// A boundary must never split a valid surrogate pair. Source text stays plain.
export const RICH_TEXT_LIMITS = Object.freeze({ fields: 256, runs: 256, totalRuns: 2048, text: 50000, href: 2048 });
const MARKS = ['bold', 'italic', 'underline'];
const RUN_KEYS = ['start', 'end', ...MARKS, 'href'];
const FIELD = /^[A-Za-z][A-Za-z0-9_.-]{0,179}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const fail = message => { throw new Error(message); };

function plainRecord(value, label, limit = 16) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(label + ' must be a plain object.');
  const keys = Reflect.ownKeys(value);
  if (keys.length > limit) fail(label + ' has too many fields.');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail(label + ' must contain only ordinary fields.');
  }
  return keys;
}
function denseList(value, label, limit) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) fail(label + ' must be a plain list with at most ' + limit + ' entries.');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) fail(label + ' must not contain missing or extra entries.');
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail(label + ' must not contain missing or accessor entries.');
  }
}
function textValue(text) {
  if (typeof text !== 'string' || text.length > RICH_TEXT_LIMITS.text) fail('Choose text of at most 50,000 characters to format.');
  return text;
}
export function isTextBoundary(text, offset) {
  if (typeof text !== 'string' || !Number.isInteger(offset) || offset < 0 || offset > text.length) return false;
  if (offset === 0 || offset === text.length) return true;
  const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
function range(text, start, end, allowEmpty = false) {
  if (!isTextBoundary(text, start) || !isTextBoundary(text, end) || end < start) fail('Choose a valid text selection.');
  if (!allowEmpty && start === end) fail('Select some text first.');
}
function attrs(run) {
  const result = {};
  for (const mark of MARKS) if (run?.[mark]) result[mark] = true;
  if (run?.href) result.href = run.href;
  return result;
}
function sameAttrs(left, right) {
  return MARKS.every(mark => left[mark] === right[mark]) && left.href === right.href;
}
function appendRun(out, start, end, style) {
  if (start >= end || !Object.keys(style).length) return;
  const previous = out.at(-1);
  if (previous && previous.end === start && sameAttrs(previous, style)) previous.end = end;
  else out.push({ start, end, ...style });
}

export function safeRichHref(value) {
  if (typeof value !== 'string' || value.length > RICH_TEXT_LIMITS.href) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const text = value.trim();
  if (!text || /[\u0000-\u0020\u007f]/.test(text) || text.includes('\\') || text.startsWith('//')) return null;
  let href;
  if (/^mailto:/i.test(text)) {
    if (/[?#]/.test(text.slice(7))) return null;
    let address;
    try { address = decodeURIComponent(text.slice(7)); } catch { return null; }
    // Email links deliberately have one address and no subject/body/header fields.
    href = safeContactHref('email', address);
  } else {
    href = safeContactHref('website', text);
    if (!href && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(text)) href = safeContactHref('email', text);
  }
  return href && href.length <= RICH_TEXT_LIMITS.href ? href : null;
}

export function validateRuns(text, runs) {
  textValue(text);
  if (runs === undefined) return [];
  denseList(runs, 'Formatting', RICH_TEXT_LIMITS.runs);
  const out = [];
  let lastEnd = 0;
  for (const run of runs) {
    const keys = plainRecord(run, 'Formatting range');
    if (keys.some(key => !RUN_KEYS.includes(key)) || !Object.hasOwn(run, 'start') || !Object.hasOwn(run, 'end')) fail('Formatting contains an unsupported field.');
    range(text, run.start, run.end);
    if (run.start < lastEnd) fail('Formatting ranges must be ordered and must not overlap.');
    lastEnd = run.end;
    const style = {};
    for (const mark of MARKS) if (Object.hasOwn(run, mark)) {
      if (run[mark] !== true) fail('Formatting marks must be true or absent.');
      style[mark] = true;
    }
    if (Object.hasOwn(run, 'href')) {
      const href = safeRichHref(run.href);
      if (!href) fail('Use a valid website or email link.');
      style.href = href;
    }
    if (!Object.keys(style).length) fail('A formatting range must have a mark or link.');
    appendRun(out, run.start, run.end, style);
  }
  return out;
}

export function validateRichText(metadata, resolveText) {
  if (metadata === undefined) return {};
  const fields = plainRecord(metadata, 'Text formatting', RICH_TEXT_LIMITS.fields);
  if (typeof resolveText !== 'function') fail('Text formatting needs a field resolver.');
  let total = 0;
  // Count before resolving text or composing runs, including runs that may merge.
  for (const field of fields) {
    // These are flat map keys, not object paths. An existing entry ID may look
    // reserved; the caller's resolver alone decides which fields actually exist.
    if (!FIELD.test(field) || FORBIDDEN_KEYS.has(field)) fail('Text formatting has an invalid field name.');
    denseList(metadata[field], 'Formatting', RICH_TEXT_LIMITS.runs);
    total += metadata[field].length;
    if (total > RICH_TEXT_LIMITS.totalRuns) fail('This CV has too many formatting ranges.');
  }
  const out = {};
  for (const field of fields) {
    let text;
    try { text = resolveText(field); } catch { fail('Text formatting refers to an unavailable field.'); }
    if (typeof text !== 'string') fail('Text formatting refers to an unavailable field.');
    const runs = validateRuns(text, metadata[field]);
    if (runs.length) out[field] = runs;
  }
  return out;
}

// Includes plain segments and keeps their absolute source offsets. Optional bounds
// let previews/exporters format one source line without guessing shifted offsets.
export function formatRuns(text, runs, { start = 0, end = text?.length } = {}) {
  textValue(text);
  const checked = validateRuns(text, runs);
  range(text, start, end, true);
  if (start === end) return [];
  const out = [];
  let cursor = start;
  for (const run of checked) {
    if (run.end <= start) continue;
    if (run.start >= end) break;
    const from = Math.max(start, run.start), to = Math.min(end, run.end);
    if (cursor < from) out.push({ start: cursor, end: from, text: text.slice(cursor, from) });
    out.push({ start: from, end: to, text: text.slice(from, to), ...attrs(run) });
    cursor = to;
  }
  if (cursor < end) out.push({ start: cursor, end, text: text.slice(cursor, end) });
  return out;
}

function compose(text, runs, start, end, change) {
  textValue(text);
  const checked = validateRuns(text, runs);
  range(text, start, end);
  const cuts = [...new Set([0, text.length, start, end, ...checked.flatMap(run => [run.start, run.end])])].sort((a, b) => a - b);
  const out = [];
  let index = 0;
  for (let cut = 0; cut < cuts.length - 1; cut++) {
    const from = cuts[cut], to = cuts[cut + 1];
    while (index < checked.length && checked[index].end <= from) index++;
    const current = checked[index];
    let style = current && current.start <= from && current.end >= to ? attrs(current) : {};
    if (from >= start && to <= end) style = change(style);
    appendRun(out, from, to, style);
    if (out.length > RICH_TEXT_LIMITS.runs) fail('There is too much formatting in this field. Clear some first.');
  }
  return out;
}
export function selectionHasMark(text, runs, start, end, mark) {
  if (!MARKS.includes(mark)) fail('Choose bold, italic or underline.');
  const segments = formatRuns(text, runs, { start, end });
  return segments.length > 0 && segments.every(segment => segment[mark] === true);
}
export function applyFormatting(text, runs, start, end, mark, enabled) {
  if (!MARKS.includes(mark)) fail('Choose bold, italic or underline.');
  if (enabled !== undefined && typeof enabled !== 'boolean') fail('Choose whether to add or remove the formatting.');
  const add = enabled ?? !selectionHasMark(text, runs, start, end, mark);
  return compose(text, runs, start, end, style => {
    if (add) style[mark] = true;
    else delete style[mark];
    return style;
  });
}
export function applyLink(text, runs, start, end, href) {
  const safe = href === null ? null : safeRichHref(href);
  if (href !== null && !safe) fail('Use a valid website or email link.');
  return compose(text, runs, start, end, style => {
    if (safe) style.href = safe;
    else delete style.href;
    return style;
  });
}
export function clearFormatting(text, runs, start, end) {
  return compose(text, runs, start, end, () => ({}));
}

// A single conservative edit window is found from the common prefix/suffix.
// Runs touched by that edit are dropped; suffix runs shift by the length delta.
// Insertions at a run edge do not inherit formatting. This also safely handles
// paste, replacements, multi-edit updates and emoji sharing a high surrogate.
export function transformRuns(previousText, nextText, runs) {
  textValue(nextText);
  const checked = validateRuns(previousText, runs);
  if (previousText === nextText) return checked;
  let prefix = 0;
  while (prefix < previousText.length && prefix < nextText.length && previousText[prefix] === nextText[prefix]) prefix++;
  while (!isTextBoundary(previousText, prefix) || !isTextBoundary(nextText, prefix)) prefix--;
  let suffix = 0;
  while (suffix < previousText.length - prefix && suffix < nextText.length - prefix && previousText[previousText.length - suffix - 1] === nextText[nextText.length - suffix - 1]) suffix++;
  while (!isTextBoundary(previousText, previousText.length - suffix) || !isTextBoundary(nextText, nextText.length - suffix)) suffix--;
  const oldEnd = previousText.length - suffix, delta = nextText.length - previousText.length;
  const out = [];
  for (const run of checked) {
    if (run.end <= prefix) out.push({ ...run });
    else if (run.start >= oldEnd) out.push({ ...run, start: run.start + delta, end: run.end + delta });
  }
  return validateRuns(nextText, out);
}

export function renderRichText(text, runs, { document = globalThis.document, start = 0, end = text?.length } = {}) {
  const segments = formatRuns(text, runs, { start, end });
  if (!document?.createDocumentFragment || !document?.createTextNode || !document?.createElement) fail('Text formatting needs a document.');
  const fragment = document.createDocumentFragment();
  for (const segment of segments) {
    let node = document.createTextNode(segment.text);
    for (const [mark, tag] of [['underline', 'u'], ['italic', 'em'], ['bold', 'strong']]) if (segment[mark]) {
      const wrapper = document.createElement(tag); wrapper.append(node); node = wrapper;
    }
    if (segment.href) {
      const link = document.createElement('a');
      link.setAttribute('href', segment.href);
      if (!segment.href.startsWith('mailto:')) {
        link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer');
      }
      link.append(node); node = link;
    }
    fragment.append(node);
  }
  return fragment;
}
