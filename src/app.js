import { createDocument, validateDocument, parseDocument, serialiseDocument, addItem, updateItem, moveItem, removeItem, keywordFeedback, ACCENTS, addCustomSection, removeCustomSection, moveSection, plainTextDocument, resolveRichTextField, reconcileRichText } from './model.js';

import { createWorkspace, validateWorkspace, serialiseWorkspace, parseWorkspace, parseImport, activeEntry, updateActiveDocument, addDocument, duplicateDocument, deleteDocument, saveSnapshot, restoreSnapshot, addApplication, updateApplication, mergeWorkspace, JOB_STATUSES, MAX_CVS, saveReusableLetter, useReusableLetter, removeReusableLetter } from './workspace.js';
import { reviewCV, tailoringSuggestions, coverLetterDraft } from './review.js';
import { exportDocx } from './formats.js';
import { createDocumentImportUI } from './import-ui.js';
import { createWritingUI } from './writing-ui.js';
import { getAiStatus, generateWriting } from './ai-client.js';
import { createCloudUI } from './cloud-ui.js';
import { safeContactHref } from './links.js';
import { createJobsUI } from './jobs-ui.js';
import { applicationSubmission, copySubmissionToLibrary } from './workspace.js';
import { initialWorkspace, addNewCV, isBlankCV, isFirstBlankWorkspace } from './new-cv.js';
import { persistWorkspace, WorkspaceConflictError } from './storage.js';
import { FONT_FAMILIES, TEMPLATE_CHOICES, sectionPlacement } from './layout.js';
import { renderRichText } from './rich-text.js';
import { installRichTextToolbar } from './rich-text-ui.js';
import { prepareTailoredCopy, reviewTailoredCopy, jobRequirementChecks } from './tailoring.js';
import { decodePortrait } from './portrait.js';
import { buildPagePreview } from './page-preview.js';
const STORAGE_KEY = 'clearcv.workspace.v1';
const LEGACY_STORAGE_KEY = 'clearcv.document.v1';
let workspace;
let documentImportUI = null;
let writingUI = null;
let cloudUI = null;
let jobsUI = null;
let aiStatus = { enabled: false };
let aiBusy = false;
let aiTask = 'summary';
let aiTarget = 'summary';
let aiCandidate = null;
let aiUndo = null;
let aiController = null;
const practiceRecords = new Map();
let rawWorkspace = null;
let savedWorkspaceBaseline = null;
let storageConflict = false;
let portraitGeneration = 0;
let recoveryRaw = '';
let recoveryBackedUp = false;
let recoveryDownloaded = false;
let recoveryStorageKey = '';
let recoveryPresent = false;
let welcomeDismissed = false;

let activeTab = 'content';
let noticeTimer;
let initialNotice = '';
let initialNoticeIsError = false;
let state;
let richTextToolbars = [];
let tailoringDraft = null;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  rawWorkspace = saved;
  savedWorkspaceBaseline = saved;
  if (saved !== null) workspace = initialWorkspace(saved, null).workspace;
  else {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    const loaded = initialWorkspace(null, legacy);
    workspace = loaded.workspace;
    savedWorkspaceBaseline = persistWorkspace(localStorage, STORAGE_KEY, workspace, savedWorkspaceBaseline);
    if (loaded.migrated) initialNotice = 'Your previous CV is in your library. We’ve also kept the original saved copy.';
  }
} catch (error) {
  if (error instanceof WorkspaceConflictError) storageConflict = true;
  if (rawWorkspace !== null) {
    recoveryPresent = true;
    recoveryRaw = rawWorkspace;
    recoveryStorageKey = `${STORAGE_KEY}.recovery.${Date.now()}`;
    try { localStorage.setItem(recoveryStorageKey, recoveryRaw); recoveryBackedUp = true; }
    catch { recoveryBackedUp = false; }
  }
  if (!workspace) {
    try { workspace = createWorkspace(parseDocument(localStorage.getItem(LEGACY_STORAGE_KEY)), 'recovered-cv', 'Recovered CV'); }
    catch { workspace = createWorkspace(createDocument(), 'recovered-cv', 'Untitled CV'); }
  }
  initialNoticeIsError = true;
  initialNotice = recoveryPresent
    ? `We couldn’t open or save your library: ${error.message} The original saved library is ${recoveryBackedUp ? 'kept as a recovery copy' : 'protected; saving is paused'}. Open Library to download the original and back up your open CVs.`
    : `This browser couldn’t open or save your library: ${error.message} You can keep editing. Download a workspace backup before closing.`;
  document.querySelector('#save-status').textContent = 'Saved copy unavailable';
}
state = activeEntry(workspace).document;
const panel = document.querySelector('#editor-panel');
const preview = document.querySelector('#cv-preview');

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key === 'onClick') node.addEventListener('click', value);
    else if (key === 'disabled') node.disabled = value;
    else if (key === 'value') node.value = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}
