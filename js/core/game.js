// A game in progress: pure state plus the rules that touch it. No DOM anywhere in here,
// which is what lets test/game.test.mjs and tools/playtest.mjs drive the same object the
// screen does.

import { compile, occupancy, carAt, reach, solved } from './lot.js';
import { solve } from './solve.js';

export function createGame(lot) {
  const comp = lot.comp || compile(lot.spec);
  return {
    id: lot.id,
    tier: lot.tier,
    par: lot.par,
    comp,
    start: Uint8Array.from(comp.start),
    pos: Uint8Array.from(comp.start),
    moves: 0,
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
  game.moves++;
  if (solved(comp, pos)) game.done = true;
  return d;
}

export function undo(game) {
  const last = game.history.pop();
  if (!last) return false;
  game.pos[last.car] = last.from;
  game.moves--;
  game.done = false;
  return true;
}

export function reset(game) {
  game.pos = Uint8Array.from(game.start);
  game.moves = 0;
  game.history = [];
  game.done = false;
}

// The solver's answer from wherever the player stands: the next drag of a shortest route,
// and how many drags remain if they take it. `left` is what the UI shows as "还有 N 步".
export function hint(game) {
  if (game.done) return null;
  const r = solve({ comp: game.comp }, { pos: game.pos, limit: 120000 });
  if (!r.ok || !r.path.length) return null;
  const m = r.path[0];
  return { car: m.car, delta: m.delta, left: r.moves };
}

// Drags used against the certified shortest route. The three grades the win screen
// prints are defined here rather than in the markup so the tests can assert them.
export function grade(game) {
  const over = game.moves - game.par;
  if (over <= 0) return { key: 'perfect', label: '完美通行', stars: 3 };
  if (over <= 3) return { key: 'clean', label: '干净脱身', stars: 2 };
  return { key: 'out', label: '勉强疏通', stars: 1 };
}
