const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recordingOverlayApi', {
  selectRegion: (bounds, fullscreen, displayId) =>
    ipcRenderer.invoke('recorder:select-region-result', { bounds, fullscreen, displayId }),
  cancel: () => ipcRenderer.invoke('recorder:cancel-select-region'),
  getWindows: (displayId) => ipcRenderer.invoke('recorder:get-windows', displayId),
});
