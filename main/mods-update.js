/**
 * Update all installed (Modrinth/CurseForge) mods in an instance to the latest
 * compatible version for its Minecraft version + loader.
 *
 * "Up to date?" is decided by comparing the local file's sha1 to the latest
 * version's primary file hash — identical ⇒ skip. Otherwise the new file is
 * downloaded in place (same filename — the mod still loads) and the meta record
 * is refreshed (title + new versionId).
 */
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');
const { readInstanceConfig } = require('./instances');
const { getContentDir, readContentMeta, writeContentMeta } = require('./content');
const { getProjectVersions } = require('./discovery');
const MODRINTH_UA = { 'User-Agent': 'ZenonClient/1.1.4' };

function sha1OfFile(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').toLowerCase();
}

async function updateAllInstanceMods(instanceId) {
  const cfg = readInstanceConfig(instanceId);
  if (!cfg) return { success: false, error: 'Instance not found' };
  const mcVersion = cfg.version || '';
  const loaderName = cfg.loader && cfg.loader !== 'vanilla' ? cfg.loader : null;
  const loaders = loaderName ? [loaderName] : null;
  const targetDir = getContentDir(instanceId, 'mod');
  const meta = readContentMeta(instanceId, 'mod');

  const summary = { success: true, updated: [], upToDate: 0, failed: [], skipped: 0 };

  for (const file of fs.readdirSync(targetDir)) {
    if (!/\.jar$/i.test(file)) continue;
    const m = meta[file] || null;
    const projectId = m?.projectId || null;
    if (!projectId || String(projectId).startsWith('spiget:')) { summary.skipped++; continue; }

    const title = m?.title || file;
    try {
      const versions = await getProjectVersions(projectId, mcVersion, loaderName, loaders);
      const latest = Array.isArray(versions) ? versions[0] : null;
      if (!latest) { summary.failed.push({ title, error: 'no compatible version' }); continue; }
      const primary = (latest.files || []).find((f) => f.primary) || (latest.files || [])[0];
      if (!primary?.url) { summary.failed.push({ title, error: 'no downloadable file' }); continue; }

      const localSha1 = sha1OfFile(path.join(targetDir, file));
      const latestSha1 = String(primary?.hashes?.sha1 || '').toLowerCase();
      if (latestSha1 && latestSha1 === localSha1) { summary.upToDate++; continue; }

      const res = await fetch(primary.url, { headers: MODRINTH_UA, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.buffer();
      if (!buf?.length) throw new Error('empty download');
      fs.writeFileSync(path.join(targetDir, file), buf);

      const next = {
        ...m,
        projectId,
        title: latest.name || latest.version_number || m?.title || file,
        iconUrl: m?.iconUrl || null,
        author: m?.author || null,
        at: Date.now(),
        versionId: latest.id || null,
        versionNumber: latest.version_number || null
      };
      meta[file] = next;
      summary.updated.push({ title: next.title, from: m?.versionNumber || m?.versionId || null, to: latest.version_number || null });
    } catch (e) {
      summary.failed.push({ title, error: e?.message || String(e) });
    }
  }

  try { writeContentMeta(instanceId, 'mod', meta); } catch (e) {}
  return summary;
}

module.exports = { updateAllInstanceMods };
