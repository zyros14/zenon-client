/** Dedicated servers: creation (Vanilla/Paper/Fabric/Forge), runtime, console, player tracking. */
const fetch = require('node-fetch');
const fs = require('fs-extra');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { SERVERS_DIR, SHARED_MC_CACHE } = require('./paths');
const { loadSettings } = require('./settings');
const { readServerConfig } = require('./serverConfig');
const { getServerContentDir, readServerContentMeta, writeServerContentMeta } = require('./content');
const { installModrinthRequiredDeps } = require('./discovery');
const { getMcVersionManifest, requiredJavaMajorForMcVersion } = require('./mcVersion');
const { resolveJavaExecutable } = require('./java');
const { installForgeServerToDir } = require('./forge');
const { nativeFetch } = require('./nativeFetch');
const { sendToRenderer } = require('./log');
const { clampRamMb } = require('./lib/ram');
const { isSnapshotLikeMcVersion } = require('./lib/versions');
const { stripMcFormatting, cleanPlayerToken } = require('./lib/text');
function listServers() {
  if (!fs.existsSync(SERVERS_DIR)) return [];
  const out = [];
  for (const id of fs.readdirSync(SERVERS_DIR)) {
    const full = path.join(SERVERS_DIR, id);
    try {
      if (!fs.statSync(full).isDirectory()) continue;
    } catch (e) {
      continue;
    }
    const cfg = readServerConfig(id);
    if (cfg) out.push(cfg);
  }
  return out.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
}

function writeServerEulaAndReadme(dir, lines) {
  fs.writeFileSync(
    path.join(dir, 'eula.txt'),
    '# Read https://aka.ms/MinecraftEULA — set to eula=true to run the server.\neula=false\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'README_ZENON.txt'),
    ['Zenon Client — dedicated server folder', '', ...lines, ''].join('\n'),
    'utf8'
  );
}

async function downloadVanillaServerJarTo(dir, version) {
  const manifest = await getMcVersionManifest();
  const hit = manifest.versions.find((v) => v.id === version);
  if (!hit?.url) throw new Error(`Unknown Minecraft version: ${version}`);
  const vr = await nativeFetch(hit.url);
  if (!vr.ok) throw new Error(`Version json HTTP ${vr.status}`);
  const vj = await vr.json();
  const surl = vj.downloads?.server?.url;
  if (!surl) throw new Error('No official server jar for this version (try a full release).');
  const jr = await nativeFetch(surl);
  if (!jr.ok) throw new Error(`Server jar HTTP ${jr.status}`);
  const buf = Buffer.from(await jr.arrayBuffer());
  fs.writeFileSync(path.join(dir, 'server.jar'), buf);
}

async function downloadPaperServerJarTo(dir, version) {
  // Paper's v2 API was sunset (410) — use the Fill v3 API.
  const buildsR = await nativeFetch(
    `https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(version)}/builds`
  );
  if (!buildsR.ok) throw new Error(`Paper has no builds for ${version} (HTTP ${buildsR.status}).`);
  const builds = await buildsR.json();
  const list = (Array.isArray(builds) ? builds : []).filter((b) => b?.downloads?.['server:default']?.url);
  if (!list.length) throw new Error(`No downloadable Paper builds for ${version}.`);
  // Prefer the latest STABLE build; fall back to whatever exists (RC channels).
  const stable = list.filter((b) => String(b.channel || '').toUpperCase() === 'STABLE');
  const pool = stable.length ? stable : list;
  const latest = pool.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
  const url = latest.downloads['server:default'].url;
  const jarR = await nativeFetch(url);
  if (!jarR.ok) throw new Error(`Paper jar HTTP ${jarR.status}`);
  const buf = Buffer.from(await jarR.arrayBuffer());
  fs.writeFileSync(path.join(dir, 'server.jar'), buf);
}

