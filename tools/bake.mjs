// The content pipeline. This is where the game's levels come from — the browser never
// generates a lot, it only picks one.
//
// Why offline: test/balance.mjs measures the generator at 3.6 s median and 18 s worst
// case for the top tier, with only a few in twenty seeds producing a lot at all. That is
// a perfectly good cost for a build step and an unacceptable one for a tap on the screen.
// So the generator runs here once, the solver certifies every lot it emits, and what
// ships is the measured set.
//
//   node tools/bake.mjs                 # js/data/lots.js
//   PER_TIER=24 node tools/bake.mjs
//
// A lot only enters the file if re-solving the *serialised* spec reproduces both move
// counts the generator claimed, on two independent search roads each. Nothing unmeasured
// ships, and nothing ships with one road's number.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TIERS, makeLot } from '../js/core/make.js';
import { solve, solveWeighted, distTable, census } from '../js/core/solve.js';
import { validate, toSpec, compile } from '../js/core/lot.js';
import { DRAG, CELL, witness } from '../js/core/law.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PER_TIER = Number(process.env.PER_TIER || 16);
// Position-by-position certification is affordable only while the whole reachable component
// fits here. It is a budget, not a claim: a row whose component is larger ships with its two
// start-position measurements and `table: null`, and test/library.test.mjs counts how many
// rows carry the stronger certificate so a shrinking pool shows up as a red line.
const TABLE_BUDGET = Number(process.env.TABLE_BUDGET || 40000);

// Two lots that differ only in the order their cars were appended are the same puzzle.
function signature(spec) {
  const cars = spec.cars
    .map((c) => `${c.axis}${c.x},${c.y}+${c.len}${c.hero ? '!' : ''}`)
    .sort()
    .join('|');
  return `${spec.w}x${spec.h}:${spec.exitRow}:${cars}`;
}

