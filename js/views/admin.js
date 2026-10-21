// Admin panel (#/admin). Not linked for regular users, but that is not the
// protection: every number and list here comes from database functions that
// check admin rights on the server (public.is_admin / private.require_admin)
// and refuse everyone else. Shows account facts and counts — never the
// contents of anyone's tasks, lists or reminders.

import * as cloud from '../cloud.js';
import { esc, icon, toast } from '../ui.js';

export const title = 'Admin';

let data = null;      // null = not loaded; { denied } | { error } | { overview, users, deliveries, events, audit }
let loading = false;
let search = '';

const fmt = (iso) => (iso ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—');
const n = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString() : '—');
const mb = (bytes) => `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`;

async function load(ctx) {
  if (loading) return;
  loading = true;
  try {
    if (!(await cloud.rpc('is_admin'))) {
      data = { denied: true };
    } else {
      const [overview, users, deliveries, events, audit] = await Promise.all([
        cloud.rpc('admin_overview'),
        cloud.rpc('admin_list_users', { p_search: search, p_limit: 50, p_offset: 0 }),
        cloud.rpc('admin_recent_deliveries', { p_limit: 30 }),
        cloud.rpc('admin_recent_events', { p_limit: 30 }),
        cloud.rpc('admin_audit', { p_limit: 30 }),
      ]);
      data = { overview, users, deliveries, events, audit };
    }
  } catch (err) {
    data = err?.code === '42501' ? { denied: true } : { error: true };
  }
  loading = false;
  ctx.rerender();
}

const stat = (label, value, tone = 'blue') => `
  <div class="stat"><span class="stat__icon stat__icon--${tone}">${icon('chart')}</span>
    <span><span class="stat__value">${value}</span><span class="stat__label">${esc(label)}</span></span></div>`;

