// Desktop shell: the game is a browser build, so Electron serves it over the same
// zero-dependency static server instead of file:// (ES module imports need an origin).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { startServer } = require('../server.cjs');

// The art ships in the repo (assets/gen/make_art.py produces it); the desktop shell is the
// one place a player sees it before the page ever loads, so the window and the dock carry it.
const ICON = path.join(__dirname, '..', 'assets', 'img', 'icon-512.png');

async function createWindow() {
  const server = await startServer({ port: 0 });
  const { port } = server.address();
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 780,
    minHeight: 600,
    backgroundColor: '#101217',
    title: '死锁车库 Gridlock',
    icon: ICON, // Windows / Linux 的窗口与任务栏图标；macOS 的窗口图标由系统接管
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  win.on('closed', () => server.close());
}

app.whenReady().then(() => {
  // macOS 的图标长在程序坞上，BrowserWindow 的 icon 字段在这里不起作用。
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(ICON);
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
