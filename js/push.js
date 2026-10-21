// Push notifications for reminders — delivered by the server even when DailyMate
// is closed (as far as the browser and device allow).
//
// Nothing here asks for permission on its own: the browser prompt only appears
// after the person presses "Turn on" on the Notifications page.

import * as cloud from './cloud.js';
import { SUPABASE_CONFIG } from './config.js';

const DEVICE_KEY = 'dailymate.push'; // { endpoint, user } of this browser's registered subscription

// iPadOS Safari reports itself as a Mac; a touch screen gives it away.
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && !/Android/.test(navigator.userAgent));
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

/** 'supported' | 'insecure' | 'ios-install' (iPhone/iPad: add to Home Screen first) | 'unsupported' */
export function support() {
  if (!window.isSecureContext) return 'insecure';
  const apis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIOS() && !isStandalone()) return 'ios-install';
  return apis ? 'supported' : 'unsupported';
}

export const permission = () => ('Notification' in window ? Notification.permission : 'unsupported');

function readDevice() {
  try { return JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null'); } catch { return null; }
}
function writeDevice(value) {
  try { value ? localStorage.setItem(DEVICE_KEY, JSON.stringify(value)) : localStorage.removeItem(DEVICE_KEY); } catch { /* ignore */ }
}

/** True when this browser has push turned on for the signed-in account (no network needed). */
export function isOnHere() {
  const d = readDevice();
  return Boolean(d && d.user === cloud.getUser()?.id && permission() === 'granted');
}

async function registration() {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('service worker not ready')), 10_000)),
  ]);
  return reg;
}

const keyBytes = (b64u) => {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

function deviceLabel() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : isIOS() ? 'iPhone/iPad' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

async function saveSubscription(sub) {
  const json = sub.toJSON();
  await cloud.rpc('save_push_subscription', {
    p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth, p_label: deviceLabel(),
  });
  writeDevice({ endpoint: json.endpoint, user: cloud.getUser().id });
}

export class PushError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Asks for permission (the person just pressed a button), subscribes and registers this device. */
export async function enable() {
  if (cloud.getAuth().status !== 'signed-in') throw new PushError('signed-out', 'Please sign in first.');
  const s = support();
  if (s !== 'supported') throw new PushError(s, 'This browser can’t receive push notifications.');
  const result = await Notification.requestPermission();
  if (result !== 'granted') throw new PushError(result === 'denied' ? 'denied' : 'dismissed', 'Notifications were not allowed.');

  const publicKey = await cloud.rpc('get_push_public_key');
  if (!publicKey) throw new PushError('server', 'Notifications aren’t set up on the server yet. Please try again later.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  const serverKey = keyBytes(publicKey);
  const sameKey = sub?.options?.applicationServerKey
    && new Uint8Array(sub.options.applicationServerKey).every((b, i) => b === serverKey[i]);
  if (sub && !sameKey) { await sub.unsubscribe(); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
  await saveSubscription(sub);
}

/** Turns push off on this browser: removes it from the account and unsubscribes. */
export async function disable() {
  const d = readDevice();
  let sub = null;
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    sub = await reg?.pushManager.getSubscription();
  }
  const endpoint = sub?.endpoint ?? d?.endpoint;
  if (endpoint && cloud.getAuth().status === 'signed-in') {
    try { await cloud.rpc('remove_push_subscription', { p_endpoint: endpoint }); } catch { /* still unsubscribe locally */ }
  }
  await sub?.unsubscribe().catch(() => {});
  writeDevice(null);
}

/** After sign-in or on start: keeps the server's copy of this browser's subscription current. */
export async function refresh() {
  const d = readDevice();
  if (!d || support() !== 'supported' || cloud.getAuth().status !== 'signed-in') return;
  if (d.user !== cloud.getUser().id || permission() !== 'granted') { writeDevice(null); return; }
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) { writeDevice(null); return; }
    if (sub.endpoint !== d.endpoint) await saveSubscription(sub); // the browser renewed it
  } catch { /* try again next time */ }
}

/** Sends a test notification to this device. Returns { sent, failed } or throws PushError. */
export async function sendTest() {
  const token = await cloud.accessToken();
  if (!token) throw new PushError('signed-out', 'Please sign in first.');
  let res;
  try {
    res = await fetch(`${SUPABASE_CONFIG.url}/functions/v1/push-dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_CONFIG.publishableKey },
      body: JSON.stringify({ action: 'test', endpoint: readDevice()?.endpoint ?? null }),
    });
  } catch {
    throw new PushError('network', 'Couldn’t reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw new PushError('rate', 'Please wait a few minutes before sending another test.');
  if (res.status === 404) throw new PushError('no-device', 'This device isn’t registered for notifications. Turn them off and on again.');
  if (!res.ok) throw new PushError('server', 'The test couldn’t be sent. Please try again later.');
  return { sent: data.sent ?? 0, failed: (data.failed ?? 0) + (data.gone ?? 0) + (data.retry ?? 0) };
}

/** The account's devices with push turned on (no keys, just labels and dates). */
export async function listDevices() {
  const client = await cloud.getClient();
  const { data, error } = await client.from('push_subscriptions')
    .select('id, device_label, created_at, last_success_at, disabled_at, disabled_reason')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function removeDevice(id) {
  await cloud.rpc('remove_push_subscription', { p_id: id });
}

export const thisDeviceEndpoint = () => readDevice()?.endpoint ?? null;
export const forgetThisDevice = () => writeDevice(null);
