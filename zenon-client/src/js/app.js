// ===== Global App State =====
const State = {
  currentPage: 'home',
  selectedInstance: null,
  instances: [],
  settings: {},
  mcVersions: [],
  isLaunching: false,
  runningInstanceId: null,
  auth: { loggedIn: false, profile: null },
  /** Instance library sub-tab: content | files | worlds | logs */
  libraryPane: 'content',
  /** Launch console mirror (also shown in Library > Logs). */
  launchConsole: {
    status: 'Idle',
    running: false,
    lines: [],
    filter: { query: '', errorsOnly: false },
    autoScroll: true,
    stopRequestedAt: 0
  }
};

// ===== Toast Notifications =====
function createToastContainer() {
  const el = document.createElement('div');
  el.className = 'toast-container';
  el.id = 'toast-container';
  document.body.appendChild(el);
}

function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// ===== Navigation =====
let __navSeq = 0;
async function navigateTo(page, opts = {}) {
  if (!State.auth?.loggedIn) {
    showAuthOverlay();
    showToast('Please sign in with Microsoft first', 'error', 2000);
    hideSplash();
    return;
  }
  if (State.currentPage === page && !opts.force) return;
  const seq = ++__navSeq;
  const leavingHostServer = State.currentPage === 'host-server' && page !== 'host-server';
  State.currentPage = page;
  if (leavingHostServer && typeof window.__abandonHostServerConsole === 'function') {
    window.__abandonHostServerConsole();
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  await renderPage(page);
  if (seq !== __navSeq) return;
}

async function renderPage(page) {
  const content = document.getElementById('main-content');
  content.innerHTML = '<div class="page"><div class="loading-spinner"></div></div>';

  switch (page) {
    case 'home': await renderHome(); break;
    case 'instances': await renderInstances(); break;
    case 'library': await renderLibrary(); break;
    case 'discovery': await renderDiscovery(); break;
    case 'host-server': await renderHostServer(); break;
    case 'tools': await renderTools(); break;
    case 'settings': await renderSettings(); break;
  }
}

// ===== Sidebar Instance Badge =====
function updateSidebarBadge() {
  const badge = document.getElementById('sidebar-instance-badge');
  const nameEl = document.getElementById('sidebar-instance-name');
  const dot = badge.querySelector('.badge-dot');

  if (State.selectedInstance) {
    nameEl.textContent = State.selectedInstance.name;
    dot.classList.add('active');
  } else {
    nameEl.textContent = 'No Instance';
    dot.classList.remove('active');
  }
}

// ===== Modal System =====
function openModal(id) {
  const next = document.getElementById(id);
  if (!next) return;
  document.querySelectorAll('.modal.show').forEach((m) => {
    if (m.id && m.id !== id) m.classList.remove('show');
  });
  document.getElementById('modal-overlay').classList.add('show');
  next.classList.add('show');
}

function closeModal(id) {
  document.getElementById('modal-overlay').classList.remove('show');
  document.getElementById(id).classList.remove('show');
}

function closeAllModals() {
  const browseModal = document.getElementById('modal-library-browse');
  if (browseModal?.classList.contains('show') && typeof window.__onLibraryBrowseModalClose === 'function') {
    window.__onLibraryBrowseModalClose();
  }
  document.getElementById('modal-overlay').classList.remove('show');
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
}

// ===== Console Panel =====
function openConsole() {
  document.getElementById('console-panel').classList.add('open');
}

function closeConsole() {
  document.getElementById('console-panel').classList.remove('open');
}

function renderLaunchConsoleMirrors() {
  // Mirror into Library > Logs tab (if visible)
  const out = document.getElementById('library-launch-output');
  const st = document.getElementById('library-launch-status');
  const q = document.getElementById('library-launch-search');
  const errOnly = document.getElementById('library-launch-errors-only');
  const auto = document.getElementById('library-launch-autoscroll');

  if (q && q.value !== (State.launchConsole.filter.query || '')) q.value = State.launchConsole.filter.query || '';
  if (errOnly) errOnly.classList.toggle('on', !!State.launchConsole.filter.errorsOnly);
  if (auto) auto.classList.toggle('on', State.launchConsole.autoScroll !== false);
  if (st) {
    st.textContent = State.launchConsole.status || 'Idle';
    st.className = `console-status ${State.launchConsole.running ? 'running' : ''}`;
  }
  if (out) {
    out.innerHTML = '';
    const frag = document.createDocumentFragment();
    const query = (State.launchConsole.filter.query || '').trim().toLowerCase();
    const errorsOnly = !!State.launchConsole.filter.errorsOnly;
    const rows = State.launchConsole.lines.filter((ln) => {
      if (errorsOnly && ln.type !== 'error') return false;
      if (!query) return true;
      return String(ln.text || '').toLowerCase().includes(query);
    });
    for (const ln of rows) {
      const div = document.createElement('div');
      div.className = `console-line ${ln.type || 'default'}`;
      div.textContent = ln.text || '';
      frag.appendChild(div);
    }
    out.appendChild(frag);
    if (State.launchConsole.autoScroll !== false) out.scrollTop = out.scrollHeight;
  }
}

// Allow other pages to trigger a mirror refresh (e.g., after Logs tab renders).
window.renderLaunchConsoleMirrors = renderLaunchConsoleMirrors;

function logToConsole(message, type = 'default') {
  const output = document.getElementById('console-output');
  const line = document.createElement('div');
  line.className = `console-line ${type}`;
  const time = new Date().toLocaleTimeString();
  const text = `[${time}] ${message}`;
  line.textContent = text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;

  // Mirror into state so Library Logs can render it.
  const arr = State.launchConsole?.lines || (State.launchConsole = { status: 'Idle', running: false, lines: [] }).lines;
  arr.push({ text, type });
  if (arr.length > 1200) arr.splice(0, arr.length - 1200);
  renderLaunchConsoleMirrors();
}

function clearConsole() {
  document.getElementById('console-output').innerHTML = '';
  if (State.launchConsole) State.launchConsole.lines = [];
  renderLaunchConsoleMirrors();
}

function setConsoleStatus(status, running = false) {
  const el = document.getElementById('console-status');
  el.textContent = status;
  el.className = `console-status ${running ? 'running' : ''}`;
  State.launchConsole.status = status;
  State.launchConsole.running = !!running;
  renderLaunchConsoleMirrors();
}

// ===== Format helpers =====
function formatDate(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatDownloads(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return n;
}

function instanceIconSrc(instance) {
  if (!instance || !instance.icon || typeof instance.icon !== 'string') return '';
  const s = instance.icon;
  if (!s.startsWith('img:')) return '';
  const rel = s.slice(4);
  const root = (instance.dir || '').replace(/\\/g, '/');
  if (!root || !rel) return '';
  const pathRel = rel.startsWith('/') ? rel.slice(1) : rel;
  return `file:///${encodeURI(`${root}/${pathRel}`)}`;
}

function getInstanceIcon(instance) {
  if (!instance) return '?';
  const src = instanceIconSrc(instance);
  if (src) return `<img class="instance-icon-img" src="${escapeHtml(src)}" alt="" draggable="false" />`;
  const ic = instance.icon;
  if (ic && ic !== 'default' && typeof ic === 'string') return escapeHtml(ic.charAt(0).toUpperCase());
  return escapeHtml((instance.name || '?').charAt(0).toUpperCase());
}

const THEME_IDS = ['zenon', 'midnight', 'aurora', 'slate', 'paper'];

function normalizeThemeId(raw) {
  if (!raw || raw === 'dark') return 'zenon';
  if (raw === 'light') return 'paper';
  return THEME_IDS.includes(raw) ? raw : 'zenon';
}

function applyTheme(raw) {
  const id = normalizeThemeId(raw);
  document.documentElement.setAttribute('data-theme', id);
}

function applyReduceMotion(on) {
  document.documentElement.setAttribute('data-reduce-motion', on ? 'true' : 'false');
}

const __splashStartedAt = Date.now();
const SPLASH_MIN_MS = 3_000;
const SPLASH_MAX_MS = 10_000;
const __splashTargetMs =
  SPLASH_MIN_MS + Math.floor(Math.random() * (SPLASH_MAX_MS - SPLASH_MIN_MS + 1));

function hideSplash() {
  const el = document.getElementById('splash-screen');
  if (!el) return;
  if (el.classList.contains('splash-hide')) return;
  const elapsed = Date.now() - __splashStartedAt;
  const wait = Math.max(0, __splashTargetMs - elapsed);
  setTimeout(() => {
    try {
      el.classList.add('splash-hide');
    } catch (e0) {}
    setTimeout(() => {
      try {
        el.remove();
      } catch (e) {}
    }, 520);
  }, wait);
}

/** After Microsoft sign-in (or on cold start when already logged in), load shell data and render the main UI. */
async function bootstrapMainUIAfterLogin() {
  State.settings = await window.zenon.getSettings();
  applyTheme(State.settings.theme);
  applyReduceMotion(!!State.settings.reduceMotion);
  window.__zenonSoundsEnabled = !!State.settings.soundsEnabled;
  window.__zenonRecentActionsEnabled = !!State.settings.recentActionsEnabled;

  State.instances = await window.zenon.getInstances();
  if (State.instances.length > 0) {
    if (!State.selectedInstance) State.selectedInstance = State.instances[0];
    else if (typeof window.syncSelectedInstanceWithList === 'function') window.syncSelectedInstanceWithList();
  }
  updateSidebarBadge();
  await renderPage(State.currentPage || 'home');
  hideSplash();

  // Show "What's New" after updates (once per version).
  try {
    if (typeof window.maybeShowWhatsNew === 'function') await window.maybeShowWhatsNew();
  } catch (e) {}
}

// ===== What's New =====
const WHATS_NEW_NOTES = {
  '1.0.4': [
    'Added a hardware acceleration toggle in Settings → Launcher (restart required).',
    'Improved text/layout behavior when resizing the window.',
    'Added a “What’s new” popup after updates (toggleable in Settings → Launcher).'
  ],
  '1.0.5': [
    'Added CurseForge provider in Browse & install (private test build).',
    'Added multi-account switching and per-instance tools (screenshots, crashes, conflicts).'
  ]
};

function buildWhatsNewNotesForVersion(version) {
  const v = String(version || '').trim();
  if (v && Array.isArray(WHATS_NEW_NOTES[v]) && WHATS_NEW_NOTES[v].length) return WHATS_NEW_NOTES[v];
  return [
    'Bug fixes and UI improvements.',
    'Performance and stability tweaks.'
  ];
}

async function maybeShowWhatsNew() {
  const settings = State.settings || (State.settings = await window.zenon.getSettings());
  if (settings?.whatsNewEnabled === false) return;

  let appMeta = { version: '', name: 'Zenon Client' };
  try {
    appMeta = (await window.zenon.getAppVersion()) || appMeta;
  } catch (e) {}

  const currentVersion = String(appMeta?.version || '').trim();
  if (!currentVersion) return;

  const lastSeen = String(settings?.lastSeenVersion || '').trim();
  if (lastSeen === currentVersion) return;

  const title = document.getElementById('whats-new-title');
  const sub = document.getElementById('whats-new-sub');
  const list = document.getElementById('whats-new-list');
  const foot = document.getElementById('whats-new-foot');
  if (!list) return;

  if (title) title.textContent = 'What’s New';
  if (sub) sub.textContent = `Updated to v${currentVersion}`;
  if (foot) foot.textContent = 'Tip: You can disable this popup in Settings → Launcher.';

  const notes = buildWhatsNewNotesForVersion(currentVersion);
  list.innerHTML = notes.map((n) => `<li>${escapeHtml(String(n || '').trim())}</li>`).join('');

  // Defer persisting "seen" until the user closes the modal.
  window.__pendingWhatsNewVersion = currentVersion;
  openModal('modal-whats-new');
}

window.maybeShowWhatsNew = maybeShowWhatsNew;

// ===== Initialize =====
async function init() {
  createToastContainer();

  // Cursor glow background (CSS vars)
  if (!window.__zenonCursorGlowWired) {
    window.__zenonCursorGlowWired = true;
    const root = document.documentElement;
    const setPos = (e) => {
      // Avoid work when reduce-motion is enabled.
      if (root.getAttribute('data-reduce-motion') === 'true') return;
      const x = Math.max(0, Math.min(100, (e.clientX / window.innerWidth) * 100));
      const y = Math.max(0, Math.min(100, (e.clientY / window.innerHeight) * 100));
      root.style.setProperty('--mx', `${x}%`);
      root.style.setProperty('--my', `${y}%`);
    };
    window.addEventListener('mousemove', setPos, { passive: true });
    // Reasonable default center
    root.style.setProperty('--mx', '50%');
    root.style.setProperty('--my', '50%');
  }

  // Window controls
  document.getElementById('btn-minimize').addEventListener('click', () => window.zenon.minimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.zenon.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.zenon.close());

  // Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      navigateTo(page);
    });
  });

  // Modal overlay close
  document.getElementById('modal-overlay').addEventListener('click', closeAllModals);

  // What's New modal controls
  document.getElementById('whats-new-close-btn')?.addEventListener('click', async () => {
    closeModal('modal-whats-new');
    const v = String(window.__pendingWhatsNewVersion || '').trim();
    if (!v) return;
    const prev = await window.zenon.getSettings();
    const next = { ...prev, lastSeenVersion: v };
    await window.zenon.saveSettings(next);
    State.settings = next;
    window.__pendingWhatsNewVersion = '';
  });
  document.getElementById('whats-new-ok-btn')?.addEventListener('click', () => {
    document.getElementById('whats-new-close-btn')?.click();
  });
  document.getElementById('whats-new-disable-btn')?.addEventListener('click', async () => {
    closeModal('modal-whats-new');
    const v = String(window.__pendingWhatsNewVersion || '').trim();
    const prev = await window.zenon.getSettings();
    const next = { ...prev, whatsNewEnabled: false, lastSeenVersion: v || prev.lastSeenVersion || '' };
    await window.zenon.saveSettings(next);
    State.settings = next;
    window.__pendingWhatsNewVersion = '';
    showToast('What’s new popup disabled.', 'info');
  });

  // Console controls
  document.getElementById('console-close-btn').addEventListener('click', closeConsole);
  document.getElementById('console-clear-btn').addEventListener('click', clearConsole);

  // Launch listeners
  window.zenon.onLaunchLog((data) => {
    const type = data.type === 'error' ? 'error' : data.type === 'data' ? 'default' : 'info';
    logToConsole(data.message, type);
  });

  window.zenon.onLaunchClose((data) => {
    State.isLaunching = false;
    State.runningInstanceId = null;
    const code = data?.code;
    const stopRecent = State.launchConsole.stopRequestedAt && Date.now() - State.launchConsole.stopRequestedAt < 12_000;
    const status =
      stopRecent
        ? 'Stopped'
        : (code === 0 ? 'Exited' : code == null ? 'Exited (unknown)' : `Exited (code ${code})`);
    setConsoleStatus(status, false);
    if (stopRecent) {
      logToConsole('Game stopped by user', 'info');
    } else {
      logToConsole(
        code == null ? 'Game closed (exit code unknown)' : `Game closed with exit code ${code}`,
        code === 0 ? 'success' : 'error'
      );
    }
    if (State.currentPage === 'instances') renderInstances();
    if (State.currentPage === 'library') {
      // Avoid full Library rerender (causes a flash). Just morph Play/Stop + refresh embedded console.
      if (typeof window.updateLibraryPlayStopButton === 'function') window.updateLibraryPlayStopButton();
      if (typeof window.renderLaunchConsoleMirrors === 'function') window.renderLaunchConsoleMirrors();
    }
    if (State.currentPage === 'discovery' && typeof window.__discoveryRefresh === 'function') {
      window.__discoveryRefresh();
    }
    if (State.currentPage === 'library' && typeof window.__libraryBrowseRefresh === 'function') {
      window.__libraryBrowseRefresh();
    }
  });

  // Auth gate
  const ok = await ensureLoggedInOrShowAuth();
  if (!ok) {
    // Don't load the rest until user signs in
    updateSidebarBadge();
    return;
  }

  await bootstrapMainUIAfterLogin();
}

