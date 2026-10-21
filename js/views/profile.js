// Profile & Subscription: account and sync, name, plans, and backups.
// Plans are shown for information — payments are not connected yet.

import * as store from '../store.js';
import * as cloud from '../cloud.js';
import * as sync from '../sync.js';
import * as push from '../push.js';
import { todayISO } from '../dates.js';
import { confirmAction } from '../dialogs.js';
import { esc, icon, toast } from '../ui.js';

export const title = 'Profile & Subscription';

const FREE_FEATURES = [
  'My Day and the Planner (day, week, month)',
  'Dates, times, priorities and repeating tasks',
  'Lists and reminders',
];
const PLUS_FEATURES = [
  'Everything in Free',
  'Up to 100 AI requests per billing period',
  'AI day planning',
  'Create tasks from a written note',
];

const featureList = (items) =>
  `<ul class="checklist">${items.map((f) => `<li>${icon('check')}${esc(f)}</li>`).join('')}</ul>`;

function syncLine() {
  const st = sync.getStatus();
  const when = st.lastSync ? new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(st.lastSync) : '';
  if (st.state === 'syncing') return `${icon('repeat')}Syncing…`;
  if (st.state === 'offline') return `${icon('alert')}Offline — ${st.pending ? `${st.pending} change${st.pending === 1 ? '' : 's'} will upload when you’re back online` : 'changes are saved on this device'}.`;
  if (st.state === 'error') return `${icon('alert')}${esc(st.message || 'Sync problem.')} ${st.pending ? `${st.pending} change${st.pending === 1 ? '' : 's'} waiting.` : ''}`;
  if (st.state === 'synced') return `${icon('check-circle')}Synced${when ? ` at ${esc(when)}` : ''}. Your data is the same on all devices where you sign in.`;
  return `${icon('repeat')}Getting ready to sync…`;
}

function accountCard() {
  const auth = cloud.getAuth();
  if (auth.status === 'loading') {
    return `<section class="card" aria-labelledby="acct-h"><h2 class="card__title" id="acct-h">Account</h2>
      <p class="loading"><span class="spinner" aria-hidden="true"></span> Checking your account…</p></section>`;
  }
  if (auth.status !== 'signed-in') {
    return `
      <section class="card" aria-labelledby="acct-h">
        <h2 class="card__title" id="acct-h">Account</h2>
        <p>You’re using DailyMate without an account. Create a free account to keep your tasks, lists and reminders safe in the cloud,
          use them on your phone and computer, and get reminder notifications when DailyMate is closed.</p>
        <div class="btn-row">
          <a class="btn btn--primary" href="#/account/sign-up">Create free account</a>
          <a class="btn btn--outline" href="#/account">Sign in</a>
        </div>
      </section>`;
  }
  return `
    <section class="card" aria-labelledby="acct-h">
      <h2 class="card__title" id="acct-h">Account</h2>
      <p>Signed in as <strong>${esc(auth.user.email)}</strong></p>
      <p class="status-line" role="status" id="sync-status">${syncLine()}</p>
      <div class="btn-row">
        <button class="btn btn--outline" type="button" data-action="sync-now">${icon('repeat')}Sync now</button>
        <a class="btn btn--outline" href="#/notifications">${icon('bell')}Notifications${push.isOnHere() ? ' · on' : ''}</a>
        <a class="btn btn--outline" href="#/account/forgot">Change password</a>
        <button class="btn btn--ghost" type="button" data-action="sign-out">Sign out</button>
      </div>
      <p class="muted small"><a href="#/delete-account">Delete my account</a></p>
    </section>`;
}

