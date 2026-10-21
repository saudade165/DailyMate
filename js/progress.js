// Progress, streaks, goal progress and achievements — all calculated from the
// tasks, lists and goals the person actually has (nothing is invented).
//
// Definitions (also shown on the Progress page):
//   * Planned tasks: tasks scheduled for a day in the range, up to today. Future tasks
//     are never counted as planned, missed or done.
//   * Completion rate: done ÷ planned for those tasks.
//   * Completed per day: tasks counted on the day they were ticked off (their
//     completion time in this browser's time zone).
//   * Streak: consecutive days on which at least one task was ticked off. Days without
//     completions end a streak, whether or not tasks were planned. Today only breaks the
//     streak once it is over, so "yesterday + today still open" keeps it alive.
//   * Repeating tasks: each ticked-off occurrence is its own task, so it counts once;
//     previews of future repeats aren't tasks and are never counted.
//   * Deleted tasks are gone and no longer count. Completed goals keep the progress
//     they had when they were completed.

import { addDays, startOfWeek, toISO, todayISO } from './dates.js';

/** Local "YYYY-MM-DD" of the moment a task was completed (falls back to its date for old data). */
export function completedDay(task) {
  if (!task.completed) return null;
  const t = task.completedAt ? Date.parse(task.completedAt) : NaN;
  return Number.isNaN(t) ? task.date : toISO(new Date(t));
}

/** Map day -> number of tasks completed that day. */
export function completionsByDay(tasks) {
  const map = new Map();
  for (const t of tasks) {
    const d = completedDay(t);
    if (d) map.set(d, (map.get(d) ?? 0) + 1);
  }
  return map;
}

export const RANGES = [
  { id: 'today', label: 'Today', days: 1 },
  { id: '7', label: '7 days', days: 7 },
  { id: '30', label: '30 days', days: 30 },
  { id: 'all', label: 'All time', days: null },
];

/** First day with any task or completion (for "All time"). */
function firstDay(tasks, today) {
  let first = today;
  for (const t of tasks) {
    if (t.date < first) first = t.date;
    const c = completedDay(t);
    if (c && c < first) first = c;
  }
  return first;
}

export function rangeBounds(rangeId, tasks, today = todayISO()) {
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[1];
  const to = today;
  const from = range.days ? addDays(today, -(range.days - 1)) : firstDay(tasks, today);
  return { from, to, days: daysBetween(from, to) + 1 };
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);
}

// ---- Streaks ------------------------------------------------------------------------------

/** Current daily streak ending today (or yesterday, while today is still open). */
export function currentStreak(byDay, today = todayISO()) {
  let day = byDay.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (byDay.has(day)) { n += 1; day = addDays(day, -1); }
  return n;
}

/** Longest run of consecutive completion days between `from` and `to` (inclusive). */
export function longestStreak(byDay, from = null, to = todayISO()) {
  const days = [...byDay.keys()].filter((d) => (!from || d >= from) && d <= to).sort();
  let best = 0; let run = 0; let prev = null;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** Longest run of consecutive weeks (Monday–Sunday) with at least one completion. */
export function longestWeekStreak(byDay, from = null, to = todayISO()) {
  const weeks = [...new Set([...byDay.keys()].filter((d) => (!from || d >= from) && d <= to).map(startOfWeek))].sort();
  let best = 0; let run = 0; let prev = null;
  for (const w of weeks) {
    run = prev && addDays(prev, 7) === w ? run + 1 : 1;
    best = Math.max(best, run);
    prev = w;
  }
  return best;
}

/** The day the streak first reached `n` days, or null. */
function dayStreakReached(byDay, n) {
  const days = [...byDay.keys()].sort();
  let run = 0; let prev = null;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    if (run >= n) return d;
    prev = d;
  }
  return null;
}

// ---- Summary for a range ----------------------------------------------------------------------

