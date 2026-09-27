# 死锁车库 - 交付报告

## 任务摘要

| 属性 | 内容 |
|------|------|
| **项目名称** | Gridlock |
| **App 名称** | 死锁车库 |
| **形态** | 浏览器原生（ES modules，零依赖）+ Electron 壳 + GitHub Pages |
| **仓库** | `z-biz-game/z-biz-game-gridlock-cos` |
| **线上** | https://z-biz-game.github.io/z-biz-game-gridlock-cos/ （Pages + CI 双绿，50 条线上断言见下） |
| **分组** | E（益智解谜），无成就 / 无排行榜 / 无云存档 |
| **玩法概述** | Rush Hour：在网格停车场里拖动车辆，把橙色主角车开出右侧闸门 |
| **核心差异点** | 每一关的"最少步数"是 BFS 量出来的证明值；关卡由构建期生长 + 复验，不是人手摆的 |
| **代码量** | 3,339 行（不含文档）：引擎 892 · 画面/外壳 688 · 关卡数据 71 · 测试与台架样本 730 · 构建/验证工具 695 · 服务与 Electron 壳 103 · HTML/CSS 160 |

## 真实文件清单

只列磁盘上确实存在、且被某条命令真实执行过的文件。

| 文件 | 行数 | 由谁验证 |
|------|------|----------|
| `js/core/lot.js` | 231 | `test/lot.test.mjs`（9 条） |
| `js/core/solve.js` | 94 | `test/solve.test.mjs`（10 条） |
| `js/core/game.js` | 85 | `test/game.test.mjs`（11 条） |
| `js/core/make.js` | 218 | `test/make.test.mjs`（5 条）· `test/balance.mjs` |
| `js/core/library.js` | 99 | `test/library.test.mjs`（9 条） |
| `js/core/storage.js` | 116 | `test/storage.test.mjs`（7 条） |
| `js/core/rng.js` | 49 | 被 `make` / `library` 的确定性断言覆盖 |
| `js/view.js` | 311 | `tools/playtest.mjs` 的 `@pointer`（13 条） |
| `js/main.js` | 377 | `@boot` `@play` `@routes` `@save`（37 条） |
| `js/data/lots.js` | 71 | `test/library.test.mjs` 逐关复解 |
| `index.html` · `css/game.css` | 61 · 99 | 截图 + `@pointer` 控件存在性断言 |
| `server.cjs` | 69 | `tools/verify.sh` 用它起服务 |
| `electron/main.cjs` | 34 | `node --check`（Electron 未安装，未做启动验证） |
| `tools/bake.mjs` | 101 | 产出 `js/data/lots.js`，产物被 `library.test` 复证 |
| `tools/playtest.mjs` | 443 | `tools/verify.sh` |
| `tools/verify.sh` | 117 | 本地与 CI browser job |
| `tools/harness.mjs` | 34 | node 套件的输出格式 |
| `test/*.test.mjs` | 616 | `npm run unit` |
| `test/balance.mjs` · `test/fixture.mjs` | 58 · 56 | 手跑 `node test/balance.mjs`（难度台架）；fixture 被各套件共用 |
| `.github/workflows/ci.yml` · `pages.yml` | 40 · 43 | 推上 GitHub 后由 Actions 执行 |
| `README.md` · `DESIGN.md` | 120 · 233 | 池子表由 `library.js` 的 `stats()` 复现，见下 |

## 改动表：一开始错在哪 → 现在为什么对

新增仓库没有"旧代码"，但下面每一条都是**先按直觉写错过、被证据推翻后改对**的地方。
口径与精致化规范一致：说清为什么错。

