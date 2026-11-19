/** Instance CRUD, icons, import/export and layout scaffolding. */
const { dialog } = require('electron');
const fetch = require('node-fetch');
const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const { INSTANCES_DIR } = require('./paths');
const { normalizeInstanceDisplayName, normalizeIconExt, iconRelPathForExt } = require('./lib/text');
const { listInstanceContent, toggleInstanceContent, deleteInstanceContent } = require('./content');
function instanceIconDir(instanceId) {
  return path.join(INSTANCES_DIR, instanceId, '.zenon');
}

function writeInstanceIconFile(instanceId, buffer, extOrMime) {
  const ext = normalizeIconExt(extOrMime);
  const dir = instanceIconDir(instanceId);
  fs.ensureDirSync(dir);
  const rel = iconRelPathForExt(ext);
  const full = path.join(INSTANCES_DIR, instanceId, rel);
  fs.writeFileSync(full, buffer);
  return rel;
}

async function downloadInstanceIconFromUrl(instanceId, url) {
  const u = String(url || '').trim();
  if (!u) return null;
  const res = await fetch(u, { headers: { 'User-Agent': 'ZenonClient/1.1.4' } });
  if (!res.ok) throw new Error(`Icon download failed (HTTP ${res.status})`);
  const ct = res.headers.get('content-type') || '';
  const buf = await res.buffer();
  const rel = writeInstanceIconFile(instanceId, buf, ct);
  return rel;
}

function loadInstances() {
  const instances = [];
  if (!fs.existsSync(INSTANCES_DIR)) return instances;
  const dirs = fs.readdirSync(INSTANCES_DIR);
  for (const dir of dirs) {
    const configPath = path.join(INSTANCES_DIR, dir, 'instance.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (String(config.id || '') !== String(dir)) {
          config.id = dir;
          try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
          } catch (e2) {}
        }
        if (config.name == null || String(config.name).trim() === '') {
          config.name = 'Instance';
          try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
          } catch (e3) {}
        } else {
          const nn = normalizeInstanceDisplayName(config.name, 'Instance');
          if (nn !== config.name) {
            config.name = nn;
            try {
              fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            } catch (e4) {}
          }
        }
        if (config.dir) scaffoldInstanceLayout(config.dir);
        instances.push(config);
      } catch (e) {}
    }
  }
  return instances;
}

function createInstance(data) {
  const id = uuidv4();
  const instanceDir = path.join(INSTANCES_DIR, id);
  fs.ensureDirSync(instanceDir);
  scaffoldInstanceLayout(instanceDir);

  const instance = {
    id,
    name: normalizeInstanceDisplayName(data.name, 'Instance'),
    version: data.version,
    versionType: data.versionType || 'release',
    loader: data.loader || 'vanilla',
    loaderVersion: data.loaderVersion || null,
    created: new Date().toISOString(),
    lastPlayed: null,
    playTime: 0,
    icon: data.icon || 'default',
    libraryGroup: data.libraryGroup || '',
    javaPathOverride: null,
    maxRamOverride: null,
    minRamOverride: null,
    windowWidth: null,
    windowHeight: null,
    windowFullscreen: false,
    hookPreLaunch: '',
    hookPostExit: '',
    hookWrapper: '',
    hooksCustomEnabled: false,
    jvmArgs: '',
    jvmArgsEnabled: false,
    javaCustomEnabled: false,
    memoryCustomEnabled: false,
    windowCustomEnabled: false,
    dir: instanceDir
  };

  fs.writeFileSync(path.join(instanceDir, 'instance.json'), JSON.stringify(instance, null, 2));
  return instance;
}

function deleteInstance(id) {
  const instanceDir = path.join(INSTANCES_DIR, id);
  if (fs.existsSync(instanceDir)) {
    fs.removeSync(instanceDir);
    return true;
  }
  return false;
}

function updateInstance(id, updates) {
  const instanceDir = path.join(INSTANCES_DIR, id);
  const configPath = path.join(instanceDir, 'instance.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const patch = { ...updates };
    if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
      patch.name = normalizeInstanceDisplayName(patch.name, 'Instance');
    }
    const updated = { ...config, ...patch };
    updated.id = id;
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
    return updated;
  } catch (e) {
    return null;
  }
}


