const fs = require('fs');
const p = 'C:\\Users\\xande\\AppData\\Local\\Temp\\asar-pkg-test.json';
try {
  const raw = fs.readFileSync(p, 'utf8');
  const j = JSON.parse(raw);
  console.log('asar root package.json version:', j.version);
} catch (e) {
  console.log('read failed:', e.message);
}
