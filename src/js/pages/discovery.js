// ===== Discovery (Modrinth + CurseForge browse) =====
const DISCOVERY_PAGE_SIZE = 24;

let discoverySearchTimer = null;
let discoveryQuery = '';
let discoveryTypeId = 'mod';
let discoveryOffset = 0;
// 'modrinth' | 'curseforge'
let discoverySource = 'modrinth';
try { discoverySource = localStorage.getItem('zenon-discovery-source') || 'modrinth'; } catch (e) { discoverySource = 'modrinth'; }
if (discoverySource !== 'modrinth' && discoverySource !== 'curseforge') discoverySource = 'modrinth';

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
  { id: 'modpack', label: 'Modpacks', projectType: 'modpack', kind: 'modpack', versionOpts: () => ({}) },
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
  if (type.id === 'modpack') return;

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
      navigateTo('instance', { force: true });
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
        zenonOpenInstallModal(projectId, title, type.kind, vo, {
          targetInstance: sel,
          iconUrl: iconUrl || '',
          author: author || ''
        });
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
          <span class="page-kicker">${discoverySource === 'curseforge' ? 'CurseForge' : 'Modrinth'}</span>
          <h1 class="page-title discovery-title">Discovery</h1>
          <p class="page-subtitle discovery-sub">${discoverySource === 'curseforge'
            ? 'Search CurseForge for mods, shaders, resource packs, data packs, and modpacks.'
            : 'Search Modrinth for mods, modpacks, shaders, resource packs, and data packs.'}</p>
          <p class="discovery-flow-hint">Discovery is not tied to one instance. When you install, you pick a compatible instance (or a modpack creates a new one).</p>
        </div>
      </div>

      <div class="discovery-source-row" id="discovery-source-row" role="tablist" aria-label="Content source">
        <button type="button" class="id-pill ${discoverySource === 'modrinth' ? 'active' : ''}" data-source="modrinth" role="tab" aria-selected="${discoverySource === 'modrinth'}">Modrinth</button>
        <button type="button" class="id-pill ${discoverySource === 'curseforge' ? 'active' : ''}" data-source="curseforge" role="tab" aria-selected="${discoverySource === 'curseforge'}">CurseForge</button>
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
        <input type="text" id="discovery-search-input" placeholder="Search ${type.label.toLowerCase()}…" value="${escapeHtml(discoveryQuery)}" />
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

  document.getElementById('discovery-source-row')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-source]');
    if (!btn) return;
    const next = btn.dataset.source === 'curseforge' ? 'curseforge' : 'modrinth';
    if (next === discoverySource) return;
    // CurseForge source keeps whatever type the user selected — modpacks are supported.
    discoverySource = next;
    try { localStorage.setItem('zenon-discovery-source', next); } catch (_) {}
    discoveryOffset = 0;
    await renderDiscovery();
    await runDiscoverySearch(0);
  });

  document.getElementById('discovery-type-row')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-type]');
    if (!btn) return;
    discoveryTypeId = btn.dataset.type;
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

  const searchParams = {
    query: discoveryQuery,
    version,
    loader,
    projectType: type.projectType,
    limit: DISCOVERY_PAGE_SIZE,
    offset: discoveryOffset
  };
  const data = discoverySource === 'curseforge'
    ? await window.zenon.searchCurseforge(searchParams)
    : await window.zenon.searchModrinth(searchParams);
  const hits = data.hits || [];
  const total = data.total_hits != null ? data.total_hits : hits.length;
  const searchError = data.error || '';

  if (!hits || hits.length === 0) {
    if (pagerEl) {
      pagerEl.style.display = 'none';
      pagerEl.innerHTML = '';
    }
    resultsEl.innerHTML = `
      <div class="empty-state discovery-empty">
        <h3>No results</h3>
        <p>${searchError ? escapeHtml(searchError) : 'Try another keyword, type, or Minecraft version.'}</p>
      </div>
    `;
    return;
  }

  resultsEl.innerHTML = `<div class="discovery-grid">${hits
    .map((mod) => {
      const initial = (mod.title || '?').charAt(0);
      const iconBlock = mod.icon_url
        ? `<img class="discovery-card-icon" src="${escapeHtml(mod.icon_url)}" alt="" onerror="this.outerHTML='<div class=\\'discovery-card-icon-ph\\'>${escapeHtml(initial)}</div>'">`
        : `<div class="discovery-card-icon-ph">${escapeHtml(initial)}</div>`;
      return `
    <article class="discovery-card glow-card" data-type="${currentDiscoveryType()?.id || ''}">
      <div class="discovery-card-top">
        ${iconBlock}
        <div class="discovery-card-text">
          <h3 class="discovery-card-title">${escapeHtml(mod.title)}</h3>
          <p class="discovery-card-author">${escapeHtml(mod.author || 'Unknown')}</p>
        </div>
      </div>
      <p class="discovery-card-desc">${escapeHtml((mod.description || '').slice(0, 140))}${(mod.description || '').length > 140 ? '…' : ''}</p>
      <div class="discovery-card-meta">
        <span>${formatDownloads(mod.downloads)} dl</span>
      </div>
      <div class="discovery-card-actions">
        ${currentDiscoveryType()?.id === 'modpack'
          ? `<button type="button" class="btn btn-primary btn-sm discovery-create-instance" data-id="${mod.project_id}" data-title="${escapeHtml(mod.title)}" data-icon="${escapeHtml(mod.icon_url || '')}">
               Create Instance
             </button>
             <button type="button" class="btn btn-outline btn-sm discovery-install" data-id="${mod.project_id}" data-title="${escapeHtml(mod.title)}" data-icon="${escapeHtml(mod.icon_url || '')}" data-author="${escapeHtml(mod.author || '')}">
               Install
             </button>`
          : `<button type="button" class="btn btn-primary btn-sm discovery-install" data-id="${mod.project_id}" data-title="${escapeHtml(mod.title)}" data-icon="${escapeHtml(mod.icon_url || '')}" data-author="${escapeHtml(mod.author || '')}">
               Install
             </button>`
        }
      </div>
    </article>`;
    })
    .join('')}</div>`;

  renderDiscoveryPager(total, discoveryOffset, DISCOVERY_PAGE_SIZE);

  // Handle Create Instance button for modpacks
  resultsEl.querySelectorAll('.discovery-create-instance').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const typeDef = currentDiscoveryType();
      const projectId = btn.dataset.id;
      const title = btn.dataset.title;
      const iconUrl = btn.dataset.icon || '';

      // Fetch versions to determine MC version and loader from the modpack
      const mcVersionOverride = getDiscoveryFilterVersion() || null;
      const versions = await window.zenon.getProjectVersions({ projectId, mcVersion: mcVersionOverride });
      const versionData = Array.isArray(versions) && versions.length > 0 ? versions[0] : null;

      if (!versionData) {
        showToast('Could not determine modpack requirements', 'error');
        return;
      }

      // Show the install modal where user can choose MC version and loader
      zenonOpenInstallModal(projectId, title, 'modpack', {}, {
        modpackAsNewInstance: true,
        mcVersionOverride: mcVersionOverride,
        iconUrl: iconUrl || ''
      });
    });
  });

  // Handle Install button
  resultsEl.querySelectorAll('.discovery-install').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const typeDef = currentDiscoveryType();
      const selInst = State.instances.find((x) => x && x.loader !== 'vanilla') || State.selectedInstance;
      if (typeDef.id === 'modpack') {
        // Modpacks auto-install directly without showing version list
        const projectId = btn.dataset.id;
        const title = btn.dataset.title;
        const iconUrl = btn.dataset.icon || '';
        const mcVersionOverride = getDiscoveryFilterVersion() || null;

        const taskId = window.ZenonTasks
          ? window.ZenonTasks.start(`Installing ${title}`, {
              detail: 'Fetching modpack versions...'
            })
          : null;

        // Fetch versions to find the latest
        const versions = await window.zenon.getProjectVersions({ projectId, mcVersion: mcVersionOverride });
        const versionData = Array.isArray(versions) && versions.length > 0 ? versions[0] : null;

        if (!versionData) {
          if (taskId) window.ZenonTasks.fail(taskId, 'No compatible versions found');
          showToast('No compatible versions found', 'error');
          return;
        }

        // Install directly based on the project type
        let result;
        if (versionData?._cf && window.zenon.installCfModpack) {
          // CurseForge modpack
          result = await window.zenon.installCfModpack({ versionData, displayName: title, iconUrl: iconUrl || '' });
        } else {
          // Modrinth modpack (.mrpack)
          result = await window.zenon.createInstanceFromMrpack({ versionData, displayName: title, iconUrl: iconUrl || '' });
        }

        if (result?.success) {
          if (taskId) window.ZenonTasks.succeed(taskId, 'New instance ready');
          const partialFailNote = Array.isArray(result.failed) && result.failed.length
            ? ` — ${result.failed.length} file(s) skipped`
            : '';
          showToast(`${title} installed${partialFailNote}`, result.failed?.length ? 'warning' : 'success', 6000);

          // Navigate to the new instance
          if (result.instance) {
            State.instances = await window.zenon.getInstances();
            State.selectedInstance = result.instance;
            if (typeof window.syncSelectedInstanceWithList === 'function') window.syncSelectedInstanceWithList();
            if (typeof updateSidebarBadge === 'function') updateSidebarBadge();
          }
          State.libraryPane = 'content';
          await navigateTo('instance', { force: true });
        } else {
          if (taskId) window.ZenonTasks.fail(taskId, result?.error || 'Install failed');
          showToast(`Install failed: ${result?.error || 'Unknown error'}`, 'error');
        }
        return;
      }
      openDiscoveryInstallTargetModal(btn.dataset.id, btn.dataset.title, btn.dataset.icon || '', btn.dataset.author || '');
    });
  });
}