async function ensureFabricInstallerJarCached() {
  const cached = path.join(SHARED_MC_CACHE, 'fabric-installer-1.0.1.jar');
  if (fs.existsSync(cached) && fs.statSync(cached).size > 50000) return cached;
  const r = await nativeFetch('https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.1/fabric-installer-1.0.1.jar');
  if (!r.ok) throw new Error(`Could not download Fabric installer (HTTP ${r.status}).`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(cached, buf);
  return cached;
}


async function installFabricServerViaInstaller(dir, mcVersion, fabricLoaderVersion, javaExe) {
  if (!fabricLoaderVersion) throw new Error('Select a Fabric loader version.');
  const java = String(javaExe || 'java').trim() || 'java';
  const installer = await ensureFabricInstallerJarCached();
  const manifest = await getMcVersionManifest().catch(() => null);
  const snapshot = isSnapshotLikeMcVersion(mcVersion, manifest);
  const targetDir = path.resolve(dir);
  const args = [
    '-jar',
    installer,
    'server',
    '-dir',
    targetDir,
    '-mcversion',
    mcVersion,
    '-loader',
    fabricLoaderVersion,
    '-downloadMinecraft',
    '-noprofile'
  ];
  if (snapshot) args.push('-snapshot');

  const proc = spawnSync(java, args, {
    cwd: targetDir,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    env: process.env,
    maxBuffer: 32 * 1024 * 1024
  });
  if (proc.error) throw new Error(`Fabric installer: ${proc.error.message}`);
  if (proc.status !== 0) {
    const err = `${proc.stderr || ''}\n${proc.stdout || ''}`.trim().slice(0, 1200);
    throw new Error(`Fabric installer failed (exit ${proc.status}). ${err}`);
  }

  let launchName = fs.readdirSync(targetDir).find((n) => /^fabric-server.*\.jar$/i.test(n) && !/installer/i.test(n));
  if (!launchName) launchName = 'fabric-server-launch.jar';
  return launchName;
}

async function fetchPaperMcVersionList() {
  try {
    // Fill v3: { versions: { "26.3": ["26.3", "26.3-rc-3"], "26.2": [...], ... } }
    const r = await nativeFetch('https://fill.papermc.io/v3/projects/paper');
    if (!r.ok) return [];
    const j = await r.json();
    const groups = j?.versions && typeof j.versions === 'object' ? j.versions : {};
    const familyKey = (f) => String(f).split('.').map((n) => parseInt(n, 10) || 0);
    const families = Object.keys(groups).sort((a, b) => {
      const pa = familyKey(a), pb = familyKey(b);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pb[i] || 0) - (pa[i] || 0);
        if (d) return d;
      }
      return 0;
    });
    const out = [];
    for (const family of families) {
      for (const id of groups[family] || []) {
        const s = String(id);
        if (/-rc/i.test(s)) continue; // hide pre-releases from the picker
        if (!out.includes(s)) out.push(s);
      }
    }
    return out;
  } catch (e) {
    return [];
  }
}

