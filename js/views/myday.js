// My Day — the screen people open every morning.

import * as store from '../store.js';
import { addDays, formatLong, formatShort, formatTime, greeting, isValidISO, relativeDay, todayISO } from '../dates.js';
import { openTaskDialog } from '../dialogs.js';
import { emptyState, handleTaskAction, handleTaskToggle, sortActive, sortByDate, sortDone, taskRow } from '../components.js';
import { esc, icon, toast } from '../ui.js';
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'To do' },
  { id: 'done', label: 'Done' },
];
const UPCOMING_LIMIT = 5;

// UI state for this view (not persisted — My Day always opens on today).
const view = {
  date: todayISO(),
  filter: 'all',
  query: '',
};

export const title = 'My Day';

export function setQuery(q) {
  view.query = q.trim();
}

/** Called when the calendar day rolls over while the app is open. */
export function onDayChanged(previousToday) {
  if (view.date === previousToday) view.date = todayISO();
}

// ---- Selectors --------------------------------------------------------------

function tasksFor(date) {
  return store.getTasks().filter((t) => t.date === date);
}

function overdueTasks(today) {
  return store.getTasks().filter((t) => !t.completed && t.date < today).sort(sortByDate);
}

function upcomingTasks(today) {
  return store.getTasks()
    .filter((t) => !t.completed && t.date > today)
    .sort(sortByDate)
    .slice(0, UPCOMING_LIMIT);
}

// ---- Templates ----------------------------------------------------------------

const addButton = (label, cls = 'btn--primary') =>
  `<button class="btn ${cls}" type="button" data-action="add" data-focus-key="add-${cls}">${icon('plus')}${label}</button>`;

function statCard({ iconName, tone, value, label, extra = '' }) {
  return `
    <div class="stat">
      <div class="stat__icon stat__icon--${tone}">${icon(iconName)}</div>
      <div>
        <p class="stat__value">${value}</p>
        <p class="stat__label">${label}</p>
      </div>
      ${extra}
    </div>`;
}

function renderStats(dayTasks, isToday) {
  const total = dayTasks.length;
  const done = dayTasks.filter((t) => t.completed).length;
  const left = total - done;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const scope = isToday ? 'today' : `on ${formatShort(view.date)}`;
  return `
    <section class="stats" aria-label="Summary for ${esc(scope)}">
      ${statCard({ iconName: 'list', tone: 'blue', value: total, label: `Planned ${esc(scope)}` })}
      ${statCard({ iconName: 'clock', tone: 'amber', value: left, label: 'Left to do' })}
      ${statCard({ iconName: 'check', tone: 'green', value: done, label: 'Completed' })}
      ${statCard({
        iconName: 'chart', tone: 'violet', value: `${pct}%`, label: 'Day progress',
        extra: `<div class="progress" role="progressbar" aria-label="Day progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${done} of ${total} tasks done"><span style="width:${pct}%"></span></div>`,
      })}
    </section>`;
}

function renderDayHeader(dayTasks, today) {
  const isToday = view.date === today;
  const heading = isToday ? 'Today’s tasks' : `Tasks for ${formatShort(view.date)}`;
  const counts = {
    all: dayTasks.length,
    todo: dayTasks.filter((t) => !t.completed).length,
    done: dayTasks.filter((t) => t.completed).length,
  };
  return `
    <div class="card__head card__head--wrap">
      <div>
        <h2 class="card__title">${esc(heading)}</h2>
        <p class="card__subtitle">${esc(formatLong(view.date))}</p>
      </div>
      <div class="day-nav" role="group" aria-label="Choose a day">
        <button class="icon-btn icon-btn--outline" type="button" data-action="prev-day" data-focus-key="prev-day" aria-label="Previous day">${icon('chevron-left')}</button>
        <button class="btn btn--outline btn--sm" type="button" data-action="go-today" data-focus-key="go-today" ${isToday ? 'aria-current="date"' : ''}>Today</button>
        <button class="icon-btn icon-btn--outline" type="button" data-action="next-day" data-focus-key="next-day" aria-label="Next day">${icon('chevron-right')}</button>
        <label class="visually-hidden" for="day-picker">Pick a date</label>
        <input class="input input--sm day-nav__picker" id="day-picker" type="date" value="${view.date}" data-action="pick-day" data-focus-key="pick-day">
      </div>
    </div>
    <div class="tabs" role="group" aria-label="Show tasks">
      ${FILTERS.map((f) => `
        <button class="tab" type="button" data-action="filter" data-filter="${f.id}" data-focus-key="filter-${f.id}" aria-pressed="${view.filter === f.id}">
          ${f.label} <span class="tab__count">${counts[f.id]}</span>
        </button>`).join('')}
    </div>`;
}

