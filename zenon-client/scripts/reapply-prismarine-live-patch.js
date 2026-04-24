/**
 * Copies Zenon's patched LiveTokenManager into prismarine-auth after npm install.
 * Patch: User-Agent on live.com requests, RFC8628 slow_down backoff, safe poll interval.
 */
const fs = require('fs');
const path = require('path');

const patchSrc = path.join(__dirname, '..', 'vendor', 'prismarine-auth-LiveTokenManager.js');
let pkgRoot;
try {
  pkgRoot = path.dirname(require.resolve('prismarine-auth/package.json'));
} catch (e) {
  process.exit(0);
}
const dest = path.join(pkgRoot, 'src', 'TokenManagers', 'LiveTokenManager.js');
try {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(patchSrc, dest);
} catch (e) {
  console.warn('[zenon] Could not apply prismarine-auth Live patch:', e.message);
}
