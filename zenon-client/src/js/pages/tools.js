// ===== Tools Page =====
async function renderTools() {
  const content = document.getElementById('main-content');
  const settings = await window.zenon.getSettings();
  const selected = State.selectedInstance;
  const updateState = { stage: 'idle', pct: 0, note: '' };
  const recRam = await window.zenon.getRamRecommendation?.().catch(() => null);
  const activityEnabled = !!settings?.recentActionsEnabled;
  const activity = activityEnabled ? (window.zenonActivity?.list?.(6) || []) : [];

  const instName = selected ? selected.name : 'No instance selected';

  content.innerHTML = `
    <div class="page page-tools">
      <div class="page-header">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
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
            <button type="button" class="btn btn-ghost" id="tools-repair-selected-instance-btn" ${selected ? '' : 'disabled'}>Repair</button>
            <button type="button" class="btn btn-ghost" id="tools-clear-instance-cache-btn" ${selected ? '' : 'disabled'}>Clear cache</button>
            <button type="button" class="btn btn-ghost" id="tools-export-selected-instance-btn" ${selected ? '' : 'disabled'}>Export selected</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:800;font-size:14px">Updates</div>
            <div style="margin-top:6px;color:var(--text-muted);font-size:12px">
              Install builds from GitHub Releases. You’ll be prompted to restart when an update is ready.
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" class="btn btn-ghost" id="tools-check-updates-btn">Check</button>
            <button type="button" class="btn btn-primary" id="tools-install-update-btn" disabled>Restart &amp; install</button>
          </div>
        </div>
        <div id="tools-update-status" style="margin-top:12px;color:var(--text-muted);font-size:12px"></div>
        <div id="tools-update-progress" style="display:none;margin-top:10px"></div>
      </div>

      <div class="stats-row" style="grid-template-columns:repeat(3, minmax(0, 1fr));margin-bottom:18px">
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
          <div class="stat-icon stat-icon-green">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20"/><path d="M2 12h20"/></svg>
          </div>
          <div class="stat-info">
            <h3>${escapeHtml(String(settings.offlineEnabled ? 'ON' : 'OFF'))}</h3>
            <p>Offline Mode</p>
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

      ${activityEnabled ? `
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:800;font-size:14px">Recent activity</div>
            <div style="margin-top:6px;color:var(--text-muted);font-size:12px">Local history from what you do in the launcher.</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" class="btn btn-ghost btn-sm" id="tools-activity-clear">Clear</button>
          </div>
        </div>
        <div style="margin-top:12px">
          ${
            activity.length
              ? `<div style="display:flex;flex-direction:column;gap:8px">${activity
                  .map((a) => {
                    const ago = window.zenonActivity?.ago?.(a.t) || '';
                    const tint =
                      a.kind === 'success' ? 'var(--green)' : a.kind === 'error' ? 'var(--red)' : 'var(--accent)';
                    return `<div style="display:flex;gap:10px;align-items:flex-start">
                      <span style="width:10px;height:10px;border-radius:999px;background:${tint};margin-top:4px;flex-shrink:0"></span>
                      <div style="min-width:0">
                        <div style="color:var(--text-secondary);font-size:12px;word-break:break-word">${escapeHtml(a.text || '')}</div>
                        <div style="color:var(--text-muted);font-size:11px;margin-top:2px">${escapeHtml(ago)}</div>
                      </div>
                    </div>`;
                  })
                  .join('')}</div>`
              : `<div class="empty-inline discovery-hint">No activity yet — install a mod, export an instance, or host a server.</div>`
          }
        </div>
      </div>` : ''}

      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:800;font-size:14px">Import / Export</div>
            <div style="margin-top:6px;color:var(--text-muted);font-size:12px">Move instances between PCs or back them up.</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" class="btn btn-ghost" id="tools-import-instance-btn">Import instance zip</button>
            <button type="button" class="btn btn-primary" id="tools-new-instance-btn">New instance</button>
            <button type="button" class="btn btn-ghost" id="tools-clear-shared-cache-btn">Clear shared cache</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:800;font-size:14px">Auto RAM setup</div>
            <div style="margin-top:6px;color:var(--text-muted);font-size:12px">
              This install auto-picked RAM based on your device. Current: <code class="id-code">${escapeHtml(String(settings.minRam || ''))}</code> – <code class="id-code">${escapeHtml(String(settings.maxRam || ''))}</code>
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap;min-width:260px;color:var(--text-muted);font-size:12px">
            ${
              recRam?.success
                ? `Detected: <code class="id-code">${escapeHtml(String(recRam.totalMb))} MB</code> · Recommended: <code class="id-code">${escapeHtml(recRam.recommended.minRam)}</code> – <code class="id-code">${escapeHtml(recRam.recommended.maxRam)}</code>`
                : ''
            }
            <button type="button" class="btn btn-primary btn-sm" id="tools-auto-ram-btn">Auto-detect</button>
          </div>
        </div>
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
    </div>
  `;

  document.getElementById('tools-new-instance-btn')?.addEventListener('click', () => openCreateInstanceModal());

  document.getElementById('tools-open-selected-instance-btn')?.addEventListener('click', async () => {
    if (!selected) return;
    await window.zenon.openInstanceFolder(selected.id);
    window.zenonActivity?.add?.(`Opened instance folder: ${selected.name}`, 'info');
  });

  document.getElementById('tools-repair-selected-instance-btn')?.addEventListener('click', async () => {
    if (!selected) return;
    const res = await window.zenon.repairInstanceNow(selected.id);
    if (res?.success) {
      window.zenonActivity?.add?.(`Repaired instance: ${selected.name}`, 'success');
      showToast('Instance repaired', 'success');
    } else {
      window.zenonActivity?.add?.(`Repair failed: ${selected.name}`, 'error');
      showToast(res?.error || 'Repair failed', 'error', 4500);
    }
  });

  document.getElementById('tools-clear-instance-cache-btn')?.addEventListener('click', async () => {
    if (!selected) return;
    const res = await window.zenon.clearInstanceCache(selected.id);
    if (res?.success) {
      window.zenonActivity?.add?.(`Cleared cache: ${selected.name}`, 'success');
      showToast('Cache cleared', 'success');
    } else {
      window.zenonActivity?.add?.(`Clear cache failed: ${selected.name}`, 'error');
      showToast(res?.error || 'Could not clear cache', 'error', 4500);
    }
  });

  document.getElementById('tools-export-selected-instance-btn')?.addEventListener('click', async () => {
    if (!selected) return;
    const res = await window.zenon.exportInstance(selected.id);
    if (res?.canceled) return;
    if (res?.success) {
      window.zenonActivity?.add?.(`Exported instance: ${selected.name}`, 'success');
      showToast('Instance exported', 'success');
    } else {
      window.zenonActivity?.add?.(`Export failed: ${selected.name}`, 'error');
      showToast(`Export failed: ${res?.error || 'unknown error'}`, 'error', 4500);
    }
  });

  document.getElementById('tools-import-instance-btn')?.addEventListener('click', async () => {
    const res = await window.zenon.importInstance();
    if (res?.canceled) return;
    if (res?.success) {
      window.zenonActivity?.add?.(`Imported instance: ${res?.instance?.name || 'Instance'}`, 'success');
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

  document.getElementById('tools-clear-shared-cache-btn')?.addEventListener('click', async () => {
    if (!confirm('Clear shared cache? This may force re-downloads on next launch.')) return;
    const res = await window.zenon.clearSharedCache();
    if (res?.success) {
      window.zenonActivity?.add?.('Cleared shared cache', 'success');
      showToast('Shared cache cleared', 'success');
    } else {
      window.zenonActivity?.add?.('Clear shared cache failed', 'error');
      showToast(res?.error || 'Could not clear shared cache', 'error', 5000);
    }
  });

  // Auto RAM setup (Tools card)
  function ensureAutoRamModal() {
    // Reuse the Settings auto-ram overlay if it exists; otherwise create it here.
    let overlay = document.getElementById('ram-auto-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'ram-auto-overlay';
    overlay.className = 'ram-auto-overlay';
    overlay.innerHTML = `
      <div class="ram-auto-card" role="dialog" aria-modal="true" aria-label="Auto RAM setup">
        <div class="ram-auto-title">Auto RAM setup</div>
        <div class="ram-auto-sub" id="ram-auto-sub">Scanning your PC specs…</div>
        <div class="ram-auto-scan">
          <div class="ram-auto-scan-bar"></div>
        </div>
        <div class="ram-auto-meta" id="ram-auto-meta">This takes a moment.</div>
        <div class="ram-auto-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="ram-auto-cancel">Cancel</button>
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('show');
    });
    document.body.appendChild(overlay);
    overlay.querySelector('#ram-auto-cancel')?.addEventListener('click', () => overlay.classList.remove('show'));
    return overlay;
  }

  async function runAutoRamSetupFromTools() {
    const btn = document.getElementById('tools-auto-ram-btn');
    if (!btn) return;
    btn.disabled = true;

    const overlay = ensureAutoRamModal();
    overlay.classList.add('show');
    overlay.classList.remove('done');
    overlay.classList.remove('error');
    overlay.querySelector('#ram-auto-sub').textContent = 'Scanning your PC specs…';
    overlay.querySelector('#ram-auto-meta').textContent = 'This takes a moment.';

    try {
      const res = await window.zenon.getRamRecommendation();
      if (!res?.success) throw new Error(res?.error || 'Could not detect RAM');
      const totalMb = Number(res.totalMb) || 0;
      const rec = res.recommended || {};
      const maxRam = String(rec.maxRam || '').trim();
      const minRam = String(rec.minRam || '').trim();
      if (!maxRam || !minRam) throw new Error('Invalid RAM recommendation');

      const prev = await window.zenon.getSettings();
      const next = {
        ...prev,
        maxRam,
        minRam,
        ramAutoConfigured: true,
        ramDetectedMb: totalMb,
        ramRecommended: { minMb: rec.minMb, maxMb: rec.maxMb }
      };
      await window.zenon.saveSettings(next);
      State.settings = next;

      overlay.classList.add('done');
      overlay.querySelector('#ram-auto-sub').textContent = 'All set!';
      overlay.querySelector('#ram-auto-meta').textContent =
        `Detected ${Math.round(totalMb / 1024)} GB RAM → Recommended ${minRam}–${maxRam}`;
      setTimeout(() => overlay.classList.remove('show'), 1200);

      // Refresh Tools so the "Current" values update.
      setTimeout(() => renderTools().catch(() => {}), 250);
    } catch (e) {
      overlay.classList.add('error');
      overlay.querySelector('#ram-auto-sub').textContent = 'Auto setup failed';
      overlay.querySelector('#ram-auto-meta').textContent = e?.message || 'Unknown error';
    } finally {
      btn.disabled = false;
    }
  }

  document.getElementById('tools-auto-ram-btn')?.addEventListener('click', runAutoRamSetupFromTools);

  document.getElementById('tools-open-userdata-btn')?.addEventListener('click', async () => {
    await window.zenon.openUserDataFolder();
    window.zenonActivity?.add?.('Opened app data folder', 'info');
  });
  document.getElementById('tools-open-instances-root-btn')?.addEventListener('click', async () => {
    await window.zenon.openInstancesRootFolder();
    window.zenonActivity?.add?.('Opened instances folder', 'info');
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

  const statusEl = document.getElementById('tools-update-status');
  const progEl = document.getElementById('tools-update-progress');
  const installBtn = document.getElementById('tools-install-update-btn');

  const setUpdateStatus = (text) => {
    if (statusEl) statusEl.textContent = text || '';
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

  setUpdateStatus('Idle');

  document.getElementById('tools-check-updates-btn')?.addEventListener('click', async () => {
    const res = await window.zenon.updateCheck?.();
    if (res?.success) {
      window.zenonActivity?.add?.('Checked for updates', 'info');
      showToast('Checking for updates…', 'info', 1600);
    } else {
      window.zenonActivity?.add?.('Update check failed', 'error');
      showToast(res?.error || 'Update check failed', 'error', 4500);
    }
  });

  installBtn?.addEventListener('click', async () => {
    const res = await window.zenon.updateInstall?.();
    if (!res?.success) {
      window.zenonActivity?.add?.('Update install failed', 'error');
      showToast(res?.error || 'Could not install update', 'error', 5000);
    } else {
      window.zenonActivity?.add?.('Restarting to install update', 'info');
    }
  });

  document.getElementById('tools-activity-clear')?.addEventListener('click', () => {
    try {
      localStorage.removeItem('zenon.activity.v1');
    } catch (e) {}
    renderTools();
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

