// A deterministic, dependency-free proposal for human review, not an inferred
// career history. Only line endings are normalised in the retained source.
import { createDocument, validateDocument } from './model.js';

const MAX_TEXT = 50_000;
const MAX_ITEMS = 60;
const MAX_CUSTOM = 20;
const BULLET = /^\s*[•●▪◦‣⁃➢✓✔*\-–]\s+/u;
const ROLE = /\b(?:engineer|designer|developer|manager|director|consultant|analyst|scientist|administrator|assistant|lead|head|chief|officer|specialist|coordinator|executive|architect|researcher|intern|technician|teacher|lecturer|professor|nurse|editor|writer|accountant|founder|supervisor|representative|recruiter|associate|counsellor|counselor|solicitor|lawyer|apprentice|chef|operator|controller|officer|mentor)\b/i;
const DEGREE = /\b(?:b\.?\s?sc\.?|m\.?\s?sc\.?|b\.?\s?a\.?|m\.?\s?a\.?|ph\.?\s?d\.?|mba|beng|meng|bba|hnd|hnc|gcse|a[- ]levels?|bachelor|master|doctorate|diploma|degree|certificate|certification|higher national)\b/i;
const ORGANISATION = /\b(?:ltd|limited|llc|inc|incorporated|corp|corporation|plc|gmbh|university|college|school|institute|academy|polytechnic)\b/i;
const ACTION = /^(?:led|built|created|managed|designed|developed|implemented|delivered|increased|reduced|improved|collaborated|supported|responsible|worked|achieved|maintained|conducted|produced|established|launched|organised|organized|trained|supervised|provided|awarded|graduated|thesis|dissertation|gpa|grade|first.class|honours|honors|distinction)\b/i;
const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const YEAR = '(?:19|20)\\d{2}';
const POINT = `(?:${MONTH}[ .]+${YEAR}|(?:0?[1-9]|1[0-2])[/.-]${YEAR}|${YEAR})`;
const END = `(?:${POINT}|Present|Current|Now|Ongoing|To date)`;
const RANGE = new RegExp(`\\b${POINT}\\s*(?:[-–—−]|\\bto\\b|\\buntil\\b)\\s*${END}\\b`, 'i');
const SINGLE = new RegExp(`\\b${POINT}\\b`, 'gi');
const ALIASES = {
  summary: ['summary', 'professional summary', 'career summary', 'profile', 'professional profile', 'personal profile', 'profile summary', 'about', 'about me', 'objective', 'career objective', 'overview', 'personal statement', 'profil'],
  experience: ['experience', 'work experience', 'professional experience', 'relevant experience', 'employment', 'employment history', 'work history', 'career history', 'professional background', 'employment experience', 'experiences', 'experience professionnelle', 'experiences professionnelles', 'experiencia laboral', 'experiencia profesional', 'berufserfahrung'],
  education: ['education', 'educational qualifications', 'academic background', 'academic qualifications', 'qualifications', 'education and qualifications', 'education and training', 'academic history', 'studies', 'formation', 'formations', 'educacion', 'ausbildung'],
  skills: ['skills', 'technical skills', 'core skills', 'key skills', 'skills and expertise', 'competencies', 'core competencies', 'areas of expertise', 'technical expertise', 'skill set', 'professional skills', 'expertise', 'competences', 'habilidades', 'kenntnisse'],
  contact: ['contact', 'contact information', 'contact details', 'personal details', 'personal information'],
  custom: ['projects', 'selected projects', 'personal projects', 'research', 'publications', 'certifications', 'certificates', 'licenses', 'licences', 'professional development', 'courses', 'training', 'languages', 'awards', 'honours', 'honors', 'volunteering', 'volunteer experience', 'volunteer work', 'interests', 'hobbies', 'references', 'achievements', 'additional information', 'activities', 'memberships', 'extracurricular activities']
};
const FIELD_ALIASES = new Map([
  ['name', 'name'], ['full name', 'name'], ['headline', 'headline'], ['professional title', 'headline'], ['current role', 'headline'],
  ['email', 'email'], ['e-mail', 'email'], ['mail', 'email'], ['phone', 'phone'], ['mobile', 'phone'], ['telephone', 'phone'], ['tel', 'phone'],
  ['location', 'location'], ['based in', 'location'], ['address', 'location'], ['website', 'website'], ['web', 'website'], ['portfolio', 'website'], ['linkedin', 'website'], ['github', 'website']
]);
const headingKey = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-GB').replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
const HEADINGS = new Map(Object.entries(ALIASES).flatMap(([kind, titles]) => titles.map(title => [title, kind])));
const clean = text => text.replace(/[\uFEFF\u200B]/g, '').trim();
const unbullet = text => clean(text).replace(BULLET, '').trim();
const compact = text => clean(text).replace(/[\t ]+/g, ' ');
const stripSeparators = text => text.replace(/^[\s|·,;:–—\-]+|[\s|·,;:–—\-]+$/g, '').replace(/\(\s*\)/g, '').trim();
const prose = text => text.length > 180 || text.split(/\s+/).length > 22 || ACTION.test(text);
const likelyLocation = text => /^(?:Remote|Hybrid|On[- ]site|[\p{Lu}][\p{L}\p{M}.'’\-]*(?:[ ,]+(?:[\p{Lu}][\p{L}\p{M}.'’\-]*|upon|on|in|the|of)){0,5})$/u.test(text);
const PAGE_NUMBER = '(?:\\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)';
const PAGE_NOTICE = new RegExp(`^page\\s+${PAGE_NUMBER}(?:\\s*(?:of|/)\\s*${PAGE_NUMBER})?(?:\\s*[|·:–—-]\\s*confidential)?[ .]*$`, 'i');
function documentaryMetadata(text) {
  // Interpret complete documentary notices, never substrings within an
  // explicitly labelled name. Their original rows remain reviewable.
  return /^(?:curriculum vitae|résumé|resume|cv)(?:\s+(?:draft|copy))?$/i.test(text)
    || /^(?:strictly\s+)?(?:private(?:\s+(?:and|&)\s+confidential)?|confidential)(?:\s*[|·:;–—-]\s*.*|\s+document)?[ .]*$/i.test(text)
    || PAGE_NOTICE.test(text)
    || /(?:^|[|·–—])\s*(?:no personal data|not for distribution|for (?:internal|recruitment|review|reference) (?:use|purposes)(?: only)?)\s*[ .]*$/i.test(text)
    || /^(?:document|cv|resume|résumé)\s+(?:prepared|provided)\s+(?:for|by)\b/i.test(text);
}
const plausibleName = text => text.split(/\s+/).length <= 8
  && /^[\p{L}\p{M} .,'’\-]+$/u.test(text) && !text.includes(',')
  && !ROLE.test(text) && !ACTION.test(text) && !DEGREE.test(text) && !ORGANISATION.test(text)
  && !prose(text) && !/^(?:remote|hybrid|on[- ]site)$/i.test(text);

function hasBrokenUnicode(text) {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}
function chunks(text, size = 30_000) {
  const result = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + size, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    result.push(text.slice(offset, end)); offset = end;
  }
  return result;
}
function heading(text, currentKind, allowUnknown) {
  let title = clean(text).replace(/^[#*=\s]+|[#*=\s]+$/g, '').replace(/:$/, '').trim();
  const direct = HEADINGS.get(headingKey(title));
  if (direct) return { kind: direct, title, rest: '' };
  const colon = title.indexOf(':');
  if (colon > 0) {
    const label = title.slice(0, colon).trim(), kind = HEADINGS.get(headingKey(label));
    if (kind && !(currentKind === 'skills' && kind === 'custom')) return { kind, title: label, rest: title.slice(colon + 1).trim() };
  }
  // Unknown explicit headings are retained as editable custom sections. Avoid
  // treating a capitalised name or an in-section skill category as a heading.
  if (allowUnknown && currentKind !== 'skills' && title.length <= 100 && !BULLET.test(text) && !ROLE.test(title) && !DEGREE.test(title) && !ORGANISATION.test(title) && !/\d|[@/|]/.test(title) && title.split(/\s+/).length <= 8) {
    const explicit = /:\s*$/.test(text) && !FIELD_ALIASES.has(headingKey(title));
    const capitals = /\p{Lu}/u.test(title) && title === title.toLocaleUpperCase('en-GB') && /\p{L}/u.test(title);
    if (explicit || capitals) return { kind: 'custom', title, rest: '', unknown: true };
  }
  return null;
}
function dateParts(text) {
  if (BULLET.test(text) || text.length > 600 || ACTION.test(clean(text))) return { dates: '', rest: compact(text) };
  let match = text.match(RANGE);
  if (!match) {
    const singles = [...text.matchAll(SINGLE)];
    if (singles.length === 1) {
      const candidate = singles[0], rest = stripSeparators(text.slice(0, candidate.index) + text.slice(candidate.index + candidate[0].length));
      if (!rest || DEGREE.test(text) || (/[,|·(]/.test(text.slice(0, candidate.index)) && candidate.index + candidate[0].length >= text.trimEnd().length - 1)) match = candidate;
    }
  }
  if (!match) return { dates: '', rest: compact(text) };
  const at = match.index;
  return { dates: match[0], rest: stripSeparators(text.slice(0, at) + text.slice(at + match[0].length)) };
}
function headerParts(text, kind) {
  const tidy = stripSeparators(text);
  const split = tidy.split(/\s+(?:at|@)\s+|\s*[|·]\s*|\s+[–—-]\s+|\t+| {3,}/i).map(stripSeparators).filter(Boolean);
  if (split.length > 1) return split;
  const comma = tidy.split(/,\s+/);
  const titleLike = kind === 'education' ? DEGREE : ROLE;
  if (comma.length === 2 && (titleLike.test(comma[0]) || titleLike.test(comma[1]))) return comma;
  const parenthesis = tidy.match(/^(.*?)\s*\(([^)]+)\)$/);
  if (parenthesis && ORGANISATION.test(parenthesis[2])) return [parenthesis[1].trim(), parenthesis[2].trim()];
  return tidy ? [tidy] : [];
}
function sectionBlocks(rows, kind) {
  const nonblank = rows.filter(row => clean(row.text));
  const blocks = []; let current = [];
  const titleLike = kind === 'education' ? DEGREE : ROLE;
  const candidate = row => {
    if (!row || BULLET.test(row.text) || prose(clean(row.text))) return false;
    const part = dateParts(row.text), pieces = headerParts(part.rest, kind);
    return Boolean(titleLike.test(part.rest) || (pieces.length > 1 && part.dates) || ORGANISATION.test(part.rest));
  };
  for (let index = 0; index < nonblank.length; index++) {
    const row = nonblank[index], part = dateParts(row.text);
    const dated = current.some(item => dateParts(item.text).dates);
    const described = current.some(item => BULLET.test(item.text) || prose(clean(item.text)));
    const upcomingDate = nonblank.slice(index, index + 4).findIndex(item => dateParts(item.text).dates);
    const clearInline = part.dates && part.rest && candidate(row);
    const dateFirst = part.dates && !part.rest;
    const nearDate = upcomingDate >= 0 && candidate(row) && nonblank.slice(index, index + upcomingDate).every(item => !BULLET.test(item.text) && !prose(clean(item.text)));
    const undatedHeader = titleLike.test(part.rest) && headerParts(part.rest, kind).length > 1;
    if (current.length && ((clearInline && (dated || described)) || (dateFirst && dated) || (nearDate && (dated || described)) || (undatedHeader && described))) {
      blocks.push(current); current = [];
    }
    current.push(row);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

/** Analyse at most 50,000 characters without making network calls or mutating state.
 * sourceText preserves all characters apart from CR/CRLF -> LF. Concatenating
 * hidden custom sections with IDs `${idPrefix}-source-N` recovers it exactly.
 */
export function analyseCVText(text, { idPrefix = 'import' } = {}) {
  if (typeof text !== 'string') throw new Error('Choose a text CV to analyse.');
  if (text.length > MAX_TEXT) throw new Error('Imported text must contain at most 50,000 characters.');
  if (!clean(text)) throw new Error('The document contains no readable CV text.');
  if (/[\u0000-\u0008\u000b\u000e-\u001f\ufffe\uffff]/.test(text) || hasBrokenUnicode(text)) throw new Error('The document contains damaged or non-text characters. Import a readable text CV.');
  if (typeof idPrefix !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(idPrefix)) throw new Error('Use an import ID prefix of 1–48 letters, numbers, underscores or hyphens.');
  const sourceText = text.replace(/\r\n?/g, '\n');
  const document = createDocument(), warnings = [], unmapped = new Map(), visibleOrder = [];
  const sourceChunks = chunks(sourceText), customBudget = MAX_CUSTOM - sourceChunks.length;
  const warn = message => { if (!warnings.includes(message)) warnings.push(message); };
  const leave = rows => { for (const row of rows) if (clean(row.text)) unmapped.set(row.index, row.text); };
  const order = id => { if (!visibleOrder.includes(id)) visibleOrder.push(id); };
  const bounded = (value, limit, label, rows) => {
    if (value.length <= limit) return value;
    warn(`${label} exceeds ${limit.toLocaleString('en-GB')} characters; its complete text remains in the retained source and unmapped text.`);
    leave(rows); return '';
  };
  const custom = (title, content, rows, review = false) => {
    if (!content.trim()) return;
    const parts = chunks(content);
    if (document.customSections.length + parts.length > customBudget) {
      warn('More custom sections were found than the CV can hold. Additional sections remain in the retained source and unmapped text.'); leave(rows); return;
    }
    for (const [index, part] of parts.entries()) {
      const id = `${idPrefix}-section-${document.customSections.length + 1}`;
      const suffix = parts.length > 1 ? ` (${index + 1}/${parts.length})` : '';
      if (title.length + suffix.length > 100) warn('A custom section title was shortened to fit its limit. The complete heading remains in the retained source.');
      document.customSections.push({ id, title: title.slice(0, 100 - suffix.length) + suffix, content: part }); order(id);
    }
    if (parts.length > 1) warn(`${title} was split into editable sections to fit the section size limit; no source text was removed.`);
    if (review) leave(rows);
  };
  const rows = sourceText.split(/[\n\f\u2028\u2029]/).map((text, index) => ({ text, index }));
  const sections = [{ kind: 'profile', title: 'Header', rows: [] }];
  let seenHeading = false;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], current = sections.at(-1);
    const sectionBoundary = index > 0 && !clean(rows[index - 1].text);
    const nearbyEntryDate = rows.slice(index + 1, index + 4).some(next => dateParts(next.text).dates);
    let found = heading(row.text, current.kind, seenHeading && sectionBoundary && !nearbyEntryDate);
    if (!found && index + 1 < rows.length && clean(row.text) && clean(rows[index + 1].text)) {
      const joined = `${compact(row.text)} ${compact(rows[index + 1].text)}`;
      const kind = HEADINGS.get(headingKey(joined));
      if (kind) { found = { kind, title: joined, rest: '' }; index++; }
    }
    if (found) {
      seenHeading = true;
      if (found.unknown) warn(`“${found.title}” was retained as a custom section. Check its heading and placement.`);
      const next = { kind: found.kind, title: found.title, rows: [] };
      if (found.rest) next.rows.push({ text: found.rest, index: row.index });
      sections.push(next);
    } else current.rows.push(row);
  }
  const detectedSections = sections.filter(section => section.rows.some(row => clean(row.text))).map(({ kind, title, rows }) => ({ kind, title, lines: rows.map(row => row.text) }));

  function setProfile(key, value, row) {
    value = bounded(clean(value), key === 'summary' ? 10_000 : 300, `Profile ${key}`, [row]);
    if (!value) return false;
    if (!document.profile[key]) { document.profile[key] = value; order('profile'); return true; }
    if (document.profile[key] === value) return true;
    warn(`More than one ${key} was found. The additional value remains in unmapped text.`); leave([row]); return false;
  }
  function profileRows(section) {
    const remaining = [];
    for (const row of section.rows) {
      let text = clean(row.text); if (!text) continue;
      const labelled = text.match(/^([^:]{1,35}):\s*(.+)$/);
      const key = labelled && FIELD_ALIASES.get(headingKey(labelled[1]));
      if (key) { setProfile(key, labelled[2], row); continue; }
      if (documentaryMetadata(text)) {
        leave([row]); warn('Document headings, page labels or confidentiality notices remain in unmapped text; they were not used as your name or professional title.'); continue;
      }
      // Removing recognised contact tokens from this local copy never alters
      // sourceText. Additional links or contact values remain reviewable.
      let contact = false;
      // Scan bounded tokens rather than repeatedly trying an email/domain
      // expression at every character of a 50,000-character paragraph.
      const emailTokens = text.includes('@') ? text.split(/[\s|<>·,;]+/) : [];
      for (const token of emailTokens) {
        if (!token.includes('@')) continue;
        if (token.length > 1_000) { warn('An unusually long contact value remains in unmapped text.'); leave([row]); continue; }
        const match = token.match(/[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}](?:[\p{L}\p{N}.-]*[\p{L}\p{N}])?\.[\p{L}]{2,63}/u);
        if (match) { contact = true; setProfile('email', match[0], row); text = text.replace(match[0], ' '); }
      }
      const linkTokens = text.includes('.') || text.includes('://') ? text.split(/[\s|<>·]+/) : [];
      for (const token of linkTokens) {
        if (token.length > 1_000) { if (/^(?:https?:\/\/|www\.)/i.test(token)) { warn('An unusually long contact value remains in unmapped text.'); leave([row]); } continue; }
        const match = token.match(/(?:https?:\/\/|www\.|(?:linkedin\.com|github\.com)\/)[^\s|<>·]+|\b(?:[\p{L}\p{N}-]+\.)+(?:com|org|net|io|dev|me|design|app|uk|edu|info)(?:\/[^\s|<>·]*)?/iu);
        if (match) { contact = true; const link = match[0].replace(/[),;.]$/g, ''); setProfile('website', link, row); text = text.replace(match[0], ' '); }
      }
      const phones = /\d/.test(text) ? [...text.matchAll(/(?:\+|\(?)[\d][\d ()\-.]{6,}\d(?:\s*(?:ext\.?|x)\s*\d{1,6})?/gi)] : [];
      for (const match of phones) {
        const digits = match[0].replace(/\D/g, '');
        if (digits.length < 9 || digits.length > 20 || RANGE.test(match[0])) continue;
        contact = true; setProfile('phone', match[0].trim(), row); text = text.replace(match[0], ' ');
      }
      text = stripSeparators(text.replace(/\b(?:email|e-mail|phone|mobile|tel|website|portfolio)\s*:?\s*/gi, ''));
      if (text) for (const part of text.split(/\s*[|·]\s*|\t+| {3,}|\s+[–—-]\s+/).map(stripSeparators).filter(Boolean)) remaining.push({ ...row, text: part, contact });
      else if (!contact) leave([row]);
    }
    // A known role is a useful boundary between identity and later location
    // rows. More than one preceding plausible identity requires human review;
    // positional guesses must not move the second name into title/location.
    const roleIndex = remaining.findIndex(row => ROLE.test(row.text) && !prose(row.text));
    const preceding = roleIndex < 0 ? [] : remaining.slice(0, roleIndex).filter(row => plausibleName(row.text));
    const candidates = section.kind === 'contact' ? [] : (preceding.length ? preceding : remaining.filter(row => plausibleName(row.text)));
    const candidateRows = new Set(candidates);
    const identities = [...new Set(candidates.map(row => row.text))];
    if (!document.profile.name && identities.length === 1) setProfile('name', identities[0], candidates[0]);
    else if (!document.profile.name && identities.length > 1) warn('More than one possible name was found. The name is left blank; compare the source and enter the correct identity before applying.');
    else if (document.profile.name && identities.some(value => value !== document.profile.name)) warn('An additional possible name remains in unmapped text. The explicitly supplied name has been kept; confirm the identity before applying.');
    const summary = [];
    for (const row of remaining) {
      const text = row.text;
      if (section.kind === 'contact') {
        if (!document.profile.location && /^[\p{L}\p{M} .'-]+,\s*[\p{L}\p{M} .'-]+$/u.test(text)) setProfile('location', text, row);
        else leave([row]);
        continue;
      }
      const words = text.split(/\s+/), nameLike = plausibleName(text);
      if (candidateRows.has(row)) { if (text !== document.profile.name) leave([row]); continue; }
      if (nameLike && words.length > 1 && !row.contact && !text.includes(',') && document.profile.headline) {
        leave([row]); warn('An additional name-like header line remains in unmapped text. Confirm whether it is a name, location or other detail.'); continue;
      }
      if (!document.profile.headline && !prose(text) && (ROLE.test(text) || (document.profile.name && !nameLike && words.length <= 12 && !text.includes(',') && !row.contact))) setProfile('headline', text, row);
      else if (!document.profile.location && !ROLE.test(text) && (row.contact || text.includes(',') || (document.profile.name && document.profile.headline && likelyLocation(text))) && /^[\p{L}\p{M} .,'’\-]+$/u.test(text) && words.length <= 10) setProfile('location', text, row);
      else if (prose(text) || /^(?:I\b|experienced\b|motivated\b|passionate\b|a[n]?\s)/i.test(text) || /[.!?]$/.test(text)) summary.push(row);
      else leave([row]);
    }
    if (summary.length) {
      const value = summary.map(row => row.text).join('\n');
      const merged = [document.profile.summary, value].filter(Boolean).join('\n\n');
      const boundedValue = bounded(merged, 10_000, 'Profile summary', summary);
      if (boundedValue) { document.profile.summary = boundedValue; order('profile'); }
    }
  }
  function mapEntries(section) {
    const kind = section.kind, titleLike = kind === 'education' ? DEGREE : ROLE;
    if (section.title.length <= 100) document.sectionTitles[kind] = section.title;
    for (const block of sectionBlocks(section.rows, kind)) {
      if (document[kind].length >= MAX_ITEMS) { warn(`Only the first 60 ${kind} entries fit in this CV. Further entries remain in the retained source and unmapped text.`); leave(block); continue; }
      const item = { id: `${idPrefix}-${kind}-${document[kind].length + 1}`, title: '', organisation: '', location: '', dates: '', description: '' };
      const headers = [], descriptions = [];
      let inDescription = false, inferred = false;
      for (const row of block) {
        const text = clean(row.text), part = dateParts(text);
        if (part.dates && !item.dates && !inDescription) item.dates = part.dates;
        const remaining = part.dates && !inDescription ? part.rest : text;
        if (!remaining) continue;
        const labelled = remaining.match(/^(role|title|position|degree|qualification|company|employer|organisation|organization|institution|university|school|location|dates?):\s*(.+)$/i);
        if (!inDescription && labelled) {
          const field = /^(?:role|title|position|degree|qualification)$/i.test(labelled[1]) ? 'title' : /^(?:location)$/i.test(labelled[1]) ? 'location' : /^dates?$/i.test(labelled[1]) ? 'dates' : 'organisation';
          if (!item[field]) item[field] = labelled[2].trim(); else descriptions.push(row);
          continue;
        }
        if (inDescription || BULLET.test(text) || prose(remaining) || headers.length >= 4) { inDescription = true; descriptions.push(row); }
        else headers.push({ row, text: remaining });
      }
      let parts = headers.flatMap(({ row, text }) => headerParts(text, kind).map(text => ({ row, text })));
      if (parts.length >= 2 && ORGANISATION.test(parts[0].text) && titleLike.test(parts[1].text)) [parts[0], parts[1]] = [parts[1], parts[0]];
      const hasHeader = Boolean(item.title || item.organisation || (parts.length && (item.dates || titleLike.test(parts[0].text) || (parts.length > 1 && ORGANISATION.test(parts[1].text)))));
      if (!hasHeader) {
        warn(`Some ${kind} text could not be separated into a reliable entry. It remains in a review section and unmapped text.`);
        custom(`${section.title} (review required)`, block.map(row => row.text).join('\n'), block, true); continue;
      }
      if (!item.title && parts.length) { const next = parts.shift(); item.title = next.text; inferred ||= !titleLike.test(next.text); }
      if (!item.organisation && parts.length) item.organisation = parts.shift().text;
      if (!item.location && parts.length && parts[0].text.length <= 100 && likelyLocation(parts[0].text) && !ACTION.test(parts[0].text) && !titleLike.test(parts[0].text) && !ORGANISATION.test(parts[0].text)) item.location = parts.shift().text;
      descriptions.unshift(...parts.map(({ row, text }) => ({ ...row, text })));
      for (const field of ['title', 'organisation', 'location', 'dates']) item[field] = bounded(item[field], 300, `${section.title} ${field}`, block);
      item.description = bounded(descriptions.map(row => unbullet(row.text)).join('\n'), 10_000, `${section.title} description`, descriptions);
      if (!item.title && !item.organisation) { leave(block); warn(`An ${kind} entry had dates but no reliable title or organisation. Review its retained source.`); continue; }
      if (inferred) warn(`Some ${kind} role or qualification labels were assigned from header order. Check them against the retained source.`);
      document[kind].push(item); order(kind);
    }
  }
  for (const section of sections) {
    if (!section.rows.some(row => clean(row.text))) continue;
    if (section.kind === 'profile' || section.kind === 'contact') profileRows(section);
    else if (section.kind === 'summary') {
      document.sectionTitles.profile = section.title;
      const summary = [document.profile.summary, section.rows.map(row => row.text).join('\n').trim()].filter(Boolean).join('\n\n');
      const value = bounded(summary, 10_000, 'Profile summary', section.rows);
      if (value) { document.profile.summary = value; order('profile'); }
    } else if (section.kind === 'experience' || section.kind === 'education') mapEntries(section);
    else if (section.kind === 'skills') {
      document.sectionTitles.skills = section.title;
      for (const row of section.rows) {
        let text = unbullet(row.text); if (!text) continue;
        const labelled = text.match(/^[^:]{1,60}:\s*(.+)$/); if (labelled) text = labelled[1];
        const values = text.split(/\s*[,;|·•]\s*|\t+| {3,}/).map(unbullet).filter(Boolean);
        for (const value of values) {
          if (document.skills.some(skill => skill.name === value)) continue;
          if (document.skills.length >= MAX_ITEMS) { warn('Only the first 60 skills fit in this CV. Further skills remain in the retained source and unmapped text.'); leave([row]); continue; }
          const name = bounded(value, 300, 'Skill name', [row]);
          if (name) document.skills.push({ id: `${idPrefix}-skill-${document.skills.length + 1}`, name });
        }
      }
      if (document.skills.length) order('skills');
    } else custom(section.title, section.rows.map(row => row.text).join('\n').trim(), section.rows);
  }
  if (!document.profile.name) warn('No reliable name was found. Add or confirm the name before accepting this proposal.');
  if (unmapped.size) warn('Some text was not confidently mapped. Review the unmapped text; the complete original text is also retained in hidden source sections.');
  for (const [index, content] of sourceChunks.entries()) {
    const id = `${idPrefix}-source-${index + 1}`;
    document.customSections.push({ id, title: sourceChunks.length === 1 ? 'Imported source (hidden)' : `Imported source (hidden ${index + 1}/${sourceChunks.length})`, content });
    document.hiddenSections.push(id);
  }
  document.sectionOrder = [...visibleOrder, ...['profile', 'experience', 'education', 'skills'].filter(id => !visibleOrder.includes(id)), ...document.hiddenSections];
  return { document: validateDocument(document), sourceText, warnings, detectedSections, unmappedText: [...unmapped].sort(([a], [b]) => a - b).map(([, text]) => text).join('\n') };
}
