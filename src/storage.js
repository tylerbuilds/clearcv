import { serialiseWorkspace } from './workspace.js';

export class WorkspaceConflictError extends Error {
  constructor() {
    super('Another tab saved a newer library. Download a workspace backup of your edits here, then open Library to reload the saved version.');
    this.name = 'WorkspaceConflictError';
  }
}

// Refuse an already-stale whole-workspace write. localStorage does not provide
// an atomic compare-and-set: this is not a mutex for simultaneous writers.
export function persistWorkspace(storage, key, workspace, expectedRaw) {
  const raw = serialiseWorkspace(workspace);
  if (storage.getItem(key) !== expectedRaw) throw new WorkspaceConflictError();
  storage.setItem(key, raw);
  return raw;
}
