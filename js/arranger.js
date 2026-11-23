// 自動指彈編曲引擎
// 輸入：歌曲資料（和弦 + 可選旋律）
// 輸出：六線譜事件（弦、格、左手指法、右手指法、時間）、移調夾建議、難度評估
import { TUNING, parseChord, noteToMidi, chordPitchClasses, NOTE_NAMES, midiToName } from './theory.js';
import { getShape, shapeCost, describeShape } from './chords.js';

export const LEVELS = {
  easy: { label: '簡易', desc: '拇指彈低音 + 簡單分解，適合剛入門' },
  normal: { label: '標準', desc: '低音 + 旋律 + 內聲部填充，經典指彈織體' },
  travis: { label: '進階 (Travis)', desc: '拇指每拍交替低音，手指彈旋律，真正的指彈感' },
};

const FINGER_ZH = ['空弦', '食指', '中指', '無名指', '小指'];
const PICK_ZH = { p: '拇指 p', i: '食指 i', m: '中指 m', a: '無名指 a' };
const STRING_NUM = ['第6弦', '第5弦', '第4弦', '第3弦', '第2弦', '第1弦'];

// ---------- 解析 ----------

function parseChordTokens(text, barLen) {
  const raw = (text || '').trim();
  if (!raw) return [];
  const tokens = raw.split(/\s+/).map((tok) => {
    const m = /^(.+?):(\d+(?:\.\d+)?)$/.exec(tok);
    return m ? { name: m[1], beats: parseFloat(m[2]) } : { name: tok, beats: null };
  });
  const fixed = tokens.reduce((a, t) => a + (t.beats || 0), 0);
  const free = tokens.filter((t) => t.beats === null).length;
  const each = free ? Math.max(0, barLen - fixed) / free : 0;
  let t = 0;
  const out = [];
  for (const tok of tokens) {
    const len = tok.beats ?? each;
    const ch = parseChord(tok.name);
    if (ch && len > 0) out.push({ chord: ch, start: t, len });
    t += len;
  }
  return out;
}

function parseMelody(text) {
  const raw = (text || '').trim();
  if (!raw) return [];
  let t = 0;
  const out = [];
  for (const tok of raw.split(/\s+/)) {
    const m = /^([^:]+)(?::(\d+(?:\.\d+)?))?$/.exec(tok);
    if (!m) continue;
    const d = m[2] ? parseFloat(m[2]) : 1;
    if (m[1].toLowerCase() !== 'r') {
      const midi = noteToMidi(m[1]);
      if (midi !== null) out.push({ t, d, midi });
    }
    t += d;
  }
  return out;
}

export function parseSong(song) {
  const beatsPerBar = song.timeSig ? song.timeSig[0] * (4 / song.timeSig[1]) : 4;
  const bars = song.bars.map((b, i) => ({
    index: i,
    start: i * beatsPerBar,
    len: beatsPerBar,
    segments: parseChordTokens(b.c, beatsPerBar),
    melody: parseMelody(b.m),
    sec: b.sec || '',
    chordText: b.c || '',
  }));
  return { beatsPerBar, bars, hasMelody: bars.some((b) => b.melody.length) };
}

// ---------- 移調夾與八度 ----------

function chooseCapo(parsed) {
  const uniq = new Map();
  parsed.bars.forEach((b) => b.segments.forEach((s) => uniq.set(s.chord.root + s.chord.quality, s.chord)));
  const chords = [...uniq.values()];
  let best = { capo: 0, cost: Infinity };
  for (let capo = 0; capo <= 7; capo++) {
    let cost = capo * 0.6;
    for (const ch of chords) {
      const shapeRoot = (ch.root - capo + 12) % 12;
      cost += shapeCost(getShape(shapeRoot, ch.quality));
    }
    if (cost < best.cost - 1e-9) best = { capo, cost };
  }
  return best.capo;
}

