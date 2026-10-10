# 死锁车库 - 交付报告

## 任务摘要

| 属性 | 内容 |
|------|------|
| **项目名称** | Gridlock |
| **App 名称** | 死锁车库 |
| **形态** | 浏览器原生（ES modules，零依赖）+ Electron 壳 + GitHub Pages |
| **仓库** | `z-biz-game/z-biz-game-gridlock-cos` |
| **线上** | https://z-biz-game.github.io/z-biz-game-gridlock-cos/ （Pages + CI 双绿；线上断言复跑见"构建验证结论"） |
| **分组** | E（益智解谜），无成就 / 无排行榜 / 无云存档 |
| **玩法概述** | Rush Hour：在网格停车场里拖动车辆，把橙色主角车开出右侧闸门 |
| **核心差异点** | 同一盘面**两个**"最少几步"（滑步 / 格步），各由两条独立算法量出、各有一个人手数得完的下界；关卡由构建期生长 + 复验，不是人手摆的 |
| **代码量** | 4,445 行（不含文档）：引擎 1,225 · 画面/外壳 742 · 关卡数据 74 · 测试与台架样本 1,255 · 构建/验证工具 877 · 服务与 Electron 壳 103 · HTML/CSS 169 |

## 真实文件清单

只列磁盘上确实存在、且被某条命令真实执行过的文件。

| 文件 | 行数 | 由谁验证 |
|------|------|----------|
| `js/core/lot.js` | 231 | `test/lot.test.mjs`（9 条） |
| `js/core/law.js` | 112 | `test/law.test.mjs`（7 条） |
| `js/core/solve.js` | 239 | `test/solve.test.mjs`（16 条） |
| `js/core/game.js` | 108 | `test/game.test.mjs`（16 条） |
| `js/core/make.js` | 237 | `test/make.test.mjs`（6 条）· `test/balance.mjs` |
| `js/core/library.js` | 112 | `test/library.test.mjs`（12 条） |
| `js/core/storage.js` | 137 | `test/storage.test.mjs`（9 条） |
| `js/core/rng.js` | 49 | 被 `make` / `library` 的确定性断言覆盖 |
| `js/view.js` | 311 | `tools/playtest.mjs` 的 `@pointer`（18 条） |
| `js/main.js` | 431 | `@boot` `@play` `@routes` `@save` `@law`（60 条） |
| `js/data/lots.js` | 74 | `test/library.test.mjs` 逐关复解 |
| `index.html` · `css/game.css` | 64 · 105 | 截图 + `@pointer` 控件存在性断言 |
| `server.cjs` | 69 | `tools/verify.sh` 用它起服务 |
| `electron/main.cjs` | 34 | `node --check`（Electron 未安装，未做启动验证） |
| `tools/bake.mjs` | 151 | 产出 `js/data/lots.js`，产物被 `library.test` 复证 |
| `tools/playtest.mjs` | 575 | `tools/verify.sh` |
| `tools/verify.sh` | 117 | 本地与 CI browser job |
| `tools/harness.mjs` | 34 | node 套件的输出格式 |
| `test/*.test.mjs` | 1,001 | `npm run unit` |
| `test/balance.mjs` · `test/scatter.mjs` · `test/fixture.mjs` | 67 · 123 · 64 | 手跑 `node test/balance.mjs`（生长侧难度台架）与 `npm run scatter`（随机撒车的反证，默认每档 1 万个）；fixture 被各套件共用 |
| `.github/workflows/ci.yml` · `pages.yml` | 40 · 43 | 推上 GitHub 后由 Actions 执行 |
| `README.md` · `DESIGN.md` | 170 · 356 | 池子表由 `library.js` 的 `stats()` 复现，见下 |

## 改动表：一开始错在哪 → 现在为什么对

新增仓库没有"旧代码"，但下面每一条都是**先按直觉写错过、被证据推翻后改对**的地方。
口径与精致化规范一致：说清为什么错。第 1–19 条来自首版交付，第 20–26 条来自"第二条计步口径"
这一轮扩展。

