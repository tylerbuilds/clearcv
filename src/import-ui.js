import { createDocument, validateDocument, addItem, removeItem, moveItem, addCustomSection, removeCustomSection, ACCENTS, TEMPLATES } from './model.js';
import { parseImport, mergeWorkspace, addDocument } from './workspace.js';
import { analyseCVText } from './structured-import.js';
import { extractDocument } from './document-intake.js';
import { createReviewedImport, IMPORT_PROFILE_FIELDS } from './import-workspace.js';

const TITLES = { name: 'Full name', headline: 'Professional title', email: 'Email', phone: 'Phone', location: 'Location', website: 'Website', summary: 'Profile / summary' };
const COLLECTIONS = { experience: 'Experience', education: 'Education', skills: 'Skills' };
const ENTRY_FIELDS = { title: 'Role or qualification', organisation: 'Employer or institution', location: 'Location', dates: 'Dates', description: 'Supplied achievements / details' };
const IMAGES = /\.(png|jpe?g|webp|bmp)$/i;
const pdfBytes = bytes => new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
const imageBytes = bytes => bytes[0] === 0x89 && bytes[1] === 0x50 || bytes[0] === 0xff && bytes[1] === 0xd8 || bytes[0] === 0x42 && bytes[1] === 0x4d || new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP';

