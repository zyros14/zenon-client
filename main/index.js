/** Zenon Client — main process entry. */
const { app } = require('electron');
// Side effects first: user-data layout + dir creation must exist before any module touches it.
require('./paths');
const { patchAuthConsole } = require('./log');
patchAuthConsole();
const bridge = require('./bridge');
const { createWindow } = require('./window');
const { wireAutoUpdater } = require('./updater');
const { SERVER_RUNTIME } = require('./servers');
const { restoreSafeModeModsIfNeeded } = require('./launch');
require('./ipc'); // registers all IPC handlers

process.on('uncaughtException', (err) => {
  console.error('[zenon] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[zenon] unhandledRejection:', reason);
});

app.whenReady().then(() => {
  console.log('[zenon] app ready, opening window');
  createWindow();
  wireAutoUpdater();
});

app.on('before-quit', () => {
  restoreSafeModeModsIfNeeded();
  for (const id of [...SERVER_RUNTIME.keys()]) {
    try {
      const p = SERVER_RUNTIME.get(id)?.proc;
      if (p && !p.killed) p.kill('SIGTERM');
    } catch (e) {}
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!bridge.getWindow()) createWindow(); });
