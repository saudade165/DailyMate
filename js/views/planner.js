// Planner — day, week and month views over the same tasks as My Day.
// Address: #/planner/<day|week|month>/<YYYY-MM-DD>

import * as store from '../store.js';
import {
  addDays, addMonths, dayNumber, formatLong, formatMonth, formatRange, formatShort, formatTime,
  isValidISO, relativeDay, startOfMonth, startOfWeek, todayISO, weekdayShort,
} from '../dates.js';
import { describeRepeat, occurrencesBetween } from '../repeat.js';
import { openTaskDialog, openReminderDialog } from '../dialogs.js';
import { emptyState, handleTaskAction, handleTaskToggle, sortActive, sortDone, taskRow, PRIORITY_LABEL } from '../components.js';
import { esc, icon, toast } from '../ui.js';

const VIEWS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];
const MONTH_PILLS = 3;

function stateFrom(params) {
  const view = VIEWS.some((v) => v.id === params[0]) ? params[0] : 'week';
  const date = isValidISO(params[1]) ? params[1] : todayISO();
  return { view, date };
}

export function pageTitle(params) {
  const { view } = stateFrom(params);
  return `Planner — ${VIEWS.find((v) => v.id === view).label}`;
}

// ---- Data -----------------------------------------------------------------------

/** Tasks per date in [from, to], plus previews of repeating tasks ("ghosts"). */
function buildDays(from, to) {
  const days = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { tasks: [], ghosts: [] });
  for (const t of store.getTasks()) {
    if (t.date >= from && t.date <= to) days.get(t.date).tasks.push(t);
    if (t.repeat && !t.completed) {
      for (const d of occurrencesBetween(t.date, t.repeat, from, to)) days.get(d).ghosts.push(t);
    }
  }
  for (const day of days.values()) {
    day.tasks.sort((a, b) => (a.completed === b.completed ? sortActive(a, b) : a.completed ? 1 : -1));
    day.ghosts.sort(sortActive);
  }
  return days;
}

function remindersOn(date) {
  return store.getReminders()
    .filter((r) => !r.done && r.date === date)
    .sort((a, b) => (a.time < b.time ? -1 : 1));
}

// ---- Templates --------------------------------------------------------------------

function toolbar({ view, date }, today) {
  let title;
  if (view === 'day') title = formatLong(date);
  else if (view === 'week') title = formatRange(startOfWeek(date), addDays(startOfWeek(date), 6));
  else title = formatMonth(date);
  const unit = view === 'day' ? 'day' : view === 'week' ? 'week' : 'month';
  const isCurrent = view === 'day' ? date === today
    : view === 'week' ? startOfWeek(date) === startOfWeek(today)
      : startOfMonth(date) === startOfMonth(today);
  return `
    <section class="card planner-bar" aria-label="Planner controls">
      <div class="tabs planner-bar__views" role="group" aria-label="View">
        ${VIEWS.map((v) => `<button class="tab" type="button" data-action="view" data-view="${v.id}" data-focus-key="view-${v.id}" aria-pressed="${view === v.id}">${v.label}</button>`).join('')}
      </div>
      <h2 class="planner-bar__title" aria-live="polite">${esc(title)}</h2>
      <div class="day-nav" role="group" aria-label="Change ${unit}">
        <button class="icon-btn icon-btn--outline" type="button" data-action="prev" data-focus-key="prev" aria-label="Previous ${unit}">${icon('chevron-left')}</button>
        <button class="btn btn--outline btn--sm" type="button" data-action="today" data-focus-key="today" ${isCurrent ? 'aria-current="date"' : ''}>Today</button>
        <button class="icon-btn icon-btn--outline" type="button" data-action="next" data-focus-key="next" aria-label="Next ${unit}">${icon('chevron-right')}</button>
        <label class="visually-hidden" for="planner-picker">Go to date</label>
        <input class="input input--sm day-nav__picker" id="planner-picker" type="date" value="${date}" data-action="pick" data-focus-key="pick">
      </div>
    </section>`;
}

