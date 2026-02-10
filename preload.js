const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("widgetAPI", {
  submitSearch: (query) => ipcRenderer.invoke("search:submit", query),
  hideWidget: () => ipcRenderer.send("widget:hide"),
  onActivated: (callback) => {
    ipcRenderer.on("widget:activated", () => callback());
  },
});
