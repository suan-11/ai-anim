# MOTION —— 运动规则表（什么时候用哪个）

> 我们有一份很好的**原子函数库**（`src/kit/`：`makeShot` / `fade` / `typed` / `spring` /
> `noise` / `enterOffset` / `cameraPost`…），缺的是**"什么时候用哪个"**这一层判据。
> 外部项目 hyperframes 的 `rules-index.md`（7 大类 40+ 条原子规则）里最值得抄的是**形式**：
> **按「画面要什么」检索**，而不是按"我记得有个函数"。
> （拆解见 [REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) §4.4；清单条目见 [BACKLOG.md](BACKLOG.md) 1-27；
> 横向对比见 [REFERENCE-agent-video-projects.md](REFERENCE-agent-video-projects.md) §3.4。）
>
> 这份文档做三件事：**一张按画面检索的表** + **每条数值的出处与证据强度** + **哪些还没落地**。

---

## 0. 先说证据强度（照 [STYLE.md](STYLE.md) §7 的做法）

**文里的数字分四种，读的时候必须分清是哪一种** —— 把别人的经验值当成"我方实测"，
比写错一个数字更严重（[STYLE.md](STYLE.md) §7 就是这么开头的）：

| 标记 | 含义 | 谁可以反驳它 |
|---|---|---|
| **【外部经验值】** | 从外部项目 `heygen-com/hyperframes` 抄来的**调参成果**。**我方还没有实测过** | 我们自己的出图 / 出片实测 |
| **【引擎默认值】** | 引擎代码里就是这么写的（给了 `文件:行号`），有单测钉着 | 改代码 + 改单测 |
| **【我方推导】** | 纯数学，可以当场验算（`tools/test-motion.mjs` 钉着） | 自己算一遍 |
| **【我方实测】** | 在我们这儿量过、或出过事故并由守门兜着（给了命令 / 出处） | 重跑那条命令 |

⚠ **1-27 这次交付的三个 kit 函数，抄的是"数值"，不是"实测结论"**：`10 / 65 / 25`、`0.5s`、`0.45`
都是 **【外部经验值】，我方未实测**。我们**自己**证出来的只有三件事（都标【我方推导】）：
三段式的**时长比例**、**两处接缝速度相等**、以及 10/65/25 下"尾部 ≥ 3× 加速段"**自动成立**。
**"二值到达比淡入好"同样没有在我们这儿做过对照实验** —— 见 §3.3。

---

## 1. 共享契约（写任何运动之前都成立）

外部那份契约的原文在 [REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) **530–538 行**
（"The contract — every rule assumes this"）。它是给 DOM + GSAP 写的，**逐条翻译到 anim 是这样**：

| 对方的契约（530–538 行） | 在 anim 里的等价物 |
|---|---|
| 只在**一个 paused timeline** 上跑 | 整条时间线都是"给定 t 求值"：`render(ctx)` 只依赖 `ctx.f`，没有播放器状态 |
| **双向 seek-safe**：`fromTo` 带显式 from 态、**绝对值**、绝不用相对 `+=` | 铁律：位置写成 `x = f(t - t0)`，**不许** `this.x += v`（[AGENTS.md](../AGENTS.md) §4；`anim determinism` 能定位） |
| 确定性：无 `Math.random()`、无 `Date.now()`，只有 index 派生的伪随机 | `rng(seed)`（`setup` 里预计算）/ `f.idx` / `noise1`…；`check` 会静态扫前三样 |
| 只动 transform 与 paint-only 属性；`width`/`height`/`top`/`left` 禁用 | **不适用** —— 我们没有布局，所有坐标都是自己算出来的。该抄的是意图："慢速运动别量化"（§3.6，148–153 行） |
| **`items × stagger ≤ ~0.5s`** —— 把一组的到达压成"一个节拍" | 落成函数：`waterfallStagger()`（§3.2），超了按比例压回 |
| 被动画的元素上不许有 CSS `transition` | **不适用**（没有 CSS）。等价物是"别让两套动画同时改同一个量" |
| DOM 测量只在 build 期做 | **不适用**（没有 DOM 盒子） |

我们这边**另外**还有三条自己的硬约束（写在 [AGENTS.md](../AGENTS.md) §4 / §5、[LAYOUT.md](LAYOUT.md)）：

1. **抖动必须是 t 的平滑函数**：`shakeSmooth(f.t, amp)`，不是逐帧白噪声 —— 60fps 下每 16.7ms 跳一个新位置
   = 振动，5px 也会被说成"像地震"。
2. **幅度随"镜头停住"衰减**：`amp * (1 - 0.75 * settle)`。
3. **一屏一个主体**：运动再多，观众该看的那一件事只能有一个（`focus` / `check` 的版面守门）。

---

## 2. 运动规则表：画面要什么 → 用哪个 → 数值上限 → 出处

**按"观众该感觉到什么"查这张表**（不是按函数名）。"出处"那一列**自带证据强度标记**（§0）。

