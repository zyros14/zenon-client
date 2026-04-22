const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { exec, spawn, spawnSync } = require('child_process');
const { Client, Authenticator } = require('minecraft-launcher-core');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const { Authflow, Titles } = require('prismarine-auth');
const crypto = require('crypto');

let mainWindow;

// Data directories
const USER_DATA = app.getPath('userData');
const INSTANCES_DIR = path.join(USER_DATA, 'instances');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const AUTH_CACHE_DIR = path.join(USER_DATA, 'auth-cache');
/** Shared game files across all instances — avoids re-downloading GB per world. */
const SHARED_MC_ASSETS = path.join(USER_DATA, 'shared-minecraft-assets');
const SHARED_MC_LIBRARIES = path.join(USER_DATA, 'shared-minecraft-libraries');
const SHARED_MC_CACHE = path.join(USER_DATA, 'shared-minecraft-cache');

fs.ensureDirSync(INSTANCES_DIR);
fs.ensureDirSync(SHARED_MC_ASSETS);
fs.ensureDirSync(SHARED_MC_LIBRARIES);
fs.ensureDirSync(SHARED_MC_CACHE);

const SERVERS_DIR = path.join(USER_DATA, 'servers');
fs.ensureDirSync(SERVERS_DIR);

// Hide noisy auth library console output (app polish)
if (!global.__zenonStdoutPatched) {
  const patchStream = (stream) => {
    const origWrite = stream.write.bind(stream);
    stream.write = (chunk, encoding, cb) => {
      try {
        const str = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        if (
          str.includes('[msa]') ||
          (str.includes('microsoft.com/link') && str.toLowerCase().includes('use the code'))
        ) {
          if (typeof cb === 'function') cb();
          return true;
        }
      } catch (e) {}
      return origWrite(chunk, encoding, cb);
    };
  };
  patchStream(process.stdout);
  patchStream(process.stderr);
  global.__zenonStdoutPatched = true;
}

function withSilencedAuthLogs(fn) {
  const wrap = (orig) => (...args) => {
    const first = args?.[0];
    if (typeof first === 'string' && first.startsWith('[msa]')) return;
    return orig(...args);
  };

  const orig = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  };

  console.log = wrap(orig.log);
  console.info = wrap(orig.info);
  console.warn = wrap(orig.warn);
  console.error = wrap(orig.error);

  try {
    return fn();
  } finally {
    console.log = orig.log;
    console.info = orig.info;
    console.warn = orig.warn;
    console.error = orig.error;
  }
}

// ===== Microsoft (device-code) auth =====
const DEFAULT_MSA_CLIENT_ID = '00000000402b5328'; // Minecraft Java Edition (legacy public client id)
const FALLBACK_MSA_CLIENT_IDS = ['000000004c12ae6f', '0000000048183522']; // Xbox App iOS, Minecraft Android
const MSA_DEVICE_CODE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const MSA_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';

function nowMs() { return Date.now(); }

function isExpired(expiresAtMs, skewMs = 60_000) {
  if (!expiresAtMs) return true;
  return nowMs() + skewMs >= expiresAtMs;
}

async function postForm(url, form, headers = {}) {
  const body = new URLSearchParams(form).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers
    },
    body
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error_description || json?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

async function postJson(url, payload, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.errorMessage || json?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.errorMessage || json?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

function getAuthFromSettings(settings) {
  return settings?.auth || null;
}

/** If settings has a Minecraft token but missing profile, derive from JWT and save (fixes “stuck” loggedIn). */
function repairAuthProfileIfNeeded(settings) {
  const auth = settings?.auth;
  if (!auth?.minecraft?.accessToken) return settings;
  if (auth.profile?.id && auth.profile?.name) return settings;
  const prof = profileFromMinecraftResponse({ token: auth.minecraft.accessToken, profile: auth.profile || {} });
  if (!prof) return settings;
  const next = { ...settings, auth: { ...auth, profile: prof } };
  saveSettings(next);
  zenonAuthLog('auth_profile_repaired', prof.name);
  return next;
}

function getAuthState(settings) {
  const s = repairAuthProfileIfNeeded(settings);
  const auth = getAuthFromSettings(s);
  const profile = auth?.profile || null;
  const mc = auth?.minecraft || null;
  const onlineLoggedIn = !!(profile?.id && profile?.name && mc?.accessToken && !isExpired(mc.expiresAt));
  if (onlineLoggedIn) return { loggedIn: true, profile };

  // Offline mode (no Microsoft token) — still allows local play.
  const offlineEnabled = !!s?.offlineEnabled;
  const name = String(s?.username || 'Player').trim() || 'Player';
  if (offlineEnabled) {
    return { loggedIn: true, profile: { id: offlineUuidForName(name), name }, offline: true };
  }
  return { loggedIn: false, profile: null };
}

function offlineUuidForName(name) {
  const n = String(name || 'Player').trim() || 'Player';
  const hex = crypto.createHash('md5').update(`OfflinePlayer:${n}`, 'utf8').digest('hex');
  // Format as UUID string (not necessarily v4, but stable and valid-shaped).
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Visible in the terminal (not filtered by stdout patch) + sent to renderer as auth:log */
function zenonAuthLog(step, detail = '') {
  const tail = detail ? ` ${detail}` : '';
  console.log(`[zenon-auth] ${step}${tail}`);
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('auth:log', { step, detail: String(detail || ''), at: new Date().toISOString() });
    }
  } catch (e) {}
}

function notifyAuthFinished(ok) {
  const send = () => {
    const settings = loadSettings();
    const sess = global.__zenonAuthSession;
    let st = null;
    try {
      st = ok ? getAuthState(settings) : null;
    } catch (e) {
      zenonAuthLog('verify_state_error', e?.message || String(e));
    }
    const detail = ok
      ? (st?.loggedIn
        ? `loggedIn as ${st.profile?.name || '?'}`
        : `not loggedIn (hasToken=${!!settings?.auth?.minecraft?.accessToken} hasProf=${!!(settings?.auth?.profile?.id && settings?.auth?.profile?.name)})`)
      : (sess?.error || 'unknown');
    zenonAuthLog(ok ? 'verify_complete' : 'verify_failed', detail);

    try {
      if (!mainWindow?.webContents || mainWindow.webContents.isDestroyed()) return;
      mainWindow.webContents.send('auth:finished', {
        ok,
        state: ok ? getAuthState(loadSettings()) : undefined,
        error: ok ? undefined : (sess?.error || 'Auth failed')
      });
    } catch (e) {}
  };
  setImmediate(send);
}

function jwtPayloadB64(b64url) {
  const b64 = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return Buffer.from(b64 + pad, 'base64').toString('utf8');
}

function normalizeUuidString(uuid) {
  if (!uuid || typeof uuid !== 'string') return null;
  let u = uuid.startsWith('urn:uuid:') ? uuid.slice('urn:uuid:'.length) : uuid;
  if (u.includes('-') === false && u.length === 32) {
    u = `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`;
  }
  return /^[0-9a-f-]{36}$/i.test(u) ? u : null;
}

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

/** Prefer Electron/Node undici fetch — node-fetch v2 + AbortSignal is flaky in some Electron versions. */
function nativeFetch(url, opts) {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(url, opts);
  return fetch(url, opts);
}

