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
export function toast(message, { tone = 'default' } = {}) {
  const region = document.getElementById('toast-region');
  region.innerHTML = `<div class="toast toast--${tone}">${icon(tone === 'error' ? 'alert' : 'check-circle')}<span>${esc(message)}</span></div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { region.innerHTML = ''; }, 3500);
}