// ===== Instance import/export (zip) =====
function normalizeImportedInstanceLayout(instanceDir) {
  const rootConfig = path.join(instanceDir, 'instance.json');
  if (fs.existsSync(rootConfig)) return rootConfig;

  const children = fs.readdirSync(instanceDir).filter(n => !n.startsWith('.'));
  if (children.length !== 1) return null;
  const onlyChild = path.join(instanceDir, children[0]);
  if (!fs.statSync(onlyChild).isDirectory()) return null;

  const nestedConfig = path.join(onlyChild, 'instance.json');
  if (!fs.existsSync(nestedConfig)) return null;

  // Move nested contents up one level
  const nestedItems = fs.readdirSync(onlyChild);
  for (const item of nestedItems) {
    fs.moveSync(path.join(onlyChild, item), path.join(instanceDir, item), { overwrite: true });
  }
  fs.removeSync(onlyChild);
  return path.join(instanceDir, 'instance.json');
}

async function exportInstanceZip(instanceId) {
  const instanceDir = path.join(INSTANCES_DIR, instanceId);
  const configPath = path.join(instanceDir, 'instance.json');
  if (!fs.existsSync(configPath)) throw new Error('Instance not found');

  const inst = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const suggested = `${(inst.name || 'instance').replace(/[\\\\/:*?\"<>|]/g, '_')}.zip`;

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Instance',
    defaultPath: suggested,
    filters: [{ name: 'Zip', extensions: ['zip'] }]
  });
  if (canceled || !filePath) return { canceled: true };

  const zip = new AdmZip();
  zip.addLocalFolder(instanceDir, '');
  zip.writeZip(filePath);
  return { success: true, path: filePath };
}

async function importInstanceZip() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Instance',
    properties: ['openFile'],
    filters: [{ name: 'Zip', extensions: ['zip'] }]
  });
  if (canceled || !filePaths?.[0]) return { canceled: true };

  const zipPath = filePaths[0];
  const newId = uuidv4();
  const instanceDir = path.join(INSTANCES_DIR, newId);
  fs.ensureDirSync(instanceDir);

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(instanceDir, true);

  const normalizedConfigPath = normalizeImportedInstanceLayout(instanceDir);
  if (!normalizedConfigPath) {
    fs.removeSync(instanceDir);
    throw new Error('Invalid instance zip (missing instance.json)');
  }

  const config = JSON.parse(fs.readFileSync(normalizedConfigPath, 'utf8'));
  const imported = {
    ...config,
    id: newId,
    dir: instanceDir,
    name: config.name ? `${config.name} (Imported)` : 'Imported Instance',
    created: new Date().toISOString(),
    lastPlayed: null,
    libraryGroup: config.libraryGroup ?? '',
    javaPathOverride: config.javaPathOverride ?? null,
    maxRamOverride: config.maxRamOverride ?? null,
    minRamOverride: config.minRamOverride ?? null,
    windowWidth: config.windowWidth ?? null,
    windowHeight: config.windowHeight ?? null,
    windowFullscreen: config.windowFullscreen ?? false,
    hookPreLaunch: config.hookPreLaunch ?? '',
    hookPostExit: config.hookPostExit ?? config.hookPostLaunch ?? '',
    hookWrapper: config.hookWrapper ?? '',
    hooksCustomEnabled: config.hooksCustomEnabled ?? false,
    jvmArgs: config.jvmArgs ?? '',
    jvmArgsEnabled: config.jvmArgsEnabled ?? false,
    javaCustomEnabled: config.javaCustomEnabled ?? false,
    memoryCustomEnabled: config.memoryCustomEnabled ?? false,
    windowCustomEnabled: config.windowCustomEnabled ?? false
  };

  fs.writeFileSync(path.join(instanceDir, 'instance.json'), JSON.stringify(imported, null, 2));
  scaffoldInstanceLayout(instanceDir);
  return { success: true, instance: imported };
}


