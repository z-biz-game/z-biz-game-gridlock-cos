// What a step costs. Exactly one file in this game says so, and it says it twice, because
// a jam has two legitimate answers to "how many steps is this":
//
//   drag — one drag is one step however many cells the car slid. This is the classic card
//          convention, and it is what makes a par here comparable with a par printed on a
//          shop-bought card.
//   cell — one cell slid is one step, so a three-cell slide bills three.
//
// Neither law changes which positions are legal — that is js/core/lot.js — and neither
// changes the *vertices* of the search graph: a k-cell drag is exactly a length-k path of
// cell steps, so both laws measure the same reachable state set with two different metrics.
// That is why every number the screen prints about hardness travels with the law it was
// counted in, and why one position can honestly be "18" and "31" at the same time.

import { occupancy, reach } from './lot.js';

export const DRAG = 'drag';
export const CELL = 'cell';

export const LAWS = [
  { key: DRAG, label: '滑步', bill: '一次拖动记 1 步', note: '经典卡片口径：拖 3 格也是 1 步' },
  { key: CELL, label: '格步', bill: '滑 1 格记 1 步', note: '同一张盘：拖 3 格记 3 步' },
];

export function lawOf(key) {
  const hit = LAWS.find((l) => l.key === key);
  if (!hit) throw new Error(`unknown counting law: ${String(key)}`);
  return hit;
}

// How many steps a slide of `delta` cells bills under `key`. The one ledger rule; the game
// counter, the searches and the tests all go through here rather than re-deriving it.
export function cost(key, delta) {
  lawOf(key);
  if (!delta) return 0;
  return key === CELL ? Math.abs(delta) : 1;
}

// One step's successors under `key`: cb(car, delta). Under the cell law only single-cell
// slides are edges; under the drag law every reachable distance is its own edge.
export function eachStep(comp, pos, key, cb, scratch) {
  lawOf(key);
  const occ = occupancy(comp, pos, scratch);
  for (let i = 0; i < comp.n; i++) {
    const [back, fwd] = reach(comp, occ, i, pos[i]);
    if (key === CELL) {
      if (back > 0) cb(i, -1);
      if (fwd > 0) cb(i, 1);
    } else {
      for (let d = 1; d <= back; d++) cb(i, -d);
      for (let d = 1; d <= fwd; d++) cb(i, d);
    }
  }
}

export function successors(comp, pos, key) {
  const out = [];
  eachStep(comp, pos, key, (car, delta) => out.push({ car, delta }));
  return out;
}

// The two numbers a game in progress carries, read out for the law the player chose. Both
// go through the same gate as the billing rule: a shell that had remembered a law we do not
// have must not quietly fall back to the classic one and print a number under the wrong name.
export function spent(game, key) {
  lawOf(key);
  return key === CELL ? game.cells : game.moves;
}

export function parOf(lot, key) {
  lawOf(key);
  return key === CELL ? lot.parCell : lot.par;
}

// The hand-countable witness: what the exit lane alone forces, with no search at all.
//   · the hero must be driven to the gate, so it alone travels `heroCells` cells — and one
//     drag does that, so a lot that still has road ahead of it needs at least one action;
//   · every *other* car sitting in the lane ahead of its nose has to vacate a cell the
//     hero will pass through, so each of them moves at least one cell — and one cell is
//     one step under either law.
// Add those and you get a floor for both numbers. It is not the answer (a real jam makes
// cars step aside and come back), which is exactly why the gap between this floor and the
// measured par is the interesting quantity: it says how much maneuvering the lot forces
// beyond the moves you can see from the card.
//
// A floor stated in steps of a law is only a statement about a lot that can be solved: an
// unsolvable position has no route to bound, and a lot the hero is already outside of has
// no cells to travel. The generator measures this on rows the search already solved, and
// bake.mjs fails a row whose floor exceeds either measured number.
export function witness(comp) {
  const hero = comp.hero;
  const at = comp.start[hero];
  const heroCells = Math.max(0, comp.w - comp.len[hero] - at);
  const nose = at + comp.len[hero];
  const blockers = new Set();
  for (let i = 0; i < comp.n; i++) {
    if (i === hero) continue;
    const from = comp.start[i];
    const cross = comp.cross[i];
    if (comp.axis[i] === 0) {
      if (cross === comp.exitRow && from + comp.len[i] - 1 >= nose) blockers.add(i);
    } else if (cross >= nose && from <= comp.exitRow && from + comp.len[i] - 1 >= comp.exitRow) {
      blockers.add(i);
    }
  }
  return {
    heroCells,
    blockers: blockers.size,
    drag: blockers.size + (heroCells > 0 ? 1 : 0),
    cell: heroCells + blockers.size,
  };
}
