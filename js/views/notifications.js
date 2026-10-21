// Notifications & communication preferences (#/notifications).
// Push is only turned on when the person presses the button here; the browser's
// permission prompt never appears by surprise.

import * as cloud from '../cloud.js';
import * as push from '../push.js';
import { confirmAction } from '../dialogs.js';
import { esc, icon, toast } from '../ui.js';

export const title = 'Notifications';

let busy = '';       // '' | 'enable' | 'disable' | 'test'
let message = null;  // { tone: 'info' | 'error', text }
let devices = null;  // null = not loaded, 'error', or a list
let loadingDevices = false;

const fmt = (iso) => (iso ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '');

function supportNote(s) {
  if (s === 'ios-install') {
    return `On iPhone and iPad, notifications only work after you add DailyMate to your Home Screen (iOS 16.4 or later):
      tap the <strong>Share</strong> button in Safari, choose <strong>Add to Home Screen</strong>, then open DailyMate from the new icon and come back here.`;
  }
  if (s === 'insecure') return 'Notifications need a secure (https) connection.';
  return 'This browser can’t receive push notifications. Try a recent version of Chrome, Edge, Firefox or Safari.';
}

function pushCard() {
  const auth = cloud.getAuth();
  const s = push.support();
  const perm = push.permission();
  const on = push.isOnHere();
  let status;
  let actions = '';

  if (auth.status !== 'signed-in') {
    status = `${icon('lock')}<span><strong>Sign in to get reminders when DailyMate is closed.</strong>
      Notifications are sent by our server, so they need an account.</span>`;
    actions = '<a class="btn btn--primary" href="#/account">Sign in</a> <a class="btn btn--outline" href="#/account/sign-up">Create account</a>';
  } else if (s !== 'supported') {
    status = `${icon('alert')}<span>${supportNote(s)}</span>`;
  } else if (perm === 'denied') {
    status = `${icon('alert')}<span><strong>Notifications are blocked for DailyMate in this browser.</strong>
      To allow them, open the site settings (the icon next to the address bar), set Notifications to “Allow”, then reload this page.</span>`;
  } else if (on) {
    status = `${icon('check-circle')}<span><strong>On for this device.</strong> You’ll get a notification when a reminder is due,
      even when DailyMate is closed.</span>`;
    actions = `
      <button class="btn btn--outline" type="button" data-action="test" ${busy ? 'disabled' : ''}>${busy === 'test' ? 'Sending…' : `${icon('send')}Send a test notification`}</button>
      <button class="btn btn--ghost" type="button" data-action="disable" ${busy ? 'disabled' : ''}>${busy === 'disable' ? 'Turning off…' : 'Turn off on this device'}</button>`;
  } else {
    status = `${icon('bell')}<span><strong>Off for this device.</strong> Turn on notifications to be reminded even when DailyMate is closed.
      Your browser will ask for permission next.</span>`;
    actions = `<button class="btn btn--primary" type="button" data-action="enable" ${busy ? 'disabled' : ''}>${busy === 'enable' ? 'Turning on…' : `${icon('bell')}Turn on notifications`}</button>`;
  }

  return `
    <section class="card" aria-labelledby="push-h">
      <h2 class="card__title" id="push-h">Reminder notifications</h2>
      <p class="status-line" role="status">${status}</p>
      ${message ? `<p class="form-msg form-msg--${message.tone}" role="alert">${icon(message.tone === 'error' ? 'alert' : 'check-circle')}<span>${esc(message.text)}</span></p>` : ''}
      ${actions ? `<div class="btn-row">${actions}</div>` : ''}
      <details class="details">
        <summary>What to expect on your device</summary>
        <ul class="plain-list">
          <li><strong>Android (Chrome, Edge, Firefox):</strong> works in the browser and when DailyMate is installed. Battery savers can delay notifications.</li>
          <li><strong>Windows, Mac, Linux:</strong> works in Chrome, Edge, Firefox and Safari while the browser is running (it can be in the background).
            If the browser is fully closed, notifications arrive when it next starts.</li>
          <li><strong>iPhone and iPad:</strong> only after adding DailyMate to the Home Screen (iOS 16.4+).</li>
          <li>Notifications are a convenience, not a guarantee: the device must be on and online, and do-not-disturb settings apply.
            Please don’t rely on them alone for anything critical, such as medication.</li>
        </ul>
      </details>
    </section>`;
}

