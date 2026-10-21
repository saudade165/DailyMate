// Admin panel — owner only.
//   #/admin                 Overview: key numbers, registrations chart, recent users, health
//   #/admin/users[/<id>]    Users: search, filters, sorting, pages, details, block, delete, CSV
//   #/admin/usage           How DailyMate is used (counts only) and daily active users
//   #/admin/emails          New-registration e-mails: settings, status, test, log
//   #/admin/system          Services, scheduled jobs, server log, admin audit log
//
// This page is not the protection: every number comes from database functions that
// check on the server that the caller is the confirmed owner account (public.is_admin)
// and refuse everyone else. Nobody's task, list or reminder contents are shown.

import * as cloud from '../cloud.js';
import { SUPABASE_CONFIG } from '../config.js';
import { addDays, todayISO } from '../dates.js';
import { confirmAction } from '../dialogs.js';
import { esc, icon, toast } from '../ui.js';

export const title = 'Admin';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const PAGE_SIZE = 25;
const TABS = [
  { id: '', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'usage', label: 'Usage' },
  { id: 'emails', label: 'E-mails' },
  { id: 'system', label: 'System' },
];

// ---- State -------------------------------------------------------------------------------------

let access = { user: null, state: 'unknown' }; // unknown | checking | yes | no | error
let range = { preset: '30', from: addDays(todayISO(), -29), to: todayISO() };
let filters = { q: '', status: 'all', from: '', to: '', sort: 'created_desc', page: 0 };
const cache = new Map(); // key -> { loading, data, error }
let busy = false;

