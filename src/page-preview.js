import { pageDimensions } from './layout.js';
import { isTextBoundary } from './rich-text.js';

export const MAX_PREVIEW_PAGES = 100;
function stripIds(node) {
  node.removeAttribute?.('id');
  for (const child of node.querySelectorAll?.('[id]') || []) child.removeAttribute('id');
  return node;
}
function clone(node) { return stripIds(node.cloneNode(true)); }
/** Slice only rendered text, retaining safe DOM marks and links. No HTML parser. */
export function sliceRenderedText(node, start, end) {
  const document = node.ownerDocument, text = node.textContent;
  if (!isTextBoundary(text, start) || !isTextBoundary(text, end) || end <= start) throw new Error('Choose a valid page text range.');
  const walker = document.createTreeWalker(node, 4);
  const texts = []; let total = 0;
  while (walker.nextNode()) { const current = walker.currentNode; texts.push({ node: current, start: total, end: total + current.textContent.length }); total += current.textContent.length; }
  const first = texts.find(item => item.end > start), last = texts.find(item => item.end >= end && item.start < end);
  if (!first || !last) throw new Error('The preview text changed. Open page preview again.');
  const range = document.createRange();
  range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
  const copy = stripIds(node.cloneNode(false)); copy.append(range.cloneContents());
  range.detach(); return copy;
}
function smallerBlocks(node) {
  if (node.matches('.cv-section') && node.children.length > 2) {
    const heading = node.querySelector(':scope > h2');
    return [...node.children].filter(child => child !== heading).map(child => {
      const section = stripIds(node.cloneNode(false)); if (heading) section.append(clone(heading)); section.append(clone(child)); return section;
    });
  }
  const bullets = node.matches('.cv-entry') ? node.querySelector(':scope > .cv-bullets') : null;
  if (bullets?.children.length > 1) return [...bullets.children].map((bullet, index) => {
    const entry = stripIds(node.cloneNode(false));
    if (index === 0) for (const child of node.children) if (child !== bullets) entry.append(clone(child));
    const list = stripIds(bullets.cloneNode(false)); list.append(clone(bullet)); entry.append(list); return entry;
  });
  // Split a one-entry section before trying its text. Keep its heading on the
  // first part, rather than copying a long entry into another empty page.
  if (node.matches('.cv-section') && node.children.length === 2 && node.children[1].matches('.cv-entry')) {
    const pieces = smallerBlocks(node.children[1]);
    if (pieces.length > 1) return pieces.map((piece, index) => {
      const section = stripIds(node.cloneNode(false)); if (index === 0) section.append(clone(node.children[0])); section.append(piece); return section;
    });
  }
  return [node];
}

