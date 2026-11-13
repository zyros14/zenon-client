// Diagnostic: connect to a running Electron instance via CDP, dump renderer console
// messages + page errors, and save a screenshot. Usage:
//   1) npx electron . --remote-debugging-port=9222
//   2) node scripts/diag-cdp.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.CDP_PORT || 9222;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let targets;
  for (let i = 0; i < 20; i++) {
    try {
      targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      break;
    } catch (e) {
      await sleep(500);
    }
  }
  if (!targets) {
    console.error('Could not reach CDP on port ' + PORT + '. Start the app with: npx electron . --remote-debugging-port=' + PORT);
    process.exit(1);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) { console.error('No page target'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0;
  const pending = new Map();
  const logs = [];

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value != null ? String(a.value) : (a.description || a.type)).join(' ');
      logs.push(`[console.${msg.params.type}] ${text}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const text = d.exception?.description || d.text || 'unknown error';
      logs.push(`[page-error] ${text}`);
    }
  });

  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(4000); // let the app boot past splash/auth

  const expr = `JSON.stringify({
    url: location.href,
    title: document.title,
    hasSplash: !!document.getElementById('splash-screen'),
    splashHidden: !document.getElementById('splash-screen'),
    authOverlayShown: !!document.querySelector('#auth-overlay.show'),
    mainContentPreview: (document.getElementById('main-content')?.innerText || '').slice(0, 200),
    bodyClasses: document.body.className,
    appVersion: window.zenon ? 'preload-ok' : 'PRELOAD MISSING'
  })`;
  const stateRes = await send('Runtime.evaluate', { expression: expr, returnByValue: true }).catch((e) => ({ result: { value: 'eval-failed: ' + e.message } }));

  const shot = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (shot && shot.data) {
    const out = path.join(__dirname, '..', 'ui-shots', 'diag-current-state.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('screenshot -> ' + out);
  }

  console.log('--- APP STATE ---');
  console.log(stateRes.result?.value || '(none)');
  console.log('--- RENDERER LOGS (' + logs.length + ') ---');
  for (const l of logs.slice(0, 60)) console.log(l);

  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
