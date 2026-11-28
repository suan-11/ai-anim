# 参考拆解：feitangyuan/onetake（一镜到底的连贯动效）

> 拆解日期 **2026-10-17**。上游 <https://github.com/feitangyuan/onetake>（PolyForm **Noncommercial** 1.0.0，默认分支 `main`）。
> 由主代理直接抓取原文产出：`README.md`、`SKILL.md`、`references/{rhythm,motion-library,composition}.md`、
> `cases/{one-dot-15s,knockon-15s}/README.md`（其余 cases / references 未逐字读，标注见 §1）。
> **未改动任何本地文件**。证据格式：`路径:行号` 指该仓库 `main` 分支对应文件；引用原文处已注明。
>
> ⚠ **许可证红线**：onetake 是 PolyForm Noncommercial —— **代码、字体、looks/ 的色板字面值都不许直接抄进本仓库**
> （哪怕我们目前非商用，也会把许可传染进来）。可以抄的只有**思路、规则、判据、数值口径**（不受版权保护），
> 并用我们自己的 JS/GLSL 重写。下文所有【外部经验值】都按此纪律使用。
>
> **本文件只记"别人怎么做"** —— 可执行的待办一律以 [`BACKLOG.md`](BACKLOG.md) 为准（本轮新增见 §6）。
> 与 hyperframes / video-use / hypit 三份拆解的横向关系见 [`REFERENCE-agent-video-projects.md`](REFERENCE-agent-video-projects.md)。

---

## 0. 一句话结论（先给）

**最值得抄的不是某个动效，而是把「像不像 PPT」变成可度量的验收。**

我们的引擎在技术项上已经全齐甚至更强：每帧是 t 的纯函数、逐帧自适应多子帧真运动模糊（8–216 档 vs 对方固定 8 上限 48）、
共享背景 + 一台摄影机 + 甩走配方（`src/core/trans.js` 文件头那四条）、`check` 的技术守门（背景/版面/亮度/抖动）。
但**没有任何一个量具能说出"这支片子连贯 / 不连贯"** —— [`AGENTS.md`](../AGENTS.md) §4.5 教的是**做法**（四条配方），
却没法验证**做没做到**；`check` 能报"这段没铺背景"，报不了"这两个镜头互相替换、看着像 PPT"。

onetake 用三样东西补上了这层：**边界分类**（carried / anchored / bare）、**carry score**（一个 0..1 的数）、
**四版对照数据**（同一条片子 v1 0.00 被否 → v3 0.75 通过，与人审结论逐版一致 —— 上游仓库 `references/rhythm.md` 的整张表）。
这是它整份 SKILL.md 里唯一我们完全没有的物种，也是它被拒的片子喂出来的最硬的资产。

次值得抄的是三样"动效词表"：**carry 动作**（morphRect / iris / zoomThrough / hop / gather —— 我们只有"甩走 + 反方向落位"一个方向）、
**操作员摄影机配方**（跟主体提前 ~0.1s、落点先 key、hold 时浮动归零 —— `makeCam` 已有，缺的是这层手感参数）、
**节奏判据**（镜头长度 CoV、静帧占比 —— 静态可算，几乎免费）。

---

## 1. 它是什么

一句话：**一个 Claude Agent Skill，做 10–30 秒产品动效片，卖点是"一镜到底、每个画面从上一个里长出来"**。
一个 composition = 一个 HTML 文件（`window.__seek(t)`），一个动作库 `lib/motion.js`（约 39 个纯函数动作），
一个验收 oracle（`probe.py` + `verify_promo.py`）。仓库里没有片子的源码，只有 11 条成片 + 拆解文档。

架构与我们的对照（同构性极高，这是"可抄"的前提）：