async function createServerEntry(data) {
  const name = data?.name;
  const version = data?.version;
  const serverKind = String(data?.serverKind || 'vanilla').toLowerCase();
  if (!version) throw new Error('Select a Minecraft version');

  const settings = loadSettings();
  // Resolve the Java this Minecraft version needs (26.x → Java 25); used for installer runs and README hints.
  let javaExe = settings.javaPath || 'java';
  try {
    const requiredMajor = await requiredJavaMajorForMcVersion(version);
    const javaRes = await resolveJavaExecutable(requiredMajor, version, settings, {}, () => {});
    javaExe = javaRes.javaPath;
  } catch (e) {
    /* installer steps will surface any Java error with a clear message */
  }

  const id = uuidv4();
  const dir = path.join(SERVERS_DIR, id);
  fs.ensureDirSync(dir);

  let hint = 'Edit eula.txt, then run the command in README_ZENON.txt from this folder.';
  let fabricLaunchJarSaved = null;

  if (serverKind === 'vanilla') {
    await downloadVanillaServerJarTo(dir, version);
    writeServerEulaAndReadme(dir, [
      '1) Edit eula.txt → eula=true',
      `2) Run: "${javaExe}" -jar server.jar nogui`
    ]);
  } else if (serverKind === 'paper') {
    await downloadPaperServerJarTo(dir, version);
    writeServerEulaAndReadme(dir, [
      'Paper build in server.jar',
      '1) Edit eula.txt → eula=true',
      `2) Run: "${javaExe}" -jar server.jar nogui`
    ]);
  } else if (serverKind === 'fabric') {
    fabricLaunchJarSaved = await installFabricServerViaInstaller(dir, version, data.fabricLoaderVersion, javaExe);
    writeServerEulaAndReadme(dir, [
      'Fabric server (installed with fabric-installer)',
      '1) Edit eula.txt → eula=true',
      `2) Run: "${javaExe}" -jar ${fabricLaunchJarSaved} nogui`,
      '   (If the launch jar name differs, use the fabric-server*.jar in this folder — not the installer.)'
    ]);
    hint = `Fabric server ready — run ${fabricLaunchJarSaved} after eula=true (uses official Fabric installer).`;
  } else if (serverKind === 'forge') {
    const forgeFull = data.forgeFull;
    if (!forgeFull) throw new Error('Select a Forge version.');
    await installForgeServerToDir(dir, forgeFull, javaExe);
    writeServerEulaAndReadme(dir, [
      'Forge server — installer output is in this folder.',
      '1) Edit eula.txt → eula=true',
      '2) On Windows run run.bat, or see run.sh on macOS/Linux.',
      `   Or use the same Java as the launcher: "${javaExe}" @args from the official run script.`
    ]);
    hint = 'Forge: use run.bat / run.sh in this folder after eula=true.';
  } else {
    throw new Error(`Unknown server type: ${serverKind}`);
  }

  const entry = {
    id,
    name: String(name || 'Minecraft Server').slice(0, 80),
    version,
    serverKind,
    forgeFull: serverKind === 'forge' ? data.forgeFull : null,
    fabricLoaderVersion: serverKind === 'fabric' ? data.fabricLoaderVersion : null,
    fabricLaunchJar: fabricLaunchJarSaved,
    maxRamMb: clampRamMb(parseInt(String(data?.maxRamMb || '2048'), 10) || 2048, 2048),
    dir,
    created: new Date().toISOString()
  };
  fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify(entry, null, 2));
  return { entry, hint };
}

function deleteServerEntry(serverId) {
  const dir = path.join(SERVERS_DIR, serverId);
  if (fs.existsSync(dir)) fs.removeSync(dir);
  return true;
}

// ----- Dedicated server runtime (console, stdin, player heuristics) -----
const SERVER_RUNTIME = new Map();


function readEulaAccepted(serverDir) {
  try {
    const p = path.join(serverDir, 'eula.txt');
    if (!fs.existsSync(p)) return false;
    const t = String(fs.readFileSync(p, 'utf8') || '').replace(/^\uFEFF/, '');
    // Match full line to avoid any weird false positives.
    return /^\s*eula\s*=\s*true\s*$/im.test(t);
  } catch (e) {
    return false;
  }
}

function writeEulaAccepted(serverDir) {
  try {
    fs.ensureDirSync(serverDir);
    const p = path.join(serverDir, 'eula.txt');
    let t = '';
    try {
      if (fs.existsSync(p)) t = String(fs.readFileSync(p, 'utf8') || '');
    } catch (e2) {}
    if (!t) {
      t = '# Read https://aka.ms/MinecraftEULA — set to eula=true to run the server.\neula=false\n';
    }
    t = t.replace(/^\uFEFF/, '');
    if (/^\s*eula\s*=\s*(true|false)\s*$/im.test(t)) {
      t = t.replace(/^\s*eula\s*=\s*(true|false)\s*$/gim, 'eula=true');
    } else {
      t = `${t.trimEnd()}\neula=true\n`;
    }
    fs.writeFileSync(p, t);
    return true;
  } catch (e) {
    return false;
  }
}

function findFabricLaunchJarName(serverDir) {
  try {
    const files = fs.readdirSync(serverDir);
    return (
      files.find((n) => /^fabric-server.*\.jar$/i.test(n) && !/installer/i.test(n)) || null
    );
  } catch (e) {
    return null;
  }
}

