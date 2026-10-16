const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('nova', {
  state: () => ipcRenderer.invoke('state:get'),
  addText: (text) => ipcRenderer.invoke('add:text', text),
  addFiles: (files) => ipcRenderer.invoke('add:files', files.map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  browse: () => ipcRenderer.invoke('add:browse'),
  importNovaGrid: () => ipcRenderer.invoke('add:novagrid'),
  next: () => ipcRenderer.invoke('wall:next'),
  set: (id) => ipcRenderer.invoke('wall:set', id),
  remove: (id) => ipcRenderer.invoke('wall:remove', id),
  rename: (id, title) => ipcRenderer.invoke('wall:rename', id, title),
  settings: (change) => ipcRenderer.invoke('settings:set', change),
  openLibrary: () => ipcRenderer.invoke('library:open'),
  openSource: (id) => ipcRenderer.invoke('source:open', id),
  minimise: () => ipcRenderer.send('win:min'),
  close: () => ipcRenderer.send('win:close'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
});
