// Save file. One localStorage key, plain JSON, and a versioned shape so an old save can
// be recognised rather than mistaken for a new one.
//
// Records are keyed by lot id (the ids in js/data/lots.js are stable across bakes only in
// the sense that a re-bake is a new game — see README), plus a daily log and a campaign
// unlock pointer. Everything here degrades to memory when localStorage is denied, which
// it is under file:// and in private windows.

import { LAWS } from './law.js';

const KEY = 'gridlock.save.v1';

function blank() {
  return {
    records: {},
    daily: {},
    unlocked: 1,
    law: 'drag',
    stats: { solves: 0, perfect: 0, drags: 0, cells: 0, hints: 0 },
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  let raw = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch (err) {
    raw = null;
  }
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        const base = blank();
        cache = {
          records: p.records && typeof p.records === 'object' ? p.records : base.records,
          daily: p.daily && typeof p.daily === 'object' ? p.daily : base.daily,
          unlocked: Number(p.unlocked) > 0 ? Number(p.unlocked) : base.unlocked,
          // A hand-edited or older save that names a law we do not have falls back to the
          // classic convention instead of making the shell throw on its first read.
          law: LAWS.some((l) => l.key === p.law) ? p.law : base.law,
          stats: { ...base.stats, ...(p.stats || {}) },
        };
        return cache;
      }
    } catch (err) {
      // A corrupt save is not worth keeping; start clean rather than crash the shell.
    }
  }
  cache = blank();
  return cache;
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch (err) {
    /* memory-only session */
  }
}

export const store = {
  get records() { return load().records; },
  get stats() { return load().stats; },
  get daily() { return load().daily; },
  get unlocked() { return load().unlocked; },
  get law() { return load().law; },

  // The counting law is a preference, not a result: it changes which of the lot's two
  // certified numbers the grade is read against. Unknown keys never reach the save file.
  setLaw(key) {
    if (!LAWS.some((l) => l.key === key)) return load().law;
    const s = load();
    s.law = key;
    persist();
    return s.law;
  },

  record(id) {
    return load().records[id] || null;
  },

  // Unlocking is monotone: the campaign never goes backwards because a re-solve of an
  // earlier level must not be able to hide a later one.
  unlock(n) {
    const s = load();
    if (n > s.unlocked) s.unlocked = n;
    persist();
    return s.unlocked;
  },

  markDaily(dateKey, id) {
    const s = load();
    s.daily[dateKey] = { id, at: Date.now() };
    persist();
  },

  dailyDone(dateKey) {
    return load().daily[dateKey] || null;
  },

  // `par` and `parCell` are the two certified shortest routes for this lot, one per counting
  // law (js/core/law.js). A finish is a fact about both ledgers, so both are recorded: "I
  // matched the solver" has to say which of the solver's two numbers was matched.
  solve(id, { moves, cells, par, parCell, hints }) {
    const s = load();
    const prev = s.records[id];
    const cur = {
      solved: true,
      best: !prev || !prev.best || moves < prev.best ? moves : prev.best,
      bestCell: !prev || !prev.bestCell || cells < prev.bestCell ? cells : prev.bestCell,
      plays: (prev && prev.plays ? prev.plays : 0) + 1,
      perfect: moves <= par || !!(prev && prev.perfect),
      perfectCell: cells <= parCell || !!(prev && prev.perfectCell),
    };
    s.records[id] = cur;
    s.stats.solves += 1;
    s.stats.drags += moves;
    s.stats.cells += cells;
    s.stats.hints += hints || 0;
    if (moves <= par && !hints) s.stats.perfect += 1;
    persist();
    return cur;
  },

  reset() {
    cache = blank();
    try {
      window.localStorage.removeItem(KEY);
    } catch (err) {
      /* nothing was ever persisted */
    }
  },
};