function renderDayList(dayTasks, today) {
  const isToday = view.date === today;
  const isPast = view.date < today;
  const active = dayTasks.filter((t) => !t.completed).sort(sortActive);
  const done = dayTasks.filter((t) => t.completed).sort(sortDone);
  const overdue = isToday && view.filter !== 'done' ? overdueTasks(today) : [];
  const dayName = isToday ? 'today' : formatShort(view.date);
  let html = '';

  if (overdue.length) {
    html += `
      <section class="task-group task-group--overdue" aria-labelledby="overdue-h">
        <h3 class="task-group__title" id="overdue-h">Not finished from earlier days <span class="tab__count">${overdue.length}</span></h3>
        <ul class="task-list">${overdue.map((t) => taskRow(t, { today, showDate: true, canMoveToToday: true })).join('')}</ul>
      </section>`;
  }

  const showActive = view.filter !== 'done';
  const showDone = view.filter !== 'todo';
  const visible = (showActive ? active.length : 0) + (showDone ? done.length : 0);

  if (!visible) {
    if (dayTasks.length === 0) {
      const firstTime = store.getTasks().length === 0;
      html += emptyState(firstTime ? {
        iconName: 'sun',
        heading: 'Let’s plan your day',
        text: 'Add the things you want to get done — appointments, calls, errands. You can add a time and priority if you like.',
        action: addButton('Add your first task'),
      } : {
        iconName: 'sun',
        heading: isPast ? `Nothing was planned for ${esc(dayName)}` : `Your ${isToday ? 'day' : esc(dayName)} is clear`,
        text: isPast ? 'Use the arrows to go back to today.' : 'Nothing planned yet. Add a task whenever you’re ready.',
        action: isPast ? '' : addButton('Add task'),
      });
    } else if (view.filter === 'todo') {
      html += emptyState({
        iconName: 'check-circle',
        heading: 'All done!',
        text: `Every task for ${esc(dayName)} is checked off. Well done.`,
      });
    } else {
      html += emptyState({
        iconName: 'check-circle',
        heading: 'Nothing completed yet',
        text: 'Tick the circle next to a task when it’s done and it will show up here.',
      });
    }
    return html;
  }

  if (showActive && active.length) {
    html += `<ul class="task-list" aria-label="To do">${active.map((t) => taskRow(t, { today })).join('')}</ul>`;
  }
  if (showDone && done.length) {
    html += `
      <section class="task-group" aria-labelledby="done-h">
        <h3 class="task-group__title" id="done-h">Completed <span class="tab__count">${done.length}</span></h3>
        <ul class="task-list">${done.map((t) => taskRow(t, { today })).join('')}</ul>
      </section>`;
  }
  if (!isPast) {
    html += `<button class="add-inline" type="button" data-action="add" data-focus-key="add-inline">${icon('plus')}Add a task for ${esc(dayName)}</button>`;
  }
  return html;
}

function renderSearch(today) {
  const q = view.query.toLowerCase();
  const results = store.getTasks()
    .filter((t) => t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q))
    .sort(sortByDate);
  return `
    <div class="card__head">
      <div>
        <h2 class="card__title">Search results</h2>
        <p class="card__subtitle">${results.length} ${results.length === 1 ? 'task' : 'tasks'} matching “${esc(view.query)}”</p>
      </div>
      <button class="btn btn--outline btn--sm" type="button" data-action="clear-search" data-focus-key="clear-search">${icon('close')}Clear search</button>
    </div>
    ${results.length
      ? `<ul class="task-list">${results.map((t) => taskRow(t, { today, showDate: true })).join('')}</ul>`
      : emptyState({ iconName: 'search', heading: 'No matching tasks', text: 'Try a different word, or clear the search to see your day.' })}`;
}

