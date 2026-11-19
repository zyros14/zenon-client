const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const AdmZip = require('adm-zip');
const {
  normalizeName,
  readJarModId,
  findCrashSuspects,
  sha1OfFile
} = require('../main/mod-intelligence');

test('normalizeName strips non-alphanumerics and lowercases', () => {
  assert.equal(normalizeName('Sodium-Fabric 1.20.1'), 'sodiumfabric1201');
  assert.equal(normalizeName(''), '');
  assert.equal(normalizeName('___'), '');
});

test('readJarModId reads fabric.mod.json id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenon-mi-'));
  const jar = path.join(dir, 'sodium.jar');
  const zip = new AdmZip();
  zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'sodium', version: '0.5.0' })));
  zip.writeZip(jar);
  assert.equal(readJarModId(jar), 'sodium');
  fs.removeSync(dir);
});

test('readJarModId reads mods.toml modId', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenon-mi-'));
  const jar = path.join(dir, 'forgemod.jar');
  const zip = new AdmZip();
  zip.addFile('META-INF/mods.toml', Buffer.from('modId = "forge_mod"\nversion = "1.0"\n'));
  zip.writeZip(jar);
  assert.equal(readJarModId(jar), 'forge_mod');
  fs.removeSync(dir);
});

test('readJarModId returns null for non-zip / missing metadata', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenon-mi-'));
  const notJar = path.join(dir, 'not.jar');
  fs.writeFileSync(notJar, 'not a zip');
  assert.equal(readJarModId(notJar), null);
  fs.removeSync(dir);
});

test('sha1OfFile is deterministic and lowercase hex', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenon-mi-'));
  const f = path.join(dir, 'a.txt');
  fs.writeFileSync(f, 'hello');
  const h = sha1OfFile(f);
  assert.equal(h, sha1OfFile(f));
  assert.equal(/^[0-9a-f]{40}$/.test(h), true);
  fs.removeSync(dir);
});

test('findCrashSuspects returns nothing for a clean log', () => {
  const mods = [{ filename: 'sodium.jar', title: 'Sodium', projectId: 'sodium', modId: 'sodium' }];
  assert.deepEqual(findCrashSuspects(mods, 'INFO: Game started fine\n'), []);
});

test('findCrashSuspects flags a mod named in an exception line', () => {
  const mods = [
    { filename: 'sodium.jar', title: 'Sodium', projectId: 'sodium', modId: 'sodium' },
    { filename: 'iris.jar', title: 'Iris', projectId: 'iris', modId: 'iris' }
  ];
  const log = '20:00 ERROR Sodium caused a crash\nat com.example.sodium.Main\n20:01 INFO unrelated\n';
  const suspects = findCrashSuspects(mods, log);
  assert.equal(suspects.length, 1);
  assert.equal(suspects[0].mod.filename, 'sodium.jar');
  assert.ok(suspects[0].evidence.length > 0);
  assert.ok(['low', 'medium', 'high'].includes(suspects[0].confidence));
});
