/**
 * User-data layout. Everything Zenon writes lives under Electron's userData dir
 * (%APPDATA%\zenon-client on Windows). Dirs are created on require.
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');

const USER_DATA = app.getPath('userData');
const INSTANCES_DIR = path.join(USER_DATA, 'instances');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const AUTH_CACHE_DIR = path.join(USER_DATA, 'auth-cache');
/** Shared game files across all instances — avoids re-downloading GB per world. */
const SHARED_MC_ASSETS = path.join(USER_DATA, 'shared-minecraft-assets');
const SHARED_MC_LIBRARIES = path.join(USER_DATA, 'shared-minecraft-libraries');
const SHARED_MC_CACHE = path.join(USER_DATA, 'shared-minecraft-cache');

fs.ensureDirSync(INSTANCES_DIR);
fs.ensureDirSync(SHARED_MC_ASSETS);
fs.ensureDirSync(SHARED_MC_LIBRARIES);
fs.ensureDirSync(SHARED_MC_CACHE);

const SERVERS_DIR = path.join(USER_DATA, 'servers');
fs.ensureDirSync(SERVERS_DIR);

/** Skin library — user's custom Minecraft skin files, stored locally. */
const SKINS_DIR = path.join(USER_DATA, 'skins');
fs.ensureDirSync(SKINS_DIR);
const SKIN_LIBRARY_FILE = path.join(SKINS_DIR, 'library.json');

/** Launcher-managed Java runtimes (downloaded when the system Java is too old for a MC version). */
const JAVA_RUNTIMES_DIR = path.join(USER_DATA, 'java-runtimes');
fs.ensureDirSync(JAVA_RUNTIMES_DIR);

module.exports = {
  USER_DATA,
  INSTANCES_DIR,
  SETTINGS_FILE,
  AUTH_CACHE_DIR,
  SHARED_MC_ASSETS,
  SHARED_MC_LIBRARIES,
  SHARED_MC_CACHE,
  SERVERS_DIR,
  SKINS_DIR,
  SKIN_LIBRARY_FILE,
  JAVA_RUNTIMES_DIR
};