document.addEventListener('DOMContentLoaded', init);

// Global UI sound hooks (subtle)
if (!window.__zenonSoundHooks) {
  window.__zenonSoundHooks = true;
  // Default OFF until settings load / user enables.
  if (typeof window.__zenonSoundsEnabled === 'undefined') window.__zenonSoundsEnabled = false;

  const soundsOn = () => {
    if (typeof window.__zenonSoundsEnabled === 'boolean') return window.__zenonSoundsEnabled;
    if (State?.settings && typeof State.settings.soundsEnabled === 'boolean') return !!State.settings.soundsEnabled;
    return false;
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button,.btn,.nav-item,[role="button"]');
    if (!b) return;
    try {
      if (soundsOn()) window.zenonSound?.click?.();
    } catch (e2) {}
  }, true);

  // Hover sounds for mod/plugin cards (no spam within same card)
  const __hoverLastAt = new WeakMap();
  document.addEventListener('mouseover', (e) => {
    const card = e.target?.closest?.('.discovery-card');
    if (!card) return;
    const rel = e.relatedTarget;
    if (rel && card.contains(rel)) return; // still inside same card
    const now = Date.now();
    const last = __hoverLastAt.get(card) || 0;
    if (now - last < 120) return;
    __hoverLastAt.set(card, now);
    try {
      if (soundsOn()) window.zenonSound?.hover?.();
    } catch (e2) {}
  }, true);

  // Wrap showToast for success/error tones
  const __origToast = window.showToast;
  if (typeof __origToast === 'function') {
    window.showToast = function(message, type = 'info', duration = 3000) {
      try {
        if (soundsOn()) {
          if (type === 'success') window.zenonSound?.success?.();
          if (type === 'error') window.zenonSound?.error?.();
        }
      } catch (e2) {}
      return __origToast(message, type, duration);
    };
  }
}

