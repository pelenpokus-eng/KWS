import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
  },
  saveScreenshot: (dataUrl, label) => ipcRenderer.invoke('save-screenshot', dataUrl, label),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  toggleFullScreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullScreen: () => ipcRenderer.invoke('is-fullscreen'),
  onFullScreenChanged: (cb) => {
    const h = (_, flag) => cb(!!flag)
    ipcRenderer.on('fullscreen-changed', h)
    return () => ipcRenderer.removeListener('fullscreen-changed', h)
  },
  setWebviewSize: (id, w, h) => ipcRenderer.invoke('set-webview-size', id, w, h),
  setWebContentsMuted: (id, muted) => ipcRenderer.invoke('set-webcontents-muted', id, muted),
  setWebContentsVolume: (id, volume) => ipcRenderer.invoke('set-webcontents-volume', id, volume),
  setFrameMuted: (embedUrl, muted) => ipcRenderer.invoke('set-frame-muted', embedUrl, muted),
  setFrameVolume: (embedUrl, volume) => ipcRenderer.invoke('set-frame-volume', embedUrl, volume),
  setYouTubeAudio: (videoId, muted, volume) => ipcRenderer.invoke('set-youtube-audio', videoId, muted, volume),
  chatangoCompact: (id, fontPct) => ipcRenderer.invoke('chatango-compact', id, fontPct),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  setChatFont: (id, pct) => ipcRenderer.invoke('set-chat-font', id, pct),
  setTwitchChatFont: (pct) => ipcRenderer.invoke('set-twitch-chat-font', pct),
  onChatOpenUrl: (cb) => {
    const h = (_, url) => cb(url)
    ipcRenderer.on('chat-open-url', h)
    return () => ipcRenderer.removeListener('chat-open-url', h)
  },
  focusVideoPlayer: (id) => ipcRenderer.invoke('focus-video-player', id),
  showupLogin: () => ipcRenderer.invoke('showup-login'),
  showupLogout: () => ipcRenderer.invoke('showup-logout'),
  onShowupSessionChanged: (cb) => {
    const h = () => cb()
    ipcRenderer.on('showup-session-changed', h)
    return () => ipcRenderer.removeListener('showup-session-changed', h)
  },
  searchChannels: (query) => ipcRenderer.invoke('search-channels', query),
})
