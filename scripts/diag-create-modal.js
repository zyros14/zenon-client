// Verify the create-instance button no longer gets stuck: create 2 instances back-to-back.
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

  for (const name of ['Button Test A', 'Button Test B']) {
    await ev(`openCreateInstanceModal()`);
    await sleep(600);
    await ev(`document.getElementById('inst-name').value = ${JSON.stringify(name)}`);
    const r = await ev(`(async () => {
      document.getElementById('confirm-create-btn').click();
      await new Promise((r) => setTimeout(r, 1600));
      return { disabled: document.getElementById('confirm-create-btn').disabled,
               text: document.getElementById('confirm-create-btn').textContent };
    })()`);
    console.log(name, '-> button after create:', JSON.stringify(r));
  }

  const names = await ev(`window.zenon.getInstances().then((a) => a.map((i) => i.name))`);
  console.log('instances now:', JSON.stringify(names));

  await ev(`(async () => {
    const list = await window.zenon.getInstances();
    for (const i of list) if (String(i.name).startsWith('Button Test ')) await window.zenon.deleteInstance(i.id);
    State.instances = await window.zenon.getInstances();
  })()`);
  console.log('test instances deleted');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
