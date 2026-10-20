// Add/edit task form and the confirmation dialog. Both use the native <dialog>
// element, which gives focus trapping, Esc-to-close and backdrop for free.

import * as store from './store.js';
import { toast } from './ui.js';

const taskDialog = document.getElementById('task-dialog');
const form = document.getElementById('task-form');
const titleEl = document.getElementById('task-dialog-title');
const submitBtn = document.getElementById('task-submit');
const fields = {
  title: form.elements.title,
  date: form.elements.date,
  time: form.elements.time,
  notes: form.elements.notes,
};

let editingId = null;
let returnFocusTo = null;

function setError(name, message) {
  const input = fields[name];
  const errorEl = document.getElementById(`task-${name}-error`);
  if (!errorEl) return;
  errorEl.textContent = message ?? '';
  errorEl.hidden = !message;
  input.toggleAttribute('aria-invalid', Boolean(message));
}

function clearErrors() {
  setError('title');
  setError('date');
}

/**
 * Opens the task form.
 * @param {{ task?: object, date?: string }} options — pass `task` to edit, `date` to prefill a new task.
 */
export function openTaskDialog({ task = null, date } = {}) {
  editingId = task?.id ?? null;
  returnFocusTo = document.activeElement;
  form.reset();
  clearErrors();

  titleEl.textContent = task ? 'Edit task' : 'Add task';
  submitBtn.textContent = task ? 'Save changes' : 'Add task';
  fields.title.value = task?.title ?? '';
  fields.date.value = task?.date ?? date;
  fields.time.value = task?.time ?? '';
  fields.notes.value = task?.notes ?? '';
  form.elements.priority.value = task?.priority ?? 'none';

  taskDialog.showModal();
  fields.title.focus();
}

// Cleanup runs here rather than in a 'close' listener: that event is queued
// asynchronously and isn't reliably delivered in every embedded browser.
function closeTaskDialog() {
  taskDialog.close();
  editingId = null;
  returnFocusTo?.isConnected && returnFocusTo.focus();
}

// Esc key
taskDialog.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeTaskDialog();
});

taskDialog.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="dialog-cancel"]')) closeTaskDialog();
  // Click on the backdrop (outside the form) closes the dialog.
  if (e.target === taskDialog) closeTaskDialog();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const result = store.validateTask({
    title: fields.title.value,
    date: fields.date.value,
    time: fields.time.value,
    priority: form.elements.priority.value,
    notes: fields.notes.value,
  });

  clearErrors();
  if (result.errors) {
    Object.entries(result.errors).forEach(([name, msg]) => setError(name, msg));
    const first = Object.keys(result.errors)[0];
    fields[first]?.focus();
    return;
  }

  try {
    if (editingId) {
      store.updateTask(editingId, result.task);
      toast('Changes saved');
    } else {
      store.addTask(result.task);
      toast('Task added');
    }
    closeTaskDialog();
  } catch (err) {
    console.error(err);
    toast('Something went wrong. Please try again.', { tone: 'error' });
  }
});

// ---- Confirm ---------------------------------------------------------------

const confirmDialog = document.getElementById('confirm-dialog');

/** Resolves to true when the user confirms. */
export function confirmAction({ title, message, confirmLabel = 'Delete' }) {
  const opener = document.activeElement;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-ok').textContent = confirmLabel;
  confirmDialog.showModal();

  return new Promise((resolve) => {
    const finish = (ok) => {
      confirmDialog.removeEventListener('click', onClick);
      confirmDialog.removeEventListener('cancel', onCancel);
      confirmDialog.close();
      opener?.isConnected && opener.focus();
      resolve(ok);
    };
    const onClick = (e) => {
      const button = e.target.closest('button[value]');
      if (button) {
        e.preventDefault();
        finish(button.value === 'confirm');
      } else if (e.target === confirmDialog) {
        finish(false); // backdrop
      }
    };
    const onCancel = (e) => {
      e.preventDefault();
      finish(false); // Esc
    };
    confirmDialog.addEventListener('click', onClick);
    confirmDialog.addEventListener('cancel', onCancel);
  });
}
