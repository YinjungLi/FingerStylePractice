// SVG 繪圖：六線譜、和弦圖、即時指板
const SVGNS = 'http://www.w3.org/2000/svg';
const STRING_GAP = 15;
const TOP = 40;
const BASE_H = TOP + STRING_GAP * 5 + 28;
const LYRIC_H = 20;
const LEFT = 26;

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------- 六線譜 ----------
export class TabView {
  constructor(container, { onBarClick } = {}) {
    this.container = container;
    this.onBarClick = onBarClick;
    this.noteEls = [];
    this.lit = new Set();
    this.showFingers = true;
  }

  render(arr) {
    this.arr = arr;
    const c = this.container;
    c.innerHTML = '';
    const width = Math.max(280, c.clientWidth || 600);
    const bpb = arr.beatsPerBar;
    const density = arr.level === 'easy' && !arr.hasMelody ? 30 : 40;
    this.barsPerLine = Math.max(1, Math.min(4, Math.floor((width - LEFT - 6) / (bpb * density))));
    this.barW = (width - LEFT - 6) / this.barsPerLine;
    this.width = width;
    const LINE_H = BASE_H + (arr.hasLyrics ? LYRIC_H : 0);
    const nLines = Math.ceil(arr.bars.length / this.barsPerLine);
    this.lines = [];
    this.noteEls = new Array(arr.events.length);
    for (let li = 0; li < nLines; li++) {
      const svg = el('svg', { width, height: LINE_H, viewBox: `0 0 ${width} ${LINE_H}`, class: 'tab-line' });
      const b0 = li * this.barsPerLine;
      const b1 = Math.min(arr.bars.length, b0 + this.barsPerLine);
      // TAB 字樣
      ['T', 'A', 'B'].forEach((ch, k) => svg.appendChild(el('text', { x: 9, y: TOP + 18 + k * 18, class: 'tab-clef' }, ch)));
      const lineW = LEFT + (b1 - b0) * this.barW;
      for (let s = 0; s < 6; s++) {
        const y = TOP + (5 - s) * STRING_GAP;
        svg.appendChild(el('line', { x1: LEFT, x2: lineW, y1: y, y2: y, class: 'tab-string' }));
      }
      for (let b = b0; b < b1; b++) {
        const x = LEFT + (b - b0) * this.barW;
        const bar = arr.bars[b];
        const hit = el('rect', { x, y: 0, width: this.barW, height: LINE_H, class: 'bar-hit', 'data-bar': b });
        hit.addEventListener('click', () => this.onBarClick && this.onBarClick(b));
        svg.appendChild(hit);
        svg.appendChild(el('line', { x1: x, x2: x, y1: TOP, y2: TOP + STRING_GAP * 5, class: 'tab-barline' }));
        svg.appendChild(el('text', { x: x + 2, y: TOP - 6, class: 'bar-num' }, String(b + 1)));
        if (bar.sec) svg.appendChild(el('text', { x: x + 2, y: 11, class: 'sec-label' }, bar.sec));
        if (bar.lyric) {
          const ly = el('text', { x: x + 8, y: BASE_H + 12, class: 'lyric' }, bar.lyric);
          // 歌詞太長時壓縮到小節寬度內
          const est = [...bar.lyric].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 13 : 7), 0);
          if (est > this.barW - 12) { ly.setAttribute('textLength', this.barW - 12); ly.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
          svg.appendChild(ly);
        }
        for (const sg of bar.segments) {
          const cx = this.beatX(b, sg.start) - 4;
          svg.appendChild(el('text', { x: cx, y: 25, class: 'chord-name' }, sg.chord.name));
        }
        // 拍點
        for (let k = 0; k < bpb; k++) {
          svg.appendChild(el('line', { x1: this.beatX(b, k), x2: this.beatX(b, k), y1: TOP + STRING_GAP * 5 + 4, y2: TOP + STRING_GAP * 5 + 8, class: 'beat-tick' }));
        }
      }
      svg.appendChild(el('line', { x1: lineW, x2: lineW, y1: TOP, y2: TOP + STRING_GAP * 5, class: 'tab-barline' + (b1 === arr.bars.length ? ' end' : '') }));
      const head = el('line', { x1: 0, x2: 0, y1: TOP - 4, y2: TOP + STRING_GAP * 5 + 4, class: 'playhead', visibility: 'hidden' });
      svg.appendChild(head);
      const wrap = document.createElement('div');
      wrap.className = 'tab-line-wrap';
      wrap.appendChild(svg);
      c.appendChild(wrap);
      this.lines.push({ svg, head, wrap, b0, b1 });
    }
    // 音符
    arr.events.forEach((ev, i) => {
      const li = Math.floor(ev.bar / this.barsPerLine);
      const line = this.lines[li];
      const x = this.beatX(ev.bar, ev.t - arr.bars[ev.bar].start);
      const y = TOP + (5 - ev.s) * STRING_GAP;
      const g = el('g', { class: `note rf-${ev.rf} role-${ev.role}` });
      const label = String(ev.f);
      const w = label.length > 1 ? 15 : 9;
      g.appendChild(el('rect', { x: x - w / 2, y: y - 7, width: w, height: 14, rx: 3, class: 'note-bg' }));
      g.appendChild(el('text', { x, y: y + 4.5, class: 'note-fret' }, label));
      if (ev.lf > 0) g.appendChild(el('text', { x: x + w / 2 + 0.5, y: y + 8, class: 'note-lf' }, String(ev.lf)));
      line.svg.appendChild(g);
      this.noteEls[i] = g;
    });
    // 右手指法列（在譜下方）
    const seen = new Map();
    arr.events.forEach((ev) => {
      const key = ev.t.toFixed(3);
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(ev);
    });
    for (const [, evs] of seen) {
      const ev = evs[0];
      const li = Math.floor(ev.bar / this.barsPerLine);
      const x = this.beatX(ev.bar, ev.t - arr.bars[ev.bar].start);
      const txt = evs.map((e) => e.rf).filter((v, i, a) => a.indexOf(v) === i).join('');
      this.lines[li].svg.appendChild(el('text', { x, y: TOP + STRING_GAP * 5 + 20, class: 'rh-label' }, txt));
    }
    this.setShowFingers(this.showFingers);
  }

  setShowFingers(on) {
    this.showFingers = on;
    this.container.classList.toggle('hide-fingers', !on);
  }

  beatX(bar, beatInBar) {
    const li = Math.floor(bar / this.barsPerLine);
    const col = bar - li * this.barsPerLine;
    const pad = 12;
    return LEFT + col * this.barW + pad + (beatInBar / this.arr.beatsPerBar) * (this.barW - pad * 1.6);
  }

  update(beat, autoScroll) {
    if (!this.arr) return;
    const arr = this.arr;
    const bar = Math.floor(beat / arr.beatsPerBar);
    const li = Math.floor(bar / this.barsPerLine);
    this.lines.forEach((l, i) => l.head.setAttribute('visibility', i === li && beat >= 0 && bar < arr.bars.length ? 'visible' : 'hidden'));
    if (beat >= 0 && bar < arr.bars.length && this.lines[li]) {
      const x = this.beatX(bar, beat - bar * arr.beatsPerBar);
      const h = this.lines[li].head;
      h.setAttribute('x1', x);
      h.setAttribute('x2', x);
      if (autoScroll && this.curLine !== li) {
        this.curLine = li;
        const wrap = this.lines[li].wrap;
        const r = wrap.getBoundingClientRect();
        const vh = window.innerHeight;
        if (r.top < 120 || r.bottom > vh - 240) {
          window.scrollBy({ top: r.top - 90, behavior: 'smooth' });
        }
      }
    }
    // 亮起正在發聲的音
    const now = new Set();
    arr.events.forEach((ev, i) => {
      if (beat >= ev.t - 0.02 && beat < ev.t + Math.max(0.25, Math.min(ev.d, 1))) now.add(i);
    });
    for (const i of this.lit) if (!now.has(i)) this.noteEls[i]?.classList.remove('on');
    for (const i of now) if (!this.lit.has(i)) this.noteEls[i]?.classList.add('on');
    this.lit = now;
  }

  setLoopRange(start, end) {
    this.lines.forEach((l) => {
      l.svg.querySelectorAll('.bar-hit').forEach((r) => {
        const b = +r.getAttribute('data-bar');
        r.classList.toggle('in-loop', start !== null && b >= start && b <= end);
      });
    });
  }
}

