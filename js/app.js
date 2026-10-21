// App shell: routing, navigation, search, accounts and re-rendering on data changes.

import * as store from './store.js';
import * as cloud from './cloud.js';
import * as sync from './sync.js';
import * as push from './push.js';
import * as ai from './ai.js';
import { ROUTES, DEFAULT_ROUTE, findRoute } from './routes.js';
import { todayISO } from './dates.js';
import { esc, icon, toast } from './ui.js';
import { chooseAction, confirmAction } from './dialogs.js';
import * as alerts from './alerts.js';
import * as myDay from './views/myday.js';
import * as planner from './views/planner.js';
import * as assistant from './views/assistant.js';
import * as lists from './views/lists.js';
import * as reminders from './views/reminders.js';
import * as profile from './views/profile.js';
import * as account from './views/account.js';
import * as notifications from './views/notifications.js';
import * as admin from './views/admin.js';
import * as legal from './views/legal.js';
import * as soon from './views/soon.js';

const main = document.getElementById('main');
const navEl = document.getElementById('nav');
const sidebar = document.getElementById('sidebar');
const scrim = document.querySelector('.scrim');
const menuBtn = document.querySelector('[data-action="open-menu"]');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const banner = document.getElementById('storage-banner');

const VIEWS = {
  'my-day': myDay, planner, 'ai-assistant': assistant, lists, reminders, profile, account, notifications, admin,
  privacy: legal.view('privacy'), terms: legal.view('terms'), cookies: legal.view('cookies'), 'delete-account': legal.view('delete-account'),
};

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
  navEl.innerHTML = ROUTES.filter((r) => !r.hidden).map((r) => `
    <li>
      <a class="nav__link" href="#/${r.id}" ${r.id === currentRoute ? 'aria-current="page"' : ''}>
        ${icon(r.icon, 'nav__icon')}
        <span class="nav__label">${esc(r.label)}</span>
        ${r.ready ? (r.plus ? '<span class="nav__plus">Plus</span>' : '') : '<span class="nav__soon">Soon</span>'}
      </a>
    </li>`).join('');

  renderSidebarFooter();
}

function renderSidebarFooter() {
  const auth = cloud.getAuth();
  const st = sync.getStatus();
  const syncText = { syncing: 'Syncing…', synced: 'Synced', offline: 'Offline — saved on this device', error: 'Sync problem — retrying' }[st.state] ?? '';
  const accountLine = auth.status === 'signed-in'
    ? `<a class="account-line" href="#/profile">${icon(st.state === 'error' || st.state === 'offline' ? 'alert' : 'check-circle')}<span><strong>${esc(auth.user.email)}</strong><small>${esc(syncText)}</small></span></a>`
    : auth.status === 'loading' ? ''
      : `<a class="account-line" href="#/account">${icon('user')}<span><strong>Sign in</strong><small>Sync across your devices</small></span></a>`;
  document.getElementById('sidebar-plus').innerHTML = `
    ${accountLine}
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
  const previous = currentRoute;
  ({ id: currentRoute, params: currentParams } = parseHash());
  if (previous !== currentRoute) VIEWS[previous]?.reset?.();
  fixUnknownHash();
  setMenuOpen(false);
  renderNav();
  renderView();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

/** An unknown address (e.g. an old bookmark) shows My Day — make the address bar say so too. */
function fixUnknownHash() {
  if (location.hash.includes('error_description=')) return; // a sign-in link's error: cloud.js reads it first
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

const viewCtx = { rerender: renderView, clearSearch, replacePath, params: () => currentParams, signOut };

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

// ---- Accounts and sync ------------------------------------------------------------

function downloadBackup(kind) {
  const data = JSON.stringify(store.exportData(), null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `dailymate-${kind}-${todayISO()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function chooseLocalData(counts) {
  const parts = [];
  if (counts.tasks) parts.push(`${counts.tasks} task${counts.tasks === 1 ? '' : 's'}`);
  if (counts.lists) parts.push(`${counts.lists} list${counts.lists === 1 ? '' : 's'}`);
  if (counts.reminders) parts.push(`${counts.reminders} reminder${counts.reminders === 1 ? '' : 's'}`);
  return chooseAction({
    title: 'Add this device’s data to your account?',
    message: `This browser has ${parts.join(', ') || 'some data'} saved from before you signed in. Add them to your account so they sync, or keep them out (we’ll download a copy for you first).`,
    options: [
      { value: 'merge', label: 'Add to my account', tone: 'primary' },
      { value: 'separate', label: 'Keep out — download a copy' },
    ],
  });
}

let attachedUser = null;
async function onAuth(auth) {
  if (auth.status === 'signed-in' && attachedUser !== auth.user.id) {
    attachedUser = auth.user.id;
    ai.setAccessTokenProvider(() => cloud.accessToken());
    try {
      await sync.attach(auth.user, { chooseLocalData, downloadBackup });
    } catch { /* sync shows its own status */ }
    push.refresh();
  } else if (auth.status === 'signed-out' && attachedUser) {
    attachedUser = null;
    ai.setAccessTokenProvider(null);
  }
  renderSidebarFooter();
  renderAll();
}

async function signOut() {
  const pending = await sync.flush();
  const ok = await confirmAction({
    title: 'Sign out?',
    message: pending
      ? `${pending} change${pending === 1 ? ' hasn’t' : 's haven’t'} been uploaded yet (you seem to be offline). If you sign out now, ${pending === 1 ? 'it' : 'they'} will be lost.`
      : 'Your data stays safe in your account. It will be removed from this browser, and reminder notifications stop on this device.',
    confirmLabel: 'Sign out',
    tone: pending ? 'danger' : 'primary',
  });
  if (!ok) return;
  await push.disable().catch(() => {});
  try { await cloud.signOut(); } catch { /* signed out locally anyway */ }
  sync.detach();
  try { sessionStorage.removeItem('dailymate.ai.chat'); } catch { /* ignore */ }
  location.hash = '#/my-day';
  toast('You’re signed out');
}

const LINK_MESSAGES = {
  'signed-in': ['info', 'Your email is confirmed and you’re signed in.'],
  'confirmed-elsewhere': ['info', 'Your email is confirmed. Please sign in.'],
  recovery: ['info', 'Choose a new password.'],
  offline: ['error', 'Couldn’t reach the server. Your data on this device is still here.'],
};

async function startAccounts() {
  sync.init();
  sync.onStatus(() => {
    renderSidebarFooter();
    if (currentRoute === 'profile') {
      const line = document.getElementById('sync-status');
      if (line) renderView();
    }
  });
  cloud.onAuthChange(onAuth);
  const result = await cloud.start();
  if (!result) return;
  if (result.kind === 'recovery') {
    location.hash = '#/account/new-password';
  } else if (result.kind === 'link-error') {
    account.setNotice({ tone: 'error', text: `That link didn’t work (${result.message}). Links expire after a while — you can ask for a new one.` });
    location.hash = '#/account';
  } else if (LINK_MESSAGES[result.kind]) {
    const [tone, text] = LINK_MESSAGES[result.kind];
    if (result.kind === 'confirmed-elsewhere') { account.setNotice({ tone, text }); location.hash = '#/account'; } else toast(text, { tone: tone === 'error' ? 'error' : 'default' });
  }
}

// ---- Start ----------------------------------------------------------------------

store.init();
store.subscribe(renderAll);
({ id: currentRoute, params: currentParams } = parseHash());
fixUnknownHash();
renderNav();
renderAll();
alerts.start({ onTick: () => { if (currentRoute === 'reminders') renderView(); } });
startAccounts();

// Offline copy of the app and push notifications. Registered after the first render.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
