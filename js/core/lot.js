// The lot model — the whole game in one plain, JSON-serialisable spec.
//
//   { w, h, exitRow, cars: [{ x, y, len, axis, hero }], walls: [{ x, y }] }
//
// An 'h' car keeps its y and slides along x; a 'v' car keeps its x and slides along y.
// Exactly one car is the hero: it is always horizontal, sits on exitRow, and drives out
// through the gate on the right edge. Nothing else in this file knows what winning is.

export const H = 0;
export const V = 1;

export function axisOf(car) {
  return car.axis === 'v' ? V : car.axis === 'h' ? H : -1;
}

// Pre-typed arrays so the solver never re-reads objects inside the search loop.
export function compile(spec) {
  const { w, h, exitRow } = spec;
  const cars = spec.cars;
  const n = cars.length;
  const comp = {
    w, h, exitRow, n,
    axis: new Uint8Array(n),
    cross: new Uint8Array(n),
    len: new Uint8Array(n),
    start: new Uint8Array(n),
    hero: -1,
    wall: new Uint8Array(w * h),
  };
  for (let i = 0; i < n; i++) {
    const c = cars[i];
    const a = axisOf(c);
    if (a < 0) throw new Error(`car ${i}: axis must be 'h' or 'v'`);
    comp.axis[i] = a;
    comp.cross[i] = a === H ? c.y : c.x;
    comp.len[i] = c.len;
    comp.start[i] = a === H ? c.x : c.y;
    if (c.hero) {
      if (comp.hero >= 0) throw new Error('two hero cars');
      if (a !== H) throw new Error('hero must be horizontal');
      if (c.y !== exitRow) throw new Error('hero must sit on the exit row');
      comp.hero = i;
    }
  }
  if (comp.hero < 0) throw new Error('no hero car');
  for (const cell of spec.walls || []) {
    if (cell.x < 0 || cell.x >= w || cell.y < 0 || cell.y >= h) throw new Error('wall outside the lot');
    comp.wall[cell.y * w + cell.x] = 1;
  }
  comp.key = (pos) => encode(pos);
  return comp;
}

export function encode(pos) {
  // One char per car: the along-axis coordinate. Fast to build, and exact.
  let s = '';
  for (let i = 0; i < pos.length; i++) s += String.fromCharCode(pos[i] + 48);
  return s;
}

export function decode(str, n) {
  const p = new Uint8Array(n);
  for (let i = 0; i < n; i++) p[i] = str.charCodeAt(i) - 48;
  return p;
}

// Lay the cars down into `into` (allocated when omitted). The solver reuses one buffer
// per call site — a 400k-state search must not allocate 400k arrays.
export function occupancy(comp, pos, into) {
  const occ = into || new Uint8Array(comp.w * comp.h);
  occ.fill(0);
  for (let i = 0; i < comp.n; i++) mark(comp, occ, i, pos[i], 1);
  return occ;
}

function mark(comp, occ, i, from, value) {
  const { w, axis, cross, len } = comp;
  if (axis[i] === H) {
    const row = cross[i] * w;
    for (let k = 0; k < len[i]; k++) occ[row + from + k] = value;
  } else {
    const col = cross[i];
    for (let k = 0; k < len[i]; k++) occ[(from + k) * w + col] = value;
  }
}

export function inside(comp, x, y) {
  return x >= 0 && y >= 0 && x < comp.w && y < comp.h;
}

export function cellsOf(comp, i, at) {
  const out = [];
  const { w, axis, cross, len } = comp;
  for (let k = 0; k < len[i]; k++) {
    out.push(axis[i] === H ? { x: at + k, y: cross[i] } : { x: cross[i], y: at + k });
  }
  return out;
}

export function carAt(comp, pos, occ, x, y) {
  if (!inside(comp, x, y)) return -1;
  if (comp.wall[y * comp.w + x]) return -2;
  const idx = occ[y * comp.w + x];
  if (!idx) return -1;
  for (let i = 0; i < comp.n; i++) {
    if (comp.axis[i] === H ? y === comp.cross[i] && x >= pos[i] && x < pos[i] + comp.len[i]
      : x === comp.cross[i] && y >= pos[i] && y < pos[i] + comp.len[i]) return i;
  }
  return -1;
}

