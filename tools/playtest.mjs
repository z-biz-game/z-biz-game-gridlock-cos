// Minimal CDP driver for headless playtesting (Node 21+ global WebSocket/fetch).
// env: CDP_PORT (devtools port, default 9340), BASE_URL (page to attach to, default
//      http://127.0.0.1:5180/)
// usage:
//   node playtest.mjs open  <url>          # reuse-or-create our page and navigate
//   node playtest.mjs nav   <url>
//   node playtest.mjs eval  '<js expression>'   # pass `nonav` to skip the reload
//   node playtest.mjs eval  '@boot'         # | @play | @routes | @save | @law | @pointer
//   node playtest.mjs shot  <path.png>
//   node playtest.mjs logs
//
// Every scenario reports { rows, fail } in the same shape as tools/harness.mjs, so
// tools/verify.sh aggregates node suites and browser suites on one line.
const PORT = process.env.CDP_PORT || 9340;
// Which page to attach to. Hard-coding the dev-server port silently evaluates
// against a fresh about:blank tab when pointed at any other origin.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5180/';
const SHELL_TIMEOUT = Number(process.env.SHELL_TIMEOUT || 30000);
const ORIGIN = new URL(BASE).origin;
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);
const cmd = process.argv[2];
const arg = process.argv[3];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (globalThis.__printEvents) globalThis.__printEvents(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) if (t.type === 'page' && isOurs(t.url)) {
      try { await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId }); } catch { /* gone already */ }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let targetId, sessionId;
  if (existing) {
    targetId = existing.id || existing.targetId;
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  } else {
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }
  const logs = [];
  globalThis.__printEvents = (m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.source === 'rendering') logs.push(`[log:${e.level}] ${e.text} ${e.url || ''}`);
    }
  };
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const runJS = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // Wait on the shell, not on a timer. The page is a module graph fetched over the network:
  // a fixed sleep is long enough for a localhost server and too short for GitHub Pages, where
  // it made an innocent deployment look broken (`window.gridlock` still undefined, canvas still
  // the unstyled 300x150 default). The floor keeps the local case as fast as it was.
  const waitShell = async (floorMs, budgetMs = SHELL_TIMEOUT) => {
    await sleep(floorMs);
    const deadline = Date.now() + budgetMs;
    for (;;) {
      let ready = false;
      try {
        ready = await runJS('!!(window.gridlock && window.gridlock.state && window.gridlock.state.id)');
      } catch { ready = false; }
      if (ready) return true;
      if (Date.now() > deadline) return false;
      await sleep(150);
    }
  };

  if (cmd === 'open') {
    await cdp.send('Page.navigate', { url: arg || BASE }, sessionId);
    await waitShell(600);
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'nav') {
    await cdp.send('Page.navigate', { url: arg }, sessionId);
    await waitShell(400);
    console.log('navigated\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (process.argv[4] !== 'nonav') {
      await cdp.send('Page.navigate', { url: BASE }, sessionId);
      await waitShell(300);
    }
    if (arg && arg.startsWith('@')) {
      const name = arg.slice(1);
      let value = null;
      if (name === 'pointer') {
        value = await pointerScenario(cdp, sessionId, runJS, waitShell);
      } else if (SCENARIOS[name]) {
        try {
          value = await runJS(SCENARIOS[name]);
        } catch (err) {
          const dumped = await runJS('JSON.stringify(window.__lastRows||[])').catch(() => '[]');
          value = { rows: JSON.parse(dumped) };
          value.rows.push({ test: `@${name} threw`, pass: false, detail: String(err.message).slice(0, 300) });
        }
      } else {
        console.log('unknown scenario ' + name + ' — have ' + Object.keys(SCENARIOS).join(', ') + ', pointer');
        process.exit(1);
      }
      value.fail = (value.rows || []).filter((r) => !r.pass).map((r) => r.test);
      console.log(JSON.stringify(value, null, 2));
    } else {
      try {
        console.log(JSON.stringify(await runJS(arg), null, 2));
      } catch (err) {
        console.log('EVAL THROW: ' + err.message);
      }
    }
    if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
  } else if (cmd === 'shot') {
    await runJS('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    (await import('node:fs')).writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg + ' (' + Math.round(data.length / 1024) + 'kB b64)');
  } else if (cmd === 'logs') {
    await sleep(800);
    console.log(logs.join('\n') || '(none)');
  }
  ws.close();
  process.exit(0);
}

