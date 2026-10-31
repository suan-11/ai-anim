# 写给大模型的确定性代码动画引擎

> **这个文件是给 AI agent 看的操作契约。** 你要做的任何事——渲染一帧、做一支片子、加一个效果——都以这里写的命令和规则为准。更细的 API 参考见 `docs/ENGINE.md`，常见效果的做法见 `docs/COOKBOOK.md`。
>
> **⚠ 写入判据（本文件有 65536 B 预算，超了会被注入器从尾部静默截断）。** 加内容前先问一句：
> **不写进来，会不会有人因此写错代码？** 会 → 写在这里（但要短、要能一眼扫到）；不会 → 写进 `docs/`，
> 这里最多加一行**带触发条件的**指针（「写 `return { bloom… }` 之前读 `docs/ENGINE.md` §8」）。
> 查表数据（**参数全表 / 命令全集 / 目录树 / 诊断词释义**）一律在 `docs/` 与 `anim help`，不进这个文件。
> 本文件只保留三样：**会改变你决策的命令**、**写错不报错的坑**、**交付前的门**。
>
> **⚠ 章节号是外部锚点。** `§4` / `§10.10` / `§5.5` 这些编号被 docs、`src/`、`tools/` 和已交付片子的场景代码
> 引用着（实测 **221 处 / 61 个文件**）—— **不要改名、不要重排、不要删章节**，压缩只能发生在章节内部。
> 改完跑这两个守门（**两个都必须绿**）：
>
> ```sh
> node tools/lint-agents-size.mjs   # 体积 + 最肥的 5 节（硬线 65536 B）
> node tools/lint-agents-refs.mjs   # 221 处引用是否还都解析得到
> ```

---

## 0. 这是什么

**写代码就是做动画。** 没有图片/视频素材、没有扩散模型 —— 画面由 WebGL2 着色器与几何实时算出来，
导出时无头 Chrome 逐帧渲染、ffmpeg 编码。整个引擎只靠一条约束成立：

> **每一帧都是时间的纯函数。** `render(t)` 只依赖 `t`，不依赖上一帧、不依赖墙钟、不依赖随机。

换来四件事：任意 seek、多子帧并行求平均做真运动模糊、预览与成片逐像素一致、渲染可随时中断重来。
**违反它的写法见 §4 铁律；工作循环只有一条：改代码 → 出图 → 用 Read 看图 → 再改，别凭空想象画面。**

> **"不需要素材"≠"不能用素材"**：真 logo / 产品截图 / 照片当**一张图层**画进来
> （`comp.draw(gl, tex, ctx.out, { rect, opacity, tint })`，或直接 `ctx.text.ctx.drawImage`）——
> 对外材料里真图通常比手画更像。IO 一律在 `setup`（可 `async`）里做完，`render` 里不许有异步。
> 做法与坑：`docs/COOKBOOK.md` §9。

---

## 1. 三条命令先跑起来

```sh
npm install                                     # 第一次

node scripts/anim.mjs tasks                     # 列出所有任务（一支片子 = 一个任务）
node scripts/anim.mjs tasks --json               # 机器可读清单（1-58）：尺寸/帧率/风格/旁白/变体/时长 + schema 串
                                                 # 批量跑（queue / 变体矩阵 / 外部脚本）用它，别去 grep 配置文本
node scripts/anim.mjs shots [名字]              # 列出镜头模板（A 档镜头库）与参数
node scripts/anim.mjs still demo -t 1,6,9.5     # 出单帧 PNG（agent 主要靠这个看效果）
node scripts/anim.mjs shot  demo --from 0 --to 6   # 出短 mp4（快速看运动）
node scripts/anim.mjs video demo                # 出完整成片（默认自动运动模糊）
node scripts/anim.mjs check demo                # 体检：静态检查 + 逐段试渲染 + 亮度统计
npm run dev                                     # 浏览器里实时预览（空格播放、[ ] 换段）
```

出图落在 `out/<任务名>/`。**渲染完立刻用 Read 打开那些 PNG 看** —— 这是唯一可靠的验证方式。

**做整支片子时先出草稿、后出成片**：先用 `still` 看画面，再跑
`node scripts/anim.mjs video <任务> --draft --segments 10`，把草稿路径交给用户并停下等反馈。
改稿仍走「单帧/短段 → 整支草稿」；**只有用户明确说「定稿 / 出正式版 / 全渲染」这类话，
才去掉 `--draft` 跑正式成片**。用户没看过草稿或只说「继续做 / 再改一下」≠ 同意全渲染。
长片先 `video <任务> --dry-run` 看两档分钟数，但**别拿它代替草稿给用户看**。

> **前置条件**：**Chrome**（`playwright-core` 走 `channel: 'chrome'`）+ **ffmpeg / ffprobe**（PATH 里，或
> `ANIM_FFMPEG` / `ANIM_FFPROBE`）。CLI 自己起私有 Vite 并 spawn 无头 Chrome，用管道读回帧 ——
> **受限沙箱（只允许写工作区那档）会 `spawn EPERM`**，报错点在 `openSession`，看不出是权限问题。
> PowerShell 里**别用管道接原生程序输出**（`| Select-Object` 会以"命名管道"为由被拒）—— 直接跑。
> 沙箱里推仓库：**用 Git 自带的 ssh，不是系统那个** —— 系统 `C:/Windows/System32/OpenSSH/ssh.exe`
> 在本机实测**返回 255 且毫无输出**（连 `ssh -V` 都是），看不出原因，别在那里浪费时间。
> 能用的是 `C:/Program Files/Git/usr/bin/ssh.exe`（`ssh -T git@github.com` 会说 "Hi suan-11!"）；
> ⚠ **路径有空格，必须加引号**（不加会被拆成 `C:/Program`，报 "No such file or directory"）：
> `git -c core.sshCommand='"C:/Program Files/Git/usr/bin/ssh.exe"' push origin HEAD`；
> 预提交钩子（sh 脚本）起不来时用 `--no-verify`，但**手动跑一遍钩子里的三项自检**。
> ⚠ **仓库搬过一次家**（`NekoHome-Studio/ai-anim` → `suan-11/ai-anim`）：GitHub 会重定向所以老远端照样能推，
> 但每次打一行 `Please use the new location`。`git remote set-url origin git@github.com:suan-11/ai-anim.git` 一次就干净了。
> **合别人的分支前读 `docs/RULES.md` 的 P4**（`git merge-tree` 预演、并集 vs 二选一、编号撞车怎么让）。

---

## 2. 建一个新片子

有**两条路**，先试第一条（大多数片子够用）。

> ### ★ 动手之前先决定两件事（`docs/STYLE.md` / `docs/CAPTIONS.md`）
>
> **① 用哪套风格？** 一行 `style: 'paper'` 换掉整片观感（配色 / 字体栈 / 背景母题 / 后处理基线 /
> 栅格 / 字幕样式一起换），可选清单 `node scripts/anim.mjs styles`；不写 = `print`（老任务一像素不变）。
> **风格由内容决定**（不是"必须换"）；只有连着发布两支同题材、上一支刚用过同一套时才考虑换脸，且先问用户。
> 试色：`node scripts/anim.mjs still _style-sampler -t 1.8,6,9.6 --style paper`。
>
> **② 有旁白吗？字幕交给引擎。** `captions: true`，引擎每帧自动画当前那句（位置来自风格包的字幕保留带），
> 场景里**一行都不用写**。**画面文字只放标注**（名词 / 数字 / 单位 / 出处），句子交给旁白与字幕 ——
> 同屏两套完整句子就是观众说的"两条字幕同时出现，看着好迷糊"（sodium 43 句旁白里 12 句被逐字抄成说明条）。
> 交付前 `node tools/lint-narration-dup.mjs <任务>` 自查。

### 2.1 配置档（推荐先试）：只写 `task.config.mjs`

时间线里**直接写镜头模板**：一个任务可以只有 `task.config.mjs`、**没有 `scenes/`**、**没有任何 `import`**。

