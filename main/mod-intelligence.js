/**
 * Mod Intelligence — analyze an instance's installed mods and report:
 *   - incompatible   mods with no version compatible with this MC version + loader
 *   - missingDeps    required dependencies that aren't installed
 *   - duplicates     same mod installed more than once (by project or by jar mod-id)
 *   - outdated       installed file sha1 differs from the latest compatible version
 *   - crashSuspects  mods named in latest.log error/stack lines (evidence-based)
 *   - recommendations compatible alternative mods for flagged mods
 *
 * Pure structural checks live here; version/dep lookups call the Modrinth /
 * CurseForge discovery helpers (network). Nothing mutates disk.
 */
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { modrinthVersionCompatible } = require('./lib/versions');

const MODRINTH_UA = { 'User-Agent': 'ZenonClient/1.1.4' };
const PROJECT_CACHE_TTL = 10 * 60 * 1000;
const __projCache = new Map();
const __versionCache = new Map();

async function fetchProjectCached(projectId) {
  const key = String(projectId || '');
  if (!key) return null;
  const hit = __projCache.get(key);
  if (hit && Date.now() - hit.at < PROJECT_CACHE_TTL) return hit.data;
  try {
    const res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(key)}`, {
      headers: MODRINTH_UA
    });
    if (!res.ok) return null;
    const data = await res.json();
    __projCache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    return null;
  }
}

async function fetchVersionByIdCached(versionId) {
  const key = String(versionId || '');
  if (!key) return null;
  const hit = __versionCache.get(key);
  if (hit && Date.now() - hit.at < PROJECT_CACHE_TTL) return hit.data;
  try {
    const res = await fetch(`https://api.modrinth.com/v2/version/${encodeURIComponent(key)}`, {
      headers: MODRINTH_UA
    });
    if (!res.ok) return null;
    const data = await res.json();
    __versionCache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    return null;
  }
}

function sha1OfFile(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').toLowerCase();
}

/** Tail-read the instance's latest.log. */
function readInstanceLog(instanceId) {
  const { readInstanceConfig } = require('./instances');
  const cfg = readInstanceConfig(instanceId);
  if (!cfg) return '';
  const root = cfg.dir;
  if (!root) return '';
  const logPath = path.join(root, 'logs', 'latest.log');
  try {
    if (!fs.existsSync(logPath)) return '';
    const stat = fs.statSync(logPath);
    const maxBytes = 120000;
    const len = Math.min(stat.size, maxBytes);
    const fd = fs.openSync(logPath, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, Math.max(0, stat.size - len));
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (e) {
    return '';
  }
}

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Best-effort mod-id read from a jar (fabric.mod.json / mods.toml / mcmod.info). */
function readJarModId(file) {
  try {
    const zip = new AdmZip(file);
    for (const name of ['fabric.mod.json', 'mods.toml', 'mcmod.info']) {
      const e = zip.getEntries().find((entry) => (entry.entryName || '').replace(/\\/g, '/').split('/').pop() === name);
      if (!e) continue;
      const raw = e.getData().toString('utf8');
      if (name === 'fabric.mod.json') {
        try {
          const j = JSON.parse(raw);
          if (j && j.id) return String(j.id);
        } catch (_) {}
      }
      if (name === 'mods.toml') {
        const m = raw.match(/modId\s*=\s*["']([^"']+)["']/);
        if (m) return m[1];
      }
      if (name === 'mcmod.info') {
        try {
          const j = JSON.parse(raw);
          if (Array.isArray(j) && j[0] && j[0].modid) return String(j[0].modid);
        } catch (_) {}
      }
    }
  } catch (e) {
    // not a zip or unreadable — ignore
  }
  return null;
}

function installedProjectIds(mods) {
  return new Set(mods.filter((m) => m.projectId).map((m) => String(m.projectId)));
}

/** The newest compatible version for this instance, or {version: null, ok: false} when we couldn't reach data. */
async function latestCompatibleVersion(projectId, mcVersion, loader, loaders) {
  const { getProjectVersions } = require('./discovery');
  try {
    const versions = await getProjectVersions(projectId, mcVersion, loader, loaders);
    if (!Array.isArray(versions) || versions.length === 0) return { version: null, ok: false };
    for (const v of versions) {
      if (!modrinthVersionCompatible(v, mcVersion, loader)) continue;
      const file = (v.files || []).find((f) => f.primary) || (v.files || [])[0];
      if (file && file.url) return { version: v, ok: true };
    }
    return { version: null, ok: true }; // reachable, but nothing compatible
  } catch (e) {
    return { version: null, ok: false };
  }
}

function logErrorLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((l) => /ERROR|Exception|Fatal|crash|Failed/i.test(l));
}

