// Electron main process: window + IPC bridge to the cloud facades.

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const aws = require("./aws");
const gcp = require("./gcp");
const { runScan } = require("./core/scan");
const { autoUpdater } = require("electron-updater");

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow = null;

const LOGO_PATH = path.join(__dirname, "renderer", "gpulogo.png");

// The window may be closed (and destroyed) while the app stays alive on macOS,
// so every async send must re-check the target.
function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "GPU Hunter",
    icon: LOGO_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The renderer never needs to navigate or open windows; anything that looks
  // like a link (e.g. Leaflet's attribution) goes to the system browser.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    openExternalSafe(url);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function openExternalSafe(url) {
  try {
    if (new URL(url).protocol === "https:") shell.openExternal(url);
  } catch {}
}

app.whenReady().then(() => {
  // macOS: set the dock icon (BrowserWindow.icon is ignored on macOS).
  if (process.platform === "darwin" && app.dock && app.dock.setIcon) {
    try { app.dock.setIcon(LOGO_PATH); } catch {}
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Check for updates only in packaged builds; skip during `electron .` dev runs.
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates(), 3000);
    setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
  }
});

// ---- Auto-updater events --------------------------------------------------

autoUpdater.on("update-available", (info) => {
  sendToRenderer("update:available", { version: info.version });
});

autoUpdater.on("download-progress", (p) => {
  sendToRenderer("update:progress", { percent: Math.round(p.percent) });
});

autoUpdater.on("update-downloaded", (info) => {
  sendToRenderer("update:downloaded", { version: info.version });
});

autoUpdater.on("error", (err) => {
  sendToRenderer("update:error", err.message || String(err));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---- IPC handlers ---------------------------------------------------------

// Full scan — shared orchestration with the CLI (core/scan.js).
ipcMain.handle("scan:run", async (e, opts) => {
  return runScan({
    ...opts,
    onProgress: (phase, done, total, label) => {
      e.sender.send("scan:progress", { phase, done, total, label });
    },
  });
});

ipcMain.handle("aws:getAzIdMap", async (_e, { regions, profile }) => {
  return aws.getAzIdNameMap(regions, profile);
});

ipcMain.handle("aws:probe", async (_e, args) => {
  return aws.probeCapacity(args);
});

ipcMain.handle("gcp:probe", async (_e, args) => {
  return gcp.probeCapacity(args);
});

ipcMain.handle("update:install", () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle("app:openExternal", (_e, url) => {
  openExternalSafe(url);
});
