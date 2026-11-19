// Watch the 1.1.0 build discover and download v1.1.1 from the live feed.
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
    try { targets = await getJson('http://127.0.0.1:9229/json/list'); break; }
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
  const updateEvents = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); res(msg.result); }
    else if (msg.method === 'Runtime.consoleAPICalled') {
      const t = msg.params.args.map(a => a.description || a.value || '').join(' ').slice(0, 250);
      if (/update|download|1\.1\./i.test(t)) consoleLines.push('[' + msg.params.type + '] ' + t);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleLines.push('[exception] ' + (msg.params.exceptionDetails?.exception?.description || 'err'));
    }
  });
  await new Promise((r) => ws.on('open', r));
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'EVAL-ERR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  for (let i = 0; i < 40; i++) {
    if ((await ev('!!window.State && !!(window.State.auth && window.State.auth.loggedIn)')) === true) break;
    await sleep(1000);
  }
  await ev("navigateTo('tools',{force:true})");
  await sleep(2000);
  console.log('tools version label:', await ev("document.getElementById('tools-current-version')?.textContent"));
  // Hook into the preload updater events to capture them live
  await ev("(() => { try { window.__updEvents = []; if (window.zenon && window.zenon.onUpdateEvent) { window.zenon.onUpdateEvent((e) => window.__updEvents.push(JSON.stringify(e))); } return 'wired'; } catch (e) { return 'ERR: ' + e.message; } })()");
  // Manually trigger the check (simulates the 2.5s auto-check)
  console.log('clicking Check...');
  await ev("(() => { const b = document.getElementById('tools-check-updates-btn'); if (b) b.click(); })()");
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    const status = await ev("document.getElementById('tools-update-status')?.textContent");
    const installDisabled = await ev("document.getElementById('tools-install-update-btn')?.disabled");
    const events = await ev("(window.__updEvents || []).join('||')");
    console.log('t+' + (i + 1) + 'x2s  status="' + status + '"  installBtn.disabled=' + installDisabled);
    if (events) console.log('   events so far:', events.slice(0, 300));
    const banner = await ev("(() => { const el = document.getElementById('update-reminder'); return el ? el.style.display : 'none-elem'; })()");
    if (banner !== 'none' && banner !== 'none-elem') {
      console.log('BANNER VISIBLE!', await ev("document.getElementById('update-reminder-text')?.textContent"));
      break;
    }
    if (String(status).toLowerCase().includes('downloaded') && installDisabled === false) break;
  }
  const final = await ev("(window.__updEvents || []).join('\\n')");
  console.log('=== captured events ===');
  console.log(final || '(none)');
  console.log('console relevant:', JSON.stringify(consoleLines.slice(-15)));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
