import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPagePreview, sliceRenderedText, MAX_PREVIEW_PAGES } from '../src/page-preview.js';
import { pageDimensions } from '../src/layout.js';
import { renderRichText } from '../src/rich-text.js';

// Deterministic DOM layout: each flow block consumes one pixel per UTF-16 unit
// (or an explicit font scale). This exercises the actual pagination scheduler,
// not browser typography. The coordinator separately verifies native PDF pages.
class Style {
  setProperty(name, value) { this[name] = value; }
  getPropertyValue(name) { return this[name] ?? '0px'; }
}
class Node {
  constructor(document, tag, text = '') {
    this.ownerDocument = document; this.tagName = tag.toUpperCase();
    this.nodeType = tag === '#text' ? 3 : tag === '#fragment' ? 11 : 1;
    this.childNodes = []; this.parentNode = null; this.attributes = {};
    this.dataset = {}; this.style = new Style(); this._text = text;
    this.fixedHeight = null; this.flow = false; this.unitHeight = 1;
  }
  get isConnected() { return true; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get className() { return this.attributes.class || ''; }
  set className(value) { this.attributes.class = String(value); }
  get classList() {
    return { contains: value => this.className.split(/\s+/).includes(value),
      add: (...values) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...values])].join(' '); } };
  }
  get textContent() { return this.nodeType === 3 ? this._text : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) {
    if (this.nodeType === 3) this._text = String(value);
    else { this.replaceChildren(); if (value !== '') this.append(this.ownerDocument.createTextNode(String(value))); }
  }
  set innerHTML(_) { throw new Error('HTML parsing is forbidden in this fixture.'); }
  append(...nodes) {
    for (const value of nodes) {
      const node = typeof value === 'string' ? this.ownerDocument.createTextNode(value) : value;
      if (node.nodeType === 11) { this.append(...[...node.childNodes]); continue; }
      node.remove(); node.parentNode = this; this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes) { for (const node of [...this.childNodes]) node.remove(); this.append(...nodes); }
  remove() { if (this.parentNode) { const parent = this.parentNode; parent.childNodes.splice(parent.childNodes.indexOf(this), 1); this.parentNode = null; } }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  cloneNode(deep = false) {
    const copy = new Node(this.ownerDocument, this.tagName.toLowerCase(), this._text);
    copy.attributes = { ...this.attributes }; copy.dataset = { ...this.dataset };
    Object.assign(copy.style, this.style);
    copy.fixedHeight = this.fixedHeight; copy.flow = this.flow; copy.unitHeight = this.unitHeight;
    if (deep) copy.append(...this.childNodes.map(node => node.cloneNode(true)));
    return copy;
  }
  contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
  matches(selector) {
    if (selector === '*') return this.nodeType === 1;
    if (selector === '[id]') return Object.hasOwn(this.attributes, 'id');
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    if (selector.startsWith(':scope > ')) return this.children.filter(node => node.matches(selector.slice(9)));
    return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get height() {
    if (this.classList.contains('print-page')) return Number.parseFloat(this.style.height);
    if (this.fixedHeight !== null) return this.fixedHeight;
    if (this.classList.contains('cv-columns')) return Math.max(0, ...this.children.map(node => node.height));
    if (this.flow || this.nodeType === 3) return this.textContent.length * this.unitHeight;
    return this.childNodes.reduce((sum, node) => sum + node.height, 0);
  }
  get scrollHeight() {
    if (++this.ownerDocument.measurements > 2000) throw new Error('Pagination measurement budget exceeded: search did not progress.');
    return this.height;
  }
  getBoundingClientRect() {
    let top = 0;
    if (this.parentNode) {
      top = this.parentNode.getBoundingClientRect().top;
      if (this.parentNode.classList.contains('print-page')) top += Number.parseFloat(this.parentNode.style.padding) || 0;
      if (!this.parentNode.classList.contains('cv-columns')) {
        for (const sibling of this.parentNode.childNodes) { if (sibling === this) break; top += sibling.height; }
      }
    }
    return { top, bottom: top + this.height, height: this.height, width: 400, left: 0, right: 400 };
  }
}
const textNodes = root => root.nodeType === 3 ? [root] : root.childNodes.flatMap(textNodes);
class Document {
  constructor() {
    this.measurements = 0;
    this.defaultView = { getComputedStyle: node => ({ width: '400px', height: `${node.height}px`, gap: '0px',
      getPropertyValue: name => name === 'font-size' || name === 'line-height' ? `${node.unitHeight}px` : '0px' }) };
  }
  createElement(tag) { return new Node(this, tag); }
  createTextNode(text) { return new Node(this, '#text', text); }
  createDocumentFragment() { return new Node(this, '#fragment'); }
  createTreeWalker(root) {
    const nodes = textNodes(root); let index = -1;
    return { currentNode: root, nextNode() { if (++index >= nodes.length) return false; this.currentNode = nodes[index]; return true; } };
  }
  createRange() {
    const document = this; let start, end, startOffset, endOffset;
    return {
      setStart(node, offset) { start = node; startOffset = offset; },
      setEnd(node, offset) { end = node; endOffset = offset; },
      detach() {},
      cloneContents() {
        // Native Range clones children of the common ancestor, not that
        // ancestor's own wrapper. Model this faithfully to catch lost marks.
        let common = start;
        while (!common.contains(end)) common = common.parentNode;
        const fragment = document.createDocumentFragment();
        if (common.nodeType === 3) { fragment.append(document.createTextNode(common.textContent.slice(startOffset, endOffset))); return fragment; }
        let total = 0, first = 0, last = 0;
        for (const node of textNodes(common)) {
          if (node === start) first = total + startOffset;
          if (node === end) last = total + endOffset;
          total += node.textContent.length;
        }
        let at = 0;
        function selected(node) {
          if (node.nodeType === 3) {
            const from = Math.max(0, first - at), to = Math.min(node.textContent.length, last - at);
            at += node.textContent.length;
            return to > from ? document.createTextNode(node.textContent.slice(from, to)) : null;
          }
          const copy = node.cloneNode(false);
          for (const child of node.childNodes) { const piece = selected(child); if (piece) copy.append(piece); }
          return copy.childNodes.length ? copy : null;
        }
        for (const child of common.childNodes) { const piece = selected(child); if (piece) fragment.append(piece); }
        return fragment;
      }
    };
  }
}

const layout = { pageSize: 'A4', margin: 46, columnRatio: 'wide-main' };
const available = header => pageDimensions(layout.pageSize).heightPx - layout.margin * 2 - header - 2;
function fixture({ header = 150, columns = 1 } = {}) {
  const document = new Document(), source = document.createElement('article'), target = document.createElement('div');
  source.className = 'cv'; source.setAttribute('id', 'original-preview');
  if (header) {
    const node = document.createElement('header'); node.className = 'cv-header'; node.fixedHeight = header; node.textContent = 'CV_HEADER'; source.append(node);
  }
  const grid = document.createElement('div'); grid.className = `cv-columns columns-${columns}`;
  const columnNodes = {};
  for (const name of columns === 2 ? ['main', 'side'] : ['main']) {
    const node = document.createElement('div'); node.className = `cv-column cv-column-${name}`; node.dataset.cvColumn = name;
    grid.append(node); columnNodes[name] = node;
  }
  source.append(grid);
  function block(text, { className = 'cv-entry', column = 'main', unitHeight = 1, rich = false } = {}) {
    const node = document.createElement('p'); node.className = className; node.flow = true; node.unitHeight = unitHeight;
    node.setAttribute('id', `block-${column}-${columnNodes[column].children.length}`);
    if (rich) node.append(renderRichText(text, [{ start: 0, end: text.length, bold: true, italic: true, underline: true,
      href: 'https://example.com/portfolio' }], { document }));
    else node.textContent = text;
    columnNodes[column].append(node); return node;
  }
  return { document, source, target, columnNodes, block, preview: () => buildPagePreview(source, target, layout) };
}
const column = (page, name = 'main') => page.querySelector(`.cv-column-${name}`);
function semantics(root) {
  const records = [];
  for (const node of textNodes(root)) {
    const marks = [];
    for (let parent = node.parentNode; parent && parent !== root; parent = parent.parentNode) {
      if (['A', 'STRONG', 'EM', 'U'].includes(parent.tagName)) marks.unshift({ tag: parent.tagName, ...parent.attributes });
    }
    for (let i = 0; i < node.textContent.length; i++) records.push({ unit: node.textContent[i], marks });
  }
  return records;
}
function assertColumnPreserved(f, result, name = 'main') {
  const expected = semantics(f.columnNodes[name]), actual = result.pages.flatMap(page => semantics(column(page, name)));
  assert.equal(actual.length, expected.length, 'no text unit may be missing or duplicated');
  for (let index = 0; index < expected.length; index++) {
    assert.deepEqual(actual[index], expected[index], `text order and formatting must survive at ${name} unit ${index}`);
  }
  for (const page of result.pages) {
    const text = column(page, name).textContent;
    assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(text), 'a page cannot cut a surrogate pair');
  }
}
function assertPageStructure(result, header = true) {
  assert.equal(result.pages[0].querySelectorAll('.cv-header').length, header ? 1 : 0);
  for (let i = 0; i < result.pages.length; i++) {
    const page = result.pages[i];
    if (i) assert.equal(page.querySelectorAll('.cv-header').length, 0);
    assert.equal(page.querySelectorAll('[id]').length, 0);
    assert.equal(page.getAttribute('id'), null);
    assert.equal(page.querySelector('.page-footer').textContent, `${i + 1} / ${result.pages.length}`);
    assert.equal(page.getAttribute('aria-label'), `Page ${i + 1} of ${result.pages.length}`);
    assert.ok(page.querySelectorAll('.cv-column').some(node => node.textContent.length > 0), 'no empty probe page may remain');
    const capacity = available(page.querySelector('.cv-header')?.height || 0);
    for (const node of page.querySelectorAll('.cv-column')) assert.ok(node.scrollHeight <= capacity + 1, 'column must stay inside the available paper height');
  }
}

