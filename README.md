# anim · 确定性代码动画引擎

![写代码，就是做动画](docs/images/demo-title.webp)

**写代码就是做动画。它不是一个剪辑软件，也不是一个扩散模型 —— 画面是代码算出来的。** 没有图片素材、没有视频素材：每一个像素都由 WebGL2 着色器与几何实时算出来。导出时用无头 Chrome 逐帧渲染，ffmpeg 编码成 mp4。

这个项目是**为 AI agent 设计**的：`AGENTS.md` 是写给模型看的操作契约，它能自己读代码、渲染、看图、改，直到片子对为止。

```
文字/脚本 ──▶ 代码（JS + GLSL） ──▶ 浏览器里的实时渲染器 ──▶ 无头 Chrome 逐帧 ──▶ ffmpeg ──▶ mp4
                     ▲                                        │
                     └────────── agent 看图/看片再改 ◀──────────┘
```

架构参考 [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video)（那支用 Claude 做的《I'm Upping My P(doom)》MV）：核心思想是**每一帧都是时间的纯函数** `render(t)`，由此换来任意 seek、真运动模糊（多子帧求平均）、预览与成片逐像素一致。

---

## 快速开始

### 前置条件（先看一眼，缺一样都跑不起来）

| 需要什么 | 为什么 | 怎么确认 |
|---|---|---|
| **Node ≥ 20.10** | 引擎与 CLI 都跑在 Node 上 | `node --version` |
| **Google Chrome（官方版）** | ⚠ **必装**。`playwright-core` **不会**替你下载浏览器 —— 代码走的是 `channel: 'chrome'`，用的是**你系统里装好的官方 Chrome**。没装就是一句 "Chromium distribution 'chrome' is not found" | 打开 `chrome://version` 能看到版本号即可 |
| **ffmpeg 与 ffprobe** | 编码成片与核对产物。**两个都要，且都要在 PATH 里** | `ffmpeg -version` 和 `ffprobe -version` 都能打印 |
| **可用的 GPU / WebGL2** | 无头 Chrome 需要真的 WebGL2 环境；纯软件渲染（SwiftShader）会极慢甚至直接跑不起来 | `node scripts/anim.mjs gpu demo` 打印 GPU 信息（`gpu` 要求带上一个任务名） |
| **Python + `edge-tts` + 联网** | **只有做「带旁白/口播的片子」才需要**，用来跑 `anim say`。**不做旁白片的人完全不需要装** —— 别被这条吓退 | 见下方「旁白是可选的」 |

`ffmpeg` / `ffprobe` 不在 PATH 里的话，可以用环境变量分别指路径：

```sh
# Windows PowerShell
$env:ANIM_FFMPEG  = "C:\ffmpeg\bin\ffmpeg.exe"
$env:ANIM_FFPROBE = "C:\ffmpeg\bin\ffprobe.exe"
```

> ⚠ **`ANIM_FFPROBE` 不会从 `ANIM_FFMPEG` 推导出来**（`scripts/anim.mjs` 里是刻意这么写的，因为 `ANIM_FFMPEG` 允许是包装器命令）。只设了 `ANIM_FFMPEG` 而 ffprobe 不在 PATH 里，成片复核那一步会失败。

