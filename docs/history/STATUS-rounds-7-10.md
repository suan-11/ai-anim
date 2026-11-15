# STATUS 归档：第七～十轮的详细记录（§14–§17）

> 这是 `docs/STATUS.md` 的**历史归档**：第七～十轮（§14–§17）的详细记录逐字搬到这里，
> **章节号原样保留** —— 仓库里其它文档、注释里写的「`docs/STATUS.md` §14.5」「`STATUS.md` §15」
> 这类引用，改到本文件里按同一个 § 号找。
> **当前状态见 [`../STATUS.md`](../STATUS.md)**（轮次索引）；第十一～十二轮（§18–§19）在 [`STATUS-rounds-11-12.md`](STATUS-rounds-11-12.md)。
> 本文与代码不一致时**以代码为准**。
> 文中提到的 `docs/ROADMAP.md` 已于 2026-10-18 删除（三档 A/B/C 全部落地，其 §5 立场并入 [`../CONFIG-ONLY.md`](../CONFIG-ONLY.md) §11），相关表述按当时状态理解。

---

## 14. 第七轮：A 档镜头库 `src/shots/` —— 常见镜头从 126 行降到一行

### 14.0 一句话

`docs/ROADMAP.md` 的 **A 档落地了**：`tasks/demo` 与 `tasks/beat` 的 8 个场景改成「取模板 + 给参数」，
**画面逐像素没有变**（22/22 帧）。这一步的意义不是"少写代码"本身，而是
**镜头库把"这 8 个镜头的画面"从任务里搬进了引擎** —— 以后做新片子，常见镜头不用再从零画。

### 14.1 落地形态

```js
// tasks/<任务>/scenes/chart.js —— 改造前 126 行，现在 13 行
import { shot } from '../../../src/shots/index.js';

const VALUES = [0.18, 0.34, 0.27, 0.52, 0.44, 0.71, 0.63, 0.88, 0.79, 0.95, 0.86, 1.0];
export default shot('chart', {
  values: VALUES,
  title: '每次迭代的最高准确率',
  sub: 'PER-RUN  ·  n = 12  ·  纯代码绘制，无图片素材',
  footer: '确定性渲染 → 任意时刻可重放，任意精度可重渲',
});
```

| 名字 | 从哪个场景搬来 | 参数（默认值 = 原画面） |
|---|---|---|
| `title` | `tasks/demo/scenes/title.js` | `id` `eyebrow` `title` `sub` `readout` |
| `chart` | `tasks/demo/scenes/chart.js` | `id` `values` `title` `sub` `footer` `peak` |
| `kinetic` | `tasks/demo/scenes/kinetic.js` | `id` `headline` `sub` `cellCols` `cellRows` `cellSeed` |
| `whip` | `tasks/demo/scenes/whip.js` | `id` `streaks` `dir` |
| `outro` | `tasks/demo/scenes/outro.js` | `id` `title` `sub` `signature` |
| `wave` | `tasks/beat/scenes/intro.js` | `id` `label` `cols` `window` |
| `pulse` | `tasks/beat/scenes/pulse.js` | `id` `title` |
| `grid` | `tasks/beat/scenes/grid.js` | `id` `label` `cols` `rows` `window` |

- **`shot(name, opts)` 返回的就是普通场景对象**（`{ id, setup?, render }`），所以模板镜头与手写场景能混在同一条时间线里；
  `opts.id` 覆盖段名（`tasks/beat/scenes/intro.js` 就是 `shot('wave', { id: 'intro' })`，段名沿用原来的 `intro`）。
- **参数写错会抛错**（本轮唯一"新增行为"的地方）：`shot('title', { eybrow: … })` →
  `镜头模板 "title" 没有参数 "eybrow"（大概是拼错了）。可用参数：id / eyebrow / title / sub / readout`。
- 查模板：`node scripts/anim.mjs shots`（8 个模板 + 摘要）、`node scripts/anim.mjs shots chart`（参数、类型、默认值、说明）。
- 8 个模板**全都自己铺满整帧**（三个自带全屏 Pass、四个 `gl.clear`、`whip` 是揉 `ctx.under` 的 Pass），
  所以它们与 `src/kit/shot.js` 的 `makeShot()` 是**两条平行的路**，不能叠（叠了会覆盖 `makeShot` 铺的背景）。见 `docs/ENGINE.md` §14.5。

### 14.2 做法：逐字搬运，不是"再写一遍"

模板里的绘制代码是从已经出过片的场景**逐字**搬过来的：只把内容换成参数，
数值、运算顺序、绘制顺序、Pass 的 shader 源码与 `key`、每条注释都原样保留。
这是"画面逐像素没变"唯一可行的做法 —— 任何一次"顺手改好"都会改变已经交付的片子。

**新增/改动的文件**