// Updates: show lightweight toasts and allow restart-to-update.
if (!window.__zenonUpdatesWired && typeof window.zenon?.onUpdateEvent === 'function') {
  window.__zenonUpdatesWired = true;

  const __updateKey = 'zenon.updateReminder.v1';
  const setReminder = (on, text = '') => {
    const el = document.getElementById('update-reminder');
    const tx = document.getElementById('update-reminder-text');
    if (tx) tx.textContent = text || 'Update ready — restart to install';
    if (el) el.style.display = on ? 'flex' : 'none';
    try {
      localStorage.setItem(__updateKey, JSON.stringify({ on: !!on, text: String(text || '') }));
    } catch (e) {}
  };
  const readReminder = () => {
    try {
      const raw = localStorage.getItem(__updateKey);
      const j = raw ? JSON.parse(raw) : null;
      return j && typeof j === 'object' ? j : { on: false, text: '' };
    } catch (e) {
      return { on: false, text: '' };
    }
  };

  // Restore reminder on startup/navigation.
  const r = readReminder();
  if (r?.on) setReminder(true, r.text || 'Update ready — restart to install');

  document.getElementById('update-reminder-install')?.addEventListener('click', async () => {
    const res = await window.zenon.updateInstall?.();
    if (!res?.success) showToast(res?.error || 'Could not install update', 'error', 5000);
  });
  document.getElementById('update-reminder-dismiss')?.addEventListener('click', () => {
    setReminder(false, '');
    showToast('Okay — I’ll remind you later.', 'info', 1800);
  });

  window.zenon.onUpdateEvent((ev) => {
    if (!ev || !ev.event) return;
    if (ev.event === 'available') {
      showToast('Update available — downloading…', 'info', 3500);
    } else if (ev.event === 'progress') {
      // keep quiet to avoid toast spam
    } else if (ev.event === 'downloaded') {
      showToast('Update ready — restart to apply', 'success', 5000);
      setReminder(true, 'Update ready — restart to install');
    } else if (ev.event === 'error') {
      showToast(`Update error: ${ev.message || 'unknown'}`, 'error', 5000);
    }
  });
}
