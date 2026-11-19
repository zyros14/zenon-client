// ===== Zenon Sigils — built-in SVG avatars for instances =====
// Our own asset set (no third-party art). Each sigil is a self-contained inline SVG:
// rounded-square gradient tile + geometric glyph. Icons are stored on the instance as
// `svg:<id>` (e.g. `svg:nova`). A per-instance default is picked deterministically
// from the instance id, so the default stays stable without storing anything.
(function () {
  const I = (id, name, stops, inner) => ({
    id,
    name,
    svg: `<svg class="instance-icon-img instance-icon-svg" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${name}"><defs><linearGradient id="sigil-${id}-bg" x1="0" y1="0" x2="1" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient></defs><rect width="48" height="48" rx="10" fill="url(#sigil-${id}-bg)"/>${inner}</svg>`
  });

  const ICONS = [
    I('core', 'Core', [['0', '#8b3dff'], ['1', '#5b21e6']],
      '<circle cx="24" cy="24" r="9.5" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.9"/><circle cx="24" cy="24" r="4" fill="#ffffff"/>'),
    I('orbit', 'Orbit', [['0', '#4338ca'], ['1', '#7c3aed']],
      '<circle cx="24" cy="24" r="6" fill="#ffffff"/><ellipse cx="24" cy="24" rx="15" ry="6.5" fill="none" stroke="#ffffff" stroke-width="2.4" opacity="0.85" transform="rotate(-24 24 24)"/>'),
    I('prism', 'Prism', [['0', '#7c3aed'], ['1', '#22d3ee']],
      '<path d="M24 8 L40 38 H8 Z" fill="none" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/><path d="M24 20 L32 35 H16 Z" fill="#ffffff" opacity="0.55"/>'),
    I('nova', 'Nova', [['0', '#d946ef'], ['1', '#8b3dff']],
      '<path d="M24 7 L28.5 19.5 L41 24 L28.5 28.5 L24 41 L19.5 28.5 L7 24 L19.5 19.5 Z" fill="#ffffff" opacity="0.95"/>'),
    I('halo', 'Halo', [['0', '#34d399'], ['1', '#0d9488']],
      '<circle cx="24" cy="24" r="11.5" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.95"/><circle cx="24" cy="10" r="2.2" fill="#ffffff"/>'),
    I('ember', 'Ember', [['0', '#8b3dff'], ['1', '#fb923c']],
      '<path d="M13 22 L24 12 L35 22" fill="none" stroke="#ffffff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 31 L24 21 L35 31" fill="none" stroke="#ffffff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.65"/>'),
    I('comet', 'Comet', [['0', '#1e1b4b'], ['1', '#6d28d9']],
      '<circle cx="31" cy="16" r="6.5" fill="#ffffff"/><path d="M25 23 L10 38" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.85"/><path d="M31 26 L17 40" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" opacity="0.5"/><path d="M25 16 L12 29" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" opacity="0.5"/>'),
    I('hex', 'Hex', [['0', '#334155'], ['1', '#7c3aed']],
      '<path d="M24 6 L39 15 V33 L24 42 L9 33 V15 Z" fill="none" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/><circle cx="24" cy="24" r="3.6" fill="#ffffff"/>')
  ];

  const BY_ID = new Map(ICONS.map((i) => [i.id, i]));

  function isIconId(v) { return typeof v === 'string' && BY_ID.has(v); }
  function svgFor(id) { return BY_ID.get(id)?.svg || ''; }
  /** Stable hash → icon id (same instance always gets the same sigil). */
  function defaultFor(seed) {
    const s = String(seed || 'zenon');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return ICONS[h % ICONS.length].id;
  }
  /** Resolve an instance's icon id to svg markup ('default'/unknown → hash of the seed). */
  function svgForInstance(icon, seed) {
    if (isIconId(icon)) return svgFor(icon);
    return svgFor(defaultFor(seed));
  }

  window.ZenonInstanceIcons = { ICONS, isIconId, svgFor, defaultFor, svgForInstance };
})();
