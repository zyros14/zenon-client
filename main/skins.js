/** Skins: local library, Mojang default seeding, Mojang profile sync. */
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { SKINS_DIR, SKIN_LIBRARY_FILE } = require('./paths');
const { loadSettings } = require('./settings');
const { nativeFetch } = require('./nativeFetch');
const { isValidSkinPng } = require('./lib/text');
// ===== Skins: library storage + Mojang profile sync =====
const SKIN_VARIANTS = ['CLASSIC', 'SLIM'];

function loadSkinLibrary() {
  try {
    if (!fs.existsSync(SKIN_LIBRARY_FILE)) return [];
    const j = JSON.parse(fs.readFileSync(SKIN_LIBRARY_FILE, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch (e) {
    return [];
  }
}

function saveSkinLibrary(entries) {
  fs.writeFileSync(SKIN_LIBRARY_FILE, JSON.stringify(entries, null, 2));
}

function skinFilePath(id) {
  return path.join(SKINS_DIR, `${id}.png`);
}


// ===== Seed Mojang's official default skins into the library (first run only) =====
// Nine defaults, one entry each — arm model is a user toggle (Auto/Classic/Slim), so we don't seed both variants.
// Textures are extracted from the user's own legally-obtained Minecraft client jar at runtime — nothing is redistributed.
const SKIN_DEFAULTS_V2_MARKER = path.join(SKINS_DIR, '.defaults-seeded-v2');
const SKIN_V1_MIGRATION_MARKER = path.join(SKINS_DIR, '.defaults-v1-migrated');
let __defaultsSeededThisRun = false;
const DEFAULT_SKIN_NAMES = ['steve', 'alex', 'sunny', 'efe', 'zuri', 'noor', 'ari', 'makena', 'kai'];
const capName = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const DEFAULT_SKIN_ENTRIES = DEFAULT_SKIN_NAMES.map((n) => ({
  file: `assets/minecraft/textures/entity/player/wide/${n}.png`,
  name: capName(n),
  variant: 'DEFAULT'
}));
const V1_DEFAULT_NAMES = new Set([
  ...DEFAULT_SKIN_NAMES.map((n) => `${capName(n)} (Classic)`),
  ...DEFAULT_SKIN_NAMES.map((n) => `${capName(n)} (Slim)`)
]);

function findVanillaJarCandidates() {
  const roots = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'zenon-client', 'instances'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'com.zenon.client', 'instances'),
    process.env.APPDATA && path.join(process.env.APPDATA, '.minecraft', 'versions')
  ].filter(Boolean);
  const candidates = [];
  const walk = (dir, depth) => {
    if (depth > 5) return;
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const it of items) {
      const full = path.join(dir, it.name);
      try {
        if (it.isDirectory()) {
          const n = it.name.toLowerCase();
          if (n === '.fabric' || n === 'cache' || n === 'node_modules' || n === 'mods') continue; // skip derived/mod jars
          walk(full, depth + 1);
        } else if (it.isFile() && it.name.toLowerCase().endsWith('.jar')) {
          // Prefer the standard version layout: <root>/<uuid>/versions/<v>/<v>.jar and <root>/<v>/<v>.jar
          const inVersions = /versions[\\/]/.test(full);
          candidates.push({ p: full, mtime: fs.statSync(full).mtimeMs, inVersions });
        }
      } catch (e) {}
    }
  };
  for (const r of roots) { try { walk(r, 0); } catch (e) {} }
  const preferred = candidates.filter(c => c.inVersions);
  const pool = preferred.length ? preferred : candidates;
  pool.sort((a, b) => b.mtime - a.mtime);
  return pool.slice(0, 8);
}

