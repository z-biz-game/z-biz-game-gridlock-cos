// The other rig: what happens if you *scatter* cars instead of growing them.
//
// js/core/make.js is built the way it is because random placement cannot reach a hard jam,
// and a comment asserting that is worth nothing unless somebody can re-run the measurement.
// This is that measurement. Nothing here is a pass/fail gate — the numbers are printed, and
// DESIGN.md 第 3 节 quotes whatever this last said.
//
//   node test/scatter.mjs                 # 5000 boards per tier
//   SAMPLES=50000 node test/scatter.mjs
//   TIERS=gridlock node test/scatter.mjs
//
// Scatter gets the *generous* treatment on purpose: as many cars as the tier's budget
// allows, trucks where the tier allows trucks, and every placement attempt retried dozens of
// times, so a low hit rate cannot be blamed on a stingy sampler.
//
// Bands are the drag-law bands in TIERS, so `moves` here is solved under DRAG — the same
// law the grower stops on, which is the only law under which the two rigs are comparable.

import { TIERS } from '../js/core/make.js';
import { solve } from '../js/core/solve.js';
import { validate } from '../js/core/lot.js';
import { DRAG } from '../js/core/law.js';
import { rngFrom } from '../js/core/rng.js';

const N = Number(process.env.SAMPLES || 5000);
const want = (process.env.TIERS || '').split(',').filter(Boolean);
const tiers = want.length ? TIERS.filter((t) => want.includes(t.key)) : TIERS;

function pct(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

// A legal lot with the tier's maximum car budget, chosen uniformly. `short` reports how many
// cars scatter gave up on — its own fact about scatter is that it runs out of room for cars
// it has no use for.
function scatter(rng, tier) {
  const taken = new Set();
  const cellsOf = (car) => {
    const out = [];
    for (let k = 0; k < car.len; k++) out.push(car.axis === 'h' ? `${car.x + k},${car.y}` : `${car.x},${car.y + k}`);
    return out;
  };
  const put = (car) => {
    const cells = cellsOf(car);
    if (cells.some((c) => taken.has(c))) return false;
    cells.forEach((c) => taken.add(c));
    return true;
  };
  const exitRow = rng.int(tier.h);
  const hero = { x: rng.range(0, tier.w - 2), y: exitRow, len: 2, axis: 'h', hero: true };
  const cars = [hero];
  put(hero);
  let gaps = 0;
  for (let n = 1; n < tier.cars[1]; n++) {
    let placed = false;
    for (let attempt = 0; attempt < 40 && !placed; attempt++) {
      const axis = rng.chance(0.5) ? 'h' : 'v';
      const len = tier.trucks && rng.chance(0.3) ? 3 : 2;
      const along = (axis === 'h' ? tier.w : tier.h) - len;
      if (along < 0) break;
      const car = {
        x: axis === 'h' ? rng.range(0, along) : rng.int(tier.w),
        y: axis === 'h' ? rng.int(tier.h) : rng.range(0, along),
        len,
        axis,
      };
      if (put(car)) {
        cars.push(car);
        placed = true;
      }
    }
    if (!placed) gaps++;
  }
  return { spec: { w: tier.w, h: tier.h, exitRow, cars, walls: [] }, short: gaps };
}

const rows = [];
for (const tier of tiers) {
  const rng = rngFrom('scatter');
  let unsolvable = 0;
  let inBand = 0;
  let atTop = 0;
  let shortBoards = 0;
  const moves = [];
  const carCounts = [];
  for (let i = 0; i < N; i++) {
    const { spec, short } = scatter(rng, tier);
    const err = validate(spec);
    if (err) throw new Error(`scatter built an illegal lot (${err}); the tally would measure nothing`);
    if (short) shortBoards++;
    carCounts.push(spec.cars.length);
    const r = solve(spec, { law: DRAG, limit: 200000 });
    if (!r.ok) { unsolvable++; continue; }
    moves.push(r.moves);
    if (r.moves >= tier.min) inBand++;
    if (r.moves >= tier.max) atTop++;
  }
  moves.sort((a, b) => a - b);
  carCounts.sort((a, b) => a - b);
  rows.push({
    tier: tier.key,
    band: `${tier.min}-${tier.max}`,
    cars: `${pct(carCounts, 0)}/${pct(carCounts, 0.5)}/${pct(carCounts, 1)}`,
    unfilled: `${shortBoards}/${N}`,
    unsolvable: `${unsolvable}/${N}`,
    moves: moves.length ? `${pct(moves, 0)}/${pct(moves, 0.5)}/${pct(moves, 1)}` : '—',
    inBand: `${inBand}/${N}`,
    atTop: `${atTop}/${N}`,
  });
}

const head = ['tier', 'drag band', 'cars placed', 'short of budget', 'unsolvable', 'moves min/med/max', '>= band floor', '>= band ceiling'];
console.log(`scatter: random placement, no growth. cars budget per tier = ${tiers.map((t) => `${t.key} ${t.cars[1]}`).join(', ')}`);
console.log(head.map((h, i) => h.padEnd(i < 4 ? 15 : 17)).join(' '));
for (const r of rows) {
  console.log([r.tier, r.band, r.cars, r.unfilled, r.unsolvable, r.moves, r.inBand, r.atTop]
    .map((v, i) => String(v).padEnd(i < 4 ? 15 : 17)).join(' '));
}
console.log(`\nboards per tier: ${N}  (SAMPLES=… to change, TIERS=gridlock to subset)`);
console.log('`>= band ceiling` is the column the grower exists because of: a scattered lot that');
console.log('reaches the tier\'s own top number is the thing scatter was said to be unable to do.');
