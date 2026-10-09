import { tokenise } from './model.js';

// These are writing prompts, not a hiring, grammar, truth or ATS assessment.
export const REVIEW_RULES = Object.freeze([
  ['name', 'A name is present.'],
  ['contact', 'At least an email address or phone number is present.'],
  ['email-format', 'A supplied email has one @, no spaces and a dotted domain.'],
  ['phone-format', 'A supplied phone number contains at least seven digits.'],
  ['headline', 'A professional headline is present.'],
  ['summary', 'A visible summary is present.'],
  ['summary-short', 'A supplied visible summary contains at least 15 words.'],
  ['summary-long', 'A visible summary of more than 90 words prompts a brevity review.'],
  ['summary-vague', 'A small published phrase list flags generic language in a visible summary.'],
  ['background', 'Visible experience, education or custom content is present.'],
  ['empty-entry', 'A completely blank entry prompts completion or removal.'],
  ['entry-title', 'A non-empty experience or education entry has a title.'],
  ['entry-organisation', 'A non-empty experience or education entry names its organisation.'],
  ['experience-detail', 'A non-empty experience entry describes the contribution.'],
  ['dates-missing', 'A non-empty experience or education entry includes dates.'],
  ['dates-unrecognised', 'Dates use years, English month/year or YYYY-MM, with an optional range or Present.'],
  ['dates-order', 'A recognised date range does not end before it starts.'],
  ['dates-consistency', 'Recognised dates in a section use a consistent year or month/year style.'],
  ['long-bullet', 'A description line of more than 40 words prompts a brevity review.'],
  ['many-bullets', 'More than eight description lines in one experience entry prompts prioritisation.'],
  ['numeric-evidence', 'Experience descriptions without a numeral prompt consideration of verifiable scale or outcomes.'],
  ['responsibility-opening', 'Description lines starting with a published responsibility phrase prompt a contribution review.'],
  ['repeated-bullet', 'Repeated description lines of at least four words are detected after case and punctuation normalisation.'],
  ['duplicate-skill', 'Repeated skill names are detected after case and whitespace normalisation.'],
  ['custom-title', 'A non-empty custom section has a title.'],
  ['custom-content', 'A titled custom section contains text.'],
  ['document-short', 'A non-empty CV with fewer than 100 words prompts a detail review.'],
  ['document-long', 'A CV with more than 1,000 words prompts a brevity review; this is not a page count.']
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
  if (text(profile.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text(profile.email))) add('email-format', 'profile.email', 'Check the email address format.', 'Check the spelling, @ and domain. This rule cannot verify delivery.', profile.email, 'attention');
  if (text(profile.phone) && text(profile.phone).replace(/\D/g, '').length < 7) add('phone-format', 'profile.phone', 'The phone number contains fewer than seven digits.', 'Check the complete number and country code if needed. This rule cannot verify the number.', profile.phone);
  if (!text(profile.headline)) add('headline', 'profile.headline', 'Your professional headline is missing.', 'State the role or professional focus you want this CV to communicate.');
  const summaryWords = summaryVisible ? words(profile.summary) : 0;
  if (summaryVisible && !summaryWords) add('summary', 'profile.summary', 'Your summary is empty.', 'Introduce your professional focus and one or two relevant, verifiable strengths.');
  else if (summaryVisible) {
    if (summaryWords < 15) add('summary-short', 'profile.summary', 'Your summary is very brief.', 'Consider adding a specific area of work, relevant experience or a supported example.', `${summaryWords} words`);
    if (summaryWords > 90) add('summary-long', 'profile.summary', 'Your summary is longer than 90 words.', 'Keep the most relevant points and move supporting detail into the appropriate section.', `${summaryWords} words`);
    const vague = text(profile.summary).match(VAGUE_SUMMARY);
    if (vague) add('summary-vague', 'profile.summary', 'Your summary includes a generic phrase.', 'Consider replacing the phrase with a specific contribution or example that you can substantiate.', vague[0]);
  }

  const checkLine = (line, path) => {
    if (words(line) > 40) add('long-bullet', path, 'This description line is longer than 40 words.', 'Keep one main contribution per line, or split separate ideas without losing useful detail.', line);
    if (RESPONSIBILITY_OPENING.test(line)) add('responsibility-opening', path, 'This line starts with a responsibility phrase.', 'Describe your own action and its outcome when you can support both.', line);
    const key = normalise(line);
    if (words(line) >= 4 && repeated.has(key)) add('repeated-bullet', path, 'This description line repeats another line.', `Review whether each entry needs the same wording. First occurrence: ${repeated.get(key)}.`, line);
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
      if (!text(item?.title)) add('entry-title', `${path}.title`, `This ${section} entry has no title.`, section === 'experience' ? 'Add the role or contribution title.' : 'Add the qualification, course or area of study.');
      if (!text(item?.organisation)) add('entry-organisation', `${path}.organisation`, `This ${section} entry has no organisation.`, 'Add the employer, institution or appropriate self-employed context.');
      if (!text(item?.dates)) add('dates-missing', `${path}.dates`, 'This entry has no dates.', 'Add the period or completion year if relevant to your application.');
      else {
        const dates = parseDates(item.dates);
        if (!dates) add('dates-unrecognised', `${path}.dates`, 'This date format is not recognised by the simple date check.', 'Review it yourself, or use years, English month/year or YYYY-MM, optionally separated by an en dash and ending in Present.', item.dates);
        else {
          dates.styles.forEach(style => dateStyles.add(style));
          if (dates.reversed) add('dates-order', `${path}.dates`, 'The end date appears earlier than the start date.', 'Check the start and end dates against your records.', item.dates, 'attention');
        }
      }
      const descriptionLines = lines(item?.description);
      if (section === 'experience') {
        experienceBullets += descriptionLines.length;
        if (!descriptionLines.length) add('experience-detail', `${path}.description`, 'This experience has no description.', 'Add a relevant contribution or outcome in your own words.');
        else if (!/\d/u.test(text(item?.description))) add('numeric-evidence', `${path}.description`, 'This experience description has no numerical detail.', 'If useful and verifiable, show the scale, time saved or outcome. Qualitative evidence is also valid; never invent a number.');
        if (descriptionLines.length > 8) add('many-bullets', `${path}.description`, 'This experience contains more than eight description lines.', 'Prioritise the contributions most relevant to this application.', `${descriptionLines.length} lines`);
      }
      descriptionLines.forEach(line => checkLine(line.value, `${path}.description:${line.index + 1}`));
    });
    if (dateStyles.size > 1) add('dates-consistency', section, `The ${section} dates use different levels or styles of detail.`, 'Consider using a consistent date style where your records allow it. Do not guess missing months.', [...dateStyles].join(', '));
  }

  if (!excluded.has('skills')) {
    const skillNames = new Set();
    list(doc?.skills).forEach((item, index) => {
      const name = text(item?.name);
      cvText.push(name);
      if (!name) add('empty-entry', `skills[${index}]`, 'This skill entry is empty.', 'Name a skill you can substantiate, or remove the entry.');
      else {
        const key = name.toLocaleLowerCase('en-GB').replace(/\s+/g, ' ');
        if (skillNames.has(key)) add('duplicate-skill', `skills[${index}].name`, 'This skill is listed more than once.', 'Keep one entry unless the distinction is meaningful.', name);
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
      if (!content) add('custom-content', `${path}.content`, 'This custom section has no content.', 'Add relevant, verified detail or remove the section.');
      lines(content).forEach(line => checkLine(line.value, `${path}.content:${line.index + 1}`));
    }
  });
  if (!hasBackground) add('background', 'experience', 'There is no visible experience, education or custom background content.', 'Include relevant work, study, projects or other experience you can substantiate.');
  const totalWords = words(cvText.join(' '));
  if (totalWords > 0 && totalWords < 100) add('document-short', 'document', 'The visible CV contains fewer than 100 words.', 'Check that it gives enough relevant detail for this application. A short CV may be appropriate.', `${totalWords} words`);
  if (totalWords > 1000) add('document-long', 'document', 'The visible CV contains more than 1,000 words.', 'Review relevance and the print preview. This word count does not measure page length.', `${totalWords} words`);
  return {
    method: 'Deterministic writing prompts from visible supplied text. Thresholds are guidelines, not an ATS, hiring, grammar or factual assessment.',
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
  if (!keywords.length) suggestions.push({ path: 'jobAd', message: 'Paste a job description with meaningful terms to compare it with your stored CV text.', matchedKeywords: [] });
  if (experience[0]?.matchedKeywords.length && experience[0].index !== 0) suggestions.push({ path: 'experience', message: 'Consider putting the experience with the most exact keyword overlaps first if relevance is more useful than chronological order.', matchedKeywords: experience[0].matchedKeywords });
  if (skills.some((item, index) => item.index !== index)) suggestions.push({ path: 'skills', message: 'Consider moving your existing skills with exact keyword overlaps earlier in the list.', matchedKeywords: [...new Set(skills.flatMap(item => item.matchedKeywords))] });
  if (found.length && !matched(profile.summary).length) suggestions.push({ path: 'profile.summary', message: 'Your stored sections contain job keywords that are absent from your summary. Consider mentioning relevant existing experience in your own words.', matchedKeywords: found });
  if (missing.length) suggestions.push({ path: 'jobAd', message: 'Some job keywords are absent from your stored text. Only add a term when it accurately describes experience or a skill you can substantiate.', matchedKeywords: [] });
  return {
    method: 'Up to 24 frequent exact job tokens after ClearCV common-word filtering. Ranked by distinct overlaps; ties retain original order. Stored sections, including hidden ones, are compared. No semantic matching or suitability score.',
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
  const warnings = ['Read and edit this starter before using it. Add your own reason for choosing the organisation and check every supplied fact.'];
  if (!targetCompany) warnings.push('No organisation was supplied; the opening omits it.');
  if (!targetRole) warnings.push('No target role or professional headline was supplied; the opening stays general.');
  if (!text(role) && text(profile.headline)) usedPaths.push('profile.headline');
  const opening = targetRole
    ? `I am applying for the ${targetRole} position${targetCompany ? ` at ${targetCompany}` : ''}.`
    : targetCompany ? `Please consider my application to ${targetCompany}.` : 'Please consider my application.';
  const salutation = 'Dear hiring team,';
  const closing = 'Kind regards,';
  const paragraphs = [opening];
  if (text(profile.summary)) {
    paragraphs.push(text(profile.summary));
    usedPaths.push('profile.summary');
  }
  const experienceIndex = list(doc?.experience).findIndex(item => text(item.title) || text(item.organisation) || text(item.description));
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
    const educationIndex = list(doc?.education).findIndex(item => text(item.title) || text(item.organisation) || text(item.description));
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
  const suppliedSkills = list(doc?.skills).map((item, index) => ({ name: text(item.name), index })).filter(item => item.name).slice(0, 6);
  if (suppliedSkills.length) {
    paragraphs.push(`My listed skills include ${suppliedSkills.map(item => item.name).join(', ')}.`);
    usedPaths.push(...suppliedSkills.map(item => `skills[${item.index}].name`));
  }
  if (!usedPaths.some(path => /summary|experience|education|skills/.test(path))) warnings.push('There is no supporting CV detail in this starter. Add relevant, verified experience before using it.');
  paragraphs.push('Thank you for considering my application. I would welcome the opportunity to discuss it.');
  const body = paragraphs.filter(Boolean).join('\n\n');
  if (text(profile.name)) usedPaths.push('profile.name');
  else warnings.push('No name was supplied; add your preferred signature.');
  return {
    method: 'Local text assembly using the supplied summary, first non-empty experience (or education), up to six supplied skills and name. No AI, inferred claims, job-ad assertions or invented placeholders.',
    text: [salutation, body, [closing, text(profile.name)].filter(Boolean).join('\n')].join('\n\n'),
    body, salutation, closing, warnings, usedPaths
  };
}