/** Bounded-time profile fetch (prismarine’s fetch has no timeout and can hang the sign-in UI). */
async function fetchMinecraftProfileShort(accessToken, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await nativeFetch('https://api.minecraftservices.com/minecraft/profile', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'MinecraftLauncher/2.2.10675',
        Accept: 'application/json'
      },
      signal: ac.signal
    });
    if (!res.ok) {
      zenonAuthLog('profile_api_http', String(res.status));
      return null;
    }
    return await res.json();
  } catch (e) {
    zenonAuthLog('profile_api_err', e?.message || String(e));
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function startDeviceCodeFlow(settings) {
  // Prismarine-auth handles client id quirks/policies better than custom code.
  // We keep the old settings fields, but auth is driven through the library.
  fs.ensureDirSync(AUTH_CACHE_DIR);

  if (global.__zenonAuthSession?.status === 'polling' || global.__zenonAuthSession?.status === 'waiting_code') {
    const s = global.__zenonAuthSession;
    if (s.codePayload) {
      zenonAuthLog('device_flow_reuse', 'returning existing device code');
      return s.codePayload;
    }
    zenonAuthLog('device_flow_reuse', 'waiting for existing code promise');
    return await s.codePromise;
  }

  zenonAuthLog('device_flow_start');

  const session = {
    status: 'waiting_code',
    codePayload: null,
    error: null,
    done: null,
    codePromise: null
  };
  global.__zenonAuthSession = session;

  let codeResolve;
  session.codePromise = new Promise((resolve) => { codeResolve = resolve; });

  // forceRefresh: must run full MSA device-code path (stale MC cache used to skip MSA and hang codePromise)
  // prismarine-auth: device-code callback is the 4th constructor arg, NOT options.codeCallback
  // flow: 'sisu' — MinecraftJava + Win32 with 'live' often returns HTTP 403 Forbidden on XSTS (see prismarine-auth docs/API.md FAQ).
  const flow = new Authflow(
    'zenon',
    AUTH_CACHE_DIR,
    {
      flow: 'sisu',
      authTitle: Titles.MinecraftJava,
      deviceType: 'Win32',
      forceRefresh: true
    },
    (r) => {
      session.status = 'polling';
      session.codePayload = {
        user_code: r.user_code,
        device_code: r.device_code,
        verification_uri: r.verification_uri,
        verification_uri_complete: r.verification_uri_complete,
        expires_in: r.expires_in,
        interval: r.interval
      };
      zenonAuthLog('device_code_issued', `user_code=${r.user_code}`);
      codeResolve(session.codePayload);
    }
  );

  session.done = withSilencedAuthLogs(() => (async () => {
    zenonAuthLog('microsoft_poll', 'waiting for browser approval + Xbox/Minecraft token…');
    // fetchProfile/fetchEntitlements inside prismarine use fetch() with no timeout and can hang forever
    // after the browser already shows “signed in”, leaving the launcher stuck on “Waiting…”.
    const AUTH_CHAIN_MS = 180_000;
    const mc = await Promise.race([
      flow.getMinecraftJavaToken({ fetchProfile: false, fetchEntitlements: false }),
      new Promise((_, rej) =>
        setTimeout(
          () =>
            rej(
              new Error(
                'Sign-in stalled while contacting Xbox or Minecraft services. Check your connection, VPN, or firewall, then try again.'
              )
            ),
          AUTH_CHAIN_MS
        )
      )
    ]);
    if (!mc?.token) throw new Error('Microsoft login failed: no access token');
    zenonAuthLog('minecraft_token_received');
    const apiProfile = await fetchMinecraftProfileShort(mc.token, 12_000);
    const mcForProfile =
      apiProfile && apiProfile.id && apiProfile.name ? { ...mc, profile: apiProfile } : mc;
    const profile = profileFromMinecraftResponse(mcForProfile);
    if (!profile) {
      throw new Error('Could not read your Minecraft profile. If you use Game Pass, sign in once on minecraft.net or the official launcher, then try again.');
    }
    zenonAuthLog('profile_ok', profile.name);

    const current = loadSettings();
    const auth = {
      clientToken: uuidv4(),
      minecraft: { accessToken: mc.token, expiresAt: nowMs() + 86_400_000 },
      profile: { id: profile.id, name: profile.name },
      loggedInAt: new Date().toISOString()
    };
    saveSettings({ ...current, auth });
    session.status = 'success';
    zenonAuthLog('session_saved');
    notifyAuthFinished(true);
    return auth;
  })()).catch((e) => {
    session.status = 'error';
    session.error = e?.message || 'Auth failed';
    zenonAuthLog('session_error', session.error);
    notifyAuthFinished(false);
  });

  // Wait until we have a code to return (IPC can then show link + code in the UI)
  return await session.codePromise;
}

async function pollDeviceCodeToken(settings, deviceCode) {
  const clientId = settings?.msaClientId || DEFAULT_MSA_CLIENT_ID;
  return await postForm(MSA_TOKEN_URL, {
    client_id: clientId,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: deviceCode
  });
}

async function refreshMsaToken(settings, refreshToken) {
  const clientId = settings?.msaClientId || DEFAULT_MSA_CLIENT_ID;
  const scope = settings?.msaScopes || 'XboxLive.signin offline_access';
  return await postForm(MSA_TOKEN_URL, {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope
  });
}

async function acquireMinecraftTokens(msaAccessToken) {
  // XBL: user authenticate
  const xbl = await postJson(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msaAccessToken}`
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    }
  );

  const xblToken = xbl.Token;
  const uhs = xbl?.DisplayClaims?.xui?.[0]?.uhs;
  if (!xblToken || !uhs) throw new Error('Xbox Live auth failed');

  // XSTS: authorize
  const xsts = await postJson(
    'https://xsts.auth.xboxlive.com/xsts/authorize',
    {
      Properties: {
        SandboxId: 'RETAIL',
        UserTokens: [xblToken]
      },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    }
  );

  const xstsToken = xsts.Token;
  if (!xstsToken) throw new Error('XSTS auth failed');

  // Minecraft: login with xbox
  const mcAuth = await postJson(
    'https://api.minecraftservices.com/authentication/login_with_xbox',
    { identityToken: `XBL3.0 x=${uhs};${xstsToken}` }
  );

  const mcAccessToken = mcAuth.access_token;
  const mcExpiresIn = mcAuth.expires_in || 0;
  if (!mcAccessToken) throw new Error('Minecraft auth failed');

  // Verify entitlements (owns game)
  const ent = await getJson('https://api.minecraftservices.com/entitlements/mcstore', {
    Authorization: `Bearer ${mcAccessToken}`
  });
  const hasEntitlement = Array.isArray(ent?.items) && ent.items.length > 0;
  if (!hasEntitlement) throw new Error('Minecraft not owned on this account');

  // Profile (uuid + name)
  const profile = await getJson('https://api.minecraftservices.com/minecraft/profile', {
    Authorization: `Bearer ${mcAccessToken}`
  });
  if (!profile?.id || !profile?.name) throw new Error('Failed to fetch Minecraft profile');

  return {
    minecraft: {
      accessToken: mcAccessToken,
      expiresAt: nowMs() + (mcExpiresIn * 1000)
    },
    profile: {
      id: profile.id,
      name: profile.name
    },
    xbox: { uhs }
  };
}

async function ensureMinecraftAuthFresh() {
  const settings = loadSettings();
  const auth = settings.auth || {};

  // Offline mode: return a synthetic auth object.
  if (settings?.offlineEnabled) {
    const name = String(settings.username || 'Player').trim() || 'Player';
    return {
      settings,
      auth: {
        clientToken: auth.clientToken || uuidv4(),
        minecraft: { accessToken: '0', expiresAt: nowMs() + 10 * 365 * 24 * 60 * 60 * 1000 },
        profile: { id: offlineUuidForName(name), name },
        offline: true
      }
    };
  }

  if (auth?.minecraft?.accessToken && !isExpired(auth.minecraft.expiresAt)) {
    return { settings, auth };
  }

  // Re-acquire using prismarine-auth cache (device-code login will be required if cache is empty/expired)
  fs.ensureDirSync(AUTH_CACHE_DIR);
  const flow = new Authflow('zenon', AUTH_CACHE_DIR, {
    flow: 'sisu',
    authTitle: Titles.MinecraftJava,
    deviceType: 'Win32'
  });

  const mc = await withSilencedAuthLogs(() =>
    flow.getMinecraftJavaToken({ fetchProfile: false, fetchEntitlements: false })
  );
  if (!mc?.token) {
    throw new Error('Not logged in. Please sign in with Microsoft.');
  }
  const apiProfile = await fetchMinecraftProfileShort(mc.token, 12_000);
  const mcForProfile =
    apiProfile && apiProfile.id && apiProfile.name ? { ...mc, profile: apiProfile } : mc;
  const prof = profileFromMinecraftResponse(mcForProfile);
  if (!prof) {
    throw new Error('Not logged in. Please sign in with Microsoft.');
  }

  const updated = {
    clientToken: auth.clientToken || uuidv4(),
    minecraft: { accessToken: mc.token, expiresAt: nowMs() + 86_400_000 },
    profile: { id: prof.id, name: prof.name },
    loggedInAt: auth.loggedInAt || new Date().toISOString()
  };
  const newSettings = { ...settings, auth: updated };
  saveSettings(newSettings);
  return { settings: newSettings, auth: updated };
}

// Default settings
function getDefaultSettings() {
  return {
    username: 'Player',
    javaPath: 'java',
    maxRam: '2G',
    minRam: '512M',
    theme: 'zenon',
    closeOnLaunch: false,
    /** Parallel HTTP sockets for MCLC downloads (8–64). Higher = faster first-time asset/library fetch. */
    mcDownloadSockets: 40,
    msaClientId: DEFAULT_MSA_CLIENT_ID,
    msaScopes: 'XboxLive.signin offline_access',
    auth: null,
    offlineEnabled: false
  };
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...getDefaultSettings(), ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
  } catch (e) {}
  return getDefaultSettings();
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function normalizeInstanceDisplayName(raw, fallback = 'Instance') {
  // Display name only (instance folders are UUIDs), so be permissive:
  // - Keep emojis / symbols
  // - Strip control chars
  // - Collapse newlines to spaces
  // - Ensure we always return something non-empty
  let s = String(raw == null ? '' : raw)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u001f\u007f]/g, ''); // control chars
  s = s.replace(/\n+/g, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (!s) s = String(fallback || 'Instance');
  return s.slice(0, 80);
}

// Instance icons (stored inside instance folder for portability)
function instanceIconDir(instanceId) {
  return path.join(INSTANCES_DIR, instanceId, '.zenon');
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

function writeInstanceIconFile(instanceId, buffer, extOrMime) {
  const ext = normalizeIconExt(extOrMime);
  const dir = instanceIconDir(instanceId);
  fs.ensureDirSync(dir);
  const rel = iconRelPathForExt(ext);
  const full = path.join(INSTANCES_DIR, instanceId, rel);
  fs.writeFileSync(full, buffer);
  return rel;
}

async function downloadInstanceIconFromUrl(instanceId, url) {
  const u = String(url || '').trim();
  if (!u) return null;
  const res = await fetch(u, { headers: { 'User-Agent': 'ZenonClient/1.0.0' } });
  if (!res.ok) throw new Error(`Icon download failed (HTTP ${res.status})`);
  const ct = res.headers.get('content-type') || '';
  const buf = await res.buffer();
  const rel = writeInstanceIconFile(instanceId, buf, ct);
  return rel;
}

// Instance management
function loadInstances() {
  const instances = [];
  if (!fs.existsSync(INSTANCES_DIR)) return instances;
  const dirs = fs.readdirSync(INSTANCES_DIR);
  for (const dir of dirs) {
    const configPath = path.join(INSTANCES_DIR, dir, 'instance.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (String(config.id || '') !== String(dir)) {
          config.id = dir;
          try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
          } catch (e2) {}
        }
        if (config.name == null || String(config.name).trim() === '') {
          config.name = 'Instance';
          try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
          } catch (e3) {}
        } else {
          const nn = normalizeInstanceDisplayName(config.name, 'Instance');
          if (nn !== config.name) {
            config.name = nn;
            try {
              fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            } catch (e4) {}
          }
        }
        if (config.dir) scaffoldInstanceLayout(config.dir);
        instances.push(config);
      } catch (e) {}
    }
  }
  return instances;
}

function createInstance(data) {
  const id = uuidv4();
  const instanceDir = path.join(INSTANCES_DIR, id);
  fs.ensureDirSync(instanceDir);
  scaffoldInstanceLayout(instanceDir);

  const instance = {
    id,
    name: normalizeInstanceDisplayName(data.name, 'Instance'),
    version: data.version,
    versionType: data.versionType || 'release',
    loader: data.loader || 'vanilla',
    loaderVersion: data.loaderVersion || null,
    created: new Date().toISOString(),
    lastPlayed: null,
    playTime: 0,
    icon: data.icon || 'default',
    libraryGroup: data.libraryGroup || '',
    javaPathOverride: null,
    maxRamOverride: null,
    minRamOverride: null,
    windowWidth: null,
    windowHeight: null,
    windowFullscreen: false,
    hookPreLaunch: '',
    hookPostExit: '',
    hookWrapper: '',
    hooksCustomEnabled: false,
    jvmArgs: '',
    jvmArgsEnabled: false,
    javaCustomEnabled: false,
    memoryCustomEnabled: false,
    windowCustomEnabled: false,
    dir: instanceDir
  };

  fs.writeFileSync(path.join(instanceDir, 'instance.json'), JSON.stringify(instance, null, 2));
  return instance;
}

function deleteInstance(id) {
  const instanceDir = path.join(INSTANCES_DIR, id);
  if (fs.existsSync(instanceDir)) {
    fs.removeSync(instanceDir);
    return true;
  }
  return false;
}

function updateInstance(id, updates) {
  const instanceDir = path.join(INSTANCES_DIR, id);
  const configPath = path.join(instanceDir, 'instance.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const patch = { ...updates };
    if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
      patch.name = normalizeInstanceDisplayName(patch.name, 'Instance');
    }
    const updated = { ...config, ...patch };
    updated.id = id;
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
    return updated;
  } catch (e) {
    return null;
  }
}

// ===== Instance import/export (zip) =====
function normalizeImportedInstanceLayout(instanceDir) {
  const rootConfig = path.join(instanceDir, 'instance.json');
  if (fs.existsSync(rootConfig)) return rootConfig;

  const children = fs.readdirSync(instanceDir).filter(n => !n.startsWith('.'));
  if (children.length !== 1) return null;
  const onlyChild = path.join(instanceDir, children[0]);
  if (!fs.statSync(onlyChild).isDirectory()) return null;

  const nestedConfig = path.join(onlyChild, 'instance.json');
  if (!fs.existsSync(nestedConfig)) return null;

  // Move nested contents up one level
  const nestedItems = fs.readdirSync(onlyChild);
  for (const item of nestedItems) {
    fs.moveSync(path.join(onlyChild, item), path.join(instanceDir, item), { overwrite: true });
  }
  fs.removeSync(onlyChild);
  return path.join(instanceDir, 'instance.json');
}

async function exportInstanceZip(instanceId) {
  const instanceDir = path.join(INSTANCES_DIR, instanceId);
  const configPath = path.join(instanceDir, 'instance.json');
  if (!fs.existsSync(configPath)) throw new Error('Instance not found');

  const inst = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const suggested = `${(inst.name || 'instance').replace(/[\\\\/:*?\"<>|]/g, '_')}.zip`;

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Instance',
    defaultPath: suggested,
    filters: [{ name: 'Zip', extensions: ['zip'] }]
  });
  if (canceled || !filePath) return { canceled: true };

  const zip = new AdmZip();
  zip.addLocalFolder(instanceDir, '');
  zip.writeZip(filePath);
  return { success: true, path: filePath };
}

async function importInstanceZip() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Instance',
    properties: ['openFile'],
    filters: [{ name: 'Zip', extensions: ['zip'] }]
  });
  if (canceled || !filePaths?.[0]) return { canceled: true };

  const zipPath = filePaths[0];
  const newId = uuidv4();
  const instanceDir = path.join(INSTANCES_DIR, newId);
  fs.ensureDirSync(instanceDir);

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(instanceDir, true);

  const normalizedConfigPath = normalizeImportedInstanceLayout(instanceDir);
  if (!normalizedConfigPath) {
    fs.removeSync(instanceDir);
    throw new Error('Invalid instance zip (missing instance.json)');
  }

  const config = JSON.parse(fs.readFileSync(normalizedConfigPath, 'utf8'));
  const imported = {
    ...config,
    id: newId,
    dir: instanceDir,
    name: config.name ? `${config.name} (Imported)` : 'Imported Instance',
    created: new Date().toISOString(),
    lastPlayed: null,
    libraryGroup: config.libraryGroup ?? '',
    javaPathOverride: config.javaPathOverride ?? null,
    maxRamOverride: config.maxRamOverride ?? null,
    minRamOverride: config.minRamOverride ?? null,
    windowWidth: config.windowWidth ?? null,
    windowHeight: config.windowHeight ?? null,
    windowFullscreen: config.windowFullscreen ?? false,
    hookPreLaunch: config.hookPreLaunch ?? '',
    hookPostExit: config.hookPostExit ?? config.hookPostLaunch ?? '',
    hookWrapper: config.hookWrapper ?? '',
    hooksCustomEnabled: config.hooksCustomEnabled ?? false,
    jvmArgs: config.jvmArgs ?? '',
    jvmArgsEnabled: config.jvmArgsEnabled ?? false,
    javaCustomEnabled: config.javaCustomEnabled ?? false,
    memoryCustomEnabled: config.memoryCustomEnabled ?? false,
    windowCustomEnabled: config.windowCustomEnabled ?? false
  };

  fs.writeFileSync(path.join(instanceDir, 'instance.json'), JSON.stringify(imported, null, 2));
  scaffoldInstanceLayout(instanceDir);
  return { success: true, instance: imported };
}

