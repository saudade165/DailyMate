// Cloud sync for signed-in people.
//
// The browser keeps working on its own copy (localStorage) and syncs in the
// background, so the app stays fast and works offline:
//   * Every local change is written to an "outbox" (also in localStorage, so it
//     survives reloads and being offline) and uploaded shortly after.
//   * Changes from other devices are downloaded when DailyMate opens, comes back to
//     the foreground or goes online, and every minute while it is visible.
//   * Conflicts are settled per item: the most recent change wins. The server
//     enforces the same rule, so a late upload can't overwrite a newer edit.
//   * Deleted items are uploaded as "deleted" markers so other devices remove them too.

import * as store from './store.js';
import * as cloud from './cloud.js';

const OUTBOX_KEY = 'dailymate.outbox';
const CURSOR_KEY = 'dailymate.sync';
const PULL_EVERY_MS = 60_000;
const PUSH_DELAY_MS = 800;
const OVERLAP_MS = 2 * 60_000; // re-read a little of the past: commits can land slightly out of order
const PAGE = 1000;

// ---- Mapping between the app's records and database rows ----------------------------------

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const ms = (v) => (v ? Date.parse(v) : null);

const COLLECTIONS = {
  tasks: {
    table: 'tasks',
    toRow: (t) => ({
      id: t.id, title: t.title, date: t.date, time: t.time, priority: t.priority, notes: t.notes, repeat: t.repeat,
      next_id: t.nextId, completed: t.completed, completed_at: t.completedAt, created_at: t.createdAt,
    }),
    fromRow: (r) => ({
      id: r.id, title: r.title, date: r.date, time: r.time, priority: r.priority, notes: r.notes, repeat: r.repeat,
      nextId: r.next_id, completed: r.completed, completedAt: r.completed_at, createdAt: r.created_at, updatedAt: r.updated_at,
    }),
    tombstone: { title: '-', date: '2000-01-01' },
  },
  lists: {
    table: 'lists',
    toRow: (l, index) => ({ id: l.id, name: l.name, items: l.items, position: index, created_at: l.createdAt }),
    fromRow: (r) => ({ id: r.id, name: r.name, items: r.items, createdAt: r.created_at, updatedAt: r.updated_at, position: r.position }),
    tombstone: { name: '-' },
  },
  reminders: {
    table: 'reminders',
    toRow: (r) => ({
      id: r.id, title: r.title, date: r.date, time: r.time, tz: r.tz, repeat: r.repeat, task_id: r.taskId, notes: r.notes,
      done: r.done, done_at: r.doneAt, snoozed_until: iso(r.snoozedUntil), alerted_for: r.alertedFor, created_at: r.createdAt,
    }),
    fromRow: (r) => ({
      id: r.id, title: r.title, date: r.date, time: r.time, tz: r.tz, repeat: r.repeat, taskId: r.task_id, notes: r.notes,
      done: r.done, doneAt: r.done_at, snoozedUntil: ms(r.snoozed_until), alertedFor: r.alerted_for,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }),
    tombstone: { title: '-', date: '2000-01-01', time: '00:00', tz: 'UTC' },
  },
};
const NAMES = Object.keys(COLLECTIONS);

// ---- Status (shown in Profile and the sidebar) -------------------------------------------

let status = { state: 'off', lastSync: null, pending: 0, message: '' }; // off | syncing | synced | offline | error
const listeners = new Set();
export const getStatus = () => status;
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setStatus(patch) {
  status = { ...status, ...patch, pending: Object.keys(outbox).length };
  listeners.forEach((fn) => fn(status));
}

// ---- Outbox -----------------------------------------------------------------------------

let outbox = {}; // "tasks:<id>" | "profile" -> { op: 'upsert' | 'delete', at: ISO time of the change }

function loadOutbox() {
  try { outbox = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '{}') || {}; } catch { outbox = {}; }
}
function saveOutbox() {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch { /* storage full: still in memory */ }
}

/** When a change happened. Undo puts back old copies, so their own updatedAt can't be used. */
function changeTime(record) {
  const now = Date.now();
  const t = ms(record?.updatedAt);
  return iso(t && t > now - 2000 && t <= now + 1000 ? t : now);
}

function recordChanges(prev, next) {
  if (!next.owner) return; // not signed in: nothing to upload
  for (const name of NAMES) {
    const before = new Map(prev[name].map((x) => [x.id, x]));
    for (const rec of next[name]) {
      if (before.get(rec.id) !== rec) outbox[`${name}:${rec.id}`] = { op: 'upsert', at: changeTime(rec) };
      before.delete(rec.id);
    }
    for (const id of before.keys()) outbox[`${name}:${id}`] = { op: 'delete', at: iso(Date.now()) };
  }
  if (prev.profile !== next.profile) outbox.profile = { op: 'upsert', at: changeTime(next.profile) };
  saveOutbox();
  schedulePush();
}