| 文件 | 改动 |
|---|---|
| `src/shots/{index,title,chart,kinetic,whip,outro,wave,pulse,grid}.js` | **新增**：`shot` / `SHOTS` / `listShots` + 8 个模板（每个带 `.defaults` 与 `.meta`） |
| `tasks/demo/scenes/{title,chart,kinetic,whip,outro}.js` | 改成薄壳（97/126/101/85/55 行 → 10–20 行） |
| `tasks/beat/scenes/{intro,pulse,grid}.js` | 同上（75/58/83 行 → 11–13 行） |
| `scripts/anim.mjs` | 新增 `shots` 命令（读 `listShots()`，纯 Node，不起 Vite）；`--help` 头加一行；`new` 脚手架的场景文件头加两句"想要现成镜头先看 `anim shots`" |
| `package.json` | 新增 `npm run shots` |
| `tools/test-shots.mjs` | **新增**：74 项断言（见 §14.4） |
| `tools/regress-all.mjs` | 新增 `unit:shots`；顺手修掉 `check:fidus` 那条过时的 "⏸ 两轮没验过" |
| `AGENTS.md` / `README.md` / `docs/ROADMAP.md` / `docs/ENGINE.md` | A 档标为已落地；`ENGINE.md` 新增 §14（API / 模板表 / 与 `makeShot` 的关系 / 纪律） |

### 14.3 验收（实际输出）

**① 画面逐像素没变**（这是 A 档在 ROADMAP 里写死的判据）。基线在改造**之前**存：

```sh
node scripts/anim.mjs hashes demo --times 0.5,2,4.5,6.5,8.5,10.5,12.2,12.8,13.2,14,16 --save
node scripts/anim.mjs hashes beat --times 1,4,7,10,13,16,19,22,25,28,31 --save
# …把 8 个场景改成 shot(...) …
node scripts/anim.mjs hashes demo --baseline
node scripts/anim.mjs hashes beat --baseline
```

```
demo：✓ 11 帧全部与基线一致（画面没有被改动）
  t=0.5/2/4.5/6.5/8.5/13.2/14/16   max 0     mean 0.0000  >16 0.0000%
  t=10.5 / 12.2（kinetic 与甩镜交叠附近）  max 13    mean 0.0001  >16 0.0000%
  t=12.8（whip 交叠中）                    max 6     mean 0.0001  >16 0.0000%
beat：✓ 11 帧全部与基线一致 —— **每一帧 max 0**（mean 0.0000、>16 0.0000%）
```

> 判据是"没有任何像素差超过 16/255 且平均差 < 0.002"（`negligible()`）：GPU 在转场帧上有
> 最后一位噪声，实测天花板就是 `max 13`；真正的画面变化会以远大于 16 的幅度、成千上万个像素同时打破它。
> **beat 那边 11 帧 max 全是 0**，说明这次搬运连一个 LSB 都没动。

**② 逐段体检**：`check demo --quick` / `check beat --quick` → 退出码 0，
段名与时长与改造前完全一致（demo 5 段 16.65s：title/chart/kinetic/whip/outro；beat 3 段 32s：intro/pulse/grid），
背景守门通过，各段亮度 0.051–0.868（没有全黑段）。

**③ 出图看过**（AGENTS.md 铁律：出图必须用 Read 看）：`still demo -t 1,6.5,10.5,12.8,15`、
`still beat -t 2,14,26` 共 8 张，逐张确认画面与原样一致（标题逐字入场、纸面柱状图、
等高线底 + 计数器阵列、甩镜拉丝、片尾刻度尺、波形 + 三条频段、频谱网格）。

**④ 镜头库自己的回归**：`node tools/test-shots.mjs` → `✓ 全部通过（74 项）`，进了 `regress-all` 的 `unit:shots`。

**⑤ 整份回归**：`node tools/regress-all.mjs` → **通过 32/32 ✅ 没有真失败**（上一轮是 31 项，本轮 +1 就是 `unit:shots`）：

```sh
# 与镜头库直接相关的
node tools/regress-all.mjs --only unit    # 8/8（含 unit:shots）
node scripts/anim.mjs help                # 命令清单里有 shots
node scripts/anim.mjs new _shotsmoke && node scripts/anim.mjs check _shotsmoke --quick
                                          # 脚手架仍然出得来、能过体检（临时任务已删）
# 全量（约 12 分钟；smoke:* 会临时改工作区文件，必须独占跑）
node tools/regress-all.mjs
  unit:shots PASS 0.1s ｜ smoke:worktree-edit PASS 62.7s ｜ check:demo/beat PASS ｜
  check:beast/_calib/nekohome/fidus/pdoom-lab PASS ｜ probe:* 全 PASS ｜
  probe:determinism PASS 64.7s ｜ test:parallel PASS 249.4s ｜ hashes:fidus PASS 106.8s
```

> `smoke:worktree-edit` 会往 `tasks/demo/scenes/chart.js` 里注入一行再还原 —— 跑完确认过
> 那 8 个薄壳仍然是干净的 13 行（注入的清理是幂等的）。

### 14.4 `tools/test-shots.mjs`（74 项）守什么

