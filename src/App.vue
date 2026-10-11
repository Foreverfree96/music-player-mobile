<template>
  <div class="app" :class="{ 'has-player': currentTrack }">
    <!-- Connection Screen -->
    <div v-if="!connected" class="connect-screen">
      <div class="connect-icon">🎵</div>
      <h1 class="connect-title">Music Remote</h1>
      <p class="connect-desc">Connect to your PC to control music playback</p>
      <div class="connect-form">
        <input
          v-model="ipInput"
          class="connect-input"
          placeholder="PC IP address (e.g. 192.168.1.5)"
          @keyup.enter="doConnect()"
          inputmode="url"
        />
        <button class="connect-btn" @click="doConnect()" :disabled="connecting || !ipInput.trim()">
          {{ connecting ? 'Connecting...' : 'Connect' }}
        </button>
      </div>
      <p v-if="connectError" class="connect-error">{{ connectError }}</p>
      <p class="connect-hint">Open your desktop music player and tap the 📱 icon to see the IP</p>
    </div>

    <!-- Main App (connected) -->
    <template v-if="connected">
      <!-- Header -->
      <div class="header">
        <div v-if="detailView" class="header-back" @click="detailView = null">
          <span class="back-arrow">←</span>
          <h1>{{ detailView.name }}</h1>
        </div>
        <template v-else>
          <h1>Music Remote</h1>
          <div class="header-right">
            <button class="download-btn" @click="downloadAll()" :disabled="downloading || !library.length" title="Download all to phone">
              ⬇
            </button>
            <button class="device-toggle" :class="activeDevice" @click="toggleDevice()">
              {{ activeDevice === 'pc' ? '💻 PC' : '📱 Phone' }}
            </button>
            <button class="disconnect-btn" @click="disconnect()">✕</button>
          </div>
        </template>
      </div>

      <!-- Tabs (scrollable) -->
      <div v-if="!detailView" class="tabs">
        <button v-for="tab in tabs" :key="tab.id" class="tab" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">
          {{ tab.label }}
        </button>
      </div>

      <!-- Search -->
      <div class="search-bar">
        <input v-model="search" type="text" :placeholder="searchPlaceholder" class="search-input" />
        <button v-if="search" class="clear-btn" @click="search = ''">×</button>
      </div>

      <!-- Content -->
      <div class="content-wrapper">
      <div class="content-area" ref="contentArea">
        <!-- Detail View -->
        <template v-if="detailView">
          <div class="detail-actions">
            <button class="action-btn" @click="playDetailAll()">▶ Play All</button>
            <button class="action-btn action-btn-outline" @click="shuffleDetail()">⇄ Shuffle</button>
          </div>
          <div
            v-for="song in detailView.songs"
            :key="song.id"
            class="song-item"
            :class="{ active: currentTrack && currentTrack.id === song.id }"
            :data-letter="song.title.charAt(0).toUpperCase()"
            @click="playTrack(song.id)"
            @contextmenu.prevent="openContextMenu($event, song)"
            @touchstart="startLongPress($event, song)"
            @touchend="cancelLongPress()"
            @touchmove="cancelLongPress()"
          >
            <div class="song-info">
              <div class="song-title">{{ song.title }}</div>
              <div class="song-artist">{{ detailView.type === 'artist' ? song.album : song.artist }}</div>
            </div>
            <button class="song-menu-btn" @click.stop="openContextMenu($event, song)">⋮</button>
            <div class="song-duration">{{ formatDuration(song.duration) }}</div>
          </div>
        </template>

        <!-- Songs Tab -->
        <template v-else-if="activeTab === 'songs'">
          <div v-if="filteredSongs.length === 0" class="empty">{{ search ? 'No matches' : 'No songs' }}</div>
          <div
            v-for="song in filteredSongs"
            :key="song.id"
            class="song-item"
            :class="{ active: currentTrack && currentTrack.id === song.id }"
            :data-letter="song.title.charAt(0).toUpperCase()"
            @click="playTrack(song.id)"
            @contextmenu.prevent="openContextMenu($event, song)"
            @touchstart="startLongPress($event, song)"
            @touchend="cancelLongPress()"
            @touchmove="cancelLongPress()"
          >
            <div class="song-info">
              <div class="song-title">{{ song.title }}</div>
              <div class="song-artist">{{ song.artist }}</div>
            </div>
            <button class="song-menu-btn" @click.stop="openContextMenu($event, song)">⋮</button>
            <div class="song-duration">{{ formatDuration(song.duration) }}</div>
          </div>
        </template>

        <!-- Albums Tab -->
        <template v-else-if="activeTab === 'albums'">
          <div v-if="filteredAlbums.length === 0" class="empty">No albums</div>
          <div v-for="album in filteredAlbums" :key="album.name" class="group-item" @click="openDetail('album', album.name, album.songs)">
            <div class="group-icon">♫</div>
            <div class="group-info">
              <div class="group-name">{{ album.name }}</div>
              <div class="group-meta">{{ album.artist }} · {{ album.songs.length }} songs</div>
            </div>
            <div class="group-arrow">›</div>
          </div>
        </template>

        <!-- Artists Tab -->
        <template v-else-if="activeTab === 'artists'">
          <div v-if="filteredArtists.length === 0" class="empty">No artists</div>
          <div v-for="artist in filteredArtists" :key="artist.name" class="group-item" @click="openDetail('artist', artist.name, artist.songs)">
            <div class="group-icon artist-icon">♪</div>
            <div class="group-info">
              <div class="group-name">{{ artist.name }}</div>
              <div class="group-meta">{{ artist.albumCount }} albums · {{ artist.songs.length }} songs</div>
            </div>
            <div class="group-arrow">›</div>
          </div>
        </template>

        <!-- Genres Tab -->
        <template v-else-if="activeTab === 'genres'">
          <div v-if="filteredGenres.length === 0" class="empty">No genres</div>
          <div v-for="genre in filteredGenres" :key="genre.name" class="group-item" @click="openDetail('genre', genre.name, genre.songs)">
            <div class="group-icon genre-icon">♬</div>
            <div class="group-info">
              <div class="group-name">{{ genre.name }}</div>
              <div class="group-meta">{{ genre.artistCount }} artists · {{ genre.songs.length }} songs</div>
            </div>
            <div class="group-arrow">›</div>
          </div>
        </template>

        <!-- Playlists Tab -->
        <template v-else-if="activeTab === 'playlists'">
          <button class="create-playlist-btn" @click="showCreatePlaylist = true">+ Create Playlist</button>
          <div v-if="playlists.length === 0" class="empty">No playlists yet</div>
          <div v-for="pl in playlists" :key="pl.id" class="group-item" @click="openPlaylist(pl)">
            <div class="group-icon playlist-icon">♪</div>
            <div class="group-info">
              <div class="group-name">{{ pl.name }}</div>
              <div class="group-meta">{{ pl.songIds.length }} songs</div>
            </div>
            <button class="del-playlist-btn" @click.stop="doDeletePlaylist(pl.id)" title="Delete">×</button>
            <div class="group-arrow">›</div>
          </div>
        </template>

        <!-- Queue Tab -->
        <template v-else-if="activeTab === 'queue'">
          <div v-if="upNext.length === 0" class="empty">No upcoming tracks</div>
          <div class="queue-header" v-if="upNext.length > 0">
            <span>Up Next ({{ upNext.length }} tracks)</span>
          </div>
          <div
            v-for="(track, i) in upNext"
            :key="track.id + '-' + i"
            class="song-item"
            :class="{ active: false }"
            @click="playTrack(track.id)"
            @contextmenu.prevent="openContextMenu($event, track)"
            @touchstart="startLongPress($event, track)"
            @touchend="cancelLongPress()"
            @touchmove="cancelLongPress()"
          >
            <div class="queue-num">{{ i + 1 }}</div>
            <div class="song-info">
              <div class="song-title">{{ track.title }}</div>
              <div class="song-artist">{{ track.artist }}</div>
            </div>
            <button class="song-menu-btn" @click.stop="openContextMenu($event, track)">⋮</button>
            <div class="song-duration">{{ formatDuration(track.duration) }}</div>
          </div>
        </template>
      </div>

      <!-- Alphabet Scroller -->
      <div
        v-if="showAlphaScroller"
        class="alpha-scroller"
        @touchstart.prevent="startAlphaScroll"
        @mousedown.prevent="startAlphaScroll"
      >
        <div
          v-for="letter in alphabetLetters"
          :key="letter"
          class="alpha-letter"
          :class="{ active: activeLetter === letter }"
          :data-letter="letter"
        >{{ letter }}</div>
      </div>

      <!-- Scope Bubble -->
      <div v-if="scopeLetter" class="scope-bubble">{{ scopeLetter }}</div>
      </div><!-- /content-wrapper -->

      <!-- Context Menu -->
      <div v-if="contextMenu" class="context-backdrop" @click="contextMenu = null"></div>
      <div v-if="contextMenu" class="context-menu" :style="contextMenuStyle">
        <div class="ctx-item" @click="ctxPlayNext()">Play Next</div>
        <div class="ctx-item" @click="ctxAddToQueue()">Add to Queue</div>
        <div class="ctx-item" @click="ctxGenerateSimilar()">Generate Similar</div>
        <div class="ctx-item" @click="ctxShowAddToPlaylist()">Add to Playlist</div>
      </div>

      <!-- Add to Playlist Modal -->
      <div v-if="showAddToPlaylistFor" class="modal-overlay" @click.self="showAddToPlaylistFor = null">
        <div class="modal">
          <div class="modal-title">Add to Playlist</div>
          <div v-if="playlists.length === 0" class="empty" style="padding:16px">No playlists — create one first</div>
          <div v-for="pl in playlists" :key="pl.id" class="modal-playlist-item" @click="doAddToPlaylist(pl.id)">
            {{ pl.name }} ({{ pl.songIds.length }})
          </div>
          <div class="modal-actions">
            <button class="modal-btn" @click="showAddToPlaylistFor = null">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Create Playlist Modal -->
      <div v-if="showCreatePlaylist" class="modal-overlay" @click.self="showCreatePlaylist = false">
        <div class="modal">
          <div class="modal-title">Create Playlist</div>
          <input v-model="newPlaylistName" class="modal-input" placeholder="Playlist name..." @keyup.enter="doCreatePlaylist()" />
          <div class="modal-actions">
            <button class="modal-btn" @click="showCreatePlaylist = false">Cancel</button>
            <button class="modal-btn modal-btn-ok" @click="doCreatePlaylist()" :disabled="!newPlaylistName.trim()">Create</button>
          </div>
        </div>
      </div>

      <!-- Now Playing Bar -->
      <div v-if="currentTrack" class="now-playing-bar" @click="showPlayer = true">
        <div class="np-bar-progress" :style="{ width: progressPercent + '%' }"></div>
        <div class="np-bar-content">
          <div class="np-bar-info">
            <div class="np-bar-title">{{ currentTrack.title }}</div>
            <div class="np-bar-artist">{{ currentTrack.artist }}</div>
          </div>
          <div class="np-bar-controls">
            <button class="ctrl-btn" @click.stop="prev()">⏮</button>
            <button class="ctrl-btn play-btn" @click.stop="togglePlayPause()">{{ isPlaying ? '⏸' : '▶' }}</button>
            <button class="ctrl-btn" @click.stop="next()">⏭</button>
          </div>
        </div>
      </div>

      <!-- Download Progress Overlay -->
      <div v-if="downloading" class="download-overlay">
        <div class="download-card">
          <div class="download-title">Downloading Songs</div>
          <div class="download-status">{{ downloadProgress }} / {{ downloadTotal }}</div>
          <div class="download-current">{{ downloadCurrent }}</div>
          <div class="download-bar-bg">
            <div class="download-bar-fill" :style="{ width: (downloadTotal ? (downloadProgress / downloadTotal) * 100 : 0) + '%' }"></div>
          </div>
          <button class="download-cancel" @click="cancelDownload()">Cancel</button>
        </div>
      </div>

      <!-- Full Player Overlay -->
      <div v-if="showPlayer && currentTrack" class="player-overlay">
        <div class="player-header">
          <button class="player-close" @click="showPlayer = false">▼</button>
          <span class="player-device">{{ activeDevice === 'pc' ? '💻 Playing on PC' : '📱 Playing on Phone' }}</span>
          <button class="player-device-btn" @click="toggleDevice()">{{ activeDevice === 'pc' ? '📱' : '💻' }}</button>
        </div>

        <div class="player-art">
          <div class="player-disc" :class="{ spinning: isPlaying }">♫</div>
        </div>

        <div class="player-track">
          <div class="player-title">{{ currentTrack.title }}</div>
          <div class="player-artist">{{ currentTrack.artist }}</div>
          <div class="player-album">{{ currentTrack.album }}</div>
        </div>

        <div class="player-seek">
          <input type="range" class="seek-bar" min="0" :max="duration || 0" :value="progress" @input="seek(Number($event.target.value))" />
          <div class="player-times">
            <span>{{ formatTime(progress) }}</span>
            <span>{{ formatTime(duration) }}</span>
          </div>
        </div>

        <div class="player-controls">
          <button class="mode-btn" :class="{ active: shuffled }" @click="toggleShuffle()">⇄</button>
          <button class="ctrl-lg" @click="prev()">⏮</button>
          <button class="ctrl-lg play-lg" @click="togglePlayPause()">{{ isPlaying ? '⏸' : '▶' }}</button>
          <button class="ctrl-lg" @click="next()">⏭</button>
          <button class="mode-btn" :class="{ active: repeatMode !== 'off' }" @click="toggleRepeat()">
            {{ repeatMode === 'one' ? '🔂' : '🔁' }}
          </button>
        </div>

        <div class="player-volume">
          <span class="vol-icon">{{ volume == 0 ? '🔇' : volume < 40 ? '🔉' : '🔊' }}</span>
          <input type="range" class="vol-bar" min="0" max="100" :value="volume" @input="setVolume(Number($event.target.value))" />
          <span class="vol-pct">{{ Math.round(volume) }}%</span>
        </div>

        <!-- Equalizer -->
        <div class="eq-header" @click="showEq = !showEq">
          <span>Equalizer</span>
          <div class="eq-header-right">
            <button class="eq-toggle" :class="{ active: eqEnabled }" @click.stop="toggleEq()">
              {{ eqEnabled ? 'ON' : 'OFF' }}
            </button>
            <span class="eq-chevron">{{ showEq ? '▲' : '▼' }}</span>
          </div>
        </div>
        <div v-if="showEq" class="eq-panel">
          <div class="eq-preset-row">
            <select class="eq-preset-select" :value="eqPreset" @change="setEqPreset($event.target.value)">
              <option v-for="name in eqPresetNames" :key="name" :value="name">{{ name }}</option>
              <option v-if="eqPreset === 'Custom'" value="Custom">Custom</option>
            </select>
          </div>
          <div class="eq-bands">
            <div class="eq-db-labels">
              <span>+12</span>
              <span>0</span>
              <span>-12</span>
            </div>
            <div v-for="(band, i) in eqBands" :key="band.freq" class="eq-band">
              <input
                type="range"
                class="eq-slider"
                min="-12"
                max="12"
                step="0.5"
                :value="band.gain"
                @input="setEqBand(i, Number($event.target.value))"
                orient="vertical"
              />
              <span class="eq-freq-label">{{ formatFreq(band.freq) }}</span>
            </div>
          </div>
        </div>

        <!-- Up Next in Player -->
        <div class="queue-section-header" @click="showPlayerQueue = !showPlayerQueue">
          <span>Up Next ({{ upNext.length }})</span>
          <span class="eq-chevron">{{ showPlayerQueue ? '▲' : '▼' }}</span>
        </div>
        <div v-if="showPlayerQueue" class="player-queue">
          <div
            v-for="(track, i) in upNext"
            :key="track.id + '-q-' + i"
            class="pq-item"
            @click="playTrack(track.id)"
            @contextmenu.prevent="openContextMenu($event, track)"
            @touchstart="startLongPress($event, track)"
            @touchend="cancelLongPress()"
            @touchmove="cancelLongPress()"
          >
            <span class="pq-title">{{ track.title }}</span>
            <span class="pq-artist">{{ track.artist }}</span>
            <button class="song-menu-btn pq-menu" @click.stop="openContextMenu($event, track)">⋮</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRemote } from './composables/useRemote.js'

