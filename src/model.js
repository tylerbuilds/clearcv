export const SCHEMA = 'clearcv';
export const VERSION = 1;
export const MAX_DOCUMENT_BYTES = 1_000_000;
export const TEMPLATES = ['studio', 'classic', 'compact'];
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
}
function keys(value, allowed, label) {
  record(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} contains an unsupported field: ${key}.`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) fail(`${label} is missing ${key}.`);
}
function string(value, label, limit = 10000) {
  if (typeof value !== 'string') fail(`${label} must be text.`);
  if (value.length > limit) fail(`${label} is too long (maximum ${limit} characters).`);
  return value;
}
export function validateDocument(value) {
  keys(value, ['schema', 'version', 'profile', 'experience', 'education', 'skills', 'style', 'jobAd'], 'CV');
  if (value.schema !== SCHEMA || value.version !== VERSION) fail('This file is not a supported ClearCV version 1 document.');
  keys(value.profile, PROFILE_KEYS, 'Profile');
  for (const key of PROFILE_KEYS) string(value.profile[key], `Profile ${key}`, key === 'summary' ? 10000 : 300);
  const ids = new Set();
  for (const collection of COLLECTIONS) {
    if (!Array.isArray(value[collection]) || value[collection].length > MAX_ITEMS) fail(`${collection} must be a list with at most ${MAX_ITEMS} entries.`);
    for (const item of value[collection]) {
      keys(item, ITEM_KEYS[collection], `${collection} entry`);
      for (const key of ITEM_KEYS[collection]) string(item[key], `${collection} ${key}`, key === 'description' ? 10000 : 300);
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id)) fail('Every entry must have a unique valid ID.');
      ids.add(item.id);
    }
  }
  keys(value.style, ['template', 'accent'], 'Style');
  if (!TEMPLATES.includes(value.style.template)) fail('Choose a supported template.');
  if (!/^#[0-9a-fA-F]{6}$/.test(value.style.accent)) fail('The accent must be a six-digit hex colour.');
  string(value.jobAd, 'Job description', 50000);
  if (new TextEncoder().encode(JSON.stringify(value, null, 2)).length > MAX_DOCUMENT_BYTES) fail('This CV is too large (maximum 1 MB). Shorten its content before saving or exporting.');
  return structuredClone(value);
}
export function createDocument() {
  return {
    schema: SCHEMA, version: VERSION,
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
      summary: 'I make complex things feel simple. Product designer with six years of experience turning research into thoughtful digital services. I bring clarity, curiosity and care to teams building for real people.'
    },
    experience: [
      { id: 'exp-1', title: 'Senior Product Designer', organisation: 'Northstar Studio', location: 'Bristol', dates: '2022 — Present', description: 'Led the redesign of a customer onboarding journey, reducing time to first value by 32%.\nBuilt a design system used by four product teams.\nPartnered with engineers and researchers to test, learn and ship.' },
      { id: 'exp-2', title: 'Product Designer', organisation: 'Fieldwork', location: 'London', dates: '2019 — 2022', description: 'Translated customer research into accessible tools for independent businesses.\nDesigned and tested prototypes with 40 customers across three markets.' }
    ],
    education: [{ id: 'edu-1', title: 'BA (Hons) Design', organisation: 'University of the West of England', location: 'Bristol', dates: '2016 — 2019', description: 'First-class honours. Focus on human-centred design and visual communication.' }],
    skills: ['Product design', 'User research', 'Prototyping', 'Design systems', 'Accessibility', 'Figma'].map((name, i) => ({ id: `skill-${i + 1}`, name }))
  };
}
export function parseDocument(json) {
  if (typeof json !== 'string' || json.length > MAX_DOCUMENT_BYTES || new TextEncoder().encode(json).length > MAX_DOCUMENT_BYTES) fail('Choose a ClearCV JSON file smaller than 1 MB.');
  let value;
  try { value = JSON.parse(json); } catch { fail('This file is not valid JSON.'); }
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
  return validateDocument(next);
}
export function removeItem(document, collection, id) {
  if (!COLLECTIONS.includes(collection)) fail('Unknown section.');
  const next = validateDocument(document);
  if (!next[collection].some(item => item.id === id)) fail('Entry not found.');
  next[collection] = next[collection].filter(item => item.id !== id);
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
  const cvText = [profile.headline, profile.summary, ...document.experience.flatMap(({ title, organisation, description }) => [title, organisation, description]), ...document.education.flatMap(({ title, description }) => [title, description]), ...document.skills.map(({ name }) => name)].join(' ');
  const present = new Set(tokenise(cvText));
  const found = keywords.filter(word => present.has(word));
  const missing = keywords.filter(word => !present.has(word));
  return { keywords, found, missing, percentage: keywords.length ? Math.round(found.length / keywords.length * 100) : null };
}