```js
// tasks/<任务>/task.config.mjs —— 唯一需要编辑的文件
export default {
  title: '我的片子', width: 1920, height: 1080, fps: 60, scale: 1,
  style: 'paper',                                // ← 风格包（anim styles 看全部；不写 = print）
  // export const variants = { dark: { style: 'noir', palette: { signal: '#0ff' } } };
  //   → node scripts/anim.mjs video <任务> --variant dark（深合并覆盖；数组整体替换；产物落 out/<任务>/dark/）
  captions: true,                                // ← 引擎字幕层（有旁白时开；见 docs/CAPTIONS.md）
  timeline: [                                    // 数组、seq([...]) 都行
    { type: 'title', title: '我的片子', sub: '副标题', dur: { beat: 8 } },
    { type: 'chart', values: [0.3, 0.7, 0.95], title: '成绩', dur: 5, id: 'bars' },
    { type: 'outro', dur: 3 },
  ],
};
```

这条路**不用跑 `anim new`**（那是第二条路的脚手架）：建目录、写这一个文件，然后
`check <任务>` → `still <任务> -t …` → `video <任务>`。节点上能写什么 / 默认值 / 写错怎么报 /
什么时候必须回去写场景 → **§3.2**；教程 `docs/CONFIG-ONLY.md`，可照抄的示例 `tasks/example-config-only/`。

### 2.2 手写场景：`anim new` 的脚手架

模板覆盖不到的视觉只能写代码：`node scripts/anim.mjs new 我的片子` 生成
`task.config.mjs` + `scenes/title.js` + `scenes/shapes.js` + `audio/`；改这两个场景文件就能出片，
**不需要动 `src/` 里的引擎**（除非确实要加底层能力）。

> **要写多少代码？** 常见镜头是**一行**——A 档镜头库 `src/shots/` 有 25 个参数化模板
> （`title` `chart` `kinetic` `whip` `outro` `wave` `pulse` `grid` `quote` `counter` `compare` `bigtype` `scan` `device` `lineart` `morph` `layers` `isometric` `cel` `liquid` `lockup` `timeline` `radial` `pixel` `handwrite`），
> 场景文件退化成「取模板 + 给参数」：
>
> ```js
> // tasks/<任务>/scenes/chart.js
> import { shot } from '../../../src/shots/index.js';
> export default shot('chart', { values: [0.3, 0.7, 0.95], title: '这一轮的成绩' });
> ```
>
> 有哪些模板、参数叫什么、默认值是多少：`node scripts/anim.mjs shots`（全部）、
> `node scripts/anim.mjs shots chart`（某一个的全部参数与默认值）。**参数名写错会抛错**，不会静默忽略。
> **「这一段用哪个模板」不想自己挑时**：`anim shots --pick --slot content --chars 8 --seed 7`
> —— 按条件筛 + 按权重抽，同 seed 同结果（契约见 `docs/ENGINE.md` §14.10）。
> 更省事的是 §3.2 的配置档（连场景文件都不用建）；整支片子特有的母题放该任务的 `scenes/_kit.js`。

---

## 3. 一个场景长什么样

场景就是「给定时刻 t，把这一帧画进 `ctx.out`」的纯函数：

```js
// tasks/<任务>/scenes/xxx.js
import { css } from '../../../src/core/util.js';

export default {
  id: 'xxx',                       // 唯一名字，会出现在 HUD 和报错里

  setup(ctx) {                     // 只调用一次：建 shader、建几何、预计算
    this.dots = [...];             // 需要随机就用 rng(seed)，不要 Math.random
  },

  render(ctx) {
    const { f, gl, P, text, type, comp, lines } = ctx;

    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);   // 背景（必须整帧覆盖）

    lines.begin();                                        // 矢量图形
    lines.seg(100, 100, 800, 100, 3, P.signal);
    lines.flush(ctx.out);

    text.clear();                                         // 文字图层
    type.write('写代码，就是做动画', 100, 400, {
      size: 96, weight: 800, family: 'sans',
      color: css(P.bone),
      stagger: 0.06, from: 'up', t: f.lt,                 // 逐字上浮入场
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.4, grain: 0.03 };                    // 这一帧的后处理参数（可选）
  },
};
```

时间线把场景串起来：

```js
// tasks/<任务>/task.config.mjs
import { seq, cut } from '../../src/timeline.js';
import { worldPass } from '../../src/kit/index.js';
import title from './scenes/title.js';
import shapes from './scenes/shapes.js';

// 可选但强烈推荐：全片共用的一层背景（切镜头时"世界不跳"的关键）。
// 声明了它的段（`cut(shot, { world: 'auto' })`）由**引擎**每帧先铺背景，场景不必记得调用。
export const world = (ctx) => worldPass(ctx, { grid: 60, accent: ctx.P.cyan });

export default {
  title: '我的片子',
  width: 1920, height: 1080, fps: 60, scale: 1,   // scale 1..4（2 = 真 4K）
  palette: {},                                    // 可覆盖调色板，如 { signal: '#00e0ff' }
  // audio: './audio/track.mp3',                  // 有音乐就能踩拍子
  // fonts: './fonts/brand.css',                  // 任务自带字体（不必去改全局 public/fonts/）
  timeline: seq([
    cut(title,  { dur: 4, world: 'auto' }),
    cut(shapes, { dur: 6, world: 'auto', params: { variant: 'grid' } }),
    cut(others, { dur: 3, overlap: 0.5, handlesTransition: true, world: 'auto' }),  // 重叠 = 转场
  ]),
};
```

---

## 3.2 配置档（B 档）：时间线里直接写镜头模板

**不写场景文件**：时间线的每一项可以直接写 `src/shots/` 的镜头模板，形状与 §2.1 那份相同
（`style` / `captions` 是任务级字段，不写在节点上）。一个任务因此可以只有 `task.config.mjs`。

**判据**（`src/timeline.js` 的 `isConfigNode()`）：节点是**对象**、`type` 是**字符串**、**没有 `scene`**。
带 `scene` 的照旧走 §3 / §3.5 那两条路。

**节点上的键分两类** —— 分错了就是报错，不会静默：

| 类别 | 键 | 说明 |
|---|---|---|
| **时间线字段** | `type` `id` `dur` `at` `overlap` `params` `post` `maxSamples` `handlesTransition` `note` `world` `worldPass` `focus` `carry` `transition` | 与 `cut(scene, { … })` 的第二个参数同义。⚠ `maxSamples` 是自适应子帧数的**上限**（合法档 8 / 24 / 72 / 216）、**只会往下压** —— 它是**提速**旋钮，**不是"加密采样"**：写 `maxSamples: 64` 会被夹到 24，画面更粗且不报错；拖影要更细就调**小** `--tol`。`world: false` 是合法声明（"这一段我刻意不铺底"，背景守门**不判**它的铺底、但会照常打出读数），别为了骗过 `check` 去画一笔没意义的全屏 Pass。`carry: 'morph'` = 声明这条切缝是跨元素合成的衔接（`anim carry` 判 bare 但对观众成立）。`transition` = 交叠期转场模式：默认 `push` 甩镜，另有 `wipe` 擦除 / `iris` 光圈 / `glitch` 故障 / `pixel` 像素块 / `dissolve` 阈值溶解 / `mix` 交叉溶解 / `none` 硬切；**写错当场抛并列出可用值**（静默回落成甩镜等于"我要的擦除没出现"）。不写 = 逐像素与从前一致（`docs/MOTION.md` §3.6） |
| **模板参数** | **其余所有键** | 原样交给 `shot(type, { … })`；也可以显式写在 `params: { … }` 里（`params` 优先）。**没有必需参数**，每个都有默认值 |

三条硬边界：

- **`dur`**：不写 = **4 秒**；也接受秒数 / `{ beat: n }` / `{ bar: n }` / `{ vo: 'line-id' }`（取某句旁白的长度）。
  **模板参数的默认值与清单**：`node scripts/anim.mjs shots [名字]` 是**唯一权威** —— 别在文档里抄模板清单或默认值表，
  模板一加就会过期（`docs/CONFIG-ONLY.md` 的报错示例就过期过一次，2026-10 从 8 个变 11 个）。
- **不能混写**：配置档节点可以和 `cut(场景, {…})` / `seq()` 同处一条时间线（`shot(...)` 返回的就是普通场景对象），
  但**不能**和「已经展开好的段」（手搓的、带 `start`/`end` 的对象）混写 —— `build()` 会把后者也当节点重排，
  它的 `start`/`end` 被**静默丢掉**，所以引擎直接抛错。