test('oversized letter body uses the first-page remainder rather than a header-only sheet', () => {
  const f = fixture({ header: 200 }); f.block('LETTER_START_' + 'x'.repeat(2600) + '_LETTER_END', { className: 'letter-body' });
  const result = f.preview();
  assert.ok(column(result.pages[0]).scrollHeight >= Math.floor(available(200)), 'long letter must fill useful first-page space');
  assertColumnPreserved(f, result); assertPageStructure(result);
  assert.deepEqual(result.warnings, ['A long block continues on another page.']);
});

test('letter body flows after its salutation even when the whole body could fit a fresh page', () => {
  const f = fixture({ header: 600 }); f.block('Dear reader,', { className: 'letter-salutation' });
  f.block('START_' + 'l'.repeat(590) + '_END', { className: 'letter-body' });
  const result = f.preview();
  assert.equal(result.pages.length, 2);
  assert.ok(column(result.pages[0]).scrollHeight > 400, 'salutation must share the first page with body text');
  assertColumnPreserved(f, result); assertPageStructure(result);
});

test('an oversized CV entry uses the remainder after earlier content', () => {
  const f = fixture(); f.block('INTRO_' + 'i'.repeat(394)); f.block('ENTRY_START_' + 'e'.repeat(1700) + '_ENTRY_END');
  const result = f.preview();
  assert.ok(column(result.pages[0]).scrollHeight >= Math.floor(available(150)), 'oversized entry must split on the partially used page');
  assertColumnPreserved(f, result); assertPageStructure(result);
});

