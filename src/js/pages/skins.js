// ===== Skins (ES module — loads vendored skinview3d + three.js) =====
import {
  SkinViewer,
  FunctionAnimation,
  WaveAnimation
} from 'skinview3d';
import { loadImage, loadSkinToCanvas, inferModelType } from 'skinview-utils';
import {
  CanvasTexture,
  Group as BgGroup,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry
} from 'three';

// Hand-tuned animations: static-ish poses with subtle breathing so they feel alive,
// not like a skeleton on a treadmill.
function makeIdle() {
  return new FunctionAnimation((player, progress) => {
    const t = progress * 1.6;
    const sway = Math.sin(t * 0.5);
    const breathe = Math.sin(t);
    player.skin.body.rotation.y = sway * 0.03;
    player.skin.body.rotation.x = breathe * 0.015;
    player.skin.body.position.y = -6 + breathe * 0.12; // base torso offset is -6, keep it
    // Shoulder breathing + arms drift slightly with the torso
    player.skin.leftArm.rotation.z  =  Math.PI * 0.022 + breathe * 0.035;
    player.skin.rightArm.rotation.z = -Math.PI * 0.022 - breathe * 0.035;
    player.skin.leftArm.rotation.x  =  Math.sin(t * 0.7 + 0.8) * 0.03;
    player.skin.rightArm.rotation.x = Math.sin(t * 0.7) * -0.03;
    player.skin.leftArm.rotation.y  =  Math.sin(t * 0.42 + 1.4) * 0.02;
    player.skin.rightArm.rotation.y = -Math.sin(t * 0.42 + 1.4) * 0.02;
    // Head slowly looks around + tiny nod
    player.skin.head.rotation.y = Math.sin(t * 0.35 + 0.6) * 0.07;
    player.skin.head.rotation.x = Math.sin(t * 0.55 + 1.4) * 0.032;
    // Cape breathes with the chest
    player.cape.rotation.x = Math.sin(t * 0.8) * 0.03 + Math.PI * 0.06;
  });
}

function makeWalk() {
  return new FunctionAnimation((player, progress) => {
    const t = progress * 7;           // cadence
    const legSwing = Math.sin(t) * 0.55;
    const armSwing = Math.cos(t) * 0.5;
    // Legs + arms in opposition
    player.skin.leftLeg.rotation.x  = legSwing;
    player.skin.rightLeg.rotation.x = -legSwing;
    player.skin.leftArm.rotation.x  = -armSwing;
    player.skin.rightArm.rotation.x = armSwing;
    player.skin.leftArm.rotation.z  =  Math.PI * 0.02 + Math.cos(t) * 0.03;
    player.skin.rightArm.rotation.z = -Math.PI * 0.02 - Math.cos(t + Math.PI) * 0.03;
    // Hip/torso sway — counter-lean like a human walking
    player.skin.body.rotation.y = Math.sin(t * 0.5) * 0.05;
    player.skin.body.rotation.z = Math.cos(t * 0.5) * 0.02;
    // Light bounce, not pogo-stick
    player.position.y = Math.abs(Math.sin(t)) * 0.12;
    // Head settles with the body — tiny look-around feel
    player.skin.head.rotation.y = Math.sin(t * 0.25 + 0.3) * 0.05;
    player.skin.head.rotation.x = Math.sin(t * 0.4) * 0.02;
    // Cape follows the chest, softer swing
    player.cape.rotation.x = Math.sin(t * 0.667) * 0.08 + Math.PI * 0.06;
  });
}

function makeRun() {
  const walk = makeWalk();
  walk.speed = 1.7;          // sprint = faster walk, like Minecraft
  walk.headBobbing = false;  // keep the head level when sprinting
  return walk;
}

function makeCrouchHold() {
  return new FunctionAnimation((player, progress) => {
    // Static full-crouch pose with a slow breathing wobble on top.
    const t = progress * 2.1;
    const breathe = Math.sin(t) * 0.05;
    player.skin.body.rotation.x = 0.454 + breathe * 0.15;
    player.skin.body.position.z = 1.3256 - 3.4500;
    player.skin.body.position.y = -8.104 - Math.sin(t) * 0.06;
    player.cape.position.y = 6.149 - Math.sin(t) * 0.05;
    player.cape.rotation.x = 0.4827;
    player.cape.position.z = -1.6634;
    player.skin.head.position.y = -3.618 - Math.sin(t) * 0.04;
    player.skin.head.rotation.x = 0.08;
    player.skin.leftArm.position.z = 0.168;
    player.skin.rightArm.position.z = 0.168;
    player.skin.leftArm.rotation.x = 0.410 - breathe;
    player.skin.rightArm.rotation.x = 0.410 - breathe;
    player.skin.leftArm.rotation.z = 0.1;
    player.skin.rightArm.rotation.z = -0.1;
    player.skin.leftArm.position.y = -4.539;
    player.skin.rightArm.position.y = -4.539;
    player.skin.rightLeg.position.z = -3.450;
    player.skin.leftLeg.position.z = -3.450;
  });
}

