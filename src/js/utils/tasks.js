// ===== Centralized Task Manager =====
// One place to see everything the launcher is doing: downloads, modpack installs,
// Java provisioning, updates, launches. Anything long-running can enroll itself here.
// Toasts still fire from the pages that own the action; this is the activity record.
//
// Usage:
//   const id = ZenonTasks.start('Installing sodium', { detail: 'dependencies resolve…' });
//   ZenonTasks.update(id, { progress: 42, detail: '42%' });
//   ZenonTasks.succeed(id, 'Done');          // or .fail(id, 'nope')
//   ZenonTasks.subscribe(renderFn);
(function () {
  const STORAGE_KEY = 'zenon.tasks.v1';
  const MAX_HISTORY = 20;
  const MAX_ACTIVE = 6;

  let seq = 0;
  const active = new Map();          // id -> task
  let history = [];                  // finished tasks, most recent first
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    history = raw ? JSON.parse(raw).filter((t) => t && t.status !== 'running').slice(0, MAX_HISTORY) : [];
    if (!Array.isArray(history)) history = [];
  } catch (e) { history = []; }

  const listeners = new Set();
  let hideTimer = null;
  let hiddenByTimer = false;
  const AUTO_HIDE_MS = 30000; // hide the Activity FAB 30s after the last task finishes

  const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) {} } render(); };
  const persist = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY))); } catch (e) {}
  };

  function cancelAutoHide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function scheduleAutoHide() {
    cancelAutoHide();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hiddenByTimer = true;
      const wrap = document.querySelector('.tasks-wrap');
      if (wrap) wrap.style.display = 'none';
      render();
    }, AUTO_HIDE_MS);
  }

  function start(label, { detail = '', id = null } = {}) {
    cancelAutoHide();
    hiddenByTimer = false; // new activity — always show the FAB
    const wrap = document.querySelector('.tasks-wrap');
    if (wrap) wrap.style.display = '';
    if (active.size >= MAX_ACTIVE) {
      // Recycle the oldest finished slot — never block the app on a stale entry.
      const oldest = active.keys().next().value;
      active.delete(oldest);
    }
    const task = {
      id: id || `task-${Date.now()}-${++seq}`,
      label: String(label || 'Task'),
      detail: String(detail || ''),
      progress: null,               // null = indeterminate
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      outcome: ''
    };
    active.set(task.id, task);
    emit();
    return task.id;
  }

  function update(id, patch = {}) {
    const t = active.get(id);
    if (!t) return;
    if (patch.progress != null) {
      const n = Number(patch.progress);
      t.progress = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
    }
    if (patch.detail != null) t.detail = String(patch.detail);
    if (patch.label != null) t.label = String(patch.label);
    emit();
  }

  function finish(id, status, outcome = '') {
    const t = active.get(id);
    if (!t) return;
    active.delete(id);
    t.status = status;              // 'success' | 'error'
    t.outcome = String(outcome || '');
    t.endedAt = Date.now();
    t.progress = status === 'success' ? 100 : t.progress;
    history.unshift(t);
    history = history.slice(0, MAX_HISTORY);
    persist();
    // When the last active task finishes, start the auto-hide countdown.
    if (active.size === 0) scheduleAutoHide();
    emit();
  }

  const tasksApi = {
    start,
    update,
    succeed: (id, outcome) => finish(id, 'success', outcome),
    fail: (id, outcome) => finish(id, 'error', outcome),
    activeCount: () => active.size,
    list: () => ({
      active: [...active.values()],
      history: [...history]
    }),
    subscribe: (fn) => {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    clearHistory: () => { history = []; persist(); emit(); }
  };

  // ===== Floating panel UI =====
  function escapeHtmlTask(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatAgo(ts) {
    const d = Date.now() - ts;
    if (d < 60_000) return 'just now';
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  function taskIcon(status) {
    if (status === 'success') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    }
    if (status === 'error') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    }
    return '<span class="tasks-spinner" aria-hidden="true"></span>';
  }

  function render() {
    const btn = document.getElementById('tasks-fab');
    const panel = document.getElementById('tasks-panel');
    if (!btn || !panel) return;

    const activeList = [...active.values()];
    const { history: hist } = tasksApi.list();

    const badge = btn.querySelector('.tasks-fab-badge');
    const label = btn.querySelector('.tasks-fab-label');
    const wrap = document.querySelector('.tasks-wrap');
    const hasAnything = activeList.length > 0 || hist.length > 0;

    // If the auto-hide timer fired and there are no active tasks, stay hidden
    // until new activity starts.
    if (wrap) {
      const shouldHide = hiddenByTimer && activeList.length === 0;
      wrap.style.display = (hasAnything && !shouldHide) ? '' : 'none';
      wrap.classList.toggle('tasks-wrap--idle', !hasAnything);
    }

    if (activeList.length > 0) {
      btn.classList.add('is-busy');
      badge.textContent = String(activeList.length);
      badge.style.display = 'inline-flex';
      label.textContent = 'Working…';
    } else {
      btn.classList.remove('is-busy');
      badge.style.display = 'none';
      label.textContent = 'Activity';
    }

    const row = (t) => {
      const pct = t.status === 'running' && t.progress != null ? `<span class="tasks-pct">${t.progress}%</span>` : '';
      const outcome = t.status !== 'running' && t.outcome
        ? `<div class="tasks-item-outcome ${t.status === 'error' ? 'is-error' : ''}">${escapeHtmlTask(t.outcome)}</div>`
        : '';
      const bar = t.status === 'running' && t.progress != null
        ? `<div class="tasks-item-bar"><div class="tasks-item-bar-fill" style="width:${t.progress}%"></div></div>`
        : (t.status === 'running' ? '<div class="tasks-item-bar tasks-item-bar--indeterminate"><div class="tasks-item-bar-fill"></div></div>' : '');
      return `
        <li class="tasks-item ${t.status === 'running' ? 'is-running' : ''}">
          <span class="tasks-item-icon ${t.status}">${taskIcon(t.status)}</span>
          <div class="tasks-item-body">
            <div class="tasks-item-title">
              <span class="tasks-item-label">${escapeHtmlTask(t.label)}</span>
              ${pct}
            </div>
            ${t.detail ? `<div class="tasks-item-detail">${escapeHtmlTask(t.detail)}</div>` : ''}
            ${bar}
            ${outcome}
          </div>
          <span class="tasks-item-time">${t.status === 'running' ? 'now' : formatAgo(t.endedAt || t.startedAt)}</span>
        </li>`;
    };

    panel.querySelector('.tasks-list').innerHTML =
      activeList.length
        ? activeList.map(row).join('')
        : '<li class="tasks-empty">No active tasks.</li>';
    panel.querySelector('.tasks-recent').innerHTML =
      hist.length
        ? hist.map(row).join('')
        : '<li class="tasks-empty">Nothing finished yet.</li>';
  }

  function mount() {
    if (document.getElementById('tasks-fab')) return;
    const wrap = document.createElement('div');
    wrap.className = 'tasks-wrap';
    wrap.innerHTML = `
      <button type="button" class="tasks-fab" id="tasks-fab" aria-label="Toggle activity panel" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 16 12 14 15 10 9 8 12 2 12"/></svg>
        <span class="tasks-fab-label">Activity</span>
        <span class="tasks-fab-badge" style="display:none"></span>
      </button>
      <div class="tasks-panel" id="tasks-panel" role="dialog" aria-label="Activity" hidden>
        <div class="tasks-panel-head">
          <span class="tasks-panel-title">Activity</span>
          <button type="button" class="tasks-clear" id="tasks-clear-btn">Clear finished</button>
        </div>
        <div class="tasks-scroll">
          <div class="tasks-section-label">Active</div>
          <ul class="tasks-list"></ul>
          <div class="tasks-section-label">Recent</div>
          <ul class="tasks-recent"></ul>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const fab = wrap.querySelector('#tasks-fab');
    const panel = wrap.querySelector('#tasks-panel');
    fab.addEventListener('click', () => {
      const open = !panel.hidden;
      panel.hidden = open;
      fab.setAttribute('aria-expanded', String(!open));
      fab.classList.toggle('is-open', !open);
      if (!open) render();
    });
    wrap.querySelector('#tasks-clear-btn').addEventListener('click', () => tasksApi.clearHistory());
    // Click-away closes the panel.
    document.addEventListener('click', (e) => {
      if (panel.hidden) return;
      if (wrap.contains(e.target)) return;
      panel.hidden = true;
      fab.setAttribute('aria-expanded', 'false');
      fab.classList.remove('is-open');
    });
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.ZenonTasks = tasksApi;
})();