/** Find installed mods named in error lines; evidence = matching lines. */
function findCrashSuspects(mods, logText) {
  const lines = logErrorLines(logText);
  if (lines.length === 0) return [];
  const suspects = [];
  for (const mod of mods) {
    const haystack = lines.join('\n');
    const tokens = new Set([
      normalizeName(mod.title || ''),
      normalizeName(mod.filename || ''),
      normalizeName(mod.modId || '')
    ].filter(Boolean));
    if (tokens.size === 0) continue;
    const evidence = [];
    for (const line of lines) {
      const low = line.toLowerCase();
      for (const t of tokens) {
        if (t.length > 2 && low.includes(t)) {
          evidence.push(line.trim().slice(0, 200));
          break;
        }
      }
    }
    if (evidence.length === 0) continue;
    let confidence = 'low';
    if (evidence.some((l) => /Exception|Error/i.test(l))) confidence = 'medium';
    if (evidence.some((l) => /Exception|Error/i.test(l) && /at |caused by/i.test(l))) confidence = 'high';
    suspects.push({
      mod: { filename: mod.filename, title: mod.title, projectId: mod.projectId },
      evidence: evidence.slice(0, 5),
      confidence
    });
  }
  return suspects;
}

/** Recommend compatible alternatives for a flagged mod. */
async function recommendAlternatives(projectId, title, mcVersion, loader, loaders, limit = 3) {
  const { searchModrinth } = require('./discovery');
  const query = title || projectId || '';
  try {
    const res = await searchModrinth({ query, version: mcVersion, loader, projectType: 'mod', limit: limit + 2, offset: 0 });
    const hits = Array.isArray(res?.hits) ? res.hits : [];
    const alts = [];
    for (const h of hits) {
      if (String(h.project_id || h.id || '') === String(projectId)) continue;
      alts.push({
        title: h.title || 'Untitled',
        projectId: h.project_id || h.id || null,
        source: h.source || 'modrinth',
        downloads: h.downloads || 0,
        iconUrl: h.icon_url || null,
        author: h.author || null
      });
      if (alts.length >= limit) break;
    }
    return alts;
  } catch (e) {
    return [];
  }
}

/**
 * Top-level analysis for one instance.
 * @param {string} instanceId
 * @returns {Promise<{summary, incompatible, missingDeps, duplicates, outdated, crashSuspects, recommendations}>}
 */
async function analyzeInstanceMods(instanceId) {
  const { readInstanceConfig } = require('./instances');
  const { listInstanceContent } = require('./content');
  const cfg = readInstanceConfig(instanceId);
  if (!cfg) throw new Error('Instance not found');
  const mcVersion = String(cfg.version || '');
  const loader = (cfg.loader && cfg.loader !== 'vanilla') ? cfg.loader : null;
  const loaders = loader ? [loader] : null;

  const mods = (require('./content').listInstanceContent(instanceId, 'mod') || []).map((m) => ({
    ...m,
    modId: readJarModId(m.path)
  }));
  const byProject = installedProjectIds(mods);

  const incompatible = [];
  const outdated = [];
  const missingDeps = [];
  const recommendations = [];

  // Per-mod checks (network). Bounded concurrency to avoid hammering APIs.
  const concurrency = 4;
  const queue = [...mods];
  const results = [];
  const runNext = async () => {
    while (queue.length) {
      const mod = queue.shift();
      if (!mod) break;
      results.push(await analyzeSingleMod(mod, mcVersion, loader, loaders, byProject));
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, mods.length); i++) workers.push(runNext());
  await Promise.all(workers);

  for (const r of results) {
    if (r.incompatible) incompatible.push(r.incompatible);
    if (r.outdated) outdated.push(r.outdated);
    for (const dep of r.missingDeps || []) missingDeps.push(dep);
    for (const alt of r.recommendations || []) recommendations.push(alt);
  }

  // Duplicates: same projectId installed more than once.
  const byPid = {};
  for (const mod of mods) {
    if (!mod.projectId) continue;
    (byPid[String(mod.projectId)] = byPid[String(mod.projectId)] || []).push(mod);
  }
  const duplicates = [];
  for (const [pid, files] of Object.entries(byPid)) {
    if (files.length < 2) continue;
    duplicates.push({
      projectId: pid,
      title: files[0].title || pid,
      files: files.map((f) => ({ filename: f.filename, enabled: f.enabled, title: f.title }))
    });
  }
  // Duplicates by jar mod-id across different filenames (different projects).
  const byModId = {};
  for (const mod of mods) {
    if (!mod.modId) continue;
    (byModId[mod.modId] = byModId[mod.modId] || []).push(mod);
  }
  for (const [modId, files] of Object.entries(byModId)) {
    if (files.length < 2) continue;
    duplicates.push({
      projectId: null,
      title: `Mod id "${modId}"`,
      files: files.map((f) => ({ filename: f.filename, enabled: f.enabled, title: f.title })),
      modId
    });
  }

  // Crash suspects from latest.log.
  const logText = readInstanceLog(instanceId);
  const crashSuspects = await findCrashSuspects(mods, logText);

  const summary = {
    incompatibleCount: incompatible.length,
    missingDepsCount: missingDeps.length,
    duplicatesCount: duplicates.length,
    outdatedCount: outdated.length,
    crashSuspectCount: crashSuspects.length,
    risk: 'low'
  };
  if (summary.incompatibleCount || summary.duplicatesCount) summary.risk = 'high';
  else if (summary.missingDepsCount || summary.outdatedCount || summary.crashSuspectCount) summary.risk = 'medium';

  return {
    instanceId,
    mcVersion,
    loader: loader || 'vanilla',
    scannedAt: new Date().toISOString(),
    summary,
    incompatible,
    missingDeps,
    duplicates,
    outdated,
    crashSuspects,
    recommendations
  };
}