/** Measure actual rendered text in fixed paper dimensions before scaling it. */
export function buildPagePreview(source, target, layout) {
  if (!source?.ownerDocument || !target?.isConnected) throw new Error('Open page preview before arranging pages.');
  const document = source.ownerDocument, dimensions = pageDimensions(layout.pageSize);
  // Freeze typography and vertical spacing used for measurement. Print media
  // otherwise changes heading sizes/margins after pages have been arranged.
  for (const node of [source, ...source.querySelectorAll('*')]) {
    const computed = document.defaultView.getComputedStyle(node);
    for (const property of ['font-family', 'font-size', 'line-height', 'letter-spacing', 'margin-top', 'margin-bottom', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'border-left-width', 'border-right-width']) node.style.setProperty(property, computed.getPropertyValue(property));
    if (node.tagName === 'IMG') { node.style.width = computed.width; node.style.height = computed.height; }
  }
  target.replaceChildren();
  const sourceHeader = source.querySelector(':scope > .cv-header');
  const originalColumns = source.querySelector(':scope > .cv-columns');
  const twoColumns = Boolean(originalColumns?.classList.contains('columns-2'));
  const sources = originalColumns ? [...originalColumns.children].map(column => ({ name: column.dataset.cvColumn, blocks: [...column.children] }))
    : [{ name: 'main', blocks: [...source.children].filter(node => node !== sourceHeader) }];
  const pages = [], warnings = [];
  function page(index) {
    while (pages.length <= index) {
      if (pages.length >= MAX_PREVIEW_PAGES) throw new Error('This preview is over 100 pages. Shorten the CV or use the normal print view.');
      const sheet = stripIds(source.cloneNode(false));
      sheet.classList.add('print-page'); sheet.dataset.page = String(pages.length + 1);
      sheet.style.width = `${dimensions.widthPx}px`; sheet.style.height = `${dimensions.heightPx}px`;
      sheet.style.minHeight = '0'; sheet.style.padding = `${layout.margin}px`;
      if (pages.length === 0 && sourceHeader) sheet.append(clone(sourceHeader));
      const grid = originalColumns ? stripIds(originalColumns.cloneNode(false)) : document.createElement('div');
      grid.className = `cv-columns columns-${twoColumns ? 2 : 1} ratio-${layout.columnRatio || 'wide-main'}`;
      const columns = {};
      for (const name of twoColumns ? ['main', 'side'] : ['main']) {
        const original = [...(originalColumns?.children || [])].find(column => column.dataset.cvColumn === name);
        const column = original ? stripIds(original.cloneNode(false)) : document.createElement('div');
        column.className = `cv-column cv-column-${name}`; column.dataset.cvColumn = name;
        grid.append(column); columns[name] = column;
      }
      sheet.append(grid); target.append(sheet);
      // Keep the measured column width when print media changes its gap.
      grid.style.gap = document.defaultView.getComputedStyle(grid).gap;
      const top = grid.getBoundingClientRect().top - sheet.getBoundingClientRect().top;
      const available = dimensions.heightPx - layout.margin - top - 2;
      if (available < 80) throw new Error('The header is too tall for the selected paper. Shorten it or reduce text size.');
      pages.push({ sheet, grid, columns, available });
    }
    return pages[index];
  }
  const fits = (current, column) => column.scrollHeight <= current.available + 1;
  function place(node, name, index, depth = 0) {
    if (depth > MAX_PREVIEW_PAGES * 2) throw new Error('Some content cannot fit on a page. Shorten it or use the normal print view.');
    let current = page(index), column = current.columns[name] || current.columns.main;
    const hadContent = column.children.length > 0;
    column.append(node);
    if (fits(current, column)) return index;
    node.remove();
    // Use the next page before splitting an entry that fits on a fresh sheet.
    if (hadContent || index === 0 && sourceHeader) {
      index++; current = page(index); column = current.columns[name] || current.columns.main;
      column.append(node);
      if (fits(current, column)) return index;
      node.remove();
    }
    const pieces = smallerBlocks(node);
    if (pieces.length > 1) {
      for (const piece of pieces) index = place(piece, name, index, depth + 1);
      return index;
    }
    const text = node.textContent;
    if (text.length < 2) throw new Error('An image or block is too tall for the page. Reduce its size.');
    // Find the largest text prefix fitting the remaining page, preserving DOM
    // formatting through Range.cloneContents rather than reinterpreting HTML.
    let low = 1, high = text.length - 1, best = 0;
    while (low <= high) {
      let middle = Math.floor((low + high) / 2);
      if (!isTextBoundary(text, middle)) middle--;
      if (middle < 1) { low = 2; continue; }
      const prefix = sliceRenderedText(node, 0, middle); column.append(prefix);
      const accepted = fits(current, column); prefix.remove();
      if (accepted) { best = middle; low = middle + 1; } else high = middle - 1;
    }
    if (!best) throw new Error('Some text cannot fit on the selected page. Reduce text size or use normal print.');
    const prefixText = text.slice(0, best), boundary = Math.max(prefixText.lastIndexOf('\n'), prefixText.lastIndexOf(' '));
    if (boundary > best / 2) best = boundary + 1;
    while (!isTextBoundary(text, best)) best--;
    column.append(sliceRenderedText(node, 0, best));
    warnings.push('A long block continues on another page.');
    return place(sliceRenderedText(node, best, text.length), name, index + 1, depth + 1);
  }
  page(0);
  for (const sourceColumn of sources) {
    let index = 0;
    for (const block of sourceColumn.blocks) index = place(clone(block), sourceColumn.name, index);
  }
  // A moved first block may leave only the first-page header, which is valid.
  for (let index = 0; index < pages.length; index++) {
    const footer = document.createElement('div'); footer.className = 'page-footer'; footer.textContent = `${index + 1} / ${pages.length}`;
    pages[index].sheet.append(footer); pages[index].sheet.setAttribute('aria-label', `Page ${index + 1} of ${pages.length}`);
  }
  return { pages: pages.map(item => item.sheet), warnings: [...new Set(warnings)], dimensions };
}
