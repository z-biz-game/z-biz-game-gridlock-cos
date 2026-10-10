#!/usr/bin/env node
// 文档引用腿：三份文档里那批 `path:NN`（"去看第 N 行"）一条一条读回来对账。零依赖。
//
// 为什么要有这一支：本仓的 README / DESIGN / deliverable 里挂着几十条行号引用，而 tools/ 里
// 从来没有一条闸核过它们（上一版的 tools/ 里连 citeMiss 这个词都不存在）。于是"文档说的是第
// 115 行"这句话的真假，全靠写文档那一刻有人手算过一次；代码改一行、文档不改，读者按着引用看
// 到的是隔壁那句别的话，而文档看起来照样权威。手抄的行号清单不是证据，是可再生的观测值。
//
// 两半各防一种谎，缺一不可：
//   范围半 citeMiss()：文件在盘上、行号落在真实行数内、且被指的那几行**不许整段是空行**。
//     "在界内"不等于"指到了代码"：一条落在两段之间的裸引用，前两道查都放它过。
//   锚点半 anchorMiss()：贴着引用写在反引号里的那个名字，必须作为**完整标识符**出现在被指的那
//     几行里。子串口径比它替掉的手写清单**更弱**——`grow` 坐在声明 `growTier` 的那一行上也算
//     命中，一次真的漂会被读成绿，所以这里整词，两侧再是字母/数字/_/$ 就不算这个名字。
//
// 指认写法与 fleet 同源，不另起一套：五种 —— `name`（`path:NN`）、`path:NN`（`name`）、
//   `path:NN` 的 `name`、`path:NN`（`fn(a, b)`）、`path:NN`（`dir/file.js::symbol`）；`::` 先切
//   再判 `/`（否则目录限定名的锚点会被自己的斜杠吃掉）；带 `<占位>` 的 body 锚在字面量前缀上；
//   body 里有空格是命令行（`npm test`）不是名字，拿它第一个词去锚是凭空造红；纯标点间隔
//   （`，`、`、`）不构成指认——那前面只是列表的上一个条目。
//   句子里没贴名字的裸引用只过范围半。这条腿没覆盖什么，README 里也照实写明，不装作全覆盖。
//
// 防自己空转：条数有地板（解析不到引用不是"文档变干净了"，是这一格红）、台账把数钉成**数组
// 等式**（每一把刀各占一格，少一把就看得见是哪一格归零）、文档里印的读数由本闸读回来对账、
// 最后一行自数 rows。靶子的行号一律运行时现量（空行、声明行、函数行），写死的那个数会在有人
// 填了那一行之后悄悄地不再测任何东西。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '_scratch', '_site', '_tmp', 'shots']);

let rows = 0;
const fails = [];
const ok = (cond, label, detail) => {
  rows += 1;
  if (!cond) fails.push(`${label}${detail ? '  ——  ' + detail : ''}`);
};
const eq = (a, b, label, detail) => {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  ok(ja === jb, label, ja === jb ? '' : `${detail ? detail + '  ——  ' : ''}got ${ja} / want ${jb}`);
};

const PATH_SRC = '[\\w./@-]+?\\.[A-Za-z][A-Za-z0-9]{0,11}'; // 后缀不许写死：写死成某一族的语言时，本腿在那种仓里是哑的，而「0 条引用」读起来和「全核过」一模一样
const CITE = new RegExp('^(' + PATH_SRC + '):([0-9]+(?:[,-][0-9]+)*)$');
// 锚点可以是成员路径（`view.cellCenter`），但绝不能是文件路径：body 里带 `/` 的是另一条引用，
// 拿它当字符串去被指的那几行里找，只会凭空造出一条红。
const ID = /^[A-Za-z_$][A-Za-z0-9_$]{2,}(?:\.[A-Za-z_$][A-Za-z0-9_$]+)*$/;

