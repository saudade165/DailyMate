// Data layer. Everything is kept in this browser's localStorage, so the app works
// offline and without an account. When someone signs in, js/sync.js copies changes
// to and from their account: it watches changes through setChangeHook() and puts
// data from the cloud in place with applyRemote().
//
// `owner` is the account this saved data belongs to (null = not signed in), so one
// person's data is never shown to, or uploaded into, someone else's account.

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
let committed = state; // the state the change hook last saw
let persistError = null; // null | 'unavailable' | 'quota' | 'corrupt'
const listeners = new Set();
let changeHook = null; // (previous state, next state) => void — called for the person's own changes

function emptyState() {
  return { owner: null, tasks: [], lists: [], reminders: [], goals: [], achievements: {}, profile: { name: '', updatedAt: null } };
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

const GOAL_KINDS = ['tasks', 'active_days', 'streak', 'list', 'custom'];
const GOAL_STATUSES = ['active', 'paused', 'completed'];
const GOAL_TARGET_MAX = 10000;
const intIn = (v, min, max, fallback) => (Number.isInteger(v) && v >= min && v <= max ? v : fallback);

function normalizeGoal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, TITLE_MAX) : '';
  if (!title) return null;
  const kind = GOAL_KINDS.includes(raw.kind) ? raw.kind : 'custom';
  const startDate = isValidISO(raw.startDate) ? raw.startDate : (typeof raw.createdAt === 'string' ? raw.createdAt.slice(0, 10) : todayISO());
  const deadline = isValidISO(raw.deadline) && raw.deadline >= startDate ? raw.deadline : null;
  const status = GOAL_STATUSES.includes(raw.status) ? raw.status : 'active';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    title,
    notes: str(raw.notes, NOTES_MAX),
    kind,
    target: intIn(raw.target, 1, GOAL_TARGET_MAX, 1),
    startDate: isValidISO(startDate) ? startDate : todayISO(),
    deadline,
    status,
    priority: ['any', 'high', 'medium', 'low'].includes(raw.priority) ? raw.priority : 'any',
    period: raw.period === 'week' ? 'week' : 'day',
    listId: typeof raw.listId === 'string' && raw.listId ? raw.listId.slice(0, 64) : null,
    manualProgress: intIn(raw.manualProgress, 0, GOAL_TARGET_MAX, 0),
    // The progress reached when the goal was completed, so later edits to tasks don't change it.
    achieved: status === 'completed' && Number.isInteger(raw.achieved) && raw.achieved >= 0 ? raw.achieved : null,
    completedAt: status === 'completed' && typeof raw.completedAt === 'string' ? raw.completedAt : null,
    createdAt: stamp(raw.createdAt),
    updatedAt: stamp(raw.updatedAt),
  };
}

/** { achievementId: ISO date earned } — only well-formed entries. */
function normalizeAchievements(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (/^[a-z0-9_]{1,40}$/.test(k) && typeof v === 'string' && !Number.isNaN(Date.parse(v))) out[k] = v;
  }
  return out;
}