/** Queues everything currently saved (used when someone adds this device's data to their account). */
function queueAll() {
  const s = store.getState();
  for (const name of NAMES) for (const rec of s[name]) outbox[`${name}:${rec.id}`] = { op: 'upsert', at: rec.updatedAt || iso(Date.now()) };
  if (s.profile.name) outbox.profile = { op: 'upsert', at: s.profile.updatedAt || iso(Date.now()) };
  saveOutbox();
}

// ---- Upload -----------------------------------------------------------------------------

let pushTimer = null;
let pushing = null;
let retryDelay = 5_000;

function schedulePush(delay = PUSH_DELAY_MS) {
  if (!active()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { push().catch(() => {}); }, delay);
}

const active = () => cloud.getAuth().status === 'signed-in' && store.getOwner() === cloud.getUser()?.id;
const isNetworkError = (e) => !e?.code || /fetch|network|load failed/i.test(String(e?.message));

async function push() {
  if (!active()) return;
  if (pushing) { await pushing; return push(); }
  pushing = (async () => {
    const entries = Object.entries(outbox);
    if (!entries.length) return;
    setStatus({ state: 'syncing' });
    const client = await cloud.getClient();
    const uid = cloud.getUser().id;
    const s = store.getState();
    const done = [];

    for (const name of NAMES) {
      const col = COLLECTIONS[name];
      const list = s[name];
      const rows = [];
      for (const [key, entry] of entries) {
        if (!key.startsWith(`${name}:`)) continue;
        const id = key.slice(name.length + 1);
        const index = list.findIndex((x) => x.id === id);
        const row = index >= 0 && entry.op === 'upsert'
          ? { ...col.toRow(list[index], index), deleted_at: null }
          : { id, ...col.tombstone, deleted_at: entry.at };
        rows.push({ ...row, user_id: uid, updated_at: entry.at });
        done.push([key, entry.at]);
      }
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const { error } = await client.from(col.table).upsert(chunk, { onConflict: 'user_id,id' });
        if (error && isNetworkError(error)) throw error;
        if (error) {
          // One bad item must not block everything else: retry one by one and drop what the server rejects.
          for (const row of chunk) {
            const { error: rowError } = await client.from(col.table).upsert(row, { onConflict: 'user_id,id' });
            if (rowError && isNetworkError(rowError)) throw rowError;
            if (rowError) console.warn(`DailyMate: the server rejected a change to ${name}`, rowError.message);
          }
        }
      }
    }
    if (outbox.profile) {
      const at = outbox.profile.at;
      const { error } = await client.from('profiles').update({ display_name: s.profile.name, updated_at: at }).eq('id', uid);
      if (error) throw error;
      done.push(['profile', at]);
    }
    // Only clear what was uploaded; anything changed again meanwhile stays queued.
    for (const [key, at] of done) if (outbox[key]?.at === at) delete outbox[key];
    saveOutbox();
  })();
  try {
    await pushing;
    retryDelay = 5_000;
    setStatus({ state: 'synced', lastSync: Date.now(), message: '' });
  } catch (err) {
    const offline = !navigator.onLine || isNetworkError(err);
    setStatus({ state: offline ? 'offline' : 'error', message: offline ? '' : 'Some changes couldn’t be uploaded yet.' });
    schedulePush(retryDelay);
    retryDelay = Math.min(retryDelay * 3, 5 * 60_000);
    throw err;
  } finally {
    pushing = null;
  }
}

// ---- Download ---------------------------------------------------------------------------

