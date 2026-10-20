// Navigation definition. `ready: false` sections show an honest "Coming soon"
// page instead of a fake screen.

export const ROUTES = [
  { id: 'my-day', label: 'My Day', icon: 'home', ready: true },
  { id: 'planner', label: 'Planner', icon: 'calendar', ready: true },
  { id: 'ai-assistant', label: 'AI Assistant', icon: 'sparkle', ready: true, plus: true },
  { id: 'lists', label: 'Lists', icon: 'list', ready: true },
  { id: 'reminders', label: 'Reminders', icon: 'bell', ready: true },
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
