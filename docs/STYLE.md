# STYLE.md —— 风格系统与「反审美疲劳」

> **一句话**：引擎以前只有**一张脸**，于是每一支片子长得都像上一支。
> 现在 `task.config.mjs` 里写一行 `style: 'paper'` 就换一张脸。
> 这份文档写清楚**有哪些脸、怎么挑、合并规则是什么、以及怎么让相邻两支片子的脸不一样**。
>
> 实现在 [`src/style/index.js`](../src/style/index.js) —— **API 与字段以它为准**，本文只是它的说明书。
> 相关：[`docs/CAPTIONS.md`](./CAPTIONS.md)（字幕层与信息分工）·
> [`docs/SCENE-BRIEF-TEMPLATE.md`](./SCENE-BRIEF-TEMPLATE.md)（分镜写作规范）·
> `docs/ENGINE.md` §2.2（坐标与单位）/ §3.3（`ctx.style` `ctx.grid`）· `docs/history/IMPROVEMENTS-4-5.md` §4 / §5 / §7 · `AGENTS.md` §2 / §10。

> **📌 实现状态**（写这份文档时逐条对着代码核过，**全部已落地**）：
> `src/style/index.js`（`STYLES` / `resolveStyle` / `gridFor` / `listStyles`）·
> `task.config.mjs` 的 `style:` 接线（`src/tasks.js`）· `node scripts/anim.mjs styles` ·
> `node scripts/anim.mjs still <任务> -t … --style <名字>`（临时覆盖，不改文件）·
> `worldPass(ctx, { motif })` / `motif: 'auto'`（`src/kit/world.js`）·
> `src/core/captions.js` / `src/kit/bands.js` / `anim subs` / `lint-narration-dup`。
> 字幕 `karaoke` 的默认值曾与 `src/core/captions.js` 漂移过（本文写第一版时抓到），**现已核实一致**：
> 四套风格与引擎默认**都是 `false`**，由 `tools/test-style.mjs` 的断言守着 —— 见 §5 末尾。

---

## 1. 为什么有这份文档：一次审计的四条结论

起因是用户的原话：**「视频风格似乎被定死了……这样下去容易让观众审美疲劳」**。
顺着这句话往回查，查出四件事，都指向同一个病根 —— **没有一个叫「风格」的一等公民**：

| # | 查到的事实 | 证据 |
|---|---|---|
| 1 | **8 个老镜头模板是两支片子场景的逐像素冻结副本**（2026-10-16 新加的 `quote` / `counter` / `compare` 是新写的，不受这条约束） | `src/shots/title.js` `kinetic.js` `whip.js` `outro.js` `chart.js` 头部注释都写着「绘制代码从 `tasks/demo/scenes/<名字>.js` **逐字**搬过来」；`wave.js` ← `tasks/beat/scenes/intro.js`，`pulse.js` ← `beat/scenes/pulse.js`，`grid.js` ← `beat/scenes/grid.js`。`src/shots/index.js:24–25` 把这条写成了设计意图：「模板里的绘制代码是从已经出过片的场景逐字搬过来的，画面逐像素一致」 |
| 2 | **默认调色板就是 `tasks/pdoom-lab` 那一支的配色** | `src/core/palette.js:4`：「默认是 pdoom 那种印刷品配色：墨黑 + 骨白 + 信号橙」 |
| 3 | **三份入口文档印着同一段起手场景** | `README.md:121`、`AGENTS.md:148`、`docs/COOKBOOK.md:339` 三处都是 `type.write('写代码，就是做动画', 100, 400, {…})`（`docs/ENGINE.md:324` 是同一段的变体）。新人照抄的就是它 |
| 4 | **分镜规范直接把「照抄」写成纪律** | `out/_staging/SCENE-BRIEF.md` §3 标题原文：「视觉语言（全片统一，**照这个来，不要自创**）」 |

结论：问题**不在「调色板不能换」**（`task.palette` 一直能覆盖），而在**换风格要自己拼五六样东西**
（色板、字体、背景母题、后处理基线、版面栅格、字幕样式），而且**没有任何一处文档鼓励你换** ——
于是所有人都照抄同一份示范。

第 1、2 条本来是**正确**的工程决定（不许悄悄改变老任务的画面；验收：`anim hashes demo --baseline`），
但叠加起来就变成了"风格被定死"。**所以这份文档的意义**：把"换个风格"从要拼六样东西的事变成**一行**，
再把"换"写成纪律（§6）。

---

## 2. 怎么用

```js
// tasks/<任务>/task.config.mjs
export default {
  title: '我的片子', width: 1920, height: 1080, fps: 60, scale: 1,
  style: 'paper',                       // ← 就这一行
  // 也可以写成对象：{ name: 'paper', grid: { pad: 160 }, post: { grain: 0.06 },
  //                  motif: 'scan', captions: false }
  timeline: [ /* … */ ],
};
```

`resolveStyle()` 只认这几种写法：

