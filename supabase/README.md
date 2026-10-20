# DailyMate AI — server part (not deployed yet)

The AI Assistant screen in the app is finished, but it stays locked until this
server part is deployed **and** DailyMate has accounts and payments. Nothing in
the browser ever holds an AI key.

```
Browser (GitHub Pages)                 Supabase                              Anthropic
───────────────────────                ─────────────────────────             ─────────
js/ai.js  ── POST + user token ──▶     functions/ai-assistant  ── API key ─▶  Claude
                                         │ 1. verify token (Supabase Auth)
                                         │ 2. ai_consume_request(): plan + limit,
                                         │    recorded atomically (row lock)
                                         │ 3. call Claude, structured JSON answer
                                         │ 4. ai_refund_request() if the call failed
                                         ▼
                                       Postgres: subscriptions, ai_usage (RLS)
```

## What is enforced on the server

- **Free users have no AI.** `ai_consume_request` allows a request only when the
  user's `subscriptions` row has `plan = 'plus'`, status `active`/`trialing`, and
  *now* is inside `current_period_start … current_period_end`.
- **100 requests per paid billing period.** Counted in `ai_usage` per
  `period_start`, under a row lock so parallel requests can't exceed the limit.
- **Failed calls don't count.** If Claude errors, refuses or returns something
  unreadable, the request is refunded.
- **Users can read but not change** their plan and usage (RLS, no write policies;
  the SQL functions are executable only by the service role).
- The browser's `Origin` must be in `ALLOWED_ORIGINS`.

## Still missing before AI can be switched on

1. **Accounts** — DailyMate has no sign-in yet. Add Supabase Auth to the app and
   call `setAccessTokenProvider(() => session.access_token)` from `js/ai.js`.
2. **Payments** — something must create and update `subscriptions` rows
   (plan, status, billing period), e.g. a Stripe webhook running with the
   service-role key. Until then nobody is on Plus, so AI stays locked.
3. **Deploying this folder** (below).

## Deploy

```bash
supabase link --project-ref <your-project-ref>
supabase db push                                   # applies migrations/20261020000000_dailymate_ai_plans.sql
supabase secrets set ANTHROPIC_API_KEY=<key>       # never commit this
supabase secrets set ALLOWED_ORIGINS=https://saudade165.github.io
supabase functions deploy ai-assistant --no-verify-jwt
```

`--no-verify-jwt` is intentional: the function verifies the token itself with
`auth.getUser()` and must answer the browser's CORS preflight, which carries no token.

Then put the function URL (not a key) into `js/config.js`:

```js
export const AI_CONFIG = { endpoint: 'https://<project-ref>.supabase.co/functions/v1/ai-assistant' };
```

## Model

`claude-opus-5-5` with low effort and JSON-schema structured output. Change it
with the `AI_MODEL` secret. Refusals are retried server-side on Anthropic's
recommended fallback model (`fallbacks: "default"`). Pin the
`npm:@anthropic-ai/sdk` version in `index.ts` when you deploy.

## Request and response

```jsonc
// POST {endpoint}   Authorization: Bearer <user access token>
{ "action": "status" }
// → { "plan": "plus", "active": true, "usage": { "used": 3, "limit": 100, "periodEnd": "…" } }

{ "action": "chat",
  "messages": [{ "role": "user", "content": "Plan my Saturday…" }],
  "context": { "today": "2026-10-20", "timeZone": "America/Toronto", "tasks": [ … ] } }  // tasks only if the user allows it
// → { "reply": "…", "tasks": [{ "title", "date", "time", "priority", "notes" }], "suggestions": ["…"], "usage": { … } }
// Errors: 401 unauthorized · 402 plan_required · 429 limit_reached (+usage) · 422 refused · 502/503 ai_unavailable/busy
```