| 维度 | onetake | anim（我们） |
|---|---|---|
| 每帧计算 | `__seek(t)` 纯函数，无累积状态；需要积分的东西（soft body / Verlet）**预模拟一次**（240Hz 固定种子）再按索引采样 | 同（`render(t)`；`spring` 是解析解；铁律禁 `Math.random` / 累积） |
| 运动模糊 | 截图间多次 seek 按线性光平均；`__motion(t0,t1)` 报告最大行程 → 自适应采样数（4–48） | 更强：逐帧自适应子帧 8/24/72/216，`--tol` 收紧 |
| 渲染 | Playwright 截图（一次 ~150ms，瓶颈在 Chrome 编码 PNG）+ `--workers` 多进程 | 无头 Chrome + Vite，NV12 管道直推 ffmpeg |
| 旁白 | Kokoro TTS + faster-whisper 词级时间戳；**多语言靠 `?lang=` + `timeWarp` 把新 VO 映射回已 authored 的时间线，源语言逐像素校验** | Edge TTS + `say` 量真实时长反推段长；多语言未做 |
| 验收 | **probe.py（每帧在屏元素 → 每个边界 carry 分类）+ verify_promo.py（节奏/连贯/曲线/构图/音频五腿）** | `check`（技术项）+ `hashes`（像素回归）；**语义层为零** |
| 动作库 | 39 个动作，每个是返回数值的纯函数；`gallery/sheets/<move>.png` 六帧 + 速度曲线 | `src/kit/`（弹簧/错峰/nudge/面板…）+ 11 个镜头模板；**没有速度曲线图册** |

未逐字读的部分（后续要引用需先抓原文）：`references/{product-demo,reference-deconstruction,sound}.md`、
`cases/{motion-web,clearing,overlap,pith,ebb,domino,infra,skill-demo,unbroken,onetake-launch}-*`、`lib/motion.js` 源码、`scripts/*.py` 源码。

---

## 2. 连贯（carry）—— 它的核心创新，我们最大的缺口

### 2.1 概念：边界是设计的对象，不是"转场"

onetake 把**两个画面之间的交接处**当成第一公民。原话（SKILL.md）：

> At every boundary, **something on screen survives and visibly becomes the next beat**.
> … If nothing survives, it is a slide change, whatever the rhythm.（节奏再好，边界上没有东西活下来，就是换灯片。）

它自己的反面教材：Pocket Weather Club **v1 过了全部节奏腿、仍然被否** —— 因为每个 beat 是自己的 scene，`display:none` 互换。
probe 事后量出：两个边界、全 bare、carry score **0.00**。v2 把 carry score 抬到 **0.40**，用户留下了前 6 秒、退回其余。
v3 每个边界都有衔接物，**0.75** 通过。**节奏腿在这四版里全都通过** —— 连贯是节奏腿看不见的另一个维度。

### 2.2 判据（probe 的口径，全部【外部经验值】）

- **边界**：0.4s 窗口内，屏上大部分区域的"身份"变了；经地面的 fade 会被桥接（不算边界）。
- **carried**：有东西活过边界且**移动 ≥ 画面对角线的 2%** 或**缩放 ≥ 10%**。
- **anchored**：唯一幸存者很大（≥ 画面 3%）且**没动**（作为锚定）。
- **bare**：什么都不剩。
- **豁免**：≥3 次硬切在 1.5s 内（burst）、最后 1.2s、`__meta.cuts` 里显式登记的时刻。
- **score = (carried + anchored/2) / 计入的边界数**；verify 判 <0.5 不合格、<0.7 警告。

### 2.3 probe 的盲区（它自己写的诚实清单 —— 抄判据必须连盲区一起抄）

1. **跨元素合成的 carry 不可见**：v2 里"卡片淡出、同位置新页面淡入"，观众看见"卡片变成页面"，probe 看见**替换**
   （因为身份不同）—— 用户两次接受这条缝。修法：**carry 要做成一个元素自己的形变**（morphRect 一层做），或在 cuts 里登记。
2. **连续世界没有边界**：knockon（一个俯拍机器 + 移动摄影机）continuity 1.00 **over 0 boundaries** ——
   "边界比节拍表少"的 PASS 不是证据，那时 carry 只能靠眼睛。
