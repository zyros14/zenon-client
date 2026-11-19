/** Settings persistence (%APPDATA%/zenon-client/settings.json). */
const fs = require('fs-extra');
const { SETTINGS_FILE } = require('./paths');
const { DEFAULT_MSA_CLIENT_ID } = require('./constants');
const {
  TOTAL_RAM_MB,
  recommendedMaxRamMb,
  clampRamMb,
  parseRamStringToMb,
  mbToRamLabel
} = require('./lib/ram');

// Default settings
function getDefaultSettings() {
  return {
    javaPath: 'java',
    maxRam: '2G',
    minRam: '512M',
    theme: 'zenon',
    closeOnLaunch: false,
    /** Parallel HTTP sockets for MCLC downloads (8–64). Higher = faster first-time asset/library fetch. */
    mcDownloadSockets: 40,
    msaClientId: DEFAULT_MSA_CLIENT_ID,
    msaScopes: 'XboxLive.signin offline_access',
    auth: null,
    autoCheckUpdates: true,
    /** Show the "Update ready" banner after an update has downloaded. */
    updateReminder: true,
    /** Auto-detected system RAM + one-time auto-configuration flag. */
    ramDetectedMb: TOTAL_RAM_MB,
    ramAutoConfigured: false
  };
}

function loadSettings() {
  let settings;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      settings = { ...getDefaultSettings(), ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
  } catch (e) {}
  if (!settings) settings = getDefaultSettings();
  // Offline-mode fields were removed — drop them if they linger in saved settings.
  delete settings.username;
  delete settings.offlineEnabled;

  // One-time auto-detection: pick a recommended allocation from the real system RAM.
  if (!settings.ramAutoConfigured) {
    const rec = recommendedMaxRamMb();
    // Keep whatever the user already picked (clamped to a sane range), else use the recommendation.
    const maxMb = clampRamMb(parseRamStringToMb(settings.maxRam) || rec, rec);
    settings.maxRam = mbToRamLabel(maxMb);
    settings.minRam = settings.minRam || '512M';
    settings.ramDetectedMb = TOTAL_RAM_MB;
    settings.ramAutoConfigured = true;
    settings.ramRecommended = { minMb: 512, maxMb: rec };
    try { saveSettings(settings); } catch (e) {}
  }
  settings.ramDetectedMb = TOTAL_RAM_MB;
  return settings;
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

module.exports = {
  getDefaultSettings,
  loadSettings,
  saveSettings
};