| # | 错误的做法 | 为什么错 | 现在的做法 | 证据 |
|---|------------|----------|------------|------|
| 1 | 胜利判定 = 主角车前方车道清空 | 那只是"还差一次拖动"。把 5 格拖动记成 0 步，`par` 与任何印刷卡片都不可比 | `solved` = 车已开进闸门（`pos[hero]+len[hero] >= w`），与 `exitBlocked` 分成两个谓词 | `js/core/lot.js:151,167`；`test/lot.test.mjs` "a clear lane is not an escaped hero" |
| 2 | 改完胜利规则只改代码 | `js/data/lots.js` 里印着的 64 个 `par` 全部过期，游戏会安静地变简单一整档 | 关卡进池条件是"从序列化后的 spec 复解出同一个数字" | `test/library.test.mjs` 曾一次列出 64 关 `claims N, search says N+1`；修法是重烤 |
| 3 | 随机撒车 + 过滤掉无解的 | 每档约 4 万个样本里**没有一个**摸到阶梯顶端，且数千个无解。难解堵车不是随机的，是链式互相钉住 | 从主角车开始一次加一辆，每加一辆重测，**只有严格变大才留下** | `js/core/make.js:114`；`test/balance.mjs` |
| 4 | 生长目标打在难度区间的中点 | 一超界就停 ⇒ 每档全部堆在下界，台架打出 top band = `19 19 19`，四个关卡穿一件衣服 | 目标取区间**上界**；并加 `patience/debt/saved` 回滚，允许先摆平台车再由后面的车偿清 | `js/core/make.js:116,132`；`test/make.test.mjs` "the ladder is a ladder" |
| 5 | 浏览器里点"换一辆车"时现场生成 | 实测单关最长 18.2 秒、接受率 12/40。无进度条的几十秒冻结不是产品 | 生成只在构建期跑；`js/core/make.js` 没有被任何 shipped 代码 import，运行时只查表 | DESIGN.md 第 3.3 节实测表；`js/core/library.js` 顶部说明 |
| 6 | 台架断言"点一次提示就记一次提示" | 提示数不在点击时结算，而在通关时随成绩一起入账（否则中途放弃会留下永久提示记录）。**代码是对的，测试是错的** | 断言改成"完成时结算"，并补一条"用提示打平不算完美" | `js/core/storage.js:103`；`test/storage.test.mjs` "a par matched with help is a solve, not a perfect" |
| 7 | `store.markDaily` 定义了但没人调 | 每日关卡的完成状态永远写不进存档 —— 幽灵功能 | `resolve()` 返回 `day`，`finish()` 真实调用；货架显示"已通过" | `js/main.js:57,200`；`@save` 断言 |
| 8 | `exportText` / `importText` 留在仓库里 | 没有任何 UI 接线的存档读写函数，是"文件存在但功能不存在" | 删掉；把唯一的破坏性操作换成真接线的"清空存档"，并且二次确认 | `js/core/storage.js:108`；`js/main.js:307`；`@save` 断言 |
| 9 | 在 `visibilitychange` 上暂停 rAF（常规省电写法） | headless Chrome 把自己报成 hidden，通关动画与胜利卡片永不触发，浏览器测试永远看不到通关 | 显式不接该事件，并在代码里写明原因 | `js/main.js:333` |
| 10 | 把合法性夹紧扣给视图（手指拖到哪算哪） | 规则会出现两套：测试走 `commit()`、真手走 `view`，从此互不证明 | 视图只做装饰性夹紧（只会少报），`game.slide` 是唯一合法性来源 | `js/view.js:106`；`js/core/game.js:41`；`@pointer` 的八倍过拉断言 |
| 11 | 页面内注入 JS 就算"测过交互" | 能证明 `commit()` 正确，证明不了**手指点得着车** | `@pointer` 跑在 Node 侧，坐标取自 `gridlock.carPoint(i)`，逐条 dispatch 真实 `Input.dispatchMouseEvent` | `tools/playtest.mjs` pointer 段 |
| 12 | 用 Playwright/Puppeteer 做台架 | 要进 Pages CI 的仓库，多一个依赖多一条供应链；本地装过才知道 CI 环境不同 | 零依赖：Node 21+ 的全局 `fetch` + `WebSocket` 直讲 CDP | `package.json` 的 `dependencies` / `devDependencies` 均为 `{}` |
| 13 | `JSON.parse` 整行 console 输出 | headless Chrome 会在同一行后追加别的 console 文本，直接 parse 是随机失败 | 花括号计数截取 | `tools/verify.sh` |
| 14 | 靠 `difficulty: 'hard'` 字符串标难度 | 难度成为不可证伪的意见，提示功能只能靠启发式猜 | 难度 = BFS 最短路径长度；提示 = 从当前站位出发的最短路线第一步 | `js/core/solve.js:12`；`js/core/game.js:70`；`test/solve.test.mjs` 穷举证明无更短路线 |
| 15 | favicon 404 留在 console 里 | 台架有"console 必须干净"的断言，噪音会掩盖真错误 | `<link rel="icon" href="data:,">`，不加任何资产 | `index.html`；`@boot` |
| 16 | README 的池子表手抄"中位局面数" | 抄成了按步数排序后中间那一行的状态数，不是状态数的中位 —— 四行全错，且没有任何测试能发现（文档不是代码）。`lane` 一行错了 1743 | 中位数收进 `js/core/library.js` 的 `stats()`，表里的数字改为从 `node -e ... stats()` 的输出抄；并断言每档中位落在自己的区间内 | `js/core/library.js:76`；`test/library.test.mjs` "the pool summary the docs are copied from" |
| 17 | DESIGN.md 初稿写"双击 `index.html` 也能玩，只是不记事" | 从 `storage.js` 有 try/catch 推出来的乐观结论，没人真试过 | 实测：headless Chrome 打开 `file:///.../index.html` 后 `window.gridlock` 是 `undefined`，控制台报 `<script type="module">` 被 CORS 挡掉。文档改为明说双击玩不了、本地必须 `node server.cjs`；try/catch 的理由改成"存储被拒的场合"（无痕、嵌入式 webview） | DESIGN.md 第 6 节；`README.md:25` |
| 18 | `playtest.mjs` 导航之后 `sleep(1800)` | 把台架指向线上时三条断言红、canvas 停在未样式的 300×150，看起来像部署坏了，实际只是 Pages 的模块图比 localhost 慢 —— 计时器把环境问题伪装成产品故障 | `waitShell()` 轮询 `window.gridlock.state.id`（`SHELL_TIMEOUT` 默认 30s），本地仍然秒过；同一套断言本地与线上都绿 | `tools/playtest.mjs:98`；DESIGN.md 第 7.4 节 |
| 19 | 以为 `configure-pages` 会把 Pages 打开 | 全新仓库没有 Pages 站点可附着，第一次 deploy 直接红在 `Run actions/configure-pages@v5` | 用 PAT `POST /repos/.../pages {"build_type":"workflow"}` 开一次（201），再推一个空提交重触发。**Actions 的写接口在这个 token 上仍然 404，所以重触发只能靠 push** | 首次 run `failure` / 第二次 `success`；提交 `ci: retrigger the Pages deploy…` |