- **写错就抛**（完整四条报错形状见 [`docs/CONFIG-ONLY.md`](docs/CONFIG-ONLY.md) 的「写错会怎样」）：

  ```
  tasks/<任务>/task.config.mjs 的时间线不合法：
  timeline[1] 这一段（type: "chart"）取不到镜头模板：
    镜头模板 "chart" 没有参数 "value"（大概是拼错了）。可用参数：id / values / title / sub / footer / peak
  ```

**什么时候必须回去写场景**：模板只有这 25 个，参数只能调它们**本来就有的画面**。要新视觉
（raymarch 晶格、燃烧的引线、某支片子特有的母题）就回 §3 手写场景 / §3.5 的 `makeShot`；
要自己掌控转场与背景时同理。**别为了"纯配置"把模板撑成万能 DSL。**

完整教程（模板一览 / 时长与节奏 / 转场 / 音乐 / 排错表）：[`docs/CONFIG-ONLY.md`](docs/CONFIG-ONLY.md)。
**离线回归**：`node tools/test-timeline-guard.mjs`（纯 JS，不需要 GPU）管的就是"时间线写错必须抛"。

---

## 3.5 引擎自带的镜头工具：`src/kit/`

以前每支片子都重抄一份 `_kit.js`（各约 450 行），第二次照抄还漏了画背景（9 段里 8 段纯黑）。
通用件现在在引擎里，统一从 `src/kit/index.js` 取。

最省事的写法是 **`makeShot`**：镜头该有的骨架（声明 handlesTransition、画共享背景、交叠期把上一帧甩走、
一台走完全片的摄影机）全包好，场景只画前景：

```js
import { makeShot } from '../../../src/kit/index.js';

export default makeShot('chart', {
  setup(ctx) { this.bars = [...]; },                   // 可选，只调一次
  draw(ctx, { k, dx, dy, enter }) {                    // 背景：任务声明了 world（+ world: 'auto'）时已由它铺好；没声明就自己铺，否则是纯黑且不报错
    const { f, lines, text, type, P, comp, gl } = ctx;
    lines.begin();
    // …画这一段的矢量（坐标加上 dx, dy 让它从反方向落位）…
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('标题', 960, 400, { anchor: 'center', size: 96, color: css(P.bone), ...enter(0.3) });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.3, grain: 0.02 };                // 这一帧的 post（可选）
  },
});
```

`makeShot` 返回的仍是一个普通场景对象，所以**模板镜头和手写场景能混在同一条时间线里**。

| 想要 | 用什么 |
|---|---|
| 完整镜头的骨架 | `makeShot(id, { setup, draw, post })` |
| **信息段的骨架**（标题/面板底/侧标注/出处/页脚/错峰全包，只写 `draw(ctx, rect)`） | `infoShot(id, { title, kicker, caption, source, draw })`（`src/kit/info.js`；版面与 focus 声明由骨架承担） |
| **Three.js 镜头**（真网格） | `makeThreeShot(id, { camera, setup, update, overlay, post })`（§5.5 ③ / `docs/THREE.md`） |
| 现成的整镜头（画面本身） | `shot('chart', { values: [...], title: '…' })`（`src/shots/`，也可直接写进时间线） |
| **动图表情包** | `stickerShot(id, { frame: (i) => url, count })`（`src/kit/sticker.js`）。⚠ **别直接播 GIF**：先 `ffmpeg -vf "fps=12,scale=320:-1"` 抽成 PNG 序列、按 `floor(lt*fps)%n` 取帧（`render(t)` 必须是 t 的纯函数）；`comp.draw` **没有旋转** |
| 只要背景 + 转场 | `makeWorldKit(ctx)` → `wk.openFrame(ctx)` |
| 按锚点写整行字 | `type.writeLine(text, x, y, { anchor })` ≡ `type.write(…, { align })`（`align` 自 2026-10-24 是整行对齐） |
| 整行淡入 | `fade(f.lt, delay)` → `{ alpha: [0,1], t, staggerDur }` |
| 面板 / 眉标 / 页脚 / 准星 / 标记 | `panel` `kicker` `footer` `reticle` `marker` |
| 填充矩形（一条批） | `lines.fillRect(x, y, w, h, [r,g,b,a])` |
| **填充面**（圆 / 多边形 / 扇环 / 带洞） | `lines.fillCircle` · `fillPoly(pts)` · `fillPoly([outer, inner])`（带洞）· `fillSector(cx,cy,r0,r1,a0,a1)`。⚠ 角度 0=右、π/2=**下**；先填充后描边（`COOKBOOK` §17）。**别为了「更平滑」把 `step` 压到 0.25** —— 竖向平滑由多子帧亚像素抖动负责（`ENGINE` §11.6），压小只换来一堆条数 |
| **换成像方式**（半调 / 字符画 / 1-bit / 热成像 / CRT / 雕版 / **多方向排线**） | `instrumented(ctx, { mode, cell }, (target) => {…})`（`src/kit/views.js`）。⚠ 整帧（含文字）先画进离屏目标再换，且必须最后一步（`COOKBOOK` §16）。**要真「刻痕」用 `woodcut`**（按明暗加方向；`engrave` 只有一个方向）—— 它的 `cell` 有 **22px 下限**，低于会被夹住并写 warning（§16.4） |
| **像素风**（调色板 / 块栅格 / 抖动 / 12fps 台阶） | `paletteOf` `pixelText` `drawSprite` `pixelGradient` `snapTime`（`src/kit/pixel.js`），整镜头用 `shot('pixel', {…})`。⚠ 三条写错不报错：抖动阈值按**块**坐标取；精灵 / 像素字落在整块上；台阶用 `f.t` 不用 `f.lt`（`COOKBOOK` §19） |
| **手绘笔迹** | `strokePath` / `strokeArc` / `inkOn`（`src/kit/stroke.js`），整镜头用 `shot('handwrite', {…})`。⚠ 轮廓法在**曲率半径 < 半宽**处必然自交（偶奇规则填成针孔）—— `drawStroke` 的 auto 会自动退到胶囊链；笔迹**不许半透明**（要用 `inkOn(P.c, 0.9, paper)`，§20.1） |
| **整片换介质**（默认 off） | 风格包字段 `view: 'halftone'` 或 `{ mode, cell, passes, misreg }`（写错当场抛）；`passes: 2..4` = N 版套印，整片生效、字幕仍清晰（`COOKBOOK` §16.1–16.2） |
| **像「胶片放出来的」** | `return { weave: 0.5, flicker: 0.25, scratch: 0.2 }`（默认全 0 = 逐像素不变，全由 `t` 驱动；`COOKBOOK` §16.3） |
| **剪纸 / 纸艺层叠** | `paperShape({x,y,w,h,seed})` → `paperStack(lines, layers, { pan, parallax })`（`src/kit/paper.js`）。⚠ 三条**出图才看得见**的比例：撕边幅度 = **边长 × 1.5–3%**（12px 在 2000px 的纸上就是直线）；白芯只浅 **7%**（35% ⇒ 雪白高光带）；投影**不透明**（半透明会在扫描行之间出条纹）。撕边在 `setup` 里算一次（只吃 seed，不吃 t）。见 `docs/MOTION.md` §3.7 |
| "代码行"排版（分段着色、等宽） | `codeRow(type, [{ s: 'GET ', c: css(P.ash) }, { s: '/v1/items', c: css(P.signal) }], x, y)` |
| **带回弹的落位**（不用自己积分） | `spring(f.lt - t0)` → 0→1，指数弹簧解析解（`src/core/util.js`；更弹 `spring(dt, 1, 140, 12)`） |
| 有机漂移 / 呼吸 / 不规则抖动 | `noise1/2/3`、`fbm1/fbm2`（确定性） |
| 半透明 / 提亮到发光 | `withAlpha(P.signal, 0.18)`（`lines` 第 4 分量）、`mul(P.bone, 1.6)`（>1 才泛光） |
| 全片摄影机的方向 / 数值 | `cameraAt(t)` / `cameraDir(t)`（`kit/world.js`；`cameraPost(t, extra)`） |

⚠ **`makeShot` 与镜头库模板是两条平行的路**：`src/shots/` 的模板自己就铺满整帧（自带背景），
所以别把模板塞进 `makeShot().draw()` 里 —— 那会覆盖掉 `makeShot` 铺的背景。一段里二选一，详见 `docs/ENGINE.md` §14.5。