| # | 错误的做法 | 为什么错 | 现在的做法 | 证据 |
|---|------------|----------|------------|------|
| 1 | 胜利判定 = 主角车前方车道清空 | 那只是"还差一次拖动"。把 5 格拖动记成 0 步，`par` 与任何印刷卡片都不可比 | `solved` = 车已开进闸门（`pos[hero]+len[hero] >= w`），与 `exitBlocked` 分成两个谓词 | `js/core/lot.js:151,167`；`test/lot.test.mjs` "a clear lane is not an escaped hero" |
| 2 | 改完胜利规则只改代码 | `js/data/lots.js` 里印着的 64 个 `par` 全部过期，游戏会安静地变简单一整档 | 关卡进池条件是"从序列化后的 spec 复解出同一个数字" | `test/library.test.mjs` 曾一次列出 64 关 `claims N, search says N+1`；修法是重烤 |
| 3 | 随机撒车 + 过滤掉无解的 | 每档 1 万个样本：22%–47% 无解，有解那批**中位数 1 拖**，摸到自己带上界的只有 42/1/6/0 个（kerb/lane/junction/gridlock，顶层一万次里 0 个）。难解堵车不是随机的，是链式互相钉住 | 从主角车开始一次加一辆，每加一辆重测，**只有严格变大才留下** | `js/core/make.js:115`；`test/scatter.mjs`（撒的一侧）＋`test/balance.mjs`（生长的一侧） |
| 4 | 生长目标打在难度区间的中点 | 一超界就停 ⇒ 每档全部堆在下界，台架打出 top band = `19 19 19`，四个关卡穿一件衣服 | 目标取区间**上界**；并加 `patience/debt/saved` 回滚，允许先摆平台车再由后面的车偿清 | `js/core/make.js:117,133`；`test/make.test.mjs` "the ladder is a ladder" |
| 5 | 浏览器里点"换一辆车"时现场生成 | 实测单关最长 14.6 秒、接受率 12/40。无进度条的几十秒冻结不是产品 | 生成只在构建期跑；`js/core/make.js` 没有被任何 shipped 代码 import，运行时只查表 | DESIGN.md 第 3.3 节实测表；`js/core/library.js` 顶部说明 |
| 6 | 台架断言"点一次提示就记一次提示" | 提示数不在点击时结算，而在通关时随成绩一起入账（否则中途放弃会留下永久提示记录）。**代码是对的，测试是错的** | 断言改成"完成时结算"，并补一条"用提示打平不算完美" | `js/core/storage.js:124`；`test/storage.test.mjs` "a par matched with help is a solve, not a perfect" |
| 7 | `store.markDaily` 定义了但没人调 | 每日关卡的完成状态永远写不进存档 —— 幽灵功能 | `resolve()` 返回 `day`，`finish()` 真实调用；货架显示"已通过" | `js/main.js:69,227`；`@save` 断言 |
| 8 | `exportText` / `importText` 留在仓库里 | 没有任何 UI 接线的存档读写函数，是"文件存在但功能不存在" | 删掉；把唯一的破坏性操作换成真接线的"清空存档"，并且二次确认 | `js/core/storage.js:129`；`js/main.js:355`；`@save` 断言 |
| 9 | 在 `visibilitychange` 上暂停 rAF（常规省电写法） | headless Chrome 把自己报成 hidden，通关动画与胜利卡片永不触发，浏览器测试永远看不到通关 | 显式不接该事件，并在代码里写明原因 | `js/main.js:373` |
| 10 | 把合法性夹紧扣给视图（手指拖到哪算哪） | 规则会出现两套：测试走 `commit()`、真手走 `view`，从此互不证明 | 视图只做装饰性夹紧（只会少报），`game.slide` 是唯一合法性来源 | `js/view.js:113`；`js/core/game.js:51`；`@pointer` 的八倍过拉断言 |
| 11 | 页面内注入 JS 就算"测过交互" | 能证明 `commit()` 正确，证明不了**手指点得着车** | `@pointer` 跑在 Node 侧，坐标取自 `gridlock.carPoint(i)`，逐条 dispatch 真实 `Input.dispatchMouseEvent` | `tools/playtest.mjs` pointer 段 |
| 12 | 用 Playwright/Puppeteer 做台架 | 要进 Pages CI 的仓库，多一个依赖多一条供应链；本地装过才知道 CI 环境不同 | 零依赖：Node 21+ 的全局 `fetch` + `WebSocket` 直讲 CDP | `package.json` 的 `dependencies` / `devDependencies` 均为 `{}` |
| 13 | `JSON.parse` 整行 console 输出 | headless Chrome 会在同一行后追加别的 console 文本，直接 parse 是随机失败 | 花括号计数截取 | `tools/verify.sh` |
| 14 | 靠 `difficulty: 'hard'` 字符串标难度 | 难度成为不可证伪的意见，提示功能只能靠启发式猜 | 难度 = BFS 最短路径长度；提示 = 从当前站位出发的最短路线第一步 | `js/core/solve.js:20`；`js/core/game.js:85`；`test/solve.test.mjs` 穷举证明无更短路线 |
| 15 | favicon 404 留在 console 里 | 台架有"console 必须干净"的断言，噪音会掩盖真错误 | `<link rel="icon" href="data:,">`，不加任何资产 | `index.html`；`@boot` |
| 16 | README 的池子表手抄"中位局面数" | 抄成了按步数排序后中间那一行的状态数，不是状态数的中位 —— 四行全错，且没有任何测试能发现（文档不是代码）。`lane` 一行错了 1743 | 中位数收进 `js/core/library.js` 的 `stats()`，表里的数字改为从 `node -e ... stats()` 的输出抄；并断言每档中位落在自己的区间内 | `js/core/library.js:74,79`；`test/library.test.mjs:122` |
| 17 | DESIGN.md 初稿写"双击 `index.html` 也能玩，只是不记事" | 从 `storage.js` 有 try/catch 推出来的乐观结论，没人真试过 | 实测：headless Chrome 打开 `file:///.../index.html` 后 `window.gridlock` 是 `undefined`，控制台报 `<script type="module">` 被 CORS 挡掉。文档改为明说双击玩不了、本地必须 `node server.cjs`；try/catch 的理由改成"存储被拒的场合"（无痕、嵌入式 webview） | DESIGN.md 第 6 节；`README.md` 的"跑起来" |
| 18 | `playtest.mjs` 导航之后 `sleep(1800)` | 把台架指向线上时三条断言红、canvas 停在未样式的 300×150，看起来像部署坏了，实际只是 Pages 的模块图比 localhost 慢 —— 计时器把环境问题伪装成产品故障 | `waitShell()` 轮询 `window.gridlock.state.id`（`SHELL_TIMEOUT` 默认 30s），本地仍然秒过；同一套断言本地与线上都绿 | `tools/playtest.mjs:98`；DESIGN.md 第 7.4 节 |
| 19 | 以为 `configure-pages` 会把 Pages 打开 | 全新仓库没有 Pages 站点可附着，第一次 deploy 直接红在 `Run actions/configure-pages@v5` | 用 PAT `POST /repos/.../pages {"build_type":"workflow"}` 开一次（201），再推一个空提交重触发。**Actions 的写接口在这个 token 上仍然 404，所以重触发只能靠 push** | 首次 run `failure` / 第二次 `success`；提交 `ci: retrigger the Pages deploy…` |
| 20 | 把第二个步数当成第一个的倍数（"格步 = 滑步 × 平均行程"推导出来即可） | 推导出来的数不是事实：同一档里比值从 1.00 跨到 2.5，入库的 64 关里 3 关两数完全相同、`lane-06` 是 1 : 2.75 | 第二个数自己搜一遍，而且用**两条不同算法**搜（单格边 BFS + 拖动图加权 Dijkstra），不一致就 bake 失败 | `js/core/make.js:177,179`；`test/library.test.mjs:23,61` |
| 21 | 用 `js/core/law.js` 的 `eachStep` 去"证明"格步 par 最优 | 被测代码给自己出题再给自己打分：`eachStep` 写错，穷举与 BFS 会一起错 | 格步的穷举从 `js/core/lot.js:143` 的 `moves()` 现场过滤 ±1 得到，与被测搜索器无共享路径 | `test/solve.test.mjs:70`；`test/fixture.mjs` 的 CHAIN par=3 / parCell=6 手算 |
| 22 | 存档测试写成"14 格步 < parCell 12 也算完美" | 一次跑赢认证 par 的通关不存在，这条断言在测一个不可能世界，绿了也不说明任何事 | 换成两本账各自打平各自 par 的真实组合，并断言"打平滑步对格步一字不提" | `test/storage.test.mjs:32` "the two laws are graded against their own pars" |
| 23 | 见证下界在"主角已经在闸门外"的板上返回 `drag: 1` | 一个会说谎的下界：这一关的 par 实测是 0，地板比天花板还高 | `heroCells` 取 `Math.max(0, …)`，`drag` 只在真的还剩路时 +1；CLEAR 关两数归零 | `js/core/law.js:93,109`；`test/law.test.mjs:98` |
| 24 | `spent(game, key)` / `parOf(lot, key)` 留默认值就好 | 有默认值＝一个拼错的名字（`"triples"`）会安静退回滑步，屏幕上却写着"格步" | 两个函数进门先过 `lawOf`，未知口径抛错；存档那侧同样拒写未知值 | `js/core/law.js:25,65,70`；`test/law.test.mjs:49`；`@law` 末条断言 |
| 25 | `@pointer` 用 3 倍过拉"顺手"拖完全程，且只断言拖动次数 | **验收自身的漏洞**：过拉把车停在路线之外的格子上，第三拖起板子已经偏离认证路线，而旧断言从不看落点 —— 那一段是靠运气绿的 | 默认精确拖动，过拉单独一条断言；每拖一步比对 `pos[car]`，两个账本分别核对总数 | `tools/playtest.mjs` pointer 段 `and every car lands exactly where the route puts it` |
| 26 | 文档写"四档难度带互不重叠" | 只对滑步成立。格步带是重叠的（lane 上界 22 撞 junction 下界 22，gridlock 下界 26 落在 junction 的 22–42 内），因为生成器只按滑步停机 | 池子表并排印两个带，并写明"格步带重叠"是没做、也没声称做了的事 | `js/data/lots.js:8` 的 `TIERS_META`；`test/library.test.mjs:101`；README 池子表 |
| 27 | `js/core/make.js` 头上写着"随机撒车摸不到阶梯顶端，`test/balance.mjs` 就是证据" | 那句理由没有任何台架支撑：balance.mjs 跑的是**生长器**，它压根不撒车；而撒车这件事本身是可以量的，量了就不能再靠回忆写。写下来还是**错的**——10k/档实测 kerb 有 42 个、junction 有 6 个摸到自己的带上界 | 新增 `test/scatter.mjs`（`npm run scatter`，默认每档 1 万个、4 分 21 秒、种子固定），把那句话换成台架打印出来的三条：中位 1 拖、摸到带上界 10⁻⁴ 量级、顶层 0/10000，外加 22%–47% 无解 | `test/scatter.mjs`；`js/core/make.js:7-10`；DESIGN.md 第 3 节的表 |

