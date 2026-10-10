import { validateDocument, parseDocument, createDocument } from './model.js';
import { validateTrackerFields } from './tracker.js';
export const WORKSPACE_SCHEMA = 'clearcv.workspace';
export const WORKSPACE_VERSION = 1;
export const MAX_WORKSPACE_BYTES = 4_000_000;
export const MAX_CVS = 100;
export const MAX_SAVED_LETTERS = 20;
export const JOB_STATUSES = ['wishlist', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'];
const PROFILE_KEYS = ['name', 'headline', 'email', 'phone', 'location', 'website', 'summary'];
const APP_KEYS = ['id', 'company', 'role', 'url', 'status', 'appliedDate', 'followUpDate', 'notes', 'cvId', 'description', 'location', 'salary'];
function fail(message) { throw new Error(message); }
function object(value, allowed, name, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${name} must be an object.`);
  if (Reflect.ownKeys(value).some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !allowed.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
  }) || required.some(key => !Object.hasOwn(value, key))) fail(`${name} has missing or unsupported fields.`);
}
function list(value, name, maximum, minimum = 0) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum) fail(`${name} must be a list with ${minimum ? `between ${minimum} and` : 'at most'} ${maximum} entries.`);
  const keys = Reflect.ownKeys(value).filter(key => key !== 'length');
  if (keys.length !== value.length || keys.some((key, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return key !== String(index) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
  })) fail(`${name} must be a dense list without unsupported fields.`);
}
function text(value, label, limit = 300) {
  if (typeof value !== 'string' || value.length > limit) fail(`${label} must be text of at most ${limit} characters.`);
}
function identifier(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail('Invalid workspace entry ID.'); }
function date(value, label) { if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) fail(`${label} must be a valid date.`); }
function timestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('A snapshot has an invalid saved date. Choose another backup.');
}
function size(value) { if (new TextEncoder().encode(JSON.stringify(value, null, 2)).length > MAX_WORKSPACE_BYTES) fail('Your library is over 4 MB. Download a backup, then remove snapshots or photos you no longer need.'); }
export function validateWorkspace(value) {
  const core = ['schema', 'version', 'activeId', 'masterProfile', 'documents', 'applications'];
  object(value, [...core, 'masterDocument', 'letters'], 'Workspace', core);
  if (value.schema !== WORKSPACE_SCHEMA || value.version !== WORKSPACE_VERSION) fail('This backup uses an unsupported ClearCV workspace version. Choose another backup.');
  object(value.masterProfile, PROFILE_KEYS, 'Master profile');
  const masterProfile = validateDocument({ ...createDocument(), profile: value.masterProfile }).profile;
  list(value.documents, 'CVs', MAX_CVS, 1);
  list(value.applications, 'Applications', 150);
  // Inspect originals before cloning: structuredClone would execute accessors
  // and discard hidden fields, bypassing the validators for nested records.
  const next = { schema: value.schema, version: value.version, activeId: value.activeId, masterProfile, documents: [], applications: [], letters: [] };
  const ids = new Set();
  for (const entry of value.documents) {
    object(entry, ['id', 'name', 'document', 'versions'], 'CV library entry'); identifier(entry.id);
    if (ids.has(entry.id)) fail('Duplicate CV library ID.'); ids.add(entry.id);
    text(entry.name, 'CV name', 100);
    if (!entry.name.trim()) fail('Give each CV a name.');
    const document = validateDocument(entry.document);
    list(entry.versions, 'Named snapshots', 10);
    const versionIds = new Set();
    const versions = entry.versions.map(version => {
      object(version, ['id', 'name', 'createdAt', 'document'], 'Snapshot'); identifier(version.id);
      if (versionIds.has(version.id)) fail('Duplicate snapshot ID.'); versionIds.add(version.id);
      text(version.name, 'Snapshot name', 100); text(version.createdAt, 'Snapshot date', 30);
      if (!version.name.trim()) fail('A snapshot has an invalid name. Choose another backup.');
      timestamp(version.createdAt);
      return { id: version.id, name: version.name, createdAt: version.createdAt, document: validateDocument(version.document) };
    });
    next.documents.push({ id: entry.id, name: entry.name, document, versions });
  }
  next.masterDocument = validateDocument(Object.hasOwn(value, 'masterDocument') ? value.masterDocument : { ...next.documents[0].document, profile: next.masterProfile });
  const letters = Object.hasOwn(value, 'letters') ? value.letters : [];
  list(letters, 'Saved letters', MAX_SAVED_LETTERS);
  const letterIds = new Set();
  for (const saved of letters) {
    object(saved, ['id', 'name', 'coverLetter', 'richText'], 'Saved letter');
    identifier(saved.id); text(saved.name, 'Letter name', 100);
    if (!saved.name.trim() || letterIds.has(saved.id)) fail('Give each saved letter a name and a unique ID.');
    letterIds.add(saved.id);
    const document = validateDocument({ ...createDocument(), coverLetter: saved.coverLetter, richText: saved.richText });
    if (Object.keys(document.richText).some(key => key !== 'coverLetter.body')) fail('Saved letters can only format their own body.');
    next.letters.push({ id: saved.id, name: saved.name, coverLetter: document.coverLetter, richText: document.richText });
  }
  if (!ids.has(next.activeId)) fail('The active CV must exist in the library.');
  next.applications = value.applications.map(validateTrackerFields);
  const appIds = new Set();
  for (const application of next.applications) {
    identifier(application.id);
    if (appIds.has(application.id)) fail('Duplicate application ID.'); appIds.add(application.id);
    for (const key of APP_KEYS.filter(key => key !== 'id')) text(application[key], `Application ${key}`, key === 'description' ? 50000 : key === 'notes' ? 10000 : 300);
    if (!JOB_STATUSES.includes(application.status)) fail('Choose a supported application status.');
    if (application.cvId && !ids.has(application.cvId)) fail('A linked CV must exist in the library.');
    if (application.url && !/^https?:\/\//i.test(application.url)) fail('Job links must start with https:// or http://.');
    date(application.appliedDate, 'Applied date'); date(application.followUpDate, 'Follow-up date');
  }
  size(next);
  return next;
}
export function createWorkspace(document, id = 'initial-cv', name = 'My CV') {
  const doc = validateDocument(document);
  return validateWorkspace({ schema: WORKSPACE_SCHEMA, version: WORKSPACE_VERSION, activeId: id, masterProfile: structuredClone(doc.profile), masterDocument: structuredClone(doc), documents: [{ id, name, document: doc, versions: [] }], applications: [] });
}
export function activeEntry(workspace) { return workspace.documents.find(entry => entry.id === workspace.activeId); }
export function updateActiveDocument(workspace, document) {
  const next = validateWorkspace(workspace);
  activeEntry(next).document = validateDocument(document);
  return validateWorkspace(next);
}
export function saveReusableLetter(workspace, id, name) {
  text(name, 'Saved letter name', 300);
  const next = validateWorkspace(workspace), doc = activeEntry(next).document;
  next.letters.push({ id, name: name.trim(), coverLetter: structuredClone(doc.coverLetter),
    richText: Object.hasOwn(doc.richText, 'coverLetter.body') ? { 'coverLetter.body': structuredClone(doc.richText['coverLetter.body']) } : {} });
  return validateWorkspace(next);
}
export function useReusableLetter(workspace, id) {
  const next = validateWorkspace(workspace), saved = next.letters.find(letter => letter.id === id);
  if (!saved) fail('Saved letter not found.');
  const doc = activeEntry(next).document;
  doc.coverLetter = structuredClone(saved.coverLetter);
  delete doc.richText['coverLetter.body'];
  if (Object.hasOwn(saved.richText, 'coverLetter.body')) doc.richText['coverLetter.body'] = structuredClone(saved.richText['coverLetter.body']);
  return validateWorkspace(next);
}
export function removeReusableLetter(workspace, id) {
  const next = validateWorkspace(workspace);
  if (!next.letters.some(letter => letter.id === id)) fail('Saved letter not found.');
  next.letters = next.letters.filter(letter => letter.id !== id);
  return validateWorkspace(next);
}
export function addDocument(workspace, document, id, name = 'Untitled CV') {
  const next = validateWorkspace(workspace);
  next.documents.push({ id, name, document: validateDocument(document), versions: [] }); next.activeId = id;
  return validateWorkspace(next);
}
export function duplicateDocument(workspace, id, name) {
  const next = validateWorkspace(workspace);
  return addDocument(next, activeEntry(next).document, id, name);
}
export function deleteDocument(workspace, id) {
  const next = validateWorkspace(workspace);
  if (next.documents.length === 1) fail('Keep at least one CV in your library.');
  if (!next.documents.some(entry => entry.id === id)) fail('CV not found.');
  next.documents = next.documents.filter(entry => entry.id !== id);
  next.applications = next.applications.map(app => app.cvId === id ? { ...app, cvId: '' } : app);
  if (next.activeId === id) next.activeId = next.documents[0].id;
  return validateWorkspace(next);
}
export function saveSnapshot(workspace, id, name, createdAt = new Date().toISOString()) {
  const next = validateWorkspace(workspace);
  const entry = activeEntry(next);
  entry.versions.push({ id, name, createdAt, document: structuredClone(entry.document) });
  return validateWorkspace(next);
}
export function restoreSnapshot(workspace, id, recoveryId, createdAt = new Date().toISOString()) {
  const next = validateWorkspace(workspace);
  const entry = activeEntry(next);
  const snapshot = entry.versions.find(version => version.id === id);
  if (!snapshot) fail('Snapshot not found.');
  if (entry.versions.length >= 10) fail('Remove a snapshot you no longer need before restoring. Restore also saves a snapshot of your current CV.');
  entry.versions.push({ id: recoveryId, name: 'Before restore', createdAt, document: structuredClone(entry.document) });
  entry.document = structuredClone(snapshot.document);
  return validateWorkspace(next);
}
export function addApplication(workspace, id) {
  const next = validateWorkspace(workspace);
  next.applications.unshift({ id, company: '', role: '', url: '', status: 'wishlist', appliedDate: '', followUpDate: '', notes: '', cvId: next.activeId });
  return validateWorkspace(next);
}
export function updateApplication(workspace, id, field, value) {
  if ((!APP_KEYS.includes(field) && field !== 'archived') || field === 'id') fail('Unknown application field.');
  const next = validateWorkspace(workspace);
  const application = next.applications.find(app => app.id === id);
  if (!application) fail('Application not found.');
  application[field] = value;
  return validateWorkspace(next);
}
function applicationEntry(workspace, id) {
  const application = workspace.applications.find(app => app.id === id);
  if (!application) fail('Application not found.');
  return application;
}
function editApplicationList(workspace, applicationId, collection, edit) {
  const next = validateWorkspace(workspace);
  const application = applicationEntry(next, applicationId);
  application[collection] = edit(application[collection]);
  return validateWorkspace(next);
}
export function addApplicationTask(workspace, applicationId, id) {
  return editApplicationList(workspace, applicationId, 'tasks', tasks => [...tasks, { id, title: 'Follow up', dueDate: '', done: false }]);
}
export function updateApplicationTask(workspace, applicationId, id, field, value) {
  if (!['title', 'dueDate', 'done'].includes(field)) fail('Unknown task field.');
  return editApplicationList(workspace, applicationId, 'tasks', tasks => {
    if (!tasks.some(task => task.id === id)) fail('Task not found.');
    return tasks.map(task => task.id === id ? { ...task, [field]: value } : task);
  });
}
export function removeApplicationTask(workspace, applicationId, id) {
  return editApplicationList(workspace, applicationId, 'tasks', tasks => {
    if (!tasks.some(task => task.id === id)) fail('Task not found.');
    return tasks.filter(task => task.id !== id);
  });
}
export function addApplicationCustomField(workspace, applicationId, id) {
  return editApplicationList(workspace, applicationId, 'customFields', fields => [...fields, { id, label: 'Custom field', value: '' }]);
}
export function updateApplicationCustomField(workspace, applicationId, id, field, value) {
  if (!['label', 'value'].includes(field)) fail('Unknown custom field property.');
  return editApplicationList(workspace, applicationId, 'customFields', fields => {
    if (!fields.some(item => item.id === id)) fail('Custom field not found.');
    return fields.map(item => item.id === id ? { ...item, [field]: value } : item);
  });
}
export function removeApplicationCustomField(workspace, applicationId, id) {
  return editApplicationList(workspace, applicationId, 'customFields', fields => {
    if (!fields.some(item => item.id === id)) fail('Custom field not found.');
    return fields.filter(item => item.id !== id);
  });
}
export function captureApplicationSubmission(workspace, applicationId, id, name, submittedAt = new Date().toISOString()) {
  const next = validateWorkspace(workspace);
  const application = applicationEntry(next, applicationId);
  const linked = next.documents.find(entry => entry.id === application.cvId);
  if (!linked) fail('Link a CV before saving a submitted copy.');
  application.submissions.push({ id, name: name?.trim() || linked.name, submittedAt, cvName: linked.name, document: structuredClone(linked.document) });
  return validateWorkspace(next);
}
export function removeApplicationSubmission(workspace, applicationId, id) {
  return editApplicationList(workspace, applicationId, 'submissions', copies => {
    if (!copies.some(copy => copy.id === id)) fail('Submitted copy not found.');
    return copies.filter(copy => copy.id !== id);
  });
}
export function applicationSubmission(workspace, applicationId, id) {
  const copy = applicationEntry(validateWorkspace(workspace), applicationId).submissions.find(copy => copy.id === id);
  if (!copy) fail('Submitted copy not found.');
  return copy;
}
export function copySubmissionToLibrary(workspace, applicationId, submissionId, id) {
  const copy = applicationSubmission(workspace, applicationId, submissionId);
  return addDocument(workspace, copy.document, id, `${copy.name} (submitted copy)`.slice(0, 100));
}
export function serialiseWorkspace(workspace) { return JSON.stringify(validateWorkspace(workspace), null, 2); }
export function parseWorkspace(json) {
  if (typeof json !== 'string' || json.length > MAX_WORKSPACE_BYTES || new TextEncoder().encode(json).length > MAX_WORKSPACE_BYTES) fail('Choose a workspace backup smaller than 4 MB.');
  let value;
  try { value = JSON.parse(json); } catch { fail('This workspace file is not valid JSON.'); }
  return validateWorkspace(value);
}
export function mergeWorkspace(workspace, imported, makeId) {
  const next = validateWorkspace(workspace);
  const incoming = validateWorkspace(imported);
  const mapping = new Map();
  for (const entry of incoming.documents) {
    const id = makeId(); mapping.set(entry.id, id);
    next.documents.push({ ...entry, id, name: `${entry.name} (imported)`.slice(0, 100) });
  }
  for (const app of incoming.applications) next.applications.push({ ...app, id: makeId(), cvId: mapping.get(app.cvId) || '' });
  for (const letter of incoming.letters) next.letters.push({ ...letter, id: makeId() });
  return validateWorkspace(next);
}
export function parseImport(json) {
  if (typeof json !== 'string' || json.length > MAX_WORKSPACE_BYTES || new TextEncoder().encode(json).length > MAX_WORKSPACE_BYTES) fail('Choose a file smaller than 4 MB.');
  let value;
  try { value = JSON.parse(json); } catch { fail('This file is not valid JSON.'); }
  return value?.schema === WORKSPACE_SCHEMA ? { kind: 'workspace', value: parseWorkspace(json) } : { kind: 'document', value: parseDocument(json) };
}
