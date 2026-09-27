# 设计文档 · Gridlock

面向维护者的技术说明：为什么这样实现、哪些约束不能破坏、踩过的坑写在哪。
玩法规则与关卡清单见 [README.md](README.md)。

---

## 1. 核心决策：难度是量出来的，不是标出来的

绝大多数 Rush Hour 类实现把难度写成一个字符串常量（`difficulty: 'hard'`），
然后靠人觉得像不像。本作把这条换成可证伪的：**每一关的 `par` 是 BFS 在"一次拖动 = 一步"的移动图上跑出来的最短路径长度**。

三件事因此同时成立：

1. 屏幕上"最少 N 步"是与商场卡片同口径的数字，不是营销词；
2. 提示功能可以给出资深玩家也无法反驳的答案（`js/core/game.js:70` `hint`），
   因为它是"从你当前站位出发的最短路线的第一步"，而不是启发式猜测；
3. 生成器有了**停机条件**（`js/core/make.js:135`）——加一辆车，量一次，只有数字真变大才算数。

### 1.1 为什么 BFS 在这里是可行的

图的规模由"每辆车沿轴的位置"决定：一个状态就是 `n` 个小整数，
`js/core/lot.js:54` 的 `encode` 把它压成一字符一辆车的字符串当 key。
6×6 上 13 辆车的实测状态数在几百到六万之间（README 的池子表里有实测的 `states` 列），
全搜索在 `js/core/solve.js:13` 的 `limit = 300000` 内结束，中位数耗时毫秒级。

**这个前提会失效**：一旦把棋盘放大到 8×8、车辆上限放到 20+，
状态数按指数掉，`solve` 会开始返回 `truncated: true`。所以 `js/core/make.js:197` 的 `TIERS`
里 6×6 不是审美选择而是搜索预算的边界。想放大棋盘，先想清楚 `par` 还要不要是**证明值**——
如果接受启发式估值，整套设计就要重写，不是调参。

### 1.2 移动图是无向的

任意一次拖动都可逆，所以从起点做单向 BFS 就够了，不需要双向搜索。
`test/solve.test.mjs` 里对 CHAIN 用穷举证明了不存在 1–2 步路线，
那一条断言是"无向 + 一步一格算一次"这套口径的守门人：谁改了 `reach` 或 `eachMove` 的语义，它会先响。

---

## 2. 全局约定（破坏即出 bug）

### 2.1 `solved` 不等于"路通了"

`js/core/lot.js:151` 有两个长得很像的谓词，它们是两件事：

```js
exitBlocked(comp, pos)   // 车头右边到闸门之间有没有东西
solved(comp, pos)        // pos[hero] + len[hero] >= w，即车已经开进闸门
```

**赢的是后者。** 中间那条留白是经典规则：清空车道只是"还差一次拖动"，不是通关。
这条改动会把每一关的 `par` 整体推高 1（把车开出去本身要一步），
所以改这个谓词之后**必须重烤** `node tools/bake.mjs`，否则 `js/data/lots.js` 里印着的数字全是错的。

这条不是理论风险：上一次改完没重烤，`test/library.test.mjs` 把 64 个关卡全列成
"claims N, search says N+1"。那个测试就是干这个的。

### 2.2 一次拖动 = 一步，无论拖几格

`js/core/game.js:37` 的 `slide` 只在 `d !== 0` 时 `game.moves++`。
把拖动做成"每过一格算一步"能更简单地骗过视觉，但那样 `par` 就不再是任何一本卡片上的数，
第 1 节的全部理由同时作废。`test/game.test.mjs` 里 `slide(g,0,9)` 那条断言钉住这个口径。

### 2.3 谁负责夹紧

视图和规则各夹一次，语义不同，别混：

- `js/view.js:106` 是**装饰性**的：跟手时让车贴到邻车保险杠就停，只会**少报**可行距离。
- `js/core/game.js:41` 是**合法性**的：松手时把玩家要求的格数夹进 `[-back, fwd]`。

