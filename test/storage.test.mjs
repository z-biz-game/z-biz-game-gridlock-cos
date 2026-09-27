// The save file. Node has no localStorage, so this suite runs entirely on the fallback
// path — which is the path a private window, a file:// open, and a blocked third-party
// context take. Crashing there would lose the game, so it gets tested on purpose.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { store } from '../js/core/storage.js';

const fresh = () => { store.reset(); return store; };

test('there is no browser here, and the save does not notice', () => {
  eq(typeof window, 'undefined', 'this suite is the memory-only path');
  const s = fresh();
  eq([s.records, s.unlocked, s.stats.solves], [{}, 1, 0], 'a blank save is blank');
  eq(s.record('nothing-yet'), null);
  eq(s.dailyDone('2026-09-27'), null);
});

test('a solve records the score, the plays and the grade', () => {
  const s = fresh();
  eq(s.solve('kerb-01', { moves: 5, par: 5, hints: 0 }), { solved: true, best: 5, plays: 1, perfect: true });
  const again = s.solve('kerb-01', { moves: 7, par: 5, hints: 2 });
  eq([again.best, again.plays], [5, 2], 'a worse run keeps the record and counts the play');
  eq(again.perfect, true, 'once you have matched par on a lot you have done it');
  eq([s.stats.solves, s.stats.drags, s.stats.hints], [2, 12, 2], 'the totals add up, in both senses');
  eq(s.stats.perfect, 1, 'only the unaided run counts as a perfect');
});

test('best only goes downwards', () => {
  const s = fresh();
  s.solve('lane-01', { moves: 12, par: 10, hints: 0 });
  eq(s.record('lane-01').best, 12);
  s.solve('lane-01', { moves: 10, par: 10, hints: 0 });
  eq([s.record('lane-01').best, s.record('lane-01').perfect], [10, true], 'matching par from above earns the flag');
  s.solve('lane-01', { moves: 14, par: 10, hints: 0 });
  eq(s.record('lane-01').best, 10, 'and a bad run cannot undo it');
});

test('a par matched with help is a solve, not a perfect', () => {
  const s = fresh();
  eq(s.solve('kerb-02', { moves: 4, par: 4, hints: 3 }).perfect, true, 'the lot says you hit par');
  eq(s.stats.perfect, 0, 'the tally knows you had a navigator');
  eq(s.record('kerb-02').perfect, true);
});

test('unlocking the campaign is monotone', () => {
  const s = fresh();
  eq(s.unlock(6), 6);
  eq(s.unlock(2), 6, 'replaying level two does not lock the back half away');
  eq(s.unlock(9), 9);
  eq(s.unlocked, 9);
});

test('the daily log keeps one entry per day', () => {
  const s = fresh();
  s.markDaily('2026-09-27', 'lane-04');
  eq(s.dailyDone('2026-09-27').id, 'lane-04');
  eq(s.dailyDone('2026-09-26'), null, 'yesterday is its own puzzle');
  s.markDaily('2026-09-27', 'lane-09');
  eq(s.dailyDone('2026-09-27').id, 'lane-09', 'replaying today overwrites today');
});

test('reset really is a wipe', () => {
  const s = fresh();
  s.solve('kerb-01', { moves: 5, par: 5, hints: 0 });
  s.unlock(4);
  s.markDaily('2026-09-27', 'kerb-01');
  s.reset();
  eq([s.records, s.daily, s.unlocked, s.stats], [{}, {}, 1, { solves: 0, perfect: 0, drags: 0, hints: 0 }]);
  ok(!store.record('kerb-01'), 'no trace left');
});

run();