function chooseOctaveShift(parsed, capo) {
  const notes = parsed.bars.flatMap((b) => b.melody.map((n) => n.midi));
  if (!notes.length) return 0;
  const lo = 55 + capo; // 第 3 弦空弦
  const hi = 76 + capo; // 第 1 弦第 12 格
  let best = { shift: 0, score: -Infinity };
  for (const shift of [0, 12, -12, 24]) {
    let score = 0;
    for (const n of notes) {
      const p = n + shift;
      if (p >= lo && p <= lo + 14) score += 1; // 第 1~3 弦、第一把位（0~5 格）
      else if (p > lo + 14 && p <= hi) score += 0.4; // 需要往高把位移動
      else if (p >= 50 + capo && p < lo) score += 0.5; // 只能放在第 4 弦
      else score -= 1;
    }
    score /= notes.length;
    if (shift !== 0) score -= 0.08;
    if (score > best.score) best = { shift, score };
  }
  return best.shift;
}

// ---------- 低音位置 ----------

function shapeLowFret(shape) {
  const pos = shape.frets.filter((f) => f > 0);
  if (shape.barreFret) return shape.barreFret;
  return pos.length ? Math.min(...pos) : 1;
}

function findBass(shape, chord, capo) {
  const want = (chord.bass - capo + 120) % 12;
  // 1) 指型內最低且音名相符的弦
  for (let s = 0; s <= 3; s++) {
    const f = shape.frets[s];
    if (f >= 0 && (TUNING[s] + f) % 12 === want) return { s, f, finger: shape.fingers[s], inShape: true };
  }
  // 2) 指型外：在第 6~4 弦低把位尋找（例如斜線和弦 D/F#）
  const lo = shapeLowFret(shape);
  let best = null;
  for (let s = 0; s <= 2; s++) {
    for (let f = 0; f <= Math.max(5, lo + 3); f++) {
      if ((TUNING[s] + f) % 12 !== want) continue;
      if (shape.frets[s] > 0 && shape.frets[s] !== f) continue;
      const cost = Math.abs(f - lo) + s * 0.5 + (f === 0 ? -1 : 0);
      if (!best || cost < best.cost) best = { s, f, cost };
    }
  }
  if (!best) return { s: 2, f: Math.max(0, shape.frets[2]), finger: shape.fingers[2], inShape: true };
  const used = new Set(shape.fingers.filter((x) => x > 0));
  let finger = 0;
  if (best.f > 0) finger = [2, 3, 4, 1].find((x) => !used.has(x)) || Math.min(4, Math.max(1, best.f - lo + 1));
  return { s: best.s, f: best.f, finger, inShape: false };
}

function findAltBass(shape, chord, capo, root) {
  const tones = chordPitchClasses(chord).map((pc) => (pc - capo + 120) % 12);
  const order = root.s === 0 ? [2, 1] : root.s === 1 ? [2, 3] : root.s === 2 ? [1, 3] : [2, 1];
  for (const s of order) {
    const f = shape.frets[s];
    if (f >= 0 && tones.includes((TUNING[s] + f) % 12)) return { s, f, finger: shape.fingers[s] };
    // 指型標示不彈，但空弦剛好是和弦音（例如 D 和弦的第 5 弦 A）
    if (f < 0 && s < root.s + 2 && tones.includes(TUNING[s] % 12)) return { s, f: 0, finger: 0 };
  }
  return root;
}

function trebleString(shape, n) {
  // n = 1/2/3 弦號 -> index；若該弦被標為不彈則往下找
  let s = 6 - n;
  while (s >= 2 && shape.frets[s] < 0) s--;
  return s >= 2 ? { s, f: shape.frets[s], finger: shape.fingers[s] } : null;
}

// ---------- 伴奏織體 ----------

