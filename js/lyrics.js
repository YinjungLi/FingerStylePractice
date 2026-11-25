// 歌詞：從 LRCLIB（社群維護的開放歌詞資料庫）搜尋，並對齊到小節
// 歌詞只在使用者按下搜尋時即時取得，存在使用者自己的瀏覽器裡，不會放進程式碼。

const API = 'https://lrclib.net/api/search';

export async function searchLyrics(query) {
  let res;
  try {
    res = await fetch(`${API}?q=${encodeURIComponent(query)}`);
  } catch (e) {
    throw new Error('連不上歌詞資料庫，請檢查網路。');
  }
  if (res.status === 429) throw new Error('查詢太頻繁，請稍等一下再試。');
  if (!res.ok) throw new Error(`歌詞資料庫錯誤（${res.status}）`);
  const data = await res.json();
  return (Array.isArray(data) ? data : [])
    .filter((r) => !r.instrumental && (r.plainLyrics || r.syncedLyrics))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      track: r.trackName || r.name || '',
      artist: r.artistName || '',
      album: r.albumName || '',
      duration: r.duration || 0,
      plain: r.plainLyrics || '',
      synced: r.syncedLyrics || '',
    }));
}

// "[01:23.45] 歌詞" -> [{ t: 83.45, text }]
export function parseSynced(lrc) {
  const out = [];
  for (const line of (lrc || '').split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) continue;
    for (const m of stamps) out.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function lyricLines(result) {
  const synced = parseSynced(result.synced);
  if (synced.length) return synced;
  return (result.plain || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((text) => ({ t: null, text }));
}

// 初步猜測每句歌詞在第幾小節（1 起算；0 = 不顯示）
// 第一句放在第一個不是前奏的段落；之後依原曲時間間隔換算成小節數，使用者再微調
export function guessBars(lines, song, nBars, beatsPerBar) {
  if (!lines.length) return [];
  let first = 1;
  const idx = song.bars.findIndex((b) => b.sec && !/前奏|intro/i.test(b.sec));
  if (idx > 0 && /前奏|intro/i.test(song.bars[0].sec || '')) first = idx + 1;
  const secPerBar = (60 / (song.bpm || 90)) * beatsPerBar;
  const t0 = lines[0].t;
  let prev = first - 1;
  return lines.map((ln, i) => {
    let bar;
    if (ln.t !== null && t0 !== null) bar = first + Math.round((ln.t - t0) / secPerBar);
    else bar = first + i * 2;
    bar = Math.max(prev + (i === 0 ? 1 : 0), bar); // 不倒退
    prev = bar;
    return bar > nBars ? 0 : bar;
  });
}

// 依對齊結果寫入每小節歌詞
export function applyLyrics(song, lines, bars) {
  song.bars.forEach((b) => { delete b.l; });
  lines.forEach((ln, i) => {
    const bar = bars[i];
    if (!bar || !song.bars[bar - 1]) return;
    const b = song.bars[bar - 1];
    b.l = b.l ? `${b.l} / ${ln.text}` : ln.text;
  });
  song.lyricLines = lines.map((ln, i) => ({ text: ln.text, t: ln.t, bar: bars[i] || 0 }));
}

export function fmtDuration(sec) {
  if (!sec) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
