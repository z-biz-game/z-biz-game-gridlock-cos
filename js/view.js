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
    if (!game || game.done) return;
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
      const t = (performance.now() % 900) / 900;
      ctx.strokeStyle = `rgba(120, 220, 255, ${(0.85 - t * 0.55).toFixed(3)})`;
      ctx.lineWidth = 2 + t * 4;
      roundRect(ctx, x - 3 - t * 5, y - 3 - t * 5, w + 6 + t * 10, h + 6 + t * 10, Math.round(cell * 0.24));
      ctx.stroke();
    }
  }

  function draw() {
    const { cell, ox, oy, vw, vh } = geom;
    ctx.clearRect(0, 0, vw, vh);
    if (!game) return;
    const comp = game.comp;
    const bw = cell * comp.w;
    const bh = cell * comp.h;

    ctx.fillStyle = CURB;
    roundRect(ctx, ox - 8, oy - 8, bw + 16 + GATE, bh + 16, 14);
    ctx.fill();
    ctx.fillStyle = ASPHALT;
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
    ctx.fillStyle = 'rgba(224, 166, 60, 0.12)';
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
    const dt = Math.min(64, now - (last || now));
    last = now;
    const escaping = game && game.done && escape < 1;
    if (escaping) escape = Math.min(1, escape + dt / 420);
    if (hint && now >= hint.until) {
      hint = null;
      draw();
    }
    if (escaping || drag || hint) draw();
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  return {
    attach(next) {
      game = next;
      drag = null;
      hint = null;
      escape = 0;
      measure();
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
    showHint(car) {
      hint = { car, until: performance.now() + 2400 };
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
