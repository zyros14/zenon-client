// ===== Tools Page =====
async function renderTools() {
  const content = document.getElementById('main-content');
  const selected = State.selectedInstance;

  const instName = selected ? selected.name : 'No instance selected';

  content.innerHTML = `
    <div class="page page-tools">
      <div class="page-header">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <span class="page-kicker">Shortcuts</span>
            <h1 class="page-title">Tools</h1>
            <p class="page-subtitle">Quick actions and power-user shortcuts.</p>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" class="btn btn-ghost" id="tools-open-userdata-btn">Open app data</button>
            <button type="button" class="btn btn-ghost" id="tools-open-instances-root-btn">Open instances folder</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap">
          <div style="min-width:240px">
            <div style="font-weight:800;font-size:14px">Selected instance</div>
            <div style="margin-top:6px;color:var(--text-muted);font-size:12px">${escapeHtml(instName)}</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" class="btn btn-primary" id="tools-open-selected-instance-btn" ${selected ? '' : 'disabled'}>Open instance folder</button>
            <button type="button" class="btn btn-ghost" id="tools-export-selected-instance-btn" ${selected ? '' : 'disabled'}>Export selected</button>
          </div>
        </div>
      </div>

      <div class="stats-row" style="grid-template-columns:repeat(2, minmax(0, 1fr));margin-bottom:18px">
        <div class="stat-card">
          <div class="stat-icon stat-icon-blue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          </div>
          <div class="stat-info">
            <h3>${escapeHtml(String(State.instances.length))}</h3>
            <p>Instances</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon-purple">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M8 8h8v8H8z"/></svg>
          </div>
          <div class="stat-info">
            <h3>${escapeHtml(State.auth?.profile?.name || '—')}</h3>
            <p>Profile</p>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:800;font-size:14px">Import / Export</div>
            <div style="margin-top:6px;color:var(--text-muted);font-size:12px">Move instances between PCs or back them up.</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" class="btn btn-ghost" id="tools-import-instance-btn">Import instance zip</button>
            <button type="button" class="btn btn-primary" id="tools-new-instance-btn">New instance</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px" id="tools-backups-card">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:800;font-size:14px">Backups</div>
            <div style="margin-top:6px;color:var(--text-muted);font-size:12px">Snapshots live under your app-data <code class="id-code">backups/</code> folder. Restoring creates a <em>copy</em> — your current instance is never overwritten.</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="tools-backup-now-btn" ${selected ? '' : 'disabled'}>Back up selected instance</button>
        </div>
        <div id="tools-backups-list" style="margin-top:12px;display:flex;flex-direction:column;gap:6px"></div>
      </div>

      <div class="card">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:800;font-size:14px">Logs</div>
            <div style="margin-top:6px;color:var(--text-muted);font-size:12px">Quick access to the latest Minecraft log.</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" class="btn btn-ghost" id="tools-view-latest-log-btn" ${selected ? '' : 'disabled'}>View latest.log</button>
          </div>
        </div>
        <div id="tools-log-view" style="display:none;margin-top:14px"></div>
      </div>

      <!-- Updates -->
      <div class="card">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:800;font-size:14px">Updates</div>
            <div style="margin-top:6px;color:var(--text-muted);font-size:12px">Check for new versions of Zenon Client. <span id="tools-current-version">Current: v?</span></div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" class="btn btn-ghost" id="tools-check-updates-btn">Check for updates</button>
            <button type="button" class="btn btn-primary" id="tools-install-update-btn" disabled>Restart to install</button>
          </div>
        </div>
        <div id="tools-update-status" style="margin-top:8px;color:var(--text-muted);font-size:12px">Idle</div>
        <div id="tools-update-progress" style="display:none;margin-top:8px"></div>
      </div>
    </div>
  `;

  document.getElementById('tools-new-instance-btn')?.addEventListener('click', () => openCreateInstanceModal());

  // ===== Backups =====
  const renderBackupsList = async () => {
    const wrap = document.getElementById('tools-backups-list');
    if (!wrap) return;
    wrap.innerHTML = '<div class="loading-spinner"></div>';
    const all = [];
    for (const inst of State.instances || []) {
      try {
        const list = await window.zenon.listBackups?.(inst.id);
        if (Array.isArray(list)) {
          for (const b of list) all.push({ ...b, instanceName: inst.name });
        }
      } catch (e) {}
    }
    all.sort((a, b) => (b.at || 0) - (a.at || 0));
    const top = all.slice(0, 8);
    if (top.length === 0) {
      wrap.innerHTML = '<div class="empty-inline">No backups yet. Use “Back up selected instance” to create one.</div>';
      return;
    }
    const fmtSize = (n) => n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1048576))} MB`;
    wrap.innerHTML = top.map((b) => `
      <div class="tools-backup-row" data-file="${escapeHtml(b.file)}">
        <div class="tools-backup-meta">
          <span class="tools-backup-name">${escapeHtml(b.name)}</span>
          <span class="tools-backup-sub">${escapeHtml(b.instanceName || '')} · ${fmtSize(b.size || 0)} · ${formatDate(new Date(b.at || 0).toISOString())}</span>
        </div>
        <div class="tools-backup-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="restore">Restore</button>
          <button type="button" class="btn btn-danger btn-sm btn-icon" data-action="delete" title="Delete backup">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
      </div>`).join('');
    wrap.querySelectorAll('[data-action="restore"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const file = btn.closest('.tools-backup-row')?.dataset.file;
        if (!file) return;
        if (!await showConfirm({
          title: 'Restore backup',
          message: 'Restore this backup as a NEW instance? (non-destructive)',
          confirmLabel: 'Restore',
          danger: false
        })) return;
        const r = await window.zenon.restoreBackup(file);
        if (r?.success) {
          State.instances = await window.zenon.getInstances();
          State.selectedInstance = r.instance || State.selectedInstance;
          if (typeof window.syncSelectedInstanceWithList === 'function') window.syncSelectedInstanceWithList();
          updateSidebarBadge();
          showToast(`Restored “${r.instance?.name || 'backup'}” as a new instance`, 'success', 5000);
          renderBackupsList();
        } else {
          showToast(`Restore failed: ${r?.error || 'unknown error'}`, 'error', 5000);
        }
      });
    });
    wrap.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const file = btn.closest('.tools-backup-row')?.dataset.file;
        if (!file) return;
        if (!await showConfirm({ title: 'Delete backup', message: 'Delete this backup permanently?', confirmLabel: 'Delete' })) return;
        const r = await window.zenon.deleteBackup(file);
        if (r?.success) showToast('Backup deleted', 'info');
        else showToast(`Delete failed: ${r?.error || 'unknown error'}`, 'error', 5000);
        renderBackupsList();
      });
    });
  };
  renderBackupsList();
  document.getElementById('tools-backup-now-btn')?.addEventListener('click', async () => {
    if (!selected) return;
    const r = await window.zenon.backupInstance(selected.id);
    if (r?.success) {
      showToast('Backup saved', 'success');
      renderBackupsList();
    } else {
      showToast(`Backup failed: ${r?.error || 'unknown error'}`, 'error', 5000);
    }
  });

  document.getElementById('tools-open-selected-instance-btn')?.addEventListener('click', async () => {
    if (!selected) return;
    await window.zenon.openInstanceFolder(selected.id);
  });

  document.getElementById('tools-export-selected-instance-btn')?.addEventListener('click', async () => {
    if (!selected) return;
    const res = await window.zenon.exportInstance(selected.id);
    if (res?.canceled) return;
    if (res?.success) showToast('Instance exported', 'success');
    else showToast(`Export failed: ${res?.error || 'unknown error'}`, 'error', 4500);
  });

  document.getElementById('tools-import-instance-btn')?.addEventListener('click', async () => {
    const res = await window.zenon.importInstance();
    if (res?.canceled) return;
    if (res?.success) {
      showToast('Instance imported', 'success');
      State.instances = await window.zenon.getInstances();
      State.selectedInstance = res.instance || State.selectedInstance;
      if (typeof window.syncSelectedInstanceWithList === 'function') window.syncSelectedInstanceWithList();
      updateSidebarBadge();
      renderTools();
    } else {
      showToast(`Import failed: ${res?.error || 'unknown error'}`, 'error', 5000);
    }
  });

  document.getElementById('tools-open-userdata-btn')?.addEventListener('click', async () => {
    await window.zenon.openUserDataFolder();
  });
  document.getElementById('tools-open-instances-root-btn')?.addEventListener('click', async () => {
    await window.zenon.openInstancesRootFolder();
  });

  document.getElementById('tools-view-latest-log-btn')?.addEventListener('click', async () => {
    if (!selected) return;
    const wrap = document.getElementById('tools-log-view');
    if (!wrap) return;
    wrap.style.display = 'block';
    wrap.innerHTML = '<div class="loading-spinner"></div>';
    const res = await window.zenon.readInstanceLatestLog(selected.id);
    const text = res?.text || '';
    wrap.innerHTML = `<pre class="id-log-pre" style="max-height: min(52vh, 520px)">${escapeHtml(text)}</pre>`;
  });

  // ===== Update UI =====
  const statusEl = document.getElementById('tools-update-status');
  const progEl = document.getElementById('tools-update-progress');
  const installBtn = document.getElementById('tools-install-update-btn');
  const currentVersionEl = document.getElementById('tools-current-version');
  const checkBtn = document.getElementById('tools-check-updates-btn');

  const setUpdateStatus = (text) => {
    if (statusEl) statusEl.textContent = text || 'Idle';
  };
  const setProgress = (pct, note) => {
    if (!progEl) return;
    const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    progEl.style.display = 'block';
    progEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:6px">
        <div style="color:var(--text-muted);font-size:12px">${escapeHtml(note || 'Downloading…')}</div>
        <div style="color:var(--text-muted);font-size:12px">${p}%</div>
      </div>
      <div style="height:8px;border-radius:999px;border:1px solid var(--border);background:var(--bg-tertiary);overflow:hidden">
        <div style="height:100%;width:${p}%;background:linear-gradient(90deg,var(--accent),var(--purple))"></div>
      </div>
    `;
  };
  const hideProgress = () => { if (progEl) progEl.style.display = 'none'; };

  // Show the running version (from the packaged app when available, else the vendored copy)
  (async () => {
    try {
      const info = await window.zenon.getAppInfo?.();
      if (info?.version) {
        State.appVersion = info.version;
        State.appIsPackaged = !!info.isPackaged;
        if (currentVersionEl) currentVersionEl.textContent = `Current: v${info.version}`;
      }
    } catch (e) {}
  })();

  const describeResult = (res) => {
    const current = State.appVersion || '';
    return current ? `You're up to date (v${current}).` : 'Check complete.';
  };

  // If auto-update already downloaded while this page mounts (common when the page loads late), flag it up.
  if (window.__zenonUpdateReady && installBtn) {
    installBtn.disabled = false;
    setUpdateStatus('Update ready — restart to install.');
  }

  const runCheck = async () => {
    setUpdateStatus('Checking for updates…');
    hideProgress();
    if (checkBtn) checkBtn.disabled = true;
    try {
      const res = await window.zenon.updateCheck?.();
      if (checkBtn) checkBtn.disabled = false;
      if (res?.success) {
        window.zenonActivity?.add?.('Checked for updates', 'info');
        const info = res?.result?.versionInfo;
        const latest = info?.version || info?.tag || '';
        if (res?.result?.isUpdateAvailable) {
          setUpdateStatus(`Update v${latest} found — downloading…`);
          showToast(`Update v${latest} found — downloading…`, 'info', 2500);
        } else {
          setUpdateStatus(describeResult(res));
        }
      } else {
        window.zenonActivity?.add?.('Update check failed', 'error');
        setUpdateStatus(`Update check failed: ${res?.error || 'unknown error'}`);
        showToast(res?.error || 'Update check failed', 'error', 4500);
      }
    } catch (e) {
      if (checkBtn) checkBtn.disabled = false;
      const msg = e?.message || 'unknown error';
      setUpdateStatus(`Update check failed: ${msg}`);
      showToast(`Update check failed: ${msg}`, 'error', 4500);
    }
  };

  checkBtn?.addEventListener('click', runCheck);

  installBtn?.addEventListener('click', async () => {
    const res = await window.zenon.updateInstall?.();
    if (!res?.success) {
      window.zenonActivity?.add?.('Update install failed', 'error');
      setUpdateStatus(`Restart failed: ${res?.error || 'unknown error'}`);
      showToast(res?.error || 'Could not install update', 'error', 5000);
    } else {
      window.zenonActivity?.add?.('Restarting to install update', 'info');
      setUpdateStatus('Restarting to install update…');
    }
  });

  if (!window.__toolsUpdateUnsub && typeof window.zenon?.onUpdateEvent === 'function') {
    window.__toolsUpdateUnsub = window.zenon.onUpdateEvent((ev) => {
      if (!ev?.event) return;
      if (ev.event === 'available') {
        setUpdateStatus('Update available — downloading…');
        if (installBtn) installBtn.disabled = true;
      } else if (ev.event === 'none') {
        setUpdateStatus('No updates found.');
        if (installBtn) installBtn.disabled = true;
      } else if (ev.event === 'progress') {
        const pct = ev?.progress?.percent ?? 0;
        const note = ev?.progress?.bytesPerSecond
          ? `Downloading… ${Math.round(ev.progress.bytesPerSecond / (1024 * 1024))} MB/s`
          : 'Downloading…';
        setUpdateStatus('Downloading update…');
        setProgress(pct, note);
      } else if (ev.event === 'downloaded') {
        setUpdateStatus('Update downloaded — restart to install.');
        if (installBtn) installBtn.disabled = false;
      } else if (ev.event === 'error') {
        setUpdateStatus(`Update error: ${ev.message || 'unknown'}`);
        if (installBtn) installBtn.disabled = true;
      }
    });
  }
}

window.renderTools = renderTools;

