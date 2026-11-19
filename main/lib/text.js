/**
 * Pure string / data helpers shared across the main process.
 * No Electron or app-state dependencies — safe to unit-test.
 */

/** Instance display name (folders are UUIDs): permissive, strips control chars, collapses newlines. */
function normalizeInstanceDisplayName(raw, fallback = 'Instance') {
  let s = String(raw == null ? '' : raw)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n+/g, ' '); // newlines become spaces before control chars vanish
  s = s.replace(/[\u0000-\u001f\u007f]/g, ''); // control chars
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (!s) s = String(fallback || 'Instance');
  return s.slice(0, 80);
}

function normalizeIconExt(extOrMime) {
  const s = String(extOrMime || '').toLowerCase().trim();
  if (s.includes('png') || s === '.png') return 'png';
  if (s.includes('jpeg') || s.includes('jpg') || s === '.jpg' || s === '.jpeg') return 'jpg';
  if (s.includes('webp') || s === '.webp') return 'webp';
  return 'png';
}

function iconRelPathForExt(ext) {
  return `.zenon/icon.${ext}`;
}

/** "mod.jar.disabled" | "mod.jar" | "pack.zip" → base display name. */
function normalizeDisplayName(filename) {
  return String(filename || '')
    .replace('.disabled', '')
    .replace(/\.jar$/i, '')
    .replace(/\.zip$/i, '')
    .replace(/\.mrpack$/i, '');
}

/** Strip Minecraft formatting codes (§e, §l, …) from a server log line. */
function stripMcFormatting(s) {
  return String(s || '').replace(/§[0-9a-fk-or]/gi, '');
}

/** First token of a player name in a server log line, minus brackets/noise. */
function cleanPlayerToken(raw) {
  let s = stripMcFormatting(String(raw || '').trim());
  s = s.replace(/^\[[^\]]*]\s*/, '').trim();
  const lost = s.match(/^(.+?)\s+lost connection:/i);
  if (lost) s = lost[1].trim();
  if (!s) return '';
  if (/^There are\b/i.test(s)) return '';
  const parts = s.split(/\s+/);
  return parts[0].replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/g, '') || parts[0];
}

/** Strip characters that are illegal/unsafe in plugin jar filenames. */
function sanitizeJarBaseName(raw) {
  const s = String(raw || '').trim() || 'plugin';
  return s
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'plugin';
}

/** Decode the payload segment of a JWT (no signature verification — we only read claims). */
function jwtPayloadB64(b64url) {
  const b64 = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return Buffer.from(b64 + pad, 'base64').toString('utf8');
}

/** Normalize a Minecraft UUID (with/without dashes, urn: prefix) or return null. */
function normalizeUuidString(uuid) {
  if (!uuid || typeof uuid !== 'string') return null;
  let u = uuid.startsWith('urn:uuid:') ? uuid.slice('urn:uuid:'.length) : uuid;
  if (u.includes('-') === false && u.length === 32) {
    u = `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`;
  }
  return /^[0-9a-f-]{36}$/i.test(u) ? u : null;
}

/**
 * Best-effort { id, name } profile from a Minecraft services/auth token response.
 * Falls back to decoding the access-token JWT claims when the profile block is missing.
 */
function profileFromMinecraftResponse(mc) {
  if (!mc?.token) return null;
  const id = mc.profile?.id;
  const name = mc.profile?.name;
  if (id && name) return { id: normalizeUuidString(String(id)) || String(id), name: String(name) };
  try {
    const parts = mc.token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(jwtPayloadB64(parts[1]));
    const mcEmb = payload.minecraft;
    if (mcEmb && typeof mcEmb === 'object') {
      const nm = mcEmb.username || mcEmb.name || mcEmb.displayName;
      let uid = mcEmb.id || mcEmb.uuid || mcEmb.profileId;
      if (nm && uid) {
        uid = normalizeUuidString(String(uid)) || String(uid);
        return { id: uid, name: String(nm) };
      }
    }
    const n =
      name ||
      payload.name ||
      payload.username ||
      payload.playerName ||
      payload.ign ||
      payload.gamertag ||
      (typeof payload.preferred_username === 'string' && payload.preferred_username.includes('@')
        ? payload.preferred_username.split('@')[0]
        : payload.preferred_username) ||
      payload?.profile?.name ||
      payload?.minecraft?.username;
    let uuid =
      id ||
      payload.uuid ||
      payload.yuid ||
      payload?.minecraft?.id ||
      payload?.profile?.id ||
      payload?.profile?.uuid ||
      payload.sub;
    if (uuid && typeof uuid !== 'string') return null;
    uuid = normalizeUuidString(uuid);
    if (n && uuid) return { id: uuid, name: String(n) };
    if (n && payload.sub && typeof payload.sub === 'string' && payload.sub.length >= 32) {
      const u2 = normalizeUuidString(payload.sub) || normalizeUuidString(payload.sub.replace(/-/g, ''));
      if (u2) return { id: u2, name: String(n) };
    }
  } catch (e) {}
  return null;
}

/** Validate a Minecraft skin PNG buffer; returns { width, height } or null. */
function isValidSkinPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 200) return null;
  // PNG magic
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.compare(PNG_MAGIC, 0, 8, 0, 8) !== 0) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  // Minecraft skin canvases: legacy 64x32, modern 64x64; 2x 128x64/128x128 also accepted
  const okDims =
    (width === 64 && (height === 64 || height === 32)) ||
    (width === 128 && (height === 128 || height === 64));
  if (!okDims) return null;
  return { width, height };
}

module.exports = {
  normalizeInstanceDisplayName,
  normalizeIconExt,
  iconRelPathForExt,
  normalizeDisplayName,
  stripMcFormatting,
  cleanPlayerToken,
  sanitizeJarBaseName,
  jwtPayloadB64,
  normalizeUuidString,
  profileFromMinecraftResponse,
  isValidSkinPng
};