test('a section heading moves with its first body text when only the heading fits the remainder', () => {
  const f = fixture(); const intro = f.block('i'.repeat(864));
  const section = f.document.createElement('section'); section.className = 'cv-section'; section.setAttribute('id', 'experience-section');
  const heading = f.document.createElement('h2'); heading.textContent = 'Experience'; heading.flow = true;
  const paragraph = f.document.createElement('p'); paragraph.textContent = 'BODY_START_' + 'b'.repeat(110); paragraph.flow = true; paragraph.unitHeight = 20;
  section.append(heading, paragraph); f.columnNodes.main.append(section);
  const result = f.preview();
  assert.equal(column(result.pages[0]).textContent, intro.textContent, 'a section heading cannot stand alone at the bottom of a page');
  assert.ok(column(result.pages[1]).textContent.startsWith('ExperienceBODY_START_'), 'the next sheet needs the heading and actual body text together');
  assertColumnPreserved(f, result); assertPageStructure(result);
});

test('salutation moves with the first complete body character when the remainder cannot fit it', () => {
  const f = fixture(); const intro = f.block('i'.repeat(850));
  const salutation = f.block('Dear Hiring Manager,', { className: 'letter-salutation' });
  f.block('😀' + 'body'.repeat(40), { className: 'letter-body', unitHeight: 20, rich: true });
  const result = f.preview();
  assert.equal(column(result.pages[0]).textContent, intro.textContent, 'greeting must not be stranded without any body text');
  assert.ok(column(result.pages[1]).textContent.startsWith(salutation.textContent + '😀'));
  assertColumnPreserved(f, result); assertPageStructure(result);
});

