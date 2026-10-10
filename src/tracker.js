import { validateDocument } from './model.js';

export const TRACKER_STATUSES = Object.freeze(['wishlist', 'applied', 'interview', 'offer', 'rejected', 'withdrawn']);
export const TRACKER_REQUIRED_FIELDS = Object.freeze(['id', 'company', 'role', 'url', 'status', 'appliedDate', 'followUpDate', 'notes', 'cvId']);
export const TRACKER_OPTIONAL_FIELDS = Object.freeze(['archived', 'tasks', 'customFields', 'submissions']);
export const TRACKER_CSV_COLUMNS = Object.freeze([...TRACKER_REQUIRED_FIELDS, 'archived', 'tasksTotal', 'tasksOpen', 'tasksDone', 'taskSummaries', 'submissionCount', 'submissionMetadata']);

function fail(message) { throw new Error(message); }
function record(value, allowed, required, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${name} must be a plain object.`);
  if (Reflect.ownKeys(value).some(key => !allowed.includes(key) || !Object.getOwnPropertyDescriptor(value, key).enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) || required.some(key => !Object.hasOwn(value, key))) fail(`${name} has missing or unsupported fields.`);
}
function string(value, name, limit) {
  if (typeof value !== 'string' || value.length > limit) fail(`${name} must be text of at most ${limit} characters.`);
}
function identifier(value, name) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail(`${name} must be a valid ID.`);
}
function date(value, name, required = false) {
  if (typeof value !== 'string' || (required && !value)) fail(`${name} must be a valid date in YYYY-MM-DD format.`);
  if (!value) return;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) fail(`${name} must be a valid date in YYYY-MM-DD format.`);
}
function timestamp(value, name) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString() !== value) fail(`${name} must be a canonical ISO timestamp, for example 2026-10-10T12:00:00.000Z.`);
}
function array(value, name, limit) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) fail(`${name} must be a list with at most ${limit} entries.`);
  const entryKeys = Reflect.ownKeys(value).filter(key => key !== 'length');
  if (entryKeys.length !== value.length || entryKeys.some((key, index) => key !== String(index) || !Object.getOwnPropertyDescriptor(value, key).enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail(`${name} must be a dense list without unsupported fields.`);
}
function nested(value, name, limit, keys, validate) {
  array(value, name, limit);
  const ids = new Set();
  return value.map(item => {
    record(item, keys, keys, `${name} entry`);
    identifier(item.id, `${name} entry ID`);
    if (ids.has(item.id)) fail(`${name} entry IDs must be unique within the list.`);
    ids.add(item.id);
    return validate(item);
  });
}

/**
 * Accepts the legacy application fields plus four optional additions. Only
 * missing additions receive defaults; explicit null/undefined or wrong types
 * are rejected. IDs are unique within each nested list, not across list types.
 * Returns detached data, including validated/migrated submission documents.
 * Workspace validation owns linked CV existence, URL policy and global IDs.
 */
export function validateTrackerFields(application) {
  record(application, [...TRACKER_REQUIRED_FIELDS, ...TRACKER_OPTIONAL_FIELDS], TRACKER_REQUIRED_FIELDS, 'Application');
  identifier(application.id, 'Application ID');
  for (const key of TRACKER_REQUIRED_FIELDS.filter(key => key !== 'id')) string(application[key], `Application ${key}`, key === 'notes' ? 10000 : 300);
  if (!TRACKER_STATUSES.includes(application.status)) fail('Choose a supported application status.');
  if (application.cvId) identifier(application.cvId, 'Linked CV ID');
  date(application.appliedDate, 'Applied date');
  date(application.followUpDate, 'Follow-up date');
  const archived = Object.hasOwn(application, 'archived') ? application.archived : false;
  if (typeof archived !== 'boolean') fail('Application archived must be true or false.');
  const tasks = nested(Object.hasOwn(application, 'tasks') ? application.tasks : [], 'Tasks', 30, ['id', 'title', 'dueDate', 'done'], item => {
    string(item.title, 'Task title', 200);
    date(item.dueDate, 'Task due date');
    if (typeof item.done !== 'boolean') fail('Task done must be true or false.');
    return { ...item };
  });
  const customFields = nested(Object.hasOwn(application, 'customFields') ? application.customFields : [], 'Custom fields', 20, ['id', 'label', 'value'], item => {
    string(item.label, 'Custom field label', 80);
    string(item.value, 'Custom field value', 2000);
    return { ...item };
  });
  const submissions = nested(Object.hasOwn(application, 'submissions') ? application.submissions : [], 'Submissions', 8, ['id', 'name', 'submittedAt', 'cvName', 'document'], item => {
    string(item.name, 'Submission name', 100);
    string(item.cvName, 'Submitted CV name', 100);
    timestamp(item.submittedAt, 'Submission date');
    return { ...item, document: validateDocument(item.document) };
  });
  return structuredClone({ ...application, archived, tasks, customFields, submissions });
}

function applications(value) {
  array(value, 'Applications', 150);
  const ids = new Set();
  return value.map(application => {
    const validated = validateTrackerFields(application);
    if (ids.has(validated.id)) fail('Application IDs must be unique within the supplied list.');
    ids.add(validated.id);
    return validated;
  });
}
const searchText = value => value.normalize('NFC').toLocaleLowerCase('en-GB');
function pendingDates(application) {
  return [application.followUpDate, ...application.tasks.filter(task => !task.done).map(task => task.dueDate)].filter(Boolean);
}

/**
 * Returns detached matching rows in input order. Query is a literal substring
 * over metadata, notes, task titles and custom fields, never snapshot content.
 * due: a pending date <= today; overdue: < today; open: a legacy follow-up date
 * or unfinished task; done: tasks exist, all done, and no legacy follow-up date.
 * A legacy follow-up date remains pending until cleared: it has no done field.
 * `today` is required for due/overdue and never derived from a system clock.
 */
export function filterApplications(apps, options = {}) {
  const allowed = ['query', 'status', 'archive', 'followUp', 'today'];
  record(options, allowed, [], 'Tracker filters');
  const { query = '', status = '', archive = 'active', followUp = 'all', today } = options;
  string(query, 'Search query', 10000);
  if (status !== '' && !TRACKER_STATUSES.includes(status)) fail('Choose a supported status filter.');
  if (!['active', 'archived', 'all'].includes(archive)) fail('Choose active, archived or all applications.');
  if (!['all', 'due', 'overdue', 'open', 'done'].includes(followUp)) fail('Choose a supported follow-up filter.');
  if (['due', 'overdue'].includes(followUp) || Object.hasOwn(options, 'today')) date(today, 'Today', true);
  const needle = searchText(query.trim());
  return applications(apps).filter(application => {
    if (archive === 'active' && application.archived || archive === 'archived' && !application.archived) return false;
    if (status && application.status !== status) return false;
    const dates = pendingDates(application);
    if (followUp === 'due' && !dates.some(value => value <= today)) return false;
    if (followUp === 'overdue' && !dates.some(value => value < today)) return false;
    if (followUp === 'open' && !application.followUpDate && !application.tasks.some(task => !task.done)) return false;
    if (followUp === 'done' && (application.followUpDate || !application.tasks.length || application.tasks.some(task => !task.done))) return false;
    if (!needle) return true;
    const searchable = [...TRACKER_REQUIRED_FIELDS.map(key => application[key]),
      ...application.tasks.map(task => task.title),
      ...application.customFields.flatMap(field => [field.label, field.value]),
      ...application.submissions.flatMap(submission => [submission.name, submission.cvName])].join('\n');
    return searchText(searchable).includes(needle);
  });
}

/**
 * Current-state analytics, not a funnel or historical stage conversion. total
 * includes all supplied rows; archivedCount and activeCount partition it. Every
 * other count excludes archived rows. statusCounts has all six current statuses.
 * appliedDateCounts is an ascending histogram of supplied appliedDate values;
 * appliedDateCount/undatedApplicationCount partition active rows. last7DaysApplied
 * counts dated rows in today-6..today inclusive; futureAppliedDates counts >today.
 * followUps counts the single legacy date per row: dated, due (<=today), overdue
 * (<today), upcoming (>today). tasks counts total/open/done, undatedOpen and dated
 * pending due/overdue/upcoming; completed task dates never count as pending.
 * submissions reports total stored snapshots and applicationsWithSubmissions.
 * `today` must be a supplied YYYY-MM-DD date; no system clock is consulted.
 */
export function applicationAnalytics(apps, options = {}) {
  record(options, ['today'], ['today'], 'Tracker analytics');
  date(options.today, 'Today', true);
  const today = options.today;
  const all = applications(apps);
  const active = all.filter(application => !application.archived);
  const todayTime = Date.parse(`${today}T00:00:00.000Z`);
  const weekStart = todayTime - 6 * 24 * 60 * 60 * 1000;
  const statusCounts = Object.fromEntries(TRACKER_STATUSES.map(status => [status, 0]));
  const appliedDates = new Map();
  const followUps = { dated: 0, due: 0, overdue: 0, upcoming: 0 };
  const tasks = { total: 0, open: 0, done: 0, undatedOpen: 0, due: 0, overdue: 0, upcoming: 0 };
  const submissions = { total: 0, applicationsWithSubmissions: 0 };
  let last7DaysApplied = 0;
  let futureAppliedDates = 0;
  const countPendingDate = (value, counts) => {
    if (value <= today) counts.due++;
    if (value < today) counts.overdue++;
    if (value > today) counts.upcoming++;
  };
  for (const application of active) {
    statusCounts[application.status]++;
    if (application.appliedDate) {
      appliedDates.set(application.appliedDate, (appliedDates.get(application.appliedDate) || 0) + 1);
      const appliedTime = Date.parse(`${application.appliedDate}T00:00:00.000Z`);
      if (appliedTime >= weekStart && appliedTime <= todayTime) last7DaysApplied++;
      if (application.appliedDate > today) futureAppliedDates++;
    }
    if (application.followUpDate) {
      followUps.dated++;
      countPendingDate(application.followUpDate, followUps);
    }
    for (const task of application.tasks) {
      tasks.total++;
      if (task.done) tasks.done++;
      else {
        tasks.open++;
        if (!task.dueDate) tasks.undatedOpen++;
        else countPendingDate(task.dueDate, tasks);
      }
    }
    submissions.total += application.submissions.length;
    if (application.submissions.length) submissions.applicationsWithSubmissions++;
  }
  const appliedDateCount = [...appliedDates.values()].reduce((sum, count) => sum + count, 0);
  return {
    today, total: all.length, archivedCount: all.length - active.length, activeCount: active.length,
    statusCounts, appliedDateCounts: [...appliedDates].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([date, count]) => ({ date, count })),
    appliedDateCount, undatedApplicationCount: active.length - appliedDateCount,
    last7DaysApplied, futureAppliedDates, followUps, tasks, submissions
  };
}

function csvCell(value) {
  let cell = String(value);
  // Quote/escape every field and neutralise formula/control prefixes, including
  // full-width variants and leading whitespace. Apostrophes may remain visible.
  // CSV cannot guarantee safety after a spreadsheet rewrites its escaping:
  // https://community.owasp.org/attacks/CSV_Injection
  if (/^[\s\p{Cc}\p{Cf}]*[=+\-@＝＋－＠]/u.test(cell) || /^[\s\p{Cc}\p{Cf}]*[\t\r\n]/u.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

function compareLabels(a, b) {
  const left = Array.from(a, char => char.codePointAt(0));
  const right = Array.from(b, char => char.codePointAt(0));
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

/**
 * Exports exactly the supplied list, including archived rows, in supplied order.
 * RFC4180 quoting and CRLF records protect field boundaries. Formula-like cells
 * receive a leading apostrophe, preserving the supplied text after that marker.
 * Fixed columns precede case-sensitive custom-label union sorted by codepoint,
 * with headers `Custom: label` to avoid collisions with fixed column names.
 * Repeated same-label values in one row are joined by LF in field order. Tasks
 * and submission metadata are JSON summaries; snapshot document data is omitted.
 */
export function applicationsToCsv(apps) {
  const rows = applications(apps);
  const customLabels = [...new Set(rows.flatMap(application => application.customFields.map(field => field.label)))].sort(compareLabels);
  const output = [[...TRACKER_CSV_COLUMNS, ...customLabels.map(label => `Custom: ${label}`)]];
  for (const application of rows) {
    const custom = new Map();
    for (const field of application.customFields) custom.set(field.label, [...(custom.get(field.label) || []), field.value]);
    const taskSummaries = application.tasks.map(({ id, title, dueDate, done }) => ({ id, title, dueDate, done }));
    const submissionMetadata = application.submissions.map(({ id, name, submittedAt, cvName }) => ({ id, name, submittedAt, cvName }));
    output.push([...TRACKER_REQUIRED_FIELDS.map(key => application[key]), application.archived,
      application.tasks.length, application.tasks.filter(task => !task.done).length, application.tasks.filter(task => task.done).length,
      JSON.stringify(taskSummaries), application.submissions.length, JSON.stringify(submissionMetadata),
      ...customLabels.map(label => (custom.get(label) || []).join('\n'))]);
  }
  return `${output.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
