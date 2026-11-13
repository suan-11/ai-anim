# BACKLOG —— 还没做的事（唯一的待办清单）

> **2026-11-13 · 改进计划进度已核对**：详见 [`PLAN-2026-11-08.md`](PLAN-2026-11-08.md) 顶部进度表。11 项中完成 2 项、部分完成 4 项、未完成 5 项，覆盖工程健康 A1–A6、渲染测速 B0、画面下限 C1–C4。

> **2026-11-08 · 已完成条目已归档**：带 `~~删除线~~` 或明确写「已完成 / 已拍板完成」的条目（含顶部按日期堆叠的历史批次说明、§4「已经关掉的」整节）**逐字迁入** [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md)；本文只留 §0 拍板区、仍开放的条目、磁盘清理现状与维护规则。已迁走的编号见 §5。

> **刚接手？先读 [`HANDOVER.md`](HANDOVER.md)**：现状 / 这轮做了什么 / 怎么验证 / 环境坑 / 欠账。

> **这份文件是仓库里唯一的待办 / 待拍板清单。**
> 各轮改进记录（[`history/IMPROVEMENTS-1-3.md`](history/IMPROVEMENTS-1-3.md)、
> [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md)）与 [`STATUS.md`](STATUS.md)
> 记录的是**已经做完**的事；它们各自有一个"没做的 / 留给下一轮"小节，那是**当时**的状态，
> **现在以本文为准**（本文已经逐条核对过代码与文档，把后来做掉的划掉了）。
>
> **维护规则**：只有本文是待办；做完一条就移到 §5 并注明**哪一轮做的**（保留一行，不要静默删除）；
> 每条都要能回答"从哪接着做 / 怎么算做完"。
>

---

## 0. 拍板区（2026-10-17 0-6 落地后**已空**，2026-10-18 重新开了三条 —— 其余待办仍进 §1 / §2 / §3）

> 来源：（2026-10-18 那支成片的复盘，文档只留本地；活条目已全部收编如下）：
> 12 个真实撞到的坑 + 引擎改进建议）。三条都是**引擎能力**，不是这一支片子的返工。