| 画面要什么（观众该感觉到什么） | 用哪个 | 数值上限 | 出处 |
|---|---|---|---|
| 一个元素**到位、有回弹**，像被吸过去、被磁铁抓住 | `spring(f.lt - t0)` → 0→1（指数弹簧**解析解**；"想更弹"再给参数） | 默认 `stiffness 90 / damping 18`；更弹 `spring(x, 1, 140, 12)`；⚠ 别写成逐帧积分 | 【引擎默认值】`src/core/util.js:61` + [AGENTS.md](../AGENTS.md) §3.5 |
| **一整组东西被推一下**：慢-快-慢、一次爆发、**不回弹** | `nudgeCurve(t, t0, dur, dist)`（新，§3.1） | 距离分配 **10 / 65 / 25**；**尾部时长 ≥ 3× 加速段**（我们解出来正好 10/3） | 【外部经验值】[REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) **516 行**（`nudge-curve`）→ 时长比例对我们是【我方推导】 |
| 一组元素**错峰到达**（级联、加速的波、最后收敛） | `waterfallStagger(items, stagger)` → 把结果的 `.stagger` 喂 `type.write`（新，§3.2） | **`items × stagger ≤ ~0.5s`**，超了按比例压回；默认上限 `0.5` | 【外部经验值】[REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) **535 行**（共享契约）、**517 行**（`waterfall-entry`） |
| 新元素**出现**（"到达"） | **二值到达**：`type.write(text, x, y, { t, stagger })` —— **不要传 `alpha`、不要传 `from`**（§3.3） | 不许给到达做淡入（"never fade an arrival"）；真要一帧过渡就 `staggerDur ≤ 0.05s`（≤3 帧，观感等同二值） | 【外部经验值】同上 **517 行**；【引擎默认值】`src/core/text.js:291/293/303` 证明 `from: 'up'` 会 `al = e` **淡入** |
| **已经在那儿的东西**显隐（不是到达） | `fade(f.lt, delay)` → `{ alpha: [0,1], t, staggerDur }` | 淡出随便；**淡入只给"本来就在"的东西**（面板重新出现、整屏压暗再回来） | 【引擎默认值】`src/kit/layout.js:74` |
| 文字**逐字上浮**入场（我们现在的默认写法） | `type.write(..., { stagger, from: 'up', t: f.lt })` | ⚠ 它**是淡入**（`al = e`），与上一行冲突；**我方没做过对照实验** —— 见 §3.3 | 【引擎默认值】`src/core/text.js:296–304` |
| 转场：**新内容把旧内容推走**（物理碰撞式） | `handlesTransition` + `transitionPass(gl, { victimRatio })` + `enterOffset`（新内容从反方向落位）；比例本身用**纯函数** `planCollision({ enterDur, ratio })` 算（§3.5） | **受害者的时长 = 入侵者的 40–50%**：`VICTIM_RATIO_RANGE = [0.40, 0.50]`（闭区间）；越界**夹回区间并返回说明**（不静默）；`enterDur ≤ 0` ⇒ 受害者时长记 0；三个 tween 落在**同一时间点** | 【外部经验值】[REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) **518 行**（`reactive-displacement`，**我方未实测**）+ 【引擎默认值】`src/core/trans.js`（**不传 `victimRatio` ⇒ `fadeAt` 0.55，逐像素不变**），判据由 `tools/test-transition-collision.mjs`（纯 JS）钉着 |
| **切点上有东西活下来**（连贯 / carry）：按下的东西变成结果、卡片推近成场景、一群元素收拢成标志 | `src/kit/carry.js`：`morphRect`（容器形变）/ `iris`（圆形揭示）/ `zoomThrough`（推近穿透）/ `hop`（弧线跳）/ `gather`（收拢）；衔接物的选择表见 [REFERENCE-onetake.md](REFERENCE-onetake.md) §2.4 | **验收**：`anim carry` 判 carried/anchored/bare；**carry score < 0.5 = 像 PPT**（四版对照 0.00/0.40 被否、0.75/0.83 通过）。跨元素合成的缝（量具判 bare 但观众认）用 `cut(..., { carry: 'morph' })` 声明 | 【外部经验值】[REFERENCE-onetake.md](REFERENCE-onetake.md) §2（probe 判据：位移 ≥2% 对角线 / 缩放 ≥10%） |
| **操作员摄影机**（跟主体、甩到落点、hold 真空静） | `operatorCam(makeCam(...), { lead, hits, rests })`（`src/kit/carry.js`） | `lead` 提前量 ~0.1s（"一帧不落"= 摄影机**先到**）；**rests 区间内浮动必须归零**（浮动着的机位永远不"死静"，静帧判据会假红）；每次落地配 `hits` 的确定性衰减 shake | 【外部经验值】同上 §4（one-dot：定机位版被否「缺灵动的跟踪运镜」、操作员版通过） |
| **镜头长度不许匀速**（节奏：CoV ≥ 0.25） | 时间线设计层的事 —— 长枪 8–13s、短击 2–4s、burst 里 0.2–0.5s；`check` 的「节奏（静态）」腿自动报 | **变异系数 < 0.25 = 节拍器**：观众读作"一格一格翻灯片"，不管每镜多好看；单段 / `--only` 没有分布可判（进 skipped） | 【外部经验值】同上 §3（motion-web 匀速两版都被否；通过片实测 0.44 / 0.67） |
| **画面要停下来**（静/动节奏：死静 ≥25%、最长静段 ≥1s） | `anim rhythm <任务>` 量具（降采样帧差 → 静段表）；hold 的写法看 `tasks/_carry-lab/scenes/rhythm.js` | **rest 必须真空静**：① 不许慢推/drift（1→1.05 在量具眼里永远不静）；② post 必须 `return { grain: 0, dither: 'off' }` —— 默认 grain 0.035 与 dither 的种子都来自帧号，任何帧间比对都会被它们判成"在动"（暗部经 sRGB 斜率放大可达 ~6.4/255） | 【外部经验值】同上 §3（clearing 假红 → 真空静后通过的实测）；grain/dither 这条是【我方实测】（2026-10-17 在 _carry-lab 上量出 0% → 3% → 成段） |
| hero 元素背后的**柔光 / 辉光**（无触发、有界呼吸） | 自己叠一层径向辉光（`lines` 的第 4 个分量 + `mul`），或 `post` 的 `bloom` / `halation` | **峰值 opacity ≤ ~0.45**（`glowPeakCap()`，新，§3.4）；只有信号色才允许 > 0.85 线性亮度去泛光 | 【外部经验值】同上 **522 行**（`ambient-glow-bloom`）；0.85 那条是【我方】[AGENTS.md](../AGENTS.md) §5 |
| **粒子 / 彩带**（确定性、可 scrub） | 固定池 + `rng(seed)` 发射值 + **一个单 driver**，把每个粒子算成时间的纯弹道函数 | **≤ ~40 个粒子** | 【外部经验值】同上 **523 行**（`particle-burst`） |
| **抖动 / 手持** | `shakeSmooth(f.t, amp)` 交给 `post.shake` | ≤2px 呼吸；3–5px 手持（0.85Hz）；≥5px 只许是故意的冲击 | 【我方实测】[AGENTS.md](../AGENTS.md) §5 的幅度表 + `node scripts/anim.mjs shake <任务>`（第三轮事故："最后像地震"） |
| 甩镜的**方向速度模糊** | 引擎的**真**运动模糊（逐帧自适应多子帧，我们的强项） | 模糊峰值必须落在**最大速度处**、落定归零 —— 这个绑定**还没写进 kit** | 【外部经验值】同上 **519 行**（`motion-blur-streak`）；采样档 8/24/72/216 是【引擎默认值】（[AGENTS.md](../AGENTS.md) §7） |
| 单元素**复合变换**式的虚拟摄影机（推近某块内容） | `ctx.setXform({ x, y, scale })` | ⚠ **反向平移的公式有两种**：带 scale 的 `T = −offset × S`，纯平移的 `T = −offset` —— 混了就是"推过去对不上" | 【外部经验值】同上 **520 行**（`viewport-change` vs `coordinate-target-zoom`） |

