// The shipped pool. These tests are the second half of the build-time promise: bake.mjs
// certifies a lot as it writes it, and this suite re-certifies whatever is actually in
// js/data/lots.js, so a hand-edit or a stale file fails here instead of in someone's face.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { validate, compile, encode, toSpec } from '../js/core/lot.js';
import { solve } from '../js/core/solve.js';
import {
  TIERS, ALL, byId, lotsIn, campaign, levelAt, tierByKey, randomLot, dailyLot, stats,
} from '../js/core/library.js';

test('the pool is not empty, and every entry is legal', () => {
  ok(ALL.length >= 32, `there should be a game here, got ${ALL.length} lots`);
  for (const lot of ALL) eq(validate(lot.spec), null, `${lot.id} must be a legal lot`);
});

test('every printed par reproduces from the shipped spec', () => {
  const wrong = [];
  for (const lot of ALL) {
    const r = solve(lot.spec);
    if (!r.ok || r.moves !== lot.par) wrong.push(`${lot.id}: claims ${lot.par}, search says ${r.ok ? r.moves : 'unsolvable'}`);
  }
  eq(wrong, [], 'a level is a measurement, so the measurement has to still hold');
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
    const measured = lotsIn(tier.key).map((l) => l.par);
    eq([tier.min, tier.max], [Math.min(...measured), Math.max(...measured)], `${tier.key} band`);
    eq([s.byTier[tier.key].min, s.byTier[tier.key].max], [tier.min, tier.max], `${tier.key} stats`);
    ok(/步/.test(tier.blurb), `${tier.key} advertises its band in the blurb`);
  }
  for (let i = 1; i < TIERS.length; i++) {
    ok(TIERS[i].min > TIERS[i - 1].max, `bands must not overlap: ${TIERS.map((t) => `${t.key} ${t.min}-${t.max}`).join(' · ')}`);
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
    ok(s2.movesMed >= tier.min && s2.movesMed <= tier.max, `${tier.key} median ${s2.movesMed} outside its band ${tier.min}-${tier.max}`);
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