3. **rest 在 320px 粒度上量**：黑底上的小点（one-dot v1 静帧读数 0.844，实际在动）、慢推也算动（clearing 首渲 rest 0.178 假红）。
   **"停顿必须真空静"**，这条腿才诚实。

### 2.4 carry 动作词表（哪些衔接物、什么时候用哪个）

| 动作 | 干什么 | 适用边界 | 我们引擎的等价物 |
|---|---|---|---|
| `morphRect(t,t0,t1,A,B)` | 一个矩形变成另一个矩形（位置/大小/圆角全插值） | **按下的东西变成结果**（按钮→窗口、卡片→页面） | 无 —— `lines.fillRect` 画得出，缺插值骨架 |
| `iris(t,t0,t1,cx,cy)` | 从一点打开圆形遮罩直到盖满画面 | **主体打开自己的世界** | 无（BACKLOG 1-13 的 `iris` 转场同源） |
| `zoomThrough(t,t0,t1,target)` | 对数空间推近直到目标充满画面 | **众多卡片之一是下一场景** | `transitionPass` 的 k² 推离 + 拖影是近亲，但没有"推近到目标"的正向版 |
| `hop(t,t0,t1,from,to)` | 弧线从一个槽跳到下一个，落地配 impact | **主体挑起下一个东西** | 无（`polylineLengths/pointAtLength` 可搭弧线） |
| `gather(t,t0,t1,i,n,from,to)` | 一群元素沿扇形弧线收拢成簇 | **从多个变成一组** | 无 |
| `ribbon(switches)` | 弹性轨道：面板带环形回弹切换、文字滞后 | **选项在手下面切换** | 无 |
| `seal(t,t0,t1)` | 收拢的演员下方长出旋转圆盘 | **演员群变成标志** | 无 |
| `staccato(list)` | 硬切词（0.22–0.36s/个） | **burst —— 唯一 bare 合法的地方** | 逐字 `type.write` 近似 |

手法总结（rhythm.md）：**"手是最便宜的衔接物"** —— 让手（指针）在它引发的边界两侧一直可见；
**"按压成结果"** 是最强的一类因果衔接（knockon 整片即此：每个 beat 是启动下一个 beat 的碰撞）。

---

## 3. 节奏（rhythm）—— 判据全部静态可算或近免费

motion-web 三版教训（同九页同 15 秒）：v1 卡片场匀速 dolly（每卡 0.74s）→「PPT 式一个一个展示」；
v2 全画幅硬切每镜 1.55s →「也没有节奏变化 依然是 ppt」；v3 镜头长度 0.22–2.2s、一 burst 一 rest → 通过。
**匀速镜头长度读作节拍器，不管每镜多好看。**

判据（全部【外部经验值】，出口是 verify_promo.py 的腿）：

| 判据 | 阈值 | 在我们这里怎么算 |
|---|---|---|
| 镜头长度变异系数（CoV） | ≥ 0.25 否则节拍器 | **纯静态**：build 好的时间线每段时长，零渲染成本，可进 `check` |
| 死静帧占比 | ≥ 25%，且至少一段 ≥ 1s 低于低阈值 | 逐帧渲染车道已有（`hashes`）；或降采样 2fps 渲染比对 |
| burst | 若参考片有则本片至少一处（≥3 大变化 / 1.5s），无参考时只警告 | 同上 |
| rest 真空静 | hold 里不许 drift / 慢推 —— **1→1.05 的推在 320px 粒度上永远不静** | 静帧判据天然覆盖；教训照抄 |
| 相邻镜头不许同型收尾 | 弹出/模糊出/硬切交替 | 先不做（难自动判），记进 MOTION.md 作人审条 |

「**停顿让动作落得下来**」（Never let the frame be always in motion）在我们文档里只有间接表述，
值得在 [`MOTION.md`](MOTION.md) 立为正条目。

---

## 4. 摄影机 —— `makeCam` 已有，缺的是"操作员手感"配方