**怎么用这张表**：先问"这一屏观众该感觉到什么"，再选行 —— 与 [AGENTS.md](../AGENTS.md) §5.5
那张"按画面需要什么选 3D"的表同一个用法。**选错才是真的限制画面**，不是"哪个省事选哪个"。

---

## 3. 四条规则展开（有新代码的那些）

### 3.1 `nudgeCurve` —— 三段式整组位移（慢-快-慢）

```js
import { nudgeCurve } from '../../../src/kit/index.js';

const dx = nudgeCurve(f.lt, 0.6, 1.3, 220);   // 0.6s 起、1.3s 内向右推 220px
lines.fillRect(panel.x + dx, panel.y, panel.w, panel.h, P.bone);
```

三段是 `power3.in` 加速（**10%** 距离）→ 线性爆发（**65%**）→ `power4.out` 收尾（**25%**）。
【外部经验值】出处：`REFERENCE-hyperframes.md` 516 行（距离分配与"尾部 ≥ 3× 加速段"）、550 行（函数提案）。

**时长不是拍脑袋定的**（这一条【我方推导】，`tools/test-motion.mjs` 钉着）：要"慢-快-慢"接得住，
两处接缝的**速度必须相等**：

```
第 1 段 power3.in ：位移 = 0.10·dist·x³           ⇒ 段末速度 = 0.30·dist/d1
第 2 段 线性      ：位移 = 0.65·dist·x             ⇒ 速度     = 0.65·dist/d2
第 3 段 power4.out：位移 = 0.25·dist·(1−(1−x)⁴)   ⇒ 段首速度 = 1.00·dist/d3
令三者相等 ⇒ d1 : d2 : d3 = 2/13 : 1/3 : 20/39（≈ 0.154 : 0.333 : 0.513 个 dur）
```

副产品：`d3/d1 = 10/3 ≈ 3.33 ≥ 3` —— 516 行那条"尾部时长 ≥ 3× 加速段"**自动成立**，不用另凑一个数。
**没选的另一条路**（外部那一版到底是先定时长还是先定距离，我们没核实）：如果反过来先定时长
（比如 0.2 / 0.4 / 0.4），距离分配就不再是 10/65/25，两处接缝的速度也不再相等 —— 会看出"顿一下"。

**什么时候不用它**：① 要回弹 → `spring`；② 单个元素自己的位移 → `spring` 或 `from: 'up'`；
③ 一整段镜头的运镜 → `cameraPost`（那是摄影机，不是元素）。

### 3.2 `waterfallStagger` —— 错峰到达的归一化

```js
import { waterfallStagger } from '../../../src/kit/index.js';

const w = waterfallStagger(str.length, 0.12);              // 想给 0.12s/字
type.write(str, x, y, { t: f.lt, stagger: w.stagger });    // 超了就是 0.5/N，没超还是 0.12
if (w.capped) ctx.warnings.push(w.warning);                // 函数只判定，不喊
```

- **口径按 §4.4 的字面那条**：`items × stagger`，**不是** `(items−1) × stagger`（这样才能与出处逐字对上）。
  物理上的"波"是 `span = (items−1) × stagger`（最后一个元素真正开始的时间），它恒 ≤ `total`，也一并返回。
- 返回值：`{ items, stagger, total, span, rawStagger, rawTotal, maxStagger, capped, warning }` ——
  `stagger` 直接喂 `type.write`；`warning` 是**字符串或 null**（要喊就 `ctx.warnings.push`）。
- 另有一个**纯判据** `waterfallOver(items, stagger, maxStagger)` → boolean：静态扫描场景代码里的
  stagger 字面量时用它，**与 `.capped` 同一个口径**（两套算法打架的话，`check` 报的和运行时压的就不是一回事）。
- 边界：`items = 0` 不改写你的 `stagger`（没有元素可错峰）；`items = 1` 按字面口径也会把 0.9s 压到 0.5s
  （一个元素没有级联，压不压看不出来）；负 stagger 原样通过（这是**上**限）。
- **别用它去"通过检查"**：上限说的是"一组的到达要像一个节拍"，给不出好看的错峰就**减少同屏元素**
  （或者改用下面的二值到达），不是把 stagger 压到看不见 —— 同一条 stance 见
  [REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) 568 行："fix-the-motion, not silence-the-rule"。

### 3.3 二值到达（"到达不要用淡入"）⚠ 这一条撞上了我们自己的默认写法

外部那条原话是 **"Binary 0→1 opacity via `tl.set` — never fade an arrival"**
（[REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) **517 行**，【外部经验值】）。

**在 anim 里怎么做到二值**（读代码得到的等价物，【引擎默认值】）：

| 写法 | 出来的是什么 | 证据 |
|---|---|---|
| `type.write(s, x, y, { t, stagger })`（**不传 alpha、不传 from**） | **二值**：第 i 个字在 `t = i × stagger` 那一刻**满不透明地出现**（位置不动） | `src/core/text.js:280`（`perGlyphAnim = stagger > 0`）、`:291`（`k`）、`:293`（`if (k <= 0) continue` —— 到点才画）、`:295–304`（`from === 'none'` 时 `al` 保持 1） |
| `type.write(s, x, y, { t, stagger, from: 'up' })` | **上浮 + 淡入**：`al = e`，边动边显影 | `src/core/text.js:296–304`（`if (from !== 'none') { … al = e; }`，第 **303** 行） |

⚠ **两件事必须说清**：

1. **我们现在的房子默认是"上浮 + 淡入"**（`from: 'up'` 到处都是，[AGENTS.md](../AGENTS.md) §3.5 也这么教）。
   按 517 行那条，**到达**应该改成二值 —— 但**我们没做过 A/B**：所以这一条在表里是
   **【外部经验值】，不是我们的结论**。真要改，第一站是拿一段 `still` / `sheet` 做对照（不要全片一起改）。
2. **不传 `t` 就等于全不画**：`opts.t` 缺省是 `0`，而 `k = sat((0 − i·stagger)/dur) = 0` ⇒ `continue`。
   套用二值到达时**必须**把 `t: f.lt` 给上（`src/core/text.js:259`）。

### 3.4 `glowPeakCap` —— 辉光峰值上限