function priorityClass(t) {
  return t.priority !== 'none' ? ` is-${t.priority}` : '';
}

/** Compact task card used in week and month views. */
function miniTask(t, today) {
  const overdue = !t.completed && t.date < today;
  const meta = [t.time ? formatTime(t.time) : '', t.repeat && !t.completed ? 'Repeats' : ''].filter(Boolean).join(' · ');
  return `
    <li class="mini${t.completed ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}${priorityClass(t)}" draggable="true" data-drag-id="${esc(t.id)}">
      <label class="check check--sm">
        <input type="checkbox" data-action="toggle" data-id="${esc(t.id)}" data-focus-key="mtoggle-${esc(t.id)}" ${t.completed ? 'checked' : ''}>
        <span class="check__box" aria-hidden="true">${icon('check')}</span>
        <span class="visually-hidden">${t.completed ? 'Completed' : 'Mark as done'}: ${esc(t.title)}</span>
      </label>
      <button class="mini__body" type="button" data-action="edit" data-id="${esc(t.id)}" data-focus-key="medit-${esc(t.id)}" aria-label="Edit: ${esc(t.title)}${t.time ? `, ${esc(formatTime(t.time))}` : ''}${t.priority !== 'none' ? `, ${PRIORITY_LABEL[t.priority]}` : ''}${overdue ? ', overdue' : ''}">
        <span class="mini__title">${esc(t.title)}</span>
        ${meta ? `<span class="mini__meta">${esc(meta)}</span>` : ''}
      </button>
    </li>`;
}

function ghostTask(t, date) {
  return `
    <li class="mini mini--ghost">
      <span class="mini__ghost-icon" aria-hidden="true">${icon('repeat')}</span>
      <button class="mini__body" type="button" data-action="edit" data-id="${esc(t.id)}" aria-label="Repeat of “${esc(t.title)}” on ${esc(formatShort(date))} — edit the repeating task">
        <span class="mini__title">${esc(t.title)}</span>
        <span class="mini__meta">${esc([t.time ? formatTime(t.time) : '', 'Repeats'].filter(Boolean).join(' · '))}</span>
      </button>
    </li>`;
}

function renderWeek(date, today) {
  const from = startOfWeek(date);
  const to = addDays(from, 6);
  const days = buildDays(from, to);
  return `
    <section class="week" aria-label="Week of ${esc(formatShort(from))}">
      ${[...days.entries()].map(([d, { tasks, ghosts }]) => {
        const isToday = d === today;
        const open = tasks.filter((t) => !t.completed).length;
        return `
        <div class="week__day${isToday ? ' is-today' : ''}${d < today ? ' is-past' : ''}" data-drop-date="${d}">
          <div class="week__head">
            <button class="week__date" type="button" data-action="open-day" data-date="${d}" data-focus-key="wday-${d}" aria-label="${esc(formatLong(d))}${isToday ? ', today' : ''}: ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}. Open day view">
              <span class="week__dow">${esc(weekdayShort(d))}</span>
              <span class="week__num">${dayNumber(d)}</span>
            </button>
            ${tasks.length ? `<span class="week__count" aria-hidden="true">${open ? `${open} to do` : 'All done'}</span>` : ''}
          </div>
          <ul class="mini-list">
            ${tasks.map((t) => miniTask(t, today)).join('')}
            ${ghosts.map((t) => ghostTask(t, d)).join('')}
          </ul>
          ${d >= today ? `<button class="week__add" type="button" data-action="add" data-date="${d}" data-focus-key="wadd-${d}" aria-label="Add a task on ${esc(formatShort(d))}">${icon('plus')}<span>Add</span></button>` : ''}
        </div>`;
      }).join('')}
    </section>`;
}