// Mod management
const CONTENT_FOLDERS = {
  mod: 'mods',
  shaderpack: 'shaderpacks',
  resourcepack: 'resourcepacks',
  datapack: 'datapacks',
  modpack: 'modpacks'
};

// Server-side content folders (inside server dir)
const SERVER_CONTENT_FOLDERS = {
  mod: 'mods', // Fabric/Forge server mods
  plugin: 'plugins' // Paper plugins
};

function getContentDir(instanceId, kind) {
  const folder = CONTENT_FOLDERS[kind];
  if (!folder) throw new Error(`Unknown content type: ${kind}`);
  const dir = path.join(INSTANCES_DIR, instanceId, folder);
  fs.ensureDirSync(dir);
  return dir;
}

function getContentMetaPath(instanceId, kind) {
  // Stored inside instance folder for export/import portability
  const safeKind = String(kind || 'mod').replace(/[^a-z0-9_-]/gi, '');
  return path.join(INSTANCES_DIR, instanceId, '.zenon', `content-meta-${safeKind}.json`);
}

function readContentMeta(instanceId, kind) {
  try {
    const p = getContentMetaPath(instanceId, kind);
    if (!fs.existsSync(p)) return {};
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch (e) {
    return {};
  }
}

function writeContentMeta(instanceId, kind, meta) {
  const p = getContentMetaPath(instanceId, kind);
  fs.ensureDirSync(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(meta || {}, null, 2));
}

function getServerContentDir(serverId, kind) {
  const cfg = readServerConfig(serverId);
  if (!cfg) throw new Error('Unknown server.');
  const serverDir = cfg.dir || path.join(SERVERS_DIR, serverId);
  const folder = SERVER_CONTENT_FOLDERS[String(kind || '').toLowerCase()];
  if (!folder) throw new Error(`Unknown server content type: ${kind}`);
  const dir = path.join(serverDir, folder);
  fs.ensureDirSync(dir);
  return dir;
}

function getServerContentMetaPath(serverId, kind) {
  const cfg = readServerConfig(serverId);
  if (!cfg) throw new Error('Unknown server.');
  const serverDir = cfg.dir || path.join(SERVERS_DIR, serverId);
  const safeKind = String(kind || 'mod').replace(/[^a-z0-9_-]/gi, '');
  return path.join(serverDir, '.zenon', `content-meta-${safeKind}.json`);
}

function readServerContentMeta(serverId, kind) {
  try {
    const p = getServerContentMetaPath(serverId, kind);
    if (!fs.existsSync(p)) return {};
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch (e) {
    return {};
  }
}

function writeServerContentMeta(serverId, kind, meta) {
  const p = getServerContentMetaPath(serverId, kind);
  fs.ensureDirSync(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(meta || {}, null, 2));
}

function listServerContent(serverId, kind) {
  const dir = getServerContentDir(serverId, kind);
  const meta = readServerContentMeta(serverId, kind);
  const files = fs.readdirSync(dir);
  return files
    .filter((f) => /\.(jar|zip)(?:\.disabled)?$/i.test(f))
    .map((file) => ({
      filename: file,
      enabled: !file.endsWith('.disabled'),
      displayName: normalizeDisplayName(file),
      size: fs.statSync(path.join(dir, file)).size,
      path: path.join(dir, file),
      kind,
      projectId: meta?.[file]?.projectId || null,
      title: meta?.[file]?.title || null,
      iconUrl: meta?.[file]?.iconUrl || null,
      author: meta?.[file]?.author || null
    }));
}

function toggleServerContent(serverId, kind, filename) {
  const dir = getServerContentDir(serverId, kind);
  const currentPath = path.join(dir, filename);
  let newPath;
  if (filename.endsWith('.disabled')) newPath = currentPath.replace('.disabled', '');
  else newPath = currentPath + '.disabled';
  fs.renameSync(currentPath, newPath);
  return path.basename(newPath);
}

function deleteServerContent(serverId, kind, filename) {
  const dir = getServerContentDir(serverId, kind);
  const filePath = path.join(dir, filename);
  if (fs.existsSync(filePath)) {
    fs.removeSync(filePath);
    return true;
  }
  return false;
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

    return { success: true, filename: pick.filename };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function normalizeDisplayName(filename) {
  return filename
    .replace('.disabled', '')
    .replace(/\.jar$/i, '')
    .replace(/\.zip$/i, '')
    .replace(/\.mrpack$/i, '');
}

function listInstanceContent(instanceId, kind) {
  const dir = getContentDir(instanceId, kind);
  const meta = readContentMeta(instanceId, kind);
  const files = fs.readdirSync(dir);
  return files.map(file => ({
    filename: file,
    enabled: !file.endsWith('.disabled'),
    displayName: normalizeDisplayName(file),
    size: fs.statSync(path.join(dir, file)).size,
    path: path.join(dir, file),
    kind,
    projectId: meta?.[file]?.projectId || null,
    title: meta?.[file]?.title || null,
    iconUrl: meta?.[file]?.iconUrl || null,
    author: meta?.[file]?.author || null
  }));
}

function toggleInstanceContent(instanceId, kind, filename) {
  const dir = getContentDir(instanceId, kind);
  const currentPath = path.join(dir, filename);
  let newPath;
  if (filename.endsWith('.disabled')) newPath = currentPath.replace('.disabled', '');
  else newPath = currentPath + '.disabled';
  fs.renameSync(currentPath, newPath);
  return path.basename(newPath);
}

function deleteInstanceContent(instanceId, kind, filename) {
  const dir = getContentDir(instanceId, kind);
  const filePath = path.join(dir, filename);
  if (fs.existsSync(filePath)) {
    fs.removeSync(filePath);
    return true;
  }
  return false;
}

function readInstanceConfig(instanceId) {
  const configPath = path.join(INSTANCES_DIR, instanceId, 'instance.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function getInstanceRootDir(instanceId) {
  const cfg = readInstanceConfig(instanceId);
  if (!cfg) return null;
  return cfg.dir || path.join(INSTANCES_DIR, instanceId);
}

/** Minecraft-style folders + placeholder options.txt (matches typical instance layout). */
function scaffoldInstanceLayout(instanceDir) {
  if (!instanceDir || typeof instanceDir !== 'string') return;
  try {
    fs.ensureDirSync(instanceDir);
    const subdirs = [
      '.fabric',
      'assets',
      'cache',
      'datapacks',
      'libraries',
      'logs',
      'mods',
      'modpacks',
      'resourcepacks',
      'saves',
      'screenshots',
      'shaderpacks',
      'versions'
    ];
    for (const d of subdirs) {
      fs.ensureDirSync(path.join(instanceDir, d));
    }
    const optPath = path.join(instanceDir, 'options.txt');
    if (!fs.existsSync(optPath)) {
      fs.writeFileSync(
        optPath,
        '# Zenon Client — Minecraft will fill this file when you run the game.\n',
        'utf8'
      );
    }
  } catch (e) {
    /* non-fatal */
  }
}

function repairInstance(instanceId) {
  const dir = getInstanceRootDir(instanceId);
  if (!dir || !fs.existsSync(dir)) throw new Error('Instance not found');
  scaffoldInstanceLayout(dir);
  const cacheDir = path.join(dir, 'cache');
  if (fs.existsSync(cacheDir)) {
    try {
      fs.emptyDirSync(cacheDir);
    } catch (e) {
      /* ignore */
    }
  }
  return true;
}

function duplicateInstance(instanceId) {
  const cfg = readInstanceConfig(instanceId);
  if (!cfg || !cfg.dir || !fs.existsSync(cfg.dir)) {
    throw new Error('Instance not found');
  }
  const newId = uuidv4();
  const newDir = path.join(INSTANCES_DIR, newId);
  if (fs.existsSync(newDir)) throw new Error('Could not create duplicate folder');
  fs.copySync(cfg.dir, newDir);
  const baseName = (cfg.name || 'Instance').replace(/\s*\(copy\)\s*\d*$/i, '').trim() || 'Instance';
  const newCfg = {
    ...cfg,
    id: newId,
    dir: newDir,
    name: `${baseName} (copy)`,
    created: new Date().toISOString(),
    lastPlayed: null,
    playTime: 0
  };
  fs.writeFileSync(path.join(newDir, 'instance.json'), JSON.stringify(newCfg, null, 2));
  scaffoldInstanceLayout(newDir);
  return newCfg;
}

function listInstanceRoot(instanceId) {
  const root = getInstanceRootDir(instanceId);
  if (!root || !fs.existsSync(root)) return [];
  const items = [];
  for (const name of fs.readdirSync(root)) {
    if (name === '.' || name === '..') continue;
    const full = path.join(root, name);
    let type = 'file';
    try {
      type = fs.statSync(full).isDirectory() ? 'dir' : 'file';
    } catch (e) {
      continue;
    }
    items.push({ name, type });
  }
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return items;
}

function listInstanceWorlds(instanceId) {
  const root = getInstanceRootDir(instanceId);
  if (!root) return [];
  const saves = path.join(root, 'saves');
  if (!fs.existsSync(saves)) return [];
  return fs.readdirSync(saves, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name }));
}

function readInstanceLatestLog(instanceId, maxBytes = 120000) {
  const root = getInstanceRootDir(instanceId);
  if (!root) return { found: false, text: '' };
  const logPath = path.join(root, 'logs', 'latest.log');
  if (!fs.existsSync(logPath)) {
    return { found: false, text: 'No log file yet. Launch the game once to generate logs/latest.log.' };
  }
  try {
    const stat = fs.statSync(logPath);
    const fd = fs.openSync(logPath, 'r');
    const start = Math.max(0, stat.size - maxBytes);
    const len = stat.size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    return { found: true, text: buf.toString('utf8') };
  } catch (e) {
    return { found: false, text: e.message || String(e) };
  }
}

// Backwards-compatible wrappers for existing renderer code
function getInstanceMods(instanceId) {
  return listInstanceContent(instanceId, 'mod');
}
function toggleMod(instanceId, filename) {
  return toggleInstanceContent(instanceId, 'mod', filename);
}
function deleteMod(instanceId, filename) {
  return deleteInstanceContent(instanceId, 'mod', filename);
}

// ----- Dedicated servers (vanilla jar from Mojang metadata) -----
function readServerConfig(serverId) {
  const p = path.join(SERVERS_DIR, serverId, 'server.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

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
  const buildsR = await nativeFetch(
    `https://api.papermc.io/v2/projects/paper/versions/${encodeURIComponent(version)}/builds`
  );
  if (!buildsR.ok) throw new Error(`Paper has no builds for ${version} (HTTP ${buildsR.status}).`);
  const buildsData = await buildsR.json();
  const builds = (buildsData.builds || []).filter((b) => b.downloads?.application?.name);
  if (!builds.length) throw new Error(`No downloadable Paper builds for ${version}.`);
  const latest = builds.reduce((a, b) => (b.build > a.build ? b : a));
  const bn = latest.build;
  const fname = latest.downloads.application.name;
  const url = `https://api.papermc.io/v2/projects/paper/versions/${encodeURIComponent(version)}/builds/${bn}/downloads/${encodeURIComponent(fname)}`;
  const jarR = await nativeFetch(url);
  if (!jarR.ok) throw new Error(`Paper jar HTTP ${jarR.status}`);
  const buf = Buffer.from(await jarR.arrayBuffer());
  fs.writeFileSync(path.join(dir, 'server.jar'), buf);
}

function isSnapshotLikeMcVersion(versionId, manifest) {
  if (!versionId) return false;
  try {
    const hit = manifest?.versions?.find((v) => v.id === versionId);
    if (hit && hit.type && hit.type !== 'release') return true;
  } catch (e) {}
  return /snapshot|rc\d*(\.|$)|pre|beta|alpha/i.test(String(versionId));
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

/** Fabric removed the /server/jar redirect; use the official headless Fabric installer CLI instead. */
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
    const r = await nativeFetch('https://api.papermc.io/v2/projects/paper');
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.versions) ? j.versions : [];
  } catch (e) {
    return [];
  }
}

function compareForgeFullIdDesc(a, b) {
  const pa = String(a).split('-');
  const pb = String(b).split('-');
  const na = parseInt(pa[pa.length - 1], 10);
  const nb = parseInt(pb[pb.length - 1], 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(b).localeCompare(String(a));
}

const FORGE_FETCH_HEADERS = { 'User-Agent': 'ZenonClient/1.0 (Electron; +https://github.com/)' };

/** e.g. 1.21.10-rc1 → 1.21.10 (Forge promos/maven use release ids). */
function forgeMcVersionFallbacks(mcVersion) {
  const raw = String(mcVersion || '').trim();
  if (!raw) return [];
  const uniq = [];
  const add = (s) => {
    if (s && !uniq.includes(s)) uniq.push(s);
  };
  add(raw);
  const m = raw.match(/^(\d+\.\d+(?:\.\d+)?)-(.+)$/);
  if (m) {
    const tail = m[2];
    if (/^(rc|pre)\d*$/i.test(tail) || /^\d{2}w\d*[a-z]?$/i.test(tail) || /^snapshot$/i.test(tail) || /^alpha|beta/i.test(tail)) {
      add(m[1]);
    }
  }
  return uniq;
}

async function fetchForgeMavenVersionStrings() {
  const urls = [
    'https://maven.minecraftforge.net/releases/net/minecraftforge/forge/maven-metadata.xml',
    'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'
  ];
  for (const url of urls) {
    try {
      const mr = await nativeFetch(url, { headers: FORGE_FETCH_HEADERS });
      if (!mr.ok) continue;
      const text = await mr.text();
      const vers = [];
      const re = /<version>([^<]+)<\/version>/g;
      let m;
      while ((m = re.exec(text))) vers.push(m[1]);
      if (vers.length) return vers;
    } catch (e) {}
  }
  return [];
}

async function fetchForgeVersionsForMc(mcVersion) {
  if (!mcVersion) return [];
  const seen = new Set();
  const out = [];

  const addRow = (row) => {
    if (!row?.full || seen.has(row.full)) return;
    seen.add(row.full);
    out.push(row);
  };

  const mcKeys = forgeMcVersionFallbacks(mcVersion);

  try {
    const pr = await nativeFetch('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', {
      headers: FORGE_FETCH_HEADERS
    });
    if (pr.ok) {
      const j = await pr.json();
      const promos = j.promos || {};
      for (const mc of mcKeys) {
        for (const ch of ['recommended', 'latest']) {
          const k = `${mc}-${ch}`;
          const forgePart = promos[k];
          if (forgePart) {
            const full = `${mc}-${forgePart}`;
            addRow({ full, label: `${full} (${ch})`, channel: ch });
          }
        }
      }
    }
  } catch (e) {}

  try {
    const allVers = await fetchForgeMavenVersionStrings();
    for (const mc of mcKeys) {
      const prefix = `${mc}-`;
      for (const v of allVers) {
        if (v.startsWith(prefix)) addRow({ full: v, label: v, channel: 'build' });
      }
    }
  } catch (e) {}

  const rest = out.filter((o) => o.channel === 'build').sort((x, y) => compareForgeFullIdDesc(x.full, y.full));
  const head = out.filter((o) => o.channel !== 'build');
  return [...head, ...rest];
}

async function installForgeServerToDir(dir, forgeFull, javaExe) {
  const instDir = path.join(dir, '.zenon-forge-install');
  fs.ensureDirSync(instDir);
  const installerPath = path.join(instDir, `forge-${forgeFull}-installer.jar`);
  const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeFull}/forge-${forgeFull}-installer.jar`;
  const ir = await nativeFetch(url, { headers: FORGE_FETCH_HEADERS });
  if (!ir.ok) throw new Error(`Forge installer not found for ${forgeFull} (HTTP ${ir.status}).`);
  const buf = Buffer.from(await ir.arrayBuffer());
  fs.writeFileSync(installerPath, buf);

  const java = String(javaExe || 'java').trim() || 'java';
  const proc = spawnSync(java, ['-jar', installerPath, '--installServer'], {
    cwd: instDir,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    env: process.env,
    maxBuffer: 32 * 1024 * 1024
  });
  if (proc.error) throw new Error(`Forge install: ${proc.error.message}`);
  if (proc.status !== 0) {
    const err = `${proc.stderr || ''}\n${proc.stdout || ''}`.trim().slice(0, 800);
    throw new Error(`Forge installer exited with code ${proc.status}. ${err}`);
  }

  const names = fs.readdirSync(instDir);
  for (const n of names) {
    if (n === path.basename(installerPath)) continue;
    fs.moveSync(path.join(instDir, n), path.join(dir, n), { overwrite: true });
  }
  fs.removeSync(instDir);
}

async function createServerEntry(data) {
  const name = data?.name;
  const version = data?.version;
  const serverKind = String(data?.serverKind || 'vanilla').toLowerCase();
  if (!version) throw new Error('Select a Minecraft version');

  const settings = loadSettings();
  const javaExe = settings.javaPath || 'java';

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
    maxRamMb: Math.min(Math.max(parseInt(String(data?.maxRamMb || '2048'), 10) || 2048, 512), 16384),
    dir,
    created: new Date().toISOString()
  };
  fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify(entry, null, 2));
  return { entry, hint };
}

async function ensureForgeInstallerJar(forgeFull) {
  const sub = path.join(SHARED_MC_CACHE, 'forge-installers');
  fs.ensureDirSync(sub);
  const fileName = `forge-${forgeFull}-installer.jar`;
  const dest = path.join(sub, fileName);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 50000) return dest;
  const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeFull}/forge-${forgeFull}-installer.jar`;
  const ir = await nativeFetch(url, { headers: FORGE_FETCH_HEADERS });
  if (!ir.ok) throw new Error(`Could not download Forge installer for ${forgeFull} (HTTP ${ir.status}).`);
  const buf = Buffer.from(await ir.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

function deleteServerEntry(serverId) {
  const dir = path.join(SERVERS_DIR, serverId);
  if (fs.existsSync(dir)) fs.removeSync(dir);
  return true;
}

// ----- Dedicated server runtime (console, stdin, player heuristics) -----
const SERVER_RUNTIME = new Map();

function stripMcFormatting(s) {
  return String(s || '').replace(/§[0-9a-fk-or]/gi, '');
}

function sendToRenderer(channel, payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  } catch (e) {}
}

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

function resolveDedicatedServerLaunch(cfg) {
  const dir = cfg.dir;
  if (!dir || !fs.existsSync(dir)) return { error: 'Server folder missing' };
  const settings = loadSettings();
  const java = String(settings.javaPath || 'java').trim() || 'java';
  const maxRam = Math.min(
    Math.max(parseInt(String(cfg.maxRamMb || '2048'), 10) || 2048, 512),
    16384
  );
  const jvm = [`-Xms${Math.min(512, maxRam)}M`, `-Xmx${maxRam}M`];
  const kind = String(cfg.serverKind || 'vanilla').toLowerCase();

  if (kind === 'vanilla' || kind === 'paper') {
    const jar = path.join(dir, 'server.jar');
    if (!fs.existsSync(jar)) return { error: 'Missing server.jar' };
    return { cwd: dir, command: java, args: [...jvm, '-jar', 'server.jar', 'nogui'] };
  }

  if (kind === 'fabric') {
    let jarName = cfg.fabricLaunchJar || findFabricLaunchJarName(dir);
    if (!jarName) return { error: 'Could not find Fabric server jar in folder' };
    const jarPath = path.join(dir, jarName);
    if (!fs.existsSync(jarPath)) return { error: 'Fabric server jar path invalid' };
    return { cwd: dir, command: java, args: [...jvm, '-jar', jarName, 'nogui'] };
  }

  if (kind === 'forge') {
    if (process.platform === 'win32') {
      const bat = path.join(dir, 'run.bat');
      if (fs.existsSync(bat)) {
        return { cwd: dir, command: 'cmd.exe', args: ['/d', '/s', '/c', 'run.bat'], shell: false };
      }
    }
    const sh = path.join(dir, 'run.sh');
    if (fs.existsSync(sh)) {
      return { cwd: dir, command: 'sh', args: ['run.sh'], shell: false };
    }
    return { error: 'Forge: run.bat / run.sh not found. Open the folder and generate server files first.' };
  }

  return { error: `Unsupported server kind: ${kind}` };
}

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
  const launch = resolveDedicatedServerLaunch(cfg);
  if (launch.error) return { success: false, error: launch.error };

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

// Minecraft version manifest (cached for launch + create UI)
let __mcVersionManifestCache = null;
async function getMcVersionManifest() {
  if (__mcVersionManifestCache) return __mcVersionManifestCache;
  const res = await nativeFetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
  if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`);
  __mcVersionManifestCache = await res.json();
  return __mcVersionManifestCache;
}

/** All Mojang-published versions (newest first) for the create-instance picker. */
async function fetchMinecraftVersions() {
  try {
    const data = await getMcVersionManifest();
    const list = (data.versions || []).map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
    list.sort((a, b) => String(b.releaseTime).localeCompare(String(a.releaseTime)));
    return list;
  } catch (e) {
    return [];
  }
}

function resolveVersionTypeFromManifest(manifest, versionId, fallback = 'release') {
  if (!manifest?.versions || !versionId) return fallback;
  const hit = manifest.versions.find((v) => v.id === versionId);
  return hit?.type || fallback;
}

async function fetchFabricVersions(mcVersion) {
  try {
    const res = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`);
    const data = await res.json();
    const arr = Array.isArray(data) ? data : [];
    return arr.slice(0, 24).map((v) => ({
      version: v.loader?.version,
      stable: v.loader?.stable
    })).filter((v) => v.version);
  } catch (e) {
    return [];
  }
}