async function analyzeSingleMod(mod, mcVersion, loader, loaders, byProject) {
  const out = { incompatible: null, outdated: null, missingDeps: [], recommendations: [] };
  const projectId = mod.projectId;
  if (!projectId) return out;

  const { version: latest, ok } = await latestCompatibleVersion(projectId, mcVersion, loader, loaders);
  if (!ok) {
    // Couldn't reach version data (offline / API error) — don't flag as incompatible.
    return out;
  }
  if (!latest) {
    out.incompatible = {
      filename: mod.filename,
      title: mod.title || projectId,
      projectId,
      reason: `No compatible version for Minecraft ${mcVersion || '?'}${
        loader ? ` / ${loader}` : ''
      }`,
      severity: 'high'
    };
    return out;
  }

  // Outdated: compare local sha1 to the latest compatible primary file sha1.
  const latestFile = (latest.files || []).find((f) => f.primary) || (latest.files || [])[0];
  const latestSha1 = String(latestFile?.hashes?.sha1 || '').toLowerCase();
  if (latestSha1) {
    try {
      const localSha1 = sha1OfFile(mod.path);
      if (localSha1 && localSha1 !== latestSha1) {
        out.outdated = {
          filename: mod.filename,
          title: mod.title || projectId,
          projectId,
          localVersion: mod.versionNumber || null,
          latestVersion: latest.version_number || null,
          versionId: latest.id || null
        };
      }
    } catch (e) {
      // unreadable file — skip outdated check
    }
  }

  // Missing required dependencies (Modrinth version metadata).
  const versionId = mod.versionId || (latest.id && mod.versionId ? mod.versionId : null);
  const version = versionId ? await fetchVersionByIdCached(versionId) : null;
  const deps = Array.isArray(version?.dependencies) ? version.dependencies : [];
  for (const dep of deps) {
    if (String(dep.dependency_type || '').toLowerCase() !== 'required') continue;
    const depPid = String(dep.project_id || '');
    if (!depPid) continue;
    if (byProject.has(depPid)) continue;
    const proj = await fetchProjectCached(depPid);
    missingDepsPush(out, {
      mod: { filename: mod.filename, title: mod.title || projectId, projectId },
      dep: {
        projectId: depPid,
        title: proj?.title || depPid,
        versionId: dep.version_id || null,
        type: dep.dependency_type || 'required'
      },
      satisfied: false
    });
  }

  // Recommendations only for mods flagged as problematic.
  if (out.incompatible || out.outdated || out.missingDeps.length) {
    out.recommendations = await recommendAlternatives(
      projectId, mod.title, mcVersion, loader, loaders
    ).then((alts) => alts.map((a) => ({ for: { filename: mod.filename, title: mod.title, projectId }, alt: a })));
  }

  return out;
}

function missingDepsPush(out, entry) {
  out.missingDeps.push(entry);
}

module.exports = {
  analyzeInstanceMods,
  analyzeSingleMod,
  readInstanceLog,
  readJarModId,
  findCrashSuspects,
  recommendAlternatives,
  sha1OfFile,
  normalizeName,
  latestCompatibleVersion
};
