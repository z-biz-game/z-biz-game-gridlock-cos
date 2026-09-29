// The rules of a game in progress. Nothing here reaches for the DOM, so this suite and
// tools/playtest.mjs drive the same object the screen does.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { CHAIN, CLEAR, DEAD } from './fixture.mjs';
import { encode } from '../js/core/lot.js';
import { createGame, grab, slide, undo, reset, hint, grade, tally } from '../js/core/game.js';
import { solve } from '../js/core/solve.js';
import { DRAG, CELL } from '../js/core/law.js';

// Both pars are typed here rather than imported from a search so the assertions below stay
// independent of the code they grade: three drags, six cells, counted on the picture in
// test/fixture.mjs (see the reasoning there).
const chain = (par = 3, parCell = 6) => createGame({ id: 'chain', tier: 'kerb', par, parCell, spec: CHAIN });

test('a game opens on the start line with nothing spent', () => {
  const g = chain();
  eq([g.moves, g.cells, g.done, g.id, g.tier, g.par, g.parCell], [0, 0, false, 'chain', 'kerb', 3, 6]);
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
  eq([g.moves, g.cells], [2, 6], 'two drags actually happened, and they carried six cells between them');
});

test('one drag is one move however far the car travels', () => {
  const g = chain();
  slide(g, 3, -2); // C off the corner
  slide(g, 1, -1); // the pin up out of the lane
  eq(g.moves, 2, 'the lane is open and that has cost two');
  eq(g.cells, 3, 'in cells the same two drags are three');
  ok(!g.done, 'but the hero is still sitting in the middle of the block');
  const askedFar = slide(g, 0, 9); // all the way to the gate in one pull
  eq(askedFar, g.comp.w - g.comp.len[0], 'it went as far as the lot allows');
  eq(g.moves, 3, 'and that is three moves, not seven');
  eq([g.moves, g.cells], [3, 7], 'the two ledgers, on the same three drags');
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

test('the cell route plays out of the lot one cell at a time', () => {
  const g = chain();
  const r = solve(CHAIN, { law: CELL });
  eq(r.moves, g.parCell, 'the second certified number is reachable the same way');
  for (const m of r.path) {
    ok(Math.abs(m.delta) === 1, `car ${m.car} by ${m.delta}: a cell route is all single cells`);
    eq(slide(g, m.car, m.delta), m.delta, 'and every one of them is legal on the board');
  }
  eq([g.moves, g.cells, g.done], [6, 6, true], 'played step by step it is six of each — a cell route cannot be shortcut');
});

// The two laws are not in competition: on this lot one route is shortest under both, and
// the shortest-drag route is a cell worse. A UI that converted one counter into the other
// on a law switch could not tell these two runs apart, which is why both are kept live.
test('a run can be perfect twice over, or perfect once and clean once', () => {
  const both = chain();
  for (const m of [{ car: 3, delta: 1 }, { car: 1, delta: -1 }, { car: 0, delta: 4 }]) {
    eq(slide(both, m.car, m.delta), m.delta, 'C one right, the pin up, the hero all the way out');
  }
  eq([both.moves, both.cells], [3, 6], 'three drags and six cells at the same time');
  eq([grade(both, DRAG).key, grade(both, CELL).key], ['perfect', 'perfect']);

  const drags = chain();
  for (const m of solve(CHAIN).path) slide(drags, m.car, m.delta);
  eq([drags.moves, drags.cells], [3, 7], 'the minimum-drag route pushes C two cells left');
  eq([grade(drags, DRAG).key, grade(drags, CELL).key], ['perfect', 'clean']);
  eq(tally(drags, CELL), { spent: 7, par: 6, law: CELL }, 'and the tally reads the ledger of the law asked for');
});

test('undo gives the drags back, including the winning one', () => {
  const g = chain();
  slide(g, 3, -2);
  slide(g, 1, -1);
  const at = encode(g.pos);
  eq(undo(g), true);
  ok(encode(g.pos) !== at, 'the pin came back down');
  eq([g.moves, g.cells], [1, 2], 'and both ledgers give the step back, not just the classic one');
  eq(g.done, false);
  undo(g);
  eq(encode(g.pos), encode(g.start), 'back to the start line');
  eq([g.moves, g.cells, g.history.length], [0, 0, 0]);
  eq(undo(g), false, 'there is nothing older than the first drag');
});

test('undo unwinds a four-cell drag as four cells', () => {
  const g = chain();
  slide(g, 3, -2);
  slide(g, 1, -1);
  slide(g, 0, 4);
  eq([g.moves, g.cells, g.done], [3, 7, true]);
  undo(g);
  eq([g.moves, g.cells, g.done], [2, 3, false], 'one drag out, one drag and its four cells back');
});

test('reset puts the whole lot back', () => {
  const g = chain();
  for (const m of solve(CHAIN).path) slide(g, m.car, m.delta);
  eq(g.done, true);
  reset(g);
  eq([g.moves, g.cells, g.done, g.history.length], [0, 0, false, 0]);
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

test('a cell-law hint promises a cell, and its countdown is in cells', () => {
  const g = chain();
  eq(hint(g, CELL), { car: 3, delta: 1, left: 6, law: CELL }, 'the same lot, the same first car, six cells of road left');
  eq(hint(g, CELL).law, CELL, 'and the hint says which law it counted its remaining steps in');
  let n = 1;
  while (!g.done && n < 20) {
    const m = hint(g, CELL);
    ok(m, 'a live lot always has a next step');
    eq(Math.abs(m.delta), 1, `car ${m.car} by ${m.delta}: a cell hint never asks for more than one cell`);
    eq(slide(g, m.car, m.delta), m.delta, 'and the board allows exactly that');
    eq(hint(g, CELL) && hint(g, CELL).left, g.done ? null : 6 - g.cells, 'the countdown is in the law being played');
    n++;
  }
  eq([g.done, g.cells, g.moves], [true, 6, 6], 'every cell hint, taken in order, is six cells and six drags');
  eq(hint(g, CELL), null, 'and the lot has nothing left to say once it is out');
});

test('hint has nothing to say when there is nothing to say', () => {
  eq(hint(createGame({ id: 'dead', par: 1, spec: DEAD })), null, 'an unsolvable lot gets no suggestion');
  const out = createGame({ id: 'clear', par: 0, spec: CLEAR });
  eq(hint(out), null, 'and neither does a lot the hero is already standing outside of');
});

test('the three grades are measured against the certified par', () => {
  const g = chain();
  const at = (moves) => { g.moves = moves; return grade(g); };
  eq(at(2), { key: 'perfect', label: '完美通行', stars: 3, law: 'drag', over: -1 }, 'beating a par should never happen, but it grades the same');
  eq(at(3), { key: 'perfect', label: '完美通行', stars: 3, law: 'drag', over: 0 });
  eq(at(6), { key: 'clean', label: '干净脱身', stars: 2, law: 'drag', over: 3 }, 'three drags of slack is still clean');
  eq(at(7), { key: 'out', label: '勉强疏通', stars: 1, law: 'drag', over: 4 });
  eq(at(40).stars, 1, 'however bad it gets, the hero got out');
});

// Six of each is the cell par to the cell, and three drags over the drag par. If the grade
// read one ledger against the other law's number, this run would be perfect twice over.
test('the same board grades against the par of the law being read', () => {
  const g = chain();
  for (const m of solve(CHAIN, { law: CELL }).path) slide(g, m.car, m.delta);
  eq([g.moves, g.cells], [6, 6], 'six of each, played out on the board');
  eq(grade(g, CELL), { key: 'perfect', label: '完美通行', stars: 3, law: 'cell', over: 0 });
  eq(grade(g, DRAG), { key: 'clean', label: '干净脱身', stars: 2, law: 'drag', over: 3 });
  eq([tally(g, DRAG), tally(g, CELL)], [{ spent: 6, par: 3, law: 'drag' }, { spent: 6, par: 6, law: 'cell' }]);
});

run();
