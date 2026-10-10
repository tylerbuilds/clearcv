import { JOB_STATUSES, addApplication, updateApplication, addApplicationTask, updateApplicationTask, removeApplicationTask, addApplicationCustomField, updateApplicationCustomField, removeApplicationCustomField, captureApplicationSubmission, removeApplicationSubmission } from './workspace.js';
import { filterApplications, applicationAnalytics, applicationsToCsv } from './tracker.js';

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
const label = value => value[0].toUpperCase() + value.slice(1);

export function createJobsUI({ element, field, selectField, sectionTitle, getWorkspace, changeWorkspace, safeAction, announce, switchTab, download, openSubmission }) {
  let container;
  const expanded = new Set();
  const customExpanded = new Set();
  const submissionNames = new Map();
  const filters = { query: '', status: '', archive: 'active', followUp: 'all' };
  let analyticsOpen = false;
  const application = id => getWorkspace().applications.find(app => app.id === id);
  const visible = () => filterApplications(getWorkspace().applications, { ...filters, today: localToday() });
  function commit(next, rerender = false) {
    const focused = document.activeElement;
    const restore = rerender && container?.contains(focused) ? {
      id: focused.id,
      applicationId: focused.closest('.application-card')?.dataset.applicationId,
      field: focused.dataset.taskField ? 'task' : focused.dataset.applicationField,
      archive: focused.hasAttribute('data-archive-application')
    } : null;
    const saved = changeWorkspace(next, false);
    if (rerender) {
      render(container);
      if (restore) {
        let target = restore.id ? document.getElementById(restore.id) : null;
        if (!target || !container.contains(target)) {
          const card = restore.applicationId ? container.querySelector(`.application-card[data-application-id="${restore.applicationId}"]`) : null;
          target = card?.querySelector(':scope > summary');
          if (!target) target = container.querySelector(restore.archive ? '#job-archive-filter' : restore.field === 'task' && filters.followUp !== 'all' ? '#job-followup-filter' : restore.field === 'status' && filters.status ? '#job-filter' : '#job-search');
        }
        target?.focus({ preventScroll: true });
      }
    }
    else refreshMetrics();
    return saved;
  }
  function action(run) { return safeAction(run); }
  function textInput(wrapper, read, write, { onBlur = false } = {}) {
    const input = wrapper.querySelector('input,textarea,select');
    const eventName = onBlur ? 'focusout' : input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(eventName, event => {
      event.stopPropagation();
      if (!action(() => { write(input.value); })) input.value = read();
    });
    // Fields in this module are handled here, independently of the CV editor.
    if (eventName !== 'input') input.addEventListener('input', event => event.stopPropagation());
    return wrapper;
  }
  function refreshMetrics() {
    if (!container?.querySelector('#job-analytics')) return;
    const stats = applicationAnalytics(getWorkspace().applications, { today: localToday() });
    const metrics = container.querySelector('#job-metrics');
    metrics.replaceChildren(...[
      [`${stats.activeCount}`, 'active applications'], [`${stats.last7DaysApplied}`, 'applied in the last 7 days'], [`${stats.tasks.overdue}`, 'overdue tasks'], [`${stats.tasks.due - stats.tasks.overdue}`, 'tasks due today']
    ].map(([value, title]) => element('div', { class: 'job-metric' }, [element('strong', { text: value }), element('span', { text: title })])));
    const stages = container.querySelector('#job-stages');
    stages.replaceChildren(...JOB_STATUSES.map(status => element('div', { class: 'job-stage' }, [element('span', { text: label(status) }), element('meter', { min: '0', max: String(Math.max(1, stats.activeCount)), value: String(stats.statusCounts[status]), 'aria-label': `${label(status)}: ${stats.statusCounts[status]} of ${stats.activeCount} active applications` }), element('strong', { text: String(stats.statusCounts[status]) })])));
    container.querySelector('#job-analytics-note').textContent = `${stats.tasks.open} open tasks (${stats.tasks.undatedOpen} without a due date), ${stats.tasks.done} done. ${stats.followUps.due} follow-up dates are due. ${stats.archivedCount} archived records are left out. ${stats.undatedApplicationCount} active records have no applied date; ${stats.futureAppliedDates} have a future applied date.`;
    const days = container.querySelector('#job-week');
    const today = localToday();
    const [year, month, day] = today.split('-').map(Number);
    const counts = new Map(stats.appliedDateCounts.map(item => [item.date, item.count]));
    days.replaceChildren(...Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.UTC(year, month - 1, day - 6 + i)).toISOString().slice(0, 10);
      return element('div', {}, [element('span', { text: date.slice(5), title: date }), element('strong', { text: String(counts.get(date) || 0) })]);
    }));
    container.querySelector('#job-count-visible').textContent = `${visible().length} shown · ${getWorkspace().applications.length} total`;
    for (const card of container.querySelectorAll('.application-card[data-application-id]')) {
      const app = application(card.dataset.applicationId);
      if (!app) continue;
      card.querySelector('.application-heading').textContent = app.company || 'New application';
      card.querySelector('.application-role').textContent = app.role || 'Add the role';
      card.querySelector('.application-stage').textContent = `${label(app.status)}${app.archived ? ' · archived' : ''}`;
    }
  }
  function render(target) {
    container = target; target.replaceChildren();
    const ws = getWorkspace();
    target.append(sectionTitle('Keep track of your applications', `${ws.applications.length} APPLICATIONS`), element('p', { class: 'panel-intro', text: 'Keep each role, the CV and letter you sent, and your next steps together. This tracker stays in your browser. It won’t send applications or reminders.' }));
    const actions = element('div', { class: 'action-row tracker-actions' }, [
      element('button', { id: 'add-application', type: 'button', class: 'button button-primary', text: '+ Track a job', onClick: () => action(() => {
        const id = crypto.randomUUID(); expanded.add(id); Object.assign(filters, { query: '', status: '', archive: 'active', followUp: 'all' });
        commit(addApplication(getWorkspace(), id), true); container.querySelector(`#application-${id}-company`)?.focus();
      }) }),
      element('button', { id: 'export-applications-csv', type: 'button', class: 'button button-quiet', text: 'Export shown CSV', onClick: () => action(() => { download(applicationsToCsv(visible()), 'text/csv;charset=utf-8', 'csv', 'clearcv-applications-visible'); announce('CSV downloaded. To keep the saved CV and letter copies too, download a workspace backup.'); }) })
    ]); target.append(actions);
    const analytics = element('details', { id: 'job-analytics', class: 'tracker-disclosure' }, [element('summary', { text: 'Your search at a glance' }), element('div', { id: 'job-metrics', class: 'job-metrics' }), element('p', { class: 'field-hint', text: 'These totals use your active applications and the dates you entered. Archived records are left out.' }), element('div', { id: 'job-stages', class: 'job-stages' }), element('h3', { text: 'Applications sent in the last 7 days', class: 'tracker-subheading' }), element('div', { id: 'job-week', class: 'job-week', 'aria-label': 'Application dates in the last seven days' }), element('p', { id: 'job-analytics-note', class: 'field-hint' }), element('button', { id: 'export-all-applications-csv', type: 'button', class: 'text-button', text: 'Export all records, including archived, as CSV', onClick: () => action(() => download(applicationsToCsv(getWorkspace().applications), 'text/csv;charset=utf-8', 'csv', 'clearcv-applications-all')) })]);
    analytics.open = analyticsOpen; analytics.addEventListener('toggle', () => { analyticsOpen = analytics.open; }); target.append(analytics);
    const search = field('Search applications', filters.query, 'job-search', { placeholder: 'Company, role, notes, tasks or custom fields' });
    search.querySelector('input').addEventListener('input', event => { filters.query = event.target.value; renderList(); refreshMetrics(); }); target.append(search);
    const filterRow = element('div', { class: 'field-row' });
    for (const [key, title, id, choices] of [
      ['status', 'Stage', 'job-filter', [['', 'All stages'], ...JOB_STATUSES.map(status => [status, label(status)])]],
      ['archive', 'Records', 'job-archive-filter', [['active', 'Active'], ['archived', 'Archived'], ['all', 'All records']]],
      ['followUp', 'Follow-up', 'job-followup-filter', [['all', 'All follow-ups'], ['due', 'Due today or overdue'], ['overdue', 'Overdue'], ['open', 'Any open follow-up'], ['done', 'Tasks completed']]]
    ]) {
      const wrapper = selectField(title, filters[key], id, choices); wrapper.querySelector('select').addEventListener('change', event => { filters[key] = event.target.value; renderList(); refreshMetrics(); }); filterRow.append(wrapper);
    }
    target.append(filterRow, element('p', { id: 'job-count-visible', class: 'field-hint', 'aria-live': 'polite' }), element('div', { id: 'application-list' }));
    renderList(); refreshMetrics();
  }
  function renderList() {
    const list = container.querySelector('#application-list'); list.replaceChildren();
    const applications = visible();
    for (const app of applications) list.append(renderApplication(app));
    if (!applications.length) list.append(element('p', { class: 'match-empty', text: getWorkspace().applications.length ? 'No records match these filters. Try another stage, search or archive view.' : 'Add your first role. Your jobs, tasks and submitted copies are included in workspace backups.' }));
  }
  function renderApplication(app) {
    const card = element('details', { class: 'entry application-card', 'data-application-id': app.id });
    card.open = expanded.has(app.id);
    card.addEventListener('toggle', () => { if (card.open) expanded.add(app.id); else expanded.delete(app.id); });
    card.append(element('summary', { class: 'application-summary' }, [element('span', {}, [element('strong', { class: 'application-heading', text: app.company || 'New application' }), element('span', { class: 'application-role', text: app.role || 'Add the role' })]), element('span', { class: 'application-stage', text: `${label(app.status)}${app.archived ? ' · archived' : ''}` })]));
    const body = element('div', { class: 'application-body' });
    for (const [key, title, type] of [['company', 'Company'], ['role', 'Role'], ['url', 'Job URL', 'url'], ['appliedDate', 'Applied date', 'date'], ['followUpDate', 'Follow-up date', 'date'], ['notes', 'Notes & next steps']]) {
      const wrapper = field(title, app[key], `application-${app.id}-${key}`, { type, multiline: key === 'notes', rows: '4', data: { 'data-application-field': key, 'data-application-id': app.id } });
      wrapper.querySelector('input,textarea').maxLength = key === 'notes' ? 10000 : 300;
      body.append(textInput(wrapper, () => application(app.id)[key], value => commit(updateApplication(getWorkspace(), app.id, key, value)), { onBlur: key === 'url' }));
    }
    for (const [key, title, id, choices] of [['status', 'Stage', 'status', JOB_STATUSES.map(status => [status, label(status)])], ['cvId', 'CV and cover letter', 'cv', [['', 'No CV linked'], ...getWorkspace().documents.map(entry => [entry.id, entry.name])]]]) body.append(textInput(selectField(title, app[key], `application-${app.id}-${id}`, choices, { 'data-application-field': key, 'data-application-id': app.id }), () => application(app.id)[key], value => commit(updateApplication(getWorkspace(), app.id, key, value), true)));
    body.append(element('p', { class: 'field-hint', text: 'The link opens your current CV. Save a submitted copy below to keep what you sent. Use tasks when you want to tick off a follow-up.' }));
    body.append(renderTasks(app), renderCustomFields(app), renderSubmissions(app));
    body.append(element('div', { class: 'action-row' }, [
      app.cvId ? element('button', { type: 'button', class: 'text-button', text: 'Open linked CV', 'data-open-linked-cv': app.id, onClick: () => { const current = application(app.id); if (current.cvId) { changeWorkspace({ ...getWorkspace(), activeId: current.cvId }); switchTab('content'); } } }) : null,
      element('button', { type: 'button', class: 'text-button', text: app.archived ? 'Restore from archive' : 'Archive application', 'data-archive-application': app.id, onClick: () => action(() => commit(updateApplication(getWorkspace(), app.id, 'archived', !application(app.id).archived), true)) }),
      element('button', { type: 'button', class: 'text-button danger-text', text: 'Delete record', 'data-remove-application': app.id, onClick: () => { if (window.confirm('Delete this application, its tasks, custom fields and submitted copies? The CV library is kept. Archive instead to retain its history.')) action(() => commit({ ...getWorkspace(), applications: getWorkspace().applications.filter(item => item.id !== app.id) }, true)); } })
    ]));
    card.append(body); return card;
  }
  function renderTasks(app) {
    const section = element('section', { class: 'tracker-section' }, [sectionTitle('Your next steps', `${app.tasks.length} / 30 TASKS`)]);
    for (const task of app.tasks) {
      const row = element('div', { class: `tracker-task${task.done ? ' done' : ''}`, 'data-task-id': task.id });
      const done = element('input', { id: `task-${app.id}-${task.id}-done`, type: 'checkbox', 'aria-label': `Mark ${task.title || 'task'} done`, 'data-task-field': 'done' }); done.checked = task.done;
      done.addEventListener('change', () => action(() => commit(updateApplicationTask(getWorkspace(), app.id, task.id, 'done', done.checked), true)));
      row.append(element('label', { class: 'task-completion', for: done.id, title: `Mark ${task.title || 'task'} done` }, [done, element('span', { class: 'completion-text', text: 'Done' })]));
      for (const [key, title, type] of [['title', 'Task', 'text'], ['dueDate', 'Due date', 'date']]) {
        const wrapper = field(title, task[key], `task-${app.id}-${task.id}-${key}`, { type, data: { 'data-task-field': key, 'data-application-id': app.id, 'data-task-id': task.id } });
        wrapper.querySelector('input').maxLength = 200;
        row.append(textInput(wrapper, () => application(app.id).tasks.find(item => item.id === task.id)[key], value => commit(updateApplicationTask(getWorkspace(), app.id, task.id, key, value))));
      }
      row.append(element('button', { type: 'button', class: 'icon-button', text: '×', 'aria-label': `Remove ${task.title || 'task'}`, 'data-remove-task': task.id, onClick: () => action(() => commit(removeApplicationTask(getWorkspace(), app.id, task.id), true)) }));
      section.append(row);
    }
    section.append(element('button', { type: 'button', class: 'add-button', text: '+ Add a task', 'data-add-task': app.id, disabled: app.tasks.length >= 30, onClick: () => action(() => { const id = crypto.randomUUID(); commit(addApplicationTask(getWorkspace(), app.id, id), true); container.querySelector(`#task-${app.id}-${id}-title`)?.focus(); }) }));
    return section;
  }
  function renderCustomFields(app) {
    const section = element('details', { class: 'tracker-disclosure custom-fields', 'data-custom-fields': app.id }, [element('summary', { text: `More details · ${app.customFields.length} custom fields` })]);
    section.open = customExpanded.has(app.id);
    section.addEventListener('toggle', () => { if (section.open) customExpanded.add(app.id); else customExpanded.delete(app.id); });
    for (const item of app.customFields) {
      const row = element('div', { class: 'tracker-custom-field', 'data-custom-field-id': item.id });
      for (const [key, title, limit] of [['label', 'Field name', 80], ['value', 'Value', 2000]]) {
        const wrapper = field(title, item[key], `application-field-${app.id}-${item.id}-${key}`, { multiline: key === 'value', rows: '2' }); wrapper.querySelector('input,textarea').maxLength = limit;
        row.append(textInput(wrapper, () => application(app.id).customFields.find(field => field.id === item.id)[key], value => commit(updateApplicationCustomField(getWorkspace(), app.id, item.id, key, value))));
      }
      row.append(element('button', { type: 'button', class: 'text-button', text: 'Remove field', 'data-remove-custom-field': item.id, onClick: () => action(() => commit(removeApplicationCustomField(getWorkspace(), app.id, item.id), true)) })); section.append(row);
    }
    section.append(element('button', { type: 'button', class: 'add-button', text: '+ Add custom field', 'data-add-custom-field': app.id, disabled: app.customFields.length >= 20, onClick: () => action(() => { const id = crypto.randomUUID(); customExpanded.add(app.id); commit(addApplicationCustomField(getWorkspace(), app.id, id), true); container.querySelector(`#application-field-${app.id}-${id}-label`)?.focus(); }) }), element('p', { class: 'field-hint', text: 'Add contacts, salary, location or interview notes as text fields.' }));
    return section;
  }
  function renderSubmissions(app) {
    const section = element('section', { class: 'tracker-section' }, [sectionTitle('What you sent', `${app.submissions.length} / 8 COPIES`), element('p', { class: 'field-hint', text: 'Keep a copy of the linked CV and letter before editing them for another role. This records what you choose to save; it doesn’t send the application. Backups also include hidden sections and the pasted job description, so keep them private.' })]);
    const name = field('Submitted copy name', submissionNames.get(app.id) || '', `submission-name-${app.id}`, { placeholder: 'First application · product role' }); name.querySelector('input').maxLength = 100;
    name.querySelector('input').addEventListener('input', event => { submissionNames.set(app.id, event.target.value); }); section.append(name);
    section.append(element('button', { type: 'button', class: 'button button-quiet', 'data-capture-submission': app.id, text: 'Save submitted CV + letter copy', disabled: !app.cvId || app.submissions.length >= 8, onClick: () => action(() => {
      const title = container.querySelector(`#submission-name-${app.id}`).value;
      const next = captureApplicationSubmission(getWorkspace(), app.id, crypto.randomUUID(), title);
      submissionNames.delete(app.id);
      const saved = commit(next, true);
      announce(saved ? 'Your CV and letter copy is saved. Later edits to your CV won’t change it.' : 'Submitted copy is open but unsaved. Export a workspace backup before closing.', !saved);
    }) }));
    if (!app.cvId) section.append(element('p', { class: 'field-hint', text: 'Choose a CV above to save a new copy.' }));
    for (const copy of app.submissions) section.append(element('div', { class: 'submitted-copy-row', 'data-submission-id': copy.id }, [element('div', {}, [element('strong', { text: copy.name }), element('span', { class: 'section-caption', text: `Captured ${new Date(copy.submittedAt).toLocaleString('en-GB')}` })]), element('button', { type: 'button', class: 'text-button', text: 'View and download', 'data-review-submission': copy.id, onClick: () => action(() => openSubmission(app.id, copy.id)) }), element('button', { type: 'button', class: 'icon-button', text: '×', 'aria-label': `Delete submitted copy ${copy.name}`, 'data-remove-submission': copy.id, onClick: () => { if (window.confirm(`Delete the saved submitted CV and letter “${copy.name}”? This does not affect the linked CV.`)) action(() => commit(removeApplicationSubmission(getWorkspace(), app.id, copy.id), true)); } })]));
    return section;
  }
  return { render };
}