const num = (v) => (v === null || v === undefined ? '—' : new Intl.NumberFormat('en-US').format(Number(v)));
const when = (iso) => (iso ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—');
const day = (iso) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00`));
const mb = (bytes) => `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`;

const fail = (message) => Object.assign(new Error(message), { userMessage: message });

function explainError(err) {
  if (err?.userMessage) return err.userMessage;
  if (err?.code === '42501') return 'You don’t have access to this.';
  if (err?.code === 'PT404') return 'This account no longer exists.';
  if (/fetch|network|load failed/i.test(String(err?.message))) return 'Couldn’t reach the server. Check your connection and try again.';
  return err?.message ? `The server refused: ${err.message}` : 'Something went wrong. Please try again.';
}

/** Loads `key` once (or again after invalidate) and re-renders when it arrives. */
function load(key, fn, ctx) {
  const entry = cache.get(key);
  if (entry && (entry.loading || entry.data !== undefined || entry.error)) return entry;
  const fresh = { loading: true, data: undefined, error: null };
  cache.set(key, fresh);
  fn().then((data) => { fresh.data = data; }, (err) => {
    fresh.error = explainError(err);
    if (err?.code === '42501') { access.state = 'no'; }
  }).finally(() => { fresh.loading = false; ctx.rerender(); });
  return fresh;
}
const invalidate = (prefix) => { for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k); };

function state(entry, render) {
  if (!entry || entry.loading) return '<p class="loading"><span class="spinner" aria-hidden="true"></span> Loading…</p>';
  if (entry.error) return `<p class="form-msg form-msg--error" role="alert">${icon('alert')}<span>${esc(entry.error)}</span></p>
    <button class="btn btn--outline btn--sm" type="button" data-action="reload">Try again</button>`;
  return render(entry.data);
}

// ---- Shared pieces -------------------------------------------------------------------------------

function statCard(label, value, sub = '', tone = 'blue', iconName = 'user') {
  return `<div class="stat"><span class="stat__icon stat__icon--${tone}">${icon(iconName)}</span>
    <span class="stat__body"><span class="stat__value">${value}</span><span class="stat__label">${esc(label)}</span>${sub ? `<span class="stat__sub">${sub}</span>` : ''}</span></div>`;
}

function rangeBar() {
  return `
    <form class="admin-range" data-form="range" aria-label="Date range">
      <div class="segmented" role="group" aria-label="Quick ranges">
        ${['7', '30', '90'].map((p) => `<button type="button" class="segmented__btn" data-action="preset" data-preset="${p}" aria-pressed="${range.preset === p}">${p} days</button>`).join('')}
      </div>
      <label class="admin-range__field"><span>From</span><input class="input input--sm" type="date" name="from" value="${range.from}" max="${todayISO()}"></label>
      <label class="admin-range__field"><span>To</span><input class="input input--sm" type="date" name="to" value="${range.to}" max="${todayISO()}"></label>
      <button class="btn btn--outline btn--sm" type="submit">Apply</button>
    </form>`;
}

/** Bar chart of one daily series (a single series: the heading names it, no legend). */
function barChart(series, key, label) {
  if (!series.length) return '<p class="muted">No data for this range.</p>';
  const max = Math.max(1, ...series.map((d) => Number(d[key])));
  const W = 640; const H = 180; const top = 10; const bottom = 24; const left = 28;
  const plotH = H - top - bottom;
  const step = (W - left) / series.length;
  const barW = Math.max(2, Math.min(28, step - 2)); // 2px gap between bars
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  const y = (v) => top + plotH - (v / max) * plotH;
  const labelEvery = Math.ceil(series.length / 6);
  const bars = series.map((d, i) => {
    const v = Number(d[key]);
    const x = left + i * step + (step - barW) / 2;
    const h = (v / max) * plotH;
    const r = Math.min(4, barW / 2, h);
    const path = v > 0
      ? `M${x},${top + plotH} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z` : '';
    const tip = `${day(d.day)}: ${num(v)} ${label}`;
    return `<g class="chart__col" data-tip="${esc(tip)}">
      <rect x="${left + i * step}" y="${top}" width="${step}" height="${plotH}" fill="transparent"></rect>
      ${path ? `<path class="chart__bar" d="${path}"></path>` : ''}
      ${i % labelEvery === 0 || i === series.length - 1 ? `<text class="chart__x" x="${x + barW / 2}" y="${H - 6}" text-anchor="middle">${esc(day(d.day))}</text>` : ''}
    </g>`;
  }).join('');
  return `
    <div class="chart" data-chart>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} per day, ${esc(day(series[0].day))} to ${esc(day(series.at(-1).day))}">
        ${ticks.map((t) => `<line class="chart__grid" x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}"></line>
          <text class="chart__y" x="${left - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
        ${bars}
      </svg>
      <div class="chart__tip" hidden></div>
    </div>
    <details class="details"><summary>Show as a table</summary>
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Day</th><th scope="col">${esc(label)}</th></tr></thead>
      <tbody>${series.map((d) => `<tr><td>${esc(day(d.day))}</td><td>${num(d[key])}</td></tr>`).join('')}</tbody></table></div>
    </details>`;
}

function table(headers, rows, empty) {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<div class="table-wrap"><table class="table">
    <thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

const statusBadge = (u) => (u.blocked ? '<span class="badge badge--red">Blocked</span>'
  : u.confirmed ? '<span class="badge badge--green">Active</span>' : '<span class="badge">Unconfirmed</span>');
const roleBadge = (role) => (role === 'owner' ? '<span class="badge badge--plus">Owner</span>' : 'User');
const avatar = (u) => `<span class="avatar avatar--sm" aria-hidden="true">${esc((u.name || u.email || '?')[0].toUpperCase())}</span>`;

// ---- Overview & usage ------------------------------------------------------------------------

const dashKey = () => `dash:${range.from}:${range.to}`;
const loadDash = (ctx) => load(dashKey(), () => cloud.rpc('admin_dashboard', { p_from: range.from, p_to: range.to, p_tz: TZ }), ctx);

function overview(ctx) {
  const entry = loadDash(ctx);
  return `${rangeBar()}${state(entry, (d) => {
    const u = d.users; const a = d.active;
    const mailer = d.email.mailer ?? {};
    const healthy = (d.health.cron ?? []).every((j) => !j.lastRun || j.lastRun.status === 'succeeded');
    return `
      <section class="stats admin-stats" aria-label="Key numbers">
        ${statCard('Registered users', num(u.total), `${num(u.confirmed)} confirmed · ${num(u.blocked)} blocked`)}
        ${statCard('New today', num(u.newToday), '', 'green', 'plus')}
        ${statCard('New in 7 days', num(u.new7d), `${num(u.new30d)} in 30 days`, 'violet', 'calendar')}
        ${statCard('Active in 7 days', num(a.d7), `${num(a.today)} today (UTC) · ${num(a.d30)} in 30 days`, 'amber', 'chart')}
      </section>
      <p class="muted small">Active = opened DailyMate while signed in. Counted since ${a.trackedSince ? esc(day(a.trackedSince)) : 'this feature was added (no data yet)'}.</p>

      <section class="card" aria-labelledby="reg-h">
        <div class="card__head card__head--wrap"><h2 class="card__title" id="reg-h">Registrations per day</h2>
          <span class="muted">${num(u.inRange)} in this range</span></div>
        ${barChart(d.series, 'signups', 'registrations')}
      </section>

      <div class="admin-grid">
        <section class="card" aria-labelledby="recent-h">
          <div class="card__head"><h2 class="card__title" id="recent-h">Latest registrations</h2><a href="#/admin/users">All users</a></div>
          ${d.recent.length ? `<ul class="admin-list">${d.recent.map((r) => `
            <li><a class="admin-list__row" href="#/admin/users/${esc(r.id)}">${avatar(r)}
              <span class="admin-list__main"><strong>${esc(r.name || r.email)}</strong>${r.name ? `<span class="muted small">${esc(r.email)}</span>` : ''}</span>
              <span class="muted small">${esc(when(r.created_at))}</span></a></li>`).join('')}</ul>` : '<p class="muted">No users yet.</p>'}
        </section>
        <section class="card" aria-labelledby="health-h">
          <div class="card__head"><h2 class="card__title" id="health-h">Health</h2><a href="#/admin/system">Details</a></div>
          <ul class="health-list">
            <li>${healthDot(true)}Database: responding (Postgres ${esc(d.health.database.version)})</li>
            <li>${healthDot(d.health.errors24h === 0)}Errors in the last 24 h: ${num(d.health.errors24h)}</li>
            <li>${healthDot(healthy)}Scheduled jobs: ${(d.health.cron ?? []).length} · ${healthy ? 'all OK' : 'check System'}</li>
            <li>${healthDot(d.health.pushConfigured)}Push notifications: ${d.health.pushConfigured ? 'ready' : 'not set up'}</li>
            <li>${healthDot(mailer.configured === true, mailer.configured === undefined)}Registration e-mails: ${mailerText(mailer, d.email.settings)}</li>
          </ul>
        </section>
      </div>`;
  })}`;
}

const healthDot = (ok, unknown = false) => `<span class="health-dot ${unknown ? 'is-unknown' : ok ? 'is-ok' : 'is-bad'}" aria-hidden="true"></span>`;
function mailerText(m, s) {
  if (s && s.enabled === false) return 'turned off';
  if (m.configured === true) return m.lastError ? `set up · last error: ${esc(m.lastError)}` : 'set up';
  if (m.configured === false) return 'waiting for a Resend API key';
  return 'not checked yet (runs when there is something to send)';
}

function usage(ctx) {
  const entry = loadDash(ctx);
  return `${rangeBar()}${state(entry, (d) => {
    const g = d.usage; const total = Number(d.users.total) || 0;
    const share = (n) => (total ? ` (${Math.round((Number(n) / total) * 100)}% of users)` : '');
    return `
      <section class="stats admin-stats" aria-label="Usage in this range">
        ${statCard('Tasks created', num(g.tasksCreated), 'in this range', 'blue', 'check-circle')}
        ${statCard('Tasks completed', num(g.tasksCompleted), 'in this range', 'green', 'check')}
        ${statCard('Notifications sent', num(g.notificationsSent), 'in this range', 'amber', 'bell')}
        ${statCard('Push devices', num(g.pushDevices), `${num(g.usersWithPush)} users`, 'violet', 'bell')}
      </section>
      <section class="card" aria-labelledby="act-h">
        <h2 class="card__title" id="act-h">Active users per day</h2>
        <p class="muted small">Days are counted in UTC. Only the date is stored.</p>
        ${barChart(d.series, 'active', 'active users')}
      </section>
      <section class="card" aria-labelledby="feat-h">
        <h2 class="card__title" id="feat-h">Features in use (all time, current items)</h2>
        ${table(['Feature', 'Items', 'Users using it'], [
          ['Tasks', num(g.tasks), num(g.usersWithTasks) + share(g.usersWithTasks)],
          ['Lists', num(g.lists), num(g.usersWithLists) + share(g.usersWithLists)],
          ['Reminders', num(g.reminders), num(g.usersWithReminders) + share(g.usersWithReminders)],
          ['Repeating tasks and reminders', num(g.repeating), '—'],
          ['Push notifications', `${num(g.pushDevices)} devices`, num(g.usersWithPush) + share(g.usersWithPush)],
        ], '')}
        <p class="muted small">Counts only — no one’s task, list or reminder text is read. Data saved by people without an account stays on their device and isn’t counted.</p>
      </section>`;
  })}`;
}

// ---- Users -----------------------------------------------------------------------------------

const usersKey = () => `users:${JSON.stringify(filters)}`;
function loadUsers(ctx) {
  return load(usersKey(), () => cloud.rpc('admin_users', {
    p_search: filters.q, p_status: filters.status, p_from: filters.from || null, p_to: filters.to || null,
    p_sort: filters.sort, p_limit: PAGE_SIZE, p_offset: filters.page * PAGE_SIZE, p_tz: TZ,
  }), ctx);
}

function usersPage(ctx) {
  const entry = loadUsers(ctx);
  const opt = (v, l, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  return `
    <form class="admin-filters" data-form="user-filters" role="search">
      <label class="admin-filters__search"><span class="visually-hidden">Search by e-mail or name</span>
        <input class="input input--sm" type="search" name="q" value="${esc(filters.q)}" placeholder="Search e-mail or name" maxlength="100"></label>
      <label><span>Status</span><select class="input input--sm select" name="status">
        ${opt('all', 'All', filters.status)}${opt('active', 'Active', filters.status)}${opt('unconfirmed', 'Unconfirmed', filters.status)}${opt('blocked', 'Blocked', filters.status)}</select></label>
      <label><span>Registered from</span><input class="input input--sm" type="date" name="from" value="${esc(filters.from)}" max="${todayISO()}"></label>
      <label><span>to</span><input class="input input--sm" type="date" name="to" value="${esc(filters.to)}" max="${todayISO()}"></label>
      <label><span>Sort</span><select class="input input--sm select" name="sort">
        ${opt('created_desc', 'Newest first', filters.sort)}${opt('created_asc', 'Oldest first', filters.sort)}${opt('email', 'E-mail A–Z', filters.sort)}
        ${opt('last_active', 'Last active', filters.sort)}${opt('last_sign_in', 'Last sign-in', filters.sort)}</select></label>
      <div class="btn-row"><button class="btn btn--primary btn--sm" type="submit">Apply</button>
        <button class="btn btn--ghost btn--sm" type="button" data-action="clear-filters">Clear</button></div>
    </form>
    <section class="card" aria-labelledby="users-h">
      <div class="card__head card__head--wrap">
        <h2 class="card__title" id="users-h">Users</h2>
        <div class="btn-row">
          <button class="btn btn--outline btn--sm" type="button" data-action="export" data-mask="1">Export CSV (masked)</button>
          <button class="btn btn--ghost btn--sm" type="button" data-action="export" data-mask="0">Export with full e-mails</button>
        </div>
      </div>
      ${state(entry, (rows) => {
        const total = rows[0]?.total ?? 0;
        const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        return `
          <p class="muted small" role="status">${num(total)} user${Number(total) === 1 ? '' : 's'} found</p>
          ${table(['User', 'Registered', 'Last active', 'Status', 'Role', 'Tasks', 'Lists', 'Reminders', ''], rows.map((u) => [
            `<span class="user-cell">${avatar(u)}<span><strong>${esc(u.name || u.email)}</strong>${u.name ? `<br><span class="muted small">${esc(u.email)}</span>` : ''}</span></span>`,
            esc(when(u.created_at)), esc(when(u.last_active_at ?? u.last_sign_in_at)), statusBadge(u), roleBadge(u.role),
            num(u.tasks), num(u.lists), num(u.reminders),
            `<a class="btn btn--outline btn--sm" href="#/admin/users/${esc(u.id)}">Details</a>`,
          ]), 'No users match these filters.')}
          ${pages > 1 ? `<nav class="pager" aria-label="Pages">
            <button class="btn btn--outline btn--sm" type="button" data-action="page" data-page="${filters.page - 1}" ${filters.page === 0 ? 'disabled' : ''}>${icon('chevron-left')}Previous</button>
            <span>Page ${filters.page + 1} of ${pages}</span>
            <button class="btn btn--outline btn--sm" type="button" data-action="page" data-page="${filters.page + 1}" ${filters.page + 1 >= pages ? 'disabled' : ''}>Next${icon('chevron-right')}</button>
          </nav>` : ''}`;
      })}
    </section>`;
}

function userDetail(id, ctx) {
  const entry = load(`user:${id}`, () => cloud.rpc('admin_user_detail', { p_user: id }), ctx);
  return `<p><a class="back-link" href="#/admin/users">${icon('arrow-left')}All users</a></p>${state(entry, (u) => {
    const owner = u.role === 'owner';
    const c = u.counts;
    return `
      <section class="card" aria-labelledby="ud-h">
        <div class="user-head">${avatar(u)}<div><h2 class="card__title" id="ud-h">${esc(u.name || u.email)}</h2>
          <p class="muted">${esc(u.email)}</p></div></div>
        <dl class="facts">
          <div><dt>Status</dt><dd>${statusBadge({ blocked: u.blocked, confirmed: Boolean(u.confirmedAt) })}</dd></div>
          <div><dt>Role</dt><dd>${roleBadge(u.role)}</dd></div>
          <div><dt>Registered</dt><dd>${esc(when(u.createdAt))}</dd></div>
          <div><dt>E-mail confirmed</dt><dd>${esc(when(u.confirmedAt))}</dd></div>
          <div><dt>Last sign-in</dt><dd>${esc(when(u.lastSignInAt))}</dd></div>
          <div><dt>Last active</dt><dd>${esc(when(u.lastActiveAt))} · ${num(u.activeDays30)} active day${Number(u.activeDays30) === 1 ? '' : 's'} in 30</dd></div>
          <div><dt>Sign-in method</dt><dd>${esc(u.provider)}</dd></div>
          <div><dt>Plan</dt><dd>${esc(u.plan.plan)}${u.plan.status ? ` (${esc(u.plan.status)})` : ''}</dd></div>
          <div><dt>Saved in the cloud</dt><dd>${num(c.tasks)} tasks (${num(c.completed)} done), ${num(c.lists)} lists, ${num(c.reminders)} reminders</dd></div>
          <div><dt>Notification devices</dt><dd>${u.devices.length ? u.devices.map((d) => `${esc(d.label || 'Browser')}${d.disabled ? ` (stopped: ${esc(d.disabled)})` : ''}`).join(', ') : 'none'}</dd></div>
        </dl>
      </section>
      ${owner ? '<p class="muted">This is the owner account. It can’t be blocked or deleted here.</p>' : `
      <section class="card" aria-labelledby="ua-h">
        <h2 class="card__title" id="ua-h">Actions</h2>
        <form class="admin-action" data-form="block" data-id="${esc(u.id)}" data-blocked="${u.blocked}">
          <p>${u.blocked ? 'This account is blocked: it can’t sign in, its sessions were ended and its data can’t be read or changed.'
            : 'Blocking signs this person out everywhere, stops their notifications and prevents sign-in and data access until you unblock them. Their data is kept.'}</p>
          ${u.blocked ? '' : `<div class="field"><label class="field__label" for="block-reason">Reason (kept in the audit log)</label>
            <input class="input" id="block-reason" name="reason" maxlength="300" required data-focus-key="block-reason"></div>`}
          <button class="btn ${u.blocked ? 'btn--outline' : 'btn--danger-outline'}" type="submit" ${busy ? 'disabled' : ''}>${u.blocked ? 'Unblock account' : 'Block account'}</button>
        </form>
        <form class="danger-zone" data-form="delete-user" data-id="${esc(u.id)}" data-email="${esc(u.email)}">
          <h3>Delete this account</h3>
          <p>This permanently deletes the account and, as the Privacy Policy says, everything saved in it:
            <strong>${num(c.tasks)} tasks, ${num(c.lists)} lists and ${num(c.reminders)} reminders</strong>, their name, notification devices and plan details.
            It can’t be undone, and the person isn’t notified. The audit log keeps only the account id, these counts and your reason.
            If you only want to stop access, block the account instead.</p>
          <div class="field"><label class="field__label" for="del-email">Type the account’s e-mail to confirm</label>
            <input class="input" id="del-email" name="email" autocomplete="off" required data-focus-key="del-email"></div>
          <div class="field"><label class="field__label" for="del-reason">Reason</label>
            <input class="input" id="del-reason" name="reason" maxlength="300" required data-focus-key="del-reason"></div>
          <button class="btn btn--danger" type="submit" ${busy ? 'disabled' : ''}>Delete account</button>
        </form>
      </section>`}
      <section class="card" aria-labelledby="uh-h">
        <h2 class="card__title" id="uh-h">Admin history for this account</h2>
        ${table(['When', 'Action', 'Details'], u.history.map((h) => [esc(when(h.at)), esc(h.action.replace(/_/g, ' ')), `<code>${esc(JSON.stringify(h.details))}</code>`]), 'No admin actions yet.')}
      </section>`;
  })}`;
}

// ---- E-mails -------------------------------------------------------------------------------

function emailsPage(ctx) {
  const dash = loadDash(ctx);
  const log = load('emails', () => cloud.rpc('admin_email_log', { p_limit: 30 }), ctx);
  return state(dash, (d) => {
    const s = d.email.settings ?? {}; const m = d.email.mailer ?? {};
    return `
      <section class="card" aria-labelledby="mail-h">
        <h2 class="card__title" id="mail-h">New-registration e-mails</h2>
        <p>DailyMate e-mails the owner account when someone registers. Sent by the server through Resend; the API key is kept in Supabase secrets, never in the app.</p>
        <p class="status-line">${healthDot(m.configured === true, m.configured === undefined)}<span>Status: ${mailerText(m, s)}${m.lastSentAt ? ` · last sent ${esc(when(m.lastSentAt))}` : ''}${m.checkedAt ? ` · checked ${esc(when(m.checkedAt))}` : ''}</span></p>
        <form class="admin-action" data-form="email-settings">
          <label class="check-row"><input type="checkbox" name="enabled" ${s.enabled !== false ? 'checked' : ''}> Send an e-mail for each new registration</label>
          <fieldset class="field"><legend class="field__label">When</legend>
            <label class="check-row"><input type="radio" name="when" value="confirmed" ${s.when !== 'created' ? 'checked' : ''}> After the person confirms their e-mail (recommended — skips fake sign-ups)</label>
            <label class="check-row"><input type="radio" name="when" value="created" ${s.when === 'created' ? 'checked' : ''}> As soon as the account is created</label>
          </fieldset>
          <div class="btn-row">
            <button class="btn btn--primary" type="submit" ${busy ? 'disabled' : ''}>Save settings</button>
            <button class="btn btn--outline" type="button" data-action="test-email" ${busy ? 'disabled' : ''}>${icon('send')}Send a test e-mail</button>
          </div>
        </form>
        <p class="muted small">Each account triggers at most one e-mail. Temporary errors are retried automatically (up to 8 times over several hours).</p>
      </section>
      <section class="card" aria-labelledby="mlog-h">
        <h2 class="card__title" id="mlog-h">Recent e-mails</h2>
        ${state(log, (rows) => table(['Created', 'Type', 'Account', 'Status', 'Tries', 'Error', ''], rows.map((r) => [
          esc(when(r.created_at)), r.kind === 'test' ? 'Test' : 'New user', esc(r.user_email ?? (r.kind === 'test' ? '' : 'deleted account')),
          `${esc(r.status)}${r.sent_at ? `<br><span class="muted small">${esc(when(r.sent_at))}</span>` : ''}`, num(r.attempts), esc(r.last_error ?? ''),
          r.status === 'failed' ? `<button class="btn btn--outline btn--sm" type="button" data-action="retry-email" data-id="${r.id}">Retry</button>` : '',
        ]), 'No e-mails yet.'))}
      </section>`;
  });
}

// ---- System ------------------------------------------------------------------------------------

function systemPage(ctx) {
  const dash = loadDash(ctx);
  const events = load('events', () => cloud.rpc('admin_recent_events', { p_limit: 30 }), ctx);
  const audit = load('audit', () => cloud.rpc('admin_audit', { p_limit: 30 }), ctx);
  const deliveries = load('deliveries', () => cloud.rpc('admin_recent_deliveries', { p_limit: 20 }), ctx);
  return `
    ${state(dash, (d) => `
      <section class="card" aria-labelledby="svc-h">
        <h2 class="card__title" id="svc-h">Services</h2>
        <ul class="health-list">
          <li>${healthDot(true)}Database: Postgres ${esc(d.health.database.version)}, ${esc(mb(d.health.database.sizeBytes))} of 500 MB (Free plan)</li>
          <li>${healthDot(true)}Migrations applied: ${num(d.health.migrations.length)} (latest: ${esc(d.health.migrations.at(-1)?.name ?? '—')})</li>
          ${(d.health.cron ?? []).map((j) => `<li>${healthDot(!j.lastRun || j.lastRun.status === 'succeeded')}Job <strong>${esc(j.job)}</strong> (${esc(j.schedule)}): ${j.active ? 'on' : 'paused'}
            · last run ${esc(when(j.lastRun?.start))} ${j.lastRun ? `— ${esc(j.lastRun.status)}` : ''} · failures in 24 h: ${num(j.failures24h)}</li>`).join('')}
          <li>${healthDot(!Object.keys(d.health.functionCalls24h).some((k) => k === 'error' || Number(k) >= 500))}Server function calls in 24 h:
            ${Object.keys(d.health.functionCalls24h).length ? Object.entries(d.health.functionCalls24h).map(([k, v]) => `${esc(k === 'error' ? 'no answer' : `HTTP ${k}`)}: ${num(v)}`).join(' · ') : 'none (nothing to send)'}</li>
          <li>${healthDot(d.health.pushConfigured)}Push notifications: ${d.health.pushConfigured ? 'keys ready' : 'not set up'}</li>
          <li>${healthDot(true, true)}AI Assistant: not connected (deferred)</li>
          <li>${healthDot(true, true)}Website: GitHub Pages (${esc(location.host)}) · backend ${esc(new URL(SUPABASE_CONFIG.url).host)}</li>
        </ul>
      </section>`)}
    <section class="card" aria-labelledby="ev-h">
      <h2 class="card__title" id="ev-h">Server log (errors and warnings)</h2>
      ${state(events, (rows) => table(['When', 'Source', 'Level', 'Message', 'Details'], rows.map((e) => [
        esc(when(e.created_at)), esc(e.source), e.level === 'error' ? `<span class="text-warn">${esc(e.level)}</span>` : esc(e.level), esc(e.message),
        `<code>${esc(JSON.stringify(e.details)).slice(0, 200)}</code>`]), 'Nothing logged.'))}
    </section>
    <section class="card" aria-labelledby="dl-h">
      <h2 class="card__title" id="dl-h">Recent push deliveries</h2>
      ${state(deliveries, (rows) => table(['When', 'Kind', 'Status', 'Tries', 'HTTP', 'Error'], rows.map((r) => [
        esc(when(r.created_at)), esc(r.kind), esc(r.status), num(r.attempts), esc(r.http_status ?? ''), esc((r.last_error ?? '').slice(0, 80))]), 'No deliveries yet.'))}
    </section>
    <section class="card" aria-labelledby="au-h">
      <h2 class="card__title" id="au-h">Admin audit log</h2>
      ${state(audit, (rows) => table(['When', 'Action', 'Account', 'Details'], rows.map((a) => [
        esc(when(a.created_at)), esc(a.action.replace(/_/g, ' ')),
        a.target_user_id ? `<a href="#/admin/users/${esc(a.target_user_id)}"><code>${esc(a.target_user_id.slice(0, 8))}</code></a>` : '',
        `<code>${esc(JSON.stringify(a.details))}</code>`]), 'No admin actions yet.'))}
    </section>`;
}

// ---- Access and page -----------------------------------------------------------------------------

function checkAccess(ctx) {
  const user = cloud.getUser();
  if (access.user === user?.id && access.state !== 'unknown') return;
  access = { user: user?.id ?? null, state: 'checking' };
  cache.clear();
  cloud.rpc('is_admin').then((ok) => {
    access.state = ok === true ? 'yes' : 'no';
  }, () => { access.state = 'error'; }).finally(() => ctx.rerender());
}

export function pageTitle(params) {
  return `Admin${params[0] ? ` — ${TABS.find((t) => t.id === params[0])?.label ?? ''}` : ''}`;
}

export function render(params) {
  const auth = cloud.getAuth();
  const tab = TABS.some((t) => t.id === (params[0] ?? '')) ? (params[0] ?? '') : '';
  let body;
  if (auth.status === 'loading' || (auth.status === 'signed-in' && ['unknown', 'checking'].includes(access.state))) {
    body = '<p class="loading"><span class="spinner" aria-hidden="true"></span> Checking access…</p>';
  } else if (auth.status !== 'signed-in') {
    body = `<section class="card"><h2 class="card__title">${icon('lock', 'card__title-icon')}Sign in to continue</h2>
      <p>The admin panel is only available to the DailyMate owner account.</p>
      <button class="btn btn--primary" type="button" data-action="sign-in">Sign in</button></section>`;
  } else if (access.state === 'error') {
    body = `<section class="card"><p class="form-msg form-msg--error">${icon('alert')}<span>Couldn’t check access. Check your connection.</span></p>
      <button class="btn btn--outline" type="button" data-action="recheck">Try again</button></section>`;
  } else if (access.state !== 'yes') {
    body = '<p class="loading"><span class="spinner" aria-hidden="true"></span> Redirecting…</p>';
  } else {
    let content;
    if (tab === 'users' && params[1]) content = userDetail(params[1], viewCtx);
    else if (tab === 'users') content = usersPage(viewCtx);
    else if (tab === 'usage') content = usage(viewCtx);
    else if (tab === 'emails') content = emailsPage(viewCtx);
    else if (tab === 'system') content = systemPage(viewCtx);
    else content = overview(viewCtx);
    body = `
      <nav class="tabs admin-tabs" aria-label="Admin sections">
        ${TABS.map((t) => `<a class="tab" href="#/admin${t.id ? `/${t.id}` : ''}" ${t.id === tab ? 'aria-current="page"' : ''}>${t.label}</a>`).join('')}
      </nav>
      ${content}`;
  }
  return `
    <div class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Owner only</p>
          <h1 class="page-title">Admin</h1>
        </div>
        ${access.state === 'yes' ? '<button class="btn btn--outline" type="button" data-action="reload">Refresh</button>' : ''}
      </header>
      ${body}
    </div>`;
}

let viewCtx = null;

export function afterRender(params, ctx) {
  viewCtx = ctx;
  const auth = cloud.getAuth();
  if (auth.status === 'signed-in') checkAccess(ctx);
  else if (auth.status === 'signed-out') access = { user: null, state: 'unknown' };
  if (auth.status === 'signed-in' && access.state === 'no') {
    // Another account: no admin data, back to the normal app.
    access.state = 'redirected';
    toast('The admin panel is only for the DailyMate owner.', { tone: 'error' });
    location.hash = '#/my-day';
  }
}

// ---- Events ------------------------------------------------------------------------------------

function downloadCsv(rows, masked) {
  const cols = ['email', 'name', 'created_at', 'confirmed', 'blocked', 'last_active_at', 'tasks', 'lists', 'reminders'];
  // Quote every cell; neutralise spreadsheet formulas (=, +, -, @ at the start).
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `dailymate-users-${masked ? 'masked-' : ''}${todayISO()}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function act(ctx, fn, success) {
  if (busy) return;
  busy = true;
  ctx.rerender();
  try {
    await fn();
    if (success) toast(success);
  } catch (err) {
    toast(explainError(err), { tone: 'error' });
  } finally {
    busy = false;
    ctx.rerender();
  }
}

export async function onClick(e, ctx) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
  if (a === 'sign-in') { cloud.rememberReturn('#/admin'); location.hash = '#/account'; }
  if (a === 'recheck') { access.state = 'unknown'; ctx.rerender(); }
  if (a === 'reload') { cache.clear(); ctx.rerender(); }
  if (a === 'preset') {
    const n = Number(btn.dataset.preset);
    range = { preset: String(n), from: addDays(todayISO(), -(n - 1)), to: todayISO() };
    ctx.rerender();
  }
  if (a === 'page') { filters.page = Math.max(0, Number(btn.dataset.page)); ctx.rerender(); }
  if (a === 'clear-filters') { filters = { q: '', status: 'all', from: '', to: '', sort: 'created_desc', page: 0 }; ctx.rerender(); }
  if (a === 'export') {
    const masked = btn.dataset.mask === '1';
    if (!masked && !(await confirmAction({
      title: 'Export full e-mail addresses?',
      message: 'The file will contain personal information (e-mail addresses and names). Keep it private, don’t share it, and delete it when you no longer need it. The export is recorded in the audit log.',
      confirmLabel: 'Export', tone: 'primary',
    }))) return;
    act(ctx, async () => {
      const rows = await cloud.rpc('admin_export_users', { p_mask: masked });
      downloadCsv(rows, masked);
    }, 'CSV downloaded');
  }
  if (a === 'test-email') {
    act(ctx, async () => {
      const token = await cloud.accessToken();
      const res = await fetch(`${SUPABASE_CONFIG.url}/functions/v1/admin-mailer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_CONFIG.publishableKey },
        body: JSON.stringify({ action: 'test' }),
      }).catch(() => { throw fail('Couldn’t reach the server. Check your connection and try again.'); });
      const data = await res.json().catch(() => ({}));
      invalidate('emails'); invalidate('dash');
      if (res.status === 503) throw fail('E-mail isn’t set up yet: add RESEND_API_KEY in Supabase (see the setup guide).');
      if (res.status === 429) throw fail('Too many test e-mails. Please wait an hour.');
      if (res.status === 403) throw fail('Only the owner account can send test e-mails.');
      if (!res.ok || !data.ok) throw fail(`The test e-mail couldn’t be sent${data.failed ? ' — see “Recent e-mails” for the reason' : ''}.`);
    }, 'Test e-mail sent. Check the owner inbox (and spam folder).');
  }
  if (a === 'retry-email') {
    act(ctx, async () => { await cloud.rpc('admin_retry_email', { p_id: Number(btn.dataset.id) }); invalidate('emails'); }, 'Queued again — it will be sent within a minute');
  }
}

