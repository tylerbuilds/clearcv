import { sampleDocument, createDocument, validateDocument, parseDocument, serialiseDocument, addItem, updateItem, moveItem, removeItem, keywordFeedback, ACCENTS, addCustomSection, removeCustomSection, moveSection, plainTextDocument } from './model.js';

import { createWorkspace, validateWorkspace, serialiseWorkspace, parseWorkspace, parseImport, activeEntry, updateActiveDocument, addDocument, duplicateDocument, deleteDocument, saveSnapshot, restoreSnapshot, addApplication, updateApplication, mergeWorkspace, JOB_STATUSES } from './workspace.js';
import { reviewCV, tailoringSuggestions, coverLetterDraft } from './review.js';
import { exportDocx } from './formats.js';
import { createDocumentImportUI } from './import-ui.js';
import { createWritingUI } from './writing-ui.js';
import { getAiStatus, generateWriting } from './ai-client.js';
import { createCloudUI } from './cloud-ui.js';
import { safeContactHref } from './links.js';
import { createJobsUI } from './jobs-ui.js';
import { applicationSubmission, copySubmissionToLibrary } from './workspace.js';
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
let recoveryRaw = '';
let recoveryBackedUp = false;
let recoveryDownloaded = false;
let recoveryStorageKey = '';

