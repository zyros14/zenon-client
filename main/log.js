/** Logging + renderer messaging shared by every module. */
const bridge = require('./bridge');

/** Hide noisy [msa] auth library console output (app polish). Installed once at startup. */
function patchAuthConsole() {
  if (global.__zenonStdoutPatched) return;
  const patchStream = (stream) => {
    const origWrite = stream.write.bind(stream);
    stream.write = (chunk, encoding, cb) => {
      try {
        const str = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        if (
          str.includes('[msa]') ||
          (str.includes('microsoft.com/link') && str.toLowerCase().includes('use the code'))
        ) {
          if (typeof cb === 'function') cb();
          return true;
        }
      } catch (e) {}
      return origWrite(chunk, encoding, cb);
    };
  };
  patchStream(process.stdout);
  patchStream(process.stderr);
  global.__zenonStdoutPatched = true;
}

function withSilencedAuthLogs(fn) {
  const wrap = (orig) => (...args) => {
    const first = args?.[0];
    if (typeof first === 'string' && first.startsWith('[msa]')) return;
    return orig(...args);
  };

  const orig = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  };

  console.log = wrap(orig.log);
  console.info = wrap(orig.info);
  console.warn = wrap(orig.warn);
  console.error = wrap(orig.error);

  try {
    return fn();
  } finally {
    console.log = orig.log;
    console.info = orig.info;
    console.warn = orig.warn;
    console.error = orig.error;
  }
}

function sendToRenderer(channel, payload) {
  try {
    const mainWindow = bridge.getWindow();
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  } catch (e) {}
}

/** Send a line to the in-app Launch Console (main-process scope so helpers can log too). */
function sendLaunchLog(type, message) {
  sendToRenderer('launch-log', { type, message });
}

/** Visible in the terminal (not filtered by stdout patch) + sent to renderer as auth:log */
function zenonAuthLog(step, detail = '') {
  const tail = detail ? ` ${detail}` : '';
  console.log(`[zenon-auth] ${step}${tail}`);
  try {
    const mainWindow = bridge.getWindow();
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('auth:log', { step, detail: String(detail || ''), at: new Date().toISOString() });
    }
  } catch (e) {}
}

module.exports = {
  patchAuthConsole,
  withSilencedAuthLogs,
  sendToRenderer,
  sendLaunchLog,
  zenonAuthLog
};
