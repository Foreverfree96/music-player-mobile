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
            <button class="device-toggle" :class="activeDevice" @click="toggleDevice()">
              {{ activeDevice === 'pc' ? '💻 PC' : '📱 Phone' }}
            </button>
            <button class="disconnect-btn" @click="disconnect()">✕</button>
          </div>
        </template>
      </div>

      <!-- Tabs -->
      <div v-if="!detailView" class="tabs">
        <button v-for="tab in tabs" :key="tab.id" class="tab" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">
          {{ tab.label }}
        </button>
      </div>

      <!-- Search -->
      <div class="search-bar">
        <input v-model="search" type="text" :placeholder="'Search ' + activeTab + '...'" class="search-input" />
        <button v-if="search" class="clear-btn" @click="search = ''">×</button>
      </div>

      <!-- Content -->
      <div class="content-area">
        <!-- Detail View -->
        <template v-if="detailView">
          <div class="detail-actions">
            <button class="action-btn" @click="playDetailAll()">▶ Play All</button>
          </div>
          <div
            v-for="song in detailView.songs"
            :key="song.id"
            class="song-item"
            :class="{ active: currentTrack && currentTrack.id === song.id }"
            @click="playTrack(song.id)"
          >
            <div class="song-info">
              <div class="song-title">{{ song.title }}</div>
              <div class="song-artist">{{ song.artist }}</div>
            </div>
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
            @click="playTrack(song.id)"
          >
            <div class="song-info">
              <div class="song-title">{{ song.title }}</div>
              <div class="song-artist">{{ song.artist }}</div>
            </div>
            <div class="song-duration">{{ formatDuration(song.duration) }}</div>
          </div>
        </template>

        <!-- Albums Tab -->
        <template v-else-if="activeTab === 'albums'">
          <div v-if="albums.length === 0" class="empty">No albums</div>
          <div v-for="album in albums" :key="album.name" class="group-item" @click="openDetail(album.name, album.songs)">
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
          <div v-if="artists.length === 0" class="empty">No artists</div>
          <div v-for="artist in artists" :key="artist.name" class="group-item" @click="openDetail(artist.name, artist.songs)">
            <div class="group-icon">♪</div>
            <div class="group-info">
              <div class="group-name">{{ artist.name }}</div>
              <div class="group-meta">{{ artist.songs.length }} songs</div>
            </div>
            <div class="group-arrow">›</div>
          </div>
        </template>
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
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRemote } from './composables/useRemote.js'

const {
  connected, connecting, pcIP, connect, disconnect,
  library, currentTrack, isPlaying, progress, duration,
  volume, shuffled, repeatMode, activeDevice, queueLength,
  togglePlayPause, next, prev, seek, setVolume,
  toggleShuffle, toggleRepeat, playTrack, transferTo, send,
  search, filteredSongs, albums, artists,
  formatTime, formatDuration,
} = useRemote()

const ipInput = ref(pcIP.value)
const connectError = ref('')
const showPlayer = ref(false)
const activeTab = ref('songs')
const detailView = ref(null)
const tabs = [
  { id: 'songs', label: 'Songs' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
]

const progressPercent = computed(() => {
  if (!duration.value) return 0
  return (progress.value / duration.value) * 100
})

function doConnect() {
  const ip = ipInput.value.trim()
  if (!ip) return
  connectError.value = ''
  connect(ip)
  // Check after 5s if still not connected
  setTimeout(() => {
    if (!connected.value && connecting.value) {
      connectError.value = 'Could not connect. Make sure the desktop app is running and you\'re on the same WiFi.'
    }
  }, 5000)
}

function openDetail(name, songs) {
  detailView.value = { name, songs: [...songs] }
}

function playDetailAll() {
  if (detailView.value?.songs.length) {
    playTrack(detailView.value.songs[0].id)
  }
}

function toggleDevice() {
  transferTo(activeDevice.value === 'pc' ? 'phone' : 'pc')
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

/* Tabs */
.tabs {
  display: flex; padding: 0 16px; gap: 4px;
  flex-shrink: 0; background: var(--bg);
  border-bottom: 1px solid #1a1a1a;
}
.tab {
  flex: 1; padding: 10px 0; background: none; border: none;
  color: var(--text-muted); font-size: 13px; font-weight: 600;
  cursor: pointer; border-bottom: 2px solid transparent;
  transition: all 0.15s;
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
.content-area { flex: 1; overflow-y: auto; padding: 0 8px; }
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

.group-item {
  display: flex; align-items: center; padding: 12px 8px;
  border-bottom: 1px solid #111; cursor: pointer;
}
.group-item:active { background: var(--bg-card); }
.group-icon { font-size: 24px; width: 40px; text-align: center; flex-shrink: 0; }
.group-info { flex: 1; min-width: 0; }
.group-name { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.group-meta { font-size: 12px; color: var(--text-muted); }
.group-arrow { color: var(--text-muted); font-size: 18px; flex-shrink: 0; }

.detail-actions { padding: 8px; display: flex; gap: 8px; }
.action-btn {
  padding: 8px 16px; background: var(--pink); border: none;
  border-radius: 8px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
}

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
</style>
