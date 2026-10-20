// Reminder alerts. These work only while DailyMate is open in a browser tab:
// a card appears on screen and, if the person allowed it, the browser shows a
// notification. Alerts when the app is closed would need a push server (see README).

import * as store from './store.js';
import { formatTime, relativeDay, instantToLocal } from './dates.js';
import { esc, icon, toast } from './ui.js';

const CHECK_EVERY_MS = 15_000;
const CATCH_UP_MS = 6 * 3_600_000; // after opening the app, still alert for things due in the last 6 hours
const MAX_CARDS = 3;
const region = document.getElementById('alert-region');
const shown = new Map(); // reminder id -> alert key
let lastHTML = '';

export const notificationsSupported = () => typeof window.Notification === 'function';
export const notificationPermission = () => (notificationsSupported() ? Notification.permission : 'unsupported');

export async function requestNotifications() {
  if (!notificationsSupported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

const alertKey = (r) => String(store.reminderAlertAt(r));

function dueReminders(now) {
  return store.getReminders().filter((r) => {
    if (r.done) return false;
    const at = store.reminderAlertAt(r);
    return at <= now && at >= now - CATCH_UP_MS && r.alertedFor !== String(at);
  });
}

function cardHTML(r) {
  const at = instantToLocal(store.reminderAlertAt(r));
  const task = r.taskId ? store.getTask(r.taskId) : null;
  return `
    <div class="alert-card" role="alertdialog" aria-labelledby="alert-t-${esc(r.id)}" data-id="${esc(r.id)}">
      <span class="alert-card__icon">${icon('bell')}</span>
      <div class="alert-card__body">
        <p class="alert-card__eyebrow">Reminder · ${esc(relativeDay(at.date))}, ${esc(formatTime(at.time))}</p>
        <p class="alert-card__title" id="alert-t-${esc(r.id)}">${esc(r.title)}</p>
        ${task ? `<p class="alert-card__task">${icon('check-circle')}Task: ${esc(task.title)}</p>` : ''}
        <div class="alert-card__actions">
          <button class="btn btn--primary btn--sm" type="button" data-alert="done">${icon('check')}${r.repeat ? 'Done for now' : 'Done'}</button>
          <button class="btn btn--outline btn--sm" type="button" data-alert="snooze">Snooze 10 min</button>
          <button class="btn btn--ghost btn--sm" type="button" data-alert="close">Close</button>
        </div>
      </div>
    </div>`;
}

function render() {
  // Drop cards whose reminder was completed, deleted or rescheduled elsewhere.
  for (const [id, key] of shown) {
    const r = store.getReminder(id);
    if (!r || r.done || alertKey(r) !== key) shown.delete(id);
  }
  const ids = [...shown.keys()].slice(-MAX_CARDS);
  const html = ids.map((id) => cardHTML(store.getReminder(id))).join('');
  // Only touch the DOM when something changed, so cards don't flicker or lose focus.
  if (html !== lastHTML) region.innerHTML = lastHTML = html;
}

function check() {
  const now = Date.now();
  for (const r of dueReminders(now)) {
    const key = alertKey(r);
    shown.set(r.id, key);
    store.markReminderAlerted(r.id, key); // so it isn't shown again after a reload
    if (notificationPermission() === 'granted' && document.visibilityState === 'hidden') {
      try {
        const n = new Notification(`Reminder: ${r.title}`, { body: r.notes || 'DailyMate', tag: `dm-${r.id}`, icon: 'assets/icon.svg' });
        n.onclick = () => { window.focus(); location.hash = '#/reminders'; n.close(); };
      } catch { /* some browsers only allow notifications from a service worker */ }
    }
  }
  render();
}

region.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-alert]');
  if (!btn) return;
  const id = btn.closest('.alert-card').dataset.id;
  const r = store.getReminder(id);
  shown.delete(id);
  if (r && btn.dataset.alert === 'done') {
    const next = store.completeReminder(id);
    toast(r.repeat ? `Done — next reminder ${relativeDay(next.date)}, ${formatTime(next.time)}` : 'Reminder done');
  } else if (r && btn.dataset.alert === 'snooze') {
    store.snoozeReminder(id, 10);
    toast('Snoozed for 10 minutes');
  }
  render();
});

export function start({ onTick } = {}) {
  store.subscribe(render);
  check();
  setInterval(() => { check(); onTick?.(); }, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
