// ===== Global App State =====
const State = {
  currentPage: 'home',
  selectedInstance: null,
  instances: [],
  settings: {},
  mcVersions: [],
  isLaunching: false,
  runningInstanceId: null,
  /** Instance ids with a live game process launched from this Zenon process. */
  runningInstanceIds: new Set(),
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

  // Respect the user's "Update reminder" setting — Settings → Updates.
  const reminderAllowed = () => {
    try {
      return (State?.settings?.updateReminder !== false);
    } catch (e) {
      return true;
    }
  };

  // Restore reminder on startup/navigation.
  (async () => {
    const r = readReminder();
    if (r?.on && reminderAllowed()) setReminder(true, r.text || 'Update ready — restart to install');
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
      window.__zenonUpdateTask = ZenonTasks.start('Downloading update…', { detail: 'Update found', progress: 0 });
      showToast('Update available — downloading…', 'info', 3500);
    } else if (ev.event === 'progress') {
      const tid = window.__zenonUpdateTask;
      const pct = ev?.progress?.percent;
      if (tid && Number.isFinite(Number(pct))) {
        ZenonTasks.update(tid, { progress: Math.round(Number(pct)), detail: `Downloading… ${Math.round(Number(pct))}%` });
      }
    } else if (ev.event === 'downloaded') {
      const tid = window.__zenonUpdateTask;
      if (tid) {
        ZenonTasks.succeed(tid, 'Restart to install');
        window.__zenonUpdateTask = null;
      }
      window.__zenonUpdateReady = true;
      showToast('Update ready — restart to install', 'success', 5000);
      if (reminderAllowed()) setReminder(true, 'Update ready — restart to install');
      const btn = document.getElementById('tools-install-update-btn');
      if (btn) btn.disabled = false;
      const status = document.getElementById('tools-update-status');
      if (status) status.textContent = 'Update ready - restart to install.';
    } else if (ev.event === 'error') {
      const tid = window.__zenonUpdateTask;
      if (tid) {
        ZenonTasks.fail(tid, ev.message || 'Update failed');
        window.__zenonUpdateTask = null;
      }
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
  if (page !== 'skins' && typeof window.__abandonSkinViewer === 'function') {
    window.__abandonSkinViewer();
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  await renderPage(page);
  if (seq !== __navSeq) return;
}

async function renderPage(page) {
  const content = document.getElementById('main-content');
  const oldPage = content.children[0] || null;

  // Fade out the current page before replacing it — this prevents the black
  // flash that happens when innerHTML wipes the DOM mid-paint.
  if (oldPage) {
    oldPage.style.transition = 'opacity 100ms ease';
    oldPage.style.opacity = '0';
    await new Promise((r) => setTimeout(r, 100));
  }

  switch (page) {
    case 'home': await renderHome(); break;
    case 'instances':
    case 'library': await renderInstances(); break;
    case 'instance': await renderLibrary(); break;
    case 'skins': if (typeof window.renderSkins === 'function') await window.renderSkins(); break;
    case 'discovery': await renderDiscovery(); break;
    case 'host-server': await renderHostServer(); break;
    case 'tools': await renderTools(); break;
    case 'settings': await renderSettings(); break;
  }

  const newPage = content.children[0] || null;
  if (newPage) {
    newPage.style.opacity = '0';
    newPage.style.transition = 'opacity 150ms ease';
    // Let the new element settle in the DOM, then fade it in.
    await new Promise((r) => requestAnimationFrame(r));
    newPage.style.opacity = '1';
  }

  content.scrollTop = 0;
}

/** Re-render whatever is showing so running badges/buttons reflect the live set. */
function refreshRunningUI() {
  renderSidebarRecent();
  if (State.currentPage === 'instances' || State.currentPage === 'library') renderInstances();
  else if (State.currentPage === 'instance' && typeof renderLibrary === 'function') renderLibrary();
  else if (State.currentPage === 'home' && typeof renderHome === 'function') renderHome();
  else if (State.currentPage === 'tools' && typeof renderTools === 'function') renderTools();
}

// ===== Sidebar Instance Badge =====
function updateSidebarBadge() {
  const nameEl = document.getElementById('sidebar-instance-name');
  const dot = document.getElementById('sidebar-instance-dot');

  if (State.selectedInstance) {
    if (nameEl) nameEl.textContent = State.selectedInstance.name;
    if (dot) dot.classList.add('active');
  } else {
    if (nameEl) nameEl.textContent = 'No Instance';
    if (dot) dot.classList.remove('active');
  }
  renderSidebarRecent();
}

// ===== Sidebar: recently played instances =====
function renderSidebarRecent() {
  const wrap = document.getElementById('sidebar-recent');
  const list = document.getElementById('sidebar-recent-list');
  if (!wrap || !list) return;
  const instances = Array.isArray(State.instances) ? State.instances : [];
  const recent = instances
    .filter((i) => i && i.lastPlayed)
    .slice()
    .sort((a, b) => new Date(b.lastPlayed || 0) - new Date(a.lastPlayed || 0))
    .slice(0, 4);

  if (recent.length === 0) {
    wrap.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  wrap.style.display = '';
  const selectedId = State.selectedInstance ? State.selectedInstance.id : null;
  list.innerHTML = recent
    .map((inst) => {
      const loader = String(inst.loader || 'vanilla');
      const meta = [inst.version || '', loader !== 'vanilla' ? loader : ''].filter(Boolean).join(' · ');
      const active = selectedId && inst.id === selectedId ? ' active' : '';
      const runningDot = State.runningInstanceIds.has(inst.id)
        ? '<span class="recent-running-dot" title="Game is running" aria-label="Game is running"></span>'
        : '';
      return `
        <button type="button" class="sidebar-recent-item${active}${runningDot ? ' is-running' : ''}" data-recent-id="${escapeHtml(inst.id)}" title="Open ${escapeHtml(inst.name || 'Instance')}">
          <span class="sidebar-recent-icon">${getInstanceIcon(inst)}</span>
          <span class="sidebar-recent-text">
            <span class="sidebar-recent-name">${escapeHtml(inst.name || 'Instance')}</span>
            <span class="sidebar-recent-meta">${escapeHtml(meta)}</span>
          </span>
          ${runningDot || '<span class="sidebar-recent-play" aria-hidden="true">&#8250;</span>'}
        </button>`;
    })
    .join('');
  list.querySelectorAll('[data-recent-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-recent-id');
      const hit = (State.instances || []).find((x) => x.id === id);
      if (!hit) return;
      State.selectedInstance = hit;
      if (typeof window.syncSelectedInstanceWithList === 'function') window.syncSelectedInstanceWithList();
      State.libraryPane = 'content';
      updateSidebarBadge();
      navigateTo('instance', { force: true });
    });
  });
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
  // Any pending confirmation dialog counts as "cancelled"
  resolveConfirm(false);
  document.getElementById('modal-overlay').classList.remove('show');
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
}

