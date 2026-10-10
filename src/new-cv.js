import { createDocument, sampleDocument, parseDocument } from './model.js';
import { createWorkspace, parseWorkspace, validateWorkspace, addDocument } from './workspace.js';

export function initialWorkspace(saved, legacy) {
  if (saved !== null) return { workspace: parseWorkspace(saved), migrated: false };
  const migrated = legacy !== null;
  return { workspace: createWorkspace(migrated ? parseDocument(legacy) : createDocument(), 'initial-cv', migrated ? 'Migrated CV' : 'Untitled CV'), migrated };
}

export function isBlankCV(document) {
  return Object.values(document.profile).every(value => !value.trim())
    && ['experience', 'education', 'skills', 'customSections'].every(key => document[key].length === 0)
    && !document.photo && !document.jobAd.trim()
    && ['company', 'role', 'recipient', 'subject', 'date', 'body'].every(key => !document.coverLetter[key].trim())
    && ['salutation', 'closing'].every(key => document.coverLetter[key] === createDocument().coverLetter[key]);
}

export function isFirstBlankWorkspace(workspace) {
  return workspace.documents.length === 1 && workspace.documents[0].versions.length === 0
    && workspace.applications.length === 0 && isBlankCV(workspace.documents[0].document)
    && isBlankCV(workspace.masterDocument) && Object.values(workspace.masterProfile).every(value => !value.trim());
}

export function addNewCV(workspace, id, kind = 'blank') {
  if (!['blank', 'example'].includes(kind)) throw new Error('Choose a blank CV or an example.');
  const current = validateWorkspace(workspace);
  const stem = kind === 'example' ? 'Example CV' : 'Untitled CV';
  const names = new Set(current.documents.map(entry => entry.name.toLocaleLowerCase('en-GB')));
  let name = stem, number = 2;
  while (names.has(name.toLocaleLowerCase('en-GB'))) name = `${stem} ${number++}`;
  return addDocument(current, kind === 'example' ? sampleDocument() : createDocument(), id, name);
}
