// The rules of a game in progress. Nothing here reaches for the DOM, so this suite and
// tools/playtest.mjs drive the same object the screen does.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { CHAIN, CLEAR, DEAD } from './fixture.mjs';
import { encode } from '../js/core/lot.js';
import { createGame, grab, slide, undo, reset, hint, grade } from '../js/core/game.js';
import { solve } from '../js/core/solve.js';

const chain = (par = 3) => createGame({ id: 'chain', tier: 'kerb', par, spec: CHAIN });

test('a game opens on the start line with nothing spent', () => {
  const g = chain();
  eq([g.moves, g.done, g.id, g.tier, g.par], [0, false, 'chain', 'kerb', 3]);
  eq(encode(g.pos), encode(g.comp.start), 'pos and the start line agree at the outset');
  eq(g.history, [], 'nothing to take back');
});

test('grab reports which car is under a cell and how far it can go', () => {
  const g = chain();
  eq(grab(g, 0, 2), { car: 0, back: 0, fwd: 0, axis: 0, len: 2 }, 'the hero is pinched: it can be picked up, but it has nowhere to go');
  eq(grab(g, 2, 1), { car: 1, back: 0, fwd: 1, axis: 1, len: 2 }, 'the pin can only creep down, where it still covers the lane');
  eq(grab(g, 2, 0), { car: 3, back: 2, fwd: 2, axis: 0, len: 2 }, 'C can run two cells either way');
  eq(grab(g, 0, 0), null, 'tarmac');
  eq(grab(g, 5, 5), null, 'more tarmac');
});

test('a drag that runs into a bumper stops at the bumper', () => {
  const g = chain();
  eq(slide(g, 3, 5), 2, 'asked for five to the right, the lot only has two');
  eq(g.pos[3], g.comp.start[3] + 2);
  eq(slide(g, 3, -9), -4, 'with the corner gone there are four cells to the left, and the drag stops at the wall');
  eq(g.pos[3], 0);
  eq(slide(g, 1, 0), 0, 'asking for no movement costs nothing');
  eq(slide(g, 4, 7), 0, 'a car with no room in that direction does not move');
  eq(g.moves, 2, 'two drags actually happened');
});

test('one drag is one move however far the car travels', () => {
  const g = chain();
  slide(g, 3, -2); // C off the corner
  slide(g, 1, -1); // the pin up out of the lane
  eq(g.moves, 2, 'the lane is open and that has cost two');
  ok(!g.done, 'but the hero is still sitting in the middle of the block');
  const askedFar = slide(g, 0, 9); // all the way to the gate in one pull
  eq(askedFar, g.comp.w - g.comp.len[0], 'it went as far as the lot allows');
  eq(g.moves, 3, 'and that is three moves, not seven');
  eq(g.done, true, 'the curtain goes up');
});

test('the certified route plays out of the lot', () => {
  const g = chain();
  for (const m of solve(CHAIN).path) {
    ok(slide(g, m.car, m.delta) === m.delta, `the route's drag car ${m.car} by ${m.delta} plays exactly as written`);
  }
  eq(g.moves, g.par, 'par is reachable by definition, since par is a measured route');
  eq(grade(g).stars, 3);
});

test('undo gives the drags back, including the winning one', () => {
  const g = chain();
  slide(g, 3, -2);
  slide(g, 1, -1);
  const at = encode(g.pos);
  eq(undo(g), true);
  ok(encode(g.pos) !== at, 'the pin came back down');
  eq(g.moves, 1);
  eq(g.done, false);
  undo(g);
  eq(encode(g.pos), encode(g.start), 'back to the start line');
  eq([g.moves, g.history.length], [0, 0]);
  eq(undo(g), false, 'there is nothing older than the first drag');
});

test('reset puts the whole lot back', () => {
  const g = chain();
  for (const m of solve(CHAIN).path) slide(g, m.car, m.delta);
  eq(g.done, true);
  reset(g);
  eq([g.moves, g.done, g.history.length], [0, false, 0]);
  eq(encode(g.pos), encode(g.start));
});

test('a finished game takes no more drags', () => {
  const g = chain();
  slide(g, 3, -2);
  slide(g, 1, -1);
  slide(g, 0, 4);
  eq(g.done, true);
  eq(slide(g, 2, 1), 0, 'B is still slidably, but the lot is already out');
});

test('hint names a legal drag and counts what is left', () => {
  const g = chain();
  const h = hint(g);
  eq(h.left, 3, 'from the start line, the whole route is ahead');
  ok(h.car >= 0 && h.delta !== 0, 'a drag, not a lecture');
  eq(slide(g, h.car, h.delta), h.delta, 'and the player can make exactly that move');
  eq(hint(g).left, 2, 'one drag spent, one less to go');
  let n = 1;
  while (!g.done && n < 10) {
    const m = hint(g);
    ok(m, 'a live lot always has a next step');
    slide(g, m.car, m.delta);
    n++;
  }
  eq([g.done, g.moves], [true, 3], 'taking every hint lands exactly on par');
});

test('hint has nothing to say when there is nothing to say', () => {
  eq(hint(createGame({ id: 'dead', par: 1, spec: DEAD })), null, 'an unsolvable lot gets no suggestion');
  const out = createGame({ id: 'clear', par: 0, spec: CLEAR });
  eq(hint(out), null, 'and neither does a lot the hero is already standing outside of');
});

test('the three grades are measured against the certified par', () => {
  const g = chain();
  const at = (moves) => { g.moves = moves; return grade(g); };
  eq(at(2), { key: 'perfect', label: '完美通行', stars: 3 }, 'beating a par should never happen, but it grades the same');
  eq(at(3), { key: 'perfect', label: '完美通行', stars: 3 });
  eq(at(6), { key: 'clean', label: '干净脱身', stars: 2 }, 'three drags of slack is still clean');
  eq(at(7), { key: 'out', label: '勉强疏通', stars: 1 });
  eq(at(40).stars, 1, 'however bad it gets, the hero got out');
});

run();