export function summarize(tasks, rangeId, today = todayISO()) {
  const { from, to, days } = rangeBounds(rangeId, tasks, today);
  const planned = tasks.filter((t) => t.date >= from && t.date <= to);
  const done = planned.filter((t) => t.completed);
  const missed = planned.filter((t) => !t.completed && t.date < today);
  const openToday = planned.filter((t) => !t.completed && t.date === today);
  const byDay = completionsByDay(tasks);
  let completedInRange = 0;
  for (const [d, n] of byDay) if (d >= from && d <= to) completedInRange += n;

  // The same number of days just before this range.
  let previous = null;
  if (rangeId !== 'all') {
    const pTo = addDays(from, -1);
    const pFrom = addDays(from, -days);
    let n = 0;
    for (const [d, c] of byDay) if (d >= pFrom && d <= pTo) n += c;
    const hadData = tasks.some((t) => t.date <= pTo || (completedDay(t) && completedDay(t) <= pTo));
    previous = hadData ? { from: pFrom, to: pTo, completed: n } : null;
  }

  return {
    from, to, days,
    planned: planned.length,
    done: done.length,
    missed: missed.length,
    openToday: openToday.length,
    rate: planned.length ? done.length / planned.length : null,
    completedInRange,
    previous,
    streak: currentStreak(byDay, today),
    streakIncludesToday: byDay.has(today),
    bestStreak: longestStreak(byDay),
    byDay,
  };
}

/** Completed-per-day series for a chart, oldest first. All time is grouped by week. */
export function series(byDay, from, to) {
  const days = daysBetween(from, to) + 1;
  if (days <= 31) {
    return Array.from({ length: days }, (_, i) => {
      const d = addDays(from, i);
      return { key: d, label: d, value: byDay.get(d) ?? 0 };
    });
  }
  const weeks = new Map();
  for (let w = startOfWeek(from); w <= to; w = addDays(w, 7)) weeks.set(w, 0);
  for (const [d, n] of byDay) {
    if (d < from || d > to) continue;
    const w = startOfWeek(d);
    weeks.set(w, (weeks.get(w) ?? 0) + n);
  }
  return [...weeks].map(([w, n]) => ({ key: w, label: w, value: n, week: true }));
}

// ---- Goals -------------------------------------------------------------------------------

export const GOAL_KINDS = {
  tasks: { label: 'Complete tasks', icon: 'check-circle', unit: (n) => `task${n === 1 ? '' : 's'}`,
    help: 'Counts tasks you tick off between the start date and the deadline.' },
  active_days: { label: 'Productive days', icon: 'calendar', unit: (n) => `day${n === 1 ? '' : 's'}`,
    help: 'Counts days on which you tick off at least one task.' },
  streak: { label: 'Keep a streak', icon: 'flag', unit: (n, g) => `${g?.period === 'week' ? 'week' : 'day'}${n === 1 ? '' : 's'} in a row`,
    help: 'Your longest run of days (or weeks) in a row with at least one completed task, since the start date.' },
  list: { label: 'Finish a list', icon: 'list', unit: (n) => `item${n === 1 ? '' : 's'}`,
    help: 'Ticks off every item of one of your lists.' },
  custom: { label: 'Custom', icon: 'target', unit: (n) => `step${n === 1 ? '' : 's'}`,
    help: 'You update the progress yourself.' },
};

/**
 * Progress of one goal: { current, target, pct, text, state }.
 * state: 'active' | 'paused' | 'completed' | 'overdue' | 'missing-list'
 */
export function goalProgress(goal, { tasks, lists, byDay = completionsByDay(tasks), today = todayISO() }) {
  const end = goal.deadline && goal.deadline < today ? goal.deadline : today;
  const inWindow = (d) => d && d >= goal.startDate && d <= end;
  let current = 0;
  let target = goal.target;

  switch (goal.kind) {
    case 'tasks':
      current = tasks.filter((t) => inWindow(completedDay(t)) && (goal.priority === 'any' || t.priority === goal.priority)).length;
      break;
    case 'active_days':
      for (const d of byDay.keys()) if (inWindow(d)) current += 1;
      break;
    case 'streak':
      current = goal.period === 'week'
        ? longestWeekStreak(byDay, goal.startDate, end)
        : longestStreak(byDay, goal.startDate, end);
      break;
    case 'list': {
      const list = lists.find((l) => l.id === goal.listId);
      if (!list) {
        if (goal.status !== 'completed') return { current: 0, target: 0, pct: 0, text: 'This list was deleted', state: 'missing-list' };
        break;
      }
      target = list.items.length;
      current = list.items.filter((i) => i.done).length;
      break;
    }
    default:
      current = goal.manualProgress;
  }

  if (goal.status === 'completed') {
    current = Math.max(goal.achieved ?? target, 0);
    if (goal.kind === 'list') target = Math.max(current, 1);
  }
  const shown = Math.min(current, target);
  const pct = target > 0 ? Math.min(100, Math.round((shown / target) * 100)) : 0;
  const unit = GOAL_KINDS[goal.kind].unit(target, goal);
  let text;
  if (goal.kind === 'streak') text = `Best: ${current} of ${target} ${unit}`;
  else if (goal.kind === 'list' && target === 0) text = 'This list has no items yet';
  else text = `${shown} of ${target} ${unit}${goal.kind === 'tasks' && goal.priority !== 'any' ? ` (${goal.priority} priority)` : ''}`;
  const state = goal.status === 'completed' ? 'completed'
    : goal.status === 'paused' ? 'paused'
      : goal.deadline && goal.deadline < today ? 'overdue' : 'active';
  return { current, target, pct, text, state };
}

