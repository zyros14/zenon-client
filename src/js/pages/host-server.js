// ===== Host a server (vanilla / Paper / Forge / Fabric) + in-app console & players =====
let hostServerKind = 'vanilla';
let hostConsoleServerId = null;
let hostConsoleKind = 'mod';
let serverBrowseQuery = '';
let serverBrowseOffset = 0;
let serverBrowseTimer = null;
let serverBrowseCfg = null;
let serverBrowseServerId = null;
let serverBrowseSeq = 0;
const SERVER_BROWSE_PAGE_SIZE = 20;
let __hostServerGen = 0;
let __hostServerUnsubs = [];

function clearHostServerSubs() {
  __hostServerUnsubs.forEach((u) => {
    try {
      u();
    } catch (e) {}
  });
  __hostServerUnsubs = [];
}

/** Called when leaving the Host a server page — invalidates IPC listeners. */
function abandonHostServerConsole() {
  __hostServerGen += 1;
  hostConsoleServerId = null;
  clearHostServerSubs();
  const panel = document.getElementById('host-server-console-panel');
  if (panel) panel.style.display = 'none';
}

window.__abandonHostServerConsole = abandonHostServerConsole;

function closeHostConsolePanel() {
  hostConsoleServerId = null;
  const panel = document.getElementById('host-server-console-panel');
  if (panel) panel.style.display = 'none';
}

function appendHostConsoleLine(text) {
  const pre = document.getElementById('host-console-log');
  if (!pre) return;
  pre.textContent += (pre.textContent ? '\n' : '') + text;
  pre.scrollTop = pre.scrollHeight;
}

function setHostPlayerLists(active, inactive) {
  const aEl = document.getElementById('host-players-active');
  const iEl = document.getElementById('host-players-inactive');
  if (aEl) {
    aEl.innerHTML = (active && active.length
      ? active.map((n) => `<li>${escapeHtml(n)}</li>`).join('')
      : '<li class="host-players-empty">No one online</li>');
  }
  if (iEl) {
    iEl.innerHTML = (inactive && inactive.length
      ? inactive.map((n) => `<li>${escapeHtml(n)}</li>`).join('')
      : '<li class="host-players-empty">—</li>');
  }
}

function updateHostConsoleRunningUI(running) {
  const st = document.getElementById('host-console-status');
  const start = document.getElementById('host-server-start');
  const stop = document.getElementById('host-server-stop');
  if (st) st.textContent = running ? 'Running' : 'Stopped';
  if (start) start.disabled = !!running;
  if (stop) stop.disabled = !running;
}

async function syncHostConsoleFromMain(serverId) {
  if (!serverId || !window.zenon.serverStatus) return;
  const s = await window.zenon.serverStatus(serverId);
  updateHostConsoleRunningUI(!!s.running);
  setHostPlayerLists(s.active || [], s.inactive || []);
  const start = document.getElementById('host-server-start');
  if (start) start.textContent = s?.eulaAccepted ? 'Start server' : 'Accept EULA & start';
}

async function openHostConsolePanel(serverId, serverName) {
  hostConsoleServerId = serverId;
  hostConsoleKind = 'mod';
  const panel = document.getElementById('host-server-console-panel');
  const title = document.getElementById('host-console-title');
  const pre = document.getElementById('host-console-log');
  if (!panel || !pre) return;
  if (title) title.textContent = serverName || 'Server';
  pre.textContent = '';
  panel.style.display = 'block';

  if (window.zenon.serverConsoleBuffer) {
    const buf = await window.zenon.serverConsoleBuffer(serverId);
    const lines = buf?.lines || [];
    pre.textContent = lines.length ? lines.join('\n') : '(no output yet — start the server)';
    pre.scrollTop = pre.scrollHeight;
  }
  await syncHostConsoleFromMain(serverId);
  await refreshHostServerContentPanel();
}

function serverContentKindsForServer(cfg) {
  const kind = String(cfg?.serverKind || '').toLowerCase();
  if (kind === 'paper') return [{ kind: 'plugin', label: 'Plugins', projectType: 'plugin', loader: 'paper' }];
  if (kind === 'fabric') return [{ kind: 'mod', label: 'Mods', projectType: 'mod', loader: 'fabric' }];
  if (kind === 'forge') return [{ kind: 'mod', label: 'Mods', projectType: 'mod', loader: 'forge' }];
  return [];
}

