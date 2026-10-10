export const FONT_FAMILIES = {
  sans: { label: 'Modern sans', css: 'ui-sans-serif, system-ui, sans-serif', word: 'Arial' },
  serif: { label: 'Georgia', css: 'Georgia, serif', word: 'Georgia' },
  mono: { label: 'Monospace', css: 'ui-monospace, monospace', word: 'Courier New' },
  humanist: { label: 'Verdana', css: 'Verdana, Geneva, sans-serif', word: 'Verdana' },
  book: { label: 'Palatino', css: 'Palatino, "Palatino Linotype", "Book Antiqua", serif', word: 'Palatino Linotype' },
  grotesk: { label: 'Arial', css: 'Arial, Helvetica, sans-serif', word: 'Arial' }
};
export const TEMPLATE_CHOICES = [
  ['studio', 'Studio', 1], ['classic', 'Editorial', 1], ['compact', 'Concise', 1],
  ['folio', 'Folio', 2], ['ledger', 'Ledger', 2]
];
export function sectionPlacement(doc, id) {
  if (Object.hasOwn(doc.sectionColumns || {}, id)) return doc.sectionColumns[id];
  return ['education', 'skills'].includes(id) ? 'side' : 'main';
}
export function pageDimensions(pageSize = 'A4') {
  if (!['A4', 'Letter'].includes(pageSize)) throw new Error('Choose A4 or US Letter.');
  const mm = pageSize === 'Letter' ? { width: 215.9, height: 279.4 } : { width: 210, height: 297 };
  return { ...mm, widthPx: mm.width * 96 / 25.4, heightPx: mm.height * 96 / 25.4 };
}