export function onSubmit(e, ctx) {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const f = form.elements;
  switch (form.dataset.form) {
    case 'range': {
      const from = f.from.value; const to = f.to.value;
      if (!from || !to || from > to) { toast('Please choose a start date before the end date.', { tone: 'error' }); return; }
      if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) { toast('Please choose at most one year.', { tone: 'error' }); return; }
      range = { preset: '', from, to };
      ctx.rerender();
      break;
    }
    case 'user-filters':
      if (f.from.value && f.to.value && f.from.value > f.to.value) { toast('“Registered from” must be before “to”.', { tone: 'error' }); return; }
      filters = { q: f.q.value.trim(), status: f.status.value, from: f.from.value, to: f.to.value, sort: f.sort.value, page: 0 };
      ctx.rerender();
      break;
    case 'block': {
      const id = form.dataset.id;
      const blocked = form.dataset.blocked === 'true';
      const reason = f.reason?.value.trim() ?? '';
      if (!blocked && !reason) { toast('Please give a reason.', { tone: 'error' }); return; }
      act(ctx, async () => {
        await cloud.rpc('admin_set_blocked', { p_user: id, p_blocked: !blocked, p_reason: reason });
        invalidate(`user:${id}`); invalidate('users'); invalidate('dash');
      }, blocked ? 'Account unblocked' : 'Account blocked');
      break;
    }
    case 'delete-user': {
      const id = form.dataset.id;
      const email = f.email.value.trim();
      const reason = f.reason.value.trim();
      if (email.toLowerCase() !== form.dataset.email.toLowerCase()) { toast('The e-mail doesn’t match this account.', { tone: 'error' }); return; }
      if (!reason) { toast('Please give a reason.', { tone: 'error' }); return; }
      confirmAction({
        title: 'Delete this account permanently?',
        message: `${form.dataset.email} and all of its data will be deleted. This can’t be undone.`,
        confirmLabel: 'Delete account',
      }).then((ok) => {
        if (!ok) return;
        act(ctx, async () => {
          await cloud.rpc('admin_delete_user', { p_user: id, p_confirm_email: email, p_reason: reason });
          invalidate('users'); invalidate('dash'); cache.delete(`user:${id}`);
          ctx.replacePath(['users']); // leave the deleted account's page right away
        }, 'Account deleted');
      });
      break;
    }
    case 'email-settings':
      act(ctx, async () => {
        await cloud.rpc('admin_update_email_settings', { p_enabled: f.enabled.checked, p_when: f.when.value });
        invalidate('dash');
      }, 'Settings saved');
      break;
    default:
  }
}

// Chart tooltips (hover and keyboard focus).
function showTip(e) {
  const col = e.target.closest?.('[data-tip]');
  const chart = e.target.closest?.('[data-chart]');
  const tip = chart?.querySelector('.chart__tip');
  if (!tip) return;
  if (!col) { tip.hidden = true; return; }
  const box = chart.getBoundingClientRect();
  const r = col.getBoundingClientRect();
  tip.textContent = col.dataset.tip;
  tip.hidden = false;
  const x = Math.min(Math.max(r.left + r.width / 2 - box.left, 60), box.width - 60);
  tip.style.left = `${x}px`;
}
document.addEventListener('pointerover', (e) => { if (e.target.closest?.('[data-chart]')) showTip(e); });
document.addEventListener('pointerleave', (e) => { if (e.target.matches?.('[data-chart]')) e.target.querySelector('.chart__tip').hidden = true; }, true);

/** Leaving the admin page: loaded data is kept (Refresh reloads it); a redirect is forgotten. */
export function reset() {
  if (access.state === 'redirected') access = { user: null, state: 'unknown' };
}
