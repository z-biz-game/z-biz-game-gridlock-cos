// The solver. This is the only place difficulty is decided in this game, so the numbers
// it is tested against cannot come from itself.
//
// CHAIN's par is 3, written out by hand: the pin has to leave the lane, that needs C off
// (2,0), which needs a two-cell slide since one cell is not enough — and even then the
// hero still has to drive the length of the lot. Three drags, and no two. The optimality
// half of that claim is re-checked below by brute force rather than trusted to the BFS.
//
// Counted in cells the same picture is six: four for the hero, one for the pin, one for C
// to give up the cell the pin has to move into (test/fixture.mjs walks through it). That
// number gets its own brute force below, on the single-cell graph built straight out of
// lot.js rather than out of the step generator being tested.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { CHAIN, CLEAR, DEAD } from './fixture.mjs';
import { compile, occupancy, reach, moves, solved, step, encode } from '../js/core/lot.js';
import { solve, solveWeighted, bestMove, census, distTable } from '../js/core/solve.js';
import { DRAG, CELL } from '../js/core/law.js';

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

test('CHAIN empties in exactly six cells', () => {
  const r = solve(CHAIN, { law: CELL });
  ok(r.ok, 'the same fixture, the second law');
  eq(r.moves, 6, 'hand-written cell par');
  eq(r.path.length, 6);
  eq(r.law, CELL, 'a result says which law it was counted in');
  eq(r.path.every((m) => Math.abs(m.delta) === 1), true, 'and a cell route is six single-cell slides');
  const { comp, pos } = replay(CHAIN, r.path);
  ok(solved(comp, pos), 'replayed one cell at a time it still ends at the gate');
});

test('brute force on the single-cell graph finds no route shorter than six', () => {
  const comp = compile(CHAIN);
  // Enumerated from lot.js' own move list, filtered to one cell — nothing here goes through
  // the step generator whose output the BFS is being compared against.
  const cellMoves = (pos) => moves(comp, pos).filter((m) => m.delta === 1 || m.delta === -1);
  let shorter = null;
  const seen = new Set([encode(comp.start)]);
  const walk = (pos, path) => {
    if (path.length >= 5 || shorter) return;
    for (const m of cellMoves(pos)) {
      const next = step(Uint8Array.from(pos), m);
      const key = encode(next);
      if (seen.has(key)) continue;
      if (solved(comp, next)) { shorter = [...path, m]; return; }
      seen.add(key);
      walk(next, [...path, m]);
      seen.delete(key);
    }
  };
  walk(comp.start, []);
  eq(shorter, null, 'no walk of five or fewer cell steps empties the lot');
});

test('the second road, a different algorithm over the drag graph, lands on both numbers', () => {
  eq([solveWeighted(CHAIN).moves, solveWeighted(CHAIN, { law: CELL }).moves], [3, 6], 'BFS and weighted Dijkstra, per law');
  eq(solveWeighted(CHAIN, { law: CELL }).path.length, 3, 'the weighted road is allowed to run three cells in one pull');
  eq(solveWeighted(CHAIN, { law: CELL }).path.map((m) => m.delta), [1, -1, 4], 'C right, the pin up, the hero all the way out');
  eq(solveWeighted(CLEAR, { law: CELL }).moves, 0, 'already out costs nothing in either law');
  eq(solveWeighted(DEAD, { law: CELL }).ok, false, 'and a dead lot stays dead whichever way it is billed');
});

// The reason the lot ships two numbers instead of one conversion: the shortest drag route
// is not the cheapest one in cells, so no arithmetic on the drag par yields the cell par.
test('the cell par is a second measurement, not the first one multiplied', () => {
  const drag = solve(CHAIN);
  const cell = solve(CHAIN, { law: CELL });
  const dragRouteInCells = drag.path.reduce((n, m) => n + Math.abs(m.delta), 0);
  eq([drag.moves, cell.moves, dragRouteInCells], [3, 6, 7], 'cheapest in drags bills seven cells; the lot only needs six');
  ok(cell.moves >= drag.moves, 'any route bills at least as many cells as drags, so the cell par cannot be below');
  ok(cell.moves < dragRouteInCells, 'and it can be strictly below what the drag-optimal route costs');
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

test('the distance table certifies every position, not just the one on screen', () => {
  const comp = compile(CHAIN);
  const at = encode(comp.start);
  const cell = distTable(CHAIN, { law: CELL });
  const drag = distTable(CHAIN, { law: DRAG });
  eq([cell.states, cell.covered, cell.roots, cell.truncated], [288, 288, 26, false], 'the whole component, reachable from any of its 26 winning positions');
  eq(drag.states, cell.states, 'the two laws span the same positions');
  eq(cell.dist.get(at), 6, 'the start line reads back the cell par, from a search run from the other end');
  eq(drag.dist.get(at), 3, 'and the drag par the same way');
  eq([drag.maxDist, cell.maxDist], [6, 16], 'the farthest a player can get from winning, counted in each law');
  ok(cell.maxDist >= drag.maxDist, 'a cell step gets you no further than a drag does, so the same escape can never cost fewer cells than drags');
  for (const law of [DRAG, CELL]) {
    const b = distTable(CHAIN, { law, via: 'bfs' });
    const w = distTable(CHAIN, { law, via: 'weighted' });
    eq(w.states, b.states, `${law}: both table roads enumerate the same component`);
    eq(w.maxDist, b.maxDist, `${law}: and agree on how deep it goes`);
    const wrong = [];
    for (const [key, d] of b.dist) if (w.dist.get(key) !== d) wrong.push(`${key} ${d} vs ${w.dist.get(key)}`);
    eq(wrong, [], `${law}: no position has two distances`);
  }
});

test('an unsolvable lot has no distance to anything', () => {
  const t = distTable(DEAD);
  eq([t.states, t.roots, t.dist.size], [2, 0, 0], 'two positions, none of them a win, so the table is empty');
  eq(t.maxDist, -1, 'and it says so rather than printing zero depth');
});

run();
