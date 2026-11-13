// Verify default orb icons: create two instances, screenshot the Instances page, clean up.
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
  const evalJs = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.value;
  };
  for (let i = 0; i < 30; i++) {
    if ((await evalJs('!!window.State && !!(State.auth && State.auth.loggedIn)')) === true) break;
    await sleep(1000);
  }

  const made = await evalJs(`(async () => {
    const a = await window.zenon.createInstance({ name: 'Orb Alpha', version: '1.20.1' });
    const b = await window.zenon.createInstance({ name: 'Orb Beta', version: '1.20.1' });
    State.instances = await window.zenon.getInstances();
    return [a.id, b.id];
  })()`);
  console.log('created:', JSON.stringify(made));

  await evalJs(`navigateTo('instances', { force: true })`);
  await sleep(1500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('ui-shots/orb-defaults.png', Buffer.from(shot.data, 'base64'));
  console.log('screenshot saved -> ui-shots/orb-defaults.png');

  await evalJs(`(async () => {
    for (const i of State.instances) { if (String(i.name).startsWith('Orb ')) await window.zenon.deleteInstance(i.id); }
    State.instances = await window.zenon.getInstances();
  })()`);
  console.log('test instances deleted');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