one-dot 的关键转折（它自己的原话）：定机位版「很牛逼…就缺灵动的跟踪运镜」；
加了操作员摄影机后「运镜、镜头和物理都没问题」。配方（composition.md *A camera* + one-dot 拆解，【外部经验值】）：

1. **追，不是跟**（chase, don't follow）：跟主体 → key **提前 ~0.1s**、`sineInOut` 走；
   甩到落点 → **落点先 key**、`expoInOut` 抢在主体到达前到 —— "一帧不落的追逐感"其实是**摄影机先到**。
2. **手持浮动在 hold 时归零**：慢双正弦浮动，用 sstep 包一层 envelope，**必须停的地方振幅为 0**
   （浮动着的机位永远不"死静"，rests 腿会假红）。
3. **每次落地配 shake**：`[t, px, decay]` 列表，确定性种子。
4. **空地面上画 lattice**（远处的点阵）：镜头移动要有东西可滑过，否则读不出运动
   —— 我们的 `worldPass` 网格母题已经同构，这条算已覆盖。
5. **deep zoom（>20×）时 key 屏幕不 key 世界**：锚点 A 的屏幕位置 + zoom 的对数做关键帧，再反推相机。
6. **量化输出**（1/16 px、0.05% zoom）：停住的相机逐帧字节相同 → 跳过快门。
   我们不需要：子帧求解是实时的，但"hold 帧 8 子帧全同 → 自动跳"引擎已有（静止帧 8 个子帧）。

已有地基（kit 子代理报告）：`makeCam(ks, opts)`（`src/core/cam.js:138`）—— `[t, {x,y}, zoom, rot?, ease?]` 关键帧、
**对数 zoom 插值**、zoom 变化 >0.04 时绕不动点插值、格式错当场抛 —— 这就是键控摄影机本体。
缺的是 ①②③ 那层包装（一个 `operatorCam` / `camRig` 辅助：hand envelope + 提前量 + 落地 shake）。

---

## 5. 数值与规则的出处清单（全部标【外部经验值】，我方未实测）

| 值 / 规则 | 出处 | 备注 |
|---|---|---|
| carry score 阈值 <0.5 fail、<0.7 warn | rhythm.md 四版数据表 | 阈值由 4 个版本 2 条人审线标定，样本量小 |
| carried 判据：移动 ≥2% 对角线 / 缩放 ≥10%；anchored：≥3% 画面且不动 | rhythm.md *How the probe decides* | 粒度化判据，可直接进我们实现 |
| 边界 = 0.4s 窗口、大面积身份变化；豁免 burst / 片尾 1.2s / 显式登记 | 同上 | |
| 镜头长度 CoV ≥ 0.25 | rhythm.md + one-dot 实测（0.44）/ knockon（0.67） | 两片实测都 ≥0.44 |
| 静帧 ≥25%，且最长静段 ≥1s；参考片 34% 静止 | rhythm.md（motion-web 的参考片实测） | one-dot 0.389 / knockon 0.272 |
| burst = ≥3 大变化 / 1.5s | rhythm.md | |
| 跟主体提前 ~0.1s、sineInOut；落点先 key、expoInOut | composition.md | 0.1s 是经验值，"先到"是结构性的 |
| >80 px/frame（30fps）无运动模糊会频闪 | SKILL.md Hard rules | 我们自动有真运动模糊，此条变成"不需要担心" |
| whip 540 / iris 206 / flyThrough 189 / morphRect 156 / zoomThrough 72 px/frame @60fps | motion-library.md *Speed and the shutter* | 动作速度谱，做 gallery 时可对照 |
| 一个手势 everywhere 的同形缓动 = "每个动作都是同一个软 S" | SKILL.md（Pocket Weather v3 手搓教训） | 我们的 `ease` 表 + `spring` 已覆盖广度 |
| 卡片缩略图里整页动画读不出（cut 1 教训） | rhythm.md | 与我们"一屏一个主体"（LAYOUT.md）同向 |
| 「小元素、大地」：该类型 70% 留白 | SKILL.md Hard rules | 与我们版面纪律一致 |
| 不许永远在动；rests 真空静 | 同上 + clearing 假红案例 | |
| 相邻两片不许带同一 look（palette/stage/camera grammar 每片重选） | SKILL.md Hard rules | 与我们 STYLE.md 反审美疲劳同条，互相印证 |
| 声音：一套材质、一个房间；每个事件一个合成音 = 音频版幻灯片 | SKILL.md + sound.md 未读 | 我们已有 mix 的音乐闪避；此条进教训 |

