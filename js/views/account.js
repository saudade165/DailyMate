// Sign in, create an account, reset a password.
//   #/account               sign in
//   #/account/sign-up       create an account
//   #/account/forgot        ask for a password-reset email
//   #/account/new-password  choose a new password (after opening the reset link)
//   #/account/check-email   "we sent you an email"

import * as cloud from '../cloud.js';
import { esc, icon, toast } from '../ui.js';

export const title = 'Account';
const MIN_PASSWORD = 8;

let error = '';
let typedEmail = '';
let notice = null; // { tone: 'info' | 'error', text }
let sentTo = '';
let canResend = false;

/** Shows a message at the top of the account page (e.g. after a sign-in link). */
export function setNotice(n) { notice = n; error = ''; }

export function pageTitle(params) {
  return { 'sign-up': 'Create account', forgot: 'Reset password', 'new-password': 'New password', 'check-email': 'Check your email' }[params[0]] ?? 'Sign in';
}

const field = (id, label, type, autocomplete, extra = '') => `
  <div class="field">
    <label class="field__label" for="${id}">${label}</label>
    <input class="input" id="${id}" name="${id.replace('acct-', '')}" type="${type}" autocomplete="${autocomplete}" required ${extra}
           value="${esc(typedEmail)}" data-focus-key="${id}">
  </div>`;

const passwordField = (id, label, autocomplete) => `
  <div class="field">
    <label class="field__label" for="${id}">${label}</label>
    <div class="password-row">
      <input class="input" id="${id}" name="password" type="password" autocomplete="${autocomplete}" required
             minlength="${autocomplete === 'new-password' ? MIN_PASSWORD : 1}" maxlength="72" data-focus-key="${id}"
             ${autocomplete === 'new-password' ? `aria-describedby="${id}-hint"` : ''}>
      <button class="btn btn--ghost btn--sm" type="button" data-action="toggle-password" aria-controls="${id}" aria-pressed="false">Show</button>
    </div>
    ${autocomplete === 'new-password' ? `<p class="field__hint" id="${id}-hint">At least ${MIN_PASSWORD} characters.</p>` : ''}
  </div>`;

function messages() {
  return `<div class="auth-msgs" id="auth-msgs">
    ${notice ? `<p class="form-msg form-msg--${notice.tone}" role="status">${icon(notice.tone === 'error' ? 'alert' : 'check-circle')}<span>${esc(notice.text)}</span></p>` : ''}
    ${error ? `<p class="form-msg form-msg--error" role="alert">${icon('alert')}<span>${esc(error)}</span></p>` : ''}
    ${canResend ? `<button class="btn btn--outline btn--sm" type="button" data-action="resend">Send the confirmation email again</button>` : ''}
  </div>`;
}

const submit = (label) => `<button class="btn btn--primary btn--lg btn--block" type="submit">${label}</button>`;

function signInForm() {
  return `
    <form class="auth-form" data-form="sign-in" novalidate>
      ${messages()}
      ${field('acct-email', 'Email', 'email', 'email', 'maxlength="254" inputmode="email"')}
      ${passwordField('acct-password', 'Password', 'current-password')}
      ${submit('Sign in')}
    </form>
    <p class="auth-links"><a href="#/account/forgot">Forgot your password?</a></p>
    <p class="auth-links">New to DailyMate? <a href="#/account/sign-up">Create a free account</a></p>`;
}

function signUpForm() {
  return `
    <form class="auth-form" data-form="sign-up" novalidate>
      ${messages()}
      <div class="field">
        <label class="field__label" for="acct-name">Your name <span class="field__optional">(optional)</span></label>
        <input class="input" id="acct-name" name="name" type="text" autocomplete="given-name" maxlength="40" data-focus-key="acct-name">
      </div>
      ${field('acct-email', 'Email', 'email', 'email', 'maxlength="254" inputmode="email"')}
      ${passwordField('acct-password', 'Choose a password', 'new-password')}
      <p class="muted small">By creating an account you agree to the <a href="#/terms">Terms of Service</a> and the <a href="#/privacy">Privacy Policy</a>.
        We’ll email you a link to confirm your address.</p>
      ${submit('Create account')}
    </form>
    <p class="auth-links">Already have an account? <a href="#/account">Sign in</a></p>`;
}

function forgotForm() {
  return `
    <form class="auth-form" data-form="forgot" novalidate>
      ${messages()}
      <p>Enter the email you signed up with. If it has an account, we’ll send a link to choose a new password.</p>
      ${field('acct-email', 'Email', 'email', 'email', 'maxlength="254" inputmode="email"')}
      ${submit('Send reset link')}
    </form>
    <p class="auth-links"><a href="#/account">Back to sign in</a></p>`;
}

function newPasswordForm() {
  if (cloud.getAuth().status !== 'signed-in') {
    return `${messages()}<p>This page is for choosing a new password after opening the link in your email.
      The link may have expired — <a href="#/account/forgot">ask for a new one</a>.</p>`;
  }
  return `
    <form class="auth-form" data-form="new-password" novalidate>
      ${messages()}
      <p>Signed in as <strong>${esc(cloud.getUser().email)}</strong>. Choose a new password.</p>
      ${passwordField('acct-password', 'New password', 'new-password')}
      ${submit('Save new password')}
    </form>`;
}

