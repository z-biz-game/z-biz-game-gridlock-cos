// The generator. There is no hand-authored level file in this repo, and that is
// deliberate: a lot is only worth offering once a search says how hard it is.
//
// This runs at build time (tools/bake.mjs), not on tap — see that file for the measured
// cost. Nothing in the shipped game imports it.
//
// Naive random scatter does not work at this cost, and test/scatter.mjs is the measurement:
// 10k lots per tier, 22%–47% unsolvable, the rest a median of 1 drag, and only 42/1/6/0 per
// 10000 reach their own band ceiling (kerb/lane/junction/gridlock). Hard jams are not random:
// they are chains of cars that each pin the next. So growth replaces scatter:
//
//   start from the hero alone, then add one car at a time and re-measure with the BFS
//   solver. A car is kept only if the measured shortest route got *strictly longer*.
//
// That single rule buys three things at once: the lot is solvable (it is verified after
// every step), every car on the board is load-bearing by construction (a car that did
// not raise the number was discarded), and the difficulty is a measured quantity we can
// stop at. The band you play in is a move count the solver agreed to, not an opinion.

import { compile, occupancy, validate } from './lot.js';
import { solve, solveWeighted, census } from './solve.js';
import { CELL, witness } from './law.js';
import { rngFrom } from './rng.js';

// A lot under construction, in the shape `candidateCells` wants. `s` is the spec the
// solver measures — freshly compiled for whatever cars are currently committed.
function view(s) {
  const comp = s.comp;
  return {
    w: comp.w, h: comp.h, exitRow: comp.exitRow, comp,
    pos: comp.start,
    heroNose: comp.start[comp.hero] + comp.len[comp.hero],
  };
}

// Build the spec for `cars` (+ one candidate). Compile happens here on purpose: the
// solver reads spec.comp, so a candidate must never be measured against the board from
// before it was added.
function boardOf(base, cars, extra) {
  const s = {
    w: base.w, h: base.h, exitRow: base.exitRow, walls: base.walls,
    cars: extra ? cars.concat([extra]) : cars,
  };
  s.comp = compile(s);
  return s;
}

// Where to try to plant the next car. The gate lane ahead of the hero is worth most,
// then any cell touching the existing jam — that is what makes chains. Anything else is
// a long shot at scenery.
function candidateCells(lot) {
  const { w, h, exitRow, comp, pos, heroNose } = lot;
  const occ = occupancy(comp, pos);
  const free = (x, y) => x >= 0 && y >= 0 && x < w && y < h && !occ[y * w + x] && !comp.wall[y * w + x];
  const pool = [];
  for (let x = heroNose; x < w; x++) if (free(x, exitRow)) pool.push({ x, y: exitRow, weight: 8 });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!free(x, y)) continue;
      const touching = (x > 0 && occ[y * w + x - 1])
        || (x < w - 1 && occ[y * w + x + 1])
        || (y > 0 && occ[(y - 1) * w + x])
        || (y < h - 1 && occ[(y + 1) * w + x]);
      pool.push({ x, y, weight: touching ? 3 : 1 });
    }
  }
  return pool;
}

function pickCell(rng, pool) {
  let total = 0;
  for (const c of pool) total += c.weight;
  let r = rng() * total;
  for (const c of pool) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return pool[pool.length - 1];
}

function seedBase(rng, tier) {
  const len = 2;
  const exitRow = tier.exitRow === undefined ? rng.int(tier.h) : tier.exitRow;
  const hero = { x: rng.range(0, tier.w - len), y: exitRow, len, axis: 'h', hero: true };
  return { w: tier.w, h: tier.h, exitRow, cars: [hero], walls: (tier.walls || []).slice() };
}

// Half the time the car runs *through* the chosen cell rather than starting at it — a
// blocker that straddles its anchor is what locks two lanes together.
function propose(rng, lot, tier) {
  const cells = candidateCells(lot);
  if (!cells.length) return null;
  const cell = pickCell(rng, cells);
  const axis = rng.chance(0.5) ? 'h' : 'v';
  const maxLen = axis === 'h' ? tier.w - cell.x : tier.h - cell.y;
  const pool = [2];
  if (tier.trucks && maxLen >= 3) pool.push(3);
  const len = rng.pick(pool);
  if (len > maxLen) return null;
  const back = rng.int(len);
  return {
    x: axis === 'h' ? cell.x - back : cell.x,
    y: axis === 'h' ? cell.y : cell.y - back,
    len,
    axis,
  };
}

