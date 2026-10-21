// Progress — a calm overview of what the person got done, from their own tasks.
// See js/progress.js for exactly how each number is counted.

import * as store from '../store.js';
import { ACHIEVEMENTS, GOAL_KINDS, RANGES, completionsByDay, goalProgress, series, summarize } from '../progress.js';
import { barChart, ring } from '../charts.js';
import { addDays, formatShort, todayISO } from '../dates.js';
import { esc, icon } from '../ui.js';

export const title = 'Progress';

let range = '7';
try { range = sessionStorage.getItem('dailymate.progressRange') || '7'; } catch { /* default */ }

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDay = (iso) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00`));
const weekday = (iso) => new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date(`${iso}T12:00:00`));

function comparison(s) {
  if (!s.previous) return '';
  const diff = s.completedInRange - s.previous.completed;
  const span = range === 'today' ? 'yesterday' : `the previous ${s.days} days`;
  if (diff === 0) return `<span class="trend trend--flat">Same as ${span}</span>`;
  return diff > 0
    ? `<span class="trend trend--up">${icon('chevron-up')}${diff} more than ${span}</span>`
    : `<span class="trend trend--down">${icon('chevron-down')}${-diff} fewer than ${span}</span>`;
}

function statTile(label, value, sub, iconName, tone) {
  return `<div class="pstat"><span class="stat__icon stat__icon--${tone}">${icon(iconName)}</span>
    <span class="pstat__body"><span class="pstat__value">${value}</span><span class="pstat__label">${esc(label)}</span>${sub ? `<span class="pstat__sub">${sub}</span>` : ''}</span></div>`;
}

function rateCard(s) {
  if (!s.planned) {
    return `<section class="card prog-rate" aria-labelledby="rate-h">
      <h2 class="card__title" id="rate-h">Completion rate</h2>
      ${ring(0, { label: '—', sub: 'no tasks' })}
      <p class="muted">No tasks were planned ${range === 'today' ? 'for today' : 'in this range'}, so there’s no rate to show.</p>
    </section>`;
  }
  const pct = Math.round(s.rate * 100);
  return `<section class="card prog-rate" aria-labelledby="rate-h">
    <h2 class="card__title" id="rate-h">Completion rate</h2>
    ${ring(pct, { label: `${pct}%`, sub: 'done', tone: pct >= 80 ? 'green' : 'primary' })}
    <p><strong>${s.done} of ${plural(s.planned, 'planned task')}</strong> done${s.missed ? ` · ${s.missed} not done in time` : ''}${s.openToday ? ` · ${s.openToday} still open today` : ''}.</p>
  </section>`;
}

function chartCard(s, byDay) {
  const today = todayISO();
  // Today alone is one bar: show the last 7 days for context.
  const from = range === 'today' ? addDays(today, -6) : s.from;
  const pts = series(byDay, from, today).map((p) => ({
    label: p.week ? shortDay(p.key) : (s.days <= 7 || range === 'today' ? weekday(p.key) : shortDay(p.key)),
    value: p.value,
    tip: p.week ? `Week of ${shortDay(p.key)}: ${plural(p.value, 'task')} completed` : `${shortDay(p.key)}: ${plural(p.value, 'task')} completed`,
  }));
  const total = pts.reduce((n, p) => n + p.value, 0);
  const grouped = pts.some((p) => p.tip.startsWith('Week'));
  return `<section class="card" aria-labelledby="chart-h">
    <div class="card__head card__head--wrap">
      <h2 class="card__title" id="chart-h">Completed ${grouped ? 'per week' : 'per day'}</h2>
      ${range === 'today' ? '<span class="muted small">Last 7 days</span>' : ''}
    </div>
    ${total ? barChart(pts, { ariaLabel: `Tasks completed ${grouped ? 'per week' : 'per day'}`, valueLabel: 'Tasks completed', highlightLast: !grouped })
      : '<p class="muted">Nothing completed in this period yet. Tick off a task on My Day and it will show up here.</p>'}
  </section>`;
}

function goalsCard() {
  const tasks = store.getTasks(); const lists = store.getLists();
  const byDay = completionsByDay(tasks);
  const goals = store.getGoals();
  const active = goals.filter((g) => g.status === 'active');
  const done = goals.filter((g) => g.status === 'completed').length;
  let body;
  if (!goals.length) {
    body = `<p class="muted">Goals turn your tasks into something bigger, like “Finish 20 tasks this month”.</p>
      <a class="btn btn--outline btn--sm" href="#/goals">${icon('target')}Set your first goal</a>`;
  } else {
    body = `<p class="muted small">${plural(active.length, 'active goal')} · ${done} completed</p>
      <ul class="mini-goals">${active.slice(0, 4).map((g) => {
        const p = goalProgress(g, { tasks, lists, byDay });
        return `<li><a href="#/goals" class="mini-goal">
          <span class="mini-goal__top"><span>${icon(GOAL_KINDS[g.kind].icon)}${esc(g.title)}</span><strong>${p.pct}%</strong></span>
          <span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}" aria-label="${esc(g.title)}: ${esc(p.text)}"><span class="bar__fill" style="--w:${p.pct}%"></span></span>
          <span class="muted small">${esc(p.text)}</span></a></li>`;
      }).join('')}</ul>
      ${active.length ? '' : '<p class="muted">No active goals right now.</p>'}
      <a class="btn btn--ghost btn--sm" href="#/goals">All goals ${icon('arrow-right')}</a>`;
  }
  return `<section class="card" aria-labelledby="pg-h"><h2 class="card__title" id="pg-h">Goals</h2>${body}</section>`;
}

function achievementsCard() {
  const earned = store.getAchievements();
  const got = ACHIEVEMENTS.filter((a) => earned[a.id]).sort((a, b) => earned[b.id].localeCompare(earned[a.id]));
  const next = ACHIEVEMENTS.filter((a) => !earned[a.id]).slice(0, 3);
  return `<section class="card" aria-labelledby="ach-h">
    <h2 class="card__title" id="ach-h">Achievements</h2>
    ${got.length ? `<ul class="badges">${got.map((a) => `<li class="badge-tile">
      <span class="badge-tile__icon">${icon(a.icon)}</span>
      <span><strong>${esc(a.title)}</strong><span class="muted small">${esc(a.text)} · ${esc(formatShort(earned[a.id].slice(0, 10)))}</span></span></li>`).join('')}</ul>`
      : '<p class="muted">Your first achievement is one completed task away.</p>'}
    ${next.length ? `<p class="small muted">Next up</p><ul class="badges badges--locked">${next.map((a) => `<li class="badge-tile">
      <span class="badge-tile__icon">${icon('lock')}</span><span><strong>${esc(a.title)}</strong><span class="muted small">${esc(a.text)}</span></span></li>`).join('')}</ul>` : ''}
  </section>`;
}

// Rings and bars animate when the page opens, not on every background refresh.
let animate = true;
export function reset() { animate = true; }

export function render() {
  const animClass = animate ? ' is-animated' : '';
  animate = false;
  const tasks = store.getTasks();
  const header = `
    <header class="page-head">
      <div>
        <p class="eyebrow">Progress</p>
        <h1 class="page-title">Your progress</h1>
        <p class="page-subtitle">Small steps add up. Here’s what you’ve done — at your own pace.</p>
      </div>
    </header>`;

  if (!tasks.length) {
    return `<div class="page${animClass}">${header}
      <section class="card empty-hero">
        <div class="soon__icon">${icon('chart')}</div>
        <h2 class="soon__title">Your progress will appear here</h2>
        <p class="soon__text">Add a few tasks and tick them off. DailyMate will show your completion rate, streaks and milestones — calculated from your own tasks.</p>
        <a class="btn btn--primary btn--lg" href="#/my-day">${icon('plus')}Plan your day</a>
      </section></div>`;
  }

  const s = summarize(tasks, range);
  const byDay = s.byDay;
  const streakSub = s.streak
    ? (s.streakIncludesToday ? 'Including today' : 'Tick off a task today to keep it going')
    : `Best: ${plural(s.bestStreak, 'day')}`;

  return `<div class="page${animClass}">
    ${header}
    <div class="segmented segmented--range" role="group" aria-label="Time range">
      ${RANGES.map((r) => `<button type="button" class="segmented__btn" data-action="range" data-range="${r.id}" aria-pressed="${range === r.id}" data-focus-key="range-${r.id}">${r.label}</button>`).join('')}
    </div>
    <p class="muted small prog-range" role="status">${range === 'all' ? `Since ${esc(shortDay(s.from))}` : range === 'today' ? 'Today' : `${esc(shortDay(s.from))} – ${esc(shortDay(s.to))}`}</p>

    <div class="prog-top">
      ${rateCard(s)}
      <section class="pstats" aria-label="Summary">
        ${statTile('Completed', s.completedInRange, comparison(s), 'check-circle', 'green')}
        ${statTile('Planned tasks', s.planned, range === 'today' ? 'for today' : 'up to today', 'calendar', 'blue')}
        ${statTile('Current streak', plural(s.streak, 'day'), esc(streakSub), 'flag', 'amber')}
        ${statTile('Best streak', plural(s.bestStreak, 'day'), 'days in a row', 'crown', 'violet')}
      </section>
    </div>

    ${chartCard(s, byDay)}

    <div class="prog-grid">
      ${goalsCard()}
      ${achievementsCard()}
    </div>

    <details class="details card prog-how">
      <summary>How these numbers are counted</summary>
      <ul class="plain-list">
        <li><strong>Planned tasks</strong> are tasks scheduled in the range, up to today. Future tasks aren’t counted.</li>
        <li><strong>Completed</strong> counts tasks on the day you ticked them off.</li>
        <li><strong>Streak</strong>: days in a row on which you completed at least one task. A day without any completed task ends it; today counts once it’s over.</li>
        <li>Each completed repeat of a repeating task counts once. Previews of future repeats aren’t counted. Deleted tasks no longer count.</li>
      </ul>
    </details>
  </div>`;
}

export function onClick(e, ctx) {
  const btn = e.target.closest('[data-action="range"]');
  if (!btn) return;
  range = btn.dataset.range;
  try { sessionStorage.setItem('dailymate.progressRange', range); } catch { /* ignore */ }
  ctx.rerender();
}