function renderUpcoming(today) {
  const items = upcomingTasks(today);
  return `
    <section class="card" aria-labelledby="upcoming-h">
      <div class="card__head">
        <h2 class="card__title" id="upcoming-h">${icon('calendar', 'card__title-icon')}Coming up</h2>
      </div>
      ${items.length ? `
        <ul class="upcoming">
          ${items.map((t) => `
            <li>
              <button class="upcoming__item" type="button" data-action="go-date" data-date="${t.date}" data-focus-key="up-${esc(t.id)}">
                <span class="upcoming__bar upcoming__bar--${t.priority}" aria-hidden="true"></span>
                <span class="upcoming__title">${esc(t.title)}</span>
                <span class="upcoming__when">${esc(relativeDay(t.date, today))}${t.time ? ` · ${esc(formatTime(t.time))}` : ''}</span>
              </button>
            </li>`).join('')}
        </ul>` : `
        <p class="muted">Nothing scheduled for the coming days.</p>
        <button class="btn btn--soft btn--block" type="button" data-action="add-tomorrow" data-focus-key="add-tomorrow">${icon('plus')}Plan tomorrow</button>`}
    </section>`;
}

function renderPlusCard() {
  return `
    <section class="card card--plus" aria-labelledby="plus-h">
      <div class="plus__head">
        <span class="plus__crown">${icon('crown')}</span>
        <div>
          <h2 class="card__title" id="plus-h">DailyMate Plus</h2>
          <p class="plus__price">$7.99 CAD / month <span class="badge">Coming soon</span></p>
        </div>
      </div>
      <ul class="checklist">
        <li>${icon('check')}Plan your day with AI</li>
        <li>${icon('check')}Turn a note into tasks</li>
        <li>${icon('check')}Up to 100 AI requests a month</li>
      </ul>
      <a class="btn btn--outline btn--block" href="#/profile" data-focus-key="see-plans">Compare plans</a>
    </section>`;
}

export function render() {
  const today = todayISO();
  const name = store.getProfile().name;
  const dayTasks = tasksFor(view.date);
  const searching = Boolean(view.query);

  return `
    <div class="page">
      <header class="page-head">
        <div class="hello">
          <span class="hello__sun" aria-hidden="true">${icon('sun')}</span>
          <div>
            <p class="eyebrow">My Day</p>
            <h1 class="hello__title">${esc(greeting())}${name ? `, ${esc(name)}` : ''}!</h1>
            <p class="hello__date">${esc(formatLong(today))}</p>
          </div>
        </div>
        ${addButton('Add task', 'btn--primary btn--lg')}
      </header>

      ${searching ? '' : renderStats(dayTasks, view.date === today)}

      <div class="myday-grid">
        <section class="card card--tasks" aria-label="Tasks">
          ${searching ? renderSearch(today) : renderDayHeader(dayTasks, today) + renderDayList(dayTasks, today)}
        </section>
        <aside class="side-col" aria-label="More">
          ${renderUpcoming(today)}
          ${renderPlusCard()}
        </aside>
      </div>
    </div>`;
}

// ---- Events -------------------------------------------------------------------

/** Return true when the view's UI state changed and needs a re-render. */
export async function onClick(e, { rerender, clearSearch }) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const today = todayISO();

  switch (action) {
    case 'add':
      // Don't offer past days as default — new tasks go to today instead.
      openTaskDialog({ date: view.date < today ? today : view.date });
      break;
    case 'add-tomorrow':
      openTaskDialog({ date: addDays(today, 1) });
      break;
    case 'edit':
    case 'delete':
    case 'remind':
      await handleTaskAction(action, id);
      break;
    case 'move-today':
      store.updateTask(id, { date: today });
      toast('Moved to today');
      break;
    case 'prev-day': view.date = addDays(view.date, -1); rerender(); break;
    case 'next-day': view.date = addDays(view.date, 1); rerender(); break;
    case 'go-today': view.date = today; rerender(); break;
    case 'go-date':
      view.date = el.dataset.date;
      view.filter = 'all';
      rerender();
      document.querySelector('.card--tasks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    case 'filter': view.filter = el.dataset.filter; rerender(); break;
    case 'clear-search': clearSearch(); break;
    default: break;
  }
}

export function onChange(e, { rerender }) {
  const el = e.target;
  if (el.dataset.action === 'toggle') {
    handleTaskToggle(el);
  } else if (el.dataset.action === 'pick-day') {
    if (isValidISO(el.value)) {
      view.date = el.value;
      rerender();
    }
  }
}