export function createDocumentImportUI({ element, field, selectField, sectionTitle, getWorkspace, changeWorkspace, safeAction, announce, switchTab, download, renderPreview, openPreview, chooseFile, isActive }) {
  let host;
  let text = '', label = '', format = '', warnings = [];
  let proposal = null, name = '', mode = 'new', targetId = '', edited = false;
  let profileFields = new Set(), sectionModes = { experience: 'append', education: 'append', skills: 'append' };
  let generation = 0, controller = null, busy = false, progress = '';
  let pendingPdf = null, pendingOcr = null, pdfSource = null;
  function invalidate() {
    generation++; controller?.abort(); controller = null; busy = false; progress = '';
    const section = host?.querySelector('#document-upgrader');
    section?.querySelector('#import-progress')?.remove();
    section?.querySelector('#cancel-extraction')?.remove();
    const mapButton = section?.querySelector('#analyse-import');
    if (mapButton) mapButton.disabled = false;
  }
  function redraw() { if (host?.isConnected && isActive()) { const scroll = host.closest('.editor')?.scrollTop; render(host); if (scroll !== undefined) host.closest('.editor').scrollTop = scroll; } }
  function showLibrary() { switchTab('library'); }
  function reportProgress(message, request) { if (request !== generation) return; progress = message; const node = document.querySelector('#import-progress'); if (node) node.textContent = message; }
  function prepare(extracted, filename, fileFormat, notices = []) {
    text = extracted; label = filename; format = fileFormat; warnings = notices; edited = false;
    proposal = analyseCVText(text, { idPrefix: 'import' });
    name = (proposal.document.profile.name ? `${proposal.document.profile.name} — upgraded` : label.replace(/\.[^.]+$/, '')) .slice(0, 100) || 'Imported CV';
    targetId = getWorkspace().activeId; mode = 'new'; profileFields = new Set();
    pendingPdf = null; pendingOcr = null;
  }
  function analyse() {
    invalidate(); proposal = analyseCVText(text, { idPrefix: 'import' }); edited = false;
    if (!name) name = (proposal.document.profile.name || 'Imported CV').slice(0, 100);
    if (!targetId) targetId = getWorkspace().activeId;
    redraw(); announce('The supplied text is mapped into editable fields. Review every field and any uncertain text before creating a CV.');
  }
  async function openFile(file) {
    if (edited && !window.confirm('Replace this unsaved import review draft with another document? Your saved CV library is kept.')) return;
    invalidate(); const request = generation; controller = new AbortController(); const signal = controller.signal;
    busy = true; progress = `Reading ${file.name} locally…`; pendingPdf = null; pendingOcr = null; pdfSource = null; showLibrary();
    try {
      if (/\.json$/i.test(file.name)) {
        if (file.size > 4_000_000) throw new Error('Choose a JSON backup smaller than 4 MB.');
        const raw = await file.text(); if (request !== generation) return;
        const imported = parseImport(raw);
        const saved = imported.kind === 'workspace' ? changeWorkspace(mergeWorkspace(getWorkspace(), imported.value, () => crypto.randomUUID())) : changeWorkspace(addDocument(getWorkspace(), imported.value, crypto.randomUUID(), file.name.replace(/\.json$/i, '').slice(0, 100) || 'Imported CV'));
        announce(saved ? 'Backup imported into your library. Existing CVs and the master have been kept.' : 'Backup imported but not saved. Export a workspace backup before closing.', !saved); return;
      }
      if (file.size > 10_000_000) throw new Error('Choose a PDF or image smaller than 10 MB; other documents are limited to 2 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer()); if (request !== generation) return;
      if (imageBytes(bytes) || IMAGES.test(file.name) || /^image\/(png|jpeg|webp|bmp)$/.test(file.type)) {
        pendingOcr = { bytes, name: file.name, mime: file.type }; progress = ''; announce('This image is ready for local OCR. Start recognition, then review every recognised fact.'); return;
      }
      let extracted;
      try {
        if (pdfBytes(bytes)) {
          pdfSource = { bytes, name: file.name, mime: 'application/pdf' };
          const { extractOcr } = await import('./ocr-import.js'); if (request !== generation) return;
          const result = await extractOcr(bytes, { signal, onProgress: value => reportProgress(`${value.status || 'Reading PDF'}${Number.isFinite(value.progress) ? ` · ${Math.round(value.progress * 100)}%` : ''}`, request) });
          extracted = { ...result, format: 'pdf' };
        } else { if (file.size > 2_000_000) throw new Error('Word, ODT, RTF, text, Markdown and HTML imports are limited to 2 MB.'); extracted = await extractDocument(bytes, { name: file.name, mime: file.type, signal }); }
      }
      catch (error) {
        if (request !== generation) return;
        if (/password/i.test(error.message)) { pendingPdf = { bytes, name: file.name, mime: file.type }; progress = ''; announce('This PDF needs a password. Unlock it here; the password is used in memory only.'); return; }
        if (/selectable text|scanned|OCR.*not available/i.test(error.message) && /\.pdf$/i.test(file.name)) { pendingOcr = { bytes, name: file.name, mime: 'application/pdf' }; progress = ''; announce('This PDF needs local OCR. Recognition is available below; check the resulting text carefully.'); return; }
        throw error;
      }
      if (request !== generation) return;
      prepare(extracted.text, file.name, extracted.format, extracted.warnings); announce('Your document is mapped for review. The CV library has not changed.');
    } catch (error) { if (request === generation && error.name !== 'AbortError') announce(`${error.message} Your CV library has been kept.`, true); }
    finally { if (request === generation) { busy = false; controller = null; redraw(); } }
  }
  async function unlockPdf() {
    const pdf = pendingPdf, passwordInput = document.querySelector('#pdf-password'), password = passwordInput.value;
    passwordInput.value = ''; invalidate(); const request = generation; controller = new AbortController(); busy = true; progress = 'Unlocking and reading this PDF locally…'; redraw();
    try {
      let extracted;
      try { const { extractOcr } = await import('./ocr-import.js'); if (request !== generation || pendingPdf !== pdf) return; const result = await extractOcr(pdf.bytes, { password, signal: controller.signal, onProgress: value => reportProgress(`${value.status || 'Reading PDF'}${Number.isFinite(value.progress) ? ` · ${Math.round(value.progress * 100)}%` : ''}`, request) }); extracted = { ...result, format: 'pdf' }; }
      catch (error) {
        if (request !== generation || pendingPdf !== pdf) return;
        if (/selectable text|scanned|OCR.*not available/i.test(error.message)) { pendingPdf = null; pendingOcr = { ...pdf, password }; progress = ''; announce('The unlocked PDF needs OCR. Its password remains in memory only until recognition or cancellation.'); return; }
        throw error;
      }
      if (request !== generation || pendingPdf !== pdf) return;
      pdfSource = { ...pdf, password }; prepare(extracted.text, pdf.name, extracted.format, extracted.warnings); announce('The PDF is mapped for review. Its password has not been saved.');
    } catch (error) { if (request === generation && error.name !== 'AbortError') announce(error.message, true); }
    finally { if (request === generation) { busy = false; controller = null; redraw(); } }
  }
  async function recognise() {
    const input = pendingOcr; invalidate(); const request = generation; controller = new AbortController(); busy = true; progress = 'Loading the local English OCR engine…'; redraw();
    try {
      const { extractOcr } = await import('./ocr-import.js'); if (request !== generation || pendingOcr !== input) return;
      const result = await extractOcr(input.bytes, { name: input.name, mime: input.mime, password: input.password, forceOcr: Boolean(input.forceOcr), signal: controller.signal, onProgress: value => reportProgress(typeof value === 'string' ? value : `${value.status || 'Recognising'}${Number.isFinite(value.progress) ? ` · ${Math.round(value.progress * 100)}%` : ''}`, request) });
      if (request !== generation || pendingOcr !== input) return;
      prepare(result.text, input.name, 'ocr', result.warnings); announce('OCR text is mapped for review. Recognition can be wrong: compare names, dates and numbers with the original.');
    } catch (error) { if (request === generation && error.name !== 'AbortError') announce(error.message, true); }
    finally { if (request === generation) { busy = false; controller = null; redraw(); } }
  }
  function edit(wrapper, write, limit) {
    const input = wrapper.querySelector('input,textarea,select'); if (limit) input.maxLength = limit;
    input.setAttribute('spellcheck', 'true'); input.setAttribute('lang', 'en-GB');
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', event => { event.stopPropagation(); invalidate(); edited = true; write(input.value); const preview = document.querySelector('#import-preview-details[open] #import-proposal-preview'); if (preview && proposal) safeAction(() => renderPreview(validateDocument(proposal.document), 'cv', preview)); });
    return wrapper;
  }
  function render(target) {
    host = target; target.querySelector('#document-upgrader')?.remove(); const section = element('section', { id: 'document-upgrader', class: 'import-workflow' });
    section.append(sectionTitle('Improve an existing CV', 'LOCAL DOCUMENT INTAKE'), element('p', { class: 'panel-intro', text: 'Bring your existing career facts into a fresh, editable CV. Review the extracted text and mapped fields, then create a new CV or upgrade a separate copy. Your original library and history stay intact.' }));
    const zone = element('button', { id: 'cv-drop-zone', type: 'button', class: 'cv-drop-zone', onClick: chooseFile }, [element('strong', { text: 'Choose a document, or drop it here' }), element('span', { text: 'PDF · Word DOCX · ODT · RTF · text · Markdown · HTML · PNG/JPEG/WebP/BMP' })]);
    zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('dragging'); }); zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
    zone.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('dragging'); const file = event.dataTransfer.files[0]; if (file) void openFile(file); });
    section.append(zone, element('p', { class: 'field-hint', text: 'PDFs/images up to 10 MB; other documents up to 2 MB; text up to 50,000 characters. PDF pages use local English OCR when needed; images start OCR on request. Word97–2003 .doc support is limited to readable main-body text; convert encrypted or older files first. JSON backups use the same chooser.' }));
    if (busy) section.append(element('p', { id: 'import-progress', class: 'import-progress', role: 'status', text: progress }), element('button', { id: 'cancel-extraction', type: 'button', class: 'button button-quiet', text: 'Cancel extraction', onClick: () => { invalidate(); pendingPdf = null; pendingOcr = null; redraw(); announce('Extraction cancelled. Your CV library and any earlier review draft have been kept.'); } }));
    if (pendingPdf && !busy) section.append(element('div', { class: 'import-unlock' }, [sectionTitle('Unlock this PDF', pendingPdf.name), field('PDF password', '', 'pdf-password', { type: 'password' }), element('button', { id: 'unlock-pdf', type: 'button', class: 'button button-primary', text: 'Unlock and review locally', onClick: () => void unlockPdf() })]));
    if (pendingOcr && !busy) section.append(element('div', { class: 'import-unlock' }, [sectionTitle('Read a scan or image', pendingOcr.name), element('p', { class: 'field-hint', text: 'OCR can misread columns, handwriting, dates and numbers. You will review its text and structured fields before anything is saved.' }), element('button', { id: 'start-ocr', type: 'button', class: 'button button-primary', text: 'Start local English OCR', onClick: () => void recognise() })]));
    if (pdfSource && text && !busy) section.append(element('button', { id: 'force-pdf-ocr', type: 'button', class: 'button button-quiet', text: 'Read every PDF page visually with OCR', onClick: () => { if (edited && !window.confirm('Replace the unsaved import review draft with a visual OCR reading? The saved library is kept.')) return; pendingOcr = { ...pdfSource, forceOcr: true }; void recognise(); } }), element('p', { class: 'field-hint', text: 'Use this if the extracted text missed facts inside page images or complex layouts. OCR replaces this review draft only; compare names and numbers with your original.' }));
    const source = element('details', { id: 'import-source-details', class: 'import-disclosure' }, [element('summary', { text: text ? `Extracted source · ${label || 'pasted CV'}${format ? ` (${format.toUpperCase()})` : ''}` : 'Or paste your existing CV' })]); source.open = !text || !proposal;
    const raw = field('Source text — review or paste', text, 'import-review', { multiline: true, rows: '12' });
    const textarea = raw.querySelector('textarea'); textarea.maxLength = 50000; textarea.setAttribute('spellcheck', 'true'); textarea.setAttribute('lang', 'en-GB');
    textarea.addEventListener('input', event => { event.stopPropagation(); invalidate(); edited = true; text = textarea.value; proposal = null; section.querySelector('.import-mapping')?.remove(); section.querySelector('#source-reanalyse').hidden = false; });
    source.append(raw, element('p', { id: 'source-reanalyse', class: 'field-hint', ...(proposal ? { hidden: '' } : {}), text: 'Reviewing or changing the source invalidates the earlier mapping. Map this text again before applying.' }), element('button', { id: 'analyse-import', type: 'button', class: 'button button-primary', text: text ? 'Map this text into editable fields' : 'Review pasted CV', disabled: busy, onClick: () => safeAction(analyse) })); section.append(source);
    if (proposal) renderMapping(section);
    if (text || pendingPdf || pendingOcr) section.append(element('button', { id: 'discard-import', type: 'button', class: 'text-button', text: 'Clear this import draft', onClick: () => { invalidate(); text = ''; label = ''; format = ''; warnings = []; proposal = null; pendingPdf = null; pendingOcr = null; pdfSource = null; edited = false; name = ''; redraw(); announce('Import draft cleared. Your library has been kept.'); } }));
    target.prepend(section);
  }
  function renderMapping(section) {
    const mapping = element('section', { class: 'import-mapping', 'aria-label': 'Review imported CV fields' });
    mapping.append(sectionTitle('Review the editable CV', `${proposal.document.experience.length} ROLES · ${proposal.document.education.length} EDUCATION · ${proposal.document.skills.length} SKILLS`), element('p', { class: 'field-hint', text: 'Review the extracted fields. Check names, employers, qualifications and dates before creating your CV. Move any misclassified content; the complete extracted source stays in hidden source sections in the new CV.' }));
    mapping.append(element('button', { id: 'preview-structured-import', type: 'button', class: 'button button-quiet', text: 'Preview the reviewed CV', onClick: () => safeAction(() => openPreview(validateDocument(proposal.document))) }));
    const notices = [...warnings, ...proposal.warnings]; if (notices.length) mapping.append(element('ul', { class: 'import-notices' }, notices.map(message => element('li', { text: message }))));
    if (proposal.unmappedText) { const uncertain = element('details', { class: 'import-disclosure import-uncertain' }, [element('summary', { text: 'Uncertain / unmapped text — check this before applying' }), element('pre', { class: 'import-unmapped', text: proposal.unmappedText })]); uncertain.open = true; mapping.append(uncertain); }
    for (const key of IMPORT_PROFILE_FIELDS) mapping.append(edit(field(TITLES[key], proposal.document.profile[key], `import-profile-${key}`, { multiline: key === 'summary', rows: '5' }), value => { proposal.document.profile[key] = value; }, key === 'summary' ? 10000 : 300));
    for (const [collection, title] of Object.entries(COLLECTIONS)) {
      const group = element('details', { class: 'import-disclosure', 'data-import-group': collection }, [element('summary', { text: `${title} · ${proposal.document[collection].length} entries` })]); group.open = true;
      proposal.document[collection].forEach((item, index) => {
        const card = element('div', { class: 'entry import-entry', 'data-import-collection': collection, 'data-import-id': item.id });
        const keys = collection === 'skills' ? ['name'] : Object.keys(ENTRY_FIELDS);
        for (const key of keys) card.append(edit(field(key === 'name' ? 'Skill' : ENTRY_FIELDS[key], item[key], `import-${item.id}-${key}`, { multiline: key === 'description', rows: '4' }), value => { item[key] = value; }, key === 'description' ? 10000 : 300));
        card.append(element('div', { class: 'action-row' }, [element('button', { type: 'button', class: 'text-button', text: 'Move up', disabled: index === 0, 'data-import-move': item.id, onClick: () => safeAction(() => { invalidate(); edited = true; proposal.document = moveItem(proposal.document, collection, item.id, -1); redraw(); }) }), element('button', { type: 'button', class: 'text-button', text: 'Remove from mapped CV', 'data-import-remove': item.id, onClick: () => safeAction(() => { invalidate(); edited = true; proposal.document = removeItem(proposal.document, collection, item.id); redraw(); }) })])); group.append(card);
      });
      group.append(element('button', { type: 'button', class: 'add-button', text: `+ Add ${collection === 'skills' ? 'a skill' : 'an entry'}`, 'data-import-add': collection, onClick: () => safeAction(() => { invalidate(); edited = true; proposal.document = addItem(proposal.document, collection, crypto.randomUUID()); redraw(); }) })); mapping.append(group);
    }
    for (const custom of proposal.document.customSections.filter(item => !proposal.document.hiddenSections.includes(item.id))) mapping.append(element('div', { class: 'entry import-entry', 'data-import-custom': custom.id }, [edit(field('Other section heading', custom.title, `import-custom-${custom.id}-title`), value => { custom.title = value; }, 100), edit(field('Other supplied content', custom.content, `import-custom-${custom.id}-content`, { multiline: true, rows: '5' }), value => { custom.content = value; }, 30000), element('button', { type: 'button', class: 'text-button', text: 'Remove from mapped CV', onClick: () => safeAction(() => { invalidate(); edited = true; proposal.document = removeCustomSection(proposal.document, custom.id); redraw(); }) })]));
    mapping.append(element('button', { type: 'button', class: 'add-button', text: '+ Add another section', id: 'import-add-section', onClick: () => safeAction(() => { invalidate(); edited = true; proposal.document = addCustomSection(proposal.document, crypto.randomUUID(), 'Other experience'); redraw(); }) }));
    const style = edit(selectField('Original ClearCV style', proposal.document.style.template, 'import-template', TEMPLATES.map(value => [value, value[0].toUpperCase() + value.slice(1)])), value => { proposal.document.style.template = value; }); mapping.append(style);
    mapping.append(edit(selectField('Accent', proposal.document.style.accent, 'import-accent', ACCENTS.map(value => [value, value])), value => { proposal.document.style.accent = value; }));
    mapping.append(edit(field('Name for the new library CV', name, 'import-document-name'), value => { name = value; }, 100));
    const options = selectField('How to use the reviewed fields', mode, 'import-mode', [['new', 'Create a new CV'], ['merge', 'Upgrade a separate copy of an existing CV']]);
    options.querySelector('select').addEventListener('change', event => { mode = event.target.value; const target = getWorkspace().documents.find(entry => entry.id === targetId) || getWorkspace().documents.find(entry => entry.id === getWorkspace().activeId); targetId = target.id; profileFields = new Set(IMPORT_PROFILE_FIELDS.filter(key => !target.document.profile[key].trim() && proposal.document.profile[key].trim())); redraw(); }); mapping.append(options);
    if (mode === 'merge') {
      const target = selectField('CV to upgrade — the original is kept', targetId, 'import-target', getWorkspace().documents.map(entry => [entry.id, entry.name])); target.querySelector('select').addEventListener('change', event => { targetId = event.target.value; profileFields = new Set(IMPORT_PROFILE_FIELDS.filter(key => !getWorkspace().documents.find(entry => entry.id === targetId).document.profile[key].trim() && proposal.document.profile[key].trim())); redraw(); }); mapping.append(target);
      mapping.append(element('p', { class: 'field-hint', text: 'Choose profile fields to replace in the separate copy. Existing facts, layout, cover letter and job description are kept unless explicitly changed below. Imported source sections are always retained.' }));
      for (const key of IMPORT_PROFILE_FIELDS) { const checkbox = element('input', { id: `import-use-${key}`, type: 'checkbox' }); checkbox.checked = profileFields.has(key); checkbox.addEventListener('change', () => { if (checkbox.checked) profileFields.add(key); else profileFields.delete(key); }); mapping.append(element('label', { class: 'import-choice', for: checkbox.id }, [checkbox, element('span', { text: `Use reviewed ${TITLES[key].toLowerCase()}` })])); }
      for (const [collection, title] of Object.entries(COLLECTIONS)) { const choices = selectField(`${title} in the separate copy`, sectionModes[collection], `import-merge-${collection}`, [['append', 'Append reviewed entries; skip exact duplicates'], ['replace', 'Replace with reviewed entries'], ['keep', 'Keep existing entries']]); choices.querySelector('select').addEventListener('change', event => { sectionModes[collection] = event.target.value; }); mapping.append(choices); }
    }
    mapping.append(element('p', { class: 'field-hint', text: mode === 'merge' ? 'Applying creates an independent upgraded copy. It preserves the chosen CV’s style and letter; adjust Design after applying. Existing CVs, snapshots, jobs and submitted attachments are unchanged.' : 'Applying creates an independent CV with the chosen style. Existing CVs, snapshots, jobs and submitted attachments are unchanged.' }));
    mapping.append(element('div', { class: 'action-row import-apply-actions' }, [element('button', { id: 'apply-structured-import', type: 'button', class: 'button button-primary', text: mode === 'merge' ? 'Create upgraded copy' : 'Create reviewed CV', onClick: () => safeAction(() => {
      const next = createReviewedImport(getWorkspace(), proposal.document, { id: crypto.randomUUID(), name: name.trim(), mode, targetId, profileFields: [...profileFields], sectionModes });
      const saved = changeWorkspace(next); invalidate(); text = ''; proposal = null; label = ''; name = ''; warnings = []; pdfSource = null; edited = false; switchTab('content');
      announce(saved ? 'Your reviewed CV is editable and saved. The original library and history have been kept.' : 'Your reviewed CV is editable but could not be saved. Export a workspace backup before closing; the originals have been kept.', !saved);
    }) }), element('button', { id: 'export-import-proposal', type: 'button', class: 'button button-quiet', text: 'Download reviewed JSON', onClick: () => safeAction(() => download(JSON.stringify(validateDocument(proposal.document), null, 2), 'application/json', 'json', name || 'reviewed-cv')) })]));
    section.append(mapping);
  }
  function cancelPending() { invalidate(); pendingPdf = null; pendingOcr = null; pdfSource = null; }
  return { render, openFile, cancelPending };
}
