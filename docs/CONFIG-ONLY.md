# CONFIG-ONLY.md —— 零代码出片（B 档：整支片子只有 `task.config.mjs`）

> **一句话**：当你要的画面能用 `src/shots/` 里那 25 个镜头模板的参数说清楚时，
> 时间线的每一项就直接写模板名 —— `{ type: 'chart', values: […], dur: 5 }` ——
> 任务目录里**只有 `task.config.mjs`，没有 `scenes/`，一个 `import` 都不用写**。
>
> 术语（三档作者模型，原 `docs/ROADMAP.md` §2；路线图三档已全部落地）：
> **A 档** = 镜头库 `src/shots/`（`shot('名字', {…})` 一行取一个整镜头）；
> **B 档** = 配置档，也就是本文（时间线直接写 `{ type: '名字' }`，由 `build()` 查表分发）；
> **C 档** = 手写场景（模板覆盖不到的新视觉）。
>
> 配套的完整示例任务是 `tasks/example-config-only/`（同样只有 `task.config.mjs`，无音频）。
> 它和本文是同一批落地的：`node scripts/anim.mjs tasks` 列得出它就直接照它抄，
> 列不出来就以本文 §2 的骨架为准。

---

## 1. 一句话：什么时候只用配置，什么时候不行

| 你要的东西 | 走哪条路 |
|---|---|
| 25 个模板能表达的画面（标题 / 柱状图 / 动态大字 / 甩镜 / 片尾 / 波形 / 同心圆 / 频谱网格 / 引言 / 计数 / 对比 / 一句主张 / 扫描格阵 / 界面窗口 / 一笔线稿 / 图表形变 / 分层纸片 / 等距体块 / 逐帧手绘 / 液体动态 / 署名定版 / 事件轴 / 径向分布 / 像素机 / 手写讲解） | **只写 `task.config.mjs`**（本文） |
| 段落顺序、每段时长、段间重叠（转场）、模板参数、配色、帧率与分辨率、选哪条音乐 | 同上 —— 这些本来就是配置 |
| 模板覆盖不到的新视觉（raymarch 晶格、燃烧的引线、钞票团花…） | **回去写场景代码**：`AGENTS.md` §3（场景长什么样）、`docs/COOKBOOK.md`（做法手册），也就是 C 档 |

判据只有一条：**这个画面能不能用某个模板的参数说清楚？** 能，就写配置；不能的那一段写场景，
其余段落照旧用模板 —— 模板返回的就是普通场景对象，两种写法能混在同一条时间线里
（`src/shots/index.js`）。配置档省掉的是**场景代码**，不是"看图"这一步。

⚠ **零代码 ≠ 零检查。** 出片流程一个字都没变：`check` → `still` → **用 Read 工具看那些 PNG** → `video`
（`AGENTS.md` §1）。不出图看就调画面，跟手写场景时一样是盲改。

---

## 2. 最小可跑的例子

一个完整的任务只需要一个文件：

```
tasks/我的片子/
  task.config.mjs        ← 就这一个
```

```js
// tasks/我的片子/task.config.mjs —— 没有 import，也不需要 scenes/
export default {
  title: '我的片子',
  width: 1920, height: 1080, fps: 60, scale: 1,   // 这四个都有默认值，就是这里写的这些
  palette: { signal: '#00e0ff' },                 // 可选：覆盖默认调色板的强调色
  timeline: [
    { type: 'title', title: '我的片子', sub: '副标题', dur: { beat: 8 } },
    { type: 'chart', values: [0.3, 0.7, 0.95], title: '成绩', dur: 5 },
    { type: 'outro', title: '完', dur: 3 },
  ],
};
```

三条命令：

```sh
node scripts/anim.mjs check 我的片子            # 体检：静态扫描 + 逐段试渲染 + 亮度/背景守门 + 印出时间线
node scripts/anim.mjs still 我的片子 -t 1,6,9   # 出单帧 PNG → out/我的片子/stills/f_0001.000.png …
node scripts/anim.mjs video 我的片子            # 出成片 → out/我的片子/我的片子.mp4
```

产物都落在 `out/<任务>/`：

| 命令 | 产物 |
|---|---|
| `still` | `out/<任务>/stills/f_<时刻>.png`（`-t 9.5` → `f_0009.500.png`） |
| `sheet` | `out/<任务>/sheet_<from>-<to>.png`（一张接触表看一段运动） |
| `shot` | `out/<任务>/shot_<from>-<to>.mp4`（无音轨短预览） |
| `video` | `out/<任务>/<任务>.mp4`（配了 `audio` 就带音轨；收尾时 CLI 自己用 ffprobe 复核帧数） |

`still`/`sheet` 的 `-t`、`--from/--to` 都是**整片时间**（不是段内时间）——例外是 `--only a,b`，
它会把选中的段平移到时间轴开头，那时 `-t` 才是段内时间（`AGENTS.md` §7）。

`task.config.mjs` 里能写的东西（`src/tasks.js` 的 `TaskSpec`）：

