import { api, currentProfile, restoreProfile, setProfile, state } from './api.js';
import { $, avatar, firstName, html, icon, toast } from './ui.js';
import * as assistant from './assistant.js';
import { renderAuth } from './pages/auth.js';
import dashboard from './pages/dashboard.js';
import reports, { reportDetail, reportNew } from './pages/reports.js';
import vitals from './pages/vitals.js';
import reminders from './pages/reminders.js';
import family from './pages/family.js';
import notifications from './pages/notifications.js';
import settings from './pages/settings.js';

const ROUTES = [
  ['/dashboard', dashboard],
  ['/reports/new', reportNew],
  ['/reports/:id', reportDetail],
  ['/reports', reports],
  ['/vitals', vitals],
  ['/reminders', reminders],
  ['/family', family],
  ['/notifications', notifications],
  ['/settings', settings],
];

const NAV = [
  ['/dashboard', 'home', 'Home'],
  ['/reports', 'report', 'Reports'],
  ['/vitals', 'activity', 'Vitals'],
  ['/reminders', 'alarm', 'Reminders'],
  ['/family', 'users', 'Family'],
  ['/notifications', 'bell', 'Notifications'],
  ['/settings', 'settings', 'Settings'],
];
const BOTTOM_NAV = ['/dashboard', '/reports', '/vitals', '/reminders', '/family'];

let current = { page: null, cleanup: null, path: '' };
let previousPath = '';
let events = null;

// Theme
function applyTheme() {
  let theme = 'system';
  try { theme = localStorage.getItem('mz.theme') || 'system'; } catch { /* storage unavailable */ }
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}
export function setTheme(theme) {
  try { localStorage.setItem('mz.theme', theme); } catch { /* storage unavailable */ }
  applyTheme();
}

// Routing
function parseHash() {
  const [path, query = ''] = (location.hash.slice(1) || '/dashboard').split('?');
  return { path: path || '/dashboard', query: Object.fromEntries(new URLSearchParams(query)) };
}