| # | 拍什么 | 代价 | 详见 |
|---|---|---|---|
| P-1 | **字幕层要不要做厚** —— 离线回归（连渲 3 帧字幕应不同）+ 完整 CJK 断行（避尾 / 悬挂 / 中西间距）+ 字幕与画面标注的冲突检测 | 约 2–3 天 | 复盘 §3.A-1 / A-3 / A-4 |
| P-2 | **3D 舞台要不要进 src/kit/** —— 房间 / 长桌 / 座位参数化，seats[].facing 由参数给（堵住「靠背朝错」这类 bug） | 约 2–3 天 | 复盘 §3.B-1 |

---

## 1. 引擎 / 工具（已确认还开着）

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| 1-1 | **`check` 增加几何自检**：随机取几个"已知应该可见"的面，验证"被铺的面 = 朝镜头的面" | 这类"不报错但画面全错"的几何 bug 目前**只能靠眼睛**（`facesToward` 反向那次出图核对了 20+ 帧才定位到）。判据可以先做成纯 JS 的（`tools/test-blocks.mjs` 已有正反用例可复用）。<br>⚠ **2026-10-10 核正：先解决「假覆盖」再动手** —— 今天**没有任何 `tasks/` 引用 `src/kit/blocks.js`**（老任务各自带一份私有拷贝），所以直接把它接进 `check` 会做出一个**永远绿**的检查（在现有任务集上不可能被触发）。要么先迁一个任务过来用 kit，要么专门做一个夹具任务 —— 否则这条等于没做。**2026-11-01 拍板：做 —— 先做 `blocks.js` 夹具任务，再接 `check`** | [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第四轮 §6 **F**（⬜ 未做） |
| 1-7 | **渲染提速的下一刀（2026-10-17 重估；ⓐ 已落地，剩 ⓑ/ⓒ）** | **ⓐ R8/RG8 回读已做（2026-10-17，0-8）**：`readNV12()` 的 Y/UV 平面改成 R8/RG8 直接回读，总回读 **10.37 → 3.11MB/帧**、紧凑化循环删除；实测 `_calib` 720 帧 **47.8s → 44.5s（15.1 → 16.2 fps，1.07×；三次 44.3–44.6s）**，`probe-r8` / `probe-nv12` / `verify` / `hashes` 全绿（PERF.md §5.2/§5.4a/§5.6）。**剩下**：ⓑ **WebCodecs**（浏览器内编码 38.7ms/帧、传输 3.11MB→27KB（314×），粗算 81→47ms = 1.7×，**等待 B0 实测数据后再定**；代价：放弃 CRF、`--segments`/音轨/`verify` 全要适配编码分片 + `-c copy` 封装）；ⓒ 渲染侧本身（独显 `--gpu high` 对填充重段已实测 2.15×，这个已经能用）。旧②「GPU 编码 8bit 回读」与旧③「PBO」仍关（只值 1.5% / 6%） | [`PERF.md`](PERF.md) §5.2/§5.3/§5.4/§5.6 · `src/core/gl.js` 的 `RT.format` / `readNV12` |
| 1-31 | **`lint-fabricated-numbers` 判据 ③ 的假阴性：`values: [0.3, 0.7, 0.95]` 这种纯数字数组元素两边都不认**（判据 ① 只认字面量数字、③ 只认算出来的） | 本仓库的图表任务**全是这个写法** ⇒ 那串数**实际上没人验**（子代理 2026-10-16 实测：6 个有事实表的任务 194 个显示位里，`values` 元素一个都没被两条判据覆盖）。要做就得把 `values` 的元素纳进判据 ①（代价：所有图表任务染红，得逐个登记进 FACTS.md）；**先想清楚要不要**，别顺手加。另两条同类假阴性：裸变量实参 `type.write(cnt, …)`、跨文件流向。<br>**2026-11-01 已量化**：全仓纯数字 `values` = **15 个任务 / 17 组 / 100 个数**（nuomi7–15 全部、7 个 `_lab` 夹具、example-config-only、_style-sampler），**没有一个有 FACTS.md** ⇒ lint 本来就安静跳过，**纳入判据①的即时染红面 = 0**；真正收益是堵住未来「有 FACTS 的图表任务」没人验的洞。**建议纳入**，动 lint 时顺手做 | 子代理报告（2026-10-16）· `tools/lint-fabricated-numbers.mjs` 文件头的诚实清单 |
| 1-32 | **`String(cnt).padStart(2, '0')` 里的补零字符 `'0'` 被当成显示位字面量**（判据 ① 的假阳性） | 它其实是**格式参数**，不是画面上的数字。消掉要改判据 ① 的"实参里任意字面量"口径，会动**所有任务**的条数（本轮没做：夹具里刻意留着并登记了一行 `0`）。<br>**2026-11-01 已量化**：显示位共 **3 处**（`nekohome-intro-ja/cards.js:389`、`nekoclicker-intro/packflash.js:59`、`promo/_world.js:547`）+ 非显示位 1 处（`nekoclicker-intro/sticker.js:8`，文件名参数不进 `type.write`、本来就不咬）⇒ 影响面很小，**建议改口径**（padStart 的填充字符参数不算显示位实参），动 lint 时顺手做。⚠ 改之前先量一遍"会影响几个任务、几条" | 同上 |
| 1-33 | **1-27 留下的一半：三条运动上限接进守门**<br>**①错峰跨度：已完成（2026-10-26）** —— `tools/lint-motion-caps.mjs` 从源码字面量算 `items × stagger`（判据与 `waterfallOver()` 同口径 0.5s），`anim check` 每次都跑：默认 warn、`--strict` 进 errs、没有可判对象进 skipped；读不出元素个数（简写 / 函数参数）记 **unchecked** 而不是通过。验证 `tools/test-motion-caps.mjs` 27 项 + 夹具 `tasks/_motion-lab`<br>**②辉光峰值：已完成（2026-10-26）** —— 只认**显式声明** `halo: { peak: 0.62 }`（或 `halo: 0.62`），峰值 > 0.45 即报；不扫裸 `alpha`（分不清辉光与正文淡入，假阳性会淹掉真命中）。没有 halo 的场景**不算「没验」**（设计上没做辉光）<br>**③碰撞式转场 40–50%：已完成（2026-10-26）** —— `src/core/trans.js` 出 `VICTIM_RATIO_RANGE = [0.40, 0.50]` / `VICTIM_RATIO_DEFAULT`（区间中点，由常量算出）/ `planCollision({ enterDur, ratio })`（越界夹回 + 非空说明；`enterDur ≤ 0` ⇒ victimDur 0 + degenerate；NaN / ±Inf 当场抛）/ `victimSpan()`；`transitionPass(gl, { victimRatio })` 把比例喂 uniform `fadeAt`，**不传则行为逐像素不变**（Pass 源码与 HEAD 逐字节相同，773 B）。`src/kit/index.js` 与 `kit/world.js` 都已转发。验证 `tools/test-transition-collision.mjs` **30 项**（含 120 组扫描恒落 [40%,50%]、说明带原值/区间/出处）<br>⚠ 三条上限的数值本身仍是**外部经验值**（`docs/MOTION.md` §0），要变成我方实测得拿一段 `anim cuts` 做 A/B（**2026-11-01 拍板：做**） | — |

> **1.A（画面能力）/ 1.B（画面 / 验证能力）/ 1.D（连贯 / 节奏）/ 1.E（参考拆解 EAC）四节已全部完成**，整节（含来源与许可证说明）迁入 [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md)；本节只留还开着的条目。

### 1.C 素材能力（**还没做，也没有排期** —— 只是想清楚了一半）

| # | 事 | 现在能确定的 | 还不知道的 |
|---|---|---|---|
| 1-30 | **从已有素材里挑片段**（**2026-11-01 拍板：立项要做，排在 1-12 之后**）（裁切 / 拼接真实视频段，即 B-roll 那一层） | ① 我方的**结构性优势不能弄丢**：现在是"一次编码、无接缝、字幕画在后处理之后、每帧可 seek"；② 真做素材裁切时，"预烘焙视频段拼进成片"必撞的五条硬规则已经拆出来了（字幕必须在滤镜链**最后**、逐段抽帧后无损 `-c copy` 拼、每个接缝补 30ms 音频淡入淡出、overlay 用 `setpts=PTS-STARTPTS+T/TB` 落位、母版字幕按输出时间轴偏移）——我们**已经对了三条**，不会返工；③ 必须先决定**素材段的合成层级**（在 ffmpeg 层拼好当"底"、代码镜头合成上去？还是把素材当引擎里的一张图层？）—— 前者会失去"代码镜头逐帧可 seek"的便利 | 值不值得做（用户目前是"大量可视化的科普/介绍片"，不是实拍剪辑）；观众反馈里到底缺不缺"真实画面" |

> **还没做、也还没排期的一条**：**一条旁白出多语言版本**。现在 `VOICE` 一行换音色、`say`+`mix` 重跑即可；
> 多语言要重写整份 `SCENE` 文案与 `words` —— 先等 **1-23**（`variants` + `narration.json` 可指定）落地再谈，
> 否则会做两遍。**2026-11-01 拍板：立项要做**（前置 1-23 已落地；排在 1-12 之后）。

### 1.F 个人内容工厂（2026-10-25 定的主线，**按"周末能多出一支"排序**）

> 来源：[HANDOFF-directions.md](history/HANDOFF-directions.md)（这一轮的方向结论：硬约束 C-1~C-8、现状读数、外部证据、四阶段路线）。
> 判断口径只有两条：**每支片子的边际工时**（现在 3 小时/支，顺利时）与**画面下限**。
> 前三条（1-43 ~ 1-45）解决"等渲染"；1-46 ~ 1-49 解决"劣质感"；其后是复利与选题。

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| 1-49 | **母题库**：`sodium` 积木 / `spectrum` 波形格阵 / `bikeshed` 会议室 抽进 `src/kit/motifs/` | 画面变化用 `hashes --accept --note` 记录 | 同 §5 Phase 2 |
| ~~1-74~~ | **已修（2026-11-11）**：`gl.clear()` 现在算一次「整帧覆盖绘制」（`src/core/gl.js` 的 `clear` 调 `_notePaint`）。背景守门原来只数 `Pass.render` —— 而 `AGENTS.md` §3 教场景写的第一句正是 `gl.clear(ctx.out, …)`，于是「只靠 clear 铺底」的模板（`outro`）被误判。引擎在 `beginPaint` **之前**那次兜底黑屏不会被数（那时 `paint` 为 null）。复现原状：`tasks/_gate-probe` 的 outro 段。**原始记录：** **`outro` 模板 + `world: 'auto'` 被背景守门判成「没铺底」**（2026-11-09 在做转场样片时撞到）：`outro` 自己 `gl.clear(ctx.out, P.bg)` 且声明 `outputs.visual = 'full-frame'`，但在配置档节点上同时写 `world: 'auto'` + `handlesTransition: true` 时，`check` 的「背景守门」把它列进 `missing`。换成 `title` 模板同样的写法就通过 ⇒ 怀疑是 `outro` 的清屏路径没被守门的计数器认到（或它与 `world` 铺底的顺序/目标不一致）。复现：`tasks/trans-showcase` 的 `e` 段改回 `type: 'outro'` 跑 `check --quick` |
| 1-56 | **绿幕 / 透明导出**（**2026-11-01 拍板：立项要做，排在 1-12 之后**）（2026-10-26 从 `REFERENCE-jizura.md` 拆出，**不排期**）：`video --alpha` 背景层出纯色、文字层单独出一条，后期合成用 | 判据：两条轨帧数与主片一致（ffprobe 复核）；`qtrle` 或 PNG 序列两种可选。对"一个人做片子"收益中等，先登记 | [`docs/REFERENCE-jizura.md`](REFERENCE-jizura.md) §4 |

---

## 2. 内容 / 片子

> 当前没有开放条目：`2-1` 已完成，见 [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md)。

---

## 3. 磁盘与临时件（确认成片没问题就可以删）

> **2026-10-16 复核：`out/` 曾合计 55 GB；当夜按用户拍板清掉了全部 `*.parts/` 等中间产物 ——
> 7 个任务、释放 29.4 GB，现在合计 27 GB。** 下面这张表是**清理后**的读数：
>
> `node scripts/anim.mjs clean <任务>` 的**默认档就是删这些**（`*.parts/`、裸帧、`concat.txt`、
> `_dumpframe` 这类诊断目录），**成片 / stills / hash 基线 / `NOTES.json` 一律不删**；`--all` 才连成片一起删。
> ⚠ 代价：**下次 `video --segments` 会全部重渲**（分块本来就是断点续渲用的）。

| 任务 | 目录（清理后） | 这一轮删掉的 |
|---|---|---|
| sodium | **8.1 GB** | 11.7 GB（`*.parts/` 33 块 + `_dumpframe/`） |
| optifine | **7.1 GB** | 11.5 GB（`*.parts/` 38 块） |
| beast | **4.0 GB** | 55 MB（`*.parts/` + `concat.txt`） |
| fidus | **2.0 GB** | 3.2 GB（`*.parts/` 15 块） |
| promo | **1.7 GB** | 2.5 GB（`*.parts/` 12 块） |
| example-config-only | **309 MB** | 566 MB（`*.parts/` 7 块） |
| `_calib` | 84 MB | 2.4 MB（`*.parts/` 7 块） |
| `_style-sampler` / `_nv12test` / demo / `_three-lab` / `_staging` | 1.4 GB / 594 MB / 483 MB / 432 MB / 322 MB | —（这一轮**没动**） |

**下面这些还可以删**（用户这一轮只选了"删 `*.parts/`"，所以它们都还在）：

| 路径 | 大小 / 说明 |
|---|---|

> **2026-10-16 深夜 · 第二轮清理（跟着 §1.B-25/26 那个小包走的）**：上面那张表里的
> `_style-sampler/`（1.4 GB）、`_staging/`（322 MB）、`_postlab/`（42 MB）、`_refs/`（24 MB）、
> `_docbackup-20261007/`（1.6 MB）、`sodium/_diag_*.png` + `bed.mono22k.wav`（25 MB）、以及 `out/` 根目录
> 散落的 `_dbg*.mjs` / `_measure.mjs` / `_b-smoke.mjs` / `_commit*.txt` / `_err.txt` —— **全部已删**，
> `out/` **27.6 GB → 25.9 GB（释放 1.77 GB）**。`_postlab` 的那两个读数脚本没有丢，已搬进
> `tools/probe-post-ab.mjs` 与 `tools/probe-post-ab2.mjs`（默认仍读 `out/_postlab`，可用环境变量 `POSTLAB`
> 覆盖；0-6 要用）。**没动的**：`_nv12test/`（594 MB）、`demo/`、`_three-lab/`、`_calib/`、`_probe*/`、
> `_ref/`、`_look/`、`check/`、`dev/`、`final/` —— 没核过它们还有没有用，**别顺手删**。
> 删之前都可以用 `node scripts/anim.mjs clean <任务>`（默认档）或手工删；`out/**` 不在版本控制里。
> **别删 `out/<任务>/NOTES.json`** —— 它是评论（"第 12.5 秒这里字幕太小"这类反馈）的唯一落点，`clean` 结构上就碰不到它。

---

## 4. 已经关掉的（历史遗留，别再翻）

整节（「第九轮 / 第十轮 / 第十一轮 / 第十二轮」的逐条销账、用户拍板不做的 0-1～0-7、以及 1-63 / 1-64 / 1-65 / 1-45b / C-1 / 1-49（部分））**逐字迁入** [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md)。这一节原本记的就是「这些已经做掉了」——**别再翻出来当待办**。

---

## 5. 已完成（已归档）—— 指针

> 迁移规则见文首：做完一条就**逐字搬进** [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md)，在这里留一行指针（不要静默删除）。

| 编号 | 现在在哪 |
|---|---|
| ~~P-3~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~0-3~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~0-5~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-2~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-4~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-5~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-6~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-10~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-12~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-14~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-17~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-18~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-19~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-20~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-21~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-22~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-24~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-26~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-29~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-35~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-36~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-37~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-38~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-39~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-41~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-42~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-45~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-47~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-48~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-50~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-51~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-53~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-58~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-59~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-60~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-62~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-67~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-68~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-69~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-70~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |
| ~~1-71~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md) |

其余已归档编号（`1-8`、`1-11`、`1-13`、`1-15`、`1-23`、`1-34`、`1-43`、`1-44`、`1-46`、`1-52`、`1-54`、`1-55`、`1-57`、`1-61`、`1-63`~`1-66`、`1-72`、`1-45b`、`2-1`、`C-1`、`P-4`~`P-8`）同样在那份归档里，按编号搜即可。

> 正文里 `同 §5 Phase 1/2/3/4` 这种出处指的是 [`history/HANDOFF-directions.md`](history/HANDOFF-directions.md) §5，不是本节的编号。

---

## 已解决：亮底风格「底色与调色板不符」（2026-11-02 全量回归发现，同日修完）

三层原因（判据取点时刻 / 取点位置 / `palette.bg` 被 `...DEFAULT_PALETTE` 盖回去）与修法**逐字迁入** [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md)；现在 `node tools/test-style-palette.mjs` 全绿（亮底 229 / 暗底 47 的分档也成立）。