function devicesCard() {
  if (cloud.getAuth().status !== 'signed-in') return '';
  let body;
  if (devices === null) body = '<p class="loading"><span class="spinner" aria-hidden="true"></span> Loading…</p>';
  else if (devices === 'error') body = '<p class="muted">Couldn’t load your devices. Check your connection.</p>';
  else if (!devices.length) body = '<p class="muted">No devices have notifications turned on.</p>';
  else {
    body = `<ul class="device-list">${devices.map((d) => `
      <li class="device">
        <span class="device__icon">${icon('bell')}</span>
        <span class="device__body">
          <strong>${esc(d.device_label || 'Browser')}</strong>
          <span class="muted small">Added ${esc(fmt(d.created_at))}${d.last_success_at ? ` · last notification ${esc(fmt(d.last_success_at))}` : ''}
            ${d.disabled_at ? ` · <span class="text-warn">stopped (${esc(d.disabled_reason === 'expired' ? 'the browser cancelled it' : 'delivery kept failing')})</span>` : ''}</span>
        </span>
        <button class="btn btn--ghost btn--sm" type="button" data-action="remove-device" data-id="${esc(d.id)}">Remove</button>
      </li>`).join('')}</ul>`;
  }
  return `
    <section class="card" aria-labelledby="devices-h">
      <h2 class="card__title" id="devices-h">Devices with notifications</h2>
      ${body}
    </section>`;
}

export function render() {
  return `
    <div class="page page--narrow">
      <header class="page-head">
        <div>
          <h1 class="page-title">Notifications</h1>
          <p class="page-subtitle">Choose how DailyMate reminds you and what we send you.</p>
        </div>
      </header>
      ${pushCard()}
      ${devicesCard()}
      <section class="card" aria-labelledby="inapp-h">
        <h2 class="card__title" id="inapp-h">While DailyMate is open</h2>
        <p>Due reminders also appear on screen while DailyMate is open, with buttons to mark them done or snooze them. This works without an account.</p>
      </section>
      <section class="card" aria-labelledby="email-h">
        <h2 class="card__title" id="email-h">Email</h2>
        <p>We only email you about your account: to confirm your address and to reset your password when you ask.
          We don’t send newsletters or marketing, and there’s nothing to unsubscribe from.</p>
        <p class="muted">Text messages (SMS) are not available.</p>
      </section>
    </div>`;
}

async function loadDevices(ctx) {
  if (loadingDevices || cloud.getAuth().status !== 'signed-in') return;
  loadingDevices = true;
  try { devices = await push.listDevices(); } catch { devices = 'error'; }
  loadingDevices = false;
  ctx.rerender();
}

export function afterRender(params, ctx) {
  if (devices === null) loadDevices(ctx);
}

async function act(ctx, kind, fn) {
  busy = kind; message = null;
  ctx.rerender();
  try { await fn(); } catch (err) {
    const code = err?.code;
    message = { tone: 'error', text: code === 'denied' ? 'Notifications were blocked. You can allow them in your browser’s site settings.'
      : code === 'dismissed' ? 'Notifications were not turned on. Press the button again when you’re ready.'
        : err instanceof push.PushError ? err.message : 'Something went wrong. Please try again.' };
  }
  busy = '';
  devices = null;
  ctx.rerender();
}

export async function onClick(e, ctx) {
  const btn = e.target.closest('[data-action]');
  if (!btn || busy) return;
  const action = btn.dataset.action;
  if (action === 'enable') act(ctx, 'enable', async () => { await push.enable(); message = { tone: 'info', text: 'Notifications are on for this device.' }; });
  if (action === 'disable') act(ctx, 'disable', async () => { await push.disable(); message = { tone: 'info', text: 'Notifications are off for this device.' }; });
  if (action === 'test') act(ctx, 'test', async () => {
    const r = await push.sendTest();
    message = r.sent ? { tone: 'info', text: 'Test sent. It should appear in a few seconds.' }
      : { tone: 'error', text: 'The test couldn’t be delivered. Try turning notifications off and on again.' };
  });
  if (action === 'remove-device') {
    const ok = await confirmAction({ title: 'Remove this device?', message: 'It will stop receiving reminder notifications.', confirmLabel: 'Remove' });
    if (!ok) return;
    try {
      await push.removeDevice(btn.dataset.id);
      toast('Device removed');
    } catch { toast('Couldn’t remove the device. Please try again.', { tone: 'error' }); }
    devices = null;
    ctx.rerender();
  }
}

/** Forget loaded data when the account changes. */
export function reset() { devices = null; message = null; busy = ''; }
