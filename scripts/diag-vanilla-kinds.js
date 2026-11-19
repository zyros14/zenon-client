// Visit the vanilla instance page and screenshot.
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
  // Pick the vanilla instance and navigate to instance page
  const vanillaId = await ev("State.instances.filter(i => i.loader === 'vanilla').map(i => i.id)[0] || null");
  console.log('vanilla instance id:', vanillaId);
  if (vanillaId) {
    await ev(`(() => { const inst = State.instances.find(i => i.id === ${JSON.stringify(vanillaId)}); if (inst) { State.selectedInstance = inst; navigateTo('instance', { force: true }); } })()`);
  }
  await sleep(1800);
  console.log('kind pills (vanilla):', await ev("Array.from(document.querySelectorAll('#library-kind-pills [data-kind]')).map(p => p.textContent.trim()).join(', ')"));
  console.log('active pill:', await ev("document.querySelector('#library-kind-pills .id-pill.active')?.textContent?.trim()"));
  const shot = await Promise.race([
    send('Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: false }),
    sleep(12000).then(() => null)
  ]);
  if (shot) { fs.writeFileSync('ui-shots/vanilla-kinds.jpg', Buffer.from(shot.data, 'base64')); console.log('saved vanilla-kinds.jpg'); } else console.log('timeout');
  // Also navigate back to the fabric instance for comparison
  const fabricId = await ev("State.instances.filter(i => i.loader !== 'vanilla').map(i => i.id)[0] || null");
  if (fabricId) {
    await ev(`(() => { const inst = State.instances.find(i => i.id === ${JSON.stringify(fabricId)}); if (inst) { State.selectedInstance = inst; navigateTo('instance', { force: true }); } })()`);
    await sleep(1500);
    console.log('kind pills (fabric):', await ev("Array.from(document.querySelectorAll('#library-kind-pills [data-kind]')).map(p => p.textContent.trim()).join(', ')"));
    const shot2 = await Promise.race([
      send('Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: false }),
      sleep(10000).then(() => null)
    ]);
    if (shot2) { fs.writeFileSync('ui-shots/fabric-kinds.jpg', Buffer.from(shot2.data, 'base64')); console.log('saved fabric-kinds.jpg'); }
  }
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