---

## 4. 铁律（违反会导致成片随机出错，而且通常不报错）

| 禁止 | 原因 | 正确做法 |
|---|---|---|
| `Math.random()` | 一帧会被拆成多个子帧乱序渲染，每子帧都调一次，结果抖动 | `rng(seed)`（`setup` 里预计算） |
| `Date.now()` / `performance.now()` | 时间只能来自 `f.t` | 用 `f.t` / `f.lt` |
| 逐帧累积状态（`this.x += v*dt`） | 子帧乱序、可任意 seek，累积值无意义 | 把位置写成**时间的函数**，例如 `x = f(t - birth)` |
| 按帧抖动用 `Math.floor(t*60)` | 一帧内所有子帧会取到不同值，出现双重曝光 | 用 `f.idx` |
| **拿逐帧白噪声当"手持"**（`shake: [(hash2(f.idx,1)-.5)*2*amp, …]`） | 60fps 下每 16.7ms 跳到一个**新位置** = **振动**，不是手持 —— 幅度只有 5px 也会被用户说成"像地震"（`docs/history/IMPROVEMENTS-1-3.md` 第三轮） | 抖动用 `shakeSmooth(f.t, amp)`（`src/core/cam.js`，**是 t 的平滑函数**）；真要震屏/冲击才用逐帧噪声，且写成 `handheld(cam, f.t, f.idx, { mode: 'grain' })` |
| 场景里不 `text.clear()` 就画 | 上一帧的字会叠上来 | 每帧开头 `text.clear()` |
| 一帧多段共存时共用 `engine.text` | 每段场景有自己的 `ctx.text`，别用引擎的 | 一律用 `ctx.text` / `ctx.type` |
| 声明了 `handlesTransition` 却不铺整帧背景 | 那一段的底是**纯黑**（只有 grain 和暗角），而且不报错 —— fidus 那次 9 段里 8 段这样 | 写 `cut(shot, { world: 'auto' })` 让引擎铺；或自己画一次全屏 Pass；`check` 会报出来 |

`f` 上已经给你准备好了：`t`（整片时间）、`lt`（段内时间）、`p`（段内进度）、`idx`（帧号）、`seed`、`beat` / `bar` / `beatPhase`、`a`（音频特征快照）、`tin` / `tout`、`start` / `end`。

> **`tin` / `tout` 的准确含义**（容易误解）：
> `tin` = 与上一段重叠时，**本段入场进度**（0→1）。
> `tout` = 与下一段重叠时，**下一段压进来的程度**（本质是「本段被顶掉多少」）；没有重叠时恒为 0。

---

## 4.5 让片子「像一支片子」而不是幻灯片

一切镜头就"跳"，**通常不是引擎问题，是剪辑设计问题**：每个场景各建背景、各写 post，一切换世界就变了。
`src/core/trans.js` 里有一套验证过的配方，四条缺一条就露馅：

1. **全片只有一层背景** —— 同一个 shader、参数**只由整片时间 `f.t` 驱动**（不是 `f.lt`）。
   于是切点两侧的背景逐像素一致：世界没变，只有前景在换。
2. **全片一台摄影机** —— `cameraPost(f.t, {…})` 交给 post 的 `zoom`/`shake`，全帧一起动，切镜头时它不会断。
3. **一个走完全片的母题** —— 一条指针 / 一道扫描线 / 一颗星。眼睛有得跟，切了也像没切。
4. **交叠期把上一帧甩走**，不是原地淡出；新内容从**反方向**落位（`enterOffset`）。

```js
import { makeTransitionKit, cameraPost, enterOffset } from '../../../src/core/trans.js';

export default {
  id: 'shot_a',
  handlesTransition: true,                     // ⚠ 不写引擎会先做交叉溶解（见 §4 铁律）
  setup(ctx) { this.tk = makeTransitionKit(ctx); this.world = /* 全片共用的背景 Pass */; },
  render(ctx) {
    const { f } = ctx;
    const k = this.tk.openFrame(ctx, this.world);   // 画背景 + 把上一帧甩走；k = 入场进度
    const [dx, dy] = enterOffset(f.t, k, 220);      // 前景从反方向落位
    // …画这一段的画面（文字/矢量坐标加上 dx, dy）…
    return cameraPost(f.t, { bloom: 0.34, grain: 0.02 });
  },
};
```

时间线上让两段重叠即可：`cut(shot_b, { dur: 6, overlap: 0.6, handlesTransition: true })`。

> ⚠ **文字量大的画面不要用交叉溶解**（引擎默认）：两屏字叠一起会糊，必须让旧的"走掉"—— 这正是 `transitionPass` 的理由。

**另一种更省事的"一台摄影机"**：`ctx.setXform({…})` 把整张 `ctx.out` 当一组做变换 —— 它**做不出视差**
（分层视差要把偏移乘进每层自己的坐标），是整层运镜与整层透视的入口（`docs/ENGINE.md` §3.5 / §3.7.5）。

---

## 5. 四个主力工具

| 工具 | 用途 | 关键点 |
|---|---|---|
| `lines`（LineBatch） | 矢量图形：线、折线、圆、矩形、填充矩形、刻度 | 颜色是**线性**值 `[r,g,b]` 或 **`[r,g,b,a]`**（`a` 是真半透明叠加），可以 >1 让它发光；`fillRect` 是填充；一次 `flush` 就是一次 draw call；容量 6 万条 |
| `text` + `type` | 文字排版 | `type.write` 逐字动画；`size` 可写**语义字号** `'hero'/'h1'/'h2'/'body'/'label'/'mono'`（按风格取值、写错抛；规则见 `docs/STYLE.md` §4.1）；`type.writeLine` **按锚点写整行**（与 `write(…,{align})` 等价，两者都是整行）；`type.karaoke` 逐词同步；`type.wrap` 折行；画完必须 `text.upload()` 再 `comp.draw` |
| `new Pass(gl, glsl)` | 全屏 shader：背景、扭曲、后处理式效果 | shader 里直接写 `void main(){ fragColor = ...; }`；`GLSL_COMMON` 已提供 `vUv`/`t`/`res`/`FRAG_PX`/调色板常量 `C_INK` `C_SIGNAL`…/噪声/SDF |
| `comp.draw(gl, 图层, out, opts)` | 叠图层 | `mode: 'normal'\|'add'\|'screen'\|'multiply'\|'max'`；Canvas2D 图层传 `premult: false` |

后处理参数（`return { ... }` 或 timeline 的 `post`）—— **完整全表见 [`docs/ENGINE.md`](docs/ENGINE.md) §8**
（类型 / 默认值 / 该调它的场景 / 执行顺序都在那儿）。这里只留**三条写错就不报错**的：

| 陷阱 | 正确写法 |
|---|---|
| `fade` 是**黑掉的量**，不是亮度 | 开场淡入：`fade = 1 - prog(t, 0, 1)`（写成 `fade: prog(...)` 就是整场黑） |
| `shake` 的单位是**物理像素** | `--scale 2` 下同样数值的视觉位移**减半**，要跨分辨率一致就乘 `scale`；`center` 才是逻辑像素 |
| `tonemap` 非 `'off'` 时 `shoulder` **静默失效** | 二者二选一；换 `'agx'` 一般要配 `exposure: 0.75`（ACES 配 `0.85`） |

> **泛光分界线**：只有「信号色」（火花 / 被唱到的词 / 要发光的东西）才允许超过 0.85 线性亮度；**骨白正文永远不要 bloom**。
> **抖动要平滑**：用 `shakeSmooth(f.t, amp)`（**不是**逐帧白噪声），幅度随镜头停住衰减；出片前 `node scripts/anim.mjs shake <任务>` 体检（§4 铁律第 5 条）。

### 5.5 想做真 3D 时

引擎自带**三种**"3D"。前两种**手写**、都只吃 `f.t`（**没有深度缓冲、没有场景图**）；
第三种是**真网格**（Three.js，有深度缓冲与场景图，`three` 已经在 `dependencies` 里）：