const ANIMATION_CHOICES = {
  idle: () => makeIdle(),
  walk: () => makeWalk(),
  run: () => makeRun(),
  wave: () => new WaveAnimation(),
  crouch: () => makeCrouchHold()
};

const state = {
  viewer: null,
  currentMiniViewer: null,
  hoverViewer: null,   // single live 3D viewer mounted on hover — never more than one context
  thumbs: new Map(),   // skin.id -> baked 3D snapshot (dataUrl) for the flat card face
  floor: null,          // { group, dispose() } — studio floor under the player
  currentSkinUrl: null, // source last loaded into the viewer (for re-applying arm model)
  currentSkinVariant: 'CLASSIC', // stored variant of the currently loaded skin
  modelPref: 'auto',    // 'auto' | 'classic' | 'slim'
  libraryTab: 'mine',   // 'mine' (user skins) | 'defaults' (built-in Minecraft defaults)
  profile: null,        // { id, name, skins, active }
  library: [],          // [{ id, name, variant, width, height, addedAt, dataUrl }]
  previewingId: null,   // null = viewing the profile skin, otherwise a library skin id
  busy: false
};

try { state.modelPref = localStorage.getItem('zenon-skin-model-arms') || 'auto'; } catch (e) { state.modelPref = 'auto'; }
if (state.modelPref !== 'classic' && state.modelPref !== 'slim') state.modelPref = 'auto';
try { state.libraryTab = localStorage.getItem('zenon-skin-library-tab') || 'mine'; } catch (e) { state.libraryTab = 'mine'; }
if (state.libraryTab !== 'mine' && state.libraryTab !== 'defaults') state.libraryTab = 'mine';

/** 'auto' lets the skin pixels decide; otherwise force slim (Alex 3px) or classic (Steve 4px) arms. */
function resolveArmsModel() {
  if (state.modelPref === 'slim') return 'slim';
  if (state.modelPref === 'classic') return 'default';
  return 'auto-detect';
}

function effectiveArmsLabel(fallbackVariant) {
  if (state.modelPref === 'slim') return 'Slim';
  if (state.modelPref === 'classic') return 'Classic';
  return variantOf(fallbackVariant);
}

/** Soft grounding shadow under the avatar's feet — no floor, nothing else. */
function buildFloor() {
  const group = new BgGroup();
  const disposables = [];

  // Radial "contact shadow" ellipse under the feet
  const sc = document.createElement('canvas');
  sc.width = sc.height = 256;
  const sctx = sc.getContext('2d');
  const grad = sctx.createRadialGradient(128, 128, 4, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0.82)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 256, 256);
  const shadowTex = new CanvasTexture(sc);
  const shadowGeo = new PlaneGeometry(30, 30);
  const shadowMat = new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const shadow = new Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -24.4;
  group.add(shadow);
  disposables.push(shadowTex, shadowGeo, shadowMat);

  return {
    group,
    dispose() {
      for (const d of disposables) { try { d.dispose(); } catch (e) {} }
    }
  };
}

function secureUrl(url) {
  const u = String(url || '').trim();
  if (!u) return u;
  if (u.startsWith('http://')) return 'https://' + u.slice('http://'.length);
  return u;
}

function variantOf(v) {
  const s = String(v || 'CLASSIC').toUpperCase();
  return s === 'SLIM' ? 'SLIM' : 'CLASSIC';
}

function cardMetaLabel(s) {
  if (s && s.builtin === true) return 'Default';
  return `${variantOf(s && s.variant)} · ${(s && s.width) || 64}×${(s && s.height) || 64}`;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}

async function refreshProfile(force = false) {
  const res = await window.zenon.skinGetProfile(force === true);
  if (res?.success) {
    state.profile = res.profile || null;
    return true;
  }
  state.profile = null;
  showToast(res?.error || 'Could not load your Minecraft profile.', 'error', 4500);
  return false;
}

