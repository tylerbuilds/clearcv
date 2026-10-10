import { applyFormatting, applyLink, clearFormatting, isTextBoundary, selectionHasMark, transformRuns, validateRuns } from './rich-text.js';

// Parent editors should normally set transformOnInput:false and update text plus
// metadata atomically. When enabled, setRuns receives the changed text in context.
export function installRichTextToolbar(textarea, {
  getRuns, setRuns, getText = () => textarea.value, announce = () => {},
  onError = error => announce(error.message), transformOnInput = true
} = {}) {
  if (textarea?.tagName !== 'TEXTAREA' || typeof getRuns !== 'function' || typeof setRuns !== 'function') throw new Error('Text formatting needs a textarea and formatting callbacks.');
  const document = textarea.ownerDocument;
  const toolbar = document.createElement('div');
  toolbar.className = 'rich-text-toolbar';
  toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Text formatting');
  const listeners = [];
  let disposed = false, previousText = textarea.value, linkSelection = null;
  const listen = (node, type, handler) => { node.addEventListener(type, handler); listeners.push(() => node.removeEventListener(type, handler)); };
  const button = (text, title) => {
    const node = document.createElement('button');
    node.type = 'button'; node.className = 'rich-text-button'; node.textContent = text;
    node.setAttribute('aria-label', title); node.title = title;
    toolbar.append(node);
    // Retain the textarea selection when a pointer activates a toolbar button.
    listen(node, 'pointerdown', event => event.preventDefault());
    return node;
  };
  const marks = [['bold', 'Bold'], ['italic', 'Italic'], ['underline', 'Underline']];
  const markButtons = marks.map(([mark, title]) => [mark, button(title, title)]);
  const linkButton = button('Link', 'Add or edit a link');
  const clearButton = button('Clear', 'Clear formatting and links');
  const editor = document.createElement('div'); editor.className = 'rich-text-link-editor'; editor.hidden = true;
  const label = document.createElement('label'); label.textContent = 'Website or email';
  const linkInput = document.createElement('input'); linkInput.type = 'text';
  linkInput.className = 'rich-text-link-input'; linkInput.placeholder = 'https://example.com';
  linkInput.setAttribute('aria-label', 'Website or email'); linkInput.setAttribute('autocomplete', 'off'); linkInput.setAttribute('spellcheck', 'false');
  label.append(linkInput); editor.append(label);
  const editorButton = text => {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'rich-text-button'; node.textContent = text;
    editor.append(node); return node;
  };
  const saveButton = editorButton('Save link'), removeButton = editorButton('Remove link'), cancelButton = editorButton('Cancel');
  toolbar.append(editor);
  textarea.before(toolbar);

  function available() { return !disposed && textarea.isConnected !== false && !textarea.disabled && !textarea.readOnly; }
  function selection() {
    const text = getText();
    if (!available() || text !== textarea.value) return null;
    const start = textarea.selectionStart, end = textarea.selectionEnd;
    return start < end && isTextBoundary(text, start) && isTextBoundary(text, end) ? { text, start, end } : null;
  }
  function restore(selected) {
    if (available() && getText() === selected.text && textarea.value === selected.text) {
      textarea.focus(); textarea.setSelectionRange(selected.start, selected.end);
    }
  }
  function closeLink(restoreFocus = true) {
    const selected = linkSelection; linkSelection = null; editor.hidden = true;
    if (restoreFocus && selected) restore(selected);
  }
  function refresh() {
    if (disposed) return;
    try {
      const selected = selection(), text = getText(), runs = validateRuns(text, getRuns());
      for (const [mark, node] of markButtons) {
        node.disabled = !selected;
        node.setAttribute('aria-pressed', String(!!selected && selectionHasMark(text, runs, selected.start, selected.end, mark)));
      }
      linkButton.disabled = clearButton.disabled = !selected;
      if (text === textarea.value) previousText = text;
      if (linkSelection && (!available() || text !== linkSelection.text)) closeLink(false);
    } catch (error) {
      for (const [, node] of markButtons) node.disabled = true;
      linkButton.disabled = clearButton.disabled = true;
      closeLink(false); onError(error);
    }
  }
  function commit(selected, runs, reason, message) {
    if (!available() || getText() !== selected.text || textarea.value !== selected.text) {
      closeLink(false); announce('Text changed. Select it again.'); return false;
    }
    const checked = validateRuns(selected.text, runs);
    const saved = setRuns(checked, { text: selected.text, previousText: selected.text, reason, start: selected.start, end: selected.end });
    if (saved === false) return false;
    previousText = selected.text;
    closeLink(false); restore(selected); refresh(); announce(message); return true;
  }
  function format(mark) {
    const selected = selection();
    if (!selected) { announce('Select some text first.'); return; }
    try {
      const runs = getRuns(), enabled = !selectionHasMark(selected.text, runs, selected.start, selected.end, mark);
      commit(selected, applyFormatting(selected.text, runs, selected.start, selected.end, mark, enabled), 'format', marks.find(([key]) => key === mark)[1] + (enabled ? ' added.' : ' removed.'));
    } catch (error) { onError(error); }
  }
  for (const [mark, node] of markButtons) listen(node, 'click', () => format(mark));
  listen(clearButton, 'click', () => {
    const selected = selection();
    if (!selected) { announce('Select some text first.'); return; }
    try { commit(selected, clearFormatting(selected.text, getRuns(), selected.start, selected.end), 'clear', 'Formatting cleared.'); } catch (error) { onError(error); }
  });
  listen(linkButton, 'click', () => {
    const selected = selection();
    if (!selected) { announce('Select some text first.'); return; }
    try {
      const runs = validateRuns(selected.text, getRuns());
      linkSelection = selected;
      const links = runs.filter(run => run.start < selected.end && run.end > selected.start && run.href).map(run => run.href);
      linkInput.value = links.length && links.every(href => href === links[0]) ? links[0] : '';
      editor.hidden = false; linkInput.focus();
    } catch (error) { onError(error); }
  });
  function saveLink(href) {
    if (!linkSelection) return;
    try { commit(linkSelection, applyLink(linkSelection.text, getRuns(), linkSelection.start, linkSelection.end, href), 'link', href === null ? 'Link removed.' : 'Link added.'); }
    catch (error) { onError(error); }
  }
  listen(saveButton, 'click', () => saveLink(linkInput.value));
  listen(removeButton, 'click', () => saveLink(null));
  listen(cancelButton, 'click', () => closeLink());
  listen(linkInput, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeLink(); }
    else if (event.key === 'Enter') { event.preventDefault(); saveLink(linkInput.value); }
    event.stopPropagation();
  });
  // A link draft must not be mistaken for a CV text-field edit by parent handlers.
  listen(editor, 'input', event => event.stopPropagation());
  listen(textarea, 'keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || !selection()) return;
    const mark = { b: 'bold', i: 'italic', u: 'underline' }[event.key.toLowerCase()];
    if (mark) { event.preventDefault(); format(mark); }
  });
  for (const type of ['select', 'keyup', 'mouseup', 'focus']) listen(textarea, type, refresh);
  listen(textarea, 'input', () => {
    const nextText = textarea.value, oldText = previousText;
    previousText = nextText; closeLink(false);
    if (transformOnInput && available()) {
      try {
        const runs = transformRuns(oldText, nextText, getRuns());
        const saved = setRuns(runs, { text: nextText, previousText: oldText, reason: 'input', start: textarea.selectionStart, end: textarea.selectionEnd });
        if (saved === false) previousText = oldText;
      } catch (error) { onError(error); }
    }
    // Central parent input handling may not have committed the text yet.
    // The parent calls refresh after its atomic update when transforms are off.
    if (transformOnInput) refresh();
  });
  listen(document, 'selectionchange', () => { if (document.activeElement === textarea) refresh(); });
  refresh();
  return {
    element: toolbar, refresh,
    dispose() {
      if (disposed) return;
      disposed = true; linkSelection = null;
      for (const remove of listeners) remove();
      toolbar.remove();
    }
  };
}