| 写法 | 结果 |
|---|---|
| 不写 / `null` / `undefined` | `print`（= 引擎从前的默认观感，**老任务一像素不变**） |
| `'paper'` | 取 `STYLES.paper` 整包 |
| `{ name: 'paper', … }` | 取 `STYLES.paper` + 局部覆盖（`palette` / `fonts` / `post` / `grid` / `captions` / `motif`） |
| `style: false` | **显式关掉整个风格系统**（返回 `null`，老行为的保险绳） |

风格名写错会抛错，报错里列出全部可用名字：

```
未知的风格 "papper"。可用的：print / blueprint / paper / terminal / noir
（看说明：node scripts/anim.mjs styles）
```

```sh
node scripts/anim.mjs styles        # 列出 name / label / 背景母题 / note / 三个主色

# 不改文件就能看效果（临时覆盖 style）—— 选风格最省事的办法：
node scripts/anim.mjs still _style-sampler -t 1.8,6,9.6 --style paper
node scripts/anim.mjs still _style-sampler -t 1.8,6,9.6 --style noir
```

`tasks/_style-sampler/` 就是为这件事建的：同一段画面在几套风格下各长什么样，一眼比出来，
比读五个 `note` 快得多。**优先级一句话**：`style: false` > 任务里单独写的字段 > 风格包 > 引擎默认（§5）。

---

## 3. 基础六套，各自适合讲什么

> 下表 `label` / `note` **原样抄自** `src/style/index.js` 的 `STYLES`，一个字没改。

| 名字 | label | 一眼特征（ink / bone / signal） | 母题 |
|---|---|---|---|
| `print` | **印刷品** | `#0a0a0b` 墨黑 / `#eee9df` 骨白 / `#ff4d12` 信号橙（= `DEFAULT_PALETTE`） | `grid` |
| `blueprint` | **蓝图 · 工程图** | `#061726` 深蓝 / `#e6f2fb` 近白 / `#4fd0ff` 青 | `blueprint` |
| `paper` | **纸面 · 反色** | `#f3f0e7` 米白 / `#1b1a17` 墨黑 / `#c8381b` 朱红 | `paper` |
| `terminal` | **终端 · 磷光** | `#030704` 纯黑 / `#c6ffd9` 淡绿 / `#3dff88` 磷光绿 | `scan` |
| `noir` | **黑白电影 · 单点琥珀** | `#08080a` 近黑 / `#ffffff` 纯白 / `#ffb020` 琥珀 | `noir` |
| `flat` | **纯色摄影棚 · 无母题背景**（2026-10-25 新增） | `#0b0c0f` 冷青近黑 / `#f7f4ec` 纸白 / `#ff4d12` 信号橙 | `flat`（**不画母题**） |

**适合讲什么**（`note` 原文）：

- **`print`** —— 「墨黑纸面 + 骨白正文 + 单一信号橙。引擎从前的默认观感；不写 style 就是它，适合"信息密度高的技术讲解"。」
- **`blueprint`** —— 「深蓝坐标纸 + 白描线 + 青色标注。适合讲结构、管线、坐标与"这东西怎么拼起来"。」
- **`paper`** —— 「米白纸面 + 墨黑正文 + 朱红强调 —— 把 ink/bone **反过来**，整片立刻从"屏幕"变成"纸"。适合科普、说明、任何想让观众"读得下去"的长片。」
- **`terminal`** —— 「纯黑 + 磷光绿 + **全片等宽字**。适合讲代码、日志、协议、命令行 —— 一眼就是"机器在说话"。」
- **`noir`** —— 「近黑 + 纯白 + 一点琥珀，重暗角、强颗粒、宽边距。适合讲事故、真相、'当时到底发生了什么'。」

**怎么挑（经验，不是规则）**：先问"这支片子要观众**读**还是要观众**看**"。
要读 → `paper`（浅底、低泛光、颗粒给足）；要看结构关系 → `blueprint`；机器/协议/代码 → `terminal`；
叙事/调查 → `noir`；其余 → `print`。

**差异是刻意做大的**（原话：「每一条都刻意做得**差异明显**（底色明暗、字体介质、背景母题、栅格宽窄都不同）
—— 换了风格必须一眼看得出来」）。实测：`pad` 84（terminal）/ 120（print・blueprint）/ 140（paper）/ 160（noir）；
`top` 92 / 76（terminal）/ 110（noir）。

**字幕样式各风格怎么微调** —— `CAPTIONS_BASE` **直接引用** `src/core/captions.js` 的
`DEFAULT_CAPTION_STYLE`（`const CAPTIONS_BASE = { ...DEFAULT_CAPTION_STYLE }`），
四套风格只在它上面改"长什么样"的几项：`blueprint` `size 42 / bg 0.44`；
`paper` `size 46 / bg 0.0 / dim 0.5`；`terminal` `size 40 / bg 0.62 / weight 500`；
`noir` `size 44 / weight 500 / bg 0.34`。
**其余默认值只有一处定义**（`hold` 1.06 / `fade` 0.16 / `karaoke` false / `maxCharsPerLine` 16 /
`maxLines` 2 / `position: 'top'`），由 `tools/test-style.mjs` 的断言钉住 ——
同一默认值再写在两个地方会当场红。

## 3.1 版式风格（2026-10-30 新增 11 套：`src/style/panels.js`）

