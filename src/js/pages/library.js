// ===== Instance Library (installed content + detail layout) =====
let libraryContentKind = 'mod';
let librarySearchFilter = '';
let libraryBrowseQuery = '';
let libraryBrowseTimer = null;
let libraryBrowseOffset = 0;
let __libraryBrowseSeq = 0; // bump per search so stale in-flight searches can't overwrite newer results
/** Active category while the Modrinth browse modal is open (synced to the library tab on close). */
let libraryBrowseModalKind = 'mod';
// 'modrinth' | 'curseforge' (instance-scoped browse source)
let libraryBrowseSource = 'modrinth';
try { libraryBrowseSource = localStorage.getItem('zenon-library-browse-source') || 'modrinth'; } catch (e) { libraryBrowseSource = 'modrinth'; }
if (libraryBrowseSource !== 'modrinth' && libraryBrowseSource !== 'curseforge') libraryBrowseSource = 'modrinth';
const LIBRARY_BROWSE_PAGE_SIZE = 18;
let __libraryRenderSeq = 0;
/** Cached latest.log text for the Logs pane + active filter ('all'|'warn'|'error'). */
let libraryLastLogText = '';
let libraryLogFilter = 'all';
let libraryIntelligence = null;

/** Classify a log line for the error/warning-aware viewer. */
function logLineClass(line) {
  const s = String(line || '');
  if (/(\bERROR\b|\bFATAL\b|\bSEVERE\b|\bCRITICAL\b|OutOfMemoryError|UnsupportedClassVersionError|AccessViolation|Caused by:|mod_crash|crash report)/i.test(s)) return 'error';
  if (/(\bWARN\b|\bWARNING\b|\bBROKEN\b|mismatch|deobf)/i.test(s)) return 'warn';
  return '';
}

/** Render the cached log text into the <pre>, honoring the active filter + counts. */
function renderLogView(filter) {
  const pre = document.getElementById('library-log-pre');
  const counts = document.getElementById('library-log-counts');
  if (!pre) return;
  const lines = (libraryLastLogText || '').split(/\r?\n/);
  let errC = 0;
  let warnC = 0;
  const out = [];
  for (const ln of lines) {
    const cls = logLineClass(ln);
    if (cls === 'error') errC++;
    else if (cls === 'warn') warnC++;
    if (filter === 'error' && cls !== 'error') continue;
    if (filter === 'warn' && cls === '') continue;
    const safe = escapeHtml(ln);
    out.push(cls ? `<span class="log-line log-line--${cls}">${safe}</span>\n` : `${safe}\n`);
  }
  pre.innerHTML = out.join('');
  if (counts) counts.textContent = `${errC} errors · ${warnC} warnings`;
}

/** ===== Mod Intelligence pane ===== */

function intelligenceEmpty() {
  return `
    <div class="intelligence-panel glow-card" id="library-intel-panel">
      <div class="intelligence-header">
        <div>
          <h2>Mod Intelligence</h2>
          <p class="intelligence-sub">Scans installed mods for incompatibilities, missing dependencies, duplicates, outdated versions, and crash evidence in latest.log.</p>
        </div>
      </div>
      <div class="intelligence-empty">
        <button type="button" class="btn btn-primary" data-action="scan" id="library-intel-scan">Scan this instance</button>
      </div>
    </div>
  `;
}

function intelligenceChip(label, count, klass) {
  const c = count || 0;
  return `<span class="chip ${klass || ''}" title="${escapeHtml(label)}">${escapeHtml(label)} <span class="chip-count">${c}</span></span>`;
}

