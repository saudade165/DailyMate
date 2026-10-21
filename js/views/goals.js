// Goals — measured from the person's own tasks and lists where possible
// (see js/progress.js), or updated by hand for custom goals.

import * as store from '../store.js';
import { GOAL_KINDS, completionsByDay, daysBetween, goalProgress } from '../progress.js';
import { ring } from '../charts.js';
import { confirmAction, openGoalDialog } from '../dialogs.js';
import { addDays, formatShort, startOfMonth, startOfWeek, todayISO } from '../dates.js';
import { esc, icon, toast } from '../ui.js';

export const title = 'Goals';

const FILTERS = [
  { id: 'active', label: 'Active' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'paused', label: 'Paused' },
  { id: 'completed', label: 'Completed' },
  { id: 'all', label: 'All' },
];
const STATE_LABEL = { active: 'Active', overdue: 'Overdue', paused: 'Paused', completed: 'Completed', 'missing-list': 'List deleted' };
const STATE_BADGE = { active: '', overdue: 'badge--red', paused: '', completed: 'badge--green', 'missing-list': 'badge--red' };

let filter = 'active';
let sort = 'deadline';

function examples() {
  const today = todayISO();
  const monthEnd = addDays(startOfMonth(addDays(startOfMonth(today), 40)), -1);
  const weekEnd = addDays(startOfWeek(today), 6);
  const list = store.getLists().find((l) => l.items.some((i) => !i.done));
  return [
    { title: 'Finish 20 tasks this month', kind: 'tasks', target: 20, startDate: today, deadline: monthEnd },
    { title: 'Get something done on 5 days this week', kind: 'active_days', target: 5, startDate: today, deadline: weekEnd },
    { title: 'Keep a 7-day streak', kind: 'streak', target: 7, period: 'day', startDate: today },
    { title: 'Clear 5 high-priority tasks', kind: 'tasks', target: 5, priority: 'high', startDate: today },
    ...(list ? [{ title: `Finish “${list.name}”`, kind: 'list', listId: list.id, startDate: today }] : []),
    { title: 'Read 12 books this year', kind: 'custom', target: 12, startDate: today, deadline: `${today.slice(0, 4)}-12-31` },
  ];
}

function deadlineText(goal, state, today) {
  if (state === 'completed') return goal.completedAt ? `Completed ${formatShort(goal.completedAt.slice(0, 10))}` : 'Completed';
  if (!goal.deadline) return `Started ${formatShort(goal.startDate)} · no deadline`;
  const left = daysBetween(today, goal.deadline);
  if (left < 0) return `Deadline was ${formatShort(goal.deadline)}`;
  if (left === 0) return 'Due today';
  return `Due ${formatShort(goal.deadline)} · ${left} day${left === 1 ? '' : 's'} left`;
}

