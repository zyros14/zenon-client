// ===== Instance Library (installed content + detail layout) =====
let libraryContentKind = 'mod';
let librarySearchFilter = '';
let libraryBrowseQuery = '';
let libraryBrowseTimer = null;
let libraryBrowseOffset = 0;
/** Active category while the Modrinth browse modal is open (synced to the library tab on close). */
let libraryBrowseModalKind = 'mod';
let libraryBrowseProvider = 'all'; // 'all' | 'modrinth' | 'curseforge'
const LIBRARY_BROWSE_PAGE_SIZE = 18;
let __libraryRenderSeq = 0;
let libraryLogsView = 'launch'; // 'launch' | 'latest'

// CurseForge kind routing (server resolves exact ids; we provide kind).
const CURSEFORGE_KIND = {
  mod: 'mod',
  modpack: 'modpack',
  resourcepack: 'resourcepack',
  datapack: 'datapack'
};

function libraryPlayStopButtonHtml(inst) {
  if (!inst) return '';
  const isRunning = State.runningInstanceId && State.runningInstanceId === inst.id;
  if (isRunning) {
    return `<button type="button" class="btn btn-danger id-play-btn id-play-morph" data-action="stop" data-id="${inst.id}">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
      Stop
    </button>`;
  }
  return `<button type="button" class="btn btn-play id-play-btn id-play-morph" data-action="play" data-id="${inst.id}">
    <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    Play
  </button>`;
}

// Lightweight update to avoid full rerender (prevents screen flash).
if (!window.updateLibraryPlayStopButton) {
  window.updateLibraryPlayStopButton = function updateLibraryPlayStopButton() {
    if (State.currentPage !== 'library') return;
    const inst = State.selectedInstance;
    const wrap = document.querySelector('.id-header-actions');
    if (!inst || !wrap) return;

    const existing = wrap.querySelector('.id-play-btn');
    const wantAction = State.runningInstanceId && State.runningInstanceId === inst.id ? 'stop' : 'play';
    const haveAction = existing?.getAttribute?.('data-action') || '';
    if (existing && haveAction === wantAction) return;

    const replace = () => {
      const html = libraryPlayStopButtonHtml(inst);
      if (!html) return;
      if (existing) existing.outerHTML = html;
      else wrap.insertAdjacentHTML('afterbegin', html);
      const next = wrap.querySelector('.id-play-btn');
      if (next) {
        next.classList.remove('id-play-morph-out');
        next.classList.add('id-play-morph-in');
        setTimeout(() => next.classList.remove('id-play-morph-in'), 220);
      }
    };

    if (existing) {
      existing.classList.remove('id-play-morph-in');
      existing.classList.add('id-play-morph-out');
      setTimeout(replace, 140);
    } else {
      replace();
    }
  };
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
    return 'Modrinth modpacks (.mrpack) filtered to this Minecraft version.';
  }
  return '';
}

function browseSearchPlaceholder(kind) {
  if (kind === 'shaderpack') return 'Search shaders…';
  if (kind === 'resourcepack') return 'Search resource packs…';
  if (kind === 'datapack') return 'Search data packs…';
  if (kind === 'modpack') return 'Search modpacks…';
  return 'Search Modrinth mods…';
}

function renderLibraryBrowseKindPills() {
  const el = document.getElementById('library-browse-kind-pills');
  if (!el) return;
  el.innerHTML = LIBRARY_CONTENT_KINDS.map(
    (k) =>
      `<button type="button" role="tab" aria-selected="${k.kind === libraryBrowseModalKind ? 'true' : 'false'}" class="id-pill ${k.kind === libraryBrowseModalKind ? 'active' : ''}" data-browse-kind="${k.kind}">${k.label}</button>`
  ).join('');
}

function renderLibraryBrowseProviderPills() {
  const el = document.getElementById('library-browse-provider-pills');
  if (!el) return;
  const opts = [
    { id: 'all', label: 'All' },
    { id: 'modrinth', label: 'Modrinth' },
    { id: 'curseforge', label: 'CurseForge' }
  ];
  el.innerHTML = opts
    .map(
      (p) =>
        `<button type="button" role="tab" aria-selected="${p.id === libraryBrowseProvider ? 'true' : 'false'}" class="id-pill ${p.id === libraryBrowseProvider ? 'active' : ''}" data-browse-provider="${p.id}">${p.label}</button>`
    )
    .join('');
}

function updateLibraryBrowseModalChrome(inst) {
  if (!inst) return;
  const kind = libraryBrowseModalKind;
  const tabLabel = LIBRARY_CONTENT_KINDS.find((k) => k.kind === kind)?.label || 'Content';
  const titleEl = document.getElementById('library-browse-modal-title');
  const hintEl = document.getElementById('library-browse-modal-hint');
  const lockedEl = document.getElementById('library-browse-locked');
  const input = document.getElementById('library-browse-search-input');
  if (titleEl) titleEl.textContent = `Browse & install — ${tabLabel}`;
  if (hintEl) hintEl.textContent = browseModalHint(kind);
  if (lockedEl) lockedEl.innerHTML = browseLockedRowsHtml(inst, kind);
  if (input) {
    const base = libraryBrowseProvider === 'curseforge' ? 'CurseForge' : libraryBrowseProvider === 'modrinth' ? 'Modrinth' : 'Modrinth + CurseForge';
    input.placeholder = `Search ${base}…`;
  }
}

function syncLibraryBrowseModalToMain() {
  libraryContentKind = libraryBrowseModalKind;
  window.__libraryBrowseRefresh = null;
  window.__onLibraryBrowseModalClose = null;
  if (State.currentPage === 'library') void renderLibrary();
}

