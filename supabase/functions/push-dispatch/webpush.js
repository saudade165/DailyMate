// Minimal Web Push sender using only WebCrypto (works in Deno and browsers):
//   * RFC 8291 message encryption ("aes128gcm" content coding)
//   * RFC 8292 VAPID authentication (ES256 JWT)
// No dependencies, so there is nothing to keep patched besides this file.

const enc = new TextEncoder();
const RECORD_SIZE = 4096;
export const MAX_PAYLOAD_BYTES = 3000;

export const b64u = {
  encode(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** A new VAPID key pair: the public key as base64url (for browsers), the private key as JWK text (server only). */
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { publicKey: b64u.encode(publicRaw), privateJwk: JSON.stringify(privateJwk) };
}

/** The Authorization header value for one push service (RFC 8292). */
export async function vapidAuthorization(endpoint, { publicKey, privateJwk, subject }, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const jwk = JSON.parse(privateJwk);
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto returns the raw r||s signature, which is exactly what JWS ES256 uses.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.encode(sig)}, k=${publicKey}`;
}

/**
 * Encrypts `plaintext` (Uint8Array) for one browser subscription (RFC 8291).
 * `p256dh` and `auth` are the subscription's keys (base64url). `testing` lets tests fix the salt and key.
 */
export async function encryptPayload(plaintext, p256dh, auth, testing = {}) {
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error('payload too large');
  const uaPublic = b64u.decode(p256dh);
  const authSecret = b64u.decode(auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('invalid subscription keys');
  const salt = testing.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const local = testing.localKeys ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  // HKDF (SHA-256), written out: extract = HMAC(salt, ikm); expand (≤ 32 bytes) = HMAC(prk, info || 0x01).
  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, Uint8Array.of(1)));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), Uint8Array.of(1)))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), Uint8Array.of(1)))).slice(0, 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // A single record, ending with the 0x02 "last record" delimiter.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, Uint8Array.of(2))));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/**
 * Sends one notification. Returns { status, outcome } where outcome is
 * 'sent' | 'gone' (subscription expired: remove it) | 'retry' (temporary) | 'failed' (permanent).
 */
export async function sendWebPush(subscription, payload, vapid, { ttl = 3600, urgency = 'high', fetchImpl = fetch } = {}) {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), subscription.p256dh, subscription.auth);
  let res;
  try {
    res = await fetchImpl(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency,
        Authorization: await vapidAuthorization(subscription.endpoint, vapid),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { status: 0, outcome: 'retry', error: err?.name === 'TimeoutError' ? 'timeout' : 'network error' };
  }
  const text = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 300);
  if (res.status >= 200 && res.status < 300) return { status: res.status, outcome: 'sent' };
  if (res.status === 404 || res.status === 410) return { status: res.status, outcome: 'gone', error: text };
  if (res.status === 429 || res.status >= 500) return { status: res.status, outcome: 'retry', error: text };
  return { status: res.status, outcome: 'failed', error: text };
}
