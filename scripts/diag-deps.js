// Diagnostic: install Iris (requires Sodium) through the app's own IPC and report deps result.
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.CDP_PORT || 9223;
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let targets;
  for (let i = 0; i < 30; i++) {
    try { targets = await getJson(`http://127.0.0.1:${PORT}/json/list`); break; }
    catch (e) { await sleep(500); }
  }
  if (!targets) { console.error('CDP unreachable'); process.exit(1); }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  await new Promise((r) => ws.on('open', r));

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.value;
  };

  for (let i = 0; i < 30; i++) {
    const ready = await evalJs(`!!window.State && !!(State.auth && State.auth.loggedIn)`);
    if (ready === true) break;
    await sleep(1000);
  }

  const result = await evalJs(`(async () => {
    const inst = State.selectedInstance;
    const versions = await window.zenon.getProjectVersions({ projectId: 'iris', mcVersion: '26.3', loader: 'fabric' });
    if (!versions || !versions.length) return { error: 'no iris versions' };
    const versionData = versions[0];
    const r = await window.zenon.downloadContent(inst.id, 'mod', versionData, { projectId: 'iris', title: 'Iris', iconUrl: '', author: null });
    return r;
  })()`);
  console.log('download result:', JSON.stringify(result, null, 2));

  const mods = await evalJs(`window.zenon.getContent(State.selectedInstance.id, 'mod').then(list => list.map(m => m.filename + ' | ' + (m.title || m.displayName)))`);
  console.log('--- installed mods now ---');
  console.log(mods.join('\n'));

  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
