// ===== Instances Page =====
/** After `State.instances` is replaced from disk, keep `State.selectedInstance` on the same row (fixes stale names in the sidebar). */
function syncSelectedInstanceWithList() {
  if (!State.selectedInstance) return;
  const id = State.selectedInstance.id;
  const match = State.instances.find((i) => i.id === id);
  if (match) {
    State.selectedInstance = match;
  } else {
    State.selectedInstance = State.instances.length > 0 ? State.instances[0] : null;
  }
}

window.syncSelectedInstanceWithList = syncSelectedInstanceWithList;

async function renderInstances() {
  const content = document.getElementById('main-content');
  State.instances = await window.zenon.getInstances();
  syncSelectedInstanceWithList();

  content.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <h1 class="page-title">Instances</h1>
            <p class="page-subtitle">${State.instances.length} instance${State.instances.length !== 1 ? 's' : ''} · click a card to open its library</p>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <button class="btn btn-ghost" id="import-instance-btn">Import</button>
            <button class="btn btn-ghost" id="export-instance-btn" ${State.selectedInstance ? '' : 'disabled'}>Export Selected</button>
            <button class="btn btn-primary" id="new-instance-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;stroke:white">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Instance
            </button>
          </div>
        </div>
      </div>

      <div class="instances-grid" id="instances-grid">
        ${State.instances.length === 0
          ? `<div style="grid-column:1/-1">
              <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                <h3>No instances yet</h3>
                <p>Create your first Minecraft instance to get started</p>
              </div>
            </div>`
          : State.instances.map(inst => renderInstanceCard(inst)).join('')
        }
      </div>
    </div>
  `;

  document.getElementById('new-instance-btn').addEventListener('click', openCreateInstanceModal);
  document.getElementById('import-instance-btn').addEventListener('click', importInstanceZipUi);
  document.getElementById('export-instance-btn').addEventListener('click', exportSelectedInstanceZipUi);
  bindInstanceCardEvents();
}

async function exportSelectedInstanceZipUi() {
  if (!State.selectedInstance) {
    showToast('No instance selected', 'error');
    return;
  }
  const res = await window.zenon.exportInstance(State.selectedInstance.id);
  if (res?.canceled) return;
  if (res?.success) showToast('Instance exported', 'success');
  else showToast(`Export failed: ${res?.error || 'unknown error'}`, 'error', 5000);
}

async function exportInstanceZipUi(instanceId) {
  const id = String(instanceId || '').trim();
  if (!id) {
    showToast('No instance selected', 'error');
    return;
  }
  const res = await window.zenon.exportInstance(id);
  if (res?.canceled) return;
  if (res?.success) showToast('Instance exported', 'success');
  else showToast(`Export failed: ${res?.error || 'unknown error'}`, 'error', 5000);
}

async function importInstanceZipUi() {
  const res = await window.zenon.importInstance();
  if (res?.canceled) return;
  if (res?.success) {
    showToast('Instance imported', 'success');
    State.instances = await window.zenon.getInstances();
    State.selectedInstance = res.instance;
    syncSelectedInstanceWithList();
    updateSidebarBadge();
    renderInstances();
  } else {
    showToast(`Import failed: ${res?.error || 'unknown error'}`, 'error', 5000);
  }
}

function renderInstanceCard(inst) {
  const isSelected = State.selectedInstance && State.selectedInstance.id === inst.id;
  const loaderClass = inst.loader === 'fabric' ? 'fabric' : inst.loader === 'forge' ? 'forge' : 'vanilla';

  const loaderTag =
    inst.loader === 'fabric'
      ? '<span class="tag tag-fabric">Fabric</span>'
      : inst.loader === 'forge'
        ? '<span class="tag tag-forge">Forge</span>'
        : '<span class="tag tag-vanilla">Vanilla</span>';

  return `
    <div class="instance-card ${isSelected ? 'selected' : ''}" data-id="${inst.id}" role="button" tabindex="0" aria-label="Open ${escapeHtml(inst.name)}">
      <div class="ic-banner ${loaderClass}"></div>
      <div class="ic-body">
        <div class="ic-top">
          <div class="ic-icon">${getInstanceIcon(inst)}</div>
          <div class="ic-info">
            <div class="ic-name">${escapeHtml(inst.name)}</div>
            <div class="ic-tags">
              <span class="tag tag-version">${escapeHtml(inst.version)}</span>
              ${loaderTag}
            </div>
            <div class="ic-hint">Library — content, files, worlds, logs</div>
          </div>
        </div>
        <div class="ic-actions">
          <span class="ic-last-played">
            ${inst.lastPlayed ? formatDate(inst.lastPlayed) : 'Never launched'}
          </span>
          <button class="btn btn-ghost btn-sm btn-icon" data-action="edit" data-id="${inst.id}" title="Rename" style="padding:6px 8px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm btn-icon" data-action="folder" data-id="${inst.id}" title="Open folder" style="padding:6px 8px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button class="btn btn-danger btn-sm btn-icon" data-action="delete" data-id="${inst.id}" title="Delete" style="padding:6px 8px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
          ${
            State.runningInstanceId && State.runningInstanceId === inst.id
              ? `<button class="launch-btn" data-action="stop-game" data-id="${inst.id}" style="background:var(--danger);border-color:rgba(255,255,255,0.12)">
                  <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                  Stop
                </button>`
              : `<button class="launch-btn" data-action="launch" data-id="${inst.id}">
                  <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  Play
                </button>`
          }
        </div>
      </div>
    </div>
  `;
}

function bindInstanceCardEvents() {
  document.querySelectorAll('.instance-card').forEach(card => {
    const openLibrary = (e) => {
      if (e.target.closest('[data-action]')) return;
      const id = card.dataset.id;
      const inst = State.instances.find(i => i.id === id);
      if (!inst) return;
      State.selectedInstance = inst;
      State.libraryPane = 'content';
      updateSidebarBadge();
      document.querySelectorAll('.instance-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.id === id);
      });
      navigateTo('library', { force: true });
    };
    card.addEventListener('click', openLibrary);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLibrary(e);
      }
    });
  });

  document.querySelectorAll('[data-action="launch"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      launchInstance(btn.dataset.id);
    });
  });

  document.querySelectorAll('[data-action="stop-game"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const b = e.currentTarget;
      b.disabled = true;
      try {
        try { State.launchConsole.stopRequestedAt = Date.now(); } catch (e0) {}
        const r = await window.zenon.stopGame();
        if (!r?.success) showToast(r?.error || 'Stop failed', 'error', 4500);
        else showToast(r?.detail ? `Stopping game… (${r.detail})` : 'Stopping game…', 'info', 2200);
      } finally {
        b.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDeleteInstance(btn.dataset.id);
    });
  });

  document.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditInstanceModal(btn.dataset.id);
    });
  });

  document.querySelectorAll('[data-action="folder"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.zenon.openInstanceFolder(btn.dataset.id);
    });
  });
}

// ===== Edit Instance Modal =====
const EIM_ICON_CHOICES = ['default', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
let eimSelectedIcon = 'default';

function parseRamToMb(s) {
  if (!s) return 2048;
  const t = String(s).trim().toUpperCase();
  const gm = t.match(/^([\d.]+)\s*G$/);
  if (gm) return Math.round(parseFloat(gm[1]) * 1024);
  const mm = t.match(/^([\d.]+)\s*M$/);
  if (mm) return Math.round(parseFloat(mm[1]));
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n > 0 ? n : 2048;
}

function mbToRamString(mb) {
  const v = Math.round(Number(mb));
  if (!Number.isFinite(v) || v < 512) return '512M';
  if (v % 1024 === 0) return `${v / 1024}G`;
  return `${v}M`;
}

function wireEimRamSlider() {
  const slider = document.getElementById('eim-ram-slider');
  const input = document.getElementById('eim-ram-mb-input');
  const label = document.getElementById('eim-ram-mb-label');
  const hidden = document.getElementById('eim-ram-max');
  if (!slider || !input || !label || !hidden) return;
  const sync = (v) => {
    let n = Math.round(Number(v));
    if (!Number.isFinite(n)) n = 2048;
    n = Math.max(512, Math.min(32768, n));
    slider.value = String(n);
    input.value = String(n);
    label.textContent = String(n);
    hidden.value = mbToRamString(n);
  };
  slider.oninput = () => sync(slider.value);
  input.onchange = () => sync(input.value);
}

function bindEimToggleHandlers() {
  const winCustom = document.getElementById('eim-win-custom');
  const winW = document.getElementById('eim-win-w');
  const winH = document.getElementById('eim-win-h');
  if (winCustom && winW && winH) {
    const applyWin = () => {
      const on = winCustom.checked;
      winW.disabled = !on;
      winH.disabled = !on;
    };
    winCustom.onchange = applyWin;
    applyWin();
  }

  const javaCustom = document.getElementById('eim-java-custom');
  const javaDefWrap = document.getElementById('eim-java-default-wrap');
  const javaCustWrap = document.getElementById('eim-java-custom-wrap');
  if (javaCustom && javaDefWrap && javaCustWrap) {
    const applyJava = () => {
      const on = javaCustom.checked;
      javaDefWrap.style.display = on ? 'none' : 'block';
      javaCustWrap.style.display = on ? 'block' : 'none';
    };
    javaCustom.onchange = applyJava;
    applyJava();
  }

  const memCustom = document.getElementById('eim-mem-custom');
  const memWrap = document.getElementById('eim-mem-slider-wrap');
  if (memCustom && memWrap) {
    memCustom.onchange = () => {
      memWrap.style.display = memCustom.checked ? 'block' : 'none';
    };
  }

  const jvmCustom = document.getElementById('eim-jvmargs-custom');
  const jvmTa = document.getElementById('eim-jvm-args');
  if (jvmCustom && jvmTa) {
    const applyJvm = () => {
      jvmTa.disabled = !jvmCustom.checked;
    };
    jvmCustom.onchange = applyJvm;
    applyJvm();
  }

  const hooksCustom = document.getElementById('eim-hooks-custom');
  const hooksFields = document.getElementById('eim-hooks-fields');
  if (hooksCustom && hooksFields) {
    const applyHooks = () => {
      const on = hooksCustom.checked;
      hooksFields.style.opacity = on ? '1' : '0.45';
      hooksFields.style.pointerEvents = on ? 'auto' : 'none';
    };
    hooksCustom.onchange = applyHooks;
    applyHooks();
  }
}

function setEimTab(tab) {
  document.querySelectorAll('#eim-sidebar .eim-nav').forEach((b) => {
    b.classList.toggle('active', b.dataset.eimTab === tab);
  });
  document.querySelectorAll('#modal-edit-instance .eim-panel').forEach((p) => {
    p.classList.toggle('active', p.dataset.eimPanel === tab);
  });
}

function syncEimIconPreview() {
  const el = document.getElementById('eim-icon-preview');
  if (!el) return;
  if (eimSelectedIcon === 'default') {
    const id = document.getElementById('edit-inst-id')?.value;
    const inst = State.instances.find((i) => i.id === id);
    el.innerHTML = inst ? getInstanceIcon(inst) : '?';
  } else {
    // If it's an uploaded image icon, show it; otherwise show the chosen glyph.
    if (typeof eimSelectedIcon === 'string' && eimSelectedIcon.startsWith('img:')) {
      const id = document.getElementById('edit-inst-id')?.value;
      const inst = State.instances.find((i) => i.id === id) || {};
      el.innerHTML = getInstanceIcon({ ...inst, icon: eimSelectedIcon });
    } else {
      el.textContent = eimSelectedIcon;
    }
  }
  document.querySelectorAll('.eim-icon-pick').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.icon === eimSelectedIcon);
  });
}

async function openEditInstanceModal(id) {
  const inst = State.instances.find((i) => i.id === id);
  if (!inst) return;

  try {
    State.settings = await window.zenon.getSettings();
  } catch (e) {}

  document.getElementById('edit-inst-id').value = inst.id;
  document.getElementById('eim-bc-name').textContent = inst.name || 'Instance';
  document.getElementById('eim-name').value = inst.name || '';

  // Allow existing uploaded image icons (img:...) as well as built-in glyphs.
  eimSelectedIcon =
    inst.icon && typeof inst.icon === 'string' && inst.icon.startsWith('img:')
      ? inst.icon
      : inst.icon && EIM_ICON_CHOICES.includes(inst.icon)
        ? inst.icon
        : 'default';

  const picks = document.getElementById('eim-icon-picks');
  picks.innerHTML = EIM_ICON_CHOICES.map(
    (ic) =>
      `<button type="button" class="eim-icon-pick ${ic === eimSelectedIcon ? 'selected' : ''}" data-icon="${ic}">${ic === 'default' ? '&#9675;' : escapeHtml(ic)}</button>`
  ).join('');
  picks.querySelectorAll('.eim-icon-pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      eimSelectedIcon = btn.dataset.icon;
      syncEimIconPreview();
    });
  });
  syncEimIconPreview();

  // Upload / clear icon
  const uploadInput = document.getElementById('eim-icon-upload');
  const uploadBtn = document.getElementById('eim-icon-upload-btn');
  const clearBtn = document.getElementById('eim-icon-clear-btn');
  if (uploadInput && uploadBtn) {
    uploadBtn.onclick = () => uploadInput.click();
    uploadInput.onchange = async () => {
      const file = uploadInput.files && uploadInput.files[0];
      if (!file) return;
      const id = document.getElementById('edit-inst-id')?.value?.trim();
      if (!id) return;
      try {
        if (file.size > 4 * 1024 * 1024) {
          showToast('Image too large (max 4MB)', 'error');
          uploadInput.value = '';
          return;
        }
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        const base64 = btoa(bin);
        const res = await window.zenon.setInstanceIcon(id, base64, file.type || 'image/png');
        if (!res?.success) throw new Error(res?.error || 'Upload failed');
        State.instances = await window.zenon.getInstances();
        syncSelectedInstanceWithList();
        eimSelectedIcon = (res.instance && res.instance.icon) || `img:.zenon/icon.png`;
        syncEimIconPreview();
        updateSidebarBadge();
        renderInstances();
        showToast('Icon updated', 'success');
      } catch (e) {
        showToast(e.message || 'Icon upload failed', 'error');
      } finally {
        uploadInput.value = '';
      }
    };
  }
  if (clearBtn) {
    clearBtn.onclick = async () => {
      const id = document.getElementById('edit-inst-id')?.value?.trim();
      if (!id) return;
      const res = await window.zenon.clearInstanceIcon(id);
      if (res?.success) {
        State.instances = await window.zenon.getInstances();
        syncSelectedInstanceWithList();
        eimSelectedIcon = 'default';
        syncEimIconPreview();
        updateSidebarBadge();
        renderInstances();
        showToast('Icon removed', 'info');
      } else {
        showToast(res?.error || 'Could not remove icon', 'error');
      }
    };
  }

  document.getElementById('eim-group').value = inst.libraryGroup != null ? inst.libraryGroup : '';

  const platform =
    inst.loader === 'fabric'
      ? 'Fabric'
      : inst.loader === 'forge'
        ? 'Forge'
        : inst.loader === 'vanilla'
          ? 'Vanilla'
          : String(inst.loader || '—');
  document.getElementById('eim-install-platform').textContent = platform;
  document.getElementById('eim-install-gamever').textContent = inst.version || '—';
  const loaderVer =
    inst.loader === 'fabric' && inst.loaderVersion
      ? String(inst.loaderVersion)
      : inst.loader === 'forge' && inst.loaderVersion
        ? String(inst.loaderVersion)
        : '—';
  document.getElementById('eim-install-loaderv').textContent = loaderVer;
  document.getElementById('eim-folder-path').value = inst.dir || '';

  document.getElementById('eim-win-custom').checked = !!inst.windowCustomEnabled;
  document.getElementById('eim-win-w').value =
    inst.windowWidth != null && inst.windowWidth !== '' ? inst.windowWidth : '';
  document.getElementById('eim-win-h').value =
    inst.windowHeight != null && inst.windowHeight !== '' ? inst.windowHeight : '';
  document.getElementById('eim-win-fs').checked = !!inst.windowFullscreen;

  document.getElementById('eim-java-default-path').value = State.settings?.javaPath || 'java';
  document.getElementById('eim-java-custom').checked = !!inst.javaCustomEnabled;
  document.getElementById('eim-java').value = inst.javaPathOverride || '';

  document.getElementById('eim-mem-custom').checked = !!inst.memoryCustomEnabled;
  const mb = parseRamToMb(inst.maxRamOverride || State.settings?.maxRam);
  document.getElementById('eim-ram-slider').value = String(mb);
  document.getElementById('eim-ram-mb-input').value = String(mb);
  document.getElementById('eim-ram-mb-label').textContent = String(mb);
  document.getElementById('eim-ram-max').value = mbToRamString(mb);
  document.getElementById('eim-mem-slider-wrap').style.display = inst.memoryCustomEnabled ? 'block' : 'none';

  document.getElementById('eim-jvmargs-custom').checked = !!inst.jvmArgsEnabled;
  document.getElementById('eim-jvm-args').value = inst.jvmArgs || '';

  document.getElementById('eim-hooks-custom').checked = !!inst.hooksCustomEnabled;
  document.getElementById('eim-hook-pre').value = inst.hookPreLaunch || '';
  document.getElementById('eim-hook-wrapper').value = inst.hookWrapper || '';
  const postExit =
    inst.hookPostExit != null && inst.hookPostExit !== ''
      ? inst.hookPostExit
      : inst.hookPostLaunch || '';
  document.getElementById('eim-hook-postexit').value = postExit;

  bindEimToggleHandlers();
  wireEimRamSlider();

  setEimTab('general');

  openModal('modal-edit-instance');

  const close = () => closeModal('modal-edit-instance');
  document.getElementById('modal-edit-close-btn').onclick = close;
  document.getElementById('edit-inst-cancel-btn').onclick = close;

  document.getElementById('eim-sidebar').onclick = (e) => {
    const nav = e.target.closest('[data-eim-tab]');
    if (!nav) return;
    setEimTab(nav.dataset.eimTab);
  };

  document.getElementById('eim-open-folder-btn').onclick = () => window.zenon.openInstanceFolder(inst.id);

  document.getElementById('eim-repair-btn').onclick = async () => {
    const res = await window.zenon.repairInstance(inst.id);
    if (res.success) showToast('Instance repaired', 'success');
    else showToast(res.error || 'Repair failed', 'error');
  };

  document.getElementById('eim-duplicate-btn').onclick = async () => {
    const btn = document.getElementById('eim-duplicate-btn');
    btn.disabled = true;
    const res = await window.zenon.duplicateInstance(inst.id);
    btn.disabled = false;
    if (!res.success) {
      showToast(res.error || 'Duplicate failed', 'error');
      return;
    }
    State.instances = await window.zenon.getInstances();
    State.selectedInstance = res.instance;
    syncSelectedInstanceWithList();
    updateSidebarBadge();
    closeModal('modal-edit-instance');
    showToast(`Duplicated as "${res.instance.name}"`, 'success');
    renderInstances();
  };

  document.getElementById('eim-group-hint-btn').onclick = () => {
    document.getElementById('eim-group').focus();
    showToast('Type a group name, then Save changes', 'info');
  };

  document.getElementById('eim-delete-btn').onclick = async () => {
    closeModal('modal-edit-instance');
    await confirmDeleteInstance(inst.id);
  };

  document.getElementById('edit-inst-save-btn').onclick = async () => {
    const instanceId = document.getElementById('edit-inst-id')?.value?.trim();
    if (!instanceId) {
      showToast('Instance id missing — close and reopen the editor.', 'error');
      return;
    }

    // Allow any name input; backend normalizes + falls back if empty.
    const newName = document.getElementById('eim-name').value;

    const winCustom = document.getElementById('eim-win-custom').checked;
    const ww = document.getElementById('eim-win-w').value.trim();
    const wh = document.getElementById('eim-win-h').value.trim();
    const nw = ww === '' ? null : Number(ww);
    const nh = wh === '' ? null : Number(wh);

    const javaCustom = document.getElementById('eim-java-custom').checked;
    const memCustom = document.getElementById('eim-mem-custom').checked;

    const updates = {
      name: newName,
      icon: eimSelectedIcon,
      libraryGroup: document.getElementById('eim-group').value.trim(),
      javaCustomEnabled: javaCustom,
      javaPathOverride: javaCustom ? document.getElementById('eim-java').value.trim() || null : null,
      memoryCustomEnabled: memCustom,
      maxRamOverride: memCustom ? document.getElementById('eim-ram-max').value.trim() || null : null,
      minRamOverride: null,
      windowCustomEnabled: winCustom,
      windowWidth:
        winCustom && nw != null && Number.isFinite(nw) && nw > 0 ? nw : null,
      windowHeight:
        winCustom && nh != null && Number.isFinite(nh) && nh > 0 ? nh : null,
      windowFullscreen: document.getElementById('eim-win-fs').checked,
      jvmArgsEnabled: document.getElementById('eim-jvmargs-custom').checked,
      jvmArgs: document.getElementById('eim-jvm-args').value.trim(),
      hooksCustomEnabled: document.getElementById('eim-hooks-custom').checked,
      hookPreLaunch: document.getElementById('eim-hook-pre').value.trim(),
      hookWrapper: document.getElementById('eim-hook-wrapper').value.trim(),
      hookPostExit: document.getElementById('eim-hook-postexit').value.trim(),
      hookPostLaunch: ''
    };

    const btn = document.getElementById('edit-inst-save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const updated = await window.zenon.updateInstance(instanceId, updates);
      if (!updated) {
        showToast('Could not save — instance folder or id may be invalid.', 'error');
        return;
      }
      State.instances = await window.zenon.getInstances();
      syncSelectedInstanceWithList();
      if (State.selectedInstance && State.selectedInstance.id === instanceId) {
        const row = State.instances.find((i) => i.id === instanceId);
        State.selectedInstance = row || updated;
        updateSidebarBadge();
      }

      closeModal('modal-edit-instance');
      showToast('Instance settings saved', 'success');
      renderInstances();
      if (State.currentPage === 'library') renderLibrary();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save changes';
    }
  };

  document.getElementById('edit-inst-export-btn').onclick = async () => {
    const instanceId = document.getElementById('edit-inst-id')?.value?.trim();
    await exportInstanceZipUi(instanceId);
  };
}

// ===== Create Instance Modal =====
async function openCreateInstanceModal() {
  openModal('modal-create-instance');

  const mcSelect = document.getElementById('inst-mc-version');
  const snapshotsBtn = document.getElementById('inst-snapshots-toggle');
  const loaderSelect = document.getElementById('inst-loader');
  const fabricGroup = document.getElementById('fabric-version-group');
  const fabricSelect = document.getElementById('inst-fabric-version');
  const forgeGroup = document.getElementById('forge-version-group');
  const forgeSelect = document.getElementById('inst-forge-version');

  let showSnapshots = false;

  const applySnapshotsBtn = () => {
    if (!snapshotsBtn) return;
    snapshotsBtn.setAttribute('aria-pressed', showSnapshots ? 'true' : 'false');
    snapshotsBtn.classList.toggle('is-on', showSnapshots);
    snapshotsBtn.textContent = `Snapshots: ${showSnapshots ? 'On' : 'Off'}`;
  };

  const renderMcVersionOptions = () => {
    const prev = mcSelect.value;
    const filtered = showSnapshots
      ? State.mcVersions
      : State.mcVersions.filter((v) => (v && v.type ? v.type === 'release' : true));

    mcSelect.innerHTML = filtered.map((v) => {
      const label = v.type === 'release' ? v.id : `${v.id} · ${v.type}`;
      return `<option value="${String(v.id).replace(/"/g, '&quot;')}" data-version-type="${String(v.type).replace(/"/g, '&quot;')}">${escapeHtml(label)}</option>`;
    }).join('');

    // Restore selection if it still exists; otherwise pick the first option.
    if (prev && [...mcSelect.options].some((o) => o.value === prev)) mcSelect.value = prev;
    else mcSelect.selectedIndex = 0;
  };

  // Load MC versions
  if (State.mcVersions.length === 0) {
    mcSelect.innerHTML = '<option value="">Loading...</option>';
    State.mcVersions = await window.zenon.getMcVersions();
  }

  applySnapshotsBtn();
  renderMcVersionOptions();

  loaderSelect.value = 'vanilla';

  const syncLoaderSubmenus = async () => {
    const mc = mcSelect.value;
    if (loaderSelect.value === 'fabric') {
      fabricGroup.style.display = 'block';
      forgeGroup.style.display = 'none';
      fabricSelect.innerHTML = '<option value="">Loading Fabric versions...</option>';
      const vers = await window.zenon.getFabricVersions(mc);
      fabricSelect.innerHTML = vers.map(v =>
        `<option value="${v.version}">${v.version}${v.stable ? '' : ' (unstable)'}</option>`
      ).join('');
    } else if (loaderSelect.value === 'forge') {
      fabricGroup.style.display = 'none';
      forgeGroup.style.display = 'block';
      forgeSelect.innerHTML = '<option value="">Loading Forge versions…</option>';
      const rows = (await window.zenon.getForgeVersions(mc)) || [];
      const opts = rows.map((r) => {
        const val = String(r.full || '').replace(/"/g, '&quot;');
        const lab = escapeHtml(r.label || r.full || '');
        return `<option value="${val}">${lab}</option>`;
      });
      forgeSelect.innerHTML =
        '<option value="">Select Forge version…</option>' +
        (opts.length
          ? opts.join('')
          : '<option value="" disabled>No Forge builds for this Minecraft version — pick another MC version or a release (not pre-release).</option>');
    } else {
      fabricGroup.style.display = 'none';
      forgeGroup.style.display = 'none';
    }
  };

  loaderSelect.onchange = () => syncLoaderSubmenus();

  mcSelect.onchange = () => syncLoaderSubmenus();

  if (snapshotsBtn) {
    snapshotsBtn.onclick = async () => {
      showSnapshots = !showSnapshots;
      applySnapshotsBtn();
      renderMcVersionOptions();
      await syncLoaderSubmenus();
    };
  }

  // Close buttons
  document.getElementById('modal-close-btn').onclick = () => closeModal('modal-create-instance');
  document.getElementById('cancel-create-btn').onclick = () => closeModal('modal-create-instance');

  // Confirm
  document.getElementById('confirm-create-btn').onclick = async () => {
    // Allow blank / symbol-heavy names; backend will normalize/fallback.
    const name = document.getElementById('inst-name').value;
    const version = mcSelect.value;
    const versionType = mcSelect.selectedOptions[0]?.getAttribute('data-version-type') || 'release';
    const loader = loaderSelect.value;
    const fabricVersion = fabricSelect.value;
    const forgeFull = forgeSelect.value;

    if (!version) { showToast('Please select a Minecraft version', 'error'); return; }
    if (loader === 'fabric' && !fabricVersion) { showToast('Please select a Fabric version', 'error'); return; }
    if (loader === 'forge' && !forgeFull) { showToast('Please select a Forge version', 'error'); return; }

    const btn = document.getElementById('confirm-create-btn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    const inst = await window.zenon.createInstance({
      name,
      version,
      versionType,
      loader,
      loaderVersion: loader === 'fabric' ? fabricVersion : loader === 'forge' ? forgeFull : null
    });

    State.instances = await window.zenon.getInstances();
    State.selectedInstance = inst;
    syncSelectedInstanceWithList();
    updateSidebarBadge();

    closeModal('modal-create-instance');
    document.getElementById('inst-name').value = '';
    showToast(`Instance "${name}" created!`, 'success');
    // After creating an instance, take user straight to Library.
    State.libraryPane = 'content';
    navigateTo('library', { force: true });
  };
}

// ===== Delete Instance =====
async function confirmDeleteInstance(id) {
  const inst = State.instances.find(i => i.id === id);
  if (!inst) return;

  if (!confirm(`Delete "${inst.name}"? This cannot be undone.`)) return;

  await window.zenon.deleteInstance(id);
  State.instances = await window.zenon.getInstances();

  if (State.selectedInstance && State.selectedInstance.id === id) {
    State.selectedInstance = State.instances.length > 0 ? State.instances[0] : null;
    updateSidebarBadge();
  }

  showToast(`Deleted "${inst.name}"`, 'info');
  // After deleting an instance (often a modpack instance), return user to Library.
  State.libraryPane = 'content';
  navigateTo('library', { force: true });
}

// ===== Launch Game =====
async function launchInstance(id) {
  if (State.isLaunching) {
    showToast('Game is already launching!', 'error');
    return;
  }

  const inst = State.instances.find(i => i.id === id);
  if (!inst) return;

  State.selectedInstance = inst;
  State.isLaunching = true;
  updateSidebarBadge();

  // Launch console is available in Library > Logs (no popup panel).
  clearConsole();
  setConsoleStatus('Launching...', true);
  logToConsole(`Launching ${inst.name} (${inst.version}, ${inst.loader})`, 'info');
  logToConsole(`Java: ${State.settings.javaPath || 'java'}`, 'info');
  logToConsole(`RAM: ${State.settings.maxRam || '2G'}`, 'info');

  const result = await window.zenon.launchGame(id);

  if (!result.success) {
    State.isLaunching = false;
    setConsoleStatus('Failed', false);
    logToConsole(`Launch failed: ${result.error}`, 'error');
    showToast(`Launch failed: ${result.error}`, 'error', 5000);
  } else {
    logToConsole('Game launched successfully', 'success');
    setConsoleStatus('Running', true);
    State.runningInstanceId = id;
    State.isLaunching = false;
    showToast(`${inst.name} is running!`, 'success');
    // Ensure UI updates immediately (Play -> Stop).
    if (State.currentPage === 'instances') renderInstances();
    if (State.currentPage === 'library') {
      if (typeof window.updateLibraryPlayStopButton === 'function') window.updateLibraryPlayStopButton();
      else renderLibrary();
    }
    if (State.currentPage === 'discovery' && typeof window.__discoveryRefresh === 'function') {
      window.__discoveryRefresh();
    }
  }
}
