// Verify the default orb ANIMATES: capture the same icon twice and diff the frames.
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
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

  const inst = await evalJs(`window.zenon.createInstance({ name: 'Anim Check', version: '1.20.1' }).then(i => { State.instances = null; return i.id; })`);
  await evalJs(`navigateTo('instances', { force: true })`);
  await sleep(1500);

  const rect = await evalJs(`(() => {
    const img = document.querySelector('.instance-card .instance-icon-img');
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  if (!rect) throw new Error('icon img not found on page');

  const clip = { ...rect, scale: 1 };
  const s1 = await send('Page.captureScreenshot', { format: 'png', clip });
  await sleep(600);
  const s2 = await send('Page.captureScreenshot', { format: 'png', clip });

  const h1 = crypto.createHash('md5').update(s1.data).digest('hex');
  const h2 = crypto.createHash('md5').update(s2.data).digest('hex');
  console.log('frame1 md5:', h1);
  console.log('frame2 md5:', h2);
  console.log(h1 !== h2 ? 'ANIMATED ✔ (frames differ)' : 'STATIC ✘ (identical frames)');

  fs.writeFileSync('ui-shots/orb-anim-frame1.png', Buffer.from(s1.data, 'base64'));
  fs.writeFileSync('ui-shots/orb-anim-frame2.png', Buffer.from(s2.data, 'base64'));

  await evalJs(`window.zenon.deleteInstance('${inst}')`);
  console.log('test instance deleted');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
