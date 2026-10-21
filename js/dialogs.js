// Forms in dialogs (task, reminder, list) and the confirmation dialog. All use
// the native <dialog> element, which gives focus trapping, Esc-to-close and a
// backdrop for free.

import * as store from './store.js';
import { addDays, formatTime, instantToLocal, localTimeZone, relativeDay, todayISO, zonedToInstant } from './dates.js';
import { LIST_TEMPLATES } from './templates.js';
import { esc, icon, toast } from './ui.js';

/**
 * Wires a dialog: Esc, the close buttons and a backdrop click all call `close`.
 * Cleanup runs in `close` rather than in a 'close' listener: that event is queued
 * asynchronously and isn't reliably delivered in every embedded browser.
 */
function wireDialog(dialog, close) {
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="dialog-cancel"]')) close();
    if (e.target === dialog) close();
  });
}

function errorSetter(prefix, form) {
  return (name, message) => {
    const input = form.elements[name];
    const errorEl = document.getElementById(`${prefix}-${name}-error`);
    if (!errorEl || !input) return;
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
    input.toggleAttribute('aria-invalid', Boolean(message));
  };
}

// ---- Task -------------------------------------------------------------------

const taskDialog = document.getElementById('task-dialog');
const taskForm = document.getElementById('task-form');
const setTaskError = errorSetter('task', taskForm);
let editingTaskId = null;
let onTaskSaved = null;
let taskReturnFocus = null;

/**
 * Opens the task form.
 * @param {{ task?: object, date?: string, time?: string, draft?: object }} options — pass `task` to edit,
 * `date` to prefill a new task, or `draft` (title, date, time, priority, notes) to start from a suggestion.
 */
export function openTaskDialog({ task = null, date, time, draft = null, onSaved = null } = {}) {
  editingTaskId = task?.id ?? null;
  onTaskSaved = onSaved;
  taskReturnFocus = document.activeElement;
  taskForm.reset();
  ['title', 'date'].forEach((n) => setTaskError(n));

  document.getElementById('task-dialog-title').textContent = task ? 'Edit task' : 'Add task';
  document.getElementById('task-submit').textContent = task ? 'Save changes' : 'Add task';
  const f = taskForm.elements;
  const src = task ?? draft ?? {};
  f.title.value = src.title ?? '';
  f.date.value = src.date ?? date ?? todayISO();
  f.time.value = src.time ?? time ?? '';
  f.notes.value = src.notes ?? '';
  f.repeat.value = src.repeat ?? '';
  f.priority.value = src.priority ?? 'none';

  taskDialog.showModal();
  f.title.focus();
}

function closeTaskDialog() {
  taskDialog.close();
  editingTaskId = null;
  onTaskSaved = null;
  taskReturnFocus?.isConnected && taskReturnFocus.focus();
}
wireDialog(taskDialog, closeTaskDialog);

taskForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = taskForm.elements;
  const result = store.validateTask({
    title: f.title.value, date: f.date.value, time: f.time.value,
    priority: f.priority.value, notes: f.notes.value, repeat: f.repeat.value,
  });

  ['title', 'date'].forEach((n) => setTaskError(n));
  if (result.errors) {
    Object.entries(result.errors).forEach(([name, msg]) => setTaskError(name, msg));
    f[Object.keys(result.errors)[0]]?.focus();
    return;
  }

  try {
    let saved;
    if (editingTaskId) {
      saved = store.updateTask(editingTaskId, result.task);
      toast('Changes saved');
    } else {
      saved = store.addTask(result.task);
      toast(saved.date === todayISO() ? 'Task added' : `Task added for ${relativeDay(saved.date)}`);
    }
    const cb = onTaskSaved;
    closeTaskDialog();
    cb?.(saved);
  } catch (err) {
    console.error(err);
    toast('Something went wrong. Please try again.', { tone: 'error' });
  }
});

// ---- Reminder ---------------------------------------------------------------

