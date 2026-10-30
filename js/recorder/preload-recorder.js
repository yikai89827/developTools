const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onRecordingTime: (callback) => {
    ipcRenderer.on('recording:update-time', callback);
  },
  stopRecording: () => {
    ipcRenderer.invoke('recorder:request-stop');
  },
  getWindowPosition: () => {
    return ipcRenderer.invoke('recorder:get-window-position');
  },
  setWindowPosition: (x, y) => {
    return ipcRenderer.invoke('recorder:set-window-position', { x, y });
  },
});