// How far car i may slide each way from `pos`, given the occupancy in `scratch`.
// Returns [maxBack, maxFwd]; a slide of any length in (1..max) is a legal single move,
// which is the classic counting rule: dragging a car three spaces is one move.
export function reach(comp, scratch, i, at) {
  const { w, h, axis, cross, len, wall } = comp;
  let back = 0;
  let fwd = 0;
  mark(comp, scratch, i, at, 0);
  if (axis[i] === H) {
    const row = cross[i] * w;
    while (at - back - 1 >= 0 && !scratch[row + at - back - 1] && !wall[row + at - back - 1]) back++;
    while (at + len[i] + fwd < w && !scratch[row + at + len[i] + fwd] && !wall[row + at + len[i] + fwd]) fwd++;
  } else {
    const col = cross[i];
    while (at - back - 1 >= 0 && !scratch[(at - back - 1) * w + col] && !wall[(at - back - 1) * w + col]) back++;
    while (at + len[i] + fwd < h && !scratch[(at + len[i] + fwd) * w + col] && !wall[(at + len[i] + fwd) * w + col]) fwd++;
  }
  mark(comp, scratch, i, at, 1);
  return [back, fwd];
}

// Enumerate every one-move successor: cb(car, delta).
export function eachMove(comp, pos, cb, scratch) {
  const occ = occupancy(comp, pos, scratch);
  for (let i = 0; i < comp.n; i++) {
    const [back, fwd] = reach(comp, occ, i, pos[i]);
    for (let d = 1; d <= back; d++) cb(i, -d);
    for (let d = 1; d <= fwd; d++) cb(i, d);
  }
}

export function moves(comp, pos) {
  const out = [];
  eachMove(comp, pos, (car, delta) => out.push({ car, delta }));
  return out;
}

// The hero has escaped once nothing blocks the lane from its nose to the gate. The
// gate itself is off-grid, so no cell to the right of the lot needs checking.
export function exitBlocked(comp, pos, occ = occupancy(comp, pos)) {
  const i = comp.hero;
  const nose = pos[i] + comp.len[i];
  const row = comp.exitRow * comp.w;
  for (let x = nose; x < comp.w; x++) {
    if (occ[row + x] || comp.wall[row + x]) return true;
  }
  return false;
}

// Two different things, and only one of them is winning:
//   exitBlocked  — is the lane ahead of the hero clear?
//   solved       — has the hero actually been driven into the gate?
// The second is deliberately not the first: a clear lane with the hero stuck mid-block is
// one drag from victory, not victory. That is the classic counting rule, which is what
// makes a par here comparable with a par printed on a shop-bought card.
export function solved(comp, pos) {
  const i = comp.hero;
  return pos[i] + comp.len[i] >= comp.w;
}

// Apply a move without allocating: returns the same array, mutated.
export function step(pos, move) {
  pos[move.car] = pos[move.car] + move.delta;
  return pos;
}

// A spec is the save format too, so it must survive JSON and a device swap.
export function toSpec(comp, pos) {
  const cars = [];
  for (let i = 0; i < comp.n; i++) {
    cars.push({
      x: comp.axis[i] === H ? pos[i] : comp.cross[i],
      y: comp.axis[i] === H ? comp.cross[i] : pos[i],
      len: comp.len[i],
      axis: comp.axis[i] === H ? 'h' : 'v',
      hero: i === comp.hero || undefined,
    });
  }
  const walls = [];
  for (let y = 0; y < comp.h; y++) {
    for (let x = 0; x < comp.w; x++) if (comp.wall[y * comp.w + x]) walls.push({ x, y });
  }
  return { w: comp.w, h: comp.h, exitRow: comp.exitRow, cars, walls };
}

// Structural sanity, used by the generator and by the test suite: cars on the grid,
// no two sharing a cell, hero present and on the gate lane.
export function validate(spec) {
  const { w, h, exitRow, cars } = spec;
  if (!w || !h) return 'empty lot';
  if (exitRow < 0 || exitRow >= h) return 'exit row outside the lot';
  const seen = new Uint8Array(w * h);
  let heroes = 0;
  for (const cell of spec.walls || []) {
    if (cell.x < 0 || cell.x >= w || cell.y < 0 || cell.y >= h) return 'wall outside the lot';
    if (seen[cell.y * w + cell.x]) return 'wall overlaps another car';
    seen[cell.y * w + cell.x] = 1;
  }
  for (const c of cars) {
    const a = axisOf(c);
    if (a < 0) return 'car with a bad axis';
    if (c.len < 2 || c.len > Math.min(w, h)) return 'car length out of range';
    if (c.hero) {
      heroes++;
      if (a !== H || c.y !== exitRow) return 'hero must be horizontal on the exit row';
    }
    const from = a === H ? c.x : c.y;
    if (from < 0 || from + c.len > (a === H ? w : h)) return 'car sticking out of the lot';
    const cross = a === H ? c.y : c.x;
    if (cross < 0 || cross >= (a === H ? h : w)) return 'car outside the lot';
    for (let k = 0; k < c.len; k++) {
      const x = a === H ? from + k : cross;
      const y = a === H ? cross : from + k;
      if (seen[y * w + x]) return 'two cars overlap';
      seen[y * w + x] = 1;
    }
  }
  if (heroes !== 1) return heroes ? 'more than one hero' : 'no hero car';
  return null;
}
