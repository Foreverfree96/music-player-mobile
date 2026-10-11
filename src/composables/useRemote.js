import { ref, computed } from 'vue'
import { Filesystem, Directory } from '@capacitor/filesystem'

const connected = ref(false)
const connecting = ref(false)
const connectError = ref('')
const pcIP = ref(localStorage.getItem('mp-pc-ip') || '')
const wsPort = ref(9525)
const httpPort = ref(9526)

// State from desktop
const library = ref([])
const currentTrack = ref(null)
const isPlaying = ref(false)
const progress = ref(0)
const duration = ref(0)
const volume = ref(80)
const shuffled = ref(false)
const repeatMode = ref('off')
const activeDevice = ref('pc')
const queueLength = ref(0)
const currentIndex = ref(-1)

// Local audio for phone playback
const audio = new Audio()
audio.crossOrigin = 'anonymous'

let ws = null
let reconnectTimer = null
let hasConnectedOnce = false // only auto-reconnect after a successful connection

function baseURL() {
  return `http://${pcIP.value}:${httpPort.value}`
}

function send(action, data = {}) {
  if (!ws) { console.warn('[remote] send failed: no websocket'); return }
  if (ws.readyState !== 1) { console.warn('[remote] send failed: ws state', ws.readyState); return }
  const msg = JSON.stringify({ type: 'command', action, data })
  console.log('[remote] sending:', action, data)
  ws.send(msg)
}

function connect(rawIp) {
  if (ws) { ws.close(); ws = null }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }

  // Strip port/protocol if user included them
  const ip = rawIp.replace(/^wss?:\/\//, '').replace(/:\d+$/, '').trim()

  pcIP.value = ip
  localStorage.setItem('mp-pc-ip', ip)
  connecting.value = true
  connectError.value = ''

  const wsUrl = `ws://${ip}:${wsPort.value}`
  console.log('[remote] Connecting to', wsUrl)

  try {
    ws = new WebSocket(wsUrl)
  } catch (e) {
    connecting.value = false
    connectError.value = `Connection error: ${e.message || e}`
    console.error('[remote] WebSocket constructor error:', e)
    return
  }

  // Timeout - if not connected after 8s, give up
  const connectTimeout = setTimeout(() => {
    if (!connected.value) {
      connecting.value = false
      connectError.value = 'Connection timed out. Check IP and that desktop app is running.'
      try { ws.close() } catch {}
      ws = null
    }
  }, 8000)

  ws.onopen = () => {
    clearTimeout(connectTimeout)
    connected.value = true
    connecting.value = false
    connectError.value = ''
    hasConnectedOnce = true
    console.log('[remote] Connected to desktop')
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'library') {
        library.value = msg.data
      } else if (msg.type === 'state') {
        const s = msg.data
        currentTrack.value = s.currentTrack
        isPlaying.value = s.isPlaying
        progress.value = s.progress
        duration.value = s.duration
        volume.value = s.volume
        shuffled.value = s.shuffled
        repeatMode.value = s.repeatMode
        activeDevice.value = s.activeDevice
        queueLength.value = s.queueLength || 0
        currentIndex.value = s.currentIndex ?? -1

        // If phone is active device and track changed, start streaming
        if (s.activeDevice === 'phone' && s.currentTrack) {
          const audioSrc = `${baseURL()}/audio/${s.currentTrack.id}`
          if (audio.src !== audioSrc) {
            audio.src = audioSrc
          }
          if (s.isPlaying && audio.paused) {
            audio.play().catch(() => {})
          } else if (!s.isPlaying && !audio.paused) {
            audio.pause()
          }
        } else if (s.activeDevice === 'pc' && !audio.paused) {
          audio.pause()
        }
      }
    } catch (e) { console.error('[remote] Parse error:', e) }
  }

  ws.onclose = () => {
    clearTimeout(connectTimeout)
    const wasConnected = connected.value
    connected.value = false
    connecting.value = false

    // Only auto-reconnect if we were previously connected (lost connection)
    if (wasConnected || hasConnectedOnce) {
      console.log('[remote] Disconnected, reconnecting in 3s...')
      reconnectTimer = setTimeout(() => {
        if (pcIP.value) connect(pcIP.value)
      }, 3000)
    }
  }

  ws.onerror = (e) => {
    clearTimeout(connectTimeout)
    console.error('[remote] WebSocket error:', e.message || e.type || e)
    if (!connected.value) {
      connecting.value = false
      connectError.value = `Connection failed to ${ip}. Make sure the desktop app is running and you're on the same WiFi.`
    }
  }
}

function disconnect() {
  hasConnectedOnce = false
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (ws) { ws.close(); ws = null }
  connected.value = false
  connecting.value = false
  connectError.value = ''
}

