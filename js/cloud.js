// Accounts (Supabase Auth). The Supabase library is only downloaded when it's
// needed — when someone has signed in on this browser or opens an account page —
// so people who never create an account don't load it at all.
//
// Sign-in links (email confirmation, password reset) use the PKCE flow: the link
// comes back with ?code=… which is exchanged here for a session. The hash part of
// the address stays free for the app's own routes.

import { SUPABASE_CONFIG } from './config.js';

const SESSION_KEY = 'dailymate.auth';
const LIBRARY = 'js/vendor/supabase-2.117.2.js';

let clientPromise = null;
let state = { status: 'signed-out', user: null }; // status: 'loading' | 'signed-out' | 'signed-in'
const listeners = new Set();

export const isConfigured = () => Boolean(SUPABASE_CONFIG.url && SUPABASE_CONFIG.publishableKey);
export const getAuth = () => state;
export const getUser = () => state.user;

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setState(next) {
  const changed = next.status !== state.status || next.user?.id !== state.user?.id || next.user?.email !== state.user?.email;
  state = next;
  if (changed) listeners.forEach((fn) => fn(state));
}

const hasStoredSession = () => {
  try { return Boolean(localStorage.getItem(SESSION_KEY)); } catch { return false; }
};

/** The address sign-in links should come back to (this page, without query or hash). */
export const appUrl = () => `${location.origin}${location.pathname}`;

function loadLibrary() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  return new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement('script'), { src: LIBRARY, async: true });
    script.onload = () => (window.supabase?.createClient ? resolve(window.supabase) : reject(new Error('library')));
    script.onerror = () => reject(new Error('Could not load the sign-in library'));
    document.head.append(script);
  });
}

/** The Supabase client (loads the library on first use). */
export function getClient() {
  if (!isConfigured()) return Promise.reject(new Error('Accounts are not set up'));
  clientPromise ??= loadLibrary().then((lib) => {
    const client = lib.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.publishableKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: SESSION_KEY },
    });
    client.auth.onAuthStateChange((event, session) => {
      // Called inside the library's lock: never await other auth calls here.
      setState(session?.user ? { status: 'signed-in', user: toUser(session.user) } : { status: 'signed-out', user: null });
    });
    return client;
  }).catch((err) => { clientPromise = null; throw err; });
  return clientPromise;
}

const toUser = (u) => ({ id: u.id, email: u.email ?? '', confirmed: Boolean(u.email_confirmed_at), createdAt: u.created_at });

/**
 * Reads ?code= / ?error= from a sign-in link. Returns what happened so the app can
 * show the right page: null | { kind: 'signed-in' | 'recovery' | 'confirmed-elsewhere' | 'link-error', message? }.
 */
async function handleRedirect() {
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#\/?/, '').includes('=') ? location.hash.slice(1) : '');
  const code = query.get('code');
  const error = query.get('error_description') || hash.get('error_description');
  const flow = query.get('flow');
  if (!code && !error) return null;

  // Clean the address right away so a reload doesn't reuse the link.
  history.replaceState(null, '', `${location.pathname}${location.hash && !location.hash.includes('=') ? location.hash : '#/my-day'}`);
  if (error) return { kind: 'link-error', message: error };

  const client = await getClient();
  const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    // Opened in a different browser than the one that asked for the link: the email
    // is confirmed, but this browser can't finish signing in.
    return flow === 'recovery' ? { kind: 'link-error', message: exchangeError.message } : { kind: 'confirmed-elsewhere' };
  }
  return { kind: flow === 'recovery' ? 'recovery' : 'signed-in' };
}

/** Starts auth: restores a saved session and handles sign-in links. */
export async function start() {
  if (!isConfigured()) return null;
  const pendingLink = /[?&](code|error_description)=/.test(location.search) || location.hash.includes('error_description=');
  if (!hasStoredSession() && !pendingLink) return null;
  setState({ status: 'loading', user: null });
  try {
    const client = await getClient();
    const redirect = await handleRedirect();
    const { data } = await client.auth.getSession();
    setState(data.session?.user ? { status: 'signed-in', user: toUser(data.session.user) } : { status: 'signed-out', user: null });
    return redirect;
  } catch {
    setState({ status: 'signed-out', user: null });
    return { kind: 'offline' };
  }
}

/** Turns Supabase Auth errors into plain sentences. */
export function explain(error) {
  const code = error?.code ?? '';
  const msg = String(error?.message ?? '');
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'That email and password don’t match. Check them and try again.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return 'Please confirm your email first — open the link we sent you.';
  if (code === 'weak_password' || /password should/i.test(msg)) return 'Please choose a longer password (at least 8 characters, not a common one).';
  if (code === 'same_password') return 'Your new password must be different from the old one.';
  if (code === 'email_address_invalid') return 'That email address can’t be used. Please check it, or use a different one.';
  if (code === 'email_address_not_authorized') return 'We can’t send email to this address right now. Please try again later.';
  if (code === 'signup_disabled') return 'New accounts can’t be created right now. Please try again later.';
  if (/rate limit|too many|over_email_send_rate_limit/i.test(code + msg) || error?.status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/sending.*email|smtp/i.test(msg)) return 'We couldn’t send the email just now. Please try again later.';
  if (code === 'user_already_exists') return 'An account with this email already exists. Try signing in.';
  if (/fetch|network|load failed/i.test(msg)) return 'Couldn’t reach the server. Check your internet connection and try again.';
  if (/library/i.test(msg)) return 'The sign-in page couldn’t load. Check your connection and reload the page.';
  return 'Something went wrong. Please try again.';
}

export async function signUp(email, password) {
  const client = await getClient();
  const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
  if (error) throw error;
  // With email confirmation on there is no session yet. (For an email that already has an
  // account Supabase answers the same way, so nobody can find out who has an account.)
  return { needsConfirmation: !data.session };
}

export async function signIn(email, password) {
  const client = await getClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function resendConfirmation(email) {
  const client = await getClient();
  const { error } = await client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: appUrl() } });
  if (error) throw error;
}

export async function requestPasswordReset(email) {
  const client = await getClient();
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl()}?flow=recovery` });
  if (error) throw error;
}

export async function updatePassword(password) {
  const client = await getClient();
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}

/** Signs out on this browser only (other devices stay signed in). */
export async function signOut() {
  const client = await getClient();
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) throw error;
  setState({ status: 'signed-out', user: null });
}

export async function accessToken() {
  if (state.status !== 'signed-in') return null;
  const client = await getClient();
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Calls a database function as the signed-in person. Throws on error. */
export async function rpc(name, args = {}) {
  const client = await getClient();
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}