```js
import { glowPeakCap } from '../../../src/kit/index.js';

const g = glowPeakCap([{ id: 'hero', peak: 0.62 }, { id: 'rim', peak: 0.3 }]);
if (!g.ok) { ctx.warnings.push(g.warning); hero.alpha = g.suggested[0]; }
```

- 【外部经验值】出处：`REFERENCE-hyperframes.md` **522 行**（"峰值 opacity ≤ ~0.45"）、552 行（函数提案）。
- 返回值：`{ cap, count, peak, ok, over, suggested, warning }` ——
  `over` 是超限项（`{ i, id, value, suggested, reason }`，按原下标），`suggested` 是**与输入等长**的建议值数组
  （超限项压到 `cap`，其余原样），`peak` **只统计有限值**。
- **不静默通过**（"空 ≠ 干净"这条纪律在纯函数这一层也成立）：`NaN` / `±Inf` / 根本不是数字的项
  **不算"没超限"**，而是记进 `over` 并标 `reason: '不是有限数'`。
- 参数写错就抛：`values` 不是数组、对象没有数值型 `.peak`、`cap` 非有限 —— 一律当场抛
  （与镜头模板参数写错同一条哲学）。
- ⚠ **它现在还没有接进 `post` / `check`**：`bloom` / `halation` 的强度是 0..1 的自由数，
  引擎不会替你判"这个辉光是不是太亮"（见 §4）。

### 3.5 `planCollision` —— 碰撞式转场的受害者时长（= 入侵者的 40–50%）

```js
import { planCollision, victimSpan, VICTIM_RATIO_RANGE } from '../../../src/core/trans.js';

const c = planCollision({ enterDur: 0.6 });   // 交叠期 0.6s（不给 ratio ⇒ 默认 0.45）
c.victimDur;   // 0.27s —— 旧内容该在这么久之内退干净
c.ratio;       // 0.45（夹取之后；你原本给的那个数在 c.rawRatio）
if (c.clamped || c.degenerate) ctx.warnings.push(c.warning);   // 函数只判定，不喊

// 接线：给转场 Pass 一个比例，它就把 fadeAt 设成同一个数（k 是交叠期的归一化进度）
this.wk = makeWorldKit(ctx, { victimRatio: 0.45 });
```

- 出处：**518 行**那条 `reactive-displacement`（"受害者的时长是入侵者的 40-50%"）。**【外部经验值】，
  我方未实测** —— 我们证到的只有下面这些边界，不是"40–50% 在我们这儿最好看"。
- **常量只有一处**：`VICTIM_RATIO_RANGE = [0.40, 0.50]`（`VICTIM_RATIO_DEFAULT` = 区间中点 0.45）。
  别在场景里再写一个 0.4 / 0.5；要改口径就改常量。
- **`enterDur` 的口径**：真实秒数就是"交叠期多长"；省略时是 **1**（= 一整段交叠期的归一化口径，
  此时 `victimDur` 与 `fadeAt` 同值）。`transitionPass` 走的就是后一种 —— 它只知道 `k`，不知道秒数。
- **三条边界**（都有单测）：
  ① 越界（< 0.40 或 > 0.50）⇒ **夹回区间**并给 `warning`（带原值 / 区间 / 夹取后的时长）；
  ② `enterDur ≤ 0`（没有交叠期）⇒ 受害者时长记 **0**（不是负数、不是 NaN），比例照原样保留；
  ③ `NaN` / `±Inf` / 非数字 ⇒ **当场抛** —— "空 ≠ 干净"，不能把非有限数当成"没越界"。
- **默认路径逐像素不变**：`transitionPass(gl, opts)` 不传 `victimRatio` 时 `fadeAt` 还是 0.55，
  shader 源码逐字符相同（`tools/test-transition-collision.mjs` 直接比 `src`）。
  `fadeAt` 与 `victimRatio` 是同一个旋钮的两种写法，**两个都给会抛**（静默忽略一个比抛错贵得多）。
- **还能怎么用**：`victimSpan(enterDur, ratio)` 只要那个数（与 `planCollision().victimDur` 逐位相同）；
  想自查一条切缝的节奏，用 `c.victimDur / c.enterDur` 与 `VICTIM_RATIO_RANGE` 比 —— 越界就是这次
  按 40%/50% 夹过（`clamped`），观众看到的"旧内容走得太急/黏太久"就在这里。


### 3.6 转场模式：九种切法，一个字段（BACKLOG 1-13 / 1-12）

```js
// task.config.mjs 的配置档节点上（或 cut() 的 opts 上）
{ type: 'chart', title: '…', dur: 4, overlap: 1.2, transition: 'wipe' }
```

| 名字 | 画面 | 什么时候用 | 代价 |
|---|---|---|---|
| `'push'`（默认） | 旧帧沿摄影机方向加速甩走 + 方向拖尾 | 通用；**文字量大**的画面 | 0 |
| `'wipe'` | 一条软边沿摄影机方向横扫，前沿一道暖光 | 段落推进、"翻页" | 0 |
| `'iris'` | 正圆从中心张开（按 `RES_LOGICAL` 长宽比校正，不是椭圆） | 聚焦一件事、开场/收尾 | 0 |
| `'glitch'` | 横向切片错位 + RGB 分离 + 极短闪白 | 冲击、故障、数据感 | 每像素 3 次采样 |
| `'pixel'` | 格子由密到疏、逐格消失 | 数字化、降采样、"回忆" | 0 |
| `'dissolve'` | 多尺度 fbm 阈值溶解，消融边缘微微发亮 | 梦境、时间流逝 | 1 次 fbm |
| `'mix'` | 交叉溶解（2026-10-24 之前的默认） | 两屏**都是图形**、没有成段文字 | 0 |
| `'none'` | 硬切 | 要"断"的时候 | 0 |
| `'relay'` | **相机接力**：一台相机在两段的 home 位姿之间飞过去（look 直线、dist 与 tan(fov/2) 几何插值、yaw 最短路径），内容在换手窗 [.35, .65] 交叉，move 走 glide / whip 两种曲线（BACKLOG 1-12） | 两段是**同一个世界的两台机位**、想要"镜头飞过去内容换手"而不是"甩走" | 每子帧多两次位姿探针（纯查表级） |

**四条纪律**：

1. **不写 `transition` = `'push'` = 逐像素与从前一致。** 已交付片子的画面一个像素都不许动
   （`tools/test-transition-modes.mjs` 与 `test-transition-collision.mjs` 各钉一遍）。
