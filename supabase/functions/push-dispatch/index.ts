// DailyMate push-dispatch — Supabase Edge Function (Deno).
//
//   {"action":"dispatch"}  from pg_cron, with the x-dispatch-secret header (secret in Vault).
//                          Creates the VAPID keys on first run, then sends queued reminders.
//   {"action":"test"}      from the app, with the signed-in user's access token.
//                          Sends a test notification to that user's devices (rate-limited).
//
// The VAPID private key and the dispatcher secret are read from Supabase Vault via
// service-role-only database functions; nothing secret is in this file or the browser.
// Deployed with verify_jwt = false because the function authorizes each request itself.

import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { generateVapidKeys, sendWebPush } from "./webpush.js";

const SUBJECT = "https://saudade165.github.io/DailyMate/";
const ALLOWED_ORIGINS = ["https://saudade165.github.io", "http://localhost:5174", "http://127.0.0.1:5174"];
const BATCH = 50;
const CONCURRENCY = 8;
const TIME_BUDGET_MS = 20_000;

function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default;
  } catch { /* fall back to the legacy key */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Vapid = { publicKey: string; privateJwk: string; subject: string };
type Claimed = {
  delivery_id: number; kind: string; attempts: number; endpoint: string; p256dh: string; auth_secret: string;
  title: string; body: string; reminder_id: string; occurrence_key: string;
};

async function log(level: "info" | "warning" | "error", message: string, details: Record<string, unknown> = {}) {
  const { error } = await db.rpc("log_integration_event", { p_source: "push-dispatch", p_level: level, p_message: message, p_details: details });
  if (error) console.error("log failed", error.message);
}

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function loadConfig() {
  const { data, error } = await db.rpc("push_server_config");
  if (error) throw new Error(`push_server_config: ${error.message}`);
  return data as { public: string | null; privateJwk: string | null; dispatchSecret: string | null };
}

/** Returns the VAPID keys, creating and storing them the first time. */
async function ensureVapid(config: Awaited<ReturnType<typeof loadConfig>>): Promise<Vapid> {
  if (config.public && config.privateJwk) return { publicKey: config.public, privateJwk: config.privateJwk, subject: SUBJECT };
  const keys = await generateVapidKeys();
  const { data: stored, error } = await db.rpc("push_store_vapid", { p_public: keys.publicKey, p_private_jwk: keys.privateJwk });
  if (error) throw new Error(`push_store_vapid: ${error.message}`);
  if (stored) {
    await log("info", "VAPID keys created");
    return { ...keys, subject: SUBJECT };
  }
  const again = await loadConfig(); // another run created them first
  return { publicKey: again.public!, privateJwk: again.privateJwk!, subject: SUBJECT };
}

function payloadFor(d: Claimed) {
  if (d.kind === "test") {
    return { title: d.title, body: d.body, tag: "dm-test", url: "./#/notifications", kind: "test" };
  }
  return { title: `Reminder: ${d.title}`, body: d.body, tag: `dm-${d.reminder_id}`, url: "./#/reminders", kind: "reminder", at: Number(d.occurrence_key) };
}

/** Claims and sends queued deliveries. Returns counts by outcome. */
async function processQueue(vapid: Vapid, userId: string | null = null) {
  const counts: Record<string, number> = { sent: 0, gone: 0, retry: 0, failed: 0 };
  const statuses: Record<string, number> = {};
  const started = Date.now();
  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data, error } = await db.rpc("push_claim", { p_limit: BATCH, p_user: userId });
    if (error) throw new Error(`push_claim: ${error.message}`);
    const batch = (data ?? []) as Claimed[];
    if (!batch.length) break;
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      await Promise.all(batch.slice(i, i + CONCURRENCY).map(async (d) => {
        let result;
        try {
          result = await sendWebPush({ endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth_secret }, payloadFor(d), vapid,
            { ttl: d.kind === "test" ? 300 : 3600 });
        } catch (err) {
          result = { status: 0, outcome: "failed", error: err instanceof Error ? err.message : "send failed" };
        }
        counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
        if (result.outcome !== "sent") statuses[String(result.status)] = (statuses[String(result.status)] ?? 0) + 1;
        const { error: reportError } = await db.rpc("push_report", {
          p_delivery_id: d.delivery_id, p_outcome: result.outcome, p_http: result.status || null, p_error: result.error ?? null,
        });
        if (reportError) console.error("push_report failed", reportError.message);
      }));
    }
    if (batch.length < BATCH) break;
  }
  if (counts.failed || counts.retry || counts.gone) {
    await log(counts.failed ? "error" : "warning", "Some notifications were not delivered", { ...counts, httpStatuses: statuses });
  }
  return counts;
}

function cors(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const headers = { ...cors(origin), "Content-Type": "application/json" };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "forbidden_origin" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  try {
    const config = await loadConfig();

    if (body.action === "dispatch") {
      if (!sameSecret(req.headers.get("x-dispatch-secret") ?? "", config.dispatchSecret ?? "")) return json({ error: "unauthorized" }, 401);
      const vapid = await ensureVapid(config);
      const counts = await processQueue(vapid);
      return json({ ok: true, ...counts });
    }

    if (body.action === "test") {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: auth, error: authError } = token ? await db.auth.getUser(token) : { data: null, error: true };
      if (authError || !auth?.user) return json({ error: "unauthorized" }, 401);
      const endpoint = typeof body.endpoint === "string" ? body.endpoint.slice(0, 1000) : null;
      const vapid = await ensureVapid(config);
      const { data: queued, error } = await db.rpc("push_enqueue_test", { p_user: auth.user.id, p_endpoint: endpoint });
      if (error) throw new Error(`push_enqueue_test: ${error.message}`);
      if (queued === -1) return json({ error: "too_many_tests" }, 429);
      if (queued === 0) return json({ error: "no_devices" }, 404);
      const counts = await processQueue(vapid, auth.user.id);
      return json({ ok: counts.sent > 0, ...counts });
    }

    return json({ error: "bad_request" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("push-dispatch failed", message);
    await log("error", "push-dispatch failed", { message: message.slice(0, 300) });
    return json({ error: "server_error" }, 500);
  }
});
