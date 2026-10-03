// The shell: hash routes in, canvas out, records in between. Nothing here knows the
// rules of the lot — those live in js/core — and nothing here draws — that is js/view.js.

import { createGame, slide, undo, reset, hint, grade } from './core/game.js';
import { solve } from './core/solve.js';
import { LAWS, DRAG, CELL, lawOf, spent, parOf } from './core/law.js';
import { store } from './core/storage.js';
import {
  TIERS, ALL, byId, levelAt, lotsIn, randomLot, dailyLot, tierByKey, stats as poolStats,
} from './core/library.js';
import { todayKey } from './core/rng.js';
import { createView } from './view.js';

const $ = (id) => document.getElementById(id);
const el = {
  modes: $('modes'), totals: $('totals'), crumbs: $('crumbs'), readout: $('readout'),
  laws: $('laws'),
  shelf: $('shelf'), hintline: $('hintline'), curtain: $('curtain'), stars: $('stars'),
  verdict: $('verdict'), tally: $('tally'), undo: $('undo'), hint: $('hint'),
  restart: $('restart'), share: $('share'), next: $('next'), again: $('again'),
  toast: $('toast'), canvas: $('lot'), wipe: $('wipe'),
};

const LEVELS = ALL.length;
const app = {
  mode: 'campaign',
  index: 1,
  route: null,
  lot: null,
  game: null,
  hints: 0,
  label: '',
  day: null,
  // Which of the lot's two certified numbers the grade is read against. Both ledgers are
  // kept whatever this says (js/core/game.js), so switching never invalidates a run.
  law: store.law || DRAG,
};

function lawName() {
  return lawOf(app.law).label;
}

function clampIndex(n) {
  return Math.min(LEVELS, Math.max(1, Number(n) || 1));
}

// #/c/12 · #/daily · #/random/lane/4kq2 · #/lot/junction-07
// The lot id is in the URL, so a shared link resolves to the same jam on another device
// without the receiver needing the sender's save file.
function parseHash(hash = location.hash) {
  const p = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'daily') return { mode: 'daily' };
  if (p[0] === 'random') return { mode: 'random', tier: p[1] || TIERS[0].key, key: p[2] || null };
  if (p[0] === 'lot') return { mode: 'lot', id: p[1] };
  const n = p[0] === 'c' || p[0] === 'campaign' ? Number(p[1]) : Number(p[0]);
  return { mode: 'campaign', index: clampIndex(n) };
}

function linkFor(rt) {
  if (rt.mode === 'daily') return '#/daily';
  if (rt.mode === 'random') return `#/random/${rt.tier}/${rt.key}`;
  if (rt.mode === 'lot') return `#/lot/${rt.id}`;
  return `#/c/${rt.index}`;
}

function resolve(rt) {
  if (rt.mode === 'daily') {
    const day = todayKey();
    return { lot: dailyLot(day), label: `每日死锁 · ${day}`, note: day, day };
  }
  if (rt.mode === 'random') {
    const tier = tierByKey(rt.tier);
    return { lot: randomLot(`${tier.key}|${rt.key}`, tier.key), label: `随机 · ${tier.label}`, note: tier.blurb };
  }
  if (rt.mode === 'lot') {
    const lot = byId(rt.id) || ALL[0];
    return { lot, label: `关卡 ${lot.id}`, note: tierByKey(lot.tier).blurb };
  }
  const lot = levelAt(rt.index - 1);
  return { lot, label: `第 ${rt.index} 关`, note: `共 ${LEVELS} 关 · ${tierByKey(lot.tier).label}` };
}

const view = createView(el.canvas, { onCommit: (car, d) => commit(car, d) });

function setGame(lot, label) {
  app.lot = lot;
  app.label = label || app.label;
  app.game = createGame(lot);
  app.hints = 0;
  view.attach(app.game);
  el.curtain.hidden = true;
  say('');
}

function say(html) {
  el.hintline.innerHTML = html;
}