async function resolveDedicatedServerLaunch(cfg) {
  const dir = cfg.dir;
  if (!dir || !fs.existsSync(dir)) return { error: 'Server folder missing' };
  const settings = loadSettings();
  const maxRam = clampRamMb(parseInt(String(cfg.maxRamMb || '2048'), 10) || 2048, 2048);
  const jvm = [`-Xms${Math.min(512, maxRam)}M`, `-Xmx${maxRam}M`];
  const kind = String(cfg.serverKind || 'vanilla').toLowerCase();

  // Servers need the same Java their Minecraft version requires (e.g. 26.x → Java 25).
  const requiredMajor = await requiredJavaMajorForMcVersion(cfg.version);
  const javaLogs = [`[Zenon] Minecraft ${cfg.version || '?'} requires Java ${requiredMajor}+`];
  let java;
  try {
    const javaRes = await resolveJavaExecutable(requiredMajor, cfg.version || '1.20.1', settings, {}, (_t, msg) => javaLogs.push(String(msg)));
    java = javaRes.javaPath;
    javaLogs.push(`[Zenon] Server will use Java ${javaRes.major} (${javaRes.source})`);
  } catch (e) {
    return { error: e.message };
  }

  if (kind === 'vanilla' || kind === 'paper') {
    const jar = path.join(dir, 'server.jar');
    if (!fs.existsSync(jar)) return { error: 'Missing server.jar' };
    return { cwd: dir, command: java, args: [...jvm, '-jar', 'server.jar', 'nogui'], javaLogs };
  }

  if (kind === 'fabric') {
    let jarName = cfg.fabricLaunchJar || findFabricLaunchJarName(dir);
    if (!jarName) return { error: 'Could not find Fabric server jar in folder' };
    const jarPath = path.join(dir, jarName);
    if (!fs.existsSync(jarPath)) return { error: 'Fabric server jar path invalid' };
    return { cwd: dir, command: java, args: [...jvm, '-jar', jarName, 'nogui'], javaLogs };
  }

  if (kind === 'forge') {
    if (process.platform === 'win32') {
      const bat = path.join(dir, 'run.bat');
      if (fs.existsSync(bat)) {
        return { cwd: dir, command: 'cmd.exe', args: ['/d', '/s', '/c', 'run.bat'], shell: false, javaLogs };
      }
    }
    const sh = path.join(dir, 'run.sh');
    if (fs.existsSync(sh)) {
      return { cwd: dir, command: 'sh', args: ['run.sh'], shell: false, javaLogs };
    }
    return { error: 'Forge: run.bat / run.sh not found. Open the folder and generate server files first.' };
  }

  return { error: `Unsupported server kind: ${kind}` };
}

function pushInactive(rt, name) {
  if (!name) return;
  rt.online.delete(name);
  rt.inactive = rt.inactive.filter((x) => x.name !== name);
  rt.inactive.unshift({ name, at: Date.now() });
  if (rt.inactive.length > 64) rt.inactive.length = 64;
  sendToRenderer('server-players', {
    serverId: rt.serverId,
    active: [...rt.online],
    inactive: rt.inactive.map((x) => x.name)
  });
}

function processServerLineForPlayers(serverId, line) {
  const rt = SERVER_RUNTIME.get(serverId);
  if (!rt) return;
  const text = stripMcFormatting(line).trim();

  const listMatch = text.match(/There are (\d+) of a max of (\d+) players online:\s*(.*)$/i);
  if (listMatch && rt.awaitingList) {
    rt.awaitingList = false;
    clearTimeout(rt.listTimer);
    rt.listTimer = null;
    const tail = (listMatch[3] || '').trim();
    const names = tail ? tail.split(',').map((s) => cleanPlayerToken(s)).filter(Boolean) : [];
    rt.online.clear();
    for (const n of names) rt.online.add(n);
    sendToRenderer('server-players', {
      serverId,
      active: [...rt.online],
      inactive: rt.inactive.map((x) => x.name)
    });
    return;
  }

  let m = text.match(/]:\s*(.+?)\s+joined the game\s*$/i) || text.match(/:\s*(.+?)\s+joined the game\s*$/i);
  if (m) {
    const name = cleanPlayerToken(m[1]);
    if (name) {
      rt.online.add(name);
      rt.inactive = rt.inactive.filter((x) => x.name !== name);
      sendToRenderer('server-players', {
        serverId,
        active: [...rt.online],
        inactive: rt.inactive.map((x) => x.name)
      });
    }
    return;
  }
  m = text.match(/]:\s*(.+?)\s+left the game\s*$/i) || text.match(/:\s*(.+?)\s+left the game\s*$/i);
  if (m) {
    const name = cleanPlayerToken(m[1]);
    if (name) pushInactive(rt, name);
    return;
  }
  m = text.match(/]:\s*(.+?)\s+lost connection:/i) || text.match(/^(.+?)\s+lost connection:/i);
  if (m) {
    const name = cleanPlayerToken(m[1]);
    if (name) pushInactive(rt, name);
  }
}


