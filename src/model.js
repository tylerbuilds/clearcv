import { FONT_FAMILIES, TEMPLATE_CHOICES } from './layout.js';
import { validateRichText, transformRuns } from './rich-text.js';
import { checkDeclaredRasterSize } from './raster-size.js';
export const SCHEMA = 'clearcv';
export const VERSION = 1;
export const MAX_DOCUMENT_BYTES = 1_000_000;
export const TEMPLATES = TEMPLATE_CHOICES.map(([id]) => id);
export const ACCENTS = ['#a94f2e', '#2b6b5b', '#385b8f', '#6d4b85', '#272b36'];
export const COLLECTIONS = ['experience', 'education', 'skills'];
const PROFILE_KEYS = ['name', 'headline', 'email', 'phone', 'location', 'website', 'summary'];
const ITEM_KEYS = {
  experience: ['id', 'title', 'organisation', 'location', 'dates', 'description'],
  education: ['id', 'title', 'organisation', 'location', 'dates', 'description'],
  skills: ['id', 'name']
};
const MAX_ITEMS = 60;
function fail(message) { throw new Error(message); }
function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be an object.`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`${label} must contain only plain text fields and values.`);
  }
}
function list(value, label, limit) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) fail(`${label} must be a list with at most ${limit} entries.`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1) fail(`${label} must be a plain list without missing or extra entries.`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`${label} must be a plain list without missing or accessor entries.`);
  }
}
function keys(value, allowed, label, required = allowed) {
  record(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} contains an unsupported field: ${key}.`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${label} is missing ${key}.`);
}
function string(value, label, limit = 10000) {
  if (typeof value !== 'string') fail(`${label} must be text.`);
  if (value.length > limit) fail(`${label} is too long (maximum ${limit} characters).`);
  return value;
}
export function validateDocument(value) {
  const core = ['schema', 'version', 'profile', 'experience', 'education', 'skills', 'style', 'jobAd'];
  keys(value, [...core, 'customSections', 'sectionOrder', 'hiddenSections', 'sectionTitles', 'layout', 'photo', 'coverLetter', 'richText', 'sectionColumns'], 'CV', core);
  value = { ...documentDefaults(), ...value };

  if (value.schema !== SCHEMA || value.version !== VERSION) fail('This backup isn’t a supported ClearCV version 1 document. Choose a CV backup exported by ClearCV.');
  keys(value.profile, PROFILE_KEYS, 'Profile');
  for (const key of PROFILE_KEYS) string(value.profile[key], `Profile ${key}`, key === 'summary' ? 10000 : 300);
  const ids = new Set();
  for (const collection of COLLECTIONS) {
    list(value[collection], collection, MAX_ITEMS);
    for (const item of value[collection]) {
      keys(item, ITEM_KEYS[collection], `${collection} entry`);
      for (const key of ITEM_KEYS[collection]) string(item[key], `${collection} ${key}`, key === 'description' ? 10000 : 300);
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id)) fail('This backup has a missing, invalid or repeated entry ID. Choose another ClearCV backup.');
      ids.add(item.id);
    }
  }
  keys(value.style, ['template', 'accent'], 'Style');
  if (!TEMPLATES.includes(value.style.template)) fail('Choose a supported template.');
  string(value.style.accent, 'Accent colour', 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(value.style.accent)) fail('Enter a six-digit hex colour, such as #a94f2e.');
  string(value.jobAd, 'Job description', 50000);
  list(value.customSections, 'Custom sections', 20);
  for (const section of value.customSections) {
    keys(section, ['id', 'title', 'content'], 'Custom section');
    string(section.id, 'Section ID', 80);
    string(section.title, 'Section title', 100); string(section.content, 'Section content', 30000);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(section.id) || ids.has(section.id) || ['profile', ...COLLECTIONS].includes(section.id)) fail('This backup has a missing, invalid or repeated section ID. Choose another ClearCV backup.');
    ids.add(section.id);
  }
  const sectionIds = ['profile', ...COLLECTIONS, ...value.customSections.map(section => section.id)];
  list(value.sectionOrder, 'Section order', sectionIds.length);
  if (value.sectionOrder.length !== sectionIds.length || new Set(value.sectionOrder).size !== sectionIds.length || value.sectionOrder.some(id => !sectionIds.includes(id))) fail('Section order must contain every section exactly once.');
  list(value.hiddenSections, 'Hidden sections', sectionIds.length);
  if (new Set(value.hiddenSections).size !== value.hiddenSections.length || value.hiddenSections.some(id => !sectionIds.includes(id))) fail('This backup has missing or repeated hidden sections. Choose another ClearCV backup.');
  keys(value.sectionTitles, ['profile', ...COLLECTIONS], 'Section titles');
  for (const title of Object.values(value.sectionTitles)) string(title, 'Section title', 100);
  const layoutCore = ['font', 'fontSize', 'lineHeight', 'spacing', 'margin', 'pageSize'];
  keys(value.layout, [...layoutCore, 'columns', 'columnRatio'], 'Layout', layoutCore);
  value.layout = { ...documentDefaults().layout, ...value.layout };
  if (!Object.hasOwn(FONT_FAMILIES, value.layout.font) || !['A4', 'Letter'].includes(value.layout.pageSize)) fail('Choose a supported font and page size.');
  if (![1, 2].includes(value.layout.columns) || !['balanced', 'wide-main'].includes(value.layout.columnRatio)) fail('Choose one or two columns and a supported column width.');
  for (const [key, minimum, maximum] of [['fontSize', 9, 15], ['lineHeight', 1.2, 2.2], ['spacing', 8, 28], ['margin', 20, 60]]) if (typeof value.layout[key] !== 'number' || !Number.isFinite(value.layout[key]) || value.layout[key] < minimum || value.layout[key] > maximum) fail(`Layout ${key} must be between ${minimum} and ${maximum}.`);
  string(value.photo, 'Photo', 250000);
  if (value.photo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.photo)) fail('Photo must be an embedded PNG, JPEG or WebP image.');
  if (value.photo) {
    let encoded;
    try { encoded = atob(value.photo.slice(value.photo.indexOf(',') + 1)); }
    catch { encoded = null; } // Preserve older syntax-accepted incomplete photos.
    if (encoded !== null) {
      const bytes = Uint8Array.from(encoded, character => character.charCodeAt(0));
      checkDeclaredRasterSize(bytes, value.photo.slice(5, value.photo.indexOf(';')));
    }
  }
  keys(value.coverLetter, ['company', 'role', 'recipient', 'date', 'subject', 'salutation', 'body', 'closing'], 'Cover letter');
  for (const [key, text] of Object.entries(value.coverLetter)) string(text, `Cover letter ${key}`, key === 'body' ? 30000 : 300);
  keys(value.sectionColumns, sectionIds, 'Column placement', []);
  if (Object.values(value.sectionColumns).some(column => !['main', 'side'].includes(column))) fail('Place sections in the main or side column.');
  value.richText = validateRichText(value.richText, key => resolveRichTextField(value, key));

  if (new TextEncoder().encode(JSON.stringify(value, null, 2)).length > MAX_DOCUMENT_BYTES) fail('This CV is too large (maximum 1 MB). Shorten its content before saving or exporting.');
  return structuredClone(value);
}
export function documentDefaults() {
  return {
    customSections: [], sectionOrder: ['profile', 'experience', 'education', 'skills'], hiddenSections: [],
    sectionTitles: { profile: 'Profile', experience: 'Experience', education: 'Education', skills: 'Skills' },
    layout: { font: 'sans', fontSize: 11, lineHeight: 1.7, spacing: 20, margin: 46, pageSize: 'A4', columns: 1, columnRatio: 'wide-main' }, photo: '',
    richText: {}, sectionColumns: {},
    coverLetter: { company: '', role: '', recipient: '', date: '', subject: '', salutation: 'Dear hiring team,', body: '', closing: 'Kind regards,' }
  };
}
export function createDocument() {
  return {
    ...documentDefaults(), schema: SCHEMA, version: VERSION,
    profile: Object.fromEntries(PROFILE_KEYS.map(key => [key, ''])),
    experience: [], education: [], skills: [],
    style: { template: 'studio', accent: ACCENTS[0] }, jobAd: ''
  };
}
export function sampleDocument() {
  return {
    ...createDocument(),
    profile: {
      name: 'Alex Morgan', headline: 'Product designer', email: 'alex@example.com', phone: '+44 7700 900000',
      location: 'Bristol, UK', website: 'alexmorgan.example',
      summary: 'Product designer with six years of experience designing digital services. I work with researchers and engineers to turn customer needs into useful, accessible products.'
    },
    experience: [
      { id: 'exp-1', title: 'Senior Product Designer', organisation: 'Northstar Studio', location: 'Bristol', dates: '2022 — Present', description: 'Redesigned the customer sign-up process, reducing the time to complete setup by 32%.\nBuilt a design system used by four product teams.\nWorked with engineers and researchers to test prototypes and release new features.' },
      { id: 'exp-2', title: 'Product Designer', organisation: 'Fieldwork', location: 'London', dates: '2019 — 2022', description: 'Designed accessible tools for independent businesses using findings from customer research.\nDesigned and tested prototypes with 40 customers across three markets.' }
    ],
    education: [{ id: 'edu-1', title: 'BA (Hons) Design', organisation: 'University of the West of England', location: 'Bristol', dates: '2016 — 2019', description: 'First-class honours. Focus on human-centred design and visual communication.' }],
    skills: ['Product design', 'User research', 'Prototyping', 'Design systems', 'Accessibility', 'Figma'].map((name, i) => ({ id: `skill-${i + 1}`, name }))
  };
}
export function parseDocument(json) {
  if (typeof json !== 'string' || json.length > MAX_DOCUMENT_BYTES || new TextEncoder().encode(json).length > MAX_DOCUMENT_BYTES) fail('Choose a ClearCV JSON file smaller than 1 MB.');
  let value;
  try { value = JSON.parse(json); } catch { fail('This file isn’t valid JSON. Choose a ClearCV JSON backup.'); }
  return validateDocument(value);
}
export function serialiseDocument(document) { return JSON.stringify(validateDocument(document), null, 2); }
export function addItem(document, collection, id) {
  if (!COLLECTIONS.includes(collection)) fail('Unknown section.');
  const next = validateDocument(document);
  if (next[collection].length >= MAX_ITEMS) fail(`You can add up to ${MAX_ITEMS} entries in this section.`);
  const item = Object.fromEntries(ITEM_KEYS[collection].map(key => [key, key === 'id' ? id : '']));
  next[collection].push(item);
  return validateDocument(next);
}
export function updateItem(document, collection, id, field, value) {
  if (!COLLECTIONS.includes(collection) || !ITEM_KEYS[collection].includes(field) || field === 'id') fail('Unknown editable field.');
  const next = validateDocument(document);
  const item = next[collection].find(item => item.id === id);
  if (!item) fail('Entry not found.');
  item[field] = value;
  const key = `${collection}.${id}.${field}`;
  if (field === 'description' && Object.hasOwn(next.richText, key)) next.richText[key] = transformRuns(document[collection].find(item => item.id === id)[field], value, next.richText[key]);
  return validateDocument(next);
}
export function removeItem(document, collection, id) {
  if (!COLLECTIONS.includes(collection)) fail('Unknown section.');
  const next = validateDocument(document);
  if (!next[collection].some(item => item.id === id)) fail('Entry not found.');
  next[collection] = next[collection].filter(item => item.id !== id);
  for (const key of Object.keys(next.richText)) if (key.startsWith(`${collection}.${id}.`)) delete next.richText[key];
  return next;
}
export function moveItem(document, collection, id, direction) {
  if (!COLLECTIONS.includes(collection) || ![-1, 1].includes(direction)) fail('Invalid move.');
  const next = validateDocument(document);
  const list = next[collection];
  const position = list.findIndex(item => item.id === id);
  if (position < 0) fail('Entry not found.');
  const target = position + direction;
  if (target >= 0 && target < list.length) [list[position], list[target]] = [list[target], list[position]];
  return next;
}
const STOP_WORDS = new Set('a an and are as at be been being but by can candidate company could day do experience for from full good have help i in including into is it job join knowledge looking make more must of on or our people please position required responsibilities role seeking skills strong team that the their this time to us we will with work working would you your years year ability across all also any application applications business customer customers excellent new opportunity proven relevant successful support understanding using well who'.split(' '));
export function tokenise(text) {
  return (text.toLocaleLowerCase('en-GB').match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) || [])
    .map(word => word.replace(/[.-]+$/g, ''))
    .filter(word => (word.length >= 3 || ['ai', 'ui', 'ux', 'c#'].includes(word)) && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}
export function keywordFeedback(document, jobAd = document.jobAd) {
  const counts = new Map();
  for (const word of tokenise(jobAd)) counts.set(word, (counts.get(word) || 0) + 1);
  const keywords = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en-GB')).slice(0, 24).map(([word]) => word);
  const profile = document.profile;
  const hidden = new Set(document.hiddenSections || []);
  const cvText = [profile.headline, hidden.has('profile') ? '' : profile.summary, ...(hidden.has('experience') ? [] : document.experience).flatMap(({ title, organisation, description }) => [title, organisation, description]), ...(hidden.has('education') ? [] : document.education).flatMap(({ title, description }) => [title, description]), ...(hidden.has('skills') ? [] : document.skills).map(({ name }) => name), ...(document.customSections || []).filter(section => !hidden.has(section.id)).map(section => `${section.title} ${section.content}`)].join(' ');
  const present = new Set(tokenise(cvText));
  const found = keywords.filter(word => present.has(word));
  const missing = keywords.filter(word => !present.has(word));
  return { keywords, found, missing, percentage: keywords.length ? Math.round(found.length / keywords.length * 100) : null };
}

export function addCustomSection(document, id, title = 'Projects') {
  const next = validateDocument(document);
  next.customSections.push({ id, title, content: '' });
  next.sectionOrder.push(id);
  return validateDocument(next);
}
export function removeCustomSection(document, id) {
  const next = validateDocument(document);
  if (!next.customSections.some(section => section.id === id)) fail('Custom section not found.');
  next.customSections = next.customSections.filter(section => section.id !== id);
  next.sectionOrder = next.sectionOrder.filter(section => section !== id);
  next.hiddenSections = next.hiddenSections.filter(section => section !== id);
  delete next.sectionColumns[id];
  delete next.richText[`customSections.${id}.content`];
  return validateDocument(next);
}
export function moveSection(document, id, direction) {
  const next = validateDocument(document);
  if (![-1, 1].includes(direction)) fail('Invalid section move.');
  const index = next.sectionOrder.indexOf(id);
  if (index < 0) fail('Section not found.');
  const target = index + direction;
  if (target >= 0 && target < next.sectionOrder.length) [next.sectionOrder[index], next.sectionOrder[target]] = [next.sectionOrder[target], next.sectionOrder[index]];
  return next;
}
export function plainTextDocument(document, kind = 'cv') {
  const doc = validateDocument(document);
  const p = doc.profile;
  if (kind === 'letter') return [p.name, [p.email, p.phone, p.location, p.website].filter(Boolean).join(' · '), doc.coverLetter.date, doc.coverLetter.recipient, doc.coverLetter.company, doc.coverLetter.subject || doc.coverLetter.role, doc.coverLetter.salutation, doc.coverLetter.body, doc.coverLetter.closing, p.name].filter(Boolean).join('\n\n');
  const parts = [p.name, p.headline, [p.email, p.phone, p.location, p.website].filter(Boolean).join(' · ')];
  for (const id of doc.sectionOrder) {
    if (doc.hiddenSections.includes(id)) continue;
    if (id === 'profile' && p.summary.trim()) parts.push(`${doc.sectionTitles.profile}\n${p.summary}`);
    else if (['experience', 'education'].includes(id) && doc[id].length) parts.push(`${doc.sectionTitles[id]}\n` + doc[id].map(item => [item.title, item.organisation, item.location, item.dates, item.description].filter(Boolean).join('\n')).join('\n\n'));
    else if (id === 'skills' && doc.skills.length) parts.push(`${doc.sectionTitles.skills}\n${doc.skills.map(item => item.name).filter(Boolean).join(', ')}`);
    else {
      const section = doc.customSections.find(section => section.id === id);
      if (section?.content.trim()) parts.push(`${section.title}\n${section.content}`);
    }
  }
  return parts.filter(Boolean).join('\n\n');
}

/** Stable formatting keys address existing plain-text fields, never object paths. */
export function resolveRichTextField(doc, key) {
  if (key === 'profile.summary') return doc.profile.summary;
  if (key === 'coverLetter.body') return doc.coverLetter.body;
  const match = /^(experience|education|customSections)\.([a-zA-Z0-9_-]{1,80})\.(description|content)$/.exec(key);
  if (!match || (match[1] === 'customSections') !== (match[3] === 'content')) return undefined;
  return doc[match[1]].find(item => item.id === match[2])?.[match[3]];
}
export function reconcileRichText(previous, candidate) {
  const next = { ...candidate, richText: { ...(candidate.richText || {}) } };
  for (const [key, runs] of Object.entries(previous.richText || {})) {
    const oldText = resolveRichTextField(previous, key), newText = resolveRichTextField(next, key);
    if (newText === undefined) delete next.richText[key];
    else if (oldText !== newText) {
      const shifted = transformRuns(oldText, newText, runs);
      if (shifted.length) next.richText[key] = shifted;
      else delete next.richText[key];
    }
  }
  return next;
}