function stars(n) {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

function renderCrumbs() {
  const tier = tierByKey(app.lot.tier);
  const rec = store.record(app.lot.id);
  el.crumbs.innerHTML = `${app.label}<b>${tier.label}<span class="band"> ${tier.blurb}</span></b>`;
  const w = app.lot.witness || {};
  const best = app.law === CELL ? (rec && rec.bestCell) : (rec && rec.best);
  const matched = app.law === CELL ? !!(rec && rec.perfectCell) : !!(rec && rec.perfect);
  el.readout.innerHTML = [
    field('步数', `${app.game.moves}<small>／${app.game.cells}</small>`, '滑步／格步'),
    field('最少', `${app.lot.par}<small>／${app.lot.parCell}</small>`, '两条搜索路都对上', 'par'),
    field(`最佳·${lawName()}`, best ? best : '—', matched ? '等于最少' : '你的纪录', 'best'),
    field('局面', app.lot.states, `通道逼出 ${w.drag}／${w.cell}`),
  ].join('');
  el.undo.disabled = !app.game.moves || app.game.done;
  el.hint.disabled = app.game.done;
}

// The two laws are not a difficulty knob and not a hint: they are two true statements about
// the same position. Switching only changes which of them the grade and the hint line are
// read against, so both counters keep running and neither is reset by the switch.
function renderLaws() {
  el.laws.innerHTML = LAWS.map((l) => {
    const on = l.key === app.law;
    return `<button type="button" data-law="${l.key}" aria-current="${on}" class="${on ? 'here' : ''}">${l.label}<small>${l.bill}</small></button>`;
  }).join('');
}

function field(label, value, note, cls = '') {
  return `<div class="${cls}"><dt>${label}</dt><dd>${value}</dd><dt><small>${note}</small></dt></div>`;
}

function renderTotals() {
  const s = store.stats;
  const recs = Object.values(store.records);
  el.totals.innerHTML = `已通 <b>${recs.filter((r) => r.solved).length}</b>/${LEVELS}`
    + ` · 滑步完美 <b>${recs.filter((r) => r.perfect).length}</b>`
    + ` · 格步完美 <b>${recs.filter((r) => r.perfectCell).length}</b>`
    + ` · 提示 <b>${s.hints}</b>`;
}

function renderShelf() {
  if (app.mode === 'campaign') {
    const unlocked = store.unlocked;
    let html = '';
    for (const tier of TIERS) {
      html += `<p class="tier">${tier.label} · ${tier.blurb}</p>`;
      for (const lot of lotsIn(tier.key)) {
        const n = ALL.indexOf(lot) + 1;
        const rec = store.record(lot.id);
        const cls = [
          n === app.index ? 'here' : '',
          rec && rec.perfect ? 'perfect' : rec && rec.solved ? 'done' : '',
        ].filter(Boolean).join(' ');
        html += `<button type="button" data-index="${n}" class="${cls}" ${n > unlocked ? 'disabled' : ''}>${n}</button>`;
      }
    }
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-index]').forEach((b) => {
      b.addEventListener('click', () => go(`#/c/${b.dataset.index}`));
    });
    return;
  }
  if (app.mode === 'random') {
    let html = '<p class="tier">选一段路况</p>';
    for (const tier of TIERS) {
      const on = tier.key === app.route.tier ? 'here' : '';
      html += `<button type="button" class="${on}" data-tier="${tier.key}">${tier.label}<br><small>${tier.blurb}</small></button>`;
    }
    html += '<button type="button" class="wide" data-reroll="1">换一辆车</button>';
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-tier]').forEach((b) => {
      b.addEventListener('click', () => go(`#/random/${b.dataset.tier}/${token()}`));
    });
    el.shelf.querySelector('[data-reroll]').addEventListener('click', () => go(`#/random/${app.route.tier}/${token()}`));
    return;
  }
  if (app.mode === 'daily') {
    const done = app.day && store.dailyDone(app.day);
    el.shelf.innerHTML = `<p class="tier">今天这一关对所有人相同${done ? ' · 已通过' : ''}</p>`
      + `<button type="button" class="wide" data-back="1">回到战役 第 ${store.unlocked} 关</button>`;
  } else {
    el.shelf.innerHTML = '<p class="tier">分享的关卡</p>';
  }
  const back = el.shelf.querySelector('[data-back]');
  if (back) back.addEventListener('click', () => go(`#/c/${store.unlocked}`));
}

