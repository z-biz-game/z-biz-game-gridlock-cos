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
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const el = {
  modes: $('modes'), totals: $('totals'), crumbs: $('crumbs'), readout: $('readout'),
  laws: $('laws'),
  shelf: $('shelf'), hintline: $('hintline'), curtain: $('curtain'), stars: $('stars'),
  verdict: $('verdict'), tally: $('tally'), undo: $('undo'), hint: $('hint'),
  restart: $('restart'), share: $('share'), next: $('next'), again: $('again'),
  toast: $('toast'), canvas: $('lot'), wipe: $('wipe'),
  sound: $('sound'), pause: $('pause'), resume: $('resume'), veil: $('pausedveil'),
  fullscreen: $('fullscreen'), help: $('help'), helpcard: $('helpcard'), helpclose: $('helpclose'),
  tools: $('tools'),
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
  sound: store.sound !== false,
  paused: false,
  helpOpen: false,
};

const audio = createAudio({
  isMuted: () => !app.sound,
  reducedMotion: () => view.reducedMotion,
});

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
    audio.play('blocked');
    view.redraw();
    return false;
  }
  audio.play('slide');
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
  audio.win();
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
    audio.play('undo');
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
  audio.play('hint');
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
  view.attach(app.game);
  view.resetClocks(); // 时钟、离场补间、提示脉冲相位一起归零，不只是模型
  audio.play('tap');
  render();
  say('回到起点');
}

// 暂停的口径：仿真与动画一起冻住（js/view.js 的 frame() 在 paused 时直接 return，
// animClock / escape / hint 寿命都不再推进），画布输入挡掉，恢复后盘面一格没变。
function setPaused(on) {
  app.paused = !!on;
  view.setPaused(app.paused);
  el.veil.hidden = !app.paused;
  el.pause.setAttribute('aria-pressed', String(app.paused));
  el.pause.textContent = app.paused ? '继续' : '暂停';
  if (app.paused) say('暂停中 —— 盘面冻住，按 P 继续');
  return app.paused;
}

function setSound(on) {
  app.sound = store.setSound(on);
  audio.setMuted(!app.sound); // 真停 AudioContext，不是把 gain 拧到 0
  el.sound.setAttribute('aria-pressed', String(!app.sound));
  el.sound.textContent = app.sound ? '声音 开' : '声音 关';
  return app.sound;
}

function openHelp(on) {
  app.helpOpen = !!on;
  el.helpcard.hidden = !app.helpOpen;
  el.help.setAttribute('aria-pressed', String(app.helpOpen));
  if (app.helpOpen) store.markHelpSeen();
  else if (!app.paused) el.canvas.focus && el.canvas.focus();
  return app.helpOpen;
}

function toggleFullscreen() {
  const node = document.documentElement;
  const cur = document.fullscreenElement || document.webkitFullscreenElement;
  if (cur) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) Promise.resolve(exit.call(document)).catch(() => { /* denied */ });
    return false;
  }
  const req = node.requestFullscreen || node.webkitRequestFullscreen;
  if (!req) {
    toast('这个浏览器不支持全屏');
    return false;
  }
  Promise.resolve(req.call(node)).catch(() => toast('全屏被浏览器挡下了'));
  return true;
}

function syncFullscreen() {
  const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
  el.fullscreen.setAttribute('aria-pressed', String(on));
  el.fullscreen.textContent = on ? '退出全屏' : '全屏';
  return on;
}

el.restart.addEventListener('click', restart);
el.share.addEventListener('click', () => { audio.play('tap'); shareLink(); });
el.pause.addEventListener('click', () => { audio.play('tap'); setPaused(!app.paused); });
el.resume.addEventListener('click', () => { audio.play('tap'); setPaused(false); });
el.sound.addEventListener('click', () => {
  const on = !app.sound;
  setSound(on); // 先落状态：静音态点它不该有声音
  if (on) audio.toggle();
});
el.fullscreen.addEventListener('click', () => { audio.play('tap'); toggleFullscreen(); });
el.help.addEventListener('click', () => { audio.play('tap'); openHelp(!app.helpOpen); });
el.helpclose.addEventListener('click', () => { audio.play('tap'); openHelp(false); });
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('webkitfullscreenchange', syncFullscreen);
el.helpcard.addEventListener('click', (ev) => { if (ev.target === el.helpcard) openHelp(false); });
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
  const k = ev.key === ' ' ? 'space' : ev.key.toLowerCase();
  if (k === 'escape') {
    if (app.helpOpen) openHelp(false);
    else if (!el.curtain.hidden) el.curtain.hidden = true;
    else if (app.paused) setPaused(false);
  } else if (k === 'u') el.undo.click();
  else if (k === 'h' && !ev.shiftKey) el.hint.click();
  else if (k === 'r') el.restart.click();
  else if (k === 'p') setPaused(!app.paused);
  else if (k === 'space') { if (!app.helpOpen) setPaused(!app.paused); }
  else if (k === 'm') setSound(!app.sound);
  else if (k === 'f') toggleFullscreen();
  else if (k === '?' || k === '/') openHelp(!app.helpOpen);
  else if (k === 'enter') {
    // 没有标题屏可"开始"，所以 Enter 的语义是把手上的局面推进下去：
    // 教学开着就关掉，赢了就下一关，暂停就继续。
    if (app.helpOpen) openHelp(false);
    else if (!el.curtain.hidden) el.next.hidden ? el.again.click() : el.next.click();
    else if (app.paused) setPaused(false);
  } else return;
  ev.preventDefault();
});

view.start();
// 存档里的动效偏好：'auto' 跟随系统，'on'/'off' 是显式覆盖。
view.setMotion(store.motion === 'auto' ? null : store.motion === 'on');
setSound(store.sound !== false);
syncFullscreen();
// Deliberately not paused on visibilitychange: the escape animation and the win card are
// driven from the same loop, and a tab that reports itself hidden (headless Chrome does)
// must still be able to finish a lot.
apply();
// 首启引导：只在没看过的时候自己弹出来，看过之后由「玩法」按钮与 ? / H 唤回。
if (!store.helpSeen) openHelp(true);

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
      paused: app.paused,
      sound: app.sound,
      muted: !app.sound,
      helpOpen: app.helpOpen,
      motion: store.motion,
      reducedMotion: view.reducedMotion,
      animClock: view.clock.animClock,
      escape: view.clock.escape,
      frames: view.clock.frames,
      dropped: store.dropped,
      audio: audio.state,
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
  setMotion(mode) {
    const next = store.setMotion(mode);
    view.setMotion(next === 'auto' ? null : next === 'on');
    return { stored: next, reduced: view.reducedMotion };
  },
  setSound,
  setPaused,
  toggleFullscreen,
  openHelp,
  audio,
  setLaw(key) {
    app.law = store.setLaw(key);
    renderLaws();
    renderCrumbs();
    return app.law;
  },
  hintOnce() { el.hint.click(); return { hints: app.hints, line: el.hintline.textContent }; },
  store,
};
