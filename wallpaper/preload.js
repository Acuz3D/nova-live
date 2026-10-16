const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wall', {
  onState: (cb) => ipcRenderer.on('player:state', (_e, s) => cb(s)),
  ready: () => ipcRenderer.send('player:ready'),
  ended: () => ipcRenderer.send('player:ended'),
});