// The one suite a page-side script cannot run: real input. Everything below goes through
// Chrome's own mouse and keyboard over CDP, so what gets asserted is the pointer-to-car
// wiring in js/view.js rather than the rules behind it.
async function pointerScenario(cdp, sessionId, runJS, waitShell) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    test: name, pass: !!pass,
    detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)),
  });
  const mouse = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons, clickCount: type === 'mousePressed' ? 1 : 0,
  }, sessionId);
  const key = (k) => cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', text: k, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0),
  }, sessionId);

  async function drag(from, dx, dy) {
    const steps = 6;
    await mouse('mousePressed', from.x, from.y, 1);
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', Math.round(from.x + (dx * i) / steps), Math.round(from.y + (dy * i) / steps), 1);
    }
    await mouse('mouseReleased', Math.round(from.x + dx), Math.round(from.y + dy), 0);
    await sleep(70);
  }

  // Pull a car exactly as far as the route asks. Over-pulling is tested on its own below
  // (an eight-fold pull has to stop at the lot line); here the point is that a real mouse
  // lands each car where the certified route says, which is the only way the two ledgers
  // can be checked against the board rather than against a guess.
  const pull = (p, delta, over = 1) => drag(p, p.horiz ? delta * p.cell * over : 0, p.horiz ? 0 : delta * p.cell * over);

  await runJS(`window.gridlock.setLaw('drag'); window.gridlock.load('#/c/1'); 'ok'`);
  await sleep(300);

  const ids = await runJS(`['lot','undo','hint','restart','share','curtain','stars','shelf','wipe','laws','readout','totals'].map((i) => [i, !!document.getElementById(i)])`);
  rec('every control the shell reaches for exists', ids.every(([, on]) => on), Object.fromEntries(ids));

  const start = await runJS(`(() => {
    const g = window.gridlock;
    const spec = g.lot();
    const i = spec.cars.findIndex((c) => c.hero);
    return { state: g.state, path: g.path(), pos: g.pos(), hero: i, len: spec.cars[i].len, w: spec.w, h: spec.h };
  })()`);
  const par = start.state.par;
  rec('a lot loads with a certified par', start.state.id && par >= 1 && start.path.length === par, { id: start.state.id, par, path: start.path.length });

  let played = 0;
  let owedCells = 0;
  const where = start.pos.slice();
  const log = [];
  let drifted = null;
  for (const m of start.path) {
    const p = await runJS(`window.gridlock.carPoint(${m.car})`);
    if (!p) { rec(`car ${m.car} is on screen`, false, p); break; }
    await pull(p, m.delta);
    owedCells += Math.abs(m.delta);
    where[m.car] += m.delta;
    const after = await runJS(`(() => { const g = window.gridlock; return { moves: g.state.moves, cells: g.state.cells, at: g.pos()[${m.car}], done: g.state.done }; })()`);
    played++;
    log.push({ car: m.car, want: m.delta, owed: where[m.car], ...after });
    if (after.moves !== played) { rec(`drag ${played} counted as one move`, false, log); break; }
    if (after.cells !== owedCells) { rec(`drag ${played} billed ${owedCells} 格步 for ${after.cells}`, false, log); break; }
    if (after.at !== where[m.car]) { drifted = log[log.length - 1]; break; }
  }
  rec('the mouse plays the whole certified route, one move per drag', played === start.path.length && played > 0, log);
  rec('and every car lands exactly where the route puts it', played === start.path.length && !drifted, drifted || log[log.length - 1]);
  // The same fingers, the other ledger: the drags came out at par because that is what the
  // route was measured in, and the cells have to be at least the lot's second number.
  const ledgers = await runJS(`(() => { const g = window.gridlock; return { moves: g.state.moves, cells: g.state.cells, par: g.state.par, parCell: g.state.parCell }; })()`);
  rec('one pull bills one 滑步 but every 格步 the car travelled', ledgers.moves === played && ledgers.cells === owedCells && ledgers.cells >= ledgers.parCell, { ...ledgers, owedCells });

  const end = await runJS(`(() => {
    const g = window.gridlock;
    return {
      state: g.state,
      at: g.pos()[${start.hero}],
      stars: document.getElementById('stars').textContent,
      verdict: document.getElementById('verdict').textContent,
      curtain: !document.getElementById('curtain').hidden,
      record: g.store.record(g.state.id),
    };
  })()`);
  rec('the hero lands on the gate and cannot sail past it', end.at + start.len === start.w, { at: end.at, len: start.len, w: start.w });
  rec('the win card goes up with three stars', end.curtain && end.stars === '★★★' && end.verdict === '完美通行', end);
  rec('the run is on record at par', end.record && end.record.best === par && end.record.perfect === true, end.record);

  // A release with no travel is not a move, and tarmac is not a car.
  await runJS(`document.getElementById('again').click(); 'ok'`);
  await sleep(200);
  rec('再来一次 clears the card as well as the count', await runJS(`window.gridlock.state.moves === 0 && document.getElementById('curtain').hidden`), await runJS(`window.gridlock.state`));
  const p0 = await runJS(`window.gridlock.carPoint(${start.hero})`);
  await drag(p0, 0, 0);
  rec('pressing and releasing in place does nothing', (await runJS(`window.gridlock.state.moves`)) === 0, await runJS(`window.gridlock.state.moves`));

  const empty = await runJS(`(() => {
    const g = window.gridlock, spec = g.lot(), pos = g.pos();
    const taken = new Set();
    spec.cars.forEach((c, i) => {
      for (let k = 0; k < c.len; k++) taken.add((c.axis === 'h' ? pos[i] + k + ',' + c.y : c.x + ',' + (pos[i] + k)));
    });
    for (const w of spec.walls) taken.add(w.x + ',' + w.y);
    for (let y = 0; y < spec.h; y++) for (let x = 0; x < spec.w; x++) if (!taken.has(x + ',' + y)) return { x, y };
    return null;
  })()`);
  if (empty) {
    const pe = await runJS(`window.gridlock.cellPoint(${empty.x}, ${empty.y})`);
    await drag(pe, pe.cell * 2, 0);
    rec('a drag on empty tarmac moves nothing', (await runJS(`window.gridlock.state.moves`)) === 0, { empty, moves: await runJS(`window.gridlock.state.moves`) });
  } else {
    rec('a drag on empty tarmac moves nothing', false, 'the lot has no free cell to press');
  }

  // The lot line is the last bumper: replay the route to one drag short of the escape,
  // then pull the hero eight cells when it has fewer than that to go.
  await runJS(`document.getElementById('restart').click(); 'ok'`);
  await sleep(200);
  await runJS(`window.gridlock.play(window.gridlock.path().slice(0, -1)); 'ok'`);
  const almost = await runJS(`(() => {
    const g = window.gridlock, spec = g.lot(), p = g.path(), last = p[p.length - 1];
    const i = spec.cars.findIndex((c) => c.hero);
    return { car: last.car, delta: last.delta, moves: g.state.moves, at: g.pos()[i], len: spec.cars[i].len, w: spec.w };
  })()`);
  const hp = await runJS(`window.gridlock.carPoint(${almost.car})`);
  await pull(hp, almost.delta, 8);
  const clamped = await runJS(`(() => { const g = window.gridlock; return { at: g.pos()[${almost.car}], moves: g.state.moves, done: g.state.done }; })()`);
  rec('an eight-fold over-pull stops at the lot line', clamped.at + almost.len === almost.w && clamped.moves === start.path.length && clamped.done, { almost, clamped });

  // Keyboard shortcuts the panel advertises.
  await runJS(`document.getElementById('restart').click(); 'ok'`);
  await sleep(160);
  await runJS(`window.gridlock.play(window.gridlock.path().slice(0, 1)); 'ok'`);
  const kMoves = await runJS(`window.gridlock.state.moves`);
  await key('u');
  await sleep(160);
  rec('the u key undoes', (await runJS(`window.gridlock.state.moves`)) === kMoves - 1, { before: kMoves, after: await runJS(`window.gridlock.state.moves`) });
  await key('h');
  await sleep(160);
  rec('the h key asks for a hint', (await runJS(`window.gridlock.state.hints`)) === 1, await runJS(`window.gridlock.state.hints`));
  await key('r');
  await sleep(160);
  rec('the r key restarts', (await runJS(`window.gridlock.state.moves`)) === 0, await runJS(`window.gridlock.state`));

  // The law switch is a control like any other, so it gets pressed with a real mouse, and
  // the preference then has to survive an actual page load rather than living only in the
  // object the test was holding on to.
  const chipBox = await runJS(`(() => {
    const b = document.querySelector('#laws button[data-law="cell"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), law: window.gridlock.state.law };
  })()`);
  if (!chipBox) {
    rec('a real click on 格步 switches the counting law', false, chipBox);
  } else {
    await mouse('mousePressed', chipBox.x, chipBox.y, 1);
    await mouse('mouseReleased', chipBox.x, chipBox.y, 0);
    await sleep(160);
    rec('a real click on 格步 switches the counting law', chipBox.law === 'drag' && (await runJS(`window.gridlock.state.law`)) === 'cell', chipBox);
    // Page.reload, not a navigate to a hash: a fragment-only navigation is the same document,
    // so the module graph never re-runs and a "preference survived the reload" assertion would
    // be the test agreeing with itself. timeOrigin is the witness that this really was a boot.
    const before = await runJS(`performance.timeOrigin`);
    await cdp.send('Page.reload', {}, sessionId);
    const ready = await waitShell(300);
    const after = ready ? await runJS(`(() => { const g = window.gridlock; return { at: performance.timeOrigin, law: g.state.law, current: document.querySelector('#laws button[data-law="cell"]').getAttribute('aria-current') }; })()`).catch(() => null) : null;
    rec('a reload reads the law back out of the save file', !!after && after.at !== before && after.law === 'cell' && after.current === 'true', { before, after });
    await runJS(`window.gridlock.setLaw('drag'); 'ok'`);
    await sleep(120);
    rec('and the shell can be handed back on the classic convention', (await runJS(`window.gridlock.state.law`)) === 'drag', await runJS(`window.gridlock.state.law`));
  }

  return { rows };
}

