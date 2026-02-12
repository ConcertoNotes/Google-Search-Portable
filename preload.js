const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("widgetAPI", {
  // Default search
  submitSearch: (query) => ipcRenderer.invoke("search:submit", query),
  hideWidget: () => ipcRenderer.send("widget:hide"),
  minimizeWidget: () => ipcRenderer.send("widget:minimize"),
  onActivated: (callback) => {
    ipcRenderer.on("widget:activated", () => callback());
  },

  // Aggregate search
  aggregateSearch: (query) => ipcRenderer.invoke("search:aggregate", query),
  searchSingle: (query, sourceId) =>
    ipcRenderer.invoke("search:single", query, sourceId),
  onPartialResult: (callback) => {
    ipcRenderer.on("search:partial", (_event, data) => callback(data));
  },
  openResult: (url) => ipcRenderer.invoke("result:open", url),
  resizeWindow: (width, height) =>
    ipcRenderer.invoke("window:resize", width, height),
  getSources: () => ipcRenderer.invoke("sources:list"),
  changeMode: (mode) => ipcRenderer.invoke("mode:change", mode),
  onHidden: (callback) => {
    ipcRenderer.on("widget:hidden", () => callback());
  },

  // Window drag-resize
  startResize: (direction, startX, startY) =>
    ipcRenderer.send("window:startResize", direction, startX, startY),
  resizeDrag: (x, y) => ipcRenderer.send("window:resizeDrag", x, y),
  stopResize: () => ipcRenderer.send("window:stopResize"),

  // Auth
  login: (sourceId) => ipcRenderer.invoke("auth:login", sourceId),
  logout: (sourceId) => ipcRenderer.invoke("auth:logout", sourceId),
  getAuthStatus: () => ipcRenderer.invoke("auth:status"),
  onAuthChanged: (callback) => {
    ipcRenderer.on("auth:changed", (_event, data) => callback(data));
  },
});