const out = [];
for (const tier of TIERS) {
  const seen = new Set();
  const picked = [];
  const t0 = Date.now();
  for (let s = 0; picked.length < PER_TIER && s < PER_TIER * 60; s++) {
    const lot = makeLot(`bake-${tier.key}-${s}`, tier);
    if (!lot) continue;
    const spec = toSpec(lot.spec.comp, lot.spec.comp.start);
    const err = validate(spec);
    if (err) throw new Error(`${tier.key}: generator emitted an invalid lot: ${err}`);
    const sig = signature(spec);
    if (seen.has(sig)) continue;
    // Four roads over the serialised spec: BFS and weighted Dijkstra in each law. A row
    // ships only when all four land on the two numbers the generator measured.
    const comp = compile(spec);
    const dragBFS = solve(spec, { law: DRAG });
    const dragWeighted = solveWeighted(spec, { law: DRAG });
    const cellBFS = solve(spec, { law: CELL });
    const cellWeighted = solveWeighted(spec, { law: CELL });
    const fail = (msg) => { throw new Error(`${tier.key} ${sig}: ${msg}`); };
    if (!dragBFS.ok || dragBFS.moves !== lot.rating.moves) fail(`par ${lot.rating.moves} not reproducible from the spec (${dragBFS.moves})`);
    if (!dragWeighted.ok || dragWeighted.moves !== dragBFS.moves) fail(`drag roads disagree (${dragBFS.moves} vs ${dragWeighted.moves})`);
    if (!cellBFS.ok || cellBFS.moves !== lot.rating.movesCell) fail(`cell par ${lot.rating.movesCell} not reproducible (${cellBFS.moves})`);
    if (!cellWeighted.ok || cellWeighted.moves !== cellBFS.moves) fail(`cell roads disagree (${cellBFS.moves} vs ${cellWeighted.moves})`);
    if (cellBFS.moves < dragBFS.moves) fail(`the cell law billed fewer steps than the drag law (${cellBFS.moves} < ${dragBFS.moves})`);
    const w = witness(comp);
    if (w.drag > dragBFS.moves || w.cell > cellBFS.moves) fail(`the hand-countable witness ${w.drag}/${w.cell} exceeds the measured ${dragBFS.moves}/${cellBFS.moves}`);
    // On the small bands the whole reachable component is affordable, so the measurement is
    // checked position by position rather than only at the start: every position a player can
    // wander into has one distance-to-winning per law, and the two roads must agree on all
    // of them.
    let table = null;
    const t1 = distTable(spec, { law: CELL, via: 'bfs', limit: TABLE_BUDGET });
    if (!t1.truncated) {
      const t2 = distTable(spec, { law: CELL, via: 'weighted', limit: TABLE_BUDGET });
      if (t2.truncated) fail(`the weighted table could not cover the ${t1.states}-state component`);
      if (t2.states !== t1.states || t2.maxDist !== t1.maxDist) fail(`cell table roads disagree on the component (${t1.maxDist} vs ${t2.maxDist})`);
      for (const [key, d] of t1.dist) if (t2.dist.get(key) !== d) fail(`a position has two cell distances (${key}: ${d} vs ${t2.dist.get(key)})`);
      const t3 = distTable(spec, { law: DRAG, via: 'bfs', limit: TABLE_BUDGET });
      if (t3.truncated) fail(`the drag table could not cover the ${t1.states}-state component`);
      if (t3.states !== t1.states) fail(`the two laws reached different numbers of positions (${t1.states} vs ${t3.states})`);
      if (t1.maxDist < t3.maxDist) fail(`the cell law's diameter came out below the drag law's (${t1.maxDist} < ${t3.maxDist})`);
      table = { states: t1.states, maxDist: t1.maxDist, roots: t1.roots };
    }
    seen.add(sig);
    picked.push({
      id: `${tier.key}-${String(picked.length + 1).padStart(2, '0')}`,
      tier: tier.key,
      moves: dragBFS.moves,
      movesCell: cellBFS.moves,
      witness: w,
      table,
      states: census(spec, 300000).states,
      cars: spec.cars.length,
      spec,
    });
    process.stdout.write(`\r${tier.key}: ${picked.length}/${PER_TIER}  ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
  }
  process.stdout.write(`\n`);
  if (picked.length < PER_TIER) console.error(`warn: ${tier.key} only reached ${picked.length} lots`);
  // A tier is played as a curve, so order it by the one number that means something.
  picked.sort((a, b) => a.moves - b.moves || a.states - b.states);
  picked.forEach((p, i) => { p.id = `${tier.key}-${String(i + 1).padStart(2, '0')}`; });
  out.push(...picked);
}

// The band the UI prints is measured off the lots that actually shipped, not copied from
// the generator's wish list — so a re-bake that lands lighter or heavier says so. Both laws
// get a band, because both numbers are on screen.
const meta = TIERS.map((t) => {
  const mine = out.filter((l) => l.tier === t.key);
  const lo = Math.min(...mine.map((l) => l.moves));
  const hi = Math.max(...mine.map((l) => l.moves));
  const clo = Math.min(...mine.map((l) => l.movesCell));
  const chi = Math.max(...mine.map((l) => l.movesCell));
  return {
    key: t.key, label: t.label, min: lo, max: hi, minCell: clo, maxCell: chi,
    blurb: `${t.w}×${t.h} · ${lo === hi ? lo : `${lo}-${hi}`} 滑步 / ${clo === chi ? clo : `${clo}-${chi}`} 格步`,
  };
});
const lines = [
  '// Generated by tools/bake.mjs — the levels in this game are measurements, not opinions.',
  '// `moves` is the BFS-shortest count in drags (one drag = one step, however many cells it',
  '// slid) and `movesCell` the same lot counted in cells (a three-cell slide bills three).',
  '// Each number ships measured on two independent search roads, and `witness` is the floor',
  '// the exit lane alone forces: hero cells + one per car that has to step out of them.',
  '// Re-run `node tools/bake.mjs` instead of hand-editing; `node test/library.test.mjs`',
  '// fails if a line and any of its numbers ever disagree.',
  `export const TIERS_META = ${JSON.stringify(meta)};`,
  'export const LOTS = [',
  ...out.map((l) => `  ${JSON.stringify(l)},`),
  '];',
  '',
];
const path = join(root, 'js', 'data', 'lots.js');
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, lines.join('\n'));

const byTier = {};
for (const l of out) byTier[l.tier] = (byTier[l.tier] || 0) + 1;
const ratios = out.map((l) => l.movesCell / l.moves).sort((a, b) => a - b);
const slackDrag = out.map((l) => l.moves - l.witness.drag).sort((a, b) => a - b);
const slackCell = out.map((l) => l.movesCell - l.witness.cell).sort((a, b) => a - b);
const med = (a) => a[a.length >> 1];
console.log(`wrote ${out.length} lots (${Object.entries(byTier).map(([k, n]) => `${k}:${n}`).join(' ')}) -> js/data/lots.js`);
console.log(`certified position by position: ${out.filter((l) => l.table).length}/${out.length} rows｜格步/滑步 ratio med ${med(ratios).toFixed(2)} min ${ratios[0].toFixed(2)} max ${ratios[ratios.length - 1].toFixed(2)}`);
console.log(`slack over the witness: drag med ${med(slackDrag)} max ${slackDrag[slackDrag.length - 1]}｜cell med ${med(slackCell)} max ${slackCell[slackCell.length - 1]}`);