// Grow one lot. Returns null if it could not reach the band inside its budget.
//
// The target is the *ceiling* of the band, not a point inside it: growth stops the moment
// the search says the lot is too hard, and whatever it reached on the way is published.
// Aiming at a random point instead made every tier pile up on its floor — the rig showed
// `19 19 19` for the top band, which is one level dressed up as four.
function grow(seed, tier, stats) {
  const rng = rngFrom(`${tier.key}|${seed}`);
  const target = tier.max;
  const limit = tier.probeSearch || 60000;
  const hit = (k) => { if (stats) stats[k] = (stats[k] || 0) + 1; };

  const base = seedBase(rng, tier);
  const cars = base.cars;
  let board = boardOf(base, cars, null);
  let rating = solve(board, { limit });
  if (!rating.ok) { hit('seedBad'); return null; }

  let guard = 0;
  let last = 0;
  // The last board where every car demonstrably earned its space. Anything pushed after
  // this checkpoint is a debt: a plateau car is only welcome if a later car pays it off
  // by raising the number. Without the rollback the board just fills up with furniture
  // and the car budget runs out before the difficulty does.
  let saved = null;
  let debt = 0;
  const patience = tier.patience === undefined ? 2 : tier.patience;
  while (rating.moves < target && cars.length < tier.cars[1] && guard < (tier.probes || 900)) {
    guard++;
    hit('probe');
    const car = propose(rng, view(board), tier);
    if (!car) { hit('nofit'); continue; }
    const trial = boardOf(base, cars, car);
    if (validate(trial)) { hit('nofit'); continue; }
    const next = solve(trial, { limit });
    if (!next.ok) { hit('unsolvable'); continue; }
    if (next.moves > tier.max) { hit('tooHard'); continue; }
    if (next.moves > rating.moves) {
      cars.push(car);
      board = trial;
      rating = next;
      saved = null;
      debt = 0;
      hit('keep');
      last = guard;
    } else if (debt < patience) {
      if (!saved) saved = { n: cars.length, board, rating };
      cars.push(car);
      board = trial;
      debt++;
      hit('plateau');
    } else {
      hit('noGain');
    }
  }

  if (saved) {
    cars.length = saved.n;
    board = saved.board;
    rating = saved.rating;
  }
  if (rating.moves < tier.min) { hit(cars.length < tier.cars[0] ? 'tooFewCars' : 'underBand'); return null; }
  const c = census(board, tier.census || 200000);
  // The lot ships with both counting laws measured, and the cell count is taken on two
  // independent roads (BFS over single-cell steps, then Dijkstra over the drag graph billed
  // per cell). The ladder is still climbed in drags — that is the classic card convention
  // the bands are written against — but the second number has to be as good as the first,
  // because the screen prints it as a fact about the same position.
  const cellSearch = solve(board, { law: CELL, limit: tier.cellSearch || 200000 });
  if (!cellSearch.ok) throw new Error(`${tier.key}: the drag law solved a lot the cell law could not`);
  const cellWeighted = solveWeighted(board, { law: CELL, limit: tier.cellSearch || 200000 });
  if (!cellWeighted.ok || cellWeighted.moves !== cellSearch.moves) {
    throw new Error(`${tier.key}: cell par ${cellSearch.moves} disagrees with the weighted road (${cellWeighted.moves})`);
  }
  const w = witness(board.comp);
  if (w.drag > rating.moves || w.cell > cellSearch.moves) {
    throw new Error(`${tier.key}: the hand-countable witness (${w.drag}/${w.cell}) exceeds the measured par ${rating.moves}/${cellSearch.moves}`);
  }
  return {
    spec: board,
    rating: {
      moves: rating.moves, movesCell: cellSearch.moves, states: c.states, depth: c.depth,
      cars: cars.length, probes: last, witness: w,
    },
    path: rating.path,
    seed,
    tier: tier.key,
  };
}

// makeLot(seed, tier, stats?) -> { spec, rating, path } | null, deterministic in the seed.
export function makeLot(seed, tier, stats) {
  const tries = tier.restarts || 24;
  for (let i = 0; i < tries; i++) {
    const out = grow(`${seed}#${i}`, tier, stats);
    if (out) {
      if (stats) stats.found = (stats.found || 0) + 1;
      return out;
    }
  }
  if (stats) stats.gaveUp = (stats.gaveUp || 0) + 1;
  return null;
}

// The generation ladder. `min`/`max` are the band the grower is allowed to publish in;
// what players actually see is the band measured off the baked lots (TIERS_META in
// js/data/lots.js), so there is only ever one place that claims a difficulty range.
export const TIERS = [
  {
    key: 'kerb', label: '巷口', w: 5, h: 5,
    cars: [3, 7], min: 4, max: 6, trucks: false, patience: 1, probes: 300, restarts: 12,
  },
  {
    key: 'lane', label: '单行', w: 6, h: 6,
    cars: [4, 10], min: 8, max: 12, trucks: false, patience: 2, probes: 700, restarts: 16,
  },
  {
    key: 'junction', label: '路口', w: 6, h: 6,
    cars: [6, 12], min: 13, max: 17, trucks: true, patience: 3, probes: 1000, restarts: 20,
  },
  {
    key: 'gridlock', label: '死锁', w: 6, h: 6,
    cars: [8, 13], min: 18, max: 24, trucks: true, patience: 3, probes: 1400, restarts: 26,
  },
];

export function tierByKey(key) {
  return TIERS.find((t) => t.key === key) || TIERS[0];
}
