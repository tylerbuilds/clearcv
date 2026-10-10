import { validateDocument } from './model.js';
import { activeEntry } from './workspace.js';
import { checkText } from './spellcheck.js';
import { writingFields, joinWritingFields, locateWritingIssue, applyWritingSuggestion, cleanupSuggestions, applyCleanupSuggestion } from './writing-review.js';

export function createWritingUI({ element, selectField, sectionTitle, getWorkspace, change, safeAction, announce, isActive }) {
  let host, kind = 'cv', selectedField = '', busy = false, controller = null, generation = 0;
  let issues = [], cleanup = [], checkedWords = null, limited = false, resultId = '', undo = null;
  const ignored = new Set();
  const current = () => activeEntry(getWorkspace()).document;
  function redraw() { if (host?.isConnected && isActive()) render(host); }
  function cancel() { generation++; controller?.abort(); controller = null; busy = false; redraw(); announce('Spelling check cancelled.'); }
  async function runCheck() {
    controller?.abort(); controller = new AbortController(); const signal = controller.signal, request = ++generation;
    const doc = current(), docId = getWorkspace().activeId, original = JSON.stringify(doc), selectedKind = kind;
    const chosenField = selectedField;
    const joined = joinWritingFields(writingFields(doc, kind).filter(field => !chosenField || JSON.stringify(field.path) === chosenField)); busy = true; redraw();
    try {
      const result = await checkText(joined.text, { signal, ignored: [...ignored] });
      if (request !== generation || signal.aborted) return;
      if (getWorkspace().activeId !== docId || JSON.stringify(current()) !== original || kind !== selectedKind || selectedField !== chosenField) { announce('Your CV changed during the check. Run it again before making a correction.', true); return; }
      issues = result.issues.map(issue => locateWritingIssue(joined.ranges, issue)); checkedWords = result.checkedWords; limited = result.limitReached; resultId = docId;
      announce(issues.length ? 'Spelling suggestions are ready. Names and specialist terms may already be correct.' : 'No spelling suggestions came up. Read through once more to check the meaning and details.');
    } catch (error) { if (request === generation && error.name !== 'AbortError') announce(error.message, true); }
    finally { if (request === generation) { busy = false; controller = null; redraw(); } }
  }
  function apply(next, message) {
    const before = validateDocument(current()), docId = getWorkspace().activeId;
    const saved = change(next, true); undo = { docId, before, after: JSON.stringify(next) }; issues = []; cleanup = []; checkedWords = null; redraw();
    announce(saved ? message : `${message} This browser could not save the change; export a workspace backup before closing.`, !saved);
  }
  function render(target) {
    host = target; target.querySelector('#writing-review')?.remove();
    const section = element('section', { id: 'writing-review', class: 'writing-workflow' }, [sectionTitle('Spelling and spacing', 'BRITISH ENGLISH · LOCAL'), element('p', { class: 'panel-intro', text: 'Check British English spelling or tidy extra spaces and blank lines. Choose the changes you want to make; names and specialist terms may already be correct.' })]);
    const scope = selectField('Writing to check', kind, 'writing-kind', [['cv', 'CV text shown in the preview'], ['letter', 'Cover letter']]); scope.querySelector('select').addEventListener('change', event => { generation++; controller?.abort(); busy = false; kind = event.target.value; selectedField = ''; issues = []; cleanup = []; checkedWords = null; redraw(); }); section.append(scope);
    const fields = writingFields(current(), kind);
    if (selectedField && !fields.some(field => JSON.stringify(field.path) === selectedField)) selectedField = '';
    const fieldScope = selectField('Choose what to check', selectedField, 'writing-field', [['', 'All text'], ...fields.map(field => [JSON.stringify(field.path), field.label])]);
    fieldScope.querySelector('select').addEventListener('change', event => { generation++; controller?.abort(); busy = false; selectedField = event.target.value; issues = []; cleanup = []; checkedWords = null; redraw(); }); section.append(fieldScope);
    section.append(element('div', { class: 'action-row writing-actions' }, [element('button', { id: 'check-spelling', type: 'button', class: 'button button-primary', text: busy ? 'Checking…' : 'Check spelling', disabled: busy, onClick: () => void runCheck() }), element('button', { id: 'review-cleanup', type: 'button', class: 'button button-quiet', text: 'Tidy spacing', onClick: () => safeAction(() => { cleanup = cleanupSuggestions(current(), kind).filter(suggestion => !selectedField || JSON.stringify(suggestion.path) === selectedField); resultId = getWorkspace().activeId; redraw(); announce(cleanup.length ? 'Spacing changes are ready to check. Your words and numbers stay the same.' : 'No extra spaces or blank lines to tidy.'); }) })]));
    if (busy) section.append(element('p', { id: 'spellcheck-progress', class: 'field-hint', role: 'status', text: 'Checking the selected text…' }), element('button', { id: 'cancel-spellcheck', type: 'button', class: 'button button-quiet', text: 'Cancel check', onClick: cancel }));
    section.append(element('p', { class: 'field-hint', text: 'This checks the text shown in your CV or letter, leaving out contacts, dates and the job advertisement. Choose one field if the full check takes too long.' }));
    if (checkedWords !== null && resultId === getWorkspace().activeId) section.append(element('p', { id: 'spelling-summary', class: 'writing-summary', role: 'status', text: `${checkedWords} ${checkedWords === 1 ? 'word' : 'words'} checked · ${issues.length} spelling ${issues.length === 1 ? 'suggestion' : 'suggestions'}${limited ? ' · more text to check; choose a shorter section' : ''}` }));
    if (resultId && resultId !== getWorkspace().activeId && (issues.length || cleanup.length)) section.append(element('p', { class: 'field-hint', text: 'These results are for another CV. Check the current CV again.' }));
    if (resultId === getWorkspace().activeId) issues.forEach((issue, index) => {
      const row = element('div', { class: 'writing-issue', 'data-spell-issue': issue.word }, [element('strong', { text: issue.word }), element('p', { class: 'field-hint', text: issue.label })]);
      const input = element('input', { id: `spelling-replacement-${index}`, value: issue.suggestions[0] || issue.word, maxlength: '100', 'aria-label': `Replacement for ${issue.word}`, spellcheck: 'true', lang: 'en-GB', class: 'spelling-replacement' });
      row.append(element('label', { class: 'field-label', for: input.id, text: 'Your correction' }), input);
      if (issue.suggestions.length) row.append(element('p', { class: 'field-hint', text: `Suggestions: ${issue.suggestions.join(', ')}` }));
      row.append(element('div', { class: 'action-row' }, [element('button', { id: `apply-spelling-${index}`, type: 'button', class: 'button button-quiet', text: 'Apply this correction', onClick: () => safeAction(() => { if (resultId !== getWorkspace().activeId) throw new Error('This result belongs to another CV. Check the current CV again.'); apply(applyWritingSuggestion(current(), issue, input.value), 'Correction added. Check again for more suggestions.'); }) }), element('button', { type: 'button', class: 'text-button', text: 'Accept this word until I close the page', 'data-ignore-spelling': issue.word, onClick: () => { if (ignored.size >= 500) { announce('This session has 500 accepted words. Clear the list before adding more.', true); return; } ignored.add(issue.word.toLocaleLowerCase('en-GB')); issues = issues.filter(item => item.word.toLocaleLowerCase('en-GB') !== issue.word.toLocaleLowerCase('en-GB')); redraw(); } })])); section.append(row);
    });
    if (ignored.size) section.append(element('button', { id: 'clear-spelling-exceptions', type: 'button', class: 'text-button', text: `Clear ${ignored.size} accepted word${ignored.size === 1 ? '' : 's'} from this session`, onClick: () => { ignored.clear(); redraw(); announce('Accepted words cleared. Run Check spelling to check them again.'); } }));
    if (resultId === getWorkspace().activeId) cleanup.forEach((suggestion, index) => {
      const row = element('details', { class: 'writing-cleanup' }, [element('summary', { text: `Check spacing in ${suggestion.label}` }), element('span', { class: 'field-label', text: 'Current text' }), element('pre', { text: suggestion.before }), element('span', { class: 'field-label', text: 'Tidied text' }), element('pre', { text: suggestion.replacement }), element('button', { id: `apply-cleanup-${index}`, type: 'button', class: 'button button-quiet', text: 'Use tidied text', onClick: () => safeAction(() => { if (resultId !== getWorkspace().activeId) throw new Error('This review belongs to another CV.'); apply(applyCleanupSuggestion(current(), suggestion), 'Spacing tidied. Your words and numbers haven’t changed.'); }) })]); row.open = true; section.append(row);
    });
    if (undo && undo.docId === getWorkspace().activeId) section.append(element('button', { id: 'undo-writing-change', type: 'button', class: 'button button-quiet', text: 'Undo the last writing change', onClick: () => safeAction(() => { if (JSON.stringify(current()) !== undo.after) throw new Error('You’ve edited the CV since this change. Undo would lose those edits. Restore a snapshot in Library if you want an earlier version.'); const previous = undo.before; undo = null; const saved = change(previous, true); redraw(); announce(saved ? 'The previous writing is restored.' : 'Previous writing restored but not saved; export a workspace backup before closing.', !saved); }) }));
    target.prepend(section);
  }
  function cancelPending() { generation++; controller?.abort(); controller = null; busy = false; }
  return { render, cancelPending };
}