const PATTERNS = {
  4: {
    easy: [[0, ['B']], [1, [3]], [2, [2]], [3, [1]]],
    normal: [[0, ['B']], [0.5, [3]], [1, [2]], [1.5, [1]], [2, ['A']], [2.5, [3]], [3, [2]], [3.5, [3]]],
    travis: [[0, ['B', 1]], [0.5, [2]], [1, ['A']], [1.5, [3]], [2, ['B']], [2.5, [1]], [3, ['A']], [3.5, [2]]],
  },
  3: {
    easy: [[0, ['B']], [1, [3, 2]], [2, [3, 2]]],
    normal: [[0, ['B']], [0.5, [3]], [1, [2]], [1.5, [1]], [2, [2]], [2.5, [3]]],
    travis: [[0, ['B', 1]], [0.5, [3]], [1, ['A', 2]], [1.5, [3]], [2, ['A']], [2.5, [2]]],
  },
  2: {
    easy: [[0, ['B']], [1, [3, 2]]],
    normal: [[0, ['B']], [0.5, [3]], [1, ['A']], [1.5, [2]]],
    travis: [[0, ['B', 1]], [0.5, [2]], [1, ['A']], [1.5, [3]]],
  },
};

// 有旋律時的拇指節奏
const THUMB = {
  4: { easy: [[0, 'B'], [2, 'B']], normal: [[0, 'B'], [2, 'A']], travis: [[0, 'B'], [1, 'A'], [2, 'B'], [3, 'A']] },
  3: { easy: [[0, 'B']], normal: [[0, 'B']], travis: [[0, 'B'], [1, 'A'], [2, 'A']] },
  2: { easy: [[0, 'B']], normal: [[0, 'B']], travis: [[0, 'B'], [1, 'A']] },
};
const FILL = { 4: [1, 3], 3: [1, 2], 2: [1] };

function pickFinger(s, role) {
  if (role === 'bass') return 'p';
  return s >= 5 ? 'a' : s === 4 ? 'm' : s === 3 ? 'i' : 'p';
}

// ---------- 旋律指位 ----------

function placeMelodyNote(midi, shape, capo, prev, lowestAllowed) {
  const lo = shapeLowFret(shape);
  let best = null;
  for (let s = 0; s <= 5; s++) {
    const f = midi - TUNING[s] - capo;
    if (f < 0 || f > 15) continue;
    let cost;
    let inShape = false;
    if (shape.frets[s] === f) { cost = 0; inShape = true; }
    else if (f === 0) cost = 0.6;
    else {
      const dist = f < lo ? lo - f : f > lo + 3 ? f - (lo + 3) : 0;
      cost = 1 + dist * 1.5;
    }
    if (s < lowestAllowed) cost += 6; // 最後手段：放到低音弦
    if (s === 2) cost += 2.5;
    if (s === 3) cost += 0.3;
    if (f > 5) cost += (f - 5) * 0.25;
    if (prev && Math.abs(f - prev.f) > 4) cost += 0.8;
    if (!best || cost < best.cost) best = { s, f, cost, inShape };
  }
  if (!best) return null;
  let finger = 0;
  if (best.f > 0) {
    if (best.inShape) finger = shape.fingers[best.s];
    else {
      // 指型外的音：依把位推算手指（一指一格原則）
      const base = best.f > lo + 3 ? best.f - 3 : lo;
      finger = Math.min(4, Math.max(1, best.f - base + 1));
    }
  }
  return { ...best, finger, shift: best.f > lo + 3 || (best.f > 0 && best.f < lo - 1) };
}

// ---------- 主函式 ----------