function readInstanceConfig(instanceId) {
  const configPath = path.join(INSTANCES_DIR, instanceId, 'instance.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function getInstanceRootDir(instanceId) {
  const cfg = readInstanceConfig(instanceId);
  if (!cfg) return null;
  return cfg.dir || path.join(INSTANCES_DIR, instanceId);
}

function scaffoldInstanceLayout(instanceDir) {
  if (!instanceDir || typeof instanceDir !== 'string') return;
  try {
    fs.ensureDirSync(instanceDir);
    const subdirs = [
      '.fabric',
      'assets',
      'cache',
      'datapacks',
      'libraries',
      'logs',
      'mods',
      'modpacks',
      'resourcepacks',
      'saves',
      'screenshots',
      'shaderpacks',
      'versions'
    ];
    for (const d of subdirs) {
      fs.ensureDirSync(path.join(instanceDir, d));
    }
    const optPath = path.join(instanceDir, 'options.txt');
    if (!fs.existsSync(optPath)) {
      fs.writeFileSync(
        optPath,
        '# Zenon Client — Minecraft will fill this file when you run the game.\n',
        'utf8'
      );
    }
  } catch (e) {
    /* non-fatal */
  }
}

function repairInstance(instanceId) {
  const dir = getInstanceRootDir(instanceId);
  if (!dir || !fs.existsSync(dir)) throw new Error('Instance not found');
  scaffoldInstanceLayout(dir);
  const cacheDir = path.join(dir, 'cache');
  if (fs.existsSync(cacheDir)) {
    try {
      fs.emptyDirSync(cacheDir);
    } catch (e) {
      /* ignore */
    }
  }
  return true;
}

function duplicateInstance(instanceId) {
  const cfg = readInstanceConfig(instanceId);
  if (!cfg || !cfg.dir || !fs.existsSync(cfg.dir)) {
    throw new Error('Instance not found');
  }
  const newId = uuidv4();
  const newDir = path.join(INSTANCES_DIR, newId);
  if (fs.existsSync(newDir)) throw new Error('Could not create duplicate folder');
  fs.copySync(cfg.dir, newDir);
  const baseName = (cfg.name || 'Instance').replace(/\s*\(copy\)\s*\d*$/i, '').trim() || 'Instance';
  const newCfg = {
    ...cfg,
    id: newId,
    dir: newDir,
    name: `${baseName} (copy)`,
    created: new Date().toISOString(),
    lastPlayed: null,
    playTime: 0
  };
  fs.writeFileSync(path.join(newDir, 'instance.json'), JSON.stringify(newCfg, null, 2));
  scaffoldInstanceLayout(newDir);
  return newCfg;
}

function listInstanceRoot(instanceId) {
  const root = getInstanceRootDir(instanceId);
  if (!root || !fs.existsSync(root)) return [];
  const items = [];
  for (const name of fs.readdirSync(root)) {
    if (name === '.' || name === '..') continue;
    const full = path.join(root, name);
    let type = 'file';
    try {
      type = fs.statSync(full).isDirectory() ? 'dir' : 'file';
    } catch (e) {
      continue;
    }
    items.push({ name, type });
  }
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return items;
}

function listInstanceWorlds(instanceId) {
  const root = getInstanceRootDir(instanceId);
  if (!root) return [];
  const saves = path.join(root, 'saves');
  if (!fs.existsSync(saves)) return [];
  return fs.readdirSync(saves, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(saves, d.name);
      let size = 0;
      let mtime = null;
      try {
        const stat = fs.statSync(dir);
        mtime = stat.mtimeMs;
        size = dirSize(dir);
      } catch (e) {}
      return { name: d.name, size, mtime };
    })
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

function dirSize(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(full);
      else total += fs.statSync(full).size;
    }
  } catch (e) {}
  return total;
}

function worldDir(instanceId, worldName) {
  const root = getInstanceRootDir(instanceId);
  if (!root) return null;
  return path.join(root, 'saves', String(worldName));
}

function safeWorldName(name) {
  const n = String(name || '').trim();
  if (!n || n === '.' || n === '..') return null;
  if (/[\\/:*?"<>|]/.test(n)) return null;
  if (n.startsWith('.')) return null;
  return n;
}

async function renameWorld(instanceId, oldName, newName) {
  const oldDir = worldDir(instanceId, oldName);
  if (!oldDir || !fs.existsSync(oldDir)) throw new Error('World not found');
  const safe = safeWorldName(newName);
  if (!safe) throw new Error('Invalid world name');
  if (safe === oldName) return { success: true, name: safe };
  const newDir = worldDir(instanceId, safe);
  if (fs.existsSync(newDir)) throw new Error('A world with that name already exists');
  fs.renameSync(oldDir, newDir);
  return { success: true, name: safe };
}

async function deleteWorld(instanceId, worldName) {
  const dir = worldDir(instanceId, worldName);
  if (!dir || !fs.existsSync(dir)) throw new Error('World not found');
  fs.removeSync(dir);
  return { success: true };
}

async function exportWorld(instanceId, worldName) {
  const { dialog } = require('electron');
  const dir = worldDir(instanceId, worldName);
  if (!dir || !fs.existsSync(dir)) throw new Error('World not found');

  const inst = readInstanceConfig(instanceId);
  const suggested = `${(inst?.name || 'instance').replace(/[\\/:*?"<>|]/g, '_')}-${worldName.replace(/[\\/:*?"<>|]/g, '_')}.zip`;

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export World',
    defaultPath: suggested,
    filters: [{ name: 'Zip', extensions: ['zip'] }]
  });
  if (canceled || !filePath) return { canceled: true };

  const zip = new AdmZip();
  zip.addLocalFolder(dir, worldName);
  zip.writeZip(filePath);
  return { success: true, path: filePath };
}