function goalCard(goal, p, today) {
  const kind = GOAL_KINDS[goal.kind];
  const actions = [];
  if (p.state !== 'completed') {
    if (goal.kind === 'custom' && goal.status === 'active') {
      actions.push(`<button class="btn btn--outline btn--sm" type="button" data-action="step" data-step="-1" data-id="${esc(goal.id)}" ${goal.manualProgress <= 0 ? 'disabled' : ''} aria-label="Remove one step from ${esc(goal.title)}">−1</button>`);
      actions.push(`<button class="btn btn--primary btn--sm" type="button" data-action="step" data-step="1" data-id="${esc(goal.id)}" aria-label="Add one step to ${esc(goal.title)}">${icon('plus')}1</button>`);
    }
    if (goal.kind === 'custom' && goal.status === 'active') actions.push(`<button class="btn btn--ghost btn--sm" type="button" data-action="complete" data-id="${esc(goal.id)}">${icon('check')}Mark done</button>`);
    actions.push(goal.status === 'paused'
      ? `<button class="btn btn--ghost btn--sm" type="button" data-action="resume" data-id="${esc(goal.id)}">Resume</button>`
      : `<button class="btn btn--ghost btn--sm" type="button" data-action="pause" data-id="${esc(goal.id)}">Pause</button>`);
  } else {
    actions.push(`<button class="btn btn--ghost btn--sm" type="button" data-action="reopen" data-id="${esc(goal.id)}">Reopen</button>`);
  }
  actions.push(`<button class="btn btn--ghost btn--sm" type="button" data-action="edit" data-id="${esc(goal.id)}">${icon('edit')}Edit</button>`);
  actions.push(`<button class="icon-btn icon-btn--danger" type="button" data-action="delete" data-id="${esc(goal.id)}" aria-label="Delete goal ${esc(goal.title)}">${icon('trash')}</button>`);

  return `
    <article class="goal-card goal-card--${p.state}" aria-labelledby="g-${esc(goal.id)}">
      <div class="goal-card__head">
        <span class="goal-card__icon">${icon(p.state === 'completed' ? 'check-circle' : kind.icon)}</span>
        <div class="goal-card__titles">
          <h3 class="goal-card__title" id="g-${esc(goal.id)}">${esc(goal.title)}</h3>
          <p class="muted small">${esc(kind.label)}</p>
        </div>
        <span class="badge ${STATE_BADGE[p.state]}">${STATE_LABEL[p.state]}</span>
      </div>
      ${goal.notes ? `<p class="goal-card__notes">${esc(goal.notes)}</p>` : ''}
      <div class="goal-card__progress">
        ${ring(p.pct, { size: 76, stroke: 8, label: `${p.pct}%`, tone: p.state === 'completed' ? 'green' : p.state === 'overdue' ? 'red' : 'primary' })}
        <div class="goal-card__numbers">
          <strong>${esc(p.text)}</strong>
          <span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}" aria-label="${esc(goal.title)} progress"><span class="bar__fill" style="--w:${p.pct}%"></span></span>
          <span class="muted small">${esc(deadlineText(goal, p.state, today))}</span>
        </div>
      </div>
      <div class="goal-card__actions">${actions.join('')}</div>
    </article>`;
}

function computed() {
  const tasks = store.getTasks(); const lists = store.getLists();
  const byDay = completionsByDay(tasks);
  const today = todayISO();
  return { today, items: store.getGoals().map((g) => ({ goal: g, p: goalProgress(g, { tasks, lists, byDay, today }) })) };
}

// Rings and bars animate when the page opens, not on every background refresh.
let animate = true;
export function reset() { animate = true; }

