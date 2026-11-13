// ===== Settings Page =====
/** Build RAM allocation options (MB values) up to the detected system RAM. */
function ramOptionValues(totalMb) {
  // Cap the selectable max at a whole-GB value ≤ installed RAM (e.g. 63G on a 65407 MB machine).
  const maxMb = Math.max(1024, Math.floor(totalMb / 1024) * 1024);
  const vals = [512];
  for (let g = 1; g <= 16; g++) vals.push(g * 1024); // 1G … 16G in 1G steps
  for (let g = 20; g <= Math.floor(maxMb / 1024); g += 4) vals.push(g * 1024); // then 4G steps
  vals.push(maxMb); // hard max ≈ all installed RAM
  return [...new Set(vals.filter((v) => v <= maxMb))].sort((a, b) => a - b);
}

function ramOptionLabel(mb) {
  return mb % 1024 === 0 ? `${mb / 1024}G` : `${mb}M`;
}

/** Full option list as MB, always including the currently-selected value. */
function ramSelectOptions(totalMb, selectedStr, fallbackMb) {
  let selectedMb = 0;
  const t = String(selectedStr || '').trim().toUpperCase();
  const gm = t.match(/^([\d.]+)\s*G$/);
  if (gm) selectedMb = Math.round(parseFloat(gm[1]) * 1024);
  else {
    const mm = t.match(/^([\d.]+)\s*M$/);
    if (mm) selectedMb = Math.round(parseFloat(mm[1]));
  }
  if (!selectedMb) selectedMb = fallbackMb;
  const maxMb = Math.max(1024, Math.floor(totalMb / 1024) * 1024);
  selectedMb = Math.min(selectedMb, maxMb);
  const vals = ramOptionValues(totalMb);
  if (!vals.includes(selectedMb)) {
    vals.push(selectedMb);
    vals.sort((a, b) => a - b);
  }
  return vals.map((v) => `<option value="${ramOptionLabel(v)}" ${v === selectedMb ? 'selected' : ''}>${ramOptionLabel(v)}</option>`).join('');
}

async function renderSettings() {
  const content = document.getElementById('main-content');
  const settings = await window.zenon.getSettings();
  State.settings = settings;
  const authState = await window.zenon.authGetState();
  const themeId = typeof normalizeThemeId === 'function' ? normalizeThemeId(settings.theme) : 'zenon';

  let sys = null;
  try { sys = await window.zenon.getSystemInfo(); } catch (e) {}
  const totalMb = sys?.totalMemMb || 65536;
  const recMaxMb = sys?.recommendedMaxMb || 16384;
  State.systemInfo = sys || { totalMemMb: totalMb, recommendedMaxMb: recMaxMb };
  const totalGbLabel = Math.floor(totalMb / 1024);

  content.innerHTML = `
    <div class="page">
      <div class="page-header">
        <span class="page-kicker">Preferences</span>
        <h1 class="page-title">Settings</h1>
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
            <p>Maximum memory allocated to Minecraft — up to all ${totalGbLabel} GB of RAM detected on this PC</p>
          </div>
          <div class="settings-control">
            <select class="form-select" id="set-max-ram">
              ${ramSelectOptions(totalMb, settings.maxRam, recMaxMb)}
            </select>
          </div>
        </div>

        <div class="settings-row">
          <div class="settings-label">
            <h4>Minimum RAM</h4>
            <p>Starting memory for the JVM (recommended: 512M)</p>
          </div>
          <div class="settings-control">
            <select class="form-select" id="set-min-ram">
              ${(() => {
                const base = [256, 512, 1024, 2048, 4096, 8192].filter((v) => v <= totalMb);
                const cur = (() => {
                  const t = String(settings.minRam || '').trim().toUpperCase();
                  const gm = t.match(/^([\d.]+)\s*G$/);
                  if (gm) return Math.round(parseFloat(gm[1]) * 1024);
                  const mm = t.match(/^([\d.]+)\s*M$/);
                  if (mm) return Math.round(parseFloat(mm[1]) * 1024);
                  return 512;
                })();
                if (!base.includes(cur)) { base.push(Math.min(cur, totalMb)); base.sort((a, b) => a - b); }
                return base.map((v) => `<option value="${ramOptionLabel(v)}" ${v === cur ? 'selected' : ''}>${ramOptionLabel(v)}</option>`).join('');
              })()}
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

      <!-- Updates -->
      <div class="settings-section">
        <div class="settings-section-title">Updates</div>
        <div class="settings-row">
          <div class="settings-label">
            <h4>Auto-check updates</h4>
            <p>Check for updates automatically on startup (packaged builds only)</p>
          </div>
          <div class="settings-control" style="width:auto">
            <div class="toggle-switch ${settings.autoCheckUpdates === false ? '' : 'on'}" id="set-auto-check-updates"></div>
          </div>
        </div>
        <div class="settings-row" style="margin-top: 18px">
          <div class="settings-label">
            <h4>Update reminder</h4>
            <p>Show a banner when a downloaded update is ready to install</p>
          </div>
          <div class="settings-control" style="width:auto">
            <div class="toggle-switch on" id="set-update-reminder" data-hard-on="true"></div>
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
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Version 1.0.8 &nbsp;·&nbsp; Built with Electron &nbsp;·&nbsp; minecraft-launcher-core</div>
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
  const autoCheckToggle = document.getElementById('set-auto-check-updates');
  autoCheckToggle?.addEventListener('click', () => autoCheckToggle.classList.toggle('on'));

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
      closeOnLaunch: closeToggle.classList.contains('on'),
      autoCheckUpdates: autoCheckToggle?.classList.contains('on') !== false
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
    const recGb = Math.round((State.systemInfo?.recommendedMaxMb || 16384) / 1024);
    const defaults = {
      ...prev,
      username: 'Player',
      offlineEnabled: false,
      javaPath: 'java',
      maxRam: `${recGb}G`,
      minRam: '512M',
      theme: 'zenon',
      closeOnLaunch: false,
      autoCheckUpdates: true
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