| 组 | 条数 | 守的是 |
|---|---|---|
| §1 登记 | 4 | `SHOTS` / `listShots()` 的键正好是那 8 个名字；每个值都是函数；8 个具名导出都在 |
| §2 文档与代码一致 | 33 | 每个模板的 `meta.name == 注册名`、`summary` 非空、每个参数都有 `name/type/desc`；**`meta.params` 的键集合与 `defaults` 完全相等**（少登记一个参数、或登记了一个不存在的参数，都会点名）；`listShots()` 报的默认值就是工厂 `defaults` 里的值 |
| §3 场景对象 | 9 | 8 个模板不传参数都能拿到 `{ id, render }`；`whip.handlesTransition === true`（转场镜头） |
| §4 状态隔离 | 1 | 每次调用返回**新对象**（场景有自己的 `this.bg`/`this.cells`，共享会串场） |
| §5 `id` | 2 | `opts.id` 覆盖；不传时等于 `defaults.id` |
| §6 报错路径 | 12 | 未知模板名抛错 + 点名 + 列出全部可用名字；**每个模板传一个不存在的参数都必须抛错并点名它**（某个模板忘了写 `defaults` 时校验会全线放行，这条就是抓这个的） |
| §7 任务侧集成 | 8 | `tasks/demo|beat` 的 8 个场景段名没变（`intro` 也是）——段名被悄悄改掉会红 |
| §8 静态扫描 | 5 | `src/shots/` 下确实扫到 8 个模板 + `index.js`；源码里没有 `Math.random(` / `Date.now(` / `performance.now(`（注释与字符串先掩码，避免把"注释里提到 Math.random"当成违规） |

### 14.5 这一轮的坑（比结论更值得记）

1. **渲染期间写 `docs/*.md` 也会把 Vite 搞崩**（第三次复现，这次抓到了机制）。
   第一次 `hashes demo --baseline` 跑到第 8 帧就死了：

   ```
   Error: EBUSY: resource busy or locked, watch
     'D:\ai动画\docs\.ENGINE.md.19416.b30f73a2-….tmpdir\ENGINE.md.tmp'
   ```

   那是我**并行写 `docs/ENGINE.md`** 时编辑工具留下的原子写临时文件 ——
   `watch.ignored` 里的 `docs/**` 与 `**/*.md` **没能挡住它**（`.tmp` 不以 `.md` 结尾）。
   → 规则比 `§12.4.1` 再收紧一格：**只要有一场渲染在跑，就不要写任何文件**（连 `docs/*.md` 都不行）。
   并发子代理的产出先落到 **`out/_staging/`**（`**/out/**` 确实被挡住了，这一轮 8 个模板全程写在里面，
   没有干扰任何渲染），渲染结束之后再搬进仓库。
2. **原始场景代码在磁盘上没有第二份。** 本仓库**不是 git 仓库**（`git log` → not a git repository），
   `tasks/demo|beat/scenes/*.js` 被改成薄壳之后，原文就只剩"搬好的模板"了 ——
   也就是说**这个重构的"逐字"保证，只能靠先读、后写**（顺序反了就没法 diff，也没有 `git diff` 兜底）。
   → 下次做同类重构：**先把源文件复制一份到 `out/_staging/orig/` 再动 `tasks/`**（几秒钟的事，换一个可回退）。
3. **`shot()` 的参数校验值得单独说**：它把"参数名拼错"从"静默吃默认值、画面看着也对"变成了一句抛错。
   这正是 `docs/history/IMPROVEMENTS-1-3.md` 那类 bug（写错了但画面照样出）的通用解法 —— 能抛错就别约定。
4. **两条路不要叠**：`src/shots/` 的模板自己铺满整帧，`src/kit/shot.js` 的 `makeShot()` 也铺背景。
   子代理在写文档时核对了代码并**否掉了我简报里"两者可叠加"的说法** —— 这是对的，文档按事实写成了"二选一"。
   （又一次印证 `§12.4.5`：听起来合理的说法，先证伪再写进文档。）

### 14.6 这一轮**没做**的（仍然开着）

| 事 | 从哪接着做 |
|---|---|
| **B 档：`task.config.mjs` 里直接写 `{ type: 'chart', … }`、由时间线查表分发** | 这是路线图的**下一步**：`src/timeline.js` 的 `build()` 加一条分支去查 `SHOTS`；再做 `docs/CONFIG-ONLY.md` + `tasks/example-config-only/`。见 `docs/ROADMAP.md` §2 B / §3 |
| 镜头库只有 8 个模板（缺 `quote` / `counter` / `compare` 这类常见镜头） | 需要新模板时**照 `src/shots/title.js` 的形状写**，并同步 `meta`（`tools/test-shots.mjs` 会守住键集合） |
| `tasks/nekohome` / `fidus` / `beast` / `pdoom-lab` 里仍有各自手写的重复镜头 | 那些是"这支片子特有的母题"，按边界**不该**进 `src/shots/`；但如果发现其中有不带片名信息的通用镜头，值得按 `§14.2` 的方式搬（**先复制原文到 `out/_staging/orig/`**） |
| 本轮没跑**整份** `regress-all`（只跑了 `--only unit` 8/8） | ✅ 已跑：**32/32 通过**（`node tools/regress-all.mjs`，约 12 分钟；其中 `smoke:*` 会临时改工作区文件，别与别的渲染并行） |

---

## 15. 第八轮：B 档「配置档」——只写 `task.config.mjs` 就能出片

### 15.0 一句话

`docs/ROADMAP.md` 的最后一块落地了：时间线的每一项可以直接写**镜头模板**，
于是任务可以**只有 `task.config.mjs`** —— 没有 `scenes/`、整个文件没有一行 `import`。
路线图的三档作者模型（A 镜头库 / B 配置档 / C 手写场景）现在全部到位。

### 15.1 落地形态