function loaderLabel(loader) {
  if (loader === 'fabric') return 'Fabric';
  if (loader === 'forge') return 'Forge';
  if (loader === 'vanilla') return 'Vanilla';
  return loader || 'Unknown';
}

function instanceSubtitle(inst) {
  const played = inst.lastPlayed ? formatDate(inst.lastPlayed) : 'Never launched';
  return `${loaderLabel(inst.loader)} ${inst.version} · ${played}`;
}

async function renderLibrary() {
  const seq = ++__libraryRenderSeq;
  const content = document.getElementById('main-content');

  // Always show all instances in the Library (left column), and show the selected instance's content on the right.
  if (!State.instances || State.instances.length === 0) {
    try {
      State.instances = await window.zenon.getInstances();
      if (typeof window.syncSelectedInstanceWithList === 'function') window.syncSelectedInstanceWithList();
    } catch (e) {
      State.instances = [];
    }
  }
  if (seq !== __libraryRenderSeq) return;

  const instances = State.instances || [];
  const selectedId = State.selectedInstance?.id || '';
  const instListHtml = instances.length
    ? instances
        .map((i) => {
          const active = selectedId && i.id === selectedId;
          return `<button type="button" class="btn btn-ghost library-inst-row ${active ? 'active' : ''}" data-inst="${escapeHtml(i.id)}">
            <span class="library-inst-icon">${getInstanceIcon(i)}</span>
            <span class="library-inst-main">
              <span class="library-inst-name">${escapeHtml(i.name || 'Instance')}</span>
              <span class="library-inst-meta">${escapeHtml(loaderLabel(i.loader))} ${escapeHtml(i.version || '')}</span>
            </span>
          </button>`;
        })
        .join('')
    : `<div class="empty-inline">No instances yet.</div>`;

  const inst = State.selectedInstance;
  const pane = State.libraryPane || 'content';

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

    paneBody = `
      <div class="id-content-toolbar library-content-toolbar-row">
        <div class="id-kind-pills" id="library-kind-pills">
          ${LIBRARY_CONTENT_KINDS.map(
            (k) => `
            <button type="button" class="id-pill ${k.kind === libraryContentKind ? 'active' : ''}" data-kind="${k.kind}">${k.label}</button>
          `
          ).join('')}
        </div>
        <button type="button" class="btn btn-primary btn-browse-install" id="library-open-browse-btn" title="Search Modrinth scoped to this instance">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Browse &amp; install
        </button>
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
      <p class="id-pane-hint">Worlds in <code class="id-code">saves/</code>. Launch the game once if this list is empty.</p>
      <div class="id-files-list">
        ${worlds.length === 0 ? '<div class="empty-inline">No worlds in saves/ yet.</div>' : ''}
        ${worlds
          .map(
            (w) => `
          <div class="id-file-row">
            <span class="id-file-icon">&#127757;</span>
            <span class="id-file-name">${escapeHtml(w.name)}</span>
            <span class="id-file-type">World</span>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  } else if (pane === 'logs') {
    const log = await window.zenon.readInstanceLatestLog(inst.id);
    if (seq !== __libraryRenderSeq) return;
    const activeLaunch = libraryLogsView === 'launch';
    paneBody = `
      <div class="id-logs-toolbar">
        <div class="id-logs-toolbar-left">
          <button type="button" class="btn btn-ghost btn-sm ${activeLaunch ? 'active' : ''}" id="library-logs-view-launch">Launch console</button>
          <button type="button" class="btn btn-ghost btn-sm ${!activeLaunch ? 'active' : ''}" id="library-logs-view-latest">Latest log</button>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="library-log-refresh">Refresh</button>
      </div>
      <div id="library-logs-launch-wrap" style="display:${activeLaunch ? 'block' : 'none'}">
        <div class="id-launch-console-card">
          <div class="console-header id-launch-console-head">
            <span>Launch Console</span>
            <div class="id-launch-console-head-right">
              <span class="console-status" id="library-launch-status">Idle</span>
              <button type="button" class="btn btn-ghost btn-sm" id="library-launch-copy">Copy</button>
              <button type="button" class="btn btn-ghost btn-sm" id="library-launch-save">Save</button>
            </div>
          </div>
          <div class="id-launch-console-toolbar">
            <div class="search-bar id-launch-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" id="library-launch-search" placeholder="Filter launch output…" value="" />
            </div>
            <button type="button" class="toggle-switch on" id="library-launch-errors-only" title="Errors only"></button>
            <div class="id-launch-toggle-label">Errors only</div>
            <button type="button" class="toggle-switch on" id="library-launch-autoscroll" title="Auto-scroll"></button>
            <div class="id-launch-toggle-label">Auto-scroll</div>
          </div>
          <div class="console-output id-launch-console-output" id="library-launch-output"></div>
        </div>
      </div>
      <div id="library-logs-latest-wrap" style="display:${activeLaunch ? 'none' : 'block'}">
        <pre class="id-log-pre" id="library-log-pre">${escapeHtml(log.text || '')}</pre>
      </div>
    `;
  } else if (pane === 'screenshots') {
    const res = await window.zenon.listInstanceScreenshots?.(inst.id);
    if (seq !== __libraryRenderSeq) return;
    const items = res?.success && Array.isArray(res.items) ? res.items : [];
    const root = (inst.dir || '').replace(/\\/g, '/');
    const mkSrc = (fn) => {
      const pathRel = `screenshots/${fn}`.replace(/^\/+/, '');
      return root ? `file:///${encodeURI(`${root}/${pathRel}`)}` : '';
    };
    paneBody = `
      <p class="id-pane-hint">Screenshots saved by Minecraft in <code class="id-code">screenshots/</code>.</p>
      ${
        items.length
          ? `<div class="zn-shot-grid" id="library-shot-grid">
              ${items
                .map((it) => {
                  const src = mkSrc(it.filename);
                  const title = escapeHtml(it.filename || '');
                  const meta = it.mtimeMs ? new Date(it.mtimeMs).toLocaleString() : '';
                  return `
                    <button type="button" class="zn-shot-card" data-shot="${escapeHtml(it.filename)}" title="${title}">
                      <img class="zn-shot-img" src="${escapeHtml(src)}" alt="" draggable="false" />
                      <div class="zn-shot-name">${title}</div>
                      <div class="zn-shot-meta">${escapeHtml(meta)}</div>
                    </button>
                  `;
                })
                .join('')}
            </div>`
          : `<div class="empty-inline discovery-hint">No screenshots yet. Take one in-game (F2) and it will appear here.</div>`
      }
    `;
  } else if (pane === 'crashes') {
    const res = await window.zenon.listInstanceCrashes?.(inst.id);
    if (seq !== __libraryRenderSeq) return;
    const items = res?.success && Array.isArray(res.items) ? res.items : [];
    paneBody = `
      <p class="id-pane-hint">Crash reports and JVM crash logs found in this instance.</p>
      ${
        items.length
          ? `<div class="id-files-list" id="library-crash-list">
              ${items
                .map((c) => {
                  return `
                    <div class="id-file-row">
                      <span class="id-file-icon">!</span>
                      <span class="id-file-name" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.filename || '')}</span>
                      <span class="id-file-type">${escapeHtml(c.kind || '')}</span>
                      <div style="display:flex;gap:8px;flex-shrink:0">
                        <button type="button" class="btn btn-ghost btn-sm" data-crash-open="${escapeHtml(c.filename)}" data-crash-kind="${escapeHtml(c.kind)}">View</button>
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>
            <div class="card" style="margin-top:14px;display:none" id="library-crash-detail">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
                <div style="min-width:0">
                  <div style="font-weight:800;font-size:14px" id="library-crash-title">Crash</div>
                  <div style="margin-top:6px;color:var(--text-muted);font-size:12px" id="library-crash-hints"></div>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
                  <button type="button" class="btn btn-ghost btn-sm" id="library-crash-open-folder">Open instance folder</button>
                </div>
              </div>
              <div style="margin-top:12px">
                <pre class="id-log-pre" id="library-crash-raw" style="max-height:360px"></pre>
              </div>
            </div>`
          : `<div class="empty-inline discovery-hint">No crash reports found yet.</div>`
      }
    `;
  } else if (pane === 'conflicts') {
    const res = await window.zenon.analyzeModConflicts?.(inst.id);
    if (seq !== __libraryRenderSeq) return;
    const issues = res?.ok && Array.isArray(res.issues) ? res.issues : [];
    const errs = issues.filter((i) => i.severity === 'error');
    const warns = issues.filter((i) => i.severity === 'warn');
    const renderIssues = (arr) =>
      arr.length
        ? `<div style="display:flex;flex-direction:column;gap:8px">${arr
            .map(
              (i) => `
            <div class="home-tip">
              <div class="home-tip-title">${escapeHtml(i.title || i.kind || 'Issue')}</div>
              <div class="home-tip-desc">${escapeHtml(i.detail || '')}</div>
            </div>`
            )
            .join('')}</div>`
        : `<div class="empty-inline discovery-hint">None.</div>`;
    paneBody = `
      <p class="id-pane-hint">Scans your <code class="id-code">mods/</code> folder for common conflicts.</p>
      <div class="card" style="margin-top:10px">
        <div style="font-weight:800;font-size:14px">Errors</div>
        <div style="margin-top:10px">${renderIssues(errs)}</div>
      </div>
      <div class="card" style="margin-top:12px">
        <div style="font-weight:800;font-size:14px">Warnings</div>
        <div style="margin-top:10px">${renderIssues(warns)}</div>
      </div>
    `;
  }

  if (seq !== __libraryRenderSeq) return;
  content.innerHTML = `
    <div class="page page-instance-detail">
      <div class="library-content-split">
        <aside class="library-browse-col">
          <div class="library-browse-head">
            <div class="library-browse-title">Instances</div>
            <div class="library-browse-sub">Pick one to view its library.</div>
          </div>
          <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
            <button type="button" class="btn btn-primary btn-sm" id="library-new-instance-left">New Instance</button>
            <button type="button" class="btn btn-ghost btn-sm" id="library-manage-instances-left">Manage</button>
          </div>
          <div class="id-files-list" id="library-instances-list">${instListHtml}</div>
        </aside>

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
              ${libraryPlayStopButtonHtml(inst)}
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
            <button type="button" class="id-tab ${pane === 'screenshots' ? 'active' : ''}" data-pane="screenshots">Screenshots</button>
            <button type="button" class="id-tab ${pane === 'crashes' ? 'active' : ''}" data-pane="crashes">Crashes</button>
            <button type="button" class="id-tab ${pane === 'conflicts' ? 'active' : ''}" data-pane="conflicts">Conflicts</button>
          </nav>
          `
              : ''
          }

          <section class="id-pane">${paneBody}</section>
        </section>
      </div>
    </div>
  `;

  document.getElementById('library-new-instance-left')?.addEventListener('click', () => {
    if (typeof openCreateInstanceModal === 'function') openCreateInstanceModal();
    else navigateTo('instances');
  });
  document.getElementById('library-manage-instances-left')?.addEventListener('click', () => navigateTo('instances'));
  document.getElementById('library-create-instance-btn')?.addEventListener('click', () => {
    if (typeof openCreateInstanceModal === 'function') openCreateInstanceModal();
    else navigateTo('instances');
  });

  document.getElementById('library-instances-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-inst]');
    if (!btn) return;
    const id = btn.getAttribute('data-inst');
    const hit = (State.instances || []).find((x) => x.id === id);
    if (!hit) return;
    State.selectedInstance = hit;
    if (typeof updateSidebarBadge === 'function') updateSidebarBadge();
    librarySearchFilter = '';
    libraryBrowseQuery = '';
    State.libraryPane = 'content';
    await renderLibrary();
  });

  // Play/Stop: use event delegation so handlers survive rerenders.
  if (!window.__zenonLibraryPlayStopWired) {
    window.__zenonLibraryPlayStopWired = true;
    document.addEventListener('click', async (e) => {
      const btn = e.target?.closest?.('.id-play-btn');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      if (action === 'play') {
        if (id) launchInstance(id);
        // Optimistically morph Play -> Stop after launch sets State.runningInstanceId.
        setTimeout(() => window.updateLibraryPlayStopButton?.(), 150);
      } else if (action === 'stop') {
        try {
          btn.disabled = true;
          btn.classList.add('id-play-busy');
          btn.innerHTML = `<span class="id-play-spinner" aria-hidden="true"></span>Stopping…`;
          try { State.launchConsole.stopRequestedAt = Date.now(); } catch (e0) {}
          const r = await window.zenon.stopGame();
          if (!r?.success) showToast(r?.error || 'Stop failed', 'error', 4500);
          else showToast(r?.detail ? `Stopping game… (${r.detail})` : 'Stopping game…', 'info', 2200);
        } finally {
          btn.disabled = false;
        }
      }
    }, true);
  }

  document.getElementById('library-open-folder')?.addEventListener('click', () => window.zenon.openInstanceFolder(inst.id));
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

  // Screenshots: click to open
  document.getElementById('library-shot-grid')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-shot]');
    if (!b || !State.selectedInstance) return;
    const fn = b.getAttribute('data-shot');
    if (!fn) return;
    await window.zenon.openInstanceScreenshot?.(State.selectedInstance.id, fn);
  });

  // Crashes: click to view + analyze
  document.getElementById('library-crash-list')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-crash-open]');
    if (!b || !State.selectedInstance) return;
    const fn = b.getAttribute('data-crash-open');
    const kind = b.getAttribute('data-crash-kind') || '';
    if (!fn) return;

    const detail = document.getElementById('library-crash-detail');
    if (detail) detail.style.display = 'block';
    const title = document.getElementById('library-crash-title');
    const hints = document.getElementById('library-crash-hints');
    const raw = document.getElementById('library-crash-raw');
    if (title) title.textContent = fn;
    if (hints) hints.textContent = 'Analyzing…';
    if (raw) raw.textContent = '';

    const analysisRes = await window.zenon.analyzeInstanceCrash?.(State.selectedInstance.id, kind, fn);
    const readRes = await window.zenon.readInstanceCrash?.(State.selectedInstance.id, kind, fn);
    if (raw) raw.textContent = readRes?.text || '';
    if (analysisRes?.analysis) {
      const a = analysisRes.analysis;
      const hs = Array.isArray(a.hints) ? a.hints : [];
      if (hints) hints.textContent = hs.join(' ');
      if (title && a.title) title.textContent = a.title;
    } else {
      if (hints) hints.textContent = analysisRes?.error || 'Could not analyze crash.';
    }

    document.getElementById('library-crash-open-folder')?.addEventListener(
      'click',
      () => {
        if (State.selectedInstance) window.zenon.openInstanceFolder(State.selectedInstance.id);
      },
      { once: true }
    );
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

  document.getElementById('library-logs-view-launch')?.addEventListener('click', () => {
    libraryLogsView = 'launch';
    // Update in-place without full rerender flash.
    const a = document.getElementById('library-logs-launch-wrap');
    const b = document.getElementById('library-logs-latest-wrap');
    if (a && b) {
      b.classList.remove('id-logs-fade-in');
      b.classList.add('id-logs-fade-out');
      a.style.display = 'block';
      a.classList.remove('id-logs-fade-out');
      a.classList.add('id-logs-fade-in');
      setTimeout(() => { b.style.display = 'none'; }, 160);
    }
    try { window.renderLaunchConsoleMirrors?.(); } catch (e) {}
  });
  document.getElementById('library-logs-view-latest')?.addEventListener('click', () => {
    libraryLogsView = 'latest';
    const a = document.getElementById('library-logs-launch-wrap');
    const b = document.getElementById('library-logs-latest-wrap');
    if (a && b) {
      a.classList.remove('id-logs-fade-in');
      a.classList.add('id-logs-fade-out');
      b.style.display = 'block';
      b.classList.remove('id-logs-fade-out');
      b.classList.add('id-logs-fade-in');
      setTimeout(() => { a.style.display = 'none'; }, 160);
    }
  });

  // Launch console QOL controls
  document.getElementById('library-launch-search')?.addEventListener('input', (e) => {
    State.launchConsole.filter.query = e.currentTarget.value || '';
    window.renderLaunchConsoleMirrors?.();
  });
  document.getElementById('library-launch-errors-only')?.addEventListener('click', (e) => {
    State.launchConsole.filter.errorsOnly = !State.launchConsole.filter.errorsOnly;
    e.currentTarget.classList.toggle('on', State.launchConsole.filter.errorsOnly);
    window.renderLaunchConsoleMirrors?.();
  });
  document.getElementById('library-launch-autoscroll')?.addEventListener('click', (e) => {
    State.launchConsole.autoScroll = !(State.launchConsole.autoScroll === false);
    e.currentTarget.classList.toggle('on', State.launchConsole.autoScroll !== false);
    window.renderLaunchConsoleMirrors?.();
  });
  document.getElementById('library-launch-copy')?.addEventListener('click', async () => {
    try {
      const text = (State.launchConsole.lines || []).map((l) => l.text || '').join('\n');
      await navigator.clipboard.writeText(text);
      showToast('Launch console copied', 'success', 1500);
    } catch (e) {
      showToast('Copy failed', 'error', 2500);
    }
  });
  document.getElementById('library-launch-save')?.addEventListener('click', async () => {
    try {
      const inst = State.selectedInstance;
      if (!inst?.id) return;
      const text = (State.launchConsole.lines || []).map((l) => l.text || '').join('\n');
      const r = await window.zenon.saveLaunchConsole?.(inst.id, text);
      if (!r?.success) throw new Error(r?.error || 'Save failed');
      showToast(`Saved to ${r.filename || 'launch-console.txt'}`, 'success', 2200);
    } catch (e) {
      showToast(e?.message || 'Save failed', 'error', 3500);
    }
  });

  // If we rendered the launch console mirror, hydrate it now.
  try {
    if (State.libraryPane === 'logs') window.renderLaunchConsoleMirrors?.();
  } catch (e) {}
  // Ensure initial fade classes are set for current view.
  try {
    const a = document.getElementById('library-logs-launch-wrap');
    const b = document.getElementById('library-logs-latest-wrap');
    if (a && b) {
      if (libraryLogsView === 'launch') {
        a.classList.add('id-logs-fade-in');
        a.classList.remove('id-logs-fade-out');
        b.classList.add('id-logs-fade-out');
        b.classList.remove('id-logs-fade-in');
      } else {
        b.classList.add('id-logs-fade-in');
        b.classList.remove('id-logs-fade-out');
        a.classList.add('id-logs-fade-out');
        a.classList.remove('id-logs-fade-in');
      }
    }
  } catch (e) {}

  attachLibraryInstalledHandlers();

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

  const def = libraryBrowseDef();
  const loader = def.projectType === 'mod' ? instanceModrinthFacetLoader(inst) : '';

  resultsEl.innerHTML = '<div class="loading-spinner"></div>';
  const pagerEl = document.getElementById('library-browse-pager');
  if (pagerEl) pagerEl.style.display = 'none';

  let data;
  try {
    const doModrinth = libraryBrowseProvider === 'modrinth' || libraryBrowseProvider === 'all';
    const doCurseforge = libraryBrowseProvider === 'curseforge' || libraryBrowseProvider === 'all';

    const modrinthPromise = doModrinth
      ? window.zenon.searchModrinth({
          query: libraryBrowseQuery,
          version: inst.version,
          loader,
          projectType: def.projectType,
          limit: LIBRARY_BROWSE_PAGE_SIZE,
          offset: libraryBrowseOffset
        })
      : Promise.resolve(null);

    const cfKind =
      def.projectType === 'mod' ? CURSEFORGE_KIND.mod
        : def.projectType === 'modpack' ? CURSEFORGE_KIND.modpack
        : def.projectType === 'resourcepack' ? CURSEFORGE_KIND.resourcepack
        : def.projectType === 'datapack' ? CURSEFORGE_KIND.datapack
        : null;

    const curseforgePromise = doCurseforge
      ? (cfKind
          ? window.zenon.curseforgeSearchMods?.({
              query: libraryBrowseQuery,
              mcVersion: inst.version,
              loader: inst.loader,
              kind: cfKind,
              pageSize: LIBRARY_BROWSE_PAGE_SIZE,
              index: libraryBrowseOffset
            })
          : Promise.resolve({ hits: [], total_hits: 0, error: 'CurseForge provider does not support this content type yet.' }))
      : Promise.resolve(null);

    const [mr, cf] = await Promise.all([modrinthPromise.catch((e) => ({ hits: [], total_hits: 0, error: e?.message || String(e) })), curseforgePromise.catch((e) => ({ hits: [], total_hits: 0, error: e?.message || String(e) }))]);

    if (libraryBrowseProvider === 'modrinth') data = mr;
    else if (libraryBrowseProvider === 'curseforge') data = cf;
    else {
      // Merge for "all"
      const mrHits = Array.isArray(mr?.hits) ? mr.hits.map((h) => ({ ...h, _provider: 'modrinth' })) : [];
      const cfHits = Array.isArray(cf?.hits) ? cf.hits.map((h) => ({ ...h, _provider: 'curseforge' })) : [];
      const hits = [...mrHits, ...cfHits];
      const total = (mr?.total_hits || 0) + (cf?.total_hits || 0);
      const err = [mr?.error, cf?.error].filter(Boolean).join(' · ');
      data = { hits, total_hits: total, ...(err ? { error: err } : {}) };
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

  const total = data.total_hits != null ? data.total_hits : (data.hits || []).length;

  // If CurseForge is selected/merged but missing a key, show a prominent setup hint.
  const errText = String(data?.error || '').toLowerCase();
  const cfKeyMissing =
    (libraryBrowseProvider === 'curseforge' || libraryBrowseProvider === 'all') &&
    (errText.includes('curseforge api key not set') || errText.includes('api key not set') || errText.includes('cf_no_key'));
  if (cfKeyMissing) {
    const show = async () => {
      const has = await window.zenon.curseforgeHasKey?.().catch(() => null);
      const canSet = !!has?.available;
      const msg =
        canSet
          ? 'CurseForge is enabled, but your API key is not set on this PC.'
          : 'CurseForge key storage is unavailable on this PC. Use the CURSEFORGE_API_KEY environment variable.';
      const hint = `
        <div class="home-tip" style="margin-bottom:12px">
          <div class="home-tip-title">CurseForge disabled</div>
          <div class="home-tip-desc">${escapeHtml(msg)}</div>
          <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" class="btn btn-primary btn-sm" id="cf-browse-set-key" ${canSet ? '' : 'disabled'}>Set key</button>
            <button type="button" class="btn btn-ghost btn-sm" id="cf-browse-open-settings">Open Settings</button>
          </div>
        </div>
      `;
      resultsEl.innerHTML = hint + resultsEl.innerHTML;
      document.getElementById('cf-browse-open-settings')?.addEventListener('click', () => {
        closeModal('modal-library-browse');
        navigateTo('settings', { force: true });
        window.__settingsTab = 'launcher';
        setTimeout(() => {
          try { renderSettings(); } catch (e) {}
        }, 80);
      });
      document.getElementById('cf-browse-set-key')?.addEventListener('click', async () => {
        try {
          const key = prompt('Paste your CurseForge API key');
          if (!key) return;
          const r = await window.zenon.curseforgeSetKey?.(key);
          if (!r?.success) throw new Error(r?.error || 'Could not save key');
          showToast('CurseForge key saved (encrypted)', 'success', 2200);
          runLibraryBrowseSearch(libraryBrowseOffset);
        } catch (e) {
          showToast(e?.message || 'Could not save key', 'error', 3500);
        }
      });
    };
    try { await show(); } catch (e) {}
  }

  if (!data.hits || data.hits.length === 0) {
    if (pagerEl) {
      pagerEl.style.display = 'none';
      pagerEl.innerHTML = '';
    }
    const extra = data?.error ? ` <span style="color:var(--text-muted)">${escapeHtml(String(data.error).slice(0, 160))}</span>` : '';
    resultsEl.innerHTML = `<div class="empty-inline discovery-hint">No hits — try other keywords.${extra}</div>`;
    return;
  }

  resultsEl.innerHTML = `<div class="discovery-grid">${data.hits
    .map((mod) => {
      const initial = (mod.title || '?').charAt(0);
      const iconBlock = mod.icon_url
        ? `<img class="discovery-card-icon" src="${escapeHtml(mod.icon_url)}" alt="" onerror="this.outerHTML='<div class=\\'discovery-card-icon-ph\\'>${escapeHtml(initial)}</div>'">`
        : `<div class="discovery-card-icon-ph">${escapeHtml(initial)}</div>`;
      const providerChip =
        mod._provider === 'curseforge'
          ? `<span class="home-panel-chip" style="margin-left:8px">CurseForge</span>`
          : mod._provider === 'modrinth'
            ? `<span class="home-panel-chip" style="margin-left:8px">Modrinth</span>`
            : '';
      return `
    <article class="discovery-card glow-card">
      <div class="discovery-card-top">
        ${iconBlock}
        <div class="discovery-card-text">
          <h3 class="discovery-card-title">${escapeHtml(mod.title)} ${providerChip}</h3>
          <p class="discovery-card-author">${escapeHtml(mod.author || '')}</p>
        </div>
      </div>
      <p class="discovery-card-desc">${escapeHtml((mod.description || '').slice(0, 140))}${(mod.description || '').length > 140 ? '…' : ''}</p>
      <button type="button" class="btn btn-primary btn-sm library-browse-install" data-id="${mod.project_id}" data-title="${escapeHtml(mod.title)}" data-icon="${escapeHtml(mod.icon_url || '')}" data-author="${escapeHtml(mod.author || '')}">Install</button>
    </article>`;
    })
    .join('')}</div>`;

  renderLibraryBrowsePager(total, libraryBrowseOffset, LIBRARY_BROWSE_PAGE_SIZE);

  resultsEl.querySelectorAll('.library-browse-install').forEach((btn) => {
    btn.addEventListener('click', () => {
      const vo = def.versionOpts(inst);
      try {
        window.zenonActivity?.add?.(`Install queued: ${btn.dataset.title || 'Project'} → ${inst.name}`, 'info');
      } catch (e) {}
      if (libraryBrowseProvider === 'curseforge' || (libraryBrowseProvider === 'all' && String(btn.dataset.id || '').startsWith('cf:'))) {
        zenonOpenCurseforgeInstallModal(btn.dataset.id, btn.dataset.title, inst, def.projectType, { iconUrl: btn.dataset.icon || '', author: btn.dataset.author || '' });
      } else {
        zenonOpenInstallModal(btn.dataset.id, btn.dataset.title, libraryBrowseModalKind, vo, { iconUrl: btn.dataset.icon || '', author: btn.dataset.author || '' });
      }
    });
  });
}

function openLibraryBrowseModal() {
  const inst = State.selectedInstance;
  if (!inst || State.libraryPane !== 'content') return;

  libraryBrowseModalKind = libraryContentKind;
  renderLibraryBrowseProviderPills();
  updateLibraryBrowseModalChrome(inst);
  renderLibraryBrowseKindPills();

  const providerPills = document.getElementById('library-browse-provider-pills');
  if (providerPills) {
    providerPills.onclick = (e) => {
      const pill = e.target.closest('[data-browse-provider]');
      if (!pill) return;
      const next = pill.getAttribute('data-browse-provider') || '';
      if (!next || next === libraryBrowseProvider) return;
      libraryBrowseProvider = next;
      renderLibraryBrowseProviderPills();
      updateLibraryBrowseModalChrome(inst);
      libraryBrowseOffset = 0;
      runLibraryBrowseSearch(0);
    };
  }

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
    return `<div class="empty-inline id-table-empty">Nothing installed yet. Use <strong>Browse &amp; install</strong> to add from Modrinth.</div>`;
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
    ? `<img class="discovery-card-icon" src="${escapeHtml(mod.iconUrl)}" alt="" onerror="this.outerHTML='<div class=\\'discovery-card-icon-ph\\'>${escapeHtml(initial)}</div>'">`
    : `<div class="discovery-card-icon-ph">${escapeHtml(initial)}</div>`;

  const maker = String(mod.author || '').trim() || 'Unknown';
  const file = String(mod.filename || '').trim();
  const fileLine = file ? `${file}${mod.size ? ` \u2022 ${formatBytes(mod.size)}` : ''}` : (mod.size ? formatBytes(mod.size) : '');
  return `
    <article class="discovery-card glow-card ${mod.enabled ? '': 'disabled'}" data-filename="${escapeHtml(mod.filename)}">
      <div class="discovery-card-top">
        ${iconBlock}
        <div class="discovery-card-text">
          <h3 class="discovery-card-title">${escapeHtml(rawTitle)}</h3>
          <p class="discovery-card-author">${escapeHtml(maker)}</p>
        </div>
      </div>
      <p class="discovery-card-desc">${escapeHtml(fileLine)}</p>
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
  const body = document.getElementById('library-installed-body');
  if (body) body.innerHTML = renderInstalledRows(filtered);
  attachLibraryInstalledHandlers();
}

async function onLibraryInstalledClick(e) {
  const action = e.target.closest('[data-action]');
  if (!action) return;
  const filename = action.dataset.filename;
  const inst = State.selectedInstance;
  if (!inst || !filename) return;

  if (action.dataset.action === 'toggle') {
    const card = action.closest('.discovery-card');
    const toggleBtn = action.closest('.mod-toggle') || card?.querySelector?.('.mod-toggle');
    const delBtn = card?.querySelector?.('[data-action="delete-mod"]');
    try {
      card?.classList?.remove('mod-anim-pulse');
      // restart animation
      void card?.offsetWidth;
      card?.classList?.add('mod-anim-pulse');
    } catch (e2) {}
    if (toggleBtn) toggleBtn.disabled = true;
    if (delBtn) delBtn.disabled = true;
    try {
      await window.zenon.toggleContent(inst.id, libraryContentKind, filename);
      // Update UI in-place (no full rerender)
      const nowOn = toggleBtn ? !toggleBtn.classList.contains('on') : !filename.endsWith('.disabled');
      if (toggleBtn) toggleBtn.classList.toggle('on', nowOn);
      if (card) card.classList.toggle('disabled', !nowOn);
      // Refresh data silently (keeps layout stable)
      setTimeout(() => refreshLibraryInstalledTableOnly().catch(() => {}), 120);
    } catch (err) {
      showToast(err?.message || 'Toggle failed', 'error', 3500);
    } finally {
      if (toggleBtn) toggleBtn.disabled = false;
      if (delBtn) delBtn.disabled = false;
    }
  }
  if (action.dataset.action === 'delete-mod') {
    if (!confirm(`Remove ${filename.replace('.disabled', '')}?`)) return;
    const card = action.closest('.discovery-card');
    const toggleBtn = card?.querySelector?.('.mod-toggle');
    const delBtn = action;
    if (toggleBtn) toggleBtn.disabled = true;
    if (delBtn) delBtn.disabled = true;
    try {
      // Animate immediately, then finalize on success
      if (card) {
        card.classList.add('mod-anim-leave');
      }
      await window.zenon.deleteContent(inst.id, libraryContentKind, filename);
      showToast('Removed', 'info');
      // Remove the element after animation
      setTimeout(() => {
        try { card?.remove?.(); } catch (e2) {}
      }, 180);
      // Also refresh list to keep counts/search accurate (no full page flash)
      setTimeout(() => refreshLibraryInstalledTableOnly().catch(() => {}), 220);
    } catch (err) {
      // Roll back animation if it failed
      if (card) card.classList.remove('mod-anim-leave');
      showToast(err?.message || 'Delete failed', 'error', 4500);
    } finally {
      if (toggleBtn) toggleBtn.disabled = false;
      if (delBtn) delBtn.disabled = false;
    }
  }
}

function attachLibraryInstalledHandlers() {
  const el = document.getElementById('library-installed-body');
  if (!el) return;
  el.removeEventListener('click', onLibraryInstalledClick);
  el.addEventListener('click', onLibraryInstalledClick);
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

  const mcVersion =
    mcVersionOverride != null && String(mcVersionOverride).trim() !== ''
      ? String(mcVersionOverride).trim()
      : inst?.version || '';
  const opts = { projectId, mcVersion };
  if (versionQuery?.loaders?.length) opts.loaders = versionQuery.loaders;
  else if (versionQuery?.loader) opts.loader = versionQuery.loader;
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

  // Default from settings: auto-install required dependencies for mods.
  if (!document.getElementById('mod-auto-deps-row')) {
    const hint = document.createElement('div');
    hint.id = 'mod-auto-deps-row';
    hint.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:rgba(255,255,255,0.03)';
    hint.innerHTML = `
      <div style="min-width:0">
        <div style="font-weight:700;font-size:12px">Auto-install dependencies</div>
        <div style="color:var(--text-muted);font-size:11px;margin-top:2px">Installs required deps from Modrinth if missing.</div>
      </div>
      <div class="toggle-switch ${State.settings?.autoInstallDependencies === false ? '' : 'on'}" id="mod-auto-deps-toggle" style="flex-shrink:0"></div>
    `;
    container.prepend(hint);
    hint.querySelector('#mod-auto-deps-toggle')?.addEventListener('click', (e) => {
      e.currentTarget.classList.toggle('on');
    });
  }

  async function installRequiredDepsIfMissing(versionData) {
    if (!inst || contentKind !== 'mod') return;
    const toggle = document.getElementById('mod-auto-deps-toggle');
    if (!toggle?.classList.contains('on')) return;

    const deps = Array.isArray(versionData?.dependencies) ? versionData.dependencies : [];
    const required = deps
      .filter((d) => d && d.project_id && String(d.dependency_type || '').toLowerCase() === 'required')
      .map((d) => String(d.project_id))
      .filter(Boolean);
    if (!required.length) return;

    const installed = await window.zenon.getContent(inst.id, 'mod').catch(() => []);
    const installedIds = new Set((installed || []).map((m) => String(m.projectId || '')).filter(Boolean));
    const missing = required.filter((id) => !installedIds.has(id));
    if (!missing.length) return;

    showToast(`Installing ${missing.length} dependencies…`, 'info', 2000);
    for (const depProjectId of missing) {
      try {
        const vers = await window.zenon.getProjectVersions({ projectId: depProjectId, mcVersion: inst.version, loader: inst.loader });
        if (!Array.isArray(vers) || !vers.length) continue;
        const v0 = vers[0];
        const res = await window.zenon.downloadContent(inst.id, 'mod', v0, { projectId: depProjectId, title: v0.name || 'Dependency', iconUrl: null, author: null });
        if (res?.success) {
          window.zenonActivity?.add?.(`Installed dependency: ${v0.name || depProjectId} → ${inst.name}`, 'success');
        }
      } catch (e) {}
    }
  }

  container.querySelectorAll('[data-action="do-download"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const verIdx = parseInt(btn.dataset.verIdx, 10);
      const versionData = top[verIdx];
      btn.disabled = true;
      btn.textContent = 'Downloading...';
      let result;
      if (modpackAsNewInstance) {
        result = await window.zenon.createInstanceFromMrpack({ versionData, displayName: title, iconUrl: iconUrl || '' });
      } else {
        result = await window.zenon.downloadContent(inst.id, contentKind, versionData, {
          projectId,
          title,
          iconUrl: iconUrl || null,
          author: author || null
        });
      }
      if (result.success) {
        try {
          if (!modpackAsNewInstance) await installRequiredDepsIfMissing(versionData);
        } catch (e) {}
        showToast(modpackAsNewInstance ? `${title} — new instance created` : `${title} installed`, 'success');
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
          await navigateTo('library', { force: true });
          return;
        }
        if (State.currentPage === 'library') {
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
        showToast(`Download failed: ${result.error}`, 'error');
        btn.disabled = false;
        btn.textContent = 'Download';
      }
    });
  });

  document.getElementById('mod-modal-close-btn').onclick = () => closeModal('modal-mod-download');
}

async function zenonOpenCurseforgeInstallModal(projectId, title, inst, projectType, meta = {}) {
  if (!inst) {
    showToast('Select an instance first', 'error');
    return;
  }
  if (!projectId || !String(projectId).startsWith('cf:')) {
    showToast('Invalid CurseForge project id', 'error');
    return;
  }
  const modId = parseInt(String(projectId).slice(3), 10);
  if (!Number.isFinite(modId) || modId <= 0) {
    showToast('Invalid CurseForge mod id', 'error');
    return;
  }

  const kindLabel = projectType === 'modpack' ? 'Modpack' : 'Mod';
  document.getElementById('mod-download-title').textContent = `Install (CurseForge ${kindLabel}): ${title}`;
  document.getElementById('mod-versions-list').innerHTML = '<div class="loading-spinner"></div>';
  openModal('modal-mod-download');

  const filesRes = await window.zenon.curseforgeGetFiles?.({
    modId,
    mcVersion: inst.version,
    loader: inst.loader,
    pageSize: 20,
    index: 0
  });
  const container = document.getElementById('mod-versions-list');

  if (!filesRes?.success || !Array.isArray(filesRes.files) || filesRes.files.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:24px">
        <h3>No compatible files</h3>
        <p>${escapeHtml(filesRes?.error || 'Try another Minecraft version or provider.')}</p>
      </div>
    `;
    document.getElementById('mod-modal-close-btn').onclick = () => closeModal('modal-mod-download');
    return;
  }

  const top = filesRes.files.slice(0, 14);
  container.innerHTML = top
    .map(
      (f, idx) => `
    <div class="version-item">
      <div class="version-info">
        <h4>${escapeHtml(f.displayName || f.fileName || `File ${f.fileId}`)}</h4>
        <div class="version-tags">
          ${(f.gameVersions || []).slice(0, 4).map((v) => `<span class="tag tag-version">${escapeHtml(v)}</span>`).join('')}
        </div>
      </div>
      <button type="button" class="btn btn-primary btn-sm" data-action="do-cf-download" data-ver-idx="${idx}">
        Download
      </button>
    </div>
  `
    )
    .join('');

  container.querySelectorAll('[data-action="do-cf-download"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.getAttribute('data-ver-idx') || '0', 10) || 0;
      const file = top[idx];
      if (!file) return;
      btn.disabled = true;
      btn.textContent = 'Downloading...';
      try {
        const r = await window.zenon.curseforgeDownloadFile?.({
          instanceId: inst.id,
          modId,
          fileId: file.fileId,
          kind:
            projectType === 'modpack'
              ? 'modpack'
              : projectType === 'resourcepack'
                ? 'resourcepack'
                : projectType === 'datapack'
                  ? 'datapack'
                  : 'mod',
          meta: { title, author: meta.author || '', iconUrl: meta.iconUrl || '' }
        });
        if (!r?.success) throw new Error(r?.error || 'Download failed');
        if (projectType === 'modpack') {
          showToast(`Downloaded modpack: ${r.filename || 'modpack.zip'} (saved in modpacks/)`, 'success', 3500);
        } else {
          showToast(`Installed: ${r.filename || 'mod.jar'}`, 'success', 2200);
        }
        closeModal('modal-mod-download');
        if (State.currentPage === 'library') {
          State.libraryPane = 'content';
          await renderLibrary();
        }
      } catch (e) {
        showToast(e?.message || 'Download failed', 'error', 4000);
        btn.disabled = false;
        btn.textContent = 'Download';
      }
    });
  });

  document.getElementById('mod-modal-close-btn').onclick = () => closeModal('modal-mod-download');
}
