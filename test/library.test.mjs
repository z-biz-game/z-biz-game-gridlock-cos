// The shipped pool. These tests are the second half of the build-time promise: bake.mjs
// certifies a lot as it writes it, and this suite re-certifies whatever is actually in
// js/data/lots.js, so a hand-edit or a stale file fails here instead of in someone's face.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { validate, compile, encode, toSpec } from '../js/core/lot.js';
import { solve, solveWeighted, distTable } from '../js/core/solve.js';
import { DRAG, CELL, witness } from '../js/core/law.js';
import {
  TIERS, ALL, byId, lotsIn, campaign, levelAt, tierByKey, randomLot, dailyLot, stats,
} from '../js/core/library.js';

test('the pool is not empty, and every entry is legal', () => {
  ok(ALL.length >= 32, `there should be a game here, got ${ALL.length} lots`);
  for (const lot of ALL) eq(validate(lot.spec), null, `${lot.id} must be a legal lot`);
});

// The heavy half of the build-time promise, re-run on what actually shipped. Each of the two
// numbers on a lot is measured twice — a BFS over that law's own steps, and a weighted search
// over the drag graph billed by cost(law, delta) — and both have to land on the figure in the
// file. bake.mjs refuses to write a row that fails this, so a failure here means the file was
// edited, is stale, or one of the two roads changed under the other.
test('every printed par reproduces from the shipped spec, on both roads', () => {
  const wrong = [];
  for (const lot of ALL) {
    const claims = [[DRAG, lot.par], [CELL, lot.parCell]];
    for (const [law, claimed] of claims) {
      const bfs = solve(lot.spec, { law });
      if (!bfs.ok || bfs.moves !== claimed) {
        wrong.push(`${lot.id}/${law}: claims ${claimed}, BFS says ${bfs.ok ? bfs.moves : 'unsolvable'}`);
        continue;
      }
      const weighted = solveWeighted(lot.spec, { law });
      if (!weighted.ok || weighted.moves !== claimed) {
        wrong.push(`${lot.id}/${law}: BFS ${bfs.moves}, weighted road ${weighted.ok ? weighted.moves : 'unsolvable'}`);
      }
    }
  }
  eq(wrong, [], 'a level is a measurement, so the measurement has to still hold');
});

// Two arithmetic facts about the pair of numbers, asserted across the whole pool because
// they are what makes the pair worth printing rather than a curiosity: the cell law can only
// bill more steps than the drag law for the same route, and the exit lane alone already
// forces part of both totals.
test('the two numbers keep their order, and the witness stays under both', () => {
  const wrong = [];
  for (const lot of ALL) {
    if (lot.parCell < lot.par) wrong.push(`${lot.id}: ${lot.parCell} cells for a ${lot.par}-drag route`);
    const w = witness(lot.spec.comp || compile(lot.spec));
    const shipped = JSON.stringify(w);
    if (shipped !== JSON.stringify(lot.witness)) wrong.push(`${lot.id}: witness is ${JSON.stringify(lot.witness)}, the board says ${shipped}`);
    if (w.drag > lot.par || w.cell > lot.parCell) wrong.push(`${lot.id}: floor ${w.drag}/${w.cell} above ${lot.par}/${lot.parCell}`);
  }
  eq(wrong, [], 'no lot bills fewer cells than drags, and no lot sits below its own floor');
});

// If every lot billed the same multiple, the second number would be arithmetic and the
// switch on screen would be decoration. Across the 64 shipped rows the ratio runs from 1.00
// (a lot whose drags are all single cells, in kerb) to 2.75.
test('the two numbers are not one number scaled', () => {
  const ratios = ALL.map((l) => l.parCell / l.par);
  const min = Math.min(...ratios);
  const max = Math.max(...ratios);
  ok(min === 1, `some lot must bill identically under both laws, closest is ${min}`);
  ok(max >= 2, `at least one lot must bill more than twice as much in cells, highest is ${max}`);
  const distinct = new Set(ratios.map((r) => r.toFixed(2))).size;
  ok(distinct >= 8, `only ${distinct} distinct ratios across ${ALL.length} lots — the pair looks like a formula`);
});

