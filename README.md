# DailyMate

**Your day, organized.** A calm, simple day planner built for people who want
clarity, not complexity.

## Run locally

No build step and no dependencies — it's plain HTML, CSS and JavaScript (ES modules).
ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173.

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
- **AI Assistant** — finished screen (chat, examples, suggested tasks you can add
  or edit first, loading / error / limit states). It is **locked**: there are no
  accounts or payments yet, so no one is on DailyMate Plus, and no AI server is
  connected. Nothing typed there is sent anywhere. See `supabase/README.md`.
- **Profile & Subscription** — display name, plan comparison (information only),
  backup download and restore (tasks, lists, reminders).
- Progress and Goals still show an honest "Coming soon" page.

### Reminder alerts — what works and what doesn't

When a reminder is due, DailyMate shows a card on screen (Done / Snooze 10 min)
**while the app is open in a browser tab**, and a browser notification if the
person allowed notifications and the tab is in the background. There are **no**
alerts when the browser or app is closed, and no email/SMS/phone push: that needs
a server that stores reminders and sends Web Push (service worker + VAPID keys +
a scheduled job, e.g. Supabase cron + an Edge Function). Missed reminders show
as *Overdue* the next time DailyMate is opened.

## Storage — important

Data is stored in the browser's **localStorage** (key `dailymate.v1`, format
version 2 — data saved by older versions loads unchanged) on this device only.
There is no account, no cloud sync and no backend yet. Clearing browser data
deletes everything — use *Profile → Download a backup*. All storage access goes
through `js/store.js`, so it can be replaced by an API client without touching
the UI. The AI conversation is kept only for the browser session (sessionStorage).

## Structure

```
index.html              App shell, dialogs (task, reminder, list, confirm), icon sprite
css/styles.css          Design tokens, components, responsive rules
js/app.js               Router (#/section/param…), navigation, search, re-rendering
js/store.js             Data layer (localStorage): tasks, lists, reminders, backup
js/dates.js             Local dates, formatting, time-zone conversion
js/repeat.js            Repeat rules shared by tasks and reminders
js/components.js        Task row and task actions shared by My Day and Planner
js/dialogs.js           Task / reminder / list forms and the confirm dialog
js/alerts.js            On-screen reminder alerts and browser notifications
js/templates.js         Starter lists (Groceries, Home, Errands, Shopping)
js/ai.js                Client for the AI server function (no keys in the browser)
js/config.js            Public settings (AI endpoint URL — never secrets)
js/routes.js            Navigation items and "Coming soon" copy
js/ui.js                Escaping, icons, toasts (with Undo)
js/views/*.js           My Day, Planner, AI Assistant, Lists, Reminders, Profile, Coming soon
supabase/               AI server function + database schema (not deployed) — see supabase/README.md
manifest.webmanifest    PWA manifest (groundwork for Android install)
```