test('an ordinary CV entry that fits a fresh sheet moves intact', () => {
  const f = fixture({ header: 100 }); const first = f.block('FIRST_' + 'f'.repeat(594)); const second = f.block('SECOND_' + 's'.repeat(493));
  const result = f.preview();
  assert.equal(result.pages.length, 2);
  assert.equal(column(result.pages[0]).textContent, first.textContent);
  assert.equal(column(result.pages[1]).textContent, second.textContent);
  assert.equal(column(result.pages[1]).children.length, 1);
  assert.deepEqual(result.warnings, []);
  assertColumnPreserved(f, result); assertPageStructure(result);
});

test('oversized blocks preserve all nested marks and link attributes on every page', () => {
  const f = fixture(); f.block('LINK_START_' + 'formatted😀'.repeat(250) + '_LINK_END', { className: 'letter-body', rich: true });
  const result = f.preview();
  assert.ok(result.pages.length > 2);
  assertColumnPreserved(f, result); assertPageStructure(result);
  for (const page of result.pages) {
    const links = column(page).querySelectorAll('a');
    assert.ok(links.length > 0);
    for (const link of links) {
      assert.equal(link.getAttribute('href'), 'https://example.com/portfolio');
      assert.equal(link.getAttribute('target'), '_blank');
      assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
    }
  }
});

test('mixed adjacent marks, plain gaps and a link crossing a page split stay exact', () => {
  const f = fixture(), text = 'MIXED_START_' + 'x'.repeat(2400) + '_MIXED_END';
  const body = f.block('', { className: 'letter-body' });
  const expectedSplit = Math.floor(available(150) + 1), linkStart = expectedSplit - 30, linkEnd = expectedSplit + 50;
  body.append(renderRichText(text, [
    { start: 0, end: 200, bold: true },
    { start: 200, end: 400, italic: true },
    { start: 500, end: 600, underline: true },
    { start: linkStart, end: linkEnd, href: 'https://example.com/work' },
    { start: 1000, end: 1100, bold: true, italic: true }
  ], { document: f.document }));
  const result = f.preview(), actualSplit = column(result.pages[0]).textContent.length;
  assert.ok(linkStart < actualSplit && actualSplit < linkEnd, 'the link must cross an actual rendered split');
  assertColumnPreserved(f, result); assertPageStructure(result);
  const firstLink = column(result.pages[0]).querySelector('a'), secondLink = column(result.pages[1]).querySelector('a');
  assert.equal(firstLink.textContent + secondLink.textContent, text.slice(linkStart, linkEnd));
  for (const link of [firstLink, secondLink]) {
    assert.equal(link.getAttribute('href'), 'https://example.com/work');
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  }
});

