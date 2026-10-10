import { validateDocument, plainTextDocument, tokenise, reconcileRichText } from './model.js';
import { coverLetterDraft } from './review.js';

const REQUIRED = /\b(must|required|essential|minimum|need to|requirements|qualifications)\b/i;
const PREFERRED = /\b(preferred|desirable|nice to have|bonus|ideally)\b/i;
const HEADING = /^(?:responsibilities|what you(?:'|’)ll do|about (?:us|the role)|benefits|what we offer|salary|apply|how to apply)\s*:?$/i;
function dataRecord(value, allowed, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key !== 'string' || !allowed.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
  })) throw new Error(message);
  return value;
}
function denseList(value, maximum, message) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) throw new Error(message);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) throw new Error(message);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(message);
  }
}
function jobText(value) {
  if (typeof value !== 'string' || value.length > 50000) throw new Error('Paste a job description of at most 50,000 characters.');
  if (!value.trim()) throw new Error('Paste the job description first.');
  return value.trim();
}
/** Requirement-by-requirement word evidence, deliberately not an ATS prediction. */
export function jobRequirementChecks(document, jobAd = document.jobAd) {
  const doc = validateDocument(document), text = jobText(jobAd);
  const visible = plainTextDocument(doc), vocabulary = new Set(tokenise(visible));
  let sectionType = 'role';
  const requirements = [];
  const seen = new Set();
  for (const raw of text.split(/\n|(?<=[.!?])\s+(?=[A-Z])/u)) {
    const line = raw.trim().replace(/^(?:[-*•]\s*|\d+[.)]\s+)/, '').trim();
    if (!line) continue;
    if (/^(requirements|qualifications|what you bring|about you)\s*:?$/i.test(line)) { sectionType = 'required'; continue; }
    if (/^(preferred|desirable|nice to have)\s*:?$/i.test(line)) { sectionType = 'preferred'; continue; }
    if (HEADING.test(line)) { sectionType = 'role'; continue; }
    const type = PREFERRED.test(line) ? 'preferred' : REQUIRED.test(line) ? 'required' : sectionType;
    const terms = [...new Set(tokenise(line))].slice(0, 40);
    if (terms.length < 2 || seen.has(line.toLocaleLowerCase('en-GB'))) continue;
    seen.add(line.toLocaleLowerCase('en-GB'));
    const found = terms.filter(term => vocabulary.has(term));
    const missing = terms.filter(term => !vocabulary.has(term));
    const evidence = visible.split('\n').filter(part => found.some(term => tokenise(part).includes(term))).slice(0, 3);
    requirements.push({ text: line.slice(0, 1000), type, terms, found, missing, evidence,
      coverage: !found.length ? 'none' : missing.length ? 'some' : 'all' });
    if (requirements.length === 40) break;
  }
  return {
    method: 'Each line is checked for exact words in visible CV content. Required and preferred labels come from the advert. Shared words do not prove the requirement, years of experience or ATS compatibility.',
    requirements,
    yearsPrompts: [...new Set(text.match(/\b\d{1,2}\+?\s*(?:years?|yrs?)\b[^\n.!?]{0,100}/gi) || [])].slice(0, 8),
    counts: { required: requirements.filter(item => item.type === 'required').length,
      preferred: requirements.filter(item => item.type === 'preferred').length }
  };
}
function score(text, terms) {
  const present = new Set(tokenise(text));
  return terms.filter(term => present.has(term)).length;
}
function ranked(items, text, terms) {
  return items.map((item, index) => ({ item, index, hits: score(text(item), terms) }))
    .sort((a, b) => b.hits - a.hits || a.index - b.index).map(({ item }) => item);
}
/** Reuses real master facts. It never fabricates qualifications or achievements. */
export function prepareTailoredCopy(source, jobAd, options = {}) {
  dataRecord(options, ['styleFrom', 'company', 'role'], 'Choose supported job draft options.');
  const { styleFrom = source, company = '', role = '' } = options;
  if (typeof company !== 'string' || company.length > 300 || typeof role !== 'string' || role.length > 300) throw new Error('Use a company and role of at most 300 characters.');
  const original = validateDocument(source), style = validateDocument(styleFrom), text = jobText(jobAd);
  const checks = jobRequirementChecks(original, text);
  const terms = [...new Set(checks.requirements.flatMap(item => item.terms))].slice(0, 200);
  const draft = structuredClone(original);
  draft.style = structuredClone(style.style);
  draft.layout = structuredClone(style.layout);
  // Keep valid placement for source sections; a master's custom sections may differ.
  draft.sectionColumns = Object.fromEntries(original.sectionOrder.filter(id => Object.hasOwn(style.sectionColumns, id)).map(id => [id, style.sectionColumns[id]]));
  draft.jobAd = text;
  for (const collection of ['experience', 'education']) {
    draft[collection] = ranked(draft[collection], item => `${item.title} ${item.description}`, terms);
    for (const item of draft[collection]) {
      const lines = item.description.split('\n');
      item.description = ranked(lines, line => line, terms).join('\n');
    }
  }
  draft.skills = ranked(draft.skills, item => item.name, terms);
  draft.coverLetter = { ...draft.coverLetter, company, role };
  const letter = coverLetterDraft(draft, company, role);
  draft.coverLetter = { ...draft.coverLetter, body: letter.body, salutation: letter.salutation, closing: letter.closing };
  const document = validateDocument(reconcileRichText(original, draft));
  return { document, checks, warnings: [...letter.warnings,
    'This draft reorders your existing facts. Review every field and remove anything you do not want to send.'],
    sourceCounts: { experience: original.experience.length, education: original.education.length, skills: original.skills.length } };
}
/** Apply only reviewed IDs/fields; original document remains detached and unchanged. */
export function reviewTailoredCopy(prepared, edits = {}) {
  const source = validateDocument(prepared), next = structuredClone(source);
  const allowed = ['summary', 'headline', 'experience', 'education', 'skillIds', 'company', 'role', 'letter'];
  dataRecord(edits, allowed, 'The tailored changes are invalid.');
  if (Object.hasOwn(edits, 'summary')) next.profile.summary = edits.summary;
  if (Object.hasOwn(edits, 'headline')) next.profile.headline = edits.headline;
  for (const collection of ['experience', 'education']) {
    if (!Object.hasOwn(edits, collection)) continue;
    denseList(edits[collection], source[collection].length, 'Choose entries from the reviewed career record.');
    const ids = new Set();
    next[collection] = edits[collection].map(entry => {
      dataRecord(entry, ['id', 'description'], 'Choose valid reviewed entries.');
      const original = source[collection].find(item => item.id === entry.id);
      if (!original || ids.has(entry.id)) throw new Error('Choose each reviewed entry once.');
      ids.add(entry.id);
      return { ...original, ...(Object.hasOwn(entry, 'description') ? { description: entry.description } : {}) };
    });
  }
  if (Object.hasOwn(edits, 'skillIds')) {
    denseList(edits.skillIds, source.skills.length, 'Choose skills from your career record.');
    if (new Set(edits.skillIds).size !== edits.skillIds.length || edits.skillIds.some(id => !source.skills.some(item => item.id === id))) throw new Error('Choose skills from your career record.');
    next.skills = edits.skillIds.map(id => source.skills.find(item => item.id === id));
  }
  for (const [edit, field] of [['company', 'company'], ['role', 'role'], ['letter', 'body']]) if (Object.hasOwn(edits, edit)) next.coverLetter[field] = edits[edit];
  return validateDocument(reconcileRichText(source, next));
}
