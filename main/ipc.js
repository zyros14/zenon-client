/** All IPC handlers. Registered on require (same lifecycle as before the split). */
const electron = require('electron');
const { app, ipcMain } = electron;
const bridge = require('./bridge');
const fetch = require('node-fetch');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { INSTANCES_DIR, SERVERS_DIR, USER_DATA, AUTH_CACHE_DIR } = require('./paths');
const { loadSettings, saveSettings } = require('./settings');
const { getAuthState, startDeviceCodeFlow, pollDeviceCodeToken } = require('./auth');
const {
  loadInstances, createInstance, deleteInstance, updateInstance, duplicateInstance, repairInstance,
  readInstanceConfig, instanceIconDir, writeInstanceIconFile, exportInstanceZip, importInstanceZip,
  listInstanceRoot, listInstanceWorlds, readInstanceLatestLog, getInstanceMods, toggleMod, deleteMod,
  renameWorld, deleteWorld, exportWorld, importWorld, getWorldInfo
} = require('./instances');
const { fetchMinecraftVersions, fetchFabricVersions } = require('./mcVersion');
const {
  searchModrinth, searchCurseforge, getProjectVersions, downloadProjectFile, createInstanceFromMrpack,
  spigetSearchResources, spigetGetResource, spigetDownloadResourceJar
} = require('./discovery');
const {
  listInstanceContent, toggleInstanceContent, deleteInstanceContent,
  listServerContent, toggleServerContent, deleteServerContent,
  getServerContentDir, readServerContentMeta, writeServerContentMeta
} = require('./content');
const { fetchForgeVersionsForMc } = require('./forge');
const {
  SERVER_RUNTIME, listServers, createServerEntry, fetchPaperMcVersionList, deleteServerEntry,
  startDedicatedServer, stopDedicatedServer, readEulaAccepted, writeEulaAccepted, downloadServerProjectFile
} = require('./servers');
const { readServerConfig } = require('./serverConfig');
const { launchGame, getRunningGame, getRunningInstanceIds } = require('./launch');
const { backupInstance, listBackups, restoreBackup, deleteBackup } = require('./backups');
const { exportInstanceMrpack } = require('./mrpack');
const { installCurseforgeModpack } = require('./cf-modpack');
const { updateAllInstanceMods } = require('./mods-update');
const { analyzeInstanceMods } = require('./mod-intelligence');
const { listCrashes, clearCrashes } = require('./crash-history');
const {
  SKIN_VARIANTS, loadSkinLibrary, saveSkinLibrary, skinFilePath, seedDefaultSkinsOnce, readSkinEntryWithData,
  downloadSkinToFile, fetchWithRetry, skinMojangHttpError, fetchMinecraftProfileSkins
} = require('./skins');
const { TOTAL_RAM_MB, recommendedMaxRamMb } = require('./lib/ram');
const { isValidSkinPng, sanitizeJarBaseName } = require('./lib/text');
const { handleUpdateCheck, handleUpdateInstall } = require('./updater');
// IPC Handlers
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('get-system-info', () => ({
  totalMemMb: TOTAL_RAM_MB,
  recommendedMaxMb: recommendedMaxRamMb()
}));

ipcMain.handle('app:get-version', () => ({
  version: app.getVersion(),
  isPackaged: app.isPackaged
}));
ipcMain.handle('save-settings', (_, settings) => { saveSettings(settings); return true; });

// Auth IPC
ipcMain.handle('auth:get-state', () => {
  const settings = loadSettings();
  return getAuthState(settings);
});

ipcMain.handle('auth:start-device-code', async () => {
  const settings = loadSettings();
  const dc = await startDeviceCodeFlow(settings);
  return dc;
});

ipcMain.handle('auth:poll-device-code', async (_, { device_code }) => {
  const session = global.__zenonAuthSession;
  if (!session) return { status: 'pending' };
  if (session.status === 'success') {
    const settings = loadSettings();
    return { status: 'success', state: getAuthState(settings) };
  }
  if (session.status === 'error') return { status: 'error', error: session.error || 'Auth failed' };
  return { status: 'pending' };
});

