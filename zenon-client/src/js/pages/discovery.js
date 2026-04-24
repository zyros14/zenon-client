// ===== Discovery (Modrinth browse) =====
const DISCOVERY_PAGE_SIZE = 24;

let discoverySearchTimer = null;
let discoveryQuery = '';
let discoveryTypeId = 'mod';
let discoveryOffset = 0;
let discoveryProvider = 'all'; // 'all' | 'modrinth' | 'curseforge'

const DISCOVERY_PROVIDERS = [
  { id: 'all', label: 'All' },
  { id: 'modrinth', label: 'Modrinth' },
  { id: 'curseforge', label: 'CurseForge' }
];

const DISCOVERY_TYPES = [
  {
    id: 'mod',
    label: 'Mods',
    projectType: 'mod',
    kind: 'mod',
    versionOpts: (inst) => ({
      loader: inst && inst.loader && inst.loader !== 'vanilla' ? inst.loader : null
    })
  },
  { id: 'modpack', label: 'Modpacks', projectType: 'modpack', kind: 'modpack', versionOpts: () => ({ loaders: ['mrpack'] }) },
  { id: 'shader', label: 'Shaders', projectType: 'shader', kind: 'shaderpack', versionOpts: () => ({ loader: null }) },
  { id: 'resourcepack', label: 'Resource Packs', projectType: 'resourcepack', kind: 'resourcepack', versionOpts: () => ({ loaders: ['minecraft'] }) },
  { id: 'datapack', label: 'Data Packs', projectType: 'datapack', kind: 'datapack', versionOpts: () => ({ loaders: ['minecraft'] }) }
];

function currentDiscoveryType() {
  return DISCOVERY_TYPES.find((t) => t.id === discoveryTypeId) || DISCOVERY_TYPES[0];
}

function getDiscoveryFilterVersion() {
  return document.getElementById('discovery-filter-version')?.value?.trim() || '';
}

function getDiscoveryFilterLoader() {
  return document.getElementById('discovery-filter-loader')?.value?.trim() || '';
}

/** Instances that match Discovery’s Minecraft + (for mods) loader filters; excludes vanilla for mods. */
function discoveryCompatibleInstances(type, instances) {
  const v = getDiscoveryFilterVersion();
  const l = getDiscoveryFilterLoader();
  if (type.id === 'mod') {
    return instances.filter((inst) => {
      if (inst.loader === 'vanilla') return false;
      if (v && inst.version !== v) return false;
      if (l && inst.loader !== l) return false;
      return true;
    });
  }
  return instances.filter((inst) => {
    if (v && inst.version !== v) return false;
    return true;
  });
}

