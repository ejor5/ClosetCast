const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("closetCast", {
  getBootstrap: () => ipcRenderer.invoke("closetcast:get-bootstrap"),
  refreshSchedule: () => ipcRenderer.invoke("closetcast:refresh-schedule"),
  resolveYankeesStream: () => ipcRenderer.invoke("closetcast:resolve-yankees-stream"),
  refreshAmbient: () => ipcRenderer.invoke("closetcast:refresh-ambient"),
  setFullscreen: (enabled) => ipcRenderer.invoke("closetcast:set-fullscreen", enabled),
  openConfigFolder: () => ipcRenderer.invoke("closetcast:open-config-folder"),
  openLogsFolder: () => ipcRenderer.invoke("closetcast:open-logs-folder"),
  openExternalUrl: (url) => ipcRenderer.invoke("closetcast:open-external-url", url),
  onYankeesState: (callback) => {
    ipcRenderer.on("closetcast:yankees-state", (_event, state) => callback(state));
  },
  onWeatherState: (callback) => {
    ipcRenderer.on("closetcast:weather-state", (_event, state) => callback(state));
  },
  onCalendarState: (callback) => {
    ipcRenderer.on("closetcast:calendar-state", (_event, state) => callback(state));
  },
  onDayCycleState: (callback) => {
    ipcRenderer.on("closetcast:day-cycle-state", (_event, state) => callback(state));
  },
  onAppModeState: (callback) => {
    ipcRenderer.on("closetcast:app-mode-state", (_event, state) => callback(state));
  },
  onAmbientState: (callback) => {
    ipcRenderer.on("closetcast:ambient-state", (_event, state) => callback(state));
  },
  onMediaUpdated: (callback) => {
    ipcRenderer.on("closetcast:media-updated", (_event, files) => callback(files));
  }
});
