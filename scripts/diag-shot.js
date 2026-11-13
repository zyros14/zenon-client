// Screenshot a given page: node scripts/diag-shot.js <page> <outfile>
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9223;
const target = process.argv[2] || 'home';
const out = process.argv[3] || `ui-shots/restyle-${target}.png`;
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
  for (let i = 0; i < 10; i++) {
    try { targets = await getJson(`http://127.0.0.1:${PORT}/json/list`); break; }
    catch (e) { await sleep(500); }
  }
  if (!targets) { console.error('CDP unreachable'); process.exit(1); }
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
  console.log('current page:', await evalJs('State.currentPage'));
  await evalJs(`navigateTo(${JSON.stringify(target)}, { force: true })`);
  await sleep(1500);
  console.log('now on:', await evalJs('State.currentPage'));
  // Bring window to front (background-throttled/occluded windows stop producing frames)
  await send('Page.bringToFront').catch(() => {});
  await sleep(400);
  // Pause CSS animations so the compositor can produce a stable frame for capture.
  await send('Runtime.evaluate', { expression: 'document.getElementById("pause-anim-style")?.remove(); const st = document.createElement("style"); st.id = "pause-anim-style"; st.textContent = "*,*::before,*::after{animation-play-state:paused !important}"; document.head.appendChild(st);' });
  const shot = await Promise.race([
    send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }),
    sleep(15000).then(() => null)
  ]);
  await send('Runtime.evaluate', { expression: 'document.getElementById("pause-anim-style")?.remove()' });
  if (!shot) { console.error('screenshot timed out — page still navigated OK'); process.exit(0); }
  fs.writeFileSync(out.replace(/\.png$/, '.jpg'), Buffer.from(shot.data, 'base64'));
  console.log('saved', out.replace(/\.png$/, '.jpg'));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