const reminderDialog = document.getElementById('reminder-dialog');
const reminderForm = document.getElementById('reminder-form');
const setReminderError = errorSetter('reminder', reminderForm);
let editingReminderId = null;
let reminderReturnFocus = null;

/** A sensible default time: the next whole hour, at least 15 minutes from now. */
function nextRoundTime() {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return instantToLocal(d.getTime());
}

function taskOptions(selectedId) {
  const today = todayISO();
  const horizon = addDays(today, 60);
  const tasks = store.getTasks()
    .filter((t) => t.id === selectedId || (!t.completed && t.date <= horizon))
    .sort((a, b) => (a.date === b.date ? (a.time ?? '99') < (b.time ?? '99') ? -1 : 1 : a.date < b.date ? -1 : 1));
  return ['<option value="">No linked task</option>', ...tasks.map((t) => `
    <option value="${esc(t.id)}" ${t.id === selectedId ? 'selected' : ''}>${esc(t.title)} — ${esc(relativeDay(t.date, today))}${t.time ? `, ${esc(formatTime(t.time))}` : ''}</option>`)].join('');
}

function showTzNote(reminder) {
  const note = document.getElementById('reminder-tz');
  const here = localTimeZone();
  note.hidden = !reminder || reminder.tz === here;
  if (!note.hidden) {
    note.innerHTML = `${icon('globe')}<span>This reminder was set for ${esc(formatTime(reminder.time))} in <strong>${esc(reminder.tz)}</strong>. It is shown here in your current time zone (<strong>${esc(here)}</strong>) — same moment, different clock.</span>`;
  }
}

/**
 * Opens the reminder form.
 * @param {{ reminder?: object, task?: object, date?: string }} options — `reminder` to edit; `task` to create one linked
 * to a task; `date` to suggest a day for a new one.
 */
export function openReminderDialog({ reminder = null, task = null, date: onDate = null } = {}) {
  editingReminderId = reminder?.id ?? null;
  reminderReturnFocus = document.activeElement;
  reminderForm.reset();
  ['title', 'date', 'time'].forEach((n) => setReminderError(n));

  const f = reminderForm.elements;
  let date;
  let time;
  if (reminder) {
    // Keep the same moment: show it on this device's clock (the note explains if the zone differs).
    ({ date, time } = reminder.tz === localTimeZone() ? reminder : instantToLocal(zonedToInstant(reminder.date, reminder.time, reminder.tz)));
  } else if (task) {
    date = task.date < todayISO() ? todayISO() : task.date;
    time = task.time ?? '09:00';
    if (zonedToInstant(date, time, localTimeZone()) < Date.now()) ({ date, time } = nextRoundTime());
  } else if (onDate && onDate > todayISO()) {
    date = onDate;
    time = '09:00';
  } else {
    ({ date, time } = nextRoundTime());
  }

  document.getElementById('reminder-dialog-title').textContent = reminder ? 'Edit reminder' : 'New reminder';
  document.getElementById('reminder-submit').textContent = reminder ? 'Save changes' : 'Save reminder';
  f.title.value = reminder?.title ?? task?.title ?? '';
  f.date.value = date;
  f.time.value = time;
  f.repeat.value = reminder?.repeat ?? task?.repeat ?? '';
  f.notes.value = reminder?.notes ?? '';
  f.taskId.innerHTML = taskOptions(reminder?.taskId ?? task?.id ?? null);
  showTzNote(reminder);

  reminderDialog.showModal();
  f.title.focus();
}

function closeReminderDialog() {
  reminderDialog.close();
  editingReminderId = null;
  reminderReturnFocus?.isConnected && reminderReturnFocus.focus();
}
wireDialog(reminderDialog, closeReminderDialog);

reminderForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = reminderForm.elements;
  const result = store.validateReminder({
    title: f.title.value, date: f.date.value, time: f.time.value,
    repeat: f.repeat.value, taskId: f.taskId.value, notes: f.notes.value, tz: localTimeZone(),
  });
  ['title', 'date', 'time'].forEach((n) => setReminderError(n));
  if (result.errors) {
    Object.entries(result.errors).forEach(([name, msg]) => setReminderError(name, msg));
    f[Object.keys(result.errors)[0]]?.focus();
    return;
  }
  const r = result.reminder;
  const due = zonedToInstant(r.date, r.time, r.tz);
  const inPast = due <= Date.now();
  try {
    if (editingReminderId) {
      const current = store.getReminder(editingReminderId);
      // A new date/time starts fresh: clear snooze and "already shown" state.
      const changed = current.date !== r.date || current.time !== r.time || current.tz !== r.tz;
      store.updateReminder(editingReminderId, { ...r, ...(changed ? { snoozedUntil: null, alertedFor: null, done: false } : {}) });
      toast('Reminder saved');
    } else {
      store.addReminder(r);
      toast(inPast ? 'Reminder saved — that time has already passed' : `Reminder set for ${relativeDay(r.date)}, ${formatTime(r.time)}`);
    }
    closeReminderDialog();
  } catch (err) {
    console.error(err);
    toast('Something went wrong. Please try again.', { tone: 'error' });
  }
});

// ---- List -------------------------------------------------------------------

const listDialog = document.getElementById('list-dialog');
const listForm = document.getElementById('list-form');
const setListError = errorSetter('list', listForm);
let renamingListId = null;
let onListSaved = null;
let listReturnFocus = null;

const templateOptions = document.getElementById('list-template-options');
templateOptions.innerHTML = [{ id: 'blank', name: 'Blank list', icon: 'plus', items: [] }, ...LIST_TEMPLATES].map((t, i) => `
  <label class="template">
    <input type="radio" name="template" value="${t.id}" ${i === 0 ? 'checked' : ''}>
    <span class="template__card">
      <span class="template__icon">${icon(t.icon)}</span>
      <span class="template__name">${esc(t.name)}</span>
      <span class="template__count">${t.items.length ? `${t.items.length} starter items` : 'Start empty'}</span>
    </span>
  </label>`).join('');

templateOptions.addEventListener('change', (e) => {
  if (e.target.name !== 'template') return;
  const name = listForm.elements.name;
  const tpl = LIST_TEMPLATES.find((t) => t.id === e.target.value);
  const isTemplateName = !name.value || LIST_TEMPLATES.some((t) => t.name === name.value);
  if (isTemplateName) name.value = tpl ? tpl.name : '';
});

/**
 * Opens the list form. Pass `list` to rename. `onSaved(list)` runs after saving.
 */
export function openListDialog({ list = null, onSaved = null } = {}) {
  renamingListId = list?.id ?? null;
  onListSaved = onSaved;
  listReturnFocus = document.activeElement;
  listForm.reset();
  setListError('name');
  document.getElementById('list-dialog-title').textContent = list ? 'Rename list' : 'New list';
  document.getElementById('list-submit').textContent = list ? 'Save name' : 'Create list';
  document.getElementById('list-templates').hidden = Boolean(list);
  listForm.elements.name.value = list?.name ?? '';
  listDialog.showModal();
  listForm.elements.name.focus();
}

function closeListDialog() {
  listDialog.close();
  renamingListId = null;
  onListSaved = null;
  listReturnFocus?.isConnected && listReturnFocus.focus();
}
wireDialog(listDialog, closeListDialog);

listForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = listForm.elements.name.value.trim();
  setListError('name');
  if (!name) {
    setListError('name', 'Please give the list a name.');
    listForm.elements.name.focus();
    return;
  }
  try {
    const cb = onListSaved;
    let saved;
    if (renamingListId) {
      saved = store.renameList(renamingListId, name);
      toast('List renamed');
    } else {
      const tpl = LIST_TEMPLATES.find((t) => t.id === listForm.elements.template.value);
      saved = store.addList(name, tpl ? tpl.items : []);
      toast(tpl ? `List created with ${tpl.items.length} starter items` : 'List created');
    }
    closeListDialog();
    cb?.(saved);
  } catch (err) {
    console.error(err);
    toast(err.message === 'Too many lists' ? `You can have up to ${store.LIMITS.LISTS_MAX} lists.` : 'Something went wrong. Please try again.', { tone: 'error' });
  }
});