/**
 * MCLC expects `version.custom` to name a folder under `root/versions/` that contains
 * `{custom}.json` (Fabric's merged profile). It does not download that file — only vanilla jar/json.
 */
function fabricCustomVersionId(loaderVersion, mcVersion) {
  return `fabric-loader-${loaderVersion}-${mcVersion}`;
}

async function ensureFabricProfile(instanceDir, mcVersion, loaderVersion) {
  const customId = fabricCustomVersionId(loaderVersion, mcVersion);
  const versionFolder = path.join(instanceDir, 'versions', customId);
  const profilePath = path.join(versionFolder, `${customId}.json`);

  if (fs.existsSync(profilePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      if (existing && existing.id === customId && existing.inheritsFrom === mcVersion) {
        return customId;
      }
    } catch (e) {
      /* re-download */
    }
  }

  fs.ensureDirSync(versionFolder);
  const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const res = await nativeFetch(url);
  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 240);
    throw new Error(
      `Fabric profile not available (HTTP ${res.status}). Check that loader ${loaderVersion} supports Minecraft ${mcVersion}. ${snippet}`
    );
  }
  const profile = await res.json();
  if (!profile || typeof profile !== 'object') {
    throw new Error('Fabric meta returned an invalid profile JSON.');
  }
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  return customId;
}

