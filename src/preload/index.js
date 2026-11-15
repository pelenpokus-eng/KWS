import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
  },
  saveScreenshot: (dataUrl, label) => ipcRenderer.invoke('save-screenshot', dataUrl, label),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  recStart: (target, label) => ipcRenderer.invoke('rec-start', target, label),
  recStop: (id) => ipcRenderer.invoke('rec-stop', id),
  showInFolder: (path) => ipcRenderer.invoke('show-in-folder', path),
  recList: () => ipcRenderer.invoke('rec-list'),
  recOpen: (path) => ipcRenderer.invoke('rec-open', path),
  recDelete: (path) => ipcRenderer.invoke('rec-delete', path),
  recOpenFolder: () => ipcRenderer.invoke('rec-open-folder'),
  onRecActive: (cb) => {
    const h = (_, n) => cb(n)
    ipcRenderer.on('rec-active', h)
    return () => ipcRenderer.removeListener('rec-active', h)
  },
  onRecEnded: (cb) => {
    const h = (_, info) => cb(info)
    ipcRenderer.on('rec-ended', h)
    return () => ipcRenderer.removeListener('rec-ended', h)
  },
  setContextExtra: (extra) => ipcRenderer.send('context-extra', extra),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window-toggle-maximize'),
  isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizedChanged: (cb) => {
    const h = (_, flag) => cb(!!flag)
    ipcRenderer.on('maximized-changed', h)
    return () => ipcRenderer.removeListener('maximized-changed', h)
  },
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
  setYouTubeQuality: (videoId, q) => ipcRenderer.invoke('set-youtube-quality', videoId, q),
  ytStatus: (videoId) => ipcRenderer.invoke('yt-status', videoId),
  extOpen: (dockIndex, url, rect) => ipcRenderer.invoke('ext-open', dockIndex, url, rect),
  extRect: (dockIndex, rect) => ipcRenderer.invoke('ext-rect', dockIndex, rect),
  extClose: (dockIndex) => ipcRenderer.invoke('ext-close', dockIndex),
  extAudio: (dockIndex, muted, volume) => ipcRenderer.invoke('ext-audio', dockIndex, muted, volume),
  extLogin: () => ipcRenderer.invoke('ext-login'),
  setExtProfile: (mode) => ipcRenderer.invoke('ext-profile', mode),
  onExtClosed: (cb) => {
    const h = (_, dockIndex) => cb(dockIndex)
    ipcRenderer.on('ext-closed', h)
    return () => ipcRenderer.removeListener('ext-closed', h)
  },
  setTwitchQuality: (id, q) => ipcRenderer.invoke('set-twitch-quality', id, q),
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
  openSiteCheck: (url) => ipcRenderer.invoke('open-site-check', url),
  onSiteSessionChanged: (cb) => {
    const h = (_, host) => cb(host)
    ipcRenderer.on('site-session-changed', h)
    return () => ipcRenderer.removeListener('site-session-changed', h)
  },
  showupLogout: () => ipcRenderer.invoke('showup-logout'),
  onShowupSessionChanged: (cb) => {
    const h = () => cb()
    ipcRenderer.on('showup-session-changed', h)
    return () => ipcRenderer.removeListener('showup-session-changed', h)
  },
  searchChannels: (query) => ipcRenderer.invoke('search-channels', query),
})