```js
// tasks/example-config-only/task.config.mjs —— 整个任务就这一个文件
export default {
  title: '只写配置，就能出片', width: 1920, height: 1080, fps: 60, scale: 1,
  timeline: [                                    // 数组、seq([...]) 都行
    { type: 'title', id: 'hook', title: '只写配置，就能出片', dur: { beat: 7 } },
    { type: 'chart', values: [/*…*/], title: '…', dur: 4.4 },
    { type: 'kinetic', headline: ['只写配置', '不用写场景'], dur: 3.5 },
    { type: 'outro', title: '…', dur: { beat: 5 } },
  ],
};
```

| 事 | 规则 |
|---|---|
| 判据 | 节点是对象、`type` 是字符串、**没有 `scene`**（`src/timeline.js` 的 `isConfigNode()`） |
| 时间线字段 | `type` `id` `dur` `at` `overlap` `params` `post` `maxSamples` `handlesTransition` `note` `world` `worldPass`（`TIMELINE_KEYS`） |
| 模板参数 | **其余所有键** → 原样交给 `shot(type, {…})`；显式写在 `params` 里的优先 |
| 默认值 | `id` 不写 = 模板自己的默认段名（重名加 `_2`）；`dur` 不写 = 4 秒；`dur` 支持秒 / `{beat}` / `{bar}` / `{vo}` |
| 写错 | 模板名或参数名写错**抛错**，并指出是数组第几项 + 列出可用模板/可用参数 |
| 混写 | 配置档节点与「已经展开好的段」（带 `start`/`end`）**不能混**在同一条时间线里 → 抛错 |
| 选路 | `src/tasks.js`：非数组、**或**数组里至少有一个配置档节点 → 走 `build()`；纯数组（旧行为）仍然不经过 build |
| 转场 | `{ type: 'whip', dur: 1, overlap: 0.5 }` 即可 —— `whip` 模板自带 `handlesTransition: true` |

### 15.2 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/timeline.js` | `isConfigNode` / `TIMELINE_KEYS` / `configToCut()`；`walk()` 里展开成 `cut()` 的形状（排版逻辑与手写场景共用一条路）；`assertNode()` 认数组与配置档节点；混写禁令；头注释加了配置档一节 |
| `src/tasks.js` | 时间线选路：非数组 or 数组含配置档节点 → `build()`（以前纯数组一律不做 build，配置档会因此完全不生效 —— 这是本轮唯一"必须同时改两处"的地方） |
| `tools/test-timeline-guard.mjs` | 16 → **40 项**（新增一节：展开 / 默认值 / 转发 / 混写 / 报错能定位） |
| `tasks/example-config-only/task.config.mjs` | **新增**：整个任务只有这一个文件，4 段 13.9 秒，无音频 |
| `docs/CONFIG-ONLY.md` | **新增**（353 行）：什么时候只用配置 / 字段表 / 8 个模板 / 时长四种写法 / 转场 / 需要音乐的三个模板 / 边界 / 排错表 |
| `AGENTS.md` | 新增 §2.1（配置档，推荐先试）与 §3.2（规格）；§7 那条"渲染期间能安全写哪些文件"按 §14.5 的实测收紧成"一个文件都别写" |
| `README.md` / `docs/ROADMAP.md` / `docs/ENGINE.md` | B 档标为已落地；ENGINE 新增 §9.7（配置档规格）与 §14.8；顺手更正了两处与代码不符的旧说法（`dur` 其实解析 `{beat}`/`{bar}`；`{bar:n}` = 第 4n 拍） |
| `scripts/anim.mjs` | `--help` 里点明配置档；`new` 脚手架的 `task.config.mjs` 头部写清"想要零代码出片就把 timeline 换成配置档" |
| `tools/regress-all.mjs` | `unit:timeline-guard` 注记改成 40 项；新增 `check:example-config-only` |

### 15.3 验收（实际输出）

```sh
node tools/test-timeline-guard.mjs             # ✓ 全部通过（40 项）
node tools/test-shots.mjs                      # ✓ 全部通过（74 项）
node scripts/anim.mjs hashes demo --baseline   # ✓ 11 帧全部与基线一致（改完 timeline.js/tasks.js 之后老片子没变）
node scripts/anim.mjs hashes beat --baseline   # ✓ 11 帧全部与基线一致（每帧 max 0）
node scripts/anim.mjs check example-config-only
```

```
分辨率 1920×1080×1 @60fps  时长 13.90s  4 段
  hook     0.00 →  3.50  (3.50s)  标题 · { beat: 7 } @120bpm = 3.5s
  chart    3.50 →  7.90  (4.40s)  图表 · 秒写法的 dur
  kinetic  7.90 → 11.40  (3.50s)  动态大字 · 秒写法的 dur
  outro   11.40 → 13.90  (2.50s)  片尾 · { beat: 5 } @120bpm = 2.5s
每段 15% / 50% / 85% 三个点 × 单子帧/多子帧两条路径（24 帧）→ ✓ 没有发现问题
```

- 段名就是模板名（或你写的 `id`）—— 上面第①段的 `id: 'hook'` 就是配置里覆盖的。
- 出图看过的：`still example-config-only -t 1.8,5.6,9.5,12.6`（标题 / 纸面柱状图 / 等高线底 + 大字 / 片尾刻度尺），
  中文在 `sans` 槽位正常（引擎的字体栈里有 Noto Sans SC / 微软雅黑）。
