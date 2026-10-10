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
  ['folio', 'Folio', 2], ['ledger', 'Ledger', 2],
  ['atlas', 'Atlas', 2], ['letterpress', 'Letterpress', 1], ['signal', 'Signal', 1],
  ['outline', 'Outline', 1], ['typewriter', 'Typewriter', 1], ['margin', 'Margin', 2]
];
export const TEMPLATE_DESCRIPTIONS = Object.freeze({
  studio: 'Clear single column', classic: 'Centred serif headings', compact: 'Compact, with a vertical rule',
  folio: 'Serif headings, two columns', ledger: 'A quiet right sidebar',
  atlas: 'Left sidebar, humanist type', letterpress: 'A spacious serif masthead', signal: 'A strong ink masthead',
  outline: 'Section labels in the margin', typewriter: 'Ruled, with monospace type', margin: 'Large name, editorial columns'
});
// Applied only when choosing a new layout; saved documents retain their own
// adjustments. The original five choices continue to preserve custom type.
export const TEMPLATE_LAYOUTS = Object.freeze({
  atlas: Object.freeze({ font: 'humanist', fontSize: 14, lineHeight: 1.65, spacing: 17, margin: 42, columnRatio: 'wide-main' }),
  letterpress: Object.freeze({ font: 'book', fontSize: 14.5, lineHeight: 1.8, spacing: 23, margin: 52 }),
  signal: Object.freeze({ font: 'grotesk', fontSize: 14.5, lineHeight: 1.65, spacing: 18, margin: 42 }),
  outline: Object.freeze({ font: 'sans', fontSize: 14, lineHeight: 1.65, spacing: 18, margin: 42 }),
  typewriter: Object.freeze({ font: 'mono', fontSize: 14, lineHeight: 1.65, spacing: 17, margin: 44 }),
  margin: Object.freeze({ font: 'serif', fontSize: 14.5, lineHeight: 1.75, spacing: 22, margin: 48, columnRatio: 'wide-main' })
});
export function sectionPlacement(doc, id) {
  if (Object.hasOwn(doc.sectionColumns || {}, id)) return doc.sectionColumns[id];
  return ['education', 'skills'].includes(id) ? 'side' : 'main';
}
export function pageDimensions(pageSize = 'A4') {
  if (!['A4', 'Letter'].includes(pageSize)) throw new Error('Choose A4 or US Letter.');
  const mm = pageSize === 'Letter' ? { width: 215.9, height: 279.4 } : { width: 210, height: 297 };
  return { ...mm, widthPx: mm.width * 96 / 25.4, heightPx: mm.height * 96 / 25.4 };
}