## 构建验证结论

### 语法 + 单元（等价于 CI `unit` job）

```
$ npm test
> for f in js/*.js js/*/*.js server.cjs electron/main.cjs tools/*.mjs test/*.mjs; do node --check "$f" || exit 1; done && echo OK
OK
rows: 16 fail: 0     game
rows:  7 fail: 0     law
rows: 12 fail: 0     library
rows:  9 fail: 0     lot
rows:  6 fail: 0     make
rows: 16 fail: 0     solve
rows:  9 fail: 0     storage
```

右侧的套件名是我为可读加的标注；`npm run unit` 本身按文件名字序输出 `rows: N fail: 0`。
合计 **75 条断言，0 失败，5.8 秒**（其中 `library.test.mjs` 逐关复解占 5.5 秒，其余六个套件
各自都在 0.2 秒内）。

### 浏览器（等价于 CI `browser` job）

```
$ bash tools/verify.sh
opened http://127.0.0.1:5180/
(no console output)
boot lot: kerb-01
=== @boot ===     rows:  9 fail: []
=== @play ===     rows: 10 fail: []
=== @routes ===   rows: 12 fail: []
=== @save ===     rows:  8 fail: []
=== @law ===      rows: 21 fail: []
=== @pointer ===  rows: 18 fail: []
=== console ===
(none)
=== ALL GREEN ===
```

