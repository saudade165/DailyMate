// Data layer. For now everything lives in this browser's localStorage — there is
// no account and no cloud sync. Keep the public API (getTasks, addTask, …) stable
// so this module can later be swapped for a real backend without touching the UI.

import { dayNumber, isValidISO, isValidTime, isValidTimeZone, localTimeZone, todayISO, zonedToInstant } from './dates.js';
import { isRepeat, nextDate, nextDateFrom } from './repeat.js';

const STORAGE_KEY = 'dailymate.v1';
const VERSION = 2;
const PRIORITIES = ['none', 'low', 'medium', 'high'];
const TITLE_MAX = 200;
const NOTES_MAX = 1000;
const NAME_MAX = 40;
const LIST_NAME_MAX = 60;
const ITEM_MAX = 200;
const ITEMS_PER_LIST_MAX = 500;
const LISTS_MAX = 100;

let state = emptyState();
let persistError = null; // null | 'unavailable' | 'quota' | 'corrupt'
const listeners = new Set();

function emptyState() {
  return { tasks: [], lists: [], reminders: [], profile: { name: '' } };
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const stamp = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : new Date().toISOString());

/** Returns a clean task object, or null if the input can't be repaired. */
function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, TITLE_MAX) : '';
  if (!title || !isValidISO(raw.date)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    title,
    date: raw.date,
    time: isValidTime(raw.time) ? raw.time : null,
    priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'none',
    notes: str(raw.notes, NOTES_MAX),
    repeat: isRepeat(raw.repeat) ? raw.repeat : null,
    // For a completed repeating task: the occurrence that was created from it.
    nextId: typeof raw.nextId === 'string' && raw.nextId ? raw.nextId : null,
    completed: raw.completed === true,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    createdAt: stamp(raw.createdAt),
    updatedAt: stamp(raw.updatedAt),
  };
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, ITEM_MAX) : '';
  if (!text) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    text,
    done: raw.done === true,
    createdAt: stamp(raw.createdAt),
  };
}

function normalizeList(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, LIST_NAME_MAX) : '';
  if (!name) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    name,
    items: Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter(Boolean).slice(0, ITEMS_PER_LIST_MAX) : [],
    createdAt: stamp(raw.createdAt),
    updatedAt: stamp(raw.updatedAt),
  };
}

function normalizeReminder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, TITLE_MAX) : '';
  if (!title || !isValidISO(raw.date) || !isValidTime(raw.time)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    title,
    date: raw.date,
    time: raw.time,
    tz: isValidTimeZone(raw.tz) ? raw.tz : localTimeZone(),
    repeat: isRepeat(raw.repeat) ? raw.repeat : null,
    taskId: typeof raw.taskId === 'string' && raw.taskId ? raw.taskId : null,
    notes: str(raw.notes, NOTES_MAX),
    done: raw.done === true,
    doneAt: typeof raw.doneAt === 'string' ? raw.doneAt : null,
    snoozedUntil: Number.isFinite(raw.snoozedUntil) ? raw.snoozedUntil : null,
    alertedFor: typeof raw.alertedFor === 'string' ? raw.alertedFor : null,
    createdAt: stamp(raw.createdAt),
    updatedAt: stamp(raw.updatedAt),
  };
}

function normalizeState(data) {
  const arr = (v, fn) => (Array.isArray(v) ? v.map(fn).filter(Boolean) : []);
  return {
    tasks: arr(data.tasks, normalizeTask),
    lists: arr(data.lists, normalizeList).slice(0, LISTS_MAX),
    reminders: arr(data.reminders, normalizeReminder),
    profile: { name: typeof data.profile?.name === 'string' ? data.profile.name.slice(0, NAME_MAX) : '' },
  };
}

function readStorage() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    persistError = 'unavailable';
    return;
  }
  if (!raw) return;
  try {
    state = normalizeState(JSON.parse(raw));
  } catch {
    // Keep the unreadable copy so nothing is silently lost, then start fresh.
    try { localStorage.setItem(`${STORAGE_KEY}.corrupt-${Date.now()}`, raw); } catch { /* ignore */ }
    persistError = 'corrupt';
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, ...state }));
    if (persistError !== 'corrupt') persistError = null;
  } catch (err) {
    persistError = err?.name === 'QuotaExceededError' ? 'quota' : 'unavailable';
  }
}