export function tokOf(body) {
  const seg = body.includes('::') ? body.slice(body.lastIndexOf('::') + 2) : body;
  if (seg.includes('/')) return '';
  const tpl = /^([^<>]+?)<[^<>\s]+>/.exec(seg);
  if (tpl && ID.test(tpl[1].split(':')[0].trim())) return tpl[1].split(':')[0].trim();
  const head = seg.split('(')[0].trim();
  if (ID.test(head)) return head;
  const lhs = head.split(/[=:]\s/)[0].trim();
  return ID.test(lhs) ? lhs : '';
}

let tree = null;
function theTree() {
  if (tree) return tree;
  const out = [];
  (function dig(dir) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      if (SKIP_DIRS.has(name)) continue;
      const rel = dir ? `${dir}/${name}` : name;
      if (fs.statSync(path.join(ROOT, rel)).isDirectory()) dig(rel);
      else out.push(rel);
    }
  })('');
  tree = out;
  return tree;
}

// 写出来的路径：整条命中优先；只写了裸文件名时，唯一才认（同名两处=指错了地方，不是"找到一处"）。
export function resolvePath(p) {
  const clean = p.replace(/^\.\//, '');
  if (fs.existsSync(path.join(ROOT, clean))) return clean;
  const hits = theTree().filter((f) => f === clean || f.endsWith('/' + clean));
  return hits.length === 1 ? hits[0] : null;
}

const lineCache = new Map();
export function linesOf(p) {
  const rel = resolvePath(p);
  if (!rel) return null;
  if (!lineCache.has(rel)) {
    const arr = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    if (arr[arr.length - 1] === '') arr.pop();
    lineCache.set(rel, arr);
  }
  return lineCache.get(rel);
}

export function parseRefs(text) {
  const spans = [];
  const spanRe = /`([^`\n]+)`/g;
  let m;
  while ((m = spanRe.exec(text))) spans.push({ body: m[1], s: m.index, end: m.index + m[0].length });
  const out = [];
  for (let i = 0; i < spans.length; i++) {
    const c = spans[i].body.match(CITE);
    if (!c) continue;
    let anchor = '';
    let consumed = false;
    const next = spans[i + 1];
    const gA = next ? text.slice(spans[i].end, next.s) : null;
    if (gA !== null && gA.length <= 4 && !gA.includes('\n')) {
      const gN = gA.replace(/\s+/g, '');
      if (/^[（(]/.test(gN) || gN === '的') { consumed = true; anchor = tokOf(next.body); }
    }
    // 后向那半挂在"前向没成"上，而不是挂在"前向条件不成立"上：挂在条件上会让
    // 「`elapsed` 在 `js/main.js:1`、」这种前向短间隔却推不出名字写法把后向半边一起哑掉。
    if (!consumed && i > 0) {
      const prev = spans[i - 1];
      const gap = text.slice(prev.end, spans[i].s);
      const gT = gap.replace(/\s+/g, '');
      const shaped = /^[（(]/.test(gT) || /[\w一-鿿]/.test(gT);
      if (shaped && !/\s/.test(prev.body) && gap.length <= 4 && !gap.includes('\n')) anchor = tokOf(prev.body);
    }
    for (const seg of c[2].split(',')) {
      const parts = seg.split('-').map(Number);
      const from = parts[0], to = parts[parts.length - 1] || parts[0];
      out.push({ path: c[1], from, to, anchor, label: `${c[1]}:${from}${to !== from ? '-' + to : ''}` });
    }
  }
  return out;
}

// 缓存：一条腿要对同一个名字核上百次。
const wordCache = new Map();
export function hasWord(text, name) {
  if (!wordCache.has(name)) {
    wordCache.set(name, new RegExp('(^|[^A-Za-z0-9_$])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9_$])'));
  }
  return wordCache.get(name).test(text);
}

// 范围半：文件 / 界内 / 整段空行，三道查住在同一个函数里。抽出来是为了让下面那把空行对照刀
// 走**同一条代码路径**——把空行那一道删掉，真文档照样全绿，只有这一把会立刻红；不抽出来的话
// 那一道查就是一张没有对照的等式。
export function citeMiss(p, fromRaw, toRaw) {
  const rp = resolvePath(p);
  const from = +fromRaw, to = +(toRaw || fromRaw);
  const label = `${p}:${from}${to !== from ? '-' + to : ''}`;
  if (!rp) return `${label} 文件不存在或同名不唯一`;
  const lines = linesOf(rp);
  if (!(from >= 1) || from > to || to > lines.length) return `${label} 越界（该文件共 ${lines.length} 行）`;
  if (lines.slice(from - 1, to).join('').trim() === '') return `${label} 那几行整段是空行`;
  return '';
}

// 锚点半：整词，不是子串。见文件头那条为什么。
export function anchorMiss(list) {
  return list.filter((d) => {
    if (!d.anchor) return false;
    const rp = resolvePath(d.path);
    if (!rp) return true;
    const lines = linesOf(rp);
    if (d.from < 1 || d.to > lines.length) return true;
    return !hasWord(lines.slice(d.from - 1, d.to).join('\n'), d.anchor);
  });
}

export function audit(text) {
  const refs = parseRefs(text);
  const outOfRange = [];
  for (const r of refs) {
    const miss = citeMiss(r.path, r.from, r.to);
    if (miss) outOfRange.push(miss);
  }
  const anchorBad = anchorMiss(refs);
  // `` `file`（N 行）`` 是一种被印出来的现值：它和引用一样要等值对账，不是地板。
  const cntRe = new RegExp('`(' + PATH_SRC + ')`（([0-9]+) 行）', 'g');
  let k;
  while ((k = cntRe.exec(text))) {
    const lines = linesOf(k[1]);
    if (!lines) outOfRange.push(`${k[1]}（${k[2]} 行）文件不存在或同名不唯一`);
    else if (lines.length !== Number(k[2])) outOfRange.push(`${k[1]} 实测 ${lines.length} 行，文档写的是 ${k[2]}`);
  }
  return { refs, outOfRange, anchorBad, anchored: refs.filter((r) => r.anchor).length };
}

// 输入集由目录现数，绝不手写清单：手写的那份会悄悄把样本缩小，而闸一直打印"全都对"。
export function scan() {
  const docs = fs.readdirSync(ROOT).filter((f) => f.endsWith('.md') && fs.statSync(path.join(ROOT, f)).isFile());
  let docText = '';
  const outOfRange = [];
  const anchorBad = [];
  let refs = 0;
  let anchored = 0;
  for (const f of docs) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    docText += t + '\n';
    const a = audit(t);
    refs += a.refs.length;
    anchored += a.anchored;
    for (const b of a.outOfRange) outOfRange.push(`${f} · ${b}`);
    for (const b of a.anchorBad) anchorBad.push(`${f} · ${b.label} 那几行里没有 ${b.anchor}`);
  }
  return { docs, docText, refs, anchored, outOfRange, anchorBad,
    claims: [...docText.matchAll(/解析 (\d+) 条/g)].map((x) => Number(x[1])),
    anchorClaims: [...docText.matchAll(/认到锚点 (\d+) 条/g)].map((x) => Number(x[1])),
    ledgerClaims: [...docText.matchAll(/假引用台账 (\d+) 把/g)].map((x) => Number(x[1])) };
}

// ---- 靶子全部运行时现量：这一支闸自己不改代码，但它引用的那些文件会改 ----
export function probe() {
  const file = 'js/core/solve.js';
  const lines = linesOf(file) || [];
  let declAt = 0, declName = '', cut = '', fnAt = 0, fnName = '', badAt = 0, blankAt = 0;
  for (let i = 0; i < lines.length; i++) {
    const body = lines[i];
    if (!blankAt && i > 0 && String(body).trim() === '') blankAt = i + 1;
    const d = /(?:const|let|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]{4,})/.exec(body);
    if (d && !declAt) {
      const c = d[1].slice(0, -1);
      // 截掉最后一格之后仍是这一行的子串、却不再是一个完整标识符——这正是整词那道查的靶子。
      // 碰巧也是完整词（例如那行另有一个同前缀的名字）就换下一行，不许放宽判据。
      if (body.includes(c) && !hasWord(body, c)) { declAt = i + 1; declName = d[1]; cut = c; }
    }
    const f = /\b([A-Za-z_$][A-Za-z0-9_$]{2,})\(/.exec(body);
    if (f && !fnAt && hasWord(body, f[1]) && ID.test(f[1])) { fnAt = i + 1; fnName = f[1]; }
  }
  for (let i = 0; i < lines.length; i++) {
    const body = lines[i];
    if (String(body).trim() === '') continue;
    if (hasWord(body, 'NO_SUCH_NAME') || hasWord(body, 'Math.max') || (declName && hasWord(body, declName))) continue;
    if (fnName && hasWord(body, fnName)) continue;
    badAt = i + 1;
    break;
  }
  return { file, declAt, declName, cut, fnAt, fnName, badAt, blankAt, total: lines.length };
}

// 空行对照刀（范围半）：靶子是现量出来的那一行，行号不写死——写死了的那一天就是这一格不再
// 测任何东西的那一天，所以 blankAt>0 也要被钉进下面的等式里。
export function blankKnife() {
  const p = probe();
  return { at: p.blankAt, hit: p.blankAt ? citeMiss(p.file, p.blankAt, null) : '' };
}

// 整词对照刀（锚点半）：从**真文档**里推出来的锚点中挑一条，把名字截掉最后一格。截出来的串仍
// 是被指那几行的子串、却不是完整标识符 ⇒ 整词口径必须判它红。挑不出候选就当场红，不许静默跳过：
// 口径哪天退回子串，那一天正是所有候选都"过"、这把刀挑不出红的那一天。
export function wordKnife(docAnchors) {
  for (const d of docAnchors) {
    const rp = resolvePath(d.path);
    if (!rp) continue;
    const body = linesOf(rp).slice(d.from - 1, d.to).join('\n');
    const c = d.anchor.slice(0, -1);
    if (c.length < 3 || !body.includes(d.anchor) || !body.includes(c)) continue;
    if (anchorMiss([{ ...d, anchor: c }]).length) return { d, cut: c };
  }
  return null;
}

// 九把假引用，一把一个坏法，全部要求**点名**被抓住。台账钉成数组：总数一格、每种坏法各一格、
// 空行靶子抓到没有各占一格——退回子串口径时看到"总数少一把 + 整词那格归零"，而不是一句还是
// 「都抓住了」。
export function fakeCites() {
  const p = probe();
  const drift = `${p.file}:${p.badAt}`;
  const t = audit(`出处 \`js/core/nope.js:1\`、\`${p.file}:99999\`、\`NO_SUCH_NAME\` 在 \`${drift}\`、` +
    '`package.json`（999 行）、' + `\`${drift}\`（\`NO_SUCH_NAME\`）、\`${drift}\` 的 \`NO_SUCH_NAME\`、` +
    `\`${drift}\`（\`Math.max(2, 3)\`)` + (p.blankAt ? `、\`${p.file}:${p.blankAt}\`` : '') +
    `、\`${p.file}:${p.declAt}\`（\`${p.cut}\`）`);
  const all = [...t.outOfRange, ...t.anchorBad.map((d) => `${d.label} 那几行里没有 ${d.anchor}`)];
  const mode = (re) => all.filter((x) => re.test(x)).length;
  // 整词那一把单独占一格：口径退回子串时同时看见"总数少一把"和"这一格归零"。
  const prefixSlot = all.filter((x) => x.endsWith(`里没有 ${p.cut}`)).length;
  return {
    caught: all.length, list: all, refs: t.refs.length, blankAt: p.blankAt, cut: p.cut,
    slots: [all.length, mode(/文件不存在/), mode(/越界/), mode(/实测/), mode(/那几行里没有/),
      mode(/整段是空行/), prefixSlot, p.blankAt > 0 && p.declAt > 0],
  };
}

