// DailyMate admin-mailer — Supabase Edge Function (Deno).
//
// E-mails the owner about new registrations, through Resend (https://resend.com).
//   {"action":"dispatch"}  from pg_cron with the x-dispatch-secret header (secret in Vault):
//                          sends everything waiting in public.admin_email_queue.
//   {"action":"test"}      from the admin page with the signed-in user's token: queues and
//                          sends a test e-mail — only if that user is the owner.
//
// Secrets (Edge Functions → Secrets in the Supabase dashboard; never in the repository):
//   RESEND_API_KEY  required to send anything
//   MAIL_FROM       optional, e.g. "DailyMate <notify@your-domain>" (a domain verified in Resend).
//                   Default "DailyMate <onboarding@resend.dev>", which Resend only delivers
//                   to the address the Resend account was created with.
//
// No duplicates: the queue has one row per account (unique key), a row is claimed by one
// run at a time, and Resend gets an Idempotency-Key so a retry after a crash isn't sent twice.
//
// Delivery: "sent" only means Resend accepted the e-mail. Each run also asks Resend for the
// latest event of recently sent e-mails (delivered, bounced, …) and stores it for the admin page.
// That needs an API key with "Full access"; with a "Sending access" key the status is "unavailable".

import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const APP_URL = "https://saudade165.github.io/DailyMate/";
const ALLOWED_ORIGINS = ["https://saudade165.github.io", "http://localhost:5174", "http://127.0.0.1:5174"];
const SUBJECT = "DailyMate — New User Registration";

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

