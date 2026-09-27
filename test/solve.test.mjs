// The solver. This is the only place difficulty is decided in this game, so the numbers
// it is tested against cannot come from itself.
//
// CHAIN's par is 3, written out by hand: the pin has to leave the lane, that needs C off
// (2,0), which needs a two-cell slide since one cell is not enough — and even then the
// hero still has to drive the length of the lot. Three drags, and no two. The optimality
// half of that claim is re-checked below by brute force rather than trusted to the BFS.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { CHAIN, CLEAR, DEAD } from './fixture.mjs';
import { compile, occupancy, reach, moves, solved, step } from '../js/core/lot.js';
import { solve, bestMove, census } from '../js/core/solve.js';

function legal(comp, pos, m) {
  const [back, fwd] = reach(comp, occupancy(comp, pos), m.car, pos[m.car]);
  return m.delta !== 0 && m.delta >= -back && m.delta <= fwd;
}

// Walk a path over the lot, holding every drag to the same legality test the player's
// pointer is held to.
function replay(spec, path, from) {
  const comp = spec.comp || compile(spec);
  const pos = Uint8Array.from(from || comp.start);
  for (const m of path) {
    ok(legal(comp, pos, m), `drag car ${m.car} by ${m.delta} is legal where it is played`);
    step(pos, m);
  }
  return { comp, pos };
}

test('CHAIN empties in exactly three drags', () => {
  const r = solve(CHAIN);
  ok(r.ok, 'the fixture is solvable');
  eq(r.moves, 3, 'hand-written par');
  eq(r.path.length, 3);
  const { comp, pos } = replay(CHAIN, r.path);
  ok(solved(comp, pos), 'the replayed route ends with the hero through the gate');
});

test('brute force finds no route shorter than the par', () => {
  const c = compile(CHAIN);
  let shorter = null;
  for (const m1 of moves(c, c.start)) {
    const p1 = step(Uint8Array.from(c.start), m1);
    if (solved(c, p1)) shorter = [m1];
    for (const m2 of moves(c, p1)) {
      if (solved(c, step(Uint8Array.from(p1), m2))) shorter = [m1, m2];
    }
  }
  eq(shorter, null, 'nothing empties the lot in one or two drags');
});

test('a lot that is already out costs zero drags', () => {
  const r = solve(CLEAR);
  eq([r.ok, r.moves, r.path.length], [true, 0, 0], 'solved before the search starts');
});

test('an unsolvable lot says no, and says it plainly', () => {
  const r = solve(DEAD);
  eq(r.ok, false, 'the column never moves');
  ok(!('truncated' in r) || r.truncated === false, 'a full search that found nothing is an answer, not a timeout');
  ok(r.explored < 200, 'and it was cheap because the graph really is tiny');
});

test('a search budget truncates instead of lying', () => {
  const r = solve(CHAIN, { limit: 2 });
  eq([r.ok, r.truncated], [false, true], 'ran out of budget, so it admits not knowing');
  ok(r.explored >= 2, 'it did do the work it was paid for');
});

test('bestMove is the first drag of a shortest route', () => {
  eq(bestMove(CHAIN), solve(CHAIN).path[0], 'same move, same test');
  eq(bestMove(DEAD), null, 'nothing to suggest on a dead lot');
});

test('following the hints gets out', () => {
  const c = compile(CHAIN);
  const pos = Uint8Array.from(c.start);
  for (let i = 0; !solved(c, pos); i++) {
    ok(i < 8, 'the hint loop has to terminate — no drag back out is free');
    const m = bestMove({ comp: c }, pos);
    ok(m, 'a solvable position always has a suggestion');
    ok(legal(c, pos, m), `the suggested drag (car ${m.car} by ${m.delta}) is one the player could make`);
    step(pos, m);
  }
  eq(pos[c.hero] + c.len[c.hero], c.w, 'and it stops with the nose on the gate');
});

test('the solver is a function of the lot: no state, no mutation', () => {
  const c = compile(CHAIN);
  const before = [...c.start];
  const a = solve(CHAIN);
  const b = solve({ comp: c });
  eq([...c.start], before, 'the compiled start line is untouched');
  eq(b.path, a.path, 'a pre-compiled lot answers the same as the raw spec');
  eq(solve(CHAIN).explored, a.explored, 'twice over the same lot, the same search');
});

test('a position partway through a game is a legitimate thing to solve from', () => {
  const c = compile(CHAIN);
  const mid = Uint8Array.from(c.start);
  mid[3] = 0; // C has already given up the corner
  const r = solve({ comp: c }, { pos: mid });
  eq(r.moves, 2, 'one of the three drags is already spent');
  const out = replay({ comp: c }, r.path, mid);
  ok(solved(out.comp, out.pos), 'and the remaining route still ends at the gate');
});

test('census counts the lot a player can actually wander around in', () => {
  const dead = census(DEAD);
  eq([dead.states, dead.depth], [2, 1], 'the hero has two slots and nothing else moves');
  eq(dead.truncated, false);
  const clear = census(CLEAR);
  // Five slots for the free car; five for the hero, except the two times the free car
  // dips into the lane row and costs the hero its leftmost slot — 5+4+4+5+5.
  eq(clear.states, 23, 'two cars that hardly know each other exist in 23 arrangements');
  const chain = census(CHAIN);
  ok(chain.states > clear.states, 'a chained lot reaches far more positions than two free cars');
  ok(chain.states >= solve(CHAIN).explored, 'a full sweep sees at least what a bounded search saw');
  ok(chain.depth >= solve(CHAIN).moves, 'and the lot is deeper than the route out of it');
});

run();
