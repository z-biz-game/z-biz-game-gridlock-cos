// Hand-built fixtures. These are the few lots in the repo whose difficulty a human
// wrote down, because a test needs an expected number that did not come from the same
// code that produced the answer.
//
// CHAIN is 6×6, exit row 2:
//
//     . . X X . .      <- C is the only thing keeping A from stepping up out of the lane
//     . . A . . .
//     R R A . . .      <- the hero R must reach the right edge
//     . . A . D .
//     . B B B D .      <- B cannot slide right (D), and moving left still covers A
//     . . . . D .
//
// The lane is blocked by A at (2,2). A can only go up one cell, and that needs C out of
// (2,0) — which needs C slid two cells left, since (4,0) is the other end of its travel
// and one cell of slack is not enough. Three drags, and no two: the hero is pinned the
// whole time, so nothing else can be finished off early.

export const CHAIN = {
  w: 6,
  h: 6,
  exitRow: 2,
  cars: [
    { x: 0, y: 2, len: 2, axis: 'h', hero: true }, // 0  R
    { x: 2, y: 1, len: 2, axis: 'v' }, // 1  A
    { x: 1, y: 4, len: 3, axis: 'h' }, // 2  B
    { x: 2, y: 0, len: 2, axis: 'h' }, // 3  C
    { x: 4, y: 3, len: 3, axis: 'v' }, // 4  D
  ],
  walls: [],
};

// A column of concrete across the whole lot in the hero's lane, with nowhere to slide.
// Worth having around because a solver that never answers "no" is not a solver.
export const DEAD = {
  w: 6,
  h: 6,
  exitRow: 2,
  cars: [
    { x: 0, y: 2, len: 2, axis: 'h', hero: true },
    { x: 3, y: 0, len: 6, axis: 'v' },
  ],
  walls: [],
};

// Nothing in front of the hero: already out, so the answer is zero drags.
export const CLEAR = {
  w: 6,
  h: 6,
  exitRow: 2,
  cars: [
    { x: 4, y: 2, len: 2, axis: 'h', hero: true },
    { x: 0, y: 0, len: 2, axis: 'v' },
  ],
  walls: [],
};
