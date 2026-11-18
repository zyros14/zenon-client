// Reproduce the server bugs post-fix: Paper versions list, create, start, console.
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

  const pv = await ev(`window.zenon.getPaperMcVersions()`);
  console.log('paper versions (first 6):', JSON.stringify((pv || []).slice(0, 6)));

  const created = await ev(`window.zenon.createServer({ name: 'Paper Debug', version: '26.3', serverKind: 'paper' })`);
  console.log('create paper 26.3:', JSON.stringify(created));
  if (!created?.server?.id) { console.log('PAPER CREATE FAILED'); process.exit(1); }

  const serverId = created.server.id;
  await ev(`window.zenon.serverAcceptEula('${serverId}')`);
  const startRes = await ev(`window.zenon.serverStart('${serverId}')`);
  console.log('start result:', JSON.stringify(startRes));

  const t0 = Date.now();
  let lastLines = [];
  while ((Date.now() - t0) / 1000 < 120) {
    await sleep(3000);
    const buf = await ev(`window.zenon.serverConsoleBuffer('${serverId}')`);
    const lines = buf?.lines || [];
    if (lines.length > lastLines.length) {
      const fresh = lines.slice(lastLines.length);
      console.log('---');
      for (const l of fresh) console.log(l);
      lastLines = lines;
    }
    const text = lines.join('\n');
    if (/Done \(|Implementation version|UnsupportedClassVersionError|Failed to start/i.test(text)) break;
  }

  const status = await ev(`window.zenon.serverStatus('${serverId}')`);
  console.log('server status:', JSON.stringify(status));

  await ev(`window.zenon.serverSendCommand('${serverId}', 'stop')`).catch(() => {});
  await sleep(2000);
  await ev(`window.zenon.deleteServer('${serverId}')`);
  console.log('server cleaned up');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