function checkEmail() {
  return `
    ${messages()}
    <div class="soon__icon">${icon('inbox')}</div>
    <p>We sent an email to <strong>${esc(sentTo || 'your address')}</strong>. Open the link in it to continue.</p>
    <p class="muted">It can take a few minutes. If you don’t see it, check your spam or junk folder.</p>
    ${sentTo ? '<button class="btn btn--outline" type="button" data-action="resend">Send it again</button>' : ''}
    <p class="auth-links"><a href="#/account">Back to sign in</a></p>`;
}

export function render(params) {
  const mode = params[0] ?? '';
  const auth = cloud.getAuth();
  let body;
  if (!cloud.isConfigured()) {
    body = '<p>Accounts aren’t available right now.</p>';
  } else if (auth.status === 'loading') {
    body = '<p class="loading"><span class="spinner" aria-hidden="true"></span> Checking your account…</p>';
  } else if (auth.status === 'signed-in' && mode !== 'new-password') {
    body = `${messages()}<p>You’re signed in as <strong>${esc(auth.user.email)}</strong>.</p>
      <div class="btn-row"><a class="btn btn--primary" href="#/my-day">${icon('home')}Go to My Day</a>
      <a class="btn btn--outline" href="#/profile">Account settings</a></div>`;
  } else {
    body = { 'sign-up': signUpForm, forgot: forgotForm, 'new-password': newPasswordForm, 'check-email': checkEmail }[mode]?.() ?? signInForm();
  }
  return `
    <div class="page page--auth">
      <header class="page-head">
        <div>
          <h1 class="page-title">${esc(pageTitle(params))}</h1>
          <p class="page-subtitle">${mode === 'sign-up' ? 'Keep your tasks, lists and reminders on all your devices.' : 'Your DailyMate account'}</p>
        </div>
      </header>
      <section class="card auth-card">${body}</section>
    </div>`;
}

const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

let busy = false;

/** Runs a request while the button shows "Please wait…". Updates messages in place, so typed text stays. */
async function run(button, fn) {
  busy = true; error = ''; notice = null; canResend = false;
  const label = button?.textContent;
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Please wait…'; }
  showMessages();
  try {
    await fn();
  } catch (err) {
    error = cloud.explain(err);
    canResend = err?.code === 'email_not_confirmed' || /email not confirmed/i.test(err?.message ?? '');
  } finally {
    busy = false;
    if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = label; }
    showMessages();
  }
}

function showMessages() {
  const box = document.getElementById('auth-msgs');
  if (box) box.outerHTML = messages();
}

const fail = (text) => { error = text; notice = null; canResend = false; showMessages(); };

export function onSubmit(e) {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  if (busy) return;
  const email = (form.elements.email?.value ?? '').trim();
  const password = form.elements.password?.value ?? '';
  const kind = form.dataset.form;
  const button = form.querySelector('[type="submit"]');
  typedEmail = email || typedEmail;

  if (kind !== 'new-password' && !validEmail(email)) { fail('Please enter a valid email address.'); return; }
  if ((kind === 'sign-up' || kind === 'new-password') && password.length < MIN_PASSWORD) {
    fail(`Please choose a password with at least ${MIN_PASSWORD} characters.`); return;
  }
  if (kind === 'sign-in' && !password) { fail('Please enter your password.'); return; }
  sentTo = email || sentTo;

  if (kind === 'sign-in') run(button, async () => { await cloud.signIn(email, password); location.hash = cloud.takeReturn(); });
  if (kind === 'sign-up') run(button, async () => {
    const name = (form.elements.name?.value ?? '').trim().slice(0, 40);
    const { needsConfirmation } = await cloud.signUp(email, password, name);
    location.hash = needsConfirmation ? '#/account/check-email' : '#/my-day';
  });
  if (kind === 'forgot') run(button, async () => { await cloud.requestPasswordReset(email); location.hash = '#/account/check-email'; });
  if (kind === 'new-password') run(button, async () => {
    await cloud.updatePassword(password);
    toast('Your new password is saved');
    location.hash = '#/my-day';
  });
}

export function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'toggle-password') {
    const input = document.getElementById(btn.getAttribute('aria-controls'));
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
    btn.setAttribute('aria-pressed', String(show));
  }
  if (btn.dataset.action === 'resend') {
    const email = sentTo || document.getElementById('acct-email')?.value.trim();
    if (!validEmail(email ?? '')) { fail('Please enter your email address above first.'); return; }
    run(btn, async () => { await cloud.resendConfirmation(email); notice = { tone: 'info', text: `We sent a new confirmation email to ${email}.` }; });
  }
}

/** Leaving the page clears old messages. */
export function reset() { error = ''; notice = null; canResend = false; busy = false; }