- **成片**：`node scripts/anim.mjs video example-config-only --segments 5 --idle 300` →
  **834 帧 / 13.90s，4 块拼接，ffprobe 复核通过；282.8 MB，用时 875 秒（≈15 分钟）**。
  这就是 ROADMAP §3 第 2 条那条验收：「新建一个任务，**只编辑 `task.config.mjs`**，能出完整 mp4」。
- **整份回归**：`node tools/regress-all.mjs` → **通过 33/33 ✅ 没有真失败**（上一轮 32 项；多的那一项就是新增的
  `check:example-config-only`，其余覆盖 unit / smoke / 逐任务 check / 各探针 / determinism / 并行 / `hashes:fidus`）。

### 15.4 顺手量清楚的一件事：`kinetic` 的居中文字，长行会顶出右边（demo 里就是）

写示例时按画面调 `headline` 文案，一度以为副标也被裁了 —— **是我看错了两次**：
缩略图上"少几个字"其实是**打字机效果还没走完**（`prog(t,1.6,3.2)` 到 3.2s 才擦完整行，
t=2.6 时 26 个字符只画了 24 个）。

为了不再靠缩略图猜，这一轮留了个量具 **`out/_measure.mjs`**（ffmpeg 把 PNG 解成灰度 →
按"笔画厚度"筛掉 1–2px 的背景等高线 → 找出真的有字的列），并把可疑的那一带裁出来放大看。
结论（都是量出来的，不是估的）：

| 画面 | 文字 | 横向范围 | 结论 |
|---|---|---|---|
| `tasks/demo` 的 kinetic（t=12.5） | `都是时间的函数`（7 字，170px） | **887 → 1919**（顶到右边缘） | ⚠ **真的被裁** —— demo 这支片子本身就有这个问题 |
| `tasks/example-config-only` 的 kinetic | `不用写场景`（5 字，170px） | 883 → 1674 | ✓ 放得下 |
| 示例的副标（26px 等宽，tracking 8） | 24 个字符（打字机进行中） | 947 → 1430（≈20px/字符） | ✓ 正常，没有裁 |

根因是引擎的已知坑：`type.write` 的 `align` 是**逐字**生效的（`docs/history/IMPROVEMENTS-1-3.md` P1-4 记过），
所以 `align: 'center'` 不是"整行居中"，而是"每个字各自居中在自己的推进位置上" —— 整行从画面中心**往右排**。
170px × 6 字 ≈ 1900px 就是上限，**第 7 个字会被裁**（demo 那行正好 7 个字）。

→ 示例片的文案按这个限制写（`task.config.mjs` 注释里写明"每行别超过 6 个字"）。
**demo 那支的 7 字行仍然是裁的**：修它有两条路，**都会动已经出过片的画面**，所以没有单方面改 ——
① 改模板（`type.write` → `type.writeLine(..., { anchor: 'center' })`，一行的事），但要重存 `hashes` 基线并重出 demo；
② 只把 demo 的文案改短（同样改变画面）。**这条需要用户拍板。**

### 15.5 这一轮没做的（仍然开着）

| 事 | 从哪接着做 |
|---|---|
| `kinetic` 的居中文字（见 §15.4）：修模板 or 改 demo 文案 | 需要用户拍板；改模板会改变 demo/beat 画面，要重存 `hashes` 基线 |
| 模板只有 8 个（没有 `quote` / `counter` / `compare` 这类） | 往 `src/shots/` 加，照 `src/shots/title.js` 的形状并同步 `meta`（`tools/test-shots.mjs` 会守） |
| 配置档的 `post` / `world` / `maxSamples` 还没有真实用例 | 特性已通（`test-timeline-guard` 里有转发断言），但没人用过；要用就先出图看 |
| `dur: { vo }` 只能配**内联**旁白表 | 外部 `narration.json` 是页面启动后才 fetch 的，build 时还没有表 —— 想做"配置档 + 外挂旁白表"要先改这个时序 |
| `tasks/nekohome` / `fidus` / `beast` 里的重复镜头 | 都是各片特有的母题，按边界不该进 `src/shots/`；真要搬就按 §14.2 的流程（先备份原文、逐字搬、`hashes --baseline` 证明） |





---

## 16. 第九轮：`IMPROVEMENTS-3` 落地 + 渲染提速（2026-10）

> 本轮有两个来源：①`docs/history/IMPROVEMENTS-1-3.md` 的 A–F 六条建议（做 promo 时用户说"镜头像地震"查出来的）；
> ②用户要求"探索一下有没有更快的渲染方式"。①全部落地，②量出了**新的瓶颈**并且顺手把最大的一块修掉了。

### 16.1 A–F 六条：全部落地

逐条对照见 `docs/history/IMPROVEMENTS-1-3.md` §6（含"哪一条的前提是错的"）。一句话版：

| 条 | 落地物 |
|---|---|
| A（文档：抖动要是 `t` 的平滑函数） | `AGENTS.md` §4 铁律表 + `docs/ENGINE.md` §1.2 铁律表各加一行；§5 的 post 参数表各加一张"幅度→观感"表 |
| B（`handheld` 加 `mode`） | `src/core/cam.js`：默认 `'smooth'`（低频值噪声），老的逐帧白噪声搬到 `'grain'`（只给震屏/冲击） |
| C（`shakeSmooth`） | `src/core/cam.js`：参数就是幅度 + 频率，峰值校准到 `amp`，`amp=0` 返回零位移 |
| D（`post.shake` 文档） | ✅ 但**更正了前提**：实测单位是**物理像素**（不是建议里写的逻辑像素），4K 下要乘 `scale`；`post.js` 的 JSDoc 原来也写错了，一并改对 |
| E（`anim shake`） | `scripts/anim.mjs` 的 `cmdShake` + `scripts/lib/shake.mjs`：峰值/逐帧变化量/比值/分段/收尾比 + 白噪声指纹判定，退出码可判 |
| F（出片收尾守门） | 帧头 4 → **12 字节**（搭车带回 `post.shake`），`renderToFile` 收尾用同一套判据提醒（只提醒、不删产物） |