// ===== Styled confirm dialog (replaces native confirm()) =====
let __confirmResolve = null;

/**
 * Show a Zenon-styled confirmation dialog.
 * @param {{ title?: string, message?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} [opts]
 * @returns {Promise<boolean>} true if the user confirmed, false if cancelled
 */
function showConfirm(opts = {}) {
  const {
    title = 'Are you sure?',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = true
  } = opts;

  return new Promise((resolve) => {
    __confirmResolve = resolve;
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const icon = document.getElementById('confirm-icon');
    const cancelBtn = document.getElementById('confirm-cancel-btn');
    const acceptBtn = document.getElementById('confirm-accept-btn');
    if (!msgEl || !cancelBtn || !acceptBtn) { resolve(false); return; }

    if (titleEl) titleEl.textContent = title;
    msgEl.textContent = message;
    if (icon) icon.classList.toggle('confirm-icon--warn', !danger);
    cancelBtn.textContent = cancelLabel;
    acceptBtn.textContent = confirmLabel;
    acceptBtn.classList.toggle('btn-danger', !!danger);
    acceptBtn.classList.toggle('btn-primary', !danger);
    acceptBtn.classList.toggle('confirm-icon--warn', false);

    openModal('modal-confirm');
    // Safe default for destructive actions: focus Cancel
    cancelBtn.focus();
  });
}

