// Small shared UI helpers.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape user text before putting it into an HTML template. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

let toastTimer;
/**
 * Shows a short message. Pass `action: { label, onClick }` to add a button such
 * as "Undo"; the message then stays a little longer.
 */
export function toast(message, { tone = 'default', action = null } = {}) {
  const region = document.getElementById('toast-region');
  region.innerHTML = `<div class="toast toast--${tone}">${icon(tone === 'error' ? 'alert' : 'check-circle')}<span>${esc(message)}</span>${action
    ? `<button class="toast__action" type="button">${esc(action.label)}</button>` : ''}</div>`;
  if (action) {
    region.querySelector('.toast__action').addEventListener('click', () => {
      region.innerHTML = '';
      action.onClick();
    }, { once: true });
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { region.innerHTML = ''; }, action ? 7000 : 3500);
}