function match(path) {
  for (const [pattern, page] of ROUTES) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    const m = re.exec(path);
    if (m) return { page, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export function navigate(path) {
  if (location.hash === `#${path}`) route();
  else location.hash = path;
}

async function route() {
  if (!state.user) return;
  const { path, query } = parseHash();
  if (query.profile) {
    setProfile(query.profile);
    delete query.profile;
    const rest = new URLSearchParams(query).toString();
    history.replaceState(null, '', `#${path}${rest ? `?${rest}` : ''}`);
    renderShellChrome();
  }
  const found = match(path) || match('/dashboard');
  current.cleanup?.();
  current = { page: found.page, cleanup: null, path, params: found.params, query };

  document.title = `${found.page.title} · Medizen`;
  for (const a of document.querySelectorAll('[data-nav]')) {
    a.classList.toggle('active', path === a.dataset.nav || path.startsWith(`${a.dataset.nav}/`));
  }
  renderBanner();
  // Fresh element per render so page-level event listeners never accumulate.
  const old = $('#page');
  const container = old.cloneNode(false);
  old.replaceWith(container);
  if (current.path !== previousPath) window.scrollTo(0, 0);
  previousPath = current.path;
  try {
    current.cleanup = (await found.page.render(container, found.params, query)) || null;
  } catch (err) {
    if (err.status === 401) return;
    container.innerHTML = html`<div class="card card-pad empty"><div class="ic">${icon('alert')}</div><h3>Couldn't load this page</h3><p>${err.message}</p></div>`;
  }
}

/** Re-render the current page (e.g. after data changes or a profile switch). */
export function refresh() {
  return route();
}

// Shell
function renderShell() {
  $('#app').innerHTML = html`
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="#/dashboard"><span class="brand-mark"></span><span class="wordmark">Medizen</span></a>
        ${NAV.map(([path, ic, label]) => html`
          <a class="nav-item" href="#${path}" data-nav="${path}">${icon(ic)}<span>${label}</span>
            ${path === '/notifications' ? html`<span class="count" data-unread hidden></span>` : ''}</a>`)}
        <div class="spacer"></div>
        <button class="ask-zen" data-open-assistant>
          <span class="zen-avatar" aria-hidden="true"></span>
          <span><b>Ask <span data-assistant-name>${state.user.assistant_name}</span></b><small>Log a reading, set a reminder, or ask about a result</small></span>
        </button>
      </aside>
      <div class="main">
        <header class="topbar">
          <a class="mobile-brand brand" href="#/dashboard" aria-label="Medizen home"><span class="brand-mark"></span><span class="wordmark">Medizen</span></a>
          <div class="profile-switch" data-profile-switch></div>
          <div class="grow"></div>
          <a class="icon-btn" href="#/notifications" aria-label="Notifications">${icon('bell')}<span class="dot" data-unread hidden></span></a>
          <div class="menu" data-user-menu>
            <button class="icon-btn" aria-label="Account menu" data-menu-btn>${avatar(state.user.name, state.user.id)}</button>
            <div class="menu-pop">
              <div class="who"><b>${state.user.name}</b><div class="muted small">${state.user.email}</div></div>
              <a href="#/settings">${icon('user')} Profile & settings</a>
              <a href="#/family">${icon('users')} Family sharing</a>
              <button data-logout>${icon('logout')} Sign out</button>
            </div>
          </div>
        </header>
        <main class="content">
          <div data-banner></div>
          <div id="page"></div>
        </main>
      </div>
    </div>
    <nav class="bottom-nav">
      ${BOTTOM_NAV.map((path) => {
        const [, ic, label] = NAV.find((n) => n[0] === path);
        return html`<a href="#${path}" data-nav="${path}">${icon(ic)}<span>${label}</span></a>`;
      })}
    </nav>`;

  const menu = $('[data-user-menu]');
  $('[data-menu-btn]').onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open'); };
  document.addEventListener('click', () => menu.classList.remove('open'));
  $('[data-logout]').onclick = signOut;
  $('[data-open-assistant]').onclick = () => assistant.open();
  renderShellChrome();
  updateUnread(state.unread);
}

/** Parts of the shell that depend on the selected profile. */
function renderShellChrome() {
  const holder = $('[data-profile-switch]');
  if (!holder) return;
  const cur = currentProfile();
  if (state.profiles.length < 2) { holder.innerHTML = ''; return; }
  holder.innerHTML = html`
    <span class="label">Viewing</span>
    <select aria-label="Whose health records to view">
      ${state.profiles.map((pr) => html`<option value="${pr.access === 'owner' ? 'me' : pr.id}" ${pr.id === cur.id ? 'selected' : ''}>
        ${pr.access === 'owner' ? `My records (${firstName(pr.name)})` : pr.name}</option>`)}
    </select>
    <span class="chev">${icon('chevronDown')}</span>`;
  holder.querySelector('select').onchange = (e) => {
    setProfile(e.target.value);
    renderShellChrome();
    route();
  };
}

function renderBanner() {
  const el = $('[data-banner]');
  const cur = currentProfile();
  if (!el) return;
  el.innerHTML = cur.access === 'owner' ? '' : html`
    <div class="banner">
      <span>You're looking at <b>${cur.name}</b>'s records. ${cur.access === 'manage' ? 'You can add and update things for them.' : 'View only.'}</span>
      <button class="btn sm" data-back-me>Back to mine</button>
    </div>`;
  el.querySelector('[data-back-me]')?.addEventListener('click', () => { setProfile('me'); renderShellChrome(); route(); });
}

export function updateUnread(n) {
  state.unread = Math.max(0, n);
  for (const el of document.querySelectorAll('[data-unread]')) {
    el.hidden = !state.unread;
    el.textContent = state.unread > 99 ? '99+' : state.unread;
  }
}

/** Refresh /me (profiles, settings) after sharing changes or settings saves. */
export async function reloadMe() {
  const me = await api('/api/auth/me');
  state.user = me.user;
  state.profiles = me.profiles;
  state.aiEnabled = me.aiEnabled;
  setProfile(state.profileId);
  renderShellChrome();
  const nameEl = $('[data-assistant-name]');
  if (nameEl) nameEl.textContent = state.user.assistant_name;
  assistant.updateIdentity();
}

// Live events
function speakIfEnabled(text) {
  if (state.user?.voice_enabled) assistant.speak(text);
}

function systemNotify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  try { new Notification(title, { body, icon: '/img/icon-192.png', tag: `mz-${title}` }); } catch { /* not supported in this context */ }
}

function connectEvents() {
  events?.close();
  events = new EventSource('/api/events');
  events.addEventListener('notification', (e) => {
    const n = JSON.parse(e.data);
    updateUnread(state.unread + 1);
    systemNotify(n.title, n.body || '');
    if (n.type === 'reminder') return; // the reminder-due event shows a richer toast
    toast({
      title: n.title, body: n.body, type: n.type, timeout: n.type === 'urgent' ? 0 : 8000,
      actions: n.link ? [{ label: 'View', primary: true, onClick: () => { location.hash = n.link.slice(1); } }] : [],
    });
    if (n.type === 'urgent' || n.type === 'assistant') speakIfEnabled(n.title);
    if (current.path === '/notifications') refresh();
  });
  events.addEventListener('reminder-due', (e) => {
    const r = JSON.parse(e.data);
    speakIfEnabled(r.speech);
    toast({
      title: r.speech, type: 'reminder', timeout: 0,
      body: `From ${r.from}, your health assistant`,
      actions: [
        { label: 'Done', primary: true, onClick: () => api(`/api/p/me/reminders/${r.id}/done`, { method: 'POST' }).then(() => toast({ title: 'Ticked off', type: 'success', timeout: 2500 })) },
        { label: 'Snooze 10 min', onClick: () => api(`/api/p/me/reminders/${r.id}/snooze`, { method: 'POST', body: { minutes: 10 } }) },
      ],
    });
  });
  events.addEventListener('data-changed', (e) => {
    const { profileId, kind } = JSON.parse(e.data);
    if (currentProfile()?.id !== profileId) return;
    if (current.page?.refreshOn?.includes(kind)) refresh();
  });
}

// Session
async function startApp() {
  const [me, meta, notes] = await Promise.all([api('/api/auth/me'), api('/api/meta'), api('/api/notifications?limit=1')]);
  state.user = me.user;
  state.profiles = me.profiles;
  state.aiEnabled = me.aiEnabled;
  state.meta = meta;
  state.unread = notes.unread;
  restoreProfile();
  renderShell();
  assistant.mount();
  connectEvents();
  if (!location.hash || location.hash === '#/' || location.hash.startsWith('#/login') || location.hash.startsWith('#/signup')) {
    history.replaceState(null, '', '#/dashboard');
  }
  route();
}

async function signOut() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  showSignedOut();
}

function showSignedOut() {
  events?.close();
  events = null;
  assistant.unmount();
  state.user = null;
  renderAuth($('#app'), { onSignedIn: startApp });
}

window.addEventListener('hashchange', () => (state.user ? route() : renderAuth($('#app'), { onSignedIn: startApp })));
window.addEventListener('mz:signed-out', () => state.user && showSignedOut());

applyTheme();
api('/api/auth/session')
  .then(({ signedIn }) => (signedIn ? startApp() : showSignedOut()))
  .catch(() => showSignedOut());
