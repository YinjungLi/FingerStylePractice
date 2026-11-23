// 基礎樂理工具：音名、MIDI、和弦解析

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C' };

// 標準調弦，index 0 = 第 6 弦 (低音 E)，index 5 = 第 1 弦 (高音 e)
export const TUNING = [40, 45, 50, 55, 59, 64];
export const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];
export const STRING_ZH = ['第6弦(E)', '第5弦(A)', '第4弦(D)', '第3弦(G)', '第2弦(B)', '第1弦(e)'];

export function pitchClass(name) {
  const m = /^([A-Ga-g])([#b]?)$/.exec(name.trim());
  if (!m) return null;
  let n = m[1].toUpperCase() + m[2];
  if (FLAT_TO_SHARP[n]) n = FLAT_TO_SHARP[n];
  return NOTE_NAMES.indexOf(n);
}

// "E4" / "F#3" / "Bb4" -> MIDI number
export function noteToMidi(note) {
  const m = /^([A-Ga-g][#b]?)(-?\d)$/.exec(note.trim());
  if (!m) return null;
  const pc = pitchClass(m[1]);
  if (pc === null) return null;
  return pc + (parseInt(m[2], 10) + 1) * 12;
}

export function midiToName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// 和弦品質正規化
const QUALITY_MAP = {
  '': 'maj', M: 'maj', maj: 'maj',
  m: 'm', min: 'm', '-': 'm',
  '7': '7', dom7: '7',
  m7: 'm7', min7: 'm7', '-7': 'm7',
  maj7: 'maj7', M7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7',
  sus4: 'sus4', sus: 'sus4', sus2: 'sus2',
  dim: 'dim', '°': 'dim', dim7: 'dim', m7b5: 'dim',
  aug: 'maj', '+': 'maj',
  add9: 'add9', add2: 'add9', '6': 'maj', m6: 'm', '9': '7', m9: 'm7', maj9: 'maj7',
  '7sus4': 'sus4', '11': '7', '13': '7', '5': 'maj',
};

export const QUALITY_INTERVALS = {
  maj: [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7], sus2: [0, 2, 7], dim: [0, 3, 6], add9: [0, 2, 4, 7],
};

// "Am7/G" -> { root: 9, quality: 'm7', bass: 7, name: 'Am7/G' }
export function parseChord(str) {
  if (!str) return null;
  const s = str.trim();
  if (!s || s === '-' || s.toUpperCase() === 'N.C.' || s.toUpperCase() === 'NC') return null;
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(s);
  if (!m) return null;
  const root = pitchClass(m[1]);
  let q = m[2].trim();
  let quality = QUALITY_MAP[q];
  if (quality === undefined) {
    if (/^m(?!aj)/.test(q)) quality = q.includes('7') ? 'm7' : 'm';
    else if (q.startsWith('maj')) quality = 'maj7';
    else if (q.includes('sus')) quality = 'sus4';
    else if (q.includes('7')) quality = '7';
    else quality = 'maj';
  }
  const bass = m[3] ? pitchClass(m[3]) : root;
  return { root, quality, bass, name: s };
}

export function chordPitchClasses(ch) {
  return QUALITY_INTERVALS[ch.quality].map((i) => (ch.root + i) % 12);
}

export function qualitySuffix(q) {
  return { maj: '', m: 'm', '7': '7', m7: 'm7', maj7: 'maj7', sus4: 'sus4', sus2: 'sus2', dim: 'dim', add9: 'add9' }[q];
}