## 构建验证结论

### 语法 + 单元（等价于 CI `unit` job）

```
$ npm test
> for f in js/*.js js/*/*.js server.cjs electron/main.cjs tools/*.mjs test/*.mjs; do node --check "$f" || exit 1; done && echo OK
OK
rows: 11 fail: 0     game
rows: 9  fail: 0     library
rows: 9  fail: 0     lot
rows: 5  fail: 0     make
rows: 10 fail: 0     solve
rows: 7  fail: 0     storage
```

右侧的套件名是我为可读加的标注；`npm run unit` 本身按文件名字序输出 `rows: N fail: 0`。
合计 **51 条断言，0 失败**。

### 浏览器（等价于 CI `browser` job）

```
$ bash tools/verify.sh
opened http://127.0.0.1:5180/
(no console output)
boot lot: kerb-01
=== @boot ===     rows: 7  fail: []
=== @play ===     rows: 10 fail: []
=== @routes ===   rows: 12 fail: []
=== @save ===     rows: 8  fail: []
=== @pointer ===  rows: 13 fail: []
=== console ===
(none)
=== ALL GREEN ===
```

（`verify.sh` 把 `=== @boot ===` 与它的 `rows:` 行分开输出，这里并为一流；内容未改。）
合计 **50 条断言，0 失败，console 无输出**。

### 线上部署（https://z-biz-game.github.io/z-biz-game-gridlock-cos/）

Pages 的 `Deploy to GitHub Pages` 与 `CI` 两条 workflow 均 `conclusion: success`。
线上不只看 HTTP 200 —— 同一个台架把 `BASE_URL` 指向线上地址重跑，**50 条断言全绿**：