function announce(message, error = false) {
  const box = document.querySelector('#notification');
  box.textContent = message;
  box.classList.toggle('error', error);
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { box.hidden = true; }, error ? 12000 : 5000);
}
function save() {
  if (recoveryPresent && !recoveryBackedUp) {
    document.querySelector('#save-status').textContent = 'Saving paused · keep a backup';
    announce('We couldn’t read your saved library. Open Library to download the original before replacing it. You can still edit the open CVs.', true);
    return false;
  }
  try {
    savedWorkspaceBaseline = persistWorkspace(localStorage, STORAGE_KEY, workspace, savedWorkspaceBaseline);
    storageConflict = false;
    document.querySelector('#save-status').textContent = 'Saved on this device';
    return true;
  } catch (error) {
    if (error instanceof WorkspaceConflictError) {
      storageConflict = true;
      document.querySelector('#save-status').textContent = 'Another tab saved · back up your edits';
      announce(error.message, true);
    } else {
      document.querySelector('#save-status').textContent = 'Not saved · export a backup';
      announce('Your changes couldn’t be saved. Download a workspace backup before closing this page.', true);
    }
    return false;
  }
}
function changeWorkspace(next, rerender = true) {
  workspace = validateWorkspace(next);
  state = activeEntry(workspace).document;
  const saved = save();
  renderDocumentSwitcher();
  renderPreview();
  if (rerender) renderPanel();
  else if (activeTab === 'match') renderMatchResults();
  return saved;
}
function change(next, rerender = false) {
  const saved = changeWorkspace(updateActiveDocument(workspace, reconcileRichText(state, next)), rerender);
  for (const toolbar of richTextToolbars) toolbar.refresh();
  return saved;
}
function renderDocumentSwitcher() {
  const select = document.querySelector('#active-document');
  select.replaceChildren(...workspace.documents.map(entry => element('option', { value: entry.id, text: entry.name })));
  select.value = workspace.activeId;
}
function download(content, type, extension, stem = activeEntry(workspace).name) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = element('a', { href: url, download: `${stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'clearcv'}.${extension}` });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeAction(action) {
  try { action(); return true; } catch (error) { announce(error.message, true); return false; }
}
function sectionTitle(title, caption = '') {
  return element('div', { class: 'section-heading' }, [element('h2', { text: title }), caption ? element('span', { class: 'section-caption', text: caption }) : null]);
}
function field(label, value, id, options = {}) {
  const input = element(options.multiline ? 'textarea' : 'input', {
    id, value, ...(options.multiline ? { rows: options.rows || '4' } : { type: options.type || 'text' }),
    maxlength: options.multiline ? '10000' : '300', placeholder: options.placeholder || '',
    autocomplete: options.autocomplete || 'off', spellcheck: options.type && ['email', 'tel', 'url', 'password', 'date'].includes(options.type) ? 'false' : 'true', lang: 'en-GB', ...options.data
  });
  const wrapper = element('div', { class: 'field' }, [element('label', { class: 'field-label', for: id, text: label }), input]);
  if (options.hint) wrapper.append(element('span', { class: 'field-hint', text: options.hint }));
  return wrapper;
}
function cvNameField(id) {
  const entry = activeEntry(workspace);
  const wrapper = field('CV name in your library', entry.name, id, { hint: 'Name this version so you can find it again.', data: { 'data-document-name': entry.id } });
  const input = wrapper.querySelector('input'); input.maxLength = 100;
  input.addEventListener('blur', () => { if (input.isConnected && !input.value.trim()) input.value = activeEntry(workspace).name; });
  return wrapper;
}
function renderWelcome() {
  panel.append(element('section', { id: 'welcome-start', class: 'welcome-start', 'aria-labelledby': 'welcome-title' }, [
    element('span', { class: 'eyebrow', text: 'START YOUR CV' }),
    element('h2', { id: 'welcome-title', text: 'How would you like to begin?' }),
    element('p', { text: 'Start a blank CV, import one you’ve written, or try the example. Your library stays in this browser.' }),
    element('div', { class: 'welcome-actions' }, [
      element('button', { id: 'welcome-start-blank', type: 'button', class: 'button button-primary', text: 'Create blank CV', onClick: () => safeAction(() => {
        if (!isFirstBlankWorkspace(workspace)) { createCV('blank'); return; }
        cancelPendingLocalWork(); const saved = save(); welcomeDismissed = true; openNewCVEditor();
        announce(saved ? 'Your blank CV is ready. Start with your name, then choose a style.' : 'Your blank CV is open but not saved. Export a workspace backup before closing.', !saved);
      }) }),
      element('button', { id: 'welcome-import-cv', type: 'button', class: 'button button-quiet', text: 'Import CV', onClick: openCVIntake }),
      element('button', { id: 'welcome-explore-example', type: 'button', class: 'text-button', text: 'Explore example', onClick: () => createCV('example') })
    ])
  ]));
}
function renderContent() {
  const welcome = !welcomeDismissed && isFirstBlankWorkspace(workspace);
  if (welcome) renderWelcome();
  else if (isBlankCV(state)) panel.append(element('section', { id: 'blank-cv-guide', class: 'blank-cv-guide' }, [
    sectionTitle('Write your CV'),
    element('p', { class: 'panel-intro', text: 'Add your name and title, then your experience, education and skills.' }),
    element('button', { id: 'choose-cv-style', type: 'button', class: 'button button-quiet', text: 'Choose a style', onClick: () => switchTab('design', true) })
  ]));
  else panel.append(element('button', { id: 'improve-existing-cv', type: 'button', class: 'button button-quiet improve-existing', text: 'Improve an existing CV', onClick: () => switchTab('library') }));
  panel.append(cvNameField('content-document-name'));
  panel.append(sectionTitle('The essentials', '01 / YOUR INTRODUCTION'));
  for (const [key, label, placeholder, type] of [
    ['name', 'Full name', 'Your name'], ['headline', 'Professional title', 'What do you do?'],
    ['email', 'Email address', 'you@example.com', 'email'], ['phone', 'Phone', '+44…', 'tel'],
    ['location', 'Location', 'City, country'], ['website', 'Website or portfolio', 'your-portfolio.example']
  ]) {
    const input = field(label, state.profile[key], `profile-${key}`, { placeholder, type, data: { 'data-profile': key } });
    if (['email', 'location'].includes(key)) {
      const row = element('div', { class: 'field-row' }, [input]);
      panel.append(row);
    } else if (['phone', 'website'].includes(key)) panel.lastElementChild.append(input);
    else panel.append(input);
  }
  panel.append(field('A little about you', state.profile.summary, 'profile-summary', { multiline: true, rows: '5', placeholder: 'What do you do, and what would you bring to this role?', data: { 'data-profile': 'summary' }, hint: 'Introduce yourself in a few sentences.' }));
  renderCollection('experience', 'Experience', '02 / WHAT YOU HAVE DONE');
  renderCollection('education', 'Education', '03 / WHAT YOU HAVE LEARNT');
  renderCollection('skills', 'Skills', '04 / YOUR STRENGTHS');
  renderCustomSections();
}
function entryActions(collection, item, index) {
  return element('div', { class: 'entry-actions' }, [
    element('button', { type: 'button', class: 'icon-button', text: '↑', 'aria-label': `Move ${collection} entry ${index + 1} up`, 'data-action': 'move-up', 'data-id': item.id, 'data-collection': collection, disabled: index === 0, onClick: () => safeAction(() => change(moveItem(state, collection, item.id, -1), true)) }),
    element('button', { type: 'button', class: 'icon-button', text: '↓', 'aria-label': `Move ${collection} entry ${index + 1} down`, 'data-action': 'move-down', 'data-id': item.id, 'data-collection': collection, disabled: index === state[collection].length - 1, onClick: () => safeAction(() => change(moveItem(state, collection, item.id, 1), true)) }),
    element('button', { type: 'button', class: 'icon-button', text: '×', 'aria-label': `Remove ${collection} entry ${index + 1}`, 'data-action': 'remove', 'data-id': item.id, 'data-collection': collection, onClick: () => safeAction(() => change(removeItem(state, collection, item.id), true)) })
  ]);
}
function renderCollection(collection, title, caption) {
  const section = element('section', { class: 'form-section', 'aria-label': `${title} editor` }, [sectionTitle(title, caption)]);
  if (!state[collection].length) section.append(element('p', { class: 'field-hint collection-empty', text: { experience: 'Add a role, placement or relevant volunteering. Use your own dates and achievements.', education: 'Add a qualification, course or training that is relevant to your next role.', skills: 'Add skills you can confidently bring to the role.' }[collection] }));
  state[collection].forEach((item, index) => {
    if (collection === 'skills') {
      const id = `skill-${item.id}`;
      section.append(element('div', { class: 'skill-row' }, [
        element('input', { id, 'aria-label': `Skill ${index + 1}`, value: item.name, placeholder: 'A skill you bring', maxlength: '300', 'data-collection': collection, 'data-id': item.id, 'data-field': 'name' }), entryActions(collection, item, index)
      ]));
      return;
    }
    const entry = element('div', { class: 'entry', 'data-entry-id': item.id }, [element('div', { class: 'entry-top' }, [element('span', { class: 'entry-name', text: item.title || `${title} ${index + 1}` }), entryActions(collection, item, index)])]);
    for (const [key, label, placeholder] of [
      ['title', collection === 'experience' ? 'Role title' : 'Qualification', collection === 'experience' ? 'Product Designer' : 'BA (Hons) Design'],
      ['organisation', collection === 'experience' ? 'Organisation' : 'Institution', collection === 'experience' ? 'Where you worked' : 'Where you studied'],
      ['dates', 'Dates', '2022 — Present'], ['location', 'Location', 'City or remote'],
      ['description', collection === 'experience' ? 'Achievements & responsibilities' : 'Details', collection === 'experience' ? 'What changed because of your work?' : 'Relevant subjects, honours or projects']
    ]) {
      const input = field(label, item[key], `${collection}-${item.id}-${key}`, { placeholder, multiline: key === 'description', rows: '4', data: { 'data-collection': collection, 'data-id': item.id, 'data-field': key }, hint: key === 'description' ? 'Each new line becomes a bullet point.' : '' });
      if (key === 'dates') entry.append(element('div', { class: 'field-row' }, [input]));
      else if (key === 'location') entry.lastElementChild.append(input);
      else entry.append(input);
    }
    section.append(entry);
  });
  const singular = collection === 'experience' ? 'experience' : collection === 'education' ? 'education' : 'skill';
  section.append(element('button', { type: 'button', class: 'add-button', id: `add-${collection}`, text: `+ Add ${singular}`, onClick: () => safeAction(() => {
    const id = crypto.randomUUID();
    change(addItem(state, collection, id), true);
    const input = document.querySelector(collection === 'skills' ? `#skill-${id}` : `#${collection}-${id}-title`);
    input?.focus();
  }) }));
  panel.append(section);
}
function renderDesign() {
  panel.append(sectionTitle('Choose a layout', 'STYLE YOUR CV'));
  panel.append(element('p', { class: 'panel-intro', text: 'Choose a layout, then adjust the colour, type and spacing.' }));
  const grid = element('div', { class: 'template-grid' });
  for (const [template, name, columns] of TEMPLATE_CHOICES) {
    const thumbnail = element('span', { class: `template-thumbnail mini-${template}`, 'aria-hidden': 'true' }, [element('span', { class: 'mini-title' }), element('span', { class: 'mini-accent' })]);
    for (let i = 0; i < 10; i++) thumbnail.append(element('span', { class: `mini-line${i % 4 === 3 ? ' short' : ''}` }));
    grid.append(element('button', { id: `template-${template}`, type: 'button', class: 'template-option', 'aria-pressed': String(state.style.template === template), 'aria-label': `${name} template`, onClick: () => change({ ...state, style: { ...state.style, template }, layout: { ...state.layout, columns } }, true) }, [thumbnail, element('span', { text: name })]));
  }
  panel.append(grid);
  panel.append(sectionTitle('Accent colour'));
  panel.append(element('p', { class: 'panel-intro', text: 'Choose a colour for headings and highlights.' }));
  const colours = ['Terracotta', 'Forest', 'Slate blue', 'Plum', 'Charcoal'];
  const swatches = element('div', { class: 'swatches', role: 'group', 'aria-label': 'Accent colour' });
  ACCENTS.forEach((accent, index) => {
    const button = element('button', { type: 'button', class: 'swatch', 'aria-label': colours[index], 'aria-pressed': String(state.style.accent.toLowerCase() === accent), onClick: () => change({ ...state, style: { ...state.style, accent } }, true) });
    button.style.setProperty('--swatch', accent);
    swatches.append(button);
  });
  panel.append(swatches);
  const customColour = element('div', { class: 'custom-colour' }, [field('Custom colour', state.style.accent, 'custom-accent', { type: 'color' }), field('Hex colour', state.style.accent, 'accent-hex', { hint: 'For example, #2b6b5b' })]);
  customColour.querySelector('#accent-hex').maxLength = 7;
  customColour.querySelector('#custom-accent').addEventListener('input', event => safeAction(() => {
    change({ ...state, style: { ...state.style, accent: event.target.value } });
    document.querySelector('#accent-hex').value = state.style.accent;
  }));
  customColour.querySelector('#accent-hex').addEventListener('input', event => {
    const accent = event.target.value.trim();
    // Leave incomplete colours editable; apply a complete colour without blur.
    if (/^#[0-9a-fA-F]{6}$/.test(accent) && safeAction(() => change({ ...state, style: { ...state.style, accent } }))) {
      document.querySelector('#custom-accent').value = state.style.accent;
    }
  });
  customColour.querySelector('#accent-hex').addEventListener('change', event => {
    if (!safeAction(() => change({ ...state, style: { ...state.style, accent: event.target.value.trim() } }))) event.target.value = state.style.accent;
    document.querySelector('#custom-accent').value = state.style.accent;
  });
  panel.append(customColour);
  renderLayoutControls();
  renderSectionControls();
  panel.append(element('button', { id: 'design-preview-pages', type: 'button', class: 'button button-quiet', text: 'Preview pages', onClick: showPagePreview }));
  panel.append(element('p', { class: 'design-note', text: 'Save as PDF opens your browser’s print dialogue. Use the paper size selected above, turn off headers and footers, and check every page.' }));
}
function renderMatch() {
  panel.append(sectionTitle('Match your CV to a job', 'JOB KEYWORDS'));
  panel.append(element('p', { class: 'panel-intro', text: 'Paste a job description to see which words already appear in your CV. Bring out relevant experience using your own words.' }));
  const input = field('Job description', state.jobAd, 'job-ad', { multiline: true, rows: '10', placeholder: 'Paste the role description here…', data: { 'data-job-ad': 'true' } });
  input.querySelector('textarea').maxLength = 50000;
  input.querySelector('textarea').classList.add('match-description');
  panel.append(input, element('div', { id: 'match-results', 'aria-live': 'polite' }));
  renderMatchResults();
}
function renderMatchResults() {
  const container = document.querySelector('#match-results');
  if (!container) return;
  container.replaceChildren();
  const feedback = keywordFeedback(state);
  if (feedback.percentage === null) {
    container.append(element('p', { class: 'match-empty', text: 'Paste a job description to compare its keywords with your CV. The percentage shows shared words, not an ATS score.' }));
    return;
  }
  const card = element('div', { class: 'match-card' }, [
    element('span', { id: 'match-percentage', class: 'match-count', text: `${feedback.percentage}%` }),
    element('span', { class: 'match-card-title', text: 'keyword overlap' }),
    element('p', { class: 'match-caption', text: `${feedback.found.length} of ${feedback.keywords.length} job keywords appear in your CV. This compares words, not their meaning or your chances of getting the job.` })
  ]);
  for (const [words, heading, missing] of [[feedback.found, 'Already in your CV', false], [feedback.missing, 'Add only if relevant', true]]) {
    card.append(element('h3', { class: 'keyword-heading', text: heading }));
    const chips = element('div', { class: 'keyword-chips', 'data-keyword-group': missing ? 'missing' : 'found' });
    for (const word of words) chips.append(element('span', { class: `keyword-chip${missing ? ' missing' : ''}`, text: word }));
    if (!words.length) chips.append(element('span', { class: 'match-empty', text: missing ? 'All selected words are present.' : 'No selected words appear yet.' }));
    card.append(chips);
  }
  card.append(element('p', { class: 'match-caption', text: 'Use a missing keyword only when it describes your experience. You don’t need to include every word.' }));
  container.append(card);
  renderRequirementChecks(container);
  renderTailoring(container);
}
function richFieldKey(input) {
  if (input.dataset.profile === 'summary') return 'profile.summary';
  if (['experience', 'education'].includes(input.dataset.collection) && input.dataset.field === 'description') return `${input.dataset.collection}.${input.dataset.id}.description`;
  if (input.dataset.customField === 'content') return `customSections.${input.dataset.section}.content`;
  if (input.dataset.letter === 'body') return 'coverLetter.body';
  return null;
}
function installFormatting() {
  const docId = workspace.activeId;
  for (const textarea of panel.querySelectorAll('textarea')) {
    const key = richFieldKey(textarea);
    if (!key) continue;
    textarea.dataset.richField = key;
    const toolbar = installRichTextToolbar(textarea, {
      getText: () => resolveRichTextField(state, key), getRuns: () => state.richText[key] || [], transformOnInput: false,
      setRuns: runs => {
        if (workspace.activeId !== docId) { announce('The open CV changed. Select your text again.', true); return false; }
        let saved = false;
        if (!safeAction(() => {
          const richText = { ...state.richText };
          if (runs.length) richText[key] = runs; else delete richText[key];
          saved = change({ ...state, richText });
        })) return false;
        return saved;
      }, announce, onError: error => announce(error.message, true)
    });
    richTextToolbars.push(toolbar);
  }
}
function renderPanel() {
  for (const toolbar of richTextToolbars) toolbar.dispose();
  richTextToolbars = [];
  panel.replaceChildren();
  panel.setAttribute('aria-labelledby', `tab-${activeTab}`);
  if (activeTab === 'content') renderContent();
  else if (activeTab === 'design') renderDesign();
  else if (activeTab === 'match') renderMatch();
  else if (activeTab === 'library') renderLibrary();
  else if (activeTab === 'letter') renderLetter();
  else if (activeTab === 'jobs') {
    if (!jobsUI) jobsUI = createJobsUI({ element, field, selectField, sectionTitle, getWorkspace: () => workspace, changeWorkspace, safeAction, announce, switchTab, download, openSubmission: showSubmittedCopy, openJobMatch });
    jobsUI.render(panel);
  }
  else if (activeTab === 'review') renderReview();
  else if (activeTab === 'ai') renderAi();
  else renderCloud();
  installFormatting();
}
function setPrintLayout(doc) {
  let printStyle = document.querySelector('#document-print-style');
  if (!printStyle) { printStyle = element('style', { id: 'document-print-style' }); document.head.append(printStyle); }
  printStyle.textContent = `@media print{@page{size:${doc.layout.pageSize};margin:${(doc.layout.margin / 3.78).toFixed(1)}mm}}`;
}
function renderPreview(documentOverride = state, kind = activeTab === 'letter' ? 'letter' : 'cv', target = preview) {
  const state = documentOverride;
  const preview = target;
  preview.replaceChildren();
  preview.className = `paper template-${state.style.template}`;
  preview.style.setProperty('--paper-accent', state.style.accent);
  for (const [key, value] of Object.entries({ 'font-size': `${state.layout.fontSize}px`, 'line-height': state.layout.lineHeight, 'spacing': `${state.layout.spacing}px`, 'margin': `${state.layout.margin}px`, 'font': FONT_FAMILIES[state.layout.font].css })) preview.style.setProperty(`--cv-${key}`, value);
  if (target.id === 'cv-preview') {
    if (!document.querySelector('#submitted-dialog[open]')) setPrintLayout(state);
    document.querySelector('#preview-kind').textContent = `${state.layout.pageSize} · ${kind === 'letter' ? 'cover letter' : 'CV preview'}`;
  }
  if (kind === 'letter') { renderLetterPreview(state, preview); return; }
  const profile = state.profile;
  const header = element('header', { class: 'cv-header' }, [
    element('h1', { class: `cv-name${profile.name ? '' : ' cv-placeholder'}`, text: profile.name || 'Your name' }),
    element('div', { class: `cv-headline${profile.headline ? '' : ' cv-placeholder'}`, text: profile.headline || 'Your next chapter' })
  ]);
  const contacts = element('div', { class: 'cv-contact' });
  for (const key of ['email', 'phone', 'location', 'website']) if (profile[key].trim()) contacts.append(contactElement(key, profile[key]));
  header.append(contacts);
  if (state.photo) header.append(element('img', { class: 'cv-photo', src: state.photo, alt: `Portrait of ${profile.name || 'CV author'}` }));
  preview.append(header);
  if (profile.summary.trim()) preview.append(element('section', { class: 'cv-section', 'data-preview-section': 'profile' }, [element('h2', { text: state.sectionTitles.profile }), richElement('p', 'cv-summary', profile.summary, state.richText['profile.summary'])]));
  for (const [collection, title] of [['experience', 'Experience'], ['education', 'Education']]) {
    if (!state[collection].length) continue;
    const section = element('section', { class: 'cv-section', 'data-preview-section': collection }, [element('h2', { text: state.sectionTitles[collection] })]);
    for (const item of state[collection]) {
      const entry = element('div', { class: 'cv-entry', 'data-preview-entry': item.id }, [element('div', { class: 'cv-entry-head' }, [
        element('h3', { text: item.title || (collection === 'experience' ? 'Role title' : 'Qualification'), class: item.title ? '' : 'cv-placeholder' }),
        item.dates ? element('span', { class: 'cv-dates', text: item.dates }) : null
      ])]);
      if (item.organisation || item.location) entry.append(element('div', { class: 'cv-organisation', text: item.organisation }, [item.location ? element('span', { text: item.location }) : null]));
      const bullets = element('ul', { class: 'cv-bullets' });
      let offset = 0;
      for (const raw of item.description.split('\n')) {
        const line = raw.trim().replace(/^[-*•]\s+/, '');
        if (line) {
          const start = offset + raw.indexOf(line);
          const itemNode = element('li');
          itemNode.append(renderRichText(item.description, state.richText[`${collection}.${item.id}.description`] || [], { document: window.document, start, end: start + line.length }));
          bullets.append(itemNode);
        }
        offset += raw.length + 1;
      }
      if (bullets.children.length) entry.append(bullets);
      section.append(entry);
    }
    preview.append(section);
  }
  const skills = state.skills.filter(item => item.name.trim());
  if (skills.length) preview.append(element('section', { class: 'cv-section', 'data-preview-section': 'skills' }, [element('h2', { text: state.sectionTitles.skills }), element('div', { class: 'cv-skills' }, skills.map(item => element('span', { class: 'cv-skill', text: item.name })))]));
  for (const section of state.customSections) if (section.content.trim()) preview.append(element('section', { class: 'cv-section', 'data-preview-section': section.id }, [element('h2', { text: section.title }), richElement('p', 'cv-summary', section.content, state.richText[`customSections.${section.id}.content`])]));
  const rendered = new Map([...preview.querySelectorAll('[data-preview-section]')].map(section => [section.dataset.previewSection, section]));
  const columns = element('div', { class: `cv-columns columns-${state.layout.columns} ratio-${state.layout.columnRatio}` });
  const main = element('div', { class: 'cv-column cv-column-main', 'data-cv-column': 'main' });
  const side = element('div', { class: 'cv-column cv-column-side', 'data-cv-column': 'side' });
  columns.append(main); if (state.layout.columns === 2) columns.append(side);
  for (const id of state.sectionOrder) {
    const section = rendered.get(id);
    if (!section) continue;
    if (state.hiddenSections.includes(id)) section.remove();
    else (state.layout.columns === 2 && sectionPlacement(state, id) === 'side' ? side : main).append(section);
  }
  preview.append(columns);
  if (isBlankCV(state)) preview.append(element('div', { class: 'cv-empty-guide' }, [element('p', { text: 'Your CV starts here.' }), element('span', { text: 'Add your name and experience in Content. Choose a layout in Design. The preview updates as you write.' })]));
}
function richElement(tag, className, text, runs) {
  const node = element(tag, { class: className });
  node.append(renderRichText(text, runs || [], { document: window.document }));
  return node;
}
function scrollMobileWorkspace(restoredPosition = 0) {
  if (!matchMedia('(max-width: 700px)').matches) return;
  requestAnimationFrame(() => {
    const workspace = document.querySelector('.workspace');
    const headerHeight = Math.ceil(document.querySelector('.app-header').getBoundingClientRect().height);
    // The view switch stays below the sticky header. Keep it in view rather
    // than scrolling the workspace underneath both sets of controls.
    const start = Math.max(0, window.scrollY + workspace.getBoundingClientRect().top - headerHeight);
    window.scrollTo({ top: Math.max(start, restoredPosition), behavior: 'auto' });
  });
}
function switchTab(tab, focus = false) {
  const workspace = document.querySelector('.workspace');
  if (workspace.dataset.mobileView === 'preview') {
    workspace.dataset.mobileView = 'edit';
    document.querySelector('#mobile-edit')?.setAttribute('aria-pressed', 'true');
    document.querySelector('#mobile-preview')?.setAttribute('aria-pressed', 'false');
    scrollMobileWorkspace();
  }
  activeTab = tab;
  workspace.dataset.editorView = tab;
  for (const button of document.querySelectorAll('[data-tab]')) {
    const selected = button.dataset.tab === tab;
    if (button.getAttribute('role') === 'tab') {
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    } else {
      button.classList.toggle('active', selected);
      button.setAttribute('aria-current', selected ? 'page' : 'false');
    }
  }
  renderPanel();
  renderPreview();
  const selectedTab = document.querySelector(`#tab-${tab}`);
  selectedTab.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  if (focus) selectedTab.focus();
}
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => switchTab(button.dataset.tab));
document.querySelector('.editor-tabs').addEventListener('keydown', event => {
  const tabs = ['content', 'design', 'match', 'library', 'letter', 'jobs', 'review', 'ai', 'cloud'];
  const current = tabs.indexOf(activeTab);
  let next;
  if (event.key === 'ArrowRight') next = tabs[(current + 1) % tabs.length];
  if (event.key === 'ArrowLeft') next = tabs[(current + tabs.length - 1) % tabs.length];
  if (event.key === 'Home') next = tabs[0];
  if (event.key === 'End') next = tabs.at(-1);
  if (next) { event.preventDefault(); switchTab(next, true); }
});
panel.addEventListener('input', event => {
  const input = event.target;
  const accepted = safeAction(() => {
    if (input.dataset.profile) change({ ...state, profile: { ...state.profile, [input.dataset.profile]: input.value } });
    else if (input.dataset.collection) change(updateItem(state, input.dataset.collection, input.dataset.id, input.dataset.field, input.value));
    else if (input.dataset.jobAd) change({ ...state, jobAd: input.value });
    else if (input.dataset.customField) change({ ...state, customSections: state.customSections.map(section => section.id === input.dataset.section ? { ...section, [input.dataset.customField]: input.value } : section) });
    else if (input.dataset.letter) change({ ...state, coverLetter: { ...state.coverLetter, [input.dataset.letter]: input.value } });
    else if (input.dataset.layout) change({ ...state, layout: { ...state.layout, [input.dataset.layout]: input.type === 'range' ? Number(input.value) : input.value } });
    else if (input.dataset.sectionTitle) change({ ...state, sectionTitles: { ...state.sectionTitles, [input.dataset.sectionTitle]: input.value } });
    else if (input.dataset.documentName) {
      if (input.dataset.documentName !== workspace.activeId) throw new Error('The open CV changed. Rename the current CV instead.');
      if (input.value.trim()) changeWorkspace({ ...workspace, documents: workspace.documents.map(entry => entry.id === workspace.activeId ? { ...entry, name: input.value.trim() } : entry) }, false);
    }
  });
  if (!accepted) {
    if (input.dataset.profile) input.value = state.profile[input.dataset.profile];
    else if (input.dataset.collection) input.value = state[input.dataset.collection].find(item => item.id === input.dataset.id)?.[input.dataset.field] || '';
    else if (input.dataset.jobAd) input.value = state.jobAd;
  }
});
document.querySelector('#print-cv').addEventListener('click', () => {
  const previousTitle = document.title;
  document.title = `${state.profile.name.trim() || 'ClearCV'} — ${activeTab === 'letter' ? 'Cover letter' : 'CV'}`;
  window.print();
  document.title = previousTitle;
});
document.querySelector('#export-json').addEventListener('click', () => safeAction(() => {
  const blob = new Blob([serialiseDocument(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = element('a', { href: url, download: `${state.profile.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'clearcv'}-cv.json` });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce('CV backup downloaded. It includes the pasted job description. Keep the file private.');
}));
function exportWorkspaceBackup() {
  return safeAction(() => {
    download(serialiseWorkspace(workspace), 'application/json', 'json', 'clearcv-workspace');
    announce('Workspace backup downloaded. It includes your whole library. Keep the file private.');
  });
}
document.querySelector('#header-export-workspace').addEventListener('click', exportWorkspaceBackup);
function reloadNewerWorkspace() {
  return safeAction(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) throw new Error('The saved library was removed. Keep a workspace backup of your open edits before reopening the app.');
    const next = parseWorkspace(raw);
    if (!window.confirm('Have you downloaded a backup? Reloading replaces the edits open in this tab. You can import your backup afterwards.')) return;
    if (localStorage.getItem(STORAGE_KEY) !== raw) throw new Error('Another tab saved again. Your open edits are still here. Keep a backup, then try Reload again.');
    cancelPendingLocalWork(); document.querySelector('#submitted-dialog[open]')?.close();
    savedWorkspaceBaseline = raw; storageConflict = false;
    workspace = next; state = activeEntry(workspace).document;
    renderDocumentSwitcher(); renderPreview(); renderPanel();
    document.querySelector('#save-status').textContent = 'Saved on this device';
    announce('The newer saved library is open. Import your backup to bring back the edits from this tab.');
  });
}
function openCVIntake() { switchTab('library'); document.querySelector('#import-file').click(); }
document.querySelector('#import-json').addEventListener('click', openCVIntake);
function getDocumentImportUI() {
  if (!documentImportUI) documentImportUI = createDocumentImportUI({ element, field, selectField, sectionTitle, getWorkspace: () => workspace, changeWorkspace, safeAction, announce, switchTab, download, renderPreview, openPreview: showImportPreview, chooseFile: () => document.querySelector('#import-file').click(), isActive: () => activeTab === 'library' });
  return documentImportUI;
}
document.querySelector('#import-file').addEventListener('change', event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (file) void getDocumentImportUI().openFile(file);
});

