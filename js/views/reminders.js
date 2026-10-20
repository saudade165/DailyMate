// Reminders — things to be reminded about at a set time.
// Alerts are shown only while DailyMate is open (see alerts.js and README).

import * as store from '../store.js';
import { addDays, formatTime, fromNow, instantToLocal, localTimeZone, relativeDay, startOfWeek, todayISO } from '../dates.js';
import { describeRepeat } from '../repeat.js';
import { openReminderDialog, confirmAction } from '../dialogs.js';
import { emptyState } from '../components.js';
import { notificationPermission, requestNotifications } from '../alerts.js';
import { esc, icon, toast } from '../ui.js';

const TABS = [
  { id: 'active', label: 'Coming up' },
  { id: 'done', label: 'Done' },
];
let tab = 'active';

export const pageTitle = () => 'Reminders';

function classify(now) {
  const today = todayISO();
  const groups = { overdue: [], today: [], tomorrow: [], week: [], later: [] };
  const done = [];
  for (const r of store.getReminders()) {
    if (r.done) { done.push(r); continue; }
    const at = store.reminderAlertAt(r);
    const local = instantToLocal(at).date;
    if (at <= now) groups.overdue.push(r);
    else if (local === today) groups.today.push(r);
    else if (local === addDays(today, 1)) groups.tomorrow.push(r);
    else if (local < addDays(startOfWeek(today), 7)) groups.week.push(r);
    else groups.later.push(r);
  }
  const byTime = (a, b) => store.reminderAlertAt(a) - store.reminderAlertAt(b);
  Object.values(groups).forEach((g) => g.sort(byTime));
  done.sort((a, b) => ((a.doneAt ?? '') < (b.doneAt ?? '') ? 1 : -1));
  return { groups, done };
}

function reminderRow(r, now, { overdue = false } = {}) {
  const rid = esc(r.id);
  const due = store.reminderDueAt(r);
  const at = store.reminderAlertAt(r);
  const local = instantToLocal(r.done ? due : at);
  const snoozed = !r.done && r.snoozedUntil && r.snoozedUntil > due && r.snoozedUntil > now;
  const task = r.taskId ? store.getTask(r.taskId) : null;
  const otherZone = r.tz !== localTimeZone();
  const chips = [];
  if (overdue) chips.push(`<span class="chip chip--overdue">${icon('alert')}Overdue · ${esc(fromNow(at, now))}</span>`);
  else if (!r.done) chips.push(`<span class="chip">${icon('clock')}${esc(fromNow(at, now))}</span>`);
  if (r.done) {
    // "Done today" / "Done yesterday" / "Done Tue, Oct 13"
    const when = r.doneAt ? relativeDay(instantToLocal(Date.parse(r.doneAt)).date) : '';
    chips.push(`<span class="chip chip--done">${icon('check')}Done${when ? ` ${esc(/^(Today|Yesterday|Tomorrow)$/.test(when) ? when.toLowerCase() : when)}` : ''}</span>`);
  }
  if (snoozed) chips.push(`<span class="chip chip--medium">${icon('clock')}Snoozed</span>`);
  if (r.repeat) chips.push(`<span class="chip">${icon('repeat')}${esc(describeRepeat(r.repeat, r.date))}</span>`);
  if (task) chips.push(`<a class="chip chip--link" href="#/planner/day/${task.date}" title="${esc(task.title)}">${icon('check-circle')}<span class="chip__text">Task: ${esc(task.title)}</span></a>`);
  if (otherZone) chips.push(`<span class="chip" title="Set for ${esc(formatTime(r.time))} in ${esc(r.tz)}">${icon('globe')}Set in ${esc(r.tz)}</span>`);

  return `
    <li class="reminder${r.done ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}">
      <div class="reminder__when">
        <span class="reminder__day">${esc(relativeDay(local.date))}</span>
        <span class="reminder__time">${esc(formatTime(local.time))}</span>
      </div>
      <div class="reminder__body">
        <p class="reminder__title">${esc(r.title)}</p>
        <div class="task__meta">${chips.join('')}</div>
        ${r.notes ? `<p class="task__notes">${esc(r.notes)}</p>` : ''}
      </div>
      <div class="reminder__actions">
        ${r.done
          ? `<button class="btn btn--outline btn--sm" type="button" data-action="reopen" data-id="${rid}" data-focus-key="reopen-${rid}">Not done</button>`
          : `<button class="btn btn--soft btn--sm" type="button" data-action="done" data-id="${rid}" data-focus-key="done-${rid}" aria-label="${r.repeat ? 'Done for now' : 'Mark as done'}: ${esc(r.title)}">${icon('check')}${r.repeat ? 'Done for now' : 'Done'}</button>
             ${overdue ? `<button class="btn btn--outline btn--sm" type="button" data-action="snooze" data-id="${rid}" data-focus-key="snooze-${rid}" aria-label="Snooze 1 hour: ${esc(r.title)}">Snooze 1 hour</button>` : ''}`}
        <button class="icon-btn" type="button" data-action="edit" data-id="${rid}" data-focus-key="edit-${rid}" aria-label="Edit: ${esc(r.title)}" title="Edit">${icon('edit')}</button>
        <button class="icon-btn icon-btn--danger" type="button" data-action="delete" data-id="${rid}" aria-label="Delete: ${esc(r.title)}" title="Delete">${icon('trash')}</button>
      </div>
    </li>`;
}

