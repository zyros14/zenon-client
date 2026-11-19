/** Read a dedicated server's config (server.json) from its folder. */
const fs = require('fs-extra');
const path = require('path');
const { SERVERS_DIR } = require('./paths');

function readServerConfig(serverId) {
  const p = path.join(SERVERS_DIR, serverId, 'server.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

module.exports = { readServerConfig };