（`verify.sh` 把 `=== @boot ===` 与它的 `rows:` 行分开输出，这里并为一流；内容未改。）
合计 **78 条断言，0 失败，console 无输出**。

线上不只看 HTTP 200 —— 同一个台架把 `BASE_URL` 指向线上地址重跑，全部断言必须与本地同绿。
本轮的线上复跑（`BASE_URL=https://z-biz-game.github.io/z-biz-game-gridlock-cos/ SKIP_UNIT=1 bash tools/verify.sh`）：
`@boot` 9 / `@play` 10 / `@routes` 12 / `@save` 8 / `@law` 21 / `@pointer` 18，合计 **78 条、0 失败、
console 无输出**，六段条数与上面本地那一趟逐段相同。CI 侧同一提交（`d9e2e07`）：`unit` + `browser`
在 run `36518568457`、Pages `build` + `deploy` 在 run `36518568214`，四个 job 全 `success`。
线上还额外确认了 `js/core/law.js` 返回 200（新模块真的进了产物），以及 `index.html` 里印着"格步"。

（首版交付时这段只有 50 条断言，那一轮的代码与本轮不同，所以那个 50 只算历史证据。）

### 交付物真实性（人眼核对过）

三张 `node tools/playtest.mjs shot <path>` 抓下来的真实 Chrome 帧，逐张看过像素：