type Row = {
  id: number; kind: "new_user" | "test"; dedupe_key: string; attempts: number; recipient: string | null;
  user_email: string | null; user_name: string | null; registered_at: string | null; confirmed_at: string | null; user_exists: boolean;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function when(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const toronto = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeStyle: "short", timeZone: "America/Toronto" }).format(d);
  return `${toronto} (Toronto) · ${d.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function compose(row: Row) {
  if (row.kind === "test") {
    const text = `This is a test e-mail from the DailyMate admin panel.\n\nNew-registration e-mails will arrive at this address.\n\nAdmin panel: ${APP_URL}#/admin`;
    return {
      subject: "DailyMate — Test e-mail",
      text,
      html: `<p>This is a test e-mail from the DailyMate admin panel.</p><p>New-registration e-mails will arrive at this address.</p>
             <p><a href="${APP_URL}#/admin">Open the admin panel</a></p>`,
    };
  }
  const lines: [string, string][] = [
    ["Registered", when(row.registered_at)],
    ["E-mail confirmed", row.confirmed_at ? when(row.confirmed_at) : "not yet"],
    ["E-mail", row.user_email ?? "—"],
    ["Name", row.user_name ?? "not provided"],
  ];
  const link = `${APP_URL}#/admin/users`;
  return {
    subject: SUBJECT,
    text: `A new user registered on DailyMate.\n\n${lines.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nAdmin panel: ${link}`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#13233d">
      <p>A new user registered on <strong>DailyMate</strong>.</p>
      <table cellpadding="6" style="border-collapse:collapse">${lines.map(([k, v]) =>
        `<tr><td style="color:#51627c">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join("")}</table>
      <p><a href="${link}" style="color:#1d5fd6">Open the admin panel</a></p>
      <p style="color:#6b7a91;font-size:13px">You get this e-mail because you are the DailyMate owner. Turn it off in the admin panel (E-mails).</p>
    </div>`,
  };
}

async function setStatus(patch: Record<string, unknown>) {
  const { data } = await db.rpc("admin_mail_set_status", { p_status: { ...patch, checkedAt: new Date().toISOString() } });
  return data;
}

/** Sends one e-mail. Outcome: sent | retry | failed | skipped | not_configured */
async function send(row: Row): Promise<{ outcome: string; error?: string; providerId?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  // A test isn't kept waiting for later; registrations wait until e-mail is set up.
  if (!key) return { outcome: row.kind === "test" ? "failed" : "not_configured", error: "RESEND_API_KEY is not set" };
  if (!row.recipient) return { outcome: "not_configured", error: "owner e-mail is not set" };
  if (row.kind === "new_user" && !row.user_exists) return { outcome: "skipped", error: "account was deleted before the e-mail was sent" };
  const mail = compose(row);
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": row.dedupe_key },
      body: JSON.stringify({ from: Deno.env.get("MAIL_FROM") || "DailyMate <onboarding@resend.dev>", to: [row.recipient], ...mail }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { outcome: "retry", error: "network error" };
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { outcome: "sent", providerId: body?.id };
  const message = `${res.status} ${String(body?.message ?? body?.name ?? "").slice(0, 300)}`;
  if (res.status === 429 || res.status >= 500) return { outcome: "retry", error: message };
  return { outcome: "failed", error: message }; // e.g. invalid key, sender domain not verified
}

async function processQueue(onlyTest = false) {
  const counts: Record<string, number> = {};
  let lastError: string | null = null;
  const { data, error } = await db.rpc("admin_mail_claim", { p_limit: 20, p_only_test: onlyTest });
  if (error) throw new Error(`admin_mail_claim: ${error.message}`);
  for (const row of (data ?? []) as Row[]) {
    const r = await send(row);
    counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    if (r.error && r.outcome !== "skipped") lastError = r.error;
    const { error: reportError } = await db.rpc("admin_mail_report", {
      p_id: row.id, p_outcome: r.outcome, p_error: r.error ?? null, p_provider_id: r.providerId ?? null,
    });
    if (reportError) console.error("admin_mail_report failed", reportError.message);
  }
  const configured = Boolean(Deno.env.get("RESEND_API_KEY"));
  await setStatus({ configured, lastRunAt: new Date().toISOString(), lastError, ...(counts.sent ? { lastSentAt: new Date().toISOString() } : {}) });
  // "Not set up yet" is shown as a status in the admin panel, not logged as an error.
  if (configured && (counts.failed || counts.retry)) {
    await db.rpc("log_integration_event", { p_source: "admin-mailer", p_level: counts.failed ? "error" : "warning",
      p_message: "Some admin e-mails were not sent", p_details: { ...counts, lastError } });
  }
  return { configured, ...counts };
}

/** Stores Resend's latest delivery event for e-mails sent in the last 3 days (checked every 5 minutes). */
async function refreshDelivery() {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return;
  const { data, error } = await db.rpc("admin_mail_delivery_pending", { p_limit: 20 });
  if (error) { console.error("admin_mail_delivery_pending failed", error.message); return; }
  for (const row of (data ?? []) as { id: number; provider_id: string }[]) {
    let status = "unknown";
    try {
      const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(row.provider_id)}`, {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) status = String(body?.last_event ?? "unknown");
      else if (res.status === 401 || res.status === 403) status = "unavailable";
      else continue; // try again on the next run
    } catch {
      continue;
    }
    await db.rpc("admin_mail_set_delivery", { p_id: row.id, p_status: status });
  }
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
    if (body.action === "dispatch") {
      const { data: config } = await db.rpc("push_server_config");
      const secret = req.headers.get("x-dispatch-secret") ?? "";
      const expected = String(config?.dispatchSecret ?? "");
      let diff = secret.length ^ expected.length;
      for (let i = 0; i < Math.min(secret.length, expected.length); i++) diff |= secret.charCodeAt(i) ^ expected.charCodeAt(i);
      if (!expected || diff !== 0) return json({ error: "unauthorized" }, 401);
      const result = await processQueue();
      await refreshDelivery();
      return json({ ok: true, ...result });
    }

    if (body.action === "test") {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: auth, error: authError } = token ? await db.auth.getUser(token) : { data: null, error: true };
      if (authError || !auth?.user) return json({ error: "unauthorized" }, 401);
      const { data: queued, error } = await db.rpc("admin_mail_enqueue_test", { p_user: auth.user.id });
      if (error) throw new Error(`admin_mail_enqueue_test: ${error.message}`);
      if (queued === -2) return json({ error: "forbidden" }, 403);
      if (queued === -1) return json({ error: "too_many_tests" }, 429);
      const result = await processQueue(true);
      if (!result.configured) return json({ ok: false, error: "not_configured" }, 503);
      return json({ ok: Boolean(result.sent), ...result });
    }

    return json({ error: "bad_request" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("admin-mailer failed", message);
    await db.rpc("log_integration_event", { p_source: "admin-mailer", p_level: "error", p_message: "admin-mailer failed", p_details: { message: message.slice(0, 300) } });
    return json({ error: "server_error" }, 500);
  }
});
