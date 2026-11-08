import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
  },
  saveScreenshot: (dataUrl, label) => ipcRenderer.invoke('save-screenshot', dataUrl, label),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  setWebviewSize: (id, w, h) => ipcRenderer.invoke('set-webview-size', id, w, h),
  getKickChatroomId: (channel) => ipcRenderer.invoke('get-kick-chatroom-id', channel),
  setWebContentsMuted: (id, muted) => ipcRenderer.invoke('set-webcontents-muted', id, muted),
  setWebContentsVolume: (id, volume) => ipcRenderer.invoke('set-webcontents-volume', id, volume),
  setFrameMuted: (embedUrl, muted) => ipcRenderer.invoke('set-frame-muted', embedUrl, muted),
  setFrameVolume: (embedUrl, volume) => ipcRenderer.invoke('set-frame-volume', embedUrl, volume),
  setYouTubeAudio: (videoId, muted, volume) => ipcRenderer.invoke('set-youtube-audio', videoId, muted, volume),
  injectChatangoDark: (id) => ipcRenderer.invoke('inject-chatango-dark', id),
  getChatPort: () => ipcRenderer.invoke('get-chat-port'),
})