function emit() {
  listeners.forEach((fn) => fn());
}

function commit() {
  persist();
  emit();
}

// ---- Public API -----------------------------------------------------------

export function init() {
  readStorage();
  // Keep several open tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    readStorage();
    emit();
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getTasks = () => state.tasks;
export const getTask = (id) => state.tasks.find((t) => t.id === id) ?? null;
export const getProfile = () => state.profile;
export const getPersistError = () => persistError;
export const dismissCorruptWarning = () => { if (persistError === 'corrupt') { persistError = null; emit(); } };

/**
 * Validates task form data. Returns { task } on success or { errors } keyed by field.
 */
export function validateTask(input) {
  const errors = {};
  const title = (input.title ?? '').trim();
  if (!title) errors.title = 'Please enter a short name for the task.';
  else if (title.length > TITLE_MAX) errors.title = `Please keep it under ${TITLE_MAX} characters.`;
  if (!isValidISO(input.date)) errors.date = 'Please choose a date.';
  if (input.time && !isValidTime(input.time)) errors.time = 'Please enter a valid time.';
  if (Object.keys(errors).length) return { errors };
  return {
    task: {
      title,
      date: input.date,
      time: input.time || null,
      priority: PRIORITIES.includes(input.priority) ? input.priority : 'none',
      notes: (input.notes ?? '').trim().slice(0, NOTES_MAX),
      repeat: isRepeat(input.repeat) ? input.repeat : null,
    },
  };
}

export function addTask(input) {
  const now = new Date().toISOString();
  const task = normalizeTask({ ...input, id: newId(), completed: false, nextId: null, createdAt: now, updatedAt: now });
  if (!task) throw new Error('Invalid task');
  state = { ...state, tasks: [...state.tasks, task] };
  commit();
  return task;
}

export function updateTask(id, patch) {
  const current = getTask(id);
  if (!current) throw new Error('Task not found');
  const next = normalizeTask({ ...current, ...patch, id, updatedAt: new Date().toISOString() });
  if (!next) throw new Error('Invalid task');
  state = { ...state, tasks: state.tasks.map((t) => (t.id === id ? next : t)) };
  commit();
  return next;
}

/**
 * Completing a repeating task creates its next occurrence (missed dates are
 * skipped). Un-completing removes that occurrence again if it is untouched.
 * Returns the updated task; `task.nextId` points at the new occurrence.
 */
export function setCompleted(id, completed) {
  const current = getTask(id);
  if (!current) throw new Error('Task not found');
  if (current.completed === completed) return current;
  const now = new Date().toISOString();
  let tasks = state.tasks;
  let nextId = current.nextId;

  if (completed && current.repeat && !current.nextId) {
    const date = nextDateFrom(current.date, current.repeat, todayISO());
    const spawned = normalizeTask({
      ...current, id: newId(), date, completed: false, completedAt: null, nextId: null, createdAt: now, updatedAt: now,
    });
    tasks = [...tasks, spawned];
    nextId = spawned.id;
  } else if (!completed && current.nextId) {
    const spawned = tasks.find((t) => t.id === current.nextId);
    if (spawned && !spawned.completed && spawned.createdAt === spawned.updatedAt) {
      tasks = tasks.filter((t) => t.id !== spawned.id);
    }
    nextId = null;
  }

  const updated = normalizeTask({ ...current, completed, completedAt: completed ? now : null, nextId, updatedAt: now });
  state = { ...state, tasks: tasks.map((t) => (t.id === id ? updated : t)) };
  commit();
  return updated;
}

export function deleteTask(id) {
  const task = getTask(id);
  if (!task) return null;
  // Reminders linked to this task stay, but lose the link.
  const reminders = state.reminders.map((r) => (r.taskId === id ? { ...r, taskId: null } : r));
  state = { ...state, tasks: state.tasks.filter((t) => t.id !== id), reminders };
  commit();
  return task;
}

export function setProfileName(name) {
  state = { ...state, profile: { ...state.profile, name: name.trim().slice(0, NAME_MAX) } };
  commit();
}

// ---- Lists ------------------------------------------------------------------

export const getLists = () => state.lists;
export const getList = (id) => state.lists.find((l) => l.id === id) ?? null;
export const LIMITS = { LIST_NAME_MAX, ITEM_MAX, ITEMS_PER_LIST_MAX, LISTS_MAX, TITLE_MAX, NOTES_MAX };

function setList(id, fn) {
  const list = getList(id);
  if (!list) throw new Error('List not found');
  const next = normalizeList({ ...fn(list), id, updatedAt: new Date().toISOString() });
  if (!next) throw new Error('Invalid list');
  state = { ...state, lists: state.lists.map((l) => (l.id === id ? next : l)) };
  commit();
  return next;
}

export function addList(name, items = []) {
  if (state.lists.length >= LISTS_MAX) throw new Error('Too many lists');
  const now = new Date().toISOString();
  const list = normalizeList({ id: newId(), name, items: items.map((text) => ({ id: newId(), text, createdAt: now })), createdAt: now, updatedAt: now });
  if (!list) throw new Error('Invalid list');
  state = { ...state, lists: [...state.lists, list] };
  commit();
  return list;
}

export const renameList = (id, name) => setList(id, (l) => ({ ...l, name }));

export function deleteList(id) {
  const list = getList(id);
  if (!list) return null;
  state = { ...state, lists: state.lists.filter((l) => l.id !== id) };
  commit();
  return list;
}

/** Replaces a list with an earlier copy of itself (used by "Undo"). */
export function putList(list) {
  const clean = normalizeList(list);
  if (!clean) return;
  state = { ...state, lists: getList(clean.id) ? state.lists.map((l) => (l.id === clean.id ? clean : l)) : [...state.lists, clean] };
  commit();
}

/** Puts a deleted list back where it was (used by "Undo"). */
export function restoreList(list, index) {
  if (getList(list.id)) return;
  const lists = [...state.lists];
  lists.splice(Math.min(index, lists.length), 0, list);
  state = { ...state, lists };
  commit();
}

export function addItem(listId, text) {
  const item = normalizeItem({ id: newId(), text, createdAt: new Date().toISOString() });
  if (!item) throw new Error('Invalid item');
  setList(listId, (l) => {
    if (l.items.length >= ITEMS_PER_LIST_MAX) throw new Error('List is full');
    return { ...l, items: [...l.items, item] };
  });
  return item;
}

export const updateItem = (listId, itemId, patch) =>
  setList(listId, (l) => ({ ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, ...patch, id: itemId } : i)) }));

