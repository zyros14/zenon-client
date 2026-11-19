// Tight clip of the summary strip on the vanilla instance.
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
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
    try { targets = await getJson('http://127.0.0.1:9223/json/list'); break; }
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
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); res(msg.result); }
  });
  await new Promise((r) => ws.on('open', r));
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'EVAL-ERR: ' + (r.exceptionDetails.exception?.description || 'eval');
    return r.result?.value;
  };
  for (let i = 0; i < 30; i++) {
    if ((await ev('!!window.State && !!(window.State.auth && window.State.auth.loggedIn)')) === true) break;
    await sleep(1000);
  }
  await ev(`(() => { const inst = State.instances.find(i => i.loader === 'vanilla'); if (inst) { State.selectedInstance = inst; navigateTo('instance', { force: true }); } })()`);
  await sleep(1500);
  const rect = await ev(`(() => { const el = document.querySelector('.library-summary-icon'); const r = el.getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.width), h: Math.ceil(r.height) }; })()`);
  console.log('rect:', JSON.stringify(rect));
  const shot = await Promise.race([
    send('Page.captureScreenshot', { format: 'jpeg', quality: 85, fromSurface: false, clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2.5 } }),
    sleep(10000).then(() => null)
  ]);
  if (shot) { fs.writeFileSync('ui-shots/summary-vanilla.jpg', Buffer.from(shot.data, 'base64')); console.log('saved'); } else console.log('timeout — try full page');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