| 字段 | 意思 |
|---|---|
| `title` | 片子名（HUD 里显示；与模板参数 `title` 是两件事） |
| `style` | **风格包**：`'paper'` 或 `{ name: 'paper', grid: {…} }`。一行换掉整片观感（配色 / 字体 / 背景母题 / 后处理基线 / 栅格 / 字幕样式）。可选的看 `node scripts/anim.mjs styles`，细则见 `docs/STYLE.md`。**不写 = `print`**（= 引擎从前的默认观感，一像素不变） |
| `captions` | **引擎字幕层**（`docs/CAPTIONS.md`）：`true` 就开，或有旁白时写 `{ size: 46, karaoke: true }` 微调。开了之后引擎每帧自动画当前那句旁白，场景里一行都不用写。**默认关**（老任务零变化） |
| `width` `height` `fps` `scale` | 逻辑分辨率、帧率、输出倍率（`scale: 2` = 真 4K），默认 `1920 / 1080 / 60 / 1` |
| `palette` | 覆盖调色板（键见 `src/core/palette.js`：`ink` `bone` `signal` `ember` …）。**与风格包叠加，任务优先**：`style: 'paper'` + `palette: { signal: '#1f6f9c' }` = 纸面风格但换掉强调色 |
| `audio` | 音乐（相对任务目录）。需要音乐的模板（§7）必须配它 |
| `fonts` | 任务自带字体（`.css` 或字体文件），相对任务目录 |
| `duration` | 总时长；不写 = 时间线最后一个 `end` |
| `narration` | 旁白句子表（内联对象或 json 路径），配合 `dur: { vo }`；细节见 `docs/NARRATION.md` |
| `timeline` | **时间线**：数组，或 `seq([...])`（见 `AGENTS.md` §3） |

> **配置档能改到哪一层（2026-10 起）**：以前换风格只能靠 `palette`，而模板自带的背景、
> 硬编码的字体族、以及模板 `return` 的 post 让"零代码出片"必然长得像 demo。现在
> **`style` 一行**就能换掉：调色板 + 字体栈（`TextKit` 的族映射，模板里写的逻辑名会跟着换）
> + 背景母题（`worldPass` 的 `motif`）+ 后处理基线（`style.post` 最后合并，压得住模板的 bloom）
> + 版面栅格 + 字幕样式。背景母题只在用 `world: 'auto'` 的段生效 —— 25 个模板自带满帧背景，
> 所以换母题要么写手写场景，要么用 `--style` 先看效果。

> 新建任务目录后：用 CLI 渲染**不需要**重启任何东西；`npm run dev` 的预览服务需要重启一次才看得到新任务
> （`src/tasks.js` 的提示语）。

---

## 3. 节点字段表：哪些键是时间线的，哪些键是模板参数

时间线的每一项 = 一个对象。**属于时间线的键只有这 15 个**（`src/timeline.js` 的 `TIMELINE_KEYS`）：

| 字段 | 意思 |
|---|---|
| `type` | **模板名**（20 个之一）。必填；写了 `type` 且没有 `scene` 才是"配置档节点" |
| `id` | 段名。不写 = 模板自己的默认段名（`title` / `chart` / …）；重复时自动加 `_2`。`--only`、HUD、报错里都用它 |
| `dur` | 段长（§5 的四种写法）。**不写 = 4 秒** |
| `at` | 绝对起点；不写 = 接在上一段之后（再减去 `overlap`）。也接受拍号 |
| `overlap` | 与**上一段**重叠多少秒 = 转场；不写 = 0（硬切） |
| `params` | 显式写模板参数。与节点上的散键合并，**`params` 优先** |
| `post` | 这一帧的后处理参数（`AGENTS.md` §5 那张表）。⚠ 模板自己 `render()` 里 `return` 的 post 会盖过同名的键（§3.1） |
| `maxSamples` | 这一段自适应子帧数的**上限**（引擎取所有在播段里最小的那个，`src/core/engine.js`）。⚠ 只往下压，是**提速**旋钮，合法档 8 / 24 / 72 / 216（§3.1） |
| `handlesTransition` | 这一段自己处理与上一段的衔接（`whip` 模板自带，一般不用写） |
| `note` | 备注，只印在 `check` 的时间线表里，不影响画面 |
| `world` / `worldPass` | 共享背景：`world: 'auto'` = "引擎铺底"（用 `task.config.mjs` 里 `export const world` 那张），`world: false` = "**这一段我刻意不铺底**"（背景守门**不判**它的铺底，但照样给它读数）。纯配置档里前者等于没写（没有 `task.world` 可解析），后者照旧生效 —— 见 §3.1 |
| `focus` | **主体声明**（版面守门，见 `docs/LAYOUT.md`）：`'center'` 或 `{x,y,w,h}`。不写时退回场景对象自己声明的那份；**不声明 = 版面守门那两条判据不跑（进 `skipped`，没跑 ≠ 通过）** |
| `carry` | **连贯声明**（carry 审计，`anim carry`）：`'morph'`（这条缝是跨元素合成的衔接，量具会判 bare 但对观众成立）/ `'anchor'`（刻意锚定）/ `'any'`（交给量具）。判据与豁免见 `docs/REFERENCE-onetake.md` §2 |
| `transition` | 交叠期的转场模式（2026-10-24 起**默认 = 'push' 甩镜**）：`'mix'` = 交叉溶解（引擎旧默认）、`'none'` = 不处理（硬切）。只有写了 `overlap > 0` 的那道缝有意义，见 `docs/ENGINE.md` §4.5 |

**其余所有键都是模板参数**，会被原样交给 `shot(type, {…})`：

```js
{ type: 'chart', values: [0.3, 0.7, 0.95], title: '成绩', dur: 5 }   // 散键写法
{ type: 'chart', params: { values: [0.3, 0.7, 0.95] }, dur: 5 }      // 显式写法，等价
```

### 3.1 三个"用法都在、以前没人用过"的字段：`post` / `world` / `maxSamples`

这三个字段的转发是通的，但很长一段时间里 `tasks/` 下**一个真实用例都没有**，所以没人踩过它们的坑。
可跑的完整例子：**`tasks/_config-lab/task.config.mjs`**（只有这一个文件，5 段、30.70 秒）：