const {
  connected, connecting, connectError, pcIP, connect, disconnect,
  library, currentTrack, isPlaying, progress, duration,
  volume, shuffled, repeatMode, activeDevice, queueLength, currentIndex,
  upNext, playlists,
  togglePlayPause, next, prev, seek, setVolume,
  toggleShuffle, toggleRepeat, playTrack, transferTo, send,
  playNext, addToQueue, playAll,
  getPlaylists, createPlaylist, deletePlaylist, addToPlaylist,
  search, filteredSongs, albums, artists, genres,
  generateSimilar,
  eqBands, eqPreset, eqEnabled, EQ_PRESETS, EQ_FREQUENCIES,
  setEqBand, setEqPreset, toggleEq,
  formatTime, formatDuration,
  downloading, downloadProgress, downloadTotal, downloadCurrent,
  downloadAll, cancelDownload,
} = useRemote()

const ipInput = ref(pcIP.value)
const showPlayer = ref(false)
const showEq = ref(false)
const showPlayerQueue = ref(false)
const activeTab = ref('songs')
const detailView = ref(null)
const eqPresetNames = Object.keys(EQ_PRESETS)

const tabs = [
  { id: 'songs', label: 'Songs' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'genres', label: 'Genres' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'queue', label: 'Queue' },
]

