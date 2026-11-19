// Click "Check for updates" in the packaged build (scratch profile) and report status text.
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
    try { targets = await getJson('http://127.0.0.1:9224/json/list'); break; }
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
      consoleLines.push('[' + msg.params.type + '] ' + msg.params.args.map(a => a.description || a.value || '').join(' ').slice(0, 300));
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
  // Wait for the app to be ready (scratch profile - it will not be signed in)
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const ready = await ev("!!window.zenon && !!document.querySelector('#tools-check-updates-btn')");
    if (ready) break;
    // tools page only has the button after navigation; navigate directly:
    await ev("navigateTo('tools',{force:true})");
    break;
  }
  await ev("navigateTo('tools',{force:true})");
  await sleep(1200);
  const before = await ev("document.getElementById('tools-update-status')?.textContent");
  console.log('status before:', before);
  await ev("(() => { const b = document.getElementById('tools-check-updates-btn'); if (b) b.click(); })()");
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    const s = await ev("document.getElementById('tools-update-status')?.textContent");
    console.log('status t+' + (i + 1) + 's:', s);
    const install = await ev("document.getElementById('tools-install-update-btn')?.disabled");
    if (s !== before && s !== 'Idle') break;
  }
  const errs = consoleLines.filter(l => l.startsWith('[exception') || l.toLowerCase().includes('error') || l.startsWith('[warning'));
  console.log('console (err/warn):', JSON.stringify(errs.slice(-10)));
  console.log('updateInstall exposed:', await ev("typeof window.zenon?.updateInstall"));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
