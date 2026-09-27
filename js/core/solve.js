// Breadth-first search over the one-move graph. This is not a convenience: it is what
// lets the game say "this lot takes exactly N moves" and "here is a move on a shortest
// route" instead of guessing at difficulty. Every number the UI prints about hardness
// comes out of here.

import { compile, occupancy, eachMove, solved, encode } from './lot.js';

const EMPTY = new Uint8Array(0);

// solve(spec) -> { ok, moves, path, explored, truncated }
//   path is the ordered list of { car, delta } that empties the lot in `moves` drags.
export function solve(spec, opts = {}) {
  const limit = opts.limit || 300000;
  const comp = spec.comp || compile(spec);
  const n = comp.n;
  const start = opts.pos ? Uint8Array.from(opts.pos) : Uint8Array.from(comp.start);
  const occ = new Uint8Array(comp.w * comp.h);

  if (solved(comp, start)) return { ok: true, moves: 0, path: [], explored: 1 };

  // Flat queue of states plus a key -> index map. Reconstructing a path is a walk over
  // parent indices, so nothing here needs to hold an array of objects per state.
  const states = [start];
  const parent = [-1];
  const via = [null];
  const seen = new Map([[encode(start), 0]]);
  let head = 0;
  let found = -1;

  while (head < states.length && states.length < limit) {
    const gi = head++;
    const pos = states[gi];
    eachMove(comp, pos, (car, delta) => {
      if (found >= 0) return;
      const next = Uint8Array.from(pos);
      next[car] += delta;
      const key = encode(next);
      if (seen.has(key)) return;
      const ni = states.length;
      seen.set(key, ni);
      states.push(next);
      parent.push(gi);
      via.push({ car, delta });
      if (solved(comp, next)) found = ni;
    }, occ);
    if (found >= 0) break;
  }

  if (found < 0) {
    return { ok: false, moves: -1, path: [], explored: states.length, truncated: states.length >= limit };
  }
  const path = [];
  for (let i = found; i > 0; i = parent[i]) path.push(via[i]);
  path.reverse();
  return { ok: true, moves: path.length, path, explored: states.length };
}

// The first move of a shortest route from wherever the player now stands. Returns null
// when the lot has become unsolvable — which the generator makes impossible on a fresh
// board, but a player can walk into it mid-game.
export function bestMove(spec, pos) {
  const r = solve(spec, { pos, limit: 120000 });
  return r.ok && r.path.length ? r.path[0] : null;
}

// How many distinct lots are reachable, and how deep: together with `moves` this is the
// second half of the difficulty measurement. A 30-move lot whose whole graph is 200
// states is an exercise; the same 30 moves through 40k states is a puzzle.
export function census(spec, limit = 400000) {
  const comp = spec.comp || compile(spec);
  const start = encode(comp.start);
  const occ = new Uint8Array(comp.w * comp.h);
  const seen = new Set([start]);
  const queue = [Uint8Array.from(comp.start)];
  let depth = 0;
  let frontier = queue.length;
  let maxFork = 0;
  for (let head = 0; head < queue.length && queue.length < limit; head++) {
    if (head === frontier) { depth++; frontier = queue.length; }
    const pos = queue[head];
    let fork = 0;
    eachMove(comp, pos, (car, delta) => {
      const next = Uint8Array.from(pos);
      next[car] += delta;
      const key = encode(next);
      if (seen.has(key)) return;
      seen.add(key);
      queue.push(next);
      fork++;
    }, occ);
    if (fork > maxFork) maxFork = fork;
  }
  return { states: seen.size, depth, maxFork, truncated: queue.length >= limit };
}