/** True when an active goal has reached its target and should be marked complete. */
// Paused goals never complete on their own; a passed deadline never completes a goal either
// (only progress inside the start–deadline window counts).
export function goalReached(goal, progress) {
  if (goal.status !== 'active' || progress.state === 'missing-list') return false;
  return progress.target > 0 && progress.current >= progress.target;
}

// ---- Achievements ------------------------------------------------------------------------

export const ACHIEVEMENTS = [
  { id: 'first_task', title: 'First step', text: 'Completed your first task', icon: 'check-circle' },
  { id: 'tasks_10', title: 'Getting going', text: 'Completed 10 tasks', icon: 'check' },
  { id: 'tasks_50', title: 'On a roll', text: 'Completed 50 tasks', icon: 'check' },
  { id: 'tasks_100', title: 'Century', text: 'Completed 100 tasks', icon: 'crown' },
  { id: 'tasks_500', title: 'Unstoppable', text: 'Completed 500 tasks', icon: 'crown' },
  { id: 'streak_3', title: 'Three in a row', text: 'A 3-day streak', icon: 'flag' },
  { id: 'streak_7', title: 'One whole week', text: 'A 7-day streak', icon: 'flag' },
  { id: 'streak_30', title: 'A month strong', text: 'A 30-day streak', icon: 'flag' },
  { id: 'perfect_day', title: 'Clean sweep', text: 'Finished every task on a day with 3 or more', icon: 'sun' },
  { id: 'first_goal', title: 'Goal getter', text: 'Completed your first goal', icon: 'target' },
  { id: 'goals_5', title: 'Goal crusher', text: 'Completed 5 goals', icon: 'target' },
];

/** Achievements the data shows were earned, with the date each was reached: { id: ISO }. */
export function earnedAchievements({ tasks, goals }) {
  const out = {};
  const completions = tasks.filter((t) => t.completed)
    .map((t) => t.completedAt ?? `${t.date}T12:00:00.000Z`).sort();
  [[1, 'first_task'], [10, 'tasks_10'], [50, 'tasks_50'], [100, 'tasks_100'], [500, 'tasks_500']].forEach(([n, id]) => {
    if (completions.length >= n) out[id] = completions[n - 1];
  });
  const byDay = completionsByDay(tasks);
  [[3, 'streak_3'], [7, 'streak_7'], [30, 'streak_30']].forEach(([n, id]) => {
    const d = dayStreakReached(byDay, n);
    if (d) out[id] = `${d}T12:00:00.000Z`;
  });
  const perDay = new Map();
  for (const t of tasks) {
    const e = perDay.get(t.date) ?? { all: 0, done: 0 };
    e.all += 1; if (t.completed) e.done += 1;
    perDay.set(t.date, e);
  }
  const perfect = [...perDay].filter(([d, e]) => e.all >= 3 && e.done === e.all && d <= todayISO()).map(([d]) => d).sort()[0];
  if (perfect) out.perfect_day = `${perfect}T12:00:00.000Z`;
  const done = goals.filter((g) => g.status === 'completed' && g.completedAt).map((g) => g.completedAt).sort();
  if (done.length >= 1) out.first_goal = done[0];
  if (done.length >= 5) out.goals_5 = done[4];
  return out;
}
