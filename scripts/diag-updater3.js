// Check what version the test app actually reports + updater paths used.
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9224;
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
  for (let i = 0; i < 20; i++) {
    try { targets = await getJson(`http://127.0.0.1:${PORT}/json/list`); break; }
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
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  });
  await new Promise((r) => ws.on('open', r));
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.value;
  };
  for (let i = 0; i < 30; i++) {
    if ((await ev("!!window.State && !!(State.auth && State.auth.loggedIn)")) === true) break;
    await sleep(500);
  }
  // Info we need: app version (from main via process? not exposed), About text
  console.log('About text:', await ev("Array.from(document.querySelectorAll('div')).map(d => d.textContent).find(t => t.includes('Version'))"));
  console.log('nav page:', await ev('State.currentPage'));
  // Read the asar's package.json version via a relative file fetch (file:// page allows same-dir fetch? no CORS but allowed with file protocol in Electron)
  const fetchRes = await ev("fetch('file:///C:/Users/xande/AppData/Local/Temp/opencode/zenon-1.0.8-test/win-unpacked/resources/app.asar').then(r => r.status).catch(e => 'fetch-failed: ' + e.message)");
  console.log('asar fetch status:', JSON.stringify(fetchRes));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
