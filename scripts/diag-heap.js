// Heap boundary test: vanilla 26.3 at 3G.
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9223;
const SECONDS = 90;
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
    if ((await ev('!!window.State && !!(State.auth && State.auth.loggedIn)')) === true) break;
    await sleep(1000);
  }
  const heap = process.argv[2] || '3G';
  const inst = await ev(`window.zenon.createInstance({ name: 'Heap ${heap} Test', version: '26.3', loader: 'vanilla' })`);
  await ev(`window.zenon.updateInstance('${inst.id}', { memoryCustomEnabled: true, maxRamOverride: '${heap}' })`);
  console.log('created', heap, 'instance', inst.id);
  await ev(`(async () => { State.instances = await window.zenon.getInstances(); State.selectedInstance = State.instances.find(i => i.id === '${inst.id}'); })()`);
  await ev(`launchInstance('${inst.id}')`);
  const t0 = Date.now();
  let lastLog = '';
  while ((Date.now() - t0) / 1000 < SECONDS) {
    await sleep(3000);
    const st = await ev(`JSON.stringify({ s: (document.getElementById('console-status')||{}).innerText, txt: (document.getElementById('console-output')||{}).innerText })`);
    const p = JSON.parse(st);
    if (p.txt !== lastLog) {
      const fresh = p.txt.slice(lastLog.length);
      for (const l of fresh.trim().split('\n')) {
        if (!l.trim()) continue;
        if (/unifont|Reloading|Game closed|exit code|OpenAL|Backend|Created window/i.test(l)) console.log(l.trim().slice(0, 150));
      }
      lastLog = p.txt;
    }
    if (/Exited|Failed/i.test(p.s || '')) { console.log('== FINAL:', p.s); break; }
  }
  await ev(`window.zenon.stopGame()`).catch(() => {});
  await sleep(1500);
  await ev(`window.zenon.deleteInstance('${inst.id}')`);
  console.log('deleted');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