async function refreshLibrary() {
  const res = await window.zenon.skinListLibrary();
  if (res?.success && Array.isArray(res.skins)) {
    state.library = res.skins;
    return true;
  }
  state.library = [];
  return false;
}

function activeProfileSkin() {
  return state.profile?.active || null;
}

function disposeCurrentMiniViewer() {
  const v = state.currentMiniViewer;
  state.currentMiniViewer = null;
  if (v) { try { v.dispose(); } catch (e) {} }
}

function renderCurrentCard() {
  const body = document.getElementById('skin-current-body');
  const saveBtn = document.getElementById('skin-save-current-btn');
  const cur = activeProfileSkin();
  disposeCurrentMiniViewer();
  if (!body) return;
  if (!cur || !cur.url) {
    body.innerHTML = '<div class="skin-current-meta"><div class="skin-current-detail">No active skin on your Microsoft profile — or Zenon could not reach Mojang\'s skin service.</div></div>';
    if (saveBtn) saveBtn.style.display = 'none';
    return;
  }
  body.innerHTML = `
    <div class="skin-current-thumb-wrap skin-current-mini" style="width:104px;height:104px;flex-shrink:0;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;position:relative">
      <canvas id="skin-current-mini-canvas" aria-label="3D preview of your current skin" style="width:100%;height:100%;display:block"></canvas>
    </div>
    <div class="skin-current-meta">
      <div class="skin-current-name">${escapeHtml(state.profile?.name || 'Steve')}</div>
      <div class="skin-current-detail">Arms: <strong>${escapeHtml(variantOf(cur.variant))}</strong></div>
      <div class="skin-current-detail">Currently active on your Minecraft profile. Click any card to swap instantly.</div>
    </div>
  `;
  // Mount a small live 3D model of the CURRENT skin
  const canvas = document.getElementById('skin-current-mini-canvas');
  if (canvas) {
    try {
      const viewer = new SkinViewer({
        canvas,
        width: 104,
        height: 104,
        skin: secureUrl(cur.url),
        model: resolveArmsModel(),
        enableControls: false,
        renderPaused: false,
        zoom: 1.35
      });
      viewer.controls.enableRotate = false;
      viewer.controls.autoRotate = true;
      viewer.controls.autoRotateSpeed = 1.1;
      viewer.playerWrapper.rotation.y = Math.PI / 8;
      state.currentMiniViewer = viewer;
    } catch (e) {
      console.error('[skins] mini 3D viewer failed:', e);
    }
  }
  if (saveBtn) saveBtn.style.display = '';
}

function disposeCardViewers() {
  detachHoverViewer();
}

/** Detach the single live hover viewer (if any) and restore all frozen snapshots. */
function detachHoverViewer() {
  const v = state.hoverViewer;
  state.hoverViewer = null;
  if (v) { try { v.dispose(); } catch (e) {} }
  document.querySelectorAll('.skin-live').forEach((c) => { c.style.visibility = 'hidden'; });
  document.querySelectorAll('.skin-snap').forEach((c) => { c.style.visibility = 'visible'; });
}

/** Mount the one live 3D viewer on a hovered card (flat snapshot underneath hides). */
function attachHoverViewer(card) {
  detachHoverViewer();
  const id = card?.dataset.id;
  const skin = state.library.find((s) => s.id === id);
  const liveCanvas = card?.querySelector('.skin-live');
  if (!skin?.dataUrl || !liveCanvas) return;
  try {
    const preview = card.querySelector('.skin-card-preview');
    const w = Math.max(120, Math.floor(preview?.getBoundingClientRect().width || 140));
    const h = Math.max(120, w);
    const viewer = new SkinViewer({
      canvas: liveCanvas,
      width: w,
      height: h,
      skin: skin.dataUrl,
      model: resolveArmsModel(),
      enableControls: false,
      renderPaused: false,
      zoom: 0.82
    });
    viewer.controls.enableRotate = false;
    viewer.controls.autoRotate = true;
    viewer.controls.autoRotateSpeed = 1.6;
    viewer.playerWrapper.rotation.y = Math.PI / 8;
    liveCanvas.style.visibility = 'visible';
    const snap = card.querySelector('.skin-snap');
    if (snap) snap.style.visibility = 'hidden';
    state.hoverViewer = viewer;
  } catch (e) {
    console.error('[skins] hover viewer failed:', e);
  }
}

/** Draw a snapshot dataUrl onto a 2D card canvas (pixelated, full-bleed). */
async function paintSnapshot(canvas, dataUrl) {
  try {
    const img = await loadImage(dataUrl);
    const S = 200;
    canvas.width = S;
    canvas.height = S;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(img, 0, 0, S, S);
  } catch (e) {}
}

