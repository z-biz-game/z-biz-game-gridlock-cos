// Canvas renderer + pointer handling. This file owns pixels and gestures and decides
// nothing about legality. On release it hands `main.js` a wanted distance in cells, and
// js/core/game.js clamps that against the lot — so a car can lag the finger but can never
// end up somewhere the rules forbid.

import { grab } from './core/game.js';

const PAD = 18;
const GATE = 30; // room on the right for the escape lane the hero drives out of

// Muted street palette, indexed by car so a lot looks the same on every device.
const BODY = ['#3f5f74', '#7a4a4a', '#4f6b4f', '#7d6b3f', '#5a4a72', '#3f6b66', '#735241', '#4a5570',
  '#6b4a5e', '#556470', '#6f6144', '#455f52'];
const ASPHALT = '#1d2026';
const CURB = '#2b2f38';
const LANE = 'rgba(226, 232, 240, 0.10)';
const HERO = '#e0a63c';
const HERO_DARK = '#a97721';
const GLOW = 'rgba(224, 166, 60, 0.55)';

// The two bitmaps the lot is actually paved with, generated in-repo by
// assets/gen/make_art.py and precached by sw.js. Flat colours stay as the fallback so a
// browser without them still draws the same lot.
const TEXTURES = {
  asphalt: 'assets/img/tex-asphalt-256.png',
  concrete: 'assets/img/tex-concrete-256.png',
};