// Modrinth API
async function searchModrinth({ query, version, loader, projectType = 'mod', limit = 20, offset = 0 }) {
  try {
    const facets = [];
    if (version) facets.push(`["versions:${version}"]`);
    if (loader) facets.push(`["categories:${loader}"]`);
    facets.push(`["project_type:${projectType}"]`);

    const facetsStr = `[${facets.join(',')}]`;
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(facetsStr)}&limit=${limit}&offset=${offset}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'ZenonClient/1.0.0' }
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e2) {
      data = { hits: [], total_hits: 0, error: `Invalid JSON from Modrinth (HTTP ${res.status})` };
    }
    if (!res.ok) {
      return { hits: [], total_hits: 0, error: `Modrinth HTTP ${res.status}: ${String(text || '').slice(0, 220)}` };
    }
    return data;
  } catch (e) {
    return { hits: [], total_hits: 0, error: e?.message || String(e) };
  }
}

// Spiget (Spigot plugins) API
function sanitizeJarBaseName(raw) {
  const s = String(raw || '').trim() || 'plugin';
  return s
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'plugin';
}

async function spigetSearchResources({ query, size = 20, page = 1, mode = 'search' }) {
  try {
    const lim = Math.min(Math.max(parseInt(String(size), 10) || 20, 1), 50);
    const pg = Math.max(parseInt(String(page), 10) || 1, 1);
    const m = String(mode || 'search').toLowerCase();
    let url = '';
    if (m === 'new') {
      url = `https://api.spiget.org/v2/resources/new?size=${lim}&page=${pg}`;
    } else if (m === 'free') {
      url = `https://api.spiget.org/v2/resources/free?size=${lim}&page=${pg}`;
    } else {
      const q = String(query || '').trim();
      if (!q) return [];
      const safeQ = encodeURIComponent(q);
      url = `https://api.spiget.org/v2/search/resources/${safeQ}?size=${lim}&page=${pg}`;
    }
    const res = await fetch(url, { headers: { 'User-Agent': 'ZenonClient/1.0.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

async function spigetGetResource(resourceId) {
  const id = String(resourceId || '').trim();
  if (!id) throw new Error('Missing resource id');
  const url = `https://api.spiget.org/v2/resources/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ZenonClient/1.0.0' } });
  if (!res.ok) throw new Error(`Spiget resource HTTP ${res.status}`);
  return await res.json();
}

async function spigetDownloadResourceJar(resourceId) {
  const id = String(resourceId || '').trim();
  if (!id) throw new Error('Missing resource id');
  const url = `https://api.spiget.org/v2/resources/${encodeURIComponent(id)}/download`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ZenonClient/1.0.0' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Spiget download HTTP ${res.status}`);
  const buf = await res.buffer();
  if (!buf?.length) throw new Error('Empty download');
  // Try to infer filename from content-disposition if provided.
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename\\*?=(?:UTF-8''|\"?)([^\";]+)\"?/i);
  const filename = m ? decodeURIComponent(m[1]) : '';
  return { buffer: buf, filenameHint: filename };
}

// CurseForge removed

async function getProjectVersions(projectId, mcVersion, loader, loaders = null) {
  try {
    let url = `https://api.modrinth.com/v2/project/${projectId}/version`;
    const params = [];
    if (mcVersion) {
      params.push(`game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}`);
    }
    if (loaders && Array.isArray(loaders) && loaders.length) {
      params.push(`loaders=${encodeURIComponent(JSON.stringify(loaders))}`);
    } else if (loader) {
      params.push(`loaders=${encodeURIComponent(JSON.stringify([loader]))}`);
    }
    if (params.length) url += '?' + params.join('&');

    const res = await fetch(url, {
      headers: { 'User-Agent': 'ZenonClient/1.0.0' }
    });
    return await res.json();
  } catch (e) {
    return [];
  }
}

function parseMcVersionFromModrinthDep(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    const m = raw.match(/(\d+\.\d+(?:\.\d+)?)/);
    return m ? m[1] : String(raw).trim();
  }
  if (typeof raw === 'object' && raw.version != null) return parseMcVersionFromModrinthDep(raw.version);
  return '';
}

function loaderFromMrpackDependencies(deps) {
  if (!deps || typeof deps !== 'object') return 'vanilla';
  if (deps['fabric-loader'] != null) return 'fabric';
  if (deps['quilt-loader'] != null) return 'quilt';
  if (deps.neoforge != null) return 'neoforge';
  if (deps.forge != null) return 'forge';
  return 'vanilla';
}

function safeJoinUnderInstanceRoot(instanceRoot, relPath) {
  const relative = String(relPath || '').replace(/\\/g, '/');
  if (!relative || relative.split('/').includes('..')) throw new Error(`Invalid path in modpack: ${relPath}`);
  const joined = path.resolve(path.join(instanceRoot, ...relative.split('/')));
  const rootResolved = path.resolve(instanceRoot);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (joined !== rootResolved && !joined.startsWith(prefix)) {
    throw new Error(`Path escapes instance root: ${relPath}`);
  }
  return joined;
}

async function fetchLatestFabricLoaderForMc(mcVersion) {
  try {
    const res = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`, {
      headers: { 'User-Agent': 'ZenonClient/1.0.0' }
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!Array.isArray(body) || body.length === 0) return null;
    const first = body[0];
    if (first && first.loader && first.loader.version) return first.loader.version;
  } catch (e) {}
  return null;
}

/**
 * Download a Modrinth .mrpack version, create a new instance, and extract pack files into its folder.
 */
async function createInstanceFromMrpack(versionData, displayName, iconUrl = null) {
  let inst = null;
  try {
    const file = versionData.files.find((f) => f.primary) || versionData.files[0];
    if (!file || !file.url) throw new Error('No modpack file on this version');

    const packRes = await fetch(file.url, { headers: { 'User-Agent': 'ZenonClient/1.0.0' } });
    if (!packRes.ok) throw new Error(`Download failed (HTTP ${packRes.status})`);
    const buffer = await packRes.buffer();

    const zip = new AdmZip(buffer);
    const indexEntry = zip.getEntry('modrinth.index.json');
    if (!indexEntry) throw new Error('Invalid .mrpack (missing modrinth.index.json)');
    let index;
    try {
      index = JSON.parse(indexEntry.getData().toString('utf8'));
    } catch (e) {
      throw new Error('Invalid modrinth.index.json');
    }
    const deps = index.dependencies || {};
    const mcFromVersion =
      Array.isArray(versionData.game_versions) && versionData.game_versions.length
        ? String(versionData.game_versions[0])
        : '';
    const mcFromIndex = parseMcVersionFromModrinthDep(deps.minecraft);
    const mcVersion = mcFromVersion || mcFromIndex || '1.20.1';
    let loader = loaderFromMrpackDependencies(deps);
    let loaderVersion = null;
    if (loader === 'fabric') {
      loaderVersion = await fetchLatestFabricLoaderForMc(mcVersion);
    }

    const baseNameRaw = (index.name || displayName || 'Modpack').replace(/[\\/:*?"<>|]/g, '').trim() || 'Modpack';
    inst = createInstance({
      name: baseNameRaw,
      version: mcVersion,
      versionType: 'release',
      loader,
      loaderVersion
    });
    const root = inst.dir;

    // Optional: fetch and store Modrinth icon as instance profile picture
    if (iconUrl) {
      try {
        const rel = await downloadInstanceIconFromUrl(inst.id, iconUrl);
        if (rel) {
          inst = updateInstance(inst.id, { icon: `img:${rel}` }) || inst;
        }
      } catch (e) {
        // non-fatal (modpack still installs)
      }
    }

    const files = Array.isArray(index.files) ? index.files : [];
    for (const f of files) {
      const env = f.env || {};
      if (env.client === 'unsupported') continue;
      const rel = f.path;
      if (!rel || !Array.isArray(f.downloads) || !f.downloads[0]) continue;
      const dest = safeJoinUnderInstanceRoot(root, rel);
      fs.ensureDirSync(path.dirname(dest));
      const fr = await fetch(f.downloads[0], { headers: { 'User-Agent': 'ZenonClient/1.0.0' } });
      if (!fr.ok) throw new Error(`Pack file failed (${fr.status}): ${rel}`);
      const chunk = await fr.buffer();
      fs.writeFileSync(dest, chunk);
    }

    for (const e of zip.getEntries()) {
      const name = e.entryName.replace(/\\/g, '/');
      if (e.isDirectory) continue;
      if (name.startsWith('overrides/') && name.length > 'overrides/'.length) {
        const inner = name.slice('overrides/'.length);
        if (inner.split('/').includes('..')) continue;
        const dest = safeJoinUnderInstanceRoot(root, inner);
        fs.ensureDirSync(path.dirname(dest));
        fs.writeFileSync(dest, e.getData());
      } else if (name.startsWith('client-overrides/') && name.length > 'client-overrides/'.length) {
        const inner = name.slice('client-overrides/'.length);
        if (inner.split('/').includes('..')) continue;
        const dest = safeJoinUnderInstanceRoot(root, inner);
        fs.ensureDirSync(path.dirname(dest));
        fs.writeFileSync(dest, e.getData());
      }
    }

    return inst;
  } catch (e) {
    if (inst && inst.id) {
      try {
        deleteInstance(inst.id);
      } catch (e2) {}
    }
    throw e;
  }
}

async function downloadProjectFile(instanceId, kind, versionData, meta = null) {
  try {
    const targetDir = getContentDir(instanceId, kind);

    const file = versionData.files.find(f => f.primary) || versionData.files[0];
    if (!file) throw new Error('No file found');

    const res = await fetch(file.url);
    const buffer = await res.buffer();
    const filePath = path.join(targetDir, file.filename);
    fs.writeFileSync(filePath, buffer);

    // Persist Modrinth project metadata so icons survive refresh/restart.
    try {
      if (meta && typeof meta === 'object') {
        const key = file.filename;
        const idx = readContentMeta(instanceId, kind);
        idx[key] = {
          projectId: meta.projectId || versionData.project_id || null,
          title: meta.title || versionData.name || null,
          iconUrl: meta.iconUrl || null,
          author: meta.author || null,
          at: Date.now()
        };
        writeContentMeta(instanceId, kind, idx);
      }
    } catch (e2) {}

    return { success: true, filename: file.filename };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function fetchSignedTexturesProperty(uuid) {
  const id = String(uuid || '').trim();
  if (!id) return null;
  const noDashes = id.replace(/-/g, '');
  try {
    const url = `https://sessionserver.mojang.com/session/minecraft/profile/${encodeURIComponent(noDashes)}?unsigned=false`;
    const res = await nativeFetch(url, { headers: { 'User-Agent': 'ZenonClient/1.0.0' } });
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

// Game launching — fresh Client per launch (listeners + async launch must be awaited).
let __runningGame = null; // { instanceId, proc }
async function launchGame(instanceId) {
  const configPath = path.join(INSTANCES_DIR, instanceId, 'instance.json');
  if (!fs.existsSync(configPath)) throw new Error('Instance not found');

  const instance = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  scaffoldInstanceLayout(instance.dir);

  const { settings, auth } = await ensureMinecraftAuthFresh();

  const profile = auth?.profile;
  const mcToken = auth?.minecraft?.accessToken;
  if (!profile?.id || !profile?.name || !mcToken) {
    throw new Error('Not logged in. Please sign in with Microsoft.');
  }

  const manifest = await getMcVersionManifest().catch(() => null);
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

  const isOffline = !!auth?.offline || !!settings?.offlineEnabled;
  const authorization = {
    access_token: isOffline ? '0' : mcToken,
    client_token: auth.clientToken || uuidv4(),
    uuid: profile.id,
    name: profile.name,
    user_properties: {},
    meta: { type: isOffline ? 'offline' : 'msa' }
  };

  // Some Minecraft versions log "Signature is missing from Property textures" when the launcher
  // provides a textures property without a signature. If we can fetch a signed textures property,
  // pass it through.
  if (!isOffline) {
    const tex = await fetchSignedTexturesProperty(profile.id);
    if (tex?.value && tex?.signature) {
      authorization.user_properties = {
        textures: {
          value: tex.value,
          signature: tex.signature
        }
      };
    }
  }

  const maxSockets = Math.min(
    64,
    Math.max(8, parseInt(String(settings.mcDownloadSockets || '40'), 10) || 40)
  );

  const customJavaOn =
    instance.javaCustomEnabled === true ||
    (instance.javaCustomEnabled == null &&
      instance.javaPathOverride &&
      String(instance.javaPathOverride).trim());
  const javaPath =
    customJavaOn && String(instance.javaPathOverride || '').trim()
      ? String(instance.javaPathOverride).trim()
      : settings.javaPath || 'java';

  const customMemOn =
    instance.memoryCustomEnabled === true ||
    (instance.memoryCustomEnabled == null &&
      Boolean(String(instance.maxRamOverride || '').trim() || String(instance.minRamOverride || '').trim()));
  const memMax =
    customMemOn && String(instance.maxRamOverride || '').trim()
      ? instance.maxRamOverride
      : settings.maxRam;
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
  const sendLog = (type, message) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('launch-log', { type, message });
      }
    } catch (e) {}
  };

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
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('launch-close', { code });
      }
    } catch (e) {}
    try {
      if (__runningGame && __runningGame.instanceId === instanceId) __runningGame = null;
    } catch (e2) {}
    updateInstance(instanceId, { lastPlayed: new Date().toISOString() });
  });

  await runPreHook();
  const proc = await launcher.launch(opts);
  if (!proc) {
    return { success: false, error: 'Launch failed (Java missing, bad version, or download error — check Launch Console).' };
  }
  __runningGame = { instanceId, proc };

  updateInstance(instanceId, { lastPlayed: new Date().toISOString() });
  return { success: true };
}