function resolveConfirm(value) {
  if (!__confirmResolve) return;
  const r = __confirmResolve;
  __confirmResolve = null;
  closeModal('modal-confirm');
  r(!!value);
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
  // Legacy single-letter glyphs (A–H) keep rendering for existing instances…
  if (ic && ic !== 'default' && typeof ic === 'string' && ic.length === 1) {
    return escapeHtml(ic.toUpperCase());
  }
  // …everything else gets one of our SVG sigils (stored as svg:<id>, default hashed from the instance id).
  if (window.ZenonInstanceIcons) {
    return window.ZenonInstanceIcons.svgForInstance(ic, instance.id || instance.name);
  }
  return '';
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
/** Hide the splash as soon as the UI is ready — the cap is only a nicety, not a fake delay. */
const SPLASH_MIN_MS = 400;

function hideSplash() {
  const el = document.getElementById('splash-screen');
  if (!el) return;
  if (el.classList.contains('splash-hide')) return;
  const elapsed = Date.now() - __splashStartedAt;
  const wait = Math.max(0, SPLASH_MIN_MS - elapsed);
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
  try {
    const running = await window.zenon.getRunningInstances?.();
    State.runningInstanceIds = new Set(Array.isArray(running?.ids) ? running.ids : []);
  } catch (e) {
    State.runningInstanceIds = new Set();
  }
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

  // Command palette (Ctrl+K)
  if (typeof window.CommandPalette === 'object') window.CommandPalette.init();

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

  // Sidebar: Join Discord (opens the invite in the browser)
  document.getElementById('sidebar-join-discord')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (window.zenon && typeof window.zenon.openExternal === 'function') {
      window.zenon.openExternal('https://discord.gg/umfvjxRFxy');
    }
  });

  // Sidebar: settings icon button
  document.getElementById('sidebar-settings-btn')?.addEventListener('click', () => navigateTo('settings'));

  // Modal overlay close
  document.getElementById('modal-overlay').addEventListener('click', closeAllModals);

  // Confirmation dialog buttons
  document.getElementById('confirm-cancel-btn')?.addEventListener('click', () => resolveConfirm(false));
  document.getElementById('confirm-accept-btn')?.addEventListener('click', () => resolveConfirm(true));
  document.getElementById('confirm-close-btn')?.addEventListener('click', () => resolveConfirm(false));

  // Console controls
  document.getElementById('console-close-btn').addEventListener('click', closeConsole);
  document.getElementById('console-clear-btn').addEventListener('click', clearConsole);

  // Launch listeners
  window.zenon.onLaunchLog((data) => {
    const type = data.type === 'error' ? 'error' : data.type === 'data' ? 'default' : 'info';
    logToConsole(data.message, type);

    // Surface Java auto-provisioning as an Activity task (it is the slowest silent step).
    try {
      const msg = String(data?.message ?? '');
      const dm = msg.match(/Downloading Java (\d+) runtime — (\d+)%/);
      if (dm) {
        const tid = (window.__javaTasks = window.__javaTasks || {})[`java-${dm[1]}`]
          || (ZenonTasks.start(`Java ${dm[1]} runtime`, { detail: 'Downloading…' }));
        window.__javaTasks[`java-${dm[1]}`] = tid;
        ZenonTasks.update(tid, { progress: Number(dm[2]), detail: `${dm[2]}%` });
        return;
      }
      const ex = msg.match(/Extracting Java (\d+) runtime/);
      if (ex) {
        const key = `java-${ex[1]}`;
        const tid = (window.__javaTasks = window.__javaTasks || {})[key];
        if (tid) ZenonTasks.update(tid, { progress: 99, detail: 'Extracting…' });
        return;
      }
      const use = msg.match(/Using Java (\d+)/);
      if (use) {
        const tasks = window.__javaTasks || {};
        const installed = Object.keys(tasks);
        for (const k of installed) {
          ZenonTasks.succeed(tasks[k], 'Runtime installed');
          delete tasks[k];
        }
        if (installed.length) showToast(`Java ${use[1]} ready`, 'success');
      }
    } catch (e) {}
  });

  window.zenon.onLaunchClose((data) => {
    State.isLaunching = false;
    State.runningInstanceId = null;
    if (data?.instanceId) State.runningInstanceIds.delete(data.instanceId);
    setConsoleStatus(`Exited (code ${data.code})`, false);
    logToConsole(`Game closed with exit code ${data.code}`, data.code === 0 ? 'success' : 'error');
    const tid = window.__zenonLaunchTaskId;
    if (tid) {
      ZenonTasks.succeed(tid, `Exited (code ${data.code})`);
      window.__zenonLaunchTaskId = null;
    }
    if (data?.code && data.code !== 0) {
      showToast(`Minecraft exited with code ${data.code} — check the log for details.`, 'error', 6000);
    }
    refreshRunningUI();
    if (State.currentPage === 'discovery' && typeof window.__discoveryRefresh === 'function') {
      window.__discoveryRefresh();
    }
    if (State.currentPage === 'instance' && typeof window.__libraryBrowseRefresh === 'function') {
      window.__libraryBrowseRefresh();
    }
  });

  // ===== Launch progress stepper =====
  const LAUNCH_STAGES = [
    { id: 'auth', label: 'Account' },
    { id: 'version', label: 'Metadata' },
    { id: 'loader', label: 'Loader' },
    { id: 'java', label: 'Java' },
    { id: 'preparing', label: 'Files' },
    { id: 'running', label: 'Running' }
  ];
  const STAGE_PROGRESS = { auth: 10, version: 28, loader: 42, java: 60, preparing: 80, running: 100 };
  const STAGE_INDEX = {};
  LAUNCH_STAGES.forEach((s, i) => { STAGE_INDEX[s.id] = i; });

  function stageLabel(stage, detail) {
    switch (stage) {
      case 'auth': return 'Account verified';
      case 'version': return 'Loading version metadata…';
      case 'loader': return detail ? `Setting up ${detail}…` : 'Setting up loader…';
      case 'java': return detail ? `Java ready — ${detail}` : 'Java ready';
      case 'preparing': return 'Downloading / verifying game files…';
      case 'running': return 'Minecraft is running';
      case 'closed': return `Exited — ${detail || ''}`.trim();
      case 'failed': return detail ? `Failed — ${detail}` : 'Launch failed';
      default: return detail || 'Launching…';
    }
  }

  function renderStageChips(activeStage, terminal) {
    const wrap = document.getElementById('console-stages');
    if (!wrap) return;
    if (terminal === 'closed') {
      wrap.innerHTML = LAUNCH_STAGES.map((s) => `<span class="console-stage is-done" data-stage="${s.id}">${s.label}</span>`).join('');
      return;
    }
    const activeIdx = STAGE_INDEX[activeStage] ?? -1;
    const failedIdx = terminal === 'failed' ? LAUNCH_STAGES.length : -1;
    wrap.innerHTML = LAUNCH_STAGES.map((s, i) => {
      let cls = 'console-stage';
      if (terminal === 'failed' && failedIdx >= i) cls += ' is-failed';
      else if (activeIdx > i) cls += ' is-done';
      else if (activeIdx === i) cls += ' is-active';
      return `<span class="${cls}" data-stage="${s.id}">${s.label}</span>`;
    }).join('');
  }

  function setLaunchProgressVisible(visible) {
    const strip = document.getElementById('console-progress');
    if (strip) strip.style.display = visible ? 'block' : 'none';
  }

  function resetLaunchProgress() {
    const strip = document.getElementById('console-progress');
    const fill = document.getElementById('console-progress-fill');
    const label = document.getElementById('console-progress-label');
    const pct = document.getElementById('console-progress-pct');
    if (fill) fill.style.width = '0%';
    if (label) label.textContent = 'Preparing…';
    if (pct) pct.textContent = '';
    if (strip) strip.style.display = 'none';
    const wrap = document.getElementById('console-stages');
    if (wrap) wrap.innerHTML = '';
  }
  window.__zenonResetLaunchProgress = resetLaunchProgress;

  window.zenon.onLaunchProgress?.((p) => {
    if (!p || !p.stage) return;
    if (p.stage === 'running' && p.instanceId) {
      State.runningInstanceIds.add(p.instanceId);
      State.runningInstanceId = p.instanceId;
      refreshRunningUI();
    } else if (p.stage === 'failed' && p.instanceId) {
      State.runningInstanceIds.delete(p.instanceId);
      refreshRunningUI();
    }
    const strip = document.getElementById('console-progress');
    if (!strip) return;

    const fill = document.getElementById('console-progress-fill');
    const label = document.getElementById('console-progress-label');
    const pctEl = document.getElementById('console-progress-pct');
    const stage = String(p.stage);

    setLaunchProgressVisible(true);
    label.textContent = stageLabel(stage, p.detail);
    const pct = STAGE_PROGRESS[stage];
    if (fill && pct != null) fill.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = pct != null && stage !== 'closed' && stage !== 'failed' ? `${pct}%` : '';

    if (stage === 'closed') {
      renderStageChips(null, 'closed');
      if (fill) fill.style.width = '100%';
    } else if (stage === 'failed') {
      renderStageChips(null, 'failed');
      if (fill) fill.style.width = '100%';
    } else {
      renderStageChips(stage, null);
    }

    // Mirror into the Activity task, if this launch has one open.
    const tid = window.__zenonLaunchTaskId;
    if (!tid) return;
    if (STAGE_PROGRESS[stage] != null) {
      ZenonTasks.update(tid, { progress: STAGE_PROGRESS[stage], detail: stageLabel(stage, p.detail) });
    }
    if (stage === 'running') {
      ZenonTasks.succeed(tid, 'Minecraft is running');
      window.__zenonLaunchTaskId = null;
    } else if (stage === 'failed') {
      ZenonTasks.fail(tid, p.detail || 'Launch failed');
      window.__zenonLaunchTaskId = null;
    } else if (stage === 'closed' && window.__zenonLaunchTaskId) {
      ZenonTasks.succeed(tid, 'Game closed');
      window.__zenonLaunchTaskId = null;
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
