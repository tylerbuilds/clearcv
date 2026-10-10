import { tokenise } from './model.js';

// These are writing prompts, not a hiring, grammar, truth or ATS assessment.
export const REVIEW_RULES = Object.freeze([
  ['name', 'Your CV has a name.'],
  ['contact', 'Your CV has an email address or phone number.'],
  ['email-format', 'The email address has an @ and a domain, with no spaces.'],
  ['phone-format', 'The phone number has at least seven digits.'],
  ['headline', 'Your CV has a professional title.'],
  ['summary', 'Your CV has a visible summary.'],
  ['summary-short', 'A summary under 15 words may need more detail.'],
  ['summary-long', 'A summary over 90 words may need shortening.'],
  ['summary-vague', 'The summary is checked for phrases such as “team player” and “hard-working”.'],
  ['background', 'Your CV includes work, study or another background section.'],
  ['empty-entry', 'Empty entries should be filled in or removed.'],
  ['entry-title', 'Each role or qualification has a title.'],
  ['entry-organisation', 'Each role or qualification names the employer or institution.'],
  ['experience-detail', 'Each role has a description of your work.'],
  ['dates-missing', 'Each role or qualification has dates.'],
  ['dates-unrecognised', 'Dates can use years, month and year, or YYYY-MM, including ranges and Present.'],
  ['dates-order', 'The end date doesn’t come before the start date.'],
  ['dates-consistency', 'Dates use a consistent style within each section.'],
  ['long-bullet', 'A bullet over 40 words may need splitting or shortening.'],
  ['many-bullets', 'A role with more than eight bullets may need trimming.'],
  ['numeric-evidence', 'Descriptions without numbers get a suggestion to show scale where useful.'],
  ['responsibility-opening', 'Phrases such as “responsible for” get a suggestion to describe your contribution.'],
  ['repeated-bullet', 'The check finds repeated bullets of four words or more, ignoring capitals and punctuation.'],
  ['duplicate-skill', 'The check finds repeated skills, ignoring capitals and extra spaces.'],
  ['custom-title', 'Extra sections have a heading.'],
  ['custom-content', 'Extra sections have content.'],
  ['document-short', 'A CV under 100 words may need more detail.'],
  ['document-long', 'A CV over 1,000 words may need shortening. Page length depends on your layout.']
].map(([id, description]) => Object.freeze({ id, description })));

