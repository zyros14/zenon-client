// Runtime test: invoke the app's own updater IPC from the packaged build.
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9223;
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
  if (!page) { console.log('no page target — is the app running?'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const logs = [];
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
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const t = (msg.params.args || []).map((a) => (a.value != null ? String(a.value) : (a.description || a.type))).join(' ');
      if (/updater|update/i.test(t)) logs.push(`[console.${msg.params.type}] ${t}`);
    }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  await sleep(4000);

  const result = await send('Runtime.evaluate', {
    expression: `window.zenon.updateCheck()`,
    returnByValue: true,
    awaitPromise: true
  });
  console.log('updateCheck() returned:', JSON.stringify(result.result?.value, null, 2));

  const state = await send('Runtime.evaluate', {
    expression: `JSON.stringify({ appWindowOpen: !!document.getElementById('main-content'), path: location.href })`,
    returnByValue: true
  });
  console.log('window state:', state.result?.value);

  console.log('--- updater-related console logs ---');
  for (const l of logs.slice(0, 30)) console.log(l);
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
