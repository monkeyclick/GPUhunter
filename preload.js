// Preload: expose a narrow, safe API to the renderer.
// Runs sandboxed — only contextBridge/ipcRenderer are available here.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gpuHunter", {
  // Full scan — shared orchestration with the CLI (main calls core/scan.js).
  runScan: (opts) => ipcRenderer.invoke("scan:run", opts),
  onProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("scan:progress", listener);
    return () => ipcRenderer.removeListener("scan:progress", listener);
  },

  // Probing + AZ lookup
  getAzIdMap: (args) => ipcRenderer.invoke("aws:getAzIdMap", args),
  probe: (args) => ipcRenderer.invoke("aws:probe", args),
  gcpProbe: (args) => ipcRenderer.invoke("gcp:probe", args),

  // Auto-updater
  onUpdateAvailable:  (cb) => ipcRenderer.on("update:available",  (_e, info) => cb(info)),
  onUpdateProgress:   (cb) => ipcRenderer.on("update:progress",   (_e, p)    => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on("update:downloaded", (_e, info) => cb(info)),
  onUpdateError:      (cb) => ipcRenderer.on("update:error",      (_e, msg)  => cb(msg)),
  installUpdate: () => ipcRenderer.invoke("update:install"),

  // Open an https URL in the system default browser (validated in main).
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
});