// ---------- 和弦圖 ----------
export function chordDiagram(shape, name) {
  const W = 110;
  const H = 130;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chord-svg' });
  const pos = shape.frets.filter((f) => f > 0);
  const maxF = pos.length ? Math.max(...pos) : 3;
  const minF = pos.length ? Math.min(...pos) : 1;
  const base = maxF <= 4 ? 1 : minF;
  const x0 = 20;
  const y0 = 32;
  const sg = 15;
  const fg = 20;
  svg.appendChild(el('text', { x: W / 2, y: 13, class: 'cd-name' }, name));
  for (let s = 0; s < 6; s++) svg.appendChild(el('line', { x1: x0 + s * sg, x2: x0 + s * sg, y1: y0, y2: y0 + fg * 4, class: 'cd-string' }));
  for (let f = 0; f <= 4; f++) svg.appendChild(el('line', { x1: x0, x2: x0 + 5 * sg, y1: y0 + f * fg, y2: y0 + f * fg, class: f === 0 && base === 1 ? 'cd-nut' : 'cd-fret' }));
  if (base > 1) svg.appendChild(el('text', { x: x0 - 6, y: y0 + fg * 0.5 + 4, class: 'cd-base' }, `${base}`));
  if (shape.barre) {
    const by = y0 + (shape.barre.fret - base + 0.5) * fg;
    svg.appendChild(el('rect', { x: x0 + shape.barre.from * sg - 6, y: by - 6, width: (shape.barre.to - shape.barre.from) * sg + 12, height: 12, rx: 6, class: 'cd-barre' }));
  }
  shape.frets.forEach((f, s) => {
    const x = x0 + s * sg;
    if (f < 0) svg.appendChild(el('text', { x, y: y0 - 6, class: 'cd-mark' }, '×'));
    else if (f === 0) svg.appendChild(el('circle', { cx: x, cy: y0 - 10, r: 4, class: 'cd-open' }));
    else {
      const y = y0 + (f - base + 0.5) * fg;
      svg.appendChild(el('circle', { cx: x, cy: y, r: 7, class: 'cd-dot' }));
      if (shape.fingers[s]) svg.appendChild(el('text', { x, y: y + 4, class: 'cd-finger' }, String(shape.fingers[s])));
    }
  });
  ['E', 'A', 'D', 'G', 'B', 'e'].forEach((n, s) => svg.appendChild(el('text', { x: x0 + s * sg, y: y0 + fg * 4 + 14, class: 'cd-sname' }, n)));
  return svg;
}

