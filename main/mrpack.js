/**
 * Export an instance as a Modrinth .mrpack.
 * Design under test: each local jar's sha1 is looked up on Modrinth's
 * /v2/version_file/{hash} endpoint — an exact match, no guessing. Mods found on
 * Modrinth become `files` (with real hashes/urls); the rest ship in `overrides/`.
 */
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { dialog } = require('electron');
const { INSTANCES_DIR } = require('./paths');
const { readInstanceConfig } = require('./instances');
const { nativeFetch } = require('./nativeFetch');

const MODPACK_UA = { 'User-Agent': 'ZenonClient/1.1.4' };

function sha1OfFile(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}
function sha512OfFile(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('hex');
}

async function modrinthVersionByHash(algo, hash) {
  try {
    const res = await nativeFetch(
      `https://api.modrinth.com/v2/version_file/${encodeURIComponent(hash)}?alg=${encodeURIComponent(algo)}`,
      { headers: MODPACK_UA }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function exportInstanceMrpack(instanceId) {
  const instanceDir = path.join(INSTANCES_DIR, instanceId);
  const cfg = readInstanceConfig(instanceId);
  if (!cfg) throw new Error('Instance not found');
  const name = String(cfg.name || 'modpack').replace(/[\\/:*?"<>|]/g, '_');

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export modpack',
    defaultPath: `${name}.mrpack`,
    filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }]
  });
  if (canceled || !filePath) return { canceled: true };

  const files = [];
  const overrides = [];
  const modsDir = path.join(instanceDir, 'mods');

  if (fs.existsSync(modsDir)) {
    for (const f of fs.readdirSync(modsDir)) {
      if (!/\.jar$/i.test(f)) continue;
      const full = path.join(modsDir, f);
      const sha1 = sha1OfFile(full);
      const mod = await modrinthVersionByHash('sha1', sha1);
      const primaryFile = mod?.files?.find((x) => x.primary) || mod?.files?.[0] || null;
      if (mod && primaryFile?.url) {
        files.push({
          path: `mods/${f}`,
          hashes: {
            sha1: String(primaryFile.hashes?.sha1 || sha1).toLowerCase(),
            sha512: String(primaryFile.hashes?.sha512 || sha512OfFile(full)).toLowerCase()
          },
          env: { client: 'required', server: 'optional' },
          downloads: [String(primaryFile.url)],
          fileSize: primaryFile.size || fs.statSync(full).size
        });
      } else {
        overrides.push({ abs: full, rel: `mods/${f}` });
      }
    }
  }

  const deps = { minecraft: String(cfg.version || '1.21.4') };
  if (cfg.loader === 'fabric' && cfg.loaderVersion) deps['fabric-loader'] = String(cfg.loaderVersion);
  if (cfg.loader === 'forge' && cfg.loaderVersion) deps.forge = String(cfg.loaderVersion);
  if (cfg.loader === 'quilt' && cfg.loaderVersion) deps['quilt-loader'] = String(cfg.loaderVersion);

  const index = {
    modrinth_index_version: 1,
    game: 'minecraft',
    formatVersion: 1,
    versionId: `zenon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(cfg.name || 'Zenon modpack'),
    summary: `Exported from Zenon Client — ${cfg.loader || 'vanilla'} ${cfg.version || ''}`.trim(),
    files,
    dependencies: deps
  };

  const zip = new AdmZip();
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2), 'utf8'));
  for (const ov of overrides) {
    const dir = path.posix.dirname(ov.rel);
    zip.addLocalFile(ov.abs, dir === '.' ? '' : dir, path.posix.basename(ov.rel));
  }
  zip.writeZip(filePath);
  return { success: true, path: filePath, modrinth: files.length, overrides: overrides.length };
}

module.exports = { exportInstanceMrpack };
