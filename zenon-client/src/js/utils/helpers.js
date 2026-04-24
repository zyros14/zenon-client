// ===== Utility Helpers =====

// Re-export escapeHtml if not already defined globally
if (typeof window.escapeHtml === 'undefined') {
  window.escapeHtml = function(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  };
}

// Debounce
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Truncate text
function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

// Copy to clipboard
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}

// ===== UI Sounds (no external assets) =====
let __zenonAudioCtx = null;
function zenonGetAudioCtx() {
  if (__zenonAudioCtx) return __zenonAudioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  __zenonAudioCtx = new Ctx();
  return __zenonAudioCtx;
}

function zenonBeep({ freq = 440, durMs = 45, vol = 0.03, type = 'sine' } = {}) {
  const ctx = zenonGetAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g);
    g.connect(ctx.destination);
    const now = ctx.currentTime;
    o.start(now);
    o.stop(now + durMs / 1000);
  } catch (e) {}
}

function __zenonRand(min, max) {
  const a = Number(min) || 0;
  const b = Number(max) || 0;
  return a + Math.random() * (b - a);
}

window.zenonSound = {
  // Small random range so it doesn't feel repetitive.
  click: () => zenonBeep({ freq: __zenonRand(500, 545), durMs: __zenonRand(18, 26), vol: 0.02, type: 'triangle' }),
  hover: () => zenonBeep({ freq: __zenonRand(405, 435), durMs: __zenonRand(14, 19), vol: 0.012, type: 'sine' }),
  success: () => { zenonBeep({ freq: 740, durMs: 35, vol: 0.03, type: 'sine' }); setTimeout(() => zenonBeep({ freq: 980, durMs: 45, vol: 0.03, type: 'sine' }), 40); },
  error: () => zenonBeep({ freq: 180, durMs: 70, vol: 0.035, type: 'sawtooth' })
};

// ===== Lightweight activity feed (local-only) =====
function __zenonActivityKey() {
  return 'zenon.activity.v1';
}

function __zenonReadActivity() {
  try {
    const raw = localStorage.getItem(__zenonActivityKey());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function __zenonWriteActivity(items) {
  try {
    localStorage.setItem(__zenonActivityKey(), JSON.stringify(items));
  } catch (e) {}
}

function __zenonAgo(ts) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 10_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

window.zenonActivity = {
  add: (text, kind = 'info') => {
    if (!window.__zenonRecentActionsEnabled) return;
    const msg = String(text || '').trim();
    if (!msg) return;
    const item = { t: Date.now(), kind: String(kind || 'info'), text: msg };
    const cur = __zenonReadActivity();
    const next = [item, ...cur].slice(0, 12);
    __zenonWriteActivity(next);
  },
  list: (limit = 6) => (window.__zenonRecentActionsEnabled ? __zenonReadActivity().slice(0, Math.max(0, Math.min(20, Number(limit) || 0))) : []),
  ago: (ts) => __zenonAgo(ts)
};

// Format play time
function formatPlayTime(seconds) {
  if (!seconds || seconds < 60) return 'Less than a minute';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