**与 hyperframes 拆解的交叉印证**：它也把「lint/验收规则集当产品」当第一建议（[`REFERENCE-hyperframes.md`](REFERENCE-hyperframes.md) §0），
onetake 用 carry score 把同类思想落到了"连贯"这一个维度上，并给了标定数据 —— 两份拆解指向同一个缺口。

---

## 6. 落地路线（已登记进 [`BACKLOG.md`](BACKLOG.md) §1.D，编号见彼处）

按性价比排序（第 1、2 条不引入画面变化、纯增量）：

1. **`anim carry` 量具**（新子命令）：build 时间线 → 取每个边界（段交叠的中点，无交叠则切点）→
   两侧各渲数帧（复用 `cuts` 的渲染车道）→ 粗粒度块匹配找"活过边界的区域"→ carried/anchored/bare 分类 →
   carry score + 明细。**关键设计约束**（从 2.3 盲区来）：carry 只报读数 + `--strict` 才 gate（跟版面守门同例）；
   连续世界（0 边界）要报「没边界可判」而不是 PASS；允许 `cut(..., { carry: 'anchor' })` 式显式登记豁免。
2. **`check` 节奏腿**：CoV 纯静态计算（零渲染）；静帧占比先做成 `--rhythm` 可选段（渲 2fps 采样帧比对），
   默认不打进退出码。
3. **`src/kit/carry.js` 词表**：`morphRect / iris / zoomThrough / hop / gather` 五个纯函数（允许清单只 import `../core/util.js`，
   参数 NaN 当场抛，照 motion.js 的 need() 纪律）+ `operatorCam`（makeCam 之上的 hand envelope + 提前量 + 落地 shake 包装）。
   ⚠ 名字全仓库零命中（kit 子代理已查）；与 BACKLOG 1-13（参数化转场）合并推进——`iris` 一鱼两吃。
4. **动作图册**（可后置）：`anim gallery` 或 `tools/motion-sheets.mjs` —— 每个 kit 动作一张六帧 + 速度曲线图，
   照 `gallery/sheets/<move>.png` 的形状；同时把 §5 的速度谱升级成【我方实测】。
5. 不抄的：UI 截图重建（`record_footage.py`/`ui_kit.js`，技术栈不同，我们走纹理路线 + 已有 COOKBOOK §9）、
   多语言 timeWarp（等 BACKLOG 1-23 variants 落地再谈）、`score.py` 音效（我们有 mix + 闪避；「一套材质一个房间」先记教训）、
   `looks/` 色板字面值（许可证 + STYLE.md 已有风格包体系）、`swiftSpring`（等价物 = 我们 `spring(τ,1,ω,ζ)` 换参）。

---

## 7. 与另外三份拆解的关系

| | 本文件（onetake） | hyperframes | video-use / hypit |
|---|---|---|---|
| 主贡献 | **连贯度 oracle + carry 动作词表 + 操作员摄影机配方** | lint 规则集当产品 + 运动规则判据 | 验证一张图 / 词锚定 / 并行事实 |
| 架构同构度 | 高（纯函数 + seek + 快门模糊） | 低（DOM + GSAP） | 中 |
| 交叉印证 | "像 PPT"可度量（carry score）；节奏与连贯是两个腿 | 语义层规则可 gate | 「空 ≠ 干净」也适用于 carry 报告 |
| 许可证 | **PolyForm Noncommercial —— 代码不可抄** | Apache-2.0 | MIT / Apache-2.0（有附加条件） |
