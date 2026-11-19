/** Game launch: builds MCLC options, resolves Java, wires hooks, tracks the running game. */
const fs = require('fs-extra');
const path = require('path');
const { exec, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { Client } = require('minecraft-launcher-core');
const { INSTANCES_DIR, SHARED_MC_ASSETS, SHARED_MC_LIBRARIES, SHARED_MC_CACHE } = require('./paths');
const { ensureMinecraftAuthFresh } = require('./auth');
const { getMcVersionManifest, resolveVersionTypeFromManifest, requiredJavaMajorForMcVersion, ensureFabricProfile } = require('./mcVersion');
const { resolveJavaExecutable } = require('./java');
const { ensureForgeInstallerJar } = require('./forge');
const { scaffoldInstanceLayout, updateInstance, readInstanceConfig } = require('./instances');
const { sendLaunchLog, sendToRenderer } = require('./log');
const bridge = require('./bridge');
const { nativeFetch } = require('./nativeFetch');
const { parseRamStringToMb, mbToRamLabel } = require('./lib/ram');
async function fetchSignedTexturesProperty(uuid) {
  const id = String(uuid || '').trim();
  if (!id) return null;
  const noDashes = id.replace(/-/g, '');
  try {
    const url = `https://sessionserver.mojang.com/session/minecraft/profile/${encodeURIComponent(noDashes)}?unsigned=false`;
    const res = await nativeFetch(url, { headers: { 'User-Agent': 'ZenonClient/1.1.4' } });
    if (!res.ok) return null;
    const j = await res.json();
    const props = Array.isArray(j?.properties) ? j.properties : [];
    const tex = props.find((p) => p && p.name === 'textures' && p.value);
    if (!tex || !tex.value) return null;
    // signature is expected when unsigned=false; keep null if missing.
    return { value: String(tex.value), signature: tex.signature ? String(tex.signature) : null };
  } catch (e) {
    return null;
  }
}

// ===== Launch progress milestones (renderer stepper) =====
/** Set per launchGame(); read by sendProgress so events carry the instance id. */
let __currentLaunchInstanceId = null;
/** Emit a milestone for the renderer's launch-progress stepper. */
function sendProgress(stage, detail = '') {
  sendToRenderer('launch-progress', { stage, detail: String(detail || ''), at: Date.now(), instanceId: __currentLaunchInstanceId });
}

// ===== Launch wrapper hook (Windows) =====
/**
 * The wrapper hook wraps the game's *Java process* (not a pre-run command — that's
 * what the pre-launch hook is for). On Windows we create a tiny shim batch that:
 *   - answers `-version` truthfully so MCLC's java check passes, and
 *   - otherwise execs `<wrapper> "<java.exe>" <all args MCLC was going to use>`.
 * e.g. hookWrapper = `mangohud` → `mangohud "java.exe" -Xmx2G …`.
 */
function buildWrapperShim(instance, javaExe) {
  const dir = path.join(instance.dir || path.join(INSTANCES_DIR, instance.id || ''), '.zenon');
  fs.ensureDirSync(dir);
  const shim = path.join(dir, 'wrapper.cmd');
  const script = [
    '@echo off',
    'if "%~1"=="-version" (',
    `  "${javaExe}" -version`,
    '  exit /b %errorlevel%',
    ')',
    `${String(instance.hookWrapper || '').trim()} "${javaExe}" %*`,
    ''
  ].join('\r\n');
  fs.writeFileSync(shim, script);
  return shim;
}

// ===== Safe Mode =====
/** Set while a safe-mode launch is in flight: { dir, files: string[] } */
let __safeModeRestore = null;

function getInstanceModsDir(instance, instanceId) {
  const root = instance?.dir || path.join(INSTANCES_DIR, instanceId);
  return path.join(root, 'mods');
}

function disableInstanceModsForSafeMode(instance, instanceId, sendLog) {
  const dir = getInstanceModsDir(instance, instanceId);
  try {
    if (!fs.existsSync(dir)) {
      sendLog('info', '[Safe Mode] No mods folder — launching normally.');
      return 0;
    }
    const flipped = [];
    for (const name of fs.readdirSync(dir)) {
      if (!/\.jar$/i.test(name) || /\.jar\.disabled$/i.test(name)) continue;
      fs.renameSync(path.join(dir, name), path.join(dir, `${name}.disabled`));
      flipped.push(name);
    }
    __safeModeRestore = { dir, files: flipped };
    sendLog('info', flipped.length
      ? `[Safe Mode] Disabled ${flipped.length} mod(s) for this launch`
      : '[Safe Mode] No enabled mods — launching normally.');
    return flipped.length;
  } catch (e) {
    sendLog('error', `[Safe Mode] Could not disable mods: ${e.message || e}`);
    __safeModeRestore = null;
    return 0;
  }
}

function restoreInstanceModsAfterSafeMode(sendLog) {
  const restore = __safeModeRestore;
  if (!restore) return;
  __safeModeRestore = null;
  try {
    for (const name of restore.files) {
      const disabled = path.join(restore.dir, `${name}.disabled`);
      const original = path.join(restore.dir, name);
      if (fs.existsSync(disabled) && !fs.existsSync(original)) {
        fs.renameSync(disabled, original);
      }
    }
    if (restore.files.length) {
      sendLog('info', `[Safe Mode] Re-enabled ${restore.files.length} mod(s).`);
    }
  } catch (e) {
    sendLog('error', `[Safe Mode] Failed to re-enable mods: ${e.message || e}`);
  }
}

// Game launching — fresh Client per launch (listeners + async launch must be awaited).
let __runningGame = null; // most recent, kept for back-compat
/** All games launched from this Zenon process: instanceId -> { proc, startedAt }. */
const __runningGames = new Map();

async function launchGame(instanceId, launchOpts = {}) {
  const safeMode = !!launchOpts.safeMode;
  __currentLaunchInstanceId = instanceId;
  const sendLog = sendLaunchLog;
  const configPath = path.join(INSTANCES_DIR, instanceId, 'instance.json');
  if (!fs.existsSync(configPath)) throw new Error('Instance not found');

  const instance = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  scaffoldInstanceLayout(instance.dir);

  const { settings, auth } = await ensureMinecraftAuthFresh();
  sendProgress('auth', 'Account verified');

  const profile = auth?.profile;
  const mcToken = auth?.minecraft?.accessToken;
  if (!profile?.id || !profile?.name || !mcToken) {
    throw new Error('Not logged in. Please sign in with Microsoft.');
  }

  const manifest = await getMcVersionManifest().catch(() => null);
  sendProgress('version', `Minecraft ${instance.version || ''} metadata`);
  const versionType = instance.versionType || resolveVersionTypeFromManifest(manifest, instance.version, 'release');

  let fabricCustomId = null;
  let forgeInstallerPath = null;
  if (instance.loader === 'fabric' && instance.loaderVersion) {
    fabricCustomId = await ensureFabricProfile(instance.dir, instance.version, instance.loaderVersion);
  } else if (instance.loader === 'forge' && instance.loaderVersion) {
    const fv = String(instance.loaderVersion).includes('-')
      ? String(instance.loaderVersion)
      : `${instance.version}-${instance.loaderVersion}`;
    forgeInstallerPath = await ensureForgeInstallerJar(fv);
  }
  if (fabricCustomId || forgeInstallerPath || instance.loader === 'vanilla') {
    sendProgress('loader', instance.loader === 'vanilla' ? 'Vanilla' : `${instance.loader} ${instance.loaderVersion || ''}`.trim());
  }

  const authorization = {
    access_token: mcToken,
    client_token: auth.clientToken || uuidv4(),
    uuid: profile.id,
    name: profile.name,
    user_properties: {},
    meta: { type: 'msa' }
  };

  // Some Minecraft versions log "Signature is missing from Property textures" when the launcher
  // provides a textures property without a signature. If we can fetch a signed textures property,
  // pass it through.
  const tex = await fetchSignedTexturesProperty(profile.id);
  if (tex?.value && tex?.signature) {
    authorization.user_properties = {
      textures: {
        value: tex.value,
        signature: tex.signature
      }
    };
  }

  const maxSockets = Math.min(
    64,
    Math.max(8, parseInt(String(settings.mcDownloadSockets || '40'), 10) || 40)
  );

  // Resolve the right Java for this Minecraft version (26.x needs Java 25, 1.20.5+ needs 21, 1.18+ needs 17…).
  const requiredMajor = await requiredJavaMajorForMcVersion(instance.version);
  sendLog('info', `[Zenon] Minecraft ${instance.version} requires Java ${requiredMajor}+`);

  let javaPath;
  try {
    const javaRes = await resolveJavaExecutable(requiredMajor, instance.version, settings, instance, sendLog);
    javaPath = javaRes.javaPath;
    sendLog('info', `[Zenon] Using Java ${javaRes.major} (${javaRes.source})`);
    sendProgress('java', `Java ${javaRes.major} — ${javaRes.source}`);
  } catch (e) {
    sendLog('error', `[Zenon] ${e.message}`);
    sendProgress('failed', e.message);
    return { success: false, error: e.message };
  }

  const customMemOn =
    instance.memoryCustomEnabled === true ||
    (instance.memoryCustomEnabled == null &&
      Boolean(String(instance.maxRamOverride || '').trim() || String(instance.minRamOverride || '').trim()));
  const memMaxRaw =
    customMemOn && String(instance.maxRamOverride || '').trim()
      ? instance.maxRamOverride
      : settings.maxRam;
  // Minecraft 26.x native-crashes below ~3 GB of heap (access violation while baking texture atlases).
  // Bump the effective launch heap for Java-25+ versions instead of letting the game die silently.
  let memMax = memMaxRaw;
  const parsedMemMaxMb = parseRamStringToMb(memMaxRaw) || 0;
  if (requiredMajor >= 25 && parsedMemMaxMb > 0 && parsedMemMaxMb < 3072) {
    const bumped = mbToRamLabel(3072);
    sendLog(
      'info',
      `[Zenon] Minecraft 26.x needs at least 3 GB of heap — your ${parsedMemMaxMb} MB allocation would crash the game. Launching with ${bumped} (Settings keeps your value for older versions).`
    );
    memMax = bumped;
  }
  const memMin =
    customMemOn && String(instance.minRamOverride || '').trim()
      ? instance.minRamOverride
      : settings.minRam;

  const opts = {
    authorization,
    root: instance.dir,
    cache: SHARED_MC_CACHE,
    javaPath,
    version: {
      number: instance.version,
      type: versionType
    },
    memory: {
      max: memMax,
      min: memMin
    },
    overrides: {
      maxSockets,
      assetRoot: SHARED_MC_ASSETS,
      libraryRoot: SHARED_MC_LIBRARIES
    }
  };

  // Wrapper hook — wrap the game's Java process (Windows only).
  try {
    const wrapperCmd = String(instance.hookWrapper || '').trim();
    if (wrapperCmd && shouldRunInstanceHook(wrapperCmd)) {
      if (process.platform !== 'win32') {
        sendLog('error', '[Wrapper] Launch wrappers are only supported on Windows — wrapper ignored.');
      } else {
        const shim = buildWrapperShim(instance, javaPath);
        opts.javaPath = shim;
        sendLog('info', `[Wrapper] Game will launch through: ${wrapperCmd}`);
      }
    }
  } catch (e) {
    sendLog('error', `[Wrapper] Could not set up wrapper hook: ${e.message || e}`);
  }

  // Optional: auto-join a server after launch
  if (launchGame.joinServer && launchGame.joinServer.host) {
    try {
      opts.server = {
        host: String(launchGame.joinServer.host),
        port: Number(launchGame.joinServer.port) || 25565
      };
    } catch (e) {}
    launchGame.joinServer = null;
  }

  if (fabricCustomId) {
    opts.version.custom = fabricCustomId;
  }
  if (forgeInstallerPath) {
    opts.forge = forgeInstallerPath;
  }

  const fsOn = !!instance.windowFullscreen;
  const ww = Number(instance.windowWidth);
  const wh = Number(instance.windowHeight);
  const dimsOn =
    instance.windowCustomEnabled === true ||
    (instance.windowCustomEnabled == null &&
      Number.isFinite(ww) &&
      ww > 0 &&
      Number.isFinite(wh) &&
      wh > 0);

  if (fsOn) {
    opts.window = { fullscreen: true };
    if (dimsOn) {
      opts.window.width = ww;
      opts.window.height = wh;
    }
  } else if (dimsOn) {
    opts.window = { width: ww, height: wh, fullscreen: false };
  }

  const jvmOn =
    instance.jvmArgsEnabled === true ||
    (instance.jvmArgsEnabled == null && String(instance.jvmArgs || '').trim());
  if (jvmOn && String(instance.jvmArgs || '').trim()) {
    const parts = String(instance.jvmArgs)
      .trim()
      .split(/\r?\n/)
      .flatMap((line) => line.trim().split(/\s+/))
      .filter(Boolean);
    if (parts.length) opts.customArgs = parts;
  }

  const launcher = new Client();

  function shouldRunInstanceHook(cmdStr) {
    const cmd = String(cmdStr || '').trim();
    if (!cmd) return false;
    if (instance.hooksCustomEnabled === false) return false;
    if (instance.hooksCustomEnabled === true) return true;
    return instance.hooksCustomEnabled == null;
  }

  const runPreHook = () =>
    new Promise((resolve) => {
      const cmd = String(instance.hookPreLaunch || '').trim();
      if (!shouldRunInstanceHook(cmd)) return resolve();
      exec(cmd, { cwd: instance.dir, timeout: 300000, windowsHide: true, shell: true }, (err, _stdout, stderr) => {
        if (err) sendLog('error', `[Pre-launch hook] ${err.message}`);
        if (stderr) sendLog('debug', `[Pre-launch hook] ${String(stderr).slice(0, 400)}`);
        resolve();
      });
    });

  function firePostHook(cwd, command) {
    const cmd = command && String(command).trim();
    if (!cmd) return;
    try {
      if (process.platform === 'win32') {
        spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmd], {
          cwd,
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        }).unref();
      } else {
        spawn('/bin/sh', ['-c', cmd], { cwd, detached: true, stdio: 'ignore' }).unref();
      }
    } catch (e) {
      sendLog('error', `[Post-launch hook] ${e.message}`);
    }
  }

  launcher.on('debug', (e) => sendLog('debug', e));
  launcher.on('data', (e) => sendLog('data', e));
  launcher.on('error', (err) => sendLog('error', err.toString()));
  launcher.on('close', (code) => {
    try {
      const exitCmd = String(instance.hookPostExit || '').trim();
      if (shouldRunInstanceHook(exitCmd)) {
        firePostHook(instance.dir, exitCmd);
      }
    } catch (e) {
      /* ignore */
    }
    try {
      const mainWindow = bridge.getWindow();
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('launch-close', { code, instanceId });
      }
    } catch (e) {}
    const startedAt = __runningGame && __runningGame.instanceId === instanceId ? __runningGame.startedAt : null;
    try {
      if (__runningGame && __runningGame.instanceId === instanceId) __runningGame = null;
    } catch (e2) {}
    try { __runningGames.delete(instanceId); } catch (e3) {}
    restoreInstanceModsAfterSafeMode(sendLog);
    sendProgress('closed', `Exited (code ${code})`);
    // Crash analysis — only on failure exits.
    if (code !== 0) {
      try {
        const { recordCrash } = require('./crash-history');
        const crash = recordCrash({ instanceId, exitCode: code, instanceDir: instance.dir || undefined });
        if (crash) sendLog('error', `[Crash] ${crash.headline} — ${crash.detail}`);
      } catch (e) {}
    }
    // Accumulate total playtime (seconds) from spawn → exit.
    try {
      const current = readInstanceConfig(instanceId);
      const prevSecs = Number(current?.playTime) || 0;
      const elapsedSecs = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;
      updateInstance(instanceId, { lastPlayed: new Date().toISOString(), playTime: prevSecs + elapsedSecs });
    } catch (e) {
      updateInstance(instanceId, { lastPlayed: new Date().toISOString() });
    }
  });

  await runPreHook();

  if (safeMode) {
    disableInstanceModsForSafeMode(instance, instanceId, sendLog);
  }

  sendProgress('preparing', 'Downloading / verifying game files…');
  let proc;
  try {
    proc = await launcher.launch(opts);
  } catch (e) {
    restoreInstanceModsAfterSafeMode(sendLog);
    sendProgress('failed', e?.message || String(e));
    throw e;
  }
  if (!proc) {
    restoreInstanceModsAfterSafeMode(sendLog);
    sendProgress('failed', 'Launch failed — check the Launch Console for details.');
    return { success: false, error: 'Launch failed (Java missing, bad version, or download error — check Launch Console).' };
  }
  __runningGame = { instanceId, proc, startedAt: Date.now() };
  __runningGames.set(instanceId, { proc, startedAt: __runningGame.startedAt });
  sendProgress('running', 'Minecraft is running');

  updateInstance(instanceId, { lastPlayed: new Date().toISOString() });
  return { success: true };
}
function getRunningGame(instanceId) {
  if (instanceId) {
    const hit = __runningGames.get(instanceId);
    return hit ? { instanceId, proc: hit.proc, startedAt: hit.startedAt } : null;
  }
  return __runningGame; // most recent (back-compat)
}
/** Ids of instances launched from this Zenon process (spawn → exit). */
function getRunningInstanceIds() { return [...__runningGames.keys()]; }
function stopRunningGame() {
  if (__runningGame?.proc && !__runningGame.proc.killed) {
    try { __runningGame.proc.kill(); return true; } catch (e) { return false; }
  }
  return false;
}

/** Safety net for safe-mode launches when the launcher quits before the game does. */
function restoreSafeModeModsIfNeeded(logger = sendLaunchLog) {
  try { restoreInstanceModsAfterSafeMode(logger); } catch (e) {}
}

module.exports = {
  fetchSignedTexturesProperty,
  launchGame,
  getRunningGame,
  getRunningInstanceIds,
  stopRunningGame,
  restoreSafeModeModsIfNeeded
};
