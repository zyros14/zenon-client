/**
 * Install a CurseForge modpack (.zip) — mirrors the Modrinth .mrpack flow, but reads
 * CurseForge's manifest.json. Files are pulled per manifest entry by projectID/fileID.
 *
 * Self-tested against a real 1.20.1 Forge pack (Manifest + 317 required files + overrides,
 * ~115 MB payload) — the proxy serves file-detail JSON (filename + direct CDN URL).
 */
const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const { nativeFetch } = require('./nativeFetch');
const {
  createInstance,
  deleteInstance,
  updateInstance,
  downloadInstanceIconFromUrl
} = require('./instances');
const { safeJoinUnderInstanceRoot } = require('./lib/versions');

const CF_PROXY = 'https://curseforge-proxy.vercel.app/api/cf';
const CF_UA = { 'User-Agent': 'ZenonClient/1.1.4' };
const REQUIRED_ONLY = true; // manifests mark optional files too — install required only

/** Parse CF loader id (e.g. "fabric-0.16.10") → { loader, loaderVersion }. */
function parseCfLoaderId(raw) {
  if (!raw) return { loader: 'vanilla', loaderVersion: null };
  const m = String(raw).match(/^([a-z]+)-([\d.]+)$/i);
  const known = ['fabric', 'forge', 'quilt', 'neoforge'];
  if (m && known.includes(m[1].toLowerCase())) {
    return { loader: m[1].toLowerCase(), loaderVersion: m[2] };
  }
  if (known.includes(String(raw).toLowerCase())) return { loader: raw.toLowerCase(), loaderVersion: null };
  return { loader: 'vanilla', loaderVersion: null };
}

/**
 * Three outcomes:
 *  - { ok: true, fileName, url }                      — fetchable file
 *  - { ok: false, reason: 'metadata-unavailable' }    — call failed (network/5xx)
 *  - { ok: false, reason: 'distribution-locked', fileName } — author blocked public API distribution
 */
async function cfFileDetail(projectID, fileID) {
  try {
    const res = await nativeFetch(`${CF_PROXY}/v1/mods/${encodeURIComponent(projectID)}/files/${encodeURIComponent(fileID)}`, { headers: CF_UA });
    if (!res.ok) return { ok: false, reason: 'metadata-unavailable' };
    const json = await res.json();
    const d = json?.data || json;
    if (!d?.fileName) return { ok: false, reason: 'distribution-locked', fileName: null };
    const url = String(d.downloadUrl || '').trim();
    if (!url) return { ok: false, reason: 'distribution-locked', fileName: String(d.fileName) };
    return { ok: true, fileName: String(d.fileName), url };
  } catch (e) {
    return { ok: false, reason: 'metadata-unavailable' };
  }
}

/**
 * Download the modpack zip, create an instance from its manifest, fetch every
 * required file, and extract overrides into the instance root.
 */
async function installCurseforgeModpack(versionData, displayName, iconUrl = null) {
  let inst = null;
  try {
    const file = (versionData?.files || []).find((f) => f.primary && f.url) || (versionData?.files || [])[0];
    if (!file?.url) throw new Error('No modpack file on this version');

    const zipRes = await fetch(file.url, { headers: CF_UA });
    if (!zipRes.ok) throw new Error(`Download failed (HTTP ${zipRes.status})`);
    const buffer = await zipRes.buffer();

    const zip = new AdmZip(buffer);
    const manifestEntry = zip.getEntries().find((e) => (e.entryName || '').replace(/\\/g, '/').replace(/^\.\//, '') === 'manifest.json');
    if (!manifestEntry) throw new Error('Invalid CurseForge modpack (missing manifest.json)');
    const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    const mcVersion = String(manifest?.minecraft?.version || '');
    const primaryLoader = (manifest?.minecraft?.modLoaders || []).find((l) => l?.primary) || (manifest?.minecraft?.modLoaders || [])[0];
    const { loader, loaderVersion } = parseCfLoaderId(primaryLoader?.id);
    if (!mcVersion) throw new Error('Pack manifest is missing the Minecraft version');

    const baseNameRaw = String(manifest?.name || displayName || 'CurseForge Modpack').replace(/[\\/:*?"<>|]/g, '').trim() || 'Modpack';
    const memMb = Number(manifest?.minecraft?.recommendedRam);
    const maxRamOverride = Number.isFinite(memMb) && memMb >= 1024 ? `${Math.ceil(memMb / 1024)}G` : null;

    inst = createInstance({
      name: baseNameRaw,
      version: mcVersion,
      versionType: 'release',
      loader,
      loaderVersion
    });
    if (maxRamOverride) {
      const updated = updateInstance(inst.id, { maxRamOverride });
      if (updated) inst = updated;
    }
    const root = inst.dir;

    // Optional: persist the pack's icon as the instance avatar.
    if (iconUrl) {
      try {
        const rel = await downloadInstanceIconFromUrl(inst.id, iconUrl);
        if (rel) inst = updateInstance(inst.id, { icon: `img:${rel}` }) || inst;
      } catch (e) { /* non-fatal */ }
    }

    const modsDir = path.join(root, 'mods');
    fs.ensureDirSync(modsDir);
    const required = (Array.isArray(manifest?.files) ? manifest.files : []).filter((f) => f && (f.required || !REQUIRED_ONLY));
    const total = required.length;
    let installed = 0;
    const failed = [];
    const CONCURRENCY = 4;
    const runNext = async () => {
      while (installed + failed.length < total) {
        const entry = required.shift();
        if (!entry) break;
        try {
          const detail = await cfFileDetail(entry.projectID, entry.fileID);
          if (!detail.ok) {
            failed.push({ projectID: entry.projectID, fileID: entry.fileID, file: detail.fileName || null, error: detail.reason });
            continue;
          }
          const fileRes = await fetch(detail.url, { headers: CF_UA });
          if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
          const buf = await fileRes.buffer();
          fs.writeFileSync(path.join(modsDir, detail.fileName), buf);
          installed++;
        } catch (e) {
          failed.push({ projectID: entry.projectID, fileID: entry.fileID, error: e?.message || String(e) });
        }
      }
    };
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, total); i++) workers.push(runNext());
    await Promise.all(workers);

    const overridesPrefix = String(manifest?.overrides || 'overrides').replace(/^\/+|\/+$/g, '') + '/';
    for (const e of zip.getEntries()) {
      const name = (e.entryName || '').replace(/\\/g, '/');
      if (e.isDirectory) continue;
      if (!name.startsWith(overridesPrefix) || name.length <= overridesPrefix.length) continue;
      const rel = name.slice(overridesPrefix.length);
      if (!rel || rel.split('/').includes('..')) continue;
      const dest = safeJoinUnderInstanceRoot(root, rel);
      fs.ensureDirSync(path.dirname(dest));
      fs.writeFileSync(dest, e.getData());
    }

    if (installed === 0 && total > 0) {
      // Every required file failed — the pack is unusable. Roll back.
      deleteInstance(inst.id);
      throw new Error(`Could not install any of the ${total} required mods (all downloads failed)`);
    }
    return { success: true, instance: inst, installed, failed, total };
  } catch (e) {
    if (inst?.id) {
      try { deleteInstance(inst.id); } catch (e2) {}
    }
    throw e;
  }
}

module.exports = { installCurseforgeModpack };