function reducedMotionQuery() {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch (err) {
    return null;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function createView(canvas, { onCommit } = {}) {
  const ctx = canvas.getContext('2d');
  let game = null;
  let geom = { cell: 40, ox: 20, oy: 20, vw: 320, vh: 320 };
  let drag = null; // { car, axis, back, fwd, from, along }
  let hint = null; // { car, until }
  let escape = 0; // 0..1, the hero leaving the lot
  let raf = 0;
  let last = 0;
  // animClock 与 escape 是本文件仅有的两处直接吃帧 dt 的积分：提示脉冲环、出口微光、主角
  // 离场滑行都按它们取值。必须写成 `+= dt`（而不是 `+= 1/60`），否则同一虚拟时长在 30Hz 与
  // 120Hz 下会数出两个不同的秒数 —— 派工单 §3 的阴性对照就钉在这两行上。
  let animClock = 0;
  let paused = false;
  let frames = 0;
  const motionQuery = reducedMotionQuery();
  let motionOverride = null; // null = 跟随系统；true/false = 显式「减动效」
  const patterns = { asphalt: null, concrete: null };

  const reducedMotion = () => (motionOverride === null
    ? !!(motionQuery && motionQuery.matches)
    : motionOverride);

  // 决议结果只有一处真值，但它管两段：画布（本文件）与 DOM（css/game.css 的幕布、卡片、
  // 吐司）。媒体查询自己说话时，「系统开了减动效、玩家在面板上显式要动效」会出现画布动起来
  // 而幕布还在直接淡入的分家 —— 所以把决议写到 <html data-motion>，让 CSS 也读同一个口径。
  function publishMotion() {
    const root = typeof document === 'undefined' ? null : document.documentElement;
    if (root && root.dataset) root.dataset.motion = reducedMotion() ? 'off' : 'on';
  }

  function loadTextures() {
    if (typeof Image !== 'undefined' && typeof canvas.ownerDocument !== 'undefined') {
      for (const key of Object.keys(TEXTURES)) {
        const img = new Image();
        img.onload = () => {
          try {
            patterns[key] = ctx.createPattern(img, 'repeat');
          } catch (err) {
            patterns[key] = null;
          }
          draw();
        };
        img.src = TEXTURES[key];
      }
      return;
    }
    if (typeof Image === 'undefined') return; // node / 探针沙箱：留平色
  }

  function measure() {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const W = Math.max(200, Math.round(box.width));
    const H = Math.max(200, Math.round(box.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!game) return;
    const comp = game.comp;
    const cell = Math.max(18, Math.floor(Math.min(
      (W - PAD * 2 - GATE) / comp.w,
      (H - PAD * 2) / comp.h,
    )));
    geom = {
      cell,
      ox: Math.round((W - cell * comp.w - GATE) / 2) + PAD,
      oy: Math.round((H - cell * comp.h) / 2) + PAD,
      vw: W,
      vh: H,
    };
    draw();
  }

  function localPoint(ev) {
    const box = canvas.getBoundingClientRect();
    return { x: ev.clientX - box.left, y: ev.clientY - box.top };
  }

  // Cell-space point (in cell units from the lot's top-left corner) to client pixels —
  // the same mapping down() reads, run backwards so a test can press where a car is.
  function toClient(ux, uy) {
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.round(box.left + geom.ox + ux * geom.cell),
      y: Math.round(box.top + geom.oy + uy * geom.cell),
      cell: geom.cell,
    };
  }

  function down(ev) {
    if (!game || game.done || paused) return;
    const p = localPoint(ev);
    const g = grab(game, Math.floor((p.x - geom.ox) / geom.cell), Math.floor((p.y - geom.oy) / geom.cell));
    if (!g) return;
    drag = { car: g.car, axis: g.axis, back: g.back, fwd: g.fwd, from: p, along: 0 };
    if (hint && hint.car === g.car) hint = null;
    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch (err) {
        /* a browser that refuses capture still drags fine inside the canvas */
      }
    }
    draw();
    ev.preventDefault();
  }

  function move(ev) {
    if (!drag) return;
    const p = localPoint(ev);
    const raw = drag.axis === 0 ? p.x - drag.from.x : p.y - drag.from.y;
    // A cosmetic clamp: the bumper visibly stops at the neighbouring car. game.slide
    // applies the real one, so this can only ever under-state what is legal.
    drag.along = Math.max(-drag.back * geom.cell, Math.min(drag.fwd * geom.cell, raw));
    ev.preventDefault();
  }

  function up(ev) {
    if (!drag) return;
    const d = Math.round(drag.along / geom.cell); // snap: a drag counts whole cells
    const car = drag.car;
    drag = null;
    if (ev) ev.preventDefault();
    if (d && onCommit) onCommit(car, d);
    else draw();
  }

  function carBox(i, at, lift) {
    const { cell, ox, oy } = geom;
    const comp = game.comp;
    const gap = Math.max(2, Math.round(cell * 0.07));
    const horizontal = comp.axis[i] === 0;
    const cross = comp.cross[i];
    const len = comp.len[i];
    const l = lift ? 3 : 0;
    let x = ox + (horizontal ? at : cross) * cell + gap;
    let y = oy + (horizontal ? cross : at) * cell + gap;
    if (drag && drag.car === i) {
      if (drag.axis === 0) x += drag.along;
      else y += drag.along;
    }
    return {
      x: x - l, y: y - l,
      w: (horizontal ? len : 1) * cell - gap * 2 + l * 2,
      h: (horizontal ? 1 : len) * cell - gap * 2 + l * 2,
    };
  }

  function drawCar(i, at) {
    const { cell } = geom;
    const comp = game.comp;
    const hero = i === comp.hero;
    const box = carBox(i, at, !!drag && drag.car === i);
    const { x, y, w, h } = box;

    ctx.save();
    ctx.shadowColor = drag && drag.car === i ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = drag && drag.car === i ? 18 : 8;
    ctx.shadowOffsetY = drag && drag.car === i ? 8 : 3;
    ctx.fillStyle = hero ? HERO : BODY[i % BODY.length];
    roundRect(ctx, x, y, w, h, Math.round(cell * 0.2));
    ctx.fill();
    ctx.restore();

    // Cabin: a darker inset reads as a roof from above without needing any art.
    ctx.fillStyle = hero ? HERO_DARK : 'rgba(12, 16, 22, 0.45)';
    roundRect(ctx, x + w * 0.16, y + h * 0.16, w * 0.68, h * 0.68, Math.round(cell * 0.14));
    ctx.fill();
    // Windscreen at the front — h cars face the gate, v cars face down the block.
    ctx.fillStyle = 'rgba(190, 214, 236, 0.28)';
    if (comp.axis[i] === 0) roundRect(ctx, x + w * 0.76, y + h * 0.16, w * 0.12, h * 0.68, 3);
    else roundRect(ctx, x + w * 0.16, y + h * 0.76, w * 0.68, h * 0.12, 3);
    ctx.fill();

    if (hero) {
      ctx.fillStyle = GLOW;
      roundRect(ctx, x + w * 0.88, y + h * 0.3, Math.max(2, w * 0.06), h * 0.4, 2);
      ctx.fill();
    }
    if (hint && hint.car === i) {
      if (reducedMotion()) {
        // 静图口径：不脉动，只留一圈固定描边——高亮这件事本身不需要动画也成立。
        ctx.strokeStyle = 'rgba(120, 220, 255, 0.9)';
        ctx.lineWidth = 3;
        roundRect(ctx, x - 5, y - 5, w + 10, h + 10, Math.round(cell * 0.24));
        ctx.stroke();
      } else {
        const t = (animClock % 0.9) / 0.9;
        ctx.strokeStyle = `rgba(120, 220, 255, ${(0.85 - t * 0.55).toFixed(3)})`;
        ctx.lineWidth = 2 + t * 4;
        roundRect(ctx, x - 3 - t * 5, y - 3 - t * 5, w + 6 + t * 10, h + 6 + t * 10, Math.round(cell * 0.24));
        ctx.stroke();
      }
    }
  }

  function draw() {
    const { cell, ox, oy, vw, vh } = geom;
    ctx.clearRect(0, 0, vw, vh);
    if (!game) return;
    const comp = game.comp;
    const bw = cell * comp.w;
    const bh = cell * comp.h;

    ctx.fillStyle = patterns.concrete || CURB;
    roundRect(ctx, ox - 8, oy - 8, bw + 16 + GATE, bh + 16, 14);
    ctx.fill();
    ctx.fillStyle = patterns.asphalt || ASPHALT;
    roundRect(ctx, ox - 2, oy - 2, bw + 4, bh + 4, 8);
    ctx.fill();

    // Lane markings, so a grid reads as streets rather than a chessboard.
    ctx.strokeStyle = LANE;
    ctx.lineWidth = 2;
    ctx.setLineDash([Math.max(3, cell * 0.22), Math.max(4, cell * 0.22)]);
    for (let y = 1; y < comp.h; y++) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + y * cell);
      ctx.lineTo(ox + bw, oy + y * cell);
      ctx.stroke();
    }
    for (let x = 1; x < comp.w; x++) {
      ctx.beginPath();
      ctx.moveTo(ox + x * cell, oy);
      ctx.lineTo(ox + x * cell, oy + bh);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // The gate: a lit lane plus chevrons pointing out of the lot.
    const gy = oy + comp.exitRow * cell;
    const shimmer = reducedMotion() ? 0.12 : 0.12 + 0.05 * (0.5 + 0.5 * Math.sin(animClock * 2.2));
    ctx.fillStyle = `rgba(224, 166, 60, ${shimmer.toFixed(3)})`;
    ctx.fillRect(ox + bw, gy, GATE, cell);
    ctx.strokeStyle = GLOW;
    ctx.lineWidth = 2.5;
    for (let k = 0; k < 2; k++) {
      const ax = ox + bw + 8 + k * 11;
      const my = gy + cell / 2;
      ctx.beginPath();
      ctx.moveTo(ax, my - cell * 0.16);
      ctx.lineTo(ax + 6, my);
      ctx.lineTo(ax, my + cell * 0.16);
      ctx.stroke();
    }

    for (let y = 0; y < comp.h; y++) {
      for (let x = 0; x < comp.w; x++) {
        if (!comp.wall[y * comp.w + x]) continue;
        ctx.fillStyle = '#3a3f47';
        roundRect(ctx, ox + x * cell + 4, oy + y * cell + 4, cell - 8, cell - 8, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    for (let i = 0; i < comp.n; i++) {
      const heroOut = i === comp.hero ? escape * (comp.w - game.pos[i] + 1) : 0;
      drawCar(i, game.pos[i] + heroOut);
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    frames += 1;
    const dt = Math.min(64, now - (last || now));
    last = now;
    if (paused) return; // 暂停 = 仿真不推进：时钟、离场补间、提示寿命全部冻住
    animClock += dt / 1000;
    const escaping = game && game.done && escape < 1;
    if (escaping) {
      // reduceMotion 下主角车不做离场滑行，直接定格在门外——结果同一张图，少一段动效。
      escape = reducedMotion() ? 1 : Math.min(1, escape + dt / 420);
    }
    if (hint && animClock >= hint.until) {
      hint = null;
      draw();
    }
    if (escaping || drag || hint) draw();
  }

  loadTextures();

  // pointerdown 优先；老 iOS Safari / 桌面没有 PointerEvent 时回落到 touch + mouse。
  // 两条通道共用同一套 handler，事件里只取 clientX/clientY 与 identifier，
  // 坐标一律经 getBoundingClientRect 换算，CSS 缩放过的画布不会点 A 打 B。
  if (typeof window.PointerEvent !== 'undefined') {
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  } else {
    const first = (ev) => (ev.touches && ev.touches.length ? ev.touches[0]
      : (ev.changedTouches && ev.changedTouches.length ? ev.changedTouches[0] : ev));
    const wrap = (fn) => (ev) => {
      const t = first(ev);
      fn({ clientX: t.clientX, clientY: t.clientY, pointerId: t.identifier || 0, preventDefault: () => ev.preventDefault() });
    };
    canvas.addEventListener('mousedown', wrap(down));
    canvas.addEventListener('mousemove', wrap(move));
    canvas.addEventListener('mouseup', wrap(up));
    canvas.addEventListener('touchstart', wrap(down), { passive: false });
    canvas.addEventListener('touchmove', wrap(move), { passive: false });
    canvas.addEventListener('touchend', wrap(up), { passive: false });
    canvas.addEventListener('touchcancel', wrap(up), { passive: false });
  }

  return {
    attach(next) {
      game = next;
      drag = null;
      hint = null;
      escape = 0;
      measure();
    },
    // 重开/换关要把时钟与补间一起复位：只 reset 模型而漏掉这里，下一局会从上一局的
    // 离场进度与脉冲相位开始。
    resetClocks() {
      drag = null;
      hint = null;
      escape = 0;
      animClock = 0;
      last = 0;
    },
    detach() {
      game = null;
    },
    lotSize() {
      return game ? `${game.comp.w}×${game.comp.h}` : '';
    },
    // Client-space centre of any cell — car, tarmac or concrete.
    cellPoint(x, y) {
      return toClient(x + 0.5, y + 0.5);
    },
    // Client-space centre of a car as it stands right now, plus the axis an automated
    // finger has to pull it along.
    pointAt(i) {
      if (!game || i < 0 || i >= game.comp.n) return null;
      const comp = game.comp;
      const horiz = comp.axis[i] === 0;
      const at = game.pos[i] + comp.len[i] / 2;
      const p = toClient(horiz ? at : comp.cross[i] + 0.5, horiz ? comp.cross[i] + 0.5 : at);
      return { ...p, horiz };
    },
    measure,
    redraw: draw,
    setPaused(on) {
      paused = !!on;
      last = 0; // 恢复时别把暂停那段时间当成一帧补上
      if (!paused) draw();
      return paused;
    },
    get paused() { return paused; },
    setMotion(reduced) {
      motionOverride = reduced === null ? null : !!reduced;
      publishMotion();
      draw();
      return reducedMotion();
    },
    get reducedMotion() { return reducedMotion(); },
    get clock() { return { animClock, escape, frames }; },
    showHint(car) {
      hint = { car, until: animClock + 2.4 };
      draw();
    },
    start() {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
