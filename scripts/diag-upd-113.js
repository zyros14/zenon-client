// Verify v1.1.3: version label, check-for-updates output, banner state.
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
    try { targets = await getJson('http://127.0.0.1:9232/json/list'); break; }
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
    else if (msg.method === 'Runtime.consoleAPICalled') consoleLines.push('[' + msg.params.type + '] ' + msg.params.args.map(a => a.description || a.value || '').join(' ').slice(0, 200));
    else if (msg.method === 'Runtime.exceptionThrown') consoleLines.push('[exception] ' + (msg.params.exceptionDetails?.exception?.description || 'err'));
  });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
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
  await sleep(1500);
  console.log('version label:', await ev("document.getElementById('tools-current-version')?.textContent"));
  console.log('status before check:', await ev("document.getElementById('tools-update-status')?.textContent"));
  console.log('check -> click');
  await ev("(() => { const b = document.getElementById('tools-check-updates-btn'); if (b) b.click(); })()");
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    const s = await ev("document.getElementById('tools-update-status')?.textContent");
    console.log('t+' + (i + 1) + 's:', s);
    if (s !== 'Checking for updates…' && s !== 'Idle') break;
  }
  console.log('banner display:', await ev("document.getElementById('update-reminder')?.style.display || 'none'"));
  console.log('banner text:', await ev("document.getElementById('update-reminder-text')?.textContent || ''"));
  console.log('errors:', JSON.stringify(consoleLines.filter(l => l.startsWith('[exception')).slice(-4)));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