// Context menu
const contextMenu = ref(null) // { song, x, y }
const showAddToPlaylistFor = ref(null) // song id
const showCreatePlaylist = ref(false)
const newPlaylistName = ref('')
let longPressTimer = null

// Alphabet scroller
const contentArea = ref(null)
const alphabetLetters = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const scopeLetter = ref(null)
const activeLetter = ref(null)
let alphaScrolling = false

const showAlphaScroller = computed(() => {
  if (detailView.value) return detailView.value.songs.length > 20
  return (activeTab.value === 'songs' && filteredSongs.value.length > 20)
})

// Filtered views
const filteredAlbums = computed(() => {
  if (!search.value) return albums.value
  const q = search.value.toLowerCase()
  return albums.value.filter(a => a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))
})

const filteredArtists = computed(() => {
  if (!search.value) return artists.value
  const q = search.value.toLowerCase()
  return artists.value.filter(a => a.name.toLowerCase().includes(q))
})

const filteredGenres = computed(() => {
  if (!search.value) return genres.value
  const q = search.value.toLowerCase()
  return genres.value.filter(g => g.name.toLowerCase().includes(q))
})

const searchPlaceholder = computed(() => {
  if (detailView.value) return 'Search in ' + detailView.value.name + '...'
  const labels = { songs: 'songs', albums: 'albums', artists: 'artists', genres: 'genres', playlists: 'playlists', queue: 'queue' }
  return 'Search ' + (labels[activeTab.value] || 'songs') + '...'
})