// IPC Handlers
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (_, settings) => { saveSettings(settings); return true; });

// Auth IPC
ipcMain.handle('auth:get-state', () => {
  const settings = loadSettings();
  return getAuthState(settings);
});

ipcMain.handle('auth:start-device-code', async () => {
  const settings = loadSettings();
  const dc = await startDeviceCodeFlow(settings);
  return dc;
});

ipcMain.handle('auth:poll-device-code', async (_, { device_code }) => {
  const session = global.__zenonAuthSession;
  if (!session) return { status: 'pending' };
  if (session.status === 'success') {
    const settings = loadSettings();
    return { status: 'success', state: getAuthState(settings) };
  }
  if (session.status === 'error') return { status: 'error', error: session.error || 'Auth failed' };
  return { status: 'pending' };
});

ipcMain.handle('auth:logout', () => {
  const settings = loadSettings();
  const newSettings = { ...settings, auth: null };
  saveSettings(newSettings);
  global.__zenonAuthSession = null;
  try {
    fs.emptyDirSync(AUTH_CACHE_DIR);
  } catch (e) {
    try {
      fs.removeSync(AUTH_CACHE_DIR);
      fs.ensureDirSync(AUTH_CACHE_DIR);
    } catch (e2) {}
  }
  return { ok: true };
});

