/**
 * Late-bound holder for the main BrowserWindow.
 * Lets logging/updater code reach the window without circular requires.
 */
let win = null;

module.exports = {
  setWindow(w) { win = w; },
  getWindow() { return win; }
};