// In-page suites. Each returns { rows: [{ test, pass, detail }] }.
const SCENARIOS = {
  boot: `(async () => {
    const g = window.gridlock;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    rec('the shell boots straight into a game', g && g.version === 2 && g.state && g.state.mode === 'campaign', g && g.state);
    const c = document.getElementById('lot');
    rec('the canvas has real pixels', c.width > 0 && c.height > 0 && !!c.getContext('2d'), { w: c.width, h: c.height });
    const lit = (() => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++;
      return n;
    })();
    rec('the lot was actually painted', lit > 50, { litSamples: lit });
    const pool = g.pool;
    rec('the shipped pool loaded', pool && pool.lots >= 32, pool && pool.lots);
    rec('every band reports a measured range, in both laws', Object.values(pool.byTier).every((t) => t.n > 0 && t.min <= t.max && t.cellMin <= t.cellMax && t.carsMin >= 2), pool.byTier);
    rec("the browser's own search agrees with the printed par", g.path().length === g.state.par, { path: g.path().length, par: g.state.par });
    rec("… and with the printed cell par", g.path('cell').length === g.state.parCell, { path: g.path('cell').length, parCell: g.state.parCell });
    const readout = document.getElementById('readout').textContent;
    rec('the panel prints steps, par and the record', /步数/.test(readout) && /最少/.test(readout) && /最佳/.test(readout), readout);
    rec('the law chips are painted before anything is clicked', document.querySelectorAll('#laws button[data-law]').length === 2, document.getElementById('laws').innerHTML);
    return { rows };
  })()`,

  play: `(async () => {
    const g = window.gridlock;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);

    g.store.reset();
    g.setLaw('drag'); // a previous scenario may have left the preference on 格步
    g.load('#/c/1'); await sleep(150);
    const par = g.state.par;
    const path = g.path();
    rec('the route the page finds is exactly par', path.length === par, { path: path.length, par });

    // A wasted round trip: every drag is reversible, so this is legal and stupid.
    const home = g.pos();
    g.play(path.slice(0, 1));
    const moved = g.pos()[path[0].car];
    g.play([{ car: path[0].car, delta: -path[0].delta }]);
    rec('dragging a car out and back costs two moves and puts it home',
      g.state.moves === 2 && moved !== home[path[0].car] && g.pos()[path[0].car] === home[path[0].car],
      { moves: g.state.moves, home: home[path[0].car], moved, back: g.pos()[path[0].car] });

    g.play(path);
    rec('over par still wins, two stars instead of three',
      g.state.done && g.state.moves === par + 2 && D('stars').textContent === '★★☆' && D('verdict').textContent === '干净脱身',
      { moves: g.state.moves, par, stars: D('stars').textContent, verdict: D('verdict').textContent });
    rec('the win card offers the next level', !D('curtain').hidden && !D('next').hidden, { nextHidden: D('next').hidden });
    const sloppy = g.store.record(g.state.id);
    rec('a run over par is a solve without the perfect flag', sloppy.best === par + 2 && sloppy.perfect === false, sloppy);

    D('next').click(); await sleep(160);
    rec('下一关 advances the campaign', g.state.index === 2 && g.state.moves === 0, g.state);

    g.load('#/c/1'); await sleep(160);
    g.play(path);
    const clean = g.store.record(g.state.id);
    rec('matching par later takes the record down and earns the flag', clean.best === par && clean.perfect === true && clean.plays === 2, clean);

    D('restart').click(); await sleep(150);
    const billed = g.store.stats.hints;
    const flawless = g.store.stats.perfect;
    const h = g.hintOnce();
    rec('the hint names a drag and points a direction', h.hints === 1 && /提示/.test(h.line) && /往/.test(h.line), h);
    g.play(g.path()); await sleep(150);
    rec('a hinted run bills the hint but not the perfect tally',
      g.store.stats.hints === billed + 1 && g.store.stats.perfect === flawless && g.store.record(g.state.id).perfect === true,
      { hints: g.store.stats.hints, perfect: g.store.stats.perfect, record: g.store.record(g.state.id) });
    D('restart').click(); await sleep(150);
    rec('重开 clears the count, the card and the hints', g.state.moves === 0 && g.state.hints === 0 && D('curtain').hidden, g.state);
    return { rows };
  })()`,

  routes: `(async () => {
    const g = window.gridlock;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    g.load('#/c/7'); await sleep(150);
    rec('#/c/7 is level seven', g.state.index === 7 && g.state.mode === 'campaign', g.state);
    g.load('#/c/99999'); await sleep(150);
    rec('a huge index clamps to the last level', g.state.index === g.pool.lots, { index: g.state.index, lots: g.pool.lots });
    g.load('#/c/0'); await sleep(150);
    rec('index zero clamps up to one', g.state.index === 1, g.state.index);

    g.load('#/daily'); await sleep(150);
    const daily = g.state.id;
    g.load('#/c/1'); await sleep(150);
    g.load('#/daily'); await sleep(150);
    rec('the daily route is the same puzzle twice', g.state.mode === 'daily' && g.state.id === daily, { first: daily, again: g.state.id });
    rec('the daily label carries the date', /^每日死锁 · \\d{4}-\\d{2}-\\d{2}$/.test(g.state.label), g.state.label);

    for (const tier of Object.keys(g.pool.byTier)) {
      g.load('#/random/' + tier + '/fixedseed'); await sleep(140);
      const first = g.state.id;
      g.load('#/c/1'); await sleep(140);
      g.load('#/random/' + tier + '/fixedseed'); await sleep(140);
      rec('#/random/' + tier + ' stays in its band and repeats itself', g.state.tier === tier && g.state.id === first, { tier: g.state.tier, id: g.state.id, first });
    }
    g.load('#/random'); await sleep(220);
    rec('a bare #/random mints a token into the URL', /^#\\/random\\/[a-z]+\\/[a-z0-9]+$/.test(location.hash), location.hash);

    g.load('#/c/5'); await sleep(140);
    const sample = g.state.id;
    g.load('#/c/1'); await sleep(140);
    g.load('#/lot/' + sample); await sleep(140);
    rec('#/lot/<id> opens that lot', g.state.id === sample && g.state.mode === 'lot', { want: sample, got: g.state.id });
    g.load('#/lot/not-a-real-lot'); await sleep(140);
    rec('an unknown lot id falls back instead of blanking the board', !!g.state.id && g.state.mode === 'lot' && g.state.par >= 1, g.state);
    return { rows };
  })()`,

  save: `(async () => {
    const g = window.gridlock;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);
    const KEY = 'gridlock.save.v1';

    g.store.reset();
    g.load('#/c/1'); await sleep(160);
    rec('a wiped save is empty', Object.keys(g.store.records).length === 0 && g.store.unlocked === 1, { unlocked: g.store.unlocked });

    g.play(g.path());
    const id = g.state.id;
    await sleep(160);
    const raw = JSON.parse(localStorage.getItem(KEY));
    rec('the solve reaches localStorage, not only memory', !!(raw && raw.records[id] && raw.records[id].best === g.state.par), raw && Object.keys(raw.records || {}));
    rec('clearing the first level unlocks the second', g.store.unlocked === 2 && raw.unlocked === 2, { unlocked: g.store.unlocked });
    const shelf2 = document.querySelector("#shelf button[data-index='2']");
    rec('the shelf lets level two be clicked, and takes it there', shelf2 && !shelf2.disabled, shelf2 && shelf2.outerHTML);

    g.load('#/daily'); await sleep(160);
    const day = g.state.label.split(' · ')[1];
    g.play(g.path());
    await sleep(160);
    const mark = g.store.dailyDone(day);
    rec('today is logged once solved', !!mark && mark.id === g.state.id, { day, mark });
    rec('the shelf says today is done', /已通过/.test(document.getElementById('shelf').textContent), document.getElementById('shelf').textContent);

    // The wipe is the only destructive control, so it arms on the first click.
    D('wipe').click(); await sleep(80);
    const armed = Object.keys(g.store.records).length;
    rec('the first click only arms it', armed > 0, { armed });
    D('wipe').click(); await sleep(200);
    rec('清空存档 takes two clicks and clears everything',
      Object.keys(g.store.records).length === 0 && g.store.unlocked === 1 && localStorage.getItem(KEY) === null,
      { records: Object.keys(g.store.records), unlocked: g.store.unlocked, key: localStorage.getItem(KEY) });
    return { rows };
  })()`,

  // The counting-law switch, on the hardest lot in the pool: two certified numbers, two
  // live counters, and a grade that has to follow whichever one the player is looking at.
  // The rule the stars are typed against is written out here rather than imported, so the
  // page has to match it instead of agreeing with itself.
  law: `(async () => {
    const g = window.gridlock;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);
    const KEY = 'gridlock.save.v1';
    const chip = (k) => document.querySelector('#laws button[data-law="' + k + '"]');
    const starsFor = (over) => (over <= 0 ? '★★★' : over <= 3 ? '★★☆' : '★☆☆');
    const verdictFor = (over) => (over <= 0 ? '完美通行' : over <= 3 ? '干净脱身' : '勉强疏通');

    g.store.reset();
    g.setLaw('drag');
    g.load('#/c/' + g.pool.lots); await sleep(200);
    const s = g.state;
    rec('the shell runs two counting laws, and both are on the panel', g.version === 2 && JSON.stringify(g.laws) === '["drag","cell"]', { version: g.version, laws: g.laws });
    rec('this lot ships two different numbers', s.parCell > s.par && s.par >= 1, { par: s.par, parCell: s.parCell, id: s.id });
    rec('the browser search finds both of them, by its own roads', g.path('drag').length === s.par && g.path('cell').length === s.parCell, { drag: g.path('drag').length, cell: g.path('cell').length });
    const dragBill = g.path('drag').reduce((n, m) => n + Math.abs(m.delta), 0);
    rec('the cheapest route in drags is not the cheapest in cells', dragBill >= s.parCell && s.parCell >= s.par, { dragCells: dragBill, parCell: s.parCell, par: s.par });
    rec('both chips exist and exactly one is current', !!chip('drag') && !!chip('cell') && chip('drag').getAttribute('aria-current') === 'true' && chip('cell').getAttribute('aria-current') === 'false', chip('drag') && chip('drag').outerHTML);
    const readout = D('readout').textContent;
    rec('the panel prints the pair, not one number', /滑步／格步/.test(readout) && readout.includes(String(s.par)) && readout.includes(String(s.parCell)), readout);

    chip('cell').click(); await sleep(140);
    rec('clicking 格步 changes the law and leaves the lot alone', g.state.law === 'cell' && g.state.parNow === g.state.parCell && g.state.spent === 0 && g.state.moves === 0 && !g.state.done, g.state);
    rec('the chip carries the active state', chip('cell').getAttribute('aria-current') === 'true' && chip('drag').getAttribute('aria-current') === 'false' && chip('cell').classList.contains('here'), chip('cell').outerHTML);
    rec('the preference is a fact in the save file', JSON.parse(localStorage.getItem(KEY)).law === 'cell', JSON.parse(localStorage.getItem(KEY)));
    const hintLine = g.hintOnce();
    rec('a hint under 格步 speaks 格步', /格步/.test(hintLine.line) && /提示/.test(hintLine.line), hintLine);
    D('restart').click(); await sleep(140);

    const cellPath = g.path('cell');
    g.play(cellPath); await sleep(180);
    const after = g.state;
    rec('the cell route is one cell at a time and lands on its own par', cellPath.every((m) => Math.abs(m.delta) === 1) && after.cells === after.parCell && after.done, { len: cellPath.length, cells: after.cells, parCell: after.parCell });
    rec('the same run is par in cells and far over in drags', after.moves === cellPath.length && after.moves - after.par > 3, { moves: after.moves, par: after.par });
    rec('the card grades it against the law being played', !D('curtain').hidden && D('stars').textContent === starsFor(0) && D('verdict').textContent === verdictFor(0), { stars: D('stars').textContent, verdict: D('verdict').textContent });
    const card = D('tally').textContent;
    rec('the card prints the other ledger too, so nothing is hidden', /另一本账/.test(card) && card.includes(String(after.moves)) && /通道逼出/.test(card), card);
    const cellRun = g.store.record(after.id);
    rec('the record keeps a best per ledger, with the flag of the ledger it matched',
      cellRun.bestCell === after.parCell && cellRun.perfectCell === true && cellRun.best === after.moves && cellRun.perfect === false,
      cellRun);

    D('restart').click(); await sleep(140);
    chip('drag').click(); await sleep(140);
    rec('switching back mid-lot costs nothing and resets nothing', g.state.law === 'drag' && g.state.moves === 0 && g.state.cells === 0 && g.state.parNow === g.state.par, g.state);
    g.play(g.path('drag')); await sleep(180);
    const out = g.state;
    rec('the drag route plays out in exactly par drags', out.moves === out.par && out.cells === dragBill && out.done, { moves: out.moves, par: out.par, cells: out.cells });
    rec('the card reads the law it was played in: three stars again, for the other number', D('stars').textContent === starsFor(0) && D('verdict').textContent === verdictFor(0), { stars: D('stars').textContent, law: out.law });
    const dragRun = g.store.record(out.id);
    rec('the two flags are earned by two different runs, and both stick',
      dragRun.perfect === true && dragRun.perfectCell === true && dragRun.best === out.par && dragRun.bestCell === after.parCell && dragRun.plays === 2,
      { record: dragRun, par: out.par, parCell: after.parCell });
    rec('the totals count both kinds of perfect separately', /滑步完美/.test(D('totals').textContent) && /格步完美/.test(D('totals').textContent), D('totals').textContent);

    rec('a law this game does not have is refused, not quietly defaulted to', g.setLaw('triples') === 'drag' && g.state.law === 'drag' && JSON.parse(localStorage.getItem(KEY)).law === 'drag', g.state.law);
    return { rows };
  })()`,
};

main().catch((err) => {
  console.error('playtest failed: ' + ((err && err.stack) || err));
  process.exit(1);
});
