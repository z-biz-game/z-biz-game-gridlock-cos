// The generator. Only the cheapest band is exercised here — the ladder-wide acceptance
// rates and the cost of each tier are test/balance.mjs's job, and reading them takes
// minutes rather than milliseconds.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { validate, toSpec } from '../js/core/lot.js';
import { solve } from '../js/core/solve.js';
import { CELL } from '../js/core/law.js';
import { TIERS, makeLot, tierByKey } from '../js/core/make.js';

const kerb = TIERS[0];
// A lot's identity for comparison purposes: the plain, JSON-shaped board.
const face = (lot) => JSON.stringify(toSpec(lot.spec.comp, lot.spec.comp.start));

test('a seed grows the same lot every time', () => {
  const a = makeLot('s1', kerb);
  const b = makeLot('s1', kerb);
  ok(a, 'kerb is expected to land on the first few tries');
  eq(face(a), face(b), 'same seed, same lot');
  eq(a.rating, b.rating, 'and the same measurement of it');
});

test('what grows is legal, in band, and solvable for the number it claims', () => {
  const lot = makeLot('s7', kerb);
  eq(validate(lot.spec), null, 'a legal lot');
  const r = solve(lot.spec);
  ok(r.ok, 'solvable — the grower only ever measures solvable boards');
  eq(r.moves, lot.rating.moves, 'the printed par is the searched par');
  eq(r.path.length, lot.path.length, 'and the route it came with is the same length');
  ok(lot.rating.moves >= kerb.min && lot.rating.moves <= kerb.max, `band: got ${lot.rating.moves}`);
  ok(lot.spec.cars.length >= kerb.cars[0] && lot.spec.cars.length <= kerb.cars[1], 'car budget honoured');
  eq(lot.spec.comp.hero >= 0, true, 'there is a hero to drive out');
  eq(lot.rating.states > 0, true, 'the census ran');
});

test('the grower carries a second number, measured on the way out rather than derived', () => {
  const lot = makeLot('s7', kerb);
  const cell = solve(lot.spec, { law: CELL });
  ok(cell.ok, 'a board the drag law can get out of is solvable one cell at a time too');
  eq(cell.moves, lot.rating.movesCell, 'the number the grower returns is the number the search finds');
  ok(cell.moves >= lot.rating.moves, `and it cannot bill fewer steps than the drag law (${cell.moves} < ${lot.rating.moves})`);
  const w = lot.rating.witness;
  ok(w.drag <= lot.rating.moves && w.cell <= cell.moves, `floor ${w.drag}/${w.cell} must sit under ${lot.rating.moves}/${cell.moves}`);
  eq(lot.rating.states > 0, true, 'the census still ran once per lot, law-independent');
});

test('kerb ships on every seed, and never past its ceiling', () => {
  const faces = new Set();
  for (let i = 0; i < 10; i++) {
    const lot = makeLot(`kerb-seed-${i}`, kerb);
    ok(lot, `seed ${i} gave up, which the rig says should not happen at this band`);
    ok(lot.rating.moves >= kerb.min, `${lot.rating.moves} under the floor`);
    ok(lot.rating.moves <= kerb.max, `${lot.rating.moves} over the ceiling`);
    faces.add(face(lot));
  }
  ok(faces.size >= 6, `ten seeds produced ${faces.size} distinct lots — the generator is a copy machine`);
});

test('an unknown tier key falls back instead of producing nonsense', () => {
  eq(tierByKey('nonsense'), TIERS[0]);
  const lot = makeLot('fb', tierByKey('nonsense'));
  ok(lot && validate(lot.spec) === null);
});

test('the ladder is a ladder', () => {
  for (let i = 1; i < TIERS.length; i++) {
    ok(TIERS[i].min > TIERS[i - 1].max, `${TIERS[i].key} overlaps ${TIERS[i - 1].key}`);
    ok(TIERS[i].probes >= TIERS[i - 1].probes, `${TIERS[i].key} gets less search than an easier band`);
  }
  eq(TIERS[0].trucks, false, 'the easy band starts without long cars');
  eq(TIERS[TIERS.length - 1].trucks, true);
});

run();