export function deleteItem(listId, itemId) {
  const list = getList(listId);
  const index = list?.items.findIndex((i) => i.id === itemId) ?? -1;
  if (index < 0) return null;
  const item = list.items[index];
  setList(listId, (l) => ({ ...l, items: l.items.filter((i) => i.id !== itemId) }));
  return { item, index };
}

export function restoreItem(listId, item, index) {
  setList(listId, (l) => {
    const items = [...l.items];
    items.splice(Math.min(index, items.length), 0, item);
    return { ...l, items };
  });
}

/** Moves an item up (-1) or down (+1). */
export function moveItem(listId, itemId, delta) {
  setList(listId, (l) => {
    const items = [...l.items];
    const i = items.findIndex((x) => x.id === itemId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= items.length) return l;
    [items[i], items[j]] = [items[j], items[i]];
    return { ...l, items };
  });
}

export const clearCompleted = (listId) => setList(listId, (l) => ({ ...l, items: l.items.filter((i) => !i.done) }));
export const uncheckAll = (listId) => setList(listId, (l) => ({ ...l, items: l.items.map((i) => ({ ...i, done: false })) }));

// ---- Reminders ----------------------------------------------------------------

export const getReminders = () => state.reminders;
export const getReminder = (id) => state.reminders.find((r) => r.id === id) ?? null;

