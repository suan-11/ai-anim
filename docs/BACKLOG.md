# BACKLOG —— 还没做的事（唯一的待办清单）

> **2026-11-13 · A3 归档瘦身（PLAN-2026-11-08 阶段 1）**：已完成的 53+ 条记录与顶部历史批次说明
> **原样**迁入 [`history/BACKLOG-done-2026-10.md`](history/BACKLOG-done-2026-10.md)；
> 外部仍在引用的编号在 §4 留一行指针（不静默删除）。同轮落地：
> **A5** regress-all 前置依赖体检（`tools/lib/regress-env.mjs` + 各项 `needs` 声明 + `test-ci-coverage` 守门，
> 缺依赖 ⇒ skipped(env) 一行说清修法，`tools/test-regress-env.mjs` 45 项；CI 76/76）；
> **A6** 孤儿工具清理（5 个 nuomi 工具迁 `tasks/nuomi/tools/` 并修 ROOT；删 `probe-app-scale` / `probe-text-alpha`，
> 前者是一次性验收探针、后者纯转发 `anim probe-alpha`）。
>
> **改进计划（阶段 1 已完成，阶段 2–5 待执行）**：[`PLAN-2026-11-08.md`](PLAN-2026-11-08.md)
> （三条主线：工程健康 A1–A6 · 渲染测速 B0 · 画面下限 C1–C4）。
>
> **刚接手？先读 [`HANDOVER.md`](HANDOVER.md)**：现状 / 这轮做了什么 / 怎么验证 / 环境坑 / 欠账。
>
> **这份文件是仓库里唯一的待办 / 待拍板清单。**
> 各轮改进记录（`history/IMPROVEMENTS-*.md`）与 `STATUS.md` 里的"没做的 / 留给下一轮"小节
> 是**当时**的状态，**现在以本文为准**。
>
> **维护规则**：只有本文是待办；做完一条就移到 §4 并注明**哪一轮做的**（保留一行，不要静默删除）；
> 每条都要能回答"从哪接着做 / 怎么算做完"。**编号是外部锚点**：归档时在主文件留一行指针。

---

## 0. 拍板区

