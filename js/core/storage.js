// Save file. One localStorage key, plain JSON, and a versioned shape so an old save can
// be recognised rather than mistaken for a new one.
//
// Records are keyed by lot id (the ids in js/data/lots.js are stable across bakes only in
// the sense that a re-bake is a new game — see README), plus a daily log, a campaign
// unlock pointer and three preferences. Everything here degrades to memory when localStorage
// is denied, which it is under file:// and in private windows.
//
// 解码分两段，而且**一条坏记录只丢那一条**：
//   第一段管信封 —— JSON.parse 失败、顶层不是对象，才整体回落成空档；
//   第二段管内容 —— records / daily 逐条单独校验，能修的修（缺字段补默认、数字越界夹回、
//   布尔只认 true），修不了的（null、数组、字符串、数字）只把那一条扔掉并计数，
//   其余记录照常可用。原先的写法是 `records: p.records` 一把塞进来，
//   于是一条 `"lot-07": null` 会让 renderCrumbs 读到 null.best 而把整局冻死。

import { LAWS } from './law.js';

const KEY = 'gridlock.save.v1';
const MAX_COUNT = 1e7; // 一关的最少步不可能超过这个数；超过就是手改的
const MAX_LEVEL = 9999;

const MOTIONS = ['auto', 'on', 'off'];

function blank() {
  return {
    records: {},
    daily: {},
    unlocked: 1,
    law: 'drag',
    sound: true,
    motion: 'auto',
    help: false,
    stats: { solves: 0, perfect: 0, drags: 0, cells: 0, hints: 0 },
  };
}

function whole(v, dflt, max = MAX_COUNT) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return dflt;
  return Math.floor(n);
}

// 第二段的第一半：一条记录。返回 null 表示这条扔掉。
function decodeRecord(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const rec = {
    solved: v.solved === true,
    best: whole(v.best, 0),
    bestCell: whole(v.bestCell, 0),
    plays: whole(v.plays, 0),
    perfect: v.perfect === true,
    perfectCell: v.perfectCell === true,
  };
  // perfect / perfectCell 是"solved 的一种"，一条没通过却写着完美的记录是自相矛盾的垃圾：
  // 补成通过（成绩本身还在），而不是丢掉整条。
  if (rec.perfect || rec.perfectCell) rec.solved = true;
  if (rec.perfect && !rec.best) rec.perfect = false;
  if (rec.perfectCell && !rec.bestCell) rec.perfectCell = false;
  if (!rec.solved && !rec.plays) return null; // 既没通过也没玩过：这条没有内容可留
  return rec;
}

function decodeLog(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  if (typeof v.id !== 'string' || !v.id) return null;
  return { id: v.id, at: whole(v.at, 0) };
}

function decodeTable(raw, one) {
  const out = {};
  let dropped = 0;
  if (raw === undefined) return { table: out, dropped: 0 }; // 没这一栏不是坏数据，是旧版存档
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { table: out, dropped: 1 };
  }
  for (const key of Object.keys(raw)) {
    const v = one(raw[key]);
    if (v) out[String(key)] = v;
    else dropped += 1;
  }
  return { table: out, dropped };
}

let cache = null;
let dropped = 0;

function decode(p) {
  const base = blank();
  const recs = decodeTable(p.records, decodeRecord);
  const logs = decodeTable(p.daily, decodeLog);
  dropped = recs.dropped + logs.dropped;
  return {
    records: recs.table,
    daily: logs.table,
    unlocked: Math.max(1, whole(p.unlocked, base.unlocked, MAX_LEVEL)),
    // A hand-edited or older save that names a law we do not have falls back to the
    // classic convention instead of making the shell throw on its first read.
    law: LAWS.some((l) => l.key === p.law) ? p.law : base.law,
    sound: typeof p.sound === 'boolean' ? p.sound : base.sound,
    motion: MOTIONS.indexOf(p.motion) >= 0 ? p.motion : base.motion,
    help: p.help === true,
    stats: {
      solves: whole(p.stats && p.stats.solves, 0),
      perfect: whole(p.stats && p.stats.perfect, 0),
      drags: whole(p.stats && p.stats.drags, 0),
      cells: whole(p.stats && p.stats.cells, 0),
      hints: whole(p.stats && p.stats.hints, 0),
    },
  };
}

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
        cache = decode(p);
        return cache;
      }
    } catch (err) {
      // A corrupt envelope is not worth keeping; start clean rather than crash the shell.
      dropped = 1;
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
  get sound() { return load().sound; },
  get motion() { return load().motion; },
  get helpSeen() { return load().help; },
  // 上一次解码扔掉了几条坏记录 —— 测试与"存档看起来空了"这类工单都靠它分辨。
  get dropped() { load(); return dropped; },

  // The counting law is a preference, not a result: it changes which of the lot's two
  // certified numbers the grade is read against. Unknown keys never reach the save file.
  setLaw(key) {
    if (!LAWS.some((l) => l.key === key)) return load().law;
    const s = load();
    s.law = key;
    persist();
    return s.law;
  },

  setSound(on) {
    const s = load();
    s.sound = !!on;
    persist();
    return s.sound;
  },

  // 'auto' 跟随系统的 prefers-reduced-motion，'on'/'off' 是面板上的动效开关。
  setMotion(mode) {
    const s = load();
    if (MOTIONS.indexOf(mode) < 0) return s.motion;
    s.motion = mode;
    persist();
    return s.motion;
  },

  markHelpSeen() {
    const s = load();
    s.help = true;
    persist();
    return s.help;
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
    dropped = 0;
    try {
      window.localStorage.removeItem(KEY);
    } catch (err) {
      /* nothing was ever persisted */
    }
  },

  // 测试与"换了个存档想重读一遍"用的钩子：只清进程内缓存，不动盘上的值。
  reload() {
    cache = null;
    dropped = 0;
  },
};