async function openDiscoveryInstallTargetModal(projectId, title, iconUrl = '', author = '') {
  const type = currentDiscoveryType();

  State.instances = await window.zenon.getInstances();
  if (typeof window.syncSelectedInstanceWithList === 'function') window.syncSelectedInstanceWithList();
  const list = discoveryCompatibleInstances(type, State.instances);
  const body = document.getElementById('discovery-target-body');
  const titleEl = document.getElementById('discovery-target-title');
  if (!body || !titleEl) return;

  titleEl.textContent = `Install “${title}” to…`;

  if (list.length === 0) {
    body.innerHTML = `
      <p class="discovery-target-hint">No instances match your filters.${
        type.id === 'mod'
          ? ' Mods need a mod loader (not vanilla). Use the Minecraft version and loader filters above to match an instance.'
          : ' Set the Minecraft version filter to match an instance, or create one in Library.'
      }</p>
      <div class="discovery-target-footer-btns">
        <button type="button" class="btn btn-ghost" id="discovery-target-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="discovery-target-go-instances">Go to Library</button>
      </div>`;
    document.getElementById('discovery-target-cancel')?.addEventListener('click', () => closeModal('modal-discovery-target'));
    document.getElementById('discovery-target-go-instances')?.addEventListener('click', () => {
      closeModal('modal-discovery-target');
      navigateTo('library', { force: true });
    });
  } else {
    body.innerHTML = `
      <p class="discovery-target-hint">Only instances compatible with your current filters are listed.</p>
      <div class="discovery-target-list">
        ${list
          .map(
            (inst) => `
          <button type="button" class="btn btn-ghost discovery-target-row" data-iid="${escapeHtml(inst.id)}">
            <span class="discovery-target-name">${escapeHtml(inst.name)}</span>
            <span class="discovery-target-meta">${escapeHtml(inst.version)} · ${escapeHtml(inst.loader)}</span>
          </button>`
          )
          .join('')}
      </div>
      <div class="discovery-target-footer-btns">
        <button type="button" class="btn btn-ghost" id="discovery-target-cancel">Cancel</button>
      </div>`;
    body.querySelectorAll('[data-iid]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-iid');
        const sel = State.instances.find((x) => x.id === id);
        closeModal('modal-discovery-target');
        if (!sel) return;
        const vo = type.versionOpts(sel);
        if (String(projectId || '').startsWith('cf:')) {
          // Uses the shared modal defined in library.js
          const projectType =
            type.id === 'modpack'
              ? 'modpack'
              : type.id === 'resourcepack'
                ? 'resourcepack'
                : type.id === 'datapack'
                  ? 'datapack'
                  : 'mod';
          zenonOpenCurseforgeInstallModal(projectId, title, sel, projectType, { iconUrl: iconUrl || '', author: author || '' });
        } else {
          zenonOpenInstallModal(projectId, title, type.kind, vo, {
            targetInstance: sel,
            iconUrl: iconUrl || '',
            author: author || ''
          });
        }
      });
    });
    document.getElementById('discovery-target-cancel')?.addEventListener('click', () => closeModal('modal-discovery-target'));
  }

  document.getElementById('discovery-target-close-btn').onclick = () => closeModal('modal-discovery-target');
  openModal('modal-discovery-target');
}

