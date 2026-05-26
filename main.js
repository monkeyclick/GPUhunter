// Electron main process: window + IPC bridge to AWS facade.

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const aws = require("./aws");

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