function intelligencePanel(data) {
  const { summary, incompatible, missingDeps, duplicates, outdated, crashSuspects, recommendations } = data;
  const risk = summary.risk || 'low';
  const riskLabel = risk === 'high' ? 'High' : risk === 'medium' ? 'Medium' : 'Low';

  const modItem = (m) => `
    <div class="intel-item">
      <div class="intel-item-main">
        <strong>${escapeHtml(m.title || m.filename)}</strong>
        <span class="intel-item-file">${escapeHtml(m.filename)}</span>
      </div>
      <div class="intel-item-reason">${escapeHtml(m.reason)}</div>
    </div>
  `;
  const depItem = (d) => `
    <div class="intel-item">
      <div class="intel-item-main">
        <strong>${escapeHtml(d.mod.title || d.mod.filename)}</strong> needs
        <strong>${escapeHtml(d.dep.title || d.dep.projectId)}</strong>
        ${d.dep.versionId ? `<span class="intel-item-file">dep ${escapeHtml(d.dep.projectId)}</span>` : ''}
      </div>
      <div class="intel-item-reason">Required dependency is not installed.</div>
    </div>
  `;
  const dupItem = (d) => `
    <div class="intel-item">
      <div class="intel-item-main">
        <strong>${escapeHtml(d.title)}</strong>
        ${d.modId ? `<span class="intel-item-file">mod id: ${escapeHtml(d.modId)}</span>` : ''}
      </div>
      <div class="intel-item-reason">${d.files.length} installed copy${d.files.length === 1 ? '' : 's'}</div>
      <div class="intel-item-actions">
        ${d.files.map((f) => `
          <button type="button" class="btn btn-danger btn-sm btn-icon" data-action="delete-mod" data-filename="${escapeHtml(f.filename)}" title="Remove ${escapeHtml(f.title || f.filename)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  const outItem = (o) => `
    <div class="intel-item">
      <div class="intel-item-main">
        <strong>${escapeHtml(o.title || o.filename)}</strong>
        <span class="intel-item-file">${escapeHtml(o.filename)}</span>
      </div>
      <div class="intel-item-reason">
        ${escapeHtml(o.localVersion || '?')} → ${escapeHtml(o.latestVersion || '?')}
      </div>
    </div>
  `;
  const crashItem = (s) => `
    <div class="intel-item">
      <div class="intel-item-main">
        <strong>${escapeHtml(s.mod.title || s.mod.filename)}</strong>
        <span class="intel-chip intel-confidence-${s.confidence}">${s.confidence}</span>
      </div>
      <div class="intel-item-reason">Evidence in latest.log:</div>
      <div class="intel-item-evidence">${s.evidence.map((e) => escapeHtml(e)).join('<br>')}</div>
    </div>
  `;
  const recItem = (r) => `
    <div class="intel-item">
      <div class="intel-item-main">
        <strong>For ${escapeHtml(r.for.title || r.for.filename)}:</strong>
        <strong>${escapeHtml(r.alt.title)}</strong>
        <span class="intel-item-file">${r.alt.source || 'modrinth'} · ${r.alt.downloads || 0} downloads</span>
      </div>
      <div class="intel-item-actions">
        <button type="button" class="btn btn-primary btn-sm" data-action="install-alt" data-project-id="${escapeHtml(r.alt.projectId || '')}" data-title="${escapeHtml(r.alt.title)}">Install</button>
      </div>
    </div>
  `;

  const body = `
    <div class="intelligence-panel glow-card" id="library-intel-panel">
      <div class="intelligence-header">
        <div>
          <h2>Mod Intelligence</h2>
          <p class="intelligence-sub">MC ${escapeHtml(data.mcVersion || '')} / ${escapeHtml(data.loader || 'vanilla')} · scanned ${new Date(data.scannedAt).toLocaleTimeString()}</p>
        </div>
        <div class="intelligence-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="rescan" id="library-intel-rescan">Rescan</button>
        </div>
      </div>
      <div class="intelligence-summary">
        <span class="chip intel-risk-${risk}" title="Overall risk">${riskLabel} risk</span>
        ${intelligenceChip('Incompatible', summary.incompatibleCount, 'intel-incompatible')}
        ${intelligenceChip('Missing deps', summary.missingDepsCount, 'intel-missing-deps')}
        ${intelligenceChip('Duplicates', summary.duplicatesCount, 'intel-duplicates')}
        ${intelligenceChip('Outdated', summary.outdatedCount, 'intel-outdated')}
        ${intelligenceChip('Crash suspects', summary.crashSuspectCount, 'intel-crash')}
      </div>
      ${section('Incompatible mods', 'No compatible version for this MC version + loader', 'intel-incompatible', incompatible.map(modItem).join('') || emptyRow('All installed mods have a compatible version.'))}
      ${section('Missing dependencies', 'Required dependencies not installed', 'intel-missing-deps', missingDeps.map(depItem).join('') || emptyRow('All required dependencies are present.'))}
      ${section('Duplicate mods', 'Same mod installed more than once', 'intel-duplicates', duplicates.map(dupItem).join('') || emptyRow('No duplicate mods detected.'))}
      ${section('Outdated mods', 'Local file differs from latest compatible version', 'intel-outdated', outdated.map(outItem).join('') || emptyRow('All installed mods are up to date.'))}
      ${section('Crash suspects', 'Named in latest.log error/stack lines', 'intel-crash', crashSuspects.map(crashItem).join('') || emptyRow('No mods implicated in recent log errors.'))}
      ${section('Recommended alternatives', 'Compatible replacements for flagged mods', 'intel-recommendations', recommendations.map(recItem).join('') || emptyRow('No alternatives needed.'))}
    </div>
  `;
  return body;
}

function section(title, subtitle, klass, body) {
  return `
    <div class="intel-section ${klass}">
      <div class="intel-section-head">
        <div>
          <div class="intel-section-title">${escapeHtml(title)}</div>
          <div class="intel-section-sub">${escapeHtml(subtitle)}</div>
        </div>
      </div>
      <div class="intel-section-body">${body}</div>
    </div>
  `;
}

function emptyRow(text) {
  return `<div class="intel-item intel-empty"><div class="intel-item-main">${escapeHtml(text)}</div></div>`;
}

async function scanLibraryIntelligence() {
  const inst = State.selectedInstance;
  if (!inst) return;
  const btn = document.getElementById('library-intel-scan');
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
  try {
    const data = await window.zenon.getModIntelligence(inst.id);
    if (data?.success === false) throw new Error(data.error || 'scan failed');
    libraryIntelligence = data || {};
    await renderLibrary();
  } catch (e) {
    showToast(`Intelligence scan failed: ${e?.message || e}`, 'error', 5000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Scan this instance'; }
  }
}

function attachLibraryIntelligenceHandlers() {
  const el = document.getElementById('library-intel-panel');
  if (!el) return;
  el.removeEventListener('click', onLibraryIntelligenceClick);
  el.addEventListener('click', onLibraryIntelligenceClick);
}

async function onLibraryIntelligenceClick(e) {
  const action = e.target.closest('[data-action]');
  if (!action) return;
  const inst = State.selectedInstance;
  if (!inst) return;
  if (action.dataset.action === 'scan' || action.dataset.action === 'rescan') {
    await scanLibraryIntelligence();
    return;
  }
  if (action.dataset.action === 'install-alt') {
    const projectId = action.dataset.projectId;
    const title = action.dataset.title;
    if (!projectId) return;
    await zenonOpenInstallModal(projectId, title, 'mod', { loaders: [inst.loader] }, { targetInstance: inst });
    return;
  }
  if (action.dataset.action === 'delete-mod') {
    const filename = action.dataset.filename;
    if (!filename) return;
    const ok = await showConfirm({ title: 'Remove duplicate', message: `Remove "${filename}"?`, confirmLabel: 'Remove' });
    if (!ok) return;
    await window.zenon.deleteContent(inst.id, 'mod', filename);
    showToast('Removed', 'info');
    libraryIntelligence = null;
    await renderLibrary();
    return;
  }
}

function instanceModrinthFacetLoader(inst) {
  if (!inst || inst.loader === 'vanilla') return '';
  if (inst.loader === 'fabric' || inst.loader === 'forge' || inst.loader === 'quilt') return inst.loader;
  return '';
}

function lockedLoaderLabel(inst) {
  if (!inst || inst.loader === 'vanilla') return 'Vanilla (no loader filter)';
  return loaderLabel(inst.loader);
}

/** Modrinth browse mapping for the active library content kind */
const LIBRARY_BROWSE_BY_KIND = {
  mod: { projectType: 'mod', versionOpts: (inst) => ({ loader: instanceModrinthFacetLoader(inst) || null }) },
  modpack: { projectType: 'modpack', versionOpts: () => ({ loaders: ['mrpack'] }) },
  shaderpack: { projectType: 'shader', versionOpts: () => ({ loader: null }) },
  resourcepack: { projectType: 'resourcepack', versionOpts: () => ({ loaders: ['minecraft'] }) },
  datapack: { projectType: 'datapack', versionOpts: () => ({ loaders: ['minecraft'] }) }
};

function libraryBrowseModalIsOpen() {
  return document.getElementById('modal-library-browse')?.classList.contains('show');
}

function libraryActiveContentKind() {
  return libraryBrowseModalIsOpen() ? libraryBrowseModalKind : libraryContentKind;
}

function libraryBrowseDef() {
  const kind = libraryActiveContentKind();
  return LIBRARY_BROWSE_BY_KIND[kind] || LIBRARY_BROWSE_BY_KIND.mod;
}

const LIBRARY_CONTENT_KINDS = [
  { kind: 'mod', label: 'Mods' },
  { kind: 'shaderpack', label: 'Shaders' },
  { kind: 'resourcepack', label: 'Resource Packs' },
  { kind: 'datapack', label: 'Data Packs' },
  { kind: 'modpack', label: 'Modpacks' }
];

/** Which content tabs are real for this instance. Vanilla has no loader → no mods, no shaders, no modpacks. */
const LIBRARY_VANILLA_KINDS = ['resourcepack', 'datapack'];
function libraryContentKindsFor(inst) {
  const isVanilla = !inst || String(inst.loader || 'vanilla').toLowerCase() === 'vanilla';
  if (isVanilla) return LIBRARY_CONTENT_KINDS.filter((k) => LIBRARY_VANILLA_KINDS.includes(k.kind));
  return LIBRARY_CONTENT_KINDS;
}
function libraryContentKindLabel(kind) {
  return (LIBRARY_CONTENT_KINDS.find((k) => k.kind === kind)?.label) || 'Content';
}
function browseLockedRowsHtml(inst, kind) {
  const mc = `<div class="library-embed-lock-row">
      <span class="library-embed-lock-label">Minecraft</span>
      <span class="library-embed-lock-val">${escapeHtml(inst.version)}</span>
    </div>`;
  let second = '';
  if (kind === 'mod') {
    second = `<div class="library-embed-lock-row">
      <span class="library-embed-lock-label">Loader</span>
      <span class="library-embed-lock-val">${escapeHtml(lockedLoaderLabel(inst))}</span>
    </div>`;
  } else if (kind === 'shaderpack') {
    second = `<div class="library-embed-lock-row">
      <span class="library-embed-lock-label">Type</span>
      <span class="library-embed-lock-val">Shaders</span>
    </div>`;
  } else if (kind === 'resourcepack') {
    second = `<div class="library-embed-lock-row">
      <span class="library-embed-lock-label">Type</span>
      <span class="library-embed-lock-val">Resource pack</span>
    </div>`;
  } else if (kind === 'datapack') {
    second = `<div class="library-embed-lock-row">
      <span class="library-embed-lock-label">Type</span>
      <span class="library-embed-lock-val">Data pack</span>
    </div>`;
  } else if (kind === 'modpack') {
    second = `<div class="library-embed-lock-row">
      <span class="library-embed-lock-label">Format</span>
      <span class="library-embed-lock-val">Modrinth pack</span>
    </div>`;
  }
  return mc + second;
}

function browseModalHint(kind) {
  if (kind === 'mod') {
    return 'Results are filtered to this instance’s Minecraft version and mod loader.';
  }
  if (kind === 'shaderpack') {
    return 'Filtered to this Minecraft version. Use a compatible shader runtime in your instance (e.g. Iris or OptiFine).';
  }
  if (kind === 'resourcepack') {
    return 'Resource packs filtered to this Minecraft version.';
  }
  if (kind === 'datapack') {
    return 'Data packs filtered to this Minecraft version (for world saves/datapacks).';
  }
  if (kind === 'modpack') {
    return 'Modpacks filtered to this Minecraft version (Modrinth .mrpack or CurseForge .zip).';
  }
  return '';
}

function browseSearchPlaceholder(kind) {
  const src = libraryBrowseSource === 'curseforge' ? 'CurseForge' : 'Modrinth';
  if (kind === 'shaderpack') return `Search ${src} shaders…`;
  if (kind === 'resourcepack') return `Search ${src} resource packs…`;
  if (kind === 'datapack') return `Search ${src} data packs…`;
  if (kind === 'modpack') return `Search ${src} modpacks…`;
  return `Search ${src} mods…`;
}

function renderLibraryBrowseKindPills() {
  const el = document.getElementById('library-browse-kind-pills');
  if (!el) return;
  const inst = State.selectedInstance;
  const kinds = libraryContentKindsFor(inst);
  el.innerHTML = kinds.map(
    (k) => `<button type="button" role="tab" aria-selected="${k.kind === libraryBrowseModalKind ? 'true' : 'false'}" class="id-pill ${k.kind === libraryBrowseModalKind ? 'active' : ''}" data-browse-kind="${k.kind}">${k.label}</button>`
  ).join('');
}

function renderLibraryBrowseSourceRow() {
  const el = document.getElementById('library-browse-source-row');
  if (!el) return;
  el.querySelectorAll('[data-browse-source]').forEach((btn) => {
    const active = btn.getAttribute('data-browse-source') === libraryBrowseSource;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
}

function updateLibraryBrowseModalChrome(inst) {
  if (!inst) return;
  const kind = libraryBrowseModalKind;
  renderLibraryBrowseSourceRow();
  const tabLabel = LIBRARY_CONTENT_KINDS.find((k) => k.kind === kind)?.label || 'Content';
  const titleEl = document.getElementById('library-browse-modal-title');
  const hintEl = document.getElementById('library-browse-modal-hint');
  const lockedEl = document.getElementById('library-browse-locked');
  const input = document.getElementById('library-browse-search-input');
  if (titleEl) titleEl.textContent = `Browse & install — ${tabLabel}`;
  if (hintEl) hintEl.textContent = browseModalHint(kind);
  if (lockedEl) lockedEl.innerHTML = browseLockedRowsHtml(inst, kind);
  if (input) input.placeholder = browseSearchPlaceholder(kind);
}

function syncLibraryBrowseModalToMain() {
  libraryContentKind = libraryBrowseModalKind;
  window.__libraryBrowseRefresh = null;
  window.__onLibraryBrowseModalClose = null;
  if (State.currentPage === 'instance') void renderLibrary();
}

function loaderLabel(loader) {
  if (loader === 'fabric') return 'Fabric';
  if (loader === 'forge') return 'Forge';
  if (loader === 'vanilla') return 'Vanilla';
  return loader || 'Unknown';
}

function instanceSubtitle(inst) {
  const played = typeof playTimeLabel === 'function'
    ? playTimeLabel(inst)
    : (inst.lastPlayed ? formatDate(inst.lastPlayed) : 'Never played');
  return `${loaderLabel(inst.loader)} ${inst.version} · ${played}`;
}

async function renderLibrary() {
  const seq = ++__libraryRenderSeq;
  const content = document.getElementById('main-content');

  // Load instances; the Library page shows the SELECTED instance only (instance picker lives on the Instances page).
  if (!State.instances || State.instances.length === 0) {
    try {
      State.instances = await window.zenon.getInstances();
      if (typeof window.syncSelectedInstanceWithList === 'function') window.syncSelectedInstanceWithList();
    } catch (e) {
      State.instances = [];
    }
  }
  if (seq !== __libraryRenderSeq) return;

  const inst = State.selectedInstance;
  const pane = State.libraryPane || 'content';
  if (inst && !libraryContentKindsFor(inst).some(k => k.kind === libraryContentKind)) libraryContentKind = 'resourcepack';

  let paneBody = '';
  if (!inst) {
    paneBody = `
      <div class="empty-state glow-card" style="margin-top:10px">
        <h3>Select an instance</h3>
        <p>Pick an instance on the left to view and manage its mods, files, worlds, and logs.</p>
        <button type="button" class="btn btn-primary" id="library-create-instance-btn">New Instance</button>
      </div>
    `;
  } else
  if (pane === 'content') {
    const items = await window.zenon.getContent(inst.id, libraryContentKind);
    if (seq !== __libraryRenderSeq) return;
    const tabLabel = LIBRARY_CONTENT_KINDS.find((k) => k.kind === libraryContentKind)?.label || 'Content';
    const filtered = librarySearchFilter.trim()
      ? items.filter((m) => {
        const q = librarySearchFilter.trim().toLowerCase();
        return (
          (m.displayName && m.displayName.toLowerCase().includes(q)) ||
          (m.filename && m.filename.toLowerCase().includes(q))
        );
      })
      : items;

    const totalBytes = filtered.reduce((sum, m) => sum + (Number(m.size) || 0), 0);
    const enabledCount = filtered.filter((m) => m.enabled).length;
    const disabledCount = filtered.length - enabledCount;
    const kindLabel = LIBRARY_CONTENT_KINDS.find((k) => k.kind === libraryContentKind)?.label || 'Mods';
    const kindNoun = { Mods: 'mod', Shaders: 'shader', 'Resource Packs': 'resource pack', 'Data Packs': 'data pack', Modpacks: 'modpack' }[kindLabel] || kindLabel.toLowerCase();
    
    paneBody = `
      <div class="library-summary glow-card">
        <div class="library-summary-icon">${getInstanceIcon(inst)}</div>
        <div class="library-summary-body">
          <div class="library-summary-kicker">${escapeHtml(kindLabel).toUpperCase()} &nbsp;·&nbsp; ${escapeHtml(inst.loader || 'vanilla')}</div>
          <h2 class="library-summary-title">${escapeHtml(inst.name)}</h2>
          <div class="library-summary-chips">
            <span class="chip chip-accent">${escapeHtml(inst.version || '')}</span>
            <span class="chip" id="library-summary-modcount">${filtered.length} ${escapeHtml(kindNoun)}${items.length === 1 ? '' : 's'}</span>
            <span class="chip" id="library-summary-size">${formatBytes(totalBytes)}</span>
            <span class="chip chip-on" id="library-summary-enabled">${enabledCount} on</span>
            <span class="chip chip-off" id="library-summary-disabled">${disabledCount} off</span>
          </div>
        </div>
        <div class="library-summary-actions">
          <button type="button" class="btn btn-primary btn-lg btn-browse-install" id="library-open-browse-btn" title="Search Modrinth/CurseForge scoped to this instance">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:17px;height:17px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Browse &amp; install
          </button>
          ${
            libraryContentKind === 'mod'
              ? `<button type="button" class="btn btn-ghost" id="library-update-all-btn" title="Update every installed mod to the latest version compatible with this instance">Update all</button>`
              : ''
          }
        </div>
      </div>

      <div class="id-content-toolbar library-content-toolbar-row">
        <div class="id-kind-pills" id="library-kind-pills">
          ${libraryContentKindsFor(inst).map(
            (k) => `
            <button type="button" class="id-pill ${k.kind === libraryContentKind ? 'active' : ''}" data-kind="${k.kind}">${k.label}</button>
          `
          ).join('')}
        </div>
      </div>

      <div class="id-toolbar-actions library-installed-toolbar">
        <div class="search-bar id-search-local">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="library-installed-search" placeholder="Filter installed…" value="${escapeHtml(librarySearchFilter)}" />
        </div>
      </div>
      <div class="id-content-table-wrap">
        <div class="id-table-body" id="library-installed-body">
          ${renderInstalledRows(filtered)}
        </div>
      </div>
    `;
  } else if (pane === 'files') {
    const entries = await window.zenon.listInstanceRoot(inst.id);
    if (seq !== __libraryRenderSeq) return;
    paneBody = `
      <p class="id-pane-hint">Top-level instance folder (launcher metadata folders hidden).</p>
      <div class="id-files-list">
        ${entries.length === 0 ? '<div class="empty-inline">No entries yet.</div>' : ''}
        ${entries
          .map(
            (e) => `
          <div class="id-file-row">
            <span class="id-file-icon">${e.type === 'dir' ? '&#128193;' : '&#128196;'}</span>
            <span class="id-file-name">${escapeHtml(e.name)}</span>
            <span class="id-file-type">${e.type === 'dir' ? 'Folder' : 'File'}</span>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  } else if (pane === 'worlds') {
    const worlds = await window.zenon.listInstanceWorlds(inst.id);
    if (seq !== __libraryRenderSeq) return;
    paneBody = `
      <div class="world-manager">
        <div class="world-manager-header">
          <div>
            <h2 class="world-manager-title">Worlds</h2>
            <p class="world-manager-sub">Manage saves in <code class="id-code">saves/</code>. Launch the game once if this list is empty.</p>
          </div>
          <button type="button" class="btn btn-primary" id="world-import-btn" title="Import a world zip into this instance">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Import world
          </button>
        </div>
        <div class="world-list" id="library-worlds-list">
          ${worlds.length === 0 ? `<div class="empty-inline">No worlds in saves/ yet. Launch the game once to create a world.</div>` : ''}
          ${worlds.map((w) => {
            const info = window.zenon.worldInfo ? null : null;
            const sizeText = w.size ? formatBytes(w.size) : '';
            const mtimeText = w.mtime ? formatDate(new Date(w.mtime).toISOString()) : '';
            return `
            <div class="world-row" data-world="${escapeHtml(w.name)}">
              <span class="world-icon">&#127757;</span>
              <div class="world-info">
                <div class="world-name">${escapeHtml(w.name)}</div>
                <div class="world-meta">
                  ${sizeText ? `<span class="world-meta-item">${escapeHtml(sizeText)}</span>` : ''}
                  ${mtimeText ? `<span class="world-meta-item">${escapeHtml(mtimeText)}</span>` : ''}
                  ${w.hasLevelDat ? '<span class="world-meta-item">Valid</span>' : ''}
                </div>
              </div>
              <div class="world-actions">
                <button type="button" class="btn btn-ghost btn-sm world-action" data-action="launch-world" data-world="${escapeHtml(w.name)}" title="Launch into this world">Launch</button>
                <button type="button" class="btn btn-ghost btn-sm world-action" data-action="rename-world" data-world="${escapeHtml(w.name)}" title="Rename">Rename</button>
                <button type="button" class="btn btn-ghost btn-sm world-action" data-action="export-world" data-world="${escapeHtml(w.name)}" title="Export to zip">Export</button>
                <button type="button" class="btn btn-danger btn-sm world-action" data-action="delete-world" data-world="${escapeHtml(w.name)}" title="Delete">Delete</button>
              </div>
            </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  } else if (pane === 'logs') {
    const log = await window.zenon.readInstanceLatestLog(inst.id);
    if (seq !== __libraryRenderSeq) return;
    libraryLastLogText = String(log.text || '');
    let crashBanner = '';
    try {
      const crashes = await window.zenon.listCrashes?.(inst.id);
      if (Array.isArray(crashes) && crashes.length) {
        crashBanner = `
          <div class="id-crash-banner">
            <div class="id-crash-head">
              <span class="id-crash-title">Crash history (${crashes.length})</span>
              <button type="button" class="btn btn-ghost btn-sm" id="library-crash-clear">Clear</button>
            </div>
            ${crashes.slice(0, 3).map((c) => `
              <div class="id-crash-item">
                <div class="id-crash-item-title">${escapeHtml(c.headline)} <span class="id-crash-item-code">code ${escapeHtml(String(c.exitCode))}</span></div>
                <div class="id-crash-item-detail">${escapeHtml(c.detail)}</div>
                <div class="id-crash-item-time">${escapeHtml(formatDate(c.at))}</div>
              </div>`).join('')}
          </div>`;
      }
    } catch (e) { /* crash history is best-effort */ }
    paneBody = `
      ${crashBanner}
      <div class="id-logs-toolbar">
        <div class="id-logs-filters" role="tablist" aria-label="Log filter">
          <button type="button" class="id-pill" data-log-filter="all" role="tab" aria-selected="true">All</button>
          <button type="button" class="id-pill" data-log-filter="warn" role="tab" aria-selected="false">Warnings+Errors</button>
          <button type="button" class="id-pill" data-log-filter="error" role="tab" aria-selected="false">Errors only</button>
        </div>
        <span class="id-logs-counts" id="library-log-counts"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="library-log-copy">Copy</button>
        <button type="button" class="btn btn-ghost btn-sm" id="library-log-refresh">Refresh</button>
      </div>
      <pre class="id-log-pre" id="library-log-pre"></pre>
    `;
  } else if (pane === 'intelligence') {
    if (!libraryIntelligence) {
      paneBody = intelligenceEmpty();
    } else {
      paneBody = intelligencePanel(libraryIntelligence);
    }
  }

  if (seq !== __libraryRenderSeq) return;
  content.innerHTML = `
    <div class="page page-instance-detail">
      <div class="library-content-split library-content-split--full">
        <section class="library-right-col">
          ${
            inst
              ? `
          <header class="id-header glow-hero">
            <div class="id-header-icon">${getInstanceIcon(inst)}</div>
            <div class="id-header-main">
              <h1 class="id-title">${escapeHtml(inst.name)}</h1>
              <p class="id-subtitle">${escapeHtml(instanceSubtitle(inst))}</p>
            </div>
            <div class="id-header-actions">
              ${
                State.runningInstanceIds.has(inst.id)
                  ? `<button type="button" class="btn btn-danger id-play-btn" data-action="stop" data-id="${inst.id}">
                      <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                      Stop
                    </button>`
                  : `<button type="button" class="btn btn-play id-play-btn" data-action="play" data-id="${inst.id}">
                      <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                      Play
                    </button>`
              }
              ${
                State.runningInstanceIds.has(inst.id)
                  ? ''
                  : `<button type="button" class="btn btn-ghost id-safe-btn" data-action="safe-launch" data-id="${inst.id}" title="Launch with all mods disabled — great for diagnosing mod crashes">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                      Safe mode
                    </button>`
              }
              <button type="button" class="btn btn-ghost btn-icon id-round-btn" id="library-backup-btn" title="Backup this instance to your backups folder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8v4h8z"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>
              </button>
              <button type="button" class="btn btn-ghost btn-icon id-round-btn" id="library-open-folder" title="Open folder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              </button>
              <button type="button" class="btn btn-ghost btn-icon id-round-btn" id="library-edit-btn" title="Edit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
            </div>
          </header>

          <nav class="id-tabs" id="library-section-tabs">
            <button type="button" class="id-tab ${pane === 'content' ? 'active' : ''}" data-pane="content">Content</button>
            <button type="button" class="id-tab ${pane === 'files' ? 'active' : ''}" data-pane="files">Files</button>
            <button type="button" class="id-tab ${pane === 'worlds' ? 'active' : ''}" data-pane="worlds">Worlds</button>
            <button type="button" class="id-tab ${pane === 'logs' ? 'active' : ''}" data-pane="logs">Logs</button>
            <button type="button" class="id-tab ${pane === 'intelligence' ? 'active' : ''}" data-pane="intelligence">Mod Intelligence</button>
          </nav>
          `
              : ''
          }

          <section class="id-pane">${paneBody}</section>
        </section>
      </div>
    </div>
  `;

  document.getElementById('library-create-instance-btn')?.addEventListener('click', () => {
    if (typeof openCreateInstanceModal === 'function') openCreateInstanceModal();
    else navigateTo('instances');
  });

  document.querySelector('[data-action="play"]')?.addEventListener('click', (e) => {
    const id = e.currentTarget.getAttribute('data-id');
    if (id) launchInstance(id);
  });
  document.querySelector('[data-action="safe-launch"]')?.addEventListener('click', (e) => {
    const id = e.currentTarget.getAttribute('data-id');
    if (id && typeof launchInstance === 'function') launchInstance(id, { safeMode: true });
  });
  document.querySelector('[data-action="stop"]')?.addEventListener('click', async (e) => {
    const id = e.currentTarget.getAttribute('data-id');
    const r = await (id ? window.zenon.stopGameInstance(id) : window.zenon.stopGame());
    if (!r?.success) showToast(r?.error || 'Stop failed', 'error');
    else showToast('Stopping game…', 'info');
  });

  document.getElementById('library-open-folder')?.addEventListener('click', () => window.zenon.openInstanceFolder(inst.id));
  document.getElementById('library-backup-btn')?.addEventListener('click', async function backupBtn() {
    const btn = this;
    btn.disabled = true;
    try {
      const r = await window.zenon.backupInstance(inst.id);
      if (r?.success) {
        const mb = r.size ? `${(r.size / (1024 * 1024)).toFixed(0)} MB` : '';
        showToast(`Backup saved${mb ? ` — ${mb}` : ''}`, 'success');
      } else {
        showToast(`Backup failed: ${r?.error || 'unknown error'}`, 'error', 5000);
      }
    } catch (e) {
      showToast(`Backup failed: ${e?.message || e}`, 'error', 5000);
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById('library-edit-btn')?.addEventListener('click', () => {
    navigateTo('instances');
    setTimeout(() => openEditInstanceModal(inst.id), 120);
  });

  document.getElementById('library-section-tabs')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pane]');
    if (!btn) return;
    State.libraryPane = btn.dataset.pane;
    librarySearchFilter = '';
    await renderLibrary();
  });

  document.getElementById('library-kind-pills')?.addEventListener('click', async (e) => {
    const pill = e.target.closest('[data-kind]');
    if (!pill) return;
    libraryContentKind = pill.dataset.kind;
    librarySearchFilter = '';
    libraryBrowseQuery = '';
    await renderLibrary();
  });

  document.getElementById('library-open-browse-btn')?.addEventListener('click', () => openLibraryBrowseModal());
  document.getElementById('library-update-all-btn')?.addEventListener('click', async () => {
    if (!inst) return;
    const btn = document.getElementById('library-update-all-btn');
    const taskId = window.ZenonTasks ? window.ZenonTasks.start(`Updating mods in ${inst.name}`, { detail: 'Checking installed mods…' }) : null;
    btn.disabled = true;
    btn.textContent = 'Updating…';
    try {
      const r = await window.zenon.updateAllMods(inst.id);
      if (!r?.success) throw new Error(r?.error || 'unknown error');
      const updated = r.updated?.length || 0;
      if (taskId) window.ZenonTasks.succeed(taskId, updated ? `${updated} mod(s) updated` : 'All up to date');
      if (updated > 0) {
        showToast(`Updated ${updated} mod(s)${r.upToDate ? `, ${r.upToDate} already current` : ''}`, 'success', 4500);
      } else if (r.upToDate) {
        showToast(`All ${r.upToDate} mod(s) already up to date`, 'info');
      }
      if (r.failed?.length) {
        showToast(`${r.failed.length} mod(s) failed — check the console log`, 'error', 6000);
      }
      if (typeof window.__libraryBrowseRefresh === 'function') window.__libraryBrowseRefresh();
      await refreshLibraryInstalledTableOnly();
    } catch (e) {
      if (taskId) window.ZenonTasks.fail(taskId, e?.message || String(e));
      showToast(`Update all failed: ${e?.message || e}`, 'error', 5000);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update all';
    }
  });

  const searchEl = document.getElementById('library-installed-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      librarySearchFilter = searchEl.value;
      refreshLibraryInstalledTableOnly();
    });
  }

  document.getElementById('library-log-refresh')?.addEventListener('click', async () => {
    State.libraryPane = 'logs';
    await renderLibrary();
  });
  // Log viewer: filter tabs + copy + error/warning counts
  document.getElementById('library-log-copy')?.addEventListener('click', async () => {
    const ok = await copyToClipboard(libraryLastLogText || '');
    showToast(ok ? 'Log copied to clipboard' : 'Copy failed', ok ? 'success' : 'error');
  });
  document.querySelectorAll('[data-log-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      libraryLogFilter = btn.dataset.logFilter || 'all';
      document.querySelectorAll('[data-log-filter]').forEach((b) => {
        const on = (b.dataset.logFilter || 'all') === libraryLogFilter;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      renderLogView(libraryLogFilter);
    });
  });
  document.getElementById('library-crash-clear')?.addEventListener('click', async () => {
    if (!await showConfirm({ title: 'Clear crash history', message: 'Delete all recorded crash entries?', confirmLabel: 'Clear', danger: false })) return;
    await window.zenon.clearCrashes();
    showToast('Crash history cleared', 'info');
    State.libraryPane = 'logs';
    await renderLibrary();
  });
  if (pane === 'logs') renderLogView(libraryLogFilter);

  attachLibraryInstalledHandlers();
  attachLibraryIntelligenceHandlers();
  attachWorldHandlers();

  window.__libraryBrowseRefresh = null;
}

function renderLibraryBrowsePager(totalHits, offset, limit) {
  const el = document.getElementById('library-browse-pager');
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
    <button type="button" class="btn btn-ghost btn-sm" id="library-browse-prev" ${canPrev ? '' : 'disabled'}>Previous</button>
    <span class="discovery-pager-meta">${start}–${end} of ${total}</span>
    <button type="button" class="btn btn-ghost btn-sm" id="library-browse-next" ${canNext ? '' : 'disabled'}>Next</button>
  `;
  document.getElementById('library-browse-prev')?.addEventListener('click', () => {
    libraryBrowseOffset = Math.max(0, libraryBrowseOffset - LIBRARY_BROWSE_PAGE_SIZE);
    runLibraryBrowseSearch(libraryBrowseOffset);
  });
  document.getElementById('library-browse-next')?.addEventListener('click', () => {
    libraryBrowseOffset += LIBRARY_BROWSE_PAGE_SIZE;
    runLibraryBrowseSearch(libraryBrowseOffset);
  });
}

async function runLibraryBrowseSearch(offset) {
  const resultsEl = document.getElementById('library-browse-results');
  const inst = State.selectedInstance;
  const modal = document.getElementById('modal-library-browse');
  if (!resultsEl || !inst || !modal?.classList.contains('show')) return;

  if (typeof offset === 'number') libraryBrowseOffset = offset;
  const seq = ++__libraryBrowseSeq;

  const def = libraryBrowseDef();
  const isCf = libraryBrowseSource === 'curseforge';
  const loader = def.projectType === 'mod' ? instanceModrinthFacetLoader(inst) : '';

  resultsEl.innerHTML = '<div class="loading-spinner"></div>';
  const pagerEl = document.getElementById('library-browse-pager');
  if (pagerEl) pagerEl.style.display = 'none';

  const searchParams = {
    query: libraryBrowseQuery,
    version: inst.version,
    loader,
    projectType: def.projectType,
    limit: LIBRARY_BROWSE_PAGE_SIZE,
    offset: libraryBrowseOffset
  };
  const data = isCf
    ? await window.zenon.searchCurseforge(searchParams)
    : await window.zenon.searchModrinth(searchParams);
  if (seq !== __libraryBrowseSeq) return; // A newer search started — drop this stale response.
  const hits = data.hits || [];
  const total = data.total_hits != null ? data.total_hits : hits.length;
  const searchError = data.error || '';

  if (hits.length === 0) {
    if (pagerEl) {
      pagerEl.style.display = 'none';
      pagerEl.innerHTML = '';
    }
    const msg = searchError ? escapeHtml(searchError) : 'No hits — try other keywords.';
    resultsEl.innerHTML = `<div class="empty-inline discovery-hint">${msg}</div>`;
    return;
  }

  resultsEl.innerHTML = `<div class="library-browse-grid">${hits
    .map((mod) => {
      const initial = (mod.title || '?').charAt(0);
      const iconBlock = mod.icon_url
        ? `<img class="library-embed-icon" src="${escapeHtml(mod.icon_url)}" alt="" onerror="this.outerHTML='<div class=\\'library-embed-icon-ph\\'>${escapeHtml(initial)}</div>'">`
        : `<div class="library-embed-icon-ph">${escapeHtml(initial)}</div>`;
      return `
    <div class="library-embed-card">
      <div class="library-embed-card-top">
        ${iconBlock}
        <div class="library-embed-card-text">
          <div class="library-embed-card-title">${escapeHtml(mod.title)}</div>
          <div class="library-embed-card-author">${escapeHtml(mod.author || '')}</div>
        </div>
      </div>
      <button type="button" class="btn btn-primary btn-sm library-browse-install" data-id="${mod.project_id}" data-title="${escapeHtml(mod.title)}" data-icon="${escapeHtml(mod.icon_url || '')}" data-author="${escapeHtml(mod.author || '')}">Install</button>
    </div>`;
    })
    .join('')}</div>`;

  renderLibraryBrowsePager(total, libraryBrowseOffset, LIBRARY_BROWSE_PAGE_SIZE);

  resultsEl.querySelectorAll('.library-browse-install').forEach((btn) => {
    btn.addEventListener('click', () => {
      const vo = def.versionOpts(inst);
      zenonOpenInstallModal(btn.dataset.id, btn.dataset.title, libraryBrowseModalKind, vo, { iconUrl: btn.dataset.icon || '', author: btn.dataset.author || '' });
    });
  });
}

function openLibraryBrowseModal() {
  const inst = State.selectedInstance;
  if (!inst || State.libraryPane !== 'content') return;

  libraryBrowseModalKind = libraryContentKind;
  updateLibraryBrowseModalChrome(inst);
  renderLibraryBrowseKindPills();

  const pills = document.getElementById('library-browse-kind-pills');
  if (pills) {
    pills.onclick = (e) => {
      const pill = e.target.closest('[data-browse-kind]');
      if (!pill) return;
      const next = pill.dataset.browseKind;
      if (!next || next === libraryBrowseModalKind) return;
      libraryBrowseModalKind = next;
      renderLibraryBrowseKindPills();
      updateLibraryBrowseModalChrome(inst);
      libraryBrowseOffset = 0;
      runLibraryBrowseSearch(0);
    };
  }

  const sourceRow = document.getElementById('library-browse-source-row');
  if (sourceRow) {
    sourceRow.onclick = (e) => {
      const btn = e.target.closest('[data-browse-source]');
      if (!btn) return;
      const next = btn.getAttribute('data-browse-source') === 'curseforge' ? 'curseforge' : 'modrinth';
      if (next === libraryBrowseSource) return;
      libraryBrowseSource = next;
      try { localStorage.setItem('zenon-library-browse-source', next); } catch (_) {}
      renderLibraryBrowseKindPills();
      updateLibraryBrowseModalChrome(inst);
      libraryBrowseOffset = 0;
      runLibraryBrowseSearch(0);
    };
  }

  const input = document.getElementById('library-browse-search-input');
  if (input) {
    input.value = libraryBrowseQuery;
    input.oninput = () => {
      libraryBrowseQuery = input.value;
      libraryBrowseOffset = 0;
      clearTimeout(libraryBrowseTimer);
      libraryBrowseTimer = setTimeout(() => runLibraryBrowseSearch(0), 420);
    };
  }

  document.getElementById('library-browse-close-btn').onclick = () => {
    syncLibraryBrowseModalToMain();
    closeModal('modal-library-browse');
  };

  window.__onLibraryBrowseModalClose = syncLibraryBrowseModalToMain;
  libraryBrowseOffset = 0;
  openModal('modal-library-browse');

  window.__libraryBrowseRefresh = () => runLibraryBrowseSearch(libraryBrowseOffset);
  runLibraryBrowseSearch(0);
}

function renderInstalledRows(items) {
  if (!items.length) {
    return `<div class="empty-inline id-table-empty">Nothing installed yet. Use <strong>Browse &amp; install</strong> to add from Modrinth or CurseForge.</div>`;
  }
  // Reuse Discovery card layout so installed content matches Discovery visuals.
  return `<div class="discovery-grid">${items.map((mod) => renderInstalledCard(mod)).join('')}</div>`;
}

function renderInstalledCard(mod) {
  const guessTitleFromFilename = () => {
    const f = String(mod.filename || '').trim();
    if (!f) return '';
    // Strip extension and common trailing version fragments so the title reads better.
    return f
      .replace(/\.(jar|zip)$/i, '')
      .replace(/[-_+](fabric|forge|quilt)([-_].*)?$/i, '')
      .replace(/[-_+]?mc[-_+]?\d+(\.\d+){1,2}.*$/i, '')
      .replace(/[-_+]\d+(\.\d+){1,3}.*$/i, '');
  };

  const rawTitle = String(mod.title || '').trim() || String(mod.displayName || '').trim() || guessTitleFromFilename() || String(mod.filename || '').trim() || 'Project';
  const initial = rawTitle.charAt(0) || '?';
  const iconBlock = mod.iconUrl
    ? `<img class="discovery-card-icon library-mod-icon" src="${escapeHtml(mod.iconUrl)}" alt="" onerror="this.outerHTML='<div class=\'discovery-card-icon-ph library-mod-icon\'>${escapeHtml(initial)}</div>'">`
    : `<div class="discovery-card-icon-ph library-mod-icon">${escapeHtml(initial)}</div>`;

  const maker = String(mod.author || '').trim() || 'Unknown';
  const file = String(mod.filename || '').trim();
  const sizeText = mod.size ? formatBytes(mod.size) : '';

  return `
    <article class="discovery-card glow-card library-mod-card ${mod.enabled ? '': 'disabled'}" data-filename="${escapeHtml(mod.filename)}">
      <div class="library-mod-top">
        ${iconBlock}
        <div class="library-mod-body">
          <h3 class="discovery-card-title">${escapeHtml(rawTitle)}</h3>
          <p class="discovery-card-author">${escapeHtml(maker)}</p>
          <div class="library-mod-chips">
            ${sizeText ? `<span class="chip chip-mini">${escapeHtml(sizeText)}</span>` : ''}
            <span class="chip chip-mini ${mod.enabled ? 'chip-on' : 'chip-off'}">${mod.enabled ? 'Active' : 'Disabled'}</span>
          </div>
        </div>
      </div>
      <p class="library-mod-file" title="${escapeHtml(file)}">${escapeHtml(file)}</p>
      <div class="library-installed-actions">
        <button type="button" class="mod-toggle ${mod.enabled ? 'on' : ''}" data-action="toggle" data-filename="${escapeHtml(mod.filename)}" title="Enable / disable"></button>
        <button type="button" class="btn btn-danger btn-sm btn-icon" data-action="delete-mod" data-filename="${escapeHtml(mod.filename)}" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    </article>
  `;
}

async function refreshLibraryInstalledTableOnly() {
  if (State.libraryPane !== 'content' || !State.selectedInstance) return;
  const inst = State.selectedInstance;
  const items = await window.zenon.getContent(inst.id, libraryContentKind);
  const filtered = librarySearchFilter.trim()
    ? items.filter((m) => {
      const q = librarySearchFilter.trim().toLowerCase();
      return (
        (m.displayName && m.displayName.toLowerCase().includes(q)) ||
        (m.filename && m.filename.toLowerCase().includes(q))
      );
    })
    : items;
  const onlyBody = document.getElementById('library-installed-body');
  if (onlyBody) {
    onlyBody.innerHTML = renderInstalledRows(filtered);
  }
  // Keep the summary strip live with the grid.
  const totalBytes = items.reduce((sum, m) => sum + (Number(m.size) || 0), 0);
  const enabledCount = items.filter((m) => m.enabled).length;
  const kindLabel = LIBRARY_CONTENT_KINDS.find((k) => k.kind === libraryContentKind)?.label || 'Mods';
    const kindNoun = { Mods: 'mod', Shaders: 'shader', 'Resource Packs': 'resource pack', 'Data Packs': 'data pack', Modpacks: 'modpack' }[kindLabel] || kindLabel.toLowerCase();
      const modcount = document.getElementById('library-summary-modcount');
  const sizeEl = document.getElementById('library-summary-size');
  const onEl = document.getElementById('library-summary-enabled');
  const offEl = document.getElementById('library-summary-disabled');
  if (modcount) modcount.textContent = `${items.length} ${kindNoun}${items.length === 1 ? '' : 's'}`;
  if (sizeEl) sizeEl.textContent = formatBytes(totalBytes);
  if (onEl) onEl.textContent = `${enabledCount} on`;
  if (offEl) offEl.textContent = `${items.length - enabledCount} off`;
  if (onlyBody) attachLibraryInstalledHandlers();
}

async function onLibraryInstalledClick(e) {
  const action = e.target.closest('[data-action]');
  if (!action) return;
  const filename = action.dataset.filename;
  const inst = State.selectedInstance;
  if (!inst || !filename) return;

  if (action.dataset.action === 'toggle') {
    await window.zenon.toggleContent(inst.id, libraryContentKind, filename);
    // Refresh just the installed list — full page re-render feels janky.
    await refreshLibraryInstalledTableOnly();
  }
  if (action.dataset.action === 'delete-mod') {
    const base = filename.replace('.disabled', '');
    const ok = await showConfirm({
      title: 'Remove content',
      message: `Remove "${base}"? The file will be deleted from this instance.`,
      confirmLabel: 'Remove'
    });
    if (!ok) return;
    await window.zenon.deleteContent(inst.id, libraryContentKind, filename);
    showToast('Removed', 'info');
    // Keep user anchored on Library after delete.
    await navigateTo('instance', { force: true });
  }
}

function attachLibraryInstalledHandlers() {
  const el = document.getElementById('library-installed-body');
  if (!el) return;
  el.removeEventListener('click', onLibraryInstalledClick);
  el.addEventListener('click', onLibraryInstalledClick);
}

function attachWorldHandlers() {
  const el = document.getElementById('world-import-btn');
  if (el) {
    el.removeEventListener('click', onWorldImportClick);
    el.addEventListener('click', onWorldImportClick);
  }
  const wrap = document.getElementById('library-worlds-list');
  if (wrap) {
    wrap.removeEventListener('click', onWorldManagerClick);
    wrap.addEventListener('click', onWorldManagerClick);
  }
}

async function onWorldImportClick() {
  const inst = State.selectedInstance;
  if (!inst) return;
  // worldImport expects a zip path — trigger via a hidden file input so the user picks a file.
  let input = document.getElementById('world-import-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'world-import-input';
    input.accept = '.zip';
    input.style.display = 'none';
    document.body.appendChild(input);
  }
  input.value = '';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await window.zenon.worldImport(inst.id, file.path);
      showToast('World imported', 'success');
      await renderLibrary();
    } catch (e) {
      showToast(`Import failed: ${e?.message || e}`, 'error', 5000);
    }
  };
  input.click();
}

async function onWorldManagerClick(e) {
  const action = e.target.closest('[data-action]');
  if (!action) return;
  const inst = State.selectedInstance;
  if (!inst) return;
  const worldName = action.dataset.world;
  if (!worldName) return;

  if (action.dataset.action === 'launch-world') {
    // Launching into a specific world isn't directly supported by MCLC launch args;
    // we launch the instance and note the world in the console.
    showToast(`Launching ${inst.name} — select "${worldName}" in-game`, 'info');
    await window.zenon.launchGame(inst.id);
    return;
  }

  if (action.dataset.action === 'rename-world') {
    const newName = await showPrompt(`Rename "${worldName}" to:`, worldName);
    if (newName === null) return;
    try {
      await window.zenon.worldRename(inst.id, worldName, newName);
      showToast(`Renamed to "${newName}"`, 'success');
      await renderLibrary();
    } catch (err) {
      showToast(`Rename failed: ${err?.message || err}`, 'error', 5000);
    }
    return;
  }

  if (action.dataset.action === 'export-world') {
    try {
      const res = await window.zenon.worldExport(inst.id, worldName);
      if (res?.canceled) return;
      showToast(`Exported "${worldName}"`, 'success');
    } catch (err) {
      showToast(`Export failed: ${err?.message || err}`, 'error', 5000);
    }
    return;
  }

  if (action.dataset.action === 'delete-world') {
    const ok = await showConfirm({
      title: 'Delete world',
      message: `Delete "${worldName}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    try {
      await window.zenon.worldDelete(inst.id, worldName);
      showToast('World deleted', 'info');
      await renderLibrary();
    } catch (err) {
      showToast(`Delete failed: ${err?.message || err}`, 'error', 5000);
    }
    return;
  }
}

/**
 * Simple styled prompt dialog.
 * @returns {Promise<string|null>} the entered text, or null if cancelled
 */
function showPrompt(message, defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const dlg = document.createElement('div');
    dlg.className = 'modal modal-prompt show';
    dlg.innerHTML = `
      <div class="modal-header">
        <h2>Rename</h2>
        <button class="modal-close" id="prompt-close">&#x2715;</button>
      </div>
      <div class="modal-body">
        <p class="prompt-message">${escapeHtml(message)}</p>
        <input type="text" id="prompt-input" class="form-input" value="${escapeHtml(defaultValue)}" />
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="prompt-cancel">Cancel</button>
        <button class="btn btn-primary" id="prompt-ok">OK</button>
      </div>
    `;
    overlay.classList.add('show');
    dlg.querySelector('#prompt-ok').onclick = () => {
      const val = dlg.querySelector('#prompt-input').value;
      cleanup();
      resolve(val || null);
    };
    dlg.querySelector('#prompt-cancel').onclick = () => { cleanup(); resolve(null); };
    dlg.querySelector('#prompt-close').onclick = () => { cleanup(); resolve(null); };
    dlg.querySelector('#prompt-input').focus();
    const cleanup = () => {
      overlay.classList.remove('show');
      dlg.remove();
    };
  });
}


/**
 * Install modal — library (selected instance), discovery (targetInstance), or discovery modpack (new instance).
 * @param {object} [meta]
 * @param {object} [meta.targetInstance] — use instead of State.selectedInstance
 * @param {boolean} [meta.modpackAsNewInstance] — create a new instance from .mrpack (no target instance)
 * @param {string} [meta.mcVersionOverride] — Modrinth version query when no target instance (e.g. discovery filter)
 * @param {string} [meta.iconUrl] — optional icon URL when creating a modpack instance
 */
async function zenonOpenInstallModal(projectId, title, contentKind, versionQuery, meta = {}) {
  const { targetInstance = null, modpackAsNewInstance = false, mcVersionOverride = null, iconUrl = null, author = null } = meta;
  const inst = targetInstance || State.selectedInstance;

  if (!modpackAsNewInstance && !inst) {
    showToast('Select an instance first', 'error');
    return;
  }

  document.getElementById('mod-download-title').textContent = `Install: ${title}`;
  document.getElementById('mod-versions-list').innerHTML = '<div class="loading-spinner"></div>';
  openModal('modal-mod-download');

  // For CurseForge projects (cf- prefix), use the CF-specific version fetch
  // For Modrinth modpacks, we need to allow mrpack loader. For CF modpacks, we need no loader filter.
  const isCurseForge = String(projectId || '').startsWith('cf-');
  const mcVersion =
    mcVersionOverride != null && String(mcVersionOverride).trim() !== ''
      ? String(mcVersionOverride).trim()
      : inst?.version || '';

  let opts = { projectId, mcVersion };
  if (modpackAsNewInstance) {
    // For modpacks from Discovery, we need special handling:
    // - Modrinth modpacks: pass loaders: ['mrpack'] 
    // - CurseForge modpacks: pass loaders: null (let CF determine compatibility)
    if (!isCurseForge) {
      opts.loaders = ['mrpack'];
    }
    // For CurseForge, don't pass loaders - CF API handles modpack filtering differently
  } else if (versionQuery?.loaders?.length) {
    opts.loaders = versionQuery.loaders;
  } else if (versionQuery?.loader) {
    opts.loader = versionQuery.loader;
  }
  const versions = await window.zenon.getProjectVersions(opts);

  const container = document.getElementById('mod-versions-list');

  if (!versions || !Array.isArray(versions) || versions.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:24px">
        <h3>No compatible versions</h3>
        <p>Try another Minecraft version or check the project on Modrinth.</p>
      </div>
    `;
    document.getElementById('mod-modal-close-btn').onclick = () => closeModal('modal-mod-download');
    return;
  }

  const top = versions.slice(0, 14);
  container.innerHTML = top
    .map(
      (ver, verIdx) => `
    <div class="version-item">
      <div class="version-info">
        <h4>${escapeHtml(ver.name || ver.version_number)}</h4>
        <div class="version-tags">
          ${(ver.game_versions || []).slice(0, 4).map((v) => `<span class="tag tag-version">${escapeHtml(v)}</span>`).join('')}
          ${(ver.loaders || []).map((l) => `<span class="tag tag-fabric">${escapeHtml(l)}</span>`).join('')}
        </div>
      </div>
      <button type="button" class="btn btn-primary btn-sm" data-action="do-download" data-ver-idx="${verIdx}">
        Download
      </button>
    </div>
  `
    )
    .join('');

  container.querySelectorAll('[data-action="do-download"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const verIdx = parseInt(btn.dataset.verIdx, 10);
      const versionData = top[verIdx];
      btn.disabled = true;
      btn.textContent = 'Downloading...';
      const taskId = window.ZenonTasks
        ? window.ZenonTasks.start(modpackAsNewInstance ? `Installing ${title}` : `Downloading ${title}`, {
            detail: modpackAsNewInstance ? 'Creating instance & fetching files…' : 'Downloading…'
          })
        : null;
      let result;
      if (modpackAsNewInstance) {
        result = versionData?._cf && window.zenon.installCfModpack
          ? await window.zenon.installCfModpack({ versionData, displayName: title, iconUrl: iconUrl || '' })
          : await window.zenon.createInstanceFromMrpack({ versionData, displayName: title, iconUrl: iconUrl || '' });
      } else {
        result = await window.zenon.downloadContent(inst.id, contentKind, versionData, {
          projectId,
          title,
          iconUrl: iconUrl || null,
          author: author || null
        });
      }
      if (result.success) {
        if (taskId) {
          if (Array.isArray(result.failed) && result.failed.length) {
            window.ZenonTasks.fail(taskId, `${result.installed || 0}/${result.total || '?'} required files installed — ${result.failed.length} failed`);
          } else {
            window.ZenonTasks.succeed(taskId, modpackAsNewInstance ? 'New instance ready' : 'Installed');
          }
        }
        const partialFailNote = Array.isArray(result.failed) && result.failed.length
          ? ` — ${result.failed.length} file(s) skipped (${result.failed.slice(0, 3).map((f) => f.file || f.projectID).join(', ')}${result.failed.length > 3 ? `, +${result.failed.length - 3} more` : ''})`
          : '';
        if (modpackAsNewInstance) {
          showToast(`${title} — new instance created${partialFailNote}`, result.failed?.length ? 'warning' : 'success', 6000);
        } else {
          showToast(describeDependencyInstall(title, result), 'success', 6000);
          showDependencyFailures(result);
        }
        closeModal('modal-mod-download');
        if (modpackAsNewInstance && result.instance) {
          State.instances = await window.zenon.getInstances();
          State.selectedInstance = result.instance;
          if (typeof window.syncSelectedInstanceWithList === 'function') window.syncSelectedInstanceWithList();
          if (typeof updateSidebarBadge === 'function') updateSidebarBadge();
        }
        // After creating a modpack instance, always land in Library.
        if (modpackAsNewInstance) {
          State.libraryPane = 'content';
          await navigateTo('instance', { force: true });
          return;
        }
        if (State.currentPage === 'instance') {
          await refreshLibraryInstalledTableOnly();
          const br = window.__libraryBrowseRefresh;
          if (typeof br === 'function') br();
        } else if (State.currentPage === 'discovery') {
          const fn = window.__discoveryRefresh;
          if (typeof fn === 'function') fn();
        }
        if (State.currentPage === 'instances' && typeof renderInstances === 'function') {
          await renderInstances();
        }
      } else {
        if (taskId) window.ZenonTasks.fail(taskId, result.error || 'Download failed');
        showToast(`Download failed: ${result.error}`, 'error');
        btn.disabled = false;
        btn.textContent = 'Download';
      }
    });
  });

  document.getElementById('mod-modal-close-btn').onclick = () => closeModal('modal-mod-download');
}
