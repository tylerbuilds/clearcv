import { pageDimensions } from './layout.js';
import { isTextBoundary } from './rich-text.js';

export const MAX_PREVIEW_PAGES = 100;
function stripIds(node) {
  node.removeAttribute?.('id');
  for (const child of node.querySelectorAll?.('[id]') || []) child.removeAttribute('id');
  return node;
}
function clone(node) { return stripIds(node.cloneNode(true)); }
/** Slice rendered text while retaining each safe ancestor mark and link. */
export function sliceRenderedText(node, start, end) {
  const document = node.ownerDocument, text = node.textContent;
  if (!isTextBoundary(text, start) || !isTextBoundary(text, end) || end <= start) throw new Error('Choose a valid page text range.');
  function slice(current, offset) {
    if (current.nodeType === 3) return document.createTextNode(current.textContent.slice(Math.max(0, start - offset), Math.min(current.textContent.length, end - offset)));
    const copy = stripIds(current.cloneNode(false));
    let cursor = offset;
    for (const child of current.childNodes) {
      const length = child.textContent.length;
      if (length && cursor < end && cursor + length > start) copy.append(slice(child, cursor));
      cursor += length;
    }
    return copy;
  }
  return slice(node, 0);
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
  const originalNodes = [source, ...source.querySelectorAll('*')];
  source = clone(source);
  const measuredNodes = [source, ...source.querySelectorAll('*')];
  for (let index = 0; index < originalNodes.length; index++) {
    const node = measuredNodes[index], computed = document.defaultView.getComputedStyle(originalNodes[index]);
    for (const property of ['font-family', 'font-size', 'line-height', 'letter-spacing', 'margin-top', 'margin-bottom', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'border-left-width', 'border-right-width']) node.style.setProperty(property, computed.getPropertyValue(property));
    if (node.tagName === 'IMG') { node.style.width = computed.width; node.style.height = computed.height; }
  }
  // The rendered greeting is the paragraph immediately before the letter body.
  // Mark only this measured clone so it can stay with the first body text.
  for (const body of source.querySelectorAll('.letter-body')) {
    const siblings = [...body.parentNode.children], greeting = siblings[siblings.indexOf(body) - 1];
    if (greeting?.tagName === 'P') greeting.classList.add('letter-salutation');
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
    const canContinue = hadContent || index === 0 && sourceHeader;
    // Keep a normal entry together if it fits a fresh sheet. Oversized blocks
    // use the original page's remaining space; letter bodies flow continuously.
    if (canContinue && !node.matches('.letter-body')) {
      const fresh = page(index + 1), freshColumn = fresh.columns[name] || fresh.columns.main;
      freshColumn.append(node);
      if (fits(fresh, freshColumn)) return index + 1;
      node.remove();
    }
    const pieces = smallerBlocks(node);
    if (pieces.length > 1) {
      for (const piece of pieces) index = place(piece, name, index, depth + 1);
      return index;
    }
    const text = node.textContent;
    if (!text.length) throw new Error('An image or block is too tall for the page. Reduce its size.');
    // Find the largest prefix fitting the remainder, cloning its DOM ancestry
    // so marks and links stay attached without reinterpreting HTML.
    let low = 1, high = text.length - 1, best = 0;
    while (low <= high) {
      const midpoint = Math.floor((low + high) / 2);
      let middle = midpoint;
      if (!isTextBoundary(text, middle)) middle--;
      if (middle < 1) { low = midpoint + 1; continue; }
      const prefix = sliceRenderedText(node, 0, middle); column.append(prefix);
      const accepted = fits(current, column); prefix.remove();
      if (accepted) { best = middle; low = midpoint + 1; } else high = middle - 1;
    }
    if (best) {
      const prefixText = text.slice(0, best), boundary = Math.max(prefixText.lastIndexOf('\n'), prefixText.lastIndexOf(' '));
      if (boundary > best / 2) best = boundary + 1;
    }
    while (!isTextBoundary(text, best)) best--;
    const heading = node.matches('.cv-section') ? node.querySelector(':scope > h2') : null;
    const followingStart = heading?.textContent.length || 0;
    const nextText = text.slice(followingStart).search(/\S/u);
    // A section heading or greeting alone is not a useful first fragment.
    if (!best || nextText >= 0 && best <= followingStart + nextText) {
      const greeting = node.matches('.letter-body') ? [...column.children].at(-1) : null;
      if (greeting?.matches('.letter-salutation')) {
        if (index > 0 && column.children.length === 1) throw new Error('The greeting and first letter text cannot fit on the selected page. Reduce text size or use normal print.');
        greeting.remove();
        const fresh = page(index + 1), freshColumn = fresh.columns[name] || fresh.columns.main;
        freshColumn.append(greeting);
        return place(node, name, index + 1, depth + 1);
      }
      if (canContinue) return place(node, name, index + 1, depth + 1);
      throw new Error('Some text cannot fit on the selected page. Reduce text size or use normal print.');
    }
    column.append(sliceRenderedText(node, 0, best));
    warnings.push('A long block continues on another page.');
    return place(sliceRenderedText(node, best, text.length), name, index + 1, depth + 1);
  }
  page(0);
  for (const sourceColumn of sources) {
    let index = 0;
    for (const block of sourceColumn.blocks) index = place(clone(block), sourceColumn.name, index);
  }
  // Measuring a candidate on a fresh page must not leave a blank final sheet.
  while (pages.length > 1 && Object.values(pages.at(-1).columns).every(column => column.children.length === 0)) pages.pop().sheet.remove();
  for (let index = 0; index < pages.length; index++) {
    const footer = document.createElement('div'); footer.className = 'page-footer'; footer.textContent = `${index + 1} / ${pages.length}`;
    pages[index].sheet.append(footer); pages[index].sheet.setAttribute('aria-label', `Page ${index + 1} of ${pages.length}`);
  }
  return { pages: pages.map(item => item.sheet), warnings: [...new Set(warnings)], dimensions };
}