function readCursor(uid) {
  try {
    const c = JSON.parse(localStorage.getItem(CURSOR_KEY) || 'null');
    return c?.user === uid ? c : { user: uid, since: null };
  } catch { return { user: uid, since: null }; }
}
function writeCursor(c) {
  try { localStorage.setItem(CURSOR_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

async function fetchChanged(client, table, since) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = client.from(table).select('*').order('synced_at', { ascending: true }).range(from, from + PAGE - 1);
    if (since) q = q.gt('synced_at', since);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/** Applies downloaded rows to the local list. Returns null when nothing changed. */
function mergeCollection(name, local, rows) {
  const col = COLLECTIONS[name];
  const byId = new Map(local.map((x) => [x.id, x]));
  const added = [];
  let changed = false;
  for (const row of rows) {
    const key = `${name}:${row.id}`;
    const pending = outbox[key];
    if (pending && ms(pending.at) > ms(row.updated_at)) continue; // our newer change will be uploaded
    if (pending) delete outbox[key]; // a change from elsewhere is as new or newer
    const mine = byId.get(row.id);
    if (row.deleted_at) {
      if (mine) { byId.delete(row.id); changed = true; }
      continue;
    }
    if (mine && !pending && ms(mine.updatedAt) >= ms(row.updated_at)) continue; // already have it (or newer)
    const rec = col.fromRow(row);
    if (!mine) added.push(rec);
    byId.set(row.id, rec);
    changed = true;
  }
  if (!changed) return null;
  // Keep the local order; new items go at the end (lists by their position).
  const kept = local.filter((x) => byId.has(x.id)).map((x) => byId.get(x.id));
  if (name === 'lists') added.sort((a, b) => a.position - b.position);
  return [...kept, ...added];
}

async function pull() {
  if (!active()) return;
  const client = await cloud.getClient();
  const uid = cloud.getUser().id;
  const cursor = readCursor(uid);
  const since = cursor.since ? iso(ms(cursor.since) - OVERLAP_MS) : null;
  setStatus({ state: 'syncing' });

  const results = {};
  let newest = cursor.since;
  for (const name of NAMES) {
    results[name] = await fetchChanged(client, COLLECTIONS[name].table, since);
    for (const r of results[name]) if (!newest || r.synced_at > newest) newest = r.synced_at;
  }
  const { data: profile, error } = await client.from('profiles').select('display_name, updated_at').eq('id', uid).maybeSingle();
  if (error) throw error;
  if (!active()) return; // signed out while downloading

  const s = store.getState();
  const next = { ...s };
  let changed = false;
  for (const name of NAMES) {
    const merged = mergeCollection(name, s[name], results[name]);
    if (merged) { next[name] = merged; changed = true; }
  }
  if (profile && !outbox.profile && ms(profile.updated_at) > (ms(s.profile.updatedAt) ?? 0) && profile.display_name !== s.profile.name) {
    next.profile = { name: profile.display_name, updatedAt: profile.updated_at };
    changed = true;
  }
  if (changed) store.applyRemote(next);
  saveOutbox();
  writeCursor({ user: uid, since: newest });
  setStatus({ state: 'synced', lastSync: Date.now(), message: '' });
}

/** Download, then upload. Safe to call any time. */
export async function syncNow() {
  if (!active()) return;
  try {
    await pull();
    await push();
  } catch (err) {
    const offline = !navigator.onLine || isNetworkError(err);
    setStatus({ state: offline ? 'offline' : 'error', message: offline ? '' : 'Sync failed. We’ll keep trying.' });
  }
}

// ---- Signing in and out -------------------------------------------------------------------

/**
 * Called when someone is signed in. `chooseLocalData(counts)` is asked what to do with
 * data that was saved on this device before signing in: resolves to 'merge' or 'separate'.
 */
export async function attach(user, { chooseLocalData, downloadBackup }) {
  const owner = store.getOwner();
  if (owner && owner !== user.id) {
    // Saved data belongs to a different account that wasn't signed out properly.
    if (Object.keys(outbox).length) downloadBackup('unsynced');
    store.resetLocal();
    outbox = {}; saveOutbox();
  }
  if (!store.getOwner()) {
    if (store.hasData()) {
      const s = store.getState();
      const choice = await chooseLocalData({ tasks: s.tasks.length, lists: s.lists.length, reminders: s.reminders.length });
      if (choice === 'merge') {
        store.setOwner(user.id);
        queueAll();
      } else {
        downloadBackup('before-sign-in');
        store.resetLocal();
        store.setOwner(user.id);
      }
    } else {
      store.setOwner(user.id);
    }
    writeCursor({ user: user.id, since: null });
  }
  setStatus({ state: 'syncing' });
  await syncNow();
}

/** Uploads what's left. Returns the number of changes that could not be uploaded. */
export async function flush() {
  if (!active()) return Object.keys(outbox).length;
  try { await push(); } catch { /* counted below */ }
  return Object.keys(outbox).length;
}

/** Forgets this browser's copy (after sign-out or account deletion). */
export function detach() {
  clearTimeout(pushTimer);
  outbox = {}; saveOutbox();
  try { localStorage.removeItem(CURSOR_KEY); } catch { /* ignore */ }
  store.resetLocal();
  setStatus({ state: 'off', lastSync: null, message: '' });
}

export const pendingCount = () => Object.keys(outbox).length;

// ---- Start ------------------------------------------------------------------------------

export function init() {
  loadOutbox();
  store.setChangeHook(recordChanges);
  window.addEventListener('storage', (e) => { if (e.key === OUTBOX_KEY) loadOutbox(); });
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, PULL_EVERY_MS);
}
