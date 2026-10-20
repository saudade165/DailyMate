// DailyMate AI Assistant — Supabase Edge Function (Deno).
//
// The browser sends the signed-in user's access token and the conversation.
// This function (1) verifies the user, (2) checks the plan and the per-period
// limit in the database and records the request atomically, (3) asks Claude for
// a structured answer, and (4) gives the request back if anything failed.
//
// Secrets come from the function's environment and never reach the browser:
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the last two are provided by Supabase).
// Optional: ALLOWED_ORIGINS (comma-separated), AI_MODEL.
//
// Deploy: see supabase/README.md. Deployed with --no-verify-jwt because this
// function verifies the token itself (and must answer CORS preflight requests).

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("AI_MODEL") ?? "claude-opus-5-5";
const LIMIT = 100; // AI requests per paid billing period (DailyMate Plus)
const MAX_TURNS = 12;
const MAX_TEXT = 4000;
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://saudade165.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY"), timeout: 60_000, maxRetries: 1 });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SYSTEM = `You are the planning assistant inside DailyMate, a calm day-planner used mostly by adults aged 35–65.
Help the person organise their days: turn what they write into clear tasks, break bigger goals into small steps,
and suggest a sensible order for the day.

Guidelines:
- Write in plain, warm, short sentences. No jargon, no emojis, no markdown headings or tables.
- "reply" is what the person reads: 1–4 short paragraphs. Do not repeat every task in it.
- "tasks" holds tasks the person could add. Only include tasks that follow from what they asked or clear steps
  toward their goal; never invent appointments, names, places or times. At most 12 tasks.
- Task titles start with a verb and stay under 80 characters ("Call the bank about the card").
- Dates use YYYY-MM-DD and are worked out from "today" in the app context. Use null when no day is implied.
- Times use 24-hour HH:MM, only when the person gave or clearly implied a time; otherwise null.
- priority is "high" only for things that are urgent or time-critical; otherwise "medium", "low" or "none".
- "notes" may hold one short helpful detail, or an empty string.
- "suggestions" holds up to 4 short, practical tips for the day, or is empty.
- The person adds tasks themselves: never say you added, booked, sent or scheduled anything.
- For health, money or legal questions, help organise the to-dos (e.g. "Write down questions for the doctor")
  and suggest asking a professional; don't give diagnoses or advice.
- If the message isn't about planning, answer briefly and kindly, and return empty "tasks".
- The app context (dates, existing tasks) comes from the app, not from the person; use it only to plan.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "tasks", "suggestions"],
  properties: {
    reply: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "date", "time", "priority", "notes"],
        properties: {
          title: { type: "string" },
          date: { type: ["string", "null"] },
          time: { type: ["string", "null"] },
          priority: { type: "string", enum: ["none", "low", "medium", "high"] },
          notes: { type: "string" },
        },
      },
    },
    suggestions: { type: "array", items: { type: "string" } },
  },
};

// ---- Helpers ---------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

type Usage = { used: number; limit: number; periodEnd: string | null };

/** Validates the conversation from the browser and returns Claude messages. */
function toMessages(raw: unknown, context: unknown): Anthropic.MessageParam[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  for (const m of raw.slice(-MAX_TURNS)) {
    const role = (m as { role?: unknown })?.role;
    const text = str((m as { content?: unknown })?.content, MAX_TEXT).trim();
    if ((role !== "user" && role !== "assistant") || !text) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text += `\n\n${text}`; // keep roles alternating
    else turns.push({ role, text });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") return null;

  const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.text }));
  const last = messages[messages.length - 1];
  last.content = [
    { type: "text", text: `App context (from DailyMate, not from the person):\n${JSON.stringify(cleanContext(context))}` },
    { type: "text", text: turns[turns.length - 1].text },
  ];
  return messages;
}