> 来源：用户提供的**风格素材包**的 H 系列（12 套「配色 + 字体」整套搭配）。
> 素材包只给了一句话配方，这里把它换成引擎字段。出处与许可：`docs/REFERENCE-style-pack.md`。

**为什么加这一批**：原有 21 套里**浅底纸面只有 `paper` 一套**（米白 + 宋体）。散文 / 杂志 /
说明类内容连着做两支就必然撞脸 —— 这一批补的正是这一格：暖羊皮纸、奶油糖果色、钴蓝网格、
工业报纸。九套的共同点是「浅底 + 一两个强调色 + 一套衬线或无衬线」，一套约 20 行。

| 名字 | label | 底色 / 正文 / 强调 | 母题 | 字体介质 |
|---|---|---|---|---|
| `h-biennale` | 版式 · 双年展黄 | `#f2e7cf` / `#20263f` / `#e8a33d` | `paper` | 中文宋体 |
| `h-blockframe` | 版式 · 粗黑框 | `#f7f4ec` / `#111111` / `#ff5a36` | `flat` | 中文黑体（Bahnschrift） |
| `h-blue` | 版式 · 钴蓝 | `#f4f1e8` / `#152238` / `#1f4fd8` | `blueprint` | 中文黑体 + 宋体副 |
| `h-coral` | 版式 · 珊瑚 | `#fdf6ec` / `#2a2118` / `#ff6b5a` | `flat` | 中文黑体 |
| `h-forest` | 版式 · 森林编辑 | `#f3f1e6` / `#1b2b21` / `#c94f6d` | `paper` | 中文宋体 |
| `h-broadside` | 版式 · 工业报纸 | `#efe8d8` / `#181613` / `#e2571f` | `paper` | 中文黑体 + 宋体副 |
| `h-cartesian` | 版式 · 极简留白 | `#fbf9f3` / `#14130f` / `#8a6a3a` | `flat` | 中文黑体（留白版） |
| `h-capsule` | 版式 · 胶囊糖果 | `#fffaf1` / `#231b14` / `#ff4f8b` | `flat` | 中文宋体标题 |
| `h-poster` | 版式 · 大字海报 | `#fdf3e6` / `#1c1610` / `#e01f28` | `paper` | Georgia 衬线（中文回退宋体） |
| `h-riso` | 版式 · 双版套印 | `#f4ecda` / `#1b2a4a` / `#d0472a` | `paper` | 中文黑体（**`view: halftone` 双版套印**） |
| `h-vhs` | 版式 · 录像带 | `#0d1418` / `#e8f2f4` / `#ffb454` | `scan` | 中文黑体（**`view: crt` + 磨损三件套**） |

**后两套是 2026-10-30 晚新增的「介质」示范**（`style.view` 与 `post.weave/flicker/scratch`）：
它们不只换配色与字体，还让**整片**换一种成像方式 —— `h-riso` 整片印成双版套印（版面照旧），
`h-vhs` 整片过 CRT 荫罩 + 胶片磨损。**其余 30 套都没写 `view`，所以一个像素都不变**（见 §4.2）。

**怎么挑**：

- 要给合作方看的方案 / 结论 → `h-blue`（最「可信」的一套）；
- 文化 / 展览 / 年度回顾这类要体面的 → `h-biennale`；
- 有引文、有出处、有旁白的长段 → `h-forest`（杂志感）；
- 通告 / 声明 / 数字很强 → `h-broadside`；
- 一屏只想放一件事（封面帧、金句）→ `h-poster`；
- 内容本身要占满注意力 → `h-cartesian`。

⚠ **它们和 `paper` 一样是浅底**，所以 §8 那条「浅底不是安全的」照旧适用：场景里任何高 `bloom`、
`mul(col, 1.6)` 的发光写法都会在浅底上糊掉。九套的 `post.bloom` 已经压到 0.05–0.12。

⚠ **`chart` 这类模板在浅底风格下会反相**（模板刻意用 `P.bone` 当纸、`P.ink` 画柱，
见 `src/shots/chart.js` 的注释 —— 那是设计意图，不是 bug）。浅底风格配图表要手写场景，
或者接受「纸面上的深色图表」这个观感。**标题 / 大字 / 片尾这几类模板不受影响。**

出对比图（不改任何文件）：

```sh
node scripts/anim.mjs still _style-sampler -t 2.4 --style h-biennale
node scripts/anim.mjs still _style-sampler -t 2.4 --style h-poster
```

---
---

## 4. 风格包里有什么：八个字段

> 这张表**对照 `src/style/index.js` 顶部那张表**写成；"谁读它"一列就是接线点。

