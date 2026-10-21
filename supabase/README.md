# DailyMate backend (Supabase)

Project: **DailyMate** · ref `aboenuyweqirlhdzrehd` · region `ca-central-1` (Montréal) · Free plan.

```
Browser (GitHub Pages)                    Supabase
──────────────────────                    ───────────────────────────────────────────────
js/cloud.js  ── Auth (email+password) ──▶ Supabase Auth (PKCE links, email confirmation)
js/sync.js   ── REST, user's token ─────▶ Postgres: profiles, tasks, lists, reminders, goals (RLS)
js/push.js   ── RPC ────────────────────▶ save/remove_push_subscription, get_push_public_key
sw.js        ◀── Web Push ─── push service (FCM / Mozilla / WNS / Apple) ◀── functions/push-dispatch
                                           ▲ every minute: pg_cron → pg_net (secret from Vault)
js/views/admin.js ── RPC ───────────────▶ admin_* functions (checked with is_admin() on the server)
js/ai.js     ── (not deployed) ─────────▶ functions/ai-assistant → Claude   (deferred)
```

Only the **publishable** key is in the app (`js/config.js`). It can do nothing beyond what
Row Level Security allows the signed-in person. Secret keys exist only inside Supabase.

## Migrations (all applied)

| File | What it does |
|---|---|
| `20261020000000_dailymate_ai_plans.sql` | `subscriptions`, `ai_usage`, `ai_consume_request/refund/status` — server-side plan + 100-request limit (AI deferred) |
| `20261020100000_accounts_and_sync.sql` | `profiles` (auto-created on sign-up), `tasks`, `lists`, `reminders`, `goals`; last-write-wins trigger; tombstones with content wiped; RLS; `delete_my_account()` |
| `20261020110000_push_notifications.sql` | `push_subscriptions` (push-service allowlist), `notification_deliveries` (unique per device+reminder+occurrence = no duplicates), recurrence-aware due calculation, retry/expiry handling, VAPID storage in Vault |
| `20261020111000_push_claim_per_user.sql` | test notifications only process that user's queue |
| `20261020120000_admin.sql` | `app_admins`, `admin_audit_log`, `integration_events`, `is_admin()`, `admin_*` functions (counts only, actions audited) |
| `20261020130000_scheduled_jobs.sql` | pg_cron: push dispatch every minute (only calls the function when there is work), daily cleanup |

Data rules enforced by the database (tested):
- Each person can read and change only their own rows. Nobody can hard-delete, change their plan, or make themselves admin from the browser.
- An older change can't overwrite a newer one (`updated_at`; clamped to now + 5 min).
- Deleted items keep only an id + date for 90 days so other devices remove them too.

## Push notifications

- VAPID keys were generated **inside** the Edge Function on its first run and stored in Supabase Vault
  (`push_vapid_public`, `push_vapid_private`). The private key never left Supabase.
- `push_dispatch_secret` (Vault) authenticates pg_cron → `push-dispatch`. The function is deployed with
  `verify_jwt = false` because it checks that secret, or the user's token for `{"action":"test"}`.
- Sending is implemented in `functions/push-dispatch/webpush.js` with WebCrypto only (RFC 8291 + RFC 8292).
  It was checked against Mozilla's reference implementation (`http_ece`) and the `cryptography` library.
- Delivery results: 2xx → `sent`; 404/410 → subscription disabled (`expired`); 429/5xx/network → up to
  3 retries with back-off within an hour; other 4xx → `failed`. Ten failures in a row disable a device.
- Reminders more than 6 hours late are not sent. Repeating reminders alert for each occurrence until done.

Redeploy after changing the function (needs the Supabase CLI and access to the project):

```bash
supabase link --project-ref aboenuyweqirlhdzrehd
supabase functions deploy push-dispatch --no-verify-jwt
```

## Admin access

Admins can only be added with SQL (Dashboard → SQL Editor), after the person has signed up and confirmed their email:

```sql
insert into public.app_admins (user_id, note)
select id, 'owner' from auth.users where email = '<the admin''s email>';
```

The admin page is at `#/admin`. It shows account facts and counts, never task/list/reminder contents.

## Dashboard settings still needed (cannot be set from the repository)

1. **Authentication → URL Configuration**
   - Site URL: `https://saudade165.github.io/DailyMate/`
   - Redirect URLs: `https://saudade165.github.io/DailyMate/**` (and `http://localhost:5174/**` for development)
   Without this, links in confirmation and password-reset emails point to `localhost:3000`.
2. **Authentication → Emails → SMTP Settings: set up a custom SMTP provider.** The built-in sender only
   delivers to members of the Supabase organization and is limited to a few emails per hour, so regular
   people can't confirm their accounts until this is done. Low-cost options: Resend, Brevo, Amazon SES,
   Postmark (most have a free tier). Values needed: host, port, username, password, sender address/name.
3. **Authentication → Providers → Email:** keep "Confirm email" on. Set the minimum password length to 8.
4. **Authentication → Attack Protection:** turn on leaked-password protection if your plan includes it.
5. Optional: customise the email templates (Authentication → Emails → Templates) with DailyMate wording.

## AI Assistant (deferred)

The AI screen stays locked. To turn it on later:
1. Payments: something (e.g. a Stripe webhook running with a secret key) must create `subscriptions` rows.
2. `supabase secrets set ANTHROPIC_API_KEY=… ALLOWED_ORIGINS=https://saudade165.github.io`
3. `supabase functions deploy ai-assistant --no-verify-jwt`
4. Put the function URL (not a key) into `AI_CONFIG.endpoint` in `js/config.js`.
The sign-in token is already passed to `js/ai.js` (`setAccessTokenProvider`). The quota rules are
already in the database (Plus only, 100 requests per billing period, failed calls refunded).

## Costs

Everything above runs on the Supabase **Free** plan ($0). Limits to watch: 500 MB database,
500K Edge Function invocations/month (the dispatcher uses at most ~43K), 50K monthly active users.
Free projects are **paused after 7 days without activity**; the Pro plan (US$25/month) avoids that.
