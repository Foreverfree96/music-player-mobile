import { ref, computed } from 'vue'

const connected = ref(false)
const connecting = ref(false)
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
let localPlaying = false

let ws = null
let reconnectTimer = null
let progressTimer = null

function baseURL() {
  return `http://${pcIP.value}:${httpPort.value}`
}

function send(action, data = {}) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'command', action, data }))
  }
}

function connect(ip) {
  if (ws) { ws.close(); ws = null }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }

  pcIP.value = ip
  localStorage.setItem('mp-pc-ip', ip)
  connecting.value = true

  ws = new WebSocket(`ws://${ip}:${wsPort.value}`)

  ws.onopen = () => {
    connected.value = true
    connecting.value = false
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
    connected.value = false
    connecting.value = false
    console.log('[remote] Disconnected')
    // Auto-reconnect after 3s
    reconnectTimer = setTimeout(() => {
      if (pcIP.value) connect(pcIP.value)
    }, 3000)
  }

  ws.onerror = () => {
    connecting.value = false
  }
}

function disconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (ws) { ws.close(); ws = null }
  connected.value = false
  connecting.value = false
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

export function useRemote() {
  return {
    // Connection
    connected, connecting, pcIP, connect, disconnect,
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
  }
}
