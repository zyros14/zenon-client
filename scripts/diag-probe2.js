// Deep probe for the 1.0.8 build: preload API, window.zenon shape, update check at different times.
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
      logs.push(`[${msg.params.type}] ${t}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      logs.push(`[page-error] ${d?.exception?.description || d?.text || 'unknown'}`);
    }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');

  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'EVAL: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };

  for (let i = 0; i < 30; i++) {
    if (await ev('!!window.State') === true) break;
    await sleep(500);
  }

  console.log('typeof window.zenon:', await ev('typeof window.zenon'));
  console.log('Object.keys(window.zenon):', await ev('JSON.stringify(Object.keys(window.zenon||{}))'));
  console.log('typeof window.zenon.updateCheck:', await ev('typeof window.zenon?.updateCheck'));
  console.log('typeof window.zenon.updateCheck?.valueOf?.():', await ev('typeof window.zenon?.updateCheck?.toString?.()'));
  console.log();
  const res1 = await ev('window.zenon.updateCheck()');
  console.log('updateCheck() round 1:', JSON.stringify(res1));
  await sleep(2000);
  const res2 = await ev('window.zenon.updateCheck()');
  console.log('updateCheck() round 2:', JSON.stringify(res2));
  await sleep(15000);
  const res3 = await ev('window.zenon.updateCheck()');
  console.log('updateCheck() round 3 (after 15s):', JSON.stringify(res3));
  console.log();
  console.log('--- console logs (last 40) ---');
  for (const l of logs.slice(-40)) console.log(l);
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
