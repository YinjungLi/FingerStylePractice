// 音訊引擎：Karplus-Strong 撥弦合成 + 精準排程器 + 節拍器
import { midiToFreq } from './theory.js';

const LOOKAHEAD = 0.15; // 秒
const TICK_MS = 25;

export class Player {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.events = [];
    this.totalBeats = 0;
    this.beatsPerBar = 4;
    this.bpm = 90;
    this.playing = false;
    this.metronomeOn = false;
    this.metronomeOnly = false;
    this.countIn = true;
    this.loop = null; // {start, end}
    this.anchors = [];
    this.active = [];
    this.timer = null;
    this.pausedBeat = 0;
    this.onEnd = null;
    this.onLoop = null; // 回傳新的 bpm（漸進加速）
    this.guitarVolume = 0.9;
    this.clickVolume = 0.6;
  }

  ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      const body = this.ctx.createBiquadFilter();
      body.type = 'peaking';
      body.frequency.value = 180;
      body.Q.value = 1;
      body.gain.value = 3;
      const tone = this.ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 5200;
      this.guitarBus = this.ctx.createGain();
      this.guitarBus.gain.value = this.guitarVolume;
      this.clickBus = this.ctx.createGain();
      this.clickBus.gain.value = this.clickVolume;
      this.guitarBus.connect(body).connect(tone).connect(comp);
      this.clickBus.connect(comp);
      comp.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setGuitarVolume(v) { this.guitarVolume = v; if (this.guitarBus) this.guitarBus.gain.value = v; }
  setClickVolume(v) { this.clickVolume = v; if (this.clickBus) this.clickBus.gain.value = v; }

  // Karplus-Strong：用雜訊激發延遲線，平均濾波模擬弦的能量衰減
  pluckBuffer(midi) {
    if (this.buffers.has(midi)) return this.buffers.get(midi);
    const ctx = this.ensureCtx();
    const sr = ctx.sampleRate;
    const freq = midiToFreq(midi);
    const dur = Math.max(1.6, 4.2 - (midi - 40) * 0.07);
    const len = Math.floor(sr * dur);
    const period = sr / freq;
    const N = Math.max(2, Math.floor(period));
    const frac = period - N; // 分數延遲用一階全通濾波修正音準
    const apC = (1 - frac) / (1 + frac);
    const line = new Float32Array(N);
    for (let i = 0; i < N; i++) line[i] = Math.random() * 2 - 1;
    // 讓初始雜訊柔和一點（指肉撥弦的感覺）
    for (let pass = 0; pass < 2; pass++) for (let i = 1; i < N; i++) line[i] = 0.5 * (line[i] + line[i - 1]);
    let mean = 0;
    for (let i = 0; i < N; i++) mean += line[i];
    mean /= N;
    for (let i = 0; i < N; i++) line[i] -= mean;
    const t60 = Math.max(1.2, 3.8 - (midi - 40) * 0.06);
    const rho = Math.pow(10, -3 / (t60 * freq));
    const buffer = ctx.createBuffer(1, len, sr);
    const out = buffer.getChannelData(0);
    let idx = 0;
    let apX = 0;
    let apY = 0;
    let peak = 0;
    for (let n = 0; n < len; n++) {
      const cur = line[idx];
      const nxt = line[(idx + 1) % N];
      const avg = rho * 0.5 * (cur + nxt);
      const y = apC * avg + apX - apC * apY;
      apX = avg;
      apY = y;
      line[idx] = y;
      out[n] = cur;
      const a = Math.abs(cur);
      if (a > peak) peak = a;
      idx = (idx + 1) % N;
    }
    const norm = peak > 0 ? 0.9 / peak : 1;
    const fadeIn = Math.min(64, len);
    for (let n = 0; n < len; n++) out[n] *= norm * (n < fadeIn ? n / fadeIn : 1);
    this.buffers.set(midi, buffer);
    return buffer;
  }

  load(arr, bpm) {
    this.stop();
    this.events = arr.events.slice().sort((a, b) => a.t - b.t);
    this.totalBeats = arr.totalBeats;
    this.beatsPerBar = arr.beatsPerBar;
    this.bpm = bpm;
    this.pausedBeat = 0;
  }

  prepare() {
    this.ensureCtx();
    const midis = new Set(this.events.map((e) => e.midi));
    midis.forEach((m) => this.pluckBuffer(m));
  }

  get spb() { return 60 / this.bpm; }

  playNote(ev, when, spb) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.pluckBuffer(ev.midi);
    const g = ctx.createGain();
    const vol = (ev.vel ?? 0.8) * 0.42;
    g.gain.setValueAtTime(vol, when);
    const stopAt = when + Math.max(0.08, ev.d * spb);
    g.gain.setTargetAtTime(0, stopAt, 0.05);
    src.connect(g).connect(this.guitarBus);
    src.start(when);
    src.stop(stopAt + 0.4);
    this.active.push({ src, g, end: stopAt + 0.4 });
  }

  click(when, accent, countIn) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1760 : 1180;
    if (countIn) osc.frequency.value = accent ? 2000 : 1500;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(g).connect(this.clickBus);
    osc.start(when);
    osc.stop(when + 0.06);
    this.active.push({ src: osc, g, end: when + 0.06 });
  }

  lowerBound(beat) {
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].t < beat - 1e-6) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // 從第 fromBeat 拍開始播放
  play(fromBeat = this.pausedBeat) {
    const ctx = this.ensureCtx();
    this.halt();
    this.metronomeOnly = false;
    if (this.loop && (fromBeat < this.loop.start || fromBeat >= this.loop.end)) fromBeat = this.loop.start;
    if (fromBeat >= this.totalBeats) fromBeat = 0;
    const start = ctx.currentTime + 0.08;
    const pre = this.countIn ? this.beatsPerBar : 0;
    this.anchors = [{ ctx: start, beat: fromBeat - pre, spb: this.spb }];
    this.schedBeat = fromBeat - pre;
    this.playFrom = fromBeat;
    this.evIdx = this.lowerBound(fromBeat);
    this.endAt = null;
    this.playing = true;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  // 只開節拍器（沒有播放歌曲時）
  startMetronomeOnly() {
    const ctx = this.ensureCtx();
    this.halt();
    this.metronomeOnly = true;
    this.anchors = [{ ctx: ctx.currentTime + 0.05, beat: 0, spb: this.spb }];
    this.schedBeat = 0;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  tick() {
    const ctx = this.ctx;
    const horizon = ctx.currentTime + LOOKAHEAD;
    for (let guard = 0; guard < 8; guard++) {
      const a = this.anchors[this.anchors.length - 1];
      const beatHorizon = a.beat + (horizon - a.ctx) / a.spb;
      const end = this.metronomeOnly ? Infinity : this.loop ? this.loop.end : this.totalBeats;
      if (this.endAt !== null && this.endAt !== undefined) break;
      const limit = Math.min(beatHorizon, end);
      // 節拍器
      const firstTick = Math.ceil(this.schedBeat - 1e-6);
      for (let k = firstTick; k < limit - 1e-6; k++) {
        const isCount = !this.metronomeOnly && k < this.playFrom;
        if (this.metronomeOn || isCount) {
          const when = a.ctx + (k - a.beat) * a.spb;
          const barPos = ((k % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar;
          if (when >= ctx.currentTime - 0.01) this.click(when, barPos === 0, isCount);
        }
      }
      // 音符
      if (!this.metronomeOnly) {
        while (this.evIdx < this.events.length && this.events[this.evIdx].t < limit - 1e-6) {
          const ev = this.events[this.evIdx];
          if (ev.t >= this.schedBeat - 1e-6) {
            const when = a.ctx + (ev.t - a.beat) * a.spb;
            if (when >= ctx.currentTime - 0.02) this.playNote(ev, Math.max(when, ctx.currentTime), a.spb);
          }
          this.evIdx++;
        }
      }
      this.schedBeat = limit;
      if (beatHorizon < end) break;
      // 到達結尾
      const endTime = a.ctx + (end - a.beat) * a.spb;
      if (this.loop) {
        const newBpm = this.onLoop ? this.onLoop() : null;
        if (newBpm) this.bpm = newBpm;
        this.anchors.push({ ctx: endTime, beat: this.loop.start, spb: this.spb });
        this.schedBeat = this.loop.start;
        this.playFrom = this.loop.start;
        this.evIdx = this.lowerBound(this.loop.start);
      } else {
        this.endAt = endTime;
        break;
      }
    }
    if (this.endAt && ctx.currentTime >= this.endAt + 0.1) {
      this.halt();
      this.pausedBeat = 0;
      if (this.onEnd) this.onEnd();
    }
    const now = ctx.currentTime;
    if (this.active.length > 64) this.active = this.active.filter((n) => n.end > now);
    if (this.anchors.length > 4) this.anchors = this.anchors.filter((x, i) => i >= this.anchors.length - 2 || x.ctx > now - 1);
  }

  currentBeat() {
    if (!this.ctx || !this.anchors.length || (!this.playing && !this.metronomeOnly)) return this.pausedBeat;
    const now = this.ctx.currentTime;
    let a = this.anchors[0];
    for (const x of this.anchors) if (x.ctx <= now) a = x;
    return a.beat + (now - a.ctx) / a.spb;
  }

  setTempo(bpm) {
    if (bpm === this.bpm) return;
    if ((this.playing || this.metronomeOnly) && this.anchors.length) {
      // 在已排程位置建立新錨點，無縫換速
      const a = this.anchors[this.anchors.length - 1];
      const t = a.ctx + (this.schedBeat - a.beat) * a.spb;
      this.bpm = bpm;
      this.anchors.push({ ctx: t, beat: this.schedBeat, spb: this.spb });
    } else {
      this.bpm = bpm;
    }
  }

  // 停止排程並靜音所有聲音（不重設位置）
  halt() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const wasPlaying = this.playing;
    this.playing = false;
    this.metronomeOnly = false;
    if (this.ctx) {
      const now = this.ctx.currentTime;
      for (const n of this.active) {
        try {
          n.g.gain.cancelScheduledValues(now);
          n.g.gain.setTargetAtTime(0, now, 0.015);
          n.src.stop(now + 0.1);
        } catch (e) { /* 已經停止 */ }
      }
    }
    this.active = [];
    return wasPlaying;
  }

  pause() {
    const b = this.currentBeat();
    this.halt();
    this.pausedBeat = Math.max(0, Math.min(this.totalBeats, b));
  }

  stop() {
    this.halt();
    this.pausedBeat = this.loop ? this.loop.start : 0;
  }

  seek(beat) {
    const was = this.playing;
    this.halt();
    this.pausedBeat = beat;
    if (was) this.play(beat);
  }
}
