// Preload: expose a narrow, safe API to the renderer.
const { contextBridge, ipcRenderer, shell } = require("electron");

contextBridge.exposeInMainWorld("gpuHunter", {
  // AWS
  listRegions: (profile) => ipcRenderer.invoke("aws:listRegions", { profile }),
  getOfferings: (args) => ipcRenderer.invoke("aws:getOfferings", args),
  getSpotScores: (args) => ipcRenderer.invoke("aws:getSpotScores", args),
  getAzIdMap: (args) => ipcRenderer.invoke("aws:getAzIdMap", args),
  probe: (args) => ipcRenderer.invoke("aws:probe", args),
  onProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("aws:progress", listener);
    return () => ipcRenderer.removeListener("aws:progress", listener);
  },

  // Auto-updater
  onUpdateAvailable:  (cb) => ipcRenderer.on("update:available",  (_e, info) => cb(info)),
  onUpdateProgress:   (cb) => ipcRenderer.on("update:progress",   (_e, p)    => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on("update:downloaded", (_e, info) => cb(info)),
  onUpdateError:      (cb) => ipcRenderer.on("update:error",      (_e, msg)  => cb(msg)),
  installUpdate: () => ipcRenderer.invoke("update:install"),

  // GCP
  gcpGetOfferings: (args) => ipcRenderer.invoke("gcp:getOfferings", args),
  gcpProbe:        (args) => ipcRenderer.invoke("gcp:probe",        args),

  // Open a URL in the system default browser.
  openExternal: (url) => shell.openExternal(url),
});