test('the rows that ship a position-by-position certificate still earn it', () => {
  const tabled = ALL.filter((l) => l.table);
  ok(tabled.length >= Math.floor(ALL.length * 0.75),
    `${tabled.length}/${ALL.length} rows carry the stronger certificate; the docs say the pool is mostly certified position by position`);
  const wrong = [];
  for (const lot of tabled) {
    const at = encode(compile(lot.spec).start);
    const bfs = distTable(lot.spec, { law: CELL, via: 'bfs', limit: 40000 });
    if (bfs.truncated) { wrong.push(`${lot.id}: the component no longer fits the table budget, but ships table ${JSON.stringify(lot.table)}`); continue; }
    if (bfs.states !== lot.table.states || bfs.maxDist !== lot.table.maxDist || bfs.roots !== lot.table.roots) {
      wrong.push(`${lot.id}: shipped ${JSON.stringify(lot.table)}, recomputed ${JSON.stringify({ states: bfs.states, maxDist: bfs.maxDist, roots: bfs.roots })}`);
    }
    if (bfs.dist.get(at) !== lot.parCell) wrong.push(`${lot.id}: the table puts its own start line at ${bfs.dist.get(at)}, the line says ${lot.parCell}`);
    const weighted = distTable(lot.spec, { law: CELL, via: 'weighted', limit: 40000 });
    for (const [key, d] of bfs.dist) if (weighted.dist.get(key) !== d) wrong.push(`${lot.id}: position ${key} is ${d} steps one road, ${weighted.dist.get(key)} the other`);
  }
  eq(wrong, [], 'a table is a claim about every position a player can reach, in both roads');
});

test('ids are unique, shaped after their tier, and every tier ships something', () => {
  const seen = new Set();
  for (const lot of ALL) {
    ok(!seen.has(lot.id), `${lot.id} appears twice`);
    seen.add(lot.id);
    ok(new RegExp(`^${lot.tier}-\\d+$`).test(lot.id), `${lot.id} does not look like a ${lot.tier} id`);
    ok(lot.par >= 1, `${lot.id} starts with the hero already outside`);
  }
  for (const tier of TIERS) ok(lotsIn(tier.key).length > 0, `${tier.key} shipped nothing`);
});

test('the bands on screen are the bands in the file', () => {
  const s = stats();
  eq(s.lots, ALL.length);
  for (const tier of TIERS) {
    const mine = lotsIn(tier.key);
    const measured = mine.map((l) => l.par);
    const cells = mine.map((l) => l.parCell);
    eq([tier.min, tier.max], [Math.min(...measured), Math.max(...measured)], `${tier.key} drag band`);
    eq([tier.minCell, tier.maxCell], [Math.min(...cells), Math.max(...cells)], `${tier.key} cell band`);
    eq([s.byTier[tier.key].min, s.byTier[tier.key].max], [tier.min, tier.max], `${tier.key} drag stats`);
    eq([s.byTier[tier.key].cellMin, s.byTier[tier.key].cellMax], [tier.minCell, tier.maxCell], `${tier.key} cell stats`);
    ok(/滑步/.test(tier.blurb) && /格步/.test(tier.blurb), `${tier.key} advertises both bands, since both are on screen`);
  }
  // The drag bands are what the shelf is ordered by, so they must not overlap. The cell bands
  // genuinely do (lane 11-22, junction 22-42): two lots can be a longer walk in drags and the
  // same walk in cells, so that pair is a fact about the pool, not a sorting bug.
  for (let i = 1; i < TIERS.length; i++) {
    ok(TIERS[i].min > TIERS[i - 1].max, `drag bands must not overlap: ${TIERS.map((t) => `${t.key} ${t.min}-${t.max}`).join(' · ')}`);
  }
});

