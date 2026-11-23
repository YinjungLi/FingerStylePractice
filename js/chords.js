// 和弦按法資料庫：開放和弦 + 自動計算的封閉和弦
// frets: [第6弦..第1弦]，-1 = 不彈，0 = 空弦
// fingers: 0 = 不用手指，1 食指 2 中指 3 無名指 4 小指
import { NOTE_NAMES, qualitySuffix } from './theory.js';

const OPEN = {
  C: { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  Cmaj7: { frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] },
  C7: { frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
  Cadd9: { frets: [-1, 3, 2, 0, 3, 0], fingers: [0, 2, 1, 0, 3, 0] },
  Csus2: { frets: [-1, 3, 0, 0, 1, 0], fingers: [0, 3, 0, 0, 1, 0] },
  Csus4: { frets: [-1, 3, 3, 0, 1, 1], fingers: [0, 3, 4, 0, 1, 1] },
  D: { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  Dm: { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  D7: { frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] },
  Dm7: { frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1] },
  Dmaj7: { frets: [-1, -1, 0, 2, 2, 2], fingers: [0, 0, 0, 1, 2, 3] },
  Dsus4: { frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 3, 4] },
  Dsus2: { frets: [-1, -1, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 3, 0] },
  Dadd9: { frets: [-1, -1, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 3, 0] },
  E: { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
  Em: { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
  E7: { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
  Em7: { frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0] },
  Emaj7: { frets: [0, 2, 1, 1, 0, 0], fingers: [0, 3, 1, 2, 0, 0] },
  Esus4: { frets: [0, 2, 2, 2, 0, 0], fingers: [0, 2, 3, 4, 0, 0] },
  Eadd9: { frets: [0, 2, 2, 1, 0, 2], fingers: [0, 2, 3, 1, 0, 4] },
  // 小 F（四弦版本），食指橫按第 1、2 弦，對初學者比大橫按友善
  F: { frets: [-1, -1, 3, 2, 1, 1], fingers: [0, 0, 3, 2, 1, 1], miniBarre: true },
  Fmaj7: { frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] },
  Fadd9: { frets: [-1, -1, 3, 2, 1, 3], fingers: [0, 0, 3, 2, 1, 4] },
  G: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
  G7: { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
  Gmaj7: { frets: [3, 2, 0, 0, 0, 2], fingers: [3, 2, 0, 0, 0, 1] },
  Gsus4: { frets: [3, 3, 0, 0, 1, 3], fingers: [2, 3, 0, 0, 1, 4] },
  Gadd9: { frets: [3, 0, 0, 2, 0, 3], fingers: [2, 0, 0, 1, 0, 3] },
  A: { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
  Am: { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  A7: { frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
  Am7: { frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
  Amaj7: { frets: [-1, 0, 2, 1, 2, 0], fingers: [0, 0, 2, 1, 3, 0] },
  Asus4: { frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
  Asus2: { frets: [-1, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0] },
  Aadd9: { frets: [-1, 0, 2, 4, 2, 0], fingers: [0, 0, 1, 3, 2, 0] },
  B7: { frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
};

// 封閉和弦樣板（相對於橫按的格數 f）
const E_SHAPE = {
  maj: { o: [0, 2, 2, 1, 0, 0], fi: [1, 3, 4, 2, 1, 1] },
  m: { o: [0, 2, 2, 0, 0, 0], fi: [1, 3, 4, 1, 1, 1] },
  '7': { o: [0, 2, 0, 1, 0, 0], fi: [1, 3, 1, 2, 1, 1] },
  m7: { o: [0, 2, 0, 0, 0, 0], fi: [1, 3, 1, 1, 1, 1] },
  sus4: { o: [0, 2, 2, 2, 0, 0], fi: [1, 2, 3, 4, 1, 1] },
};
const A_SHAPE = {
  maj: { o: [null, 0, 2, 2, 2, 0], fi: [0, 1, 2, 3, 4, 1] },
  m: { o: [null, 0, 2, 2, 1, 0], fi: [0, 1, 3, 4, 2, 1] },
  '7': { o: [null, 0, 2, 0, 2, 0], fi: [0, 1, 3, 1, 4, 1] },
  m7: { o: [null, 0, 2, 0, 1, 0], fi: [0, 1, 3, 1, 2, 1] },
  maj7: { o: [null, 0, 2, 1, 2, 0], fi: [0, 1, 3, 2, 4, 1] },
  sus4: { o: [null, 0, 2, 2, 3, 0], fi: [0, 1, 2, 3, 4, 1] },
  sus2: { o: [null, 0, 2, 2, 0, 0], fi: [0, 1, 3, 4, 1, 1] },
  dim: { o: [null, 0, 1, 2, 1, null], fi: [0, 1, 2, 4, 3, 0] },
  add9: { o: [null, 0, 2, 2, 2, 0], fi: [0, 1, 2, 3, 4, 1] },
};

function fallbackQuality(q, table) {
  if (table[q]) return q;
  if (q === 'maj7' || q === 'add9') return 'maj';
  if (q === 'sus2') return 'maj';
  if (q === 'dim') return 'm';
  return 'maj';
}

function buildBarre(shapeRoot, quality, kind) {
  const table = kind === 'E' ? E_SHAPE : A_SHAPE;
  const q = fallbackQuality(quality, table);
  const base = kind === 'E' ? 4 : 9; // E 或 A 的音級
  let f = (shapeRoot - base + 12) % 12;
  if (f === 0) f = 12;
  const t = table[q];
  return {
    frets: t.o.map((x) => (x === null ? -1 : x + f)),
    fingers: t.fi.slice(),
    barre: { fret: f, from: kind === 'E' ? 0 : 1, to: 5 },
    barreFret: f,
  };
}

// 取得「指型」：shapeRoot 是加了移調夾之後手指實際按的和弦根音
export function getShape(shapeRoot, quality) {
  const name = NOTE_NAMES[shapeRoot] + qualitySuffix(quality);
  if (OPEN[name]) return { name, ...OPEN[name], open: true };
  // 次選：同根音的簡化開放和弦
  const simple = NOTE_NAMES[shapeRoot] + (['m', 'm7', 'dim'].includes(quality) ? 'm' : '');
  if (OPEN[simple] && quality !== 'maj' && quality !== 'm') {
    return { name: simple, ...OPEN[simple], open: true, simplified: true };
  }
  const e = buildBarre(shapeRoot, quality, 'E');
  const a = buildBarre(shapeRoot, quality, 'A');
  const pick = a.barreFret < e.barreFret ? a : e;
  return { name, ...pick, open: false };
}

// 該指型難度：0 開放、1 小橫按、3 大橫按
export function shapeCost(shape) {
  if (shape.open) return shape.miniBarre ? 1 : 0;
  return 3 + (shape.barreFret > 7 ? 1 : 0);
}

const FINGER_ZH = ['', '食指', '中指', '無名指', '小指'];
const STRING_NUM = ['第6弦', '第5弦', '第4弦', '第3弦', '第2弦', '第1弦'];

// 用中文描述按法
export function describeShape(shape) {
  const lines = [];
  if (shape.barre) {
    const from = 6 - shape.barre.from;
    lines.push(`食指(1)在第 ${shape.barre.fret} 格橫按 第${from}弦到第1弦`);
    shape.frets.forEach((fr, s) => {
      if (fr > 0 && shape.fingers[s] > 1) lines.push(`${FINGER_ZH[shape.fingers[s]]}(${shape.fingers[s]}) 按 ${STRING_NUM[s]} 第 ${fr} 格`);
    });
  } else {
    // 同一手指按多弦 = 小橫按
    const byFinger = {};
    shape.frets.forEach((fr, s) => {
      if (fr > 0 && shape.fingers[s] > 0) (byFinger[shape.fingers[s]] ||= []).push(s);
    });
    Object.keys(byFinger).sort().forEach((f) => {
      const ss = byFinger[f];
      const fr = shape.frets[ss[0]];
      if (ss.length > 1) lines.push(`${FINGER_ZH[f]}(${f}) 在第 ${fr} 格同時壓住 ${ss.map((s) => STRING_NUM[s]).join('、')}`);
      else lines.push(`${FINGER_ZH[f]}(${f}) 按 ${STRING_NUM[ss[0]]} 第 ${fr} 格`);
    });
  }
  const open = [];
  const mute = [];
  shape.frets.forEach((fr, s) => {
    if (fr === 0) open.push(STRING_NUM[s]);
    if (fr < 0) mute.push(STRING_NUM[s]);
  });
  if (open.length) lines.push(`空弦：${open.join('、')}`);
  if (mute.length) lines.push(`不彈：${mute.join('、')}`);
  return lines;
}