2. **写错当场抛**并列出可用值（`resolveTransitionMode`）。静默回落成甩镜 = 画面照样出、`check` 照样绿，
   只把"我要的擦除怎么没出现"留给人 —— 与"参数名拼错要抛"是同一条纪律。
3. **掩码型转场（wipe / iris / pixel / dissolve）的 alpha 就是时间轴**，不要再叠一层全局淡出：
   两个 fade 乘起来会让画面在中段发灰（第一版就是这样，出图当场看出来）。
   它们的 `fadeAt` 只是"旧帧最晚什么时候退干净"的上限（`transitionFadeAt(mode)`）。
4. **方向约定**：`fragColor` 的 alpha = **"旧帧还剩多少"**。`wipe` / `iris` 的掩码必须随
   "旧帧所在的位置"取 1 —— 写反了不会报错，只会让光圈越开旧帧越多（也在出图时抓到的）。

**实现**：`src/core/transition-frag.js`（六支 shader，共用 `under`/`k`/`dir`/`push`/`blur`/`fadeAt`
六个 uniform）+ `src/core/trans.js` 的模式表。引擎在 `composite()` 里读 `item.transition`，
按模式缓存 Pass（每帧新建 Pass 会把编译时间乘进渲染时间）。
⚠ 别在 shader 里重复声明 `GLSL_COMMON` 已有的东西（`vnoise` / `fbm` / `hash12` / `sat` / `luma`…）——
GLSL 会报 `function already has a body`，而这个错在第一版 `dissolve` 上就踩过一次。

**夹具**：`tasks/_trans-lab`（8 个模式各一段 A→B，`overlap: 1.2`，含 `push` / `mix` / `none` 三个对照组）；relay 的机制与接入见 `docs/ENGINE.md` §3.7.7，夹具 `tasks/_relay-lab`（camera3 对 + push 对照组 + Three.js 对，含配置档 `transitionOpts: { move: glide | whip }` 写法）。

---

### 3.7 剪纸 / 纸艺层叠：`src/kit/paper.js`（BACKLOG 1-49 缺口表第 5 行）

```js
import { paperShape, paperStack, paperGrain, shadowColor } from '../../../src/kit/index.js';

setup(ctx) {
  // ⚠ 撕边在 setup 里算一次：纸不会每帧重新撕一遍（也省掉每帧 800 次噪声）
  this.layers = [0, 1, 2].map((i) => ({
    shape: paperShape({ x: 200 + i * 120, y: 300 - i * 60, w: 900, h: 420, seed: i }),
    color: paperGrain([0.78, 0.71, 0.60], i * 100, i * 40),
    depth: i / 2,
  }));
},
draw(ctx, { dx, dy }) {
  // pan 必须是 t 的函数（引擎铁律）；视差由 paperStack 按 depth 铺开
  paperStack(ctx.lines, this.layers, { pan: [ctx.f.t * 6 + dx, dy], parallax: 40 });
},
```

**一张纸要像纸，只有三件事，缺一件就退化成「彩色多边形」**：

| 件 | 做什么 | 不这么做的后果 |
|---|---|---|
| 硬投影 | 纸**贴**在下一层上，影子边缘是硬的（不透明色，由 `shadowColor()` 从纸色乘暗） | 软阴影 ⇒ 观众读成「UI 卡片」；半透明黑 ⇒ `lines` 的柔边在相邻扫描行叠加，出**横向条纹** |
| 分形撕边 + 白芯 | 边缘是 `fbm1` 重采样的分形，撕口内侧再画一圈更浅的「纸芯」 | 直线/规则波浪 ⇒ 像矢量图标；只有外轮廓 ⇒ 像锯齿线，没有厚度 |
| 纸色纤维 | `paperGrain()` 给纸色乘 ±2.5% 的确定性噪声 | 纯色填充 ⇒ 一眼就是代码画的 |

**三个出图才看得见的比例**（都踩错过，现在都进了单测）：

| 数 | 正确值 | 第一版错在哪 |
|---|---|---|
| 撕边幅度 | **边长 × 1.5–3%**（2040px ⇒ 40px） | 12px ⇒ 2000px 的纸上缩略图里就是一条直线 |
| 撕边采样密度 | **约 8px 一个点**（`paperShape` 现在按边长自动定） | 默认 40 点 ⇒ 2040px 的边每 51px 才一个点，小尺度毛刺被 `fillPoly` 的折线**抹平** |
| 白芯提亮 | **7%**（`coreColorOf` 的默认值） | 35% ⇒ 一条雪白高光带，读起来像贴纸白边 |

**结构上的三条**（也都有单测）：

- 撕边**只吃 `seed` 不吃 `t`** —— 纸不会每帧重新撕一遍。这既是物理事实，也是「每帧是 t 的纯函数」的硬要求
  （撕边逐帧变 = 抖动 = 子帧累加后糊成一团）。
- 层栈**由远到近画**（`paperStack` 内部按 `depth` 排序）—— 线段批没有 z-test。
- `translateShape()` **返回新对象**，不改原形状 —— 否则每帧的 `pan` 会在原形状上累加。

**层与层的明度要拉开 15% 以上**：纸和纸的色差本来就不大，但画面要读得出层次就得夸张一点
（这一条是「照片 vs 插画」的差别，不是物理）。夹具 `tasks/_paper-lab` 的三层是 0.52 / 0.78 / 0.97。

**投影方向全片一致**：`light` 默认 `[-1, -1]`（光从左上，影子落右下）。三层各朝不同方向投影 = 光源在打架。

### 3.8 像素风：四件事，缺一件就只是「糊了」（`src/kit/pixel.js`，BACKLOG 1-67）

```js
import { paletteOf, snapTime, drawSprite, spriteOf } from '../../../src/kit/index.js';

setup(ctx) { this.pal = paletteOf('gameboy'); this.bot = spriteOf('bot'); }
render(ctx) {
  const step = snapTime(ctx.f.t, 12);   // ⚠ 整片时间，不是 f.lt
  drawSprite(lines, this.bot, 200 + Math.round(step * 120), 640, { scale: 8, color: this.pal.linear[2] });
}
```

| 件 | 做什么 | 不这么做的后果 |
|---|---|---|
| **调色板** | 只有 4–8 色 | 颜色一多，块就不读了 —— 变成「低分辨率的照片」 |
| **块** | 一切落在同一栅格上（`snapTo` / `drawSprite` 的 `snap`） | 半块的边缘被抗锯齿抹成灰，全屏看就是「脏」 |
| **有序抖动** | `ditherQuantize` 在最近两色之间按 Bayer 二选一 | 用渐变 ⇒ 现代滤镜，不是当年的机器 |
| **台阶** | `snapTime(t, 12)`：动作在 1/12 秒的格子上跳 | 60fps 平滑 = 现代；跳台阶才是「算力不够」的唯一可见证据 |