| 字段 | 管什么 | 谁读它 |
|---|---|---|
| `palette` | 色板（**只写要覆盖的键**，与 `DEFAULT_PALETTE` 合并） | `src/core/palette.js` → `ctx.P`、以及注入每个 shader 的 GLSL 常量 `C_INK` `C_BONE` `C_SIGNAL`…（`P.glsl()`） |
| `fonts` | 字体栈（覆盖 `src/core/text.js` 的 `FAMILIES`，键 `sans` / `mono` / `serif`） | `TextKit.font()`。例：`terminal` 把 `sans` 和 `serif` **都**设成等宽 |
| `post` | 后处理**基线**（泛光/颗粒/暗角/色差…，字段见 `AGENTS.md` §5 与 `docs/ENGINE.md` §8） | `src/core/engine.js` 的 `post` 合并 |
| `grid` | 版面栅格：`pad` `top` `footerLineY` `footerY` `captionLineY` `captionY` `contentBottom` `captionBand` | `src/kit/bands.js` 的 `bands()` + 字幕层（条带含义见 [`docs/CAPTIONS.md`](./CAPTIONS.md) §4） |
| `gridPortrait` | **竖屏栅格**（1080×1920 基准）：默认 = `GRID_PORTRAIT`（`pad 88` / 字幕带 `[1180,1344]` / `footerY 1622`）。`H > W` 时由 `fitStyleToFrame()` 换上来，按短边（宽）缩放 | `src/style/index.js` 的 `fitStyleToFrame()` → `ctx.grid`、字幕带、kit 条带。见 [`docs/LAYOUT.md`](./LAYOUT.md) §6.5 |
| `captions` | 字幕样式：`position` `size` `weight` `maxCharsPerLine` `maxLines` `bg` `padX` `padY` `lineHeight` `hold` `fade` `karaoke` `dim` `color` `sungColor` | `src/core/captions.js`。⚠ **`print` 的这一项是 `false`**（这套风格默认不开字幕）；其余四套 = `{ ...DEFAULT_CAPTION_STYLE, 各自的微调 }`（微调值见 §3 末尾） |
| `motif` | 背景**母题名**：`grid` / `blueprint` / `paper` / `scan` / `noir` / `flat`（纯色，不画母题） | `src/kit/world.js` 的 `worldPass`（`motif: 'auto'` 时读 `ctx.style.motif`） |
| `tokens` | **设计 token**：字号阶梯 / 线宽三档 / 动效配方 / 边距 / 质感（2026-10-25 起，来自 `src/style/tokens.js`） | `ctx.style.tokens`（场景读它：**写 `size: T.type.hero` 不写 `size: 24`**）；**`type.write` 的语义字号**也读它（见 §4.1）。纯被动字段，老任务不变 |
| `view` | **整片介质**（2026-10-30，默认 `null` = off）：把 `src/kit/views.js` 的九种成像之一提成这套风格的默认观感 —— `'halftone'` 字符串，或 `{ mode, cell, passes, misreg, paper, ink, accent, … }`。`halftone` 加 `passes: 2..4` = **N 版套印**（riso），`crt` = 录像带 | `src/style/index.js` 的 `resolveView()`（模式名写错**当场抛**）→ `src/core/engine.js` 在「全部段合成完 → post 之前」把整帧换成像。**字幕画在后处理之后，所以字幕永远清晰** |

### 4.2 整片介质 `view`：什么时候用、什么时候别用（2026-10-30）

风格包写一行 `view`，**整支片子**（含模板段、图表、刻度、页脚）都会被换成那种介质：

```js
// 在风格包里：
view: { mode: 'halftone', cell: 6, passes: 2, misreg: 2.2 },
// 或者任务里临时给某套风格加（不动风格包本身）：
style: { name: 'paper', view: 'halftone' },
```

三条纪律：

1. **它是「片子是什么做的」，不是「这个镜头长什么样」** —— 介质级决定才写在这里；
   某一个镜头想换介质，继续用场景里的 `instrumented()`（`docs/COOKBOOK.md` §16）。
2. **字多的片子慎用半调 / CRT**：网点与扫描线会吃掉小字。测试方法只有一条 ——
   出单帧看（`node scripts/anim.mjs still <任务> -t 12`），别只看缩略图。
3. **浅底风格要显式写 `paper` / `ink`**：`halftone` 默认取调色板的 `bone` 当纸、`ink` 当墨，
   而浅底风格里这两个角色是**反的**（`ink` 才是纸色）—— 不点名就会整屏反相（黑纸白点）。
   `h-riso` 就是这么写的，照抄即可。

### 4.1 语义字号：`size: 'hero'`（2026-10-25 落地）

`type.write` / `writeLine` / `karaoke` / `wrap` / `paragraph` / `writeOnPath` 的 `size`
除了像素数，也接受**名字**：

```js
type.write('把方波拆开', 140, 330, { size: 'hero', weight: 800, color: css(P.bone) });
type.write('FOURIER · 4 项', 140, 176, { size: 'label', family: 'mono', color: css(P.ash) });
```

阶梯六档：`hero` / `h1` / `h2` / `body` / `label` / `mono`（`src/style/tokens.js` 的 `TYPE_SCALE`）。
取值来自**这套风格的** `ctx.style.tokens.type`（引擎在 `applyStyleFonts()` 里下发到每个图层的
`TextKit`），所以同一份场景换 `--style` 之后层级还在、只是整体尺码跟着介质走：

