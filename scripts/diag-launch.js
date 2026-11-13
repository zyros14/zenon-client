// Diagnostic v2: trigger launchInstance directly and capture everything.
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.CDP_PORT || 9223;
const SECONDS = parseInt(process.argv[2], 10) || 120;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let targets;
  for (let i = 0; i < 30; i++) {
    try { targets = await getJson(`http://127.0.0.1:${PORT}/json/list`); break; }
    catch (e) { await sleep(500); }
  }
  if (!targets) { console.error('CDP unreachable'); process.exit(1); }
  const page = targets.find((t) => t.type === 'page');
  if (!page) { console.error('No page target'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0;
  const pending = new Map();
  const errors = [];
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(d.exception?.description || d.text || 'unknown');
    }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');

  const evalJs = async (expr) => {
    try {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result?.value;
    } catch (e) { return 'EVAL-ERR: ' + e.message; }
  };

  for (let i = 0; i < 30; i++) {
    const ready = await evalJs(`!!window.State && !!(State.auth && State.auth.loggedIn)`);
    if (ready === true) break;
    await sleep(1000);
  }

  console.log('pre-launch state:', await evalJs(`JSON.stringify({
    page: State.currentPage,
    isLaunching: State.isLaunching,
    runningId: State.runningInstanceId,
    sel: State.selectedInstance && State.selectedInstance.name
  })`));

  const launchResult = await evalJs(`launchInstance(State.selectedInstance.id).then(() => 'launchInstance-resolved').catch(e => 'launchInstance-REJECTED: ' + (e && e.message || e))`);
  console.log('launchInstance promise:', launchResult);

  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < SECONDS) {
    await sleep(4000);
    const st = await evalJs(`JSON.stringify({
      status: (document.getElementById('console-status')||{}).innerText,
      isLaunching: State.isLaunching,
      lines: (document.getElementById('console-output')||{childElementCount:0}).childElementCount
    })`);
    console.log('poll:', st);
    if (st && /"status":"(Exited|Failed)/.test(st)) break;
  }

  console.log('--- FINAL CONSOLE OUTPUT ---');
  console.log(await evalJs(`(document.getElementById('console-output')||{}).innerText || '(empty)'`));
  if (errors.length) {
    console.log('--- RENDERER ERRORS (' + errors.length + ') ---');
    for (const e of errors.slice(0, 20)) console.log(e.split('\n').slice(0, 4).join('\n'));
  }
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