function group(id, title, items, now, opts = {}) {
  if (!items.length) return '';
  return `
    <section class="task-group${opts.overdue ? ' task-group--overdue' : ''}" aria-labelledby="rg-${id}">
      <h3 class="task-group__title" id="rg-${id}">${title} <span class="tab__count">${items.length}</span></h3>
      <ul class="reminder-list">${items.map((r) => reminderRow(r, now, opts)).join('')}</ul>
    </section>`;
}

function notificationCard() {
  const perm = notificationPermission();
  let status;
  let action = '';
  if (perm === 'granted') status = `${icon('check-circle')}<strong>Browser notifications are on.</strong> You’ll also get a notification if DailyMate is open in a background tab.`;
  else if (perm === 'denied') status = `${icon('alert')}<strong>Browser notifications are blocked.</strong> To allow them, open your browser’s site settings for DailyMate. Reminders still appear on screen while DailyMate is open.`;
  else if (perm === 'unsupported') status = `${icon('alert')}This browser can’t show notifications. Reminders appear on screen while DailyMate is open.`;
  else {
    status = 'Want a notification even when DailyMate is in a background tab? Allow browser notifications.';
    action = `<button class="btn btn--outline btn--sm" type="button" data-action="allow-notifications" data-focus-key="allow-notif">${icon('bell')}Allow notifications</button>`;
  }
  return `
    <section class="card card--note" aria-labelledby="how-h">
      <h2 class="card__title" id="how-h">${icon('bell', 'card__title-icon')}How reminders work</h2>
      <p>When a reminder is due, DailyMate shows it on screen — <strong>as long as DailyMate is open in your browser</strong>. If the browser or the app is closed, the reminder waits and appears as <em>Overdue</em> next time you open DailyMate. Phone and email alerts aren’t available yet.</p>
      <div class="note-row"><p class="muted">${status}</p>${action}</div>
    </section>`;
}

export function render() {
  const now = Date.now();
  const { groups, done } = classify(now);
  const active = Object.values(groups).reduce((n, g) => n + g.length, 0);
  const counts = { active, done: done.length };
  let body;

  if (tab === 'done') {
    body = done.length
      ? `<ul class="reminder-list">${done.map((r) => reminderRow(r, now)).join('')}</ul>`
      : emptyState({ iconName: 'check-circle', heading: 'Nothing done yet', text: 'Reminders you mark as done will be listed here.' });
  } else if (!active) {
    body = emptyState({
      iconName: 'bell',
      heading: store.getReminders().length ? 'No reminders coming up' : 'Never forget the important things',
      text: 'Add a reminder for pills, appointments, calls or bills. You can also set one from any task with the bell button.',
      action: `<button class="btn btn--primary" type="button" data-action="add" data-focus-key="add-empty">${icon('plus')}New reminder</button>`,
    });
  } else {
    body = [
      group('overdue', `${icon('alert')}Overdue`, groups.overdue, now, { overdue: true }),
      group('today', 'Today', groups.today, now),
      group('tomorrow', 'Tomorrow', groups.tomorrow, now),
      group('week', 'Later this week', groups.week, now),
      group('later', 'Later', groups.later, now),
    ].join('');
  }

  return `
    <div class="page page--narrow">
      <header class="page-head">
        <div>
          <p class="eyebrow">Reminders</p>
          <h1 class="page-title">Reminders</h1>
          <p class="page-subtitle">${groups.overdue.length ? `${groups.overdue.length} overdue · ` : ''}${groups.today.length} today · ${active} coming up</p>
        </div>
        <button class="btn btn--primary btn--lg" type="button" data-action="add" data-focus-key="add-top">${icon('plus')}New reminder</button>
      </header>
      <section class="card" aria-label="Reminders">
        <div class="tabs" role="group" aria-label="Show reminders">
          ${TABS.map((t) => `<button class="tab" type="button" data-action="tab" data-tab="${t.id}" data-focus-key="tab-${t.id}" aria-pressed="${tab === t.id}">${t.label} <span class="tab__count">${counts[t.id]}</span></button>`).join('')}
        </div>
        ${body}
      </section>
      ${notificationCard()}
    </div>`;
}

export async function onClick(e, ctx) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const r = id ? store.getReminder(id) : null;

  switch (action) {
    case 'add': openReminderDialog(); break;
    case 'tab': tab = el.dataset.tab; ctx.rerender(); break;
    case 'edit': if (r) openReminderDialog({ reminder: r }); break;
    case 'done': {
      if (!r) return;
      const next = store.completeReminder(id);
      if (r.repeat) {
        const at = instantToLocal(store.reminderDueAt(next));
        toast(`Done — next reminder ${relativeDay(at.date)}, ${formatTime(at.time)}`);
      } else toast('Reminder done');
      break;
    }
    case 'reopen':
      if (r) { store.reopenReminder(id); toast('Moved back to Coming up'); }
      break;
    case 'snooze':
      if (r) { store.snoozeReminder(id, 60); toast('Snoozed for 1 hour'); }
      break;
    case 'delete': {
      if (!r) return;
      const ok = await confirmAction({
        title: 'Delete this reminder?',
        message: `“${r.title}” will be removed.${r.repeat ? ' It won’t repeat any more.' : ''}`,
      });
      if (ok) {
        store.deleteReminder(id);
        toast('Reminder deleted', { action: { label: 'Undo', onClick: () => store.restoreReminder(r) } });
      }
      break;
    }
    case 'allow-notifications': {
      const result = await requestNotifications();
      toast(result === 'granted' ? 'Notifications allowed' : 'Notifications were not allowed', { tone: result === 'granted' ? 'default' : 'error' });
      ctx.rerender();
      break;
    }
    default:
  }
}