function dayDots(tasks, ghosts, today, date) {
  if (!tasks.length && !ghosts.length) return '';
  const open = tasks.filter((t) => !t.completed);
  const overdue = date < today && open.length;
  const dots = [...open.slice(0, 4).map((t) => `<span class="dot dot--${t.priority}"></span>`)];
  if (!open.length && tasks.length) dots.push('<span class="dot dot--done"></span>');
  if (ghosts.length && dots.length < 4) dots.push('<span class="dot dot--ghost"></span>');
  return `<span class="mcell__dots${overdue ? ' is-overdue' : ''}" aria-hidden="true">${dots.join('')}</span>`;
}

function cellLabel(d, tasks, ghosts, today) {
  const open = tasks.filter((t) => !t.completed).length;
  const parts = [formatLong(d)];
  if (d === today) parts.push('today');
  if (tasks.length) parts.push(`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}${open && open !== tasks.length ? `, ${open} to do` : !open ? ', all done' : ''}`);
  else parts.push('no tasks');
  if (open && d < today) parts.push('some not finished');
  if (ghosts.length) parts.push(`${ghosts.length} repeating`);
  return parts.join(', ');
}

function renderMonth(date, today) {
  const first = startOfMonth(date);
  const from = startOfWeek(first);
  const lastOfMonth = addDays(addMonths(first, 1), -1);
  const to = addDays(startOfWeek(lastOfMonth), 6);
  const days = buildDays(from, to);
  const month = first.slice(0, 7);
  const weekdays = [...Array(7)].map((_, i) => weekdayShort(addDays(from, i)));
  return `
    <section class="month" aria-label="${esc(formatMonth(date))}">
      <div class="month__dow" aria-hidden="true">${weekdays.map((w) => `<span>${esc(w)}</span>`).join('')}</div>
      <div class="month__grid">
        ${[...days.entries()].map(([d, { tasks, ghosts }]) => {
          const shownTasks = [...tasks.filter((t) => !t.completed), ...tasks.filter((t) => t.completed)];
          const items = [...shownTasks.map((t) => ({ t })), ...ghosts.map((t) => ({ t, ghost: true }))];
          const more = items.length - MONTH_PILLS;
          return `
          <div class="mcell${d.slice(0, 7) !== month ? ' is-outside' : ''}${d === today ? ' is-today' : ''}${d === date ? ' is-selected' : ''}" data-drop-date="${d}">
            <button class="mcell__day" type="button" data-action="select" data-date="${d}" data-focus-key="mday-${d}" aria-pressed="${d === date}" aria-label="${esc(cellLabel(d, tasks, ghosts, today))}">
              <span class="mcell__num">${dayNumber(d)}</span>
              ${dayDots(tasks, ghosts, today, d)}
            </button>
            <ul class="mcell__pills">
              ${items.slice(0, MONTH_PILLS).map(({ t, ghost }) => `
                <li class="pill${ghost ? ' pill--ghost' : ''}${t.completed ? ' is-done' : ''}${priorityClass(t)}" ${ghost ? '' : `draggable="true" data-drag-id="${esc(t.id)}"`}>
                  <button type="button" data-action="edit" data-id="${esc(t.id)}" tabindex="-1" aria-hidden="true">${ghost ? icon('repeat') : ''}${esc(t.title)}</button>
                </li>`).join('')}
              ${more > 0 ? `<li class="pill pill--more"><button type="button" data-action="select" data-date="${d}" tabindex="-1" aria-hidden="true">+${more} more</button></li>` : ''}
            </ul>
          </div>`;
        }).join('')}
      </div>
    </section>`;
}

