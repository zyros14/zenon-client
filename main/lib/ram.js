/**
 * RAM helpers shared by settings defaults, the launcher and the servers runtime.
 * Pure Node (no Electron) so they can be unit-tested.
 */
const os = require('os');

/** Total physical RAM (MB) — drives RAM allocation limits everywhere in the launcher. */
const TOTAL_RAM_MB = Math.max(1024, Math.floor(os.totalmem() / (1024 * 1024)));

/** Sensible default allocation: 1/4 of system RAM, clamped to 2–16 GB. */
function recommendedMaxRamMb() {
  return Math.min(16384, Math.max(2048, Math.round(TOTAL_RAM_MB / 4 / 512) * 512));
}

/** Clamp a RAM value (MB) to the range the launcher allows: 512 MB … total system RAM. */
function clampRamMb(mb, fallback = 2048) {
  const n = parseInt(String(mb ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(TOTAL_RAM_MB, Math.max(512, n));
}

/** "4G" | "4096M" | 4096 → MB. Returns 0 when unparseable. */
function parseRamStringToMb(s) {
  if (!s) return 0;
  const t = String(s).trim().toUpperCase();
  const gm = t.match(/^([\d.]+)\s*G$/);
  if (gm) return Math.round(parseFloat(gm[1]) * 1024);
  const mm = t.match(/^([\d.]+)\s*M$/);
  if (mm) return Math.round(parseFloat(mm[1]));
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** MB → compact label, e.g. 4096 → "4G", 1536 → "1536M". */
function mbToRamLabel(mb) {
  const v = Math.round(Number(mb) || 0);
  if (v <= 0) return '2G';
  if (v % 1024 === 0) return `${v / 1024}G`;
  return `${v}M`;
}

module.exports = {
  TOTAL_RAM_MB,
  recommendedMaxRamMb,
  clampRamMb,
  parseRamStringToMb,
  mbToRamLabel
};
