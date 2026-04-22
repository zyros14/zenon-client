const { contextBridge, ipcRenderer } = require('electron');

let authFinishedHandler = null;
function cancelAuthFinishedWait() {
  if (authFinishedHandler) {
    ipcRenderer.removeListener('auth:finished', authFinishedHandler);
    authFinishedHandler = null;
  }
}

contextBridge.exposeInMainWorld('zenon', {
  // Auth
  authGetState: () => ipcRenderer.invoke('auth:get-state'),
  authStartDeviceCode: () => ipcRenderer.invoke('auth:start-device-code'),
  authPollDeviceCode: (device_code) => ipcRenderer.invoke('auth:poll-device-code', { device_code }),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  waitForAuthFinished: () => new Promise((resolve) => {
    cancelAuthFinishedWait();
    authFinishedHandler = (_e, data) => {
      cancelAuthFinishedWait();
      resolve(data);
    };
    ipcRenderer.on('auth:finished', authFinishedHandler);
  }),
  cancelAuthFinishedWait: () => cancelAuthFinishedWait(),
  onAuthLog: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('auth:log', handler);
    return () => ipcRenderer.removeListener('auth:log', handler);
  },

  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  // Instances
  getInstances: () => ipcRenderer.invoke('get-instances'),
  createInstance: (data) => ipcRenderer.invoke('create-instance', data),
  deleteInstance: (id) => ipcRenderer.invoke('delete-instance', id),
  duplicateInstance: (id) => ipcRenderer.invoke('duplicate-instance', id),
  repairInstance: (id) => ipcRenderer.invoke('repair-instance', id),
  updateInstance: (id, updates) => ipcRenderer.invoke('update-instance', { id, updates }),
  setInstanceIcon: (instanceId, base64, mime) => ipcRenderer.invoke('instance-set-icon', { instanceId, base64, mime }),
  clearInstanceIcon: (instanceId) => ipcRenderer.invoke('instance-clear-icon', instanceId),
  openInstanceFolder: (id) => ipcRenderer.invoke('open-instance-folder', id),
  exportInstance: (id) => ipcRenderer.invoke('export-instance', id),
  importInstance: () => ipcRenderer.invoke('import-instance'),

  // Dedicated servers (vanilla jar)
  listServers: () => ipcRenderer.invoke('list-servers'),
  createServer: (data) => ipcRenderer.invoke('create-server', data),
  deleteServer: (serverId) => ipcRenderer.invoke('delete-server', serverId),
  openServerFolder: (serverId) => ipcRenderer.invoke('open-server-folder', serverId),
  serverStart: (serverId) => ipcRenderer.invoke('server-start', serverId),
  serverStop: (serverId) => ipcRenderer.invoke('server-stop', serverId),
  serverSendCommand: (serverId, cmd) => ipcRenderer.invoke('server-send', { serverId, cmd }),
  serverConsoleBuffer: (serverId) => ipcRenderer.invoke('server-console-buffer', serverId),
  serverStatus: (serverId) => ipcRenderer.invoke('server-status', serverId),
  serverAcceptEula: (serverId) => ipcRenderer.invoke('server-accept-eula', serverId),
  serverGetContent: (serverId, kind) => ipcRenderer.invoke('server-get-content', { serverId, kind }),
  serverToggleContent: (serverId, kind, filename) => ipcRenderer.invoke('server-toggle-content', { serverId, kind, filename }),
  serverDeleteContent: (serverId, kind, filename) => ipcRenderer.invoke('server-delete-content', { serverId, kind, filename }),
  serverDownloadContent: (serverId, kind, versionData, meta = null) => ipcRenderer.invoke('server-download-content', { serverId, kind, versionData, meta }),
  onServerLog: (cb) => {
    const fn = (_e, d) => cb(d);
    ipcRenderer.on('server-log', fn);
    return () => ipcRenderer.removeListener('server-log', fn);
  },
  onServerPlayers: (cb) => {
    const fn = (_e, d) => cb(d);
    ipcRenderer.on('server-players', fn);
    return () => ipcRenderer.removeListener('server-players', fn);
  },
  onServerState: (cb) => {
    const fn = (_e, d) => cb(d);
    ipcRenderer.on('server-state', fn);
    return () => ipcRenderer.removeListener('server-state', fn);
  },
  getForgeVersions: (mcVersion) => ipcRenderer.invoke('get-forge-versions', mcVersion),
  getPaperMcVersions: () => ipcRenderer.invoke('get-paper-mc-versions'),

  // Versions
  getMcVersions: () => ipcRenderer.invoke('get-mc-versions'),
  getFabricVersions: (mcVersion) => ipcRenderer.invoke('get-fabric-versions', mcVersion),

  // Mods
  getMods: (instanceId) => ipcRenderer.invoke('get-mods', instanceId),
  toggleMod: (instanceId, filename) => ipcRenderer.invoke('toggle-mod', { instanceId, filename }),
  deleteMod: (instanceId, filename) => ipcRenderer.invoke('delete-mod', { instanceId, filename }),
  getContent: (instanceId, kind) => ipcRenderer.invoke('get-content', { instanceId, kind }),
  toggleContent: (instanceId, kind, filename) => ipcRenderer.invoke('toggle-content', { instanceId, kind, filename }),
  deleteContent: (instanceId, kind, filename) => ipcRenderer.invoke('delete-content', { instanceId, kind, filename }),

  // Modrinth
  searchModrinth: (params) => ipcRenderer.invoke('search-modrinth', params),
  getModVersions: (opts) => ipcRenderer.invoke('get-mod-versions', opts),
  getProjectVersions: (opts) => ipcRenderer.invoke('get-project-versions', opts),
  spigetSearch: (params) => ipcRenderer.invoke('spiget-search', params),
  spigetInstallPlugin: (serverId, resourceId) => ipcRenderer.invoke('spiget-install-plugin', { serverId, resourceId }),
  listInstanceRoot: (instanceId) => ipcRenderer.invoke('list-instance-root', instanceId),
  listInstanceWorlds: (instanceId) => ipcRenderer.invoke('list-instance-worlds', instanceId),
  readInstanceLatestLog: (instanceId) => ipcRenderer.invoke('read-instance-latest-log', instanceId),
  downloadMod: (instanceId, versionData, meta = null) => ipcRenderer.invoke('download-mod', { instanceId, versionData, meta }),
  downloadContent: (instanceId, kind, versionData, meta = null) => ipcRenderer.invoke('download-content', { instanceId, kind, versionData, meta }),
  createInstanceFromMrpack: (payload) => ipcRenderer.invoke('create-instance-from-mrpack', payload),

  // Launcher
  launchGame: (instanceId) => ipcRenderer.invoke('launch-game', instanceId),
  launchGameWithServer: (instanceId, host, port) => ipcRenderer.invoke('launch-game-with-server', { instanceId, host, port }),
  stopGame: () => ipcRenderer.invoke('launch-stop'),
  onLaunchLog: (cb) => ipcRenderer.on('launch-log', (_, data) => cb(data)),
  onLaunchClose: (cb) => ipcRenderer.on('launch-close', (_, data) => cb(data)),
  removeLaunchListeners: () => {
    ipcRenderer.removeAllListeners('launch-log');
    ipcRenderer.removeAllListeners('launch-close');
  },

  // Tools
  openUserDataFolder: () => ipcRenderer.invoke('open-user-data-folder'),
  openInstancesRootFolder: () => ipcRenderer.invoke('open-instances-root-folder')
});