/** Full task list for one day (Day view, and the selected day in Month view). */
function renderAgenda(date, today, { heading = true } = {}) {
  const day = buildDays(date, date).get(date);
  const active = day.tasks.filter((t) => !t.completed).sort(sortActive);
  const done = day.tasks.filter((t) => t.completed).sort(sortDone);
  const reminders = remindersOn(date);
  const isPast = date < today;
  let body = '';

  if (!day.tasks.length && !day.ghosts.length) {
    body = emptyState({
      iconName: 'calendar',
      heading: isPast ? 'Nothing was planned' : 'Nothing planned yet',
      text: isPast ? `There were no tasks on ${esc(formatShort(date))}.` : `Add something for ${esc(relativeDay(date, today).toLowerCase() === 'today' ? 'today' : formatShort(date))} — an appointment, a call or an errand.`,
      action: isPast ? '' : `<button class="btn btn--primary" type="button" data-action="add" data-date="${date}" data-focus-key="agenda-add-empty">${icon('plus')}Add task</button>`,
    });
  } else {
    if (active.length) body += `<ul class="task-list" aria-label="To do">${active.map((t) => taskRow(t, { today })).join('')}</ul>`;
    if (day.ghosts.length) {
      body += `
        <section class="task-group" aria-labelledby="ghost-h-${date}">
          <h3 class="task-group__title" id="ghost-h-${date}">${icon('repeat')}Repeating — will appear here <span class="tab__count">${day.ghosts.length}</span></h3>
          <ul class="task-list">${day.ghosts.map((t) => `
            <li class="task task--ghost">
              <span class="task__ghost-icon" aria-hidden="true">${icon('repeat')}</span>
              <div class="task__body">
                <p class="task__title">${esc(t.title)}</p>
                <div class="task__meta">
                  ${t.time ? `<span class="chip">${icon('clock')}${esc(formatTime(t.time))}</span>` : ''}
                  <span class="chip">${icon('repeat')}${esc(describeRepeat(t.repeat, t.date))}</span>
                </div>
              </div>
              <div class="task__actions">
                <button class="btn btn--outline btn--sm" type="button" data-action="edit" data-id="${esc(t.id)}">Edit series</button>
              </div>
            </li>`).join('')}
          </ul>
          <p class="muted small">Repeating tasks are added one at a time: the next one appears when you tick off the current one.</p>
        </section>`;
    }
    if (done.length) {
      body += `
        <section class="task-group" aria-labelledby="done-h-${date}">
          <h3 class="task-group__title" id="done-h-${date}">Completed <span class="tab__count">${done.length}</span></h3>
          <ul class="task-list">${done.map((t) => taskRow(t, { today })).join('')}</ul>
        </section>`;
    }
    if (!isPast) body += `<button class="add-inline" type="button" data-action="add" data-date="${date}" data-focus-key="agenda-add">${icon('plus')}Add a task for ${esc(relativeDay(date, today) === 'Today' ? 'today' : formatShort(date))}</button>`;
  }

  if (reminders.length) {
    body += `
      <section class="task-group" aria-labelledby="rem-h-${date}">
        <h3 class="task-group__title" id="rem-h-${date}">${icon('bell')}Reminders <span class="tab__count">${reminders.length}</span></h3>
        <ul class="agenda-reminders">${reminders.map((r) => `
          <li><button class="agenda-reminder" type="button" data-action="edit-reminder" data-id="${esc(r.id)}">
            <span class="agenda-reminder__time">${esc(formatTime(r.time))}</span>
            <span class="agenda-reminder__title">${esc(r.title)}</span>
            ${icon('chevron-right')}
          </button></li>`).join('')}
        </ul>
      </section>`;
  }

  const done_ = day.tasks.length ? `${done.length} of ${day.tasks.length} done` : '';
  return `
    <section class="card card--tasks agenda" aria-labelledby="agenda-h">
      ${heading ? `
      <div class="card__head card__head--wrap">
        <div>
          <h2 class="card__title" id="agenda-h">${esc(relativeDay(date, today) === formatShort(date) ? formatShort(date) : `${relativeDay(date, today)} · ${formatShort(date)}`)}</h2>
          <p class="card__subtitle">${esc(formatLong(date))}${done_ ? ` · ${done_}` : ''}</p>
        </div>
        ${isPast ? '' : `<button class="btn btn--soft btn--sm" type="button" data-action="add-reminder" data-date="${date}" data-focus-key="agenda-remind">${icon('bell')}Add reminder</button>`}
      </div>` : ''}
      ${body}
    </section>`;
}