function normalizeState(data) {
  const arr = (v, fn) => (Array.isArray(v) ? v.map(fn).filter(Boolean) : []);
  return {
    owner: typeof data.owner === 'string' && data.owner ? data.owner : null,
    tasks: arr(data.tasks, normalizeTask),
    lists: arr(data.lists, normalizeList).slice(0, LISTS_MAX),
    reminders: arr(data.reminders, normalizeReminder),
    goals: arr(data.goals, normalizeGoal).slice(0, 200),
    achievements: normalizeAchievements(data.achievements),
    profile: {
      name: typeof data.profile?.name === 'string' ? data.profile.name.slice(0, NAME_MAX) : '',
      updatedAt: typeof data.profile?.updatedAt === 'string' ? data.profile.updatedAt : null,
    },
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
  if (!raw) { state = emptyState(); committed = state; return; }
  try {
    state = normalizeState(JSON.parse(raw));
    committed = state;
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
  const previous = committed;
  committed = state;
  persist();
  changeHook?.(previous, state);
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
  state = { ...state, profile: { name: name.trim().slice(0, NAME_MAX), updatedAt: new Date().toISOString() } };
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

// ---- Goals --------------------------------------------------------------------

export const getGoals = () => state.goals;
export const getGoal = (id) => state.goals.find((g) => g.id === id) ?? null;
export const GOAL_LIMITS = { TARGET_MAX: GOAL_TARGET_MAX, GOALS_MAX: 200 };

/** Validates goal form data. Returns { goal } or { errors } keyed by field. */
export function validateGoal(input) {
  const errors = {};
  const title = (input.title ?? '').trim();
  if (!title) errors.title = 'Please give the goal a short name.';
  else if (title.length > TITLE_MAX) errors.title = `Please keep it under ${TITLE_MAX} characters.`;
  const kind = GOAL_KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) errors.kind = 'Please choose what kind of goal this is.';
  const target = Number(input.target);
  if (kind !== 'list' && (!Number.isInteger(target) || target < 1 || target > GOAL_TARGET_MAX)) {
    errors.target = `Please enter a whole number from 1 to ${GOAL_TARGET_MAX.toLocaleString('en-US')}.`;
  }
  if (kind === 'list' && !getList(input.listId)) errors.listId = 'Please choose a list.';
  if (!isValidISO(input.startDate)) errors.startDate = 'Please choose a start date.';
  if (input.deadline && !isValidISO(input.deadline)) errors.deadline = 'Please enter a valid date.';
  else if (input.deadline && isValidISO(input.startDate) && input.deadline < input.startDate) errors.deadline = 'The deadline can’t be before the start date.';
  if (Object.keys(errors).length) return { errors };
  return {
    goal: {
      title,
      notes: (input.notes ?? '').trim().slice(0, NOTES_MAX),
      kind,
      target: kind === 'list' ? 1 : target,
      startDate: input.startDate,
      deadline: input.deadline || null,
      priority: kind === 'tasks' && ['high', 'medium', 'low'].includes(input.priority) ? input.priority : 'any',
      period: kind === 'streak' && input.period === 'week' ? 'week' : 'day',
      listId: kind === 'list' ? input.listId : null,
    },
  };
}

export function addGoal(input) {
  if (state.goals.length >= 200) throw new Error('Too many goals');
  const now = new Date().toISOString();
  const goal = normalizeGoal({ ...input, id: newId(), status: 'active', manualProgress: 0, createdAt: now, updatedAt: now });
  if (!goal) throw new Error('Invalid goal');
  state = { ...state, goals: [...state.goals, goal] };
  commit();
  return goal;
}

export function updateGoal(id, patch) {
  const current = getGoal(id);
  if (!current) throw new Error('Goal not found');
  const next = normalizeGoal({ ...current, ...patch, id, updatedAt: new Date().toISOString() });
  if (!next) throw new Error('Invalid goal');
  state = { ...state, goals: state.goals.map((g) => (g.id === id ? next : g)) };
  commit();
  return next;
}

/** Marks a goal reached, keeping the progress it had at that moment. */
export const completeGoal = (id, achieved) =>
  updateGoal(id, { status: 'completed', achieved: Math.max(0, Math.round(achieved)), completedAt: new Date().toISOString() });
export const reopenGoal = (id) => updateGoal(id, { status: 'active', achieved: null, completedAt: null });

export function deleteGoal(id) {
  const goal = getGoal(id);
  if (!goal) return null;
  state = { ...state, goals: state.goals.filter((g) => g.id !== id) };
  commit();
  return goal;
}

export function restoreGoal(goal) {
  const clean = normalizeGoal(goal);
  if (!clean || getGoal(clean.id)) return;
  state = { ...state, goals: [...state.goals, { ...clean, updatedAt: new Date().toISOString() }] };
  commit();
}

// ---- Achievements -------------------------------------------------------------
// Earned once and kept, even if the tasks that earned them are deleted later.

export const getAchievements = () => state.achievements;

/** Adds achievements that aren't recorded yet. `earned` = { id: ISO date }. Returns the ids that were new. */
export function addAchievements(earned) {
  const fresh = Object.entries(normalizeAchievements(earned)).filter(([k]) => !state.achievements[k]);
  if (!fresh.length) return [];
  state = { ...state, achievements: { ...state.achievements, ...Object.fromEntries(fresh) } };
  commit();
  return fresh.map(([k]) => k);
}

// ---- Backup -------------------------------------------------------------------

export function exportData() {
  const { owner, ...data } = state;
  return { app: 'DailyMate', version: VERSION, exportedAt: new Date().toISOString(), ...data };
}

/** Replaces all data with a backup. Returns counts, or throws if the file isn't a DailyMate backup. */
export function importData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) throw new Error('Not a DailyMate backup');
  // A backup never changes whose account this is.
  // Achievements already earned are kept.
  state = normalizeState({ ...data, owner: state.owner, achievements: { ...(data.achievements ?? {}), ...state.achievements } });
  commit();
  return { tasks: state.tasks.length, lists: state.lists.length, reminders: state.reminders.length, goals: state.goals.length };
}

// ---- Sync support (used by js/sync.js) -------------------------------------------

/** The whole current state (treat as read-only). */
export const getState = () => state;
export const getOwner = () => state.owner;
export const hasData = () => state.tasks.length + state.lists.length + state.reminders.length + state.goals.length > 0 || !!state.profile.name;

/** `fn(previous, next)` runs after each change the person makes (not for applyRemote). */
export function setChangeHook(fn) {
  changeHook = fn;
}

/** Marks this saved data as belonging to an account (or to nobody). */
export function setOwner(owner) {
  state = { ...state, owner: owner || null };
  committed = state;
  persist();
  emit();
}

/** Puts data that came from the cloud in place, without treating it as a new local change. */
export function applyRemote(next) {
  state = normalizeState({ ...next, owner: state.owner });
  committed = state;
  persist();
  emit();
}

/** Empties this browser's copy (used on sign-out and account deletion). */
export function resetLocal() {
  state = emptyState();
  committed = state;
  persist();
  emit();
}
