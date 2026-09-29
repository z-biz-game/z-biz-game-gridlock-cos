// What a step costs. This is the module every other number in the game hangs off, so it
// gets its own red lines: the billing rule, the shared-vertex claim that lets two laws
// describe one lot, and the hand-countable floor that bounds both of them from below.
//
// The expected values here are typed from test/fixture.mjs's picture (CHAIN: hero R needs
// four cells to reach the gate at x=6, A is the single car in the lane ahead of its nose),
// not read back out of the functions under test.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { CHAIN, CLEAR, DEAD } from './fixture.mjs';
import { compile, encode, step } from '../js/core/lot.js';
import { DRAG, CELL, LAWS, lawOf, cost, eachStep, successors, spent, parOf, witness } from '../js/core/law.js';
import { census } from '../js/core/solve.js';

const noop = () => undefined;

// Every position one step of `law` away from `pos`, as encoded states.
function oneStep(comp, pos, law) {
  const out = new Set();
  eachStep(comp, pos, law, (car, delta) => out.add(encode(step(Uint8Array.from(pos), { car, delta }))));
  return out;
}

// … and everything a player can wander into using only that law's step.
function closure(comp, law) {
  const seen = new Set();
  const queue = [Uint8Array.from(comp.start)];
  seen.add(encode(queue[0]));
  for (let head = 0; head < queue.length; head++) {
    for (const m of successors(comp, queue[head], law)) {
      const next = step(Uint8Array.from(queue[head]), m);
      const key = encode(next);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen;
}

test('the law list is exactly the two conventions, and each says what it bills', () => {
  eq(LAWS.map((l) => l.key), ['drag', 'cell'], 'a third law would need its own measured pars on every lot');
  eq(LAWS.map((l) => l.label), ['滑步', '格步']);
  for (const l of LAWS) ok(l.bill && l.note, `${l.key} tells the player what it counts`);
  eq(lawOf(DRAG).key, DRAG);
  eq(lawOf(CELL).key, CELL);
});

test('an unknown law is refused rather than silently counted', () => {
  const comp = compile(CHAIN);
  const game = { moves: 3, cells: 7, par: 3, parCell: 6 };
  const probes = [
    ['cost', () => cost('kvorn', 2)],
    ['eachStep', () => eachStep(comp, Uint8Array.from(comp.start), 'kvorn', noop)],
    ['successors', () => successors(comp, Uint8Array.from(comp.start), 'kvorn')],
    ['spent', () => spent(game, 'kvorn')],
    ['parOf', () => parOf(game, 'kvorn')],
  ];
  let threw = '';
  try { lawOf('triples'); } catch (err) { threw = err.message; }
  ok(/unknown counting law/.test(threw), `lawOf must throw, got ${threw || 'nothing'}`);
  for (const row of probes) {
    threw = '';
    try { row[1](); } catch (err) { threw = err.message; }
    ok(/unknown counting law/.test(threw), `${row[0]} goes through the same gate instead of defaulting, got ${threw || 'nothing'}`);
  }
});

test('a drag bills one, a cell bills the distance, nothing bills zero', () => {
  eq([cost(DRAG, 1), cost(DRAG, 3), cost(DRAG, -4)], [1, 1, 1], 'the classic convention: the pull is the step');
  eq([cost(CELL, 1), cost(CELL, 3), cost(CELL, -4)], [1, 3, 4], 'the second convention: the road is the step');
  eq([cost(DRAG, 0), cost(CELL, 0)], [0, 0], 'a drag that went nowhere is not charged to either');
});

test('every cell step is also a drag, so the cell neighbourhood sits inside the drag one', () => {
  const comp = compile(CHAIN);
  const pos = Uint8Array.from(comp.start);
  const cells = oneStep(comp, pos, CELL);
  const drags = oneStep(comp, pos, DRAG);
  ok(cells.size < drags.size, `one cell each way is ${cells.size} positions, every reachable distance is ${drags.size}`);
  for (const key of cells) ok(drags.has(key), `a cell step (${key}) has to be legal as a drag too`);
  eq(successors(comp, pos, CELL).every((m) => Math.abs(m.delta) === 1), true, 'the cell law only ever emits single cells');
  eq(successors(comp, pos, DRAG).some((m) => Math.abs(m.delta) > 1), true, 'and the drag law does not');
});

// The claim the whole extension rests on: a k-cell drag is a length-k path of cell steps,
// so the two laws do not disagree about which positions exist — only about what they cost.
// If this ever fails, the second par on screen is measuring a different game.
test('the two laws span the same graph', () => {
  const comp = compile(CHAIN);
  const a = closure(comp, DRAG);
  const b = closure(comp, CELL);
  eq(b.size, a.size, 'the same reachable positions, counted by two different step rules');
  for (const key of b) ok(a.has(key), 'and the same set, not two sets of equal size');
  eq(a.size, census(CHAIN).states, 'a third enumeration, over lot.js own move list, agrees');
});

test('the floor the exit lane forces is hand-countable on the picture', () => {
  eq(witness(compile(CHAIN)), { heroCells: 4, blockers: 1, drag: 2, cell: 5 }, 'four cells for the hero, one car in them');
  eq(witness(compile(CLEAR)), { heroCells: 0, blockers: 0, drag: 0, cell: 0 }, 'a lot that is already out demands nothing');
  // DEAD has A-style concrete in the lane, but it is the column of cars that cannot move at
  // all: the floor counts steps a route would need, and this lot has no route to bound.
  const dead = witness(compile(DEAD));
  eq([dead.heroCells, dead.blockers], [4, 1], 'the hero still has four cells of road in front of it');
});

test('the ledger accessors read the counter and the par of the law asked about', () => {
  const g = { moves: 3, cells: 7, par: 3, parCell: 6 };
  eq([spent(g, DRAG), spent(g, CELL)], [3, 7]);
  eq([parOf(g, DRAG), parOf(g, CELL)], [3, 6]);
});

run();
