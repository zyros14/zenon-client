// Reproduce: vanilla launch crash + latest server versions not working.
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9223;
const SECONDS = parseInt(process.argv[2], 10) || 90;
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

  // What is the latest MC version on offer?
  const versions = await ev(`window.zenon.getMcVersions().then((v) => v.filter(x => x.type === 'release').slice(0, 5).map((x) => x.id))`);
  console.log('latest releases:', JSON.stringify(versions));

  // --- Vanilla launch test ---
  const inst = await ev(`window.zenon.createInstance({ name: 'Vanilla Debug', version: '26.3', loader: 'vanilla' })`);
  console.log('vanilla instance created:', inst.id);
  await ev(`(async () => { State.instances = await window.zenon.getInstances(); State.selectedInstance = State.instances.find(i => i.id === '${inst.id}') || null; })()`);
  await ev(`launchInstance('${inst.id}')`);
  const t0 = Date.now();
  let lastLog = '';
  while ((Date.now() - t0) / 1000 < SECONDS) {
    await sleep(3000);
    const st = await ev(`JSON.stringify({ s: (document.getElementById('console-status')||{}).innerText, l: (document.getElementById('console-output')||{childElementCount:0}).childElementCount, txt: (document.getElementById('console-output')||{}).innerText.slice(-1500) })`);
    const parsed = JSON.parse(st);
    if (parsed.txt && parsed.txt !== lastLog) {
      console.log('---console---');
      console.log(parsed.txt);
      lastLog = parsed.txt;
    }
    if (/Exited|Failed/i.test(parsed.s || '')) { console.log('== final status:', parsed.s); break; }
  }

  // --- Server creation test with the latest version ---
  const latest = (versions && versions[0]) || '26.3';
  console.log('--- create vanilla server with latest (' + latest + ') ---');
  const srv = await ev(`window.zenon.createServer({ name: 'Debug Server', version: '${latest}', serverKind: 'vanilla' })`);
  console.log('vanilla server result:', JSON.stringify(srv));

  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