```js
// ① 解析投影 + 线段批（便宜，几何自己给）：柱子 / 走廊 / 塔 / 线框
import { camera3, project3, clipSegment, depthScale } from '../../../src/core/cam.js';
const cam = camera3({ pos: [0, 0, -2], target: [0, 0, -3], fov: 50, roll: 0.02, H });
const a = project3(cam, W, H, x0, y0, z0), b = project3(cam, W, H, x1, y1, z1);
if (clipSegment(a, b, 0.15)) lines.seg(a.x, a.y, b.x, b.y, depthScale(cam, a.w, H) * 3, P.bone);

// ② 真 raymarch（贵，几何是数学式子）：无限晶格 / 空腔 / 雕版排线
import { GLSL3D_PRE, GLSL3D_KERNELS, cam3Uniforms } from '../../../src/core/glsl3d.js';
new Pass(ctx.gl, `${GLSL3D_PRE}\n${SDF}\n${GLSL3D_KERNELS}\n${MAIN}`, cam3Uniforms(cam), { palette: ctx.P });

// ③ 真网格（Three.js）：一个镜头一行
import { makeThreeShot } from '../../../src/kit/index.js';
export default makeThreeShot('cube', {
  background: 'over',            // 'cover' 自带背景；'over' 浮在引擎背景上（配 world: 'auto'），必须 bridge.alpha
  bridge: { alpha: true },
  camera: { fov: 34, pos: [4, 3, 6], target: [0, 1, 0] },
  async setup(ctx, api) { /* THREE.Scene / 材质 / 灯光；api.palette('signal') 取**线性**色 */ },
  update(ctx, api) { api.scene.rotation.y = ctx.f.t * 0.4; },   // ⚠ 只吃 t，绝不做累积
  overlay(ctx, api) { /* 文字/引线；api.project(x,y,z) 可贴到 3D 物体上 */ },
});
```

**选哪一种**：按「画面需要什么」选，**不是**按「哪个省事 / 哪个零依赖」选 —— 三种都能出片，
选错才真的限制画面：

| 画面要什么 | 用哪一种 | 代价 / 边界 |
|---|---|---|
| 线框、柱林、走廊、塔 —— 几何你能用线给出来 | ① 解析投影 + 线段批 | **没有 z-test**，遮挡只能靠"按深度从远到近"自己排 |
| 几何本身是数学式子：无限重复晶格、圆角融合、掏空、雕版排线 | ② raymarch | 每像素几十次 SDF，出片时间会明显变长 |
| **成百上千个同样的单元**（实例化）、材质 / 光照 / 阴影、真深度真遮挡、以后要导入 `.glb` | ③ Three.js 真网格（`three` 已在 `dependencies`，**不是"最后的备选"**） | 每子帧重渲一次 + 一次全屏合成；写法和另两种一样简单（`makeThreeShot`） |

⚠ **能画出来 ≠ 画出来好看，也不等于一样快**。别为了"手写更纯粹"把本该用 ③ 的画面硬压成 ①/②：
需要真遮挡、材质光照、或成百上千个单元时，③ 才是省事又好看的那条路。
写法、三种合成模式、坑清单见 **`docs/THREE.md`**；实现在 `src/core/three-bridge.js`
（桥）与 `src/kit/three.js`（镜头骨架）。

五条**写错不报错、只出错画面**的（其余规格见 `docs/ENGINE.md` §3.7 ①② / §3.8 ③）：

* **世界坐标（三种共用）**：右手系，`+x` 右、`+y` 上、`-z` 朝屏幕里；`project3` 的 `w` 是深度（`> 0` 才在镜头前）。
  Three.js 同一套，可直接照搬。**`FRAG_PX` 的 y 向上**，与 JS 侧"逻辑像素 y 向下"**相反** —— 混了就是整个世界上下颠倒。
* **相机 uniform 一律 `cam3Uniforms(...)`**（②），别手写字段名（写错 = uniform 全 0 = 整屏白）。
* **① 的遮挡要自己做**（线段批没有 z-test）：按深度**从远到近**排（画家算法）。
  ⚠ **排序用的深度不能拿去算线宽** —— `depthScale` 是 `focal / max(1e-6, w) / H`，相机**身后**的 `w < 0`
  会被当成 1e-6 ⇒ 线宽变成几亿像素的胶囊、几条线就把整屏糊白。线宽一律用 `clipSegment()` **裁剪之后**的深度算。
* **③ 的确定性一条都不能破**：`update()` 里只写 `t` 的纯函数（`mesh.rotation.y = f.t * 0.4`），**不是** `+= 0.01`；
  随机用 `ctx.rng(seed)` 在 `setup` 里预计算。"用了 Three.js"**不是**破例的理由 —— 每个子帧都会重渲一次它。
* **整屏白 = 场景写出了 NaN / ±Inf**（引擎不报错）：`node tools/probe-raymarch.mjs` 会把两者分开数出来；
  `check` 也报「非有限值：NaN n / Inf n」。完整样本：`tasks/pdoom-lab`（①②）、`tasks/_three-lab` / `_three-calib`（③）。

---

## 6. 有音乐时

```sh
node scripts/anim.mjs analyze <任务名>     # 生成 audio/<文件名>.analysis.json（拍子/小节/段落/包络）
```

之后画面就能真的踩拍子（全表见 `docs/ENGINE.md` §10.2–§10.3）：

```js
f.beat / f.beatPhase    // 连续拍号（3.4 = 第 3 拍走了 40%）/ 0→1 走向下一拍
f.a.kick / snare / hat  // 打击事件强度（±60ms 窗口）· f.a.rms/low/mid/high/vocal/flux 是 0..1 包络
music.timeOfBeat(16)    // 第 16 拍的时刻 —— 用它来定切割点；music.beatAt / nearestBeat 同理
music.hit('kick', t, 0.12)   // 衰减脉冲（做撞击位移/闪白最省事）；music.hits('kick', t-2, t) 取一段内的
```

**切镜头要对齐节拍**：用 `cut(scene, { dur: { beat: 16 } })` 或 `cut(scene, { at: music.timeOfBeat(16), dur: 8 })`，而不是手写秒数。`at` 和 `dur` 都接受 `{ beat: n }` / `{ bar: n }`（配置档节点上的 `at` / `dur` 同理，见 §3.2）。

### 6.5 有人讲解的片子（旁白/口播）

**镜头多长由旁白决定，不是"总时长 ÷ 段数"平摊**（硬经验：beast 第一版 63 秒塞 12 段、每段
2–4 个信息块，读不完被打回）。引擎自带这一层（`docs/NARRATION.md`）：

```sh
node scripts/anim.mjs say <任务> [--voice zh-CN-YunxiNeural] [--rate -6%] [--dry-run]
node scripts/anim.mjs mix <任务>          # 旁白摆位 + 给音乐做闪避 → 一条混音轨
node scripts/anim.mjs say <任务> --table en   # 表写到 audio/en.{timing,narration}.json，默认那份不动
                                            # → task.config 里 narration: './audio/en.narration.json'
```

> 贴平台响度靶子要**显式**：`anim mix <任务> --target streaming`（默认只报数字、不动音轨；`docs/NARRATION.md` §7）。

写法（`tasks/<任务>/narration.mjs`，**旁白是唯一的时间源**）：

```js
export const VOICE = 'zh-CN-YunxiNeural';   // 换音色只改这一行，重跑 say+mix（场景代码不用动）
export const TAIL = 1.2;                    // 每段最后一句说完后至少留这么久画面
export const MAX_STRETCH = 1.9;             // 画面最多放慢几倍（再慢就像卡住）
export const SCENES = [
  { id: 'hook', internal: 4.2,              // internal = 这个镜头画面最后一次揭晓的内部时刻
    lines: [ { cue: 0.6, text: '先看一句话。' },        // cue = 说这句时画面该走到哪
             { cue: 2.6, text: '这串「嗷呜啊」，叫「兽语」。' } ] },
];
```

`say` 逐句合成、**量出真实时长**、解出每段的 `stretch`/`slot`，写 `audio/timing.{json,mjs}` + `narration.json` +
`<任务>-vo.mp3` 并打印时长表；场景侧只写 `const t = f.lt / (ctx.params?.stretch ?? 1)`。
它挡住的坑：**叠句**、放慢到 `MAX_STRETCH` 还不够、没有节拍源。⚠ 旁白尾巴自带约 0.9s 静音 —— 别用文件时长。

`task.config.mjs` 里这样接（`duration` 直接用生成的表）：

