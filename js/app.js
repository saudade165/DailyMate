// App shell: routing, navigation, search and re-rendering on data changes.

import * as store from './store.js';
import { ROUTES, DEFAULT_ROUTE, findRoute } from './routes.js';
import { todayISO } from './dates.js';
import { esc, icon } from './ui.js';
import * as alerts from './alerts.js';
import * as myDay from './views/myday.js';
import * as planner from './views/planner.js';
import * as assistant from './views/assistant.js';
import * as lists from './views/lists.js';
import * as reminders from './views/reminders.js';
import * as profile from './views/profile.js';
import * as soon from './views/soon.js';

const main = document.getElementById('main');
const navEl = document.getElementById('nav');
const sidebar = document.getElementById('sidebar');
const scrim = document.querySelector('.scrim');
const menuBtn = document.querySelector('[data-action="open-menu"]');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const banner = document.getElementById('storage-banner');

const VIEWS = { 'my-day': myDay, planner, 'ai-assistant': assistant, lists, reminders, profile };

let currentRoute = DEFAULT_ROUTE;
let currentParams = [];
let knownToday = todayISO();

/** "#/planner/week/2026-10-20" -> { id: 'planner', params: ['week', '2026-10-20'] } */
function parseHash() {
  const [id, ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return findRoute(id) ? { id, params: params.filter(Boolean) } : { id: DEFAULT_ROUTE, params: [] };
}

function currentView() {
  return VIEWS[currentRoute] ?? null;
}

// ---- Rendering ------------------------------------------------------------------

function renderNav() {
  navEl.innerHTML = ROUTES.map((r) => `
    <li>
      <a class="nav__link" href="#/${r.id}" ${r.id === currentRoute ? 'aria-current="page"' : ''}>
        ${icon(r.icon, 'nav__icon')}
        <span class="nav__label">${esc(r.label)}</span>
        ${r.ready ? (r.plus ? '<span class="nav__plus">Plus</span>' : '') : '<span class="nav__soon">Soon</span>'}
      </a>
    </li>`).join('');

  document.getElementById('sidebar-plus').innerHTML = `
    <a class="plan-pill" href="#/profile">
      ${icon('crown', 'plan-pill__icon')}
      <span><strong>Free plan</strong><small>See DailyMate Plus</small></span>
      ${icon('chevron-right')}
    </a>`;
}

function renderProfileChip() {
  const { name } = store.getProfile();
  const avatar = document.getElementById('profile-initial');
  if (name) avatar.textContent = name[0].toUpperCase();
  else avatar.innerHTML = icon('user');
  document.getElementById('profile-name').textContent = name || 'Profile';
}

const BANNER_TEXT = {
  unavailable: 'Your browser is blocking storage, so your data will be lost when you close this page. Try turning off private browsing.',
  quota: 'Your browser’s storage is full, so the latest change could not be saved.',
  corrupt: 'Some saved data could not be read, so DailyMate started fresh. A copy of the old data was kept in this browser.',
};

function renderBanner() {
  const err = store.getPersistError();
  banner.hidden = !err;
  if (!err) return;
  banner.innerHTML = `${icon('alert')}<span>${BANNER_TEXT[err]}</span>${err === 'corrupt'
    ? '<button class="btn btn--sm btn--outline" type="button" data-action="dismiss-banner">OK</button>' : ''}`;
}

function renderView() {
  // Keep keyboard focus on the "same" control across re-renders.
  const active = document.activeElement;
  const focusKey = main.contains(active) ? active.dataset.focusKey : null;
  const isText = focusKey && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && /^(text|search|)$/.test(active.type)));
  const selection = isText && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const typed = isText ? active.value : null;
  const scrollY = window.scrollY;

  const view = currentView();
  const route = findRoute(currentRoute);
  main.innerHTML = view ? view.render(currentParams) : soon.render(route);
  document.title = `${view?.pageTitle?.(currentParams) ?? route.label} · DailyMate`;

  if (focusKey) {
    const el = main.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    el?.focus({ preventScroll: true });
    // Don't lose what the person was typing when something else changes.
    if (el && typed !== null && 'value' in el) el.value = typed;
    if (el && selection && typeof el.setSelectionRange === 'function') {
      try { el.setSelectionRange(...selection); } catch { /* not a text field */ }
    }
    window.scrollTo(0, scrollY);
  }
  view?.afterRender?.(currentParams, viewCtx);
}

function renderAll() {
  renderProfileChip();
  renderBanner();
  renderView();
}

// ---- Navigation -----------------------------------------------------------------

function setMenuOpen(open) {
  sidebar.classList.toggle('is-open', open);
  scrim.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('menu-open', open);
  if (open) sidebar.querySelector('.nav__link[aria-current]')?.focus();
}

function onRouteChange() {
  ({ id: currentRoute, params: currentParams } = parseHash());
  fixUnknownHash();
  setMenuOpen(false);
  renderNav();
  renderView();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

/** An unknown address (e.g. an old bookmark) shows My Day — make the address bar say so too. */
function fixUnknownHash() {
  const id = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (id && !findRoute(decodeURIComponent(id))) history.replaceState(null, '', `#/${DEFAULT_ROUTE}`);
}

/** Updates the address within the current section without a full page change (keeps scroll and focus). */
function replacePath(params) {
  currentParams = params;
  const hash = `#/${[currentRoute, ...params].map(encodeURIComponent).join('/')}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
  renderView();
}

function clearSearch() {
  searchInput.value = '';
  myDay.setQuery('');
  renderView();
  searchInput.focus();
}

// ---- Events ---------------------------------------------------------------------

const viewCtx = { rerender: renderView, clearSearch, replacePath, params: () => currentParams };

main.addEventListener('click', (e) => currentView()?.onClick?.(e, viewCtx));
main.addEventListener('change', (e) => currentView()?.onChange?.(e, viewCtx));
main.addEventListener('submit', (e) => currentView()?.onSubmit?.(e, viewCtx));
main.addEventListener('input', (e) => currentView()?.onInput?.(e, viewCtx));
main.addEventListener('keydown', (e) => currentView()?.onKeydown?.(e, viewCtx));
['dragstart', 'dragover', 'dragleave', 'drop', 'dragend'].forEach((type) => {
  main.addEventListener(type, (e) => currentView()?.onDrag?.(e, viewCtx));
});

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'open-menu') setMenuOpen(true);
  if (action === 'close-menu') setMenuOpen(false);
  if (action === 'dismiss-banner') store.dismissCorruptWarning();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sidebar.classList.contains('is-open')) {
    setMenuOpen(false);
    menuBtn.focus();
  }
});

searchInput.addEventListener('input', () => {
  myDay.setQuery(searchInput.value);
  if (currentRoute !== 'my-day') location.hash = '#/my-day';
  else renderView();
});
searchForm.addEventListener('submit', (e) => e.preventDefault());

window.addEventListener('hashchange', onRouteChange);

// Roll over to the new day if the app stays open past midnight.
setInterval(() => {
  const now = todayISO();
  if (now === knownToday) return;
  myDay.onDayChanged(knownToday);
  knownToday = now;
  renderView();
}, 60_000);

// ---- Start ----------------------------------------------------------------------

store.init();
store.subscribe(renderAll);
({ id: currentRoute, params: currentParams } = parseHash());
fixUnknownHash();
renderNav();
renderAll();
alerts.start({ onTick: () => { if (currentRoute === 'reminders') renderView(); } });