- `boot`：5×5 巷口 `kerb-01`，面板四栏是 `步数 0／0`、`最少 4／4`（下面一行小字
  "两条搜索路都对上"）、`最佳·滑步 —`（"你的纪录"）、`局面 48`（"通道逼出 2／2"）；
  口径两颗芯片在面板里，滑步高亮、格步灰；货架上未解锁的关卡号是灰的。
- `law`：`gridlock-16` 的通关卡，★★★ 完美通行，卡片写"你的 24 滑步 · 滑步搜索最少 24 ·
  提示 0"，第二行"同一路线的另一本账：50 格步 / 最少 47"，第三行"通道逼出 6"。
  面板"步数 24／50"、"最少 24／47"、"局面 14917 · 通道逼出 3／6"。
  这一帧就是第 2.1 节那条区分的实物证据：拖步最优路线记的是 50 格，而格步 par 是 47。
- `pointer`：真实鼠标那一趟的**起手帧**（`kerb-01`，步数 0／0，顶栏 已通 2/64 ·
  滑步完美 2 · 格步完美 2）。这一趟的通关与逐辆落点由断言核对，不在这张图里。

### 关卡数据

```
$ node tools/bake.mjs
wrote 64 lots (kerb:16 lane:16 junction:16 gridlock:16) -> js/data/lots.js
certified position by position: 61/64 rows｜格步/滑步 ratio med 1.72 min 1.00 max 2.75
slack over the witness: drag med 9 max 21｜cell med 15 max 41
```

5 分 01 秒（墙钟），产物 38,659 字节。实测分布，可用一条命令复现：

```
$ node -e "import('./js/core/library.js').then(m => console.log(m.stats()))"
kerb      n=16 moves 4-5 med=4  cells 4-10 med=7  cars 5-7  | states 9/589/1192     tabled 16
lane      n=16 moves 8-12 med=9 cells 11-22 med=17 cars 9-10 | states 657/13198/61960 tabled 13
junction  n=16 moves 13-17 med=15 cells 22-42 med=28 cars 10-12 | states 1146/5380/30013 tabled 16
gridlock  n=16 moves 18-24 med=19 cells 26-47 med=32 cars 10-13 | states 344/7179/21771 tabled 16
```

| 档 | 滑步 | 滑步中位 | 格步 | 格步中位 | 车辆 | 局面数 最小/中位/最大 |
| --- | --- | --- | --- | --- | --- | --- |
| 巷口 kerb | 4–5 | 4 | 4–10 | 7 | 5–7 | 9 / 589 / 1192 |
| 单行 lane | 8–12 | 9 | 11–22 | 17 | 9–10 | 657 / 13198 / 61960 |
| 路口 junction | 13–17 | 15 | 22–42 | 28 | 10–12 | 1146 / 5380 / 30013 |
| 死锁 gridlock | 18–24 | 19 | 26–47 | 32 | 10–13 | 344 / 7179 / 21771 |

