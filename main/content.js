/** Instance & server content folders (mods / shaders / resource packs / plugins). */
const fs = require('fs-extra');
const path = require('path');
const { INSTANCES_DIR, SERVERS_DIR } = require('./paths');
const { normalizeDisplayName } = require('./lib/text');
const { readServerConfig } = require('./serverConfig');
const CONTENT_FOLDERS = {
  mod: 'mods',
  shaderpack: 'shaderpacks',
  resourcepack: 'resourcepacks',
  datapack: 'datapacks',
  modpack: 'modpacks'
};

// Server-side content folders (inside server dir)
const SERVER_CONTENT_FOLDERS = {
  mod: 'mods', // Fabric/Forge server mods
  plugin: 'plugins' // Paper plugins
};

function getContentDir(instanceId, kind) {
  const folder = CONTENT_FOLDERS[kind];
  if (!folder) throw new Error(`Unknown content type: ${kind}`);
  const dir = path.join(INSTANCES_DIR, instanceId, folder);
  fs.ensureDirSync(dir);
  return dir;
}

function getContentMetaPath(instanceId, kind) {
  // Stored inside instance folder for export/import portability
  const safeKind = String(kind || 'mod').replace(/[^a-z0-9_-]/gi, '');
  return path.join(INSTANCES_DIR, instanceId, '.zenon', `content-meta-${safeKind}.json`);
}

function readContentMeta(instanceId, kind) {
  try {
    const p = getContentMetaPath(instanceId, kind);
    if (!fs.existsSync(p)) return {};
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch (e) {
    return {};
  }
}

function writeContentMeta(instanceId, kind, meta) {
  const p = getContentMetaPath(instanceId, kind);
  fs.ensureDirSync(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(meta || {}, null, 2));
}

function getServerContentDir(serverId, kind) {
  const cfg = readServerConfig(serverId);
  if (!cfg) throw new Error('Unknown server.');
  const serverDir = cfg.dir || path.join(SERVERS_DIR, serverId);
  const folder = SERVER_CONTENT_FOLDERS[String(kind || '').toLowerCase()];
  if (!folder) throw new Error(`Unknown server content type: ${kind}`);
  const dir = path.join(serverDir, folder);
  fs.ensureDirSync(dir);
  return dir;
}

function getServerContentMetaPath(serverId, kind) {
  const cfg = readServerConfig(serverId);
  if (!cfg) throw new Error('Unknown server.');
  const serverDir = cfg.dir || path.join(SERVERS_DIR, serverId);
  const safeKind = String(kind || 'mod').replace(/[^a-z0-9_-]/gi, '');
  return path.join(serverDir, '.zenon', `content-meta-${safeKind}.json`);
}

function readServerContentMeta(serverId, kind) {
  try {
    const p = getServerContentMetaPath(serverId, kind);
    if (!fs.existsSync(p)) return {};
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch (e) {
    return {};
  }
}

function writeServerContentMeta(serverId, kind, meta) {
  const p = getServerContentMetaPath(serverId, kind);
  fs.ensureDirSync(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(meta || {}, null, 2));
}

function listServerContent(serverId, kind) {
  const dir = getServerContentDir(serverId, kind);
  const meta = readServerContentMeta(serverId, kind);
  const files = fs.readdirSync(dir);
  return files
    .filter((f) => /\.(jar|zip)(?:\.disabled)?$/i.test(f))
    .map((file) => {
      // Same `.disabled` fallback as listInstanceContent so server content keeps its title/icon.
      const metaEntry = meta?.[file] || (file.endsWith('.disabled') ? meta?.[file.slice(0, -'.disabled'.length)] : null) || null;
      return {
        filename: file,
        enabled: !file.endsWith('.disabled'),
        displayName: normalizeDisplayName(file),
        size: fs.statSync(path.join(dir, file)).size,
        path: path.join(dir, file),
        kind,
        projectId: metaEntry?.projectId || null,
        title: metaEntry?.title || null,
        iconUrl: metaEntry?.iconUrl || null,
        author: metaEntry?.author || null
      };
    });
}

function toggleServerContent(serverId, kind, filename) {
  const dir = getServerContentDir(serverId, kind);
  const currentPath = path.join(dir, filename);
  let newPath;
  if (filename.endsWith('.disabled')) newPath = currentPath.replace('.disabled', '');
  else newPath = currentPath + '.disabled';
  fs.renameSync(currentPath, newPath);
  return path.basename(newPath);
}

function deleteServerContent(serverId, kind, filename) {
  const dir = getServerContentDir(serverId, kind);
  const filePath = path.join(dir, filename);
  if (fs.existsSync(filePath)) {
    fs.removeSync(filePath);
    try {
      const idx = readServerContentMeta(serverId, kind);
      const base = String(filename).replace(/\.disabled$/i, '');
      if (idx[filename]) delete idx[filename];
      if (base !== filename && idx[base]) delete idx[base];
      writeServerContentMeta(serverId, kind, idx);
    } catch (e) {}
    return true;
  }
  return false;
}

function listInstanceContent(instanceId, kind) {
  const dir = getContentDir(instanceId, kind);
  const meta = readContentMeta(instanceId, kind);
  const files = fs.readdirSync(dir);
  return files.map(file => {
    // Meta is stored under the enabled filename; when toggled off the file gains a
    // `.disabled` suffix, so fall back to the base name to keep title/icon/author.
    const metaEntry = meta?.[file] || (file.endsWith('.disabled') ? meta?.[file.slice(0, -'.disabled'.length)] : null) || null;
    let size = 0;
    try { size = fs.statSync(path.join(dir, file)).size; } catch (e) { return null; }
    return {
      filename: file,
      enabled: !file.endsWith('.disabled'),
      displayName: normalizeDisplayName(file),
      size,
      path: path.join(dir, file),
      kind,
      projectId: metaEntry?.projectId || null,
      title: metaEntry?.title || null,
      iconUrl: metaEntry?.iconUrl || null,
      author: metaEntry?.author || null
    };
  }).filter(Boolean);
}

function toggleInstanceContent(instanceId, kind, filename) {
  const dir = getContentDir(instanceId, kind);
  const currentPath = path.join(dir, filename);
  let newPath;
  if (filename.endsWith('.disabled')) newPath = currentPath.replace('.disabled', '');
  else newPath = currentPath + '.disabled';
  fs.renameSync(currentPath, newPath);
  return path.basename(newPath);
}

function deleteInstanceContent(instanceId, kind, filename) {
  const dir = getContentDir(instanceId, kind);
  const filePath = path.join(dir, filename);
  if (fs.existsSync(filePath)) {
    fs.removeSync(filePath);
    // Keep the metadata index consistent (title/icon entries for missing jars are stale).
    try {
      const idx = readContentMeta(instanceId, kind);
      const base = String(filename).replace(/\.disabled$/i, '');
      if (idx[filename]) delete idx[filename];
      if (base !== filename && idx[base]) delete idx[base];
      writeContentMeta(instanceId, kind, idx);
    } catch (e) {}
    return true;
  }
  return false;
}

module.exports = {
  CONTENT_FOLDERS,
  SERVER_CONTENT_FOLDERS,
  getContentDir,
  getContentMetaPath,
  readContentMeta,
  writeContentMeta,
  getServerContentDir,
  getServerContentMetaPath,
  readServerContentMeta,
  writeServerContentMeta,
  listServerContent,
  toggleServerContent,
  deleteServerContent,
  listInstanceContent,
  toggleInstanceContent,
  deleteInstanceContent
};