async function renderDiscoveryVersionOptions() {
  if (!State.mcVersions || State.mcVersions.length === 0) {
    State.mcVersions = await window.zenon.getMcVersions();
  }
  const list = State.mcVersions || [];
  const opts = ['<option value="">Any Minecraft version</option>'];
  for (const v of list.slice(0, 200)) {
    const label = v.type === 'release' ? v.id : `${v.id} · ${v.type}`;
    const safeVal = String(v.id).replace(/"/g, '&quot;');
    opts.push(`<option value="${safeVal}">${escapeHtml(label)}</option>`);
  }
  return opts.join('');
}

async function renderDiscovery() {
  const content = document.getElementById('main-content');
  const type = currentDiscoveryType();

  const versionOpts = await renderDiscoveryVersionOptions();

  content.innerHTML = `
    <div class="page page-discovery">
      <div class="discovery-head glow-hero">
        <div>
          <h1 class="page-title discovery-title">Discovery</h1>
          <p class="page-subtitle discovery-sub">Search Modrinth + CurseForge for mods, modpacks, resource packs, and data packs.</p>
          <p class="discovery-flow-hint">Discovery is not tied to one instance. When you install, you pick a compatible instance (or a modpack creates a new one).</p>
        </div>
      </div>

      <div class="discovery-type-row" id="discovery-provider-row">
        ${DISCOVERY_PROVIDERS.map(
          (p) => `
          <button type="button" class="id-pill ${p.id === discoveryProvider ? 'active' : ''}" data-provider="${p.id}">${p.label}</button>
        `
        ).join('')}
      </div>

      <div class="discovery-type-row" id="discovery-type-row">
        ${DISCOVERY_TYPES.map(
          (t) => `
          <button type="button" class="id-pill ${t.id === discoveryTypeId ? 'active' : ''}" data-type="${t.id}">${t.label}</button>
        `
        ).join('')}
      </div>

      <div class="search-bar discovery-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="discovery-search-input" placeholder="Search ${discoveryProvider === 'curseforge' ? 'CurseForge' : discoveryProvider === 'modrinth' ? 'Modrinth' : 'Modrinth + CurseForge'}…" value="${escapeHtml(discoveryQuery)}" />
      </div>

      <div class="discovery-filters">
        <select id="discovery-filter-version" class="discovery-select">
          ${versionOpts}
        </select>
        <select id="discovery-filter-loader" class="discovery-select" ${type.id === 'mod' ? '' : 'disabled'}>
          <option value="">Any loader</option>
          <option value="fabric">Fabric</option>
          <option value="forge">Forge</option>
          <option value="quilt">Quilt</option>
          <option value="neoforge">NeoForge</option>
        </select>
        <button type="button" class="btn btn-ghost btn-sm" id="discovery-run-search">Search</button>
      </div>

      <div id="discovery-results" class="discovery-results">
        <div class="empty-inline discovery-hint">Results appear here. Try searching or leave empty for popular hits.</div>
      </div>
      <div id="discovery-pager" class="discovery-pager" style="display:none" aria-label="Result pages"></div>
    </div>
  `;

  document.getElementById('discovery-type-row')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-type]');
    if (!btn) return;
    discoveryTypeId = btn.dataset.type;
    discoveryOffset = 0;
    await renderDiscovery();
    await runDiscoverySearch(0);
  });

  document.getElementById('discovery-provider-row')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-provider]');
    if (!btn) return;
    discoveryProvider = btn.dataset.provider;
    discoveryOffset = 0;
    await renderDiscovery();
    await runDiscoverySearch(0);
  });

  const input = document.getElementById('discovery-search-input');
  input?.addEventListener('input', () => {
    discoveryQuery = input.value;
    discoveryOffset = 0;
    clearTimeout(discoverySearchTimer);
    discoverySearchTimer = setTimeout(() => runDiscoverySearch(0), 420);
  });

  document.getElementById('discovery-filter-version')?.addEventListener('change', () => {
    discoveryOffset = 0;
    runDiscoverySearch(0);
  });
  document.getElementById('discovery-filter-loader')?.addEventListener('change', () => {
    discoveryOffset = 0;
    runDiscoverySearch(0);
  });

  document.getElementById('discovery-run-search')?.addEventListener('click', () => {
    discoveryOffset = 0;
    runDiscoverySearch(0);
  });

  window.__discoveryRefresh = () => runDiscoverySearch(discoveryOffset);
  await runDiscoverySearch(0);
}

function renderDiscoveryPager(totalHits, offset, limit) {
  const el = document.getElementById('discovery-pager');
  if (!el) return;
  const total = Number(totalHits) || 0;
  if (total <= 0) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const start = offset + 1;
  const end = Math.min(offset + limit, total);
  const canPrev = offset > 0;
  const canNext = offset + limit < total;
  el.style.display = 'flex';
  el.innerHTML = `
    <button type="button" class="btn btn-ghost btn-sm" id="discovery-prev-page" ${canPrev ? '' : 'disabled'}>Previous</button>
    <span class="discovery-pager-meta">${start}–${end} of ${total}</span>
    <button type="button" class="btn btn-ghost btn-sm" id="discovery-next-page" ${canNext ? '' : 'disabled'}>Next</button>
  `;
  document.getElementById('discovery-prev-page')?.addEventListener('click', () => {
    discoveryOffset = Math.max(0, discoveryOffset - DISCOVERY_PAGE_SIZE);
    runDiscoverySearch(discoveryOffset);
  });
  document.getElementById('discovery-next-page')?.addEventListener('click', () => {
    discoveryOffset += DISCOVERY_PAGE_SIZE;
    runDiscoverySearch(discoveryOffset);
  });
}

