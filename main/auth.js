/** Microsoft (device-code) auth — device code flow, token cache in settings.json. */
const fetch = require('node-fetch');
const fs = require('fs-extra');
const { Authflow, Titles } = require('prismarine-auth');
const bridge = require('./bridge');
const { AUTH_CACHE_DIR } = require('./paths');
const { DEFAULT_MSA_CLIENT_ID, FALLBACK_MSA_CLIENT_IDS, MSA_DEVICE_CODE_URL, MSA_TOKEN_URL } = require('./constants');
const { loadSettings, saveSettings } = require('./settings');
const { zenonAuthLog, withSilencedAuthLogs } = require('./log');
const { nativeFetch } = require('./nativeFetch');
const { profileFromMinecraftResponse, normalizeUuidString, jwtPayloadB64 } = require('./lib/text');
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
  return { loggedIn: false, profile: null };
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
      const mainWindow = bridge.getWindow();
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

  // Bounded silent refresh: if the cached Microsoft session is also expired, prismarine would
  // start a device-code sign-in nobody can see (packaged GUI) and the launch would hang forever.
  const SILENT_REFRESH_MS = 90_000;
  const mc = await Promise.race([
    withSilencedAuthLogs(() => flow.getMinecraftJavaToken({ fetchProfile: false, fetchEntitlements: false })),
    new Promise((_, rej) =>
      setTimeout(
        () => rej(new Error('Your Microsoft session has expired. Please sign in again (Settings → Logout, then sign in).')),
        SILENT_REFRESH_MS
      )
    )
  ]).catch((e) => {
    throw e instanceof Error ? e : new Error(String(e));
  });
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

module.exports = {
  getAuthFromSettings,
  repairAuthProfileIfNeeded,
  getAuthState,
  notifyAuthFinished,
  fetchMinecraftProfileShort,
  startDeviceCodeFlow,
  pollDeviceCodeToken,
  refreshMsaToken,
  acquireMinecraftTokens,
  ensureMinecraftAuthFresh
};
