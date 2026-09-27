// The balance rig. Nothing here is a pass/fail gate — it is the instrument the tier
// bands were read off of, kept in the repo so the published numbers stay checkable.
//
//   node test/balance.mjs               # 40 sampled seeds per tier
//   SAMPLES=200 node test/balance.mjs   # a real distribution
//   TIERS=kerb,lane node test/balance.mjs

import { TIERS, makeLot } from '../js/core/make.js';

const N = Number(process.env.SAMPLES || 40);
const want = (process.env.TIERS || '').split(',').filter(Boolean);
const tiers = want.length ? TIERS.filter((t) => want.includes(t.key)) : TIERS;

function pct(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

const rows = [];
for (const tier of tiers) {
  const stats = {};
  const found = [];
  let ms = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const lot = makeLot(`balance-${i}`, tier, stats);
    const dt = performance.now() - t0;
    ms.push(dt);
    if (lot) found.push(lot);
  }
  const moves = found.map((f) => f.rating.moves).sort((a, b) => a - b);
  const states = found.map((f) => f.rating.states).sort((a, b) => a - b);
  const cars = found.map((f) => f.rating.cars).sort((a, b) => a - b);
  ms.sort((a, b) => a - b);
  rows.push({
    tier: tier.key,
    band: `${tier.min}-${tier.max}`,
    accepted: `${found.length}/${N}`,
    moves: moves.length ? `${pct(moves, 0)}/${pct(moves, 0.5)}/${pct(moves, 1)}` : '—',
    cars: cars.length ? `${pct(cars, 0)}/${pct(cars, 1)}` : '—',
    states: states.length ? `${pct(states, 0)}/${pct(states, 0.5)}/${pct(states, 1)}` : '—',
    ms: ms.length ? `${pct(ms, 0.5).toFixed(0)}/${ms[ms.length - 1].toFixed(0)}` : '—',
    hist: moves.length ? moves.map((m) => m.toFixed(0)).join(' ') : '—',
    reject: Object.entries(stats)
      .filter(([k, v]) => v && k !== 'found')
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`).join(' '),
  });
}

const head = ['tier', 'band', 'accept', 'moves min/med/max', 'cars', 'states min/med/max', 'ms med/max', 'per-tier tallies'];
console.log(head.map((h, i) => h.padEnd(i < 2 ? 8 : 18)).join(' '));
for (const r of rows) {
  console.log([r.tier, r.band, r.accepted, r.moves, r.cars, r.states, r.ms, r.reject]
    .map((v, i) => String(v).padEnd(i < 2 ? 8 : 18)).join(' '));
}
console.log(`\nsamples per tier: ${N}  (SAMPLES=… to change, TIERS=kerb,lane to subset)`);
for (const r of rows) console.log(`${r.tier} moves, sorted: ${r.hist}`);