let activeTab = 'content';
let noticeTimer;
let pendingReset = 'blank';
let initialNotice = '';
let initialNoticeIsError = false;
let state;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  rawWorkspace = saved;
  if (saved) workspace = parseWorkspace(saved);
  else {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    const doc = legacy ? parseDocument(legacy) : sampleDocument();
    workspace = createWorkspace(doc, 'initial-cv', legacy ? 'Migrated CV' : 'My CV');
    localStorage.setItem(STORAGE_KEY, serialiseWorkspace(workspace));
    if (legacy) initialNotice = 'Your previous CV is now in your library. Its original saved copy has been kept.';
  }
} catch (error) {
  if (rawWorkspace) {
    recoveryRaw = rawWorkspace;
    recoveryStorageKey = `${STORAGE_KEY}.recovery.${Date.now()}`;
    try { localStorage.setItem(recoveryStorageKey, recoveryRaw); recoveryBackedUp = true; }
    catch { recoveryBackedUp = false; }
  }
  if (!workspace) {
    try { workspace = createWorkspace(parseDocument(localStorage.getItem(LEGACY_STORAGE_KEY)), 'recovered-cv', 'Recovered CV'); }
    catch { workspace = createWorkspace(sampleDocument()); }
  }
  initialNoticeIsError = true;
  initialNotice = `The saved workspace could not be read or saved: ${error.message} The original unreadable workspace is ${recoveryBackedUp ? 'kept in a separate recovery copy' : 'protected from replacement; saving is locked'}. Open Library to export recovery data and a backup of the open library.`;
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
  if (recoveryRaw && !recoveryBackedUp) {
    document.querySelector('#save-status').textContent = 'Recovery locked · export originals';
    announce('The original saved workspace is unreadable and protected. Open Library to download recovery data before explicitly replacing it. Current edits remain open.', true);
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, serialiseWorkspace(workspace));
    document.querySelector('#save-status').textContent = 'Saved on this device';
    return true;
  } catch {
    document.querySelector('#save-status').textContent = 'Not saved · export a backup';
    announce('Your changes are open, but this browser could not save them. Export a JSON backup before closing this page.', true);
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
function change(next, rerender = false) { return changeWorkspace(updateActiveDocument(workspace, next), rerender); }
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
function renderContent() {
  panel.append(element('button', { id: 'improve-existing-cv', type: 'button', class: 'button button-quiet improve-existing', text: 'Improve an existing CV', onClick: () => switchTab('library') }));
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
  panel.append(field('A little about you', state.profile.summary, 'profile-summary', { multiline: true, rows: '5', placeholder: 'Bring your experience, strengths and ambitions together.', data: { 'data-profile': 'summary' }, hint: 'A few clear sentences are all you need. Make them your own.' }));
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
  panel.append(sectionTitle('Find your look', 'MADE TO FEEL LIKE YOU'));
  panel.append(element('p', { class: 'panel-intro', text: 'Three thoughtful layouts. One clear story. Choose a starting point and make it yours.' }));
  const grid = element('div', { class: 'template-grid' });
  for (const [template, name] of [['studio', 'Studio'], ['classic', 'Editorial'], ['compact', 'Concise']]) {
    const thumbnail = element('span', { class: `template-thumbnail mini-${template}`, 'aria-hidden': 'true' }, [element('span', { class: 'mini-title' }), element('span', { class: 'mini-accent' })]);
    for (let i = 0; i < 10; i++) thumbnail.append(element('span', { class: `mini-line${i % 4 === 3 ? ' short' : ''}` }));
    grid.append(element('button', { id: `template-${template}`, type: 'button', class: 'template-option', 'aria-pressed': String(state.style.template === template), 'aria-label': `${name} template`, onClick: () => change({ ...state, style: { ...state.style, template } }, true) }, [thumbnail, element('span', { text: name })]));
  }
  panel.append(grid);
  panel.append(sectionTitle('A touch of colour'));
  panel.append(element('p', { class: 'panel-intro', text: 'A quiet accent brings the details together.' }));
  const colours = ['Terracotta', 'Forest', 'Slate blue', 'Plum', 'Charcoal'];
  const swatches = element('div', { class: 'swatches', role: 'group', 'aria-label': 'Accent colour' });
  ACCENTS.forEach((accent, index) => {
    const button = element('button', { type: 'button', class: 'swatch', 'aria-label': colours[index], 'aria-pressed': String(state.style.accent.toLowerCase() === accent), onClick: () => change({ ...state, style: { ...state.style, accent } }, true) });
    button.style.setProperty('--swatch', accent);
    swatches.append(button);
  });
  panel.append(swatches);
  renderLayoutControls();
  renderSectionControls();
  panel.append(element('p', { class: 'design-note', text: 'A4, with room to breathe. Save as PDF opens your browser’s print dialogue. Choose “Save as PDF”, use A4 paper and turn off browser headers and footers. Longer CVs flow onto another page.' }));
}
function renderMatch() {
  panel.append(sectionTitle('Make the connection', 'A SECOND PAIR OF EYES'));
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
    container.append(element('p', { class: 'match-empty', text: 'Add a job description to compare keywords. This is a simple word comparison, not an ATS score or a hiring prediction.' }));
    return;
  }
  const card = element('div', { class: 'match-card' }, [
    element('span', { id: 'match-percentage', class: 'match-count', text: `${feedback.percentage}%` }),
    element('span', { class: 'match-card-title', text: 'keyword overlap' }),
    element('p', { class: 'match-caption', text: `${feedback.found.length} of ${feedback.keywords.length} selected words appear in your CV. We compare up to 24 frequent words, ignore common words, and match whole words without guessing meaning. This is not an ATS score.` })
  ]);
  for (const [words, heading, missing] of [[feedback.found, 'Already in your CV', false], [feedback.missing, 'Worth considering — if accurate', true]]) {
    card.append(element('h3', { class: 'keyword-heading', text: heading }));
    const chips = element('div', { class: 'keyword-chips', 'data-keyword-group': missing ? 'missing' : 'found' });
    for (const word of words) chips.append(element('span', { class: `keyword-chip${missing ? ' missing' : ''}`, text: word }));
    if (!words.length) chips.append(element('span', { class: 'match-empty', text: missing ? 'All selected words are present.' : 'No selected words appear yet.' }));
    card.append(chips);
  }
  card.append(element('p', { class: 'match-caption', text: 'Only include skills and experience you really have. A missing word may be irrelevant; a matching word does not prove suitability.' }));
  container.append(card);
  renderTailoring(container);
}
function renderPanel() {
  panel.replaceChildren();
  panel.setAttribute('aria-labelledby', `tab-${activeTab}`);
  if (activeTab === 'content') renderContent();
  else if (activeTab === 'design') renderDesign();
  else if (activeTab === 'match') renderMatch();
  else if (activeTab === 'library') renderLibrary();
  else if (activeTab === 'letter') renderLetter();
  else if (activeTab === 'jobs') {
    if (!jobsUI) jobsUI = createJobsUI({ element, field, selectField, sectionTitle, getWorkspace: () => workspace, changeWorkspace, safeAction, announce, switchTab, download, openSubmission: showSubmittedCopy });
    jobsUI.render(panel);
  }
  else if (activeTab === 'review') renderReview();
  else if (activeTab === 'ai') renderAi();
  else renderCloud();
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
  for (const [key, value] of Object.entries({ 'font-size': `${state.layout.fontSize}px`, 'line-height': state.layout.lineHeight, 'spacing': `${state.layout.spacing}px`, 'margin': `${state.layout.margin}px`, 'font': {sans:'ui-sans-serif, system-ui, sans-serif',serif:'Georgia, serif',mono:'ui-monospace, monospace'}[state.layout.font] })) preview.style.setProperty(`--cv-${key}`, value);
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
  if (profile.summary.trim()) preview.append(element('section', { class: 'cv-section', 'data-preview-section': 'profile' }, [element('h2', { text: state.sectionTitles.profile }), element('p', { class: 'cv-summary', text: profile.summary })]));
  for (const [collection, title] of [['experience', 'Experience'], ['education', 'Education']]) {
    if (!state[collection].length) continue;
    const section = element('section', { class: 'cv-section', 'data-preview-section': collection }, [element('h2', { text: state.sectionTitles[collection] })]);
    for (const item of state[collection]) {
      const entry = element('div', { class: 'cv-entry', 'data-preview-entry': item.id }, [element('div', { class: 'cv-entry-head' }, [
        element('h3', { text: item.title || (collection === 'experience' ? 'Role title' : 'Qualification'), class: item.title ? '' : 'cv-placeholder' }),
        item.dates ? element('span', { class: 'cv-dates', text: item.dates }) : null
      ])]);
      if (item.organisation || item.location) entry.append(element('div', { class: 'cv-organisation', text: item.organisation }, [item.location ? element('span', { text: item.location }) : null]));
      const lines = item.description.split('\n').map(line => line.trim().replace(/^[-*•]\s+/, '')).filter(Boolean);
      if (lines.length) entry.append(element('ul', { class: 'cv-bullets' }, lines.map(line => element('li', { text: line }))));
      section.append(entry);
    }
    preview.append(section);
  }
  const skills = state.skills.filter(item => item.name.trim());
  if (skills.length) preview.append(element('section', { class: 'cv-section', 'data-preview-section': 'skills' }, [element('h2', { text: state.sectionTitles.skills }), element('div', { class: 'cv-skills' }, skills.map(item => element('span', { class: 'cv-skill', text: item.name })))]));
  for (const section of state.customSections) if (section.content.trim()) preview.append(element('section', { class: 'cv-section', 'data-preview-section': section.id }, [element('h2', { text: section.title }), element('p', { class: 'cv-summary', text: section.content })]));
  const rendered = new Map([...preview.querySelectorAll('[data-preview-section]')].map(section => [section.dataset.previewSection, section]));
  for (const id of state.sectionOrder) {
    const section = rendered.get(id);
    if (!section) continue;
    if (state.hiddenSections.includes(id)) section.remove();
    else preview.append(section);
  }
}
function switchTab(tab, focus = false) {
  const workspace = document.querySelector('.workspace');
  if (workspace.dataset.mobileView === 'preview') {
    workspace.dataset.mobileView = 'edit';
    document.querySelector('#mobile-edit')?.setAttribute('aria-pressed', 'true');
    document.querySelector('#mobile-preview')?.setAttribute('aria-pressed', 'false');
    if (matchMedia('(max-width: 700px)').matches) requestAnimationFrame(() => window.scrollTo({ top: workspace.offsetTop, behavior: 'auto' }));
  }
  activeTab = tab;
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
    else if (input.id === 'document-name') {
      if (input.value.trim()) changeWorkspace({ ...workspace, documents: workspace.documents.map(entry => entry.id === workspace.activeId ? { ...entry, name: input.value } : entry) }, false);
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
  announce('JSON backup downloaded. It contains your CV and job description; keep it somewhere you trust.');
}));
document.querySelector('#import-json').addEventListener('click', () => document.querySelector('#import-file').click());
function getDocumentImportUI() {
  if (!documentImportUI) documentImportUI = createDocumentImportUI({ element, field, selectField, sectionTitle, getWorkspace: () => workspace, changeWorkspace, safeAction, announce, switchTab, download, renderPreview, openPreview: showImportPreview, chooseFile: () => document.querySelector('#import-file').click(), isActive: () => activeTab === 'library' });
  return documentImportUI;
}
document.querySelector('#import-file').addEventListener('change', event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (file) void getDocumentImportUI().openFile(file);
});

