const DRAFT_FIELDS = ['company', 'role', 'url', 'location', 'salary', 'description'];
function fail(message) { throw new Error(message); }
function record(value, keys, required, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${name} must be a plain object.`);
  if (Reflect.ownKeys(value).some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !keys.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
  }) || required.some(key => !Object.hasOwn(value, key))) fail(`${name} has missing or unsupported fields.`);
}
function text(value, name, limit) {
  if (typeof value !== 'string' || value.length > limit) fail(`${name} must be text of at most ${limit} characters.`);
}
function sourceUrl(value) {
  text(value, 'Job link', 300);
  const url = value.trim();
  if (!url) return '';
  // URL parsing can silently discard controls or turn backslashes into slashes.
  // Reject those forms before parsing; links are references and are never fetched.
  if (!/^https?:\/\//i.test(url) || /[\s\p{Cc}\p{Cf}\\]/u.test(url)) fail('Use a complete http:// or https:// job link without spaces or hidden characters.');
  let parsed;
  try { parsed = new URL(url); } catch { fail('That job link is incomplete. Check the address and try again.'); }
  if (!parsed.hostname || parsed.username || parsed.password) fail('Use a job link without a username or password.');
  return url;
}

/** Validate the edited review before creating a single, complete job record. */
export function validateJobDraft(value) {
  record(value, DRAFT_FIELDS, DRAFT_FIELDS, 'Job details');
  const draft = {};
  for (const key of DRAFT_FIELDS) {
    text(value[key], key === 'description' ? 'Job description' : `Job ${key}`, key === 'description' ? 50000 : 300);
    draft[key] = key === 'description' ? value[key] : value[key].trim();
  }
  draft.url = sourceUrl(value.url);
  if (!Object.values(draft).some(value => value.trim())) fail('Paste a job description, add a link, or enter a company or role first.');
  return draft;
}

/**
 * Conservative extraction from pasted text. It never requests a web page,
 * interprets HTML or runs embedded instructions. All guesses are reviewed and
 * editable, and the description remains exactly as pasted in the saved draft.
 */
export function analyseJobPosting(options = {}) {
  record(options, ['text', 'url'], [], 'Job intake');
  const description = Object.hasOwn(options, 'text') ? options.text : '';
  const suppliedUrl = Object.hasOwn(options, 'url') ? options.url : '';
  text(description, 'Job description', 50000);
  const url = sourceUrl(suppliedUrl);
  if (!description.trim() && !url) fail('Paste the job description or add its link first.');
  const draft = { company: '', role: '', url, location: '', salary: '', description };
  const warnings = [];
  const lines = description.split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean);
  const labels = {
    company: /^(?:company|employer|organisation|organization)\s*:\s*(.+)$/i,
    role: /^(?:job\s+title|position|role|title)\s*:\s*(.+)$/i,
    location: /^(?:job\s+location|location|work\s+location)\s*:\s*(.+)$/i,
    salary: /^(?:salary|pay|salary\s+range|compensation)\s*:\s*(.+)$/i,
    url: /^(?:job\s+(?:url|link)|url|link|source)\s*:\s*(https?:\/\/\S+)$/i
  };
  for (const key of Object.keys(labels)) {
    const values = [...new Set(lines.map(line => line.match(labels[key])?.[1]?.trim()).filter(Boolean))];
    if (!values.length || (key === 'url' && draft.url)) continue;
    if (values.length > 1) warnings.push(`More than one ${key === 'role' ? 'role' : key === 'url' ? 'link' : key} was found. Check the first one below.`);
    if (key === 'url') {
      try { draft.url = sourceUrl(values[0]); } catch { warnings.push('The link in the text could not be used. Add a complete job link below.'); }
    } else if (values[0].length > 300) warnings.push(`The ${key} line is too long. Enter a shorter value below.`);
    else draft[key] = values[0];
  }
  // A clearly separated opening headline is a useful fallback. Do not infer an
  // employer from a domain, a skills requirement or a line inside the advert.
  const headline = lines[0]?.match(/^(.{1,150}?)\s+at\s+(.{1,150})$/i);
  if (headline && !/[<>:]/.test(lines[0])) {
    if (!draft.role) draft.role = headline[1].trim();
    if (!draft.company) draft.company = headline[2].trim();
  }
  if (!draft.salary) {
    const salaryLine = lines.find(line => line.length <= 300 && /(?:£|€|\$|\b(?:GBP|USD|EUR)\s*)\s*\d[\d,.]*(?:\s*[kK])?/.test(line) && /(?:salary|pay|per\s+(?:year|annum|month|hour)|\/(?:year|yr|hour|hr)|p\.a\.)/i.test(line));
    if (salaryLine) draft.salary = salaryLine;
  }
  if (!description.trim()) warnings.push('Links are saved as references. Paste the job text to extract its details; ClearCV does not open the website.');
  if (!draft.company || !draft.role) warnings.push('Check the company and role before adding this job. Any details we could not find are left blank.');
  return { ...draft, warnings };
}