/** One-time offscreen baker — renders each skin once, caches as frozen snapshot. */
function bakeMissingThumbnails(skins) {
  const bakeCanvas = document.createElement('canvas');
  bakeCanvas.width = 192;
  bakeCanvas.height = 192;
  let baker;
  try {
    baker = new SkinViewer({
      canvas: bakeCanvas,
      width: 192,
      height: 192,
      model: resolveArmsModel(),
      enableControls: false,
      renderPaused: true,
      zoom: 0.82,
      preserveDrawingBuffer: true
    });
  } catch (e) {
    console.error('[skins] thumbnail baker failed:', e);
    return;
  }
  baker.controls.enableRotate = false;
  baker.controls.autoRotate = false;
  baker.playerWrapper.rotation.y = Math.PI / 8;
  (async () => {
    for (const skin of skins) {
      if (state.thumbs.has(skin.id) || !skin?.dataUrl) continue;
      try {
        await baker.loadSkin(skin.dataUrl, { model: resolveArmsModel() });
        baker.render();
        const dataUrl = bakeCanvas.toDataURL('image/png');
        if (dataUrl) {
          state.thumbs.set(skin.id, dataUrl);
          gridCardsFor(skin.id).forEach((c) => paintSnapshot(c, dataUrl));
        }
      } catch (e) {
        console.error('[skins] thumbnail bake failed for', skin?.name, e);
      }
    }
    try { baker.dispose(); } catch (e) {}
  })();
}

function gridCardsFor(skinId) {
  return Array.from(document.querySelectorAll(`.skin-card[data-id="${CSS.escape(skinId)}"] .skin-snap`));
}

function renderLibraryGrid() {
  const grid = document.getElementById('skins-grid');
  const count = document.getElementById('skin-library-count');
  if (!grid) return;
  disposeCardViewers();
  const isDefaultsTab = state.libraryTab === 'defaults';
  const skins = state.library
    .filter((s) => (isDefaultsTab ? s.builtin === true : s.builtin !== true))
    .slice()
    .sort((a, b) => isDefaultsTab
      ? String(a.name || '').localeCompare(String(b.name || ''))
      : String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
  if (count) {
    count.textContent = isDefaultsTab
      ? `${skins.length} defaults`
      : (skins.length ? `${skins.length} saved` : '');
  }

  grid.innerHTML = skins
    .map((s) => {
      const thumb = s.dataUrl || '';
      // Main viewer + 15 card viewers is the WebGL context ceiling — cards past #14 fall back to flat 2D thumbs.
      return `
        <article class="skin-card" data-id="${escapeHtml(s.id)}">
          <div class="skin-card-preview">
            ${thumb
              ? `<canvas class="skin-snap" role="img" aria-label="3D preview of ${escapeHtml(s.name)}"></canvas><canvas class="skin-live" aria-hidden="true"></canvas>`
              : '<div style="color:var(--text-muted);font-size:12px">Missing file</div>'}
          </div>
          <div class="skin-card-name skin-card-name-edit" title="Click to rename" data-act="rename">${escapeHtml(s.name)}</div>
          <div class="skin-card-meta">${escapeHtml(cardMetaLabel(s))}</div>
          <div class="skin-card-actions">
            <button type="button" class="btn btn-ghost skin-card-rename" data-act="rename" title="Rename" aria-label="Rename ${escapeHtml(s.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button type="button" class="btn btn-ghost skin-card-remove" data-act="remove" title="Remove from library" aria-label="Remove ${escapeHtml(s.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </article>`;
    })
    .join('');

  // Paint cached 3D snapshots immediately (session-persistent)
  for (const canvas of grid.querySelectorAll('.skin-snap')) {
    const id = canvas.closest('.skin-card')?.dataset.id;
    const cached = id ? state.thumbs.get(id) : null;
    if (cached) paintSnapshot(canvas, cached);
  }

  // Bake 3D snapshots for skins we don't have yet (single shared offscreen baker)
  bakeMissingThumbnails(skins);

  // Hover a card -> live spin; leave -> dispose and fall back to the snapshot
  for (const card of grid.querySelectorAll('.skin-card')) {
    card.addEventListener('mouseenter', () => attachHoverViewer(card));
    card.addEventListener('mouseleave', () => detachHoverViewer());
  }

  // Whole card applies the skin instantly (rename/remove buttons excluded)
  grid.querySelectorAll('.skin-card').forEach((card) => {
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('button, input, a, .skin-card-name-edit')) return;
      const id = card.dataset.id;
      setActiveLibrarySkin(id);
    });
  });
  grid.querySelectorAll('[data-act="remove"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.skin-card')?.dataset.id;
      removeLibrarySkin(id);
    });
  });
  grid.querySelectorAll('[data-act="rename"]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      const card = el.closest('.skin-card');
      const id = card?.dataset.id;
      startRenameSkin(id, card);
    });
  });
}

