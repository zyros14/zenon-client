/** Auto-updater (GitHub Releases, packaged builds only). */
const { app } = require('electron');
const { sendToRenderer } = require('./log');
const { loadSettings } = require('./settings');

async function wireAutoUpdater() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;

    autoUpdater.on('update-available', (info) => {
      sendToRenderer('update:event', { event: 'available', info });
    });
    autoUpdater.on('update-not-available', (info) => {
      sendToRenderer('update:event', { event: 'none', info });
    });
    autoUpdater.on('download-progress', (p) => {
      sendToRenderer('update:event', { event: 'progress', progress: p });
    });
    autoUpdater.on('update-downloaded', (info) => {
      sendToRenderer('update:event', { event: 'downloaded', info });
    });
    autoUpdater.on('error', (err) => {
      sendToRenderer('update:event', { event: 'error', message: err?.message || String(err) });
    });

    // Check for updates after 2.5s (gives UI time to render). Respects the user's setting.
    setTimeout(() => {
      try {
        if (loadSettings().autoCheckUpdates === false) return;
        autoUpdater.checkForUpdates();
      } catch (e) { console.error('[zenon] checkForUpdates failed:', e); }
    }, 2500);
  } catch (e) {
    console.error('[zenon] auto-updater setup failed:', e);
  }
}

async function handleUpdateCheck() {
  if (!app.isPackaged) return { success: false, error: 'Updates only work in packaged builds.' };
  try {
    const { autoUpdater } = require('electron-updater');
    // checkForUpdates() resolves with non-serializable members (cancellationToken, downloadPromise)
    // when an update is available — return a plain shape IPC can clone.
    const res = await autoUpdater.checkForUpdates();
    return {
      success: true,
      result: res
        ? {
            isUpdateAvailable: !!res.isUpdateAvailable,
            versionInfo: res.versionInfo || res.updateInfo || null
          }
        : null
    };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

async function handleUpdateInstall() {
  if (!app.isPackaged) return { success: false, error: 'Updates only work in packaged builds.' };
  setImmediate(() => {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.quitAndInstall(false, true);
    } catch (e) {}
  });
  return { success: true };
}

module.exports = { wireAutoUpdater, handleUpdateCheck, handleUpdateInstall };
