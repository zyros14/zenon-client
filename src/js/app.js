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
  libraryPane: 'content'
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

// ===== Update reminder banner =====
if (!window.__zenonUpdatesWired && typeof window.zenon?.onUpdateEvent === 'function') {
  window.__zenonUpdatesWired = true;

  const __updateKey = 'zenon.updateReminder.v1';
  const setReminder = (on, text = '') => {
    const el = document.getElementById('update-reminder');
    const tx = document.getElementById('update-reminder-text');
    if (tx) tx.textContent = text || 'Update ready — restart to install';
    if (el) el.style.display = on ? 'flex' : 'none';
    try { localStorage.setItem(__updateKey, JSON.stringify({ on: !!on, text: String(text || '') })); } catch (e) {}
  };
  const readReminder = () => {
    try {
      const raw = localStorage.getItem(__updateKey);
      const j = raw ? JSON.parse(raw) : null;
      return j && typeof j === 'object' ? j : { on: false, text: '' };
    } catch (e) { return { on: false, text: '' }; }
  };

  // Restore reminder on startup/navigation.
  (async () => {
    const r = readReminder();
    if (r?.on) setReminder(true, r.text || 'Update ready — restart to install');
  })();

  document.getElementById('update-reminder-install')?.addEventListener('click', async () => {
    const res = await window.zenon.updateInstall?.();
    if (!res?.success) showToast(res?.error || 'Could not install update', 'error', 5000);
  });
  document.getElementById('update-reminder-dismiss')?.addEventListener('click', () => {
    setReminder(false, '');
    showToast('Okay — I’ll remind you later.', 'info', 1800);
  });

  window.zenon.onUpdateEvent((ev) => {
    if (!ev?.event) return;
    if (ev.event === 'available') {
      showToast('Update available — downloading…', 'info', 3500);
    } else if (ev.event === 'downloaded') {
      showToast('Update ready — restart to apply', 'success', 5000);
      setReminder(true, 'Update ready — restart to install');
    } else if (ev.event === 'error') {
      showToast(`Update error: ${ev.message || 'unknown'}`, 'error', 5000);
    }
  });
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
  content.scrollTop = 0;

  switch (page) {
    case 'home': await renderHome(); break;
    case 'instances': await renderInstances(); break;
    case 'library': await renderLibrary(); break;
    case 'discovery': await renderDiscovery(); break;
    case 'host-server': await renderHostServer(); break;
    case 'tools': await renderTools(); break;
    case 'settings': await renderSettings(); break;
  }

  initReveal();
}

// ===== Reveal-on-scroll =====
function initReveal() {
  const els = document.querySelectorAll('.reveal:not(.visible)');
  if (!('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('visible'));
    return;
  }
  let idx = 0;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.06 });
  els.forEach((el) => {
    el.style.setProperty('--reveal-delay', `${Math.min(idx++ * 70, 350)}ms`);
    observer.observe(el);
  });
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

function logToConsole(message, type = 'default') {
  const output = document.getElementById('console-output');
  const line = document.createElement('div');
  line.className = `console-line ${type}`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${message}`;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

function clearConsole() {
  document.getElementById('console-output').innerHTML = '';
}

function setConsoleStatus(status, running = false) {
  const el = document.getElementById('console-status');
  el.textContent = status;
  el.className = `console-status ${running ? 'running' : ''}`;
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
  // Built-in glyph choices (A–H) keep their letter icon…
  if (ic && ic !== 'default' && typeof ic === 'string' && ic.length === 1) {
    return escapeHtml(ic.toUpperCase());
  }
  // …everything else gets the default orb, tinted per instance.
  return instanceOrbHtml(instance);
}

/** Default instance avatar: one animated nebula orb (APNG), hue-rotated to a stable color per instance. */
const INSTANCE_ORB_HUES = [0, 70, 140, 210, 280, 330];

function instanceOrbHtml(instance) {
  const id = String((instance && (instance.id || instance.name)) || '');
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = INSTANCE_ORB_HUES[h % INSTANCE_ORB_HUES.length];
  const filter = hue ? ` style="filter:hue-rotate(${hue}deg) saturate(1.15)"` : '';
  return `<img class="instance-icon-img" src="assets/orbs/orb.png" alt="" draggable="false"${filter} />`;
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

  State.instances = await window.zenon.getInstances();
  if (State.instances.length > 0) {
    if (!State.selectedInstance) State.selectedInstance = State.instances[0];
    else if (typeof window.syncSelectedInstanceWithList === 'function') window.syncSelectedInstanceWithList();
  }
  updateSidebarBadge();
  await renderPage(State.currentPage || 'home');
  hideSplash();
}

// ===== Initialize =====
async function init() {
  createToastContainer();

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
    setConsoleStatus(`Exited (code ${data.code})`, false);
    logToConsole(`Game closed with exit code ${data.code}`, data.code === 0 ? 'success' : 'error');
    if (State.currentPage === 'instances') renderInstances();
    if (State.currentPage === 'library') renderLibrary();
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