```
$ BASE_URL=https://z-biz-game.github.io/z-biz-game-gridlock-cos/ node tools/playtest.mjs eval @boot
ok   the shell boots straight into a game
ok   the canvas has real pixels
ok   the lot was actually painted
ok   the shipped pool loaded
ok   every band reports a measured range
ok   the browser's own search agrees with the printed par
ok   the panel prints steps, par and the record
fail: []
```

`@play` 10 / `@routes` 12 / `@save` 8 / `@pointer` 13，fail 均为空 ——
包括用真实 `Input.dispatchMouseEvent` 在线上把一条认证最短路线拖完并通关。

### 交付物真实性（人眼核对过）

三张截图在真实 Chrome 里检查过，不是只看断言通过：

- `boot`：5×5 巷口关卡 `kerb-01`，面板四栏（步数 / 最少 / 最佳 / 局面）与货架的锁定格正常。
- `save`：6×6 路口每日关，13 步、11049 局面，toast「存档已清空」。
- `win`：`lane-04` 以 par=8 通关，★★★ 完美通行，「你的 8 步 · 搜索最少 8 步 · 提示 0」，
  「这是这一关的最好成绩」，顶栏「已通 1/64 · 完美 1」。

### 关卡数据

```
$ node tools/bake.mjs
wrote 64 lots (kerb:16 lane:16 junction:16 gridlock:16) -> js/data/lots.js
```

（约 6 分钟，产物 30,615 字节。）实测分布，可用一条命令复现：

```
$ node -e "import('./js/core/library.js').then(m => console.log(m.stats()))"
kerb      n=16 moves 4-5 med=4  | cars 5-7  | states 9/589/1192
lane      n=16 moves 8-12 med=9  | cars 9-10 | states 657/13198/61960
junction  n=16 moves 13-17 med=15 | cars 10-12 | states 1146/5380/30013
gridlock  n=16 moves 18-24 med=19 | cars 10-13 | states 344/7179/21771
```

| 档 | 步数 | 步数中位 | 车辆 | 局面数 最小/中位/最大 |
| --- | --- | --- | --- | --- |
| 巷口 kerb | 4–5 | 4 | 5–7 | 9 / 589 / 1192 |
| 单行 lane | 8–12 | 9 | 9–10 | 657 / 13198 / 61960 |
| 路口 junction | 13–17 | 15 | 10–12 | 1146 / 5380 / 30013 |
| 死锁 gridlock | 18–24 | 19 | 10–13 | 344 / 7179 / 21771 |

区间与 `js/data/lots.js` 里印着的 `TIERS_META` 一致，由 `test/library.test.mjs` 断言；
中位数那一列最初手抄错过（抄成了"按步数排序后取中间那一行"，不是状态数的中位），
所以现在把中位收进了 `library.js` 的 `stats()` 并加了断言，表里的数字改为从命令输出抄。

## 未实现清单（写清楚，不留空头承诺）

- **浏览器内生成关卡**：故意不做，理由与实测见 DESIGN.md 第 3.3 节。"换一辆车"是从烤好的池子里换一个种子取关。
- **成就 / 排行榜 / 云存档 / 分享战绩**：组织规范 E 组禁止。分享只有 `#/lot/<id>` 链接（同一关卡，不含分数）。
- **Electron 打包产物**：`electron/main.cjs` 存在且过 `node --check`，但仓库不装 electron，**没有跑过真实启动**。
- **26 步以上的关卡**：6×6 上实测不可达（不是搜索预算不够，是图没那么深）。
- **8×8 大棋盘 / 可旋转车辆**：前者会让 `par` 从证明值退化成估值，后者改变游戏规则。
- **通关动效以外的特效、音效、美术资产**：全仓库 0 个二进制资产文件。
- **移动端适配的手势冲突处理**：`touch-action` 与 `pointercancel` 已接，但**没有真机验证**。
- **每日关卡的难度控制**：`dailyLot` 从整个池子取，所以它可能落在最高档。"每日"只保证人人同题。
- **多语言**：UI 只有中文。