// ---- Goal -------------------------------------------------------------------

const goalDialog = document.getElementById('goal-dialog');
const goalForm = document.getElementById('goal-form');
// Right after an update, a browser can briefly combine a cached old index.html with new
// scripts. Then the goal form is missing: don't break the whole app, ask for a reload.
const goalFormReady = Boolean(goalDialog && goalForm);
const setGoalError = goalFormReady ? errorSetter('goal', goalForm) : () => {};
let editingGoalId = null;
let goalReturnFocus = null;

const GOAL_HINTS = {
  tasks: 'Counts tasks you tick off between the start date and the deadline.',
  active_days: 'Counts days on which you tick off at least one task.',
  streak: 'Your longest run in a row with at least one completed task, counted from the start date.',
  list: 'Done when every item on the list is ticked off.',
  custom: 'You add progress yourself with the + button on the goal.',
};
const TARGET_LABELS = { tasks: 'Number of tasks', active_days: 'Number of days', streak: 'Length of the streak', custom: 'Number of steps' };

function syncGoalFields() {
  const kind = goalForm.elements.kind.value;
  document.getElementById('goal-kind-hint').textContent = GOAL_HINTS[kind] ?? '';
  const show = { target: kind !== 'list', priority: kind === 'tasks', period: kind === 'streak', list: kind === 'list' };
  goalForm.querySelectorAll('[data-goal-field]').forEach((el) => { el.hidden = !show[el.dataset.goalField]; });
  document.getElementById('goal-target-label').textContent = TARGET_LABELS[kind] ?? 'Target';
}
if (goalFormReady) goalForm.elements.kind.addEventListener('change', syncGoalFields);

/**
 * Opens the goal form. Pass `goal` to edit, or `draft` ({ title, kind, target, … }) to prefill a new goal.
 */
export function openGoalDialog({ goal = null, draft = null } = {}) {
  if (!goalFormReady) { toast('DailyMate was just updated. Please reload the page.', { tone: 'error' }); return; }
  editingGoalId = goal?.id ?? null;
  goalReturnFocus = document.activeElement;
  goalForm.reset();
  ['title', 'kind', 'target', 'listId', 'startDate', 'deadline'].forEach((f) => setGoalError(f));
  const lists = store.getLists();
  const listSelect = goalForm.elements.listId;
  listSelect.innerHTML = lists.length
    ? lists.map((l) => `<option value="${esc(l.id)}">${esc(l.name)} (${l.items.filter((i) => i.done).length}/${l.items.length})</option>`).join('')
    : '<option value="">You don’t have any lists yet</option>';
  const src = goal ?? draft ?? {};
  const f = goalForm.elements;
  f.title.value = src.title ?? '';
  f.kind.value = src.kind ?? 'tasks';
  f.target.value = src.target ?? (src.kind === 'streak' ? 7 : 10);
  f.priority.value = src.priority ?? 'any';
  f.period.value = src.period ?? 'day';
  if (src.listId) f.listId.value = src.listId;
  f.startDate.value = src.startDate ?? todayISO();
  f.deadline.value = src.deadline ?? '';
  f.notes.value = src.notes ?? '';
  f.kind.disabled = Boolean(goal); // the kind of an existing goal can't change: its progress means something else
  document.getElementById('goal-dialog-title').textContent = goal ? 'Edit goal' : 'New goal';
  document.getElementById('goal-submit').textContent = goal ? 'Save changes' : 'Create goal';
  syncGoalFields();
  goalDialog.showModal();
  f.title.focus();
}

function closeGoalDialog() {
  goalDialog.close();
  editingGoalId = null;
  goalReturnFocus?.isConnected && goalReturnFocus.focus();
}
if (goalFormReady) wireDialog(goalDialog, closeGoalDialog);

goalForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = goalForm.elements;
  const editing = editingGoalId ? store.getGoal(editingGoalId) : null;
  const input = {
    title: f.title.value, notes: f.notes.value, kind: editing?.kind ?? f.kind.value, target: f.target.value,
    priority: f.priority.value, period: f.period.value, listId: f.listId.value, startDate: f.startDate.value, deadline: f.deadline.value,
  };
  const { goal, errors } = store.validateGoal(input);
  ['title', 'kind', 'target', 'listId', 'startDate', 'deadline'].forEach((name) => setGoalError(name, errors?.[name]));
  if (errors) {
    const first = ['title', 'kind', 'target', 'listId', 'startDate', 'deadline'].find((n) => errors[n]);
    f[first]?.focus();
    return;
  }
  try {
    if (editing) {
      // A completed goal whose target was raised past what it reached becomes active again.
      const reopen = editing.status === 'completed' && goal.target > (editing.achieved ?? 0) && goal.kind !== 'list';
      store.updateGoal(editing.id, { ...goal, ...(reopen ? { status: 'active', achieved: null, completedAt: null } : {}) });
      toast(reopen ? 'Goal updated and active again' : 'Goal updated');
    } else {
      store.addGoal(goal);
      toast('Goal created');
    }
    closeGoalDialog();
  } catch (err) {
    console.error(err);
    toast(err.message === 'Too many goals' ? 'You can have up to 200 goals.' : 'Something went wrong. Please try again.', { tone: 'error' });
  }
});

// ---- Confirm ---------------------------------------------------------------

const confirmDialog = document.getElementById('confirm-dialog');

/** Resolves to true when the user confirms. */
export function confirmAction({ title, message, confirmLabel = 'Delete', tone = 'danger' }) {
  const opener = document.activeElement;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  const ok = document.getElementById('confirm-ok');
  ok.textContent = confirmLabel;
  ok.className = `btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`;
  confirmDialog.showModal();

  return new Promise((resolve) => {
    const finish = (result) => {
      confirmDialog.removeEventListener('click', onClick);
      confirmDialog.removeEventListener('cancel', onCancel);
      confirmDialog.close();
      opener?.isConnected && opener.focus();
      resolve(result);
    };
    const onClick = (e) => {
      const button = e.target.closest('button[value]');
      if (button) {
        e.preventDefault();
        finish(button.value === 'confirm');
      } else if (e.target === confirmDialog) {
        finish(false); // backdrop
      }
    };
    const onCancel = (e) => {
      e.preventDefault();
      finish(false); // Esc
    };
    confirmDialog.addEventListener('click', onClick);
    confirmDialog.addEventListener('cancel', onCancel);
  });
}


const choiceDialog = document.getElementById('choice-dialog');

/**
 * Asks the person to pick one of `options` ([{ value, label, tone }]). The dialog
 * can't be dismissed with Esc or the backdrop, because both choices matter.
 */
export function chooseAction({ title, message, options }) {
  document.getElementById('choice-title').textContent = title;
  document.getElementById('choice-message').textContent = message;
  const actions = document.getElementById('choice-actions');
  actions.innerHTML = '';
  for (const o of options) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: o.label });
    b.className = `btn ${o.tone === 'primary' ? 'btn--primary' : 'btn--outline'}`;
    b.dataset.value = o.value;
    actions.append(b);
  }
  choiceDialog.showModal();
  return new Promise((resolve) => {
    const onClick = (e) => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      choiceDialog.removeEventListener('click', onClick);
      choiceDialog.removeEventListener('cancel', onCancel);
      choiceDialog.close();
      resolve(b.dataset.value);
    };
    const onCancel = (e) => e.preventDefault();
    choiceDialog.addEventListener('click', onClick);
    choiceDialog.addEventListener('cancel', onCancel);
  });
}
