// The model: what a lot is, and what a legal drag is.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { CHAIN, CLEAR } from './fixture.mjs';
import {
  compile, encode, decode, occupancy, cellsOf, reach, eachMove, moves,
  exitBlocked, solved, validate, toSpec, H, V,
} from '../js/core/lot.js';

test('compile types the lot and finds the hero', () => {
  const c = compile(CHAIN);
  eq(c.hero, 0, 'hero index');
  eq([...c.axis], [H, V, H, H, V], 'axis per car');
  eq([...c.cross], [2, 2, 4, 0, 4], 'cross coordinate: h cars store y, v cars store x');
  eq([...c.start], [0, 1, 1, 2, 3], 'along-axis start');
});

test('a lot needs exactly one hero, horizontal, on the exit row', () => {
  eq(validate(CHAIN), null, 'the fixture must be clean');
  ok(/no hero/.test(validate({ ...CHAIN, cars: CHAIN.cars.map((c) => ({ ...c, hero: undefined })) })), 'no hero');
  const pair = {
    w: 6, h: 6, exitRow: 2, walls: [],
    cars: [{ x: 0, y: 2, len: 2, axis: 'h', hero: true }, { x: 3, y: 2, len: 2, axis: 'h', hero: true }],
  };
  ok(/more than one hero/.test(validate(pair)), 'two heroes');
  ok(/hero must be horizontal/.test(validate({
    ...CHAIN,
    cars: [{ x: 0, y: 2, len: 2, axis: 'v', hero: true }, { x: 2, y: 2, len: 2, axis: 'h' }],
  })), 'vertical hero');
  ok(/exit row/.test(validate({ ...CHAIN, cars: [{ ...CHAIN.cars[0], y: 1 }, ...CHAIN.cars.slice(1)] })), 'hero off the lane');
});

test('validate catches overlap, overhang and a car that is one cell long', () => {
  ok(/overlap/.test(validate({ ...CHAIN, cars: [CHAIN.cars[0], { ...CHAIN.cars[0] }, ...CHAIN.cars.slice(2)] })), 'overlap');
  ok(/sticking out/.test(validate({ ...CHAIN, cars: [{ ...CHAIN.cars[0], x: 5 }, ...CHAIN.cars.slice(1)] })), 'overhang');
  ok(/length out of range/.test(validate({ ...CHAIN, cars: [{ ...CHAIN.cars[0], len: 1 }, ...CHAIN.cars.slice(1)] })), 'len 1');
  ok(/wall outside/.test(validate({ ...CHAIN, walls: [{ x: 6, y: 0 }] })), 'wall off-grid');
});

test('two cars cannot share a cell, and occupancy says who is where', () => {
  const c = compile(CHAIN);
  const occ = occupancy(c, c.start);
  eq(occ.length, 36);
  eq(occ.reduce((a, b) => a + b, 0), 2 + 2 + 3 + 2 + 3, 'every car cell marked exactly once');
  for (let i = 0; i < c.n; i++) {
    for (const cell of cellsOf(c, i, c.start[i])) {
      eq(occ[cell.y * c.w + cell.x], 1, `car ${i} cell ${cell.x},${cell.y}`);
    }
  }
});

test('encode/decode round-trips a position in one char per car', () => {
  const c = compile(CHAIN);
  const p = Uint8Array.from([3, 0, 2, 4, 1]);
  eq([...decode(encode(p), p.length)], [...p]);
});

test('reach measures the slack on both sides, and a slide of any length is one move', () => {
  const c = compile(CHAIN);
  const occ = occupancy(c, c.start);
  eq(reach(c, occ, 0, c.start[0]), [0, 0], 'the hero is pinched: wall on the left, the blocker on the right');
  eq(reach(c, occ, 1, c.start[1]), [0, 1], 'the pin can creep one cell down — and still cover the lane doing it');
  eq(reach(c, occ, 2, c.start[2]), [1, 0], 'B can give one cell left, and no room right');
  eq(reach(c, occ, 3, c.start[3]), [2, 2], 'C can slide two cells each way');
  const mv = moves(c, c.start);
  eq(mv.filter((m) => m.car === 3).length, 4, 'two cells each way is four one-move drags');
  eq(mv.length, 9, 'hero 0 + pin 1 + B 1 + C 4 + D 3');
  let n = 0;
  eachMove(c, c.start, () => n++);
  eq(n, mv.length, 'eachMove and moves agree');
});

test('a clear lane is not an escaped hero', () => {
  const c = compile(CHAIN);
  ok(exitBlocked(c, c.start), 'fixture starts blocked');
  const open = Uint8Array.from(c.start);
  open[3] = 0; // C gives up the corner
  open[1] = 0; // the pin steps up out of the lane
  ok(!exitBlocked(c, open), 'lane open');
  ok(!solved(c, open), 'the hero is still mid-block — an open lane is one drag from victory, not victory');
  open[0] = c.w - c.len[0];
  ok(solved(c, open), 'nose on the gate is the win');
  const clear = compile(CLEAR);
  ok(solved(clear, clear.start), 'a lot with the hero already home is solved before a single drag');
});

test('toSpec survives the round trip through JSON', () => {
  const c = compile(CHAIN);
  const spec = JSON.parse(JSON.stringify(toSpec(c, c.start)));
  eq(validate(spec), null, 'round-tripped spec is legal');
  const again = compile(spec);
  eq(encode(again.start), encode(c.start), 'same position');
  eq([...again.axis], [...c.axis]);
  eq([...again.cross], [...c.cross]);
  eq(again.hero, c.hero);
});

test('walls are concrete: they stop a slide dead', () => {
  const walled = {
    w: 6, h: 6, exitRow: 0, walls: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: 0 }],
    cars: [
      { x: 2, y: 0, len: 2, axis: 'h', hero: true },
      { x: 4, y: 1, len: 3, axis: 'v' },
    ],
  };
  eq(validate(walled), null, 'the walled fixture is legal');
  const c = compile(walled);
  eq(c.wall[0], 1, 'cell (0,0) is concrete');
  eq(occupancy(c, c.start).reduce((a, b) => a + b, 0), 5, 'walls are not counted as car cells');
  eq(reach(c, occupancy(c, c.start), 0, 2), [0, 1], 'concrete on both sides leaves one cell of slack');
  ok(exitBlocked(c, c.start), 'a wall in the lane blocks the gate as surely as a car does');
});

run();
