// One-off: connect to a running Electron app via CDP and capture screenshots.
// Usage: launch the app with --remote-debugging-port=9222, then `node scripts/ui-screenshot.js [waitMs]`
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'ui-shots');
const waitMs = Number(process.argv[2]) || 4000;

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
  await new Promise((r) => setTimeout(r, waitMs));
  const list = await targets();
  const page = list.find((t) => t.type === 'page' && !/devtools/i.test(t.url));
  if (!page) { console.error('no page target found', list); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((r) => ws.on('open', r));
  let id = 0;
  const pending = new Map();
  ws.on('message', (m) => {
    const msg = JSON.parse(m);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });

  fs.mkdirSync(OUT, { recursive: true });

  // Full UI with splash settled
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result && r.result.data) {
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
      console.log('saved', name);
    } else { console.error('capture failed', name, JSON.stringify(r).slice(0, 200)); }
  };

  // Splash
  await shot('01-splash');

  // Try to dismiss splash if app exposes the element; just click through by waiting more
  await new Promise((r) => setTimeout(r, 6000));
  await send('Page.captureScreenshot', {}).then(() => {});
  await shot('02-app');

  // Navigate to each page via JS (app router uses .nav-item[data-page])
  const pages = ['home', 'library', 'tools', 'discovery', 'host-server', 'settings'];
  for (const p of pages) {
    await send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector('.nav-item[data-page="${p}"]'); if (el) el.click(); })()`,
    });
    await new Promise((r) => setTimeout(r, 1200));
    await shot('page-' + p);
  }

  // Open the edit-instance modal if any instance card exists
  await send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector('.instance-card, .recent-instance-card'); if (el) el.click(); })()`,
  });
  await new Promise((r) => setTimeout(r, 1000));
  await shot('instance-selected');

  // Edit instance modal via context or double click
  await send('Runtime.evaluate', {
    expression: `(() => {
      const card = document.querySelector('.instance-card');
      if (card) {
        card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        const btn = document.getElementById('inst-edit-btn') || document.querySelector('[id*="edit"]');
        if (btn) btn.click();
      }
    })()`,
  });
  await new Promise((r) => setTimeout(r, 1200));
  await shot('edit-modal');

  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