**四条出图才看得见的比例/相位**（都踩错过，`shot('pixel')` 里都钉着）：

| 数 | 正确做法 | 第一版错在哪 |
|---|---|---|
| 抖动阈值的坐标 | 用**块**坐标（`ditherQuantize(…, bx, by)`） | 用像素坐标 ⇒ 同一块里不同像素取到不同阈值，块被撕成噪点 |
| 压栅格的重采样 | 降到 `cols × 4` 再在 JS 里做 **4×4 方框平均** | 直接降到一格一像素是**点采样**：块随机跳变，中文标题碎成一地 |
| 读回的 y 方向 | `readPixels` 自下而上，用到 `lines` 前要**翻 y** | 不翻 ⇒ 整块画面**上下颠倒**（机器人跑到天花板上） |
| 天空的色阶跨度 | **只跨两档**，中间全靠抖 | 跨 3/4 张色表 ⇒ 天空变成一道彩虹 |

**节奏上的两条**：

- **台阶由整片时间 `f.t` 算**，不是 `f.lt` —— 用段内时间的话每次切段动作会卡一下（台阶被重置到 0）。
- **像素字的揭晓是逐字台阶**（`reveal` 按字数取整），不是连续 alpha —— 连续淡入是「现代 UI」，
  像素画的入场历来是「一格一格跳出来」。

**中文字不要用 5x7 像素字**：一个汉字要 12x12 以上，表里没有（`glyphOf` 对未知字符返回全空，
不抛错 —— 一段里混一个中文就把整行吃掉是最坏的结果）。中文走 `type.write`，最后由 `post.pixel`
把字体与像素图对齐到同一栅格（取**半格**：整格会把 CJK 笔画 ≈ 字号/10 整根吃掉）。

---
## 4. 还没落地的（诚实清单）

| 规则 | 现在的状态 | 缺什么 |
|---|---|---|
| 碰撞式转场：**受害者时长 = 入侵者的 40–50%**（518 行） | **已落地（2026-10-26）**：纯函数 `planCollision({ enterDur, ratio })` / `victimSpan()`（§3.5，`src/core/trans.js`）+ 接进 `transitionPass(gl, { victimRatio })`（比例 = `fadeAt`，`kit/world.js` 原样转发）；`tools/test-transition-collision.mjs` 纯 JS 钉着 | 边界：① 比例只在 `VICTIM_RATIO_RANGE = [0.40, 0.50]` 内被接受，越界**夹回并给说明**；② `enterDur ≤ 0` ⇒ 受害者时长 0、比例保留；③ 非有限数当场抛；④ `fadeAt` 与 `victimRatio` 两个都给会抛；⑤ **还没在已交付片子里用过** —— 40–50% 仍是【外部经验值】，要拿一段 `anim cuts` 看切点做对照才算【我方实测】；⑥ `docs/ENGINE.md` §后处理表里 `transitionPass` 的签名还没补 `victimRatio` |
| 辉光峰值上限 | 函数有了，**没人调用** | 接进 `post`（或 `check` 的静态扫描：读场景里的 alpha 字面量），并定一条"谁在什么时候调用"。<br>⚠ 2026-10-26：错峰那一条已经接上了（见下），**辉光这条没接** —— 静态读 `alpha` 字面量分不清"辉光"与"正文淡入"，假阳性会淹掉真命中；要接得先给辉光一个显式声明（比如 `halo: { peak }`） |
| 错峰跨度上限 | **已接（2026-10-26）**：`tools/lint-motion-caps.mjs` 从源码字面量算 `items × stagger`，`anim check` 每次都会跑（默认 warn、`--strict` 进 errs）；判据与 `waterfallOver()` **同一个函数口径**（0.5s），元素个数优先取「文字绘制调用的第一个实参」（const 字符串 / 数组 / 字面量），读不出就记 **unchecked**（不是通过） | 还差：`stagger` 由函数参数传进来的写法只能记 unchecked（静态读不到值）；要覆盖就得把「同屏字数」挪进运行时读数 |
| 模糊峰值绑定最大速度（519 行） | 引擎有真运动模糊（强项），但**谁也没规定模糊什么时候最大** | `cameraPost` 之外的一个 post 助手 |
| 粒子 ≤ 40（523 行） | 没有池、没有上限判据 | 一个 `makeBurst()` 之类的 kit 函数 |
| 二值到达 vs 淡入 | **没做对照实验** | 一段 `still` / `sheet` 的 A/B（不是全片一起改） |

外部那份 §4.4 说规则表 **8–12 条就够**（553 行），这份表目前 **12 条**（§2）。

---

## 5. motion.json：可 gate 的画面断言（BACKLOG 1-18，2026-10-17）

> 出处：[REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) §4.2 —— 对方的 `motion_out_of_order` /
> `motion_appears_late` / `motion_frozen` / `canvas_content_at_edge` 四条规则 + 它的两条元设计
> （**严重性持久性感知** 与 **空 ≠ 干净**）。对方原文："a frame that never changes while a GSAP
> timeline is playing" 该被拦住 —— 我们此前只有亮度统计，"画了但整段没动" 与 "画了且在动" 区分不开。

任务目录里放一个 `tasks/<任务>/motion.json`（**没有这个文件 = 没判**，`check` 会把它列进
`skipped:`，绝不冒充通过）：

```json
{
  "assert": [
    { "before": ["段A", "段B"] },
    { "appearsBy": ["段A", 2.0] },
    { "keepsMoving": ["段B", 1.5] },
    { "noEdgeContent": ["段A"] }
  ],
  "thresholds": { "changed": 0.0015, "edgeSafe": 0.03 }
}
```

### 5.1 四种断言语义

