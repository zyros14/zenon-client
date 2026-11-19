// Prove the 1.1.1 -> 1.1.2 auto-update path end-to-end in a patched-1.1.1 build.
const http = require('http');
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
(async () => {
  let targets;
  for (let i = 0; i < 30; i++) {
    try { targets = await getJson('http://127.0.0.1:9231/json/list'); break; }
    catch (e) { await sleep(500); }
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); res(msg.result); }
  });
  await new Promise((r) => ws.on('open', r));
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'EVAL-ERR: ' + (r.exceptionDetails.exception?.description || 'eval');
    return r.result?.value;
  };
  for (let i = 0; i < 40; i++) {
    if ((await ev('!!window.State && !!(window.State.auth && window.State.auth.loggedIn)')) === true) break;
    await sleep(1000);
  }
  await ev("navigateTo('tools',{force:true})");
  await sleep(1000);
  console.log('version label:', await ev("document.getElementById('tools-current-version')?.textContent"));
  for (let i = 0; i < 45; i++) {
    await sleep(3000);
    const status = await ev("document.getElementById('tools-update-status')?.textContent");
    const installDisabled = await ev("document.getElementById('tools-install-update-btn')?.disabled");
    const banner = await ev("(() => { const el = document.getElementById('update-reminder'); return el ? { display: el.style.display, text: document.getElementById('update-reminder-text')?.textContent } : 'missing'; })()");
    console.log('t+' + (i + 1) + 'x3s  status="' + status + '"  installDisabled=' + installDisabled + '  banner=' + JSON.stringify(banner));
    if (banner && banner.display === 'flex') break;
    if (String(status).toLowerCase().includes('downloading') && Number("0") === 1) break;
  }
  const last = await ev("(window.__recentToasts || []).slice(-6)");
  console.log('recent toasts:', JSON.stringify(last));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