function startRenameSkin(id, card) {
  if (!id) return;
  const skin = state.library.find((s) => s.id === id);
  if (!skin || !card) return;
  const nameEl = card.querySelector('.skin-card-name');
  if (!nameEl || nameEl.querySelector('input')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'skin-rename-input';
  input.value = skin.name;
  input.maxLength = 80;
  input.setAttribute('aria-label', 'New skin name');
  nameEl.textContent = '';
  nameEl.classList.add('editing');
  nameEl.removeAttribute('data-act'); // don't re-trigger rename while editing
  nameEl.appendChild(input);

  const cancel = () => {
    nameEl.classList.remove('editing');
    nameEl.textContent = skin.name;
    nameEl.setAttribute('data-act', 'rename');
    nameEl.title = 'Click to rename';
  };
  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const next = input.value.trim().slice(0, 80);
    if (!next || next === skin.name) { cancel(); return; }
    const res = await window.zenon.skinRenameLibrarySkin({ id, name: next });
    if (res?.success) {
      skin.name = res.skin?.name || next;
      showToast(`Renamed to "${skin.name}"`, 'success');
      // Update the name element in place — avoids re-rendering viewers
      nameEl.classList.remove('editing');
      nameEl.textContent = skin.name;
      nameEl.title = 'Click to rename';
      nameEl.setAttribute('data-act', 'rename');
      nameEl.closest('.skin-card')?.setAttribute('aria-label', skin.name);
    } else {
      showToast(res?.error || 'Could not rename the skin.', 'error', 4500);
      cancel();
      return;
    }
    committed = false;
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); committed = true; cancel(); }
  });
  input.addEventListener('blur', commit);
  input.focus();
  input.select();
}

function currentVariantChoice() {
  const sel = document.getElementById('skin-animation-select');
  return sel?.value || 'idle';
}

async function ensureViewer() {
  const canvas = document.getElementById('skin-canvas');
  if (!canvas) return null;
  if (state.viewer) return state.viewer;
  try {
    const viewer = new SkinViewer({
      canvas,
      width: 1,
      height: 1,
      skin: undefined,
      model: 'default',
      zoom: 0.76
    });
    viewer.controls.autoRotate = false;
    viewer.controls.autoRotateSpeed = 2.2;
    viewer.controls.enableZoom = false;
    viewer.controls.enablePan = false;
    viewer.controls.minPolarAngle = Math.PI / 4.5;
    viewer.controls.maxPolarAngle = Math.PI / 1.8;
    viewer.animation = ANIMATION_CHOICES.idle();
    // Studio floor under the model (top face at foot level)
    try {
      if (!state.floor) state.floor = buildFloor();
      if (state.floor?.group) viewer.scene.add(state.floor.group);
    } catch (floorErr) {
      console.error('[skins] floor build failed:', floorErr);
    }
    state.viewer = viewer;
    window.__abandonSkinViewer = abandonViewer;
    window.__zenonSkinViewer = viewer;
    resizeViewer();
    return viewer;
  } catch (e) {
    console.error('[skins] viewer init failed:', e?.message || e, e?.stack);
    if (window) window.__skinsDebug = String(e?.message || e) + (e?.stack ? '\n' + String(e.stack).slice(0, 1200) : '');
    showToast('Could not start the 3D skin viewer: ' + (e?.message || 'unknown error'), 'error', 6000);
    return null;
  }
}

function resizeViewer() {
  const wrap = document.getElementById('skin-canvas-wrap');
  const viewer = state.viewer;
  if (!wrap || !viewer) return;
  const rect = wrap.getBoundingClientRect();
  const w = Math.max(220, Math.floor(rect.width));
  const h = Math.max(260, Math.floor(rect.height));
  if (typeof viewer.setSize === 'function') viewer.setSize(w, h);
  else {
    viewer.width = w;
    viewer.height = h;
    const canvas = document.getElementById('skin-canvas');
    if (canvas) { canvas.width = w; canvas.height = h; }
    viewer.renderer?.setSize?.(w, h);
  }
}