**踩到并修掉的两个坑**（都写进代码注释了）：
① 收尾判据只看比值会误报（promo 5–10s 从 0.43px 升到 1.23px，比值 1.40 但那是"呼吸"）——
现在要求**比值 > 1.25 且收尾绝对幅度 > 2.5px**，且只对跑到片尾的区间生效；
② 整片 2880 帧一次 `page.evaluate` 会把渲染进程跑崩（`Target crashed`）——
改成每批 240 帧、批间打进度与 ETA（`--batch` 可调）。

### 16.2 渲染提速：瓶颈是**每帧 new 33MB**，不是 GPU、也不是 `pow`

量法：`out/_probe/perf-breakdown.mjs` / `out/_probe/srgb-lut-check.mjs`（都是只读页面实例的探针）。
1080p 全帧、同一会话同一帧、5 次取中位数：

| 实现 | 耗时 |
|---|---|
| 旧：每帧 `new Float32Array(33MB)` + `new Uint8Array(8.3MB)` + 逐通道 `pow` | **195.0 ms** |
| 每帧分配 + 直算（循环写成 JIT 友好的形式） | 17.1 ms |
| **复用缓冲 + 直算（已落地；逐像素等价）** | **6.4 ms（30.5×）** |
| GPU blit 编码 + 8bit 回读（未落地，见 §5.6） | 5.2 ms |

分解：纯 `GL.readPixels(FLOAT)` 只要 0.1–0.2ms，`'none'`（读回+8bit）5.9ms，`'srgb'`（多一步编码）
142–197ms ⇒ **分配 + 编码循环**才是成本，GPU 回读从来不是。

**改了什么**（`src/core/gl.js`）：GL 实例持有读回缓冲并复用；热循环拆开 `encode` 分支
（`this._px*` 会让 V8 类型反馈带上 Nullable，跑不进最快档）。**数学一个字没改。**
`app.js` 的 `diff()`（跨 `await` 的两帧比较）显式复制 —— 这是复用缓冲唯一的语义变化。

**端到端**（同一命令、同一任务、同一机器）：

| 口径 | 旧 | 新 |
|---|---|---|
| `anim perf promo --from 10 --to 12 --samples 1` | 215.6 ms/帧 | **66.7 ms/帧**（3.2×） |
| `anim shot promo --from 10 --to 16 --samples 1`（真实出片 360 帧） | 95.7 s（3.8 fps） | **47.9 s（7.5 fps）** |

### 16.3 `--gpu high`：**推翻** PERF.md §2① 的"独显更慢"

那条结论量在 `readPixels` 要 195ms/帧 的年代（当时大头是跨适配器回读）。现在读回只要 6ms，
同一个 promo、`samples=1`、连续 40 帧「渲染+读回」重测：

| 场景 | 核显 | RTX 3070 | |
|---|---|---|---|
| raymarch 大厅段（t=21） | 125.4 ms/帧 | **58.3 ms/帧** | **2.15×** |
| 走廊段（t=10，轻） | 45.0 ms/帧 | 51.4 ms/帧 | 慢 14% |

所以做成**显式开关**（`--gpu high` / `--force-gpu`，`openSession` 里读，`renderParallel` 会转发），
默认仍跟系统走。`docs/PERF.md` §2① 已重写为"旧结论作废 + 新数据 + 判据"。

### 16.4 新瓶颈：把裸帧搬出浏览器只有 ~110 MB/s（探索结论）

`readPixels` 修好之后，每帧还剩 ~126ms 在渲染之外，而 ffmpeg 那一侧实测只要 **4.2 ms/帧**
（`out/_probe/pipe-cost.mjs`：vflip+bt709+x264 veryfast = 237 fps）。差额全在传输：

| 通道（7.91MB/帧） | 实测 |
|---|---|
| WebSocket（现状） | 101–115 MB/s（72–79 ms/帧） |
| HTTP POST（一帧一请求） | 24–26 MB/s ← 更慢 |
| 攒 8 帧一次 `send` | 103–115 MB/s ← 只快 1.01–1.11×，**不是消息数的问题** |
| Node→Node 的 ws（排除 Chrome） | **245 MB/s**（32 ms/帧） |
| 纯内存拷贝 | 2.3–2.6 GB/s |
| `fetch` 流式上传（1 请求 N 帧） | 本机被挡：`ERR_ALPN_NEGOTIATION_FAILED`（未取到数） |

⇒ **唯一出路是少传字节**。两条都量过、都没落地：**YUV420**（3.11MB/帧，估算 ~41ms/帧，
改动小，但色度下采样会与 ffmpeg 现有路径有细微差别）；**浏览器内编码 WebCodecs**
（H.264 实测 **27 KB/帧、314× 更小**，编码 38.7ms/帧 ⇒ ~47ms/帧，但要动整条出片流程与 `verify`）。
详见 `docs/PERF.md` §5.3–§5.6。