export function arrange(song, opts = {}) {
  const level = opts.level || 'normal';
  const parsed = parseSong(song);
  const { beatsPerBar, bars } = parsed;
  const capo = opts.capo === undefined || opts.capo === 'auto' ? chooseCapo(parsed) : Number(opts.capo);
  const octave = chooseOctaveShift(parsed, capo);
  const bpbKey = beatsPerBar >= 4 ? 4 : beatsPerBar >= 3 ? 3 : 2;

  const events = [];
  const shapes = new Map(); // 和弦名 -> {chord, shape}
  const barNotes = [];
  let prevMel = null;
  let firstShape = null;

  // 先為每個和弦取得指型
  for (const bar of bars) {
    for (const seg of bar.segments) {
      const shapeRoot = (seg.chord.root - capo + 120) % 12;
      seg.shape = getShape(shapeRoot, seg.chord.quality);
      seg.bass = findBass(seg.shape, seg.chord, capo);
      seg.alt = findAltBass(seg.shape, seg.chord, capo, seg.bass);
      if (!shapes.has(seg.chord.name)) shapes.set(seg.chord.name, { chord: seg.chord, shape: seg.shape, bass: seg.bass });
      if (!firstShape) firstShape = seg.shape;
    }
  }
  const OPEN_SHAPE = { frets: [0, 0, 0, 0, 0, 0], fingers: [0, 0, 0, 0, 0, 0] };

  bars.forEach((bar, bi) => {
    const notes = [];
    const segAt = (t) => bar.segments.find((sg) => t >= sg.start - 1e-6 && t < sg.start + sg.len - 1e-6) || null;
    const nextShape = () => {
      for (let j = bi; j < bars.length; j++) if (bars[j].segments.length) return bars[j].segments[0].shape;
      return firstShape || OPEN_SHAPE;
    };
    const barEvents = [];
    const push = (ev) => { barEvents.push(ev); };

    // 1) 旋律
    const melodyOnsets = new Map(); // t -> string index
    for (const n of bar.melody) {
      const seg = segAt(n.t);
      const shape = seg ? seg.shape : nextShape();
      const midi = n.midi + octave;
      const pos = placeMelodyNote(midi, shape, capo, prevMel, 2);
      if (!pos) continue;
      prevMel = pos;
      melodyOnsets.set(n.t, pos.s);
      push({ t: bar.start + n.t, d: n.d, s: pos.s, f: pos.f, lf: pos.finger, role: 'mel', vel: 0.95, offShape: !pos.inShape && pos.f > 0, shift: pos.shift, midi: TUNING[pos.s] + capo + pos.f });
      if (!pos.inShape && pos.f > 0) {
        notes.push(`旋律 ${midiToName(midi)}：${STRING_NUM[pos.s]}第 ${pos.f} 格，用${FINGER_ZH[pos.finger]}(${pos.finger})${pos.shift ? '（需要移動手的位置）' : ''}`);
      }
    }

    // 2) 伴奏
    if (bar.segments.length) {
      const segStarted = new Set();
      const addBass = (t, kind, seg) => {
        const b = kind === 'A' && segStarted.has(seg) ? seg.alt : seg.bass;
        segStarted.add(seg);
        const mel = melodyOnsets.get(t);
        if (mel !== undefined && mel <= b.s) return; // 與旋律同弦或旋律更低時略過
        push({ t: bar.start + t, d: 1, s: b.s, f: b.f, lf: b.finger, role: 'bass', vel: 0.75, midi: TUNING[b.s] + capo + b.f, offShape: false });
      };
      const addTreble = (t, n, seg) => {
        const tr = trebleString(seg.shape, n);
        if (!tr) return;
        const mel = melodyOnsets.get(t);
        if (mel !== undefined && (mel === tr.s)) return;
        push({ t: bar.start + t, d: 1, s: tr.s, f: tr.f, lf: tr.finger, role: 'fill', vel: 0.55, midi: TUNING[tr.s] + capo + tr.f, offShape: false });
      };

      if (!parsed.hasMelody) {
        const pat = PATTERNS[bpbKey][level];
        for (const [t, parts] of pat) {
          if (t >= bar.len) continue;
          const seg = segAt(t);
          if (!seg) continue;
          const firstInSeg = !segStarted.has(seg);
          let ps = parts.slice();
          if (firstInSeg) {
            ps = ps.map((p) => (p === 'A' ? 'B' : p));
            if (!ps.includes('B')) ps.unshift('B');
          }
          for (const p of ps) {
            if (p === 'B' || p === 'A') addBass(t, p, seg);
            else addTreble(t, p, seg);
          }
        }
      } else {
        const thumb = THUMB[bpbKey][level];
        const thumbTimes = new Set();
        for (const [t, kind] of thumb) {
          if (t >= bar.len) continue;
          const seg = segAt(t);
          if (!seg) continue;
          addBass(t, segStarted.has(seg) ? kind : 'B', seg);
          thumbTimes.add(t);
        }
        // 和弦在小節中間換：補一個根音
        for (const seg of bar.segments) {
          if (!thumbTimes.has(seg.start)) { addBass(seg.start, 'B', seg); thumbTimes.add(seg.start); }
        }
        // 標準難度：旋律長音時補內聲部
        if (level === 'normal') {
          for (const t of FILL[bpbKey]) {
            if (t >= bar.len || melodyOnsets.has(t)) continue;
            const seg = segAt(t);
            if (!seg) continue;
            // 找在旋律弦之下、低音之上的弦
            const melNow = bar.melody.filter((n) => n.t <= t + 1e-6).pop();
            const melS = melNow ? melodyOnsets.get(melNow.t) : 6;
            for (const n of [3, 2]) {
              const tr = trebleString(seg.shape, n);
              if (tr && tr.s < melS && tr.s > seg.bass.s) { addTreble(t, n, seg); break; }
            }
          }
        }
      }
    }

    // 排序並指定右手指法
    barEvents.sort((a, b) => a.t - b.t || a.s - b.s);
    for (const ev of barEvents) ev.rf = pickFinger(ev.s, ev.role);
    // 同時發聲時，若有兩個音用到同一隻右手手指，調整
    const byT = new Map();
    barEvents.forEach((ev) => { (byT.get(ev.t) || byT.set(ev.t, []).get(ev.t)).push(ev); });
    for (const group of byT.values()) {
      const used = new Set();
      group.sort((a, b) => a.s - b.s);
      for (const ev of group) {
        if (used.has(ev.rf)) ev.rf = ['i', 'm', 'a'].find((x) => !used.has(x)) || ev.rf;
        used.add(ev.rf);
      }
    }
    barEvents.forEach((ev) => { ev.bar = bi; events.push(ev); });

    // 小節說明
    const chordDesc = bar.segments.map((sg) => sg.chord.name).join(' → ');
    barNotes.push({ bar: bi, chords: chordDesc || '(弱起，只彈旋律)', notes, sec: bar.sec });
  });

  // 3) 計算延音長度：同一條弦再次被彈、或和弦更換時停止
  events.sort((a, b) => a.t - b.t || a.s - b.s);
  const segEnd = (ev) => {
    const bar = bars[ev.bar];
    const local = ev.t - bar.start;
    const seg = bar.segments.find((sg) => local >= sg.start - 1e-6 && local < sg.start + sg.len - 1e-6);
    return seg ? bar.start + seg.start + seg.len : bar.start + bar.len;
  };
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    let next = Infinity;
    for (let j = i + 1; j < events.length; j++) if (events[j].s === ev.s && events[j].t > ev.t) { next = events[j].t; break; }
    let d = ev.role === 'mel' ? Math.max(ev.d, 0.5) : segEnd(ev) - ev.t;
    if (ev.role !== 'mel' && ev.f === 0) d = Math.max(d, 0.5);
    ev.d = Math.max(0.1, Math.min(d, next - ev.t, 4));
  }

  const totalBeats = bars.length * beatsPerBar;
  const result = {
    capo, octave, level, beatsPerBar, bars, events, totalBeats, barNotes, hasMelody: parsed.hasMelody,
    chordList: [...shapes.values()].map((x) => ({ ...x, desc: describeShape(x.shape) })),
  };
  result.difficulty = rateDifficulty(result, song.bpm || 90);
  return result;
}