ipcMain.handle('open-external', async (_, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) return { ok: false };
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('get-instances', () => loadInstances());
ipcMain.handle('create-instance', (_, data) => createInstance(data));
ipcMain.handle('delete-instance', (_, id) => deleteInstance(id));
ipcMain.handle('duplicate-instance', (_, id) => {
  try {
    return { success: true, instance: duplicateInstance(id) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('repair-instance', (_, id) => {
  try {
    repairInstance(id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('update-instance', (_, { id, updates }) => updateInstance(id, updates));

ipcMain.handle('instance-set-icon', async (_, { instanceId, base64, mime }) => {
  try {
    const id = String(instanceId || '').trim();
    if (!id) return { success: false, error: 'Missing instance id' };
    const cfg = readInstanceConfig(id);
    if (!cfg) return { success: false, error: 'Instance not found' };
    const raw = String(base64 || '');
    if (!raw) return { success: false, error: 'Empty image' };
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) return { success: false, error: 'Empty image' };
    if (buf.length > 4 * 1024 * 1024) return { success: false, error: 'Image too large (max 4MB)' };
    const rel = writeInstanceIconFile(id, buf, mime || 'image/png');
    const updated = updateInstance(id, { icon: `img:${rel}` });
    return updated ? { success: true, instance: updated } : { success: false, error: 'Could not save instance icon' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('instance-clear-icon', async (_, instanceId) => {
  try {
    const id = String(instanceId || '').trim();
    if (!id) return { success: false, error: 'Missing instance id' };
    const cfg = readInstanceConfig(id);
    if (!cfg) return { success: false, error: 'Instance not found' };
    // Best-effort delete .zenon/icon.*
    try {
      const d = instanceIconDir(id);
      if (fs.existsSync(d)) {
        for (const n of fs.readdirSync(d)) {
          if (/^icon\\.(png|jpg|jpeg|webp)$/i.test(n)) fs.removeSync(path.join(d, n));
        }
      }
    } catch (e2) {}
    const updated = updateInstance(id, { icon: 'default' });
    return updated ? { success: true, instance: updated } : { success: false, error: 'Could not update instance' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('export-instance', async (_, instanceId) => {
  try {
    return await exportInstanceZip(instanceId);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('import-instance', async () => {
  try {
    return await importInstanceZip();
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-mc-versions', () => fetchMinecraftVersions());
ipcMain.handle('get-fabric-versions', (_, mcVersion) => fetchFabricVersions(mcVersion));

ipcMain.handle('get-mods', (_, instanceId) => getInstanceMods(instanceId));
ipcMain.handle('toggle-mod', (_, { instanceId, filename }) => toggleMod(instanceId, filename));
ipcMain.handle('delete-mod', (_, { instanceId, filename }) => deleteMod(instanceId, filename));

ipcMain.handle('search-modrinth', (_, params) => searchModrinth(params));
ipcMain.handle('get-mod-versions', (_, opts) => getProjectVersions(opts.projectId, opts.mcVersion, opts.loader, opts.loaders || null));
ipcMain.handle('download-mod', (_, { instanceId, versionData, meta }) => downloadProjectFile(instanceId, 'mod', versionData, meta || null));

// Generic content manager IPC
ipcMain.handle('get-content', (_, { instanceId, kind }) => listInstanceContent(instanceId, kind));
ipcMain.handle('list-instance-root', (_, instanceId) => listInstanceRoot(instanceId));
ipcMain.handle('list-instance-worlds', (_, instanceId) => listInstanceWorlds(instanceId));
ipcMain.handle('read-instance-latest-log', (_, instanceId) => readInstanceLatestLog(instanceId));
ipcMain.handle('toggle-content', (_, { instanceId, kind, filename }) => toggleInstanceContent(instanceId, kind, filename));
ipcMain.handle('delete-content', (_, { instanceId, kind, filename }) => deleteInstanceContent(instanceId, kind, filename));
ipcMain.handle('get-project-versions', (_, opts) => getProjectVersions(opts.projectId, opts.mcVersion, opts.loader, opts.loaders || null));
ipcMain.handle('download-content', (_, { instanceId, kind, versionData, meta }) => downloadProjectFile(instanceId, kind, versionData, meta || null));

// Server-side content manager IPC
ipcMain.handle('server-get-content', (_, { serverId, kind }) => listServerContent(serverId, kind));
ipcMain.handle('server-toggle-content', (_, { serverId, kind, filename }) => toggleServerContent(serverId, kind, filename));
ipcMain.handle('server-delete-content', (_, { serverId, kind, filename }) => deleteServerContent(serverId, kind, filename));
ipcMain.handle('server-download-content', (_, { serverId, kind, versionData, meta }) =>
  downloadServerProjectFile(serverId, kind, versionData, meta || null)
);

// Spiget (Spigot plugins) IPC
ipcMain.handle('spiget-search', async (_, params) => {
  try {
    return await spigetSearchResources(params || {});
  } catch (e) {
    return [];
  }
});

ipcMain.handle('spiget-install-plugin', async (_, { serverId, resourceId }) => {
  try {
    const cfg = readServerConfig(serverId);
    if (!cfg) return { success: false, error: 'Unknown server.' };
    const serverKind = String(cfg.serverKind || '').toLowerCase();
    if (serverKind !== 'paper') return { success: false, error: 'Plugins are only supported for Paper servers.' };

    const resInfo = await spigetGetResource(resourceId);
    const dl = await spigetDownloadResourceJar(resourceId);

    const targetDir = getServerContentDir(serverId, 'plugin');
    const base = sanitizeJarBaseName(resInfo?.name || resInfo?.tag || `plugin-${resourceId}`);
    let filename = String(dl.filenameHint || '').trim();
    if (!filename.toLowerCase().endsWith('.jar')) {
      filename = `${base}-${resourceId}.jar`;
    }
    const dest = path.join(targetDir, filename);
    fs.writeFileSync(dest, dl.buffer);

    // Persist metadata next to file (so UI can show icon/name/author).
    try {
      const idx = readServerContentMeta(serverId, 'plugin');
      const author = resInfo?.author?.name || resInfo?.author?.username || null;
      // Spiget icon.url can be like "/resources/..../icon?...." so normalize leading slashes.
      const iconUrl = resInfo?.icon?.url
        ? `https://www.spigotmc.org/${String(resInfo.icon.url).replace(/^\/+/, '')}`
        : null;
      idx[filename] = {
        projectId: `spiget:${resourceId}`,
        title: resInfo?.name || base,
        iconUrl,
        author,
        at: Date.now()
      };
      writeServerContentMeta(serverId, 'plugin', idx);
    } catch (e2) {}

    return { success: true, filename };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('create-instance-from-mrpack', async (_, { versionData, displayName, iconUrl }) => {
  try {
    const instance = await createInstanceFromMrpack(versionData, displayName, iconUrl || null);
    return { success: true, instance };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('launch-game', async (_, instanceId) => {
  try {
    return await launchGame(instanceId);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('launch-stop', async () => {
  try {
    const rg = __runningGame;
    if (!rg?.proc || rg.proc.killed) return { success: false, error: 'Game is not running.' };
    try {
      rg.proc.kill('SIGTERM');
    } catch (e2) {
      try {
        rg.proc.kill();
      } catch (e3) {}
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('launch-game-with-server', async (_, { instanceId, host, port }) => {
  try {
    launchGame.joinServer = { host: String(host || '').trim(), port: Number(port) || 25565 };
    return await launchGame(instanceId);
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    launchGame.joinServer = null;
  }
});

ipcMain.handle('open-instance-folder', (_, instanceId) => {
  const instanceDir = path.join(INSTANCES_DIR, instanceId);
  require('electron').shell.openPath(instanceDir);
});

ipcMain.handle('list-servers', () => listServers());
ipcMain.handle('create-server', async (_, data) => {
  try {
    const { entry: server, hint } = await createServerEntry(data || {});
    return { success: true, server, hint };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-forge-versions', async (_, mcVersion) => {
  try {
    return await fetchForgeVersionsForMc(mcVersion);
  } catch (e) {
    return [];
  }
});

ipcMain.handle('get-paper-mc-versions', async () => {
  try {
    return await fetchPaperMcVersionList();
  } catch (e) {
    return [];
  }
});
ipcMain.handle('delete-server', async (_, serverId) => {
  try {
    await stopDedicatedServer(serverId, { force: true });
    deleteServerEntry(serverId);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('open-server-folder', (_, serverId) => {
  const cfg = readServerConfig(serverId);
  const dir = cfg?.dir || path.join(SERVERS_DIR, serverId);
  require('electron').shell.openPath(dir);
});

ipcMain.handle('server-start', async (_, serverId) => {
  try {
    return await startDedicatedServer(serverId);
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('server-stop', async (_, serverId) => {
  try {
    await stopDedicatedServer(serverId, { force: false });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('server-send', (_, { serverId, cmd }) => {
  const rt = SERVER_RUNTIME.get(serverId);
  if (!rt?.proc?.stdin) return { success: false, error: 'Server is not running.' };
  const line = String(cmd || '').trim();
  if (!line) return { success: false, error: 'Empty command' };
  try {
    rt.proc.stdin.write(`${line}\n`);
    if (/^list$/i.test(line)) {
      rt.awaitingList = true;
      if (rt.listTimer) clearTimeout(rt.listTimer);
      rt.listTimer = setTimeout(() => {
        rt.awaitingList = false;
        rt.listTimer = null;
      }, 6000);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('server-console-buffer', (_, serverId) => ({
  lines: SERVER_RUNTIME.get(serverId)?.logLines || []
}));
ipcMain.handle('server-status', (_, serverId) => {
  const rt = SERVER_RUNTIME.get(serverId);
  const cfg = readServerConfig(serverId);
  const serverDir = cfg?.dir || path.join(SERVERS_DIR, String(serverId || ''));
  if (!rt?.proc || rt.proc.killed) {
    return { running: false, active: [], inactive: [], eulaAccepted: readEulaAccepted(serverDir) };
  }
  return {
    running: true,
    active: [...rt.online],
    inactive: rt.inactive.map((x) => x.name),
    eulaAccepted: readEulaAccepted(serverDir)
  };
});

ipcMain.handle('server-accept-eula', async (_, serverId) => {
  try {
    const cfg = readServerConfig(serverId);
    if (!cfg) return { success: false, error: 'Unknown server.' };
    const serverDir = cfg.dir || path.join(SERVERS_DIR, serverId);
    const ok = writeEulaAccepted(serverDir);
    return ok ? { success: true } : { success: false, error: 'Could not write eula.txt' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Tools: open useful folders
ipcMain.handle('open-user-data-folder', async () => {
  try {
    await require('electron').shell.openPath(USER_DATA);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('open-instances-root-folder', async () => {
  try {
    await require('electron').shell.openPath(INSTANCES_DIR);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// App lifecycle
function createWindow() {
  const iconPath = path.join(__dirname, 'src/assets/zenon-logo.png');
  const opts = {
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  };
  if (fs.existsSync(iconPath)) opts.icon = iconPath;

  mainWindow = new BrowserWindow(opts);

  mainWindow.loadFile(path.join(__dirname, 'src/index.html'));
  mainWindow.once('ready-to-show', () => {
    try {
      mainWindow.focus();
    } catch (e) {}
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

process.on('uncaughtException', (err) => {
  console.error('[zenon] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[zenon] unhandledRejection:', reason);
});

app.whenReady().then(() => {
  console.log('[zenon] app ready, opening window');
  createWindow();
});
app.on('before-quit', () => {
  for (const id of [...SERVER_RUNTIME.keys()]) {
    try {
      const p = SERVER_RUNTIME.get(id)?.proc;
      if (p && !p.killed) p.kill('SIGTERM');
    } catch (e) {}
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });
