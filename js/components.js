// Building blocks shared by several screens, so a task looks and behaves the
// same in My Day, the Planner and search results.

import * as store from './store.js';
import { formatTime, relativeDay } from './dates.js';
import { describeRepeat } from './repeat.js';
import { openTaskDialog, openReminderDialog, confirmAction } from './dialogs.js';
import { esc, icon, toast } from './ui.js';

export const PRIORITY_RANK = { high: 0, medium: 1, low: 2, none: 3 };
export const PRIORITY_LABEL = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };

export function sortActive(a, b) {
  if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
  if (Boolean(a.time) !== Boolean(b.time)) return a.time ? -1 : 1;
  if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  return a.createdAt < b.createdAt ? -1 : 1;
}

export function sortByDate(a, b) {
  return a.date === b.date ? sortActive(a, b) : a.date < b.date ? -1 : 1;
}

export function sortDone(a, b) {
  return (a.completedAt ?? '') < (b.completedAt ?? '') ? -1 : 1;
}

/** Active reminders linked to a task. */
export function remindersFor(taskId) {
  return store.getReminders().filter((r) => r.taskId === taskId && !r.done);
}

export function taskRow(task, { today, showDate = false, canMoveToToday = false }) {
  const overdue = !task.completed && task.date < today;
  const linked = remindersFor(task.id);
  const chips = [];
  if (task.completed) chips.push(`<span class="chip chip--done">${icon('check')}Done</span>`);
  if (overdue) chips.push(`<span class="chip chip--overdue">${icon('alert')}Overdue</span>`);
  if (showDate) chips.push(`<span class="chip">${icon('calendar')}${esc(relativeDay(task.date, today))}</span>`);
  if (task.time) chips.push(`<span class="chip">${icon('clock')}${esc(formatTime(task.time))}</span>`);
  if (task.priority !== 'none') {
    chips.push(`<span class="chip chip--${task.priority}">${icon('flag')}${PRIORITY_LABEL[task.priority]}</span>`);
  }
  if (task.repeat && !task.completed) chips.push(`<span class="chip">${icon('repeat')}${esc(describeRepeat(task.repeat, task.date))}</span>`);
  if (linked.length) {
    const r = linked[0];
    chips.push(`<a class="chip chip--link" href="#/reminders" title="Open reminders">${icon('bell')}Reminder ${esc(relativeDay(r.date, today))}, ${esc(formatTime(r.time))}</a>`);
  }

  return `
    <li class="task ${task.completed ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}">
      <label class="check">
        <input type="checkbox" data-action="toggle" data-id="${esc(task.id)}" data-focus-key="toggle-${esc(task.id)}" ${task.completed ? 'checked' : ''}>
        <span class="check__box" aria-hidden="true">${icon('check')}</span>
        <span class="visually-hidden">${task.completed ? 'Completed' : 'Mark as done'}: ${esc(task.title)}</span>
      </label>
      <div class="task__body">
        <p class="task__title">${esc(task.title)}</p>
        ${chips.length ? `<div class="task__meta">${chips.join('')}</div>` : ''}
        ${task.notes ? `<p class="task__notes">${esc(task.notes)}</p>` : ''}
      </div>
      <div class="task__actions">
        ${canMoveToToday ? `<button class="btn btn--soft btn--sm" type="button" data-action="move-today" data-id="${esc(task.id)}" data-focus-key="move-${esc(task.id)}">Move to today</button>` : ''}
        ${task.completed ? '' : `<button class="icon-btn" type="button" data-action="remind" data-id="${esc(task.id)}" data-focus-key="remind-${esc(task.id)}" aria-label="Set a reminder: ${esc(task.title)}" title="Set a reminder">${icon('bell')}</button>`}
        <button class="icon-btn" type="button" data-action="edit" data-id="${esc(task.id)}" data-focus-key="edit-${esc(task.id)}" aria-label="Edit: ${esc(task.title)}" title="Edit">${icon('edit')}</button>
        <button class="icon-btn icon-btn--danger" type="button" data-action="delete" data-id="${esc(task.id)}" aria-label="Delete: ${esc(task.title)}" title="Delete">${icon('trash')}</button>
      </div>
    </li>`;
}

export function emptyState({ iconName, heading, text, action = '' }) {
  return `
    <div class="empty">
      <div class="empty__icon">${icon(iconName)}</div>
      <h3 class="empty__title">${heading}</h3>
      <p class="empty__text">${text}</p>
      ${action}
    </div>`;
}

// ---- Task actions ---------------------------------------------------------------

/** Handles edit / delete / remind on a task. Returns true if the action was handled. */
export async function handleTaskAction(action, id) {
  const task = store.getTask(id);
  if (!task) return false;
  if (action === 'edit') {
    openTaskDialog({ task });
    return true;
  }
  if (action === 'remind') {
    openReminderDialog({ task });
    return true;
  }
  if (action === 'delete') {
    const linked = remindersFor(id).length;
    const ok = await confirmAction({
      title: 'Delete this task?',
      message: `“${task.title}” will be removed. This can’t be undone.${task.repeat ? ' Future repeats of it will stop too.' : ''}${linked ? ' Its reminder will be kept.' : ''}`,
    });
    if (ok) {
      store.deleteTask(id);
      toast('Task deleted');
      document.getElementById('main').focus();
    }
    return true;
  }
  return false;
}

/** Handles the "done" checkbox on a task row. */
export function handleTaskToggle(el) {
  const task = store.setCompleted(el.dataset.id, el.checked);
  if (!task.completed) return;
  const next = task.nextId ? store.getTask(task.nextId) : null;
  toast(next ? `Done — next one added for ${relativeDay(next.date)}` : 'Nice work — task completed');
}