function loadSkinIntoViewer(url, variant, label) {
  const viewer = state.viewer;
  if (!viewer) return;
  state.currentSkinUrl = url;
  state.currentSkinVariant = variant;
  try {
    // Honour the arm-model preference (auto / classic / slim) instead of forcing auto-detect.
    viewer.loadSkin(url, { model: resolveArmsModel() });
  } catch (e) {
    console.error('[skins] loadSkin failed:', e);
    showToast('Could not load that skin into the 3D view.', 'error', 4000);
    return;
  }
  const nameEl = document.getElementById('skin-viewer-name');
  const variantEl = document.getElementById('skin-viewer-variant');
  if (nameEl) nameEl.textContent = label || state.profile?.name || 'Steve';
  if (variantEl) variantEl.textContent = effectiveArmsLabel(variant);
}

async function renderSkins() {
  const content = document.getElementById('main-content');
  if (!content) return;

  const hadViewer = !!state.viewer;
  if (state.viewer) abandonViewer();

  content.innerHTML = `
    <div class="page page-skins">
      <header class="page-header">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
          <div>
            <span class="page-kicker">Wardrobe</span>
            <h1 class="page-title">Skins</h1>
            <p class="page-subtitle">See your character in 3D, build a skin library, and push a new look to your Minecraft account — all without leaving Zenon.</p>
          </div>
          <button type="button" class="btn btn-primary btn-lg" id="skin-add-btn">Add skin <span class="arrow" aria-hidden="true">&#8599;</span></button>
        </div>
      </header>

      <div class="skins-split">
        <section class="skins-viewer-card">
          <div id="skin-canvas-wrap" class="skin-canvas-wrap">
            <canvas id="skin-canvas" aria-label="3D view of your Minecraft character"></canvas>
          </div>
          <div class="skin-viewer-footer">
            <div class="skin-viewer-name" id="skin-viewer-name">Loading…</div>
            <div class="skin-viewer-variant" id="skin-viewer-variant">SLIM</div>
          </div>
          <div class="skin-viewer-controls">
            <select id="skin-animation-select" class="form-select" aria-label="Animation">
              <option value="idle">Idle</option>
              <option value="walk">Walking</option>
              <option value="run">Running</option>
              <option value="wave">Wave</option>
              <option value="crouch">Crouch</option>
            </select>
            <div class="skin-arms-toggle" id="skin-arms-toggle" role="radiogroup" aria-label="Arm model">
              <span class="skin-arms-label">Arms</span>
              <button type="button" class="id-pill" data-arms="auto" role="radio" aria-checked="true">Auto</button>
              <button type="button" class="id-pill" data-arms="classic" role="radio" aria-checked="false">Classic</button>
              <button type="button" class="id-pill" data-arms="slim" role="radio" aria-checked="false">Slim</button>
            </div>
            <label class="skin-rotate-toggle" title="Slowly rotate the model"><input type="checkbox" id="skin-autorotate" /> Turntable</label>
          </div>
        </section>

        <section class="skins-side">
          <div class="card skin-current-card">
            <div class="section-kicker" style="margin-bottom:0">Currently wearing</div>
            <div class="skin-current-body" id="skin-current-body">
              <div class="skin-current-meta"><div class="skin-current-detail">Loading your Minecraft profile…</div></div>
            </div>
            <div class="skin-current-actions">
              <button type="button" class="btn btn-ghost" id="skin-save-current-btn" style="display:none">Save to library</button>
              <button type="button" class="btn btn-ghost" id="skin-refresh-btn">Refresh</button>
            </div>
          </div>

          <div class="card skins-library-card">
            <div class="section-kicker-row">
              <div class="section-kicker" style="margin-bottom:0">Your library</div>
              <span id="skin-library-count" class="skin-count"></span>
            </div>
            <div class="skins-library-tabs" id="skins-library-tabs" role="tablist" aria-label="Library filter">
              <button type="button" class="id-pill active" data-libtab="mine" role="tab" aria-selected="true">Mine</button>
              <button type="button" class="id-pill" data-libtab="defaults" role="tab" aria-selected="false">Defaults</button>
            </div>
            <div class="skins-grid" id="skins-grid"></div>
          </div>
        </section>
      </div>

      <input type="file" id="skin-file-input" accept="image/png" style="display:none" />
    </div>
  `;

  document.getElementById('skin-add-btn')?.addEventListener('click', () => {
    document.getElementById('skin-file-input')?.click();
  });
  document.getElementById('skin-file-input')?.addEventListener('change', onFilePicked);
  document.getElementById('skin-save-current-btn')?.addEventListener('click', saveCurrentToLibrary);
  document.getElementById('skin-refresh-btn')?.addEventListener('click', async () => {
    await refreshAll(true);
    showToast('Profile refreshed', 'success', 1500);
  });
  document.getElementById('skin-animation-select')?.addEventListener('change', (e) => {
    setViewerAnimation(e.target.value);
  });
  document.getElementById('skin-autorotate')?.addEventListener('change', (e) => {
    if (state.viewer?.controls) state.viewer.controls.autoRotate = !!e.target.checked;
  });
  document.getElementById('skin-arms-toggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-arms]');
    if (!btn) return;
    setModelPref(btn.getAttribute('data-arms'));
  });
  document.getElementById('skins-library-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-libtab]');
    if (!btn) return;
    setLibraryTab(btn.getAttribute('data-libtab'));
  });
  syncArmsToggle();
  syncLibraryTabs();

  await refreshAll();

  // Canvas resize — listen for window resizes while this page is visible
  window.addEventListener('resize', resizeViewer, { passive: true });
}