// 阳性对照：五种真指认写法 + 带空格的命令行 body + 真的行数，必须在**同一个解析器**下判绿。
// 没有这一格，上面那条红就可能只是解析器坏了，而不是文档引用漂了。
export function realAnnotations() {
  const p = probe();
  const pkg = linesOf('package.json');
  const t = audit(`\`${p.declName}\`（\`${p.file}:${p.declAt}\`）、\`${p.file}:${p.declAt}\`（\`${p.declName}\`）、` +
    `\`${p.file}:${p.declAt}\` 的 \`${p.declName}\`、\`${p.file}:${p.fnAt}\`（\`${p.fnName}(start, opts)\`）、` +
    `\`${p.file}:${p.fnAt}\`（\`${p.file}::${p.fnName}\`）、\`${p.file}:${p.declAt}\`（\`npm test\`） 与 ` +
    '`package.json`（' + (pkg ? pkg.length : 0) + ' 行）');
  return { bad: [...t.outOfRange, ...t.anchorBad.map((d) => `${d.label} 那几行里没有 ${d.anchor}`)], refs: t.refs.length };
}

// `name:<占位>` 锚在字面量前缀上：对得上判绿、对不上必须红（`test:docs` 那种写法指的是 `test`）。
export function templatePrefix() {
  const p = probe();
  const g = audit(`\`${p.file}:${p.declAt}\`（\`${p.declName}:<占位>\`）`);
  const r = audit(`\`${p.file}:${p.declAt}\`（\`NOPE:<占位>\`）`);
  return { greenBad: [...g.outOfRange, ...g.anchorBad.map((d) => `${d.label} 没有 ${d.anchor}`)],
    redBad: r.anchorBad.map((d) => `${d.label} 那几行里没有 ${d.anchor}`), refs: g.refs.length };
}

