// Client for the DailyMate AI server function. The browser never talks to an AI
// provider directly and never holds an AI key: it sends the signed-in user's
// access token to our server, which checks the plan and the monthly limit,
// calls the model, and returns structured suggestions.

import { AI_CONFIG } from './config.js';
import { isValidISO, isValidTime } from './dates.js';

const TIMEOUT_MS = 90_000;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

let accessTokenProvider = null;

/** Called by the (future) sign-in module: `fn` resolves to the user's access token, or null when signed out. */
export function setAccessTokenProvider(fn) {
  accessTokenProvider = fn;
}

// Developer override for testing the screen against a local server. Ignored on
// any real website, so it can't be used to send people's data elsewhere.
function devOverride() {
  if (!LOCAL_HOSTS.includes(location.hostname)) return null;
  try {
    const endpoint = localStorage.getItem('dailymate.dev.aiEndpoint');
    return endpoint ? { endpoint, token: localStorage.getItem('dailymate.dev.aiToken') || 'dev' } : null;
  } catch { return null; }
}

function endpoint() {
  return devOverride()?.endpoint || AI_CONFIG.endpoint || '';
}

async function accessToken() {
  const dev = devOverride();
  if (dev) return dev.token;
  return accessTokenProvider ? accessTokenProvider() : null;
}

/** 'not-configured' (no server), 'signed-out' (no account), or 'ready' (can ask the server). */
export function availability() {
  if (!endpoint()) return 'not-configured';
  if (!devOverride() && !accessTokenProvider) return 'signed-out';
  return 'ready';
}

export class AiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code; // not-configured | signed-out | plan | limit | timeout | network | refusal | server | bad-response
    this.details = details;
  }
}

async function call(body) {
  const url = endpoint();
  if (!url) throw new AiError('not-configured', 'The AI Assistant is not connected yet.');
  const token = await accessToken();
  if (!token) throw new AiError('signed-out', 'Please sign in to use the AI Assistant.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw err.name === 'AbortError'
      ? new AiError('timeout', 'The assistant took too long to answer. Please try again.')
      : new AiError('network', 'Couldn’t reach the assistant. Check your internet connection and try again.');
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try { data = await res.json(); } catch { /* handled below */ }
  if (res.ok && data) return data;

  const usage = data?.usage ?? {};
  if (res.status === 401) throw new AiError('signed-out', 'Your session has ended. Please sign in again.');
  if (res.status === 402 || data?.error === 'plan_required') throw new AiError('plan', 'The AI Assistant is part of DailyMate Plus.', { usage });
  if (res.status === 429 && data?.error === 'limit_reached') throw new AiError('limit', 'You’ve used all your AI requests for this billing period.', { usage });
  if (res.status === 429) throw new AiError('server', 'Too many requests right now. Please wait a minute and try again.');
  if (data?.error === 'refused') throw new AiError('refusal', 'The assistant can’t help with that request. Try asking in a different way.', { usage });
  throw new AiError('server', 'The assistant couldn’t answer just now. Please try again in a moment.', { usage });
}

function cleanUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const n = (v) => (Number.isFinite(v) ? v : null);
  return { used: n(u.used), limit: n(u.limit), periodEnd: typeof u.periodEnd === 'string' ? u.periodEnd : null };
}

/** Plan and usage, without spending a request. */
export async function fetchStatus() {
  const data = await call({ action: 'status' });
  return { plan: data.plan === 'plus' ? 'plus' : 'free', active: data.active === true, usage: cleanUsage(data.usage) };
}

/**
 * Sends the conversation. `context.tasks` is only included when the person allows it.
 * Returns { reply, tasks, suggestions, usage } with every task validated.
 */
export async function ask({ messages, context }) {
  const data = await call({ action: 'chat', messages, context });
  if (typeof data.reply !== 'string') throw new AiError('bad-response', 'The assistant sent an answer DailyMate couldn’t read. Please try again.');
  const tasks = (Array.isArray(data.tasks) ? data.tasks : []).slice(0, 20).map((t) => ({
    title: typeof t?.title === 'string' ? t.title.trim().slice(0, 200) : '',
    date: isValidISO(t?.date) ? t.date : null,
    time: isValidTime(t?.time) ? t.time : null,
    priority: ['none', 'low', 'medium', 'high'].includes(t?.priority) ? t.priority : 'none',
    notes: typeof t?.notes === 'string' ? t.notes.slice(0, 1000) : '',
  })).filter((t) => t.title);
  const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : []).filter((s) => typeof s === 'string').slice(0, 6).map((s) => s.slice(0, 300));
  return { reply: data.reply.slice(0, 4000), tasks, suggestions, usage: cleanUsage(data.usage) };
}
