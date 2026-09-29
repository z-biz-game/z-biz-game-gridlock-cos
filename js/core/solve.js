// Breadth-first search over the move graph. This is not a convenience: it is what lets the
// game say "this lot takes exactly N steps" and "here is a step on a shortest route"
// instead of guessing at difficulty. Every number the UI prints about hardness comes out of
// here — and since the lot carries two counting laws (js/core/law.js), a number on its own
// is no longer a complete claim: `solve(spec, { law })` is.
//
// Two independent roads run through this file, and the build step requires them to agree:
//   solve()          — plain BFS over the graph whose edges are one step *of that law*.
//   solveWeighted()  — Dijkstra over the classic drag graph with each edge billed by
//                      cost(law, delta). Different graph, different algorithm, same answer
//                      or the bake fails.

import { compile, occupancy, eachMove, solved, encode } from './lot.js';
import { DRAG, cost, eachStep, lawOf } from './law.js';

// solve(spec, { law, pos, limit }) -> { ok, moves, path, explored, truncated }
//   `moves` is the shortest route measured in the chosen law's steps; `path` is the ordered
//   list of { car, delta } that empties the lot in that many steps. Under the cell law every
//   delta in the path is a single cell.
export function solve(spec, opts = {}) {
  const limit = opts.limit || 300000;
  const law = opts.law || DRAG;
  lawOf(law);
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
    eachStep(comp, pos, law, (car, delta) => {
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
  return { ok: true, moves: path.length, path, explored: states.length, law };
}

// The first step of a shortest route from wherever the player now stands, in the chosen
// law. Returns null when the lot has become unsolvable — which the generator makes
// impossible on a fresh board, but a player can walk into it mid-game.
export function bestMove(spec, pos, law = DRAG) {
  const r = solve(spec, { pos, law, limit: 120000 });
  return r.ok && r.path.length ? r.path[0] : null;
}

// The second road: the *drag* graph, every edge billed by cost(law, delta). Edge weights are
// small integers (at most the lot's side), so buckets by distance replace a priority heap.
export function solveWeighted(spec, opts = {}) {
  const limit = opts.limit || 300000;
  const law = opts.law || DRAG;
  lawOf(law);
  const comp = spec.comp || compile(spec);
  const start = opts.pos ? Uint8Array.from(opts.pos) : Uint8Array.from(comp.start);
  const occ = new Uint8Array(comp.w * comp.h);
  if (solved(comp, start)) return { ok: true, moves: 0, path: [], explored: 1 };

  const dist = new Map([[encode(start), 0]]);
  const parent = new Map([[encode(start), { from: null, move: null }]]);
  const buckets = new Map([[0, [start]]]);
  let d = 0;
  let popped = 0;
  while (buckets.size) {
    while (!buckets.has(d)) d++;
    const list = buckets.get(d);
    buckets.delete(d);
    for (const pos of list) {
      const key = encode(pos);
      if (dist.get(key) !== d) continue;
      if (++popped > limit) return { ok: false, moves: -1, path: [], explored: popped, truncated: true };
      if (solved(comp, pos)) return { ok: true, moves: d, path: walk(comp.n, key, parent), explored: popped, law };
      eachMove(comp, pos, (car, delta) => {
        const next = Uint8Array.from(pos);
        next[car] += delta;
        const nk = encode(next);
        const nd = d + cost(law, delta);
        const old = dist.get(nk);
        if (old !== undefined && old <= nd) return;
        dist.set(nk, nd);
        parent.set(nk, { from: key, move: { car, delta } });
        const bucket = buckets.get(nd);
        if (bucket) bucket.push(next);
        else buckets.set(nd, [next]);
      }, occ);
    }
  }
  return { ok: false, moves: -1, path: [], explored: popped, truncated: false };
}

function walk(n, key, parent) {
  const out = [];
  let cur = key;
  while (true) {
    const step = parent.get(cur);
    if (!step || !step.move) break;
    out.push(step.move);
    cur = step.from;
  }
  out.reverse();
  return out;
}

// Every position a player can actually wander into, with the fewest steps of `law` from each
// one back to a solved lot. The root is the whole set of solved positions, not one of them,
// so dist(state) is "how far from winning", which is what a hint and a difficulty claim both
// need. Two roads again: multi-source BFS over that law's own edges, or multi-source Dijkstra
// over the drag graph billed by cost(law, .). The build step runs both and compares.
export function distTable(spec, opts = {}) {
  const law = opts.law || DRAG;
  lawOf(law);
  const limit = opts.limit || 400000;
  const via = opts.via || 'bfs';
  const comp = spec.comp || compile(spec);
  const occ = new Uint8Array(comp.w * comp.h);
  const scratch = new Uint8Array(comp.w * comp.h);

  const component = new Map();
  const queue = [Uint8Array.from(comp.start)];
  component.set(encode(comp.start), queue[0]);
  for (let head = 0; head < queue.length && queue.length < limit; head++) {
    const pos = queue[head];
    eachMove(comp, pos, (car, delta) => {
      const next = Uint8Array.from(pos);
      next[car] += delta;
      const key = encode(next);
      if (component.has(key)) return;
      component.set(key, next);
      queue.push(next);
    }, occ);
  }
  const truncated = queue.length >= limit;

  const roots = [];
  for (const [key, pos] of component) if (solved(comp, pos)) roots.push(key);
  if (!roots.length) return { law, via, states: component.size, truncated: true, dist: new Map(), maxDist: -1, roots: 0 };

  const dist = new Map();
  const buckets = new Map();
  for (const key of roots) {
    dist.set(key, 0);
    const b = buckets.get(0);
    if (b) b.push(component.get(key));
    else buckets.set(0, [component.get(key)]);
  }
  let d = 0;
  let visited = 0;
  while (buckets.size) {
    while (!buckets.has(d)) d++;
    const list = buckets.get(d);
    buckets.delete(d);
    for (const pos of list) {
      const key = encode(pos);
      if (dist.get(key) !== d) continue;
      visited++;
      const emit = (car, delta) => {
        const next = Uint8Array.from(pos);
        next[car] += delta;
        const nk = encode(next);
        if (!component.has(nk)) return;
        const nd = d + (via === 'weighted' ? cost(law, delta) : 1);
        const old = dist.get(nk);
        if (old !== undefined && old <= nd) return;
        dist.set(nk, nd);
        const bucket = buckets.get(nd);
        if (bucket) bucket.push(next);
        else buckets.set(nd, [next]);
      };
      if (via === 'weighted') eachMove(comp, pos, emit, scratch);
      else eachStep(comp, pos, law, emit, scratch);
    }
  }
  let maxDist = 0;
  for (const v of dist.values()) if (v > maxDist) maxDist = v;
  return {
    law, via, states: component.size, covered: dist.size, maxDist, roots: roots.length,
    truncated: truncated || dist.size < component.size, dist,
  };
}

// How many distinct lots are reachable, and how deep: together with `moves` this is the
// second half of the difficulty measurement. A 30-step lot whose whole graph is 200
// states is an exercise; the same 30 steps through 40k states is a puzzle.
// The vertex set does not depend on the counting law — see js/core/law.js — so this runs on
// the drag graph and its number is what both laws share.
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