function appendServerLog(serverId, line, stream) {
  const rt = SERVER_RUNTIME.get(serverId);
  if (!rt) return;
  if (!rt.logLines) rt.logLines = [];
  const full = stream === 'stderr' ? `[stderr] ${line}` : line;
  rt.logLines.push(full);
  if (rt.logLines.length > 600) rt.logLines.shift();
  // If the JVM reports EULA-required, surface it to the UI (some server jars print this even when pre-checks pass).
  if (/agree to the EULA/i.test(full) || /eula\.txt/i.test(full) && /need/i.test(full)) {
    rt.needsEula = true;
  }
  processServerLineForPlayers(serverId, full);
  sendToRenderer('server-log', { serverId, line: full, stream: stream || 'stdout', at: Date.now() });
}

function wireServerProcessStreams(serverId, proc) {
  const rt = SERVER_RUNTIME.get(serverId);
  if (!rt) return;
  const flush = (bufRef, chunk, stream) => {
    bufRef[0] += chunk;
    const parts = bufRef[0].split(/\r?\n/);
    bufRef[0] = parts.pop() || '';
    for (const p of parts) {
      if (p.length) appendServerLog(serverId, p, stream);
    }
  };
  const outBuf = [''];
  const errBuf = [''];
  proc.stdout?.setEncoding?.('utf8');
  proc.stderr?.setEncoding?.('utf8');
  proc.stdout?.on('data', (ch) => flush(outBuf, ch, 'stdout'));
  proc.stderr?.on('data', (ch) => flush(errBuf, ch, 'stderr'));
  proc.once('error', (err) => {
    appendServerLog(serverId, `[Zenon] Process error: ${err.message}`, 'stderr');
    SERVER_RUNTIME.delete(serverId);
    sendToRenderer('server-state', { serverId, running: false });
  });
  proc.on('exit', (code) => {
    if (outBuf[0].trim()) appendServerLog(serverId, outBuf[0].trim(), 'stdout');
    if (errBuf[0].trim()) appendServerLog(serverId, errBuf[0].trim(), 'stderr');
    appendServerLog(serverId, `[Zenon] Server process exited (code ${code}).`, 'stdout');
    const needsEula = !!rt.needsEula;
    SERVER_RUNTIME.delete(serverId);
    sendToRenderer('server-state', { serverId, running: false, needsEula });
  });
}

async function startDedicatedServer(serverId) {
  if (SERVER_RUNTIME.has(serverId)) {
    return { success: false, error: 'Server is already running.' };
  }
  const cfg = readServerConfig(serverId);
  if (!cfg) return { success: false, error: 'Unknown server.' };
  const serverDir = cfg.dir || path.join(SERVERS_DIR, serverId);
  if (!readEulaAccepted(serverDir)) {
    return {
      success: false,
      error: 'EULA not accepted.',
      needsEula: true
    };
  }
  const launch = await resolveDedicatedServerLaunch(cfg);
  if (launch.error) return { success: false, error: launch.error };

  // Register the runtime BEFORE spawning so the Java resolution lines land in the console.
  const proc = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: process.env,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const rt = {
    serverId,
    proc,
    logLines: [],
    online: new Set(),
    inactive: [],
    awaitingList: false,
    listTimer: null
  };
  SERVER_RUNTIME.set(serverId, rt);
  wireServerProcessStreams(serverId, proc);
  for (const line of launch.javaLogs || []) appendServerLog(serverId, line, 'stdout');
  sendToRenderer('server-state', { serverId, running: true });
  sendToRenderer('server-players', { serverId, active: [], inactive: [] });
  return { success: true };
}

