// The shipped lot pool. The game picks levels from here; it never generates them, and
// that is a measured decision — see tools/bake.mjs for why the generator lives at build
// time instead of on tap.
//
// Everything below is a pure lookup over js/data/lots.js, which is why the daily puzzle
// and a shared link are reproducible without any state: the pool is fixed, and the seed
// only chooses an index.

import { LOTS, TIERS_META } from '../data/lots.js';
import { compile } from './lot.js';
import { hashSeed } from './rng.js';

// Display-side tier list (label / blurb / band). The generation-side ladder with its
// search budgets lives in make.js and is not needed once the lots are baked.
export const TIERS = TIERS_META;

const prepared = LOTS.map((row) => ({
  id: row.id,
  tier: row.tier,
  par: row.moves,
  parCell: row.movesCell,
  witness: row.witness,
  table: row.table,
  states: row.states,
  cars: row.cars,
  spec: row.spec,
  comp: compile(row.spec),
}));

export const ALL = prepared;

function pick(list, seed, salt) {
  if (!list.length) return null;
  return list[hashSeed(`${salt}|${seed}`) % list.length];
}

export function tierByKey(key) {
  return TIERS.find((t) => t.key === key) || TIERS[0];
}

export function lotsIn(key) {
  return prepared.filter((l) => l.tier === key);
}

export function byId(id) {
  return prepared.find((l) => l.id === id) || null;
}

// The campaign: every baked lot, lowest band first and within a band easiest first —
// which is exactly the order tools/bake.mjs wrote them in.
export function campaign() {
  return prepared;
}

export function levelAt(index) {
  return prepared[((index % prepared.length) + prepared.length) % prepared.length];
}

// Endless play in one band. A seed picks, so `?seed=` links stay honest.
export function randomLot(seed, tierKey) {
  const list = tierKey ? lotsIn(tierKey) : prepared;
  return pick(list, seed, 'random');
}

// One puzzle per calendar day, the same for everyone.
export function dailyLot(dateKey) {
  return pick(prepared, dateKey, 'daily');
}

// What the shipped pool actually contains, measured rather than claimed: the harness
// prints this so a re-bake that quietly loses difficulty shows up as a changed band.
// `med` is there for the same reason — a tier where every lot lands on the same number is
// one level wearing four costumes, and min/max alone cannot see that.
function median(sorted) {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

export function stats() {
  const byTier = {};
  for (const l of prepared) {
    const s = byTier[l.tier] || (byTier[l.tier] = {
      n: 0, min: Infinity, max: 0, cellMin: Infinity, cellMax: 0, tabled: 0,
      carsMin: Infinity, carsMax: 0, statesMin: Infinity, statesMax: 0, moves: [], cells: [], states: [],
    });
    s.n++;
    if (l.par < s.min) s.min = l.par;
    if (l.par > s.max) s.max = l.par;
    if (l.parCell < s.cellMin) s.cellMin = l.parCell;
    if (l.parCell > s.cellMax) s.cellMax = l.parCell;
    if (l.table) s.tabled++;
    if (l.cars < s.carsMin) s.carsMin = l.cars;
    if (l.cars > s.carsMax) s.carsMax = l.cars;
    if (l.states < s.statesMin) s.statesMin = l.states;
    if (l.states > s.statesMax) s.statesMax = l.states;
    s.moves.push(l.par);
    s.cells.push(l.parCell);
    s.states.push(l.states);
  }
  for (const s of Object.values(byTier)) {
    s.moves.sort((a, b) => a - b);
    s.cells.sort((a, b) => a - b);
    s.states.sort((a, b) => a - b);
    s.movesMed = median(s.moves);
    s.cellsMed = median(s.cells);
    s.statesMed = median(s.states);
    delete s.moves;
    delete s.cells;
    delete s.states;
  }
  return { lots: prepared.length, byTier };
}