| 断言 | 判据 | 判什么（观众会遇到的事故） | 采样 |
|---|---|---|---|
| `before(A, B)` | B 的 `start` ≥ A 的 `end`（1e-9 容差） | **叙事顺序反了**：先出结论后出前提。**纯静态** —— 时间线（build 产物）里就有，一帧都不渲染 | 0 帧 |
| `appearsBy(段, t)` | 段头 +0.05s 的帧 与 段头 +t 的帧 做像素差，changedRatio ≥ `thresholds.changed` | **该出现的没出现**：一帧白底到 t 秒还是白底 | 每条 2 帧 |
| `keepsMoving(段, maxStaticSec)` | 段内每 `0.5s` 一对相邻帧（帧距 = 1/fps），changedRatio < `changed` 记"静"；**最长连续静 > maxStaticSec** 才命中 | **整段没动**：静止的段与"画了但冻住"的段从此分得开。rest 本来就合法 —— "有停顿"不是错，连续停过头才是 | 每段 2×N 帧（N = 每 0.5s 的时刻数） |
| `noEdgeContent(段)` | 四边 `thresholds.edgeSafe`（默认 3%）带内，**文字块** bbox 压边（数据源 `gl.paint.blocks`，即版面守门那套记账 —— src/app.js 的 `layoutRows` / src/layout.js） | **元素出画 / 压到帧边**：文字排到 1900px 去，观众看到半截字 | 每段 3 帧（记账白拿，只花渲染的 1 帧/点） |

⚠ **第一版只判文字块压边**（这是与对方 `canvas_content_at_edge` 的**刻意边界**：对方是像素级的
"帧边缘出现锐利内容"，我们第一版只看 `layoutVerdict().groups` 的文字块 bbox）—— 矢量图形 /
贴边面板压边这条**抓不到**，别把它当成"任何元素压边都能报"。贴线不算压边（`x0 == 带内沿` 合法）。

### 5.2 阈值与口径

| 参数 | 默认 | 证据强度 | 说明 |
|---|---|---|---|
| `thresholds.changed` | **0.0015** | 【我方推导】 | changedRatio = "发生可见变化的像素占比"（每 4 像素取 1、luma 权重、\|Δ亮度\| > 1/255）。下采样后 1080p 约 25 万个采样点，0.0015 ≈ 380 个点在变 —— 排掉 1 个 LSB 的 GPU 回读噪声，又抓得住真实入场变化 |
| `thresholds.edgeSafe` | **0.03** | 【我方推导】 | 边缘带宽度占边长比例（左右 57.6px / 上下 32.4px @1080p） |
| keepsMoving 步长 | **0.5s** | 【我方推导】 | `MOTION_STEP`：段内每 0.5s 排一对相邻帧；最长连续静 ≈ 静止对数 × 0.5s（帧距 1/fps 不计入，是步长近似） |

采样计划与判读都在**纯函数**里（`src/timeline.js` 的 `planMotionAsserts` / `edgeSafeHits` /
`motionVerdict`），离线单测 `node tools/test-motion-assert.mjs`（纯 JS，不需要 GPU）；
页面侧 `__anim.motionAudit(plan)` 只负责按计划渲帧、算 changedRatio（写法对照 worldAudit）。

### 5.3 持久性感知（两条元设计之一，必须和断言一起用）

**严重性是持久性感知的**（REFERENCE-hyperframes §4.2 原文语义）：单点超限、下一采样点恢复的
**瞬态降级为 info、永不 gate**；跨采样点保持才 gate。落在这里：

- `noEdgeContent`：三点采样里**只有 1 点**压边 → info（入场/出场瞬时出画是常态）；3 点全压 → error。
- `keepsMoving`：只有 1 对相邻帧静（≈0.5s）、下一对就恢复 → info；连续 ≥2 对 → error。
  （代价：`maxStaticSec` 给到 0.5s 以下时真问题也会被降级 —— 这条断言本就该配 ≥1s 的阈值。）
- `appearsBy` / `before` 是**单次测量**，没有降级一说：一个点没变化就是没出现。

**没有豁免机制** —— 不用写"这段入场允许压边"之类的声明，瞬态与保持靠采样点自动分。这与
`world: false` 那条受控豁免是两个东西：那类声明要写明"这还会关掉什么"，这里干脆不设。

### 5.4 空 ≠ 干净（两条元设计之二）

读 `check` 输出时，这些行都是"**没判**"，不是"通过"：

- 没写 `motion.json` → `skipped: 画面语义断言（motion.json）—— 任务没有声明任何断言`；
- 时间线里有段没被任何断言覆盖 → skipped 逐条点名（`uncovered`）；
- 断言里的段名在时间线里找不到（**段名拼错，或 `--only` 之后段表变了**）→ **单列 missing，
  每条报 error**，绝不当通过 —— `--only` 把选中的段平移到时间轴开头，用错段名的断言会在这里批量现形；
- 断言形状不认识（`{"typo": [...]}` / 秒数给负数）→ 单列 `ignored` 进 skipped（写了但没生效 ≠ 通过）；
- 页面侧某行渲染报错 → 那一行进 skipped（其余行照判），整个 check 不崩。

### 5.5 成本与 --quick 省时档

- 渲染帧数：`appearsBy` 每条 **2 帧**、`keepsMoving` 每段 **2×N**（N = 段长 ÷ 0.5s 向上取整，
  8s 段 ≈ 30 帧）、`noEdgeContent` 每段 **3 帧**（版面记账白拿）。`check` 收尾会报
  "画面语义断言用了 N s、多渲 N 帧" —— 先看这个数再决定要不要全量跑。
- `check --quick`：渲染类**只跑 appearsBy**（每条 2 帧）；keepsMoving / noEdgeContent
  **这次没跑**，进 skipped 并明说 —— 冒烟省时，不是通过。
- 命中**默认只 warn**（同版面守门 / 节奏腿的"先只报不改退出码"—— 已交付的片子没写过
  motion.json，一命中就 gate 会把回归清单永久染红）；`check --strict` 才进 errs。

---

## 6. 相关的其它文档

| 想知道 | 读 |
|---|---|
| 运动的**铁律**（什么会让成片随机出错） | [AGENTS.md](../AGENTS.md) §4 |
| "像一支片子而不是幻灯片"的四条配方（共享背景 / 一台摄影机 / 母题 / 甩走） | [AGENTS.md](../AGENTS.md) §4.5 |
| 抖动怎么给（幅度表 + `anim shake`） | [AGENTS.md](../AGENTS.md) §5 |
| 一屏一个主体（运动之外的另一半） | [LAYOUT.md](LAYOUT.md) |
| 节奏的宏观数值（每 20–40 秒换版面、8 秒静帧红线…**附证据强度**） | [STYLE.md](STYLE.md) §7 |
| **连贯（carry）**：镜头边界上"有没有东西活下来变成下一个画面" —— 判据、词表、验收口径 | [REFERENCE-onetake.md](REFERENCE-onetake.md) §2（拆解报告；落地待办见 [BACKLOG.md](BACKLOG.md) §1.D） |
| 这三个函数的单测 | `node tools/test-motion.mjs`（纯 JS，不需要 GPU） |