// ---------- 即時指板 ----------
export class Fretboard {
  constructor(container) {
    this.container = container;
    this.frets = 12;
    this.key = '';
  }

  setup(maxFret, capo) {
    this.frets = Math.max(5, Math.min(15, maxFret + 1));
    this.capo = capo;
    const W = 640;
    const H = 150;
    this.W = W;
    this.H = H;
    this.x0 = 44;
    this.y0 = 22;
    this.sg = 20;
    this.fw = (W - this.x0 - 12) / this.frets;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'fb-svg', preserveAspectRatio: 'xMidYMid meet' });
    svg.appendChild(el('rect', { x: this.x0, y: this.y0 - 8, width: W - this.x0 - 12, height: this.sg * 5 + 16, class: 'fb-wood', rx: 3 }));
    [3, 5, 7, 9, 12, 15].filter((f) => f <= this.frets).forEach((f) => {
      const cx = this.fx(f);
      if (f === 12) {
        svg.appendChild(el('circle', { cx, cy: this.y0 + this.sg * 1.5, r: 4, class: 'fb-inlay' }));
        svg.appendChild(el('circle', { cx, cy: this.y0 + this.sg * 3.5, r: 4, class: 'fb-inlay' }));
      } else svg.appendChild(el('circle', { cx, cy: this.y0 + this.sg * 2.5, r: 4, class: 'fb-inlay' }));
      svg.appendChild(el('text', { x: cx, y: H - 4, class: 'fb-fretnum' }, String(f)));
    });
    for (let f = 0; f <= this.frets; f++) {
      const x = this.x0 + f * this.fw;
      svg.appendChild(el('line', { x1: x, x2: x, y1: this.y0 - 8, y2: this.y0 + this.sg * 5 + 8, class: f === 0 ? 'fb-nut' : 'fb-fret' }));
    }
    if (capo) svg.appendChild(el('text', { x: this.x0 + 2, y: this.y0 - 11, class: 'fb-capo' }, `Capo ${capo}`));
    this.strings = [];
    for (let s = 0; s < 6; s++) {
      const y = this.sy(s);
      const ln = el('line', { x1: this.x0, x2: W - 12, y1: y, y2: y, class: 'fb-string', 'stroke-width': 0.9 + (5 - s) * 0.35 });
      svg.appendChild(ln);
      svg.appendChild(el('text', { x: 10, y: y + 4, class: 'fb-sname' }, ['E', 'A', 'D', 'G', 'B', 'e'][s]));
      this.strings.push(ln);
    }
    this.ghost = el('g', { class: 'fb-ghost' });
    this.live = el('g', { class: 'fb-live' });
    svg.appendChild(this.ghost);
    svg.appendChild(this.live);
    this.container.innerHTML = '';
    this.container.appendChild(svg);
    this.key = '';
    this.shapeKey = '';
  }

  fx(f) { return f === 0 ? this.x0 - 12 : this.x0 + (f - 0.5) * this.fw; }
  sy(s) { return this.y0 + (5 - s) * this.sg; }

  showShape(shape, name) {
    const k = name || '';
    if (k === this.shapeKey) return;
    this.shapeKey = k;
    this.ghost.innerHTML = '';
    if (!shape) return;
    shape.frets.forEach((f, s) => {
      if (f < 0) {
        this.ghost.appendChild(el('text', { x: this.x0 - 12, y: this.sy(s) + 4, class: 'fb-mute' }, '×'));
        return;
      }
      if (f === 0) return;
      this.ghost.appendChild(el('circle', { cx: this.fx(f), cy: this.sy(s), r: 8, class: 'fb-ghost-dot' }));
      if (shape.fingers[s]) this.ghost.appendChild(el('text', { x: this.fx(f), y: this.sy(s) + 4, class: 'fb-ghost-num' }, String(shape.fingers[s])));
    });
  }

  showNotes(evs) {
    const key = evs.map((e) => `${e.s}:${e.f}:${e.t}`).join('|');
    if (key === this.key) return;
    this.key = key;
    this.live.innerHTML = '';
    const sounding = new Set(evs.map((e) => e.s));
    this.strings.forEach((ln, s) => ln.classList.toggle('vib', sounding.has(s)));
    for (const e of evs) {
      const cx = this.fx(e.f);
      const cy = this.sy(e.s);
      this.live.appendChild(el('circle', { cx, cy, r: 9.5, class: `fb-dot rf-${e.rf}` }));
      this.live.appendChild(el('text', { x: cx, y: cy + 4, class: 'fb-dot-num' }, e.f === 0 ? 'o' : String(e.lf || '')));
      this.live.appendChild(el('text', { x: this.W - 6, y: cy + 4, class: `fb-rh rf-${e.rf}` }, e.rf));
    }
  }
}