**旁白是可选的**：`anim say` 用 [edge-tts](https://github.com/rany2/edge-tts) 合成旁白，要联网调 Edge TTS，并且要用 `ANIM_PYTHON` 指向**装了 `edge_tts` 的那个解释器**：

```sh
$env:ANIM_PYTHON = "C:\Python312\python.exe"   # 这个解释器里要 pip install edge-tts
```

只做纯画面（`demo` / `beat` / `example-config-only` 这类）的片子，这一整套都用不上。

**端口**：CLI 会自己起一个**私有 Vite 服务**（随机端口）再 spawn 无头 Chrome，不需要你配置。要知道的只有一件事 —— **渲染期间别动仓库里的文件**，文件一改就 HMR 重载页面、WebSocket 断流，渲染会报 `ERR_CONNECTION_REFUSED`。长片子用 `--segments` 分块，断了能续跑。

### 跑起来

```sh
npm install

# ① 最低门槛的上手路径：零代码出片（这个任务目录里只有 task.config.mjs 一个文件）
node scripts/anim.mjs check example-config-only
node scripts/anim.mjs video example-config-only

# ② 看完整示例
node scripts/anim.mjs check demo                 # 体检：逐段试渲染 + 静态检查
node scripts/anim.mjs still demo -t 1,6,9.5      # 出单帧 → out/demo/
node scripts/anim.mjs video demo                 # 出成片 → out/demo/demo.mp4

node scripts/anim.mjs check beat                 # 音乐驱动的那支
npm run dev                                      # 浏览器实时预览（空格播放、[ ] 换段）
```

**`beat` 依赖一个音频文件**：`tasks/beat/audio/demo-loop.mp3`（仓库里**有**，32 秒 / 120bpm）。它不是凭空来的 —— 由 `node scripts/make-demo-audio.mjs` 纯合成产生，可以自己重跑一遍重新生成。第一次渲染时 CLI 会自动分析它、生成 `audio/demo-loop.analysis.json`（拍子/小节/段落/包络），画面才踩得上拍子。

> ⚠ **坑**：如果这个音频缺失，`anim video beat` 会**静默地**产出一个**没有声音的 mp4 并且退出码是 0**（`findAudio()` 找不到文件就当作"这个任务没有音频"，`withAudio` 变 false，不报错）。成片出来发现没声音，先去看 `tasks/<任务>/audio/` 里到底有没有文件。

**依赖**：第一次会给 `playwright-core`、`vite` 和 `three` 装包 —— 其中 `three` 只有写 **Three.js 镜头**（第 3 种 3D：真网格，见 `docs/THREE.md`）时才用得到，而且是动态 import：不用它的任务不会被它拖进模块图。画面本身仍然是**代码算出来的**（没有图片素材、没有视频素材、没有扩散模型），3D 几何也全部是程序化生成的。

---

## 这几个示例任务可以看什么

![信息图：柱状图与排版全部由矢量与 Canvas2D 文字画出](docs/images/demo-chart.webp)

| 任务 | 可以看什么 |
|---|---|
| [`tasks/demo/`](tasks/demo/) | **最小 hello-world**：16 秒、无音频，一支小片子该有的东西全在里面 —— 逐字入场、矢量线段、GLSL 背景、图表、甩镜转场、后处理 |
| [`tasks/beat/`](tasks/beat/) | **音乐驱动**：镜头长度全部按拍号写（`dur: { beat: 24 }`），画面踩在拍上；波形、同心圆、频谱网格三种音频可视化 |
| [`tasks/example-config-only/`](tasks/example-config-only/) | **零代码出片**：整个任务目录**只有 `task.config.mjs` 一个文件**，没有 `scenes/`、没有一行 `import` —— 时间线里直接写镜头模板 |
| [`tasks/_style-sampler/`](tasks/_style-sampler/) | **风格采样器**：同一段时间线，五套风格。`node scripts/anim.mjs still _style-sampler -t 1.8,6,9.6 --style paper` —— 换一行就换一张脸（[`docs/STYLE.md`](docs/STYLE.md)） |
| [`tasks/_calib/`](tasks/_calib/) | **标定夹具**：色彩空间、`xform`、`post.center`、任务自带字体、4K 核对的量具；它不是片子，是一把尺子 |
| [`tasks/_three-lab/`](tasks/_three-lab/) | **Three.js 真网格沙盒**：同一个盒子换三种画法（Three.js 实体 / 引擎自己画 / 80 个实例化单元），全片一层背景、一台摄影机 |
| [`tasks/_three-calib/`](tasks/_three-calib/) | **Three.js 桥的标定量具**：证明 Three.js 渲出的画面原样、正着、以正确的颜色进了引擎的合成器（判据是量出来的：`node tools/probe-three.mjs`） |
| [`tasks/pdoom-lab/`](tasks/pdoom-lab/) | **手法验证**：真 raymarch 走廊、投影线段批的图纸与柱林、文字跟着透视走；零 overlap 的硬切怎么靠「一个世界 + 一台摄影机 + 一个火花」连起来 |
| [`tasks/promo/`](tasks/promo/) | **引擎自己的宣传片**：一镜到底 48 秒、零剪辑，六段共用一个世界与一台摄影机；屏幕上每句话的出处都标在 [`FACTS.md`](tasks/promo/FACTS.md) 里 |

---

## 做自己的片子

```sh
node scripts/anim.mjs new 我的片子
```

```
tasks/我的片子/
  task.config.mjs     ← 尺寸/帧率/调色板/音乐/时间线
  scenes/title.js     ← 第一个场景
  scenes/shapes.js    ← 第二个场景
  audio/              ← 放音乐（可选）
```

一个场景就是「给定时刻 t，把这一帧画进 `ctx.out`」。常见镜头直接取镜头库里的模板（一行），需要新视觉时再照这个接口手写：

```js
export default {
  id: 'title',
  setup(ctx) { /* 建 shader、预计算几何 */ },
  render(ctx) {
    const { f, gl, P, text, type, comp, lines } = ctx;
    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);
    lines.begin();
    lines.seg(100, 100, 800, 100, 3, P.signal);
    lines.flush(ctx.out);
    text.clear();
    type.write('写代码，就是做动画', 100, 400, {
      size: 96, weight: 800, family: 'sans', color: css(P.bone),
      stagger: 0.06, from: 'up', t: f.lt,
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.4, grain: 0.03 };
  },
};
```

时间线（重叠 = 转场，`f.tin` 就是转场进度）：

```js
timeline: seq([
  cut(title,  { dur: 4 }),
  cut(shapes, { dur: 6, params: { variant: 'grid' } }),
  cut(wipe,   { dur: 1, overlap: 0.5, handlesTransition: true }),
])
```

有音乐时：

```sh
node scripts/anim.mjs analyze 我的片子      # 分析拍子/小节/段落/包络
```

之后 `f.beat`、`f.a.kick`、`music.timeOfBeat(16)` 就能用来对齐镜头和驱动画面。

---

## 命令一览

| 命令 | 用途 |
|---|---|
| `anim.mjs tasks` | 列出所有任务 |
| `anim.mjs shots [名字]` | 列出镜头模板（A 档镜头库 `src/shots/`）与参数 |
| `anim.mjs styles` | 列出**风格包**（`src/style/`）：一行 `style: 'paper'` 换掉整片观感（`docs/STYLE.md`） |
| `anim.mjs subs [任务]` | 从旁白表导出 `.srt` / `.ass`（给平台上传；每行 ≤16 字，`docs/CAPTIONS.md`） |
| `anim.mjs new <名>` | 新建任务骨架 |
| `anim.mjs check [任务]` | 静态检查 + 逐段试渲染 + 亮度统计（**改完先跑这个**） |
| `anim.mjs still <任务> -t 1,2.5` | 出单帧 PNG（看图的主要手段） |
| `anim.mjs sheet <任务> --from 0 --to 12 -n 16` | 出接触表（一张图扫一段节奏） |
| `anim.mjs shot <任务> --from 0 --to 6` | 出无音轨短片（快） |
| `anim.mjs video <任务> [--scale 2]` | 出成片（自适应运动模糊，带音轨） |
| `anim.mjs verify <任务>` | 成片抽帧 vs 同 t 重渲，逐像素比对 |
| `anim.mjs perf <任务>` | 性能测量（每帧毫秒 / 子帧分布） |
| `anim.mjs gpu <任务>` | 打印 WebGL 诊断信息（渲染器 / 厂商 / 是否支持浮点 RT） |
| `anim.mjs analyze <任务>` | 音频分析（生成 `audio/*.analysis.json`） |
| `anim.mjs say / mix <任务>` | 旁白合成与混音（只有口播片用得到，见 `docs/NARRATION.md`） |

常用参数：`--only a,b`（只加载指定段，快且隔离错误）、`--samples N|auto`、`--shutter 0.2`、`--scale 2`（真 4K）、`--segments 8`（分块渲染，断了能续）、`--crf`、`--preset`、`--gpu high`。

---

## 引擎里有什么

- **图形**：WebGL2 + 线性 HDR（RGBA16F）；`Pass`（全屏 GLSL，自带噪声/SDF/调色板常量）、`LineBatch`（GPU 胶囊线段，一次 draw call 画几万条矢量）、`Layer2D` + `TextKit`（Canvas2D 文字，逐字/逐词动画、卡拉OK、沿路径写字）、`Compositor`（图层叠加，多种混合模式）
- **后处理**：泛光（4 级金字塔）、光晕、色差、径向模糊、暗角、胶片颗粒、抖动、软肩压缩、曝光/对比/饱和/染色/闪白/淡出/震动/推近
- **运动模糊**：逐帧自适应子帧数（8 → 24 → 72 → 216），判据是「再加一组子帧画面还变不变」
- **三种 3D**：解析投影 + 线段批、真 raymarch（SDF）、Three.js **真网格**（真深度真遮挡、实例化、材质光照；`three` 已在 `dependencies` 里）
- **音频**：纯 JS 的 FFT + 节拍/段落/包络分析（Node 与浏览器共用同一份代码，所以离线结果稳定）；拍号、小节、打击事件、六路包络
- **旁白**：`anim say` 合成口播并量出真实时长，反推每个镜头的时长与放慢倍率；词级时间戳可以直接喂给卡拉OK字幕
- **时间线**：`seq` / `cut` / `par` / `at`，支持按拍号定位、重叠转场、每段独立后处理参数
- **确定性**：`rng(seed)`、`hash`、`frameIdx`；`check` 会静态拦截 `Math.random` / `Date.now` 这类写法

详细 API 见 `docs/ENGINE.md`，常见效果的做法见 `docs/COOKBOOK.md`。

## 要写多少代码？

**两层 + 两层模板，最常见的情况一行代码都不用写**：

- **编排**（`task.config.mjs`）：纯配置——什么时候播什么、配色、音乐、时长。**不用写代码。**
- **配置档（B 档）✅ 已落地**：时间线里**直接写镜头模板**，一个任务可以**只有 `task.config.mjs`、没有 `scenes/`**：

  ```js
  // tasks/我的片子/task.config.mjs —— 唯一需要编辑的文件（没有任何 import）
  export default {
    title: '我的片子', width: 1920, height: 1080, fps: 60, scale: 1,
    timeline: [                                    // 数组、seq([...]) 都行
      { type: 'title', title: '我的片子', sub: '副标题', dur: { beat: 8 } },
      { type: 'chart', values: [0.3, 0.7, 0.95], title: '成绩', dur: 5, id: 'bars' },
      { type: 'outro', dur: 3 },
    ],
  };
  ```

  节点上除**时间线字段**（`type` `id` `dur` `at` `overlap` `params` `post` `maxSamples` `handlesTransition` `note` `world` `worldPass` `focus` `carry` `transition`）以外的键，全都是镜头模板的参数；**参数名写错会抛错并列出可用参数**（不静默忽略）。`dur` 不写 = 4 秒，`dur: { beat: n }` / `{ bar: n }` / `{ vo: 'line-id' }` 都行，`id` 不写 = 模板自己的默认段名。
  教程见 `docs/CONFIG-ONLY.md`，可以照抄的完整示例是 `tasks/example-config-only/`。

  ```sh
  node scripts/anim.mjs shots                   # 有哪些模板（20 个）、参数叫什么、默认值是多少
  node scripts/anim.mjs video <任务>             # 只写了 task.config.mjs 也能出完整 mp4
  ```

- **现成模板**（A 档镜头库 `src/shots/`，也就是配置档查的那张表）：常见镜头现在是**一行**。20 个参数化模板（`title` `chart` `kinetic` `whip` `outro` `wave` `pulse` `grid` `quote` `counter` `compare` `bigtype` `scan` `device` `lineart` `morph` `layers` `lockup` `timeline` `radial`），场景文件退化成「取模板 + 给参数」：

  ```js
  // tasks/<任务>/scenes/chart.js
  import { shot } from '../../../src/shots/index.js';

  export default shot('chart', {
    values: [0.3, 0.7, 0.95],
    title: '这一轮的成绩',
  });
  ```

  `shot()` 返回的就是普通场景对象，所以模板镜头和手写场景能混在同一条时间线里。看有哪些模板与参数：

  ```sh
  node scripts/anim.mjs shots           # 列出全部模板
  node scripts/anim.mjs shots chart     # 某个模板的全部参数与默认值
  ```

  **参数名写错会抛错**（点名那个参数并列出可用参数），不会静默忽略。
  `wave` / `pulse` / `grid` 需要音乐：`task.config.mjs` 里配 `audio`，先跑一次 `node scripts/anim.mjs analyze <任务>`。

- **手写场景**（`scenes/*.js`）：镜头库覆盖不到的新视觉（raymarch 晶格、燃烧的引线这类）仍然要写代码——**需要新视觉时再写场景**，接口见 `AGENTS.md` §3（`node scripts/anim.mjs new <名>` 生成的脚手架就是这条路）。

---

## 目录

```
AGENTS.md          给 AI agent 的操作契约（最重要的一份文档）
docs/ENGINE.md     引擎规格参考
docs/COOKBOOK.md   常见效果做法手册
docs/CONFIG-ONLY.md 零代码出片：只写 task.config.mjs 的教程（B 档）
docs/NARRATION.md  旁白/口播那一层（A/B/C 三档都已落地）
docs/THREE.md      第 3 种 3D：Three.js 真网格镜头
docs/STYLE.md      风格包：一行 style 换掉整片观感
docs/BACKLOG.md    还没做的事 / 待你拍板（**唯一的待办清单**）
docs/history/      归档：已完成的改进记录与交接单（索引见 docs/history/README.md）
src/core/          引擎
src/kit/           引擎自带的镜头工具（makeShot / 排版 / 版面元件 / 共享背景）
src/shots/         A 档镜头库：title / chart / kinetic / whip / outro / wave / pulse / grid
                   + quote / counter / compare（BACKLOG 0-5 新增的三个）
src/timeline.js    时间线 DSL
src/app.js         浏览器入口（预览 + 离屏协议）
scripts/anim.mjs   CLI
tasks/<任务>/       一支片子（配置档任务可以没有 scenes/）
public/fonts/      全局字体声明（自带 Manrope，其余缺文件时自动回退系统字体）
out/               渲染产物
```

## 已知限制

- 只出 16:9 / 方形也行，但 HUD 与安全区是按 1920×1080 设计的
- **渲染速度**：本机实测 **1080p60 / `samples=8` 约 2–3.3 fps**（场景以矢量 + 文字为主）。直观换算：**一支 4 分钟的片子大约要渲 70 分钟**。raymarch 这类填充重的段加 `--gpu high` 还能再快一些，先 `anim perf <任务> --gpu high` 量了再定
- **长片用分块渲染**：`video <任务> --segments 8`（`--segments` 后面是**目标块时长，秒**）。切点只落在段边界、避开转场交叠，所以每块都是完整的镜头；**断了可以续跑，已渲好的块会跳过**（渲染参数或源文件变了才会全部重渲）
- **字体**：仓库自带几个 SIL OFL 1.1 的字体（`public/fonts/Manrope-600.woff2`、`tasks/promo/fonts/*.woff2`、`tasks/_calib/fonts/BrandFont.woff2`，清单与出处见 `THIRD-PARTY.md`），开箱即用。要换字体就把 `.woff2` 放进 `public/fonts/` 并在 `fonts.css` 里声明；**找不到就自动回退系统字体**（Windows 上是微软雅黑 / Consolas），画面照样能渲
- 有状态场景（逐帧积分）与自适应运动模糊不兼容，`check` 会报错提醒

## 许可

- **引擎代码 MIT**（见 [`LICENSE`](LICENSE)）
- **示例音频**由仓库内的脚本合成（`scripts/make-demo-audio.mjs`、`scripts/make-promo-audio.mjs` 等），纯合成、确定性、无外部采样 —— 可以自己重跑一遍复现
- **字体**为 SIL OFL 1.1（可再分发），清单与出处见 [`THIRD-PARTY.md`](THIRD-PARTY.md)
- **仓库里的示例片子不含任何第三方图片/音乐素材**：没有一张图、没有一段视频，画面全部由代码生成
