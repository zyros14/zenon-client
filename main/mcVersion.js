/**
 * Mojang version-manifest access (cached) + Fabric loader versions.
 * Pure lookups are re-exported from lib/versions for convenience.
 */
const fs = require('fs-extra');
const path = require('path');
const { nativeFetch } = require('./nativeFetch');
const {
  resolveVersionTypeFromManifest,
  isSnapshotLikeMcVersion,
  guessRequiredJavaMajor,
  fabricCustomVersionId
} = require('./lib/versions');

// Minecraft version manifest (cached for launch + create UI)
let __mcVersionManifestCache = null;
async function getMcVersionManifest() {
  if (__mcVersionManifestCache) return __mcVersionManifestCache;
  const res = await nativeFetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
  if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`);
  __mcVersionManifestCache = await res.json();
  return __mcVersionManifestCache;
}

/** All Mojang-published versions (newest first) for the create-instance picker. */
async function fetchMinecraftVersions() {
  try {
    const data = await getMcVersionManifest();
    const list = (data.versions || []).map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
    list.sort((a, b) => String(b.releaseTime).localeCompare(String(a.releaseTime)));
    return list;
  } catch (e) {
    return [];
  }
}

const __versionJsonCache = new Map();

async function getVersionJson(versionId, manifest) {
  const key = String(versionId || '');
  if (!key) return null;
  if (__versionJsonCache.has(key)) return __versionJsonCache.get(key);
  const hit = manifest?.versions?.find((v) => v.id === key);
  if (!hit?.url) return null;
  const res = await nativeFetch(hit.url);
  if (!res.ok) return null;
  const json = await res.json();
  __versionJsonCache.set(key, json);
  return json;
}

/** Read the required Java major for a Minecraft version (metadata first, heuristic fallback). */
async function requiredJavaMajorForMcVersion(mcVersion) {
  try {
    const manifest = await getMcVersionManifest().catch(() => null);
    const vj = await getVersionJson(mcVersion, manifest);
    const n = vj?.javaVersion?.majorVersion ? Number(vj.javaVersion.majorVersion) : null;
    if (n && Number.isFinite(n)) return n;
  } catch (e) {}
  return guessRequiredJavaMajor(mcVersion);
}

async function fetchFabricVersions(mcVersion) {
  try {
    const res = await nativeFetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`);
    const data = await res.json();
    const arr = Array.isArray(data) ? data : [];
    return arr.slice(0, 24).map((v) => ({
      version: v.loader?.version,
      stable: v.loader?.stable
    })).filter((v) => v.version);
  } catch (e) {
    return [];
  }
}

/**
 * MCLC expects `version.custom` to name a folder under `root/versions/` containing
 * `{custom}.json` (Fabric merged profile). MCLC does not download that file — only vanilla jar/json.
 */
async function ensureFabricProfile(instanceDir, mcVersion, loaderVersion) {
  const customId = fabricCustomVersionId(loaderVersion, mcVersion);
  const versionFolder = path.join(instanceDir, 'versions', customId);
  const profilePath = path.join(versionFolder, `${customId}.json`);

  if (fs.existsSync(profilePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      if (existing && existing.id === customId && existing.inheritsFrom === mcVersion) {
        return customId;
      }
    } catch (e) {
      /* re-download */
    }
  }

  fs.ensureDirSync(versionFolder);
  const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const res = await nativeFetch(url);
  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 240);
    throw new Error(
      `Fabric profile not available (HTTP ${res.status}). Check that loader ${loaderVersion} supports Minecraft ${mcVersion}. ${snippet}`
    );
  }
  const profile = await res.json();
  if (!profile || typeof profile !== 'object') {
    throw new Error('Fabric meta returned an invalid profile JSON.');
  }
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  return customId;
}

module.exports = {
  ensureFabricProfile,
  getMcVersionManifest,
  fetchMinecraftVersions,
  getVersionJson,
  requiredJavaMajorForMcVersion,
  fetchFabricVersions,
  // re-exported pure helpers
  resolveVersionTypeFromManifest,
  isSnapshotLikeMcVersion,
  guessRequiredJavaMajor,
  fabricCustomVersionId
};
