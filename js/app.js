import { LIBRARY, findInLibrary, normalizeTitle } from './songs.js';
import { arrange, LEVELS, capoHint, parseSong } from './arranger.js';
import { parseChord, noteToMidi } from './theory.js';
import { Player } from './audio.js';
import { TabView, Fretboard, chordDiagram } from './render.js';
import * as store from './store.js';

const $ = (s) => document.querySelector(s);
const player = new Player();
let settings = store.getSettings();
let current = null; // { song, arr }
let practice = { last: null, acc: 0 };
let metro = { bpm: 80, beats: 4 };
let saveTimer = null;

const tabView = new TabView($('#tab'), { onBarClick: (b) => seekBar(b) });
const fretboard = new Fretboard($('#fretboard'));

player.setGuitarVolume(settings.guitarVolume ?? 0.9);
player.setClickVolume(settings.clickVolume ?? 0.6);
$('#metro-vol').value = settings.clickVolume ?? 0.6;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function starsHtml(stars) {
  return `<span class="stars" title="${stars} / 5"><span class="fill" style="width:${(stars / 5) * 100}%"></span></span>`;
}

function fmtMinutes(sec) {
  if (!sec) return '0 分鐘';
  const m = Math.round(sec / 60);
  return m < 60 ? `${Math.max(1, m)} 分鐘` : `${(m / 60).toFixed(1)} 小時`;
}

function fmtAgo(ts) {
  if (!ts) return '';
  const d = (Date.now() - ts) / 1000;
  if (d < 3600) return '剛剛練過';
  if (d < 86400) return `${Math.floor(d / 3600)} 小時前練過`;
  return `${Math.floor(d / 86400)} 天前練過`;
}

// ---------------- 路由 ----------------
function route() {
  const m = /^#\/song\/(.+)$/.exec(location.hash);
  if (m) showSong(decodeURIComponent(m[1]));
  else showHome();
}
window.addEventListener('hashchange', route);

function leaveSong() {
  if (!current) return;
  flushPractice();
  player.halt();
  current = null;
  document.body.classList.remove('song-mode');
  $('#controls').hidden = true;
  player.bpm = metro.bpm;
  player.beatsPerBar = metro.beats;
  if (player.metronomeOn) player.startMetronomeOnly();
  syncMetroPanel();
}

// ---------------- 首頁 ----------------
function showHome() {
  leaveSong();
  $('#view-home').hidden = false;
  $('#view-song').hidden = true;
  document.title = '指彈練習室';
  renderLibChips();
  renderMySongs();
}

function renderLibChips() {
  const box = $('#lib-chips');
  box.innerHTML = '';
  for (const lib of LIBRARY) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = lib.title;
    b.addEventListener('click', () => addFromLibrary(lib));
    box.appendChild(b);
  }
}

function renderMySongs() {
  const box = $('#my-songs');
  const songs = store.listSongs();
  if (!songs.length) {
    box.innerHTML = '<div class="empty">還沒有歌曲。<br>在上面輸入歌名，或點一首內建曲目開始練習吧！</div>';
    return;
  }
  songs.sort((a, b) => (b.stats?.lastPlayed || b.createdAt) - (a.stats?.lastPlayed || a.createdAt));
  box.innerHTML = '';
  for (const s of songs) {
    let diff = null;
    try { diff = arrange(s, { level: s.settings?.level, capo: s.settings?.capo }).difficulty; } catch (e) { /* 資料有誤 */ }
    const st = s.stats || {};
    const card = document.createElement('button');
    card.className = 'song-card';
    card.type = 'button';
    const src = { library: '內建', ai: 'AI 和弦', manual: '手動' }[s.source] || '';
    card.innerHTML = `
      <h3>${esc(s.title)}</h3>
      <div class="artist">${esc(s.artist || '')}</div>
      <div class="row">
        <span>${diff ? starsHtml(diff.stars) + ` <small>${diff.label}</small>` : ''}</span>
        <span class="badge">${src} · ${LEVELS[s.settings?.level || 'normal'].label}</span>
      </div>
      <div class="stats">練習 ${st.sessions || 0} 次 · ${fmtMinutes(st.seconds)}${st.bestTempoPct ? ` · 最快 ${st.bestTempoPct}%` : ''}${st.lastPlayed ? ' · ' + fmtAgo(st.lastPlayed) : ''}</div>`;
    card.addEventListener('click', () => { location.hash = `#/song/${encodeURIComponent(s.id)}`; });
    box.appendChild(card);
  }
}

