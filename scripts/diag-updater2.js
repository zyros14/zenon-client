// Wait for the auto-check (fires 2.5s after startup), then inspect the update banner state.
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

  for (let i = 0; i < 20; i++) {
    const ready = await ev('!!document.getElementById(\'main-content\') && !!document.getElementById(\'update-reminder\')').catch(() => false);
    if (ready) break;
    await sleep(500);
  }

  // Give the 2.5s auto-check + any download time to run before sampling
  console.log('sampling for up to 120s...');
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const st = await ev(`JSON.stringify({
      reminder: document.getElementById('update-reminder')?.style.display,
      reminderText: document.getElementById('update-reminder-text')?.textContent,
      status: document.getElementById('tools-update-status')?.textContent,
      showToast: !!document.querySelector('.toast'),
      page: State.currentPage
    })`);
    const p = JSON.parse(st);
    console.log(`t=${(i + 1) * 5}s`, st);
    if (p.reminder === 'flex') break;
  }

  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
