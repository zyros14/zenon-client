const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const {
  TOTAL_RAM_MB,
  recommendedMaxRamMb,
  clampRamMb,
  parseRamStringToMb,
  mbToRamLabel
} = require('../main/lib/ram');

test('TOTAL_RAM_MB reflects the machine and is at least 1 GB', () => {
  const expected = Math.max(1024, Math.floor(os.totalmem() / (1024 * 1024)));
  assert.equal(TOTAL_RAM_MB, expected);
});

test('recommendedMaxRamMb stays within 2–16 GB and sane for the host', () => {
  const rec = recommendedMaxRamMb();
  assert.ok(rec >= 2048, `rec ${rec} >= 2048`);
  assert.ok(rec <= 16384, `rec ${rec} <= 16384`);
});

test('clampRamMb clamps to [512, TOTAL_RAM_MB] and honors the fallback', () => {
  assert.equal(clampRamMb(256), 512);
  assert.equal(clampRamMb(2048), 2048);
  assert.equal(clampRamMb(TOTAL_RAM_MB + 10 * 1024), TOTAL_RAM_MB);
  assert.equal(clampRamMb('garbage', 1234), 1234);
  assert.equal(clampRamMb(undefined, 4096), 4096);
  assert.equal(clampRamMb(0, 4096), 4096);
});

test('parseRamStringToMb parses G/M suffixes and bare numbers', () => {
  assert.equal(parseRamStringToMb('4G'), 4096);
  assert.equal(parseRamStringToMb('1.5G'), 1536);
  assert.equal(parseRamStringToMb('2048M'), 2048);
  assert.equal(parseRamStringToMb('512'), 512);
  assert.equal(parseRamStringToMb('2g'), 2048); // case-insensitive
  assert.equal(parseRamStringToMb('  3G  '), 3072);
  assert.equal(parseRamStringToMb(''), 0);
  assert.equal(parseRamStringToMb('nonsense'), 0);
  assert.equal(parseRamStringToMb(null), 0);
});

test('mbToRamLabel formats GB when divisible, MB otherwise', () => {
  assert.equal(mbToRamLabel(4096), '4G');
  assert.equal(mbToRamLabel(1024), '1G');
  assert.equal(mbToRamLabel(1536), '1536M');
  assert.equal(mbToRamLabel(2048), '2G');
  assert.equal(mbToRamLabel(0), '2G'); // degenerate input → documented default
});

test('round-trip: parse → label → parse is stable for GB values', () => {
  for (const mb of [2048, 4096, 8192, 16384]) {
    assert.equal(parseRamStringToMb(mbToRamLabel(mb)), mb);
  }
});
