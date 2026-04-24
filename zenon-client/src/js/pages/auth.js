// ===== Auth Overlay (Microsoft Device Code) =====
let __authPollTimer = null;
let __authLogUnsub = null;

function ensureAuthProgressPipe() {
  if (__authLogUnsub || typeof window.zenon?.onAuthLog !== 'function') return;
  __authLogUnsub = window.zenon.onAuthLog((msg) => {
    const wrap = document.getElementById('auth-progress-wrap');
    const el = document.getElementById('auth-progress-log');
    if (!wrap || !el) return;
    wrap.style.display = 'block';
    const line = document.createElement('div');
    line.className = 'auth-progress-line';
    const t = msg.at ? new Date(msg.at).toLocaleTimeString() : '';
    line.textContent = msg.detail ? `[${t}] ${msg.step}: ${msg.detail}` : `[${t}] ${msg.step}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  });
}

function buildMicrosoftLinkUrl(dc) {
  if (!dc) return 'https://www.microsoft.com/link';
  if (dc.verification_uri_complete && String(dc.verification_uri_complete).trim()) {
    return String(dc.verification_uri_complete).trim();
  }
  const base = (dc.verification_uri && String(dc.verification_uri).trim()) || 'https://www.microsoft.com/link';
  const code = dc.user_code && String(dc.user_code).trim();
  if (!code) return base;
  try {
    const u = new URL(base, 'https://www.microsoft.com');
    if (!u.searchParams.has('otc')) u.searchParams.set('otc', code);
    return u.toString();
  } catch (e) {
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}otc=${encodeURIComponent(code)}`;
  }
}

function ensureAuthOverlay() {
  const existing = document.getElementById('auth-overlay');
  if (existing && existing.querySelector('#auth-signin-box')) return;
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'auth-overlay';
  overlay.className = 'auth-overlay';
  overlay.innerHTML = `
    <div class="auth-card">
      <div class="auth-title">Sign in required</div>

      <div class="auth-signin-box" id="auth-signin-box">
        <p class="auth-signin-hint" id="auth-signin-hint">Sign in with Microsoft to use Zenon Client.</p>
        <div class="auth-offline-box" id="auth-offline-box">
          <div class="auth-label">Or play offline</div>
          <input type="text" class="form-input" id="auth-offline-name" placeholder="Offline username" />
          <div class="auth-offline-actions">
            <button class="btn btn-ghost btn-sm" type="button" id="auth-offline-btn">Continue offline</button>
          </div>
          <p class="auth-signin-hint" style="margin-top:10px">
            Offline mode cannot join most online servers and won’t sync skins/capes. You can switch back by signing in later.
          </p>
        </div>
        <div class="auth-signin-link-block" id="auth-signin-link-block" style="display:none">
          <div class="auth-label">Your sign-in link — copy into your browser</div>
          <input type="text" class="form-input auth-url-input auth-signin-link-input" id="auth-link-url" readonly spellcheck="false" autocomplete="off" />
          <div class="auth-signin-link-actions">
            <button class="btn btn-ghost btn-sm" type="button" id="auth-copy-link-btn">Copy link</button>
            <button class="btn btn-primary btn-sm" type="button" id="auth-open-btn">Open in browser</button>
          </div>
          <div class="auth-url-fallback auth-signin-link-plain" id="auth-link-plain" style="display:none"></div>
        </div>
      </div>

      <div class="auth-actions" id="auth-actions">
        <button class="btn btn-primary" id="auth-start-btn">Sign in with Microsoft</button>
      </div>

      <div class="auth-device" id="auth-device" style="display:none">
        <div class="auth-row auth-row-code">
          <div>
            <div class="auth-label">Your code</div>
            <div class="auth-code" id="auth-code">----</div>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <button class="btn btn-ghost btn-sm" type="button" id="auth-copy-btn">Copy code</button>
          </div>
        </div>
        <div class="auth-hint" id="auth-hint">If the link didn’t open, paste it above, enter this code on Microsoft’s page, then finish signing in.</div>
        <div class="auth-progress-wrap" id="auth-progress-wrap" style="display:none">
          <div class="auth-label">Progress (from app)</div>
          <div class="auth-progress-log" id="auth-progress-log"></div>
        </div>
      </div>

      <div class="auth-footer">
        <button class="btn btn-ghost btn-sm" id="auth-quit-btn">Quit</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('auth-quit-btn').addEventListener('click', () => window.zenon.close());
  document.getElementById('auth-start-btn').addEventListener('click', startMicrosoftLogin);
  document.getElementById('auth-offline-btn')?.addEventListener('click', async () => {
    try {
      const input = document.getElementById('auth-offline-name');
      const raw = input?.value?.trim() || '';
      const name = raw || 'Player';
      if (window.zenon.accountsAddOffline) {
        await window.zenon.accountsAddOffline(name);
      } else {
        const prev = await window.zenon.getSettings();
        const next = { ...prev, username: name, offlineEnabled: true };
        await window.zenon.saveSettings(next);
        State.settings = next;
      }
      State.auth = { loggedIn: true, profile: { id: 'offline', name } };
      hideAuthOverlay();
      showToast(`Offline mode: ${name}`, 'info', 2200);
      await bootstrapMainUIAfterLogin();
    } catch (e) {
      showToast(e?.message || 'Could not start offline mode', 'error', 4000);
    }
  });
  ensureAuthProgressPipe();
}

function showAuthOverlay() {
  ensureAuthOverlay();
  const device = document.getElementById('auth-device');
  if (device) device.style.display = 'none';
  const hint = document.getElementById('auth-signin-hint');
  if (hint) hint.style.display = '';
  const linkBlock = document.getElementById('auth-signin-link-block');
  if (linkBlock) linkBlock.style.display = 'none';
  const startBtn = document.getElementById('auth-start-btn');
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = 'Sign in with Microsoft';
  }
  const urlInput = document.getElementById('auth-link-url');
  if (urlInput) urlInput.value = '';
  const plainEl = document.getElementById('auth-link-plain');
  if (plainEl) {
    plainEl.textContent = '';
    plainEl.style.display = 'none';
  }
  stopAuthPolling();
  const prog = document.getElementById('auth-progress-log');
  if (prog) prog.innerHTML = '';
  const pw = document.getElementById('auth-progress-wrap');
  if (pw) pw.style.display = 'none';
  document.body.classList.add('auth-locked');
  document.getElementById('auth-overlay').classList.add('show');
}

function hideAuthOverlay() {
  document.body.classList.remove('auth-locked');
  const el = document.getElementById('auth-overlay');
  if (el) el.classList.remove('show');
  stopAuthPolling();
}

function stopAuthPolling() {
  if (__authPollTimer) {
    clearInterval(__authPollTimer);
    __authPollTimer = null;
  }
}

/**
 * Keeps checking until Microsoft sign-in + Minecraft token are saved (survives missed IPC events).
 * @param {() => boolean} [shouldCancel] when true, stop and return null (e.g. auth:finished won the race).
 */
async function pollUntilSignedIn(dc, maxMs, shouldCancel = () => false) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (shouldCancel()) return { ok: false, error: '__superseded__' };

    const state = await window.zenon.authGetState();
    if (state.loggedIn) return { ok: true, state };

    const poll = await window.zenon.authPollDeviceCode(dc.device_code);
    if (poll.status === 'success') {
      const st = await window.zenon.authGetState();
      if (st.loggedIn) return { ok: true, state: st };
      if (poll.state?.loggedIn) return { ok: true, state: poll.state };
      // Main says auth finished but settings don’t look logged in — don’t spin for 15m.
      return {
        ok: false,
        error:
          'Sign-in completed on Microsoft’s side but this app could not verify your Minecraft session. If you own Java Edition, try again or restart the app.'
      };
    }
    if (poll.status === 'error') return { ok: false, error: poll.error || 'Sign-in failed' };

    await new Promise((r) => setTimeout(r, 300));
  }
  return { ok: false, error: 'Sign-in timed out. Try again.' };
}

async function startMicrosoftLogin() {
  const AUTH_WAIT_MS = 15 * 60 * 1000;
  let cancelled = false;
  const shouldCancel = () => cancelled;
  try {
    ensureAuthOverlay();
    const startBtn = document.getElementById('auth-start-btn');
    startBtn.disabled = true;
    startBtn.textContent = 'Starting...';

    // Main may send ok:true before repairAuthProfileIfNeeded has run once; retry getAuthState briefly.
    const finishedP = window.zenon.waitForAuthFinished().then(async (data) => {
      cancelled = true;
      if (!data?.ok) return { ok: false, error: data?.error || 'Sign-in failed' };
      let st = data.state && data.state.loggedIn ? data.state : await window.zenon.authGetState();
      for (let i = 0; i < 20 && !st.loggedIn; i++) {
        await new Promise((r) => setTimeout(r, 120));
        st = await window.zenon.authGetState();
      }
      if (st.loggedIn) return { ok: true, state: st };
      return {
        ok: false,
        error:
          'Microsoft sign-in finished, but this launcher could not confirm a Minecraft: Java Edition profile on this account. Use an account that owns Java Edition (or Game Pass PC with Minecraft), or sign in once in the official launcher then try again.'
      };
    });

    const dc = await window.zenon.authStartDeviceCode();
    const codeEl = document.getElementById('auth-code');
    const hintEl = document.getElementById('auth-hint');
    const device = document.getElementById('auth-device');

    device.style.display = 'block';
    codeEl.textContent = dc.user_code;

    const displayUrl = buildMicrosoftLinkUrl(dc);
    const urlInput = document.getElementById('auth-link-url');
    const plainEl = document.getElementById('auth-link-plain');
    const signinHint = document.getElementById('auth-signin-hint');
    const linkBlock = document.getElementById('auth-signin-link-block');
    if (!urlInput) {
      try {
        window.zenon.cancelAuthFinishedWait();
      } catch (e2) {}
      startBtn.disabled = false;
      startBtn.textContent = 'Sign in with Microsoft';
      showToast('Sign-in UI is outdated — restart the app', 'error', 4000);
      return;
    }
    if (signinHint) signinHint.style.display = 'none';
    if (linkBlock) linkBlock.style.display = 'block';
    urlInput.value = displayUrl;
    if (plainEl) {
      plainEl.textContent = displayUrl;
      plainEl.style.display = displayUrl ? 'block' : 'none';
    }
    urlInput.focus();
    urlInput.select();

    document.getElementById('auth-copy-link-btn').onclick = async () => {
      const ok = await copyToClipboard(displayUrl);
      showToast(ok ? 'Link copied' : 'Copy failed', ok ? 'success' : 'error', 1500);
    };

    document.getElementById('auth-copy-btn').onclick = async () => {
      const ok = await copyToClipboard(dc.user_code);
      showToast(ok ? 'Code copied' : 'Copy failed', ok ? 'success' : 'error', 1500);
    };

    document.getElementById('auth-open-btn').onclick = () => {
      window.zenon.openExternal(displayUrl);
    };

    startBtn.textContent = 'Waiting for sign-in...';

    stopAuthPolling();

    const hintElVerify = document.getElementById('auth-hint');
    if (hintElVerify) {
      hintElVerify.textContent = 'After you approve in the browser, we verify your account here — stay on this screen.';
    }

    const pollP = pollUntilSignedIn(dc, AUTH_WAIT_MS, shouldCancel).then((r) => {
      if (r?.ok) cancelled = true;
      return r;
    });
    const timeoutP = new Promise((resolve) => {
      setTimeout(() => {
        cancelled = true;
        resolve({ ok: false, error: 'Sign-in timed out. Try again.' });
      }, AUTH_WAIT_MS);
    });

    let result = await Promise.race([finishedP, pollP, timeoutP]);
    window.zenon.cancelAuthFinishedWait();

    if (result?.error === '__superseded__') {
      const st = await window.zenon.authGetState();
      result = st.loggedIn ? { ok: true, state: st } : { ok: false, error: 'Sign-in was interrupted. Try again.' };
    }
    if (result && result.ok && !result.state) {
      result = { ok: true, state: await window.zenon.authGetState() };
    }

    if (result && result.ok) {
      hintEl.textContent = 'Signed in! Loading main window…';
      showToast('Signed in!', 'success');
      State.auth = result.state || (await window.zenon.authGetState());
      hideAuthOverlay();
      await bootstrapMainUIAfterLogin();
      return;
    }

    startBtn.disabled = false;
    startBtn.textContent = 'Sign in with Microsoft';
    const sh = document.getElementById('auth-signin-hint');
    const lb = document.getElementById('auth-signin-link-block');
    if (sh) sh.style.display = '';
    if (lb) lb.style.display = 'none';
    hintEl.textContent = `Sign-in failed: ${result?.error || 'Unknown error'}`;
    showToast(result?.error || 'Sign-in failed', 'error', 5000);
  } catch (e) {
    cancelled = true;
    try {
      window.zenon.cancelAuthFinishedWait();
    } catch (e2) {}
    const startBtn = document.getElementById('auth-start-btn');
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = 'Sign in with Microsoft';
    }
    const sh = document.getElementById('auth-signin-hint');
    const lb = document.getElementById('auth-signin-link-block');
    if (sh) sh.style.display = '';
    if (lb) lb.style.display = 'none';
    const device = document.getElementById('auth-device');
    if (device) device.style.display = 'none';
    showToast(e.message || 'Failed to start sign-in', 'error', 4500);
  }
}

async function onAuthSuccess() {
  const state = await window.zenon.authGetState();
  State.auth = state;
  hideAuthOverlay();
  await bootstrapMainUIAfterLogin();
}

async function ensureLoggedInOrShowAuth() {
  const state = await window.zenon.authGetState();
  State.auth = state;
  if (state.loggedIn) return true;

  // Offline mode fallback (lets the app run without Microsoft).
  try {
    const settings = await window.zenon.getSettings();
    if (settings?.offlineEnabled) {
      const name = String(settings.username || 'Player').trim() || 'Player';
      State.auth = { loggedIn: true, profile: { id: 'offline', name } };
      return true;
    }
  } catch (e) {}

  showAuthOverlay();
  return false;
}

