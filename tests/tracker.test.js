import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleDocument } from '../src/model.js';
import { TRACKER_STATUSES, TRACKER_CSV_COLUMNS, validateTrackerFields, filterApplications, applicationAnalytics, applicationsToCsv, applicationBoard, moveTrackedApplication, applicationReminders, applicationCvMatch } from '../src/tracker.js';

const application = (id = 'job', changes = {}) => ({ id, company: 'Example', role: 'Designer', url: 'https://example.com/job', status: 'wishlist', appliedDate: '', followUpDate: '', notes: '', cvId: 'cv', ...changes });
const task = (id = 'task', changes = {}) => ({ id, title: 'Prepare examples', dueDate: '', done: false, ...changes });
const field = (id = 'field', changes = {}) => ({ id, label: 'Source', value: 'A referral', ...changes });
const submission = (id = 'submission', changes = {}) => ({ id, name: 'Submitted version', submittedAt: '2026-10-10T12:00:00.000Z', cvName: 'Design CV', document: sampleDocument(), ...changes });

// Independent CSV reader: verifies escaped cell boundaries and multiline text,
// rather than comparing the exported string with a second serializer.
function readCsv(csv) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\r' && csv[index + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; index++;
    } else cell += char;
  }
  assert.equal(quoted, false, 'Every quoted field must close.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function csvObjects(csv) {
  const [headers, ...rows] = readCsv(csv);
  assert.ok(rows.every(row => row.length === headers.length), 'Every record retains its column count.');
  return { headers, rows: rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]]))) };
}

test('legacy application values migrate with missing-only defaults and detached state', () => {
  const legacy = application('old', { company: 'Zoë, résumé', notes: '<script>literal</script>\nKeep this exact wording.' });
  const next = validateTrackerFields(legacy);
  for (const [key, value] of Object.entries(legacy)) assert.equal(next[key], value);
  assert.equal(next.archived, false);
  assert.deepEqual(next.tasks, []);
  assert.deepEqual(next.customFields, []);
  assert.deepEqual(next.submissions, []);
  next.tasks.push(task());
  assert.equal(Object.hasOwn(legacy, 'tasks'), false);
  assert.deepEqual(validateTrackerFields(legacy), { ...legacy, archived: false, tasks: [], customFields: [], submissions: [], description: '', location: '', salary: '' });
});

test('explicit malformed additions are rejected instead of being replaced with defaults', () => {
  for (const [key, values] of [['archived', [null, undefined, 0, 'false']], ['tasks', [null, undefined, false, {}]], ['customFields', [null, undefined, false, {}]], ['submissions', [null, undefined, false, {}]]]) {
    for (const value of values) assert.throws(() => validateTrackerFields(application('bad', { [key]: value })), Error, `${key}: ${String(value)}`);
  }
  assert.throws(() => validateTrackerFields({ ...application(), unsupported: true }), /unsupported/);
  const missingLegacy = application(); delete missingLegacy.company;
  assert.throws(() => validateTrackerFields(missingLegacy), /missing/);
  assert.throws(() => validateTrackerFields(application('bad', { notes: 0 })), /text/);
  assert.throws(() => validateTrackerFields(application('bad', { status: 'signed' })), /status/);
});

test('plain records, dense arrays, known fields and per-list unique IDs are required', () => {
  assert.throws(() => validateTrackerFields(Object.assign(Object.create(null), application())), /plain object/);
  assert.throws(() => validateTrackerFields(Object.assign(Object.create({ inherited: true }), application())), /plain object/);
  for (const [key, entry] of [['tasks', task()], ['customFields', field()], ['submissions', submission()]]) {
    assert.throws(() => validateTrackerFields(application('bad', { [key]: [{ ...entry, extra: 'unsupported' }] })), /unsupported/);
    assert.throws(() => validateTrackerFields(application('bad', { [key]: [entry, structuredClone(entry)] })), /unique/);
    assert.throws(() => validateTrackerFields(application('bad', { [key]: [Object.assign(Object.create({}), entry)] })), /plain object/);
    assert.throws(() => validateTrackerFields(application('bad', { [key]: [{ ...entry, id: 'invalid ID' }] })), /valid ID/);
  }
  assert.throws(() => validateTrackerFields(application('bad', { tasks: new Array(2) })), /list/);
  const annotated = [task()]; annotated.extra = true;
  assert.throws(() => validateTrackerFields(application('bad', { tasks: annotated })), /list/);
  const symbolic = application(); symbolic[Symbol('unsupported')] = true;
  assert.throws(() => validateTrackerFields(symbolic), /unsupported/);
  const concealed = application(); Object.defineProperty(concealed, 'extra', { value: true });
  assert.throws(() => validateTrackerFields(concealed), /unsupported/);
  const getter = application(); Object.defineProperty(getter, 'company', { enumerable: true, get() { throw new Error('Getter must not execute'); } });
  assert.throws(() => validateTrackerFields(getter), /unsupported/);
  // IDs can legitimately coincide in separate typed nested lists.
  assert.doesNotThrow(() => validateTrackerFields(application('valid', { tasks: [task('same')], customFields: [field('same')], submissions: [submission('same')] })));
});

test('nested list limits and text bounds protect imports without trimming supplied text', () => {
  for (const [key, limit, make] of [['tasks', 30, task], ['customFields', 20, field], ['submissions', 8, submission]]) {
    const values = Array.from({ length: limit }, (_, index) => make(`${key}-${index}`));
    assert.equal(validateTrackerFields(application('valid', { [key]: values }))[key].length, limit);
    assert.throws(() => validateTrackerFields(application('bad', { [key]: [...values, make('one-more')] })), /at most/);
  }
  const bounded = application('bounds', {
    tasks: [task('t', { title: ' '.repeat(200) })],
    customFields: [field('f', { label: 'L'.repeat(80), value: 'V'.repeat(2000) })],
    submissions: [submission('s', { name: 'N'.repeat(100), cvName: 'C'.repeat(100) })]
  });
  assert.equal(validateTrackerFields(bounded).tasks[0].title, ' '.repeat(200));
  for (const mutate of [
    value => { value.tasks[0].title += 'x'; },
    value => { value.customFields[0].label += 'x'; },
    value => { value.customFields[0].value += 'x'; },
    value => { value.submissions[0].name += 'x'; },
    value => { value.submissions[0].cvName += 'x'; }
  ]) { const value = structuredClone(bounded); mutate(value); assert.throws(() => validateTrackerFields(value), /text/); }
});

test('task dates and booleans are strict and snapshot timestamps must be canonical ISO', () => {
  for (const value of ['2026-02-30', '1900-02-29', '2026-13-01', '2026-10-10T12:00:00.000Z', 7, null]) assert.throws(() => validateTrackerFields(application('bad', { tasks: [task('t', { dueDate: value })] })), /date/);
  assert.doesNotThrow(() => validateTrackerFields(application('leap', { tasks: [task('t', { dueDate: '2000-02-29', done: true })] })));
  assert.throws(() => validateTrackerFields(application('bad', { tasks: [task('t', { done: 'false' })] })), /true or false/);
  for (const value of ['2026-10-10', '2026-10-10T12:00:00Z', '2026-10-10T13:00:00.000+01:00', '2026-02-30T12:00:00.000Z', '2026-10-10T24:00:00.000Z', null]) assert.throws(() => validateTrackerFields(application('bad', { submissions: [submission('s', { submittedAt: value })] })), /invalid saved date/);
});

test('submitted documents are validated and detached, including literal CV text', () => {
  const app = application('job', { submissions: [submission()] });
  app.submissions[0].document.profile.summary = 'Literal <tag> — café & 日本語';
  const next = validateTrackerFields(app);
  assert.equal(next.submissions[0].document.profile.summary, app.submissions[0].document.profile.summary);
  next.submissions[0].document.profile.name = 'Changed after validation';
  assert.equal(app.submissions[0].document.profile.name, 'Alex Morgan');
  app.submissions[0].document.style.template = 'unrecognised';
  assert.throws(() => validateTrackerFields(app), /template/);
});

function analyticsFixture() {
  return [
    application('old', { status: 'applied', appliedDate: '2026-10-03', followUpDate: '2026-10-09', tasks: [task('past', { dueDate: '2026-10-09' }), task('today', { dueDate: '2026-10-10' }), task('completed', { dueDate: '2026-10-08', done: true })], submissions: [submission()] }),
    application('boundary', { status: 'interview', appliedDate: '2026-10-04', followUpDate: '2026-10-10', tasks: [task('undated')] }),
    application('today', { status: 'wishlist', appliedDate: '2026-10-10', followUpDate: '2026-10-11', tasks: [task('next', { dueDate: '2026-10-11' })] }),
    application('repeat', { status: 'offer', appliedDate: '2026-10-10', tasks: [task('done', { dueDate: '2026-10-12', done: true })] }),
    application('future', { status: 'rejected', appliedDate: '2026-10-11', tasks: [task('open')] }),
    application('undated', { status: 'withdrawn' }),
    application('archived', { status: 'offer', archived: true, appliedDate: '2026-10-10', followUpDate: '2026-10-09', tasks: [task('old', { dueDate: '2026-10-09' })], submissions: [submission()] })
  ];
}

test('analytics describe active current state and supplied dates without inventing a historical funnel', () => {
  const result = applicationAnalytics(analyticsFixture(), { today: '2026-10-10' });
  assert.deepEqual(result, {
    today: '2026-10-10', total: 7, archivedCount: 1, activeCount: 6,
    statusCounts: { wishlist: 1, applied: 1, interview: 1, offer: 1, rejected: 1, withdrawn: 1 },
    appliedDateCounts: [{ date: '2026-10-03', count: 1 }, { date: '2026-10-04', count: 1 }, { date: '2026-10-10', count: 2 }, { date: '2026-10-11', count: 1 }],
    appliedDateCount: 5, undatedApplicationCount: 1, last7DaysApplied: 3, futureAppliedDates: 1,
    followUps: { dated: 3, due: 2, overdue: 1, upcoming: 1 },
    tasks: { total: 7, open: 5, done: 2, undatedOpen: 2, due: 2, overdue: 1, upcoming: 1 },
    submissions: { total: 1, applicationsWithSubmissions: 1 }
  });
  assert.equal(Object.hasOwn(result, 'conversionRate'), false);
});

test('weekly counts cross month/year boundaries and require an explicit valid today', () => {
  const apps = [application('included', { appliedDate: '2025-12-29' }), application('excluded', { appliedDate: '2025-12-28' }), application('today', { appliedDate: '2026-01-04' }), application('future', { appliedDate: '2026-01-05' })];
  const result = applicationAnalytics(apps, { today: '2026-01-04' });
  assert.equal(result.last7DaysApplied, 2);
  assert.equal(result.futureAppliedDates, 1);
  assert.throws(() => applicationAnalytics(apps), /missing/);
  assert.throws(() => applicationAnalytics(apps, { today: '2026-02-30' }), /date/);
  assert.deepEqual(applicationAnalytics([], { today: '2026-10-10' }).appliedDateCounts, []);
});

test('follow-up filters treat legacy dates and unfinished tasks as pending while preserving order', () => {
  const apps = analyticsFixture();
  const ids = options => filterApplications(apps, { today: '2026-10-10', ...options }).map(app => app.id);
  assert.deepEqual(ids({}), ['old', 'boundary', 'today', 'repeat', 'future', 'undated']);
  assert.deepEqual(ids({ followUp: 'due' }), ['old', 'boundary']);
  assert.deepEqual(ids({ followUp: 'overdue' }), ['old']);
  assert.deepEqual(ids({ followUp: 'open' }), ['old', 'boundary', 'today', 'future']);
  assert.deepEqual(ids({ followUp: 'done' }), ['repeat']);
  assert.deepEqual(ids({ archive: 'archived', followUp: 'due' }), ['archived']);
  assert.deepEqual(ids({ archive: 'all', status: 'offer' }), ['repeat', 'archived']);
  assert.throws(() => filterApplications(apps, { followUp: 'due' }), /date/);
  for (const options of [{ status: 'invented' }, { archive: 'unknown' }, { followUp: 'unknown' }, { query: [] }, { today: '' }, { extra: true }]) assert.throws(() => filterApplications(apps, options), Error);
});

test('search is literal and Unicode-normalised over metadata, never snapshot documents', () => {
  const secretSubmission = submission();
  secretSubmission.document.profile.summary = 'Snapshot-private secretneedle';
  const apps = [application('unicode', { company: 'Cafe\u0301 studio', notes: 'The token .* is literal', tasks: [task('t', { title: 'Review Portfolio' })], customFields: [field('f', { label: 'Contact', value: 'Samira' })], submissions: [secretSubmission] }), application('other')];
  const ids = query => filterApplications(apps, { query }).map(app => app.id);
  assert.deepEqual(ids('CAFÉ'), ['unicode']);
  assert.deepEqual(ids('.*'), ['unicode']);
  assert.deepEqual(ids('portfolio'), ['unicode']);
  assert.deepEqual(ids('samira'), ['unicode']);
  assert.deepEqual(ids('Submitted version'), ['unicode']);
  assert.deepEqual(ids('secretneedle'), []);
  assert.deepEqual(ids('[anything]'), []);
});

test('helpers reject duplicate top-level application IDs and keep caller state unchanged', () => {
  const apps = analyticsFixture();
  const before = structuredClone(apps);
  const filtered = filterApplications(apps);
  filtered[0].tasks[0].title = 'Edited returned data';
  applicationAnalytics(apps, { today: '2026-10-10' });
  applicationsToCsv(apps);
  assert.deepEqual(apps, before);
  const duplicate = [application('same'), application('same')];
  assert.throws(() => filterApplications(duplicate), /unique/);
  assert.throws(() => applicationAnalytics(duplicate, { today: '2026-10-10' }), /unique/);
  assert.throws(() => applicationsToCsv(duplicate), /unique/);
});

test('CSV preserves commas, quotes, CR/LF and Unicode with fixed columns and exact supplied row order', () => {
  const apps = [application('second', { archived: true, company: 'Zoë, studio', role: 'Designer "systems"', notes: 'First line\r\nSecond line\n日本語' }), application('first', { company: 'Another' })];
  const csv = applicationsToCsv(apps);
  assert.ok(csv.endsWith('\r\n'));
  const { headers, rows } = csvObjects(csv);
  assert.deepEqual(headers, [...TRACKER_CSV_COLUMNS]);
  assert.deepEqual(rows.map(row => row.id), ['second', 'first']);
  for (const key of ['company', 'role', 'notes', 'url', 'cvId']) assert.equal(rows[0][key], apps[0][key]);
  assert.equal(rows[0].archived, 'true');
  assert.equal(readCsv(applicationsToCsv([])).length, 1);
});

test('CSV custom labels have a stable case-sensitive union and never collide with fixed headers', () => {
  const apps = [application('one', { customFields: [field('a', { label: 'company', value: 'Custom company' }), field('b', { label: 'Source', value: 'First source' }), field('c', { label: 'Source', value: 'Second source' })] }), application('two', { customFields: [field('d', { label: 'Company', value: 'Other case' }), field('e', { label: '__proto__', value: 'Safe map key' })] })];
  const { headers, rows } = csvObjects(applicationsToCsv(apps));
  assert.deepEqual(headers.slice(TRACKER_CSV_COLUMNS.length), ['Custom: Company', 'Custom: Source', 'Custom: __proto__', 'Custom: company']);
  assert.equal(rows[0].company, 'Example');
  assert.equal(rows[0]['Custom: company'], 'Custom company');
  assert.equal(rows[0]['Custom: Source'], 'First source\nSecond source');
  assert.equal(rows[0]['Custom: Company'], '');
  assert.equal(rows[1]['Custom: Company'], 'Other case');
  assert.equal(rows[1]['Custom: __proto__'], 'Safe map key');
  assert.deepEqual(csvObjects(applicationsToCsv([...apps].reverse())).headers, headers);
  const unicode = application('unicode', { customFields: [field('emoji', { label: '😀', value: 'Supplementary character' }), field('private-use', { label: '\uE000', value: 'BMP character' })] });
  assert.deepEqual(csvObjects(applicationsToCsv([unicode])).headers.slice(TRACKER_CSV_COLUMNS.length), ['Custom: \uE000', 'Custom: 😀']);
});

test('CSV neutralises formula/control prefixes including Unicode variants without removing supplied text', () => {
  const risky = ['=SUM(1,2)', '+1', '-1', '@SUM(1)', '   =HYPERLINK("https://example.com")', '\tNormal text', '\rNormal text', '\nNormal text', '\u0000=1', '\u200e=1', '\u2066=1', '＝SUM(1)', '＋1', '－1', '＠SUM(1)'];
  for (const [index, value] of risky.entries()) {
    const { rows } = csvObjects(applicationsToCsv([application(`risk-${index}`, { company: value, customFields: [field('f', { label: 'User text', value })] })]));
    assert.equal(rows[0].company, `'${value}`);
    assert.equal(rows[0]['Custom: User text'], `'${value}`);
  }
  for (const value of ['Plain text', 'Normal = later formula', "'=Already text", 'Normal,=still one quoted field', 'A "quote";=inside one field']) assert.equal(csvObjects(applicationsToCsv([application('safe', { company: value })])).rows[0].company, value);
});