```js
import timing from './audio/timing.mjs';
export default {
  audio: { music: './audio/bed.mp3', vo: './audio/x-vo.mp3', mix: './audio/x-mix.mp3' },
  narration: './narration.json',              // 场景里 ctx.narration.at(f.t) / .recent(f.t, 1.2)
  timeline: seq([ cut(hook, { dur: timing.scenes[0].slot, overlap: timing.overlap,
                              params: { stretch: timing.scenes[0].stretch } }) ]),
};
```

**词级时间戳**（"唱到哪亮哪"/字幕）：`say` 会把驱动给的词级时间戳写进 `narration.json` 的
`lines[].words`（**整片绝对时间**），直接喂给 `type.karaoke`：

```js
const l = ctx.narration.at(f.t) ?? ctx.narration.recent(f.t, 1.2);   // 说完之后字幕再留一会儿
if (l?.words) type.karaoke(l.text, l.words, 200, 800, f.t, { size: 84, base: css(P.ash), sung: css(P.signal) });
```

没有 TTS 也能用：手写 `narration: { lines: [{ id, text, start, dur }] }`，`dur: { vo: 'line-id' }` 按那句的长度定时长
（名字写错会抛错）。离线回归 `tools/test-say.mjs`（无需联网/GPU）；真 TTS 通电 `tools/probe-tts-edge.mjs`。

#### 字幕：交给引擎，别自己画（`docs/CAPTIONS.md`）

```js
// task.config.mjs
captions: true,                    // ← 就这一行；场景里一个字都不用写
```

引擎每帧自动画"此刻该说的那句"（含"说完再留一会儿"、逐句淡入淡出），位置来自风格包的
**字幕保留带**（`style.grid.captionBand`，默认顶部居中 y 40–104）。字幕画在**后处理之后**（信息层，不过泛光/颗粒）。

四条纪律：

1. **画面文字只放标注**（名词 / 数字 / 单位 / 出处），**不许复述旁白** —— 同屏两套完整句子就是观众说的
   "两条字幕"；交付前 `node tools/lint-narration-dup.mjs <任务>`（报到 `文件:行号`）。
2. **字幕带是保留区**：别把面板/计量条放进去 —— kit 的 `assertInBand()` 压上时警告，`check` 会打出来
   （走 `ctx.warnings`，不是 `console.warn` —— 它每帧都会发生）。
3. **别手打换行**：断行（行首禁则 / 不拆词 / 两行平衡 / 超长句不丢字）交给 `src/core/cjk.js`（`docs/CAPTIONS.md` §3.5）。
4. **别做逐词高亮**（`karaoke: true` 要显式开）：96 人对照实验里字幕本身无害，**关键词突显是负效应**。

平台字幕（上传用）：`node scripts/anim.mjs subs <任务>` → `out/<任务>/*.srt|.ass`（每行 ≤16 字、最多 2 行）。
**开了 `captions: true` 就别再烧一遍 `.ass`** —— 那是两层字幕。

---

## 7. 渲染与导出

> **命令全集与每个开关的含义**：`node scripts/anim.mjs help`（一份完整清单，本文件只列会改变你决策的那些）。
> 下面没写出来的开关不是不存在，是"按默认值走就对了"。

```sh
# 看图 / 看运动
node scripts/anim.mjs still <任务> -t 1.5,2,3.25        # 单帧（逗号分隔多个时刻）
node scripts/anim.mjs still <任务> -t 6 --only chart,title   # 只加载这几段；⚠ --only 把它们**平移到时间轴开头**
                                                        #   ⇒ -t 是"段内时间"；名字写错直接报错
node scripts/anim.mjs sheet <任务> --from 0 --to 12 -n 16    # 接触表（一张图扫节奏）
node scripts/anim.mjs cuts  <任务> [--window 1.5] [--n 7]    # 切点两侧 ±1.5s（三点采样不落在切点上）
node scripts/anim.mjs shot  <任务> --from 0 --to 6 --samples 4   # 短预览 mp4（无音轨，快）

# 出片
node scripts/anim.mjs video <任务>                       # 1080p60 + 自动运动模糊 + 音轨
node scripts/anim.mjs video <任务> --segments 10         # 分块：>30 秒的片子**默认就加**
node scripts/anim.mjs video <任务> --dry-run             # 按档预估：草稿 / 成片各测 10 帧，两行分钟数
node scripts/anim.mjs video <任务> --draft --segments 10 # 草稿审片：960×540 + samples=1，改稿可复用块
node scripts/anim.mjs queue a b --segments 10 --gpu high # 睡前排队：顺序跑（并行实测更慢）、失败不中断后续

# 验收（verify 管"画面是不是这一版"，qa 管"这份文件有没有黑闪/冻结/静音"）
node scripts/anim.mjs verify <任务>     # 成片抽帧 vs 同 t 重渲，逐像素（拼接/帧数/色彩/旧版本一次查完）
node scripts/anim.mjs qa <任务>         # 纯 ffmpeg 读数：解码 / 黑场 / 静帧 / 音量（--strict 才当门）

# 画面基线：它是**变更探测器**，不是"画面永远不许变"（docs/BACKLOG.md §4）
#   · 保画面（bug fix / 重构 / 性能）⇒ --baseline 必须全绿，绿了才证明你没顺手改画面
#   · 改画面（有意的视觉改进）⇒ --accept --note "改了什么、为什么"：先看前后对比图，再存基线
node scripts/anim.mjs hashes <任务> --every 2 --save     # 首次存基线（已存在会拒绝覆盖）
node scripts/anim.mjs hashes <任务> --baseline           # 变了 ⇒ 退出码 1 + hashes-diff.png
node scripts/anim.mjs hashes <任务> --accept --note "…"

# 交付物料 / 体检
node scripts/anim.mjs cover <任务> -t 12 --title "…" [--sub "…"] [--scale 2]   # 封面：字用**引擎那套字体**
node scripts/anim.mjs chapters <任务> [--min 4] [--json]   # mm:ss 章节；首段必 00:00、短段并进上一章
node scripts/anim.mjs shake <任务> [--from 0 --to 48]      # 抖动是"平滑手持"还是"逐帧振动"（有问题退出码 1）
node scripts/anim.mjs perf <任务> --from 20 --to 24 --gpu high   # 先量再定：填充重的片子差 2×
```

**分块渲染（`--segments`）三条必知**：切点只落在段边界、避开转场；**块级判断**（BACKLOG 1-45）——
只改 `tasks/` 下的场景 ⇒ 只重渲它所在那块；改 `src/core` `src/style` `src/app.js` `src/timeline.js` 或 `public/`
（**引擎地基**）⇒ 整批重渲；改 `src/kit` `src/shots` 这类**通用件** ⇒ 只重渲**真正 import 到它**的块
（按 import 图收窄，含 `import { makeShot }` 只跟那一条、`shot('chart')` 只跟 chart 模板）；渲染参数变了 ⇒ 整批。
⚠ 长时间单进程推流**会中途卡死**（实测 1260/4550 帧处 12 分钟无进度而进程还在）—— 分块每块重启浏览器，天然规避。

**出片速度**（本机实测、1080p60、`samples=1`）：7.5 fps，raymarch 类加 `--gpu high` 再翻倍；
传输已换 **NV12**（3.11MB/帧）。读数与瓶颈见 `docs/PERF.md` §5.3–§5.4。
运动模糊**逐帧自适应**：静止帧 8 子帧、普通运镜 24、甩镜/砸字吃到 72 或 216 —— `--samples 1` 关掉，`--shutter 0.2` 调窄。

**⚠ 渲染期间一个文件都别写**（第七轮实测收紧）：CLI 起私有 Vite，文件一改就 HMR 重载 → WebSocket 断流。
`watch.ignored` 里那些（`**/*.md`、`docs/**`、`tasks/*/audio/**`…）**挡不住编辑器的原子写** ——
它会留下 `.xxx.tmpdir/…tmp`（**不以 `.md` 结尾**），Vite 撞 `EBUSY` 直接崩，渲染报 `net::ERR_CONNECTION_REFUSED`。
唯一被实测挡住的是 **`out/**`**（并发子代理的产出先落 `out/_staging/`，渲完再搬）。
`video` 收尾会用 **ffprobe 复核自己的产物**（帧数不符就报错并删废文件，分块模式逐块复核）。

