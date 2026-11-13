// One-off: screenshot Settings About section to confirm "Version 1.0.8".
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'ui-shots');

function targets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

async function main() {
  await new Promise((r) => setTimeout(r, 14000));
  const list = await targets();
  const page = list.find((t) => t.type === 'page' && !/devtools/i.test(t.url));
  if (!page) { console.error('no page target'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((r) => ws.on('open', r));
  let id = 0;
  const pending = new Map();
  ws.on('message', (m) => {
    const msg = JSON.parse(m);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      const t = setTimeout(() => { pending.delete(i); resolve(null); }, 12000);
      pending.set(i, (msg) => { clearTimeout(t); resolve(msg); });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    return r?.result?.result?.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r?.result?.data) { fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); console.log('saved', name); }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await evalJs(`document.querySelector('.nav-item[data-page="settings"]')?.click()`);
  await sleep(1800);
  const about = await evalJs(`(() => {
    const el = [...document.querySelectorAll('.settings-section')].find(s => /About/i.test(s.textContent || ''));
    if (el) el.scrollIntoView({ block: 'center' });
    return el ? el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120) : 'not found';
  })()`);
  console.log('about text:', about);
  await sleep(600);
  await shot('v6-about-version');

  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
