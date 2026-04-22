// ===== Instance Library (installed content + detail layout) =====
let libraryContentKind = 'mod';
let librarySearchFilter = '';
let libraryBrowseQuery = '';
let libraryBrowseTimer = null;
let libraryBrowseOffset = 0;
/** Active category while the Modrinth browse modal is open (synced to the library tab on close). */
let libraryBrowseModalKind = 'mod';
const LIBRARY_BROWSE_PAGE_SIZE = 18;
let __libraryRenderSeq = 0;

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
  if (input) input.placeholder = browseSearchPlaceholder(kind);
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
    paneBody = `
      <div class="id-logs-toolbar">
        <button type="button" class="btn btn-ghost btn-sm" id="library-log-refresh">Refresh</button>
      </div>
      <pre class="id-log-pre" id="library-log-pre">${escapeHtml(log.text || '')}</pre>
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
              ${
                State.runningInstanceId && State.runningInstanceId === inst.id
                  ? `<button type="button" class="btn btn-danger id-play-btn" data-action="stop" data-id="${inst.id}">
                      <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                      Stop
                    </button>`
                  : `<button type="button" class="btn btn-play id-play-btn" data-action="play" data-id="${inst.id}">
                      <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                      Play
                    </button>`
              }
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

  document.querySelector('[data-action="play"]')?.addEventListener('click', (e) => {
    const id = e.currentTarget.getAttribute('data-id');
    if (id) launchInstance(id);
  });
  document.querySelector('[data-action="stop"]')?.addEventListener('click', async () => {
    const r = await window.zenon.stopGame();
    if (!r?.success) showToast(r?.error || 'Stop failed', 'error');
    else showToast('Stopping game…', 'info');
  });

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

  const data = await window.zenon.searchModrinth({
    query: libraryBrowseQuery,
    version: inst.version,
    loader,
    projectType: def.projectType,
    limit: LIBRARY_BROWSE_PAGE_SIZE,
    offset: libraryBrowseOffset
  });

  const total = data.total_hits != null ? data.total_hits : (data.hits || []).length;

  if (!data.hits || data.hits.length === 0) {
    if (pagerEl) {
      pagerEl.style.display = 'none';
      pagerEl.innerHTML = '';
    }
    resultsEl.innerHTML = '<div class="empty-inline discovery-hint">No hits — try other keywords.</div>';
    return;
  }

  resultsEl.innerHTML = `<div class="library-browse-grid">${data.hits
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
    await window.zenon.toggleContent(inst.id, libraryContentKind, filename);
    await renderLibrary();
  }
  if (action.dataset.action === 'delete-mod') {
    if (!confirm(`Remove ${filename.replace('.disabled', '')}?`)) return;
    await window.zenon.deleteContent(inst.id, libraryContentKind, filename);
    showToast('Removed', 'info');
    // Keep user anchored on Library after delete.
    await navigateTo('library', { force: true });
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