**4K 与竖屏都不用改场景**：`--scale 2`（或任务里 `scale: 2`，接受 1..4）出真 4K，只要 shader 里别拿物理像素
当逻辑像素用；写 `width: 1080, height: 1920` 即竖屏（引擎自动换栅格 `GRID_PORTRAIT` + 字号阶梯 ×1.35，
字幕抬到 61%–70% 避开 B 站 UI）。写竖屏场景前读 `docs/LAYOUT.md` §6.5（判据不放宽，正文不许越过
`contentBottom`、标注合并成一行）；回归 `node tools/test-portrait.mjs`。

**编码器不可用会自动兜底**：默认 `libx264`，出片前探一次 —— Windows 上常见的 **LGPL 构建没有它**
（硬写默认值的结果是 ffmpeg 打一行 `Unrecognized option 'x264-params'` 就退出）。现在自动退到
`h264_mf` / `libopenh264` 并警告；要原配方（crf16 + tune grain）就装 GPL 构建或用 `--vcodec` / `ANIM_VCODEC`。

---

## 8. 遇到问题时

先跑：

```sh
node scripts/anim.mjs check <任务>
```

它会：静态扫描禁止的写法（`Math.random` 等）→ 逐段试渲染 → 报每段平均亮度（近乎全黑 = 没画东西）→ 打印控制台错误。

常见症状（**完整表 + 输出词释义只在 `docs/DIAGNOSIS.md`**，这里只留最高频的）：

| 症状 | 多半是 |
|---|---|
| 整帧黑 | 没 `gl.clear(ctx.out, …)`、画到了别的目标；或用了 `--only` 但 `-t` 给的是整片时间 |
| **整屏白（四角有暗角）** | 场景写出了 **NaN / ±Inf**（两者显示完全一样）：`check` 报「非有限值」、`node tools/probe-raymarch.mjs` 分开数。头号来源是相机 uniform 全 0（`cam3Uniforms` 字段名写错）、除以 0、`pow(0, 负数)`。**单帧白、成片黑**是同一件事（多子帧累加时非有限值被丢掉） |
| **某一段的底是黑的（文字/面板都在）** | **漏了共享背景** —— `check` 的背景守门会点名；写 `cut(shot, { world: 'auto' })` |
| 文字全不见 / 是方框 | 忘了 `text.clear()` / `text.upload()` / `comp.draw`，或用成了引擎的 `text`（要用 `ctx.text`）；方框 = 任务字体没加载完或 `task.fonts` 路径不存在 |
| 整行淡入一上来就是终值 | **已修**（`alpha` 曾只在 `stagger>0` 参与动画）；用 `probe-alpha` 复核 |
| 整行居中/右对齐偏了 | **已修**（`align` 现在是整行对齐）—— 2026-10-24 之前 `write` 的 `align` 逐字生效，整行会往右排、右边被裁。若还偏，先查自己是不是又手算了一个 `x - w/2` |
| 上下颠倒 | Canvas2D 图层不用自己翻 Y，引擎在合成器里翻了 |
| 预览对但导出暗 / 导出不对 | 暗 = 读回时别用 `readLinearPixels()` 存图；不对 = 用了 `Math.random` / 逐帧累积状态 / `Math.floor(t*60)` 抖帧 |
| shader 编译失败 | 报错会带出错那行的源码；别重复声明 `vUv`/`fragColor`/`t`/`res` 这些 `GLSL_COMMON` 已提供的名字 |
| 拖影有台阶 | **先调小 `--tol`**（默认 2.5，比加 `--samples` 便宜）→ 再调小 `--shutter`；也可能是场景里有随时间连续变化的噪声（改用 `f.idx` 播种） |
| 音频解码失败 | 跑 `analyze` 生成预计算 json；或换成 mp3/m4a |
| `task.config.mjs` 报"取不到镜头模板" | 配置档节点写错了（模板名 / 参数名拼错），报错里就列了可用项，见 §3.2 |
| `video` 报「只渲染了 N/M 帧」 | 渲染期间写了仓库里的**任何**文件（见 §7）。长片子用 `--segments` |
| `video` 报「产物验收不通过」 | 先读分类头：**已知原因**（确定性）⇒ 照「下一步：①…」做，**别直接重跑**；**原因未知** ⇒ 看原始 `·` 行、查磁盘与 `out/` 是否被别的进程碰过。逐条见 `docs/DIAGNOSIS.md` §1.5 |

> **看到输出里不认识的词**（`非有限值：NaN n / Inf n`、`背景守门`、`空档`、`段内亮度不均`、`压进了**字幕保留带**`…）→ 查 **`docs/DIAGNOSIS.md`**：`输出词 / 含义 / 修法` 三列，每条带 `文件:行号` 证据（词是从代码里 grep 出来的，能反过来验证）。

---

## 9. 目录结构

> 这一节**不列文件** —— 逐文件清单必然漂移（它曾经有 90 行，且已经过期）。要精确清单：
> `tree -L 2 -I "node_modules|out|.git"`。这里只回答两个问题：**改东西去哪**、**该读哪份文档**。

**改东西去哪**：

| 要改什么 | 去哪 |
|---|---|
| 渲染一帧 / 合成 / 后处理 / 自适应运动模糊 | `src/core/`（先读 `docs/ENGINE.md`） |
| 镜头模板（A 档，25 个） | `src/shots/`；参数：`node scripts/anim.mjs shots [名字]` |
| 写镜头的骨架与元件 | `src/kit/`（`index.js` 是统一出口：`makeShot` `makeWorldKit` `panel` …） |
| 时间线 DSL、任务加载、配置档节点判定 | `src/timeline.js`、`src/tasks.js` |
| 风格包 | `src/style/`（见 `docs/STYLE.md`） |
| 出片 CLI | `scripts/anim.mjs`；Node 侧工具在 `scripts/lib/`（**不进浏览器**） |
| 量具与离线回归 | `tools/`（`regress-all.mjs` 一条跑完；日志在 `out/_regress/`） |
| 一支片子 | `tasks/<任务>/`：`task.config.mjs` + 可选 `scenes/` + `audio/` +（有旁白时）`narration.mjs` |
| 渲染产物 | `out/<任务>/`；**并发子代理的产出先落 `out/_staging/`**（渲染期只有 `out/**` 可写） |

**该读哪份文档**：

| 文档 | 讲什么 |
|---|---|
| `docs/ENGINE.md` | 引擎规格（`src/` 的地基；**改引擎之前读**） |
| `docs/COOKBOOK.md` | 常见效果怎么做 —— 按「画面要什么」找做法 |
| `docs/MOTIFS.md` | **母题库**`src/kit/motifs/`：拆方波 / 8×8 DCT / 波形+游标 —— 同一件事只写一次 |
| `docs/shots/` | **镜头卡索引**（按叙事功能分组，25 张；生成物：`anim shot-cards`）—— 选镜头先查这里 |
| `docs/CONFIG-ONLY.md` | 零代码出片（B 档，§3.2 的完整版） |
| `docs/STYLE.md` | 风格包与反审美疲劳（相邻两片换脸是**建议**：风格由内容决定） |
| `docs/CAPTIONS.md` | 字幕层与信息分工（画面只放标注） |
| `docs/RULES.md` | **判例式准则**（R/Q/S/C/P，每条 = 规则 + 用户原话 + 自检）—— 机器判不了的看这里 |
| `docs/LAYOUT.md` | 版面纪律与「版面守门」（一屏一个主体） |
| `docs/MOTION.md` | 运动规则表（什么时候用哪个、数值上限、证据分级） |
| `docs/NARRATION.md` | 旁白 / 口播这一层（A/B/C 三档） |
| `docs/CHANGES-vs-upstream.md` | **相对上游 237e985 的全部改动**（37 提交 / 381 文件，按引擎·工作台·模板·风格·判据·流程分块） |
| `docs/SFX.md` | 音效层：从 SoundDino 取（授权/配额/记账）、`anim` 侧的接入缺口 |
| `docs/THREE.md` | 第 3 种 3D：Three.js 镜头 |
| `docs/DIAGNOSIS.md` | 输出词 → 含义 → 修法（**看到不认识的诊断词就查**） |
| `docs/PERF.md` | 渲染性能实测与验收口径 |
| `docs/BACKLOG.md` | **「还没做的事」的唯一清单** —— 要动引擎先看这份 |
| `docs/history/` | **归档，别当待办读**（索引：`history/README.md`） |

