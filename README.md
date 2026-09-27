# 死锁车库 · GRIDLOCK

把主角车开出停车场。经典 Rush Hour / 塞车时间玩法的浏览器实现，但和纸卡版有一个关键区别：
**每一关的"最少几步"不是印在卡片上的估计值，而是广度优先搜索量出来的确定答案。**

一次拖动不论滑过几格都算一步。这条计数规则让状态图变成无向图，也让 BFS 的深度成为可比较的
难度指标——你可以拿这里的 18 步去和任何一张实体卡片的 18 步对照。

**线上可玩**：<https://z-biz-game.github.io/z-biz-game-gridlock-cos/>

- 零依赖、零美术、零打包器：只有 `index.html` + `css/` + `js/`，浏览器加载的就是仓库里的文件。
- 64 关已烘焙并逐关复验，四档难度带互不重叠。
- 战役 / 每日 / 随机 / 分享链接四种入口，同一个 id 在任何设备上都是同一个局面。
- 本地存档（localStorage），无账号、无网络请求、可离线。

## 跑起来

```bash
node server.cjs            # http://127.0.0.1:5180/
npm run unit               # 六个 node 测试套件
bash tools/verify.sh       # node 套件 + headless Chrome 真实鼠标键盘验收
npm run bake               # 重新生成 js/data/lots.js（约 6 分钟，见下）
npm run balance            # 生成器体检：接受率、耗时、难度分布（约 4 分钟）
npx electron .             # 桌面壳（需先 npm i -D electron）
```

`server.cjs` 是零依赖静态服务器，存在的唯一理由是 ES module 需要一个 origin，`file://` 不行。

## 这一关的数字从哪来

游戏里没有手写关卡，也没有"简单/中等/困难"这种标签。链条是这样的：

1. `js/core/make.js` 从主角车开始**生长**：每次加一辆车，立刻用 `js/core/solve.js` 重测最短步数，
   只有把数字推上去的车才留下（推不上去的算作债务，后面还不上就被回滚删掉）。
2. `tools/bake.mjs` 在构建期跑它，把每关的 `spec` 序列化，然后**从序列化结果重新解一遍**；
   只有复现出同一个步数的关卡才写进 `js/data/lots.js`。数字对不上就直接抛错，不降级。
3. `test/library.test.mjs` 在每次 CI 里把 `js/data/lots.js` 逐关再解一遍。手改一个 `moves`
   字段，构建就红。

所以浏览器永远不生成关卡，只从池子里挑。这不是洁癖：`test/balance.mjs` 实测顶层段位
（死锁）中位数 2.6 秒、最差 18 秒、40 个种子里只有 12 个能长出合格关卡。这个成本放在
构建期是免费的，放在玩家点一下屏幕之后是灾难。

## 已烘焙的池子

| 档位 | 棋盘 | 关卡数 | 最少步数 | 步数中位 | 车辆数 | 可达局面数 min / med / max |
|---|---|---|---|---|---|---|
| 巷口 kerb | 5×5 | 16 | 4–5 | 4 | 5–7 | 9 / 589 / 1192 |
| 单行 lane | 6×6 | 16 | 8–12 | 9 | 9–10 | 657 / 13198 / 61960 |
| 路口 junction | 6×6 | 16 | 13–17 | 15 | 10–12 | 1146 / 5380 / 30013 |
| 死锁 gridlock | 6×6 | 16 | 18–24 | 19 | 10–13 | 344 / 7179 / 21771 |

表里的步数区间是从**实际入库的关卡**量出来再写进 `TIERS_META` 的，不是生成器想要的区间。
两者不一致时以入库为准——这一条由 `test/library.test.mjs` 断言。

整张表可以用一条命令重新生成，别手改数字：

```bash
node -e "import('./js/core/library.js').then(m => console.log(m.stats()))"
```

难度不止看步数：`局面` 一栏是同一关里 BFS 能走到的不同排列数。20 步但只有 400 个局面的关卡
是练习题，同样的 20 步穿过 2 万个局面才是谜题。两个数都在 `js/data/lots.js` 的每一行里。

## 验收

`bash tools/verify.sh` 一条命令跑完两层，全部断言都是可判定的：

- **node 层**（51 条）：`test/lot.test.mjs` 模型与合法拖动、`test/solve.test.mjs` 搜索、
  `test/game.test.mjs` 规则、`test/storage.test.mjs` 存档、`test/make.test.mjs` 生成器、
  `test/library.test.mjs` 全池复验。
- **浏览器层**（50 条）：`tools/playtest.mjs` 用 CDP 起一个真实 headless Chrome，
  `@boot` 检查画布真的画出了像素、`@play` 走完通关与评星、`@routes` 覆盖四种路由与越界钳制、
  `@save` 验证 localStorage 落盘与两次点击的清档、`@pointer` **派发真实鼠标事件**把整条最短
  路线拖完，并断言八倍过拉的车停在棋盘边界。

`solve.test.mjs` 里的期望值不是从被测代码里读出来的：`test/fixture.mjs` 的 CHAIN 关卡 par=3
是手算的，`test/solve.test.mjs` 再用穷举证明"两步拖不完"。搜索器不能给自己出题再给自己打分。

## 文件地图

```
index.html            壳：顶栏 / 画布 / 右侧面板 / 通关卡
css/game.css          全部样式，一个文件
js/core/lot.js        关卡模型、合法拖动、胜利判定、spec 校验
js/core/solve.js      BFS 最优解、下一步建议、局面普查
js/core/make.js       生长式生成器 + 生成侧难度梯
js/core/game.js       一局进行中的纯规则（无 DOM）
js/core/library.js    已烘焙池子的查表：战役顺序 / 每日 / 随机 / id
js/core/storage.js    localStorage 存档，无 window 时退化成内存
js/core/rng.js        FNV-1a 种子哈希 + mulberry32
js/data/lots.js       64 关，构建期产物，每行带实测步数与局面数
js/view.js            canvas 2D 绘制 + 指针手势，不判定合法性
js/main.js            路由、DOM、存档写入、window.gridlock 测试钩子
server.cjs            零依赖静态服务器
electron/main.cjs     桌面壳（复用同一个服务器）
tools/bake.mjs        内容管线：生成 → 序列化 → 复解 → 入库
tools/playtest.mjs    零依赖 CDP 驱动，真实输入事件
tools/verify.sh       一次性验收门
tools/harness.mjs     微型测试框架，node 与浏览器套件同一输出形状
test/                 六个套件 + 手算 fixture + 生成器体检 balance.mjs
```

## 规则

- 6×6（入门档 5×5）街区，右侧一个出口，只在出口那一行。
- 一辆琥珀色的主角车是玩家要开走的那辆。
- 车辆只能沿自身轴向滑动，不能旋转、不能重叠、不能出界；灰色方块是混凝土，永久占位。
- 一次拖动不论几格 = 一步。主角车头抵住右侧边界即通关。

## 已知边界

- 6×6 上 12 辆车左右能长到 22–24 步，再往上生成器就交不出货了：顶层段位 40 个种子里只活
  12 个，且 26 步以上实测不可达。想要 30 步以上的关，得换更大的棋盘或者别针式结构，而不是
  把预算调大。
- 每日关卡是从整个池子里挑的，所以某天可能一上来就是死锁档。这是刻意的：没有账号体系，
  就不做"按进度调节每日难度"这种需要状态的东西。
- 通关后没有彩带、没有音效、没有分享弹窗，只有一个"分享"按钮把 `#/lot/<id>` 链接写进剪贴板。

## License

MIT © 2026 z-biz-game