export function render() {
  const animClass = animate ? ' is-animated' : '';
  animate = false;
  const { today, items } = computed();
  const counts = {
    active: items.filter((x) => x.p.state === 'active' || x.p.state === 'missing-list').length,
    overdue: items.filter((x) => x.p.state === 'overdue').length,
    paused: items.filter((x) => x.p.state === 'paused').length,
    completed: items.filter((x) => x.p.state === 'completed').length,
    all: items.length,
  };
  const open = items.filter((x) => ['active', 'overdue'].includes(x.p.state));
  const avg = open.length ? Math.round(open.reduce((n, x) => n + x.p.pct, 0) / open.length) : null;
  const upcoming = open.filter((x) => x.goal.deadline && x.goal.deadline >= today).sort((a, b) => a.goal.deadline.localeCompare(b.goal.deadline))[0];

  const header = `
    <header class="page-head">
      <div>
        <p class="eyebrow">Goals</p>
        <h1 class="page-title">Your goals</h1>
        <p class="page-subtitle">Turn everyday tasks into something bigger.</p>
      </div>
      <button class="btn btn--primary btn--lg" type="button" data-action="new" data-focus-key="new-goal">${icon('plus')}Create goal</button>
    </header>`;

  if (!items.length) {
    return `<div class="page${animClass}">${header}
      <section class="card empty-hero">
        <div class="soon__icon">${icon('target')}</div>
        <h2 class="soon__title">Set your first goal</h2>
        <p class="soon__text">Goals track themselves from the tasks you tick off. Start with one of these, or make your own.</p>
        <div class="example-goals">${examples().map((x, i) => `<button class="example-goal" type="button" data-action="example" data-index="${i}">
          ${icon(GOAL_KINDS[x.kind].icon)}<span>${esc(x.title)}</span></button>`).join('')}</div>
      </section></div>`;
  }

  let shown = filter === 'all' ? items
    : filter === 'active' ? items.filter((x) => x.p.state === 'active' || x.p.state === 'missing-list')
      : items.filter((x) => x.p.state === filter);
  shown = [...shown].sort((a, b) => {
    if (sort === 'progress') return b.p.pct - a.p.pct;
    if (sort === 'newest') return b.goal.createdAt.localeCompare(a.goal.createdAt);
    return (a.goal.deadline ?? '9999').localeCompare(b.goal.deadline ?? '9999');
  });

  return `<div class="page${animClass}">
    ${header}
    <section class="pstats pstats--goals" aria-label="Summary">
      <div class="pstat"><span class="stat__icon stat__icon--blue">${icon('target')}</span><span class="pstat__body"><span class="pstat__value">${counts.active + counts.overdue}</span><span class="pstat__label">Active goals</span></span></div>
      <div class="pstat"><span class="stat__icon stat__icon--green">${icon('check-circle')}</span><span class="pstat__body"><span class="pstat__value">${counts.completed}</span><span class="pstat__label">Completed</span></span></div>
      <div class="pstat"><span class="stat__icon stat__icon--violet">${icon('chart')}</span><span class="pstat__body"><span class="pstat__value">${avg === null ? '—' : `${avg}%`}</span><span class="pstat__label">Average progress</span><span class="pstat__sub">of active goals</span></span></div>
      <div class="pstat"><span class="stat__icon stat__icon--amber">${icon('calendar')}</span><span class="pstat__body"><span class="pstat__value pstat__value--sm">${upcoming ? esc(formatShort(upcoming.goal.deadline)) : '—'}</span><span class="pstat__label">Next deadline</span>${upcoming ? `<span class="pstat__sub">${esc(upcoming.goal.title)}</span>` : ''}</span></div>
    </section>

    <div class="goal-toolbar">
      <div class="tabs" role="group" aria-label="Show goals">
        ${FILTERS.map((f) => `<button class="tab" type="button" data-action="filter" data-filter="${f.id}" aria-pressed="${filter === f.id}" data-focus-key="gf-${f.id}">${f.label} <span class="tab__count">${counts[f.id]}</span></button>`).join('')}
      </div>
      <label class="goal-sort"><span>Sort by</span>
        <select class="input input--sm select" data-action="sort" data-focus-key="goal-sort">
          <option value="deadline" ${sort === 'deadline' ? 'selected' : ''}>Deadline</option>
          <option value="progress" ${sort === 'progress' ? 'selected' : ''}>Progress</option>
          <option value="newest" ${sort === 'newest' ? 'selected' : ''}>Newest</option>
        </select></label>
    </div>

    ${shown.length ? `<div class="goal-grid">${shown.map((x) => goalCard(x.goal, x.p, today)).join('')}</div>`
      : `<p class="muted goal-empty">No ${filter === 'all' ? '' : `${FILTERS.find((f) => f.id === filter).label.toLowerCase()} `}goals.</p>`}
  </div>`;
}

export async function onClick(e, ctx) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const goal = id ? store.getGoal(id) : null;
  try {
    switch (btn.dataset.action) {
      case 'new': openGoalDialog(); break;
      case 'example': openGoalDialog({ draft: examples()[Number(btn.dataset.index)] }); break;
      case 'filter': filter = btn.dataset.filter; ctx.rerender(); break;
      case 'edit': if (goal) openGoalDialog({ goal }); break;
      case 'pause': store.updateGoal(id, { status: 'paused' }); toast('Goal paused'); break;
      case 'resume': store.updateGoal(id, { status: 'active' }); toast('Goal resumed'); break;
      case 'reopen': store.reopenGoal(id); toast('Goal reopened'); break;
      case 'complete': {
        const ok = await confirmAction({ title: 'Mark this goal as done?', message: `“${goal.title}” will move to Completed.`, confirmLabel: 'Mark done', tone: 'primary' });
        if (ok) { store.completeGoal(id, goal.manualProgress); toast('Goal completed — well done!'); }
        break;
      }
      case 'step': {
        const next = Math.max(0, Math.min(goal.target, goal.manualProgress + Number(btn.dataset.step)));
        store.updateGoal(id, { manualProgress: next });
        break;
      }
      case 'delete': {
        const ok = await confirmAction({ title: 'Delete this goal?', message: `“${goal.title}” and its progress will be removed. Your tasks stay as they are.` });
        if (ok) {
          const removed = store.deleteGoal(id);
          toast('Goal deleted', { action: { label: 'Undo', onClick: () => store.restoreGoal(removed) } });
        }
        break;
      }
      default:
    }
  } catch (err) {
    console.error(err);
    toast('Something went wrong. Please try again.', { tone: 'error' });
  }
}

export function onChange(e, ctx) {
  if (e.target.dataset.action !== 'sort') return;
  sort = e.target.value;
  ctx.rerender();
}