另：`--parallel` **需要重测**——它当年的 2.3× 来自"渲染吃满 CPU"，现在瓶颈是传输，
实测 4 进程并行 720 帧 ≈ 118s（6.1 fps）**比单进程 7.5 fps 还慢**。

### 16.5 顺手修掉：`hashes --baseline` 从"几分钟"到 8.5 秒

原来把参考帧 `[...cur]` 展开成 **830 万个数字**再经 `page.evaluate` 序列化（demo 的 11 帧基线要几分钟，
常常跑超时）。改成 base64（页面侧新增 `diffToB64`）：**11 帧 8.5s**，结论完全不变。

### 16.6 验收证据（本轮跑过）

```sh
node tools/regress-all.mjs --only unit          # 8/8 PASS（含 cam-math 的 3 条新断言）
node tools/regress-all.mjs --only colorspace    # PASS（导出 = 显示）
node tools/regress-all.mjs --only determinism   # PASS（复用缓冲没破坏确定性）
node tools/regress-all.mjs --only backpressure  # PASS（12 字节帧头在背压下正常）
node tools/regress-all.mjs --only scene-error   # PASS（场景抛错仍然是硬失败）
node scripts/anim.mjs hashes promo --baseline   # 4/4 帧 max 0 / mean 0.0000
node scripts/anim.mjs hashes demo  --baseline   # 11/11 帧 同上
node scripts/anim.mjs hashes beat  --baseline   # 11/11 帧 同上
node scripts/anim.mjs hashes fidus --baseline   # 4/4 帧 同上
node scripts/anim.mjs shot promo --from 10 --to 13 --samples 1     # 出片 ✓，收尾打印振荡守门
node scripts/anim.mjs verify promo --file out/_staging/verify_header.mp4 --from 10 --samples 1
                                                # 3/3 时刻一致（mean 2.94–4.10，判据 <18）
node scripts/anim.mjs shake promo --from 10 --to 20                # ⇒ 平滑（比值 0.05）
```

**共 30 帧画面基线全部 max 0 / mean 0.0000** ⇒ 本轮的引擎改动（复用缓冲、帧头扩容、`--gpu`）
**没有改变任何一帧**。

### 16.7 下一步（按性价比）

1. ~~**YUV420 传输**（§16.4）：预期 133 → ~41ms/帧，改动可控（GPU 转一次 + `-pix_fmt nv12`）。~~
   → ✅ **第十轮已落地，见 §17**。
2. `readPixels` 走 **GPU 编码 + 8bit 回读**：6.4 → 5.2ms，但要接受 sRGB 舍入差 1 LSB（会动基线）。
3. **PBO 异步回读**：把 5ms 藏到下一帧。
4. **WebCodecs**：收益最大（传输量 -314×），但要重做出片流程。
5. ~~老任务里的 `disp()/dcss()` 颜色绕行补丁（`tasks/nekohome/scenes/_kit.js` 顶部）要不要回改 —— 仍待用户拍板。~~
   → ✅ **2026-10-16 用户拍板：不回改**（成片已定稿，片里 `dscale(P, …, 1.35)` 这类系数是照现观感调的）。
   只把 `_kit.js` 顶部注释更正为"**历史绕行补丁，不是设计要求**"，并写明会偏亮、新片子别照抄。
   见 [`BACKLOG.md`](../BACKLOG.md) §4 里"第十二轮"那几行。

---

## 17. 第十轮：出片推流换 **NV12**（每帧少传 62%）

### 17.0 一句话

§16.4 认准的瓶颈是**传输**（Chrome→Node 的 ws 上限 ~110MB/s，8.3MB/帧 ⇒ 72–79ms/帧），
出路只有"少传字节"。这一轮把它做掉了：**页面在 GPU 上把画面转成 NV12（YUV420）再推**，
每帧 8.29MB → **3.11MB**，ffmpeg 用 `-pix_fmt nv12` 直接吃。

**这不是新增一次画质损失**：成片本来就是 `yuv420p`，色度二次采样早就在发生 ——
变化只是"同一个 4:2:0 转换"从 ffmpeg 的 swscale 挪到 GPU，唯一实质差别是
**色度下采样的滤波器核**（2×2 盒式平均 vs swscale 的 bicubic）。

### 17.1 改了什么