async function refreshHostServerContentPanel() {
  const wrap = document.getElementById('host-content-wrap');
  if (!wrap || !hostConsoleServerId || !window.zenon.serverGetContent) return;
  const servers = await window.zenon.listServers();
  const cfg = (servers || []).find((s) => s.id === hostConsoleServerId) || null;
  const kinds = serverContentKindsForServer(cfg);
  if (!kinds.length) {
    wrap.innerHTML = '<div class="empty-inline discovery-hint">This server type does not support in-app plugins/mods yet.</div>';
    return;
  }

  if (!kinds.some((k) => k.kind === hostConsoleKind)) hostConsoleKind = kinds[0].kind;

  const pills = kinds
    .map((k) => `<button type="button" class="id-pill ${k.kind === hostConsoleKind ? 'active' : ''}" data-skind="${escapeHtml(k.kind)}">${escapeHtml(k.label)}</button>`)
    .join('');

  const items = await window.zenon.serverGetContent(hostConsoleServerId, hostConsoleKind);
  const cards = (items || []).length
    ? `<div class="discovery-grid">${(items || []).map(renderHostServerContentCard).join('')}</div>`
    : `<div class="empty-inline id-table-empty">Nothing installed yet. Use <strong>Browse &amp; install</strong>.</div>`;

  wrap.innerHTML = `
    <div class="id-content-toolbar library-content-toolbar-row" style="margin-top:12px">
      <div class="id-kind-pills" id="host-content-kind-pills">${pills}</div>
      <button type="button" class="btn btn-primary btn-browse-install" id="host-content-browse-btn" title="Search Modrinth scoped to this server">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Browse &amp; install
      </button>
    </div>
    <div id="host-content-list">${cards}</div>
  `;

  document.getElementById('host-content-kind-pills')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-skind]');
    if (!b) return;
    hostConsoleKind = b.getAttribute('data-skind');
    await refreshHostServerContentPanel();
  });

  document.getElementById('host-content-browse-btn')?.addEventListener('click', async () => {
    try {
      await openHostServerBrowseModal(cfg);
    } catch (e) {
      showToast(e?.message || 'Browse failed', 'error');
    }
  });

  document.getElementById('host-content-list')?.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-action]');
    if (!act) return;
    const filename = act.getAttribute('data-filename') || '';
    if (!filename) return;
    if (act.dataset.action === 'toggle') {
      await window.zenon.serverToggleContent(hostConsoleServerId, hostConsoleKind, filename);
      await refreshHostServerContentPanel();
    }
    if (act.dataset.action === 'delete') {
      if (!confirm(`Remove ${filename.replace('.disabled', '')}?`)) return;
      await window.zenon.serverDeleteContent(hostConsoleServerId, hostConsoleKind, filename);
      showToast('Removed', 'info');
      await refreshHostServerContentPanel();
    }
  });
}

function renderHostServerContentCard(mod) {
  const rawTitle = String(mod.title || '').trim() || String(mod.displayName || '').trim() || String(mod.filename || '').trim() || 'Project';
  const initial = rawTitle.charAt(0) || '?';
  const iconBlock = mod.iconUrl
    ? `<img class="discovery-card-icon" src="${escapeHtml(mod.iconUrl)}" alt="" onerror="this.outerHTML='<div class=\\'discovery-card-icon-ph\\'>${escapeHtml(initial)}</div>'">`
    : `<div class="discovery-card-icon-ph">${escapeHtml(initial)}</div>`;
  const maker = String(mod.author || '').trim() || 'Unknown';
  const file = String(mod.filename || '').trim();
  const fileLine = file ? `${file}${mod.size ? ` \u2022 ${formatBytes(mod.size)}` : ''}` : (mod.size ? formatBytes(mod.size) : '');
  return `
    <article class="discovery-card glow-card ${mod.enabled ? '' : 'disabled'}">
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
        <button type="button" class="btn btn-danger btn-sm btn-icon" data-action="delete" data-filename="${escapeHtml(mod.filename)}" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    </article>
  `;
}

function hostServerBrowseDef(cfg) {
  const kinds = serverContentKindsForServer(cfg);
  return kinds.find((k) => k.kind === hostConsoleKind) || kinds[0];
}

async function openHostServerBrowseModal(cfg) {
  const def = hostServerBrowseDef(cfg);
  const serverId = hostConsoleServerId;
  if (!def || !serverId || !cfg) {
    showToast('Open a server console first', 'error');
    return;
  }
  serverBrowseCfg = cfg;
  serverBrowseServerId = serverId;
  serverBrowseOffset = 0;

  // Header + locked filters
  const titleEl = document.getElementById('server-browse-modal-title');
  const hintEl = document.getElementById('server-browse-modal-hint');
  if (titleEl) titleEl.textContent = 'Browse & install';
  if (hintEl) {
    const src = String(cfg.serverKind || '').toLowerCase() === 'paper' ? 'Spigot (plugins)' : 'Modrinth (server mods)';
    hintEl.textContent = `Search is locked to this server’s Minecraft version and platform. Source: ${src}.`;
  }
  const locked = document.getElementById('server-browse-locked');
  if (locked) {
    locked.innerHTML = `
      <span class="tag tag-version">${escapeHtml(cfg.version || '')}</span>
      <span class="tag tag-fabric">${escapeHtml(String(cfg.serverKind || 'server'))}</span>
    `;
  }

  renderServerBrowseKindPills(cfg);

  const input = document.getElementById('server-browse-search-input');
  if (input) {
    input.value = serverBrowseQuery;
    input.oninput = () => {
      serverBrowseQuery = input.value;
      serverBrowseOffset = 0;
      clearTimeout(serverBrowseTimer);
      serverBrowseTimer = setTimeout(() => {
        runServerBrowseSearch(0).catch((e) => showToast(e?.message || 'Search failed', 'error'));
      }, 420);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        serverBrowseQuery = input.value;
        serverBrowseOffset = 0;
        clearTimeout(serverBrowseTimer);
        runServerBrowseSearch(0).catch((e2) => showToast(e2?.message || 'Search failed', 'error'));
      }
    };
  }

  document.getElementById('server-browse-close-btn').onclick = () => closeModal('modal-server-browse');
  openModal('modal-server-browse');
  setTimeout(() => document.getElementById('server-browse-search-input')?.focus(), 50);
  runServerBrowseSearch(0);
}