/** When the reminder is due (ms since epoch), ignoring snooze. */
export const reminderDueAt = (r) => zonedToInstant(r.date, r.time, r.tz);
/** When it should alert next: the snooze time if snoozed, otherwise the due time. */
export const reminderAlertAt = (r) => (r.snoozedUntil && r.snoozedUntil > reminderDueAt(r) ? r.snoozedUntil : reminderDueAt(r));

export function validateReminder(input) {
  const errors = {};
  const title = (input.title ?? '').trim();
  if (!title) errors.title = 'Please say what to remind you about.';
  else if (title.length > TITLE_MAX) errors.title = `Please keep it under ${TITLE_MAX} characters.`;
  if (!isValidISO(input.date)) errors.date = 'Please choose a date.';
  if (!isValidTime(input.time)) errors.time = 'Please choose a time.';
  if (Object.keys(errors).length) return { errors };
  return {
    reminder: {
      title,
      date: input.date,
      time: input.time,
      tz: isValidTimeZone(input.tz) ? input.tz : localTimeZone(),
      repeat: isRepeat(input.repeat) ? input.repeat : null,
      taskId: input.taskId && getTask(input.taskId) ? input.taskId : null,
      notes: (input.notes ?? '').trim().slice(0, NOTES_MAX),
    },
  };
}

export function addReminder(input) {
  const now = new Date().toISOString();
  const reminder = normalizeReminder({ ...input, id: newId(), done: false, createdAt: now, updatedAt: now });
  if (!reminder) throw new Error('Invalid reminder');
  state = { ...state, reminders: [...state.reminders, reminder] };
  commit();
  return reminder;
}

export function updateReminder(id, patch) {
  const current = getReminder(id);
  if (!current) throw new Error('Reminder not found');
  const next = normalizeReminder({ ...current, ...patch, id, updatedAt: new Date().toISOString() });
  if (!next) throw new Error('Invalid reminder');
  state = { ...state, reminders: state.reminders.map((r) => (r.id === id ? next : r)) };
  commit();
  return next;
}

/**
 * Marks a reminder done. A repeating reminder moves on to its next date in the
 * future instead, and stays active.
 */
export function completeReminder(id) {
  const r = getReminder(id);
  if (!r) throw new Error('Reminder not found');
  const doneAt = new Date().toISOString();
  if (r.repeat) {
    const anchor = dayNumber(r.date);
    let date = r.date;
    // Skip occurrences that are already in the past.
    for (let i = 0; i < 2000; i += 1) {
      date = nextDate(date, r.repeat, anchor);
      if (zonedToInstant(date, r.time, r.tz) > Date.now()) break;
    }
    return updateReminder(id, { date, snoozedUntil: null, alertedFor: null, doneAt });
  }
  return updateReminder(id, { done: true, doneAt, snoozedUntil: null });
}

export const reopenReminder = (id) => updateReminder(id, { done: false, doneAt: null, alertedFor: null });
export const snoozeReminder = (id, minutes) => updateReminder(id, { snoozedUntil: Date.now() + minutes * 60_000 });
export const markReminderAlerted = (id, key) => updateReminder(id, { alertedFor: key });

/** Puts a deleted reminder back exactly as it was (used by "Undo"). */
export function restoreReminder(reminder) {
  const clean = normalizeReminder(reminder);
  if (!clean || getReminder(clean.id)) return;
  state = { ...state, reminders: [...state.reminders, clean] };
  commit();
}

export function deleteReminder(id) {
  const r = getReminder(id);
  if (!r) return null;
  state = { ...state, reminders: state.reminders.filter((x) => x.id !== id) };
  commit();
  return r;
}

// ---- Backup -------------------------------------------------------------------

export function exportData() {
  return { app: 'DailyMate', version: VERSION, exportedAt: new Date().toISOString(), ...state };
}

/** Replaces all data with a backup. Returns counts, or throws if the file isn't a DailyMate backup. */
export function importData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) throw new Error('Not a DailyMate backup');
  state = normalizeState(data);
  commit();
  return { tasks: state.tasks.length, lists: state.lists.length, reminders: state.reminders.length };
}