| 文件 | 改动 |
|---|---|
| `src/core/gl.js` | `readNV12(rt)`：两个全屏 pass（Y 平面全分辨率 / 交错 UV 平面半分辨率，2×2 盒式平均），公式 = swscale 那套（全范围 sRGB → BT.709 limited）。复用 RT / Pass / 缓冲；`pass.noFull = true`（不参与背景守门记账） |
| `src/core/engine.js` | `readNV12()` 包装（与 `readPixels()` 并列） |
| `src/app.js` | `stream().step()` 推 NV12 而不是 RGBA（帧头仍是 12 字节） |
| `scripts/anim.mjs` | ffmpeg 输入 `-pix_fmt nv12`；**去掉** `scale=out_color_matrix=bt709`（那一步已被搬到 GPU）；`setparams` 增加 `range=limited`（**钉住**色彩标记 —— NV12 输入没有 range 元数据，不钉住编码器可能按全范围打标，播放时整片对比度就变了）；`--keep-raw` 落 NV12 |
| `tools/lib/nv12-ref.mjs` | **新增**：CPU 参考实现（与 GPU 侧同一套公式），供三个探针共用 |
| `tools/probe-nv12.mjs` | **新增量具**：GPU 的 NV12 vs CPU 参考实现，判据 ±1；已进回归清单（`probe:nv12`） |
| `tools/probe-determinism.mjs` | 判据换到 NV12 空间：**两个独立会话**各自 `--keep-raw` 后逐字节比（比原来"raw vs dumpframes"更强，两边都是同一段 GPU 编码代码） |
| `tools/probe-frame-drift.mjs` | 跟着换成 NV12 空间（RGBA 那侧过一次 CPU 参考实现） |
| `docs/PERF.md` §5.3–§5.6、`docs/ENGINE.md` §12/§12.1、`AGENTS.md` §7 | 记录落地形态、实测数字与新的量具 |

### 17.2 验收证据（都跑过）

```sh
node tools/probe-nv12.mjs _calib        # ✓ 5 个时刻：max 1 码值、差 >1 的字节 0.00%（GPU 编码 == CPU 参考实现）
node scripts/anim.mjs video _calib --from 0 --to 12 --samples 1 --noaudio -o out/_nv12test/calib12.mp4
                                        # 720 帧 / 51.7s = 13.9 fps
node scripts/anim.mjs verify _calib --file out/_nv12test/calib12.mp4 --from 0 --samples 1
                                        # ✓ 8/8 时刻一致（mean 0.00–3.19，判据 <18）
node scripts/anim.mjs shot promo --from 10 --to 16 --samples 1
                                        # ✓ 360 帧 / **29.3s（12.3 fps）** —— 与 §16 / PERF §5.2 同一条基准命令
                                        #   旧路径（RGBA 推流）同一条命令是 47.9s（7.5 fps）⇒ **1.63×**
node tools/regress-all.mjs              # ✓ **37/37**（6.9 分钟；新增 probe:nv12 一项）
```

标定夹具的**逐值**核对（`tasks/_calib/scenes/probe.js` 清已知线性色，正确显示值 188/137/225）：

| 时刻 | 线性色 | 成片解出来的 YUV → RGB | 应为 |
|---|---|---|---|
| t=0.2s | (0.5, 0.25, 0.75) | YUV(148,161,147) → **188,137,223** | 188,137,225（B 差 −2，色度 8bit 量化的正常范围） |
| t=1.0s | 0.05 | YUV(70,128,128) → **63,63,63** | 63,63,63（±0） |
| t=2.0s | 1.0（白） | YUV(235,128,128) → **255,255,255** | 255,255,255（±0）|

两条独立证据说明**没有系统性偏色**：

```sh
# ① 我们推给 ffmpeg 的 NV12 vs 成片里解出来的 NV12（编码器只该带来 ±1 级损失）
node out/_probe/check-nv12-encode.mjs   # Y max 0 / UV max 1；有符号均值 ≤0.03 码值
# ② 同一静态帧（promo t=45s，samples=8，与交付版同参数）
#    新路径跑两次 = 逐字节相同（max 0）⇒ 链条是确定的
#    新 vs 旧（交付版 promo.mp4 第 2700 帧）：Y/U/V 平均差 1.72 / 0.79 / 0.85，
#    **有符号均值 −0.06 / −0.08 / +0.02 码值 ⇒ 无偏色**，差别就是色度核 + 编码器分配抖动
node out/_probe/ab-old-new-encode.mjs out/promo/promo.mp4 out/_nv12test/promo_45.mp4 2700 0
```

### 17.3 这一轮踩到的坑（值得记）

1. **`uniform int` + `Pass` 的数字 uniform = 静默失效**：`Pass` 对数字一律走 `uniform1f`，
   而我第一版把 `mode` 写成了 `uniform int mode;` ⇒ `uniform1f` 报 INVALID_OPERATION、
   **mode 永远是 0**，两个平面都渲染成亮度面 —— 色度整片错，而**渲染、check、hashes 全看不出来**
   （它们都不走这条编码路径）。是 `probe-nv12` 第一天就抓到的（>3 的字节正好占 33.33% = UV 平面）。
   → 教训：**新的交付格式必须有独立的量具**，否则"错得整整齐齐"没人发现。
2. **色彩标记要钉住**：原来 RGBA 输入时，swscale 会把输出帧的 range 标成 limited；
   换成 NV12 输入后没有 range 元数据，不显式 `range=limited` 就可能被按全范围打标 ——
   那个错误的症状是"整片对比度变了"，而**渲染侧一切正常**。
   `ffprobe -show_entries stream=color_range,…` 现在是验收的一部分（实测 `color_range=tv`）。
3. **量具自己先错了一次**：对照脚本一开始把 NV12 与 `-pix_fmt yuv420p`（平面格式）逐字节比，
   得出"一半色度字节差 14"的假警报 —— 平面 vs 半平面布局不同，比之前必须先对齐格式。

### 17.4 老片子怎么办

**什么都不用做**：nekohome / fidus / beast / promo / demo / beat 的成片已经出过了，不会因此改变；
`hashes` 基线量的是**渲染结果**（浏览器侧 `readPixels`），也不受影响。
换的是"以后出片"的那条路。

---