function renderServerBrowseKindPills(cfg) {
  const el = document.getElementById('server-browse-kind-pills');
  if (!el) return;
  const kinds = serverContentKindsForServer(cfg);
  if (!kinds.length) {
    el.innerHTML = '';
    return;
  }
  if (!kinds.some((k) => k.kind === hostConsoleKind)) hostConsoleKind = kinds[0].kind;
  el.innerHTML = kinds
    .map((k) => `<button type="button" class="id-pill ${k.kind === hostConsoleKind ? 'active' : ''}" data-browse-skind="${escapeHtml(k.kind)}">${escapeHtml(k.label)}</button>`)
    .join('');
  el.onclick = (e) => {
    const pill = e.target.closest('[data-browse-skind]');
    if (!pill) return;
    const next = pill.getAttribute('data-browse-skind');
    if (!next || next === hostConsoleKind) return;
    hostConsoleKind = next;
    serverBrowseOffset = 0;
    renderServerBrowseKindPills(cfg);
    runServerBrowseSearch(0);
  };
}

function renderServerBrowsePager(totalHits, offset, limit) {
  const el = document.getElementById('server-browse-pager');
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
    <button type="button" class="btn btn-ghost btn-sm" id="server-browse-prev" ${canPrev ? '' : 'disabled'}>Previous</button>
    <span class="discovery-pager-meta">${start}–${end} of ${total}</span>
    <button type="button" class="btn btn-ghost btn-sm" id="server-browse-next" ${canNext ? '' : 'disabled'}>Next</button>
  `;
  document.getElementById('server-browse-prev')?.addEventListener('click', () => {
    serverBrowseOffset = Math.max(0, serverBrowseOffset - limit);
    runServerBrowseSearch(serverBrowseOffset);
  });
  document.getElementById('server-browse-next')?.addEventListener('click', () => {
    serverBrowseOffset += limit;
    runServerBrowseSearch(serverBrowseOffset);
  });
}

async function runServerBrowseSearch(offset) {
  const resultsEl = document.getElementById('server-browse-results');
  try {
    const cfg = serverBrowseCfg;
    const serverId = serverBrowseServerId;
    const modal = document.getElementById('modal-server-browse');
    if (!resultsEl || !cfg || !serverId || !modal?.classList.contains('show')) return;

    if (typeof offset === 'number') serverBrowseOffset = offset;
    const seq = ++serverBrowseSeq;

    const def = hostServerBrowseDef(cfg);
    resultsEl.innerHTML = '<div class="loading-spinner"></div>';
    const pagerEl = document.getElementById('server-browse-pager');
    if (pagerEl) pagerEl.style.display = 'none';

    const isPaperPlugins = String(cfg?.serverKind || '').toLowerCase() === 'paper' && def.kind === 'plugin';
    const q = String(serverBrowseQuery || '').trim();

    // ===== Paper plugins (Spiget) =====
    if (isPaperPlugins) {
      if (!window.zenon.spigetSearch) {
        resultsEl.innerHTML = '<div class="empty-inline discovery-hint">Restart the app to enable Spigot plugin search.</div>';
        return;
      }
      const page = Math.max(1, Math.floor(serverBrowseOffset / SERVER_BROWSE_PAGE_SIZE) + 1);
      const rows = await window.zenon.spigetSearch({
        query: q || ' ',
        size: SERVER_BROWSE_PAGE_SIZE,
        page,
        mode: q ? 'search' : 'new'
      });
      if (seq !== serverBrowseSeq) return;
      const hits = Array.isArray(rows) ? rows : [];
      if (!hits.length) {
        resultsEl.innerHTML = '<div class="empty-inline discovery-hint">No results — try another keyword.</div>';
        return;
      }

      resultsEl.innerHTML = `<div class="discovery-grid">${hits
        .map((p) => {
          const initial = (p.name || '?').charAt(0);
          const iconUrl = p.icon?.url ? `https://www.spigotmc.org/${String(p.icon.url).replace(/^\/+/, '')}` : '';
          const iconBlock = iconUrl
            ? `<img class="discovery-card-icon" src="${escapeHtml(iconUrl)}" alt="" onerror="this.outerHTML='<div class=\\'discovery-card-icon-ph\\'>${escapeHtml(initial)}</div>'">`
            : `<div class="discovery-card-icon-ph">${escapeHtml(initial)}</div>`;
          return `
            <article class="discovery-card glow-card">
              <div class="discovery-card-top">
                ${iconBlock}
                <div class="discovery-card-text">
                  <h3 class="discovery-card-title">${escapeHtml(p.name || 'Plugin')}</h3>
                  <p class="discovery-card-author">${escapeHtml(p.author?.name || 'Unknown')}</p>
                </div>
              </div>
              <p class="discovery-card-desc">${escapeHtml((p.tag || '').slice(0, 140))}</p>
              <button type="button" class="btn btn-primary btn-sm" data-action="server-plugin-install" data-rid="${escapeHtml(String(p.id || ''))}">Install</button>
            </article>
          `;
        })
        .join('')}</div>`;

      // Simple pager (Spiget doesn't reliably expose total)
      if (pagerEl) {
        pagerEl.style.display = 'flex';
        pagerEl.innerHTML = `
          <button type="button" class="btn btn-ghost btn-sm" id="server-browse-prev" ${page > 1 ? '' : 'disabled'}>Previous</button>
          <span class="discovery-pager-meta">${q ? 'Search' : 'New plugins'} · Page ${page}</span>
          <button type="button" class="btn btn-ghost btn-sm" id="server-browse-next">Next</button>
        `;
        document.getElementById('server-browse-prev')?.addEventListener('click', () => {
          serverBrowseOffset = Math.max(0, serverBrowseOffset - SERVER_BROWSE_PAGE_SIZE);
          runServerBrowseSearch(serverBrowseOffset);
        });
        document.getElementById('server-browse-next')?.addEventListener('click', () => {
          serverBrowseOffset += SERVER_BROWSE_PAGE_SIZE;
          runServerBrowseSearch(serverBrowseOffset);
        });
      }

      resultsEl.querySelectorAll('[data-action="server-plugin-install"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const rid = btn.getAttribute('data-rid');
          if (!rid || !window.zenon.spigetInstallPlugin) return;
          btn.disabled = true;
          btn.textContent = 'Installing…';
          const r = await window.zenon.spigetInstallPlugin(serverId, rid);
          if (r?.success) {
            showToast('Installed', 'success');
            await refreshHostServerContentPanel();
          } else {
            showToast(r?.error || 'Install failed', 'error');
            btn.disabled = false;
            btn.textContent = 'Install';
          }
        });
      });
      return;
    }

    // ===== Fabric/Forge server mods (Modrinth) =====
    if (!window.zenon.searchModrinth) {
      resultsEl.innerHTML = '<div class="empty-inline discovery-hint">Restart the app to enable Modrinth search.</div>';
      return;
    }
    if (typeof window.zenon.searchModrinth !== 'function') {
      resultsEl.innerHTML = '<div class="empty-inline discovery-hint">Modrinth search API is unavailable. Restart the app.</div>';
      return;
    }

    const data = await window.zenon.searchModrinth({
      query: q, // can be empty → shows default list
      version: cfg?.version || '',
      loader: def.loader || '',
      projectType: def.projectType || 'mod',
      limit: SERVER_BROWSE_PAGE_SIZE,
      offset: serverBrowseOffset
    });
    if (seq !== serverBrowseSeq) return;
    const hits = data?.hits || [];
    const total = data?.total_hits != null ? data.total_hits : hits.length;
    if (!hits.length) {
      const err = data?.error ? ` ${escapeHtml(String(data.error).slice(0, 220))}` : '';
      resultsEl.innerHTML = `<div class="empty-inline discovery-hint">No results — try another keyword.${err}</div>`;
      return;
    }

    resultsEl.innerHTML = `<div class="discovery-grid">${hits
      .map((m) => {
        const initial = (m.title || '?').charAt(0);
        const iconBlock = m.icon_url
          ? `<img class="discovery-card-icon" src="${escapeHtml(m.icon_url)}" alt="" onerror="this.outerHTML='<div class=\\'discovery-card-icon-ph\\'>${escapeHtml(initial)}</div>'">`
          : `<div class="discovery-card-icon-ph">${escapeHtml(initial)}</div>`;
        return `
          <article class="discovery-card glow-card">
            <div class="discovery-card-top">
              ${iconBlock}
              <div class="discovery-card-text">
                <h3 class="discovery-card-title">${escapeHtml(m.title)}</h3>
                <p class="discovery-card-author">${escapeHtml(m.author || 'Unknown')}</p>
              </div>
            </div>
            <p class="discovery-card-desc">${escapeHtml((m.description || '').slice(0, 140))}${(m.description || '').length > 140 ? '…' : ''}</p>
            <button type="button" class="btn btn-primary btn-sm" data-action="server-mod-install" data-id="${escapeHtml(m.project_id)}" data-title="${escapeHtml(m.title)}" data-icon="${escapeHtml(m.icon_url || '')}" data-author="${escapeHtml(m.author || '')}">
              Install
            </button>
          </article>
        `;
      })
      .join('')}</div>`;

    renderServerBrowsePager(total, serverBrowseOffset, SERVER_BROWSE_PAGE_SIZE);
    resultsEl.querySelectorAll('[data-action="server-mod-install"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const projectId = btn.getAttribute('data-id');
        if (!projectId) return;
        await openHostServerInstallModal(cfg, def.kind, {
          project_id: projectId,
          title: btn.getAttribute('data-title') || 'Project',
          icon_url: btn.getAttribute('data-icon') || '',
          author: btn.getAttribute('data-author') || ''
        });
      });
    });
  } catch (e) {
    const msg = e?.message || String(e) || 'Search failed';
    if (resultsEl) {
      resultsEl.innerHTML = `<div class="empty-inline discovery-hint">Search failed: ${escapeHtml(String(msg).slice(0, 260))}</div>`;
    }
    showToast(msg, 'error');
  }
}

async function openHostServerInstallModal(cfg, kind, hit) {
  const serverId = hostConsoleServerId;
  if (!serverId) return;
  document.getElementById('mod-download-title').textContent = `Install: ${hit.title}`;
  document.getElementById('mod-versions-list').innerHTML = '<div class="loading-spinner"></div>';
  openModal('modal-mod-download');

  const def = hostServerBrowseDef(cfg);
  const versions = await window.zenon.getProjectVersions({
    projectId: hit.project_id,
    mcVersion: cfg?.version || '',
    loader: def?.loader || ''
  });

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
      <button type="button" class="btn btn-primary btn-sm" data-action="do-server-download" data-ver-idx="${verIdx}">Download</button>
    </div>
  `
    )
    .join('');

  container.querySelectorAll('[data-action="do-server-download"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const verIdx = parseInt(btn.getAttribute('data-ver-idx'), 10);
      const versionData = top[verIdx];
      btn.disabled = true;
      btn.textContent = 'Downloading...';
      const result = await window.zenon.serverDownloadContent(serverId, kind, versionData, {
        projectId: hit.project_id,
        title: hit.title,
        iconUrl: hit.icon_url || null,
        author: hit.author || null
      });
      if (result?.success) {
        showToast(`${hit.title} installed`, 'success');
        closeModal('modal-mod-download');
        await refreshHostServerContentPanel();
      } else {
        showToast(`Download failed: ${result?.error || 'Unknown error'}`, 'error');
        btn.disabled = false;
        btn.textContent = 'Download';
      }
    });
  });

  document.getElementById('mod-modal-close-btn').onclick = () => closeModal('modal-mod-download');
}

