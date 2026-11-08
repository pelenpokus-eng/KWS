export function parseStreamUrl(rawUrl) {
  let url = rawUrl.trim()
  if (!url.startsWith('http')) url = 'https://' + url

  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace('www.', '')

    // Twitch
    if (host === 'twitch.tv') {
      const parts = parsed.pathname.split('/').filter(Boolean)
      if (!parts.length) return null
      const channel = parts[0]
      if (parts[1] === 'clip' && parts[2]) {
        return {
          platform: 'twitch',
          type: 'clip',
          id: parts[2],
          label: `Twitch Clip: ${parts[2]}`,
          originalUrl: url,
          embedUrl: `https://clips.twitch.tv/embed?clip=${parts[2]}&parent=localhost&autoplay=true`,
        }
      }
      return {
        platform: 'twitch',
        type: 'live',
        id: channel,
        label: `Twitch: ${channel}`,
        originalUrl: url,
        embedUrl: `https://player.twitch.tv/?channel=${channel}&parent=localhost&autoplay=true`,
      }
    }

    // YouTube
    if (host === 'youtube.com' || host === 'youtu.be') {
      let videoId = null
      if (host === 'youtu.be') {
        videoId = parsed.pathname.slice(1).split('/')[0]
      } else if (parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v')
      } else if (parsed.pathname.startsWith('/live/')) {
        videoId = parsed.pathname.replace('/live/', '').split('/')[0]
      } else if (parsed.pathname.startsWith('/embed/')) {
        videoId = parsed.pathname.replace('/embed/', '').split('/')[0]
      }
      if (videoId) {
        return {
          platform: 'youtube',
          type: 'video',
          id: videoId,
          label: `YouTube: ${videoId}`,
          originalUrl: url,
          embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`,
        }
      }
    }

    // Kick
    if (host === 'kick.com') {
      const channel = parsed.pathname.split('/').filter(Boolean)[0]
      if (channel) {
        return {
          platform: 'kick',
          type: 'live',
          id: channel,
          label: `Kick: ${channel}`,
          originalUrl: url,
          embedUrl: `https://player.kick.com/${channel}`,
        }
      }
    }

    // ShowUp.tv — no embeddable player, so the full room page is loaded in the
    // webview and main process isolates the <video> (see 'focus-video-player')
    if (host === 'showup.tv') {
      const channel = parsed.pathname.split('/').filter(Boolean)[0]
      if (channel) {
        return {
          platform: 'showup',
          type: 'live',
          id: channel,
          label: `ShowUp: ${channel}`,
          originalUrl: url,
          embedUrl: `https://showup.tv/${channel}`,
        }
      }
    }

    // Custom / fallback
    return {
      platform: 'custom',
      type: 'custom',
      id: url,
      label: url.replace(/^https?:\/\//, '').slice(0, 40),
      originalUrl: url,
      embedUrl: url,
    }
  } catch {
    return null
  }
}

export const PLATFORM_META = {
  twitch:  { color: '#9146ff', emoji: '●', name: 'Twitch' },
  youtube: { color: '#ff0000', emoji: '●', name: 'YouTube' },
  kick:    { color: '#53fc18', emoji: '●', name: 'Kick' },
  showup:  { color: '#ff3d7f', emoji: '●', name: 'ShowUp' },
  custom:  { color: '#6366f1', emoji: '●', name: 'Custom' },
}

export function getPlatformMeta(platform) {
  return PLATFORM_META[platform] || PLATFORM_META.custom
}

export function getMutedEmbedUrl(embedUrl, platform, muted) {
  if (!embedUrl) return embedUrl
  if (platform === 'twitch') {
    return embedUrl.includes('muted=')
      ? embedUrl.replace(/muted=(true|false)/, `muted=${muted}`)
      : embedUrl + `&muted=${muted}`
  }
  if (platform === 'youtube') {
    return embedUrl.includes('mute=')
      ? embedUrl.replace(/mute=[01]/, `mute=${muted ? 1 : 0}`)
      : embedUrl + `&mute=${muted ? 1 : 0}`
  }
  return embedUrl
}

export function getChatUrl(dock) {
  if (dock.platform === 'twitch') {
    return `https://www.twitch.tv/embed/${dock.id}/chat?parent=localhost&darkpopout`
  }
  if (dock.platform === 'kick') {
    return `https://kick.com/popout/${dock.id}/chat`
  }
  return null
}