test('CSV includes task and submission metadata but excludes frozen snapshot document content', () => {
  const snapshot = submission();
  snapshot.document.profile.summary = 'PRIVATE-SNAPSHOT-TEXT';
  snapshot.document.jobAd = 'PRIVATE-JOB-AD';
  const app = application('job', { tasks: [task('one', { title: '=A supplied task', dueDate: '2026-10-10' }), task('two', { done: true })], submissions: [snapshot] });
  const csv = applicationsToCsv([app]);
  assert.doesNotMatch(csv, /PRIVATE-SNAPSHOT-TEXT|PRIVATE-JOB-AD/);
  const row = csvObjects(csv).rows[0];
  assert.equal(row.tasksTotal, '2');
  assert.equal(row.tasksOpen, '1');
  assert.equal(row.tasksDone, '1');
  assert.deepEqual(JSON.parse(row.taskSummaries), app.tasks);
  assert.equal(row.submissionCount, '1');
  assert.deepEqual(JSON.parse(row.submissionMetadata), [{ id: snapshot.id, name: snapshot.name, submittedAt: snapshot.submittedAt, cvName: snapshot.cvName }]);
  assert.equal(Object.hasOwn(JSON.parse(row.submissionMetadata)[0], 'document'), false);
});

test('new advert fields have missing-only defaults, strict bounds and preserve literal text', () => {
  const description = 'Role: Designer\r\nLiteral <script>alert(1)</script>\n日本語 café\n' + 'D'.repeat(49928);
  const source = application('new-details', { description, location: ' Bristol — hybrid ', salary: ' £50,000–£65,000 ' });
  const next = validateTrackerFields(source);
  assert.equal(next.description, description);
  assert.equal(next.location, source.location);
  assert.equal(next.salary, source.salary);
  for (const key of ['description', 'location', 'salary']) {
    for (const value of [undefined, null, false, [], {}, 12]) assert.throws(() => validateTrackerFields(application('bad', { [key]: value })), /text/);
    const limit = key === 'description' ? 50000 : 300;
    assert.equal(validateTrackerFields(application('limit', { [key]: 'X'.repeat(limit) }))[key].length, limit);
    assert.throws(() => validateTrackerFields(application('too-long', { [key]: 'X'.repeat(limit + 1) })), /at most/);
    let reads = 0;
    const accessor = application(); Object.defineProperty(accessor, key, { enumerable: true, get() { reads++; return ''; } });
    assert.throws(() => validateTrackerFields(accessor), /unsupported/); assert.equal(reads, 0);
  }
  assert.deepEqual(filterApplications([source], { query: '日本語 café' }).map(app => app.id), ['new-details']);
  assert.deepEqual(filterApplications([source], { query: 'HYBRID' }).map(app => app.id), ['new-details']);
  assert.deepEqual(filterApplications([source], { query: '£65,000' }).map(app => app.id), ['new-details']);
  const row = csvObjects(applicationsToCsv([source])).rows[0];
  assert.equal(row.description, description); assert.equal(row.location, source.location); assert.equal(row.salary, source.salary);
  assert.equal(csvObjects(applicationsToCsv([application('formula', { description: '=HYPERLINK("https://example.invalid")' })])).rows[0].description[0], "'");
});

test('board groups all stages in a stable order without changing caller state or dropping archived data', () => {
  const apps = [application('second', { status: 'interview', tasks: [task()] }), application('first'), application('third', { status: 'interview', archived: true })];
  const before = structuredClone(apps);
  const board = applicationBoard(apps);
  assert.deepEqual(board.map(column => column.status), [...TRACKER_STATUSES]);
  assert.deepEqual(board.find(column => column.status === 'interview').applications.map(app => app.id), ['second', 'third']);
  assert.deepEqual(board.find(column => column.status === 'applied').applications, []);
  board.find(column => column.status === 'interview').applications[0].tasks[0].done = true;
  assert.deepEqual(apps, before);
  assert.throws(() => applicationBoard([application('same'), application('same')]), /unique/);
  assert.throws(() => applicationBoard(new Array(2)), /dense/);
});

