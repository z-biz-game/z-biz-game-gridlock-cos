// A game in progress: pure state plus the rules that touch it. No DOM anywhere in here,
// which is what lets test/game.test.mjs and tools/playtest.mjs drive the same object the
// screen does.
//
// One drag, two ledgers: `moves` counts drags and `cells` counts cells travelled, because
// the lot has two certified pars (js/core/law.js). Both are kept on every move, so the
// player can look at either number at any moment without restarting the lot, and neither
// counter can drift from what actually happened on the board.

import { compile, occupancy, carAt, reach, solved } from './lot.js';
import { solve } from './solve.js';
import { DRAG, CELL, cost, spent, parOf } from './law.js';

export function createGame(lot) {
  const comp = lot.comp || compile(lot.spec);
  return {
    id: lot.id,
    tier: lot.tier,
    par: lot.par,
    parCell: lot.parCell,
    witness: lot.witness || null,
    comp,
    start: Uint8Array.from(comp.start),
    pos: Uint8Array.from(comp.start),
    moves: 0,
    cells: 0,
    history: [],
    done: false,
  };
}

// Which car a pointer picked up, and how far it may go from there. Returns null for a
// cell with nothing in it (tarmac, a wall, or the gate lane).
export function grab(game, x, y) {
  const { comp, pos } = game;
  const occ = occupancy(comp, pos);
  const i = carAt(comp, pos, occ, x, y);
  if (i < 0) return null;
  const [back, fwd] = reach(comp, occ, i, pos[i]);
  return { car: i, back, fwd, axis: comp.axis[i], len: comp.len[i] };
}

// Slide a car. `want` is how far the player asked for, in cells, and it gets clamped to
// what the lot allows — a drag that runs into another car stops at the bumper instead of
// failing. Returns the distance actually moved (0 = nothing moved).
export function slide(game, car, want) {
  if (game.done || !want) return 0;
  const { comp, pos } = game;
  const occ = occupancy(comp, pos);
  const [back, fwd] = reach(comp, occ, car, pos[car]);
  const d = Math.max(-back, Math.min(fwd, want));
  if (!d) return 0;
  const from = pos[car];
  pos[car] = from + d;
  game.history.push({ car, from, to: pos[car] });
  game.moves += cost(DRAG, d);
  game.cells += cost(CELL, d);
  if (solved(comp, pos)) game.done = true;
  return d;
}

export function undo(game) {
  const last = game.history.pop();
  if (!last) return false;
  const d = last.to - last.from;
  game.pos[last.car] = last.from;
  game.moves -= cost(DRAG, d);
  game.cells -= cost(CELL, d);
  game.done = false;
  return true;
}

export function reset(game) {
  game.pos = Uint8Array.from(game.start);
  game.moves = 0;
  game.cells = 0;
  game.history = [];
  game.done = false;
}

// The solver's answer from wherever the player stands: the first step of a shortest route in
// the law being played, and how many steps of that law remain. `left` is what the UI shows
// as "还有 N 步" — under the cell law that is a different, larger number, and it is still a
// measured one.
export function hint(game, law = DRAG) {
  if (game.done) return null;
  const r = solve({ comp: game.comp }, { pos: game.pos, law, limit: 120000 });
  if (!r.ok || !r.path.length) return null;
  const m = r.path[0];
  return { car: m.car, delta: m.delta, left: r.moves, law };
}

// Steps spent and par read out in the law being played, so the grade below has one source
// for both numbers.
export function tally(game, law = DRAG) {
  return { spent: spent(game, law), par: parOf(game, law), law };
}

// Drags used against the certified shortest route. The three grades the win screen
// prints are defined here rather than in the markup so the tests can assert them. A grade
// is always relative to the par *of the law being counted in* — 18 drags and 31 cells are
// the same route, and each is perfect against its own number.
export function grade(game, law = DRAG) {
  const over = spent(game, law) - parOf(game, law);
  if (over <= 0) return { key: 'perfect', label: '完美通行', stars: 3, law, over };
  if (over <= 3) return { key: 'clean', label: '干净脱身', stars: 2, law, over };
  return { key: 'out', label: '勉强疏通', stars: 1, law, over };
}
