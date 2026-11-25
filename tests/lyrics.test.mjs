import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSynced, lyricLines, guessBars, applyLyrics } from '../js/lyrics.js';

const LRC = '[00:10.00] 第一句\n[00:14.00] 第二句\n[00:14.50]\n[00:22.00] 第三句\n[00:40.00][01:20.00] 重複句';

test('parseSynced reads timestamps, skips empty lines, expands repeats', () => {
  const l = parseSynced(LRC);
  assert.deepEqual(l.map((x) => x.text), ['第一句', '第二句', '第三句', '重複句', '重複句']);
  assert.equal(l[0].t, 10);
  assert.equal(l[4].t, 80);
});

test('plain lyrics fallback', () => {
  const l = lyricLines({ synced: '', plain: 'a\n\nb\n' });
  assert.deepEqual(l, [{ t: null, text: 'a' }, { t: null, text: 'b' }]);
});

test('guessBars starts after intro and follows timing', () => {
  // 120 BPM 4/4 → 2 秒一小節
  const song = { bpm: 120, bars: [{ sec: '前奏' }, {}, { sec: '主歌' }, {}, {}, {}, {}, {}] };
  const lines = parseSynced(LRC);
  const bars = guessBars(lines, song, 8, 4);
  assert.equal(bars[0], 3); // 第一句放在主歌
  assert.equal(bars[1], 5); // +4 秒 = +2 小節
  assert.equal(bars[2], 9 > 8 ? 0 : 9); // 超出範圍 → 不顯示
  assert.ok(bars.every((b) => b >= 0 && b <= 8));
});

test('applyLyrics merges lines into bars and keeps the alignment', () => {
  const song = { bars: [{ c: 'C' }, { c: 'G', l: 'old' }, { c: 'Am' }] };
  applyLyrics(song, [{ text: 'x', t: 1 }, { text: 'y', t: 2 }, { text: 'z', t: 3 }], [1, 1, 0]);
  assert.equal(song.bars[0].l, 'x / y');
  assert.equal(song.bars[1].l, undefined);
  assert.equal(song.lyricLines.length, 3);
});
