// Verify deleting an instance keeps the user on the Instances page.
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9223;
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

  // Create two throwaway instances
  const ids = await ev(`(async () => {
    const a = await window.zenon.createInstance({ name: 'Delete Test A', version: '1.20.1' });
    const b = await window.zenon.createInstance({ name: 'Delete Test B', version: '1.20.1' });
    State.instances = await window.zenon.getInstances();
    return [a.id, b.id];
  })()`);
  console.log('created:', JSON.stringify(ids));

  await ev(`navigateTo('instances', { force: true })`);
  await sleep(1000);
  console.log('current page (before delete):', await ev('State.currentPage'));

  // Auto-accept the confirm() dialog, then click the real delete button on card A
  await ev(`window.confirm = () => true`);
  const clicked = await ev(`(() => {
    const btn = document.querySelector('[data-action="delete"][data-id="${ids[0]}"]');
    if (!btn) return 'not-found';
    btn.click();
    return 'clicked';
  })()`);
  console.log('delete button:', clicked);
  await sleep(1200);
  console.log('current page (after delete): ', await ev('State.currentPage'));
  const remaining = await ev(`window.zenon.getInstances().then((a) => a.map((i) => i.name))`);
  console.log('instances after delete:', JSON.stringify(remaining));

  // Cleanup the second test instance through the same flow
  await ev(`document.querySelector('[data-action="delete"][data-id="${ids[1]}"]')?.click()`);
  await sleep(800);
  console.log('final instances:', JSON.stringify(await ev(`window.zenon.getInstances().then((a) => a.map((i) => i.name))`)));
  console.log('final page:', await ev('State.currentPage'));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
