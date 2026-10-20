// AI Assistant (DailyMate Plus). This screen never invents answers: it only
// shows what the DailyMate AI server returns. Access (plan and the monthly
// limit) is decided by the server; the screen just explains the result.

import * as store from '../store.js';
import { addDays, formatTime, localTimeZone, relativeDay, todayISO } from '../dates.js';
import { AiError, availability, ask, fetchStatus } from '../ai.js';
import { openTaskDialog } from '../dialogs.js';
import { PRIORITY_LABEL } from '../components.js';
import { esc, icon, toast } from '../ui.js';

const CHAT_KEY = 'dailymate.ai.chat';
const MAX_HISTORY = 12; // turns sent to the server
const MAX_INPUT = 2000;

const EXAMPLES = [
  'Plan my Saturday: groceries, call my sister, and a 30-minute walk',
  'Break “clean out the garage” into small steps over the next two weeks',
  'I have a doctor’s appointment Thursday at 10. What should I prepare?',
  'What should I focus on today?',
];

const ai = {
  status: null, // null | 'loading' | { plan, active, usage } | AiError
  pending: false,
  shareTasks: true,
  messages: loadChat(),
};

function loadChat() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(CHAT_KEY) || '[]');
    return Array.isArray(raw) ? raw.slice(-40) : [];
  } catch { return []; }
}
function saveChat() {
  try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(ai.messages.slice(-40))); } catch { /* private mode */ }
}

export const pageTitle = () => 'AI Assistant';

// ---- Templates ----------------------------------------------------------------

const header = (badge) => `
  <header class="page-head">
    <div>
      <p class="eyebrow">AI Assistant ${badge}</p>
      <h1 class="page-title">Your planning assistant</h1>
      <p class="page-subtitle">Describe your day or a goal in your own words — get a tidy list of tasks back.</p>
    </div>
  </header>`;

const plusBadge = `<span class="badge badge--plus">${icon('crown')}Plus</span>`;

function features() {
  return `
    <ul class="ai-features">
      <li><span class="ai-features__icon">${icon('list')}</span><div><strong>Turn notes into tasks</strong><p>Write “dentist Tuesday 3pm, buy stamps” and get tasks with dates and times.</p></div></li>
      <li><span class="ai-features__icon">${icon('target')}</span><div><strong>Break big goals into steps</strong><p>“Get the house ready for winter” becomes small, doable steps.</p></div></li>
      <li><span class="ai-features__icon">${icon('sun')}</span><div><strong>Plan your day</strong><p>Get calm suggestions for what to do first, based on your tasks.</p></div></li>
    </ul>`;
}

/** Shown when AI can't be used: not connected yet, no account, Free plan, or limit reached. */
function lockedCard({ title, text, extra = '' }) {
  return `
    <section class="card ai-locked" aria-labelledby="ai-locked-h">
      <div class="ai-locked__head">
        <span class="ai-locked__icon">${icon('lock')}</span>
        <div>
          <h2 class="card__title" id="ai-locked-h">${title}</h2>
          <p class="muted">${text}</p>
        </div>
      </div>
      ${features()}
      ${extra}
      <a class="btn btn--outline" href="#/profile">${icon('crown')}Compare plans</a>
    </section>
    <section class="card card--note" aria-labelledby="ai-ex-h">
      <h2 class="card__title" id="ai-ex-h">Examples of what you’ll be able to ask</h2>
      <ul class="ai-examples ai-examples--static">${EXAMPLES.map((x) => `<li>“${esc(x)}”</li>`).join('')}</ul>
    </section>`;
}

