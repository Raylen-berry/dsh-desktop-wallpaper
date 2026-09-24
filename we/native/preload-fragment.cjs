// Appended by tools/install-native-bridge.mjs to DSH's trusted preload.
electron.contextBridge.exposeInMainWorld('dshWallpaper', Object.freeze({
  capability: () => electron.ipcRenderer.invoke('bga-live:capability'),
  start: (id, token) => electron.ipcRenderer.invoke('bga-live:start', {id, token}),
  stop: token => electron.ipcRenderer.invoke('bga-live:stop', token),
  properties: (id, action = 'read', values, name) => electron.ipcRenderer.invoke('bga-live:properties', {id, action, values, name}),
  onVisibility: callback => {
    const listener = (_event, visible) => callback(visible === true);
    electron.ipcRenderer.on('bga-live:visibility', listener);
    return () => electron.ipcRenderer.removeListener('bga-live:visibility', listener);
  },
}));