## 7. 运动人格（可选声明，**不是模板**）

风格包换的是**视觉**（配色 / 字体 / 母题），不换**运动** —— 于是同一支片子里每个镜头各弹各的。
这一层可选的声明只回答一件事：**这支片子属于哪种运动气质**，其余由它给**区间**。

```js
// task.config.mjs（可选；不写就完全不判）
motion: {
  personality: 'premium',   // premium / corporate / playful / energetic
  emotion: 'calm',          // 自由文本，只进报告
  intensity: 1,             // 整体缩放系数（0.7 = 这一档整体收一点）
  exempt: ['overshoot'],    // 显式豁免；也可以行内写 // motion:allow overshoot
},
```

| 人格 | 时长档 quick / standard / slow（秒） | 回弹上限 | 说明 |
|---|---|---|---|
| `playful` | 0.12–0.3 / 0.24–0.5 / 0.4–0.8 | 20% | 回弹明显、收得快 |
| `premium` | 0.3–0.55 / 0.45–0.8 / 0.7–1.4 | 4% | 不弹、慢起慢收 |
| `corporate` | 0.18–0.35 / 0.3–0.55 / 0.45–0.9 | 3% | 干净、可预测 |
| `energetic` | 0.08–0.2 / 0.16–0.36 / 0.3–0.6 | 30% | 快切、砸字 |

> 数值来自 LottieFiles motion-design-skill（MIT）的 UI 毫秒表，**换算成秒并向外放宽** ——
> 它是**参考区间**，不是规格。写片子的自由度在区间之外，判据只负责让你知道自己越了。

### 两个判据

```sh
node tools/lint-motion-persona.mjs <任务> [--strict]
node tools/lint-easing-direction.mjs <任务> [--strict]
```

| 判据 | 报什么 | 默认行为 |
|---|---|---|
| **人格** P1 时长档 | 场景里 `prog(t, a, b)` 的字面量跨度落在 quick 以下 / slow 以上的比例 | 只报；`--strict` 才拦 |
| **人格** P2 缓动族 | 缓动名不属于这一档（`outBack` 出现在 premium）或**拼错**（会静默退化成 linear） | 同上 |
| **人格** P3 回弹 | `spring(stiffness, damping)` 的预估 overshoot 超上限 | 同上 |
| **方向** D1/D2/D3 | 位移配线性 / 入场用 ease-in / 出场用 ease-out | 只报；`--strict` 才拦 |

三条**不僵化**的设计（改之前先读）：

1. **可选**：不写 `motion` ⇒ 判据退出码 2（进 skipped，**不假装通过也不扣分**）；
2. **区间 + 强度缩放**：不是定值；`intensity: 0.7` 可以把整档收 30%；
3. **可豁免**：`motion.exempt` 或行内 `// motion:allow <项>` —— 等距尺、机械感、匀速滚动屏都有正当理由用线性。

### 为什么默认只报不拦

这两条是**审美参考**，不是物理规格。`--strict` 留给「交付前想逼自己一把」的时候用；
CI 里不放它们（漂移风险大于收益）。

## 8. 同时运动：一屏里有多少东西在动（1/3 规则的片子版）

「太吵」是可测的：**一帧里有三分之一的画面在动**，眼睛就不知道看哪。
这条判据从**成片**解帧算（纯 ffmpeg + JS，不需要浏览器）：

```sh
node tools/lint-concurrency.mjs <任务> [--strict]           # 读 out/<任务>/*.mp4
node tools/lint-concurrency.mjs --file x.mp4 [--fps 8] [--area 0.33] [--blocks 6]
```

量两件事：**变化面积占比**（相邻两帧之间有多少栅格块真的变了）与**同时运动主体数**（变化块的连通分量）。
切点附近 ±0.25s 的样本**自动跳过** —— 换镜头是整屏变化，不是「同时在动」。

第一次跑的结果：

| 片子 | 面积中位 / 最大 | 主体中位 / 最大 | 备注 |
|---|---|---|---|
| `pv-king` | 3% / 14% | 3 / 11 | 跳过 178 个切点样本；最挤的时刻也远低于 1/3 |
| `pv-kattachi`（60s 版） | 2% / **64%** | 2 / 34 | 24.1s / 31s 两处整屏在动（用 --file 时切点不排除） |

⚠ 用 `--file` 时没有段表，**切点不排除**，峰值会被换镜头抬起来；要量「运动」就给任务名。

默认只报不拦：打斗、故障风、蒙太奇的短段落**本来就该整屏在动**，`--area 1` 可以整片放行。

## 9. 审美症状表（观众这么说 → 查这条）

来自 `skills/motion-design/reference/troubleshooting.md`（MIT）的**片子版**。左边是观众的话，右边是能跑的判据。

| 观众说 | 多半是 | 先跑这条 | 改法 |
|---|---|---|---|
| 「像 PPT」 | 每镜各建一套元素、没有接力物 | `lint-anti-ppt` | `state.diff` + `relayTo`（`docs/ANTI-PPT.md`） |
| 「机械 / 不像人做的」 | 全片同一缓动、直线路径、无次级运动 | `lint-easing-direction` | 换缓动族 + 弧形路径 + 环境层 |
| 「廉价 / 平」 | 只有 primary 层、只动透明度 | `lint-concurrency`（面积偏低）+ 目视 | 加 secondary + ambient |
| 「太吵」 | 同时动的东西太多、幅度过大 | `lint-concurrency` | 面积压到 1/3 以下，主体之外压到 10–20% |
| 「太快 / 太慢」 | 元素动作不在档位、缺 settle | `lint-motion-persona` | 按人格的时长档 + 50–100ms 收尾 |
| 「没有个性」 | 同一支片子里每镜各弹各的 | `lint-motion-persona` | 声明 `motion.personality` 按档统一 |
| 「不像一支片子」 | 切点各建世界 | `anim check`（背景守门） | 共享背景 + 一台摄影机（§4.5） |
| 「颜色脏」 | 色系散了 | `lint-color-family` | 强调色跟着 `signal`（`docs/STYLE.md`） |

> 用法是**先跑右边的命令**，别凭感觉改。判据红了再改画面；判据绿但人觉得不对，才是判据该扩的时候。