// Auto-connect if we have a saved IP
onMounted(() => {
  if (ipInput.value.trim()) doConnect()
})

const progressPercent = computed(() => {
  if (!duration.value) return 0
  return (progress.value / duration.value) * 100
})

const contextMenuStyle = computed(() => {
  if (!contextMenu.value) return {}
  return {
    top: Math.min(contextMenu.value.y, window.innerHeight - 200) + 'px',
    left: Math.min(contextMenu.value.x, window.innerWidth - 180) + 'px',
  }
})

function formatFreq(f) {
  return f >= 1000 ? (f / 1000) + 'k' : String(f)
}

function doConnect() {
  const ip = ipInput.value.trim()
  if (!ip) return
  connect(ip)
}

function openDetail(type, name, songs) {
  detailView.value = { type, name, songs: [...songs] }
  search.value = ''
}

function openPlaylist(pl) {
  const songMap = new Map(library.value.map(s => [s.id, s]))
  const songs = pl.songIds.map(id => songMap.get(id)).filter(Boolean)
  openDetail('playlist', pl.name, songs)
}

function playDetailAll() {
  if (detailView.value?.songs.length) {
    playTrack(detailView.value.songs[0].id)
  }
}

function shuffleDetail() {
  if (!detailView.value?.songs.length) return
  const songs = [...detailView.value.songs]
  for (let i = songs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [songs[i], songs[j]] = [songs[j], songs[i]]
  }
  playTrack(songs[0].id)
}

