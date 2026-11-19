/**
 * Minecraft version / loader compatibility helpers.
 * Pure Node (path is a builtin) — no Electron, no app state.
 */
const path = require('path');

/** True when the given version id looks like a snapshot/pre/rc instead of a stable release. */
function isSnapshotLikeMcVersion(versionId, manifest) {
  if (!versionId) return false;
  try {
    const hit = manifest?.versions?.find((v) => v.id === versionId);
    if (hit && hit.type && hit.type !== 'release') return true;
  } catch (e) {}
  return /snapshot|rc\d*(\.|$)|pre|beta|alpha|\d{2}w\d{2}[a-z]/i.test(String(versionId));
}

/** Resolve the Mojang manifest `type` for a version id (fallback 'release'). */
function resolveVersionTypeFromManifest(manifest, versionId, fallback = 'release') {
  if (!manifest?.versions || !versionId) return fallback;
  const hit = manifest.versions.find((v) => v.id === versionId);
  return hit?.type || fallback;
}

/**
 * Sort full Forge ids newest-first (the Forge dropdown expects descending order).
 * Compares the trailing build version numerically per dotted segment, so
 * 47.10.0 sorts ahead of 47.3.0 (a plain string compare gets this wrong).
 */
function compareForgeFullIdDesc(a, b) {
  const splitFull = (s) => String(s).split('-', 2);
  const [, ba = ''] = splitFull(a);
  const [, bb = ''] = splitFull(b);
  const pa = ba.split('.');
  const pb = bb.split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] || '0', 10);
    const nb = parseInt(pb[i] || '0', 10);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return nb - na; // descending
  }
  return String(b).localeCompare(String(a)); // descending fallback, unstable ties broken by string
}

/** e.g. 1.21.10-rc1 → [1.21.10-rc1, 1.21.10] (Forge promos/maven use release ids). */
function forgeMcVersionFallbacks(mcVersion) {
  const raw = String(mcVersion || '').trim();
  if (!raw) return [];
  const uniq = [];
  const add = (s) => {
    if (s && !uniq.includes(s)) uniq.push(s);
  };
  add(raw);
  const m = raw.match(/^(\d+\.\d+(?:\.\d+)?)-(.+)$/);
  if (m) {
    const tail = m[2];
    if (/^(rc|pre)\d*$/i.test(tail) || /^\d{2}w\d*[a-z]?$/i.test(tail) || /^snapshot$/i.test(tail) || /^alpha|beta/i.test(tail)) {
      add(m[1]);
    }
  }
  return uniq;
}

/** Fallback when version metadata is unavailable (26.x → 25, 1.20.5+ → 21, 1.18+ → 17, older → 8). */
function guessRequiredJavaMajor(mcVersion) {
  const m = String(mcVersion || '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return 8;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2] || '0', 10);
  const c = parseInt(m[3] || '0', 10);
  if (a >= 26) return 25;
  if (a === 1) {
    if (b >= 21) return 21;
    if (b === 20) return c >= 5 ? 21 : 17;
    if (b >= 18) return 17;
    if (b === 17) return 17;
    return 8;
  }
  return 8;
}

/** MCLC `version.custom` id for the merged Fabric loader profile (folder under root/versions/). */
function fabricCustomVersionId(loaderVersion, mcVersion) {
  return `fabric-loader-${loaderVersion}-${mcVersion}`;
}

/** Pull the mcVersion out of a Modrinth dependency entry (string or object). */
function parseMcVersionFromModrinthDep(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    const m = raw.match(/(\d+\.\d+(?:\.\d+)?)/);
    return m ? m[1] : String(raw).trim();
  }
  if (typeof raw === 'object' && raw.version != null) return parseMcVersionFromModrinthDep(raw.version);
  return '';
}

/** Loader hint from a .mrpack dependencies block; 'vanilla' when nothing loader-specific is pinned. */
function loaderFromMrpackDependencies(deps) {
  if (!deps || typeof deps !== 'object') return 'vanilla';
  if (deps['fabric-loader'] != null) return 'fabric';
  if (deps['quilt-loader'] != null) return 'quilt';
  if (deps.neoforge != null) return 'neoforge';
  if (deps.forge != null) return 'forge';
  return 'vanilla';
}

/** True when a Modrinth version entry matches the requested mcVersion/loader (empty filters pass). */
function modrinthVersionCompatible(version, mcVersion, loader) {
  if (!version) return false;
  if (mcVersion && Array.isArray(version.game_versions) && version.game_versions.length && !version.game_versions.includes(mcVersion)) return false;
  if (loader && Array.isArray(version.loaders) && version.loaders.length && !version.loaders.includes(loader)) return false;
  return true;
}

/**
 * Join `relPath` (posix-style, from a modpack manifest) under `instanceRoot`.
 * Throws on absolute paths, `..` segments or anything escaping the root.
 */
function safeJoinUnderInstanceRoot(instanceRoot, relPath) {
  const relative = String(relPath || '').replace(/\\/g, '/');
  if (!relative || relative.split('/').includes('..')) throw new Error(`Invalid path in modpack: ${relPath}`);
  const joined = path.resolve(path.join(instanceRoot, ...relative.split('/')));
  const rootResolved = path.resolve(instanceRoot);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (joined !== rootResolved && !joined.startsWith(prefix)) {
    throw new Error(`Path escapes instance root: ${relPath}`);
  }
  return joined;
}

module.exports = {
  isSnapshotLikeMcVersion,
  resolveVersionTypeFromManifest,
  compareForgeFullIdDesc,
  forgeMcVersionFallbacks,
  guessRequiredJavaMajor,
  fabricCustomVersionId,
  parseMcVersionFromModrinthDep,
  loaderFromMrpackDependencies,
  modrinthVersionCompatible,
  safeJoinUnderInstanceRoot
};