function bindHostConsolePanelControls() {
  const send = () => {
    const input = document.getElementById('host-console-cmd');
    if (!input || !hostConsoleServerId) return;
    const cmd = input.value.trim();
    if (!cmd) return;
    window.zenon.serverSendCommand(hostConsoleServerId, cmd).then((r) => {
      if (!r?.success) showToast(r?.error || 'Send failed', 'error');
    });
    input.value = '';
  };

  document.getElementById('host-console-send')?.addEventListener('click', send);
  document.getElementById('host-console-cmd')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });

  document.getElementById('host-console-clear')?.addEventListener('click', () => {
    const pre = document.getElementById('host-console-log');
    if (pre) pre.textContent = '';
  });

  document.getElementById('host-server-start')?.addEventListener('click', async () => {
    if (!hostConsoleServerId) return;
    const r = await window.zenon.serverStart(hostConsoleServerId);
    if (r?.success) {
      showToast('Server starting…', 'info');
      await syncHostConsoleFromMain(hostConsoleServerId);
    } else {
      if (r?.needsEula) {
        const ok = confirm('Minecraft requires accepting the EULA before first launch.\n\nOpen https://aka.ms/MinecraftEULA and accept it.\n\nClick OK to set eula=true for this server now.');
        if (!ok) return;
        if (!window.zenon.serverAcceptEula) {
          showToast('Update applied — restart the app to accept EULA in-app.', 'error');
          return;
        }
        const wr = await window.zenon.serverAcceptEula(hostConsoleServerId);
        if (!wr?.success) {
          showToast(wr?.error || 'Could not write eula.txt', 'error');
          if (window.zenon.openServerFolder) window.zenon.openServerFolder(hostConsoleServerId);
          return;
        }
        // Verify it actually flipped (some AV/permissions can block writes).
        const st = await window.zenon.serverStatus(hostConsoleServerId);
        if (!st?.eulaAccepted) {
          showToast('Could not confirm EULA write — opening folder (set eula=true in eula.txt).', 'error');
          if (window.zenon.openServerFolder) window.zenon.openServerFolder(hostConsoleServerId);
          return;
        }
        showToast('EULA accepted (eula=true). Starting server…', 'success');
        const r2 = await window.zenon.serverStart(hostConsoleServerId);
        if (r2?.success) {
          await syncHostConsoleFromMain(hostConsoleServerId);
        } else showToast(r2?.error || 'Start failed', 'error');
        return;
      }
      showToast(r?.error || 'Start failed', 'error');
    }
  });

  document.getElementById('host-server-stop')?.addEventListener('click', async () => {
    if (!hostConsoleServerId) return;
    await window.zenon.serverStop(hostConsoleServerId);
    showToast('Stopping server…', 'info');
    await syncHostConsoleFromMain(hostConsoleServerId);
  });

  document.getElementById('host-players-refresh')?.addEventListener('click', () => {
    if (!hostConsoleServerId) return;
    window.zenon.serverSendCommand(hostConsoleServerId, 'list');
  });

  document.getElementById('host-console-close-panel')?.addEventListener('click', () => {
    closeHostConsolePanel();
  });
}

