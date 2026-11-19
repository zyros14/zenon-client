/**
 * Instance backups — zip-based snapshots under %APPDATA%/zenon-client/backups/<instanceId>/.
 * Restore is deliberately non-destructive: it extracts into a NEW instance.
 */
const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const { INSTANCES_DIR, USER_DATA } = require('./paths');
const { readInstanceConfig, scaffoldInstanceLayout } = require('./instances');

const BACKUP_DIR = path.join(USER_DATA, 'backups');

function backupDirFor(instanceId) {
  return path.join(BACKUP_DIR, String(instanceId || ''));
}

async function backupInstance(instanceId) {
  const instanceDir = path.join(INSTANCES_DIR, instanceId);
  if (!instanceId || !fs.existsSync(instanceDir)) throw new Error('Instance not found');
  const cfg = readInstanceConfig(instanceId);
  const base = String(cfg?.name || 'instance').replace(/[\\/:*?"<>|]/g, '_');
  const destDir = backupDirFor(instanceId);
  fs.ensureDirSync(destDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(destDir, `${base}-${stamp}.zip`);
  const zip = new AdmZip();
  zip.addLocalFolder(instanceDir, '');
  zip.writeZip(dest);
  const st = fs.statSync(dest);
  return { success: true, file: dest, size: st.size };
}

async function listBackups(instanceId) {
  const root = backupDirFor(instanceId);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const f of fs.readdirSync(root)) {
    if (!f.toLowerCase().endsWith('.zip')) continue;
    const full = path.join(root, f);
    try {
      const st = fs.statSync(full);
      let name = null;
      try {
        const zip = new AdmZip(full);
        const entry = zip.getEntry('instance.json');
        if (entry) name = JSON.parse(entry.getData().toString('utf8'))?.name || null;
      } catch (e2) { /* unnamed backup */ }
      out.push({ file: full, name: name || f, size: st.size, at: st.mtimeMs, instanceId });
    } catch (e) { /* skip unreadable */ }
  }
  out.sort((a, b) => b.at - a.at);
  return out;
}

async function restoreBackup(file) {
  const target = path.resolve(String(file || ''));
  if (!file || !fs.existsSync(target)) throw new Error('Backup not found');
  const root = path.resolve(BACKUP_DIR) + path.sep;
  if (!target.startsWith(root)) throw new Error('Not a Zenon backup');
  const newId = uuidv4();
  const destDir = path.join(INSTANCES_DIR, newId);
  fs.ensureDirSync(destDir);
  const zip = new AdmZip(target);
  zip.extractAllTo(destDir, true);
  const cfgPath = path.join(destDir, 'instance.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) { /* start fresh below */ }
  const baseName = String(cfg?.name || 'Instance').replace(/\s*\(restored\)\s*\d*$/i, '').trim() || 'Instance';
  const instance = {
    ...cfg,
    id: newId,
    dir: destDir,
    name: `${baseName} (restored)`,
    created: new Date().toISOString(),
    lastPlayed: null,
    playTime: 0
  };
  fs.ensureDirSync(destDir);
  fs.writeFileSync(cfgPath, JSON.stringify(instance, null, 2));
  scaffoldInstanceLayout(destDir);
  return { success: true, instance };
}

function deleteBackup(file) {
  const target = path.resolve(String(file || ''));
  if (!file) return false;
  const root = path.resolve(BACKUP_DIR) + path.sep;
  if (!target.startsWith(root)) throw new Error('Invalid backup path');
  if (fs.existsSync(target)) fs.removeSync(target);
  return true;
}

module.exports = { backupInstance, listBackups, restoreBackup, deleteBackup };
