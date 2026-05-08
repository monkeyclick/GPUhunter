// Preload: expose a narrow, safe API to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gpuHunter", {
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
});