---

## 10. 交付前自检

1. `check <任务>` 无报错、无空档告警、每段都不是全黑、**背景守门通过**（三点 15%/50%/85% × 单/多子帧
   两条路径：过曝、两条路径不一致、**段内亮度不均**、**交叠段没铺整帧背景**都会报）。
2. `still` 抽查了**每一段**的中间帧，并且**真的用 Read 看了图**（配置档任务同理：段名 = 模板名或你写的 `id`，
   `--only` 用的就是它，例如 `still <任务> -t 6 --only chart,title`）。
3. 有音乐的片子：切点对齐在拍上（`dur: { beat: n }`）。
4. `video` 出片成功（CLI 会用 ffprobe 复核产物：帧数不符就报错并删废文件，分块模式逐块复核）；
   再确认就 `verify <任务>` + `qa <任务>`（解码/黑场/静帧/音量 —— 切点处的短暂黑闪只有它会扫出来）。
5. 段间没有黑隙（`check` 报「空档」），最后一段有淡出或明确收尾。
6. 代团队/项目对外发声的片子：`tasks/<任务>/FACTS.md` 逐句标出处（模板 `docs/FACTS-TEMPLATE.md`），
   并列出「刻意没写的东西及原因」。
7. 有旁白的片子：`anim say` 输出里**无叠句警告**、无 `MAX_STRETCH` 顶格警告、说话占比不离谱（>80% 会提醒），
   每段最后一句之后还有 `TAIL` 秒画面（`solveTiming` 保证并打印）。改完旁白先跑 `node tools/test-say.mjs`（免 GPU）。
8. **风格由内容决定**（`docs/STYLE.md`）：先按内容选最合适的 `style`；只有连着发布两支同题材、
   上一支刚用过同一套时才考虑换脸（建议不是门）。对比图：`still <任务> -t <时刻> --style paper`（不改文件）。
9. **有旁白的片子开了引擎字幕**（`docs/CAPTIONS.md`）：`captions: true` 且 `lint-narration-dup` **零命中**，
   `check` 里没有「压进字幕保留带」的警告。平台要软字幕就 `subs <任务>`（**开过 captions 就别再烧一遍**）。
10. **一屏只让观众看一件事**（`docs/LAYOUT.md`）：`check` 的「版面守门」段没有 `⚠`，且**声明了主体**
    （场景对象上写 `focus: 'center'` 或 `{ x, y, w, h }`）—— 不声明时那两条判据**根本没跑**（进 `skipped`）。
    判据「主体之外 ≤ 2 块、每屏 ≤ 6 块字」默认只 warn，**交付自检加 `--strict`** 才当门。观众原话：
    「有些动画元素相互遮挡害得我搞不清楚到底要看哪个主体」。
11. **画面上的数字必须有出处**（`docs/BACKLOG.md` 1-22；判据与边界见 `docs/FACTS-TEMPLATE.md` ★ 一节）。
    **画面全是代码算的，「编一个数字」的成本是零**，只能靠硬规则：数值显示位（`type.write` 的字符串、`chart` 的
    `values`、`codeRow`、模板的 `title`/`sub`/`footer`、旁白与字幕）里的字面量数字，要么在 `tasks/<任务>/FACTS.md`
    有出处，要么写占位符 `— figure —`。自查 `lint-fabricated-numbers` 零命中。⚠ 它只扫显示位且**不进退出码**：
    **算出来的数**（模板串插值 / `.toFixed()` / `values` 里的变量）单列「没验」—— 登记口径或写占位符。坐标/字号/时长/阈值/颜色分量不算。
11.5 **切点对得上拍子**（有音乐时）：`check` 的「卡点」那行要是 `✓ N/N 个切点都在 ±30ms 内`（`--strict` 要求 ≥90%）。
    对不上就改段长（`dur: { beat: n }`）或把 `narration.mjs` 的 `BPM` 设成实测值；单独体检 `tools/lint-beat-align.mjs`
    （它从音频**自己重建**网格，不信 `analysis.json` 的 bpm 估计）。
11.6 **每一秒都有东西看**（有音乐时也要）：`check` 的「事件密度」读的是**成片**帧间差 —— `最长静止 ≤ 3.5s`、
    `稀薄窗口 ≤ 25%`（低于均值一半的 2 秒窗口）。超了就补持续运动（推近/扫线/逐条落位），别指望 2px 游标
    或 0.09 alpha 的水印（检测器和人眼都看不见）。单独体检 `tools/lint-event-density.mjs <任务>`。
11.7 **提交前钩子会跑一次自检**（只读已有成片，不渲染）：`node tools/install-git-hooks.mjs` 装一次，之后
    `git commit` 会对**你改到的任务**跑 `anim report`，判据红就拦住；只是被引擎改动顺带扫到的片子只提醒不拦。
    绕过：`--no-verify`。
11.8 **机器判据过了之后，还要人过一遍 docs/RULES.md**（R/Q/S/C/P 十二条判例准则：节奏/构图/声音/文案/流程）。
    输出格式 R1 ✓ / Q2 ✗(第 3 段)；有意违反要在 `tasks/<任务>/FACTS.md` 写明违反了哪条、为什么。
12. **自检最多 3 轮，3 轮不过就交人**（第 4 轮起就是在猜）；发布前派一个**只挑毛病不夸**的审查者，
    交回**按时间码排序的问题清单 + 证据**（哪一秒、哪张图、什么问题）。原文与理由见
    [`docs/REFERENCE-video-use.md`](docs/REFERENCE-video-use.md) §3.3；切点优先看 `anim cuts`。

### 出问题时按这个顺序查

> **症状 → 原因只有一张表**：在上面 §8（这里不再复制 —— 两份表迟早漂移成互相矛盾）。

```sh
# ① 体检（三点采样 + 多子帧 + 背景守门/版面/卡点/事件密度）
node scripts/anim.mjs check <任务> [--quick | --strict]

# ② 画面不对 → 出图看，别猜
node scripts/anim.mjs still <任务> -t …   # 单帧
node scripts/anim.mjs cuts  <任务>        # 切点两侧 ±1.5s 接触表
node scripts/anim.mjs audit <任务>        # 交叠段在交叠期到底画了什么

# ③ 引擎层 / 确定性 / 像素级量具
node scripts/anim.mjs determinism <任务> --from 0 --frames 40   # 跨帧依赖定位（分叉即退出码 1）
node scripts/anim.mjs probe-alpha <任务>    # 整行淡入（alpha）到底生效没有
node scripts/anim.mjs dumpframe <任务> -t 0.5 --run-up          # 裸帧 + 引擎内部量
node scripts/anim.mjs dumppx <任务> --times 1.5 --out x.raw     # 浏览器那一帧的裸像素
node scripts/anim.mjs probe <任务> --times 4,12   # 渲染顺序会不会改变结果
node scripts/anim.mjs diff <任务> --times 12      # 同一时刻渲两次差多少
node scripts/anim.mjs gpu [<任务>]                # 浮点纹理缺失 = 这台机器不能跑 HDR
node tools/probe-raymarch.mjs / probe-three.mjs / probe-colorspace.mjs / png-rows.mjs
node tools/test-cam-math.mjs / test-say.mjs / test-karaoke.mjs / test-timeline-guard.mjs  # 纯 JS

# ④ 出片之后
node scripts/anim.mjs verify <任务>             # 抽帧 vs 重渲（拼接/帧数/色彩）
node scripts/anim.mjs hashes <任务> --baseline  # 变更探测器（变了 ⇒ 对比图 + 退出码 1）
node tools/regress-all.mjs [--only smoke]       # 整份回归（日志 out/_regress/）
node tools/regress-all.mjs --ci                 # **CI 那批**（unit:/meta:/harness:/say:）
                                                # ← 加测试只改清单，不要改 verify.yml（手抄必漂移）
```

> 输出里出现不认识的诊断词 → **`docs/DIAGNOSIS.md`**：三列（输出词 / 含义 / 修法），每条带 `文件:行号` 证据，
> 并写明退出码语义与「空 ≠ 干净」的读法（哪些行代表**没跑**而不是通过）。