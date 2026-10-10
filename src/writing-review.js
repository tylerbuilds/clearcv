import { validateDocument, reconcileRichText } from './model.js';

const PROFILE = ['headline', 'summary'];
const LETTER = ['company', 'role', 'recipient', 'subject', 'salutation', 'body', 'closing'];
export function writingFields(document, kind = 'cv') {
  const doc = validateDocument(document);
  if (!['cv', 'letter'].includes(kind)) throw new Error('Choose CV or cover-letter writing.');
  const fields = [];
  const add = (path, label, value) => { if (value.trim()) fields.push({ path, label, value }); };
  if (kind === 'letter') { for (const key of LETTER) add(['coverLetter', key], `Letter ${key}`, doc.coverLetter[key]); return fields; }
  for (const key of ['profile', 'experience', 'education', 'skills']) {
    const rendered = key === 'profile' ? doc.profile.summary.trim() : key === 'skills' ? doc.skills.some(item => item.name.trim()) : doc[key].length;
    if (rendered && !doc.hiddenSections.includes(key)) add(['sectionTitles', key], `${key} heading`, doc.sectionTitles[key]);
  }
  for (const key of PROFILE) if (key !== 'summary' || !doc.hiddenSections.includes('profile')) add(['profile', key], key === 'summary' ? 'Profile' : 'Professional title', doc.profile[key]);
  for (const collection of ['experience', 'education']) if (!doc.hiddenSections.includes(collection)) doc[collection].forEach((item, index) => {
    for (const key of ['title', 'organisation', 'location', 'description']) add([collection, item.id, key], `${collection === 'experience' ? 'Experience' : 'Education'} ${index + 1} · ${key}`, item[key]);
  });
  if (!doc.hiddenSections.includes('skills')) doc.skills.forEach((item, index) => add(['skills', item.id, 'name'], `Skill ${index + 1}`, item.name));
  for (const section of doc.customSections) if (section.content.trim() && !doc.hiddenSections.includes(section.id)) { add(['customSections', section.id, 'title'], `${section.title} heading`, section.title); add(['customSections', section.id, 'content'], section.title, section.content); }
  return fields;
}
export function joinWritingFields(fields) {
  const ranges = []; let text = '';
  for (const field of fields) { if (text) text += '\n\n'; const start = text.length; text += field.value; ranges.push({ ...field, start, end: text.length }); }
  return { text, ranges };
}
export function locateWritingIssue(ranges, issue) {
  const field = ranges.find(range => issue.start >= range.start && issue.end <= range.end);
  if (!field) throw new Error('This spelling result doesn’t match a CV field. Run the check again.');
  return { ...issue, path: [...field.path], label: field.label, start: issue.start - field.start, end: issue.end - field.start };
}
function target(document, path) {
  if (!Array.isArray(path) || !path.every(part => typeof part === 'string')) throw new Error('Choose a supported writing field.');
  if (path.length === 2 && (path[0] === 'profile' && PROFILE.includes(path[1]) || path[0] === 'coverLetter' && LETTER.includes(path[1]) || path[0] === 'sectionTitles' && ['profile', 'experience', 'education', 'skills'].includes(path[1]))) return { object: document[path[0]], key: path[1] };
  const allowed = { experience: ['title', 'organisation', 'location', 'description'], education: ['title', 'organisation', 'location', 'description'], skills: ['name'], customSections: ['title', 'content'] };
  if (path.length !== 3 || !allowed[path[0]]?.includes(path[2])) throw new Error('Choose a supported writing field.');
  const object = document[path[0]].find(item => item.id === path[1]); if (!object) throw new Error('This writing entry no longer exists.');
  return { object, key: path[2] };
}
export function applyWritingSuggestion(document, issue, replacement) {
  const next = validateDocument(document), { object, key } = target(next, issue.path);
  if (typeof replacement !== 'string' || replacement.length > 100 || /[\r\n\u0000-\u001f]/.test(replacement)) throw new Error('Use a short plain-text replacement.');
  if (!Number.isInteger(issue.start) || !Number.isInteger(issue.end) || issue.start < 0 || issue.end <= issue.start || object[key].slice(issue.start, issue.end) !== issue.word) throw new Error('You’ve changed this field since the check. Check it again before making a correction.');
  object[key] = object[key].slice(0, issue.start) + replacement + object[key].slice(issue.end);
  return validateDocument(reconcileRichText(document, next));
}
export function cleanupSuggestions(document, kind = 'cv') {
  return writingFields(document, kind).flatMap(field => {
    const replacement = field.value.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[\t\u00a0]+/g, ' ').replace(/ {2,}/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n');
    return replacement === field.value ? [] : [{ path: field.path, label: field.label, before: field.value, replacement }];
  });
}
export function applyCleanupSuggestion(document, suggestion) {
  const next = validateDocument(document), { object, key } = target(next, suggestion.path);
  if (object[key] !== suggestion.before) throw new Error('You’ve changed this field since checking the spacing. Choose Tidy spacing again.');
  if (typeof suggestion.replacement !== 'string' || suggestion.before.replace(/\s/g, '') !== suggestion.replacement.replace(/\s/g, '')) throw new Error('Spacing cleanup can only change spaces and blank lines. Your words, numbers and facts must stay the same.');
  object[key] = suggestion.replacement;
  return validateDocument(reconcileRichText(document, next));
}
