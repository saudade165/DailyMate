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
  optional time, priority, notes); browse any day; filter All / To do / Done;
  overdue tasks with "Move to today"; "Coming up" list; day progress; search.
- **Profile & Subscription** — display name for the greeting, plan comparison
  (Free / Plus, information only), JSON backup download.
- Other sections (Planner, AI Assistant, Lists, Reminders, Progress, Goals) show
  an honest "Coming soon" page.

## Storage — important

Data is stored in the browser's **localStorage** (key `dailymate.v1`) on this
device only. There is no account, no cloud sync and no backend yet. Clearing
browser data deletes tasks. All storage access goes through `js/store.js`, so it
can be replaced by an API client without touching the UI.

## Structure

```
index.html            App shell, dialogs, icon sprite
css/styles.css        Design tokens, components, responsive rules
js/app.js             Router, navigation, search, re-rendering
js/store.js           Data layer (localStorage) + validation
js/dates.js           Local-date helpers and formatting
js/dialogs.js         Add/edit task form and confirm dialog
js/routes.js          Navigation items and "Coming soon" copy
js/ui.js              Escaping, icons, toasts
js/views/myday.js     My Day screen
js/views/profile.js   Profile & Subscription screen
js/views/soon.js      "Coming soon" screen
manifest.webmanifest  PWA manifest (groundwork for Android install)
```