// ---------- 難度評估 ----------

export function rateDifficulty(arr, bpm) {
  const reasons = [];
  const onsets = new Set(arr.events.map((e) => e.t.toFixed(3)));
  const notesPerSec = (onsets.size / Math.max(1, arr.totalBeats)) * (bpm / 60);
  let score = 1 + Math.max(0, notesPerSec - 1) * 0.55;
  reasons.push(`原速 ${bpm} BPM，平均每秒約 ${notesPerSec.toFixed(1)} 個音`);

  const barres = arr.chordList.filter((c) => !c.shape.open);
  const minis = arr.chordList.filter((c) => c.shape.miniBarre);
  if (barres.length) {
    score += 0.8 + Math.min(1.2, barres.length * 0.3);
    reasons.push(`需要大橫按和弦：${barres.map((c) => c.chord.name).join('、')}`);
  }
  if (minis.length) {
    score += 0.3;
    reasons.push(`有小橫按：${minis.map((c) => c.chord.name).join('、')}（食指同時壓兩條弦）`);
  }

  let changes = 0;
  let prev = null;
  arr.bars.forEach((b) => b.segments.forEach((sg) => { if (sg.chord.name !== prev) changes++; prev = sg.chord.name; }));
  const changesPerBar = changes / Math.max(1, arr.bars.length);
  const changesPerSec = changesPerBar / (arr.beatsPerBar * 60 / bpm);
  score += Math.max(0, changesPerSec - 0.3) * 1.2;
  if (changesPerBar >= 1.5) reasons.push(`和弦變換頻繁（每小節約 ${changesPerBar.toFixed(1)} 次）`);

  const mel = arr.events.filter((e) => e.role === 'mel');
  if (mel.length) {
    const off = mel.filter((e) => e.offShape).length / mel.length;
    const shifts = mel.filter((e) => e.shift).length;
    score += off * 1.5 + Math.min(1, shifts * 0.1);
    if (off > 0.3) reasons.push(`約 ${Math.round(off * 100)}% 旋律音不在和弦指型內，需要額外按壓`);
    if (shifts) reasons.push(`有 ${shifts} 個音需要移動把位`);
    score += 0.4;
    reasons.push('同時彈低音與旋律（雙聲部獨立）');
  }
  const maxFret = Math.max(0, ...arr.events.map((e) => e.f));
  if (maxFret >= 7) { score += 0.5; reasons.push(`最高用到第 ${maxFret} 格`); }
  if (arr.level === 'travis') { score += 0.5; reasons.push('Travis 交替低音：拇指要保持穩定獨立'); }

  score = Math.max(1, Math.min(5, score));
  const stars = Math.round(score * 2) / 2;
  const label = stars <= 1.5 ? '入門' : stars <= 2.5 ? '初級' : stars <= 3.5 ? '中級' : stars <= 4.5 ? '中高級' : '高級';
  const startTempo = Math.round(Math.max(30, Math.min(80, 100 - stars * 12)));
  const tips = [
    `建議從 ${startTempo}% 速度開始，能連續正確彈 3 次再加速 5%。`,
    arr.chordList.length > 1 ? `先不看譜練習和弦切換：${arr.chordList.slice(0, 4).map((c) => c.chord.name).join(' → ')}` : '先把和弦按穩，確認每條弦都有聲音。',
    arr.hasMelody ? '先只彈旋律（a、m、i 指），再加上拇指低音。' : '拇指(p)固定負責第4~6弦低音，i、m、a 分別負責第3、2、1弦。',
  ];
  return { score, stars, label, reasons, tips, startTempo };
}

export function capoHint(capo) {
  return capo ? `移調夾夾第 ${capo} 格（譜上的格數都是從移調夾算起）` : '不需要移調夾';
}

export { NOTE_NAMES, PICK_ZH, FINGER_ZH, STRING_NUM };
