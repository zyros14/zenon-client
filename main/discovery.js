/** Discovery: CurseForge (via proxy), Modrinth and Spiget search/install, modpack creation. */
const fetch = require('node-fetch');
const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const { nativeFetch } = require('./nativeFetch');
const { getContentDir, readContentMeta, writeContentMeta } = require('./content');
const { createInstance, deleteInstance, updateInstance, downloadInstanceIconFromUrl, readInstanceConfig } = require('./instances');
const { parseMcVersionFromModrinthDep, loaderFromMrpackDependencies, safeJoinUnderInstanceRoot, modrinthVersionCompatible } = require('./lib/versions');
// ===== CurseForge API (via Vercel proxy — the API key never ships in the client) =====
// The proxy at curseforge-proxy.vercel.app injects x-api-key server-side.
const CF_PROXY = 'https://curseforge-proxy.vercel.app/api/cf';
const CF_GAME_ID = 432; // Minecraft
const CF_CLASS_IDS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 6945 };
const CF_LOADER_TYPES = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const CF_LOADER_NAMES = ['forge', 'fabric', 'quilt', 'neoforge'];

async function cfFetchJson(pathAndQuery) {
  const res = await nativeFetch(`${CF_PROXY}/${pathAndQuery}`, {
    headers: { 'User-Agent': 'ZenonClient/1.1.4', Accept: 'application/json' }
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  if (!res.ok) {
    const err = new Error(`CurseForge HTTP ${res.status}`);
    err.status = res.status;
    err.body = String(text || '').slice(0, 300);
    throw err;
  }
  return json || { data: [], pagination: { totalCount: 0 } };
}

async function searchCurseforge({ query, version, loader, projectType = 'mod', limit = 20, offset = 0 }) {
  try {
    const classId = CF_CLASS_IDS[projectType] || CF_CLASS_IDS.mod;
    const pageSize = Math.max(1, Math.min(50, Number(limit) || 20));
    const params = [
      `gameId=${CF_GAME_ID}`,
      `classId=${classId}`,
      `index=${Math.max(0, Number(offset) || 0)}`,
      `pageSize=${pageSize}`,
      `sortField=2`, // Popularity
      `sortOrder=desc`
    ];
    const q = String(query || '').trim();
    if (q) params.push(`searchFilter=${encodeURIComponent(q)}`);
    const v = String(version || '').trim();
    const l = String(loader || '').toLowerCase();
    const loaderType = CF_LOADER_TYPES[l] || null;
    // modLoaderType must be coupled with gameVersion — skip the loader filter when no version filter is set.
    if (v) {
      params.push(`gameVersion=${encodeURIComponent(v)}`);
      if (projectType === 'mod' && loaderType) params.push(`modLoaderType=${loaderType}`);
    }
    const j = await cfFetchJson(`v1/mods/search?${params.join('&')}`);
    const mods = Array.isArray(j?.data) ? j.data : [];
    const hits = mods.map((m) => ({
      project_id: `cf-${m.id}`,
      title: m.name || 'Untitled',
      author: (Array.isArray(m.authors) && m.authors[0] && m.authors[0].name) || 'Unknown',
      description: m.summary || '',
      downloads: m.downloadCount || 0,
      icon_url: (m.logo && m.logo.thumbnailUrl) ? m.logo.thumbnailUrl : '',
      source: 'curseforge'
    }));
    return { hits, total_hits: (j && j.pagination && j.pagination.totalCount) || hits.length };
  } catch (e) {
    let msg = (e && e.message) || String(e);
    if (e && e.status === 403) {
      msg = 'CurseForge refused the request (403). The proxy key needs to be regenerated — at console.curseforge.com, rename the organization, then recreate the API key.';
    }
    return { hits: [], total_hits: 0, error: msg };
  }
}

async function getCurseforgeProjectVersions(cfModId, mcVersion, loader) {
  try {
    const params = ['index=0', 'pageSize=30'];
    const v = String(mcVersion || '').trim();
    const l = String(loader || '').toLowerCase();
    const loaderType = CF_LOADER_TYPES[l] || null;
    // modLoaderType must be coupled with gameVersion.
    if (v) {
      params.push(`gameVersion=${encodeURIComponent(v)}`);
      if (loaderType) params.push(`modLoaderType=${loaderType}`);
    }
    const j = await cfFetchJson(`v1/mods/${encodeURIComponent(cfModId)}/files?${params.join('&')}`);
    const files = Array.isArray(j?.data) ? j.data : [];
    // Show newest first regardless of API sort semantics.
    files.sort((a, b) => new Date(b?.fileDate || 0) - new Date(a?.fileDate || 0));
    const loaderName = CF_LOADER_NAMES.includes(l) ? l : null;
    return files.map((f) => {
      const gvs = Array.isArray(f.gameVersions) ? f.gameVersions.map(String) : [];
      const detected = gvs.filter((g) => CF_LOADER_NAMES.includes(String(g).toLowerCase())).map((g) => String(g).toLowerCase());
      const tags = gvs.filter((g) => /^\d/.test(g));
      const url = (f.downloadUrl && String(f.downloadUrl)) || `${CF_PROXY}/v1/mods/${cfModId}/files/${f.id}/download`;
      return {
        id: `cf-${f.id}`,
        name: f.displayName || f.fileName || `File ${f.id}`,
        version_number: f.fileName || String(f.id),
        game_versions: tags.length ? tags : gvs,
        loaders: loaderName ? [loaderName] : detected,
        project_id: `cf-${cfModId}`,
        _cf: true,
        files: [{ url, filename: f.fileName || `curseforge-${cfModId}-${f.id}.jar`, primary: true }]
      };
    });
  } catch (e) {
    return [];
  }
}

// Modrinth API
async function searchModrinth({ query, version, loader, projectType = 'mod', limit = 20, offset = 0 }) {
  try {
    const facets = [];
    if (version) facets.push(`["versions:${version}"]`);
    if (loader) facets.push(`["categories:${loader}"]`);
    facets.push(`["project_type:${projectType}"]`);

    const facetsStr = `[${facets.join(',')}]`;
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(facetsStr)}&limit=${limit}&offset=${offset}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'ZenonClient/1.1.4' }
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e2) {
      data = { hits: [], total_hits: 0, error: `Invalid JSON from Modrinth (HTTP ${res.status})` };
    }
    if (!res.ok) {
      return { hits: [], total_hits: 0, error: `Modrinth HTTP ${res.status}: ${String(text || '').slice(0, 220)}` };
    }
    return data;
  } catch (e) {
    return { hits: [], total_hits: 0, error: e?.message || String(e) };
  }
}