async function refreshHostServersList() {
  const listEl = document.getElementById('host-servers-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="loading-spinner"></div>';
  const servers = await window.zenon.listServers();
  if (!servers.length) {
    listEl.innerHTML = '<div class="empty-inline discovery-hint">No servers yet — create one with the form above.</div>';
    return;
  }
  listEl.innerHTML = `<div class="discovery-servers-grid">${servers
    .map((s) => {
      const kind = s.serverKind || 'vanilla';
      return `
    <article class="discovery-server-card glow-card">
      <div class="discovery-server-card-top">
        <h3 class="discovery-server-title">${escapeHtml(s.name)}</h3>
        <span class="tag tag-version">${escapeHtml(s.version)}</span>
        <span class="tag tag-fabric">${escapeHtml(kind)}</span>
      </div>
      <p class="discovery-server-meta">${escapeHtml((s.created || '').slice(0, 10))}</p>
      <div class="discovery-server-actions host-server-card-actions">
        <button type="button" class="btn btn-primary btn-sm host-console-srv" data-id="${escapeHtml(s.id)}" data-name="${escapeHtml(s.name)}">Console &amp; controls</button>
        <button type="button" class="btn btn-ghost btn-sm host-open-srv" data-id="${escapeHtml(s.id)}">Open folder</button>
        <button type="button" class="btn btn-danger btn-sm host-del-srv" data-id="${escapeHtml(s.id)}">Delete</button>
      </div>
    </article>`;
    })
    .join('')}</div>`;

  listEl.querySelectorAll('.host-console-srv').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name || 'Server';
      openHostConsolePanel(id, name);
    });
  });

  listEl.querySelectorAll('.host-open-srv').forEach((btn) => {
    btn.addEventListener('click', () => window.zenon.openServerFolder(btn.dataset.id));
  });
  listEl.querySelectorAll('.host-del-srv').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this server folder and all files inside?')) return;
      if (hostConsoleServerId === btn.dataset.id) closeHostConsolePanel();
      const r = await window.zenon.deleteServer(btn.dataset.id);
      if (r?.success) {
        showToast('Server removed', 'info');
        await refreshHostServersList();
      } else showToast(r?.error || 'Delete failed', 'error');
    });
  });
}

