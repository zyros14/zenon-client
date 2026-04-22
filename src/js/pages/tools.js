// ===== Tools Page =====
async function renderTools() {
  const content = document.getElementById('main-content');
  const settings = await window.zenon.getSettings();
  const selected = State.selectedInstance;

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
            <button type="button" class="btn btn-ghost" id="tools-export-selected-instance-btn" ${selected ? '' : 'disabled'}>Export selected</button>
          </div>
        </div>
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
}

window.renderTools = renderTools;