```sh
node scripts/anim.mjs check  _config-lab
node scripts/anim.mjs still  _config-lab -t 2,10,15,19.23,23,28.5,29.5
node scripts/anim.mjs audit  _config-lab          # 背景守门的原始数据（每个交叠段画了几次）
node tools/scene-harness.mjs _config-lab          # 离线跑场，不需要 GPU / 浏览器
```

**① `post` —— 后处理。用法**：写在节点上，就是这一段的后处理参数（`AGENTS.md` §5 的表）。

```js
{ type: 'kinetic', dur: 7.5, post: { bloom: 0.6, tonemap: 'agx', exposure: 0.75 } },
```

⚠ **坑：模板 `render()` 里 `return` 的 post 会盖掉同名的键**（合并顺序是
`{ …默认, …节点.post, …场景 return }`，`src/core/engine.js`）。上例里 `tonemap` 与 `exposure`
生效（`kinetic` 不返回它们），而 **`bloom: 0.6` 被模板自己的 `bloom: 0.34` 静默盖掉** ——
画面看上去"泛光没加强"，其余键却都对，一个字都不报。想只靠配置档加强泛光：做不到，
要么回去写场景，要么挑模板没返回的键（`anim shots <模板名>` 看参数，模板的返回值读 `src/shots/<名字>.js` 末尾）。
**`_config-lab` 第 4 段就是这一段的对照**：其余四段都不写 `post`（各自用模板自己的后处理），
只有它是 `tonemap: 'agx'` + `exposure: 0.75`。

**② `world` —— 共享背景。用法**：`world: 'auto'`（= `worldPass: true`）声明"底由引擎铺"；
`world: false` 声明"**这一段的整帧底由我自己负责**"。

```js
{ type: 'chart', dur: 15.5, world: 'auto' },   // 声明引擎铺底（本任务是纯配置档 → 解析成 null，底由模板自带）
{ type: 'whip',  dur: 1.5, overlap: 0.5, world: false },   // 整帧底 = 上一段的成帧（ctx.under）甩上来
```

⚠ **坑：`world: false` 是合法声明，不是"骗过 `check`"的开关。** 它的语义是
"**这一段的整帧底由我自己负责，引擎别再加一层**"，背景守门（`worldAudit`）**不判它的"铺没铺底"**
（`src/app.js` 的 `worldAudit()`：这类段进返回值的 `selfBase` 那一栏）。所以别为了让它绿去画一笔
没意义的全屏 Pass —— 那是把这个字段用成了谎话。四条实测出来的、容易误解的事
（`node scripts/anim.mjs audit _config-lab` 就是复现命令）：

- **守门只查"与前一段交叠"的段，而且每个这样的段取两个时刻**（交叠窗中点
  `it.start + max(0.02, span/2)` 与**交叠窗之后**的中点；2026-10-16 前只有前者，见 BACKLOG 头部 ⑦）。
  ⚠ **判据只在第一个点**（交叠窗中点）；窗后中点**只做读数** —— 转场模板在窗后走"没有 under"那条分支，
  本来就可能是近黑的（甩镜的设计值 0.037–0.051），把判据也压上去会假报（`check demo` 实测踩过）。
  `_config-lab` 5 段里实际有 **3 处交叠**（图表→甩镜、甩镜→动态大字、动态大字→片尾）：
  守门**判** 2 段（kinetic / outro），甩镜因为 `world: false` 进的是 `selfBase` 那一栏
  （**不判、但读数照给**）。
- **`world: false` 在守门的数据里显示成 `world=self`**（以前它被 `continue` 掉、连一行都没有）。
  `anim audit` 会把它单独列一段，并打出两个采样时刻的**整帧覆盖次数与画面亮度** ——
  声明"底我自己负责"不等于"这段没人看着"。
- **守门仍然不是"整段都看着"**：它采的是两个**点**（交叠窗中点 + 窗后中点），不是整段，
  而且只有第一个点是判据。
  `_config-lab` 里甩镜 `19.50–20.50` 那 1 秒现在有了读数（窗后中点，实测亮度 0.051），
  但"任一点都没铺底"这种判据仍然只在那两个点上成立 —— 要整段覆盖得靠 `sheet` / 抽帧看。
  顺带说明：甩镜尾巴的 0.051 是**模板自身的设计**（`tasks/demo` 的 whip 尾巴同样是 0.051），
  不是漏画 —— 所以亮度只当读数、不当判据。
- 在**纯配置档**里 `world: 'auto'` 等于没写：`export const world` 是手写场景那一路的东西
  （`AGENTS.md` §3 的 `worldPass()`），没有它时 `resolveWorld()` 老老实实返回 `null` ——
  25 个模板本来就各自铺满整帧，写它只是把意图写清楚。想让它真的生效，三条路：
  ① 给任务一个 `export const world`（那就要有 `scenes/` 或至少一个模块）；
  ② 写手写场景并用 `cut(scene, { world: 'auto' })`；
  ③ 节点上直接给一个 world Pass 对象（`world: myPass`）—— 这是**这一段专用**的背景，
  和手写场景那条路吃的是同一段引擎代码。

