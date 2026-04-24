// ===== Settings Page =====
async function renderSettings() {
  const content = document.getElementById('main-content');
  const settings = await window.zenon.getSettings();
  State.settings = settings;
  const authState = await window.zenon.authGetState();
  const accountsState = await (window.zenon.accountsList ? window.zenon.accountsList() : Promise.resolve({ accounts: [], activeAccountId: '' }));
  const cfState = await (window.zenon.curseforgeHasKey ? window.zenon.curseforgeHasKey() : Promise.resolve({ available: false, hasKey: false }));
  const themeId = typeof normalizeThemeId === 'function' ? normalizeThemeId(settings.theme) : 'zenon';
  let appMeta = { version: '', name: 'Zenon Client' };
  try {
    if (window.zenon.getAppVersion) appMeta = (await window.zenon.getAppVersion()) || appMeta;
  } catch (e) {}
  const aboutVersion = appMeta?.version ? String(appMeta.version) : '';
  const accounts = Array.isArray(accountsState?.accounts) ? accountsState.accounts : [];
  const activeAccountId = String(accountsState?.activeAccountId || '');
  const activeAccount = accounts.find((a) => a && a.id === activeAccountId) || accounts[0] || null;

  const TABS = [
    { id: 'account', label: 'Account' },
    { id: 'launcher', label: 'Launcher' },
    { id: 'java', label: 'Java & RAM' },
    { id: 'updates', label: 'Updates' },
    { id: 'about', label: 'About' }
  ];
  const activeTab = window.__settingsTab || 'account';
  content.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">SETTINGS</h1>
        <p class="page-subtitle">Configure your launcher preferences</p>
      </div>

      <div class="id-kind-pills" id="settings-tab-pills" style="margin-bottom:18px">
        ${TABS.map((t) => `<button type="button" class="id-pill ${t.id === activeTab ? 'active' : ''}" data-settab="${t.id}">${t.label}</button>`).join('')}
      </div>

      <div data-stab="account" style="display:${activeTab === 'account' ? 'block' : 'none'}">
        <div class="settings-section">
          <div class="settings-section-title">Account & Profile</div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Active account</h4>
              <p>Choose which profile is used when launching</p>
            </div>
            <div class="settings-control" style="display:flex;justify-content:flex-end;gap:10px;align-items:center">
              <div style="color:var(--text-secondary);font-weight:600">
                ${activeAccount?.label ? escapeHtml(activeAccount.label) : (authState?.profile?.name ? escapeHtml(authState.profile.name) : 'No account')}
              </div>
              <button class="btn btn-ghost btn-sm" id="logout-btn" ${activeAccount ? '' : 'disabled'}>Remove</button>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Accounts</h4>
              <p>Add multiple Microsoft accounts and offline profiles, then switch any time</p>
            </div>
            <div class="settings-control" style="width:420px;max-width:100%">
              <div id="accounts-list" style="display:flex;flex-direction:column;gap:8px;min-width:0">
                ${
                  accounts.length
                    ? accounts.map((a) => `
                      <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;border:1px solid var(--border);background:rgba(255,255,255,0.02);padding:10px 12px;border-radius:var(--radius-md);min-width:0">
                        <div style="min-width:0">
                          <div style="font-weight:700;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">
                            ${escapeHtml(a.label || a.name || 'Account')}
                          </div>
                          <div style="margin-top:2px;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em">
                            ${escapeHtml((a.type || 'online') === 'offline' ? 'offline' : 'microsoft')}
                            ${a.id === activeAccountId ? ' · active' : ''}
                          </div>
                        </div>
                        <div style="display:flex;gap:8px;flex-shrink:0">
                          <button type="button" class="btn btn-ghost btn-sm" data-acct-set="${escapeHtml(a.id)}" ${a.id === activeAccountId ? 'disabled' : ''}>Use</button>
                          <button type="button" class="btn btn-ghost btn-sm" data-acct-remove="${escapeHtml(a.id)}">Remove</button>
                        </div>
                      </div>
                    `).join('')
                    : `<div class="empty-inline discovery-hint">No accounts yet. Add Microsoft or offline below.</div>`
                }
              </div>
              <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px">
                <button type="button" class="btn btn-primary btn-sm" id="acct-add-ms-btn">Add Microsoft</button>
                <button type="button" class="btn btn-ghost btn-sm" id="acct-add-offline-btn">Add offline</button>
              </div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Username</h4>
              <p>Used for offline mode (and as a fallback if you’re signed out)</p>
            </div>
            <div class="settings-control">
              <input type="text" class="form-input" id="set-username" value="${escapeHtml(settings.username || 'Player')}" placeholder="Player" />
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Offline mode</h4>
              <p>Allow using the launcher and launching without Microsoft sign-in</p>
            </div>
            <div class="settings-control" style="width:auto">
              <div class="toggle-switch ${settings.offlineEnabled ? 'on' : ''}" id="set-offline-enabled"></div>
            </div>
          </div>
        </div>
      </div>

      <div data-stab="launcher" style="display:${activeTab === 'launcher' ? 'block' : 'none'}">
        <div class="settings-section">
          <div class="settings-section-title">Launcher</div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Theme</h4>
              <p>Color preset for the launcher interface</p>
            </div>
            <div class="settings-control">
              <select class="form-select" id="set-theme">
                <option value="zenon" ${themeId === 'zenon' ? 'selected' : ''}>Zenon (default)</option>
                <option value="midnight" ${themeId === 'midnight' ? 'selected' : ''}>Midnight</option>
                <option value="aurora" ${themeId === 'aurora' ? 'selected' : ''}>Aurora</option>
                <option value="slate" ${themeId === 'slate' ? 'selected' : ''}>Slate</option>
                <option value="paper" ${themeId === 'paper' ? 'selected' : ''}>Paper (light)</option>
              </select>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Hardware acceleration</h4>
              <p>Uses your GPU for smoother UI. Turn off if you see black screens or flickering (restart required)</p>
            </div>
            <div class="settings-control" style="width:auto">
              <div class="toggle-switch ${settings.disableHardwareAcceleration ? '' : 'on'}" id="set-hw-accel"></div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>What's new popup</h4>
              <p>Show a “What’s new” popup after installing an update</p>
            </div>
            <div class="settings-control" style="width:auto">
              <div class="toggle-switch ${settings.whatsNewEnabled === false ? '' : 'on'}" id="set-whatsnew-enabled"></div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>CurseForge API key</h4>
              <p>Enables CurseForge search/install. Stored encrypted on this PC only.</p>
            </div>
            <div class="settings-control" style="display:flex;justify-content:flex-end;gap:10px;align-items:center;flex-wrap:wrap;width:auto">
              <div style="color:var(--text-secondary);font-weight:600">
                ${cfState?.available ? (cfState?.hasKey ? 'Set' : 'Not set') : 'Unavailable'}
              </div>
              <button type="button" class="btn btn-primary btn-sm" id="cf-set-key-btn" ${cfState?.available ? '' : 'disabled'}>Set key</button>
              <button type="button" class="btn btn-ghost btn-sm" id="cf-clear-key-btn" ${(cfState?.available && cfState?.hasKey) ? '' : 'disabled'}>Clear</button>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Close on Launch</h4>
              <p>Close the launcher when Minecraft starts</p>
            </div>
            <div class="settings-control" style="width:auto">
              <div class="toggle-switch ${settings.closeOnLaunch ? 'on' : ''}" id="set-close-on-launch"></div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>UI sounds</h4>
              <p>Click / hover sounds in the launcher UI</p>
            </div>
            <div class="settings-control" style="width:auto">
              <div class="toggle-switch ${settings.soundsEnabled ? 'on' : ''}" id="set-sounds-enabled"></div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Recent actions</h4>
              <p>Show and record the Recent activity feed on Home/Tools</p>
            </div>
            <div class="settings-control" style="width:auto">
              <div class="toggle-switch ${settings.recentActionsEnabled ? 'on' : ''}" id="set-recent-actions-enabled"></div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Reduce motion</h4>
              <p>Disable UI animations and transitions</p>
            </div>
            <div class="settings-control" style="width:auto">
              <div class="toggle-switch ${settings.reduceMotion ? 'on' : ''}" id="set-reduce-motion"></div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Auto-install dependencies</h4>
              <p>When installing a mod, automatically install required dependencies</p>
            </div>
            <div class="settings-control" style="width:auto">
              <div class="toggle-switch ${settings.autoInstallDependencies === false ? '' : 'on'}" id="set-auto-install-deps"></div>
            </div>
          </div>
        </div>
      </div>

      <div data-stab="java" style="display:${activeTab === 'java' ? 'block' : 'none'}">
        <div class="settings-section">
          <div class="settings-section-title">Java & RAM</div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Java Path</h4>
              <p>Path to Java executable (leave as "java" to use system default)</p>
            </div>
            <div class="settings-control">
              <input type="text" class="form-input" id="set-java" value="${escapeHtml(settings.javaPath || 'java')}" placeholder="java" />
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Maximum RAM</h4>
              <p>Maximum memory allocated to Minecraft</p>
            </div>
            <div class="settings-control">
              <select class="form-select" id="set-max-ram">
                ${['512M','1G','2G','3G','4G','6G','8G','12G','16G'].map(v =>
                  `<option value="${v}" ${settings.maxRam === v ? 'selected' : ''}>${v}</option>`
                ).join('')}
              </select>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Minimum RAM</h4>
              <p>Minimum memory allocated to Minecraft</p>
            </div>
            <div class="settings-control">
              <select class="form-select" id="set-min-ram">
                ${['256M','512M','1G','2G'].map(v =>
                  `<option value="${v}" ${settings.minRam === v ? 'selected' : ''}>${v}</option>`
                ).join('')}
              </select>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Auto RAM setup</h4>
              <p>Detect your PC specs and set recommended RAM automatically</p>
            </div>
            <div class="settings-control" style="width:auto;display:flex;justify-content:flex-end">
              <button type="button" class="btn btn-primary btn-sm" id="set-auto-ram-btn">Auto-detect</button>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Download speed</h4>
              <p>Parallel download sockets for Minecraft assets (higher = faster first-time downloads)</p>
            </div>
            <div class="settings-control">
              <select class="form-select" id="set-mc-sockets">
                ${[8, 16, 24, 32, 40, 48, 64].map(n => `<option value="${n}" ${(settings.mcDownloadSockets || 40) === n ? 'selected' : ''}>${n}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div data-stab="updates" style="display:${activeTab === 'updates' ? 'block' : 'none'}">
        <div class="settings-section">
          <div class="settings-section-title">Updates</div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Auto-check updates</h4>
              <p>Check for updates automatically on startup (packaged builds)</p>
            </div>
            <div class="settings-control" style="width:auto">
              <div class="toggle-switch ${settings.autoCheckUpdates === false ? '' : 'on'}" id="set-auto-check-updates"></div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <h4>Update reminder</h4>
              <p>Show a reminder banner when an update is ready</p>
            </div>
            <div class="settings-control" style="width:auto">
              <div class="toggle-switch on" id="set-update-reminder" data-hard-on="true"></div>
            </div>
          </div>
          <div class="empty-inline discovery-hint">Update downloads are handled in Tools → Updates.</div>
        </div>
      </div>

      <div data-stab="about" style="display:${activeTab === 'about' ? 'block' : 'none'}">
        <div class="settings-section">
          <div class="settings-section-title">About</div>
          <div style="display:flex;align-items:center;gap:20px;padding:8px 0">
            <img class="about-logo-img" src="assets/zenon-logo.png" alt="" draggable="false" />
            <div>
              <div style="font-family:var(--font-display);font-size:20px;font-weight:700;letter-spacing:1px">ZENON CLIENT</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Version ${escapeHtml(aboutVersion || 'dev')} &nbsp;·&nbsp; minecraft-launcher-core</div>
            </div>
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:12px;padding-top:4px">
        <button class="btn btn-ghost" id="settings-reset-btn">Reset to Defaults</button>
        <button class="btn btn-primary" id="settings-save-btn">Save Settings</button>
      </div>
    </div>
  `;

  // Tabs
  document.getElementById('settings-tab-pills')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-settab]');
    if (!b) return;
    window.__settingsTab = b.getAttribute('data-settab') || 'account';
    renderSettings();
  });

  // Toggles
  const toggleIds = [
    'set-close-on-launch',
    'set-offline-enabled',
    'set-sounds-enabled',
    'set-recent-actions-enabled',
    'set-reduce-motion',
    'set-auto-install-deps',
    'set-auto-check-updates',
    'set-hw-accel',
    'set-whatsnew-enabled'
  ];
  toggleIds.forEach((id) => document.getElementById(id)?.addEventListener('click', (e) => e.currentTarget.classList.toggle('on')));

  function ensureAutoRamModal() {
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

  async function runAutoRamSetup() {
    const btn = document.getElementById('set-auto-ram-btn');
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

      // Apply immediately to the UI.
      const maxSel = document.getElementById('set-max-ram');
      const minSel = document.getElementById('set-min-ram');
      if (maxSel) maxSel.value = maxRam;
      if (minSel) minSel.value = minRam;

      // Persist immediately to settings.
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
    } catch (e) {
      overlay.classList.add('error');
      overlay.querySelector('#ram-auto-sub').textContent = 'Auto setup failed';
      overlay.querySelector('#ram-auto-meta').textContent = e?.message || 'Unknown error';
    } finally {
      btn.disabled = false;
    }
  }

  document.getElementById('set-auto-ram-btn')?.addEventListener('click', runAutoRamSetup);

  // Save
  document.getElementById('settings-save-btn').addEventListener('click', async () => {
    const prev = await window.zenon.getSettings();
    const themeRaw = document.getElementById('set-theme')?.value || prev.theme;
    const disableHardwareAcceleration = !(document.getElementById('set-hw-accel')?.classList.contains('on') || false);
    const whatsNewEnabled = document.getElementById('set-whatsnew-enabled')?.classList.contains('on') || false;
    const newSettings = {
      ...prev,
      username: document.getElementById('set-username')?.value?.trim() || prev.username || 'Player',
      offlineEnabled: document.getElementById('set-offline-enabled')?.classList.contains('on') || false,
      soundsEnabled: document.getElementById('set-sounds-enabled')?.classList.contains('on') || false,
      recentActionsEnabled: document.getElementById('set-recent-actions-enabled')?.classList.contains('on') || false,
      reduceMotion: document.getElementById('set-reduce-motion')?.classList.contains('on') || false,
      autoInstallDependencies: document.getElementById('set-auto-install-deps')?.classList.contains('on') || false,
      autoCheckUpdates: document.getElementById('set-auto-check-updates')?.classList.contains('on') || false,
      javaPath: document.getElementById('set-java')?.value?.trim() || prev.javaPath || 'java',
      maxRam: document.getElementById('set-max-ram')?.value || prev.maxRam,
      minRam: document.getElementById('set-min-ram')?.value || prev.minRam,
      mcDownloadSockets: parseInt(document.getElementById('set-mc-sockets')?.value || String(prev.mcDownloadSockets || 40), 10) || 40,
      theme: typeof normalizeThemeId === 'function' ? normalizeThemeId(themeRaw) : themeRaw,
      closeOnLaunch: document.getElementById('set-close-on-launch')?.classList.contains('on') || false,
      disableHardwareAcceleration,
      whatsNewEnabled
    };

    await window.zenon.saveSettings(newSettings);
    State.settings = newSettings;
    if (typeof applyTheme === 'function') applyTheme(newSettings.theme);
    window.__zenonSoundsEnabled = !!newSettings.soundsEnabled;
    window.__zenonRecentActionsEnabled = !!newSettings.recentActionsEnabled;
    if (typeof applyReduceMotion === 'function') applyReduceMotion(!!newSettings.reduceMotion);
    if (!!prev.disableHardwareAcceleration !== !!newSettings.disableHardwareAcceleration) {
      showToast('Hardware acceleration will apply after restart.', 'info');
    }
    showToast('Settings saved!', 'success');
  });

  // Reset
  document.getElementById('settings-reset-btn').addEventListener('click', async () => {
    if (!confirm('Reset all settings to defaults?')) return;
    const prev = await window.zenon.getSettings();
    const defaults = {
      ...prev,
      username: 'Player',
      offlineEnabled: false,
      soundsEnabled: false,
      recentActionsEnabled: false,
      reduceMotion: false,
      autoInstallDependencies: true,
      autoCheckUpdates: true,
      javaPath: 'java',
      maxRam: '2G',
      minRam: '512M',
      theme: 'zenon',
      closeOnLaunch: false,
      mcDownloadSockets: 40,
      disableHardwareAcceleration: false,
      whatsNewEnabled: true
    };
    await window.zenon.saveSettings(defaults);
    State.settings = defaults;
    if (typeof applyTheme === 'function') applyTheme('zenon');
    window.__zenonSoundsEnabled = false;
    window.__zenonRecentActionsEnabled = false;
    if (typeof applyReduceMotion === 'function') applyReduceMotion(false);
    showToast('Settings reset to defaults', 'info');
    renderSettings();
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async () => {
    if (!activeAccountId) return;
    if (!confirm('Remove the active account?')) return;
    if (window.zenon.accountsRemove) {
      await window.zenon.accountsRemove(activeAccountId);
      showToast('Account removed', 'info');
      renderSettings();
      return;
    }
    await window.zenon.authLogout();
    showToast('Logged out', 'info');
    await ensureLoggedInOrShowAuth();
    renderSettings();
  });

  // Account buttons
  document.getElementById('accounts-list')?.addEventListener('click', async (e) => {
    const setBtn = e.target.closest('[data-acct-set]');
    if (setBtn) {
      const id = setBtn.getAttribute('data-acct-set');
      if (id && window.zenon.accountsSetActive) {
        await window.zenon.accountsSetActive(id);
        showToast('Active account updated', 'success', 1800);
        renderSettings();
      }
      return;
    }
    const rmBtn = e.target.closest('[data-acct-remove]');
    if (rmBtn) {
      const id = rmBtn.getAttribute('data-acct-remove');
      if (!id) return;
      if (!confirm('Remove this account?')) return;
      if (window.zenon.accountsRemove) {
        await window.zenon.accountsRemove(id);
        showToast('Account removed', 'info');
        renderSettings();
      }
    }
  });

  document.getElementById('acct-add-offline-btn')?.addEventListener('click', async () => {
    const name = prompt('Offline username', 'Player');
    if (!name) return;
    if (window.zenon.accountsAddOffline) {
      await window.zenon.accountsAddOffline(name);
      showToast(`Offline profile added: ${name}`, 'success', 2000);
      renderSettings();
      return;
    }
    // legacy fallback
    const prev = await window.zenon.getSettings();
    const next = { ...prev, username: name, offlineEnabled: true };
    await window.zenon.saveSettings(next);
    State.settings = next;
    showToast(`Offline mode: ${name}`, 'info', 2200);
    renderSettings();
  });

  document.getElementById('acct-add-ms-btn')?.addEventListener('click', async () => {
    // Reuse the existing auth overlay flow to add an additional Microsoft account.
    try {
      if (typeof ensureAuthOverlay === 'function') ensureAuthOverlay();
      if (typeof startMicrosoftLogin === 'function') startMicrosoftLogin();
      else showToast('Auth UI not available', 'error', 2500);
    } catch (e) {
      showToast(e?.message || 'Could not start Microsoft login', 'error', 3000);
    }
  });

  // CurseForge key
  document.getElementById('cf-set-key-btn')?.addEventListener('click', async () => {
    try {
      const key = prompt('Paste your CurseForge API key');
      if (!key) return;
      const r = await window.zenon.curseforgeSetKey?.(key);
      if (!r?.success) throw new Error(r?.error || 'Could not save key');
      showToast('CurseForge key saved (encrypted)', 'success', 2200);
      renderSettings();
    } catch (e) {
      showToast(e?.message || 'Could not save key', 'error', 3500);
    }
  });
  document.getElementById('cf-clear-key-btn')?.addEventListener('click', async () => {
    try {
      if (!confirm('Clear the saved CurseForge key from this PC?')) return;
      const r = await window.zenon.curseforgeClearKey?.();
      if (!r?.success) throw new Error(r?.error || 'Could not clear key');
      showToast('CurseForge key cleared', 'info', 2000);
      renderSettings();
    } catch (e) {
      showToast(e?.message || 'Could not clear key', 'error', 3500);
    }
  });
}