test('the pool summary the docs are copied from is finite and inside its band', () => {
  // README and deliverable.md quote a min/med/max table generated from this function
  // (`node -e "import('./js/core/library.js').then(m => console.log(m.stats()))"`).
  // A median is a derived number, so asserting its value here would only re-run its own
  // formula; what can genuinely break is a missing field going NaN, or a band moving so far
  // that the centre of the pool no longer sits inside what the shelf advertises.
  const s = stats();
  for (const tier of TIERS) {
    const s2 = s.byTier[tier.key];
    for (const [k, v] of Object.entries(s2)) {
      ok(Number.isFinite(v), `${tier.key}.${k} is ${v}, not a number`);
    }
    ok(s2.movesMed >= tier.min && s2.movesMed <= tier.max, `${tier.key} drag median ${s2.movesMed} outside its band ${tier.min}-${tier.max}`);
    ok(s2.cellsMed >= tier.minCell && s2.cellsMed <= tier.maxCell, `${tier.key} cell median ${s2.cellsMed} outside its band ${tier.minCell}-${tier.maxCell}`);
    ok(s2.tabled <= s2.n, `${tier.key} certifies more rows than it has`);
    ok(s2.statesMin <= s2.statesMed && s2.statesMed <= s2.statesMax, `${tier.key} states median outside its own range`);
    ok(s2.carsMin <= s2.carsMax, `${tier.key} has its car range inverted`);
  }
});

test('the campaign walks upwards and wraps around', () => {
  eq(campaign().length, ALL.length);
  for (const tier of TIERS) {
    const pars = lotsIn(tier.key).map((l) => l.par);
    eq(pars, [...pars].sort((a, b) => a - b), `${tier.key} is not sorted easiest first`);
  }
  const order = campaign().map((l) => TIERS.findIndex((t) => t.key === l.tier));
  eq(order, [...order].sort((a, b) => a - b), 'a tier must not reappear after a harder one');
  eq(levelAt(0).id, ALL[0].id);
  eq(levelAt(-1).id, ALL[ALL.length - 1].id, 'walking off the front lands at the back');
  eq(levelAt(ALL.length).id, ALL[0].id, 'and off the end lands at the start');
  eq(byId('not-a-lot'), null);
  eq(byId(ALL[3].id), ALL[3]);
});

test('a shared pick is the same pick', () => {
  const today = '2026-09-27';
  eq(dailyLot(today), dailyLot(today), 'the daily puzzle is a function of the date');
  ok(ALL.includes(dailyLot(today)), 'and it comes out of the pool');
  const a = dailyLot('2026-09-27');
  const b = dailyLot('2026-09-28');
  ok(a && b, 'both days have a lot');
  for (const tier of TIERS) {
    const seed = '4kq2';
    eq(randomLot(seed, tier.key), randomLot(seed, tier.key), `${tier.key} is not deterministic`);
    eq(randomLot(seed, tier.key).tier, tier.key, `${tier.key} handed out someone else's lot`);
    ok(lotsIn(tier.key).includes(randomLot(seed, tier.key)), `${tier.key} picked from outside its band`);
  }
  ok(randomLot('a', null), 'a seed with no band still finds a lot');
  eq(tierByKey('nonsense'), TIERS[0], 'an unknown tier falls back rather than crashing the route');
});

test('a shipped spec survives its own round trip', () => {
  for (const lot of ALL) {
    const comp = compile(lot.spec);
    const again = compile(toSpec(comp, comp.start));
    eq(encode(again.start), encode(comp.start), `${lot.id} moved cars in the round trip`);
    eq(again.hero, comp.hero, `${lot.id} lost its hero`);
    eq(again.wall.reduce((a, b) => a + b, 0), lot.spec.walls.length, `${lot.id} gained or lost concrete`);
  }
});

test('the shelf gets harder as it goes up', () => {
  const first = lotsIn(TIERS[0].key);
  const last = lotsIn(TIERS[TIERS.length - 1].key);
  ok(last[last.length - 1].par > first[0].par * 2, 'the hardest lot outshines the easiest by more than a double');
  for (const lot of ALL) ok(lot.states > 0, `${lot.id} shipped without a state count`);
  for (const tier of TIERS) ok(stats().byTier[tier.key].carsMax >= 2, `${tier.key} has cars in it`);
});

run();
