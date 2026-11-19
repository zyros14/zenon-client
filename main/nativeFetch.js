/** Prefer Electron/Node's global undici fetch — node-fetch v2 + AbortSignal is flaky in some Electron versions. */
const fetch = require('node-fetch');

function nativeFetch(url, opts) {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(url, opts);
  return fetch(url, opts);
}

module.exports = { nativeFetch };
