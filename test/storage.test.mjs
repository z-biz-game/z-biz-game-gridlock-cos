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

test('a solve records both ledgers, the plays and the grades', () => {
  const s = fresh();
  eq(s.solve('kerb-01', { moves: 5, cells: 8, par: 5, parCell: 8, hints: 0 }),
    { solved: true, best: 5, bestCell: 8, plays: 1, perfect: true, perfectCell: true });
  const again = s.solve('kerb-01', { moves: 7, cells: 9, par: 5, parCell: 8, hints: 2 });
  eq([again.best, again.bestCell, again.plays], [5, 8, 2], 'a worse run keeps both records and counts the play');
  eq([again.perfect, again.perfectCell], [true, true], 'once you have matched a par on a lot you have done it');
  eq([s.stats.solves, s.stats.drags, s.stats.cells, s.stats.hints], [2, 12, 17, 2], 'the totals add up, in both senses');
  eq(s.stats.perfect, 1, 'only the unaided run counts as a perfect');
});

// A run has to be physically possible before it is a test: five drags that carry fourteen
// cells is a route, fourteen cells against a certified cell par of twelve is a lie, and
// asserting the second would grade our own arithmetic rather than the record keeping.
test('the two laws are graded against their own pars', () => {
  const s = fresh();
  const r = s.solve('kerb-09', { moves: 5, cells: 14, par: 5, parCell: 12, hints: 0 });
  eq([r.perfect, r.perfectCell], [true, false], 'matching the drag par says nothing about the cell par');
  eq([r.best, r.bestCell], [5, 14], 'and both numbers are still recorded');
  const better = s.solve('kerb-09', { moves: 8, cells: 12, par: 5, parCell: 12, hints: 4 });
  eq([better.best, better.bestCell], [5, 12], 'the cell record falls to the run that finally matches it');
  eq([better.perfect, better.perfectCell], [true, true], 'but it does earn the second flag');
  eq(s.stats.perfect, 1, 'the unaided drag run is the only perfect the tally counts');
});

test('the counting law is a preference, and an unknown one is refused', () => {
  const s = fresh();
  eq(s.law, 'drag', 'the classic card convention is the default');
  eq(s.setLaw('cell'), 'cell');
  eq(s.law, 'cell');
  eq(s.setLaw('triples'), 'cell', 'a law this game does not have never reaches the save');
  s.reset();
  eq(fresh().law, 'drag', 'and a wipe takes it back');
});

test('best only goes downwards', () => {
  const s = fresh();
  s.solve('lane-01', { moves: 12, cells: 20, par: 10, parCell: 18, hints: 0 });
  eq([s.record('lane-01').best, s.record('lane-01').bestCell], [12, 20]);
  s.solve('lane-01', { moves: 10, cells: 18, par: 10, parCell: 18, hints: 0 });
  eq([s.record('lane-01').best, s.record('lane-01').perfect], [10, true], 'matching par from above earns the flag');
  eq([s.record('lane-01').bestCell, s.record('lane-01').perfectCell], [18, true], 'and the cell flag is earned the same way');
  s.solve('lane-01', { moves: 14, cells: 19, par: 10, parCell: 18, hints: 0 });
  eq([s.record('lane-01').best, s.record('lane-01').bestCell], [10, 18], 'and a bad run cannot undo either record');
});

test('a par matched with help is a solve, not a perfect', () => {
  const s = fresh();
  const r = s.solve('kerb-02', { moves: 4, cells: 7, par: 4, parCell: 7, hints: 3 });
  eq([r.perfect, r.perfectCell], [true, true], 'the lot says you hit both pars');
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
  s.solve('kerb-01', { moves: 5, cells: 9, par: 5, parCell: 9, hints: 0 });
  s.unlock(4);
  s.markDaily('2026-09-27', 'kerb-01');
  s.reset();
  eq([s.records, s.daily, s.unlocked, s.stats], [{}, {}, 1, { solves: 0, perfect: 0, drags: 0, cells: 0, hints: 0 }]);
  ok(!store.record('kerb-01'), 'no trace left');
});

run();