function setViewerAnimation(kind) {
  const viewer = state.viewer;
  if (!viewer) return;
  const make = ANIMATION_CHOICES[kind] || ANIMATION_CHOICES.idle;
  viewer.animation = make();
}

function syncArmsToggle() {
  document.querySelectorAll('#skin-arms-toggle [data-arms]').forEach((btn) => {
    const active = btn.getAttribute('data-arms') === state.modelPref;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', String(active));
  });
}

function setLibraryTab(tab) {
  if (tab !== 'mine' && tab !== 'defaults') tab = 'mine';
  if (state.libraryTab === tab) return;
  state.libraryTab = tab;
  try { localStorage.setItem('zenon-skin-library-tab', tab); } catch (e) {}
  syncLibraryTabs();
  renderLibraryGrid();
}

function syncLibraryTabs() {
  document.querySelectorAll('#skins-library-tabs [data-libtab]').forEach((btn) => {
    const active = btn.getAttribute('data-libtab') === state.libraryTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
}

function setModelPref(pref) {
  if (pref !== 'auto' && pref !== 'classic' && pref !== 'slim') pref = 'auto';
  if (pref === state.modelPref) return;
  state.modelPref = pref;
  try { localStorage.setItem('zenon-skin-model-arms', pref); } catch (e) {}
  state.thumbs.clear();
  detachHoverViewer();
  syncArmsToggle();
  // Reload the current skin with the new arm model
  const viewer = state.viewer;
  if (viewer && state.currentSkinUrl) {
    try {
      viewer.loadSkin(state.currentSkinUrl, { model: resolveArmsModel() });
    } catch (e) {
      console.error('[skins] arm reload failed:', e);
      showToast('Could not switch arm model.', 'error', 4000);
    }
    const variantEl = document.getElementById('skin-viewer-variant');
    if (variantEl) variantEl.textContent = effectiveArmsLabel(state.currentSkinVariant);
  }
  // Rebuild library previews with the same arm model
  if (state.library.length) renderLibraryGrid();
}

async function refreshAll(force = false) {
  await Promise.all([refreshProfile(force), refreshLibrary()]);
  renderCurrentCard();
  renderLibraryGrid();

  const viewer = await ensureViewer();
  if (!viewer) return;

  // Default view: whatever the profile wears; falling back to first library skin, then a placeholder.
  const cur = activeProfileSkin();
  if (state.previewingId) {
    const skin = state.library.find((s) => s.id === state.previewingId);
    if (skin?.dataUrl) loadSkinIntoViewer(skin.dataUrl, skin.variant, skin.name);
    return;
  }
  if (cur?.url) loadSkinIntoViewer(secureUrl(cur.url), cur.variant, state.profile?.name);
  else if (state.library[0]?.dataUrl) loadSkinIntoViewer(state.library[0].dataUrl, state.library[0].variant, state.library[0].name);
  else {
    const nameEl = document.getElementById('skin-viewer-name');
    if (nameEl) nameEl.textContent = 'No skin available';
    const variantEl = document.getElementById('skin-viewer-variant');
    if (variantEl) variantEl.textContent = '—';
  }
}

async function onFilePicked(e) {
  const input = e.target;
  const file = input?.files?.[0];
  if (!file) return;
  const ok = /\.png$/i.test(file.name) || file.type === 'image/png';
  if (!ok) { showToast('Skins must be PNG images.', 'error'); input.value = ''; return; }
  if (file.size > 1024 * 1024) { showToast('Skin file is too large (max 1 MB).', 'error'); input.value = ''; return; }
  try {
    const dataUrl = await fileToDataUrl(file);
    const base64 = dataUrl.split(',')[1] || '';
    const cleanName = file.name.replace(/\.png$/i, '').slice(0, 60) || 'Untitled skin';
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read the image'));
      img.src = dataUrl;
    });
    const variant = imageFileVariant(image);
    const res = await window.zenon.skinAddToLibrary({ name: cleanName, variant, base64 });
    if (res?.success) {
      showToast(`Added "${res.skin?.name || cleanName}" to your library`, 'success');
      await refreshLibrary();
      renderLibraryGrid();
      previewLibrarySkin(res.skin?.id);
    } else {
      showToast(res?.error || 'Could not add that skin.', 'error', 4500);
    }
  } catch (err) {
    showToast(err?.message || 'Could not read the skin file.', 'error', 4500);
  } finally {
    input.value = '';
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

// Detect slim vs classic from the PNG's arm pixels using skinview-utils.
function imageFileVariant(image) {
  try {
    const canvas = document.createElement('canvas');
    loadSkinToCanvas(canvas, image);
    const model = inferModelType(canvas);
    return model === 'slim' ? 'SLIM' : 'CLASSIC';
  } catch (e) {
    return 'CLASSIC';
  }
}

async function saveCurrentToLibrary() {
  const cur = activeProfileSkin();
  if (!cur?.url) { showToast('No active skin to save.', 'error'); return; }
  const name = `${state.profile?.name || 'Steve'} (current)`;
  const res = await window.zenon.skinSaveCurrentToLibrary({
    name,
    variant: variantOf(cur.variant),
    url: secureUrl(cur.url)
  });
  if (res?.success) {
    showToast('Saved your current skin to the library', 'success');
    await refreshLibrary();
    renderLibraryGrid();
    previewLibrarySkin(res.skin?.id);
  } else {
    showToast(res?.error || 'Could not save the skin.', 'error', 4500);
  }
}

function previewLibrarySkin(id) {
  const skin = state.library.find((s) => s.id === id);
  if (!skin?.dataUrl) { showToast('Skin file missing from the library folder.', 'error'); return; }
  state.previewingId = id;
  const viewer = state.viewer;
  if (viewer) loadSkinIntoViewer(skin.dataUrl, skin.variant, skin.name);
  else ensureViewer().then(() => loadSkinIntoViewer(skin.dataUrl, skin.variant, skin.name));
}

async function setActiveLibrarySkin(id) {
  const skin = state.library.find((s) => s.id === id);
  if (!skin) { showToast('Skin not found.', 'error'); return; }
  if (state.busy) return;
  state.busy = true;
  try {
    const res = await window.zenon.skinApply({ source: 'library', id: skin.id, variant: variantOf(skin.variant) });
    if (res?.success) {
      showToast(`"${skin.name}" is now your skin`, 'success');
      await refreshAll();
    } else {
      showToast(res?.error || 'Could not set the skin.', 'error', 6000);
    }
  } finally {
    state.busy = false;
  }
}

async function removeLibrarySkin(id) {
  const skin = state.library.find((s) => s.id === id);
  if (!skin) return;
  const ok = await showConfirm({
    title: 'Remove from library',
    message: `Remove "${skin.name}" from your local library? Your Minecraft account skin is not affected.`,
    confirmLabel: 'Remove',
    danger: true
  });
  if (!ok) return;
  const res = await window.zenon.skinRemoveFromLibrary(id);
  if (res?.success) {
    if (state.previewingId === id) state.previewingId = null;
    showToast('Removed from library', 'info');
    await refreshLibrary();
    renderLibraryGrid();
  } else {
    showToast(res?.error || 'Could not remove the skin.', 'error', 4500);
  }
}

function abandonViewer() {
  disposeCardViewers();
  disposeCurrentMiniViewer();
  if (state.floor) {
    try { if (state.viewer?.scene) state.viewer.scene.remove(state.floor.group); } catch (e) {}
    try { state.floor.dispose(); } catch (e) {}
    state.floor = null;
  }
  if (!state.viewer) {
    if (window) window.__zenonSkinViewer = null;
    return;
  }
  try { state.viewer.dispose(); } catch (e) {}
  state.viewer = null;
  if (window) window.__zenonSkinViewer = null;
  window.removeEventListener('resize', resizeViewer);
  state.previewingId = null;
}

window.renderSkins = renderSkins;