> **`whip` 要放多长？**（这条不是 `world` 的坑，但同一个夹具里撞上了）它只在**交叠窗**里有
> 上一帧可甩（`ctx.under` 只在 `t < 上一段.end` 时才有值）；而且它自己就会把画面压暗 ——
> shader 里 `col *= mix(1.0, 0.15, k)`，`k → 1` 时只剩 15%，交叠窗之外的速度线/径向模糊/震屏
> 也随 `energy = sin(min(1, k)·π)` 一起归零。实测（`_config-lab`，`check` 的亮度读数）：
> 交叠窗中点 **0.945**（图表正被甩成横向拉丝）→ 窗后 0.051 → 段尾 0.056；
> `tasks/demo` 的 whip 尾巴同样是 0.051。
> 也就是说 **`dur ≈ 3 × overlap`（约 1.5 秒）时它正好压到黑，再长就是一条没人看的黑尾**，
> 而且**不报错**（0.04–0.05 够不上"全黑"阈值）。同时让上一段铺满这 1.5 秒，
> 暗下去才是"甩走"而不是"没画"。

> **一个已知的"报告不一致"**（只影响 `check` 的文字，不影响画面，可放心忽略）：
> `check` 的背景守门那行会数"其中 N 段声明了转场/共享背景"，但它读的是**段**上的
> `handlesTransition`（`src/app.js:881/884`），而引擎读的是**场景**上的那一份
> （`src/core/engine.js:563`）。配置档这条路里 `configToCut()` 把节点上的值原样带过去
> （`src/timeline.js:92`），节点上没写时是 `undefined` ⇒ 模板自带的 `true`
> （`src/shots/whip.js:34`）到不了段对象，那一行就会把它数成"没声明"。
> **画面是对的**：引擎走场景那一份，所以不会对 `whip` 再叠一次交叉溶解
> （`_config-lab` 的 `19.23` 那一帧实测就是"图表被甩成横向拉丝 + 一道 signal 主轴"，没有两屏叠影）。
> 想让那个数字也准，写场景的路子可以在节点上显式写 `handlesTransition: true`
> （配置档节点也接受这个键）；引擎侧的修法是让守门回退读 `it._scene?.handlesTransition`。

**③ `maxSamples` —— 自适应子帧数的上限。用法**：给"最贵的那一段"封个顶。

```js
{ type: 'whip',    dur: 2.5, overlap: 0.5, maxSamples: 72 },   // 甩镜是全片动得最快的：封顶 72
{ type: 'kinetic', dur: 7.5, maxSamples: 24 },                 // 逐像素噪声的底：封顶 24 = 这一段变快、画面略粗
{ type: 'outro',   dur: 3.5, maxSamples: 216 },                // 合法顶档 = 不封顶（引擎自己的 MAX_SAMPLES 就是 216）
```

⚠ **坑：它只把上限往下压 —— 是提速旋钮，不是"加密采样"，写大了不会更细。**
合法档只有 **8 / 24 / 72 / 216**（`8 × 3^L`：引擎先 `Math.min(216, item.maxSamples)`、
再 `Math.max(8, …)`，最后取能落到的那一档，`src/core/engine.js`）。
写 `maxSamples: 64` 会被**夹到 24**：画面**更粗**、渲染**更快**，而且一个字都不报。
想让拖影更细要调**小** `--tol`（自适应容差，默认 2.5），不是把这个数调大。
（它的效果只在多子帧那条路上看得见：`--samples 1` / `still` 单帧路径根本不走自适应采样。）

### 写错会怎样：抛错，并点名

这是刻意的设计 —— 镜头库的注释里写着理由：这个引擎最贵的 bug 全是"**写错了但画面照样出**"
（`src/shots/index.js`、`docs/history/IMPROVEMENTS-1-3.md`）。下面四条是从 `src/tasks.js` → `src/timeline.js`
（`configToCut`）→ `src/shots/index.js`（`shot`）三层包装后的**真实报错形状**，只有"写错的那个名字"是举例：

**① 模板名写错** —— `{ type: 'chart2', dur: 5 }`：

```
tasks/我的片子/task.config.mjs 的时间线不合法：
timeline[0] 这一段（type: "chart2"）取不到镜头模板：
  未知的镜头模板 "chart2"。可用的：title / chart / kinetic / whip / outro / wave / pulse / grid / quote / counter / compare（看参数：node scripts/anim.mjs shots <名字>）
```

> ⚠ 上面那串名字是**报错原文**，它会随模板库增加而变化（2026-10 从 8 个变 11 个，这一行就过期过一次）。
> **以 `node scripts/anim.mjs shots` 的输出为准**，不要照抄本文档里的列表。

**② 参数名拼错** —— `{ type: 'chart', value: [0.3, 0.7], dur: 5 }`（少个 `s`）：

```
tasks/我的片子/task.config.mjs 的时间线不合法：
timeline[0] 这一段（type: "chart"）取不到镜头模板：
  镜头模板 "chart" 没有参数 "value"（大概是拼错了）。可用参数：id / values / title / sub / footer / peak
```

**③ 时间线字段名拼错也会被抓**，走的是同一条路 —— 因为它不属于那 15 个键，会被当模板参数交出去：
`{ type: 'title', durs: 5 }` → `镜头模板 "title" 没有参数 "durs"（大概是拼错了）。可用参数：id / eyebrow / title / sub / readout`。

**④ 配置档节点和"已经展开好的段"混写** —— 后者指带 `scene` 和数字 `start`/`end` 的对象
（例如把 `build()` 的产物又塞回时间线）：

```
时间线里不能混写「配置档节点」和「已经展开好的段」：
  · 配置档节点 = { type: 'chart', values: […], dur: 5 }（要由 build() 排时间）；
  · 展开好的段 = { id, scene, start, end, … }（绝对时间是有意义的）。
  build() 会把后者也当成一个节点重新排，它的 start/end 就被静默丢掉了。
  → 统一成一种写法：都写配置档，或者都写 cut()/seq()。
```