function toggleDevice() {
  transferTo(activeDevice.value === 'pc' ? 'phone' : 'pc')
}

// ─── Long-press context menu ───
function startLongPress(e, song) {
  cancelLongPress()
  longPressTimer = setTimeout(() => {
    const touch = e.touches ? e.touches[0] : e
    openContextMenu({ clientX: touch.clientX, clientY: touch.clientY }, song)
  }, 500)
}

function cancelLongPress() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
}

function openContextMenu(event, song) {
  contextMenu.value = {
    song,
    x: event.clientX,
    y: event.clientY,
  }
}

function ctxPlayNext() {
  if (contextMenu.value) {
    playNext(contextMenu.value.song.id)
    contextMenu.value = null
  }
}

function ctxAddToQueue() {
  if (contextMenu.value) {
    addToQueue(contextMenu.value.song.id)
    contextMenu.value = null
  }
}

function ctxGenerateSimilar() {
  if (!contextMenu.value) return
  const song = contextMenu.value.song
  contextMenu.value = null
  const similar = generateSimilar(song)
  if (similar.length > 0) {
    // Play the source song, then queue similar tracks
    playTrack(song.id)
    for (const s of similar) {
      addToQueue(s.id)
    }
  } else {
    playTrack(song.id)
  }
}

function ctxShowAddToPlaylist() {
  if (contextMenu.value) {
    showAddToPlaylistFor.value = contextMenu.value.song.id
    contextMenu.value = null
  }
}

function doAddToPlaylist(playlistId) {
  if (showAddToPlaylistFor.value) {
    addToPlaylist(playlistId, showAddToPlaylistFor.value)
    showAddToPlaylistFor.value = null
  }
}

function doCreatePlaylist() {
  const name = newPlaylistName.value.trim()
  if (!name) return
  createPlaylist(name)
  newPlaylistName.value = ''
  showCreatePlaylist.value = false
}

function doDeletePlaylist(id) {
  deletePlaylist(id)
}

// ─── Alphabet scroller ───
function scrollToLetter(letter) {
  if (!contentArea.value) return
  const selector = letter === '#'
    ? '.song-item[data-letter]:not([data-letter="A"]):not([data-letter="B"]):not([data-letter="C"]):not([data-letter="D"]):not([data-letter="E"]):not([data-letter="F"]):not([data-letter="G"]):not([data-letter="H"]):not([data-letter="I"]):not([data-letter="J"]):not([data-letter="K"]):not([data-letter="L"]):not([data-letter="M"]):not([data-letter="N"]):not([data-letter="O"]):not([data-letter="P"]):not([data-letter="Q"]):not([data-letter="R"]):not([data-letter="S"]):not([data-letter="T"]):not([data-letter="U"]):not([data-letter="V"]):not([data-letter="W"]):not([data-letter="X"]):not([data-letter="Y"]):not([data-letter="Z"])'
    : `.song-item[data-letter="${letter}"]`
  const el = contentArea.value.querySelector(selector)
  if (el) el.scrollIntoView({ block: 'start', behavior: 'auto' })
}

function getLetterFromEvent(e) {
  const touch = e.touches ? e.touches[0] : e
  const el = document.elementFromPoint(touch.clientX, touch.clientY)
  return el?.dataset?.letter || null
}

function startAlphaScroll(e) {
  alphaScrolling = true
  handleAlphaMove(e)
  document.addEventListener('mousemove', handleAlphaMove)
  document.addEventListener('mouseup', stopAlphaScroll)
  document.addEventListener('touchmove', handleAlphaMove, { passive: false })
  document.addEventListener('touchend', stopAlphaScroll)
}

function handleAlphaMove(e) {
  if (!alphaScrolling) return
  if (e.cancelable) e.preventDefault()
  const letter = getLetterFromEvent(e)
  if (letter && letter !== activeLetter.value) {
    activeLetter.value = letter
    scopeLetter.value = letter
    scrollToLetter(letter)
  }
}

function stopAlphaScroll() {
  alphaScrolling = false
  activeLetter.value = null
  setTimeout(() => { scopeLetter.value = null }, 400)
  document.removeEventListener('mousemove', handleAlphaMove)
  document.removeEventListener('mouseup', stopAlphaScroll)
  document.removeEventListener('touchmove', handleAlphaMove)
  document.removeEventListener('touchend', stopAlphaScroll)
}
</script>

