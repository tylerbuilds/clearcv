import { validateDocument } from './model.js';
import { addDocument, validateWorkspace } from './workspace.js';

export const IMPORT_PROFILE_FIELDS = ['name', 'headline', 'email', 'phone', 'location', 'website', 'summary'];
const COLLECTIONS = ['experience', 'education', 'skills'];
const MODES = ['append', 'replace', 'keep'];
const comparable = item => JSON.stringify(Object.fromEntries(Object.keys(item).filter(key => key !== 'id').sort().map(key => [key, item[key]])));
function record(value, allowed, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !allowed.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
  })) throw new Error(message);
  return Object.assign(Object.create(null), value);
}
function profileSelection(value) {
  const message = 'Choose each supported profile field once.';
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > IMPORT_PROFILE_FIELDS.length) throw new Error(message);
  const keys = Reflect.ownKeys(value).filter(key => key !== 'length');
  if (keys.length !== value.length || keys.some((key, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return key !== String(index) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
  }) || new Set(value).size !== value.length || value.some(key => !IMPORT_PROFILE_FIELDS.includes(key))) throw new Error(message);
}

/** A merge creates a separate document. The caller never replaces the source CV. */
export function mergeReviewedDocument(current, imported, options = {}) {
  const { profileFields = [], sectionModes = {}, idPrefix = 'reviewed' } = record(options, ['profileFields', 'sectionModes', 'idPrefix'], 'Choose supported reviewed import options.');
  const next = validateDocument(current);
  const incoming = validateDocument(imported);
  profileSelection(profileFields);
  const modes = record(sectionModes, COLLECTIONS, 'Choose whether to add, replace or keep the entries in each section.');
  if (Object.values(modes).some(value => !MODES.includes(value))) throw new Error('Choose whether to add, replace or keep the entries in each section.');
  if (typeof idPrefix !== 'string' || !/^[a-zA-Z0-9_-]{1,55}$/.test(idPrefix)) throw new Error('Use a valid imported CV identifier.');
  for (const key of profileFields) next.profile[key] = incoming.profile[key];
  const used = new Set([...next.experience, ...next.education, ...next.skills, ...next.customSections].map(item => item.id));
  let sequence = 0;
  const identifier = () => { let id; do { id = `${idPrefix}-${++sequence}`; } while (used.has(id)); used.add(id); return id; };
  for (const collection of COLLECTIONS) {
    const mode = modes[collection] || 'append';
    if (mode === 'keep') continue;
    if (mode === 'replace') next[collection] = [];
    const seen = new Set(next[collection].map(comparable));
    for (const item of incoming[collection]) {
      const key = comparable(item);
      if (seen.has(key)) continue;
      next[collection].push({ ...item, id: identifier() }); seen.add(key);
    }
  }
  // Keep source evidence and other imported sections even when a career list is
  // explicitly skipped. Hidden source text is never silently dropped by merging.
  for (const section of incoming.customSections) {
    const duplicate = next.customSections.find(existing => existing.title === section.title && existing.content === section.content);
    if (duplicate && next.hiddenSections.includes(duplicate.id) === incoming.hiddenSections.includes(section.id)) continue;
    const id = identifier();
    next.customSections.push({ ...section, id }); next.sectionOrder.push(id);
    if (incoming.hiddenSections.includes(section.id)) next.hiddenSections.push(id);
  }
  return validateDocument(next);
}

export function createReviewedImport(workspace, document, options = {}) {
  const { id, name, mode = 'new', targetId, profileFields = [], sectionModes = {} } = record(options, ['id', 'name', 'mode', 'targetId', 'profileFields', 'sectionModes'], 'Choose supported reviewed import options.');
  const current = validateWorkspace(workspace);
  if (!['new', 'merge'].includes(mode)) throw new Error('Choose a new CV or an updated copy.');
  let reviewed = validateDocument(document);
  if (mode === 'merge') {
    const target = current.documents.find(entry => entry.id === targetId);
    if (!target) throw new Error('The CV you chose is no longer in Library. Choose another CV to update.');
    reviewed = mergeReviewedDocument(target.document, reviewed, { profileFields, sectionModes, idPrefix: `import-${id?.slice(0, 45) || 'copy'}` });
  }
  return addDocument(current, reviewed, id, name);
}