区间与 `js/data/lots.js` 里印着的 `TIERS_META` 一致，由 `test/library.test.mjs:101` 断言；
中位数那一列最初手抄错过（抄成了"按步数排序后取中间那一行"，不是状态数的中位），
所以现在把中位收进了 `library.js` 的 `stats()` 并加了断言，表里的数字改为从命令输出抄。
**两列步数的性质不同**：滑步带互不重叠是生成器的停机条件，格步带重叠是观测事实（第 26 条）。

### 生成器体检（`node test/balance.mjs`，每档 40 个种子）

| 档 | 接受率 | 滑步 最小/中位/最大 | 格步 最小/中位/最大 | 比值 | 中位/最大耗时 |
| --- | --- | --- | --- | --- | --- |
| kerb | 40/40 | 4/4/6 | 5/7/10 | 1.00/1.50/2.25 | 5ms / 38ms |
| lane | 25/40 | 8/9/12 | 12/16/23 | 1.44/1.88/2.56 | 204ms / 3.4s |
| junction | 19/40 | 13/15/17 | 21/28/35 | 1.38/1.88/2.36 | 636ms / 4.8s |
| gridlock | 12/40 | 18/19/24 | 25/34/48 | 1.39/1.62/2.53 | 2.16s / 14.6s |

同一条命令连跑三次：四档的步骤／格步／比值三列**逐格相同**（种子确定），
只有耗时在 ±2% 内漂移，所以上表取最近一次（整轮墙钟 2m56s）。

### 反证台架（`npm run scatter`，每档 1 万个随机摆放）

这一张表是本轮新加的，因为原来 `js/core/make.js` 头上写着一句没有台架支撑的话
（"每档约 4 万个里**没有一个**摸到阶梯顶端"）。跑出来发现那句话是错的，于是改成量出来的：

| 档 | 滑步带 | 撒不满车预算 | 无解 | 有解那批的拖数 最小/中位/最大 | 摸到自己带上界 |
| --- | --- | --- | --- | --- | --- |
| kerb | 4–6 | 0/10000 | 2223/10000 | 0/1/9 | 42/10000 |
| lane | 8–12 | 0/10000 | 2174/10000 | 0/1/12 | 1/10000 |
| junction | 13–17 | 410/10000 | 4001/10000 | 0/1/19 | 6/10000 |
| gridlock | 18–24 | 1473/10000 | 4731/10000 | 0/1/22 | **0/10000** |

整轮墙钟 4 分 21 秒；种子固定，默认值就是 1 万，所以这条命令复跑出来的表与上表逐格相同
（本轮实测：改默认值前后各跑一次，四行完全一致）。"最小 0"是真的：主角车可能直接撒在闸门
上。结论被收窄成三条可以复核的话：**中位数 1 拖**、摸到带上界的概率 10⁻⁴ 量级、顶层一万次
里 0 次，且 22%–47% 压根无解。原来那句"没有一个"在 kerb 与 junction 上都不成立。

## 未实现清单（写清楚，不留空头承诺）

- **浏览器内生成关卡**：故意不做，理由与实测见 DESIGN.md 第 3.3 节。"换一辆车"是从烤好的池子里换一个种子取关。
- **成就 / 排行榜 / 云存档 / 分享战绩**：组织规范 E 组禁止。分享只有 `#/lot/<id>` 链接（同一关卡，不含分数）。
- **Electron 打包产物**：`electron/main.cjs` 存在且过 `node --check`，但仓库不装 electron，**没有跑过真实启动**。
- **26 滑步以上的关卡**：6×6 上实测不可达（不是搜索预算不够，是图没那么深）。同一档入库关卡的
  **格步**实测 26–47，所以任何"多少步"的说法不带口径就是废话。
- **按格步重新排难度带 / "格步模式"**：没做。生成器只按滑步停机，所以格步带重叠（第 26 条）；
  做它需要另设停机条件、另烤一次池子、另出一批实测。
- **8×8 大棋盘 / 可旋转车辆**：前者会让两个 `par` 从证明值退化成估值，后者改变游戏规则。
- **通关动效以外的特效、音效、美术资产**：全仓库 0 个二进制资产文件。
- **移动端适配的手势冲突处理**：`touch-action` 与 `pointercancel` 已接，但**没有真机验证**。
- **每日关卡的难度控制**：`dailyLot` 从整个池子取，所以它可能落在最高档。"每日"只保证人人同题。
- **多语言**：UI 只有中文。
