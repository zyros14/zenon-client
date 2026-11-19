const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  isSnapshotLikeMcVersion,
  resolveVersionTypeFromManifest,
  compareForgeFullIdDesc,
  forgeMcVersionFallbacks,
  guessRequiredJavaMajor,
  fabricCustomVersionId,
  parseMcVersionFromModrinthDep,
  loaderFromMrpackDependencies,
  modrinthVersionCompatible,
  safeJoinUnderInstanceRoot
} = require('../main/lib/versions');

const manifest = {
  versions: [
    { id: '1.20.4', type: 'release' },
    { id: '24w14a', type: 'snapshot' },
    { id: '1.21.4', type: 'release' }
  ]
};

test('isSnapshotLikeMcVersion prefers the manifest type, falls back to id heuristics', () => {
  assert.equal(isSnapshotLikeMcVersion('24w14a', manifest), true);
  assert.equal(isSnapshotLikeMcVersion('1.20.4', manifest), false);
  assert.equal(isSnapshotLikeMcVersion('1.21.5-rc1', null), true);
  assert.equal(isSnapshotLikeMcVersion('25w02a', null), true);
  assert.equal(isSnapshotLikeMcVersion('1.20.4', null), false);
  assert.equal(isSnapshotLikeMcVersion('', manifest), false);
});

test('resolveVersionTypeFromManifest returns the type with fallback', () => {
  assert.equal(resolveVersionTypeFromManifest(manifest, '24w14a'), 'snapshot');
  assert.equal(resolveVersionTypeFromManifest(manifest, '1.20.4'), 'release');
  assert.equal(resolveVersionTypeFromManifest(manifest, 'mystery-build'), 'release');
  assert.equal(resolveVersionTypeFromManifest(null, 'x', 'snapshot'), 'snapshot');
});

test('compareForgeFullIdDesc orders newest forge builds first (descending)', () => {
  const ids = ['1.20.1-47.3.0', '1.20.1-47.1.0', '1.20.1-47.10.0'];
  assert.deepEqual([...ids].sort(compareForgeFullIdDesc), ['1.20.1-47.10.0', '1.20.1-47.3.0', '1.20.1-47.1.0']);
});

test('forgeMcVersionFallbacks keeps the raw id and strips snapshot suffixes', () => {
  assert.deepEqual(forgeMcVersionFallbacks('1.21.10-rc1'), ['1.21.10-rc1', '1.21.10']);
  assert.deepEqual(forgeMcVersionFallbacks('1.21.10-pre2'), ['1.21.10-pre2', '1.21.10']);
  assert.deepEqual(forgeMcVersionFallbacks('25w02a'), ['25w02a']); // not a dotted pre-release id
  assert.deepEqual(forgeMcVersionFallbacks('1.20.4'), ['1.20.4']);
  assert.deepEqual(forgeMcVersionFallbacks(''), []);
});

test('guessRequiredJavaMajor covers the documented buckets', () => {
  assert.equal(guessRequiredJavaMajor('26.3'), 25);
  assert.equal(guessRequiredJavaMajor('1.21.4'), 21);
  assert.equal(guessRequiredJavaMajor('1.20.5'), 21);
  assert.equal(guessRequiredJavaMajor('1.20.4'), 17);
  assert.equal(guessRequiredJavaMajor('1.18.2'), 17);
  assert.equal(guessRequiredJavaMajor('1.17'), 17);
  assert.equal(guessRequiredJavaMajor('1.16.5'), 8);
  assert.equal(guessRequiredJavaMajor('garbage'), 8);
});

test('fabricCustomVersionId builds the MCLC custom id', () => {
  assert.equal(fabricCustomVersionId('0.16.10', '1.21.4'), 'fabric-loader-0.16.10-1.21.4');
});

test('parseMcVersionFromModrinthDep handles strings and objects', () => {
  assert.equal(parseMcVersionFromModrinthDep('>=1.20.4'), '1.20.4');
  assert.equal(parseMcVersionFromModrinthDep('1.21.4'), '1.21.4');
  assert.equal(parseMcVersionFromModrinthDep({ version: '~1.20.1' }), '1.20.1');
  assert.equal(parseMcVersionFromModrinthDep(null), '');
  assert.equal(parseMcVersionFromModrinthDep({}), '');
});

test('loaderFromMrpackDependencies detects loader pins', () => {
  assert.equal(loaderFromMrpackDependencies({ 'fabric-loader': '0.16.10' }), 'fabric');
  assert.equal(loaderFromMrpackDependencies({ 'quilt-loader': '0.26.0' }), 'quilt');
  assert.equal(loaderFromMrpackDependencies({ neoforge: '21.0.0' }), 'neoforge');
  assert.equal(loaderFromMrpackDependencies({ forge: '47.1.0' }), 'forge');
  assert.equal(loaderFromMrpackDependencies({}), 'vanilla');
  assert.equal(loaderFromMrpackDependencies(null), 'vanilla');
});

test('modrinthVersionCompatible filters by game version and loader', () => {
  const v = { game_versions: ['1.21.4'], loaders: ['fabric'] };
  assert.equal(modrinthVersionCompatible(v, '1.21.4', 'fabric'), true);
  assert.equal(modrinthVersionCompatible(v, '1.20.4', 'fabric'), false);
  assert.equal(modrinthVersionCompatible(v, '1.21.4', 'forge'), false);
  assert.equal(modrinthVersionCompatible(v, '', ''), true);
  assert.equal(modrinthVersionCompatible(null, '1.21.4', 'fabric'), false);
  // Missing arrays on the version entry do not block it.
  assert.equal(modrinthVersionCompatible({}, '1.21.4', 'fabric'), true);
});

test('safeJoinUnderInstanceRoot accepts sane rel paths and rejects escapes', () => {
  const root = path.join('C:', 'instances', 'test');
  const ok = safeJoinUnderInstanceRoot(root, 'mods/sodium.jar');
  assert.equal(ok, path.resolve(path.join(root, 'mods/sodium.jar')));
  assert.throws(() => safeJoinUnderInstanceRoot(root, '../escape.jar'), /Invalid path|Invalid path in modpack/);
  assert.throws(() => safeJoinUnderInstanceRoot(root, 'a/../../escape.jar'), /Invalid path/);
  assert.throws(() => safeJoinUnderInstanceRoot(root, ''), /Invalid path/);
  // Absolute-looking paths must never escape the instance root (on Windows they
  // resolve to a nested folder — still contained).
  const abs = safeJoinUnderInstanceRoot(root, 'C:/windows/system32/x.dll');
  assert.ok(abs.startsWith(path.resolve(root)), `resolved path ${abs} stays under root`);
});