async function importWorld(instanceId, zipPath) {
  const dir = worldDir(instanceId, '');
  if (!dir) throw new Error('Instance not found');
  fs.ensureDirSync(path.join(dir, '..')); // ensure saves/ exists

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  // If the zip contains a single top-level folder, extract into saves/ (that folder becomes the world).
  // Otherwise extract each top-level entry as its own world folder.
  const topLevel = {};
  for (const e of entries) {
    if (e.isDirectory) continue;
    const parts = e.entryName.replace(/\\/g, '/').split('/');
    if (parts.length > 0) topLevel[parts[0]] = true;
  }

  if (Object.keys(topLevel).length === 1 && !entries.some((e) => !e.isDirectory && e.entryName.replace(/\\/g, '/').split('/').length === 1)) {
    // Single folder — extract directly into saves/
    zip.extractAllTo(dir, true);
  } else {
    // Multiple top-level entries — extract each folder as its own world under saves/
    for (const name of Object.keys(topLevel)) {
      const safe = safeWorldName(name);
      if (!safe) continue;
      const dest = path.join(dir, safe);
      fs.ensureDirSync(dest);
      // extract matching entries
      for (const e of entries) {
        const rel = e.entryName.replace(/\\/g, '/');
        if (!rel.startsWith(name + '/')) continue;
        if (e.isDirectory) continue;
        const inner = rel.slice(name.length + 1);
        if (!inner) continue;
        const outPath = path.join(dest, inner);
        fs.ensureDirSync(path.dirname(outPath));
        fs.writeFileSync(outPath, e.getData());
      }
    }
  }
  return { success: true };
}

function getWorldInfo(instanceId, worldName) {
  const dir = worldDir(instanceId, worldName);
  if (!dir || !fs.existsSync(dir)) return null;
  let size = 0;
  let mtime = null;
  try {
    const stat = fs.statSync(dir);
    mtime = stat.mtimeMs;
    size = dirSize(dir);
  } catch (e) {}
  const hasLevelDat = fs.existsSync(path.join(dir, 'level.dat'));
  return { name: worldName, size, mtime, hasLevelDat };
}


function readInstanceLatestLog(instanceId, maxBytes = 120000) {
  const root = getInstanceRootDir(instanceId);
  if (!root) return { found: false, text: '' };
  const logPath = path.join(root, 'logs', 'latest.log');
  if (!fs.existsSync(logPath)) {
    return { found: false, text: 'No log file yet. Launch the game once to generate logs/latest.log.' };
  }
  try {
    const stat = fs.statSync(logPath);
    const fd = fs.openSync(logPath, 'r');
    const start = Math.max(0, stat.size - maxBytes);
    const len = stat.size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    return { found: true, text: buf.toString('utf8') };
  } catch (e) {
    return { found: false, text: e.message || String(e) };
  }
}

// Backwards-compatible wrappers for existing renderer code
function getInstanceMods(instanceId) {
  return listInstanceContent(instanceId, 'mod');
}
function toggleMod(instanceId, filename) {
  return toggleInstanceContent(instanceId, 'mod', filename);
}
function deleteMod(instanceId, filename) {
  return deleteInstanceContent(instanceId, 'mod', filename);
}
module.exports = {
  instanceIconDir,
  writeInstanceIconFile,
  downloadInstanceIconFromUrl,
  loadInstances,
  createInstance,
  deleteInstance,
  updateInstance,
  normalizeImportedInstanceLayout,
  exportInstanceZip,
  importInstanceZip,
  readInstanceConfig,
  getInstanceRootDir,
  scaffoldInstanceLayout,
  repairInstance,
  duplicateInstance,
  listInstanceRoot,
  listInstanceWorlds,
  readInstanceLatestLog,
  getInstanceMods,
  toggleMod,
  deleteMod,
  renameWorld,
  deleteWorld,
  exportWorld,
  importWorld,
  getWorldInfo
};
