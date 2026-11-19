// Probe updateCheck() in the packaged app properly.
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
  for (let i = 0; i < 25; i++) {
    try { targets = await getJson('http://127.0.0.1:9225/json/list'); break; }
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
  const consoleLines = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); res(msg.result); }
    else if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLines.push('[' + msg.params.type + '] ' + msg.params.args.map(a => a.description || a.value || '').join(' ').slice(0, 400));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleLines.push('[exception] ' + (msg.params.exceptionDetails?.exception?.description || 'err'));
    }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'EVAL-ERR: ' + (r.exceptionDetails.exception?.description || 'eval');
    return r.result?.value;
  };
  for (let i = 0; i < 40; i++) {
    const ok = await ev('!!window.State && !!(window.State.auth && window.State.auth.loggedIn)');
    if (ok === true) break;
    await sleep(1000);
  }
  await ev("navigateTo('tools',{force:true})");
  await sleep(1000);
  console.log('call updateCheck (12s timeout):');
  console.log(await ev("(async () => { try { const r = await Promise.race([window.zenon.updateCheck(), new Promise(res => setTimeout(() => res('TIMEOUT'), 12000))]); return JSON.stringify(r); } catch (e) { return 'THREW: ' + (e && e.message); } })()"));
  console.log('console lines:', JSON.stringify(consoleLines.slice(-15)));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