function token() {
  return Math.random().toString(36).slice(2, 8);
}

function render() {
  el.modes.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.mode === app.mode));
  });
  renderCrumbs();
  renderLaws();
  renderTotals();
  renderShelf();
}

// The one place a move happens: the drag from the view, the replay from a test link, and
// the solver's own route on load all arrive here.
function commit(car, d) {
  const moved = slide(app.game, car, d);
  if (!moved) {
    view.redraw();
    return false;
  }
  if (app.game.done) finish();
  else {
    view.redraw();
    renderCrumbs();
    say(`拖动了 ${app.game.comp.axis[car] === 0 ? '横向' : '纵向'}车辆 · 已用 ${app.game.moves} 滑步／${app.game.cells} 格步`);
  }
  return true;
}

function finish() {
  const lot = app.lot;
  const g = app.game;
  const rec = store.solve(lot.id, {
    moves: g.moves, cells: g.cells, par: lot.par, parCell: lot.parCell, hints: app.hints,
  });
  if (app.day) store.markDaily(app.day, lot.id);
  let nextIndex = 0;
  if (app.mode === 'campaign') {
    store.unlock(Math.max(store.unlocked, app.index + 1));
    nextIndex = app.index < LEVELS ? app.index + 1 : 0;
  }
  const gr = grade(g, app.law);
  const other = app.law === CELL ? DRAG : CELL;
  const bestNow = app.law === CELL ? rec.bestCell : rec.best;
  el.stars.textContent = stars(gr.stars);
  el.verdict.textContent = gr.label;
  el.tally.innerHTML = `你的 <b>${spent(g, app.law)}</b> ${lawName()} · ${lawName()}搜索最少 <b>${parOf(lot, app.law)}</b> · 提示 <b>${app.hints}</b>`
    + `<br>同一路线的另一本账：${spent(g, other)} ${lawOf(other).label}／最少 ${parOf(lot, other)} · 通道逼出 ${lot.witness[other]}`
    + (bestNow === spent(g, app.law) ? '<br>这是这一关该口径下的最好成绩' : '');
  el.next.hidden = !nextIndex;
  el.curtain.hidden = false;
  render();
}

function go(hash) {
  if (location.hash === hash) apply();
  else location.hash = hash;
}

function apply() {
  const rt = parseHash();
  app.route = rt;
  app.mode = rt.mode;
  if (rt.mode === 'random' && !rt.key) {
    // A bare #/random/lane would mean a different lot on every visit and an unreproducible
    // link, so the token is minted once and written back into the URL.
    location.replace(`${location.pathname}${location.search}#/random/${rt.tier}/${token()}`);
    return;
  }
  const r = resolve(rt);
  if (!r.lot) {
    say('这一档还没有烤好的关卡');
    return;
  }
  app.day = r.day || null;
  app.index = rt.mode === 'campaign' ? rt.index : ALL.indexOf(r.lot) + 1;
  setGame(r.lot, r.label);
  render();
}

let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800);
}

function shareLink() {
  const url = `${location.origin}${location.pathname}#/lot/${app.lot.id}`;
  const done = () => toast('链接已复制');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, () => toast(url));
  } else {
    toast(url);
  }
}

el.modes.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-mode]');
  if (!b) return;
  if (b.dataset.mode === 'campaign') go(`#/c/${clampIndex(store.unlocked)}`);
  else if (b.dataset.mode === 'daily') go('#/daily');
  else go(`#/random/${TIERS[0].key}/${token()}`);
});

el.undo.addEventListener('click', () => {
  if (undo(app.game)) {
    view.redraw();
    renderCrumbs();
    if (app.game.moves === 0) say('回到起点');
  }
});

