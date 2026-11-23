// 本機儲存：歌曲清單、練習紀錄、設定（存在瀏覽器 localStorage）
const SONGS_KEY = 'fsp.songs.v1';
const SETTINGS_KEY = 'fsp.settings.v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

export const DEFAULT_SONG_SETTINGS = { level: 'normal', capo: 'auto', tempoPct: 60, loop: false, loopFrom: 1, loopTo: null, trainer: false, showFingers: true };

export function listSongs() {
  return read(SONGS_KEY, []);
}

export function getSong(id) {
  return listSongs().find((s) => s.id === id) || null;
}

export function saveSong(song) {
  const songs = listSongs();
  const i = songs.findIndex((s) => s.id === song.id);
  song.updatedAt = Date.now();
  if (i >= 0) songs[i] = song;
  else songs.unshift(song);
  write(SONGS_KEY, songs);
  return song;
}

export function deleteSong(id) {
  write(SONGS_KEY, listSongs().filter((s) => s.id !== id));
}

export function newId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function createSong(data, source) {
  return {
    id: newId(),
    title: data.title,
    artist: data.artist || '',
    key: data.key || '',
    bpm: data.bpm || 90,
    timeSig: data.timeSig || [4, 4],
    bars: data.bars,
    note: data.note || '',
    source,
    libId: data.id && String(data.id).startsWith('lib-') ? data.id : undefined,
    settings: { ...DEFAULT_SONG_SETTINGS, ...(data.settings || {}) },
    stats: { sessions: 0, seconds: 0, lastPlayed: null, bestTempoPct: 0 },
    createdAt: Date.now(),
  };
}

export function logPractice(id, seconds, tempoPct) {
  const song = getSong(id);
  if (!song) return;
  song.stats ||= { sessions: 0, seconds: 0, lastPlayed: null, bestTempoPct: 0 };
  song.stats.seconds += seconds;
  song.stats.lastPlayed = Date.now();
  song.stats.bestTempoPct = Math.max(song.stats.bestTempoPct || 0, tempoPct);
  saveSong(song);
}

export function countSession(id) {
  const song = getSong(id);
  if (!song) return;
  song.stats.sessions = (song.stats.sessions || 0) + 1;
  saveSong(song);
}

export function getSettings() {
  return read(SETTINGS_KEY, { apiKey: '', clickVolume: 0.6, guitarVolume: 0.9 });
}

export function saveSettings(s) {
  write(SETTINGS_KEY, s);
}

export function exportAll() {
  return JSON.stringify({ app: 'fingerstyle-practice', version: 1, exportedAt: new Date().toISOString(), songs: listSongs() }, null, 2);
}

export function importAll(text) {
  const data = JSON.parse(text);
  const incoming = Array.isArray(data) ? data : data.songs;
  if (!Array.isArray(incoming)) throw new Error('檔案格式不正確');
  const songs = listSongs();
  let added = 0;
  for (const s of incoming) {
    if (!s || !s.title || !Array.isArray(s.bars)) continue;
    const i = songs.findIndex((x) => x.id === s.id);
    if (i >= 0) songs[i] = s;
    else { songs.push(s); added++; }
  }
  write(SONGS_KEY, songs);
  return { added, total: incoming.length };
}