ipcMain.handle('auth:logout', () => {
  const settings = loadSettings();
  const newSettings = { ...settings, auth: null };
  saveSettings(newSettings);
  global.__zenonAuthSession = null;
  try {
    fs.emptyDirSync(AUTH_CACHE_DIR);
  } catch (e) {
    try {
      fs.removeSync(AUTH_CACHE_DIR);
      fs.ensureDirSync(AUTH_CACHE_DIR);
    } catch (e2) {}
  }
  return { ok: true };
});

ipcMain.handle('open-external', async (_, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) return { ok: false };
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('get-instances', () => loadInstances());
ipcMain.handle('create-instance', (_, data) => createInstance(data));
ipcMain.handle('delete-instance', (_, id) => deleteInstance(id));
ipcMain.handle('duplicate-instance', (_, id) => {
  try {
    return { success: true, instance: duplicateInstance(id) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('repair-instance', (_, id) => {
  try {
    repairInstance(id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('update-instance', (_, { id, updates }) => updateInstance(id, updates));

ipcMain.handle('instance-set-icon', async (_, { instanceId, base64, mime }) => {
  try {
    const id = String(instanceId || '').trim();
    if (!id) return { success: false, error: 'Missing instance id' };
    const cfg = readInstanceConfig(id);
    if (!cfg) return { success: false, error: 'Instance not found' };
    const raw = String(base64 || '');
    if (!raw) return { success: false, error: 'Empty image' };
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) return { success: false, error: 'Empty image' };
    if (buf.length > 4 * 1024 * 1024) return { success: false, error: 'Image too large (max 4MB)' };
    const rel = writeInstanceIconFile(id, buf, mime || 'image/png');
    const updated = updateInstance(id, { icon: `img:${rel}` });
    return updated ? { success: true, instance: updated } : { success: false, error: 'Could not save instance icon' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('instance-clear-icon', async (_, instanceId) => {
  try {
    const id = String(instanceId || '').trim();
    if (!id) return { success: false, error: 'Missing instance id' };
    const cfg = readInstanceConfig(id);
    if (!cfg) return { success: false, error: 'Instance not found' };
    // Best-effort delete .zenon/icon.*
    try {
      const d = instanceIconDir(id);
      if (fs.existsSync(d)) {
        for (const n of fs.readdirSync(d)) {
          if (/^icon\.(png|jpg|jpeg|webp)$/i.test(n)) fs.removeSync(path.join(d, n));
        }
      }
    } catch (e2) {}
    const updated = updateInstance(id, { icon: 'default' });
    return updated ? { success: true, instance: updated } : { success: false, error: 'Could not update instance' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('export-instance', async (_, instanceId) => {
  try {
    return await exportInstanceZip(instanceId);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('import-instance', async () => {
  try {
    return await importInstanceZip();
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-mc-versions', () => fetchMinecraftVersions());
ipcMain.handle('get-fabric-versions', (_, mcVersion) => fetchFabricVersions(mcVersion));

ipcMain.handle('get-mods', (_, instanceId) => getInstanceMods(instanceId));
ipcMain.handle('toggle-mod', (_, { instanceId, filename }) => toggleMod(instanceId, filename));
ipcMain.handle('delete-mod', (_, { instanceId, filename }) => deleteMod(instanceId, filename));

ipcMain.handle('search-modrinth', (_, params) => searchModrinth(params));
ipcMain.handle('search-curseforge', (_, params) => searchCurseforge(params));
ipcMain.handle('get-mod-versions', (_, opts) => getProjectVersions(opts.projectId, opts.mcVersion, opts.loader, opts.loaders || null));
ipcMain.handle('download-mod', (_, { instanceId, versionData, meta }) => downloadProjectFile(instanceId, 'mod', versionData, meta || null));

// Generic content manager IPC
ipcMain.handle('get-content', (_, { instanceId, kind }) => listInstanceContent(instanceId, kind));
ipcMain.handle('list-instance-root', (_, instanceId) => listInstanceRoot(instanceId));
ipcMain.handle('list-instance-worlds', (_, instanceId) => listInstanceWorlds(instanceId));
ipcMain.handle('world:rename', async (_, { instanceId, oldName, newName }) => renameWorld(instanceId, oldName, newName));
ipcMain.handle('world:delete', async (_, { instanceId, worldName }) => deleteWorld(instanceId, worldName));
ipcMain.handle('world:export', async (_, { instanceId, worldName }) => exportWorld(instanceId, worldName));
ipcMain.handle('world:import', async (_, { instanceId, zipPath }) => importWorld(instanceId, zipPath));
ipcMain.handle('world:info', (_, { instanceId, worldName }) => getWorldInfo(instanceId, worldName));
ipcMain.handle('read-instance-latest-log', (_, instanceId) => readInstanceLatestLog(instanceId));
ipcMain.handle('toggle-content', (_, { instanceId, kind, filename }) => toggleInstanceContent(instanceId, kind, filename));
ipcMain.handle('delete-content', (_, { instanceId, kind, filename }) => deleteInstanceContent(instanceId, kind, filename));
ipcMain.handle('get-project-versions', (_, opts) => getProjectVersions(opts.projectId, opts.mcVersion, opts.loader, opts.loaders || null));
ipcMain.handle('download-content', (_, { instanceId, kind, versionData, meta }) => downloadProjectFile(instanceId, kind, versionData, meta || null));

// Server-side content manager IPC
ipcMain.handle('server-get-content', (_, { serverId, kind }) => listServerContent(serverId, kind));
ipcMain.handle('server-toggle-content', (_, { serverId, kind, filename }) => toggleServerContent(serverId, kind, filename));
ipcMain.handle('server-delete-content', (_, { serverId, kind, filename }) => deleteServerContent(serverId, kind, filename));
ipcMain.handle('server-download-content', (_, { serverId, kind, versionData, meta }) =>
  downloadServerProjectFile(serverId, kind, versionData, meta || null)
);

// Spiget (Spigot plugins) IPC
ipcMain.handle('spiget-search', async (_, params) => {
  try {
    return await spigetSearchResources(params || {});
  } catch (e) {
    return [];
  }
});

ipcMain.handle('spiget-install-plugin', async (_, { serverId, resourceId }) => {
  try {
    const cfg = readServerConfig(serverId);
    if (!cfg) return { success: false, error: 'Unknown server.' };
    const serverKind = String(cfg.serverKind || '').toLowerCase();
    if (serverKind !== 'paper') return { success: false, error: 'Plugins are only supported for Paper servers.' };

    const resInfo = await spigetGetResource(resourceId);
    const dl = await spigetDownloadResourceJar(resourceId);

    const targetDir = getServerContentDir(serverId, 'plugin');
    const base = sanitizeJarBaseName(resInfo?.name || resInfo?.tag || `plugin-${resourceId}`);
    let filename = String(dl.filenameHint || '').trim();
    if (!filename.toLowerCase().endsWith('.jar')) {
      filename = `${base}-${resourceId}.jar`;
    }
    const dest = path.join(targetDir, filename);
    fs.writeFileSync(dest, dl.buffer);

    // Persist metadata next to file (so UI can show icon/name/author).
    try {
      const idx = readServerContentMeta(serverId, 'plugin');
      const author = resInfo?.author?.name || resInfo?.author?.username || null;
      // Spiget icon.url can be like "/resources/..../icon?...." so normalize leading slashes.
      const iconUrl = resInfo?.icon?.url
        ? `https://www.spigotmc.org/${String(resInfo.icon.url).replace(/^\/+/, '')}`
        : null;
      idx[filename] = {
        projectId: `spiget:${resourceId}`,
        title: resInfo?.name || base,
        iconUrl,
        author,
        at: Date.now()
      };
      writeServerContentMeta(serverId, 'plugin', idx);
    } catch (e2) {}

    return { success: true, filename };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('create-instance-from-mrpack', async (_, { versionData, displayName, iconUrl }) => {
  try {
    const instance = await createInstanceFromMrpack(versionData, displayName, iconUrl || null);
    return { success: true, instance };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('crash:list', async (_, instanceId) => {
  try {
    return await listCrashes(instanceId || null);
  } catch (e) {
    return [];
  }
});

ipcMain.handle('crash:clear', async () => {
  try {
    return { success: clearCrashes() };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('instance-update-mods', async (_, instanceId) => {
  try {
    return await updateAllInstanceMods(instanceId);
  } catch (e) {
    return { success: false, error: e.message || String(e), updated: [], upToDate: 0, failed: [], skipped: 0 };
  }
});

ipcMain.handle('mod:intelligence', async (_, instanceId) => {
  try {
    return await analyzeInstanceMods(instanceId);
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('install-cf-modpack', async (_, { versionData, displayName, iconUrl } = {}) => {
  try {
    return await installCurseforgeModpack(versionData, displayName, iconUrl || null);
  } catch (e) {
    return { success: false, error: e.message || String(e), installed: 0, failed: [], total: 0 };
  }
});

ipcMain.handle('instance-export-mrpack', async (_, instanceId) => {
  try {
    return await exportInstanceMrpack(instanceId);
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('backup-instance', async (_, instanceId) => {
  try {
    return await backupInstance(instanceId);
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('backup:list', async (_, instanceId) => {
  try {
    return await listBackups(instanceId);
  } catch (e) {
    return [];
  }
});

ipcMain.handle('backup:restore', async (_, file) => {
  try {
    return await restoreBackup(file);
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('backup:delete', async (_, file) => {
  try {
    return { success: deleteBackup(file) };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('launch-game', async (_, instanceId) => {
  try {
    return await launchGame(instanceId);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('launch-game-safe', async (_, { instanceId } = {}) => {
  try {
    return await launchGame(instanceId, { safeMode: true });
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-running-instances', () => {
  try {
    return { ids: getRunningInstanceIds() };
  } catch (e) {
    return { ids: [] };
  }
});

ipcMain.handle('launch-stop', async (_, targetInstanceId) => {
  try {
    const rg = targetInstanceId ? getRunningGame(targetInstanceId) : getRunningGame();
    const proc = rg?.proc;
    if (!proc || proc.killed) return { success: false, error: 'Game is not running.' };
    try {
      proc.kill('SIGTERM');
    } catch (e2) {
      try {
        proc.kill();
      } catch (e3) {}
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('launch-game-with-server', async (_, { instanceId, host, port }) => {
  try {
    launchGame.joinServer = { host: String(host || '').trim(), port: Number(port) || 25565 };
    return await launchGame(instanceId);
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    launchGame.joinServer = null;
  }
});

ipcMain.handle('open-instance-folder', (_, instanceId) => {
  const instanceDir = path.join(INSTANCES_DIR, instanceId);
  require('electron').shell.openPath(instanceDir);
});

ipcMain.handle('list-servers', () => listServers());
ipcMain.handle('create-server', async (_, data) => {
  try {
    const { entry: server, hint } = await createServerEntry(data || {});
    return { success: true, server, hint };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-forge-versions', async (_, mcVersion) => {
  try {
    return await fetchForgeVersionsForMc(mcVersion);
  } catch (e) {
    return [];
  }
});

ipcMain.handle('get-paper-mc-versions', async () => {
  try {
    return await fetchPaperMcVersionList();
  } catch (e) {
    return [];
  }
});
ipcMain.handle('delete-server', async (_, serverId) => {
  try {
    await stopDedicatedServer(serverId, { force: true });
    deleteServerEntry(serverId);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('open-server-folder', (_, serverId) => {
  const cfg = readServerConfig(serverId);
  const dir = cfg?.dir || path.join(SERVERS_DIR, serverId);
  require('electron').shell.openPath(dir);
});

ipcMain.handle('server-start', async (_, serverId) => {
  try {
    return await startDedicatedServer(serverId);
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('server-stop', async (_, serverId) => {
  try {
    await stopDedicatedServer(serverId, { force: false });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('server-send', (_, { serverId, cmd }) => {
  const rt = SERVER_RUNTIME.get(serverId);
  if (!rt?.proc?.stdin) return { success: false, error: 'Server is not running.' };
  const line = String(cmd || '').trim();
  if (!line) return { success: false, error: 'Empty command' };
  try {
    rt.proc.stdin.write(`${line}\n`);
    if (/^list$/i.test(line)) {
      rt.awaitingList = true;
      if (rt.listTimer) clearTimeout(rt.listTimer);
      rt.listTimer = setTimeout(() => {
        rt.awaitingList = false;
        rt.listTimer = null;
      }, 6000);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('server-console-buffer', (_, serverId) => ({
  lines: SERVER_RUNTIME.get(serverId)?.logLines || []
}));
ipcMain.handle('server-status', (_, serverId) => {
  const rt = SERVER_RUNTIME.get(serverId);
  const cfg = readServerConfig(serverId);
  const serverDir = cfg?.dir || path.join(SERVERS_DIR, String(serverId || ''));
  if (!rt?.proc || rt.proc.killed) {
    return { running: false, active: [], inactive: [], eulaAccepted: readEulaAccepted(serverDir) };
  }
  return {
    running: true,
    active: [...rt.online],
    inactive: rt.inactive.map((x) => x.name),
    eulaAccepted: readEulaAccepted(serverDir)
  };
});

ipcMain.handle('server-accept-eula', async (_, serverId) => {
  try {
    const cfg = readServerConfig(serverId);
    if (!cfg) return { success: false, error: 'Unknown server.' };
    const serverDir = cfg.dir || path.join(SERVERS_DIR, serverId);
    const ok = writeEulaAccepted(serverDir);
    return ok ? { success: true } : { success: false, error: 'Could not write eula.txt' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('skin:get-profile', async (_, opts) => {
  try {
    return await fetchMinecraftProfileSkins(!!(opts && opts.force));
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('skin:list-library', async () => {
  try {
    await seedDefaultSkinsOnce();
    const entries = loadSkinLibrary();
    return { success: true, skins: entries.map(readSkinEntryWithData) };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('skin:add-to-library', async (_, data = {}) => {
  try {
    const name = String(data?.name || 'Untitled skin').trim().slice(0, 80) || 'Untitled skin';
    const variant = SKIN_VARIANTS.includes(String(data?.variant || '').toUpperCase())
      ? String(data.variant).toUpperCase()
      : 'CLASSIC';
    const raw = String(data?.base64 || '');
    if (!raw) return { success: false, error: 'No skin image provided' };
    const buf = Buffer.from(raw, 'base64');
    const dims = isValidSkinPng(buf);
    if (!dims) return { success: false, error: 'Not a valid Minecraft skin PNG (expected 64x32 or 64x64)' };
    const id = uuidv4();
    fs.writeFileSync(skinFilePath(id), buf);
    const entry = { id, name, variant, width: dims.width, height: dims.height, addedAt: new Date().toISOString() };
    const library = loadSkinLibrary();
    library.push(entry);
    saveSkinLibrary(library);
    return { success: true, skin: readSkinEntryWithData(entry) };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('skin:save-current-to-library', async (_, data = {}) => {
  try {
    const name = String(data?.name || 'My current skin').trim().slice(0, 80) || 'My current skin';
    const variant = SKIN_VARIANTS.includes(String(data?.variant || '').toUpperCase())
      ? String(data.variant).toUpperCase()
      : 'CLASSIC';
    const url = String(data?.url || '').trim();
    if (!url) return { success: false, error: 'Missing skin URL' };
    const id = uuidv4();
    const buf = await downloadSkinToFile(url, skinFilePath(id));
    const dims = isValidSkinPng(buf);
    if (!dims) {
      try { fs.removeSync(skinFilePath(id)); } catch (e) {}
      return { success: false, error: 'Downloaded image is not a valid Minecraft skin PNG' };
    }
    const entry = { id, name, variant, width: dims.width, height: dims.height, addedAt: new Date().toISOString() };
    const library = loadSkinLibrary();
    library.push(entry);
    saveSkinLibrary(library);
    return { success: true, skin: readSkinEntryWithData(entry) };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('skin:remove-from-library', async (_, id) => {
  try {
    const sid = String(id || '').trim();
    if (!sid) return { success: false, error: 'Missing skin id' };
    const library = loadSkinLibrary();
    const next = library.filter((s) => s.id !== sid);
    try { fs.removeSync(skinFilePath(sid)); } catch (e) {}
    saveSkinLibrary(next);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('skin:rename-library-skin', async (_, data = {}) => {
  try {
    const id = String(data?.id || '').trim();
    const name = String(data?.name || '').trim().slice(0, 80);
    if (!id) return { success: false, error: 'Missing skin id' };
    if (!name) return { success: false, error: 'Name cannot be empty' };
    const library = loadSkinLibrary();
    const entry = library.find((s) => s.id === id);
    if (!entry) return { success: false, error: 'Skin not found in library' };
    entry.name = name;
    saveSkinLibrary(library);
    return { success: true, skin: readSkinEntryWithData(entry) };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('skin:apply', async (_, data = {}) => {
  try {
    const settings = loadSettings();
    const token = settings?.auth?.minecraft?.accessToken;
    if (!token) return { success: false, error: 'Not signed in with Microsoft.' };
    const variant = SKIN_VARIANTS.includes(String(data?.variant || '').toUpperCase())
      ? String(data.variant).toUpperCase()
      : 'CLASSIC';
    let skinBuf = null;
    let skinName = 'skin.png';
    if (data?.source === 'library') {
      const sid = String(data?.id || '').trim();
      if (!sid) return { success: false, error: 'Missing skin id' };
      const p = skinFilePath(sid);
      if (!fs.existsSync(p)) return { success: false, error: 'Skin not found in library' };
      skinBuf = fs.readFileSync(p);
      skinName = `${sid}.png`;
    } else if (data?.source === 'profile') {
      const url = String(data?.url || '').trim();
      if (!url) return { success: false, error: 'Missing skin URL' };
      const res = await fetchWithRetry(fetch, url, { headers: { 'User-Agent': 'ZenonClient/1.1.4' } }, 2);
      if (!res.ok) return { success: false, error: `${skinMojangHttpError(res.status)}` };
      skinBuf = await res.buffer();
    } else {
      return { success: false, error: 'Choose a skin from your library or from your Minecraft profile.' };
    }
    if (!isValidSkinPng(skinBuf)) return { success: false, error: 'Not a valid Minecraft skin PNG' };

    // Multipart/form-data upload to the Mojang profile skins endpoint
    const boundary = `----zenonSkin${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const parts = [];
    const push = (s) => parts.push(Buffer.from(s, 'utf8'));
    push(`--${boundary}\r\n`);
    push('Content-Disposition: form-data; name="variant"\r\n\r\n');
    push(`${variant.toLowerCase()}\r\n`);
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="file"; filename="${skinName}"\r\nContent-Type: image/png\r\n\r\n`);
    parts.push(skinBuf);
    push('\r\n');
    push(`--${boundary}--\r\n`);
    const body = Buffer.concat(parts);

    const res = await nativeFetch('https://api.minecraftservices.com/minecraft/profile/skins', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
        'User-Agent': 'ZenonClient/1.1.4'
      },
      body
    });
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) {}
    if (!res.ok) {
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        return { success: false, error: skinMojangHttpError(res.status) };
      }
      const msg = j?.errorMessage || j?.error || `HTTP ${res.status}`;
      return { success: false, error: String(msg).slice(0, 220) };
    }
    // Fetch the fresh profile so the UI has the ACTIVE skin URL (and refresh the cache)
    const fresh = await fetchMinecraftProfileSkins(true);
    return { success: true, variant, profile: fresh?.profile || null };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

// Tools: open useful folders
ipcMain.handle('open-user-data-folder', async () => {
  try {
    await require('electron').shell.openPath(USER_DATA);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('open-instances-root-folder', async () => {
  try {
    await require('electron').shell.openPath(INSTANCES_DIR);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.on('window-minimize', () => bridge.getWindow()?.minimize());
ipcMain.on('window-maximize', () => {
  const mainWindow = bridge.getWindow();
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => bridge.getWindow()?.close());

ipcMain.handle('update:check', () => handleUpdateCheck());

ipcMain.handle('update:install', () => handleUpdateInstall());