el.hint.addEventListener('click', () => {
  const h = hint(app.game, app.law);
  if (!h) {
    say('这条路已经堵死了 —— 撤销一步或重开，搜索从当前位置找不到出路');
    return;
  }
  app.hints++;
  view.showHint(h.car);
  const horiz = app.game.comp.axis[h.car] === 0;
  const fwd = horiz ? '右' : '下';
  const back = horiz ? '左' : '上';
  say(`提示（${lawName()}口径）：动一下高亮的那辆，往 <b>${h.delta > 0 ? fwd : back}${Math.abs(h.delta)}</b> 格 —— 之后还需 <b>${h.left - 1}</b> ${lawName()}`);
  renderCrumbs();
});

el.laws.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-law]');
  if (!b) return;
  app.law = store.setLaw(b.dataset.law);
  renderLaws();
  renderCrumbs();
  const lot = app.lot;
  toast(`${lawName()}口径：最少 ${parOf(lot, app.law)}，你已用 ${spent(app.game, app.law)}`);
});

function restart() {
  reset(app.game);
  app.hints = 0;
  el.curtain.hidden = true;
  view.attach(app.game); // resets the escape animation as well as the cars
  render();
  say('回到起点');
}

el.restart.addEventListener('click', restart);
el.share.addEventListener('click', shareLink);
el.again.addEventListener('click', restart);
el.next.addEventListener('click', () => go(`#/c/${Math.min(LEVELS, app.index + 1)}`));

// Wiping the save is the one destructive thing this game can do, so it asks twice
// instead of firing on a stray click.
let wipeArmed = false;
el.wipe.addEventListener('click', () => {
  if (!wipeArmed) {
    wipeArmed = true;
    toast('再点一次会清空本机全部成绩');
    setTimeout(() => { wipeArmed = false; }, 4000);
    return;
  }
  store.reset();
  wipeArmed = false;
  toast('存档已清空');
  apply();
});

window.addEventListener('hashchange', apply);
window.addEventListener('resize', () => view.measure());
window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k === 'escape' && !el.curtain.hidden) el.curtain.hidden = true;
  else if (k === 'u') el.undo.click();
  else if (k === 'h') el.hint.click();
  else if (k === 'r') el.restart.click();
});

view.start();
// Deliberately not paused on visibilitychange: the escape animation and the win card are
// driven from the same loop, and a tab that reports itself hidden (headless Chrome does)
// must still be able to finish a lot.
apply();

window.gridlock = {
  version: 2,
  get state() {
    return {
      mode: app.mode,
      label: app.label,
      id: app.lot && app.lot.id,
      tier: app.lot && app.lot.tier,
      index: app.index,
      moves: app.game && app.game.moves,
      cells: app.game && app.game.cells,
      par: app.lot && app.lot.par,
      parCell: app.lot && app.lot.parCell,
      witness: app.lot && app.lot.witness,
      law: app.law,
      spent: app.game ? spent(app.game, app.law) : null,
      parNow: app.lot && parOf(app.lot, app.law),
      hints: app.hints,
      done: !!(app.game && app.game.done),
      unlocked: store.unlocked,
      solved: Object.values(store.records).filter((r) => r.solved).length,
      curtain: !el.curtain.hidden,
      w: app.game && app.game.comp.w,
      h: app.game && app.game.comp.h,
    };
  },
  get pool() { return poolStats(); },
  get laws() { return LAWS.map((l) => l.key); },
  load(hash) { go(hash); return app.lot && app.lot.id; },
  // Where a car sits right now, in client pixels, and the pitch of one cell: what an
  // automated finger needs to press the car instead of the grid maths.
  carPoint(i) { return view.pointAt(i); },
  cellPoint(x, y) { return view.cellPoint(x, y); },
  lot() { return app.lot ? app.lot.spec : null; },
  pos() { return app.game ? Array.from(app.game.pos) : null; },
  // The certified shortest route from this lot's start position — the same array the
  // generator measured the par with, recomputed here so a test can prove the browser
  // agrees with the number printed on screen. Under the cell law the route is longer and
  // every step is one cell.
  path(law = app.law) { return solve({ comp: app.game.comp }, { law }).path; },
  // Play a solver route through the same commit() a finger uses.
  play(path) {
    for (const m of path || []) commit(m.car, m.delta);
    return app.game.moves;
  },
  setLaw(key) {
    app.law = store.setLaw(key);
    renderLaws();
    renderCrumbs();
    return app.law;
  },
  hintOnce() { el.hint.click(); return { hints: app.hints, line: el.hintline.textContent }; },
  store,
};