function openNewCVEditor() {
  switchTab('content');
  document.querySelector('.editor').scrollTop = 0;
  const input = document.querySelector('#profile-name'); input.focus({ preventScroll: true });
  if (matchMedia('(max-width: 700px)').matches) input.scrollIntoView({ block: 'center', behavior: 'auto' });
}
function cancelPendingLocalWork() { portraitGeneration++; documentImportUI?.cancelPending(); writingUI?.cancelPending(); }
function createCV(kind) {
  return safeAction(() => {
    const next = addNewCV(workspace, crypto.randomUUID(), kind);
    cancelPendingLocalWork();
    document.querySelector('#submitted-dialog[open]')?.close();
    const saved = changeWorkspace(next);
    welcomeDismissed = true; openNewCVEditor();
    const message = kind === 'blank' ? 'Your new blank CV is ready.' : 'The example CV is open. Edit it to try the tools.';
    announce(saved ? message : storageConflict
      ? `${message} Another tab saved a newer library. Back up this unsaved CV, then open Library to reload the saved version.`
      : `${message} It hasn’t saved. Download a workspace backup before closing.`, !saved);
  });
}
document.querySelector('#new-cv').addEventListener('click', () => createCV('blank'));
document.querySelector('#load-example').addEventListener('click', () => createCV('example'));
const exportMenu = document.querySelector('#header-export');
document.addEventListener('click', event => { if (!exportMenu.contains(event.target)) exportMenu.open = false; });
exportMenu.addEventListener('keydown', event => { if (event.key === 'Escape') { exportMenu.open = false; exportMenu.querySelector('summary').focus(); } });
for (const button of exportMenu.querySelectorAll('button')) button.addEventListener('click', () => { exportMenu.open = false; exportMenu.querySelector('summary').focus({ preventScroll: true }); });
renderDocumentSwitcher();
renderPanel();
renderPreview();
if (initialNotice) announce(initialNotice, initialNoticeIsError);