export function render(params) {
  const s = stateFrom(params);
  const today = todayISO();
  let content;
  if (s.view === 'day') content = renderAgenda(s.date, today);
  else if (s.view === 'week') content = renderWeek(s.date, today);
  else content = `<div class="month-layout">${renderMonth(s.date, today)}${renderAgenda(s.date, today)}</div>`;

  const total = store.getTasks().length;
  return `
    <div class="page page--planner">
      <header class="page-head">
        <div>
          <p class="eyebrow">Planner</p>
          <h1 class="page-title">Plan your ${s.view}</h1>
          <p class="page-subtitle">${total ? 'Tasks here are the same as in My Day — change them in either place.' : 'Add tasks to any day. They also show up in My Day.'}</p>
        </div>
        <button class="btn btn--primary btn--lg" type="button" data-action="add" data-date="${s.date < today ? today : s.date}" data-focus-key="add-top">${icon('plus')}Add task</button>
      </header>
      ${toolbar(s, today)}
      ${content}
      ${s.view !== 'day' ? '<p class="planner-hint muted">Tip: on a computer you can drag a task to another day.</p>' : ''}
    </div>`;
}

// ---- Events -------------------------------------------------------------------------

function go(ctx, view, date) {
  ctx.replacePath([view, date]);
}

export async function onClick(e, ctx) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const s = stateFrom(ctx.params());
  const today = todayISO();
  const { action, id } = el.dataset;
  const step = (dir) => {
    if (s.view === 'day') return addDays(s.date, dir);
    if (s.view === 'week') return addDays(s.date, 7 * dir);
    return addMonths(s.date, dir);
  };

  switch (action) {
    case 'view': go(ctx, el.dataset.view, s.date); break;
    case 'prev': go(ctx, s.view, step(-1)); break;
    case 'next': go(ctx, s.view, step(1)); break;
    case 'today': go(ctx, s.view, today); break;
    case 'select': go(ctx, s.view, el.dataset.date); break;
    case 'open-day': go(ctx, 'day', el.dataset.date); break;
    case 'add': {
      const date = el.dataset.date && el.dataset.date >= today ? el.dataset.date : today;
      openTaskDialog({ date });
      break;
    }
    case 'add-reminder':
      openReminderDialog({ date: el.dataset.date });
      break;
    case 'edit-reminder': {
      const r = store.getReminder(id);
      if (r) openReminderDialog({ reminder: r });
      break;
    }
    case 'move-today':
      store.updateTask(id, { date: today });
      toast('Moved to today');
      break;
    default:
      await handleTaskAction(action, id);
  }
}

export function onChange(e, ctx) {
  const el = e.target;
  if (el.dataset.action === 'toggle') handleTaskToggle(el);
  if (el.dataset.action === 'pick' && isValidISO(el.value)) go(ctx, stateFrom(ctx.params()).view, el.value);
}

// Drag a task to another day (week and month views).
let dragId = null;
export function onDrag(e) {
  const drop = e.target.closest?.('[data-drop-date]');
  switch (e.type) {
    case 'dragstart': {
      const item = e.target.closest?.('[data-drag-id]');
      if (!item) return;
      dragId = item.dataset.dragId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
      item.classList.add('is-dragging');
      break;
    }
    case 'dragover':
      if (!dragId || !drop) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.is-drop-target').forEach((x) => x !== drop && x.classList.remove('is-drop-target'));
      drop.classList.add('is-drop-target');
      break;
    case 'dragleave':
      if (drop && !drop.contains(e.relatedTarget)) drop.classList.remove('is-drop-target');
      break;
    case 'drop': {
      if (!dragId || !drop) return;
      e.preventDefault();
      const task = store.getTask(dragId);
      const date = drop.dataset.dropDate;
      dragId = null;
      if (task && task.date !== date) {
        store.updateTask(task.id, { date });
        toast(`Moved to ${relativeDay(date)}`);
      }
      break;
    }
    case 'dragend':
      dragId = null;
      document.querySelectorAll('.is-drop-target, .is-dragging').forEach((x) => x.classList.remove('is-drop-target', 'is-dragging'));
      break;
    default:
  }
}