function requestReset(kind) {
  pendingReset = kind;
  document.querySelector('#reset-title').textContent = kind === 'blank' ? 'A fresh start?' : 'Open the example?';
  document.querySelector('#reset-confirm').textContent = kind === 'blank' ? 'Start a blank CV' : 'Load example';
  document.querySelector('#reset-dialog').showModal();
}
document.querySelector('#new-cv').addEventListener('click', () => requestReset('blank'));
document.querySelector('#load-example').addEventListener('click', () => requestReset('example'));
document.querySelector('#reset-dialog').addEventListener('close', event => {
  if (event.target.returnValue !== 'confirm') return;
  const saved = changeWorkspace(addDocument(workspace, pendingReset === 'blank' ? createDocument() : sampleDocument(), crypto.randomUUID(), pendingReset === 'blank' ? 'Untitled CV' : 'Example CV'));
  switchTab('content');
  document.querySelector('#profile-name').focus();
  const message = pendingReset === 'blank' ? 'A fresh CV is ready for your story.' : 'The example CV is ready to explore.';
  announce(saved ? message : `${message} This browser could not save it; export a JSON backup before closing.`, !saved);
});
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
  const section = element('section', { class: 'form-section' }, [sectionTitle('Make room for more', 'PROJECTS, LANGUAGES, AWARDS…')]);
  for (const custom of state.customSections) {
    const card = element('div', { class: 'entry', 'data-custom-section': custom.id }, [
      field('Section heading', custom.title, `custom-${custom.id}-title`, { data: { 'data-custom-field': 'title', 'data-section': custom.id } }),
      field('Content', custom.content, `custom-${custom.id}-content`, { multiline: true, rows: '5', data: { 'data-custom-field': 'content', 'data-section': custom.id }, hint: 'Write paragraphs, links as text or a list of achievements.' }),
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
  const section = element('section', { class: 'form-section' }, [sectionTitle('Type & space')]);
  section.append(selectField('Typeface', state.layout.font, 'layout-font', [['sans', 'Modern sans'], ['serif', 'Editorial serif'], ['mono', 'Monospace']], { 'data-layout': 'font' }));
  section.append(selectField('Paper size', state.layout.pageSize, 'layout-page-size', [['A4', 'A4'], ['Letter', 'US Letter']], { 'data-layout': 'pageSize' }));
  for (const [key, label, min, max, step] of [['fontSize', 'Text size', 9, 15, .5], ['lineHeight', 'Line spacing', 1.2, 2.2, .1], ['spacing', 'Section spacing', 8, 28, 1], ['margin', 'Page margins', 20, 60, 1]]) {
    const wrapper = field(label, state.layout[key], `layout-${key}`, { type: 'range', data: { 'data-layout': key, min, max, step } });
    const output = element('output', { for: `layout-${key}`, text: String(state.layout[key]) });
    wrapper.querySelector('input').addEventListener('input', event => { output.textContent = event.target.value; });
    wrapper.append(output); section.append(wrapper);
  }
  section.append(sectionTitle('A personal touch'));
  const upload = element('input', { id: 'photo-upload', type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Upload a portrait photo' });
  upload.addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5_000_000) throw new Error('Choose a PNG, JPEG or WebP photo smaller than 5 MB.');
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 240;
      const side = Math.min(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 240, 240);
      bitmap.close();
      change({ ...state, photo: canvas.toDataURL('image/jpeg', .82) }, true);
      announce('Portrait cropped to a square and stored locally. You can remove it at any time.');
    } catch (error) { announce(error.message, true); }
  });
  section.append(upload, element('p', { class: 'field-hint', text: 'Optional. Consider whether a photo is appropriate for the role and country. Images are resized locally.' }));
  if (state.photo) section.append(element('button', { id: 'remove-photo', class: 'text-button', type: 'button', text: 'Remove portrait', onClick: () => change({ ...state, photo: '' }, true) }));
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
  });
  panel.append(section);
}
function renderLibrary() {
  panel.append(sectionTitle('A CV for every chapter', `${workspace.documents.length} / 25 LOCAL CVS`));
  if (recoveryRaw) {
    panel.append(element('section', { class: 'recovery-card' }, [sectionTitle('Keep your original saved data'), element('p', { class: 'panel-intro', text: recoveryBackedUp ? `An unreadable workspace was retained at ${recoveryStorageKey}. Download its original bytes for recovery; current editing can save safely.` : 'The unreadable saved workspace is protected from replacement. Download its original bytes first; your open edits are not yet saved.' }),
      element('button', { id: 'export-recovery', type: 'button', class: 'button button-primary', text: 'Download original recovery JSON', onClick: () => { download(recoveryRaw, 'application/json', 'json', 'clearcv-unreadable-original'); recoveryDownloaded = true; renderPanel(); } }),
      !recoveryBackedUp ? element('button', { id: 'resume-recovery-save', type: 'button', class: 'button button-quiet', text: 'Replace saved data with open library', disabled: !recoveryDownloaded, onClick: () => { if (window.confirm('Have you kept the downloaded original? This explicitly replaces the unreadable saved workspace with the open library.')) { recoveryBackedUp = true; const saved = save(); if (!saved) recoveryBackedUp = false; else { recoveryRaw = ''; recoveryStorageKey = ''; } renderPanel(); } } }) : null
    ]));
  }
  const name = field('Current CV name', activeEntry(workspace).name, 'document-name');
  name.querySelector('input').maxLength = 100; panel.append(name);
  panel.append(element('div', { class: 'action-row' }, [
    element('button', { id: 'duplicate-cv', type: 'button', class: 'button button-primary', text: 'Duplicate current CV', onClick: () => safeAction(() => changeWorkspace(duplicateDocument(workspace, crypto.randomUUID(), `${activeEntry(workspace).name} copy`.slice(0, 100)))) }),
    element('button', { id: 'blank-cv', type: 'button', class: 'button button-quiet', text: 'New from master', onClick: () => safeAction(() => changeWorkspace(addDocument(workspace, { ...structuredClone(workspace.masterDocument), jobAd: '', coverLetter: createDocument().coverLetter }, crypto.randomUUID(), 'Untitled CV'))) })
  ]));
  const list = element('div', { class: 'document-list' });
  for (const entry of workspace.documents) list.append(element('div', { class: `library-card${entry.id === workspace.activeId ? ' current' : ''}`, 'data-library-id': entry.id }, [
    element('button', { type: 'button', class: 'library-open', text: entry.name, 'data-open-document': entry.id, onClick: () => changeWorkspace({ ...workspace, activeId: entry.id }) }),
    element('span', { class: 'section-caption', text: `${entry.versions.length} snapshots${entry.id === workspace.activeId ? ' · open' : ''}` }),
    element('button', { type: 'button', class: 'icon-button', text: '×', 'aria-label': `Delete CV ${entry.name}`, disabled: workspace.documents.length === 1, 'data-delete-document': entry.id, onClick: () => { if (window.confirm(`Delete “${entry.name}” and its snapshots? Linked job records will be kept without this CV link.`)) safeAction(() => changeWorkspace(deleteDocument(workspace, entry.id))); } })
  ]));
  panel.append(list);
  const master = element('section', { class: 'form-section' }, [sectionTitle('Your master profile'), element('p', { class: 'panel-intro', text: 'Keep a complete career CV: profile, experience, education, skills and custom sections. New CVs start from this master without its job description or letter; existing tailored CVs stay independent.' }), element('p', { class: 'master-preview', text: `${workspace.masterProfile.name || 'No name yet'} · ${workspace.masterProfile.headline || 'No title yet'}` })]);
  master.append(element('div', { class: 'action-row' }, [
    element('button', { id: 'save-master', type: 'button', class: 'button button-quiet', text: 'Use current CV as master', onClick: () => safeAction(() => { const saved = changeWorkspace({ ...workspace, masterProfile: structuredClone(state.profile), masterDocument: structuredClone(state) }); announce(saved ? 'Master CV updated. Your other CVs have been kept.' : 'Master profile is open but not saved; export a workspace backup.', !saved); }) }),
    element('button', { id: 'apply-master', type: 'button', class: 'button button-quiet', text: 'Apply master to this CV', onClick: () => { if (window.confirm('Replace the profile fields in this CV with your master profile? Experience, sections and letter will be kept.')) safeAction(() => change({ ...state, profile: structuredClone(workspace.masterProfile) }, true)); } })
  ])); panel.append(master);
  const snapshots = element('section', { class: 'form-section' }, [sectionTitle('Named snapshots', `${activeEntry(workspace).versions.length} / 10`), element('p', { class: 'panel-intro', text: 'Freeze this CV and its cover letter before a change or application. Restoring also keeps a recovery snapshot of the current version.' }), field('Snapshot name', '', 'snapshot-name', { placeholder: 'Before applying to Northstar' })]);
  snapshots.append(element('button', { id: 'save-snapshot', type: 'button', class: 'button button-quiet', text: 'Save snapshot', onClick: () => safeAction(() => changeWorkspace(saveSnapshot(workspace, crypto.randomUUID(), document.querySelector('#snapshot-name').value.trim()))) }));
  for (const version of activeEntry(workspace).versions) snapshots.append(element('div', { class: 'snapshot-row', 'data-snapshot-id': version.id }, [
    element('div', {}, [element('strong', { text: version.name }), element('span', { class: 'section-caption', text: new Date(version.createdAt).toLocaleString('en-GB') })]),
    element('button', { type: 'button', class: 'text-button', text: 'Restore', 'data-restore-snapshot': version.id, onClick: () => safeAction(() => changeWorkspace(restoreSnapshot(workspace, version.id, crypto.randomUUID()))) }),
    element('button', { type: 'button', class: 'icon-button', text: '×', 'aria-label': `Remove snapshot ${version.name}`, onClick: () => safeAction(() => changeWorkspace({ ...workspace, documents: workspace.documents.map(entry => entry.id === workspace.activeId ? { ...entry, versions: entry.versions.filter(snapshot => snapshot.id !== version.id) } : entry) })) })
  ])); panel.append(snapshots);
  panel.append(element('section', { class: 'form-section' }, [sectionTitle('Keep your whole workspace'), element('p', { class: 'panel-intro', text: 'A workspace backup includes every CV, snapshot, cover letter, master profile and tracked application. Importing merges it into the current library without overwriting existing CVs.' }), element('button', { id: 'export-workspace', type: 'button', class: 'button button-primary', text: 'Export workspace JSON', onClick: () => safeAction(() => { download(serialiseWorkspace(workspace), 'application/json', 'json', 'clearcv-workspace'); announce('Workspace backup downloaded. Keep this file private.'); }) })]));
  getDocumentImportUI().render(panel);
}
function renderLetter() {
  panel.append(sectionTitle('A letter with intention'), element('p', { class: 'panel-intro', text: 'A cover letter belongs to this CV. Write a focused introduction, explain your relevant experience and make a clear connection to the role.' }));
  for (const [key, label, multiline] of [['company', 'Company'], ['role', 'Role'], ['recipient', 'Recipient & address'], ['date', 'Date'], ['subject', 'Subject'], ['salutation', 'Salutation'], ['body', 'Your letter', true], ['closing', 'Closing']]) {
    const wrapper = field(label, state.coverLetter[key], `letter-${key}`, { multiline, rows: '16', data: { 'data-letter': key } });
    if (multiline) wrapper.querySelector('textarea').maxLength = 30000;
    panel.append(wrapper);
  }
  panel.append(element('button', { id: 'draft-letter', type: 'button', class: 'button button-quiet', text: 'Draft from my existing facts', onClick: () => {
    if (state.coverLetter.body.trim() && !window.confirm('Replace this letter body with a rule-based draft from the current CV facts? Save a snapshot first to retain it.')) return;
    const draft = coverLetterDraft(state, state.coverLetter.company, state.coverLetter.role);
    safeAction(() => change({ ...state, coverLetter: { ...state.coverLetter, body: draft.body, salutation: draft.salutation, closing: draft.closing } }, true));
    announce(`Rule-based draft ready to edit. ${draft.warnings.join(' ')}`);
  } }));
  panel.append(element('p', { class: 'design-note', text: 'This draft is assembled from your stored facts by explicit rules, not an AI model. Check each sentence and personalise it. Save as PDF, TXT and DOCX export the cover letter while this view is open.' }));
}
function renderLetterPreview(state, preview) {
  const p = state.profile; const letter = state.coverLetter;
  preview.classList.add('letter-paper');
  preview.append(element('header', { class: 'cv-header' }, [element('h1', { class: 'cv-name', text: p.name || 'Your name' }), element('div', { class: 'cv-contact' }, ['email', 'phone', 'location', 'website'].filter(key => p[key].trim()).map(key => contactElement(key, p[key]))) ]));
  if (letter.date) preview.append(element('p', { class: 'letter-date', text: letter.date }));
  if (letter.recipient || letter.company) preview.append(element('p', { class: 'letter-recipient', text: [letter.recipient, letter.company].filter(Boolean).join('\n') }));
  if (letter.subject || letter.role) preview.append(element('h2', { class: 'letter-subject', text: letter.subject || `Application: ${letter.role}` }));
  preview.append(element('p', { text: letter.salutation }), element('div', { class: 'letter-body', text: letter.body }), element('p', { class: 'letter-closing', text: `${letter.closing}\n${p.name}` }));
}
function showImportPreview(candidate) {
  const doc = validateDocument(candidate);
  const dialog = element('dialog', { id: 'submitted-dialog', class: 'submitted-dialog' });
  const controls = element('div', { class: 'submitted-controls' }, [element('h2', { text: 'Your reviewed CV' }), element('p', { class: 'field-hint', text: 'Preview of the editable import draft. The library has not changed. These exports use this reviewed draft; JSON also retains the hidden extracted source.' })]);
  controls.append(element('div', { class: 'action-row' }, [element('button', { id: 'import-preview-pdf', type: 'button', class: 'button button-primary', text: 'Save reviewed PDF', onClick: () => { setPrintLayout(doc); window.print(); } }), element('button', { id: 'import-preview-txt', type: 'button', class: 'button button-quiet', text: 'TXT', onClick: () => download(plainTextDocument(doc), 'text/plain', 'txt', doc.profile.name || 'reviewed-cv') }), element('button', { id: 'import-preview-docx', type: 'button', class: 'button button-quiet', text: 'DOCX', onClick: () => download(exportDocx(doc), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', doc.profile.name || 'reviewed-cv') }), element('button', { id: 'import-preview-close', type: 'button', class: 'button button-quiet', text: 'Close preview', onClick: () => dialog.close() })]));
  const paper = element('div', { class: 'paper' }); dialog.append(controls, paper); document.body.append(dialog);
  renderPreview(doc, 'cv', paper); setPrintLayout(doc);
  dialog.addEventListener('close', () => { dialog.remove(); renderPreview(); }); dialog.showModal(); document.querySelector('#import-preview-close').focus();
}
function showSubmittedCopy(applicationId, submissionId) {
  const copy = applicationSubmission(workspace, applicationId, submissionId);
  const dialog = element('dialog', { id: 'submitted-dialog', class: 'submitted-dialog', 'aria-labelledby': 'submitted-title' });
  const paper = element('article', { id: 'submitted-preview', class: 'paper' });
  let kind = 'cv';
  const controls = element('div', { class: 'submitted-controls' }, [element('h2', { id: 'submitted-title', text: copy.name }), element('p', { class: 'panel-intro', text: `Read-only copy of ${copy.cvName}, captured ${new Date(copy.submittedAt).toLocaleString('en-GB')}. Editing or deleting its source CV cannot change this copy.` })]);
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
    element('button', { id: 'submitted-copy-to-library', type: 'button', class: 'text-button', text: 'Create an editable library copy', onClick: () => safeAction(() => { const saved = changeWorkspace(copySubmissionToLibrary(workspace, applicationId, submissionId, crypto.randomUUID())); dialog.close(); switchTab('content'); announce(saved ? 'A separate editable CV is now in your library. The submitted copy is unchanged.' : 'An editable copy is open but could not be saved. Export a workspace JSON backup before closing; the submitted copy is unchanged.', !saved); }) }),
    element('button', { id: 'submitted-close', type: 'button', class: 'text-button', text: 'Close review', onClick: () => dialog.close() })
  ]);
  controls.append(views, actions, element('p', { class: 'field-hint', text: 'JSON retains the full editable CV and letter, including hidden sections and the pasted job description. PDF, TXT and DOCX use the selected visible CV or letter. Keep these files private.' }));
  dialog.append(controls, paper); document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); renderPreview(); });
  display('cv'); dialog.showModal(); document.querySelector('#submitted-close').focus();
}
function renderReview() {
  const review = reviewCV(state);
  panel.append(sectionTitle('Clarity, one detail at a time'), element('p', { class: 'panel-intro', text: review.method }));
  panel.append(element('div', { class: 'review-metrics', text: `${review.metrics.words} words · ${review.metrics.experienceBullets} experience bullets · ${review.issues.length} review prompts` }));
  for (const issue of review.issues) panel.append(element('article', { class: `review-issue ${issue.severity}`, 'data-rule': issue.ruleId }, [element('h3', { text: issue.message }), element('p', { text: issue.suggestion }), element('span', { class: 'section-caption', text: `${issue.path} · ${issue.ruleId}` })]));
  if (!review.issues.length) panel.append(element('p', { class: 'match-empty', text: 'These rules found no issues. This is not a guarantee of accuracy, suitability or successful ATS parsing.' }));
  const rules = element('details', { class: 'review-rules' }, [element('summary', { text: 'See every rule used' })]);
  for (const rule of review.rules) rules.append(element('p', { text: `${rule.id}: ${rule.description}` }));
  panel.append(rules);
  if (!writingUI) writingUI = createWritingUI({ element, selectField, sectionTitle, getWorkspace: () => workspace, change, safeAction, announce, isActive: () => activeTab === 'review' });
  writingUI.render(panel);
}
function renderTailoring(container) {
  const suggestions = tailoringSuggestions(state);
  const box = element('section', { class: 'form-section' }, [sectionTitle('Bring relevant facts forward'), element('p', { class: 'panel-intro', text: suggestions.method })]);
  for (const suggestion of suggestions.suggestions) box.append(element('p', { class: 'tailoring-prompt', text: suggestion.message }));
  const orderChanged = suggestions.experienceOrder.join(',') !== state.experience.map(item => item.id).join(',') || suggestions.skillOrder.join(',') !== state.skills.map(item => item.id).join(',');
  if (orderChanged) box.append(element('button', { id: 'apply-tailoring', type: 'button', class: 'button button-primary', text: 'Create a tailored copy with this order', onClick: () => safeAction(() => {
    const tailored = validateDocument(state);
    tailored.experience = suggestions.experienceOrder.map(id => tailored.experience.find(item => item.id === id));
    tailored.skills = suggestions.skillOrder.map(id => tailored.skills.find(item => item.id === id));
    changeWorkspace(addDocument(workspace, tailored, crypto.randomUUID(), `${activeEntry(workspace).name} tailored`.slice(0, 100)));
    announce('A tailored copy is open. Your original CV is kept; no facts or claims have been added.');
  }) }));
  else box.append(element('p', { class: 'match-empty', text: 'The existing entry order already matches this rule. Review the words above and edit only where accurate.' }));
  container.append(box);
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
  if (target === 'summary') return validateDocument({ ...document, profile: { ...document.profile, summary: text } });
  if (target === 'headline') return validateDocument({ ...document, profile: { ...document.profile, headline: text } });
  if (target === 'letter') return validateDocument({ ...document, coverLetter: { ...document.coverLetter, body: text } });
  return updateItem(document, 'experience', target, 'description', text);
}
function renderAi() {
  panel.append(sectionTitle('Writing, with a second voice'), element('p', { class: 'panel-intro', text: 'Generate a candidate, read every claim and apply only the wording you want. The current CV stays unchanged until you apply a result.' }));
  panel.append(element('p', { id: 'ai-status', class: 'design-note', text: aiStatus.enabled ? `Connected to configured model ${aiStatus.model || 'provider'}. Clicking Generate sends only the source text and context below to that configured service.` : 'AI generation is unavailable on the static demo. Run the local server with an operator-configured model to enable it. The rule-based Review and Job match tools work without AI.' }));
  const task = selectField('Writing task', aiTask, 'ai-task', [['summary', 'Improve summary'], ['headline', 'Write a professional headline'], ['objective', 'Write a career objective'], ['bullets', 'Improve experience bullets'], ['tailor', 'Tailor summary to the job'], ['letter', 'Draft a cover letter'], ['translate', 'Translate a selected field'], ['interview', 'Generate interview questions'], ['interview-feedback', 'Review a practice answer']]);
  task.querySelector('select').addEventListener('change', event => {
    aiTask = event.target.value;
    aiTarget = aiTask.startsWith('interview') ? 'practice' : aiTask === 'headline' ? 'headline' : aiTask === 'letter' ? 'letter' : aiTask === 'bullets' ? (state.experience[0]?.id || 'summary') : aiTask === 'translate' ? aiTarget : 'summary';
    renderPanel();
  }); panel.append(task);
  const targets = aiTask.startsWith('interview') ? [['practice', 'Interview practice — CV stays unchanged']] : [['summary', 'CV summary / objective'], ['headline', 'Professional headline'], ['letter', 'Cover letter body'], ...state.experience.map((item, index) => [item.id, `Experience: ${item.title || index + 1}`])];
  const target = selectField('Apply result to', aiTarget, 'ai-target', targets);
  target.querySelector('select').addEventListener('change', event => { aiTarget = event.target.value; renderPanel(); }); panel.append(target);
  const source = field('Source text — only this text is sent', aiSource(), 'ai-source', { multiline: true, rows: '9' });
  source.querySelector('textarea').maxLength = 30000; panel.append(source);
  const contextText = aiTask === 'interview-feedback' ? `Question(s):\n${practiceRecords.get(workspace.activeId)?.questions || ''}\n\nJob context:\n${state.jobAd}` : state.jobAd;
  const context = field('Job / company context — also sent', contextText, 'ai-context', { multiline: true, rows: '6', hint: 'Check this text for private material. The model may make mistakes; supplied facts still need your review.' });
  context.querySelector('textarea').maxLength = 20000; panel.append(context);
  if (aiTask === 'translate') panel.append(field('Target language', 'French', 'ai-language', { placeholder: 'e.g. French' }));
  const generate = element('button', { id: 'ai-generate', type: 'button', class: 'button button-primary', text: aiBusy ? 'Generating…' : 'Generate candidate', disabled: !aiStatus.enabled || aiBusy });
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
      announce('Candidate generated. Review the text before applying it; no CV content has been changed.');
    } catch (error) { announce(controller.signal.aborted ? 'Generation cancelled. Your CV has been kept.' : error.message, !controller.signal.aborted); }
    finally { aiController = null; aiBusy = false; if (activeTab === 'ai') renderPanel(); }
  }); panel.append(generate);
  if (aiBusy) panel.append(element('button', { id: 'ai-cancel', type: 'button', class: 'button button-quiet', text: 'Cancel request', onClick: () => aiController?.abort() }));
  if (aiCandidate) {
    panel.append(element('section', { class: 'form-section' }, [sectionTitle('Review the candidate', aiCandidate.model || 'CONFIGURED MODEL'), field('Candidate text — edit before applying', aiCandidate.text, 'ai-result', { multiline: true, rows: '12' })]));
    panel.querySelector('#ai-result').maxLength = 30000;
    panel.querySelector('#ai-result').addEventListener('input', event => { aiCandidate.text = event.target.value; });
    panel.append(element('button', { id: 'ai-apply', type: 'button', class: 'button button-primary', text: aiCandidate.target === 'practice' ? 'Keep reviewed practice text' : aiCandidate.task === 'tailor' ? 'Apply to a new tailored CV' : 'Apply reviewed text', disabled: aiCandidate.docId !== workspace.activeId, onClick: () => safeAction(() => {
      if (aiCandidate.target === 'practice') {
        const key = aiCandidate.task === 'interview-feedback' ? 'feedback' : 'questions';
        practiceRecords.set(workspace.activeId, { ...practiceRecords.get(workspace.activeId), [key]: aiCandidate.text });
        aiCandidate = null; renderPanel(); announce('Practice text kept in this tab. Export notes to keep them after closing; your CV is unchanged.'); return;
      }
      const oldValue = aiSource(aiCandidate.target);
      const nextDoc = documentWithAiText(state, aiCandidate.target, aiCandidate.text);
      if (aiCandidate.task === 'tailor') changeWorkspace(addDocument(workspace, nextDoc, crypto.randomUUID(), `${activeEntry(workspace).name} AI tailored`.slice(0, 100)));
      else change(nextDoc, true);
      aiUndo = { docId: workspace.activeId, target: aiCandidate.target, oldValue, newValue: aiCandidate.text };
      aiCandidate = null; renderPanel();
      announce('Reviewed text applied. Undo can restore the previous field while this page stays open.');
    }) }));
    if (aiCandidate.docId !== workspace.activeId) panel.append(element('p', { class: 'match-empty', text: 'This candidate belongs to another CV. Open that CV to apply it.' }));
  }
  const practice = practiceRecords.get(workspace.activeId);
  if (practice && (practice.questions || practice.feedback)) {
    const notes = element('section', { class: 'form-section' }, [sectionTitle('Your practice notebook'), element('p', { class: 'panel-intro', text: 'These notes remain in this tab while it is open. Export them before closing. Feedback is model-generated guidance, not a hiring prediction.' })]);
    if (practice.questions) notes.append(element('p', { class: 'practice-text', text: practice.questions }));
    if (practice.feedback) notes.append(element('p', { class: 'practice-text', text: practice.feedback }));
    notes.append(element('button', { id: 'export-practice', type: 'button', class: 'button button-quiet', text: 'Export practice TXT', onClick: () => download([practice.questions, practice.answer, practice.feedback].filter(Boolean).join('\n\n'), 'text/plain;charset=utf-8', 'txt', `${activeEntry(workspace).name}-interview`) }));
    panel.append(notes);
  }
  if (aiUndo?.docId === workspace.activeId) panel.append(element('button', { id: 'ai-undo', type: 'button', class: 'button button-quiet', text: 'Undo last AI apply', onClick: () => safeAction(() => {
    if (aiSource(aiUndo.target) !== aiUndo.newValue && !window.confirm('This field has been edited since the AI apply. Restore its previous text? Other fields will be kept.')) return;
    change(documentWithAiText(state, aiUndo.target, aiUndo.oldValue), true);
    aiUndo = null; renderPanel(); announce('Previous field text restored.');
  }) }));
}
// GitHub Pages is a static release: skip unavailable API requests there entirely.
if (!location.hostname.endsWith('.github.io')) getAiStatus().then(status => { aiStatus = status; if (activeTab === 'ai') renderPanel(); });

function renderCloud() {
  if (cloudUI) cloudUI.render(panel);
  else panel.append(sectionTitle('Shared CVs'), element('p', { class: 'design-note', text: 'The optional self-hosted sharing service is unavailable here. Local workspace backups remain available in Library.' }));
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
    if (matchMedia('(max-width: 700px)').matches) requestAnimationFrame(() => window.scrollTo({ top: view === 'preview' ? workspaceNode.offsetTop : Math.max(workspaceNode.offsetTop, editorScrollPosition), behavior: 'auto' }));
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

function contactElement(kind, text) {
  const href = safeContactHref(kind, text);
  return href ? element('a', { href, text, ...(kind === 'website' ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }) : element('span', { text });
}
