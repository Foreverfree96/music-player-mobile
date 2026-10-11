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
const upNext = ref([])
const playlists = ref([])

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
let volumeLocalUntil = 0

// ─── Phone EQ (Web Audio API) ───
const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
const EQ_PRESETS = {
  'Flat':         [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Boost':   [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Treble Boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  'Rock':         [5, 4, 2, 0, -1, 0, 2, 3, 4, 4],
  'Pop':          [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
  'Jazz':         [3, 2, 0, 1, -1, -1, 0, 1, 3, 4],
  'Classical':    [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  'Electronic':   [5, 4, 2, 0, -2, 0, 1, 3, 4, 5],
  'Vocal':        [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  'Bass Cut':     [-6, -4, -2, 0, 0, 0, 0, 0, 0, 0],
}

const savedBands = JSON.parse(localStorage.getItem('mp-mobile-eq-bands') || 'null')
const savedPreset = localStorage.getItem('mp-mobile-eq-preset') || 'Flat'
const savedEnabled = localStorage.getItem('mp-mobile-eq-enabled') !== 'false'

const eqBands = ref(
  savedBands || EQ_FREQUENCIES.map((freq, i) => ({
    freq,
    gain: (EQ_PRESETS[savedPreset] || EQ_PRESETS.Flat)[i]
  }))
)
const eqPreset = ref(savedPreset)
const eqEnabled = ref(savedEnabled)

let audioContext = null
let sourceNode = null
let eqGainNode = null
let filterNodes = []
let eqInitialized = false

function initPhoneEQ() {
  if (eqInitialized) return
  eqInitialized = true

  audioContext = new (window.AudioContext || window.webkitAudioContext)()
  sourceNode = audioContext.createMediaElementSource(audio)
  eqGainNode = audioContext.createGain()

  filterNodes = EQ_FREQUENCIES.map((freq, i) => {
    const filter = audioContext.createBiquadFilter()
    filter.type = i === 0 ? 'lowshelf' : i === 9 ? 'highshelf' : 'peaking'
    filter.frequency.value = freq
    if (filter.type === 'peaking') filter.Q.value = 1.4
    filter.gain.value = eqEnabled.value ? eqBands.value[i].gain : 0
    return filter
  })

  let prev = sourceNode
  for (const filter of filterNodes) {
    prev.connect(filter)
    prev = filter
  }
  prev.connect(eqGainNode)
  eqGainNode.connect(audioContext.destination)
  audio.volume = 1
}

function saveEqState() {
  localStorage.setItem('mp-mobile-eq-bands', JSON.stringify(eqBands.value))
  localStorage.setItem('mp-mobile-eq-preset', eqPreset.value)
  localStorage.setItem('mp-mobile-eq-enabled', String(eqEnabled.value))
}

function setEqBand(index, gain) {
  eqBands.value[index].gain = gain
  if (filterNodes[index] && eqEnabled.value) {
    filterNodes[index].gain.value = gain
  }
  eqPreset.value = 'Custom'
  saveEqState()
}

function setEqPreset(name) {
  const gains = EQ_PRESETS[name]
  if (!gains) return
  eqPreset.value = name
  for (let i = 0; i < 10; i++) {
    eqBands.value[i].gain = gains[i]
    if (filterNodes[i]) {
      filterNodes[i].gain.value = eqEnabled.value ? gains[i] : 0
    }
  }
  saveEqState()
}

function toggleEq() {
  eqEnabled.value = !eqEnabled.value
  for (let i = 0; i < filterNodes.length; i++) {
    filterNodes[i].gain.value = eqEnabled.value ? eqBands.value[i].gain : 0
  }
  saveEqState()
}

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
    // Request playlists
    send('getPlaylists')
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'library') {
        library.value = msg.data
      } else if (msg.type === 'playlists') {
        playlists.value = msg.data || []
      } else if (msg.type === 'state') {
        const s = msg.data
        // Check if this is a playlists response
        if (s.type === 'playlists') {
          playlists.value = s.data || []
          return
        }
        currentTrack.value = s.currentTrack
        isPlaying.value = s.isPlaying
        duration.value = s.duration
        shuffled.value = s.shuffled
        repeatMode.value = s.repeatMode
        activeDevice.value = s.activeDevice
        queueLength.value = s.queueLength || 0
        currentIndex.value = s.currentIndex ?? -1
        upNext.value = s.upNext || []

        // Smooth progress: anchor from server, interpolate locally
        if (activeDevice.value === 'pc') {
          lastServerProgress = s.progress
          lastServerTime = Date.now()
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
          // Init EQ on first phone play
          if (!eqInitialized) initPhoneEQ()
          if (audioContext?.state === 'suspended') audioContext.resume()

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

// ─── Artist consolidation (case-insensitive) ───
function normalizeArtistName(name) {
  return name.trim().replace(/\s+/g, ' ')
}

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

// Artists (consolidated — case-insensitive grouping)
const artists = computed(() => {
  const map = {}
  for (const s of library.value) {
    const key = s.artist.toLowerCase().trim()
    if (!map[key]) map[key] = { name: normalizeArtistName(s.artist), songs: [], albumSet: new Set() }
    map[key].songs.push(s)
    map[key].albumSet.add(s.album)
    // Use the most common casing (first occurrence wins)
  }
  return Object.values(map)
    .map(a => ({ name: a.name, songs: a.songs, albumCount: a.albumSet.size }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

// Genres
const genres = computed(() => {
  const map = {}
  for (const s of library.value) {
    const key = s.genre || 'Other'
    if (!map[key]) map[key] = { name: key, songs: [], artistSet: new Set() }
    map[key].songs.push(s)
    map[key].artistSet.add(s.artist)
  }
  return Object.values(map)
    .map(g => ({ name: g.name, songs: g.songs, artistCount: g.artistSet.size }))
    .sort((a, b) => a.name.localeCompare(b.name))
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

// ─── Generate Similar ───
function generateSimilar(song) {
  const srcGenre = (song.genre || '').toLowerCase()
  const srcArtist = song.artist.toLowerCase()
  const srcAlbum = song.album.toLowerCase()
  const srcGenreParts = srcGenre.split(/[,;\/&]+/).map(g => g.trim()).filter(Boolean)

  const scored = library.value
    .filter(s => s.id !== song.id)
    .map(s => {
      let score = 0
      const genre = (s.genre || '').toLowerCase()
      const artist = s.artist.toLowerCase()
      const album = s.album.toLowerCase()

      if (genre === srcGenre && srcGenre !== 'unknown' && srcGenre !== 'other') score += 10
      else if (srcGenreParts.length > 0) {
        const genreParts = genre.split(/[,;\/&]+/).map(g => g.trim())
        for (const gp of genreParts) {
          if (srcGenreParts.includes(gp) && gp !== 'unknown') score += 5
        }
      }
      if (artist === srcArtist) score += 3
      if (album === srcAlbum && srcAlbum !== 'unknown album') score += 2
      if (song.duration && s.duration) {
        if (Math.abs(song.duration - s.duration) < 60000) score += 1
      }
      return { song: s, score, artist }
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || Math.random() - 0.5)

  const result = []
  const artistCount = {}
  for (const entry of scored) {
    const count = artistCount[entry.artist] || 0
    if (count >= 3) continue
    artistCount[entry.artist] = count + 1
    result.push(entry.song)
    if (result.length >= 30) break
  }

  // Shuffle for variety
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]]
  }

  return result
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
    upNext, playlists,
    // Actions
    send,
    play: () => send('toggle'),
    pause: () => send('pause'),
    togglePlayPause: () => send('toggle'),
    next: () => send('next'),
    prev: () => send('prev'),
    seek: (time) => {
      progress.value = time
      lastServerProgress = time
      lastServerTime = Date.now()
      send('seek', { time })
    },
    setVolume: (v) => {
      volume.value = v
      volumeLocalUntil = Date.now() + 1500
      send('setVolume', { volume: v })
    },
    toggleShuffle: () => send('toggleShuffle'),
    toggleRepeat: () => send('toggleRepeat'),
    playTrack: (songId) => send('playTrack', { songId }),
    playAll: (startIndex) => send('playAll', { startIndex }),
    playNext: (songId) => send('playNext', { songId }),
    addToQueue: (songId) => send('addToQueue', { songId }),
    transferTo: (device) => send('transfer', { device }),
    // Playlists
    getPlaylists: () => send('getPlaylists'),
    createPlaylist: (name) => send('createPlaylist', { name }),
    deletePlaylist: (playlistId) => send('deletePlaylist', { playlistId }),
    addToPlaylist: (playlistId, songId) => send('addToPlaylist', { playlistId, songId }),
    // Library views
    search, filteredSongs, albums, artists, genres,
    // Generate Similar
    generateSimilar,
    // EQ
    eqBands, eqPreset, eqEnabled, EQ_PRESETS, EQ_FREQUENCIES,
    setEqBand, setEqPreset, toggleEq,
    // Helpers
    formatTime, formatDuration,
    baseURL,
    // Download
    downloading, downloadProgress, downloadTotal, downloadCurrent,
    downloadAll, cancelDownload,
  }
}