function openSong(song) {
  location.hash = `#/song/${encodeURIComponent(song.id)}`;
}

function addFromLibrary(lib) {
  const existing = store.listSongs().find((s) => s.libId === lib.id);
  if (existing) return openSong(existing);
  const song = store.createSong(lib, 'library');
  song.note = lib.note || '';
  store.saveSong(song);
  toast(`已加入「${lib.title}」`);
  openSong(song);
}

function setStatus(html, isError) {
  const el = $('#search-status');
  el.innerHTML = html;
  el.classList.toggle('error', !!isError);
}

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  setStatus('');
  // 1. 我的歌曲
  const mine = store.listSongs().find((s) => normalizeTitle(s.title) === normalizeTitle(q));
  if (mine) return openSong(mine);
  // 2. 內建曲庫
  const lib = findInLibrary(q);
  if (lib) return addFromLibrary(lib);
  // 3. AI
  if (settings.apiKey) {
    const btn = $('#search-form button');
    btn.disabled = true;
    setStatus(`<span class="spinner"></span>正在請 AI 查「${esc(q)}」的和弦並編成指彈譜…（約 10~40 秒）`);
    try {
      const data = await store_ai(q);
      const song = store.createSong(data, 'ai');
      store.saveSong(song);
      setStatus('');
      $('#q').value = '';
      openSong(song);
    } catch (err) {
      setStatus(`${esc(err.message)} <button class="chip" type="button" id="st-manual">改用手動輸入</button>`, true);
      $('#st-manual')?.addEventListener('click', () => openEditor(null, q));
    } finally {
      btn.disabled = false;
    }
    return;
  }
  // 4. 沒有金鑰
  $('#nf-msg').textContent = `「${q}」不在內建曲庫裡，你可以：`;
  const dlg = $('#dlg-notfound');
  dlg.returnValue = '';
  dlg.showModal();
  dlg.onclose = () => {
    if (dlg.returnValue === 'manual') openEditor(null, q);
    if (dlg.returnValue === 'key') openSettings();
  };
});

async function store_ai(q) {
  const { lookupSongWithAI } = await import('./ai.js');
  return lookupSongWithAI(q, settings.apiKey);
}

