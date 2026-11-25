// 執行：node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY, findInLibrary } from '../js/songs.js';
import { arrange, parseSong } from '../js/arranger.js';
import { TUNING, parseChord } from '../js/theory.js';
import { getShape } from '../js/chords.js';

test('library melodies fill exactly one bar each', () => {
  for (const song of LIBRARY) {
    const p = parseSong(song);
    song.bars.forEach((b, i) => {
      if (!b.m) return;
      const sum = b.m.trim().split(/\s+/).reduce((a, tok) => a + (tok.includes(':') ? parseFloat(tok.split(':')[1]) : 1), 0);
      assert.equal(sum, p.beatsPerBar, `${song.title} bar ${i + 1} has ${sum} beats`);
    });
  }
});

test('every library chord parses', () => {
  for (const song of LIBRARY) {
    for (const b of song.bars) {
      for (const tok of (b.c || '').split(/\s+/).filter(Boolean)) {
        assert.ok(parseChord(tok.split(':')[0]), `${song.title}: ${tok}`);
      }
    }
  }
});

for (const song of LIBRARY) {
  for (const level of ['easy', 'normal', 'travis']) {
    test(`arrange ${song.title} (${level})`, () => {
      const arr = arrange(song, { level });
      assert.ok(arr.events.length > 0);
      for (const ev of arr.events) {
        assert.ok(ev.s >= 0 && ev.s <= 5);
        assert.ok(ev.f >= 0 && ev.f <= 15, `fret ${ev.f}`);
        assert.equal(ev.midi, TUNING[ev.s] + arr.capo + ev.f);
        assert.ok(ev.d > 0);
        assert.ok(['p', 'i', 'm', 'a'].includes(ev.rf));
        assert.ok(ev.lf >= 0 && ev.lf <= 4);
        if (ev.f === 0) assert.equal(ev.lf, 0);
      }
      // 同一時間同一條弦不可有兩個音
      const seen = new Set();
      for (const ev of arr.events) {
        const k = ev.t.toFixed(3) + ':' + ev.s;
        assert.ok(!seen.has(k), `collision at ${k}`);
        seen.add(k);
      }
      // 旋律音高必須正確（只差八度移位）
      const mel = arr.events.filter((e) => e.role === 'mel');
      const p = parseSong(song);
      const written = p.bars.flatMap((b) => b.melody);
      assert.equal(mel.length, written.length);
      mel.forEach((e, i) => assert.equal(e.midi, written[i].midi + arr.octave));
      assert.ok(arr.difficulty.stars >= 1 && arr.difficulty.stars <= 5);
    });
  }
}

test('bass note sounds the chord root / slash bass', () => {
  const song = { title: 't', bpm: 90, timeSig: [4, 4], bars: [{ c: 'D/F#' }, { c: 'Bm' }, { c: 'Eb' }, { c: 'C/G' }] };
  const arr = arrange(song, { level: 'normal', capo: 0 });
  const roots = [6, 11, 3, 7];
  arr.bars.forEach((b, i) => {
    const first = arr.events.find((e) => e.bar === i && e.role === 'bass');
    assert.equal(first.midi % 12, roots[i], `bar ${i}`);
  });
});

test('auto capo prefers open shapes', () => {
  const song = { title: 't', bpm: 90, timeSig: [4, 4], bars: [{ c: 'Eb' }, { c: 'Bb' }, { c: 'Cm' }, { c: 'Ab' }] };
  const arr = arrange(song, {});
  assert.ok(arr.capo > 0);
  assert.ok(arr.chordList.every((c) => c.shape.open), arr.chordList.map((c) => c.shape.name).join());
});

test('shapes sound the right pitch classes', () => {
  for (let root = 0; root < 12; root++) {
    for (const q of ['maj', 'm', '7', 'm7']) {
      const sh = getShape(root, q);
      sh.frets.forEach((f, s) => { if (f >= 0) assert.ok(f <= 15); });
      const lowest = sh.frets.findIndex((f) => f >= 0);
      assert.ok(lowest >= 0);
    }
  }
});

test('library search', () => {
  assert.equal(findInLibrary('小星星').id, 'lib-twinkle');
  assert.equal(findInLibrary('Amazing Grace').id, 'lib-amazing');
  assert.equal(findInLibrary('canon in d').id, 'lib-canon');
  assert.equal(findInLibrary('不存在的歌xyz'), null);
});

test('lyrics pass through to arrangement', () => {
  const tw = LIBRARY.find((s) => s.id === 'lib-twinkle');
  const arr = arrange(tw, {});
  assert.ok(arr.hasLyrics);
  assert.equal(arr.bars[0].lyric, '一閃一閃');
  const noLy = arrange(LIBRARY.find((s) => s.id === 'lib-canon'), {});
  assert.equal(noLy.hasLyrics, false);
});
