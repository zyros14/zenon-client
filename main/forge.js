/** Forge installer + version-list helpers shared by server creation and game launch. */
const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');
const { nativeFetch } = require('./nativeFetch');
const { SHARED_MC_CACHE } = require('./paths');
const { compareForgeFullIdDesc, forgeMcVersionFallbacks } = require('./lib/versions');

const FORGE_FETCH_HEADERS = { 'User-Agent': 'ZenonClient/1.1.4 (Electron; +https://github.com/)' };

async function ensureForgeInstallerJar(forgeFull) {
  const sub = path.join(SHARED_MC_CACHE, 'forge-installers');
  fs.ensureDirSync(sub);
  const fileName = `forge-${forgeFull}-installer.jar`;
  const dest = path.join(sub, fileName);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 50000) return dest;
  const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeFull}/forge-${forgeFull}-installer.jar`;
  const ir = await nativeFetch(url, { headers: FORGE_FETCH_HEADERS });
  if (!ir.ok) throw new Error(`Could not download Forge installer for ${forgeFull} (HTTP ${ir.status}).`);
  const buf = Buffer.from(await ir.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

async function installForgeServerToDir(dir, forgeFull, javaExe) {
  const instDir = path.join(dir, '.zenon-forge-install');
  fs.ensureDirSync(instDir);
  const installerPath = path.join(instDir, `forge-${forgeFull}-installer.jar`);
  const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeFull}/forge-${forgeFull}-installer.jar`;
  const ir = await nativeFetch(url, { headers: FORGE_FETCH_HEADERS });
  if (!ir.ok) throw new Error(`Forge installer not found for ${forgeFull} (HTTP ${ir.status}).`);
  const buf = Buffer.from(await ir.arrayBuffer());
  fs.writeFileSync(installerPath, buf);

  const java = String(javaExe || 'java').trim() || 'java';
  const proc = spawnSync(java, ['-jar', installerPath, '--installServer'], {
    cwd: instDir,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    env: process.env,
    maxBuffer: 32 * 1024 * 1024
  });
  if (proc.error) throw new Error(`Forge install: ${proc.error.message}`);
  if (proc.status !== 0) {
    const err = `${proc.stderr || ''}\n${proc.stdout || ''}`.trim().slice(0, 800);
    throw new Error(`Forge installer exited with code ${proc.status}. ${err}`);
  }

  const names = fs.readdirSync(instDir);
  for (const n of names) {
    if (n === path.basename(installerPath)) continue;
    fs.moveSync(path.join(instDir, n), path.join(dir, n), { overwrite: true });
  }
  fs.removeSync(instDir);
}

async function fetchForgeMavenVersionStrings() {
  const urls = [
    'https://maven.minecraftforge.net/releases/net/minecraftforge/forge/maven-metadata.xml',
    'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'
  ];
  for (const url of urls) {
    try {
      const mr = await nativeFetch(url, { headers: FORGE_FETCH_HEADERS });
      if (!mr.ok) continue;
      const text = await mr.text();
      const vers = [];
      const re = /<version>([^<]+)<\/version>/g;
      let m;
      while ((m = re.exec(text))) vers.push(m[1]);
      if (vers.length) return vers;
    } catch (e) {}
  }
  return [];
}

async function fetchForgeVersionsForMc(mcVersion) {
  const mcKeys = forgeMcVersionFallbacks(mcVersion);
  if (!mcKeys.length) return [];
  const out = [];
  const seen = new Set();
  const addRow = (row) => {
    if (seen.has(row.full)) return;
    seen.add(row.full);
    out.push(row);
  };

  try {
    const pr = await nativeFetch('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', {
      headers: FORGE_FETCH_HEADERS
    });
    if (pr.ok) {
      const j = await pr.json();
      const promos = j.promos || {};
      for (const mc of mcKeys) {
        for (const ch of ['recommended', 'latest']) {
          const k = `${mc}-${ch}`;
          const forgePart = promos[k];
          if (forgePart) {
            const full = `${mc}-${forgePart}`;
            addRow({ full, label: `${full} (${ch})`, channel: ch });
          }
        }
      }
    }
  } catch (e) {}

  try {
    const allVers = await fetchForgeMavenVersionStrings();
    for (const mc of mcKeys) {
      const prefix = `${mc}-`;
      for (const v of allVers) {
        if (v.startsWith(prefix)) addRow({ full: v, label: v, channel: 'build' });
      }
    }
  } catch (e) {}

  const rest = out.filter((o) => o.channel === 'build').sort((x, y) => compareForgeFullIdDesc(x.full, y.full));
  const head = out.filter((o) => o.channel !== 'build');
  return [...head, ...rest];
}

module.exports = {
  FORGE_FETCH_HEADERS,
  ensureForgeInstallerJar,
  installForgeServerToDir,
  fetchForgeMavenVersionStrings,
  fetchForgeVersionsForMc
};