所以拖过头不是 bug，是被支持的输入（八倍过拉仍然通关，见 `tools/playtest.mjs` 的 pointer 段）。
如果把夹紧扣到视图里、或者在 `up()` 里自己判合法性，就会造出两套规则，
测试层（走 `commit`）和真实手（走 `view`）从此行为不同。

### 2.4 三层不许互相串

| 层 | 文件 | 可以知道 | 不许知道 |
| --- | --- | --- | --- |
| 规则 | `js/core/*` | 网格、状态、搜索、存档结构 | DOM、canvas、`window` |
| 画面 | `js/view.js` | 像素、指针、手势 | 任何规则判定 |
| 外壳 | `js/main.js` | 路由、DOM、计时、`window.gridlock` | 游戏规则细节 |

这不是洁癖，是因为需要两套平行的测试：`node --test test/*.test.mjs` 能直接 import 核心，
而 `tools/playtest.mjs` 能从真实鼠标事件驱动同一个 `commit()`。
任何一处让 `js/core` 摸到 DOM，第一套立刻瘫掉。

### 2.5 搜索里不许分配

`compile()` 把 spec 预转成 `Uint8Array` 字段（`js/core/lot.js:17`），
`occupancy(comp, pos, into)` 的第三参数让调用方复用一个缓冲，`reach` 靠"擦掉这辆车再画回去"来探路
（`js/core/lot.js:119` 和 `:129`，**这两行必须成对**，少一行还原就是全错的可达距离）。
40 万状态的搜索如果每状态新建一个数组，烤一次池子从分钟级掉到小时级。

---

## 3. 生成器：为什么是"生长"而不是"撒"

随机摆放再加过滤，在这类游戏上不成立。`test/balance.mjs` 是证据：
每档试约 4 万个，数千个无解，**没有一个**摸到阶梯顶端。
原因是难解的堵车不是随机的，而是一条"这辆车钉住下一辆"的链条。

所以 `js/core/make.js:114` 的 `grow` 反过来做：从只有一辆主角车开始，一次加一辆，
每加一辆就重新量一次，**只有量出来的最短步数严格变大才留下**。
这一条规则同时买了三件事：关卡必然有解（每步都验过）、车上没有一件道具是白摆的、难度是可以停的。

### 3.1 patience / debt / saved：三个变量是一件事

只按"严格变大才留"，生长很快卡住：现实中有效的车常常**先**摆出一个平台，
**后**一辆车才把数字抬起来。`js/core/make.js:132` 因此记一个 checkpoint：

- `debt` 是连续吞下的平台车数，上限是 `tier.patience`；
- 超支时回滚到 `saved`（最后一次每辆车都挣到了位置的那个板）。

**没有回滚，板子会一路堆成家具展，车预算先耗尽、难度还没到。** 这是实测过的失败模式。

### 3.2 目标是上界，不是区间内的一个点

生长一量到超界就停，所以往中间打会**全部堆在下界**。
balance 台架曾因此给 top band 打出 `19 19 19`——四个关卡穿一件衣服。
现在 `const target = tier.max`（`js/core/make.js:116`），
`test/make.test.mjs` 里"梯子必须是梯子"断言各档区间互不重叠。

### 3.3 为什么生成不在浏览器里跑

实测（`node test/balance.mjs`，赢规则改后，每档 40 个样本）：

| 档 | 区间 | 接受率 | 步数 最小/中位/最大 | 车辆 | 中位/最大耗时 |
| --- | --- | --- | --- | --- | --- |
| kerb | 4–6 | 40/40 | 4/4/6 | 4/7 | 6ms / 47ms |
| lane | 8–12 | 25/40 | 8/9/12 | 9/10 | 248ms / 4.9s |
| junction | 13–17 | 19/40 | 13/15/17 | 11/12 | 723ms / 6.6s |
| gridlock | 18–24 | 12/40 | 18/19/24 | 12/13 | 2.6s / **18.2s** |

