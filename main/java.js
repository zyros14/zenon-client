/** Java runtime resolution: user overrides → Zenon-managed runtimes → system scan → auto-download. */
const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const { JAVA_RUNTIMES_DIR } = require('./paths');
const { nativeFetch } = require('./nativeFetch');
function javaBinDir() {
  return process.platform === 'darwin' ? path.join('Contents', 'Home', 'bin') : 'bin';
}
function javaExeName() {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}
function javaExeIn(dir) {
  return path.join(dir, javaBinDir(), javaExeName());
}

/** Detect the Java major version of an executable (null when not a working Java). */
function getJavaMajor(javaExe) {
  try {
    const r = spawnSync(javaExe, ['-version'], {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
      shell: false
    });
    const out = `${r.stderr || ''}\n${r.stdout || ''}`;
    const m = out.match(/version\s+"([^"]+)"/);
    if (!m) return null;
    const vm = m[1].match(/^(\d+)(?:\.(\d+))?/);
    if (!vm) return null;
    let major = parseInt(vm[1], 10);
    if (major === 1 && vm[2]) major = parseInt(vm[2], 10); // legacy "1.8.0_x" → 8
    return Number.isFinite(major) && major > 0 ? major : null;
  } catch (e) {
    return null;
  }
}

/** Scan common install locations for system Java installations. */
function scanInstalledJavas() {
  const roots = [];
  const pushRoot = (p) => { if (p && fs.existsSync(p)) roots.push(p); };
  if (process.platform === 'win32') {
    for (const envKey of ['ProgramFiles', 'ProgramFiles(x86)', 'LocalAppData']) {
      const base = process.env[envKey];
      if (!base) continue;
      for (const sub of ['Java', 'Eclipse Adoptium', 'AdoptOpenJDK', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft', 'Semeru']) {
        pushRoot(path.join(base, sub));
      }
      if (envKey === 'LocalAppData') pushRoot(path.join(base, 'Programs'));
    }
  } else if (process.platform === 'darwin') {
    pushRoot('/Library/Java/JavaVirtualMachines');
  } else {
    pushRoot('/usr/lib/jvm');
  }

  const found = [];
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root).filter((n) => !n.startsWith('.')); } catch (e) { continue; }
    for (const entry of entries) {
      const full = path.join(root, entry);
      let st = null;
      try { st = fs.statSync(full); } catch (e) { continue; }
      if (!st.isDirectory()) continue;
      const candidates = [javaExeIn(full)];
      if (process.platform === 'darwin') candidates.push(path.join(full, 'Contents', 'Home', 'bin', 'java'));
      let hit = candidates.find((c) => fs.existsSync(c));
      if (hit) { found.push(hit); continue; }
      // One nesting level deeper (e.g. …\Microsoft\jdk-21.0.11.10-hotspot, …\Programs\Eclipse Adoptium\jdk-25)
      let inner = [];
      try { inner = fs.readdirSync(full).filter((n) => !n.startsWith('.')); } catch (e2) { continue; }
      for (const innerName of inner) {
        const full2 = path.join(full, innerName);
        let st2 = null;
        try { st2 = fs.statSync(full2); } catch (e3) { continue; }
        if (!st2.isDirectory()) continue;
        const exe2 = javaExeIn(full2);
        if (fs.existsSync(exe2)) { found.push(exe2); break; }
      }
    }
  }
  return found;
}

async function downloadFileWithProgress(url, destPath, log, label) {
  const res = await nativeFetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let lastLogged = 0;
  const { Readable } = require('stream');
  const nodeStream = Readable.fromWeb(res.body);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    nodeStream.on('data', (chunk) => {
      received += chunk.length;
      const mb = Math.floor(received / (1024 * 1024));
      if (total) {
        const pct = Math.floor((received / total) * 100);
        if (pct >= lastLogged + 10) { lastLogged = pct; log('info', `${label} — ${pct}%`); }
      } else if (mb >= lastLogged + 8) {
        lastLogged = mb;
        log('info', `${label} — ${mb} MB`);
      }
    });
    nodeStream.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    nodeStream.pipe(out);
  });
}