| 风格 | `hero` | 为什么 |
|---|---|---|
| `print`（= 默认） | 136 | `tokens.js` 的基线 |
| `blueprint` | 120 | 工程图的口吻偏"密"，标注要留得住细节 |
| `paper` | 128 | 宋体字面小，正文 42 / 标注 26 给回来 |
| `terminal` | 112 | 等宽字窄，整套收一档；错峰 0.05（刷屏节奏） |
| `flat` | 136 | 纯色摄影棚，直接吃默认 |
| `noir` | 152 | 电影感 = 更少、更大的字；hero 字重 900 |

三条规矩（写错了**直接抛**，不静默回落）：

1. **名字拼错就报错**：`size: 'heor'` → 报错里列出可用名字。回落成 64 才是最贵的错法。
2. **数字仍然合法**：`size: 24` 原样通过 —— 120 个老场景一个像素都不变。
3. **一屏只有一个 `hero`**（§1 的硬规则）：其余最多 `h2` + `label`。

验证：`node tools/test-tokens.mjs`（38 项，纯 JS）；样片
`node scripts/anim.mjs still _token-lab -t 6.5 --style <名字> --out out/_token-lab/styles/<名字>`
（六套各一张，`out/_token-lab/styles/_sheet.png` 是 3×2 接触表）。

**竖屏（1080×1920，BACKLOG 1-52）**：同一套语义字号会**自动 ×1.35**（`PORTRAIT_TYPE_SCALE`）。
理由：横屏与竖屏的短边都是 1080，按短边算比例本该一样；但竖屏画面高 1920，一行 136px 的字
只占高度的 7%（横屏 12.6%），**看起来就是更小**。实测 1.0 / 1.2 / 1.35 / 1.5 四档对比后取 1.35
（1.5 时标题吃掉半屏）。线宽跟着放大，**字重 / 错峰 / 颗粒不放大**（与画幅无关）。
场景侧一行都不用改 —— 引擎在 `load()` 里调 `fitStyleToFrame()` 换栅格与字号：
`node tools/test-portrait.mjs`（39 项）盯着"横屏原样返回同一个对象"这条底线。


另外两个导出：**`gridFor(style, W, H)`** —— 按逻辑分辨率缩放栅格。`grid` 里的数字都是 **1920×1080 基准**；
`H === 1080` 时**直接返回原对象**（4K 的 `scale: 2` 也不算，因为引擎的 `W/H` 一直是逻辑像素），
只有任务自己把 `height` 写成非 1080p 时才需要它。**`GRID_BASE` / `CAPTIONS_BASE` / `SANS` / `MONO` / `SERIF`**
—— 默认值本体；⚠ `CAPTIONS_BASE` 现在是 `{ ...DEFAULT_CAPTION_STYLE }`，只是转发引擎那一份（见 §3 末尾）。

**场景里直接可读的三个字段**（完整字段表见 `docs/ENGINE.md` §3.3）：
`ctx.style`（= `resolveStyle()` 的结果：`{ name, label, motif, palette, fonts, post, grid, captions }`）·
`ctx.grid`（**已按分辨率缩放**的风格栅格 —— 别在场景里再写 `120` / `964` 这类魔数，`bandsOf(ctx)` 读的就是它）·
`ctx.P`（调色板，线性值；颜色已经通过它生效了）。

---

## 5. 合并优先级（**写之前想清楚**）

三层，从低到高：引擎默认（`DEFAULT_PALETTE` / `FAMILIES` / `GRID_BASE` / `CAPTIONS_BASE`）
→ 风格包 `STYLES[name]` → 任务里单独写的（`task.palette` / `task.post` / `style` 对象的覆盖 / 时间线段上的 `post`）。

`resolveStyle()` 是**逐字段浅合并**（`{ ...pack.palette, ...over.palette }`）：
**风格包里写了、你没写的键 = 继承风格包**；都没写 = 引擎默认。三条容易踩的：

1. **任务里单独写的 `palette` / `post` 覆盖风格包里的同名项** —— "用 `paper` 但主色换掉"的正确姿势：
   `style: 'paper', palette: { signal: '#1f6f9c' },`（纸面 + 靛蓝重点，其余继承 `paper`）。
2. **风格包的 `post` 会覆盖镜头模板 `return` 的同名键** —— 也就是说 `post` 不是"建议值"而是
   **介质属性**：`paper` 把 `bloom` 压到 0.06（注释原话：「浅底最怕泛光：bloom 一高整片就糊成一片白」），
   某个模板 `return { bloom: 0.4 }` 在 `paper` 下也会被压回 0.06。
   **想在这一段破例就写在时间线的 `post` 上**（段级 `post` 优先级最高）。
   写之前问一句：**"这是这一段的需要，还是整片介质的需要？"**
3. **`captions: false` 是特例** —— 它要能**覆盖掉**风格包里的字幕样式，而不是被 merge 成对象
   （`resolveStyle()` 里专门有一条注释处理这件事）。

**不写 `style` = `print`，而 `print` 的定义就是"引擎从前的默认观感"**
（色板 = `DEFAULT_PALETTE`、字体 = `FAMILIES`、`post` = 空、`motif` = `grid`、**`captions` = `false`**）。
老任务写了 `style` 与否**画面一个像素都不该变**：`node scripts/anim.mjs hashes <老任务> --baseline`。