function usageLine(usage) {
  if (!usage || usage.used == null || usage.limit == null) return '';
  const left = Math.max(0, usage.limit - usage.used);
  const pct = Math.min(100, Math.round((usage.used / usage.limit) * 100));
  const renews = usage.periodEnd ? new Date(usage.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  return `
    <div class="ai-usage">
      <p><strong>${left}</strong> of ${usage.limit} AI requests left${renews ? ` · renews ${esc(renews)}` : ''}</p>
      <div class="progress progress--blue" role="progressbar" aria-label="AI requests used" aria-valuemin="0" aria-valuemax="${usage.limit}" aria-valuenow="${usage.used}" aria-valuetext="${usage.used} of ${usage.limit} used"><span style="width:${pct}%"></span></div>
    </div>`;
}

function proposedTask(t, msgIndex, i, added) {
  const chips = [];
  if (t.date) chips.push(`<span class="chip">${icon('calendar')}${esc(relativeDay(t.date))}</span>`);
  if (t.time) chips.push(`<span class="chip">${icon('clock')}${esc(formatTime(t.time))}</span>`);
  if (t.priority !== 'none') chips.push(`<span class="chip chip--${t.priority}">${icon('flag')}${PRIORITY_LABEL[t.priority]}</span>`);
  return `
    <li class="proposal${added ? ' is-added' : ''}">
      <div class="proposal__body">
        <p class="proposal__title">${esc(t.title)}</p>
        ${chips.length ? `<div class="task__meta">${chips.join('')}</div>` : ''}
        ${t.notes ? `<p class="task__notes">${esc(t.notes)}</p>` : ''}
      </div>
      <div class="proposal__actions">
        ${added
          ? `<span class="badge badge--green">${icon('check')}Added</span>`
          : `<button class="btn btn--soft btn--sm" type="button" data-action="add-one" data-m="${msgIndex}" data-i="${i}" data-focus-key="add-${msgIndex}-${i}">${icon('plus')}Add</button>
             <button class="btn btn--ghost btn--sm" type="button" data-action="edit-one" data-m="${msgIndex}" data-i="${i}" data-focus-key="edit-${msgIndex}-${i}">Edit first</button>`}
      </div>
    </li>`;
}

function messageHTML(m, index) {
  if (m.role === 'user') {
    return `<li class="msg msg--user"><p class="msg__label visually-hidden">You said:</p><div class="msg__bubble">${esc(m.text)}</div></li>`;
  }
  if (m.error) {
    return `
      <li class="msg msg--assistant msg--error">
        <div class="msg__bubble">
          <p>${icon('alert')}${esc(m.error)}</p>
          ${m.retry ? `<button class="btn btn--outline btn--sm" type="button" data-action="retry" data-focus-key="retry">Try again</button>` : ''}
        </div>
      </li>`;
  }
  const added = new Set(m.added ?? []);
  const remaining = (m.tasks ?? []).filter((_, i) => !added.has(i)).length;
  return `
    <li class="msg msg--assistant">
      <p class="msg__label">${icon('sparkle')}DailyMate AI</p>
      <div class="msg__bubble">
        ${m.text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
        ${m.suggestions?.length ? `<ul class="ai-suggestions">${m.suggestions.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      </div>
      ${m.tasks?.length ? `
        <div class="proposals">
          <div class="proposals__head">
            <p class="proposals__title">Suggested tasks <span class="tab__count">${m.tasks.length}</span></p>
            ${remaining > 1 ? `<button class="btn btn--primary btn--sm" type="button" data-action="add-all" data-m="${index}" data-focus-key="addall-${index}">${icon('plus')}Add all ${remaining}</button>` : ''}
          </div>
          <ul class="proposal-list">${m.tasks.map((t, i) => proposedTask(t, index, i, added.has(i))).join('')}</ul>
          <p class="muted small">Nothing is added until you choose. Tasks without a date go to today.</p>
        </div>` : ''}
    </li>`;
}

function chat(status) {
  const usage = status.usage;
  const out = usage && usage.used != null && usage.limit != null && usage.used >= usage.limit;
  return `
    <section class="card ai-chat" aria-label="Conversation">
      <div class="ai-chat__top">
        ${usageLine(usage)}
        ${ai.messages.length ? `<button class="btn btn--ghost btn--sm" type="button" data-action="clear" data-focus-key="clear">Clear conversation</button>` : ''}
      </div>
      ${ai.messages.length ? `
        <ol class="msgs" aria-live="polite">
          ${ai.messages.map(messageHTML).join('')}
          ${ai.pending ? `<li class="msg msg--assistant"><div class="msg__bubble msg__bubble--loading" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>Thinking about your plan…</div></li>` : ''}
        </ol>` : `
        <div class="ai-start">
          <div class="empty__icon">${icon('sparkle')}</div>
          <h2 class="empty__title">What would you like help with?</h2>
          <p class="empty__text">Try one of these, or write your own.</p>
          <ul class="ai-examples">${EXAMPLES.map((x, i) => `<li><button class="ai-example" type="button" data-action="example" data-i="${i}">${esc(x)}</button></li>`).join('')}</ul>
        </div>`}
      ${out ? `<p class="ai-limit">${icon('alert')}You’ve used all ${usage.limit} requests for this billing period. They renew ${usage.periodEnd ? esc(new Date(usage.periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })) : 'with your next payment'}.</p>` : ''}
      <form class="composer" data-form="ask" novalidate>
        <label class="visually-hidden" for="ai-input">Message to the assistant</label>
        <textarea class="input composer__input" id="ai-input" name="text" rows="2" maxlength="${MAX_INPUT}" data-focus-key="ai-input"
                  placeholder="e.g. Tomorrow I need to pick up my prescription, call the bank and bake a cake" ${ai.pending || out ? 'disabled' : ''}></textarea>
        <div class="composer__row">
          <label class="toggle">
            <input type="checkbox" data-action="share" ${ai.shareTasks ? 'checked' : ''}>
            <span>Let the assistant see my tasks for the next 7 days</span>
          </label>
          <button class="btn btn--primary" type="submit" ${ai.pending || out ? 'disabled' : ''}>${icon('send')}Send</button>
        </div>
      </form>
      <p class="muted small">Answers come from an AI model and can be wrong — check dates and times before adding. Your messages are sent to DailyMate’s server only when you press Send.</p>
    </section>`;
}

export function render() {
  const state = availability();
  if (state === 'not-configured') {
    return `<div class="page page--narrow">${header(plusBadge)}${lockedCard({
      title: 'The AI Assistant isn’t available yet',
      text: 'It will be part of DailyMate Plus. Accounts and payments aren’t set up yet, so it can’t be used today — nothing you type here is sent anywhere.',
    })}</div>`;
  }
  if (state === 'signed-out') {
    return `<div class="page page--narrow">${header(plusBadge)}${lockedCard({
      title: 'Sign in to use the AI Assistant',
      text: 'The AI Assistant is for DailyMate Plus members. Signing in isn’t available in this version yet.',
    })}</div>`;
  }

  const s = ai.status;
  let body;
  if (s === null || s === 'loading') {
    body = `<section class="card"><div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>Checking your plan…</div></section>`;
  } else if (s instanceof AiError) {
    body = s.code === 'signed-out'
      ? lockedCard({ title: 'Please sign in again', text: esc(s.message) })
      : `<section class="card">
          <div class="empty">
            <div class="empty__icon empty__icon--error">${icon('alert')}</div>
            <h2 class="empty__title">Couldn’t open the AI Assistant</h2>
            <p class="empty__text">${esc(s.message)}</p>
            <button class="btn btn--primary" type="button" data-action="reload-status" data-focus-key="reload">Try again</button>
          </div>
        </section>`;
  } else if (s.plan !== 'plus' || !s.active) {
    body = lockedCard({
      title: s.plan === 'plus' ? 'Your DailyMate Plus membership isn’t active' : 'The AI Assistant is part of DailyMate Plus',
      text: s.plan === 'plus' ? 'Renew your membership to use the AI Assistant again.' : 'You’re on the Free plan. Upgrade to Plus to get up to 100 AI requests in each billing period.',
    });
  } else {
    body = chat(s);
  }
  return `<div class="page page--narrow">${header(plusBadge)}${body}</div>`;
}

export function afterRender(params, ctx) {
  if (availability() === 'ready' && ai.status === null) loadStatus(ctx);
  const list = document.querySelector('.msgs');
  if (list && ai.justReplied) {
    ai.justReplied = false;
    list.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

async function loadStatus(ctx) {
  ai.status = 'loading';
  try {
    ai.status = await fetchStatus();
  } catch (err) {
    ai.status = err instanceof AiError ? err : new AiError('server', 'Something went wrong. Please try again.');
  }
  ctx.rerender();
}

// ---- Sending ------------------------------------------------------------------------

function contextForServer() {
  const today = todayISO();
  const ctx = { today, timeZone: localTimeZone() };
  if (ai.shareTasks) {
    const until = addDays(today, 7);
    ctx.tasks = store.getTasks()
      .filter((t) => !t.completed && t.date <= until)
      .sort((a, b) => (a.date === b.date ? (a.time ?? '99') < (b.time ?? '99') ? -1 : 1 : a.date < b.date ? -1 : 1))
      .slice(0, 60)
      .map((t) => ({ title: t.title, date: t.date, time: t.time, priority: t.priority, overdue: t.date < today }));
  }
  return ctx;
}

async function send(text, ctx) {
  ai.messages = ai.messages.filter((m) => !m.error);
  ai.messages.push({ role: 'user', text });
  ai.pending = true;
  saveChat();
  ctx.rerender();

  const history = ai.messages
    .filter((m) => !m.error)
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.text }));
  try {
    const res = await ask({ messages: history, context: contextForServer() });
    ai.messages.push({ role: 'assistant', text: res.reply, tasks: res.tasks, suggestions: res.suggestions, added: [] });
    if (res.usage && ai.status && typeof ai.status === 'object') ai.status = { ...ai.status, usage: res.usage };
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError('server', 'Something went wrong. Please try again.');
    if (e.details?.usage && ai.status && typeof ai.status === 'object') ai.status = { ...ai.status, usage: { ...ai.status.usage, ...e.details.usage } };
    if (e.code === 'plan' && ai.status && typeof ai.status === 'object') ai.status = { ...ai.status, plan: 'free' };
    ai.messages.push({ role: 'assistant', error: e.message, retry: ['network', 'timeout', 'server', 'bad-response'].includes(e.code) });
  } finally {
    ai.pending = false;
    ai.justReplied = true;
    saveChat();
    ctx.rerender();
    document.getElementById('ai-input')?.focus();
  }
}

function addTask(t) {
  const today = todayISO();
  const result = store.validateTask({ ...t, date: t.date && t.date >= today ? t.date : today });
  if (result.errors) return null;
  return store.addTask(result.task);
}

// ---- Events -------------------------------------------------------------------------

export async function onClick(e, ctx) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const m = ai.messages[Number(el.dataset.m)];
  const i = Number(el.dataset.i);

  switch (el.dataset.action) {
    case 'example': {
      const input = document.getElementById('ai-input');
      input.value = EXAMPLES[i];
      input.focus();
      break;
    }
    case 'retry': {
      const last = [...ai.messages].reverse().find((x) => x.role === 'user');
      if (!last || ai.pending) return;
      ai.messages = ai.messages.filter((x) => !x.error && x !== last);
      send(last.text, ctx);
      break;
    }
    case 'clear':
      ai.messages = [];
      saveChat();
      ctx.rerender();
      document.getElementById('ai-input')?.focus();
      break;
    case 'reload-status':
      ai.status = null;
      ctx.rerender();
      break;
    case 'add-one': {
      const task = m && addTask(m.tasks[i]);
      if (!task) return;
      m.added = [...(m.added ?? []), i];
      saveChat();
      ctx.rerender();
      toast(`Added for ${relativeDay(task.date)}`);
      break;
    }
    case 'add-all': {
      if (!m) return;
      let n = 0;
      m.tasks.forEach((t, idx) => {
        if ((m.added ?? []).includes(idx)) return;
        if (addTask(t)) { m.added = [...(m.added ?? []), idx]; n += 1; }
      });
      saveChat();
      ctx.rerender();
      toast(`${n} ${n === 1 ? 'task' : 'tasks'} added`);
      break;
    }
    case 'edit-one': {
      if (!m) return;
      const t = m.tasks[i];
      // The suggestion is marked as added only if the person saves the form.
      openTaskDialog({
        draft: { ...t, date: t.date && t.date >= todayISO() ? t.date : todayISO() },
        onSaved: () => { m.added = [...(m.added ?? []), i]; saveChat(); ctx.rerender(); },
      });
      break;
    }
    default:
  }
}

export function onChange(e) {
  if (e.target.dataset.action === 'share') ai.shareTasks = e.target.checked;
}

export function onSubmit(e, ctx) {
  if (e.target.dataset.form !== 'ask') return;
  e.preventDefault();
  const input = e.target.elements.text;
  const text = input.value.trim().slice(0, MAX_INPUT);
  if (!text || ai.pending) { input.focus(); return; }
  input.value = '';
  send(text, ctx);
}

export function onKeydown(e) {
  // Enter sends; Shift+Enter makes a new line.
  if (e.target.id === 'ai-input' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
}