// Spiget (Spigot plugins) API

async function spigetSearchResources({ query, size = 20, page = 1, mode = 'search' }) {
  try {
    const lim = Math.min(Math.max(parseInt(String(size), 10) || 20, 1), 50);
    const pg = Math.max(parseInt(String(page), 10) || 1, 1);
    const m = String(mode || 'search').toLowerCase();
    let url = '';
    if (m === 'new') {
      url = `https://api.spiget.org/v2/resources/new?size=${lim}&page=${pg}`;
    } else if (m === 'free') {
      url = `https://api.spiget.org/v2/resources/free?size=${lim}&page=${pg}`;
    } else {
      const q = String(query || '').trim();
      if (!q) return [];
      const safeQ = encodeURIComponent(q);
      url = `https://api.spiget.org/v2/search/resources/${safeQ}?size=${lim}&page=${pg}`;
    }
    const res = await fetch(url, { headers: { 'User-Agent': 'ZenonClient/1.1.4' } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

async function spigetGetResource(resourceId) {
  const id = String(resourceId || '').trim();
  if (!id) throw new Error('Missing resource id');
  const url = `https://api.spiget.org/v2/resources/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ZenonClient/1.1.4' } });
  if (!res.ok) throw new Error(`Spiget resource HTTP ${res.status}`);
  return await res.json();
}

async function spigetDownloadResourceJar(resourceId) {
  const id = String(resourceId || '').trim();
  if (!id) throw new Error('Missing resource id');
  const url = `https://api.spiget.org/v2/resources/${encodeURIComponent(id)}/download`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ZenonClient/1.1.4' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Spiget download HTTP ${res.status}`);
  const buf = await res.buffer();
  if (!buf?.length) throw new Error('Empty download');
  // Try to infer filename from content-disposition if provided.
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i);
  const filename = m ? decodeURIComponent(m[1]) : '';
  return { buffer: buf, filenameHint: filename };
}


// CurseForge removed

async function getProjectVersions(projectId, mcVersion, loader, loaders = null) {
  if (String(projectId || '').startsWith('cf-')) {
    const cfModId = String(projectId).slice(3);
    const l = loader || (Array.isArray(loaders) && loaders[0]) || null;
    return await getCurseforgeProjectVersions(cfModId, mcVersion, l);
  }
  try {
    let url = `https://api.modrinth.com/v2/project/${projectId}/version`;
    const params = [];
    if (mcVersion) {
      params.push(`game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}`);
    }
    if (loaders && Array.isArray(loaders) && loaders.length) {
      params.push(`loaders=${encodeURIComponent(JSON.stringify(loaders))}`);
    } else if (loader) {
      params.push(`loaders=${encodeURIComponent(JSON.stringify([loader]))}`);
    }
    if (params.length) url += '?' + params.join('&');

    const res = await fetch(url, {
      headers: { 'User-Agent': 'ZenonClient/1.1.4' }
    });
    return await res.json();
  } catch (e) {
    return [];
  }
}

// ----- Modrinth dependency auto-install -----
const MODRINTH_UA = { 'User-Agent': 'ZenonClient/1.1.4' };
const __mrProjectCache = new Map(); // projectId -> { at, data }

async function fetchModrinthProjectCached(projectId) {
  const key = String(projectId || '');
  if (!key) return null;
  const hit = __mrProjectCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  try {
    const res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(key)}`, { headers: MODRINTH_UA });
    if (!res.ok) return null;
    const data = await res.json();
    __mrProjectCache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    return null;
  }
}

async function fetchModrinthVersionById(versionId) {
  try {
    const res = await fetch(`https://api.modrinth.com/v2/version/${encodeURIComponent(String(versionId))}`, { headers: MODRINTH_UA });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

/**
 * Resolve + download required Modrinth dependencies for a version (BFS, depth-capped).
 * Only applies to kind 'mod'. Returns display titles in installed/skipped/failed.
 */
async function installModrinthRequiredDeps({ kind, mcVersion, loader, rootVersionData, targetDir, isAlreadyInstalled, recordMeta }) {
  const installed = [];
  const skipped = [];
  const failed = [];
  if (String(kind || '').toLowerCase() !== 'mod') return { installed, skipped, failed };

  const seenProjects = new Set([String(rootVersionData?.project_id || '')]);
  const queue = [];
  for (const d of (Array.isArray(rootVersionData?.dependencies) ? rootVersionData.dependencies : [])) {
    if (d?.dependency_type !== 'required') continue;
    if (d.project_id || d.version_id) queue.push({ projectId: d.project_id || null, versionId: d.version_id || null, depth: 1 });
  }

  const MAX_DEPS = 20;
  let guard = 0;
  while (queue.length && installed.length < MAX_DEPS && guard < 60) {
    guard++;
    const item = queue.shift();
    let projectId = item.projectId;
    let version = null;

    if (item.versionId) {
      version = await fetchModrinthVersionById(item.versionId);
      if (version?.project_id) projectId = projectId || version.project_id;
    }
    if (!projectId) { failed.push('unknown dependency'); continue; }
    const pid = String(projectId);
    if (seenProjects.has(pid)) continue;
    seenProjects.add(pid);

    const proj = await fetchModrinthProjectCached(pid);
    const title = proj?.title || pid;

    // Already installed (or queued)? Don't duplicate.
    if (await isAlreadyInstalled(pid)) { skipped.push(title); continue; }

    // If the pinned version isn't compatible with this instance, resolve the closest match.
    if (!modrinthVersionCompatible(version, mcVersion, loader)) {
      const versions = await getProjectVersions(pid, mcVersion || null, loader || null, null);
      version = Array.isArray(versions)
        ? versions.find((v) => v && Array.isArray(v.files) && (v.files.find((f) => f.primary) || v.files[0]))
        : null;
    }
    const file = version && Array.isArray(version.files) ? (version.files.find((f) => f.primary) || version.files[0]) : null;
    if (!file || !file.url) { failed.push(title); continue; }

    try {
      const res = await fetch(file.url, { headers: MODRINTH_UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.buffer();
      fs.writeFileSync(path.join(targetDir, file.filename), buffer);
      await recordMeta(file.filename, {
        projectId: pid,
        title,
        iconUrl: proj?.icon_url || null,
        author: null,
        at: Date.now()
      });
      installed.push(title);
      // Recurse into this dependency's own required deps (depth cap keeps chains bounded).
      if ((item.depth || 1) < 4) {
        for (const d of (Array.isArray(version.dependencies) ? version.dependencies : [])) {
          if (d?.dependency_type !== 'required') continue;
          if (d.project_id || d.version_id) queue.push({ projectId: d.project_id || null, versionId: d.version_id || null, depth: (item.depth || 1) + 1 });
        }
      }
    } catch (e) {
      failed.push(title);
    }
  }
  return { installed, skipped, failed };
}

async function fetchLatestFabricLoaderForMc(mcVersion) {
  try {
    const res = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`, {
      headers: { 'User-Agent': 'ZenonClient/1.1.4' }
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!Array.isArray(body) || body.length === 0) return null;
    const first = body[0];
    if (first && first.loader && first.loader.version) return first.loader.version;
  } catch (e) {}
  return null;
}

/**
 * Download a Modrinth .mrpack version, create a new instance, and extract pack files into its folder.
 */
async function createInstanceFromMrpack(versionData, displayName, iconUrl = null) {
  let inst = null;
  try {
    const file = versionData.files.find((f) => f.primary) || versionData.files[0];
    if (!file || !file.url) throw new Error('No modpack file on this version');

    const packRes = await fetch(file.url, { headers: { 'User-Agent': 'ZenonClient/1.1.4' } });
    if (!packRes.ok) throw new Error(`Download failed (HTTP ${packRes.status})`);
    const buffer = await packRes.buffer();

    const zip = new AdmZip(buffer);
    const indexEntry = zip.getEntry('modrinth.index.json');
    if (!indexEntry) throw new Error('Invalid .mrpack (missing modrinth.index.json)');
    let index;
    try {
      index = JSON.parse(indexEntry.getData().toString('utf8'));
    } catch (e) {
      throw new Error('Invalid modrinth.index.json');
    }
    const deps = index.dependencies || {};
    const mcFromVersion =
      Array.isArray(versionData.game_versions) && versionData.game_versions.length
        ? String(versionData.game_versions[0])
        : '';
    const mcFromIndex = parseMcVersionFromModrinthDep(deps.minecraft);
    const mcVersion = mcFromVersion || mcFromIndex || '1.20.1';
    let loader = loaderFromMrpackDependencies(deps);
    let loaderVersion = null;
    if (loader === 'fabric') {
      loaderVersion = await fetchLatestFabricLoaderForMc(mcVersion);
    }

    const baseNameRaw = (index.name || displayName || 'Modpack').replace(/[\\/:*?"<>|]/g, '').trim() || 'Modpack';
    inst = createInstance({
      name: baseNameRaw,
      version: mcVersion,
      versionType: 'release',
      loader,
      loaderVersion
    });
    const root = inst.dir;

    // Optional: fetch and store Modrinth icon as instance profile picture
    if (iconUrl) {
      try {
        const rel = await downloadInstanceIconFromUrl(inst.id, iconUrl);
        if (rel) {
          inst = updateInstance(inst.id, { icon: `img:${rel}` }) || inst;
        }
      } catch (e) {
        // non-fatal (modpack still installs)
      }
    }

    const files = Array.isArray(index.files) ? index.files : [];
    const modMeta = {}; // filename -> { projectId, title, iconUrl, author, at, versionId, versionNumber }

    for (const f of files) {
      const env = f.env || {};
      if (env.client === 'unsupported') continue;
      const rel = f.path;
      if (!rel || !Array.isArray(f.downloads) || !f.downloads[0]) continue;
      const dest = safeJoinUnderInstanceRoot(root, rel);
      fs.ensureDirSync(path.dirname(dest));
      const fr = await fetch(f.downloads[0], { headers: { 'User-Agent': 'ZenonClient/1.1.4' } });
      if (!fr.ok) throw new Error(`Pack file failed (${fr.status}): ${rel}`);
      const chunk = await fr.buffer();
      fs.writeFileSync(dest, chunk);

      // Persist content metadata for mods so the launcher knows title, author, source, etc.
      // Modrinth index files may not include projectId; fall back to filename-based title.
      if (rel.startsWith('mods/')) {
        try {
          const proj = await fetchModrinthProjectCached(f.projectId);
          modMeta[rel] = {
            projectId: f.projectId || null,
            title: proj?.title || f.path.split('/').pop(),
            iconUrl: proj?.icon_url || null,
            author: null,
            at: Date.now(),
            versionId: f.fileID || null,
            versionNumber: null
          };
        } catch (e) {
          modMeta[rel] = {
            projectId: f.projectId || null,
            title: f.path.split('/').pop(),
            iconUrl: null,
            author: null,
            at: Date.now(),
            versionId: f.fileID || null,
            versionNumber: null
          };
        }
      }
    }

    // Write content meta so mods from the pack are recognized by the launcher.
    try {
      const existingMeta = readContentMeta(inst.id, 'mod') || {};
      writeContentMeta(inst.id, 'mod', { ...existingMeta, ...modMeta });
    } catch (e) { /* non-fatal */ }

    for (const e of zip.getEntries()) {
      const name = e.entryName.replace(/\\/g, '/');
      if (e.isDirectory) continue;
      if (name.startsWith('overrides/') && name.length > 'overrides/'.length) {
        const inner = name.slice('overrides/'.length);
        if (inner.split('/').includes('..')) continue;
        const dest = safeJoinUnderInstanceRoot(root, inner);
        fs.ensureDirSync(path.dirname(dest));
        fs.writeFileSync(dest, e.getData());
      } else if (name.startsWith('client-overrides/') && name.length > 'client-overrides/'.length) {
        const inner = name.slice('client-overrides/'.length);
        if (inner.split('/').includes('..')) continue;
        const dest = safeJoinUnderInstanceRoot(root, inner);
        fs.ensureDirSync(path.dirname(dest));
        fs.writeFileSync(dest, e.getData());
      }
    }

    return inst;
  } catch (e) {
    if (inst && inst.id) {
      try {
        deleteInstance(inst.id);
      } catch (e2) {}
    }
    throw e;
  }
}

async function downloadProjectFile(instanceId, kind, versionData, meta = null) {
  try {
    const targetDir = getContentDir(instanceId, kind);

    const file = versionData.files.find(f => f.primary) || versionData.files[0];
    if (!file) throw new Error('No file found');

    const res = await fetch(file.url);
    const buffer = await res.buffer();
    const filePath = path.join(targetDir, file.filename);
    fs.writeFileSync(filePath, buffer);

    // Persist Modrinth project metadata so icons survive refresh/restart.
    try {
      if (meta && typeof meta === 'object') {
        const key = file.filename;
        const idx = readContentMeta(instanceId, kind);
        idx[key] = {
          projectId: meta.projectId || versionData.project_id || null,
          title: meta.title || versionData.name || null,
          iconUrl: meta.iconUrl || null,
          author: meta.author || null,
          at: Date.now()
        };
        writeContentMeta(instanceId, kind, idx);
      }
    } catch (e2) {}

    // Auto-install required Modrinth dependencies alongside the mod (Modrinth only).
    let deps = null;
    if (String(kind || '').toLowerCase() === 'mod' && !(versionData && versionData._cf)) {
      try {
        const cfg = readInstanceConfig(instanceId);
        const mcVersion = cfg?.version || '';
        const loader = cfg?.loader && cfg.loader !== 'vanilla' ? cfg.loader : null;
        const installedIds = new Set();
        try {
          const diskFiles = new Set(fs.readdirSync(targetDir).map((f) => String(f).toLowerCase()));
          for (const [fname, m] of Object.entries(readContentMeta(instanceId, kind) || {})) {
            if (!m?.projectId) continue;
            const key = String(fname).toLowerCase();
            if (diskFiles.has(key) || diskFiles.has(`${key}.disabled`)) {
              installedIds.add(String(m.projectId));
            }
          }
        } catch (e2) {}
        deps = await installModrinthRequiredDeps({
          kind,
          mcVersion,
          loader,
          rootVersionData: versionData,
          targetDir,
          isAlreadyInstalled: async (pid) => installedIds.has(String(pid)),
          recordMeta: async (filename, m) => {
            const idx = readContentMeta(instanceId, kind);
            idx[filename] = m;
            writeContentMeta(instanceId, kind, idx);
            if (m?.projectId) installedIds.add(String(m.projectId));
          }
        });
      } catch (e2) {
        deps = { installed: [], skipped: [], failed: ['dependency scan failed'] };
      }
    }

    return { success: true, filename: file.filename, deps };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
module.exports = {
  cfFetchJson,
  searchCurseforge,
  getCurseforgeProjectVersions,
  searchModrinth,
  spigetSearchResources,
  spigetGetResource,
  spigetDownloadResourceJar,
  getProjectVersions,
  fetchModrinthProjectCached,
  fetchModrinthVersionById,
  installModrinthRequiredDeps,
  fetchLatestFabricLoaderForMc,
  createInstanceFromMrpack,
  downloadProjectFile
};