// ---- 全屏开关 ----
//
// 绑到 index.html 的 HUD 里真实存在的 #btn-fullscreen。
// 只在 js 里留一串 requestFullscreen 能骗过字符串扫描，但按钮不在 DOM 里就是死代码：
// 玩家按不到，功能等于没做。所以 id 必须与 HTML 里的按钮对得上，缺失时要在控制台喊出来。
//
// 三套 API 一律**特性探测**，不做 UA 判断：iPhone 版 Safari 压根没有元素全屏（只有 <video> 能全屏），
// 老 Edge 只认 ms 前缀，Firefox 认 moz 前缀。UA 字符串是猜的，方法在不在是量的，猜错就静默失效。
function fsRoot() {
  return document.documentElement;
}

function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function fsRequest(root) {
  // 老 Edge 的 msRequestFullscreen 挂在元素上，和标准名同一个位置，所以并排取即可。
  return root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen || null;
}

// iOS Safari 会把非 video 元素的请求直接 reject 成 NotAllowedError。
// 这个 promise 没人接就升级成 unhandledrejection，冒到 window.onerror——离屏预载时足以把整页判死。
// 因此凡是可能返回 promise 的调用，返回值一律就地吞掉，绝不让拒绝逃出这一层。
function fsQuiet(p) {
  if (p && typeof p.catch === 'function') p.catch(() => {});
  return p;
}

// 返回 true=请求进入，false=请求退出，null=不支持（调用方据此禁用按钮）。
function toggleFullscreen(root) {
  const req = fsRequest(root);
  if (!req) return null;
  if (fsElement()) {
    // 退出侧同样要兜底：老 Edge 是 msExitFullscreen；万一三者皆无就当无事发生，不抛。
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (exit) fsQuiet(exit.call(document));
    return false;
  }
  // 部分实现（如被 Permissions-Policy 挡住的 iframe）会同步抛，所以 catch 和 .catch 两头都要接。
  try {
    fsQuiet(req.call(root));
  } catch (err) {
    // 拒绝即降级：静默保持当前形态，不冒泡、不打断这一局的其余逻辑。
  }
  return true;
}

function bindFullscreen(btn) {
  const root = fsRoot();

  // 状态回写：Esc 和 iOS 下滑手势退出时不会经过按钮，
  // 只有 fullscreenchange 事件能把按钮的文案/字形拉回正确状态，否则它会一直假装自己在全屏里。
  const sync = () => {
    const on = !!fsElement();
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? "退出全屏" : "全屏";
    btn.title = on ? "退出全屏 (F)" : "全屏 (F)";
    document.body.classList.toggle('is-fullscreen', on);
    return on;
  };

  if (!fsRequest(root)) {
    // 不支持就要说明为什么：只把按钮变灰，玩家会以为这活根本没做完。
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.title = '这个浏览器不提供元素全屏（iOS Safari 请用「添加到主屏幕」）';
    return;
  }

  btn.addEventListener('click', () => {
    toggleFullscreen(root);
    sync();
  });

  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);

  window.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    // 正在输入框里打字时不劫持按键，否则会打不出 f。
    if (ev.target && /^(input|textarea|select)$/i.test(ev.target.tagName)) return;
    if (ev.key === "f" || ev.key === "F") {
      ev.preventDefault();
      toggleFullscreen(root);
      sync();
    }
  });

  sync();
}

function bootFullscreen() {
  const btn = document.getElementById("btn-fullscreen");
  if (!btn) {
    // 按钮被谁删掉了？在控制台喊出来，别让这个坑静默地烂在下一棒手里。
    console.warn('[fullscreen] index.html 里找不到 #' + "btn-fullscreen" + '，全屏开关没有入口');
    return;
  }
  bindFullscreen(btn);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootFullscreen);
} else {
  bootFullscreen();
}