function stopDedicatedServer(serverId, opts = {}) {
  const force = !!opts.force;
  return new Promise((resolve) => {
    const rt = SERVER_RUNTIME.get(serverId);
    if (!rt || !rt.proc) {
      SERVER_RUNTIME.delete(serverId);
      sendToRenderer('server-state', { serverId, running: false });
      return resolve({ success: true });
    }
    const proc = rt.proc;
    const timer = setTimeout(() => {
      try {
        if (!proc.killed) proc.kill('SIGTERM');
      } catch (e) {}
    }, force ? 600 : 24000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve({ success: true });
    });
    try {
      if (!force && proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write('stop\n');
      } else {
        clearTimeout(timer);
        try {
          if (!proc.killed) proc.kill('SIGTERM');
        } catch (e) {}
      }
    } catch (e) {
      clearTimeout(timer);
      try {
        if (!proc.killed) proc.kill('SIGTERM');
      } catch (e2) {}
    }
  });
}

async function downloadServerProjectFile(serverId, kind, versionData, meta = null) {
  try {
    const targetDir = getServerContentDir(serverId, kind);
    const files = Array.isArray(versionData?.files) ? versionData.files : [];
    const pick =
      files.find((f) => f.primary && f.url && f.filename && (f.env?.server || 'required') !== 'unsupported') ||
      files.find((f) => f.url && f.filename && (f.env?.server || 'required') !== 'unsupported') ||
      null;
    if (!pick) throw new Error('No server-compatible file found');

    const res = await fetch(pick.url);
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    const buffer = await res.buffer();
    const filePath = path.join(targetDir, pick.filename);
    fs.writeFileSync(filePath, buffer);

    try {
      if (meta && typeof meta === 'object') {
        const key = pick.filename;
        const idx = readServerContentMeta(serverId, kind);
        idx[key] = {
          projectId: meta.projectId || versionData.project_id || null,
          title: meta.title || versionData.name || null,
          iconUrl: meta.iconUrl || null,
          author: meta.author || null,
          at: Date.now()
        };
        writeServerContentMeta(serverId, kind, idx);
      }
    } catch (e2) {}

    // Auto-install required Modrinth dependencies alongside the server mod.
    let deps = null;
    if (String(kind || '').toLowerCase() === 'mod') {
      try {
        const cfg = readServerConfig(serverId);
        const mcVersion = cfg?.version || '';
        const serverKind = String(cfg?.serverKind || '').toLowerCase();
        const loader = serverKind === 'fabric' || serverKind === 'forge' ? serverKind : null;
        const installedIds = new Set();
        try {
          const diskFiles = new Set(fs.readdirSync(targetDir).map((f) => String(f).toLowerCase()));
          for (const [fname, m] of Object.entries(readServerContentMeta(serverId, kind) || {})) {
            if (!m?.projectId) continue;
            const key = String(fname).toLowerCase();
            if (diskFiles.has(key) || diskFiles.has(`${key}.disabled`)) {
              installedIds.add(String(m.projectId));
            }
          }
        } catch (e3) {}
        deps = await installModrinthRequiredDeps({
          kind,
          mcVersion,
          loader,
          rootVersionData: versionData,
          targetDir,
          isAlreadyInstalled: async (pid) => installedIds.has(String(pid)),
          recordMeta: async (filename, m) => {
            const idx = readServerContentMeta(serverId, kind);
            idx[filename] = m;
            writeServerContentMeta(serverId, kind, idx);
            if (m?.projectId) installedIds.add(String(m.projectId));
          }
        });
      } catch (e3) {
        deps = { installed: [], skipped: [], failed: ['dependency scan failed'] };
      }
    }

    return { success: true, filename: pick.filename, deps };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
module.exports = {
  SERVER_RUNTIME,
  listServers,
  writeServerEulaAndReadme,
  downloadVanillaServerJarTo,
  downloadPaperServerJarTo,
  ensureFabricInstallerJarCached,
  installFabricServerViaInstaller,
  fetchPaperMcVersionList,
  createServerEntry,
  deleteServerEntry,
  readEulaAccepted,
  writeEulaAccepted,
  findFabricLaunchJarName,
  resolveDedicatedServerLaunch,
  processServerLineForPlayers,
  startDedicatedServer,
  stopDedicatedServer,
  downloadServerProjectFile
};
