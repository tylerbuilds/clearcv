import { createCloudClient, readShareLink, shareLink } from './cloud-client.mjs';
import { validateDocument } from './model.js';

// Bearer tokens stay in this tab/URL fragment and never enter CV/workspace JSON.
export function createCloudUI({ element, field, sectionTitle, notify, getDocument, getLocalId, getName, addLocalDocument, replaceLocalDocument, rerender }) {
  const client = createCloudClient();
  let status = { enabled: false };
  let session = null;
  let tokens = {};
  let comments = [];
  let revisions = [];
  let busy = false;
  let commentDraft = '';
  let authorDraft = '';
  let conflict = null;
  let linkDraft = location.hash.includes('workspace=') ? location.href : '';
  const connection = () => ({ id: session.workspace.id, token: session.token });
  const checkSnapshot = result => {
    if (result.workspace.kind !== 'clearcv') throw new Error('This shared document belongs to another application.');
    return { ...result, workspace: { ...result.workspace, document: validateDocument(result.workspace.document) } };
  };
  const action = async callback => {
    if (busy) return;
    busy = true; rerender();
    try { await callback(); }
    catch (error) {
      if (error.status === 409) {
        conflict = error.current;
        notify('The shared CV has a newer revision. Your local edits have been kept. Review history or refresh before saving; no conflicting changes were overwritten.', true);
      } else notify(error.message, true);
    } finally { busy = false; rerender(); }
  };
  async function openLink(link) {
    const connection = readShareLink(link);
    if (!connection) throw new Error('Use a complete ClearCV share link with its workspace ID and token in the URL fragment.');
    const result = checkSnapshot(await client.open(connection));
    const localId = addLocalDocument(result.workspace.document, `${result.workspace.title} (shared)`);
    session = { ...result, token: connection.token, localId };
    tokens = { [result.role]: connection.token }; comments = []; revisions = []; conflict = null;
    notify('Shared CV opened as an independent local copy. Refresh and Save are explicit; the rest of your library is private.');
  }
  async function initialise() {
    if (location.hostname.endsWith('.github.io')) return;
    try { status = await client.status(); } catch { status = { enabled: false }; }
    if (status.enabled && readShareLink(location.href)) {
      try { await openLink(location.href); } catch (error) { notify(error.message, true); }
    }
    rerender();
  }
  function button(id, text, callback, primary = false, disabled = false) {
    return element('button', { id, type: 'button', class: `button ${primary ? 'button-primary' : 'button-quiet'}`, text, disabled: busy || disabled, onClick: () => action(callback) });
  }
  function render(container) {
    container.append(sectionTitle('A shared second pair of eyes'), element('p', { class: 'panel-intro', text: 'An optional self-hosted workspace service shares the full editable active CV, including hidden sections, its cover letter and the pasted job description. Your master CV, other CVs, snapshots and job tracker stay local. Changes are sent only when you click a sharing action.' }));
    container.append(element('p', { id: 'cloud-status', class: 'design-note', text: status.enabled ? 'Self-hosted sharing is available. Read, edit and owner links have distinct permissions. Anyone holding a link can use its permission; keep owner links private.' : 'Sharing is unavailable on the static demo or an unconfigured server. Configure the optional self-hosted workspace service to enable private links, comments and revision history.' }));
    if (!status.enabled) return;
    if (!session || session.localId !== getLocalId()) container.append(button('cloud-create', 'Share this CV', async () => {
      const localId = getLocalId();
      const document = getDocument(); const title = getName();
      const result = checkSnapshot(await client.create({ kind: 'clearcv', title, document }));
      tokens = result.tokens;
      session = { ...result, token: tokens.owner, localId }; comments = []; revisions = []; conflict = null;
      notify('Shared CV created. Keep the owner link to regain management access after closing this tab.');
    }, true));
    const link = field('Open a shared CV link', linkDraft, 'cloud-open-link', { placeholder: 'https://your-server/#workspace=…&token=…' });
    link.querySelector('input').maxLength = 3000;
    link.querySelector('input').addEventListener('input', event => { linkDraft = event.target.value; });
    container.append(link, button('cloud-open', 'Open shared CV', () => openLink(linkDraft)));
    if (!session) return;
    container.append(element('section', { class: 'form-section' }, [sectionTitle(session.workspace.title, `${session.role.toUpperCase()} · REVISION ${session.workspace.revision}`)]));
    if (session.localId !== getLocalId()) {
      container.append(element('p', { class: 'match-empty', text: 'This sharing session belongs to another local CV. Open its library entry to refresh or save it.' }));
      return;
    }
    const actions = element('div', { class: 'action-row' });
    actions.append(button('cloud-refresh', 'Refresh from server', async () => {
      if (!window.confirm('Refresh replaces the active CV with the shared revision and keeps your current CV as a named recovery snapshot. Continue?')) return;
      const target = session;
      const localId = target.localId;
      const result = checkSnapshot(await client.open(connection()));
      if (getLocalId() !== localId || session !== target) throw new Error('The active CV changed while refreshing. No local CV was replaced; reopen the shared CV and refresh again.');
      replaceLocalDocument(result.workspace.document, 'Before shared refresh');
      session = { ...target, ...result }; conflict = null;
      notify('Shared revision opened. A recovery snapshot retains the previous local CV.');
    }));
    actions.append(button('cloud-save', 'Save CV to server', async () => {
      const target = session;
      const result = checkSnapshot(await client.update({ id: target.workspace.id, token: target.token, baseRevision: target.workspace.revision, title: getName(), document: getDocument() }));
      if (session === target) session = { ...target, ...result }; conflict = null;
      notify('Shared CV saved with a new revision.');
    }, true, session.role === 'view'));
    actions.append(button('cloud-disconnect', 'Close sharing session', () => { session = null; tokens = {}; comments = []; revisions = []; conflict = null; notify('Sharing session closed. The independent local CV is kept.'); }));
    container.append(actions);
    if (conflict) container.append(element('p', { class: 'recovery-card', text: `Revision conflict: the server is now at revision ${conflict.revision}. Your local edits are unchanged. Refresh creates a recovery snapshot before adopting the shared version.` }));
    const links = element('section', { class: 'form-section' }, [sectionTitle('Permission links')]);
    for (const role of ['owner', 'edit', 'view']) if (tokens[role]) {
      const value = shareLink({ id: session.workspace.id, token: tokens[role], baseURL: location.href });
      const input = element('input', { id: `cloud-link-${role}`, class: 'share-link', type: 'password', value, readonly: 'true', 'aria-label': `${role} share link` });
      links.append(element('label', { class: 'field-label', for: `cloud-link-${role}`, text: `${role[0].toUpperCase()}${role.slice(1)} link` }), input, button(`cloud-copy-${role}`, `Copy ${role} link`, async () => {
        try { await navigator.clipboard.writeText(value); notify(`${role} link copied.`); }
        catch { const currentInput = document.querySelector(`#cloud-link-${role}`); currentInput.type = 'text'; currentInput.select(); notify('Copy the selected link manually. Keep it private.'); }
      }));
    }
    if (session.role === 'owner') for (const role of ['edit', 'view']) links.append(button(`cloud-permission-${role}`, session.workspace.permissions[role] ? `Revoke ${role} link` : `Enable ${role} link`, async () => {
      const enabled = !session.workspace.permissions[role];
      const result = checkSnapshot(await client.setPermission({ ...connection(), baseRevision: session.workspace.revision, role, enabled }));
      session = { ...session, ...result };
      tokens[role] = result.share.token;
      notify(enabled ? `A new ${role} link is enabled. Previous tokens remain invalid.` : `${role} access revoked. Old links no longer work.`);
    }));
    container.append(links);
    const commentSection = element('section', { class: 'form-section' }, [sectionTitle('Comments')]);
    commentSection.append(button('cloud-load-comments', 'Refresh comments', async () => {
      const result = await client.comments(connection()); comments = result.comments;
      // Reading comments does not adopt a newer document revision for writes.
      notify('Comments refreshed.');
    }));
    for (const comment of comments) commentSection.append(element('article', { class: 'review-issue' }, [element('h3', { text: comment.author || 'Anonymous reviewer' }), element('p', { text: comment.text }), element('span', { class: 'section-caption', text: new Date(comment.createdAt).toLocaleString('en-GB') })]));
    if (session.role !== 'view') {
      const author = field('Display name (self-declared)', authorDraft, 'cloud-comment-author');
      author.querySelector('input').maxLength = 80; author.querySelector('input').addEventListener('input', event => { authorDraft = event.target.value; });
      const comment = field('Comment', commentDraft, 'cloud-comment', { multiline: true, rows: '4' });
      comment.querySelector('textarea').maxLength = 4000; comment.querySelector('textarea').addEventListener('input', event => { commentDraft = event.target.value; });
      commentSection.append(author, comment, button('cloud-post-comment', 'Post comment', async () => {
        const result = checkSnapshot(await client.addComment({ ...connection(), baseRevision: session.workspace.revision, text: commentDraft, author: authorDraft }));
        session = { ...session, ...result };
        const loaded = await client.comments(connection()); comments = loaded.comments; commentDraft = '';
        notify('Comment posted to this shared CV.');
      }));
    }
    container.append(commentSection);
    if (session.role !== 'view') {
      const history = element('section', { class: 'form-section' }, [sectionTitle('Shared revision history'), button('cloud-load-history', 'Load history', async () => { const result = await client.revisions(connection()); revisions = result.revisions; notify('Shared history loaded.'); })]);
      for (const revision of revisions) history.append(element('div', { class: 'snapshot-row' }, [element('div', {}, [element('strong', { text: `Revision ${revision.revision}` }), element('span', { class: 'section-caption', text: new Date(revision.createdAt).toLocaleString('en-GB') })]), button(`cloud-open-revision-${revision.revision}`, 'Open as local copy', () => { addLocalDocument(validateDocument(revision.document), `${revision.title} revision ${revision.revision}`.slice(0, 100)); notify('Historical revision opened as a separate local CV. The shared document is unchanged.'); })]));
      container.append(history);
    }
  }
  return { initialise, render };
}