async function seedDefaultSkinsOnce() {
  if (__defaultsSeededThisRun) return;
  __defaultsSeededThisRun = true;
  try {
    // Migration: drop the earlier Classic/Slim-split defaults (user-added skins are untouched)
    if (!fs.existsSync(SKIN_V1_MIGRATION_MARKER)) {
      try {
        const lib = loadSkinLibrary().filter((s) => !V1_DEFAULT_NAMES.has(String(s?.name)));
        saveSkinLibrary(lib);
        fs.writeFileSync(SKIN_V1_MIGRATION_MARKER, new Date().toISOString());
      } catch (e) {}
    }
    if (fs.existsSync(SKIN_DEFAULTS_V2_MARKER)) return;
    const AdmZip = require('adm-zip');
    for (const { p } of findVanillaJarCandidates()) {
      let zip = null;
      try { zip = new AdmZip(p); } catch (e) { continue; }
      const extracted = [];
      let ok = true;
      try {
        for (const e of DEFAULT_SKIN_ENTRIES) {
          const ze = zip.getEntry(e.file);
          if (!ze) { ok = false; break; }
          extracted.push({ ...e, buf: ze.getData() });
        }
      } catch (e) { ok = false; }
      if (!ok) continue; // modern-format jars only; try next candidate
      const entriesToWrite = extracted.filter((e) => isValidSkinPng(e.buf));
      if (entriesToWrite.length === 0) continue;
      const library = loadSkinLibrary();
      const base = Date.now();
      entriesToWrite.forEach((e, i) => {
        const id = uuidv4();
        try {
          fs.writeFileSync(skinFilePath(id), e.buf);
          library.push({
            id,
            name: e.name,
            variant: e.variant,
            width: 64,
            height: 64,
            addedAt: new Date(base + i).toISOString(),
            builtin: true
          });
        } catch (err) {}
      });
      saveSkinLibrary(library);
      fs.writeFileSync(SKIN_DEFAULTS_V2_MARKER, new Date().toISOString());
      return;
    }
  } catch (e) { /* non-fatal — library just starts empty */ }
}

function readSkinEntryWithData(entry) {
  try {
    const p = skinFilePath(entry.id);
    if (!fs.existsSync(p)) return { ...entry, missing: true };
    const buf = fs.readFileSync(p);
    return { ...entry, dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
  } catch (e) {
    return { ...entry, missing: true };
  }
}

async function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Friendly, actionable message for the common Mojang failure modes (esp. 429). */
function skinMojangHttpError(status) {
  if (status === 429) return 'Mojang is rate-limiting right now — wait a minute and try again.';
  if (status === 401 || status === 403) return 'Your Microsoft session was rejected — sign out and back in.';
  if (status >= 500 && status < 600) return `Mojang is having issues right now (HTTP ${status}) — try again shortly.`;
  return `HTTP ${status}`;
}

/** GET with retry + backoff on 429 / 5xx. Honors Retry-After (capped). */
async function fetchWithRetry(fetchImpl, url, opts = {}, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, opts);
    if (res.ok) return res;
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (!retryable || attempt === retries) return res;
    const retryAfterRaw = String((res.headers && res.headers.get && res.headers.get('retry-after')) || '').trim();
    const retryAfter = Number(retryAfterRaw) || 0;
    const wait = retryAfter > 0 ? Math.min(5000, retryAfter * 1000) : Math.min(5000, 350 * Math.pow(2, attempt));
    await sleepMs(wait);
  }
}

const MOJANG_PROFILE_CACHE_TTL_MS = 90 * 1000;
let __mojangProfileCache = { at: 0, data: null };

async function fetchMinecraftProfileSkins(force = false) {
  const cached = __mojangProfileCache;
  if (!force && cached.data && Date.now() - cached.at < MOJANG_PROFILE_CACHE_TTL_MS) {
    return cached.data;
  }
  const settings = loadSettings();
  const token = settings?.auth?.minecraft?.accessToken;
  if (!token) return { success: false, error: 'Not signed in with Microsoft.' };
  const res = await fetchWithRetry(nativeFetch, 'https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'ZenonClient/1.1.4' }
  }, 2);
  if (!res.ok) return { success: false, error: skinMojangHttpError(res.status) };
  const j = await res.json();
  const skins = Array.isArray(j?.skins) ? j.skins : [];
  const active = skins.find((s) => s && s.state === 'ACTIVE') || skins[0] || null;
  const out = {
    success: true,
    profile: {
      id: j?.id || null,
      name: j?.name || null,
      skins,
      active: active
        ? {
            id: active.id || null,
            url: active.url || null,
            variant: active.variant || 'CLASSIC',
            textureKey: active.textureKey || null
          }
        : null
    }
  };
  __mojangProfileCache = { at: Date.now(), data: out };
  return out;
}

async function downloadSkinToFile(url, destPath) {
  const u = String(url || '').trim();
  if (!u) throw new Error('Missing skin URL');
  const res = await fetchWithRetry(fetch, u, { headers: { 'User-Agent': 'ZenonClient/1.1.4' } }, 2);
  if (!res.ok) throw new Error(skinMojangHttpError(res.status));
  const buf = await res.buffer();
  fs.writeFileSync(destPath, buf);
  return buf;
}

module.exports = {
  SKIN_VARIANTS,
  loadSkinLibrary,
  saveSkinLibrary,
  skinFilePath,
  seedDefaultSkinsOnce,
  readSkinEntryWithData,
  sleepMs,
  skinMojangHttpError,
  fetchWithRetry,
  fetchMinecraftProfileSkins,
  downloadSkinToFile
};