test('board move changes only stage, preserving tasks, descriptions, links, custom fields and submitted copies', () => {
  const rich = validateTrackerFields(application('rich', { description: 'A saved original advert', location: 'Remote', salary: '£55,000', followUpDate: '2026-10-10', tasks: [task()], customFields: [field()], submissions: [submission()] }));
  const apps = [rich, validateTrackerFields(application('other', { status: 'offer' }))];
  const before = structuredClone(apps);
  const moved = moveTrackedApplication(apps, 'rich', 'interview');
  assert.deepEqual(moved, [{ ...rich, status: 'interview' }, apps[1]]);
  assert.deepEqual(apps, before);
  moved[0].submissions[0].document.profile.name = 'Edited returned copy';
  assert.equal(apps[0].submissions[0].document.profile.name, before[0].submissions[0].document.profile.name);
  assert.throws(() => moveTrackedApplication(apps, 'missing', 'applied'), /not found/);
  assert.throws(() => moveTrackedApplication(apps, 'rich', 'invented'), /status/);
  assert.throws(() => moveTrackedApplication(apps, '../rich', 'offer'), /valid ID/);
  assert.throws(() => moveTrackedApplication([{ ...rich, archived: true }], 'rich', 'applied'), /Restore/);
  assert.deepEqual(apps, before);
});

test('reminders cover only active pending dates, sorted by due date with explicit today and no clock assumption', () => {
  const apps = analyticsFixture();
  const before = structuredClone(apps);
  const reminders = applicationReminders(apps, { today: '2026-10-10' });
  assert.deepEqual(reminders, [
    { applicationId: 'old', kind: 'followUp', taskId: '', title: 'Follow up', dueDate: '2026-10-09', state: 'overdue' },
    { applicationId: 'old', kind: 'task', taskId: 'past', title: 'Prepare examples', dueDate: '2026-10-09', state: 'overdue' },
    { applicationId: 'old', kind: 'task', taskId: 'today', title: 'Prepare examples', dueDate: '2026-10-10', state: 'today' },
    { applicationId: 'boundary', kind: 'followUp', taskId: '', title: 'Follow up', dueDate: '2026-10-10', state: 'today' }
  ]);
  const upcoming = applicationReminders(apps, { today: '2026-10-10', includeUpcoming: true });
  assert.equal(upcoming.length, 6); assert.equal(upcoming.at(-1).state, 'upcoming');
  assert.ok(upcoming.every(row => row.applicationId !== 'archived' && row.taskId !== 'completed' && row.taskId !== 'done' && row.taskId !== 'undated'));
  assert.equal(applicationReminders(apps, { today: '2026-10-08' }).length, 0);
  assert.equal(applicationReminders([application('empty-title', { tasks: [task('t', { title: '', dueDate: '2026-10-10' })] })], { today: '2026-10-10' })[0].title, 'Unnamed task');
  assert.throws(() => applicationReminders(apps), /missing/);
  assert.throws(() => applicationReminders(apps, { today: '2026-02-30' }), /date/);
  assert.throws(() => applicationReminders(apps, { today: '2026-10-10', includeUpcoming: 'true' }), /true or false/);
  let reads = 0; const accessor = {}; Object.defineProperty(accessor, 'today', { enumerable: true, get() { reads++; return '2026-10-10'; } });
  assert.throws(() => applicationReminders(apps, accessor), /unsupported/); assert.equal(reads, 0);
  assert.deepEqual(apps, before);
});

test('local comparison uses the saved advert and visible linked CV, excluding hidden skills and submitted copies', () => {
  const document = sampleDocument();
  document.profile.headline = 'Designer'; document.profile.summary = 'Figma';
  document.experience = []; document.education = []; document.skills = [{ id: 's', name: 'SecretSkill' }]; document.hiddenSections = ['skills'];
  const snapshot = submission(); snapshot.document.profile.summary = 'Python snapshotonly';
  const app = application('local-match', { description: 'Figma Figma Python SecretSkill snapshotonly', submissions: [snapshot] });
  const before = structuredClone({ app, document });
  const match = applicationCvMatch(app, document);
  assert.deepEqual(match.found, ['figma']);
  assert.deepEqual(new Set(match.missing), new Set(['python', 'secretskill', 'snapshotonly']));
  assert.equal(match.percentage, 25);
  assert.deepEqual({ app, document }, before);
  assert.equal(applicationCvMatch(application('no-advert'), document).percentage, null);
  const manyTerms = Array.from({ length: 50 }, (_, index) => `Term${index}`).join(' ');
  assert.equal(applicationCvMatch(application('many', { description: manyTerms }), document).keywords.length, 24);
  assert.throws(() => applicationCvMatch(app, { ...document, unsupported: true }), /unsupported/);
});