> **字幕 `karaoke`（"唱到哪亮哪"）默认是 `false` —— 四套风格与引擎默认一致。**
> 依据是一项对照实验：它研究的正是"**偶尔出现的关键词**"这类字幕增强，方向是关键词突显对学习不利
> （Cojean & Martin 2021，*L'Année psychologique* 121(4):417-442，DOI 10.3917/anpsy1.214.0417；
> ⚠ 我们只核到书目信息与标题，**样本量未核实**，细节见 [`docs/CAPTIONS.md`](./CAPTIONS.md) 附注）。
> **要开只能显式写**：`captions: { karaoke: true }`。
> 这条默认值由 `tools/test-style.mjs` 的断言守着（`node tools/test-style.mjs` 可复现），
> 未来再漂移会被它抓到 —— 更详细的口径见 [`docs/CAPTIONS.md`](./CAPTIONS.md) §3.4。

---

## 6. 两条纪律（这份文档真正的目的）

### 纪律一：一支片子只用一套风格

片内一致才有"成套"的感觉 —— 这是原来那条「一套颜色 + 一套字体 + 一种颗粒贯穿全片」里**正确的部分**，保留。
`style` 写在 `task.config.mjs` 的顶层（不是每个 `cut()` 上），就是为了让这件事在结构上难以违反。
**唯一允许的例外**：某一段需要"换介质"来讲一个特殊的东西（例如整片是 `print`，但有一段就是一台终端）
—— 做法是在那一段的 `post` 上写，**不要**换 `palette`（换色板会把"这套片子的身份色"打散）。

### 纪律二：风格由内容决定，连做两支同题材时再考虑换脸（建议，不是门）

观众记住的是"**你的片子长什么样**"。这条纪律的存在是因为有一段时期每支片子都是
"11 个模板 + 默认调色板"的冻结副本，观众产生了"又是这个味"的疲劳。
但它是**建议**、不是门：风格应该**由这支片子的内容决定**（科普、产品、MV 各有各的合适脸），
连做两支同题材的片子时再拿下面四项自查 —— **没有"必须换几项"的硬性要求**：

| # | 自查项 | 字段 | 例子 |
|---|---|---|---|
| ① | **主色 / 介质** | `style` 名（连带 `palette.ink`/`bone`/`signal`、浅底↔深底） | `print` → `paper` |
| ② | **字体** | `style` 自带（`terminal` 是等宽），或 `style.fonts` 覆盖 | `sans` → `serif` 标题 |
| ③ | **背景母题** | `style.motif` | `grid` → `blueprint` |
| ④ | **每段的视觉主角** | 不在风格包里，写在分镜 brief | 上支是方块世界，这支是管线图 |

第 ④ 项不在风格包里，但**最容易造成"同味"**：即使颜色字体全换了，如果每段的视觉主角
还是"一叠方块 + 一个面板"，观众仍然觉得是同一支片子 —— 这一项值得每支片子都想一想。

> **用法**：开新片子时先想"这支片子该长什么样"（由内容决定）；如果答案是"和上一支一样"，
> 而两支又是连着发布的同系列，再对照四项看看是否要换。**不强制、不写进交付自检**。

---

## 7. 反审美疲劳：节奏建议（**先说证据强度**）

> 每条都标了证据强度：**【研究】**= 有同行评审论文、样本量、方法学；
> **【从业者测量】**= 有人一条条量过片子，但样本是**挑出来的成功案例**、**不是受控实验**；
> **【从业者经验】**= 没有数据，行业里反复出现的说法，**当假设用**。
> 另外：下面几条研究的被测对象是真人实拍视频（有脸、有人声），我们的片子是**纯代码生成的说明动画**，
> 迁移时**要打折，不要照抄数字**。

### 7.1 【研究】剪辑会改变观众对"时长"的感受

Kovarski 等 2022（*Scientific Reports* 12, 20084；**研究 1：90 人；研究 2：60 人预注册复现**）
用《红气球》45 个片段（连续剪辑 / 动作不连续剪辑 / 无剪辑 × 2000/2500/3000 ms）让被试判断或复现时长：

- **含"连续剪辑"的片段被感知为更长**（比另外两类都长）；
- **含"动作不连续剪辑"的比"无剪辑"更长**。