（前面还会带一行 `tasks/<任务>/task.config.mjs 的时间线不合法：`。）
注意：配置档节点**可以**和 `cut(scene, {…})` 混在一条时间线里 —— 那是"模板镜头 + 手写场景"，
是支持的用法；被拒绝的只有"已经展开好的段"。

---

## 4. 25 个模板一览

| 名字 | 画什么 | 主要参数 | 要音乐吗 |
|---|---|---|---|
| `title` | 大标题入场：眉标逐字打出 + 主标题逐字上浮 + 一条生长的横线与刻度 | `title` `sub` `eyebrow` `readout` | 不用 |
| `chart` | 柱状图逐条生长：坐标轴 + 排线柱体 + 扫描线与跟随读数 | `values` `title` `sub` `footer` `peak` | 不用 |
| `kinetic` | 动态大字 + GLSL 背景 + 左下角滚动的计数器阵列 | `headline`(见下) `sub` `cellCols` `cellRows` `cellSeed` | 不用 |
| `whip` | 甩镜转场：把上一段的成帧甩走 + 斜向速度线 + 震屏 | `streaks` `dir` | 不用 |
| `outro` | 片尾：从两侧收拢的细线与刻度 + 标题落位 + 最后 0.6 秒压黑 | `title` `sub` `signature` | 不用 |
| `wave` | 波形：以当前时刻为右端的历史窗口，逐列画包络竖线 + kick 横线 | `label` `cols` `window` | **要** |
| `pulse` | 同心圆：8 圈从最近 8 个拍点扩出去，中心方块跟低频呼吸 | `title` | **要** |
| `grid` | 频谱网格：每列一个频段，按包络高度点亮格子 + 扫描线 | `label` `cols` `rows` `window` | **要** |
| `quote` | 引言：眉标 + 一条生长的竖线 + 大段引文逐行上浮 + 出处（`align: 'center'` 是居中版） | `label` `text` `cite` `role` `align` | 不用 |
| `counter` | 计数：环形刻度盘 + 进度弧 + 从 `from` 滚到 `to` 的大数字（千分位 / 小数位 / 单位） | `from` `to` `decimals` `unit` `label` `sub` `footer` | 不用 |
| `compare` | 对比：一行一个指标，上下两条水平条 + 右侧 `A → B` 读数 | `title` `sub` `aTitle` `bTitle` `rows` `footer` | 不用 |
| `bigtype` | 一屏一句：hero 级大字逐行上浮 + 关键词换信号色（切段画）+ 左侧引导线 | `kicker` `line1` `line2` `mark` `footer` | 不用 |
| `scan` | 扫描格阵：扫描线从左到右，走过的格子按确定性读数填块（**不读音乐**） | `kicker` `label` `cols` `rows` `footer` | 不用 |
| `device` | 界面窗口：四条边依次展开 + 标题栏 + 一句标题 + 逐行填出来的内容骨架 | `kicker` `chrome` `title` `rows` `footer` | 不用 |
| `lineart` | 一笔线稿：折线按弧长自绘 + 走过的节点留圆点 + 笔尖带当前节点的名字 | `kicker` `points` `labels` `footer` | 不用 |
| `morph` | 图表形变：柱 → 折线 → 排线面积，同一组数换三种画法（位置不变） | `values` `title` `sub` `footer` | 不用 |
| `layers` | 分层纸片：带透视的纸页从后往前落位，最前面那张写标题 | `kicker` `sheets` `title` `footer` | 不用 |
| `isometric` | 等距 2.5D 体块：一格格方块从地面长起来，按 `gx+gy+gz` 从远到近画（画家算法） | `kicker` `title` `sub` `cols` `rows` `cell` `height` `footer` | 不用 |
| `cel` | 逐帧手绘 · 线条沸腾：纸面 + 每 2 帧重描一次的线（圆不圆、线不直） | `kicker` `title` `sub` `amp` `footer` | 不用 |
| `liquid` | 液体动态：域扭曲 fbm 流体底 + 一圈圈落下的液滴涟漪 | `kicker` `title` `sub` `drops` `footer` | 不用 |
| `lockup` | 署名定版：几何标记 + 字标 + 副标 + 分隔线 + 署名行（停住、不压黑） | `mark` `kicker` `name` `tagline` `meta` `footer` | 不用 |
| `timeline` | 横向事件轴：轴从左画到右，笔尖路过的事件节点依次弹出，事件名上下交替 | `kicker` `title` `events` `footer` | 不用 |
| `radial` | 径向分布：中心呼吸核 + 一圈轮辐（节点/名字/读数条）+ 慢转的缺口环 | `kicker` `title` `nodes` `weights` `footer` | 不用 |
| `pixel` | 像素机：4–8 色调色板 + 整块栅格 + Bayer 抖出来的渐变 + 12fps 台阶的精灵队列 | `kicker` `title` `palette` `cell` `crawl` `footer` | 不用 |
| `handwrite` | 手写讲解：白板 / 纸感，一笔一笔按弧长生长（有笔压），每 2 帧重描 | `kicker` `title` `mode` `seed` `boil` `footer` | 不用 |

- **没有"必需参数"**：每个模板的每个参数都有默认值，什么都不传就是它自己的默认画面。
- 参数的类型、默认值、说明，以及每个模板的注意事项，**唯一权威**是：

  ```sh
  node scripts/anim.mjs shots            # 25 个模板的名字与一句话
  node scripts/anim.mjs shots chart      # 某一个模板的全部参数 + 类型 + 默认值 + 说明
  ```