async function fillHostMcVersionSelect() {
  const sel = document.getElementById('host-server-version');
  if (!sel) return;
  const kind = hostServerKind;
  sel.innerHTML = '<option value="">Loading…</option>';
  const all = await window.zenon.getMcVersions();
  const releases = (all || []).filter((v) => v.type === 'release');

  if (kind === 'paper') {
    const paperVers = await window.zenon.getPaperMcVersions();
    const set = new Set(paperVers || []);
    const relIds = new Set(releases.map((v) => v.id));
    let list = releases.filter((v) => set.has(v.id)).slice(0, 48);
    if (!list.length) {
      const fallback = (paperVers || []).filter((id) => relIds.has(id));
      list = fallback.length ? releases.filter((v) => fallback.includes(v.id)).slice(0, 48) : [];
    }
    if (!list.length) {
      const tail = (paperVers || []).slice(-40).reverse();
      list = tail.map((id) => ({ id, type: 'release' }));
    }
    sel.innerHTML =
      '<option value="">Select Minecraft version…</option>' +
      (list.length
        ? list.map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.id)}</option>`).join('')
        : '<option value="">Could not load Paper versions</option>');
    return;
  }

  sel.innerHTML =
    '<option value="">Select Minecraft version…</option>' +
    releases
      .slice(0, 56)
      .map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.id)}</option>`)
      .join('');
}