function selectField(label, value, id, choices, data = {}) {
  const select = element('select', { id, ...data }, choices.map(([key, text]) => element('option', { value: key, text })));
  select.value = value;
  return element('div', { class: 'field' }, [element('label', { class: 'field-label', for: id, text: label }), select]);
}
function renderCustomSections() {
  const section = element('section', { class: 'form-section' }, [sectionTitle('Add another section', 'PROJECTS, LANGUAGES, AWARDS…')]);
  for (const custom of state.customSections) {
    const card = element('div', { class: 'entry', 'data-custom-section': custom.id }, [
      field('Section heading', custom.title, `custom-${custom.id}-title`, { data: { 'data-custom-field': 'title', 'data-section': custom.id } }),
      field('Content', custom.content, `custom-${custom.id}-content`, { multiline: true, rows: '5', data: { 'data-custom-field': 'content', 'data-section': custom.id }, hint: 'Add your projects, languages, awards or other relevant details.' }),
      element('button', { type: 'button', class: 'text-button', text: 'Remove section', 'data-remove-section': custom.id, onClick: () => safeAction(() => change(removeCustomSection(state, custom.id), true)) })
    ]);
    card.querySelector('textarea').maxLength = 30000;
    card.querySelector('input').maxLength = 100;
    section.append(card);
  }
  section.append(element('button', { type: 'button', class: 'add-button', id: 'add-custom-section', text: '+ Add a custom section', onClick: () => safeAction(() => change(addCustomSection(state, crypto.randomUUID()), true)) }));
  panel.append(section);
}
function renderLayoutControls() {
  const section = element('section', { class: 'form-section' }, [sectionTitle('Type and spacing')]);
  section.append(selectField('Typeface', state.layout.font, 'layout-font', Object.entries(FONT_FAMILIES).map(([key, value]) => [key, value.label]), { 'data-layout': 'font' }));
  const columns = selectField('Columns', state.layout.columns, 'layout-columns', [['1', 'One column'], ['2', 'Two columns']]);
  columns.querySelector('select').addEventListener('change', event => change({ ...state, layout: { ...state.layout, columns: Number(event.target.value) } }, true));
  section.append(columns);
  if (state.layout.columns === 2) section.append(selectField('Column widths', state.layout.columnRatio, 'layout-column-ratio', [['wide-main', 'Wide main column'], ['balanced', 'Equal columns']], { 'data-layout': 'columnRatio' }));
  section.append(selectField('Paper size', state.layout.pageSize, 'layout-page-size', [['A4', 'A4'], ['Letter', 'US Letter']], { 'data-layout': 'pageSize' }));
  for (const [key, label, min, max, step] of [['fontSize', 'Text size', 9, 15, .5], ['lineHeight', 'Line spacing', 1.2, 2.2, .1], ['spacing', 'Section spacing', 8, 28, 1], ['margin', 'Page margins', 20, 60, 1]]) {
    const wrapper = field(label, state.layout[key], `layout-${key}`, { type: 'range', data: { 'data-layout': key, min, max, step } });
    const output = element('output', { for: `layout-${key}`, text: String(state.layout[key]) });
    wrapper.querySelector('input').addEventListener('input', event => { output.textContent = event.target.value; });
    wrapper.append(output); section.append(wrapper);
  }
  section.append(sectionTitle('Add a photo'));
  const upload = element('input', { id: 'photo-upload', type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Upload a portrait photo' });
  upload.addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    event.target.value = '';
    const request = ++portraitGeneration, docId = workspace.activeId, original = JSON.stringify(state);
    let bitmap;
    try {
      bitmap = await decodePortrait(file, { isCurrent: () => request === portraitGeneration && workspace.activeId === docId && JSON.stringify(state) === original });
      if (request !== portraitGeneration) return;
      if (workspace.activeId !== docId || JSON.stringify(state) !== original) { announce('Your CV changed while the photo was loading. Choose the photo again to add it here.', true); return; }
      if (!bitmap) return;
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 240;
      const side = Math.min(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 240, 240);
      const saved = change({ ...state, photo: canvas.toDataURL('image/jpeg', .82) }, true);
      announce(saved ? 'Photo added and cropped to a square. You can remove it below.' : 'The photo hasn’t saved. Download a workspace backup before closing. Check Library if another tab is open.', !saved);
    } catch (error) { if (request === portraitGeneration) announce(error.message, true); }
    finally { bitmap?.close(); }
  });
  section.append(upload, element('p', { class: 'field-hint', text: 'Optional. Check whether CV photos are expected where you’re applying. Your photo is resized in this browser.' }));
  if (state.photo) section.append(element('button', { id: 'remove-photo', class: 'text-button', type: 'button', text: 'Remove portrait', onClick: () => { portraitGeneration++; change({ ...state, photo: '' }, true); } }));
  panel.append(section);
}
function renderSectionControls() {
  const section = element('section', { class: 'form-section' }, [sectionTitle('Your section order'), element('p', { class: 'panel-intro', text: 'Rename, hide or move sections. Hidden content stays in your CV but is excluded from printing and keyword comparison.' })]);
  state.sectionOrder.forEach((id, index) => {
    const custom = state.customSections.find(section => section.id === id);
    const title = custom ? custom.title : state.sectionTitles[id];
    const row = element('div', { class: 'section-order-row', 'data-section-order': id });
    const visibility = element('input', { type: 'checkbox', id: `visible-${id}`, 'aria-label': `Show ${title}` });
    visibility.checked = !state.hiddenSections.includes(id);
    visibility.addEventListener('change', () => change({ ...state, hiddenSections: visibility.checked ? state.hiddenSections.filter(section => section !== id) : [...state.hiddenSections, id] }));
    const name = element('input', { value: title, maxlength: '100', 'aria-label': `Heading for ${title}`, ...(custom ? { 'data-custom-field': 'title', 'data-section': id } : { 'data-section-title': id }) });
    row.append(visibility, name,
      element('button', { type: 'button', class: 'icon-button', text: '↑', 'aria-label': `Move section ${title} up`, disabled: index === 0, 'data-section-up': id, onClick: () => change(moveSection(state, id, -1), true) }),
      element('button', { type: 'button', class: 'icon-button', text: '↓', 'aria-label': `Move section ${title} down`, disabled: index === state.sectionOrder.length - 1, 'data-section-down': id, onClick: () => change(moveSection(state, id, 1), true) }));
    section.append(row);
    if (state.layout.columns === 2) {
      const placement = selectField(`Column for ${title || 'section'}`, sectionPlacement(state, id), `section-column-${id}`, [['main', 'Main'], ['side', 'Side']]);
      placement.classList.add('section-placement');
      placement.querySelector('select').addEventListener('change', event => change({ ...state, sectionColumns: { ...state.sectionColumns, [id]: event.target.value } }));
      section.append(placement);
    }
  });
  panel.append(section);
}
function storageConflictCard() {
  return element('section', { id: 'storage-conflict-card', class: 'recovery-card' }, [
    sectionTitle('Keep both versions of your library'),
    element('p', { class: 'panel-intro', text: 'Another tab saved a newer library. Download a backup of your edits here, then reload the saved version. You can import your backup afterwards to keep both.' }),
    element('div', { class: 'action-row' }, [element('button', { id: 'export-conflict-workspace', type: 'button', class: 'button button-primary', text: 'Download open workspace', onClick: exportWorkspaceBackup }), element('button', { id: 'reload-newer-workspace', type: 'button', class: 'button button-quiet', text: 'Reload newer saved library', onClick: reloadNewerWorkspace })])
  ]);
}
function renderLibrary() {
  panel.append(element('section', { class: 'library-start', 'aria-label': 'Create a CV' }, [
    sectionTitle('Start another CV'),
    element('p', { class: 'panel-intro', text: 'Start a blank CV or try the example. Both add a new CV to your library.' }),
    element('div', { class: 'action-row' }, [
      element('button', { id: 'library-new-cv', type: 'button', class: 'button button-primary', text: '+ New blank CV', onClick: () => createCV('blank') }),
      element('button', { id: 'library-explore-example', type: 'button', class: 'button button-quiet', text: 'Explore example', onClick: () => createCV('example') })
    ])
  ]));
  if (storageConflict) panel.append(storageConflictCard());
  panel.append(sectionTitle('Your CV library', `${workspace.documents.length} / ${MAX_CVS} CVS`));
  if (recoveryPresent) {
    panel.append(element('section', { class: 'recovery-card' }, [sectionTitle('Recover your saved library'), element('p', { class: 'panel-intro', text: recoveryBackedUp ? `We couldn’t read your saved library, so we kept a recovery copy. Download it below. Your open edits can still save.` : 'We couldn’t read your saved library. Download the original below before replacing it. Your open edits haven’t saved yet.' }),
      element('button', { id: 'export-recovery', type: 'button', class: 'button button-primary', text: 'Download original saved library', onClick: () => { download(recoveryRaw, 'application/json', 'json', 'clearcv-unreadable-original'); recoveryDownloaded = true; renderPanel(); } }),
      !recoveryBackedUp ? element('button', { id: 'resume-recovery-save', type: 'button', class: 'button button-quiet', text: 'Replace saved data with open library', disabled: !recoveryDownloaded, onClick: () => { if (window.confirm('Have you kept the downloaded original? This replaces the unreadable saved library with your open CVs.')) { recoveryBackedUp = true; const saved = save(); if (!saved) recoveryBackedUp = false; else { recoveryRaw = ''; recoveryStorageKey = ''; recoveryPresent = false; } renderPanel(); } } }) : null
    ]));
  }
  panel.append(cvNameField('document-name'));
  panel.append(element('div', { class: 'action-row' }, [
    element('button', { id: 'duplicate-cv', type: 'button', class: 'button button-primary', text: 'Duplicate current CV', onClick: () => safeAction(() => changeWorkspace(duplicateDocument(workspace, crypto.randomUUID(), `${activeEntry(workspace).name} copy`.slice(0, 100)))) }),
    element('button', { id: 'blank-cv', type: 'button', class: 'button button-quiet', text: 'New from master', onClick: () => safeAction(() => changeWorkspace(addDocument(workspace, reconcileRichText(workspace.masterDocument, { ...structuredClone(workspace.masterDocument), jobAd: '', coverLetter: createDocument().coverLetter }), crypto.randomUUID(), 'Untitled CV'))) })
  ]));
  const list = element('div', { class: 'document-list' });
  for (const entry of workspace.documents) list.append(element('div', { class: `library-card${entry.id === workspace.activeId ? ' current' : ''}`, 'data-library-id': entry.id }, [
    element('button', { type: 'button', class: 'library-open', text: entry.name, 'data-open-document': entry.id, onClick: () => changeWorkspace({ ...workspace, activeId: entry.id }) }),
    element('span', { class: 'section-caption', text: `${entry.versions.length} snapshots${entry.id === workspace.activeId ? ' · open' : ''}` }),
    element('button', { type: 'button', class: 'icon-button', text: '×', 'aria-label': `Delete CV ${entry.name}`, disabled: workspace.documents.length === 1, 'data-delete-document': entry.id, onClick: () => { if (window.confirm(`Delete “${entry.name}” and its snapshots? Linked job records will be kept without this CV link.`)) safeAction(() => changeWorkspace(deleteDocument(workspace, entry.id))); } })
  ]));
  panel.append(list);
  const master = element('section', { class: 'form-section' }, [sectionTitle('Your master profile'), element('p', { class: 'panel-intro', text: 'Keep your full career history as a master CV. New from master copies its content into a new CV without the job description or cover letter.' }), element('p', { class: 'master-preview', text: `${workspace.masterProfile.name || 'No name yet'} · ${workspace.masterProfile.headline || 'No title yet'}` })]);
  master.append(element('div', { class: 'action-row' }, [
    element('button', { id: 'save-master', type: 'button', class: 'button button-quiet', text: 'Use current CV as master', onClick: () => safeAction(() => { const saved = changeWorkspace({ ...workspace, masterProfile: structuredClone(state.profile), masterDocument: structuredClone(state) }); announce(saved ? 'Master CV updated.' : 'Master profile is open but not saved; export a workspace backup.', !saved); }) }),
    element('button', { id: 'apply-master', type: 'button', class: 'button button-quiet', text: 'Apply master to this CV', onClick: () => { if (window.confirm('Replace the profile fields in this CV with your master profile? Experience, sections and letter will be kept.')) safeAction(() => change({ ...state, profile: structuredClone(workspace.masterProfile) }, true)); } })
  ])); panel.append(master);
  const snapshots = element('section', { class: 'form-section' }, [sectionTitle('Named snapshots', `${activeEntry(workspace).versions.length} / 10`), element('p', { class: 'panel-intro', text: 'Save this CV and letter before making changes. If you restore a snapshot, we also keep a copy of the version you’re replacing.' }), field('Snapshot name', '', 'snapshot-name', { placeholder: 'Before applying to Northstar' })]);
  snapshots.append(element('button', { id: 'save-snapshot', type: 'button', class: 'button button-quiet', text: 'Save snapshot', onClick: () => safeAction(() => changeWorkspace(saveSnapshot(workspace, crypto.randomUUID(), document.querySelector('#snapshot-name').value.trim()))) }));
  for (const version of activeEntry(workspace).versions) snapshots.append(element('div', { class: 'snapshot-row', 'data-snapshot-id': version.id }, [
    element('div', {}, [element('strong', { text: version.name }), element('span', { class: 'section-caption', text: new Date(version.createdAt).toLocaleString('en-GB') })]),
    element('button', { type: 'button', class: 'text-button', text: 'Restore', 'data-restore-snapshot': version.id, onClick: () => safeAction(() => changeWorkspace(restoreSnapshot(workspace, version.id, crypto.randomUUID()))) }),
    element('button', { type: 'button', class: 'icon-button', text: '×', 'aria-label': `Remove snapshot ${version.name}`, onClick: () => safeAction(() => changeWorkspace({ ...workspace, documents: workspace.documents.map(entry => entry.id === workspace.activeId ? { ...entry, versions: entry.versions.filter(snapshot => snapshot.id !== version.id) } : entry) })) })
  ])); panel.append(snapshots);
  panel.append(element('section', { class: 'form-section' }, [sectionTitle('Back up your library'), element('p', { class: 'panel-intro', text: 'Download every CV, snapshot, letter and application in one file. Import a backup to add its CVs to your library.' }), element('button', { id: 'export-workspace', type: 'button', class: 'button button-primary', text: 'Export workspace JSON', onClick: exportWorkspaceBackup })]));
  getDocumentImportUI().render(panel);
  const conflict = panel.querySelector('#storage-conflict-card'); if (conflict) panel.prepend(conflict);
  const start = panel.querySelector('.library-start'); if (start) panel.prepend(start);
}
function renderLetter() {
  panel.append(sectionTitle('Write your cover letter'), element('p', { class: 'panel-intro', text: 'This letter is saved with your current CV. Explain why you want the role and what you would bring to it.' }));
  for (const [key, label, multiline] of [['company', 'Company'], ['role', 'Role'], ['recipient', 'Recipient & address'], ['date', 'Date'], ['subject', 'Subject'], ['salutation', 'Salutation'], ['body', 'Your letter', true], ['closing', 'Closing']]) {
    const wrapper = field(label, state.coverLetter[key], `letter-${key}`, { multiline, rows: '16', data: { 'data-letter': key } });
    if (multiline) wrapper.querySelector('textarea').maxLength = 30000;
    panel.append(wrapper);
  }
  panel.append(element('button', { id: 'draft-letter', type: 'button', class: 'button button-quiet', text: 'Start from my CV', onClick: () => {
    if (state.coverLetter.body.trim() && !window.confirm('Replace your letter with a draft using your current CV? Save a snapshot first if you want to keep this version.')) return;
    const draft = coverLetterDraft(state, state.coverLetter.company, state.coverLetter.role);
    safeAction(() => change({ ...state, coverLetter: { ...state.coverLetter, body: draft.body, salutation: draft.salutation, closing: draft.closing } }, true));
    announce(`Your draft is ready to edit. ${draft.warnings.join(' ')}`);
  } }));
  panel.append(element('p', { class: 'design-note', text: 'This starter uses the summary, experience and skills you’ve already written. It doesn’t use AI. Edit it for this role, then save as PDF, TXT or DOCX while the Letter tab is open.' }));
  renderSavedLetters();
}
function renderLetterPreview(state, preview) {
  const p = state.profile; const letter = state.coverLetter;
  preview.classList.add('letter-paper');
  preview.append(element('header', { class: 'cv-header' }, [element('h1', { class: 'cv-name', text: p.name || 'Your name' }), element('div', { class: 'cv-contact' }, ['email', 'phone', 'location', 'website'].filter(key => p[key].trim()).map(key => contactElement(key, p[key]))) ]));
  if (letter.date) preview.append(element('p', { class: 'letter-date', text: letter.date }));
  if (letter.recipient || letter.company) preview.append(element('p', { class: 'letter-recipient', text: [letter.recipient, letter.company].filter(Boolean).join('\n') }));
  if (letter.subject || letter.role) preview.append(element('h2', { class: 'letter-subject', text: letter.subject || `Application: ${letter.role}` }));
  preview.append(element('p', { text: letter.salutation }), richElement('div', 'letter-body', letter.body, state.richText['coverLetter.body']), element('p', { class: 'letter-closing', text: `${letter.closing}\n${p.name}` }));
}
function showPagePreview() {
  safeAction(() => {
    const doc = validateDocument(state), kind = activeTab === 'letter' ? 'letter' : 'cv';
    const dialog = element('dialog', { id: 'submitted-dialog', class: 'submitted-dialog page-preview-dialog', 'aria-labelledby': 'page-preview-title' });
    const count = element('p', { id: 'page-preview-count', class: 'field-hint', role: 'status', text: 'Arranging pages…' });
    const print = element('button', { id: 'page-preview-print', type: 'button', class: 'button button-primary', text: 'Print / Save as PDF', disabled: true, onClick: () => {
      const previous = document.title; document.title = `${doc.profile.name || 'ClearCV'} — ${kind === 'letter' ? 'Cover letter' : 'CV'}`;
      window.print(); document.title = previous;
    } });
    const controls = element('div', { class: 'submitted-controls' }, [element('h2', { id: 'page-preview-title', text: 'Check your pages' }), count,
      element('p', { class: 'field-hint', text: 'This view uses the selected paper size and keeps entries together where they fit. Turn off browser headers and footers, and check the final print preview.' }),
      element('div', { class: 'action-row' }, [print, element('button', { id: 'page-preview-close', type: 'button', class: 'button button-quiet', text: 'Back to editing', onClick: () => dialog.close() })])
    ]);
    const pages = element('div', { class: 'page-preview-pages', id: 'page-preview-pages' });
    const measure = element('div', { class: 'page-measure', 'aria-hidden': 'true' });
    const source = element('article', { class: 'paper' }); measure.append(source);
    dialog.append(controls, pages, measure); document.body.append(dialog); dialog.showModal();
    renderPreview(doc, kind, source);
    let previewPages = [];
    const fitPages = () => {
      const available = Math.max(180, pages.clientWidth - 32);
      for (const page of previewPages) page.style.zoom = String(Math.min(1, available / Number.parseFloat(page.style.width)));
    };
    dialog.addEventListener('close', () => { window.removeEventListener('resize', fitPages); dialog.remove(); renderPreview(); document.querySelector('#preview-pages')?.focus({ preventScroll: true }); });
    try {
      const result = buildPagePreview(source, pages, doc.layout); previewPages = result.pages;
      count.textContent = `${result.pages.length} ${result.pages.length === 1 ? 'page' : 'pages'} · ${doc.layout.pageSize}${result.warnings.length ? ' · long text continues across pages' : ''}`;
      measure.remove(); fitPages(); window.addEventListener('resize', fitPages);
      document.querySelector('#document-print-style').textContent = `@media print{@page{size:${doc.layout.pageSize};margin:0}}`;
      print.disabled = false;
    } catch (error) {
      pages.replaceChildren(); measure.remove(); count.textContent = error.message;
      controls.append(element('p', { class: 'field-hint', text: 'Go back to editing to shorten the content or use Save as PDF from the header.' }));
    }
    document.querySelector('#page-preview-close').focus();
  });
}
document.querySelector('#preview-pages').addEventListener('click', showPagePreview);
function showImportPreview(candidate, title = 'Preview your imported CV') {
  const doc = validateDocument(candidate);
  const dialog = element('dialog', { id: 'submitted-dialog', class: 'submitted-dialog' });
  const controls = element('div', { class: 'submitted-controls' }, [element('h2', { text: title }), element('p', { class: 'field-hint', text: 'Check the layout before adding this CV to your library. You can also download the draft here. JSON includes hidden content and the pasted job description.' })]);
  controls.append(element('div', { class: 'action-row' }, [element('button', { id: 'import-preview-pdf', type: 'button', class: 'button button-primary', text: 'Save draft as PDF', onClick: () => { setPrintLayout(doc); window.print(); } }), element('button', { id: 'import-preview-txt', type: 'button', class: 'button button-quiet', text: 'TXT', onClick: () => download(plainTextDocument(doc), 'text/plain', 'txt', doc.profile.name || 'reviewed-cv') }), element('button', { id: 'import-preview-docx', type: 'button', class: 'button button-quiet', text: 'DOCX', onClick: () => download(exportDocx(doc), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', doc.profile.name || 'reviewed-cv') }), element('button', { id: 'import-preview-close', type: 'button', class: 'button button-quiet', text: 'Close preview', onClick: () => dialog.close() })]));
  const paper = element('div', { class: 'paper' }); dialog.append(controls, paper); document.body.append(dialog);
  renderPreview(doc, 'cv', paper); setPrintLayout(doc);
  dialog.addEventListener('close', () => { dialog.remove(); renderPreview(); }); dialog.showModal(); document.querySelector('#import-preview-close').focus();
}
function showSubmittedCopy(applicationId, submissionId) {
  const copy = applicationSubmission(workspace, applicationId, submissionId);
  const dialog = element('dialog', { id: 'submitted-dialog', class: 'submitted-dialog', 'aria-labelledby': 'submitted-title' });
  const paper = element('article', { id: 'submitted-preview', class: 'paper' });
  let kind = 'cv';
  const controls = element('div', { class: 'submitted-controls' }, [element('h2', { id: 'submitted-title', text: copy.name }), element('p', { class: 'panel-intro', text: `Saved copy of ${copy.cvName} from ${new Date(copy.submittedAt).toLocaleString('en-GB')}. It stays as it was, even if you change the CV in your library.` })]);
  const views = element('div', { class: 'action-row' });
  function display(selected) {
    kind = selected;
    for (const button of views.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.submissionKind === selected));
    renderPreview(copy.document, kind, paper); setPrintLayout(copy.document);
  }
  for (const [value, label] of [['cv', 'Submitted CV'], ['letter', 'Submitted letter']]) views.append(element('button', { type: 'button', class: 'button button-quiet', 'data-submission-kind': value, id: `submitted-${value}`, text: label, onClick: () => display(value) }));
  const actions = element('div', { class: 'action-row' }, [
    element('button', { id: 'submitted-print', type: 'button', class: 'button button-primary', text: 'Save this copy as PDF', onClick: () => { setPrintLayout(copy.document); const title = document.title; document.title = `${copy.name} — ${kind === 'letter' ? 'submitted letter' : 'submitted CV'}`; window.print(); document.title = title; } }),
    element('button', { id: 'submitted-txt', type: 'button', class: 'button button-quiet', text: 'TXT', onClick: () => download(plainTextDocument(copy.document, kind), 'text/plain;charset=utf-8', 'txt', `${copy.name}-${kind}`) }),
    element('button', { id: 'submitted-docx', type: 'button', class: 'button button-quiet', text: 'DOCX', onClick: () => download(exportDocx(copy.document, { kind }), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', `${copy.name}-${kind}`) }),
    element('button', { id: 'submitted-json', type: 'button', class: 'button button-quiet', text: 'CV + letter JSON', onClick: () => download(serialiseDocument(copy.document), 'application/json', 'json', `${copy.name}-submitted`) }),
    element('button', { id: 'submitted-copy-to-library', type: 'button', class: 'text-button', text: 'Create an editable library copy', onClick: () => safeAction(() => { const saved = changeWorkspace(copySubmissionToLibrary(workspace, applicationId, submissionId, crypto.randomUUID())); dialog.close(); switchTab('content'); announce(saved ? 'An editable copy is in your library. Your submitted copy is still kept.' : 'The editable copy hasn’t saved. Download a workspace backup before closing. Your submitted copy is still kept.', !saved); }) }),
    element('button', { id: 'submitted-close', type: 'button', class: 'text-button', text: 'Close preview', onClick: () => dialog.close() })
  ]);
  controls.append(views, actions, element('p', { class: 'field-hint', text: 'PDF, TXT and DOCX contain the CV or letter shown here. JSON also includes hidden sections and the pasted job description. Keep these files private.' }));
  dialog.append(controls, paper); document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); renderPreview(); });
  display('cv'); dialog.showModal(); document.querySelector('#submitted-close').focus();
}
function reviewLocation(path) {
  const entry = /^(experience|education|skills|customSections)\[(\d+)\]/.exec(path);
  if (entry) {
    const [, collection, number] = entry;
    const item = state[collection][Number(number)];
    const kind = { experience: 'Experience', education: 'Education', skills: 'Skill', customSections: 'Section' }[collection];
    const name = collection === 'skills' ? item?.name : item?.title;
    return `${kind} · ${name || `entry ${Number(number) + 1}`}${item?.organisation ? ` at ${item.organisation}` : ''}`;
  }
  return { 'profile.name': 'Your name', 'profile.email': 'Contact details', 'profile.phone': 'Phone number', 'profile.headline': 'Professional title', 'profile.summary': 'Summary', experience: 'Experience', education: 'Education', document: 'Your CV' }[path] || 'Your CV';
}
function renderReview() {
  const review = reviewCV(state);
  panel.append(sectionTitle('Check your CV'), element('p', { class: 'panel-intro', text: review.method }));
  panel.append(element('div', { class: 'review-metrics', text: `${review.metrics.words} words · ${review.metrics.experienceBullets} experience bullets · ${review.issues.length} suggestions` }));
  for (const issue of review.issues) panel.append(element('article', { class: `review-issue ${issue.severity}`, 'data-rule': issue.ruleId }, [element('h3', { text: issue.message }), element('p', { text: issue.suggestion }), element('span', { class: 'section-caption', text: `${reviewLocation(issue.path)}${issue.evidence ? ` · ${issue.evidence}` : ''}` })]));
  if (!review.issues.length) panel.append(element('p', { class: 'match-empty', text: 'Nothing came up in these checks. Read through your CV once more to check the details.' }));
  const rules = element('details', { class: 'review-rules' }, [element('summary', { text: 'What these checks look for' })]);
  for (const rule of review.rules) rules.append(element('p', { text: rule.description }));
  panel.append(rules);
  if (!writingUI) writingUI = createWritingUI({ element, selectField, sectionTitle, getWorkspace: () => workspace, change, safeAction, announce, isActive: () => activeTab === 'review' });
  writingUI.render(panel);
}
function renderTailoring(container) {
  const suggestions = tailoringSuggestions(state);
  const box = element('section', { class: 'form-section' }, [sectionTitle('Put relevant experience first'), element('p', { class: 'panel-intro', text: suggestions.method })]);
  for (const suggestion of suggestions.suggestions) box.append(element('p', { class: 'tailoring-prompt', text: suggestion.message }));
  const orderChanged = suggestions.experienceOrder.join(',') !== state.experience.map(item => item.id).join(',') || suggestions.skillOrder.join(',') !== state.skills.map(item => item.id).join(',');
  if (orderChanged) box.append(element('button', { id: 'apply-tailoring', type: 'button', class: 'button button-primary', text: 'Create a reordered copy', onClick: () => safeAction(() => {
    const tailored = validateDocument(state);
    tailored.experience = suggestions.experienceOrder.map(id => tailored.experience.find(item => item.id === id));
    tailored.skills = suggestions.skillOrder.map(id => tailored.skills.find(item => item.id === id));
    changeWorkspace(addDocument(workspace, tailored, crypto.randomUUID(), `${activeEntry(workspace).name} tailored`.slice(0, 100)));
    announce('Your reordered copy is ready. The original CV is still in your library.');
  }) }));
  else box.append(element('p', { class: 'match-empty', text: 'Your entries are already in the suggested order. Check the keywords above for anything relevant you want to add.' }));
  container.append(box);
  renderFullTailoring(container);
}
function renderRequirementChecks(container) {
  const checks = jobRequirementChecks(state);
  const section = element('details', { class: 'requirement-checks', id: 'job-requirement-checks' }, [element('summary', { text: `Check the advert line by line · ${checks.requirements.length} lines` }), element('p', { class: 'field-hint', text: checks.method })]);
  for (const requirement of checks.requirements) {
    const card = element('article', { class: 'requirement-row', 'data-requirement-coverage': requirement.coverage }, [
      element('span', { class: 'section-caption', text: { required: 'REQUIRED', preferred: 'PREFERRED', role: 'ROLE DETAILS' }[requirement.type] }),
      element('h3', { text: requirement.text }),
      element('p', { text: requirement.found.length ? `Words in your CV: ${requirement.found.join(', ')}` : 'No shared words found in this line.' })
    ]);
    if (requirement.missing.length) card.append(element('p', { class: 'field-hint', text: `Not mentioned: ${requirement.missing.join(', ')}` }));
    if (requirement.evidence.length) card.append(element('details', {}, [element('summary', { text: 'See the CV wording' }), ...requirement.evidence.map(text => element('blockquote', { text }))]));
    section.append(card);
  }
  if (checks.yearsPrompts.length) section.append(element('p', { class: 'design-note', text: `Check these experience requirements against your dates: ${checks.yearsPrompts.join('; ')}. ClearCV does not infer how many years you qualify for.` }));
  container.append(section);
}
function draftIsCurrent(draft) {
  return draft?.docId === workspace.activeId && draft.currentFingerprint === JSON.stringify(state)
    && draft.masterFingerprint === JSON.stringify(workspace.masterDocument);
}
function renderFullTailoring(container) {
  const section = element('section', { class: 'form-section full-tailoring', id: 'full-tailoring' }, [
    sectionTitle('Make a CV for this job'), element('p', { class: 'panel-intro', text: 'Bring in your career history, put relevant facts first, and review a new CV and letter. Your original stays in your library.' }),
    selectField('Career history to use', 'current', 'tailor-source', [['current', 'Current CV'], ['master', 'Master CV from Library']]),
    field('Company', '', 'tailor-company', { placeholder: 'Where you are applying' }),
    field('Role', '', 'tailor-role', { placeholder: 'The advertised role' })
  ]);
  section.append(element('button', { id: 'prepare-tailored-cv', type: 'button', class: 'button button-primary', text: 'Prepare a draft', onClick: () => safeAction(() => {
    const sourceChoice = document.querySelector('#tailor-source').value;
    const source = sourceChoice === 'master' ? workspace.masterDocument : state;
    const prepared = prepareTailoredCopy(source, state.jobAd, { styleFrom: state, company: document.querySelector('#tailor-company').value, role: document.querySelector('#tailor-role').value });
    tailoringDraft = {
      prepared, docId: workspace.activeId, sourceChoice, currentFingerprint: JSON.stringify(state), masterFingerprint: JSON.stringify(workspace.masterDocument),
      name: `${activeEntry(workspace).name} tailored`.slice(0, 100),
      edits: { summary: prepared.document.profile.summary, headline: prepared.document.profile.headline, company: prepared.document.coverLetter.company, role: prepared.document.coverLetter.role, letter: prepared.document.coverLetter.body },
      entries: new Map(['experience', 'education'].flatMap(collection => prepared.document[collection].map(item => [`${collection}.${item.id}`, { included: !prepared.document.hiddenSections.includes(collection), description: item.description }]))),
      skills: new Set(prepared.document.hiddenSections.includes('skills') ? [] : prepared.document.skills.map(item => item.id))
    };
    renderMatchResults();
    document.querySelector('#tailored-name')?.focus();
    announce('Your draft is ready to review. Nothing has changed in the library yet.');
  }) }));
  container.append(section);
  if (tailoringDraft) renderTailoringReview(container);
}
function reviewedTailoringDocument() {
  const draft = tailoringDraft;
  if (!draftIsCurrent(draft)) throw new Error('Your CV or master changed. Prepare a fresh draft before saving.');
  const edits = { ...draft.edits, skillIds: draft.prepared.document.skills.filter(item => draft.skills.has(item.id)).map(item => item.id) };
  for (const collection of ['experience', 'education']) edits[collection] = draft.prepared.document[collection].filter(item => draft.entries.get(`${collection}.${item.id}`).included)
    .map(item => ({ id: item.id, description: draft.entries.get(`${collection}.${item.id}`).description }));
  return reviewTailoredCopy(draft.prepared.document, edits);
}
function renderTailoringReview(container) {
  const draft = tailoringDraft, doc = draft.prepared.document, current = draftIsCurrent(draft);
  const section = element('section', { id: 'tailored-review', class: 'tailored-review' }, [
    sectionTitle('Review your draft'), element('p', { class: 'panel-intro', text: `From ${draft.sourceChoice === 'master' ? 'your master CV' : 'your current CV'}. Entries and bullet lines are ordered by shared job words. No qualifications or achievements have been invented.` })
  ]);
  if (!current) section.append(element('p', { class: 'recovery-card', text: 'Your CV or master has changed. Prepare a fresh draft to use the latest facts.' }));
  const name = field('Name the new CV', draft.name, 'tailored-name'); name.querySelector('input').maxLength = 100;
  name.querySelector('input').addEventListener('input', event => { event.stopPropagation(); draft.name = event.target.value; }); section.append(name);
  const draftField = (label, key, id, multiline = false) => {
    const wrapper = field(label, draft.edits[key], id, { multiline, rows: multiline ? '6' : undefined });
    const input = wrapper.querySelector('input,textarea');
    if (key === 'letter') input.maxLength = 30000;
    input.addEventListener('input', event => { event.stopPropagation(); draft.edits[key] = event.target.value; });
    return wrapper;
  };
  section.append(draftField('Professional title', 'headline', 'tailored-headline'), draftField('Summary', 'summary', 'tailored-summary', true));
  for (const collection of ['experience', 'education']) {
    const group = element('details', { class: 'tailoring-collection' }, [element('summary', { text: `${collection === 'experience' ? 'Experience' : 'Education'} · choose and edit ${doc[collection].length} entries` })]);
    for (const item of doc[collection]) {
      const record = draft.entries.get(`${collection}.${item.id}`);
      const checkbox = element('input', { id: `tailor-include-${collection}-${item.id}`, type: 'checkbox', 'data-tailor-entry': item.id, 'data-tailor-collection': collection }); checkbox.checked = record.included;
      checkbox.addEventListener('change', () => { record.included = checkbox.checked; });
      const row = element('div', { class: 'tailoring-entry' }, [element('label', { for: checkbox.id, class: 'tailoring-choice' }, [checkbox, element('span', { text: [item.title || 'Untitled entry', item.organisation, item.dates].filter(Boolean).join(' · ') })])]);
      const description = field('Details to include', record.description, `tailored-${collection}-${item.id}`, { multiline: true, rows: '5' });
      description.querySelector('textarea').addEventListener('input', event => { event.stopPropagation(); record.description = event.target.value; });
      row.append(description); group.append(row);
    }
    section.append(group);
  }
  const skills = element('details', { class: 'tailoring-collection' }, [element('summary', { text: `Skills · choose from ${doc.skills.length}` })]);
  for (const item of doc.skills) {
    const checkbox = element('input', { id: `tailor-skill-${item.id}`, type: 'checkbox', 'data-tailor-skill': item.id }); checkbox.checked = draft.skills.has(item.id);
    checkbox.addEventListener('change', () => checkbox.checked ? draft.skills.add(item.id) : draft.skills.delete(item.id));
    skills.append(element('label', { for: checkbox.id, class: 'tailoring-choice' }, [checkbox, element('span', { text: item.name || 'Untitled skill' })]));
  }
  section.append(skills);
  const letter = element('details', { class: 'tailoring-collection' }, [element('summary', { text: 'Cover letter · review the starter' }), draftField('Company', 'company', 'tailored-company'), draftField('Role', 'role', 'tailored-role'), draftField('Letter body', 'letter', 'tailored-letter', true)]);
  section.append(letter, element('p', { class: 'field-hint', text: 'Other sections retain their visibility. Read the preview and letter before sending. This draft uses local rules, without AI.' }));
  section.append(element('div', { class: 'action-row' }, [
    element('button', { id: 'tailored-preview', type: 'button', class: 'button button-quiet', text: 'Preview draft', disabled: !current, onClick: () => safeAction(() => showImportPreview(reviewedTailoringDocument(), 'Preview your tailored CV')) }),
    element('button', { id: 'create-tailored-copy', type: 'button', class: 'button button-primary', text: 'Create reviewed copy', disabled: !current, onClick: () => safeAction(() => {
      const reviewed = reviewedTailoringDocument();
      const next = addDocument(workspace, reviewed, crypto.randomUUID(), draft.name.trim());
      tailoringDraft = null; const saved = changeWorkspace(next); switchTab('content');
      announce(saved ? 'Your new CV and letter are ready. The original is still in Library.' : 'The new copy is open but not saved. Download a workspace backup before closing.', !saved);
    }) }),
    element('button', { id: 'discard-tailored-draft', type: 'button', class: 'text-button', text: 'Discard draft', onClick: () => { tailoringDraft = null; renderMatchResults(); } })
  ]));
  container.append(section);
}
function openJobMatch(application) {
  safeAction(() => {
    const linked = workspace.documents.find(entry => entry.id === application.cvId);
    if (!linked || !application.description.trim()) throw new Error('Link a CV and add the job description first.');
    const linkedDocument = { ...linked.document, jobAd: application.description };
    const next = { ...workspace, activeId: linked.id, documents: workspace.documents.map(entry => entry.id === linked.id ? { ...entry, document: linkedDocument } : entry) };
    tailoringDraft = null; changeWorkspace(next); switchTab('match');
    document.querySelector('#tailor-company').value = application.company;
    document.querySelector('#tailor-role').value = application.role;
    announce('The saved job description is open with its linked CV. Prepare a draft to make a separate copy.');
  });
}
function renderSavedLetters() {
  const section = element('section', { class: 'form-section saved-letters' }, [sectionTitle('Keep a letter to reuse'), element('p', { class: 'panel-intro', text: 'Save the wording separately, then use it with any CV. Check the company and role each time.' }), field('Saved letter name', '', 'saved-letter-name')]);
  section.querySelector('input').maxLength = 100;
  section.append(element('button', { id: 'save-reusable-letter', type: 'button', class: 'button button-quiet', text: 'Save this letter', onClick: () => safeAction(() => {
    const saved = changeWorkspace(saveReusableLetter(workspace, crypto.randomUUID(), document.querySelector('#saved-letter-name').value));
    announce(saved ? 'Letter saved for reuse.' : 'The letter hasn’t saved. Keep a workspace backup before closing.', !saved);
  }) }));
  for (const saved of workspace.letters) section.append(element('div', { class: 'saved-letter-row', 'data-saved-letter': saved.id }, [
    element('strong', { text: saved.name }),
    element('button', { type: 'button', class: 'text-button', text: 'Use letter', 'data-use-letter': saved.id, onClick: () => {
      if (state.coverLetter.body.trim() && !window.confirm('Replace the current letter with this saved wording? The saved letter stays in your collection.')) return;
      safeAction(() => { const written = changeWorkspace(useReusableLetter(workspace, saved.id)); announce(written ? 'Letter added. Check the company and role before sending.' : 'The letter is open but not saved. Keep a workspace backup.', !written); });
    } }),
    element('button', { type: 'button', class: 'icon-button', text: '×', 'aria-label': `Remove saved letter ${saved.name}`, 'data-remove-letter': saved.id, onClick: () => { if (window.confirm(`Remove “${saved.name}” from saved letters? The letter open with your CV is kept.`)) safeAction(() => changeWorkspace(removeReusableLetter(workspace, saved.id))); } })
  ]));
  panel.append(section);
}

document.querySelector('#active-document').addEventListener('change', event => safeAction(() => changeWorkspace({ ...workspace, activeId: event.target.value })));
document.querySelector('#export-txt').addEventListener('click', () => safeAction(() => download(plainTextDocument(state, activeTab === 'letter' ? 'letter' : 'cv'), 'text/plain;charset=utf-8', 'txt', `${activeEntry(workspace).name}${activeTab === 'letter' ? '-letter' : ''}`)));
document.querySelector('#export-docx').addEventListener('click', () => safeAction(() => download(exportDocx(state, { kind: activeTab === 'letter' ? 'letter' : 'cv' }), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', `${activeEntry(workspace).name}${activeTab === 'letter' ? '-letter' : ''}`)));

function aiSource(target = aiTarget) {
  if (target === 'summary') return state.profile.summary;
  if (target === 'letter') return state.coverLetter.body;
  if (target === 'headline') return state.profile.headline;
  if (target === 'practice') return aiTask === 'interview-feedback' ? (practiceRecords.get(workspace.activeId)?.answer || '') : plainTextDocument(state);
  return state.experience.find(item => item.id === target)?.description || '';
}
function documentWithAiText(document, target, text) {
  if (target === 'summary') return validateDocument(reconcileRichText(document, { ...document, profile: { ...document.profile, summary: text } }));
  if (target === 'headline') return validateDocument(reconcileRichText(document, { ...document, profile: { ...document.profile, headline: text } }));
  if (target === 'letter') return validateDocument(reconcileRichText(document, { ...document, coverLetter: { ...document.coverLetter, body: text } }));
  return updateItem(document, 'experience', target, 'description', text);
}
function renderAi() {
  panel.append(sectionTitle('Get help with your wording'), element('p', { class: 'panel-intro', text: 'Choose what you’d like help with. Read and edit the suggestion before adding it to your CV.' }));
  panel.append(element('p', { id: 'ai-status', class: 'design-note', text: aiStatus.enabled ? `Connected to ${aiStatus.model || 'your AI service'}. Generate sends the source text and context below to this service.` : 'AI isn’t connected here. To use it, run ClearCV with your own model service. Review and Job match still work without AI.' }));
  const task = selectField('Writing task', aiTask, 'ai-task', [['summary', 'Improve summary'], ['headline', 'Write a professional headline'], ['objective', 'Write a career objective'], ['bullets', 'Improve experience bullets'], ['tailor', 'Tailor summary to the job'], ['letter', 'Draft a cover letter'], ['translate', 'Translate a selected field'], ['interview', 'Generate interview questions'], ['interview-feedback', 'Review a practice answer']]);
  task.querySelector('select').addEventListener('change', event => {
    aiTask = event.target.value;
    aiTarget = aiTask.startsWith('interview') ? 'practice' : aiTask === 'headline' ? 'headline' : aiTask === 'letter' ? 'letter' : aiTask === 'bullets' ? (state.experience[0]?.id || 'summary') : aiTask === 'translate' ? aiTarget : 'summary';
    renderPanel();
  }); panel.append(task);
  const targets = aiTask.startsWith('interview') ? [['practice', 'Interview practice']] : [['summary', 'CV summary / objective'], ['headline', 'Professional headline'], ['letter', 'Cover letter body'], ...state.experience.map((item, index) => [item.id, `Experience: ${item.title || index + 1}`])];
  const target = selectField('Apply result to', aiTarget, 'ai-target', targets);
  target.querySelector('select').addEventListener('change', event => { aiTarget = event.target.value; renderPanel(); }); panel.append(target);
  const source = field('Text to send', aiSource(), 'ai-source', { multiline: true, rows: '9' });
  source.querySelector('textarea').maxLength = 30000; panel.append(source);
  const contextText = aiTask === 'interview-feedback' ? `Question(s):\n${practiceRecords.get(workspace.activeId)?.questions || ''}\n\nJob context:\n${state.jobAd}` : state.jobAd;
  const context = field('Job or company details to send', contextText, 'ai-context', { multiline: true, rows: '6', hint: 'Remove anything private before sending. Check the result for mistakes.' });
  context.querySelector('textarea').maxLength = 20000; panel.append(context);
  if (aiTask === 'translate') panel.append(field('Target language', 'French', 'ai-language', { placeholder: 'e.g. French' }));
  const generate = element('button', { id: 'ai-generate', type: 'button', class: 'button button-primary', text: aiBusy ? 'Generating…' : 'Generate suggestion', disabled: !aiStatus.enabled || aiBusy });
  generate.addEventListener('click', async () => {
    const content = document.querySelector('#ai-source').value;
    const context = document.querySelector('#ai-context').value;
    const language = document.querySelector('#ai-language')?.value;
    const docId = workspace.activeId; const target = aiTarget; const task = aiTask;
    aiController = new AbortController();
    const controller = aiController;
    if (task === 'interview-feedback') practiceRecords.set(docId, { ...practiceRecords.get(docId), answer: content });
    aiBusy = true; generate.disabled = true; generate.textContent = 'Generating…';
    generate.after(element('button', { id: 'ai-cancel', type: 'button', class: 'button button-quiet', text: 'Cancel request', onClick: () => controller.abort() }));
    try {
      const result = await generateWriting({ task, content, context, ...(language ? { language } : {}) }, { signal: controller.signal });
      if (controller.signal.aborted) throw new Error('Generation cancelled.');
      aiCandidate = { docId, target, task, text: result.text, model: result.model };
      if (activeTab === 'ai') renderPanel();
      announce('Your suggestion is ready. Read and edit it before applying.');
    } catch (error) { announce(controller.signal.aborted ? 'Cancelled. Your CV hasn’t changed.' : error.message, !controller.signal.aborted); }
    finally { aiController = null; aiBusy = false; if (activeTab === 'ai') renderPanel(); }
  }); panel.append(generate);
  if (aiBusy) panel.append(element('button', { id: 'ai-cancel', type: 'button', class: 'button button-quiet', text: 'Cancel request', onClick: () => aiController?.abort() }));
  if (aiCandidate) {
    panel.append(element('section', { class: 'form-section' }, [sectionTitle('Read the suggestion', aiCandidate.model || 'AI SUGGESTION'), field('Suggestion to edit', aiCandidate.text, 'ai-result', { multiline: true, rows: '12' })]));
    panel.querySelector('#ai-result').maxLength = 30000;
    panel.querySelector('#ai-result').addEventListener('input', event => { aiCandidate.text = event.target.value; });
    panel.append(element('button', { id: 'ai-apply', type: 'button', class: 'button button-primary', text: aiCandidate.target === 'practice' ? 'Keep practice notes' : aiCandidate.task === 'tailor' ? 'Apply to a new tailored CV' : 'Use this text', disabled: aiCandidate.docId !== workspace.activeId, onClick: () => safeAction(() => {
      if (aiCandidate.target === 'practice') {
        const key = aiCandidate.task === 'interview-feedback' ? 'feedback' : 'questions';
        practiceRecords.set(workspace.activeId, { ...practiceRecords.get(workspace.activeId), [key]: aiCandidate.text });
        aiCandidate = null; renderPanel(); announce('Practice notes kept in this tab. Download them before closing.'); return;
      }
      const oldValue = aiSource(aiCandidate.target);
      const nextDoc = documentWithAiText(state, aiCandidate.target, aiCandidate.text);
      if (aiCandidate.task === 'tailor') changeWorkspace(addDocument(workspace, nextDoc, crypto.randomUUID(), `${activeEntry(workspace).name} AI tailored`.slice(0, 100)));
      else change(nextDoc, true);
      aiUndo = { docId: workspace.activeId, target: aiCandidate.target, oldValue, newValue: aiCandidate.text };
      aiCandidate = null; renderPanel();
      announce('Text added. You can undo this change while the page is open.');
    }) }));
    if (aiCandidate.docId !== workspace.activeId) panel.append(element('p', { class: 'match-empty', text: 'This suggestion is for another CV. Open that CV to use it.' }));
  }
  const practice = practiceRecords.get(workspace.activeId);
  if (practice && (practice.questions || practice.feedback)) {
    const notes = element('section', { class: 'form-section' }, [sectionTitle('Your practice notebook'), element('p', { class: 'panel-intro', text: 'Download these notes before closing the tab. Treat the AI feedback as suggestions for your practice.' })]);
    if (practice.questions) notes.append(element('p', { class: 'practice-text', text: practice.questions }));
    if (practice.feedback) notes.append(element('p', { class: 'practice-text', text: practice.feedback }));
    notes.append(element('button', { id: 'export-practice', type: 'button', class: 'button button-quiet', text: 'Export practice TXT', onClick: () => download([practice.questions, practice.answer, practice.feedback].filter(Boolean).join('\n\n'), 'text/plain;charset=utf-8', 'txt', `${activeEntry(workspace).name}-interview`) }));
    panel.append(notes);
  }
  if (aiUndo?.docId === workspace.activeId) panel.append(element('button', { id: 'ai-undo', type: 'button', class: 'button button-quiet', text: 'Undo last AI change', onClick: () => safeAction(() => {
    if (aiSource(aiUndo.target) !== aiUndo.newValue && !window.confirm('You’ve edited this field since using the AI text. Restore the earlier wording?')) return;
    change(documentWithAiText(state, aiUndo.target, aiUndo.oldValue), true);
    aiUndo = null; renderPanel(); announce('Previous field text restored.');
  }) }));
}
// GitHub Pages is a static release: skip unavailable API requests there entirely.
if (!location.hostname.endsWith('.github.io')) getAiStatus().then(status => { aiStatus = status; if (activeTab === 'ai') renderPanel(); });

function renderCloud() {
  if (cloudUI) cloudUI.render(panel);
  else panel.append(sectionTitle('Shared CVs'), element('p', { class: 'design-note', text: 'Sharing isn’t connected here. You can download a workspace backup in Library.' }));
}

cloudUI = createCloudUI({
  element, field, sectionTitle, notify: announce,
  getDocument: () => validateDocument(state), getLocalId: () => workspace.activeId, getName: () => activeEntry(workspace).name,
  addLocalDocument: (document, name) => {
    changeWorkspace(addDocument(workspace, document, crypto.randomUUID(), name.slice(0, 100)));
    return workspace.activeId;
  },
  replaceLocalDocument: (document, reason) => {
    const preserved = saveSnapshot(workspace, crypto.randomUUID(), reason);
    changeWorkspace(updateActiveDocument(preserved, document));
  },
  rerender: () => { if (activeTab === 'cloud') renderPanel(); }
});
void cloudUI.initialise();

// Original stroke icons keep workspace tools visually consistent across platforms.
function workspaceIcon(name) {
  const paths = {
    content: ['M5 19h4l11-11-4-4L5 15v4Z', 'm14 6 4 4', 'M4 21h16'],
    design: ['M5 3h14v18H5z', 'M5 9h14', 'M10 9v12'],
    match: ['M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z', 'm14.5 14.5 5 5', 'm7 10 2 2 4-4'],
    library: ['M4 6h16v15H4z', 'M7 3h10', 'M8 10h8', 'M8 14h8', 'M8 18h5'],
    letter: ['M3 6h18v13H3z', 'm3 6 9 7 9-7'],
    jobs: ['M4 6h16v15H4z', 'M8 6V3h8v3', 'M4 12h16', 'M10 12v3h4v-3'],
    review: ['M5 3h10l4 4v14H5z', 'M15 3v5h4', 'm8 14 3 3 5-6'],
    ai: ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z', 'M19 3v4', 'M17 5h4'],
    cloud: ['M4 8h15', 'm16 5 3 3-3 3', 'M20 16H5', 'm8 13-3 3 3 3'],
    preview: ['M5 3h14v18H5z', 'M8 7h8', 'M8 11h8', 'M8 15h5'],
    chevron: ['m9 6 6 6-6 6']
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  for (const path of paths[name] || paths.content) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path'); node.setAttribute('d', path); svg.append(node);
  }
  return svg;
}
for (const button of document.querySelectorAll('.rail-button')) {
  const label = [...button.children].findLast(child => child.tagName === 'SPAN')?.textContent || button.title;
  button.replaceChildren(workspaceIcon(button.dataset.tab), element('span', { text: label }));
}
const localSymbol = document.querySelector('.local-symbol');
if (localSymbol) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2'); svg.append(path); localSymbol.replaceChildren(svg);
}
const workspaceNode = document.querySelector('.workspace');
let editorScrollPosition = 0;
workspaceNode.dataset.mobileView = 'edit';
const mobileViews = element('div', { class: 'mobile-view-switch', role: 'group', 'aria-label': 'Mobile workspace view' });
for (const [view, label, icon] of [['edit', 'Edit CV', 'content'], ['preview', 'Preview', 'preview']]) {
  mobileViews.append(element('button', { id: `mobile-${view}`, type: 'button', 'aria-pressed': String(view === 'edit'), onClick: () => {
    if (view === 'preview') editorScrollPosition = window.scrollY;
    workspaceNode.dataset.mobileView = view;
    for (const button of mobileViews.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.id === `mobile-${view}`));
    scrollMobileWorkspace(view === 'preview' ? 0 : editorScrollPosition);
  } }, [workspaceIcon(icon), element('span', { text: label })]));
}
workspaceNode.prepend(mobileViews);

// Make the remaining horizontally scrollable navigation visibly navigable.
const editorTabs = document.querySelector('.editor-tabs');
const tabNavigation = element('div', { class: 'editor-tabs-wrap' });
editorTabs.before(tabNavigation); tabNavigation.append(editorTabs);
const moreTabs = element('button', { id: 'editor-more-views', type: 'button', class: 'more-views', 'aria-label': 'Scroll to more editor views', onClick: () => {
  const atEnd = editorTabs.scrollLeft + editorTabs.clientWidth >= editorTabs.scrollWidth - 4;
  editorTabs.scrollTo({ left: atEnd ? 0 : editorTabs.scrollLeft + 210, behavior: 'smooth' });
} }, [workspaceIcon('chevron')]);
tabNavigation.append(moreTabs);
function updateTabOverflow() {
  moreTabs.hidden = editorTabs.scrollWidth <= editorTabs.clientWidth + 4;
  moreTabs.classList.toggle('at-end', editorTabs.scrollLeft + editorTabs.clientWidth >= editorTabs.scrollWidth - 4);
}
editorTabs.addEventListener('scroll', updateTabOverflow);
let tabResizeFrame = 0;
window.addEventListener('resize', () => {
  if (tabResizeFrame) return;
  tabResizeFrame = requestAnimationFrame(() => {
    tabResizeFrame = 0;
    updateTabOverflow();
    const selected = editorTabs.querySelector('[aria-selected="true"]');
    if (selected && editorTabs.clientWidth) {
      const bounds = editorTabs.getBoundingClientRect();
      const tabBounds = selected.getBoundingClientRect();
      const delta = tabBounds.left < bounds.left ? tabBounds.left - bounds.left : tabBounds.right > bounds.right ? tabBounds.right - bounds.right : 0;
      // Reveal horizontally without changing the page position or keyboard focus.
      if (delta) editorTabs.scrollLeft = Math.max(0, Math.min(editorTabs.scrollWidth - editorTabs.clientWidth, editorTabs.scrollLeft + delta));
    }
    updateTabOverflow();
  });
});
requestAnimationFrame(updateTabOverflow);

// Keep the sticky header, rail and phone view switch clear of one another as
// controls wrap. This changes layout only; it never changes focus or CV state.
function updateHeaderHeight() {
  const height = document.querySelector('.app-header').getBoundingClientRect().height;
  if (height > 0) document.documentElement.style.setProperty('--app-header-height', `${Math.ceil(height)}px`);
}
new ResizeObserver(updateHeaderHeight).observe(document.querySelector('.app-header'));
requestAnimationFrame(updateHeaderHeight);

function contactElement(kind, text) {
  const href = safeContactHref(kind, text);
  return href ? element('a', { href, text, ...(kind === 'website' ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }) : element('span', { text });
}

window.addEventListener('storage', event => {
  if (event.storageArea !== localStorage || event.key !== STORAGE_KEY) return;
  try {
    if (localStorage.getItem(STORAGE_KEY) === savedWorkspaceBaseline) return;
    storageConflict = true;
    document.querySelector('#save-status').textContent = 'Another tab saved · back up your edits';
    announce('Another tab saved a newer library. Back up your edits here, then open Library to reload the saved version.', true);
    if (activeTab === 'library' && !panel.querySelector('#storage-conflict-card')) panel.prepend(storageConflictCard());
  } catch {
    document.querySelector('#save-status').textContent = 'Not saved · export a backup';
    announce('This browser couldn’t check your saved library. Download a workspace backup before closing.', true);
  }
});
