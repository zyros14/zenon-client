// ===== Settings Page =====
async function renderSettings() {
  const content = document.getElementById('main-content');
  const settings = await window.zenon.getSettings();
  State.settings = settings;
  const authState = await window.zenon.authGetState();
  const themeId = typeof normalizeThemeId === 'function' ? normalizeThemeId(settings.theme) : 'zenon';

  content.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">SETTINGS</h1>
        <p class="page-subtitle">Configure your launcher preferences</p>
      </div>

      <!-- Account -->
      <div class="settings-section">
        <div class="settings-section-title">Account</div>

        <div class="settings-row">
          <div class="settings-label">
            <h4>Signed in</h4>
            <p>Your Minecraft profile used for launching</p>
          </div>
          <div class="settings-control" style="display:flex;justify-content:flex-end;gap:10px;align-items:center">
            <div style="color:var(--text-secondary);font-weight:600">
              ${authState?.profile?.name ? escapeHtml(authState.profile.name) : 'Not signed in'}
            </div>
            <button class="btn btn-ghost btn-sm" id="logout-btn">Logout</button>
          </div>
        </div>
      </div>

      <!-- Profile -->
      <div class="settings-section">
        <div class="settings-section-title">Profile</div>

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

      <!-- Java -->
      <div class="settings-section">
        <div class="settings-section-title">Java</div>

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
      </div>

      <!-- Launcher -->
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
            <h4>Close on Launch</h4>
            <p>Close the launcher when Minecraft starts</p>
          </div>
          <div class="settings-control" style="width:auto">
            <div class="toggle-switch ${settings.closeOnLaunch ? 'on' : ''}" id="set-close-on-launch"></div>
          </div>
        </div>
      </div>

      <!-- About -->
      <div class="settings-section">
        <div class="settings-section-title">About</div>
        <div style="display:flex;align-items:center;gap:20px;padding:8px 0">
          <img class="about-logo-img" src="assets/zenon-logo.png" alt="" draggable="false" />
          <div>
            <div style="font-family:var(--font-display);font-size:20px;font-weight:700;letter-spacing:1px">ZENON CLIENT</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Version 1.0.0 &nbsp;·&nbsp; Built with Electron &nbsp;·&nbsp; minecraft-launcher-core</div>
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:12px;padding-top:4px">
        <button class="btn btn-ghost" id="settings-reset-btn">Reset to Defaults</button>
        <button class="btn btn-primary" id="settings-save-btn">Save Settings</button>
      </div>
    </div>
  `;

  // Toggle
  const closeToggle = document.getElementById('set-close-on-launch');
  closeToggle.addEventListener('click', () => {
    closeToggle.classList.toggle('on');
  });
  const offlineToggle = document.getElementById('set-offline-enabled');
  offlineToggle?.addEventListener('click', () => offlineToggle.classList.toggle('on'));

  // Save
  document.getElementById('settings-save-btn').addEventListener('click', async () => {
    const prev = await window.zenon.getSettings();
    const themeRaw = document.getElementById('set-theme').value;
    const newSettings = {
      ...prev,
      username: document.getElementById('set-username').value.trim() || 'Player',
      offlineEnabled: offlineToggle?.classList.contains('on') || false,
      javaPath: document.getElementById('set-java').value.trim() || 'java',
      maxRam: document.getElementById('set-max-ram').value,
      minRam: document.getElementById('set-min-ram').value,
      theme: typeof normalizeThemeId === 'function' ? normalizeThemeId(themeRaw) : themeRaw,
      closeOnLaunch: closeToggle.classList.contains('on')
    };

    await window.zenon.saveSettings(newSettings);
    State.settings = newSettings;
    if (typeof applyTheme === 'function') applyTheme(newSettings.theme);
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
      javaPath: 'java',
      maxRam: '2G',
      minRam: '512M',
      theme: 'zenon',
      closeOnLaunch: false
    };
    await window.zenon.saveSettings(defaults);
    State.settings = defaults;
    if (typeof applyTheme === 'function') applyTheme('zenon');
    showToast('Settings reset to defaults', 'info');
    renderSettings();
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async () => {
    if (!confirm('Logout from Microsoft?')) return;
    await window.zenon.authLogout();
    showToast('Logged out', 'info');
    await ensureLoggedInOrShowAuth();
    renderSettings();
  });
}