// Update local progress when phone is playing
audio.addEventListener('timeupdate', () => {
  if (activeDevice.value === 'phone') {
    progress.value = audio.currentTime
    duration.value = audio.duration || 0
  }
})

audio.addEventListener('ended', () => {
  if (activeDevice.value === 'phone') {
    send('next')
  }
})

// Search
const search = ref('')
const filteredSongs = computed(() => {
  if (!search.value) return library.value
  const q = search.value.toLowerCase()
  return library.value.filter(s =>
    s.title.toLowerCase().includes(q) ||
    s.artist.toLowerCase().includes(q) ||
    s.album.toLowerCase().includes(q)
  )
})

// Albums
const albums = computed(() => {
  const map = {}
  for (const s of library.value) {
    if (!map[s.album]) map[s.album] = { name: s.album, artist: s.artist, songs: [] }
    map[s.album].songs.push(s)
    if (map[s.album].artist !== s.artist) map[s.album].artist = 'Various Artists'
  }
  return Object.values(map).sort((a, b) => a.name.localeCompare(b.name))
})

// Artists
const artists = computed(() => {
  const map = {}
  for (const s of library.value) {
    if (!map[s.artist]) map[s.artist] = { name: s.artist, songs: [] }
    map[s.artist].songs.push(s)
  }
  return Object.values(map).sort((a, b) => a.name.localeCompare(b.name))
})

function formatTime(secs) {
  if (!secs || isNaN(secs)) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDuration(ms) {
  if (!ms) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ─── Download All ───
const downloading = ref(false)
const downloadProgress = ref(0)
const downloadTotal = ref(0)
const downloadCurrent = ref('')
const downloadCancelled = ref(false)

// Track downloaded songs in localStorage so we remember across sessions
function getDownloadedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem('mp-downloaded') || '[]'))
  } catch { return new Set() }
}

function saveDownloadedSet(set) {
  localStorage.setItem('mp-downloaded', JSON.stringify([...set]))
}

async function downloadAll() {
  if (!library.value.length || downloading.value) return
  downloading.value = true
  downloadProgress.value = 0
  downloadTotal.value = library.value.length
  downloadCancelled.value = false

  const downloaded = getDownloadedSet()

  // Create Music folder
  try {
    await Filesystem.mkdir({ path: 'Music', directory: Directory.Documents, recursive: true })
  } catch {}

  for (const song of library.value) {
    if (downloadCancelled.value) break
    downloadCurrent.value = song.title

    // Skip if already downloaded (tracked in localStorage)
    const songKey = `${song.artist}|||${song.title}|||${song.id}`
    if (downloaded.has(songKey)) {
      downloadProgress.value++
      continue
    }

    try {
      const ext = song.path ? song.path.split('.').pop() : 'mp3'
      const safeName = `${song.artist} - ${song.title}`.replace(/[<>:"/\\|?*]/g, '_')
      const fileName = `Music/${safeName}.${ext}`

      // Also check filesystem in case it exists but wasn't tracked
      try {
        await Filesystem.stat({ path: fileName, directory: Directory.Documents })
        downloaded.add(songKey)
        saveDownloadedSet(downloaded)
        downloadProgress.value++
        continue
      } catch {}

      const response = await fetch(`${baseURL()}/audio/${song.id}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()

      // Convert blob to base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result.split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })

      await Filesystem.writeFile({
        path: fileName,
        data: base64,
        directory: Directory.Documents,
      })

      // Track as downloaded
      downloaded.add(songKey)
      saveDownloadedSet(downloaded)
    } catch (e) {
      console.error(`[download] Failed: ${song.title}`, e)
    }
    downloadProgress.value++
  }

  downloading.value = false
  downloadCurrent.value = ''
}

function cancelDownload() {
  downloadCancelled.value = true
}

export function useRemote() {
  return {
    // Connection
    connected, connecting, connectError, pcIP, connect, disconnect,
    // State
    library, currentTrack, isPlaying, progress, duration,
    volume, shuffled, repeatMode, activeDevice, queueLength, currentIndex,
    // Actions
    send,
    play: () => send('toggle'),
    pause: () => send('pause'),
    togglePlayPause: () => send('toggle'),
    next: () => send('next'),
    prev: () => send('prev'),
    seek: (time) => send('seek', { time }),
    setVolume: (v) => { send('setVolume', { volume: v }); volume.value = v },
    toggleShuffle: () => send('toggleShuffle'),
    toggleRepeat: () => send('toggleRepeat'),
    playTrack: (songId) => send('playTrack', { songId }),
    transferTo: (device) => send('transfer', { device }),
    // Library
    search, filteredSongs, albums, artists,
    // Helpers
    formatTime, formatDuration,
    baseURL,
    // Download
    downloading, downloadProgress, downloadTotal, downloadCurrent,
    downloadAll, cancelDownload,
  }
}