export function render() {
  const { name } = store.getProfile();
  const signedIn = cloud.getAuth().status === 'signed-in';
  const taskCount = store.getTasks().length;
  const listCount = store.getLists().length;
  const reminderCount = store.getReminders().length;
  const hasData = taskCount + listCount + reminderCount > 0;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  return `
    <div class="page page--narrow">
      <header class="page-head">
        <div>
          <h1 class="page-title">Profile & Subscription</h1>
          <p class="page-subtitle">Your name, your plan and your data.</p>
        </div>
      </header>

      ${accountCard()}

      <section class="card" aria-labelledby="name-h">
        <h2 class="card__title" id="name-h">Your name</h2>
        <p class="muted">We use it to greet you on My Day.</p>
        <form class="inline-form" data-form="name">
          <label class="visually-hidden" for="profile-name-input">Your name</label>
          <input class="input" id="profile-name-input" name="name" type="text" maxlength="40"
                 autocomplete="given-name" placeholder="e.g. Alex" value="${esc(name)}">
          <button class="btn btn--primary" type="submit">Save</button>
        </form>
      </section>

      <section class="card" aria-labelledby="plans-h">
        <h2 class="card__title" id="plans-h">Plans</h2>
        <div class="plans">
          <article class="plan plan--current" aria-labelledby="plan-free">
            <div class="plan__head">
              <h3 class="plan__name" id="plan-free">Free</h3>
              <span class="badge badge--green">Your plan</span>
            </div>
            <p class="plan__price">$0 <span>CAD</span></p>
            ${featureList(FREE_FEATURES)}
            <p class="plan__note">No AI features.</p>
          </article>
          <article class="plan" aria-labelledby="plan-plus">
            <div class="plan__head">
              <h3 class="plan__name" id="plan-plus">${icon('crown', 'plan__crown')}DailyMate Plus</h3>
              <span class="badge">Coming soon</span>
            </div>
            <p class="plan__price">$7.99 <span>CAD / month</span></p>
            ${featureList(PLUS_FEATURES)}
            <p class="plan__note">Plus isn’t available to buy yet, and no payment details are collected. The price is preliminary.</p>
          </article>
        </div>
      </section>

      <section class="card" aria-labelledby="data-h">
        <h2 class="card__title" id="data-h">Your data</h2>
        ${signedIn
          ? '<p>Your tasks, lists and reminders are saved in your account and kept on this device too, so DailyMate also works offline. You can download a copy any time.</p>'
          : '<p>Your tasks, lists and reminders are saved <strong>in this browser on this device only</strong>. Clearing your browser data will remove them. Create an account to keep them in the cloud, or use a backup file to move them to another device.</p>'}
        <p class="muted">Saved now: ${plural(taskCount, 'task', 'tasks')}, ${plural(listCount, 'list', 'lists')}, ${plural(reminderCount, 'reminder', 'reminders')}.</p>
        <div class="btn-row">
          <button class="btn btn--outline" type="button" data-action="export" ${hasData ? '' : 'disabled'}>Download a backup</button>
          <label class="btn btn--outline" for="restore-file">Restore from a backup…</label>
          <input class="visually-hidden" id="restore-file" type="file" accept="application/json,.json" data-action="restore">
        </div>
      </section>

      <section class="card" aria-labelledby="privacy-h">
        <h2 class="card__title" id="privacy-h">Privacy</h2>
        <p class="link-row">
          <a href="#/privacy">Privacy Policy</a> <a href="#/terms">Terms of Service</a>
          <a href="#/cookies">Storage & cookies</a> <a href="#/delete-account">Delete your account</a>
        </p>
      </section>
    </div>`;
}

export function onSubmit(e) {
  if (e.target.dataset.form !== 'name') return;
  e.preventDefault();
  store.setProfileName(e.target.elements.name.value);
  toast('Name saved');
}

export async function onChange(e) {
  const input = e.target;
  if (input.dataset.action !== 'restore' || !input.files?.length) return;
  const file = input.files[0];
  input.value = '';
  let data;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('too big');
    data = JSON.parse(await file.text());
    if (!Array.isArray(data?.tasks)) throw new Error('not a backup');
  } catch {
    toast('That file isn’t a DailyMate backup.', { tone: 'error' });
    return;
  }
  const n = (v) => (Array.isArray(v) ? v.length : 0);
  const ok = await confirmAction({
    title: 'Replace your data with this backup?',
    message: `The backup has ${n(data.tasks)} tasks, ${n(data.lists)} lists and ${n(data.reminders)} reminders. Everything currently saved ${cloud.getAuth().status === 'signed-in' ? 'in your account, on all your devices,' : 'in this browser'} will be replaced.`,
    confirmLabel: 'Replace my data',
  });
  if (!ok) return;
  try {
    const counts = store.importData(data);
    toast(`Backup restored: ${counts.tasks} tasks, ${counts.lists} lists, ${counts.reminders} reminders`);
  } catch {
    toast('That file isn’t a DailyMate backup.', { tone: 'error' });
  }
}

export async function onClick(e, ctx) {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'sync-now') {
    await sync.syncNow();
    toast(sync.getStatus().state === 'synced' ? 'Everything is synced' : 'Couldn’t sync right now. We’ll keep trying.', { tone: sync.getStatus().state === 'synced' ? 'default' : 'error' });
    return;
  }
  if (action === 'sign-out') { ctx.signOut(); return; }
  if (action !== 'export') return;
  const data = JSON.stringify(store.exportData(), null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `dailymate-backup-${todayISO()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Backup downloaded');
}