const VAGUE_SUMMARY = /\b(?:hard[ -]working|results[ -]orient(?:ed|ated)|team player|go[ -]getter|self[ -]motivated|dynamic professional)\b/i;
const RESPONSIBILITY_OPENING = /^(?:responsible for|duties included|worked on|helped(?: with)?|assisted with)\b/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAME = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const ENDPOINT = `(?:${MONTH_NAME}\\s+)?(?:19|20|21)\\d{2}(?:-(?:0[1-9]|1[0-2]))?`;
const DATE_RANGE = new RegExp(`^(${ENDPOINT})(?:\\s*(?:[–—]|\\s+-\\s+|\\s+to\\s+|-(?=\\d{4}\\b))\\s*(${ENDPOINT}|present|current|now))?$`, 'i');
const text = value => typeof value === 'string' ? value.trim() : '';
const list = value => Array.isArray(value) ? value : [];
const words = value => (text(value).match(/[\p{L}\p{N}]+(?:['’+#.-][\p{L}\p{N}+#]+)*/gu) || []).length;
const lines = value => text(value).split(/\r?\n/).map((value, index) => ({ value: value.replace(/^\s*[•*-]\s+/, '').trim(), index })).filter(line => line.value);
const normalise = value => text(value).toLocaleLowerCase('en-GB').replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim();
const hidden = doc => new Set(list(doc?.hiddenSections));

function dateEndpoint(value) {
  const year = Number(value.match(/\b(?:19|20|21)\d{2}\b/)[0]);
  const numericMonth = value.match(/^\d{4}-(\d{2})$/);
  const namedMonth = value.match(/^([a-z]+)/i);
  const month = numericMonth ? Number(numericMonth[1]) - 1 : namedMonth ? MONTHS.indexOf(namedMonth[1].slice(0, 3).toLowerCase()) : null;
  const style = numericMonth ? 'numeric-month' : namedMonth ? 'named-month' : 'year';
  return { first: year * 12 + (month ?? 0), last: year * 12 + (month ?? 11), style };
}

function parseDates(value) {
  const match = DATE_RANGE.exec(text(value));
  if (!match) return null;
  const start = dateEndpoint(match[1]);
  const end = match[2] && !/^(present|current|now)$/i.test(match[2]) ? dateEndpoint(match[2]) : null;
  return { reversed: Boolean(end && end.last < start.first), styles: [...new Set([start.style, ...(end ? [end.style] : [])])] };
}

/**
 * Pure writing review of a validated ClearCV document. Hidden content sections,
 * including the summary, are excluded; essential header fields remain visible.
 * Issues use model paths, stable rule IDs and two prompt severities.
 * No overall score is returned. `evidence` is a short supplied-text excerpt.
 */
export function reviewCV(doc) {
  const profile = doc?.profile || {};
  const excluded = hidden(doc);
  const summaryVisible = !excluded.has('profile');
  const issues = [];
  const cvText = ['name', 'headline', 'email', 'phone', 'location', 'website', ...(summaryVisible ? ['summary'] : [])].map(key => text(profile[key]));
  const repeated = new Map();
  let experienceBullets = 0;
  let hasBackground = false;
  const add = (ruleId, path, message, suggestion, evidence = '', severity = 'suggestion') => {
    issues.push({ ruleId, severity, path, message, suggestion, evidence: text(evidence).slice(0, 180) });
  };
  if (!text(profile.name)) add('name', 'profile.name', 'Your name is missing.', 'Add the name you want to use for this application.', '', 'attention');
  if (!text(profile.email) && !text(profile.phone)) add('contact', 'profile.email', 'There is no email address or phone number.', 'Add a contact method you want employers to use.', '', 'attention');
  if (text(profile.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text(profile.email))) add('email-format', 'profile.email', 'Check the email address format.', 'Check the spelling, @ and domain.', profile.email, 'attention');
  if (text(profile.phone) && text(profile.phone).replace(/\D/g, '').length < 7) add('phone-format', 'profile.phone', 'The phone number contains fewer than seven digits.', 'Check the complete number and country code.', profile.phone);
  if (!text(profile.headline)) add('headline', 'profile.headline', 'Your professional headline is missing.', 'Add your role or the kind of work you do.');
  const summaryWords = summaryVisible ? words(profile.summary) : 0;
  if (summaryVisible && !summaryWords) add('summary', 'profile.summary', 'Your summary is empty.', 'Say what you do and add one or two strengths relevant to this role.');
  else if (summaryVisible) {
    if (summaryWords < 15) add('summary-short', 'profile.summary', 'Your summary is very brief.', 'Add your area of work, relevant experience or a useful example.', `${summaryWords} words`);
    if (summaryWords > 90) add('summary-long', 'profile.summary', 'Your summary is longer than 90 words.', 'Keep the main points here and move the detail into Experience or another section.', `${summaryWords} words`);
    const vague = text(profile.summary).match(VAGUE_SUMMARY);
    if (vague) add('summary-vague', 'profile.summary', 'Your summary includes a generic phrase.', 'Replace it with something you did or an example of your work.', vague[0]);
  }

  const checkLine = (line, path) => {
    if (words(line) > 40) add('long-bullet', path, 'This description line is longer than 40 words.', 'Keep one main contribution per line, or split separate ideas without losing useful detail.', line);
    if (RESPONSIBILITY_OPENING.test(line)) add('responsibility-opening', path, 'This bullet describes a duty rather than your contribution.', 'Say what you did and what changed as a result, where you can.', line);
    const key = normalise(line);
    if (words(line) >= 4 && repeated.has(key)) add('repeated-bullet', path, 'This description line repeats another line.', `Check whether both entries need this wording, or give each its own example.`, line);
    else if (words(line) >= 4) repeated.set(key, path);
  };

  for (const section of ['experience', 'education']) {
    if (excluded.has(section)) continue;
    const dateStyles = new Set();
    list(doc?.[section]).forEach((item, index) => {
      const path = `${section}[${index}]`;
      const values = ['title', 'organisation', 'location', 'dates', 'description'].map(key => text(item?.[key]));
      cvText.push(...values);
      if (!values.some(Boolean)) {
        add('empty-entry', path, 'This entry is empty.', 'Complete it or remove it from this CV.', '', 'attention');
        return;
      }
      hasBackground ||= values.some(Boolean);
      if (!text(item?.title)) add('entry-title', `${path}.title`, `This ${section} entry has no title.`, section === 'experience' ? 'Add your role title.' : 'Add the qualification, course or area of study.');
      if (!text(item?.organisation)) add('entry-organisation', `${path}.organisation`, `This ${section} entry has no organisation.`, 'Add the employer, institution or your self-employed work.');
      if (!text(item?.dates)) add('dates-missing', `${path}.dates`, 'This entry has no dates.', 'Add when you worked or studied here, or the completion year.');
      else {
        const dates = parseDates(item.dates);
        if (!dates) add('dates-unrecognised', `${path}.dates`, 'We couldn’t read these dates.', 'Check them yourself, or try a format such as 2022 to Present, January 2022 or 2022-01.', item.dates);
        else {
          dates.styles.forEach(style => dateStyles.add(style));
          if (dates.reversed) add('dates-order', `${path}.dates`, 'The end date appears earlier than the start date.', 'Check the start and end dates against your records.', item.dates, 'attention');
        }
      }
      const descriptionLines = lines(item?.description);
      if (section === 'experience') {
        experienceBullets += descriptionLines.length;
        if (!descriptionLines.length) add('experience-detail', `${path}.description`, 'This experience has no description.', 'Describe what you did and any relevant results.');
        else if (!/\d/u.test(text(item?.description))) add('numeric-evidence', `${path}.description`, 'Could a number help explain this work?', 'Add a real number if it helps show scale, time saved or results. A clear description works too. Don’t invent a number.');
        if (descriptionLines.length > 8) add('many-bullets', `${path}.description`, 'This role has more than eight bullets.', 'Keep the examples most relevant to this job.', `${descriptionLines.length} lines`);
      }
      descriptionLines.forEach(line => checkLine(line.value, `${path}.description:${line.index + 1}`));
    });
    if (dateStyles.size > 1) add('dates-consistency', section, `The dates in ${section} use different styles.`, 'Use the same date style where you can. Don’t guess missing months.', list(doc?.[section]).map(item => text(item?.dates)).filter(Boolean).slice(0, 3).join(' / '));
  }

  if (!excluded.has('skills')) {
    const skillNames = new Set();
    list(doc?.skills).forEach((item, index) => {
      const name = text(item?.name);
      cvText.push(name);
      if (!name) add('empty-entry', `skills[${index}]`, 'This skill entry is empty.', 'Add a skill you have, or remove this entry.');
      else {
        const key = name.toLocaleLowerCase('en-GB').replace(/\s+/g, ' ');
        if (skillNames.has(key)) add('duplicate-skill', `skills[${index}].name`, 'This skill is listed more than once.', 'Keep one entry, or make the difference clear.', name);
        skillNames.add(key);
      }
    });
  }
  list(doc?.customSections).forEach((item, index) => {
    if (excluded.has(item?.id)) return;
    const title = text(item?.title);
    const content = text(item?.content);
    cvText.push(title, content);
    const path = `customSections[${index}]`;
    if (!title && !content) add('empty-entry', path, 'This custom section is empty.', 'Complete it or remove it from this CV.');
    else {
      if (content) hasBackground = true;
      if (!title) add('custom-title', `${path}.title`, 'This custom section has no title.', 'Add a heading that describes its content.');
      if (!content) add('custom-content', `${path}.content`, 'This custom section has no content.', 'Add the details you want to include, or remove this section.');
      lines(content).forEach(line => checkLine(line.value, `${path}.content:${line.index + 1}`));
    }
  });
  if (!hasBackground) add('background', 'experience', 'Your CV needs some background.', 'Add relevant work, study, projects or other experience.');
  const totalWords = words(cvText.join(' '));
  if (totalWords > 0 && totalWords < 100) add('document-short', 'document', 'Your CV has fewer than 100 words.', 'Check that you’ve included enough detail for this role. A short CV can be appropriate.', `${totalWords} words`);
  if (totalWords > 1000) add('document-long', 'document', 'Your CV has more than 1,000 words.', 'Trim anything that doesn’t help this application and check the print preview.', `${totalWords} words`);
  return {
    method: 'Check for missing details, repeated wording and long descriptions. These are writing suggestions, not an ATS score. You’ll still need to check your facts and grammar.',
    issues,
    metrics: { words: totalWords, summaryWords, experienceBullets },
    rules: REVIEW_RULES.map(rule => ({ ...rule }))
  };
}

function jobKeywords(jobAd) {
  const counts = new Map();
  for (const word of tokenise(text(jobAd))) counts.set(word, (counts.get(word) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en-GB')).slice(0, 24).map(([word]) => word);
}

/**
 * Ranks stored experience and skills by distinct exact-token overlap with the
 * up to 24 frequent job keywords used by ClearCV. Ties preserve original order.
 * The returned ID arrays are suggestions; this function does not reorder state.
 */
export function tailoringSuggestions(doc, jobAd = doc?.jobAd) {
  const keywords = jobKeywords(jobAd);
  const matched = value => {
    const tokens = new Set(tokenise(text(value)));
    return keywords.filter(keyword => tokens.has(keyword));
  };
  const rank = (items, content) => list(items).map((item, index) => ({ id: item.id, index, matchedKeywords: matched(content(item)) }))
    .sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length || a.index - b.index);
  const experience = rank(doc?.experience, item => [item.title, item.organisation, item.description].join(' '));
  const skills = rank(doc?.skills, item => item.name);
  const profile = doc?.profile || {};
  const cvText = [profile.headline, profile.summary,
    ...list(doc?.experience).flatMap(item => [item.title, item.organisation, item.description]),
    ...list(doc?.education).flatMap(item => [item.title, item.organisation, item.description]),
    ...list(doc?.skills).map(item => item.name),
    ...list(doc?.customSections).flatMap(item => [item.title, item.content])].join(' ');
  const found = matched(cvText);
  const missing = keywords.filter(keyword => !found.includes(keyword));
  const suggestions = [];
  if (!keywords.length) suggestions.push({ path: 'jobAd', message: 'Paste a job description to compare it with your CV.', matchedKeywords: [] });
  if (experience[0]?.matchedKeywords.length && experience[0].index !== 0) suggestions.push({ path: 'experience', message: 'A role lower in your CV shares more job keywords. You could move it first if it’s more relevant than your latest role.', matchedKeywords: experience[0].matchedKeywords });
  if (skills.some((item, index) => item.index !== index)) suggestions.push({ path: 'skills', message: 'Move skills mentioned in the job description nearer the top.', matchedKeywords: [...new Set(skills.flatMap(item => item.matchedKeywords))] });
  if (found.length && !matched(profile.summary).length) suggestions.push({ path: 'profile.summary', message: 'Some job keywords appear elsewhere in your CV but not in your summary. Mention that experience here if it helps introduce you.', matchedKeywords: found });
  if (missing.length) suggestions.push({ path: 'jobAd', message: 'Some job keywords are missing. Only add a term if it describes experience or a skill you have.', matchedKeywords: [] });
  return {
    method: 'This suggests an order based on shared job keywords. It checks all your sections, including hidden ones. It doesn’t judge how well you fit the role.',
    keywords, found, missing,
    experienceOrder: experience.map(item => item.id), skillOrder: skills.map(item => item.id), suggestions,
    rankings: {
      experience: experience.map(({ id, matchedKeywords }) => ({ id, matchedKeywords })),
      skills: skills.map(({ id, matchedKeywords }) => ({ id, matchedKeywords }))
    }
  };
}

/**
 * Editable plain-text starter assembled from supplied CV text, never inferred
 * achievements. Missing context is omitted and reported through warnings.
 * `body` omits salutation, closing and signature for the structured letter
 * editor. `text` preserves the complete standalone letter API.
 */
export function coverLetterDraft(doc, company = '', role = '') {
  const profile = doc?.profile || {};
  const targetCompany = text(company);
  const targetRole = text(role) || text(profile.headline);
  const usedPaths = [];
  const warnings = ['Edit this draft for the role and add why you want to work there.'];
  if (!targetCompany) warnings.push('Add the organisation to personalise the opening.');
  if (!targetRole) warnings.push('Add the role you’re applying for to personalise the opening.');
  if (!text(role) && text(profile.headline)) usedPaths.push('profile.headline');
  const opening = targetRole
    ? `I am applying for the ${targetRole} position${targetCompany ? ` at ${targetCompany}` : ''}.`
    : targetCompany ? `Please consider my application to ${targetCompany}.` : 'Please consider my application.';
  const salutation = 'Dear hiring team,';
  const closing = 'Kind regards,';
  const paragraphs = [opening];
  const hidden = new Set(doc?.hiddenSections || []);
  if (!hidden.has('profile') && text(profile.summary)) {
    paragraphs.push(text(profile.summary));
    usedPaths.push('profile.summary');
  }
  const experienceIndex = hidden.has('experience') ? -1 : list(doc?.experience).findIndex(item => text(item.title) || text(item.organisation) || text(item.description));
  if (experienceIndex >= 0) {
    const item = doc.experience[experienceIndex];
    const title = text(item.title);
    const organisation = text(item.organisation);
    const detail = lines(item.description).slice(0, 2).map(line => line.value).join('\n');
    const context = title && organisation ? `My experience includes ${title} at ${organisation}.` : title ? `My experience includes ${title}.` : organisation ? `My experience includes work at ${organisation}.` : '';
    if (context || detail) paragraphs.push([context, detail].filter(Boolean).join('\n'));
    if (title) usedPaths.push(`experience[${experienceIndex}].title`);
    if (organisation) usedPaths.push(`experience[${experienceIndex}].organisation`);
    if (detail) usedPaths.push(`experience[${experienceIndex}].description`);
  } else {
    const educationIndex = hidden.has('education') ? -1 : list(doc?.education).findIndex(item => text(item.title) || text(item.organisation) || text(item.description));
    if (educationIndex >= 0) {
      const item = doc.education[educationIndex];
      const title = text(item.title);
      const organisation = text(item.organisation);
      const context = title && organisation ? `My education includes ${title} at ${organisation}.` : title ? `My education includes ${title}.` : organisation ? `My education includes study at ${organisation}.` : '';
      const detail = lines(item.description).slice(0, 2).map(line => line.value).join('\n');
      paragraphs.push([context, detail].filter(Boolean).join('\n'));
      if (title) usedPaths.push(`education[${educationIndex}].title`);
      if (organisation) usedPaths.push(`education[${educationIndex}].organisation`);
      if (detail) usedPaths.push(`education[${educationIndex}].description`);
    }
  }
  const suppliedSkills = (hidden.has('skills') ? [] : list(doc?.skills)).map((item, index) => ({ name: text(item.name), index })).filter(item => item.name).slice(0, 6);
  if (suppliedSkills.length) {
    paragraphs.push(`My skills include ${suppliedSkills.map(item => item.name).join(', ')}.`);
    usedPaths.push(...suppliedSkills.map(item => `skills[${item.index}].name`));
  }
  if (!usedPaths.some(path => /summary|experience|education|skills/.test(path))) warnings.push('Add some experience, study or skills to your CV, then try this draft again.');
  paragraphs.push('Thank you for considering my application. I would welcome the opportunity to discuss it.');
  const body = paragraphs.filter(Boolean).join('\n\n');
  if (text(profile.name)) usedPaths.push('profile.name');
  else warnings.push('Add your name for the signature.');
  return {
    method: 'This starter uses your summary, first role or qualification, up to six skills and name. Edit it to suit the job.',
    text: [salutation, body, [closing, text(profile.name)].filter(Boolean).join('\n')].join('\n\n'),
    body, salutation, closing, warnings, usedPaths
  };
}
