// App shell: routing, navigation, search and re-rendering on data changes.

import * as store from './store.js';
import { ROUTES, DEFAULT_ROUTE, findRoute } from './routes.js';
import { todayISO } from './dates.js';
import { esc, icon } from './ui.js';
import * as myDay from './views/myday.js';
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

const VIEWS = { 'my-day': myDay, profile };

let currentRoute = DEFAULT_ROUTE;
let knownToday = todayISO();

function routeFromHash() {
  const id = location.hash.replace(/^#\/?/, '');
  return findRoute(id) ? id : DEFAULT_ROUTE;
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
        ${r.ready ? '' : '<span class="nav__soon">Soon</span>'}
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
  unavailable: 'Your browser is blocking storage, so tasks will be lost when you close this page. Try turning off private browsing.',
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
  const focusKey = main.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  const scrollY = window.scrollY;

  const view = currentView();
  const route = findRoute(currentRoute);
  main.innerHTML = view ? view.render() : soon.render(route);
  document.title = `${route.label} · DailyMate`;

  if (focusKey) {
    main.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    window.scrollTo(0, scrollY);
  }
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
  currentRoute = routeFromHash();
  setMenuOpen(false);
  renderNav();
  renderView();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

function clearSearch() {
  searchInput.value = '';
  myDay.setQuery('');
  renderView();
  searchInput.focus();
}

// ---- Events ---------------------------------------------------------------------

const viewCtx = { rerender: renderView, clearSearch };

main.addEventListener('click', (e) => currentView()?.onClick?.(e, viewCtx));
main.addEventListener('change', (e) => currentView()?.onChange?.(e, viewCtx));
main.addEventListener('submit', (e) => currentView()?.onSubmit?.(e, viewCtx));

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
currentRoute = routeFromHash();
renderNav();
renderAll();