// 纯标点间隔不构成指认：`，` 前面那个名字只是上一个列表项，拿它去锚会把一份正确的文档读红。
export function commaControl() {
  const p = probe();
  const t = audit(`\`NO_SUCH_NAME\`，\`${p.file}:${p.declAt}\``);
  return { bad: [...t.outOfRange, ...t.anchorBad.map((d) => `${d.label} 那几行里没有 ${d.anchor}`)], refs: t.refs.length };
}

// 界内漂移的靶子：从**真文档**里挑一条带指认的引用，把行段整体挪一格（只在内存里改，盘上一个
// 字节不动）。范围半看不见这种漂（还在同一个文件里），只有锚点半能。
export function poisonNeedle(docText) {
  const anchored = parseRefs(docText).filter((r) => r.anchor);
  let picked = null;
  for (const r of anchored) {
    const lines = linesOf(r.path) || [];
    const to = r.to + 1;
    if (to > lines.length) continue;
    const shifted = `${r.path}:${r.from + 1}-${to}`;
    const poisoned = audit(docText.split('`' + r.label + '`').join('`' + shifted + '`'));
    if (poisoned.anchorBad.length >= 1) {
      picked = { label: r.label, shifted, anchor: r.anchor, bad: poisoned.anchorBad.map((d) => `${d.label} 那几行里没有 ${d.anchor}`) };
      break;
    }
  }
  return { anchored: anchored.length, picked };
}

