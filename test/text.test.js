const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../main/lib/text');

function makeJwt(payload) {
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'none' })}.${b64url(payload)}.signature`;
}

test('normalizeInstanceDisplayName strips control chars, collapses newlines and spaces', () => {
  assert.equal(normalizeInstanceDisplayName('My\u0001Instance'), 'MyInstance');
  assert.equal(normalizeInstanceDisplayName('a\n\nb   c'), 'a b c');
  assert.equal(normalizeInstanceDisplayName('\r\n\r\n'), 'Instance');
  assert.equal(normalizeInstanceDisplayName('', 'Fallback'), 'Fallback');
  assert.equal(normalizeInstanceDisplayName(null), 'Instance');
  assert.equal(normalizeInstanceDisplayName('x'.repeat(200)).length, 80);
});

test('normalizeIconExt maps mimes/extensions to canonical ext', () => {
  assert.equal(normalizeIconExt('image/png'), 'png');
  assert.equal(normalizeIconExt('image/jpeg'), 'jpg');
  assert.equal(normalizeIconExt('image/webp'), 'webp');
  assert.equal(normalizeIconExt('.PNG'), 'png');
  assert.equal(normalizeIconExt('weird'), 'png');
});

test('iconRelPathForExt builds the .zenon relative path', () => {
  assert.equal(iconRelPathForExt('png'), '.zenon/icon.png');
  assert.equal(iconRelPathForExt('jpg'), '.zenon/icon.jpg');
});

test('normalizeDisplayName strips loader/archive suffixes', () => {
  assert.equal(normalizeDisplayName('sodium-fabric-0.6.0.jar'), 'sodium-fabric-0.6.0');
  assert.equal(normalizeDisplayName('mod.jar.disabled'), 'mod');
  assert.equal(normalizeDisplayName('pack.zip'), 'pack');
  assert.equal(normalizeDisplayName('modpack.mrpack'), 'modpack');
});

test('stripMcFormatting removes § formatting codes', () => {
  assert.equal(stripMcFormatting('§eHello §lWorld§r'), 'Hello World');
  assert.equal(stripMcFormatting(null), '');
});

test('cleanPlayerToken extracts the player name from captured log groups', () => {
  // In the real flow the name group is extracted by a regex before this is applied.
  assert.equal(cleanPlayerToken('Steve'), 'Steve');
  assert.equal(cleanPlayerToken('§eSteve§r'), 'Steve');
  assert.equal(cleanPlayerToken('Steve lost connection: Disconnected'), 'Steve');
  assert.equal(cleanPlayerToken('There are 3 of a max of 20 players online:'), '');
  assert.equal(cleanPlayerToken(''), '');
});

test('sanitizeJarBaseName removes illegal filename characters', () => {
  assert.equal(sanitizeJarBaseName('My/Plugin: v2'), 'My_Plugin_ v2');
  assert.equal(sanitizeJarBaseName('   '), 'plugin');
  assert.equal(sanitizeJarBaseName('a'.repeat(200)).length, 80);
  assert.equal(sanitizeJarBaseName('ke\u0000ep'), 'keep');
});

test('jwtPayloadB64 decodes base64url payloads (with/without padding)', () => {
  const payload = { sub: 'abc123', name: 'Tester' };
  const b64url = Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.deepEqual(JSON.parse(jwtPayloadB64(b64url)), payload);
});

test('normalizeUuidString accepts dashed/undashed/urn UUIDs and rejects junk', () => {
  const dashed = '01234567-89ab-cdef-0123-456789abcdef';
  assert.equal(normalizeUuidString(dashed), dashed);
  assert.equal(normalizeUuidString('0123456789abcdef0123456789abcdef'), dashed);
  assert.equal(normalizeUuidString(`urn:uuid:${dashed}`), dashed);
  assert.equal(normalizeUuidString('not-a-uuid'), null);
  assert.equal(normalizeUuidString(null), null);
  assert.equal(normalizeUuidString(42), null);
});

test('profileFromMinecraftResponse prefers the profile block when present', () => {
  const mc = { token: 'x.y.z', profile: { id: '0123456789abcdef0123456789abcdef', name: 'Zen' } };
  assert.deepEqual(profileFromMinecraftResponse(mc), { id: '01234567-89ab-cdef-0123-456789abcdef', name: 'Zen' });
});

test('profileFromMinecraftResponse falls back to JWT claims', () => {
  const token = makeJwt({ name: 'JwtPlayer', uuid: '01234567-89ab-cdef-0123-456789abcdef' });
  assert.deepEqual(profileFromMinecraftResponse({ token }), { id: '01234567-89ab-cdef-0123-456789abcdef', name: 'JwtPlayer' });
});

test('profileFromMinecraftResponse returns null without a token', () => {
  assert.equal(profileFromMinecraftResponse(null), null);
  assert.equal(profileFromMinecraftResponse({}), null);
});

test('isValidSkinPng enforces magic bytes and Minecraft canvas sizes', () => {
  const mk = (w, h) => {
    const b = Buffer.alloc(256);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  assert.deepEqual(isValidSkinPng(mk(64, 64)), { width: 64, height: 64 });
  assert.deepEqual(isValidSkinPng(mk(64, 32)), { width: 64, height: 32 });
  assert.deepEqual(isValidSkinPng(mk(128, 128)), { width: 128, height: 128 });
  assert.equal(isValidSkinPng(mk(32, 32)), null);
  assert.equal(isValidSkinPng(Buffer.alloc(10)), null);
  assert.equal(isValidSkinPng('not a buffer'), null);
});