<style>
:root {
  --bg: #0a0a0a;
  --bg-light: #141414;
  --bg-card: #1a1a1a;
  --pink: #ff1493;
  --pink-dim: rgba(255, 20, 147, 0.3);
  --text: #e5e5e5;
  --text-muted: #888;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
button { font-family: inherit; }

.app {
  height: 100vh; height: 100dvh;
  display: flex; flex-direction: column;
  background: var(--bg); color: var(--text);
  user-select: none;
  overflow: hidden;
}
.app.has-player { padding-bottom: 60px; }

/* Connection Screen */
.connect-screen {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 30px;
}
.connect-icon { font-size: 64px; margin-bottom: 16px; }
.connect-title { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
.connect-desc { color: var(--text-muted); font-size: 14px; margin-bottom: 30px; text-align: center; }
.connect-form { width: 100%; max-width: 320px; display: flex; flex-direction: column; gap: 12px; }
.connect-input {
  width: 100%; padding: 14px 16px; background: var(--bg-card);
  border: 1px solid #333; border-radius: 12px; color: var(--text);
  font-size: 16px; outline: none; text-align: center;
}
.connect-input:focus { border-color: var(--pink); }
.connect-btn {
  padding: 14px; background: var(--pink); border: none;
  border-radius: 12px; color: #fff; font-size: 16px; font-weight: 600;
  cursor: pointer;
}
.connect-btn:disabled { opacity: 0.5; }
.connect-error { color: #f44; font-size: 13px; margin-top: 12px; text-align: center; }
.connect-hint { color: #555; font-size: 12px; margin-top: 20px; text-align: center; }

/* Header */
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; flex-shrink: 0;
  background: var(--bg-light);
  padding-top: max(12px, env(safe-area-inset-top));
}
.header h1 { font-size: 18px; font-weight: 700; }
.header-right { display: flex; align-items: center; gap: 10px; }
.header-back { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.back-arrow { font-size: 20px; color: var(--pink); }
.disconnect-btn {
  width: 28px; height: 28px; border-radius: 50%;
  background: #333; border: none; color: var(--text-muted);
  font-size: 14px; cursor: pointer;
}
.device-toggle {
  padding: 4px 10px; border-radius: 16px; font-size: 12px;
  border: 1px solid var(--pink); background: rgba(255,20,147,0.1);
  color: var(--pink); cursor: pointer;
}

/* Tabs (scrollable) */
.tabs {
  display: flex; padding: 0 8px; gap: 2px;
  flex-shrink: 0; background: var(--bg);
  border-bottom: 1px solid #1a1a1a;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.tabs::-webkit-scrollbar { display: none; }
.tab {
  padding: 10px 8px; background: none; border: none;
  color: var(--text-muted); font-size: 12px; font-weight: 600;
  cursor: pointer; border-bottom: 2px solid transparent;
  transition: all 0.15s;
  white-space: nowrap; flex-shrink: 0;
}
.tab.active { color: var(--pink); border-bottom-color: var(--pink); }

/* Search */
.search-bar { padding: 8px 16px; flex-shrink: 0; position: relative; }
.search-input {
  width: 100%; padding: 10px 36px 10px 14px;
  background: var(--bg-card); border: 1px solid #333;
  border-radius: 10px; color: var(--text); font-size: 14px; outline: none;
}
.search-input:focus { border-color: var(--pink); }
.search-input::placeholder { color: #555; }
.clear-btn {
  position: absolute; right: 24px; top: 50%;
  transform: translateY(-50%); background: none;
  border: none; color: var(--text-muted); font-size: 18px; cursor: pointer;
}

/* Content */
.content-wrapper { flex: 1; position: relative; overflow: hidden; }
.content-area { height: 100%; overflow-y: auto; padding: 0 8px; }
.content-area::-webkit-scrollbar { width: 3px; }
.content-area::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
.empty { text-align: center; color: var(--text-muted); padding: 40px 16px; font-size: 14px; }

.song-item {
  display: flex; align-items: center; padding: 10px 8px;
  border-bottom: 1px solid #111; cursor: pointer;
  border-radius: 6px; transition: background 0.15s;
}
.song-item:active { background: var(--bg-card); }
.song-item.active { background: var(--pink-dim); }
.song-item.active .song-title { color: var(--pink); }
.song-info { flex: 1; min-width: 0; }
.song-title { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.song-artist { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.song-duration { font-size: 12px; color: var(--text-muted); margin-left: 8px; flex-shrink: 0; }
.song-menu-btn {
  width: 28px; height: 28px; border: none; background: none;
  color: var(--text-muted); font-size: 18px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.queue-num {
  width: 24px; text-align: center; color: var(--text-muted);
  font-size: 12px; flex-shrink: 0; margin-right: 4px;
}
.queue-header {
  padding: 8px; color: var(--text-muted); font-size: 13px; font-weight: 600;
}

.group-item {
  display: flex; align-items: center; padding: 12px 8px;
  border-bottom: 1px solid #111; cursor: pointer;
}
.group-item:active { background: var(--bg-card); }
.group-icon {
  font-size: 24px; width: 40px; height: 40px; text-align: center;
  line-height: 40px; flex-shrink: 0; border-radius: 8px;
  background: linear-gradient(135deg, #222, #333);
}
.group-icon.artist-icon { border-radius: 50%; }
.group-icon.genre-icon { background: linear-gradient(135deg, #2a1a30, #3a2040); }
.group-icon.playlist-icon { background: linear-gradient(135deg, #1a2a30, #203a40); }
.group-info { flex: 1; min-width: 0; margin-left: 10px; }
.group-name { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.group-meta { font-size: 12px; color: var(--text-muted); }
.group-arrow { color: var(--text-muted); font-size: 18px; flex-shrink: 0; margin-left: 4px; }

.detail-actions { padding: 8px; display: flex; gap: 8px; }
.action-btn {
  padding: 8px 16px; background: var(--pink); border: none;
  border-radius: 8px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
}
.action-btn-outline {
  background: none; border: 1px solid var(--pink); color: var(--pink);
}

.create-playlist-btn {
  display: block; width: calc(100% - 16px); margin: 8px;
  padding: 12px; background: none; border: 2px dashed #333;
  border-radius: 10px; color: var(--text-muted); font-size: 14px;
  font-weight: 600; cursor: pointer; text-align: center;
}
.del-playlist-btn {
  width: 24px; height: 24px; border-radius: 50%;
  background: rgba(255,50,50,0.2); border: none;
  color: #f55; font-size: 14px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}

/* Alphabet Scroller */
.alpha-scroller {
  position: absolute; right: 2px; top: 0; bottom: 0;
  display: flex; flex-direction: column; justify-content: center;
  z-index: 10; padding: 4px 0;
}
.alpha-letter {
  font-size: 9px; color: var(--text-muted); text-align: center;
  padding: 1px 4px; cursor: pointer;
}
.alpha-letter.active { color: var(--pink); font-weight: 700; }
.scope-bubble {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 72px; height: 72px; border-radius: 50%;
  background: var(--pink); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 32px; font-weight: 700; z-index: 20;
  animation: scopeIn 0.15s ease-out;
}
@keyframes scopeIn { from { transform: translate(-50%,-50%) scale(0.5); opacity: 0; } }

/* Context Menu */
.context-backdrop {
  position: fixed; inset: 0; z-index: 140; background: rgba(0,0,0,0.4);
}
.context-menu {
  position: fixed; z-index: 150;
  background: #222; border-radius: 12px;
  overflow: hidden; min-width: 180px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
}
.ctx-item {
  padding: 14px 18px; font-size: 14px; cursor: pointer;
  border-bottom: 1px solid #333;
}
.ctx-item:last-child { border-bottom: none; }
.ctx-item:active { background: #333; }

/* Modals */
.modal-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.85);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.modal {
  background: var(--bg-card); border-radius: 16px;
  padding: 24px; width: 100%; max-width: 320px;
}
.modal-title { font-size: 18px; font-weight: 700; margin-bottom: 16px; text-align: center; }
.modal-input {
  width: 100%; padding: 12px 14px; background: #111;
  border: 1px solid #333; border-radius: 10px;
  color: var(--text); font-size: 14px; outline: none;
  margin-bottom: 16px;
}
.modal-input:focus { border-color: var(--pink); }
.modal-actions { display: flex; gap: 8px; justify-content: center; }
.modal-btn {
  padding: 10px 20px; background: #333; border: none;
  border-radius: 10px; color: var(--text); font-size: 14px;
  font-weight: 600; cursor: pointer;
}
.modal-btn-ok { background: var(--pink); color: #fff; }
.modal-btn-ok:disabled { opacity: 0.4; }
.modal-playlist-item {
  padding: 12px 16px; border-bottom: 1px solid #333;
  cursor: pointer; font-size: 14px;
}
.modal-playlist-item:active { background: #333; }

/* Now Playing Bar */
.now-playing-bar {
  position: fixed; bottom: 0; left: 0; right: 0;
  height: 60px; background: #111;
  border-top: 1px solid #222; cursor: pointer;
  z-index: 50;
}
.np-bar-progress {
  position: absolute; top: 0; left: 0; height: 2px;
  background: var(--pink); transition: width 0.3s linear;
}
.np-bar-content {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; height: 100%;
}
.np-bar-info { flex: 1; min-width: 0; }
.np-bar-title { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.np-bar-artist { font-size: 12px; color: var(--text-muted); }
.np-bar-controls { display: flex; align-items: center; gap: 4px; }
.ctrl-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: none; border: none; color: var(--text);
  font-size: 16px; cursor: pointer; display: flex;
  align-items: center; justify-content: center;
}
.play-btn { font-size: 20px; }

/* Player Overlay */
.player-overlay {
  position: fixed; inset: 0;
  background: var(--bg); z-index: 100;
  display: flex; flex-direction: column;
  padding: 16px; padding-top: max(16px, env(safe-area-inset-top));
  overflow-y: auto;
}
.player-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 24px;
}
.player-close {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--bg-card); border: none; color: var(--text);
  font-size: 14px; cursor: pointer;
}
.player-device { font-size: 12px; color: var(--text-muted); }
.player-device-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--bg-card); border: none; font-size: 16px; cursor: pointer;
}

.player-art {
  display: flex; justify-content: center;
  margin-bottom: 28px;
}
.player-disc {
  width: 200px; height: 200px; border-radius: 50%;
  background: linear-gradient(135deg, #1a1a1a 0%, #333 100%);
  border: 3px solid #333; display: flex;
  align-items: center; justify-content: center;
  font-size: 60px; color: var(--pink);
}
.player-disc.spinning { animation: spin 3s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.player-track { text-align: center; margin-bottom: 24px; }
.player-title { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.player-artist { font-size: 14px; color: var(--text-muted); margin-bottom: 2px; }
.player-album { font-size: 13px; color: #555; }

.player-seek { padding: 0 8px; margin-bottom: 20px; }
.seek-bar {
  width: 100%; height: 4px; -webkit-appearance: none;
  background: #333; border-radius: 2px; outline: none;
}
.seek-bar::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px;
  border-radius: 50%; background: var(--pink); cursor: pointer;
}
.player-times {
  display: flex; justify-content: space-between;
  font-size: 11px; color: var(--text-muted); margin-top: 4px;
}

.player-controls {
  display: flex; align-items: center; justify-content: center;
  gap: 20px; margin-bottom: 24px;
}
.mode-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: none; border: none; color: var(--text-muted);
  font-size: 18px; cursor: pointer;
}
.mode-btn.active { color: var(--pink); }
.ctrl-lg {
  width: 48px; height: 48px; border-radius: 50%;
  background: none; border: none; color: var(--text);
  font-size: 24px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.play-lg {
  width: 60px; height: 60px; font-size: 28px;
  background: var(--pink); border-radius: 50%;
  color: #fff;
}

.player-volume {
  display: flex; align-items: center; gap: 10px; padding: 0 16px;
  margin-bottom: 16px;
}
.vol-icon { font-size: 18px; cursor: pointer; }
.vol-bar {
  flex: 1; height: 4px; -webkit-appearance: none;
  background: #333; border-radius: 2px; outline: none;
}
.vol-bar::-webkit-slider-thumb {
  -webkit-appearance: none; width: 12px; height: 12px;
  border-radius: 50%; background: var(--pink); cursor: pointer;
}
.vol-pct { font-size: 12px; color: var(--text-muted); width: 32px; text-align: right; }

/* Equalizer */
.eq-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; cursor: pointer; border-top: 1px solid #222;
  margin-top: 8px;
}
.eq-header-right { display: flex; align-items: center; gap: 10px; }
.eq-toggle {
  padding: 4px 10px; border-radius: 12px; font-size: 11px;
  font-weight: 700; cursor: pointer; border: 1px solid #444;
  background: #222; color: var(--text-muted);
}
.eq-toggle.active { background: var(--pink); border-color: var(--pink); color: #fff; }
.eq-chevron { font-size: 10px; color: var(--text-muted); }

.eq-panel { padding: 8px 12px 16px; }
.eq-preset-row { margin-bottom: 12px; }
.eq-preset-select {
  width: 100%; padding: 8px 12px; background: #222;
  border: 1px solid #444; border-radius: 8px;
  color: var(--text); font-size: 13px; outline: none;
}
.eq-bands {
  display: flex; gap: 4px; align-items: flex-end;
  justify-content: center;
}
.eq-db-labels {
  display: flex; flex-direction: column;
  justify-content: space-between; height: 100px;
  font-size: 9px; color: var(--text-muted); margin-right: 4px;
}
.eq-band { display: flex; flex-direction: column; align-items: center; }
.eq-slider {
  -webkit-appearance: slider-vertical;
  width: 20px; height: 100px;
  background: transparent; outline: none;
}
.eq-slider::-webkit-slider-thumb {
  -webkit-appearance: none; width: 10px; height: 10px;
  border-radius: 50%; background: var(--pink); cursor: pointer;
}
.eq-freq-label { font-size: 8px; color: var(--text-muted); margin-top: 4px; }

/* Queue in Player */
.queue-section-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; cursor: pointer; border-top: 1px solid #222;
  margin-top: 4px;
}
.player-queue { padding: 0 12px 16px; }
.pq-item {
  display: flex; justify-content: space-between;
  padding: 8px 4px; border-bottom: 1px solid #111;
  font-size: 13px;
}
.pq-item { cursor: pointer; }
.pq-item:active { background: var(--bg-card); }
.pq-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pq-artist { color: var(--text-muted); font-size: 12px; margin-left: 8px; flex-shrink: 0; }
.pq-menu { width: 24px; height: 24px; font-size: 16px; margin-left: 4px; }

/* Download Button */
.download-btn {
  width: 32px; height: 32px; border-radius: 50%;
  background: rgba(255,20,147,0.15); border: 1px solid var(--pink);
  color: var(--pink); font-size: 14px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.download-btn:disabled { opacity: 0.4; }

/* Download Overlay */
.download-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.85);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.download-card {
  background: var(--bg-card); border-radius: 16px;
  padding: 28px 24px; width: 100%; max-width: 340px;
  text-align: center;
}
.download-title { font-size: 18px; font-weight: 700; margin-bottom: 12px; }
.download-status { font-size: 24px; font-weight: 700; color: var(--pink); margin-bottom: 6px; }
.download-current {
  font-size: 13px; color: var(--text-muted); margin-bottom: 16px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.download-bar-bg {
  height: 6px; background: #333; border-radius: 3px;
  overflow: hidden; margin-bottom: 20px;
}
.download-bar-fill {
  height: 100%; background: var(--pink); border-radius: 3px;
  transition: width 0.3s ease;
}
.download-cancel {
  padding: 10px 28px; background: #333; border: none;
  border-radius: 10px; color: var(--text); font-size: 14px;
  font-weight: 600; cursor: pointer;
}
</style>