// ---- 断言 ----
// 三处入口必须调同一条命令：只在 CI 跑的门等于没有门（本仓的 deploy-set 就栽过一次）。
const EXPECT = {
  REFS_FLOOR: 70,        // 条数地板：少于这个数=解析器扑空，不是文档变干净了
  ANCHOR_FLOOR: 3,       // 锚点地板：按真实数钉（本仓文档里带名字的引用本来就少）
  LEDGER: [9, 1, 1, 1, 5, 1, 1, true],
  ROWS: 19,              // 本闸的自计数：加一条、删一条都要在这里同步，否则这里红
};

export function legs() {
  const s = scan();
  const bk = blankKnife();
  const docAnchors = parseRefs(s.docText).filter((r) => r.anchor);
  const wk = wordKnife(docAnchors);
  const F = fakeCites();
  const P = realAnnotations();
  const T = templatePrefix();
  const C = commaControl();
  const N = poisonNeedle(s.docText);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const verify = fs.readFileSync(path.join(ROOT, 'tools/verify.sh'), 'utf8');
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const out = [];
  const push = (fn) => out.push(fn);

  push(() => eq(s.docs, fs.readdirSync(ROOT).filter((f) => f.endsWith('.md')),
    'A1 被审的文档集就是本仓根下的 .md（清单由目录现数，手写的那份会悄悄缩样本）'));
  push(() => ok(s.refs >= EXPECT.REFS_FLOOR, `A2 解析到的引用条数多到它自己算覆盖面（地板 ${EXPECT.REFS_FLOOR}）`,
    `本次解析 ${s.refs} 条；解析不到不是"文档变干净了"，是这一格红`));
  push(() => ok(s.outOfRange.length === 0 && !!bk.hit,
    `A3 每一条 path:NN 都在盘上、落在真实行数内、且被指那几行不许整段是空行（这一格自己带一把指空行的刀）`,
    s.outOfRange.length ? `越界/不存在/空行：${s.outOfRange.slice(0, 5).join('，')}${s.outOfRange.length > 5 ? ` …共 ${s.outOfRange.length} 条` : ''}`
      : bk.hit ? `${s.refs} 条全在范围内 · 刀：${bk.hit}（第 ${bk.at} 行是现量出来的空行）`
        : `现量不出空行靶子 —— 空行那一道没被证明过（blankAt=${bk.at}）`));
  push(() => ok(s.anchored >= EXPECT.ANCHOR_FLOOR, `B1 带指认的引用不少于 ${EXPECT.ANCHOR_FLOOR} 条（少了就是锚点半边在空转）`,
    `本次认到锚点 ${s.anchored} 条：${docAnchors.map((r) => `${r.label}=${r.anchor}`).join(' ')}`));
  push(() => ok(s.anchorBad.length === 0 && !!wk,
    'B2 贴着引用写的那个名字作为**完整标识符**坐在被指的那几行里（整词口径；行号在界内不算数，这一格自己带一把截前缀的刀）',
    s.anchorBad.length ? `漂 ${s.anchorBad.length} 处：${s.anchorBad.slice(0, 6).join('，')}`
      : wk ? `${s.anchored} 条全部落回原处 · 刀：${wk.d.label} 的 ${wk.d.anchor} 截成 ${wk.cut} 判红`
        : '现推锚点里截不出前缀靶子 —— 整词这一道没被证明过（口径退回子串的那一天就是这里）'));
  push(() => ok(!!N.picked, 'B3 刀：把文档里一条界内的真引用挪歪一格，锚点半边必须认它漂（范围半边看不见这种漂）',
    N.picked ? `下刀处 ${N.picked.label} → ${N.picked.shifted} 红在 ${N.picked.bad[0]}`
      : `带指认的 ${N.anchored} 条里没有一条挪歪会红 —— 锚点是摆设`));
  push(() => eq(F.slots, EXPECT.LEDGER,
    `C1 假引用台账 ${EXPECT.LEDGER[0]} 把一把不落（不存在 / 越界 / 行数写错 / 后向锚点漂 / 前向括号漂 / 「的」漂 / 调用形式漂 / 无锚点落在第 ${F.blankAt} 行现量空行 / 前缀不算整词）`,
    `抓到 ${F.caught} 把`));
  push(() => { eq(P.bad, [], 'C2 五种真指认写法 + 带空格的命令行 body + 真行数在同一个解析器下判绿');
    eq(P.refs, 6, 'C2b 正样本应当解析到 6 条引用（第 7 处是「N 行」那种等值断言，不是引用）'); });
  push(() => { eq(T.greenBad, [], 'C3a 模板 body 的前缀对得上时必须判绿');
    eq(T.redBad.length, 1, `C3b 模板 body 的前缀对不上时必须红，红在 ${T.redBad.join(' | ') || '（一处都没红）'}`); });
  push(() => { eq(C.bad, [], 'C4a 纯标点间隔（`，`）不构成指认，这种写法必须判绿');
    ok(C.refs === 1, `C4b 应当只解析到 1 条引用，实到 ${C.refs}`); });
  push(() => ok(s.claims.length >= 1 && s.claims.every((c) => c === s.refs),
    `N1 文档里每一处「解析 N 条」等于这条腿自己数到的（删掉这个数字同样算红——"没有声称"不能当成"没有错"）`,
    `闸数到 ${s.refs} · 文档写了 ${s.claims.length} 处：${[...new Set(s.claims)].join('/') || '（一处都没写）'}`));
  push(() => ok(s.anchorClaims.length >= 1 && s.anchorClaims.every((c) => c === s.anchored),
    'N2 文档里每一处「认到锚点 N 条」等于这条腿真的推出来的条数',
    `闸数到 ${s.anchored} · 文档写了 ${s.anchorClaims.length} 处：${[...new Set(s.anchorClaims)].join('/') || '（一处都没写）'}`));
  push(() => ok(s.ledgerClaims.length >= 1 && s.ledgerClaims.every((c) => c === EXPECT.LEDGER[0]),
    `N3 文档里每一处「假引用台账 N 把」等于钉在闸里的那 ${EXPECT.LEDGER[0]} 把（刀加一把、文档不写数就红）`,
    `钉 ${EXPECT.LEDGER[0]} · 文档写了 ${s.ledgerClaims.length} 处：${[...new Set(s.ledgerClaims)].join('/') || '（一处都没写）'}`));
  push(() => {
    const inPkg = (pkg.scripts?.docs || '').includes('node tools/doctest.mjs');
    const inVerify = /node tools\/doctest\.mjs/.test(verify);
    const inCi = /run: node tools\/doctest\.mjs/.test(ci);
    ok(inPkg && inVerify && inCi, 'T1 接线：package.json 的 docs、tools/verify.sh、.github/workflows/ci.yml 调的是同一条命令（不许有只在一处跑的门）',
      `pkg.docs=${pkg.scripts?.docs || '（没有）'} · verify.sh=${inVerify} · ci.yml=${inCi}`);
    ok(/&& npm run docs/.test(pkg.scripts?.test || ''), 'T2 本地 `npm test` 也跑这一条（不是只有 CI 跑）',
      `pkg.test=${pkg.scripts?.test}`);
  });
  // 自计数：这一格缩水必须先自己红。比较发生在计数之前，所以比的是「含这一条」的总数。
  push(() => ok(rows + 1 === EXPECT.ROWS, `Z1 本闸跑出的断言条数（含这一条）等于钉在文件里的 EXPECT.ROWS（${EXPECT.ROWS}）`,
    `实际 ${rows + 1} 条：加一条、删一条都要在这里同步，否则就是这里红`));

  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = scan();
  const bk = blankKnife();
  const F = fakeCites();
  for (const fn of legs()) fn(); // 每条腿各自把结果记进 rows / fails
  console.log(`文档门：${s.docs.length} 份文档由目录现数，解析 ${s.refs} 条 文件:行号，其中认到锚点 ${s.anchored} 条；` +
    `越界/不存在/空行 ${s.outOfRange.length} 条，锚点漂 ${s.anchorBad.length} 处`);
  if (s.outOfRange.length) console.log(s.outOfRange.slice(0, 12).map((x) => `       ${x}`).join('\n'));
  if (s.anchorBad.length) console.log(s.anchorBad.slice(0, 12).map((x) => `       ${x}`).join('\n'));
  console.log(`空行靶子（现量）：${bk.at || '没有'} → ${bk.hit || '没红（这一格没被证明）'}`);
  console.log(`台账：${F.caught}/${EXPECT.LEDGER[0]} 把，槽位 ${JSON.stringify(F.slots)}`);
  for (const f of fails) console.log('  FAIL ' + f);
  console.log(`rows: ${rows} fail: ${fails.length}`);
  // exitCode 而不是 exit()：exit() 不等 stdout 排干，长清单会被截断在半条引用上。
  process.exitCode = fails.length === 0 ? 0 : 1;
}