- 每个模板都有 `id`（段名）。`id` 也可以写在节点顶层（时间线字段），效果一样。

**几个"名字在表里、语义没写"的参数**（写错了不报错，只是画面悄悄变弱）：

| 参数 | 默认 | 要知道的事 |
|---|---|---|
| `chart.peak` | `0.95` | 判"最高那根"的阈值：`>= peak` 的柱子才用**信号色 + 顶端小帽**。**你的 `values` 上界低于它 → 整张图没有强调色**。换量纲时写成 `peak: Math.max(...values)` |
| `whip.dir` | `[1, 0.12]` | 甩的**方向**（uv 空间：`x` 正 = 内容被带向画面右，`y` 正 = 向下）。**连续两段甩镜要反向**（`[1,0.12]` → `[-1,-0.08]`）；`streaks: 0` 只留方向性模糊 |
| `title.readout` | `true` | 右下角那个随时间走的 `NNN%` 读数，是 demo 的演示元件 —— **正片一般写 `readout: false`** |
| `kinetic.cellCols` / `cellRows` | `8` / `5` | 左下计数器阵列的列/行数，每格 26×26 逻辑像素、从 (60,60) 起算 —— 调大就铺满下半屏 |
| `wave.window` | `1.2` | 只管**波形竖线**的窗口；kick 横线固定查 `t-2.2..t`，与它无关 |

三条"参数没写错、但会画错"的规则（都在 `anim shots <名字>` 的说明里）：

- `kinetic` 的 `headline` **必须正好两个元素**（两行大字，多给少给都会画错）。
- `whip` 是**转场镜头**：它要放在与上一段有 `overlap` 的位置才拿得到 `ctx.under`（上一段的成帧）；
  单独播它（`--only whip`）画面几乎是黑的，那是正常的。
- `outro` 别写太短：细线要到 t=1.6 才收拢完、压黑在最后 0.6 秒，段长短于约 2 秒会看到"还没写完就黑了"。

---

## 5. 时长与节奏

`dur`（段长）和 `at`（绝对起点）都接受这几种写法：

| 写法 | 意思 |
|---|---|
| `dur: 5` | 5 秒 |
| `dur: { beat: 8 }` | 8 拍 |
| `dur: { bar: 2 }` | 2 小节（1 小节 = 4 拍） |
| `dur: { vo: 'hook-1' }` | 和 `hook-1` 这句旁白**一样长**（可加 `tail: 1.2` 再多留 1.2 秒） |
| 不写 | **4 秒** |

**没有音乐时按 bpm 120 折算**（`src/timeline.js` 的 `beatTime`，`bpm` 缺省 120）：
一拍 0.5 秒、一小节 2 秒。所以 §2 那个例子里 `{ beat: 8 }` 其实是 4 秒。
⚠ **同一个配置，配了音乐之后 `{ beat: 8 }` 会变成另一个长度** —— 那正是"镜头长度天然对齐音乐"的代价。
要么配 `audio` + 跑一次 `analyze`，要么统一写秒。

有音乐时的推荐流程：

```sh
node scripts/anim.mjs analyze 我的片子     # 生成 tasks/我的片子/audio/<音乐文件名>.analysis.json
```

之后 `{ beat: n }` / `{ bar: n }` 走的是**分析出来的真实拍网格**（`music.beats`），
切镜头就自然落在拍上：

```js
timeline: [
  { type: 'title', title: '…', dur: { bar: 2 } },                     // 2 小节
  { type: 'chart', values: [/* … */], dur: { beat: 16 }, overlap: 0.4 },
]
```

（`music.timeOfBeat(...)` 那些是**场景里**的 API；配置档用不到，写 `{ beat }` 就够了。）

`{ vo: 'line-id' }` 的一个前提：`build()` 是在**任务加载时**跑的，那时能看到的旁白表只有
**内联**的那张 —— `narration: { lines: [{ id, text, start, dur }, …] }`（字段见 `src/core/narration.js`）。
`narration: './narration.json'` 是外部文件，页面启动**之后**才 fetch（`src/app.js` 的 `boot`），
那时时间线早就排好了 —— 所以纯配置 + `{ vo }` 请用内联表。句子 id 写错会抛错并列出表里的 id，
不会静默退化成 4 秒。

---

## 6. 转场

`overlap` = "与上一段重叠多少秒"。不写就是 0，也就是**硬切** —— 大多数剪辑点本来就该是硬切。

```js
timeline: [
  { type: 'title', title: '开头', dur: 4 },
  { type: 'whip',  dur: 0.8, overlap: 0.6 },                          // 甩镜转场
  { type: 'chart', values: [0.3, 0.7, 0.95], dur: 6, overlap: 0.6 },  // 引擎默认转场（交叉溶解）
  { type: 'outro', title: '完', dur: 3 },
]
```

- **`whip`**：模板自己声明了 `handlesTransition: true`（`src/shots/whip.js`），
  它读 `ctx.under`（上一段这一刻的成帧）做方向性模糊 + 速度线 + 震屏。你只要给它 `overlap`。
- **其它模板**：不写 `handlesTransition` 时，引擎自己做**交叉溶解** —— 把上一段的成帧与本段按
  入场进度 `tin` 混起来（`src/core/engine.js`）。
- ⚠ **文字量大的画面不要交叉溶解**：两屏字叠在一起会糊（`AGENTS.md` §4.5）。
  要么硬切（不写 `overlap`），要么让它"走掉"—— 用 `whip`，或者回去写场景用
  `src/core/trans.js` 的 `transitionPass` / `enterOffset`。
