// Data layer. For now everything lives in this browser's localStorage — there is
// no account and no cloud sync. Keep the public API (getTasks, addTask, …) stable
// so this module can later be swapped for a real backend without touching the UI.

import { isValidISO, isValidTime } from './dates.js';

const STORAGE_KEY = 'dailymate.v1';
const PRIORITIES = ['none', 'low', 'medium', 'high'];
const TITLE_MAX = 200;
const NOTES_MAX = 1000;
const NAME_MAX = 40;

let state = { tasks: [], profile: { name: '' } };
let persistError = null; // null | 'unavailable' | 'quota' | 'corrupt'
const listeners = new Set();

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, NOTES_MAX) : '',
    completed: raw.completed === true,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
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
    const data = JSON.parse(raw);
    const tasks = Array.isArray(data.tasks) ? data.tasks.map(normalizeTask).filter(Boolean) : [];
    const name = typeof data.profile?.name === 'string' ? data.profile.name.slice(0, NAME_MAX) : '';
    state = { tasks, profile: { name } };
  } catch {
    // Keep the unreadable copy so nothing is silently lost, then start fresh.
    try { localStorage.setItem(`${STORAGE_KEY}.corrupt-${Date.now()}`, raw); } catch { /* ignore */ }
    persistError = 'corrupt';
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...state }));
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
    },
  };
}

export function addTask(input) {
  const now = new Date().toISOString();
  const task = normalizeTask({ ...input, id: newId(), completed: false, createdAt: now, updatedAt: now });
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

export function setCompleted(id, completed) {
  return updateTask(id, { completed, completedAt: completed ? new Date().toISOString() : null });
}

export function deleteTask(id) {
  const task = getTask(id);
  if (!task) return null;
  state = { ...state, tasks: state.tasks.filter((t) => t.id !== id) };
  commit();
  return task;
}

export function setProfileName(name) {
  state = { ...state, profile: { ...state.profile, name: name.trim().slice(0, NAME_MAX) } };
  commit();
}
