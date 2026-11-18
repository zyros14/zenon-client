// Probe: inspect the test app state via CDP.
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
  for (let i = 0; i < 10; i++) {
    try { targets = await getJson(`http://127.0.0.1:${PORT}/json/list`); break; }
    catch (e) { await sleep(300); }
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
    return r && r.result ? r.result.value : 'EVAL_ERROR';
  };
  console.log('typeof State     :', await ev('typeof State'));
  console.log('typeof window.S  :', await ev('typeof window.State'));
  console.log('document.title   :', await ev('document.title'));
  console.log('has body         :', await ev('!!document.body'));
  console.log('splash still?    :', await ev('!!document.getElementById("splash-screen")'));
  console.log('auth shown?      :', await ev('!!document.querySelector("#auth-overlay.show")'));
  console.log('body class       :', await ev('document.body.className'));
  console.log('errors           :', await ev('(window.__zenonErrors||[]).join(" | ")'));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