| # | 拍什么 | 代价 | 详见 |
|---|---|---|---|
| P-1 | **字幕层要不要做厚** —— 离线回归（连渲 3 帧字幕应不同）+ 完整 CJK 断行（避尾 / 悬挂 / 中西间距）+ 字幕与画面标注的冲突检测 | 约 2–3 天 | 复盘 §3.A-1 / A-3 / A-4 |
| P-2 | **3D 舞台要不要进 src/kit/** —— 房间 / 长桌 / 座位参数化，seats[].facing 由参数给（堵住「靠背朝错」这类 bug） | 约 2–3 天 | 复盘 §3.B-1 |

**现行拍板结论（2026-11-01，用户逐条拍板）**：

- 主线 **1-12 相机接力已落地**（2026-11-01）；**P-1 / P-2 / 1-7ⓑ 本轮不做、保留不关门**。
- 内容能力三条立项（排在 1-12 之后，**顺位已到**）：**1-30 B-roll**、**1-56 绿幕/透明导出**、**多语言旁白**。
- 小额两条排进：**1-1**（先做 `blocks.js` 夹具任务再接 `check`）、**1-33**（`anim cuts` A/B 实测三条运动上限）。
- **1-31 / 1-32 已量化**（数字记在各自行），建议动 lint 时顺手做。
- 方向（2026-10-25）：anim 是「一个人的内容工厂」，口径 = **每支片子的边际工时 + 画面下限**；
  分发层与 VLM 自动评审全砍。背景见 `history/HANDOFF-directions.md`。
- P-3～P-8 已完成/已拍板（60fps 保留、竖屏提前、可拆 Opus 案例只学手法），记录在归档 §2。

---

## 1. 引擎 / 工具（已确认还开着）

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| 1-1 | **`check` 增加几何自检**：随机取几个"已知应该可见"的面，验证"被铺的面 = 朝镜头的面" | 这类"不报错但画面全错"的几何 bug 目前**只能靠眼睛**（`facesToward` 反向那次出图核对了 20+ 帧才定位到）。判据可以先做成纯 JS 的（`tools/test-blocks.mjs` 已有正反用例可复用）。<br>⚠ **2026-10-10 核正：先解决「假覆盖」再动手** —— 今天**没有任何 `tasks/` 引用 `src/kit/blocks.js`**（老任务各自带一份私有拷贝），所以直接把它接进 `check` 会做出一个**永远绿**的检查（在现有任务集上不可能被触发）。要么先迁一个任务过来用 kit，要么专门做一个夹具任务 —— 否则这条等于没做。**2026-11-01 拍板：做 —— 先做 `blocks.js` 夹具任务，再接 `check`** | [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第四轮 §6 **F**（⬜ 未做） |
| 1-7 | **渲染提速的下一刀（2026-10-17 重估；ⓐ 已落地，剩 ⓑ/ⓒ）** | **ⓐ R8/RG8 回读已做（2026-10-17，0-8）**：`readNV12()` 的 Y/UV 平面改成 R8/RG8 直接回读，总回读 **10.37 → 3.11MB/帧**、紧凑化循环删除；实测 `_calib` 720 帧 **47.8s → 44.5s（15.1 → 16.2 fps，1.07×；三次 44.3–44.6s）**，`probe-r8` / `probe-nv12` / `verify` / `hashes` 全绿（PERF.md §5.2/§5.4a/§5.6）。**剩下**：ⓑ **WebCodecs**（浏览器内编码 38.7ms/帧、传输 3.11MB→27KB（314×），粗算 81→47ms = 1.7×，PERF.md §5.4b 已实测可行未落地，**等 B0 分段计时实测后再拍板**（PLAN-2026-11-08 §4：目标机有独显，瓶颈可能在 GPU 渲染端；传输+编码占比 >40% 才立项 WebCodecs）；代价：放弃 CRF、`--segments`/音轨/`verify` 全要适配编码分片 + `-c copy` 封装）；ⓒ 渲染侧本身（独显 `--gpu high` 对填充重段已实测 2.15×，这个已经能用）。旧②「GPU 编码 8bit 回读」与旧③「PBO」仍关（只值 1.5% / 6%） | [`PERF.md`](PERF.md) §5.2/§5.3/§5.4/§5.6 · `src/core/gl.js` 的 `RT.format` / `readNV12` |
| 1-31 | **`lint-fabricated-numbers` 判据 ③ 的假阴性：`values: [0.3, 0.7, 0.95]` 这种纯数字数组元素两边都不认**（判据 ① 只认字面量数字、③ 只认算出来的） | 本仓库的图表任务**全是这个写法** ⇒ 那串数**实际上没人验**（子代理 2026-10-16 实测：6 个有事实表的任务 194 个显示位里，`values` 元素一个都没被两条判据覆盖）。要做就得把 `values` 的元素纳进判据 ①（代价：所有图表任务染红，得逐个登记进 FACTS.md）；**先想清楚要不要**，别顺手加。另两条同类假阴性：裸变量实参 `type.write(cnt, …)`、跨文件流向。<br>**2026-11-01 已量化**：全仓纯数字 `values` = **15 个任务 / 17 组 / 100 个数**（nuomi7–15 全部、7 个 `_lab` 夹具、example-config-only、_style-sampler），**没有一个有 FACTS.md** ⇒ lint 本来就安静跳过，**纳入判据①的即时染红面 = 0**；真正收益是堵住未来「有 FACTS 的图表任务」没人验的洞。**建议纳入**，动 lint 时顺手做 | 子代理报告（2026-10-16）· `tools/lint-fabricated-numbers.mjs` 文件头的诚实清单 |
| 1-32 | **`String(cnt).padStart(2, '0')` 里的补零字符 `'0'` 被当成显示位字面量**（判据 ① 的假阳性） | 它其实是**格式参数**，不是画面上的数字。消掉要改判据 ① 的"实参里任意字面量"口径，会动**所有任务**的条数（本轮没做：夹具里刻意留着并登记了一行 `0`）。<br>**2026-11-01 已量化**：显示位共 **3 处**（`nekohome-intro-ja/cards.js:389`、`nekoclicker-intro/packflash.js:59`、`promo/_world.js:547`）+ 非显示位 1 处（`nekoclicker-intro/sticker.js:8`，文件名参数不进 `type.write`、本来就不咬）⇒ 影响面很小，**建议改口径**（padStart 的填充字符参数不算显示位实参），动 lint 时顺手做。⚠ 改之前先量一遍"会影响几个任务、几条" | 同上 |
| 1-33 | **1-27 留下的一半：三条运动上限接进守门**<br>**①错峰跨度：已完成（2026-10-26）** —— `tools/lint-motion-caps.mjs` 从源码字面量算 `items × stagger`（判据与 `waterfallOver()` 同口径 0.5s），`anim check` 每次都跑：默认 warn、`--strict` 进 errs、没有可判对象进 skipped；读不出元素个数（简写 / 函数参数）记 **unchecked** 而不是通过。验证 `tools/test-motion-caps.mjs` 27 项 + 夹具 `tasks/_motion-lab`<br>**②辉光峰值：已完成（2026-10-26）** —— 只认**显式声明** `halo: { peak: 0.62 }`（或 `halo: 0.62`），峰值 > 0.45 即报；不扫裸 `alpha`（分不清辉光与正文淡入，假阳性会淹掉真命中）。没有 halo 的场景**不算「没验」**（设计上没做辉光）<br>**③碰撞式转场 40–50%：已完成（2026-10-26）** —— `src/core/trans.js` 出 `VICTIM_RATIO_RANGE = [0.40, 0.50]` / `VICTIM_RATIO_DEFAULT`（区间中点，由常量算出）/ `planCollision({ enterDur, ratio })`（越界夹回 + 非空说明；`enterDur ≤ 0` ⇒ victimDur 0 + degenerate；NaN / ±Inf 当场抛）/ `victimSpan()`；`transitionPass(gl, { victimRatio })` 把比例喂 uniform `fadeAt`，**不传则行为逐像素不变**（Pass 源码与 HEAD 逐字节相同，773 B）。`src/kit/index.js` 与 `kit/world.js` 都已转发。验证 `tools/test-transition-collision.mjs` **30 项**（含 120 组扫描恒落 [40%,50%]、说明带原值/区间/出处）<br>⚠ 三条上限的数值本身仍是**外部经验值**（`docs/MOTION.md` §0），要变成我方实测得拿一段 `anim cuts` 做 A/B（**2026-11-01 拍板：做**） | — |

### 1.A 画面能力 / 1.B 画面验证 / 1.D 连贯节奏 / 1.E EAC 拆解

**全部完成**，记录在归档 §3.2–§3.5（编号指针见 §4）。

### 1.C 素材能力（立项，顺位已到）

| # | 事 | 现在能确定的 | 还不知道的 |
|---|---|---|---|
| 1-30 | **从已有素材里挑片段**（**2026-11-01 拍板：立项要做，排在 1-12 之后**）（裁切 / 拼接真实视频段，即 B-roll 那一层） | ① 我方的**结构性优势不能弄丢**：现在是"一次编码、无接缝、字幕画在后处理之后、每帧可 seek"；② 真做素材裁切时，"预烘焙视频段拼进成片"必撞的五条硬规则已经拆出来了（字幕必须在滤镜链**最后**、逐段抽帧后无损 `-c copy` 拼、每个接缝补 30ms 音频淡入淡出、overlay 用 `setpts=PTS-STARTPTS+T/TB` 落位、母版字幕按输出时间轴偏移）——我们**已经对了三条**，不会返工；③ 必须先决定**素材段的合成层级**（在 ffmpeg 层拼好当"底"、代码镜头合成上去？还是把素材当引擎里的一张图层？）—— 前者会失去"代码镜头逐帧可 seek"的便利 | 值不值得做（用户目前是"大量可视化的科普/介绍片"，不是实拍剪辑）；观众反馈里到底缺不缺"真实画面" |

> **还没做、也还没排期的一条**：**一条旁白出多语言版本**。现在 `VOICE` 一行换音色、`say`+`mix` 重跑即可；
> 多语言要重写整份 `SCENE` 文案与 `words` —— 先等 **1-23**（`variants` + `narration.json` 可指定）落地再谈，
> 否则会做两遍。**2026-11-01 拍板：立项要做**（前置 1-23 已落地；排在 1-12 之后）。

### 1.F 个人内容工厂

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| 1-56 | **绿幕 / 透明导出**（**2026-11-01 拍板：立项要做，排在 1-12 之后**）（2026-10-26 从 `REFERENCE-jizura.md` 拆出，**不排期**）：`video --alpha` 背景层出纯色、文字层单独出一条，后期合成用 | 判据：两条轨帧数与主片一致（ffprobe 复核）；`qtrle` 或 PNG 序列两种可选。对"一个人做片子"收益中等，先登记 | [`docs/REFERENCE-jizura.md`](REFERENCE-jizura.md) §4 |

其余（1-43～1-55 / 1-57～1-62 / 1-66～1-71）**全部完成**，见归档 §3.6；
**1-49 母题库 2026-11-13 核实关闭**：spectrum 三母题已落地（fourier/dct/waveform，unit:motifs 38 项）；
剩余描述（sodium 积木 / bikeshed 会议室 / 私有 _kit.js）全指向 .gitignore 的本地任务，按 PLAN A3 移出待办（见归档 §3.7）。

### 1.G 反 PPT 批次遗留（2026-11-04）

- **非均匀时长的自动编排** / **环境音** / **三维穿场景**：继续保留（`docs/ANTI-PPT.md` §六的未做项）。
  `deconstruct` 只提供了单物体三维解构，**没有**把"镜头穿场景"这一整条销账。
- **C7 接线**已由 PLAN-2026-11-08 **C4** 收编（运动节奏读数进 `check`）。
- 已完成部分（reveal/cascade/transform、TextKit.reveal、_action-lab、分块签名修复）见归档头部批次说明。

---

## 2. 内容 / 片子

| # | 事 | 说明 | 出处 |
|---|---|---|---|
| 2-3 | **pv-kattachi 尾段歌词错位** | 既有片子欠账，不在 PLAN-2026-11-08 本轮范围，待单开排期 | PLAN-2026-11-08 §1.4 |
| 2-4 | **pv-king 补音效与 state/relayTo 声明** | 同上 | 同上 |

（2-1 一支真成片已完成，见归档 §4；2-2 nekoseek 不立项是用户拍板，见归档 §5。）

---

## 3. 磁盘与临时件（确认成片没问题就可以删）

> 两轮清理（2026-10-16）：`out/` **55 GB → 27 GB → 25.9 GB**（删 `*.parts/` 等中间产物与散落的调试件）。
> 逐任务读数与两轮清理的完整清单见归档 §6。
>
> `node scripts/anim.mjs clean <任务>` 的**默认档**删 `*.parts/`、裸帧、`concat.txt`、诊断目录；
> **成片 / stills / hash 基线 / `NOTES.json` 一律不删**；`--all` 才连成片一起删。
> ⚠ 代价：下次 `video --segments` 会全部重渲（分块本来就是断点续渲用的）。
>
> **没核过用途的别顺手删**：`_nv12test/`、`demo/`、`_three-lab/`、`_calib/`、`_probe*/`、`_ref/`、`_look/`、`check/`、`dev/`、`final/`。
> **别删 `out/<任务>/NOTES.json`** —— 它是评论反馈的唯一落点，`clean` 结构上就碰不到它。

---

## 4. 已归档（外部引用保活指针）

> 完整记录（**原样**）：[`history/BACKLOG-done-2026-10.md`](history/BACKLOG-done-2026-10.md)。
> 下表只保活**外部仍在引用**的编号（2026-11-13 全仓扫描）；没列出的编号同样在归档里。
> 归档文件里的"没做的"字样是当时的状态，不是现在的待办。
>
> **画面基线口径**（AGENTS.md §7 引这里）：基线是**变更探测器**，不是"画面永远不许变"——
> 保画面（bug fix / 重构 / 性能）⇒ `--baseline` 必须全绿；改画面（有意的视觉改进）⇒ 先看前后对比图再 `--accept --note`。
> 判例与 2026-10-24「基线不再冻结引擎」批次记录在归档头部。

| # | 事 | 记录在哪 |
|---|---|---|
| 0-3 | type.write align 整行对齐修复 | [归档 §5](history/BACKLOG-done-2026-10.md) |
| 0-5 | 镜头库加模板（8→11） | [归档头部批次](history/BACKLOG-done-2026-10.md) |
| 0-6 | 后处理新参数用起来 | [归档头部批次](history/BACKLOG-done-2026-10.md) |
| 0-8 | R8/RG8 回读（1-7ⓐ） | [归档头部批次](history/BACKLOG-done-2026-10.md) |
| 1-2 | 第九轮守门/工具批次条目 | [归档头部](history/BACKLOG-done-2026-10.md) |
| 1-3 | 第九轮守门/工具批次条目 | [归档头部](history/BACKLOG-done-2026-10.md) |
| 1-4 | 出片路径非有限值扫描 | [归档 §5](history/BACKLOG-done-2026-10.md) |
| 1-5 | probe-alpha 读数更正 | [归档 §5](history/BACKLOG-done-2026-10.md) |
| 1-6 | say 批量容错 | [归档 §5](history/BACKLOG-done-2026-10.md) |
| 1-9 | 配置档 post/world/maxSamples 首个真实用例 | [归档 §5](history/BACKLOG-done-2026-10.md) |
| 1-10 | raymarch vs 投影线段批成本对照 | [归档 §5](history/BACKLOG-done-2026-10.md) |
| 1-11 | 仪器视图（九种成像） | [归档 §3.2](history/BACKLOG-done-2026-10.md) |
| 1-12 | 相机接力 relay | [归档 §3.2](history/BACKLOG-done-2026-10.md) |
| 1-13 | 参数化转场（9 种模式） | [归档 §3.2](history/BACKLOG-done-2026-10.md) |
| 1-14 | 零状态 GPU 粒子 | [归档 §3.2](history/BACKLOG-done-2026-10.md) |
| 1-15 | 段间引用 renderShot | [归档 §3.2](history/BACKLOG-done-2026-10.md) |
| 1-17 | §1.B 画面/验证批次条目 | [归档 §3.3](history/BACKLOG-done-2026-10.md) |
| 1-18 | 画面语义断言 | [归档 §3.3](history/BACKLOG-done-2026-10.md) |
| 1-19 | 空≠干净（skipped 语义） | [归档 §5](history/BACKLOG-done-2026-10.md) |
| 1-20 | 第九轮守门/工具批次条目 | [归档头部](history/BACKLOG-done-2026-10.md) |
| 1-21 | 模板声明式 spec + 依赖前置校验 | [归档 §5](history/BACKLOG-done-2026-10.md) |
| 1-22 | 画面数字必须有出处 | [归档 §5](history/BACKLOG-done-2026-10.md) |
| 1-23 | variants + 旁白表可指定 | [归档 §3.3](history/BACKLOG-done-2026-10.md) |
| 1-24 | --parallel 硬化 + 心跳 + 渲染锁 | [归档 §3.3](history/BACKLOG-done-2026-10.md) |
| 1-26 | 并发子代理 brief 模板 | [归档头部批次](history/BACKLOG-done-2026-10.md) |
| 1-27 | 运动规则表 + kit | [归档头部批次](history/BACKLOG-done-2026-10.md) |
| 1-29 | shots --json + anim note | [归档 §5](history/BACKLOG-done-2026-10.md) |
| 1-34 | anim carry | [归档 §3.4](history/BACKLOG-done-2026-10.md) |
| 1-35 | 节奏（静态）腿 | [归档 §3.4](history/BACKLOG-done-2026-10.md) |
| 1-36 | carry.js 纯函数 | [归档 §3.4](history/BACKLOG-done-2026-10.md) |
| 1-37 | carry 接触表 + 速度曲线 | [归档 §3.4](history/BACKLOG-done-2026-10.md) |
| 1-38 | anim rhythm 量具 | [归档 §3.4](history/BACKLOG-done-2026-10.md) |
| 1-39 | anim qa | [归档 §3.5](history/BACKLOG-done-2026-10.md) |
| 1-41 | type.write blur 通道 | [归档 §3.5](history/BACKLOG-done-2026-10.md) |
| 1-42 | 模板 use/energy/avoid | [归档 §3.5](history/BACKLOG-done-2026-10.md) |
| 1-43 | anim queue | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-44 | --draft 草稿档 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-45 | 块级增量重渲 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-46 | 设计 token + 语义字号 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-47 | token 对比夹具 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-48 | 模板 11→20 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-49 | 母题库（2026-11-13 核实关闭） | [归档 §3.7](history/BACKLOG-done-2026-10.md) |
| 1-50 | infoShot 信息段骨架 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-51 | 守门元测试 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-52 | 竖屏 1080×1920 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-53 | cover + chapters | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-54 | _ideas.md 选题池 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-55 | brief §11 选题→brief | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-58 | tasks --json | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-59 | 配置档按段切片签名 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-62 | 选型引擎 tags/w/fits | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-63 | style.view 介质字段 | [归档头部批次](history/BACKLOG-done-2026-10.md) |
| 1-64 | 胶片磨损 weave/flicker/scratch | [归档头部批次](history/BACKLOG-done-2026-10.md) |
| 1-65 | halftone N 版套印 | [归档头部批次](history/BACKLOG-done-2026-10.md) |
| 1-67 | 像素精灵 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-68 | 木刻多方向排线 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-69 | 手绘笔迹 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-70 | 填充面 fillPoly/fillCircle/fillSector | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-71 | 亚像素抖动 + 硬边带 | [归档 §3.6](history/BACKLOG-done-2026-10.md) |
| 1-73 | 成片版本戳（BACKLOG 未立行，见提交 ef76dd5） | [tools/test-render-stamp.mjs](history/BACKLOG-done-2026-10.md) |
| P-3 | 块级增量重渲拍板（随 1-45 落地） | [归档 §2](history/BACKLOG-done-2026-10.md) |