/** Download + extract an Adoptium JRE for the given major into JAVA_RUNTIMES_DIR (Windows builds). */
async function provisionJavaForMajor(major, log) {
  const targetDir = path.join(JAVA_RUNTIMES_DIR, `jdk-${major}`);
  const exe = path.join(targetDir, 'bin', 'java.exe');
  if (fs.existsSync(exe)) return exe;

  const osArch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/${osArch}/jre/hotspot/normal/eclipse?project=jdk`;
  const tmpZip = path.join(JAVA_RUNTIMES_DIR, `jdk-${major}.zip.tmp`);
  const extractDir = path.join(JAVA_RUNTIMES_DIR, `jdk-${major}.extract`);
  fs.ensureDirSync(JAVA_RUNTIMES_DIR);
  try { fs.removeSync(extractDir); } catch (e) {}
  try { fs.removeSync(tmpZip); } catch (e2) {}
  fs.ensureDirSync(extractDir);
  try {
    await downloadFileWithProgress(url, tmpZip, log, `[Zenon] Downloading Java ${major} runtime`);
    log('info', `[Zenon] Extracting Java ${major} runtime…`);
    const zip = new AdmZip(tmpZip);
    zip.extractAllTo(extractDir, true);
    const entries = fs.readdirSync(extractDir);
    let root = extractDir;
    if (entries.length === 1 && fs.statSync(path.join(extractDir, entries[0])).isDirectory()) {
      root = path.join(extractDir, entries[0]);
    }
    fs.moveSync(root, targetDir, { overwrite: true });
  } finally {
    try { fs.removeSync(extractDir); } catch (e) {}
    try { fs.removeSync(tmpZip); } catch (e2) {}
  }
  if (!fs.existsSync(exe)) throw new Error(`Downloaded Java ${major} runtime is missing bin/java.exe`);
  return exe;
}

/**
 * Pick a Java executable that satisfies the MC version's requirement:
 * user-configured paths → previously provisioned runtimes → system installs → auto-download.
 */
async function resolveJavaExecutable(requiredMajor, mcVersion, settings, instance, log) {
  const candidates = [];
  const customOn =
    instance.javaCustomEnabled === true ||
    (instance.javaCustomEnabled == null && !!String(instance.javaPathOverride || '').trim());
  const customPath = customOn ? String(instance.javaPathOverride || '').trim() : '';
  const settingsPath = String(settings.javaPath || '').trim();
  if (customPath) candidates.push({ p: customPath, label: 'Instance Java override' });
  if (settingsPath && settingsPath.toLowerCase() !== 'java') candidates.push({ p: settingsPath, label: 'Settings Java path' });
  candidates.push({ p: settingsPath || 'java', label: 'System Java (PATH)' });

  for (const c of candidates) {
    const major = getJavaMajor(c.p);
    if (major == null) continue;
    if (major >= requiredMajor) return { javaPath: c.p, major, source: c.label };
    log('info', `[Zenon] ${c.label} is Java ${major}, but Minecraft ${mcVersion} needs Java ${requiredMajor}+ — looking for a compatible runtime…`);
  }

  // Previously downloaded runtimes
  try {
    const dirs = fs.readdirSync(JAVA_RUNTIMES_DIR).filter((d) => /^jdk-\d+$/.test(d));
    for (const d of dirs) {
      const exe = javaExeIn(path.join(JAVA_RUNTIMES_DIR, d));
      if (!fs.existsSync(exe)) continue;
      const major = getJavaMajor(exe);
      if (major != null && major >= requiredMajor) return { javaPath: exe, major, source: 'Zenon-managed runtime' };
    }
  } catch (e) {}

  // System-wide installs — prefer the closest major ≥ required
  const scanned = scanInstalledJavas()
    .map((exe) => ({ exe, major: getJavaMajor(exe) }))
    .filter((x) => x.major != null && x.major >= requiredMajor)
    .sort((x, y) => x.major - y.major);
  if (scanned.length) {
    const pick = scanned[0];
    return { javaPath: pick.exe, major: pick.major, source: 'installed Java' };
  }

  // Nothing compatible — download the required runtime (Windows; the app's build target).
  if (process.platform === 'win32') {
    log('info', `[Zenon] No compatible Java found on this PC — downloading Java ${requiredMajor} (one-time, ~50 MB)…`);
    const exe = await provisionJavaForMajor(requiredMajor, log);
    return { javaPath: exe, major: getJavaMajor(exe) || requiredMajor, source: 'downloaded runtime' };
  }

  throw new Error(`Minecraft ${mcVersion} requires Java ${requiredMajor}+. Install it from https://adoptium.net (or set the Java path in Settings).`);
}
module.exports = {
  javaBinDir,
  javaExeName,
  javaExeIn,
  getJavaMajor,
  scanInstalledJavas,
  downloadFileWithProgress,
  provisionJavaForMajor,
  resolveJavaExecutable
};