async function fillHostFabricLoaderSelect(mcVersion) {
  const sel = document.getElementById('host-fabric-loader');
  if (!sel || !mcVersion) return;
  sel.innerHTML = '<option value="">Loading Fabric…</option>';
  const vers = await window.zenon.getFabricVersions(mcVersion);
  sel.innerHTML =
    '<option value="">Fabric loader version…</option>' +
    (vers || []).map((v) => `<option value="${escapeHtml(v.version)}">${escapeHtml(v.version)}${v.stable ? '' : ' (beta)'}</option>`).join('');
}

async function fillHostForgeVersionSelect(mcVersion) {
  const sel = document.getElementById('host-forge-version');
  if (!sel || !mcVersion) return;
  sel.innerHTML = '<option value="">Loading Forge…</option>';
  const rows = (await window.zenon.getForgeVersions(mcVersion)) || [];
  const opts = rows.map((r) => {
    const val = String(r.full || '').replace(/"/g, '&quot;');
    return `<option value="${val}">${escapeHtml(r.label || r.full || '')}</option>`;
  });
  sel.innerHTML =
    '<option value="">Forge installer version…</option>' +
    (opts.length
      ? opts.join('')
      : '<option value="" disabled>No Forge builds for this Minecraft version.</option>');
}

async function renderHostServer() {
  clearHostServerSubs();
  __hostServerGen += 1;
  const myGen = __hostServerGen;
  hostConsoleServerId = null;

  const content = document.getElementById('main-content');

  content.innerHTML = `
    <div class="page page-host-server">
      <div class="discovery-head glow-hero">
        <div>
          <h1 class="page-title">Host a server</h1>
          <p class="page-subtitle">Create a dedicated server folder: vanilla Mojang jar, Paper, Forge (installer), or Fabric server jar. Edit <code class="id-code">eula.txt</code> to <code class="id-code">eula=true</code> before starting from here.</p>
        </div>
      </div>

      <div class="host-server-create glow-card">
        <div class="form-group">
          <label>Server type</label>
          <select id="host-server-kind" class="form-select">
            <option value="vanilla" ${hostServerKind === 'vanilla' ? 'selected' : ''}>Vanilla (Mojang server.jar)</option>
            <option value="paper" ${hostServerKind === 'paper' ? 'selected' : ''}>Paper</option>
            <option value="forge" ${hostServerKind === 'forge' ? 'selected' : ''}>Forge</option>
            <option value="fabric" ${hostServerKind === 'fabric' ? 'selected' : ''}>Fabric</option>
          </select>
        </div>
        <div class="form-group">
          <label>Server name</label>
          <input type="text" id="host-server-name" class="form-input" placeholder="My server" maxlength="80" />
        </div>
        <div class="form-group">
          <label>Minecraft version</label>
          <select id="host-server-version" class="form-select">
            <option value="">Loading…</option>
          </select>
        </div>
        <div class="form-group" id="host-fabric-row" style="display:${hostServerKind === 'fabric' ? 'block' : 'none'}">
          <label>Fabric loader</label>
          <select id="host-fabric-loader" class="form-select">
            <option value="">Pick Minecraft version first</option>
          </select>
        </div>
        <div class="form-group" id="host-forge-row" style="display:${hostServerKind === 'forge' ? 'block' : 'none'}">
          <label>Forge version</label>
          <select id="host-forge-version" class="form-select">
            <option value="">Pick Minecraft version first</option>
          </select>
        </div>
        <button type="button" class="btn btn-primary" id="host-create-server">Create server</button>
        <p class="discovery-servers-status" id="host-servers-status"></p>
      </div>

      <h2 class="host-servers-list-title">Your servers</h2>
      <div id="host-servers-list" class="host-servers-list"></div>

      <div id="host-server-console-panel" class="host-server-console-panel" style="display:none">
        <div class="host-console-panel-head">
          <h3 id="host-console-title" class="host-console-title">Server</h3>
          <button type="button" class="btn btn-ghost btn-sm" id="host-console-close-panel">Close</button>
        </div>
        <div class="host-console-grid">
          <div class="host-console-left">
            <div class="host-console-log-wrap">
              <pre class="host-console-log" id="host-console-log" spellcheck="false"></pre>
            </div>
            <div class="host-console-input-row">
              <input type="text" id="host-console-cmd" class="form-input" placeholder="Command (say hi, list, op PlayerName, stop, …)" autocomplete="off" />
              <button type="button" class="btn btn-primary" id="host-console-send">Send</button>
              <button type="button" class="btn btn-ghost btn-sm" id="host-console-clear">Clear view</button>
            </div>
          </div>
          <aside class="host-console-sidebar">
            <div class="host-console-run-row">
              <span class="host-console-status" id="host-console-status">Stopped</span>
              <button type="button" class="btn btn-primary btn-sm" id="host-server-start">Start</button>
              <button type="button" class="btn btn-danger btn-sm" id="host-server-stop" disabled>Stop</button>
            </div>
            <p class="host-console-sidebar-hint">Players are inferred from log lines and the <code class="id-code">list</code> command.</p>
            <h4 class="host-players-heading">Online</h4>
            <ul class="host-players-ul" id="host-players-active"></ul>
            <h4 class="host-players-heading">Recently disconnected</h4>
            <ul class="host-players-ul" id="host-players-inactive"></ul>
            <button type="button" class="btn btn-ghost btn-sm" id="host-players-refresh">Refresh list (list)</button>
          </aside>
        </div>
        <div class="host-content-panel" id="host-content-wrap" style="margin-top:16px"></div>
      </div>
    </div>
  `;

  if (window.zenon.onServerLog) {
    __hostServerUnsubs.push(
      window.zenon.onServerLog((d) => {
        if (myGen !== __hostServerGen) return;
        if (d.serverId !== hostConsoleServerId) return;
        appendHostConsoleLine(d.line || '');
      })
    );
  }
  if (window.zenon.onServerPlayers) {
    __hostServerUnsubs.push(
      window.zenon.onServerPlayers((d) => {
        if (myGen !== __hostServerGen) return;
        if (d.serverId !== hostConsoleServerId) return;
        setHostPlayerLists(d.active || [], d.inactive || []);
      })
    );
  }
  if (window.zenon.onServerState) {
    __hostServerUnsubs.push(
      window.zenon.onServerState((d) => {
        if (myGen !== __hostServerGen) return;
        if (d.serverId !== hostConsoleServerId) return;
        updateHostConsoleRunningUI(!!d.running);
        if (!d.running && hostConsoleServerId) syncHostConsoleFromMain(hostConsoleServerId);
        if (!d.running && d.needsEula) {
          showToast('EULA required — click “Accept EULA & start”.', 'error');
        }
      })
    );
  }

  bindHostConsolePanelControls();

  document.getElementById('host-server-kind')?.addEventListener('change', async (e) => {
    hostServerKind = e.target.value || 'vanilla';
    document.getElementById('host-fabric-row').style.display = hostServerKind === 'fabric' ? 'block' : 'none';
    document.getElementById('host-forge-row').style.display = hostServerKind === 'forge' ? 'block' : 'none';
    await fillHostMcVersionSelect();
    const mc = document.getElementById('host-server-version')?.value || '';
    if (hostServerKind === 'fabric' && mc) await fillHostFabricLoaderSelect(mc);
    if (hostServerKind === 'forge' && mc) await fillHostForgeVersionSelect(mc);
  });

  await fillHostMcVersionSelect();

  document.getElementById('host-server-version')?.addEventListener('change', async () => {
    const mc = document.getElementById('host-server-version')?.value || '';
    if (hostServerKind === 'fabric' && mc) await fillHostFabricLoaderSelect(mc);
    if (hostServerKind === 'forge' && mc) await fillHostForgeVersionSelect(mc);
  });

  document.getElementById('host-create-server')?.addEventListener('click', async () => {
    const name = document.getElementById('host-server-name')?.value?.trim() || 'Minecraft Server';
    const version = document.getElementById('host-server-version')?.value || '';
    const stat = document.getElementById('host-servers-status');
    const kind = document.getElementById('host-server-kind')?.value || 'vanilla';
    if (!version) {
      if (stat) stat.textContent = 'Select a Minecraft version.';
      return;
    }
    const fabricLoader = document.getElementById('host-fabric-loader')?.value || '';
    const forgeFull = document.getElementById('host-forge-version')?.value || '';
    if (kind === 'fabric' && !fabricLoader) {
      if (stat) stat.textContent = 'Select a Fabric loader version.';
      return;
    }
    if (kind === 'forge' && !forgeFull) {
      if (stat) stat.textContent = 'Select a Forge version.';
      return;
    }
    if (stat) stat.textContent = kind === 'forge' ? 'Running Forge installer (may take a minute)…' : 'Working…';
    const res = await window.zenon.createServer({
      name,
      version,
      serverKind: kind,
      fabricLoaderVersion: kind === 'fabric' ? fabricLoader : null,
      forgeFull: kind === 'forge' ? forgeFull : null
    });
    if (res?.success) {
      showToast('Server created', 'success');
      if (stat) stat.textContent = res.hint || 'Done — set eula=true, then use Console & controls.';
      document.getElementById('host-server-name').value = '';
      await refreshHostServersList();
    } else {
      if (stat) stat.textContent = res?.error || 'Failed';
      showToast(res?.error || 'Create failed', 'error');
    }
  });

  await refreshHostServersList();
}
