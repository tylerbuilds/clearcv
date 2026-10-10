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
    if (result.workspace.kind !== 'clearcv') throw new Error('This link is for another app. Choose a ClearCV share link.');
    return { ...result, workspace: { ...result.workspace, document: validateDocument(result.workspace.document) } };
  };
  const action = async callback => {
    if (busy) return;
    busy = true; rerender();
    try { await callback(); }
    catch (error) {
      if (error.status === 409) {
        conflict = error.current;
        notify('Someone saved a newer shared CV. Your edits are still here. Check History or Refresh before saving again.', true);
      } else notify(error.message, true);
    } finally { busy = false; rerender(); }
  };
  async function openLink(link) {
    const connection = readShareLink(link);
    if (!connection) throw new Error('Paste the complete ClearCV share link, including everything after #.');
    const result = checkSnapshot(await client.open(connection));
    const localId = addLocalDocument(result.workspace.document, `${result.workspace.title} (shared)`);
    session = { ...result, token: connection.token, localId };
    tokens = { [result.role]: connection.token }; comments = []; revisions = []; conflict = null;
    notify('The shared CV is open as a copy in your library. Use Save to share your changes, or Refresh to get the latest version.');
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
    container.append(sectionTitle('Share your CV'), element('p', { class: 'panel-intro', text: 'Sharing sends this CV, its cover letter and job description to your configured server. Hidden sections and original imported text are included. Your other CVs, master, snapshots and job tracker stay in this browser.' }));
    container.append(element('p', { id: 'cloud-status', class: 'design-note', text: status.enabled ? 'Sharing is connected. Choose a view, edit or owner link. Anyone with the link has that access, so keep the owner link private.' : 'Sharing isn’t connected here. Run ClearCV with your own sharing server to use links, comments and history.' }));
    if (!status.enabled) return;
    if (!session || session.localId !== getLocalId()) container.append(button('cloud-create', 'Share this CV', async () => {
      const localId = getLocalId();
      const document = getDocument(); const title = getName();
      const result = checkSnapshot(await client.create({ kind: 'clearcv', title, document }));
      tokens = result.tokens;
      session = { ...result, token: tokens.owner, localId }; comments = []; revisions = []; conflict = null;
      notify('Your shared CV is ready. Keep the owner link so you can manage it after closing this tab.');
    }, true));
    const link = field('Open a shared CV link', linkDraft, 'cloud-open-link', { placeholder: 'https://your-server/#workspace=…&token=…' });
    link.querySelector('input').maxLength = 3000;
    link.querySelector('input').addEventListener('input', event => { linkDraft = event.target.value; });
    container.append(link, button('cloud-open', 'Open shared CV', () => openLink(linkDraft)));
    if (!session) return;
    container.append(element('section', { class: 'form-section' }, [sectionTitle(session.workspace.title, `${session.role.toUpperCase()} · REVISION ${session.workspace.revision}`)]));
    if (session.localId !== getLocalId()) {
      container.append(element('p', { class: 'match-empty', text: 'You’re sharing another CV. Open it in Library to save or refresh it.' }));
      return;
    }
    const actions = element('div', { class: 'action-row' });
    actions.append(button('cloud-refresh', 'Refresh from server', async () => {
      if (!window.confirm('Replace your open CV with the latest shared version? Your current version will be kept as a snapshot in Library.')) return;
      const target = session;
      const localId = target.localId;
      const result = checkSnapshot(await client.open(connection()));
      if (getLocalId() !== localId || session !== target) throw new Error('You switched CVs while refreshing. Open the shared CV and try Refresh again.');
      replaceLocalDocument(result.workspace.document, 'Before shared refresh');
      session = { ...target, ...result }; conflict = null;
      notify('The latest shared CV is open. Your earlier version is kept as a snapshot.');
    }));
    actions.append(button('cloud-save', 'Save CV to server', async () => {
      const target = session;
      const result = checkSnapshot(await client.update({ id: target.workspace.id, token: target.token, baseRevision: target.workspace.revision, title: getName(), document: getDocument() }));
      if (session === target) session = { ...target, ...result }; conflict = null;
      notify('Your changes are saved to the shared CV.');
    }, true, session.role === 'view'));
    actions.append(button('cloud-disconnect', 'Close sharing session', () => { session = null; tokens = {}; comments = []; revisions = []; conflict = null; notify('Sharing closed. Your copy stays in Library.'); }));
    container.append(actions);
    if (conflict) container.append(element('p', { class: 'recovery-card', text: `The shared CV is now at version ${conflict.revision}. Your edits are still here. Refresh opens that version and keeps your edits as a snapshot.` }));
    const links = element('section', { class: 'form-section' }, [sectionTitle('Sharing links')]);
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
      notify(enabled ? `Your new ${role} link is ready. The old link won’t work.` : `${role} access revoked. Old links no longer work.`);
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
      const author = field('Name shown with your comment', authorDraft, 'cloud-comment-author');
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
      const history = element('section', { class: 'form-section' }, [sectionTitle('Shared version history'), button('cloud-load-history', 'Load history', async () => { const result = await client.revisions(connection()); revisions = result.revisions; notify('Shared history loaded.'); })]);
      for (const revision of revisions) history.append(element('div', { class: 'snapshot-row' }, [element('div', {}, [element('strong', { text: `Revision ${revision.revision}` }), element('span', { class: 'section-caption', text: new Date(revision.createdAt).toLocaleString('en-GB') })]), button(`cloud-open-revision-${revision.revision}`, 'Open as local copy', () => { addLocalDocument(validateDocument(revision.document), `${revision.title} revision ${revision.revision}`.slice(0, 100)); notify('This earlier version is open as a copy in Library.'); })]));
      container.append(history);
    }
  }
  return { initialise, render };
}