在 tap 上做一次无限期、无进度条、手机上可能几十秒的搜索，不是产品。
所以生成只在构建期跑，`js/core/make.js` 里没有任何一行被 shipped 代码 import
（`js/main.js` 用的是 `js/core/library.js`，那只是一张查表）。

---

## 4. 烤池子与复证

`tools/bake.mjs` → `js/data/lots.js`（是 JS 模块而不是 JSON：`export const LOTS` 在模块加载期就是数据，
不需要 `await fetch()`，于是 `library.js` 顶层可以直接把 64 关编译好，Pages 上也少一次请求与一层错误处理）。

关键约束在 `js/core/library.js:17`：`compile(row.spec)` 从**序列化之后**的 spec 重新编译，
`test/library.test.mjs` 再对它跑一次 `solve`，断言复现印着的 `par`。
所以一个关卡进池子的条件是"从 JSON 里读回来还是这么难"，而不是"生成器当时说这么难"。
序列化里丢了一辆车、`exitRow` 写歪一格、赢规则改了 —— 都表现为一次测试失败，而不是线上一个悄悄变简单的关卡。

重烤成本约 6 分钟（64 关）。改完规则或 `TIERS` 就要重烤，
`js/data/lots.js` 的 diff 里 `TIERS_META` 的区间应当仍然落在 `make.js` 的 `TIERS` 之内。

---

## 5. 确定性

`js/core/rng.js`：FNV-1a 的 `hashSeed` + `mulberry32`。用途不只是"随机但要可复现"：

- 每日关卡 = `dailyLot(todayKey())`，所有人同题，靠的是池子固定 + 种子只决定下标；
- `#/random/lane/4kq2` 这类链接可分享，收的人拿到同一个堵车；
- 测试可以钉死种子（`test/make.test.mjs` 用 `face(lot)` 比较序列化结果）。

`js/main.js:225` 有个由此而来的细节：裸 `#/random/lane` 每次访问都是不同关卡且不可复现，
所以 token 一旦生成就 `location.replace` 写回地址栏。

---

## 6. 存档

一个 localStorage key（`gridlock.save.v1`），版本化形状，`js/core/storage.js:22` 读取时逐字段兜底。

- **`window.localStorage` 是会抛异常的**，不是返回 null：无痕窗口、被挡掉的第三方存储、嵌进
  webview 的场合都会。所有访问被 try/catch 包住，失败就退化成内存会话（关掉页面不记事）。
  这一条**不是**为了让 `file://` 能玩 —— 双击 `index.html` 是玩不了的，实测报
  `Access to script at 'file:///.../js/main.js' from origin 'null' has been blocked by CORS policy`，
  `<script type="module">` 在 `file://` 下根本加载不了，`window.gridlock` 是 `undefined`。
  要本地玩就用 `node server.cjs`（这就是 `server.cjs` 存在的理由）。
- **`best` 只会变小**（`js/core/storage.js:95`），`unlock` 只会变大（`:71`）。
  两条都是单向的：重玩一个早期关卡不该藏掉后面的关卡，也不该把纪录改差。
- `perfect` 的定义是"打平搜索值"，是事实不是感觉；但**用提示打平不算完美**（`moves <= par && !hints`，`:103`）。
- 清空存档是全游戏唯一的破坏性操作，所以做成两次点击（`js/main.js:307`）。

---

## 7. 验证台架

### 7.1 为什么是 CDP 而不是 Playwright

`package.json` 依赖为空是刻意的：这是要进 Pages CI 的仓库，多一个依赖就多一条供应链。
Node 21+ 自带全局 `fetch` 与 `WebSocket`，`tools/playtest.mjs` 用它们直接讲 CDP
（`open|nav|eval|shot|logs`）就够覆盖注入输入、读运行时对象、截图、抓 console。

### 7.2 `@pointer` 为什么必须存在

