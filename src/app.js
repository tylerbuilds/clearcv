import { sampleDocument, createDocument, validateDocument, parseDocument, serialiseDocument, addItem, updateItem, moveItem, removeItem, keywordFeedback, ACCENTS } from './model.js';

const STORAGE_KEY = 'clearcv.document.v1';
let activeTab = 'content';
let noticeTimer;
let pendingReset = 'blank';
let initialNotice = '';
let state;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  state = saved ? parseDocument(saved) : sampleDocument();
  if (!saved) localStorage.setItem(STORAGE_KEY, serialiseDocument(state));
} catch (error) {
  state = sampleDocument();
  initialNotice = `The saved CV could not be read: ${error.message} The example is open; an unreadable saved copy has not been overwritten.`;
  document.querySelector('#save-status').textContent = 'Saved copy unavailable';
}
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
  try {
    localStorage.setItem(STORAGE_KEY, serialiseDocument(state));
    document.querySelector('#save-status').textContent = 'Saved on this device';
    return true;
  } catch {
    document.querySelector('#save-status').textContent = 'Not saved · export a backup';
    announce('Your changes are open, but this browser could not save them. Export a JSON backup before closing this page.', true);
    return false;
  }
}
function change(next, rerender = false) {
  state = validateDocument(next);
  const saved = save();
  renderPreview();
  if (rerender) renderPanel();
  else if (activeTab === 'match') renderMatchResults();
  return saved;
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
    autocomplete: options.autocomplete || 'off', ...options.data
  });
  const wrapper = element('div', { class: 'field' }, [element('label', { class: 'field-label', for: id, text: label }), input]);
  if (options.hint) wrapper.append(element('span', { class: 'field-hint', text: options.hint }));
  return wrapper;
}
function renderContent() {
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
}
function renderPanel() {
  panel.replaceChildren();
  panel.setAttribute('aria-labelledby', `tab-${activeTab}`);
  if (activeTab === 'content') renderContent();
  else if (activeTab === 'design') renderDesign();
  else renderMatch();
}
function renderPreview() {
  preview.replaceChildren();
  preview.className = `paper template-${state.style.template}`;
  preview.style.setProperty('--paper-accent', state.style.accent);
  const profile = state.profile;
  const header = element('header', { class: 'cv-header' }, [
    element('h1', { class: `cv-name${profile.name ? '' : ' cv-placeholder'}`, text: profile.name || 'Your name' }),
    element('div', { class: `cv-headline${profile.headline ? '' : ' cv-placeholder'}`, text: profile.headline || 'Your next chapter' })
  ]);
  const contacts = element('div', { class: 'cv-contact' });
  for (const key of ['email', 'phone', 'location', 'website']) if (profile[key].trim()) contacts.append(element('span', { text: profile[key] }));
  header.append(contacts);
  preview.append(header);
  if (profile.summary.trim()) preview.append(element('section', { class: 'cv-section' }, [element('h2', { text: 'Profile' }), element('p', { class: 'cv-summary', text: profile.summary })]));
  for (const [collection, title] of [['experience', 'Experience'], ['education', 'Education']]) {
    if (!state[collection].length) continue;
    const section = element('section', { class: 'cv-section', 'data-preview-section': collection }, [element('h2', { text: title })]);
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
  if (skills.length) preview.append(element('section', { class: 'cv-section' }, [element('h2', { text: 'Skills' }), element('div', { class: 'cv-skills' }, skills.map(item => element('span', { class: 'cv-skill', text: item.name })))]));
}
function switchTab(tab, focus = false) {
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
  if (focus) document.querySelector(`#tab-${tab}`).focus();
}
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => switchTab(button.dataset.tab));
document.querySelector('.editor-tabs').addEventListener('keydown', event => {
  const tabs = ['content', 'design', 'match'];
  const current = tabs.indexOf(activeTab);
  let next;
  if (event.key === 'ArrowRight') next = tabs[(current + 1) % 3];
  if (event.key === 'ArrowLeft') next = tabs[(current + 2) % 3];
  if (event.key === 'Home') next = tabs[0];
  if (event.key === 'End') next = tabs[2];
  if (next) { event.preventDefault(); switchTab(next, true); }
});
panel.addEventListener('input', event => {
  const input = event.target;
  const accepted = safeAction(() => {
    if (input.dataset.profile) change({ ...state, profile: { ...state.profile, [input.dataset.profile]: input.value } });
    else if (input.dataset.collection) change(updateItem(state, input.dataset.collection, input.dataset.id, input.dataset.field, input.value));
    else if (input.dataset.jobAd) change({ ...state, jobAd: input.value });
  });
  if (!accepted) {
    if (input.dataset.profile) input.value = state.profile[input.dataset.profile];
    else if (input.dataset.collection) input.value = state[input.dataset.collection].find(item => item.id === input.dataset.id)?.[input.dataset.field] || '';
    else if (input.dataset.jobAd) input.value = state.jobAd;
  }
});
document.querySelector('#print-cv').addEventListener('click', () => {
  const previousTitle = document.title;
  document.title = `${state.profile.name.trim() || 'ClearCV'} — CV`;
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
document.querySelector('#import-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error('Choose a ClearCV JSON file smaller than 1 MB.');
    const imported = parseDocument(await file.text());
    const saved = change(imported, true);
    announce(saved ? 'Your CV has been imported and saved in this browser.' : 'Your CV is imported, but this browser could not save it. Export a JSON backup before closing this page.', !saved);
  } catch (error) { announce(`${error.message} Your current CV has been kept.`, true); }
  finally { event.target.value = ''; }
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
  const saved = change(pendingReset === 'blank' ? createDocument() : sampleDocument());
  switchTab('content');
  document.querySelector('#profile-name').focus();
  const message = pendingReset === 'blank' ? 'A fresh CV is ready for your story.' : 'The example CV is ready to explore.';
  announce(saved ? message : `${message} This browser could not save it; export a JSON backup before closing.`, !saved);
});
renderPanel();
renderPreview();
if (initialNotice) announce(initialNotice, true);