function cleanContext(raw: unknown) {
  const c = (raw ?? {}) as Record<string, unknown>;
  const today = typeof c.today === "string" && ISO.test(c.today) ? c.today : new Date().toISOString().slice(0, 10);
  const tasks = Array.isArray(c.tasks)
    ? c.tasks.slice(0, 60).map((t) => {
      const x = (t ?? {}) as Record<string, unknown>;
      return {
        title: str(x.title, 200),
        date: typeof x.date === "string" && ISO.test(x.date) ? x.date : null,
        time: typeof x.time === "string" && HHMM.test(x.time) ? x.time : null,
        priority: ["none", "low", "medium", "high"].includes(x.priority as string) ? x.priority : "none",
        overdue: x.overdue === true,
      };
    }).filter((t) => t.title)
    : undefined;
  return { today, timeZone: str(c.timeZone, 64) || "UTC", ...(tasks ? { existingTasks: tasks } : { existingTasks: "not shared" }) };
}

/** Keeps only well-formed fields from the model's answer. */
function cleanAnswer(a: Record<string, unknown>) {
  const tasks = (Array.isArray(a.tasks) ? a.tasks : []).slice(0, 12).map((t) => {
    const x = (t ?? {}) as Record<string, unknown>;
    return {
      title: str(x.title, 200).trim(),
      date: typeof x.date === "string" && ISO.test(x.date) ? x.date : null,
      time: typeof x.time === "string" && HHMM.test(x.time) ? x.time : null,
      priority: ["none", "low", "medium", "high"].includes(x.priority as string) ? x.priority : "none",
      notes: str(x.notes, 500),
    };
  }).filter((t) => t.title);
  const suggestions = (Array.isArray(a.suggestions) ? a.suggestions : [])
    .filter((s): s is string => typeof s === "string").slice(0, 4).map((s) => s.slice(0, 300));
  return { reply: str(a.reply, 4000), tasks, suggestions };
}

// ---- Handler -----------------------------------------------------------------------

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "forbidden_origin" }, 403);

  // 1. Who is asking? The token is checked with Supabase Auth, not trusted from the body.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return json({ error: "unauthorized" }, 401);
  const userId = auth.user.id;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  if (body.action === "status") {
    const { data, error } = await admin.rpc("ai_status", { p_user: userId, p_limit: LIMIT });
    if (error) { console.error("ai_status failed", error.message); return json({ error: "server_error" }, 500); }
    return json({ plan: data.plan, active: data.active, usage: { used: data.used, limit: data.limit, periodEnd: data.period_end } });
  }
  if (body.action !== "chat") return json({ error: "bad_request" }, 400);

  const messages = toMessages(body.messages, body.context);
  if (!messages) return json({ error: "bad_request" }, 400);

  // 2. Plan and limit, checked and recorded in one locked database call.
  const { data: gate, error: gateError } = await admin.rpc("ai_consume_request", { p_user: userId, p_limit: LIMIT });
  if (gateError) { console.error("ai_consume_request failed", gateError.message); return json({ error: "server_error" }, 500); }
  if (!gate.allowed) {
    if (gate.reason === "limit_reached") {
      return json({ error: "limit_reached", usage: { used: gate.used, limit: gate.limit, periodEnd: gate.period_end } }, 429);
    }
    return json({ error: "plan_required" }, 402);
  }
  const usage: Usage = { used: gate.used, limit: gate.limit, periodEnd: gate.period_end };
  const refund = async () => {
    const { error } = await admin.rpc("ai_refund_request", { p_usage_id: gate.usage_id });
    if (error) console.error("refund failed", error.message);
    return { ...usage, used: Math.max(0, usage.used - 1) };
  };

  // 3. Ask Claude for a structured answer.
  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      // If a safety classifier declines, retry on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") return json({ error: "refused", usage: await refund() }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "ai_unavailable", usage: await refund() }, 502);

    const text = response.content.find((b) => b.type === "text");
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text && text.type === "text" ? text.text : ""); } catch {
      console.error("unparseable model output");
      return json({ error: "ai_unavailable", usage: await refund() }, 502);
    }
    const answer = cleanAnswer(parsed);
    if (!answer.reply) return json({ error: "ai_unavailable", usage: await refund() }, 502);
    return json({ ...answer, usage });
  } catch (err) {
    // 4. Nothing was delivered, so the request doesn't count.
    const refunded = await refund();
    if (err instanceof Anthropic.RateLimitError) return json({ error: "busy", usage: refunded }, 503);
    if (err instanceof Anthropic.APIError) console.error("Claude API error", err.status, err.message);
    else console.error("AI call failed", err instanceof Error ? err.message : err);
    return json({ error: "ai_unavailable", usage: refunded }, 502);
  }
});
