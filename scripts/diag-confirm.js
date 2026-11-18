// Verify the styled confirm dialog on instance delete.
const http = require('http');
const fs = require('fs');
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

  // Create a throwaway instance to delete
  const instId = await ev(`window.zenon.createInstance({ name: 'Delete Confirm Test', version: '1.20.1' }).then(i => i.id)`);
  console.log('created instance', instId);
  await ev(`(async () => { State.instances = await window.zenon.getInstances(); })()`);
  await ev(`navigateTo('instances', { force: true })`);
  await sleep(1000);

  // Click the delete button on that card and capture the styled dialog
  await ev(`document.querySelector('[data-action="delete"][data-id="${instId}"]').click()`);
  await sleep(900);
  const visible = await ev(`document.getElementById('modal-confirm').classList.contains('show')`);
  const title = await ev(`document.getElementById('confirm-title').textContent`);
  const message = await ev(`document.getElementById('confirm-message').textContent`);
  console.log('dialog open:', visible, '| title:', title);
  console.log('message:', message);

  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  fs.writeFileSync('ui-shots/confirm-delete.jpg', Buffer.from(shot.data, 'base64'));
  console.log('screenshot saved');

  // Cancel it (should keep the instance)
  await ev(`document.getElementById('confirm-cancel-btn').click()`);
  await sleep(400);
  const stillThere = await ev(`window.zenon.getInstances().then(a => a.some(i => i.id === '${instId}'))`);
  console.log('instance kept after cancel:', stillThere);

  // Confirm it for real
  await ev(`document.querySelector('[data-action="delete"][data-id="${instId}"]').click()`);
  await sleep(700);
  await ev(`document.getElementById('confirm-accept-btn').click()`);
  await sleep(800);
  const gone = await ev(`window.zenon.getInstances().then(a => !a.some(i => i.id === '${instId}'))`);
  console.log('instance deleted after confirm:', gone);

  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