$('#btn-manual').addEventListener('click', () => openEditor(null, ''));
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([store.exportAll()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `指彈練習室-備份-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('已匯出，可以在另一台裝置用「匯入」還原');
});
$('#file-import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const r = store.importAll(await f.text());
    toast(`匯入完成：新增 ${r.added} 首`);
    renderMySongs();
  } catch (err) {
    toast('匯入失敗：' + err.message);
  }
  e.target.value = '';
});

// ---------------- 歌曲頁 ----------------
function showSong(id) {
  const song = store.getSong(id);
  if (!song) { location.hash = '#/'; return; }
  if (current && current.song.id !== id) leaveSong();
  song.settings = { ...store.DEFAULT_SONG_SETTINGS, ...(song.settings || {}) };
  current = { song, arr: null };
  practice = { last: null, acc: 0, counted: false };
  $('#view-home').hidden = true;
  $('#view-song').hidden = false;
  $('#controls').hidden = false;
  document.body.classList.add('song-mode');
  document.title = `${song.title} - 指彈練習室`;
  window.scrollTo(0, 0);

  $('#song-title').textContent = song.title;
  const ts = song.timeSig || [4, 4];
  $('#song-meta').innerHTML = [
    song.artist && esc(song.artist),
    song.key && `調性 ${esc(song.key)}`,
    `${ts[0]}/${ts[1]} 拍`,
    `原速 ${song.bpm} BPM`,
    `${song.bars.length} 小節`,
  ].filter(Boolean).map((x) => `<span>${x}</span>`).join('');
  const noteEl = $('#song-note');
  const notes = [];
  if (song.source === 'ai') notes.push('和弦由 AI 查詢，可能和原曲有出入，可以按「編輯和弦」修正。');
  if (song.note) notes.push(song.note);
  noteEl.hidden = !notes.length;
  noteEl.textContent = notes.join(' ');

  // 難度選擇
  const seg = $('#level-seg');
  seg.innerHTML = '';
  for (const [k, v] of Object.entries(LEVELS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(song.settings.level === k));
    b.title = v.desc;
    b.textContent = v.label;
    b.addEventListener('click', () => {
      song.settings.level = k;
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      persist();
      rebuild();
    });
    seg.appendChild(b);
  }
  $('#show-fingers').checked = song.settings.showFingers !== false;
  $('#tempo').value = song.settings.tempoPct;
  setToggle('#tg-loop', song.settings.loop);
  setToggle('#tg-countin', player.countIn);
  $('#trainer').checked = !!song.settings.trainer;
  $('#loop-row').hidden = !song.settings.loop;
  rebuild();
}

function rebuild() {
  const song = current.song;
  let arr;
  try {
    arr = arrange(song, { level: song.settings.level, capo: song.settings.capo });
  } catch (err) {
    toast('編曲失敗：' + err.message);
    return;
  }
  current.arr = arr;
  const wasMetro = player.metronomeOn;
  player.load(arr, bpmNow());
  player.countIn = $('#tg-countin').getAttribute('aria-pressed') === 'true';
  if (wasMetro) player.startMetronomeOnly();
  setPlayingUI(false);

  // 移調夾選單
  const autoCapo = arrange(song, { level: song.settings.level, capo: 'auto' }).capo;
  const sel = $('#capo-sel');
  sel.innerHTML = `<option value="auto">自動（建議 ${autoCapo ? '夾第 ' + autoCapo + ' 格' : '不夾'}）</option>` +
    Array.from({ length: 8 }, (_, i) => `<option value="${i}">${i ? '夾第 ' + i + ' 格' : '不夾'}</option>`).join('');
  sel.value = String(song.settings.capo);
  $('#capo-hint').textContent = capoHint(arr.capo) + (arr.capo ? `，用 ${arr.chordList.map((c) => c.shape.name).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5).join('、')} 等指型彈奏` : '');

  // 難度
  const d = arr.difficulty;
  $('#diff-badge').innerHTML = `${starsHtml(d.stars)}<div class="lvl">${d.label}</div><small class="hint">${LEVELS[arr.level].label}編曲</small>`;
  $('#diff-summary').innerHTML = `<span class="hint">${d.label} · ${d.stars} 顆星</span>`;
  $('#diff-reasons').innerHTML = d.reasons.map((r) => `<li>${esc(r)}</li>`).join('');
  $('#diff-tips').innerHTML = d.tips.map((r) => `<li>${esc(r)}</li>`).join('');

  // 和弦圖
  const grid = $('#chord-grid');
  grid.innerHTML = '';
  for (const c of arr.chordList) {
    const item = document.createElement('div');
    item.className = 'chord-item';
    const label = c.shape.name !== c.chord.name ? `${c.chord.name}` : c.chord.name;
    item.appendChild(chordDiagram(c.shape, label));
    const info = document.createElement('div');
    const shapeNote = c.shape.name !== c.chord.name.split('/')[0]
      ? `<div class="shape-note">用 ${esc(c.shape.name)} 指型${arr.capo ? `（夾第 ${arr.capo} 格後聽起來是 ${esc(c.chord.name)}）` : '（簡化按法）'}</div>` : '';
    const bassNote = c.bass && !c.bass.inShape ? `<li>低音：${['第6弦', '第5弦', '第4弦'][c.bass.s]}第 ${c.bass.f} 格</li>` : '';
    info.innerHTML = `${shapeNote}<ul>${c.desc.map((x) => `<li>${esc(x)}</li>`).join('')}${bassNote}</ul>`;
    item.appendChild(info);
    grid.appendChild(item);
  }
  // 逐小節說明
  $('#bar-notes').innerHTML = arr.barNotes.map((b) =>
    `<li>${b.sec ? `<b>[${esc(b.sec)}]</b> ` : ''}${esc(b.chords)}${b.notes.map((n) => `<span class="sub">${esc(n)}</span>`).join('')}</li>`).join('');

  // 循環範圍
  const n = arr.bars.length;
  const opts = Array.from({ length: n }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  $('#loop-from').innerHTML = opts;
  $('#loop-to').innerHTML = opts;
  song.settings.loopFrom = Math.min(Math.max(1, song.settings.loopFrom || 1), n);
  song.settings.loopTo = Math.min(Math.max(song.settings.loopFrom, song.settings.loopTo || n), n);
  $('#loop-from').value = song.settings.loopFrom;
  $('#loop-to').value = song.settings.loopTo;

  const maxFret = Math.max(5, ...arr.events.map((e) => e.f));
  fretboard.setup(maxFret, arr.capo);
  tabView.render(arr);
  tabView.setShowFingers(song.settings.showFingers !== false);
  applyLoop();
  updateTempoLabel();
  drawPosition(player.pausedBeat);
  syncMetroPanel();
}

function bpmNow() {
  return Math.max(20, Math.round((current.song.bpm * current.song.settings.tempoPct) / 100));
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (current) store.saveSong(current.song); }, 300);
}

function setToggle(sel, on) { $(sel).setAttribute('aria-pressed', String(!!on)); }

function updateTempoLabel() {
  if (!current) return;
  const p = current.song.settings.tempoPct;
  $('#tempo-label').textContent = `${p}% · ${bpmNow()} BPM`;
  $('#tempo').value = p;
}

function setTempoPct(p) {
  p = Math.max(30, Math.min(120, Math.round(p / 5) * 5));
  current.song.settings.tempoPct = p;
  player.setTempo(bpmNow());
  updateTempoLabel();
  syncMetroPanel();
  persist();
}

$('#tempo').addEventListener('input', (e) => setTempoPct(+e.target.value));
$('#tempo-minus').addEventListener('click', () => setTempoPct(current.song.settings.tempoPct - 5));
$('#tempo-plus').addEventListener('click', () => setTempoPct(current.song.settings.tempoPct + 5));

$('#capo-sel').addEventListener('change', (e) => {
  current.song.settings.capo = e.target.value === 'auto' ? 'auto' : +e.target.value;
  persist();
  rebuild();
});
$('#show-fingers').addEventListener('change', (e) => {
  current.song.settings.showFingers = e.target.checked;
  tabView.setShowFingers(e.target.checked);
  persist();
});

function applyLoop() {
  const s = current.song.settings;
  const bpb = current.arr.beatsPerBar;
  if (s.loop) {
    player.loop = { start: (s.loopFrom - 1) * bpb, end: s.loopTo * bpb };
    tabView.setLoopRange(s.loopFrom - 1, s.loopTo - 1);
  } else {
    player.loop = null;
    tabView.setLoopRange(null);
  }
}

$('#tg-loop').addEventListener('click', () => {
  const s = current.song.settings;
  s.loop = !s.loop;
  setToggle('#tg-loop', s.loop);
  $('#loop-row').hidden = !s.loop;
  applyLoop();
  persist();
});
$('#loop-from').addEventListener('change', (e) => {
  const s = current.song.settings;
  s.loopFrom = +e.target.value;
  if (s.loopTo < s.loopFrom) { s.loopTo = s.loopFrom; $('#loop-to').value = s.loopTo; }
  applyLoop();
  persist();
});
$('#loop-to').addEventListener('change', (e) => {
  const s = current.song.settings;
  s.loopTo = +e.target.value;
  if (s.loopTo < s.loopFrom) { s.loopFrom = s.loopTo; $('#loop-from').value = s.loopFrom; }
  applyLoop();
  persist();
});
$('#trainer').addEventListener('change', (e) => { current.song.settings.trainer = e.target.checked; persist(); });
$('#tg-countin').addEventListener('click', () => {
  player.countIn = !player.countIn;
  setToggle('#tg-countin', player.countIn);
});

// 漸進加速：每循環一次 +5%，到 100% 為止
player.onLoop = () => {
  if (!current || !current.song.settings.trainer) return null;
  const p = current.song.settings.tempoPct;
  if (p >= 100) return null;
  current.song.settings.tempoPct = Math.min(100, p + 5);
  persist();
  setTimeout(() => { updateTempoLabel(); toast(`加速到 ${current.song.settings.tempoPct}%`); }, 0);
  return bpmNow();
};

player.onEnd = () => {
  setPlayingUI(false);
  flushPractice();
  if (player.metronomeOn) player.startMetronomeOnly();
  drawPosition(0);
};

function setPlayingUI(on) {
  $('#btn-play').classList.toggle('playing', on);
  $('#btn-play').setAttribute('aria-label', on ? '暫停' : '播放');
}

$('#btn-play').addEventListener('click', () => {
  if (!current) return;
  if (player.playing) {
    player.pause();
    flushPractice();
    if (player.metronomeOn) player.startMetronomeOnly();
    setPlayingUI(false);
    return;
  }
  player.prepare();
  player.setTempo(bpmNow());
  player.play();
  practice.last = performance.now();
  if (!practice.counted) { store.countSession(current.song.id); current.song.stats.sessions = (current.song.stats.sessions || 0) + 1; practice.counted = true; }
  setPlayingUI(true);
});

$('#btn-rewind').addEventListener('click', () => {
  const was = player.playing;
  player.stop();
  if (was) { player.play(); } else if (player.metronomeOn) player.startMetronomeOnly();
  drawPosition(player.pausedBeat);
});

function seekBar(b) {
  if (!current) return;
  const beat = b * current.arr.beatsPerBar;
  if (current.song.settings.loop && (b + 1 < current.song.settings.loopFrom || b + 1 > current.song.settings.loopTo)) {
    current.song.settings.loopFrom = b + 1;
    if (current.song.settings.loopTo < b + 1) current.song.settings.loopTo = b + 1;
    $('#loop-from').value = current.song.settings.loopFrom;
    $('#loop-to').value = current.song.settings.loopTo;
    applyLoop();
    persist();
  }
  if (player.playing) player.seek(beat);
  else {
    player.pausedBeat = beat;
    drawPosition(beat);
  }
}

function flushPractice() {
  if (!current || practice.last === null) return;
  const sec = (performance.now() - practice.last) / 1000;
  practice.last = null;
  if (sec > 1) {
    store.logPractice(current.song.id, sec, current.song.settings.tempoPct);
    const fresh = store.getSong(current.song.id);
    if (fresh) current.song.stats = fresh.stats;
  }
}
setInterval(() => {
  if (current && player.playing && practice.last !== null) {
    flushPractice();
    practice.last = performance.now();
  }
}, 15000);

// ---------------- 動畫 ----------------
function drawPosition(beat) {
  if (!current || !current.arr) return;
  const arr = current.arr;
  tabView.update(beat, player.playing);
  const b = Math.max(0, beat);
  const bar = Math.min(arr.bars.length - 1, Math.floor(b / arr.beatsPerBar));
  const inBar = b - bar * arr.beatsPerBar;
  const barObj = arr.bars[bar];
  const seg = barObj.segments.find((sg) => inBar >= sg.start - 1e-6 && inBar < sg.start + sg.len) || barObj.segments[0];
  fretboard.showShape(seg ? seg.shape : null, seg ? seg.chord.name + '@' + bar : '');
  const active = arr.events.filter((e) => beat >= e.t - 0.02 && beat < e.t + Math.max(0.2, Math.min(e.d, 0.9)));
  fretboard.showNotes(player.playing ? active : []);
  $('#pos-label').textContent = `第 ${bar + 1} 小節 · 第 ${Math.floor(inBar) + 1} 拍${seg ? ' · ' + seg.chord.name : ''}`;
  const ci = $('#countin');
  if (player.playing && beat < player.playFrom) {
    ci.hidden = false;
    ci.textContent = String(Math.max(1, Math.ceil(player.playFrom - beat)));
  } else ci.hidden = true;
}

let lastMetroBeat = -1;
function frame() {
  if (current && player.playing) drawPosition(player.currentBeat());
  if (player.metronomeOn && (player.playing || player.metronomeOnly)) {
    const b = Math.floor(player.currentBeat() + 1e-3);
    if (b !== lastMetroBeat) {
      lastMetroBeat = b;
      const dot = $('#metro-dot');
      dot.classList.add('beat');
      setTimeout(() => dot.classList.remove('beat'), 90);
      const vis = $('#metro-vis').children;
      const n = vis.length;
      for (let k = 0; k < n; k++) vis[k].classList.toggle('on', k === ((b % n) + n) % n);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------- 節拍器 ----------------
function syncMetroPanel() {
  const inSong = !!current;
  const bpm = inSong ? bpmNow() : metro.bpm;
  $('#metro-bpm').textContent = bpm;
  $('#metro-range').value = bpm;
  $('#metro-on').checked = player.metronomeOn;
  $('#metro-dot').classList.toggle('on', player.metronomeOn);
  setToggle('#tg-metro', player.metronomeOn);
  $('#metro-free-row').hidden = inSong;
  $('#metro-sync-hint').hidden = !inSong;
  const beats = inSong && current.arr ? current.arr.beatsPerBar : metro.beats;
  const vis = $('#metro-vis');
  if (vis.children.length !== beats) vis.innerHTML = '<i></i>'.repeat(beats);
}

function setMetronome(on) {
  player.metronomeOn = on;
  if (!player.playing) {
    if (on) {
      if (!current) { player.bpm = metro.bpm; player.beatsPerBar = metro.beats; }
      player.startMetronomeOnly();
    } else player.halt();
  }
  syncMetroPanel();
}

function setMetroBpm(bpm) {
  bpm = Math.max(30, Math.min(220, Math.round(bpm)));
  if (current) {
    setTempoPct((bpm / current.song.bpm) * 100);
    return;
  }
  metro.bpm = bpm;
  player.setTempo(bpm);
  syncMetroPanel();
}

$('#btn-metro').addEventListener('click', (e) => {
  e.stopPropagation();
  const p = $('#metro-panel');
  p.hidden = !p.hidden;
  syncMetroPanel();
});
document.addEventListener('click', (e) => {
  const p = $('#metro-panel');
  if (!p.hidden && !p.contains(e.target) && !e.target.closest('#btn-metro')) p.hidden = true;
});
$('#metro-on').addEventListener('change', (e) => setMetronome(e.target.checked));
$('#tg-metro').addEventListener('click', () => setMetronome(!player.metronomeOn));
$('#metro-minus').addEventListener('click', () => setMetroBpm((current ? bpmNow() : metro.bpm) - (current ? current.song.bpm * 0.05 : 2)));
$('#metro-plus').addEventListener('click', () => setMetroBpm((current ? bpmNow() : metro.bpm) + (current ? current.song.bpm * 0.05 : 2)));
$('#metro-range').addEventListener('input', (e) => setMetroBpm(+e.target.value));
$('#metro-beats').addEventListener('change', (e) => {
  metro.beats = +e.target.value;
  if (!current) {
    player.beatsPerBar = metro.beats;
    if (player.metronomeOnly) player.startMetronomeOnly();
  }
  syncMetroPanel();
});
$('#metro-vol').addEventListener('input', (e) => {
  player.setClickVolume(+e.target.value);
  settings.clickVolume = +e.target.value;
  store.saveSettings(settings);
});
let taps = [];
$('#metro-tap').addEventListener('click', () => {
  const now = performance.now();
  taps = taps.filter((t) => now - t < 2500);
  taps.push(now);
  if (taps.length >= 2) {
    const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setMetroBpm(60000 / iv);
  }
});

// ---------------- 設定 ----------------
function openSettings() {
  $('#set-key').value = settings.apiKey || '';
  $('#set-guitar').value = settings.guitarVolume ?? 0.9;
  const dlg = $('#dlg-settings');
  dlg.returnValue = '';
  dlg.showModal();
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    settings.apiKey = $('#set-key').value.trim();
    settings.guitarVolume = +$('#set-guitar').value;
    player.setGuitarVolume(settings.guitarVolume);
    store.saveSettings(settings);
    toast(settings.apiKey ? '已儲存。現在可以輸入任何歌名了！' : '已儲存');
  };
}
$('#btn-settings').addEventListener('click', openSettings);

// ---------------- 手動輸入 / 編輯 ----------------
function barsToText(song) {
  const lines = [];
  let line = [];
  let sec = '';
  const flush = () => {
    if (line.length) lines.push((sec ? `[${sec}] ` : '') + line.join(' | ') + ' |');
    line = [];
  };
  song.bars.forEach((b) => {
    if (b.sec || line.length >= 4) { flush(); sec = b.sec || ''; }
    line.push(b.c || '-');
  });
  flush();
  return lines.join('\n');
}

function melodyToText(song) {
  if (!song.bars.some((b) => b.m)) return '';
  const cells = song.bars.map((b) => b.m || `r:${(song.timeSig || [4])[0]}`);
  const lines = [];
  for (let i = 0; i < cells.length; i += 4) lines.push(cells.slice(i, i + 4).join(' | ') + ' |');
  return lines.join('\n');
}

function parseEditor() {
  const errors = [];
  const title = $('#ed-title').value.trim();
  if (!title) errors.push('請輸入歌名');
  const beats = +$('#ed-time').value;
  const bars = [];
  $('#ed-chords').value.split('\n').forEach((rawLine) => {
    let line = rawLine.trim();
    if (!line) return;
    let sec = '';
    const m = /^\[([^\]]+)\]\s*(.*)$/.exec(line);
    if (m) { sec = m[1].trim(); line = m[2]; }
    const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length);
    cells.forEach((cell, i) => {
      const toks = cell.split(/\s+/);
      const good = [];
      for (const tok of toks) {
        const name = tok.split(':')[0];
        if (name === '-' || name === '%') continue;
        if (!parseChord(name)) errors.push(`看不懂的和弦：「${tok}」`);
        else good.push(tok);
      }
      const bar = { c: good.join(' ') };
      if (i === 0 && sec) bar.sec = sec;
      // "%" 代表重複前一小節
      if (cell === '%' && bars.length) bar.c = bars[bars.length - 1].c;
      bars.push(bar);
    });
  });
  if (!bars.length) errors.push('請至少輸入一個小節的和弦');
  const mel = $('#ed-melody').value.trim();
  if (mel) {
    const cells = mel.replace(/\n/g, ' ').split('|').map((c) => c.trim()).filter((c) => c.length);
    cells.forEach((cell, i) => {
      let sum = 0;
      for (const tok of cell.split(/\s+/)) {
        const [n, d] = tok.split(':');
        if (n.toLowerCase() !== 'r' && noteToMidi(n) === null) errors.push(`第 ${i + 1} 小節旋律看不懂：「${tok}」`);
        sum += d ? parseFloat(d) : 1;
      }
      if (sum > beats + 1e-6) errors.push(`第 ${i + 1} 小節旋律有 ${sum} 拍，超過 ${beats} 拍`);
      if (i < bars.length) bars[i].m = cell;
      else bars.push({ c: '', m: cell });
    });
  }
  return {
    errors: [...new Set(errors)].slice(0, 6),
    data: { title, artist: $('#ed-artist').value.trim(), bpm: Math.max(30, Math.min(240, +$('#ed-bpm').value || 90)), timeSig: [beats, 4], bars },
  };
}

function openEditor(song, title) {
  $('#edit-title').textContent = song ? '編輯和弦' : '手動輸入和弦';
  $('#ed-title').value = song ? song.title : title || '';
  $('#ed-artist').value = song ? song.artist : '';
  $('#ed-bpm').value = song ? song.bpm : 90;
  $('#ed-time').value = song ? String((song.timeSig || [4])[0]) : '4';
  $('#ed-chords').value = song ? barsToText(song) : '';
  $('#ed-melody').value = song ? melodyToText(song) : '';
  $('#ed-error').textContent = '';
  const dlg = $('#dlg-edit');
  dlg.returnValue = '';
  dlg.showModal();
  $('#ed-save').onclick = (e) => {
    const { errors, data } = parseEditor();
    if (errors.length) {
      e.preventDefault();
      $('#ed-error').textContent = errors.join('\n');
      return;
    }
    try { parseSong(data); arrange(data, {}); } catch (err) {
      e.preventDefault();
      $('#ed-error').textContent = '無法編曲：' + err.message;
      return;
    }
    if (song) {
      Object.assign(song, data);
      if (song.source === 'library') song.source = 'manual';
      store.saveSong(song);
      if (current && current.song.id === song.id) { current.song = song; showSong(song.id); }
      toast('已更新');
    } else {
      const s = store.createSong(data, 'manual');
      store.saveSong(s);
      openSong(s);
    }
  };
}

$('#btn-edit').addEventListener('click', () => current && openEditor(current.song));
$('#btn-delete').addEventListener('click', () => {
  if (!current) return;
  if (!confirm(`確定要刪除「${current.song.title}」嗎？練習紀錄也會一起刪除。`)) return;
  const id = current.song.id;
  leaveSong();
  store.deleteSong(id);
  location.hash = '#/';
});

// 鍵盤快捷鍵（電腦）：空白鍵播放/暫停、方向鍵調速
document.addEventListener('keydown', (e) => {
  if (!current || e.target.closest('input, textarea, select, dialog')) return;
  if (e.code === 'Space') { e.preventDefault(); $('#btn-play').click(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); setTempoPct(current.song.settings.tempoPct + 5); }
  if (e.key === 'ArrowDown') { e.preventDefault(); setTempoPct(current.song.settings.tempoPct - 5); }
  if (e.key === 'm' || e.key === 'M') setMetronome(!player.metronomeOn);
});

// 視窗大小改變時重新排版六線譜
let resizeTimer;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (current && current.arr) { tabView.render(current.arr); applyLoop(); drawPosition(player.currentBeat()); } }, 200);
});

// 離開頁面時記錄練習時間
document.addEventListener('visibilitychange', () => { if (document.hidden) flushPractice(); else if (player.playing) practice.last = performance.now(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

route();