test('a slice wholly inside one marked text node retains its outer ancestry', () => {
  const f = fixture(); const body = f.block('abcdefgh', { rich: true });
  const first = sliceRenderedText(body, 0, 4), last = sliceRenderedText(body, 4, 8);
  assert.equal(first.textContent, 'abcd'); assert.equal(last.textContent, 'efgh');
  assert.deepEqual([...semantics(first), ...semantics(last)], semantics(body));
  assert.equal(first.querySelectorAll('[id]').length, 0);
  assert.equal(first.getAttribute('id'), null);
});

test('surrogate midpoint adjustment terminates and keeps complete characters', () => {
  const f = fixture({ header: 200 }); f.block('a😀b', { className: 'letter-body', unitHeight: 400 });
  const result = f.preview();
  assertColumnPreserved(f, result); assertPageStructure(result);
  assert.equal(column(result.pages[0]).textContent, 'a');
  assert.ok(f.document.measurements < 100, 'search must progress instead of repeating its adjusted midpoint');
});

test('main and side columns paginate independently without reordering or cross-column text', () => {
  const f = fixture({ columns: 2 });
  f.block('MAIN_START_' + 'm'.repeat(2100) + '_MAIN_END');
  f.block('SIDE_START_' + 's'.repeat(1300) + '_SIDE_END', { column: 'side' });
  const result = f.preview();
  assertColumnPreserved(f, result, 'main'); assertColumnPreserved(f, result, 'side'); assertPageStructure(result);
  assert.ok(column(result.pages[0], 'main').scrollHeight > 800);
  assert.ok(column(result.pages[0], 'side').scrollHeight > 800);
});

test('an indivisible character that cannot use the current remainder advances safely', () => {
  const f = fixture({ header: 300 }); f.block('😀x', { className: 'letter-body', unitHeight: 450 });
  const result = f.preview();
  assertColumnPreserved(f, result);
  assert.equal(column(result.pages[0]).textContent, '');
  assert.equal(column(result.pages[1]).textContent, '😀');
  assert.equal(column(result.pages[2]).textContent, 'x');
  assert.equal(result.pages.length, 3, 'no extra trailing measurement sheet may remain');
});

test('arranging pages preserves source DOM and styles and is repeatable', () => {
  const f = fixture(); f.block('MARKER_' + 'Repeat'.repeat(300), { className: 'letter-body', rich: true });
  const snapshot = node => ({ type: node.nodeType, tag: node.tagName, text: node.nodeType === 3 ? node.textContent : null,
    attributes: { ...node.attributes }, dataset: { ...node.dataset }, style: { ...node.style }, children: node.childNodes.map(snapshot) });
  const before = snapshot(f.source), first = f.preview();
  assert.deepEqual(snapshot(f.source), before, 'measurement must not rewrite the normal preview');
  const firstPages = first.pages.map(snapshot), second = f.preview();
  assert.deepEqual(snapshot(f.source), before);
  assert.deepEqual(second.pages.map(snapshot), firstPages);
  assertColumnPreserved(f, second); assertPageStructure(second);
  assert.equal(f.target.children.length, second.pages.length, 'refresh must replace, not append, old pages');
});

test('documents needing over 100 sheets retain the page limit', () => {
  const f = fixture({ header: 0 }); f.block('x'.repeat(101), { className: 'letter-body', unitHeight: 600 });
  assert.equal(MAX_PREVIEW_PAGES, 100);
  assert.throws(() => f.preview(), /over 100 pages/);
  assert.equal(f.target.children.length, 100, 'a failed preview cannot create an unbounded number of sheets');
});
