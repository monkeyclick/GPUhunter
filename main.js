// Electron main process: window + IPC bridge to AWS facade.

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const aws = require("./aws");
const gcp = require("./gcp");
const { autoUpdater } = require("electron-updater");

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow;

const LOGO_PATH = path.join(__dirname, "renderer", "gpulogo.png");

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
      sandbox: false, // preload uses require()
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
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
  mainWindow?.webContents.send("update:available", { version: info.version });
});

autoUpdater.on("download-progress", (p) => {
  mainWindow?.webContents.send("update:progress", { percent: Math.round(p.percent) });
});

autoUpdater.on("update-downloaded", (info) => {
  mainWindow?.webContents.send("update:downloaded", { version: info.version });
});

autoUpdater.on("error", (err) => {
  mainWindow?.webContents.send("update:error", err.message || String(err));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---- IPC handlers ---------------------------------------------------------

ipcMain.handle("aws:listRegions", async (_e, { profile }) => {
  return aws.listEnabledRegions(profile);
});

ipcMain.handle("aws:getOfferings", async (e, { regions, instanceTypes, profile }) => {
  const onProgress = (done, total, region) => {
    e.sender.send("aws:progress", { phase: "offerings", done, total, region });
  };
  return aws.getOfferingsMultiRegion(regions, instanceTypes, profile, onProgress);
});

ipcMain.handle("aws:getSpotScores", async (e, { instanceTypes, targetCapacity, regions, profile }) => {
  const onProgress = (done, total) => {
    e.sender.send("aws:progress", { phase: "spot", done, total });
  };
  return aws.getSpotPlacementScores(instanceTypes, targetCapacity, regions, profile, onProgress);
});

ipcMain.handle("aws:getAzIdMap", async (_e, { regions, profile }) => {
  return aws.getAzIdNameMap(regions, profile);
});

ipcMain.handle("aws:probe", async (_e, args) => {
  return aws.probeCapacity(args);
});

ipcMain.handle("update:install", () => {
  autoUpdater.quitAndInstall();
});

// ---- GCP IPC handlers -----------------------------------------------------

ipcMain.handle("gcp:getOfferings", async (e, { projectId, machineTypes, keyFile }) => {
  const onProgress = (done, total, zone) => {
    e.sender.send("aws:progress", { phase: "gcp", done, total, zone });
  };
  return gcp.getOfferingsAggregated(projectId, machineTypes, keyFile || null, onProgress);
});

ipcMain.handle("gcp:probe", async (_e, args) => {
  return gcp.probeCapacity(args);
});
