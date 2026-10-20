// Navigation definition. `ready: false` sections show an honest "Coming soon"
// page instead of a fake screen.

export const ROUTES = [
  { id: 'my-day', label: 'My Day', icon: 'home', ready: true },
  {
    id: 'planner', label: 'Planner', icon: 'calendar', ready: false,
    blurb: 'See your week and month at a glance and move tasks between days.',
    meanwhile: 'You can already plan any day from My Day — use the arrows or the date picker above your task list.',
  },
  {
    id: 'ai-assistant', label: 'AI Assistant', icon: 'sparkle', ready: false, plus: true,
    blurb: 'Describe your day in your own words and DailyMate Plus will turn it into a tidy plan with tasks.',
    meanwhile: 'The AI Assistant will be part of DailyMate Plus. It is not connected yet, so nothing you type is sent anywhere.',
  },
  {
    id: 'lists', label: 'Lists', icon: 'list', ready: false,
    blurb: 'Keep shopping lists, packing lists and other checklists in one place.',
    meanwhile: 'For now, you can add these as tasks in My Day and use the Notes field for details.',
  },
  {
    id: 'reminders', label: 'Reminders', icon: 'bell', ready: false,
    blurb: 'Get a gentle notification before a task is due, on your computer or phone.',
    meanwhile: 'Add a time to your tasks in My Day so they appear in order through the day.',
  },
  {
    id: 'progress', label: 'Progress', icon: 'chart', ready: false,
    blurb: 'See how many tasks you finish each week and celebrate your streaks.',
    meanwhile: 'Your progress for each day is shown at the top of My Day.',
  },
  {
    id: 'goals', label: 'Goals', icon: 'target', ready: false,
    blurb: 'Set bigger goals and break them into small, doable steps.',
    meanwhile: 'You can already add the first step of a goal as a task in My Day.',
  },
  { id: 'profile', label: 'Profile & Subscription', icon: 'user', ready: true },
];

export const DEFAULT_ROUTE = 'my-day';

export function findRoute(id) {
  return ROUTES.find((r) => r.id === id) ?? null;
}
