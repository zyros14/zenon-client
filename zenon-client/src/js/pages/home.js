// ===== Home Page =====
async function renderHome() {
  const content = document.getElementById('main-content');
  const instances = State.instances;
  const totalMods = await getTotalMods(instances);
  const activityEnabled = !!(State.settings && State.settings.recentActionsEnabled);
  const activity = activityEnabled ? (window.zenonActivity?.list?.(3) || []) : [];
  const sel = State.selectedInstance;
  const running = !!(sel && State.runningInstanceId && State.runningInstanceId === sel.id);
  const launching = !!State.isLaunching;
  const continueLabel = !sel ? 'Select an Instance' : running ? 'Stop' : launching ? 'Launching…' : 'Play';
  const continueSub =
    !sel
      ? 'Pick an instance to see quick controls.'
      : running
        ? 'Minecraft is running — you can stop it anytime.'
        : launching
          ? 'Launch in progress — check Logs for details.'
          : 'Ready to launch with your current settings.';

  const tips = [
    { t: 'Use Library → Browse & install', d: 'Install mods from Modrinth scoped to your instance version + loader.' },
    { t: 'Stop during launch works', d: 'If a launch hangs, hit Stop — Zenon will kill the game process tree.' },
    { t: 'Auto RAM setup', d: 'Tools → Auto RAM setup can tune your min/max RAM based on total system memory.' }
  ];

  content.innerHTML = `
    <div class="page">
      <div class="home-hero">
        <h1>ZENON CLIENT</h1>
        <p>Your modern Minecraft launcher. Manage instances, install mods, and launch your game — all in one place.</p>
        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" id="hero-launch-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;stroke:white">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            ${State.selectedInstance ? `Launch ${State.selectedInstance.name}` : 'Select an Instance'}
          </button>
          <button class="btn btn-ghost btn-lg" id="hero-new-instance-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Instance
          </button>
        </div>
      </div>

      <div class="home-grid">
        <div class="home-panel glow-card home-continue">
          <div class="home-panel-top">
            <div>
              <div class="home-panel-title">Continue</div>
              <div class="home-panel-sub">${escapeHtml(continueSub)}</div>
            </div>
            <div class="home-panel-chip ${running ? 'is-running' : launching ? 'is-launching' : ''}">
              ${running ? 'RUNNING' : launching ? 'LAUNCHING' : sel ? 'READY' : '—'}
            </div>
          </div>
          <div class="home-continue-body">
            <div class="home-continue-left">
              <div class="home-continue-icon">${sel ? getInstanceIcon(sel) : '?'}</div>
              <div style="min-width:0">
                <div class="home-continue-name">${escapeHtml(sel?.name || 'No instance selected')}</div>
                <div class="home-continue-meta">${escapeHtml(sel ? instanceSubtitle(sel) : 'Create or select an instance to get started.')}</div>
              </div>
            </div>
            <div class="home-continue-actions">
              <button type="button" class="btn ${running ? 'btn-danger' : 'btn-play'}" id="home-continue-btn" ${sel ? '' : 'disabled'}>
                ${running
                  ? `<svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`
                  : `<svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><polygon points="5 3 19 12 5 21 5 3"/></svg>`
                }
                ${escapeHtml(continueLabel)}
              </button>
              <button type="button" class="btn btn-ghost" id="home-open-library" ${sel ? '' : 'disabled'}>Open Library</button>
              <button type="button" class="btn btn-ghost" id="home-open-folder" ${sel ? '' : 'disabled'}>Open Folder</button>
            </div>
          </div>
        </div>

        <div class="home-panel glow-card home-tips">
          <div class="home-panel-title">Tips</div>
          <div class="home-tips-list">
            ${tips
              .map(
                (x) => `<div class="home-tip">
                  <div class="home-tip-title">${escapeHtml(x.t)}</div>
                  <div class="home-tip-desc">${escapeHtml(x.d)}</div>
                </div>`
              )
              .join('')}
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:18px">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:800;font-size:14px">Quick actions</div>
            <div style="margin-top:6px;color:var(--text-muted);font-size:12px">The most-used things, kept small.</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" class="btn btn-ghost" id="home-open-instances-root">Open instances folder</button>
            <button type="button" class="btn btn-ghost" id="home-check-updates">Check updates</button>
            <button type="button" class="btn btn-primary" id="home-go-tools">Tools</button>
          </div>
        </div>
      </div>

      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-icon stat-icon-blue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          </div>
          <div class="stat-info">
            <h3>${instances.length}</h3>
            <p>Instances</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon-green">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          </div>
          <div class="stat-info">
            <h3>${totalMods}</h3>
            <p>Total Mods</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon-purple">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
          </div>
          <div class="stat-info">
            <h3>${State.auth?.profile?.name ? escapeHtml(State.auth.profile.name) : 'Signed out'}</h3>
            <p>Account</p>
          </div>
        </div>
      </div>

      ${activityEnabled ? `
      <div class="card" style="margin-bottom:22px">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:800;font-size:14px">Recent activity</div>
            <div style="margin-top:6px;color:var(--text-muted);font-size:12px">Last few actions in the launcher.</div>
          </div>
        </div>
        <div style="margin-top:12px">
          ${
            activity.length
              ? `<div style="display:flex;flex-direction:column;gap:8px">${activity
                  .map((a) => `<div style="display:flex;gap:10px;align-items:flex-start">
                    <span style="width:10px;height:10px;border-radius:999px;background:${a.kind === 'success' ? 'var(--green)' : a.kind === 'error' ? 'var(--red)' : 'var(--accent)'};margin-top:4px;flex-shrink:0"></span>
                    <div style="min-width:0">
                      <div style="color:var(--text-secondary);font-size:12px;word-break:break-word">${escapeHtml(a.text || '')}</div>
                      <div style="color:var(--text-muted);font-size:11px;margin-top:2px">${escapeHtml(window.zenonActivity?.ago?.(a.t) || '')}</div>
                    </div>
                  </div>`)
                  .join('')}</div>`
              : `<div class="empty-inline discovery-hint">Nothing yet — install a mod, export an instance, or host a server.</div>`
          }
        </div>
      </div>` : ''}

      <div class="recent-section">
        <h2>Recent Instances</h2>
        <div class="recent-instances" id="recent-instances-grid">
          ${instances.length === 0
            ? `<div style="grid-column:1/-1"><div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                <h3>No instances yet</h3>
                <p>Create your first instance to get started</p>
              </div></div>`
            : instances.slice(0, 6).map(inst => `
              <div class="recent-instance-card" data-id="${inst.id}">
                <div class="ric-icon">${getInstanceIcon(inst)}</div>
                <div class="ric-name">${escapeHtml(inst.name)}</div>
                <div class="ric-meta">
                  <span class="tag tag-version">${inst.version}</span>
                  ${
                    inst.loader === 'fabric'
                      ? '<span class="tag tag-fabric">Fabric</span>'
                      : inst.loader === 'forge'
                        ? '<span class="tag tag-forge">Forge</span>'
                        : inst.loader !== 'vanilla'
                          ? `<span class="tag tag-version">${escapeHtml(inst.loader)}</span>`
                          : ''
                  }
                </div>
                <div class="ric-meta" style="margin-top:4px">Played ${formatDate(inst.lastPlayed)}</div>
              </div>
            `).join('')
          }
        </div>
      </div>
    </div>
  `;

  // Events
  document.getElementById('hero-launch-btn').addEventListener('click', () => {
    if (State.selectedInstance) {
      launchInstance(State.selectedInstance.id);
    } else {
      navigateTo('library', { force: true });
      showToast('Select an instance first', 'info');
    }
  });

  document.getElementById('hero-new-instance-btn').addEventListener('click', () => {
    openCreateInstanceModal();
  });

  document.getElementById('home-continue-btn')?.addEventListener('click', async () => {
    const inst = State.selectedInstance;
    if (!inst) return;
    if (State.runningInstanceId && State.runningInstanceId === inst.id) {
      try { State.launchConsole.stopRequestedAt = Date.now(); } catch (e0) {}
      const r = await window.zenon.stopGame();
      if (!r?.success) showToast(r?.error || 'Stop failed', 'error', 4500);
      else showToast('Stopping game…', 'info', 1600);
    } else {
      launchInstance(inst.id);
    }
  });
  document.getElementById('home-open-library')?.addEventListener('click', () => {
    State.libraryPane = 'content';
    navigateTo('library', { force: true });
  });
  document.getElementById('home-open-folder')?.addEventListener('click', async () => {
    const inst = State.selectedInstance;
    if (!inst) return;
    await window.zenon.openInstanceFolder(inst.id);
    window.zenonActivity?.add?.(`Opened instance folder: ${inst.name}`, 'info');
  });

  document.getElementById('home-open-instances-root')?.addEventListener('click', async () => {
    await window.zenon.openInstancesRootFolder();
    window.zenonActivity?.add?.('Opened instances folder', 'info');
  });
  document.getElementById('home-check-updates')?.addEventListener('click', async () => {
    const res = await window.zenon.updateCheck?.();
    if (res?.success) {
      window.zenonActivity?.add?.('Checked for updates', 'info');
      showToast('Checking for updates…', 'info', 1600);
    } else {
      window.zenonActivity?.add?.('Update check failed', 'error');
      showToast(res?.error || 'Update check failed', 'error', 4500);
    }
  });
  document.getElementById('home-go-tools')?.addEventListener('click', () => navigateTo('tools', { force: true }));

  document.querySelectorAll('.recent-instance-card').forEach(card => {
    card.addEventListener('click', () => {
      const inst = State.instances.find(i => i.id === card.dataset.id);
      if (inst) {
        State.selectedInstance = inst;
        updateSidebarBadge();
        State.libraryPane = 'content';
        navigateTo('library', { force: true });
      }
    });
  });
}

async function getTotalMods(instances) {
  let total = 0;
  for (const inst of instances) {
    try {
      const mods = await window.zenon.getMods(inst.id);
      total += mods.length;
    } catch (e) {}
  }
  return total;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