- **配置档一般不需要 `world` / `worldPass`**：25 个模板都自带整帧背景（各自的背景 Pass 或
  `gl.clear` 到 `P.ink`），写上去只是多铺一层马上被盖掉的底。共享背景是给**手写场景**用的
  （`cut(scene, { world: 'auto' })`，见 `AGENTS.md` §3）。
  两个例外（细节与坑见 §3.1）：**`world: false` 在配置档里是有意义的**（"这一段我刻意不铺底"，
  背景守门不判它的铺底（`world=self`），例如 `whip` —— 它的整帧画面就是上一段的成帧）；
  而**同一条时间线里混了手写场景**、并且 `task.config.mjs` 里有 `export const world` 时，
  配置档节点写 `world: 'auto'` 会真的拿到那张共享背景（"切镜头时世界不跳"）。

---

## 7. 需要音乐的三个模板：`wave` `pulse` `grid`

这三个读 `ctx.music`（包络数组、拍点、打击事件）：

- **`task.config.mjs` 里没配 `audio` → 这三个模板的画面近乎是空的**（`wave` / `grid` 基本全空；
  `pulse` 仍会画中心方块与底部标题）。`check` 会报这几段亮度≈0，别以为模板坏了。
  ⚠ 但注意 `ctx.music` **不是 `null`** —— 它是空对象 `SILENT`：`music.hasAudio === false`、
  `music.beats.length === 0`、包络全是 `0`，所以 **`f.a` 的字段是 `0` 而不是 `undefined`**。
  要判"有没有音乐"用 `ctx.music.hasAudio`（或 `music.beats.length > 0`），**不要**写 `if (!ctx.music)`
  或 `f.a.rms === undefined` —— 那两种判法都会判反（画面会静默退化成一条平线）。
- 配了 `audio` 但没跑过 `analyze`：也不会立刻黑 —— `MusicData.load` 会退回到
  "在浏览器里现解码 + 现分析"（`src/core/audio.js`），画面出得来，只是每次启动都慢。
  `video` / `shot` 发现缺分析文件时会**自己先补一次**并打印 `· 还没有音频分析数据，先算一遍（让画面能踩拍子）…`；
  `still` 不会。稳妥做法还是自己先跑一次。

```js
audio: './audio/track.mp3',
timeline: [
  { type: 'wave',  label: 'BEAT', dur: 6 },
  { type: 'pulse', title: '节奏不需要手抄', dur: 6 },
]
```

```sh
node scripts/anim.mjs analyze 我的片子    # → tasks/我的片子/audio/track.analysis.json
node scripts/anim.mjs check 我的片子      # 印出 bpm / 拍数，并逐段报亮度
```

- **音频放在 `tasks/<任务>/audio/` 下**：`analyze` 把分析文件固定写在那个目录
  （`scripts/anim.mjs` 的 `analyzeTaskAudio`），而页面是按"音频同目录"去找它的（`src/app.js`）。
- `wave` 读的是**整片时间** `f.t`（它画的是"这首歌到此刻为止"的窗口），
  `pulse` / `grid` 读**段内时间** `f.lt`（"这一段进来之后"）。这会影响你把它们放在第几段。

---

## 8. 边界与下一步

**什么时候必须回去写场景**：模板覆盖不到的新视觉，以及一切"要自己画"的镜头。
做法见 `AGENTS.md` §3（场景是什么形状）与 §3.5（`src/kit/shot.js` 的 `makeShot()`：
共享背景、甩镜转场、一台摄影机都包好了，场景只管画前景）；做法手册见 `docs/COOKBOOK.md`。
写完照旧能混进同一条时间线：

```js
timeline: [
  { type: 'title', title: '开头', dur: 4 },     // 配置档
  cut(myScene, { dur: 6, world: 'auto' }),      // 手写场景（这时才需要 world）
]
```

**想加一个新的镜头模板**（让它以后也能"零代码"）：

1. 在 `src/shots/` 加一个模块，导出 `xxxShot(opts)`，并在工厂上挂 `.defaults`（参数的唯一真源）
   与 `.meta`（`name` / `summary` / `notes` / `params`，`anim shots` 打印的就是它）；
2. 在 `src/shots/index.js` 的 `SHOTS` 表里注册这个名字（`{ type: '名字' }` 分发读的就是它）。

两条守门断言在 `tools/test-shots.mjs`（只读对象与源码文本，不渲染、可与渲染并行跑）：

- `SHOTS` 的键集合必须等于那个文件里的 `TEMPLATES` 列表 —— **加了模板要同步改那份列表**，否则回归会红；
- 每个模板 `meta.params` 的名字集合必须等于 `.defaults` 的键集合 —— 这就是"文档与代码脱节"的守门
  （`anim shots` 打印的**参数表来自 `meta`、默认值来自 `defaults`**，两者对不上就会有人照着文档写出默认画面）。

```sh
node tools/test-shots.mjs      # 镜头库的登记 + 文档一致性 + 报错路径
```

**不要**为了"纯配置"把模板撑成大而全的 DSL：模板应该少而专，需要新视觉时回 C 档写代码。

---

## 9. 排错表