function table(headers, rows, empty) {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<div class="table-wrap"><table class="table">
    <thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function dashboard() {
  const { overview: o, users, deliveries, events, audit } = data;
  const d24 = o.push.deliveries24h ?? {};
  return `
    <section class="stats" aria-label="Summary">
      ${stat('Accounts', n(o.users.total))}
      ${stat('Confirmed emails', n(o.users.confirmed), 'green')}
      ${stat('New in 7 days', n(o.users.new7d), 'violet')}
      ${stat('Signed in, 7 days', n(o.users.active7d), 'amber')}
    </section>

    <section class="card" aria-labelledby="health-h">
      <h2 class="card__title" id="health-h">Integrations & health</h2>
      <ul class="plain-list">
        <li><strong>Push notifications:</strong> ${o.push.configured ? 'server keys ready' : '<span class="text-warn">server keys not created yet</span>'} ·
          ${n(o.push.activeDevices)} active devices · ${n(o.push.disabledDevices)} stopped ·
          last sent ${esc(fmt(o.push.lastSentAt))}</li>
        <li><strong>Deliveries (24 h):</strong> ${Object.keys(d24).length ? Object.entries(d24).map(([k, v]) => `${esc(k)} ${n(v)}`).join(' · ') : 'none'}</li>
        <li><strong>Errors logged (24 h):</strong> ${o.errors24h ? `<span class="text-warn">${n(o.errors24h)}</span>` : '0'}</li>
        <li><strong>Plans:</strong> ${Object.keys(o.plans ?? {}).length ? Object.entries(o.plans).map(([k, v]) => `${esc(k)} ${n(v)}`).join(' · ') : 'no plan records (everyone is on Free)'}</li>
        <li><strong>AI Assistant:</strong> not connected (no AI provider configured)</li>
        ${(o.cron ?? []).map((j) => `<li><strong>Job ${esc(j.job)}</strong> (${esc(j.schedule)}): ${j.active ? 'active' : 'paused'}${j.lastRun
          ? ` · last run ${esc(fmt(j.lastRun.start))} — ${j.lastRun.status === 'succeeded' ? 'OK' : `<span class="text-warn">${esc(j.lastRun.status)}: ${esc(j.lastRun.message ?? '')}</span>`}` : ' · not run yet'}</li>`).join('')}
        <li><strong>Database:</strong> Postgres ${esc(o.database.version)} · ${esc(mb(o.database.sizeBytes))} · ${n(o.migrations.length)} migrations
          (latest ${esc(o.migrations.at(-1)?.name ?? '—')})</li>
        <li><strong>Website:</strong> GitHub Pages — this page was loaded from <code>${esc(location.host)}</code></li>
      </ul>
    </section>

    <section class="card" aria-labelledby="users-h">
      <div class="card__head card__head--wrap">
        <h2 class="card__title" id="users-h">Accounts</h2>
        <form class="inline-form" data-form="admin-search" role="search">
          <label class="visually-hidden" for="admin-search">Search by email</label>
          <input class="input input--sm" id="admin-search" name="q" type="search" placeholder="Search by email" value="${esc(search)}" maxlength="100" data-focus-key="admin-search">
          <button class="btn btn--outline btn--sm" type="submit">Search</button>
        </form>
      </div>
      <p class="muted small">Counts only. Viewing this list is recorded in the audit log.</p>
      ${table(['Email', 'Joined', 'Last sign-in', 'Plan', 'Tasks', 'Lists', 'Reminders', 'Push', ''], users.map((u) => [
        `${esc(u.email)}${u.email_confirmed ? '' : ' <span class="badge">unconfirmed</span>'}${u.is_admin ? ' <span class="badge badge--plus">admin</span>' : ''}`,
        esc(fmt(u.created_at)), esc(fmt(u.last_sign_in_at)), esc(`${u.plan} (${u.plan_status})`),
        n(u.tasks), n(u.lists), n(u.reminders), n(u.push_devices),
        Number(u.push_devices) ? `<button class="btn btn--ghost btn--sm" type="button" data-action="disable-push" data-id="${esc(u.id)}" data-email="${esc(u.email)}">Stop push</button>` : '',
      ]), 'No accounts found.')}
    </section>

    <section class="card" aria-labelledby="deliv-h">
      <h2 class="card__title" id="deliv-h">Recent notification deliveries</h2>
      ${table(['When', 'Kind', 'Status', 'Attempts', 'HTTP', 'Error'], deliveries.map((d) => [
        esc(fmt(d.created_at)), esc(d.kind), esc(d.status), n(d.attempts), esc(d.http_status ?? ''), esc((d.last_error ?? '').slice(0, 80)),
      ]), 'No deliveries yet.')}
    </section>

    <section class="card" aria-labelledby="events-h">
      <h2 class="card__title" id="events-h">Server log</h2>
      ${table(['When', 'Source', 'Level', 'Message'], events.map((e) => [
        esc(fmt(e.created_at)), esc(e.source), e.level === 'error' ? `<span class="text-warn">${esc(e.level)}</span>` : esc(e.level), esc(e.message),
      ]), 'Nothing logged.')}
    </section>

    <section class="card" aria-labelledby="audit-h">
      <h2 class="card__title" id="audit-h">Admin audit log</h2>
      ${table(['When', 'Admin', 'Action', 'Details'], audit.map((a) => [
        esc(fmt(a.created_at)), `<code>${esc(String(a.admin_id ?? '').slice(0, 8))}</code>`, esc(a.action), `<code>${esc(JSON.stringify(a.details))}</code>`,
      ]), 'No admin actions yet.')}
    </section>`;
}

export function render() {
  const auth = cloud.getAuth();
  let body;
  if (auth.status !== 'signed-in') body = `<section class="card"><p>Please <a href="#/account">sign in</a> with an admin account.</p></section>`;
  else if (!data) body = '<p class="loading"><span class="spinner" aria-hidden="true"></span> Loading…</p>';
  else if (data.denied) body = `<section class="card"><p>${icon('lock')} This page is only for DailyMate administrators.</p></section>`;
  else if (data.error) body = `<section class="card"><p>Couldn’t load the admin data. <button class="btn btn--outline btn--sm" type="button" data-action="reload">Try again</button></p></section>`;
  else body = dashboard();
  return `
    <div class="page">
      <header class="page-head">
        <div>
          <h1 class="page-title">Admin</h1>
          <p class="page-subtitle">Service health and accounts</p>
        </div>
        ${data && !data.denied ? '<button class="btn btn--outline" type="button" data-action="reload">Refresh</button>' : ''}
      </header>
      ${body}
    </div>`;
}

export function afterRender(params, ctx) {
  if (!data && cloud.getAuth().status === 'signed-in') load(ctx);
}

export function onSubmit(e, ctx) {
  if (e.target.dataset.form !== 'admin-search') return;
  e.preventDefault();
  search = e.target.elements.q.value.trim();
  load(ctx);
}

export async function onClick(e, ctx) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'reload') { data = null; ctx.rerender(); }
  if (btn.dataset.action === 'disable-push') {
    const reason = window.prompt(`Why stop push notifications for ${btn.dataset.email}? (recorded in the audit log)`);
    if (!reason?.trim()) return;
    try {
      const count = await cloud.rpc('admin_disable_push', { p_user: btn.dataset.id, p_reason: reason.trim() });
      toast(`Stopped notifications on ${count} device${count === 1 ? '' : 's'}`);
    } catch { toast('That didn’t work. Please try again.', { tone: 'error' }); }
    data = null;
    ctx.rerender();
  }
}

export function reset() { data = null; }