async function runDiscoverySearch(offset) {
  const resultsEl = document.getElementById('discovery-results');
  if (!resultsEl) return;

  if (typeof offset === 'number') discoveryOffset = offset;
  const type = currentDiscoveryType();
  const version = document.getElementById('discovery-filter-version')?.value || '';
  const loaderEl = document.getElementById('discovery-filter-loader');
  const loader = type.id === 'mod' ? loaderEl?.value || '' : '';

  const pagerEl = document.getElementById('discovery-pager');

  resultsEl.innerHTML = '<div class="loading-spinner"></div>';
  if (pagerEl) pagerEl.style.display = 'none';

  const errToText = (x) => {
    try {
      if (!x) return '';
      if (typeof x === 'string') return x;
      if (x && typeof x.message === 'string') return x.message;
      return JSON.stringify(x);
    } catch (e) {
      return String(x);
    }
  };

  let data;
  try {
    if (discoveryProvider === 'modrinth') {
      data = await window.zenon.searchModrinth({
        query: discoveryQuery,
        version,
        loader,
        projectType: type.projectType,
        limit: DISCOVERY_PAGE_SIZE,
        offset: discoveryOffset
      });
    } else if (discoveryProvider === 'curseforge') {
      const kind =
        type.id === 'modpack'
          ? 'modpack'
          : type.id === 'resourcepack'
            ? 'resourcepack'
            : type.id === 'datapack'
              ? 'datapack'
              : type.id === 'shader'
                ? 'shaderpack'
              : 'mod';
      data = await window.zenon.curseforgeSearchMods({
        query: discoveryQuery,
        mcVersion: version,
        loader,
        kind,
        pageSize: DISCOVERY_PAGE_SIZE,
        index: discoveryOffset
      });
    } else {
      const kind =
        type.id === 'modpack'
          ? 'modpack'
          : type.id === 'resourcepack'
            ? 'resourcepack'
            : type.id === 'datapack'
              ? 'datapack'
              : type.id === 'shader'
                ? 'shaderpack'
                : 'mod';

      const mrPromise = window.zenon.searchModrinth({
        query: discoveryQuery,
        version,
        loader,
        projectType: type.projectType,
        limit: DISCOVERY_PAGE_SIZE,
        offset: discoveryOffset
      });

      const cfPromise = kind
        ? window.zenon.curseforgeSearchMods({
            query: discoveryQuery,
            mcVersion: version,
            loader,
            kind,
            pageSize: DISCOVERY_PAGE_SIZE,
            index: discoveryOffset
          })
        : Promise.resolve({ hits: [], total_hits: 0 });

      const [mr, cf] = await Promise.allSettled([mrPromise, cfPromise]);
      const mrVal = mr.status === 'fulfilled' ? mr.value : { hits: [], total_hits: 0, error: mr.reason?.message || String(mr.reason || '') };
      const cfVal = cf.status === 'fulfilled' ? cf.value : { hits: [], total_hits: 0, error: cf.reason?.message || String(cf.reason || '') };

      const mrHits = Array.isArray(mrVal?.hits) ? mrVal.hits.map((h) => ({ ...h, __provider: 'modrinth' })) : [];
      const cfHits = Array.isArray(cfVal?.hits) ? cfVal.hits.map((h) => ({ ...h, __provider: 'curseforge' })) : [];
      const merged = [...mrHits, ...cfHits];

      data = {
        hits: merged,
        total_hits: (Number(mrVal?.total_hits) || 0) + (Number(cfVal?.total_hits) || 0),
        error: [errToText(mrVal?.error), errToText(cfVal?.error)].filter(Boolean).join(' · ')
      };
    }
  } catch (e) {
    const msg = e?.message || String(e) || 'Search failed';
    resultsEl.innerHTML = `<div class="empty-inline discovery-hint">Search failed: ${escapeHtml(String(msg).slice(0, 220))}</div>`;
    if (pagerEl) {
      pagerEl.style.display = 'none';
      pagerEl.innerHTML = '';
    }
    return;
  }
  if (!data || typeof data !== 'object') data = { hits: [], total_hits: 0, error: 'Invalid response' };
  const hits = data.hits || [];
  const total = data.total_hits != null ? data.total_hits : hits.length;

  if (!hits || hits.length === 0) {
    if (pagerEl) {
      pagerEl.style.display = 'none';
      pagerEl.innerHTML = '';
    }
    const extraText = errToText(data?.error);
    const extra = extraText ? `<p style="margin-top:8px;color:var(--text-muted);font-size:12px">${escapeHtml(String(extraText).slice(0, 180))}</p>` : '';
    resultsEl.innerHTML = `
      <div class="empty-state discovery-empty">
        <h3>No results</h3>
        <p>Try another keyword, type, or Minecraft version.</p>
        ${extra}
      </div>
    `;
    return;
  }

  resultsEl.innerHTML = `<div class="discovery-grid">${hits
    .map((mod) => {
      const initial = (mod.title || '?').charAt(0);
      const provider = mod.__provider || (String(mod.project_id || '').startsWith('cf:') ? 'curseforge' : 'modrinth');
      const providerChip = discoveryProvider === 'all'
        ? `<span class="tag tag-version" style="margin-left:auto;opacity:.9">${provider === 'curseforge' ? 'CurseForge' : 'Modrinth'}</span>`
        : '';
      const iconBlock = mod.icon_url
        ? `<img class="discovery-card-icon" src="${escapeHtml(mod.icon_url)}" alt="" onerror="this.outerHTML='<div class=\\'discovery-card-icon-ph\\'>${escapeHtml(initial)}</div>'">`
        : `<div class="discovery-card-icon-ph">${escapeHtml(initial)}</div>`;
      const dl = Number(mod.downloads);
      return `
    <article class="discovery-card glow-card">
      <div class="discovery-card-top">
        ${iconBlock}
        <div class="discovery-card-text">
          <h3 class="discovery-card-title">${escapeHtml(mod.title)}</h3>
          <p class="discovery-card-author">${escapeHtml(mod.author || 'Unknown')}</p>
        </div>
        ${providerChip}
      </div>
      <p class="discovery-card-desc">${escapeHtml((mod.description || '').slice(0, 140))}${(mod.description || '').length > 140 ? '…' : ''}</p>
      ${Number.isFinite(dl) ? `<div class="discovery-card-meta"><span>${formatDownloads(dl)} dl</span></div>` : `<div class="discovery-card-meta"></div>`}
      <button type="button" class="btn btn-primary btn-sm discovery-install" data-id="${mod.project_id}" data-title="${escapeHtml(mod.title)}" data-icon="${escapeHtml(mod.icon_url || '')}" data-author="${escapeHtml(mod.author || '')}">
        Install
      </button>
    </article>`;
    })
    .join('')}</div>`;

  renderDiscoveryPager(total, discoveryOffset, DISCOVERY_PAGE_SIZE);

  resultsEl.querySelectorAll('.discovery-install').forEach((btn) => {
    btn.addEventListener('click', () => {
      const typeDef = currentDiscoveryType();
      const pid = String(btn.dataset.id || '');
      if (typeDef.id === 'modpack' && !pid.startsWith('cf:')) {
        // Modrinth modpacks create a new instance.
        zenonOpenInstallModal(pid, btn.dataset.title, 'modpack', { loaders: ['mrpack'] }, {
          modpackAsNewInstance: true,
          mcVersionOverride: getDiscoveryFilterVersion(),
          iconUrl: btn.dataset.icon || ''
        });
        return;
      }
      // Everything else (including CurseForge modpacks) installs to an existing instance.
      openDiscoveryInstallTargetModal(pid, btn.dataset.title, btn.dataset.icon || '', btn.dataset.author || '');
    });
  });
}
