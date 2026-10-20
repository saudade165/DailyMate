// Profile & Subscription. Only the parts that really work are interactive:
// the display name and a data backup. Plans are shown for information —
// payments are not connected yet.

import * as store from '../store.js';
import { todayISO } from '../dates.js';
import { esc, icon, toast } from '../ui.js';

export const title = 'Profile & Subscription';

const FREE_FEATURES = [
  'Plan your day with tasks',
  'Dates, times and priorities',
  'Lists and basic reminders (coming soon)',
];
const PLUS_FEATURES = [
  'Everything in Free',
  'Up to 100 AI requests per billing period',
  'AI day planning',
  'Create tasks from a written note',
];

const featureList = (items) =>
  `<ul class="checklist">${items.map((f) => `<li>${icon('check')}${esc(f)}</li>`).join('')}</ul>`;

export function render() {
  const { name } = store.getProfile();
  const taskCount = store.getTasks().length;
  return `
    <div class="page page--narrow">
      <header class="page-head">
        <div>
          <h1 class="page-title">Profile & Subscription</h1>
          <p class="page-subtitle">Your name, your plan and your data.</p>
        </div>
      </header>

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
        <p>Your tasks are saved <strong>in this browser on this device only</strong>. They are not synced to the cloud yet, and clearing your browser data will remove them.</p>
        <p class="muted">You have ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} saved.</p>
        <button class="btn btn--outline" type="button" data-action="export" ${taskCount ? '' : 'disabled'}>Download a backup</button>
      </section>
    </div>`;
}

export function onSubmit(e) {
  if (e.target.dataset.form !== 'name') return;
  e.preventDefault();
  store.setProfileName(e.target.elements.name.value);
  toast('Name saved');
}

export function onClick(e) {
  if (!e.target.closest('[data-action="export"]')) return;
  const data = JSON.stringify({ exportedAt: new Date().toISOString(), tasks: store.getTasks(), profile: store.getProfile() }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `dailymate-backup-${todayISO()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Backup downloaded');
}
