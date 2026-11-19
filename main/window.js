/** Main window: frameless, preload-bound renderer. */
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const bridge = require('./bridge');

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'src', 'assets', 'zenon-logo.png');
  const opts = {
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js')
    }
  };
  if (fs.existsSync(iconPath)) opts.icon = iconPath;

  const mainWindow = new BrowserWindow(opts);
  bridge.setWindow(mainWindow);

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    try {
      mainWindow.focus();
    } catch (e) {}
  });

  mainWindow.on('closed', () => {
    bridge.setWindow(null);
  });
}

module.exports = { createWindow };
