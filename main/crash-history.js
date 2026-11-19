/**
 * Crash history for launches. On a non-zero game exit we scan the tail of
 * logs/latest.log for known failure signatures and append a structured record
 * to crash-history.json (capped). Renderer surfaces it on the instance Logs tab.
 */
const fs = require('fs-extra');
const path = require('path');
const { USER_DATA, INSTANCES_DIR } = require('./paths');

const CRASH_FILE = path.join(USER_DATA, 'crash-history.json');
const MAX_ENTRIES = 50;

const SIGNATURES = [
  { re: /OutOfMemoryError|GC overhead limit/i, headline: 'Out of memory', detail: 'The game ran out of heap — raise this instance’s max RAM (Edit instance → Java & memory).' },
  { re: /UnsupportedClassVersionError/i, headline: 'Wrong Java for this version', detail: 'A different Java major is required — Zenon auto-provisions one; this instance may be pinned to an old PATH Java.' },
  { re: /ACCESS_VIOLATION|EXCEPTION_ACCESS_VIOLATION|AccessViolation/i, headline: 'Native crash (access violation)', detail: 'Usually GPU driver or heap-size related — for 26.x builds the heap floor is enforced automatically.' },
  { re: /MixinApplyFailedException|mixin apply failed|mixin transformer failed/i, headline: 'Mixin/mod conflict', detail: 'A mod failed to transform the game — try Safe Mode (disable mods) to find the culprit.' },
  { re: /Failed to load mod|mod loading has failed|CRASH REPORT|crash report|fml.crash|Mod crashed/i, headline: 'Mod crash', detail: 'A mod crashed during startup — check the log for the named mod or Crash Report URL.' },
  { re: /Duplicate mods|duplicate mod (jar|found)/i, headline: 'Duplicate mods', detail: 'The same mod is installed twice — remove the older jar.' },
  { re: /Sound System|AudioSystem|sound engine (failed|not)/i, headline: 'Audio issue', detail: 'Sound device problem — usually harmless; game may still run.' },
  { re: /Pixel format not accelerated|OpenGL (error|function)/i, headline: 'OpenGL/GPU issue', detail: 'Graphics driver problem — update GPU drivers or try a different render distance.' }
];

function readTail(dir, maxBytes = 120000) {
  try {
    const logPath = path.join(dir, 'logs', 'latest.log');
    if (!fs.existsSync(logPath)) return '';
    const stat = fs.statSync(logPath);
    const fd = fs.openSync(logPath, 'r');
    const len = Math.min(stat.size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, Math.max(0, stat.size - len));
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (e) {
    return '';
  }
}

function analyzeCrash(logText) {
  const text = String(logText || '');
  for (const sig of SIGNATURES) {
    if (sig.re.test(text)) return sig;
  }
  return { headline: 'Game crashed', detail: 'Unexpected exit — check the log for the first ERROR / Exception line.' };
}

function recordCrash({ instanceId, exitCode, instanceDir }) {
  try {
    const dir = instanceDir || (instanceId ? path.join(INSTANCES_DIR, instanceId) : null);
    const logText = dir ? readTail(dir) : '';
    const sig = analyzeCrash(logText);
    const entry = {
      id: `crash-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      instanceId: instanceId || null,
      exitCode: Number(exitCode) || 0,
      headline: sig.headline,
      detail: sig.detail
    };
    let history = [];
    try {
      history = JSON.parse(fs.readFileSync(CRASH_FILE, 'utf8'));
      if (!Array.isArray(history)) history = [];
    } catch (e) { history = []; }
    history.unshift(entry);
    history = history.slice(0, MAX_ENTRIES);
    fs.writeFileSync(CRASH_FILE, JSON.stringify(history, null, 2));
    return entry;
  } catch (e) {
    return null;
  }
}

function listCrashes(instanceId) {
  try {
    const raw = fs.readFileSync(CRASH_FILE, 'utf8');
    const history = JSON.parse(raw);
    if (!Array.isArray(history)) return [];
    if (!instanceId) return history.slice(0, MAX_ENTRIES);
    return history.filter((c) => c.instanceId === instanceId).slice(0, MAX_ENTRIES);
  } catch (e) {
    return [];
  }
}

function clearCrashes() {
  try { fs.removeSync(CRASH_FILE); } catch (e) {}
  return true;
}

module.exports = { recordCrash, listCrashes, clearCrashes };