来源：[Movie editing influences spectators' time perception](https://hal.science/hal-04004294v1)
（DOI [10.1038/s41598-022-23992-2](https://doi.org/10.1038/s41598-022-23992-2)）·
**【研究】**（我读到了摘要全文；局限：实拍片段、每段只有 2–3 秒）

**怎么用**：同样 20 秒，**有一个切点或一次视角变化的版本，观众会觉得"内容更多"**；
反过来，一段 20 秒完全不动的画面会被感知得"又长又空"。但**不要**读成"切得越多越好" ——
它测的是**感知时长**，不是留存率。

### 7.2 【从业者测量】长片的宏观节奏：**每 20–40 秒换一次版面**

对 **22 支头部视频**（13 支短视频 + 9 支长视频，Ali Abdaal / Hormozi / Diary of a CEO /
Cleo Abram / MKBHD / Fireship）逐帧反推的测量：

| 层级 | 数字 |
|---|---|
| **微观**——镜头长度 | 中位数 **3–6.5 秒**；每分钟 **7–13 次视觉变化**（快的 Fireship 13.3 次/分，慢的 Ali 7.7–9.3 次/分） |
| **宏观**——版面轮换 | **每 20–40 秒**换一次版面 ← **「每 20–40 秒一次视觉换气」的出处** |
| **静帧红线** | 「任何 60 秒毫无视觉变化的段落」= 留存洞；短视频侧更严：「8 秒以上的静帧就是留存洞」 |
| **开头** | 长视频**论点 10 秒内说出来**，片头在 **24–72 秒**内结束（≤ 全片 6%） |
| **收尾** | 全片**唯一**一次 30–60 秒的长静止放在 **72% 之后**的结论处；没有"感谢观看"式片尾 |

来源：[The 7 laws of retention editing (from measuring 22 top videos)](https://www.writepanda.ai/blog/retention-editing-7-laws/) ·
**【从业者测量】**（作者自陈局限：22 支是**挑出来的**高表现视频、长片只有 3 个频道、观察性数据、**不是 A/B**）

**怎么用**：我们的片子"一段 = 一个镜头"，段长通常 15–27 秒，正好落在**一次换气**的尺度上。所以：

- **不要让所有段一样长** —— 段长本来就由旁白决定（`docs/NARRATION.md`），天然有段级变化；
- **每一段内部**至少一次"版面换气"：世界压暗 → 面板上台 / 面板退场 → 世界回来 / 新元件入场
  （两层分工的参考实现见 `out/_staging/SCENE-BRIEF.md` §3.3）；
- **同屏元素要少**：这与用户对上一支片子的批评（「各种建模可能有点杂乱」）是同一件事。
  `docs/history/IMPROVEMENTS-4-5.md` §7 给了可验证的翻译法：① 同屏元素太多 → 数元素 ② 物件读不出体积 →
  查面朝向 ③ 没有主角 → 定 hero；
- **60 秒零变化的红线**我们很少触到，但**一段内部 20 秒零变化**很常见 ——
  `node scripts/anim.mjs sheet <任务> --from 0 --to 12 -n 16` 扫一遍就看出来。
  ⚠ 渲染期间不要写任何文件（`AGENTS.md` §7），所以 `sheet` 只能由主代理串行跑。

### 7.3 【从业者测量】"同屏两块字"是被明确点名的失败模式

同一份测量把它写成 Law 6 "Zoning"：

> 「22 支视频里，**图形从不盖住脸**，而且**同一时刻两块文字从不占用同一个区域**」
> 「**先把字幕带选好，然后让全片每一个图形都避开它**……字幕带是整片保留的空域」

**怎么用**：这正是 [`docs/CAPTIONS.md`](./CAPTIONS.md) 要解决的问题（观众说「两条字幕同时出现……
看着好迷糊」）。**"字幕保留带"不是我们自己发明的洁癖，它是被量出来的行业做法。**

### 7.4 【从业者测量】长片**不烧**逐句字幕（与我们的默认值一致）

同一组人对 9 支长视频的 **502 帧**做视觉分类：**0/502 帧**含逐句字幕；而 13/13 支短视频**全程带字幕**。

> 「逐句字幕条会把'注意力通道'花在**冗余**上 —— 关键词弹字之所以有效，正是因为屏幕上没有已经写满字。」
> 「文字要回答的是'**观众此刻该记住/该看什么**'，不是'**此刻在说什么**'。」

来源：[We measured 9 top YouTube videos. None of them burn captions.](https://www.writepanda.ai/blog/youtube-videos-dont-burn-captions-study/) ·
**【从业者测量】**（n=9 / 3 个频道；作者写明是观察性数据、不能说明改了会怎样）

**怎么用**：本引擎的字幕层**默认关闭**（`print` 的 `captions` 就是 `false`），与这条一致。
中文技术科普静音自动播放占比高，打开字幕层常常是对的；但**打开之后画面文字必须从"复述"退回到"标注"**
—— 否则就是在一个屏幕上同时付两份冗余的注意力成本。**"要不要字幕"和"画面能不能再复述一遍"是两个独立决定。**

### 7.5 【从业者经验】几条没有数据支撑的常见说法

当假设用，不要当结论用：「每 8–10 秒要有一次 pattern interrupt」（与 7.2 的"8 秒静帧红线"听起来
是一回事，但**样本和方法都不同，不要互相引证**）；「观众在 30 秒处、2 分钟处会掉一波」（平台后台能看到，
公开数据里没有可复核版本）；「一支片子最多用 3 种强调手段」（7.2 的 Law 4 有接近的说法，但那是短视频侧，
**推广到长片是我的推测**）。

### 7.6 【未核到】几条我没能读到原文的（别当结论引用）

- **Cutting 等 2011《Quicker, faster, darker: Changes in Hollywood film over 75 years》**
  （*i-Perception*，DOI [10.1068/i0441aap](https://doi.org/10.1068/i0441aap)，
  [PubMed 23145246](https://pubmed.ncbi.nlm.nih.gov/23145246/)）—— 方向（75 年间好莱坞镜头变短、
  画面变暗、运动变多）到处被引用，但 PubMed / DOAJ / ScienceOpen **三个站点都拒绝抓取**，
  **具体秒数我没核到原文，所以本文一个数字都不写**。
- **镜头长度的统计分布是重尾的**（[有人用三参数 Dagum 分布拟合好莱坞镜头长度](https://rivista-statistica.unibo.it/article/download/9910/11181)）
  —— 只读到检索片段，PDF 打不开。方向与纪律二同向，但**证据强度未核实**。
- **「重复曝光会让广告失效（wear-out）」** —— 营销学里是常识级说法，但我**没能打开任何可引用的原文**
  （还搜到一篇标题恰好相反的 [There Is No Such Thing as Creative Wearout](https://advertisingweek.com/aw360/news/there-is-no-such-thing-as-creative-wearout/20469/)，
  同样没读到正文）。**所以纪律二目前的依据是行业共识 + 用户的主观反馈，不是本文能引用的研究。**

### 7.7 落到流程里的四条（本节的可执行版）

1. **段不要等长** —— 本来就由旁白决定（`docs/NARRATION.md`），别再用"总时长 ÷ 段数"平摊。
2. **每段内部至少一次版面换气**，每 20–40 秒观众应该感到"换了个东西在看"。
3. **同屏元素要少** —— 一个镜头一个主角，其余压暗。压暗用**颜色**不用**透明度**
   （`docs/history/IMPROVEMENTS-4-5.md` §4.3：「**alpha 管'在不在'，tone 管'亮不亮'**」）。
4. **连做两支同题材的片子时，对照 §6 纪律二的四项清单想一想是否换脸**（建议；风格由内容决定，没有硬性数量要求）。

---

## 8. 能力边界（老实写）

`style` 换的是**介质**，不是**版面结构**。下面这几件事它做不到：

| 做不到什么 | 为什么 | 出路 |
|---|---|---|
| **A 档镜头模板的背景换不掉** | `src/shots/` 的 11 个模板**每个都自己铺满整帧**（`docs/ENGINE.md` §14.4：这是设计意图 —— 它们要"取一个整镜头"，不能依赖外面的背景）。所以 `motif` 只对**手写场景 + `world: 'auto'`** 那条路有效 | 换背景母题就**手写场景**（`makeShot`），任务里写 `export const world = (ctx) => worldPass(ctx, { motif: 'auto' })`；模板镜头就接受它自带的背景 |
| **模板的版面坐标是固定的** | 11 个模板的 x/y 是硬编码的（例如 `chart` 的柱子位置），`style.grid.pad` **不会**移动它们 | `style.grid` 只对 `src/kit/` 的版面元件（`bands()` / `captionNote()`）与字幕层生效；要换版面就手写场景 |
| **`paper` 这类浅底风格不是"安全的"** | 浅底最怕泛光（代码注释原文）。场景里任何高 `bloom`、`mul(col, 1.6)` 的发光写法都会在浅底上糊掉 | 用 `paper` 时把泛光留给**信号色**，正文一律不发光（`AGENTS.md` §5） |
| **`motif` 只有五档** | `MOTIF_ID` 里是 `grid` / `blueprint` / `paper` / `scan` / `noir`；名字不认识会落到第 0 档（`grid`），**不报错** | 要第六种母题就在任务自己的 `scenes/_world.js` 里写一个局部背景 Pass，让 `cut(shot, { world: … })` 用它 |
| **风格包不改变"事实纪律"与"确定性"** | 它只是一个数据对象 | 见 [`docs/SCENE-BRIEF-TEMPLATE.md`](./SCENE-BRIEF-TEMPLATE.md) §4 的分级 |

---

## 9. 交付前自检（风格相关）

1. `task.config.mjs` 里**写了 `style`**，而且是对象或字符串（写错名字会抛错）；
   风格与内容的匹配想过了（连做两支同题材时，对照 §6 纪律二的四项看过同味风险 —— 建议不是门）。
2. 老任务改完跑 `node scripts/anim.mjs hashes <任务> --baseline` —— **逐像素没变**
   （不写 `style` 就该等于 `print`）。纯逻辑回归：`node tools/test-style.mjs`。
3. 段与段之间**没有 20 秒以上的"零变化"**（`sheet` 扫一遍；⚠ 渲染期间不许写文件）。
4. 场景里**没有**用 `alpha` 承担"压暗"（那是 `tone` 的活，§7.7 第 3 条）。
5. 想快速看别的风格长什么样：`node scripts/anim.mjs still <任务> -t <时刻> --style <名字>`
   （**临时覆盖，不改文件**）。

**交叉引用**：[`src/style/index.js`](../src/style/index.js)（API 与字段的唯一来源）·
[`docs/CAPTIONS.md`](./CAPTIONS.md) · [`docs/SCENE-BRIEF-TEMPLATE.md`](./SCENE-BRIEF-TEMPLATE.md) ·
`docs/ENGINE.md` §2.2 / §3.3 / §8 / §14.4 · `docs/CONFIG-ONLY.md` · `docs/history/IMPROVEMENTS-4-5.md` §4.3 / §5 / §7 ·
`AGENTS.md` §2 / §3 / §3.2 / §4.5 / §5 / §10。
