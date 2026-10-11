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
let hasConnectedOnce = false

// ─── Smooth progress interpolation ───
let lastServerProgress = 0
let lastServerTime = 0
let progressRAF = null

function startProgressTick() {
  if (progressRAF) return
  function tick() {
    if (isPlaying.value && activeDevice.value === 'pc') {
      const elapsed = (Date.now() - lastServerTime) / 1000
      progress.value = lastServerProgress + elapsed
      if (duration.value && progress.value > duration.value) {
        progress.value = duration.value
      }
    }
    progressRAF = requestAnimationFrame(tick)
  }
  progressRAF = requestAnimationFrame(tick)
}

function stopProgressTick() {
  if (progressRAF) {
    cancelAnimationFrame(progressRAF)
    progressRAF = null
  }
}

// ─── Volume jitter prevention ───
let volumeLocalUntil = 0 // timestamp: ignore server volume until this time

function baseURL() {
  return `http://${pcIP.value}:${httpPort.value}`
}

function send(action, data = {}) {
  if (!ws) return
  if (ws.readyState !== 1) return
  ws.send(JSON.stringify({ type: 'command', action, data }))
}

function connect(rawIp) {
  if (ws) { ws.close(); ws = null }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }

  const ip = rawIp.replace(/^wss?:\/\//, '').replace(/:\d+$/, '').trim()

  pcIP.value = ip
  localStorage.setItem('mp-pc-ip', ip)
  connecting.value = true
  connectError.value = ''

  const wsUrl = `ws://${ip}:${wsPort.value}`

  try {
    ws = new WebSocket(wsUrl)
  } catch (e) {
    connecting.value = false
    connectError.value = `Connection error: ${e.message || e}`
    return
  }

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
    startProgressTick()
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
        duration.value = s.duration
        shuffled.value = s.shuffled
        repeatMode.value = s.repeatMode
        activeDevice.value = s.activeDevice
        queueLength.value = s.queueLength || 0
        currentIndex.value = s.currentIndex ?? -1

        // Smooth progress: anchor from server, interpolate locally
        if (activeDevice.value === 'pc') {
          lastServerProgress = s.progress
          lastServerTime = Date.now()
          // Only hard-set progress if it drifted more than 2s (seek or track change)
          if (Math.abs(progress.value - s.progress) > 2) {
            progress.value = s.progress
          }
        }

        // Volume: only accept server value if user isn't actively changing it
        if (Date.now() > volumeLocalUntil) {
          volume.value = s.volume
        }

        // Phone streaming
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
    stopProgressTick()

    if (wasConnected || hasConnectedOnce) {
      reconnectTimer = setTimeout(() => {
        if (pcIP.value) connect(pcIP.value)
      }, 3000)
    }
  }

  ws.onerror = (e) => {
    clearTimeout(connectTimeout)
    if (!connected.value) {
      connecting.value = false
      connectError.value = `Connection failed to ${pcIP.value}. Make sure the desktop app is running and you're on the same WiFi.`
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
  stopProgressTick()
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

  try {
    await Filesystem.mkdir({ path: 'Music', directory: Directory.Documents, recursive: true })
  } catch {}

  for (const song of library.value) {
    if (downloadCancelled.value) break
    downloadCurrent.value = song.title

    const songKey = `${song.artist}|||${song.title}|||${song.id}`
    if (downloaded.has(songKey)) {
      downloadProgress.value++
      continue
    }

    try {
      const ext = song.path ? song.path.split('.').pop() : 'mp3'
      const safeName = `${song.artist} - ${song.title}`.replace(/[<>:"/\\|?*]/g, '_')
      const fileName = `Music/${safeName}.${ext}`

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
    seek: (time) => {
      progress.value = time // instant local update
      lastServerProgress = time
      lastServerTime = Date.now()
      send('seek', { time })
    },
    setVolume: (v) => {
      volume.value = v
      volumeLocalUntil = Date.now() + 1500 // ignore server volume for 1.5s
      send('setVolume', { volume: v })
    },
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