页面内注入的断言可以证明 `commit()` 正确，但证明不了**手指点得着车**。
pointer 段是**跑在 Node 侧**的：`base64` 之后逐条 dispatch `Input.dispatchMouseEvent` /
`Input.dispatchKeyEvent`，坐标来自 `window.gridlock.carPoint(i)`
（`js/view.js:286`，把车当前所在的中心换算成 client 像素）。它断言的是：

- 用真实鼠标事件把整条认证路线拖完，一步一拖，主角正好落在闸门口；
- 原地按下再松开什么都不动；
- 在空柏油上拖什么都不动（格子由页面里的 spec + pos + walls 现场找出来）；
- 八倍过拉停在车位线上，且照样通关。

要让这些断言可能写成，`js/core` 必须与 DOM 无关（第 2.4 节），`view` 必须暴露按压点而不暴露规则。

### 7.3 verify.sh 的三处非显然处理

`tools/verify.sh`：

1. Chrome 用 `mktemp -d` 的独立 profile，避免污染使用者的浏览器；轮询 `/json/version` **和** web 根目录，
   两者都活才开始，否则第一次 `navigate` 会撞在半启动的端口上。
2. `SKIP_UNIT=1` 让 CI 的 browser job 跳过 node 测试（unit job 已经跑过，同一份代码跑两遍只会掩盖真因）。
3. 结果 JSON 由页面 `console.log` 带回，聚合器用**花括号计数**截取而不是 `JSON.parse(整行)`：
   headless Chrome 会在同一行后面追加别的 console 文本，直接 parse 是随机失败。

### 7.4 导航之后等的是 shell，不是秒表

`tools/playtest.mjs` 在 `Page.navigate` 之后调 `waitShell()` 轮询 `window.gridlock.state.id`，
而不是 `sleep(1800)`。**这条是被一次假故障逼出来的**：把 `BASE_URL` 指向
`https://z-biz-game.github.io/z-biz-game-gridlock-cos/` 跑 `@boot`，三条断言红，
canvas 尺寸停在未样式的 `300×150` —— 看起来像线上部署坏了，其实只是 Pages 的模块图比 localhost 慢，
固定 sleep 不够。等成轮询之后同一套 50 条断言在线上全绿（含 `@pointer` 的真实鼠标事件）。

所以：**台架必须能同时打本地和线上**，`BASE_URL` 一个变量决定目标；任何"只在本地计时够用"的写法
都会在下一次查线上时骗你。

### 7.5 不暂停 `visibilitychange`

`js/main.js:333` 显式地不接这个事件。通关动画和胜利卡片由同一个 rAF 循环驱动，
而 headless Chrome 把自己报成 hidden —— 一暂停，浏览器测试永远看不到通关。

---

## 8. 已知不做的东西

- **不做浏览器内生成**（第 3.3 节的实测）。想要更大池子就提高 `tools/bake.mjs` 的 `perTier` 重烤。
- **不做成就、排行、云存档**（组织规范 E 组）。
- **不做 8×8 与旋转车辆**：前者破坏 `par` 的可证性（第 1.1 节），后者改变游戏规则，
  BFS 的状态编码要重写，收益不抵代价。
- **不引入打包器与依赖**：ES modules + `server.cjs` + 零依赖 harness。
- **无美术与音频资产**：车辆外形是 `js/view.js:141` 的圆角矩形 + 内嵌座舱 + 挡风玻璃，全部程序绘制。

## 9. 实测出的边界

- 6×6 上 12 辆车左右能长到 22–24 步；**26 步以上实测不可达**，不是生成器不够耐心，是图就那么深。
- `hint`/`bestMove` 用 `limit: 120000`（比 `solve` 默认小），中盘玩家把板子拖进畸形状态时可能返回
  `ok: false`。此时 UI 说"这条路已经堵死了"并提示撤销或重开——**不会**假装还有一条两步的路。
- 每日关卡是从整个池子里取，所以它可能落在最高档；"每日"表示人人同题，不表示中等难度。