| 症状 | 多半是 | 下一步（命令都是真能跑的） |
|---|---|---|
| `未知的镜头模板 "xxx"` | `type` 拼错，或用了一个不存在的模板名 | `node scripts/anim.mjs shots` 列出全部 20 个名字 |
| `镜头模板 "chart" 没有参数 "value"（大概是拼错了）` | 参数名拼错；或把时间线字段名写错（如 `durs`） | `node scripts/anim.mjs shots chart` —— 唯一权威的参数表（名字/类型/默认值/说明） |
| `时间线里不能混写「配置档节点」和「已经展开好的段」` | 把 `build()` 的产物（带数字 `start`/`end` 的对象）又塞回了 `timeline` | 统一成一种写法：都写 `{ type: … }`，或都写 `cut()`/`seq()`；手写场景用 `cut()` 是允许的 |
| 画面全黑（只有 `wave`/`pulse`/`grid` 的段） | 没配 `audio`（`ctx.music` 为 `null`），或分析数据不在 | ① 在 `task.config.mjs` 里配 `audio: './audio/x.mp3'` ② `node scripts/anim.mjs analyze <任务>` ③ `node scripts/anim.mjs still <任务> -t <这一段中间的时刻>`，再用 Read 看图 |
| 时长不对（每段都成了 4 秒） | 忘了写 `dur`（默认就是 4 秒） | `node scripts/anim.mjs check <任务>` 会把时间线逐段印成「段名 / 时长 / 起止」，一眼能看出是不是全 4 秒 |
| 段名出现 `title_2` `title_3` | 同一种模板在一支片子里用了几次，不写 `id` 时都用模板默认段名 | 需要区分就给每段显式写 `id`；`check` 的时间线表里看得到最终段名 |
| 时间线里写的 `post` 好像没生效 | 模板 `render()` 里 `return` 的 post 会**盖过**同名的键（合并顺序是 `{…默认, …item.post, …场景 return}`，`src/core/engine.js`） | 只写模板没设的键；或在 `still` 出图前后各来一张对比：`node scripts/anim.mjs still <任务> -t <时刻>`。可跑的例子见 §3.1 与 `tasks/_config-lab/` |
| 写了 `maxSamples: 64`，画面反而更粗 | 它不是"加密采样"，是自适应子帧数的**上限**，且只取 `8 / 24 / 72 / 216` 这几档 —— 64 被夹到 24 | 想让拖影更细：调**小** `--tol`（默认 2.5）；想让某段变快：这才写 8 / 24。见 §3.1 |
| 背景守门把某一段"漏掉"了 | 那一段**没有与前一段交叠**（守门只查交叠段，源码见 §3.1）—— 写 `world: false` 的段**不再"漏掉"**：它们进 `world=self` 那一栏（不判铺底、但有读数） | `node scripts/anim.mjs audit <任务>` 看每个交叠段实际画了什么（判铺底的那些 + `world: false` 的那些）；没写 `world` 的段显示 `world=none` |
| `check` 说"其中 0 段声明了转场/共享背景"，可我明明用了 `whip` | **已经修了**（2026-10-16，BACKLOG 头部 ①）：守门现在与引擎同口径，段上没有 `handlesTransition` 时读**场景**那一份（`whip` 模板自带 `true`） | 若还看到 0，说明那一段真的没声明转场（既没在节点上写、模板也不自带）；见过一次就回来登记 |
| 甩镜段的尾巴是一片近黑 | `whip` 会把画面一路压暗（`col *= mix(1.0, 0.15, k)`）：`dur ≈ 3 × overlap`（约 1.5 秒）时它正好压到黑，再长就是黑尾；窗外速度线/模糊/震屏也都归零 | 段长贴着"甩完"（`_config-lab` 是 `dur: 1.5 / overlap: 0.5`），并让上一段铺满它的全长。亮度 0.05 不会触发"全黑"告警，只能靠看图/`check` 的读数 |
| 改了配置但预览没变 | `npm run dev` 的预览服务看不到**新建的**任务目录 | 重启预览服务；CLI 渲染不受影响 |
| 出片/出图期间改了配置 | `task.config.mjs` **在** Vite 的模块图里，改它会触发重载、打断渲染 | **渲染期间一个文件都别写**（`docs/*.md` 也不行 —— 编辑器的原子写会留下**不以 `.md` 结尾**的 `.tmpdir/…tmp`，`vite.config.mjs` 的 `watch.ignored` 挡不住，撞 `EBUSY` 会让 Vite 进程直接崩、渲染报 `ERR_CONNECTION_REFUSED`）。唯一被实测挡住的是 **`out/**`**：并发产出先落 `out/_staging/`（`AGENTS.md` §7 / `docs/history/STATUS-rounds-7-10.md` §14.5） |

---

## 10. 交付前自检（与 `AGENTS.md` §10 同一套，配置档不例外）

1. `node scripts/anim.mjs check <任务>` 无报错、无空档告警、每段都不是全黑
2. `still` 抽查**每一段的中间帧**，并且**真的用 Read 工具看了图**
3. 有音乐：`analyze` 跑过，镜头切点对齐在拍上（`check` 会印 bpm，`analyze` 会印拍数）
4. `video` 出片成功（CLI 收尾会用 ffprobe 复核产物帧数）
5. 段与段之间没有黑隙，最后一段有明确的收尾
6. 想知道"改动前后画面到底变没变"：`node scripts/anim.mjs hashes <任务> --save` / `--baseline`

---

## 11. 为什么不做「一句话生成视频」的模型内建路径（原 ROADMAP §5）

引擎刻意不内建「给一句提示词就出片」的接口。原因是这类系统的可靠性来自**确定性 + 可验证**：

- 画面是 `t` 的纯函数 → 能逐帧重放、能只重渲一段、能 4K 重出；
- `check` 能机械地发现「这段全黑」「时间线有空档」「用了 `Math.random`」；
- agent 能出图、看图、再改——**这一步是质量的来源**，而不是提示词。

所以这一层的方向是「减少样板代码」，不是「隐藏渲染过程」。模型仍然应该看得见、能修改每一个参数。
