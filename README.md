# DailyMate

**Your day, organized.** A calm, simple day planner built for people who want
clarity, not complexity.

## Run locally

No build step and no dependencies — it's plain HTML, CSS and JavaScript (ES modules).
ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 5174
```

Then open http://localhost:5174 (the address allowed by the server for development).

## What works today

- **My Day** — add, edit, complete/uncomplete and delete tasks (title, date,
  optional time, priority, notes, repeat); browse any day; filter All / To do / Done;
  overdue tasks with "Move to today"; "Coming up" list; day progress; search;
  set a reminder from any task.
- **Planner** (`#/planner/<day|week|month>/<YYYY-MM-DD>`) — day, week and month
  views of the same tasks as My Day; previous / next / today / pick a date; add,
  edit, complete and delete; dots and counts show which days have tasks (red ring
  for unfinished past days); drag a task to another day on a computer.
- **Repeating tasks** — every day / weekday / week / month / year. A repeating task
  is one task: ticking it off creates the next one (missed dates are skipped);
  un-ticking removes that new one again if it wasn't touched. Future repeats are
  previewed in the Planner with a dashed outline.
- **Lists** (`#/lists`, `#/lists/<id>`) — create (blank or from Groceries / Home /
  Errands / Shopping), rename, delete with confirmation and Undo; add, edit, tick,
  reorder and delete items (Undo); progress per list; "Uncheck all" and
  "Remove done items".
- **Reminders** — create, edit, delete (Undo); date, time, repeat, optional link to
  a task; Overdue / Today / Tomorrow / Later this week / Later / Done; snooze.
  Each reminder stores the time zone it was set in and is shown on this device's
  clock (daylight-saving changes handled).
- **Accounts** (`#/account`) — sign up with email + password (+ optional name), email confirmation,
  sign in/out, forgot/reset password, delete account (`#/delete-account`).
  Without an account everything still works on this device only.
- **Cloud sync** — when signed in, tasks, lists, reminders and the display name sync
  between devices through Supabase. The app keeps working offline; changes wait in
  an outbox and upload later. Per-item "latest change wins", also enforced by the
  server. On first sign-in, data already on the device can be added to the account
  (or kept out, after downloading a copy).
- **Push notifications** (`#/notifications`) — opt-in per device; reminders are
  sent by the server even when DailyMate is closed (see limits below); test button;
  list and remove devices. Email is used only for account emails. No SMS.
- **Installable app (PWA)** — manifest with PNG icons (192, 512, maskable), service
  worker with an offline copy of the app. Updates are fetched first when online.
- **Privacy pages** — Privacy Policy, Terms, Storage & cookies, account deletion
  (drafts — see below). Linked from the footer and Profile.
- **Admin** (`#/admin`, owner account only, checked on the server for every request) —
  key numbers (users, new today / 7 / 30 days, active users), registrations chart with
  date range, latest users, health; Users with search, filters, sorting, pages,
  details, block/unblock, delete with confirmation, masked CSV export; feature usage;
  new-registration e-mails (settings, status, test, retry); services, cron jobs,
  server log and audit log. See `supabase/README.md`.
- **New-registration e-mails** to the owner via a server function and Resend (needs
  the `RESEND_API_KEY` secret — see `supabase/README.md`).
- **AI Assistant** — finished screen, still **locked**: no AI provider or payments
  are connected, so no one is on DailyMate Plus. The server-side quota is in place.
  Nothing typed there is sent anywhere. See `supabase/README.md`.
- **Profile & Subscription** — account and sync status, display name, plan
  comparison (information only), backup download and restore.
- Progress and Goals still show an honest "Coming soon" page (the database already
  has a `goals` table).

### Reminder alerts — what works and what doesn't

- While DailyMate is open: an on-screen card (Done / Snooze 10 min), with or without an account.
- With an account and notifications turned on for a device: the server sends a Web
  Push notification when the reminder is due, also when DailyMate is closed. Checked
  every minute; repeating reminders alert for every occurrence until marked done.
- **Device limits:** Android and desktop Chrome/Edge/Firefox/Safari support it (desktop
  browsers must be running, at least in the background). iPhone/iPad only after
  *Add to Home Screen* (iOS 16.4+). Delivery is best-effort; do-not-disturb and
  battery savers apply.
- **Tested so far:** the full server path against real push services (FCM and
  Mozilla answered; delivery records, expiry handling and no duplicates verified)
  and the encryption against a reference library. **Not yet tested on a real phone
  or desktop browser receiving a notification** — the testing browser doesn't
  allow service workers.
- No email or SMS reminders.

## Storage, cookies and privacy

DailyMate sets **no cookies** and has no analytics, ads or trackers, so it shows no
cookie banner. Browser storage it uses is listed on `#/cookies`:
`dailymate.v1` (data), `dailymate.auth` (sign-in session), `dailymate.outbox` /
`dailymate.sync` (sync), `dailymate.push` (this device's notification setting),
session storage for the AI chat, and a cache of the app's files.

The legal pages are **drafts** that describe the actual behaviour. Operator name,
contact email, address and privacy contact are placeholders — fill in `LEGAL` in
`js/config.js`. Have them reviewed (PIPEDA; Québec Law 25, which among other things
requires naming a person responsible for personal information and assessing
transfers outside Québec) before charging money or launching widely.

## Backend

Supabase project in Canada (ca-central-1), Free plan. Schema, Edge Functions,
cron jobs, admin setup and the **dashboard settings that still have to be made by
the owner** (custom SMTP, redirect URLs) are documented in `supabase/README.md`.

## Structure

```
index.html              App shell, dialogs, icon sprite, footer
sw.js                   Service worker: push notifications + offline copy of the app
css/styles.css          Design tokens, components, responsive rules
js/app.js               Router (#/section/param…), navigation, search, accounts, re-rendering
js/store.js             Local data (localStorage): tasks, lists, reminders, backup, owner
js/cloud.js             Supabase Auth (loads the library only when needed)
js/sync.js              Cloud sync: outbox, download/merge, conflict rules
js/push.js              Push subscription on this device, test, device list
js/dates.js             Local dates, formatting, time-zone conversion
js/repeat.js            Repeat rules shared by tasks and reminders
js/components.js        Task row and task actions shared by My Day and Planner
js/dialogs.js           Task / reminder / list forms, confirm and choice dialogs
js/alerts.js            On-screen reminder alerts while the app is open
js/templates.js         Starter lists (Groceries, Home, Errands, Shopping)
js/ai.js                Client for the AI server function (no keys in the browser)
js/config.js            Public settings: Supabase URL + publishable key, AI endpoint, legal details
js/routes.js            Navigation items and "Coming soon" copy
js/ui.js                Escaping, icons, toasts (with Undo)
js/vendor/              supabase-js 2.117.2 (MIT), served from this site — no CDN
js/views/*.js           My Day, Planner, AI, Lists, Reminders, Profile, Account,
                        Notifications, Admin, legal pages, Coming soon
supabase/               Migrations and Edge Functions — see supabase/README.md
manifest.webmanifest    PWA manifest; assets/ has the icons
```
