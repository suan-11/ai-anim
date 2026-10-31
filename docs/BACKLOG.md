# BACKLOG —— 还没做的事（唯一的待办清单）

> **这份文件是仓库里唯一的待办 / 待拍板清单。**
> 各轮改进记录（[`history/IMPROVEMENTS-1-3.md`](history/IMPROVEMENTS-1-3.md)、
> [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md)）与 [`STATUS.md`](STATUS.md)
> 记录的是**已经做完**的事；它们各自有一个"没做的 / 留给下一轮"小节，那是**当时**的状态，
> **现在以本文为准**（本文已经逐条核对过代码与文档，把后来做掉的划掉了）。
>
> **维护规则**：只有本文是待办；做完一条就移到 §5 并注明**哪一轮做的**（保留一行，不要静默删除）；
> 每条都要能回答"从哪接着做 / 怎么算做完"。
>
> 最后整理：**2026-10-10 深夜（第九轮 · 两批）**。第一批「守门 / 工具」：1-2 / 1-3 / 1-16 / 1-19 / 1-20 / 1-28 / 1-29；
> 第二批「纪律 / 能力」：1-4 / 1-6 / 1-9 / 1-10 / 1-21 / 1-22 —— 两批都**已落地并移入 §4**。
> **1-1 核实后剔除**：直接接线会做成一个"永远绿"的假覆盖（今天没有任何 `tasks/` 用 `src/kit/blocks.js`，理由见该行）。
> 同一轮还按核实结果更正了 5 处与代码不符的描述（§0-3 / §0-5 / §1-1 / §1-5 / §1-10）。
>
> **第十轮（2026-10-16）：第九轮记下的 ①–⑨ + `1-5` 全部收掉**，逐条证据见 §4 末尾那一段。
> 一句话概括这一轮：**把"没验"变成"能判"** —— 依赖令牌 `under` 接线（段级审计）、
> 背景守门与引擎同口径并多采一个时刻、`--scan-nf` 的 4K 代价与 `--parallel` 第一次实测、
> 死链接注释 91 处改到 `docs/history/`。**过程中量出一个真 bug 与一个假报**：
> ① `sheet-audio --sheet` 的栅格行数写死 4×4（8 格的接触表 ⇒ 7 格落在图外）；
> ② 背景守门第一版把"窗后中点"也压了同一条判据 ⇒ `check demo` 把**设计如此**的甩镜尾巴报成"没铺背景"。
> 两个都修了、都补了离线判据（`tools/test-timeline-audit.mjs`）。
>
> **本轮记下的新待办（两条都是"判据的假阴性/假阳性"，别丢）**：
> ⑩ **`values: [0.3, 0.7, 0.95]` 这种纯数字数组两边都不认**（1-31）：判据 ① 只认**字面量数字**、
> 判据 ③ 只认**算出来的**，而"数组里逐个写死的数字"恰好落在中间 —— **本仓库的图表任务全是这个写法**，
> 也就是说那串数**实际上没人验**。要不要把 `values` 的元素也纳入判据 ①（代价：所有图表任务都会染红，
> 得逐个登记进 FACTS.md）是个**取舍**，不是纯技术问题。
> ⑪ **`String(cnt).padStart(2, '0')` 里的补零字符 `'0'` 会被当成显示位字面量**（1-32）：
> 它其实是格式参数，不是画面上的数字。消掉要改判据 ① 的"实参里任意字面量"口径，
> 会动**所有任务**的条数（这一轮没做，夹具里刻意留着并登记了一行 `0`）。
>
> **2026-10-16 深夜 · 待办复核（第十二轮：用户逐条拍板）** —— 起因是"我感觉有些不需要了"。
> 本轮只动**清单 / 磁盘 / 一处注释**（`tasks/nekohome/scenes/_kit.js` 顶部），**不动任何画面与引擎行为**。
> **关闭 5 条**（全部移进 §4，注明"用户拍板不做"）：`0-1`、`0-2`、`0-3`、`0-4`（含 §2-2）、`0-7②③`。
> **主线定为「先补引擎与工具能力」**（不是先出下一支片子）：已拍板要做的 `0-5`（`src/shots/` 加模板）
> 与 `0-6`（后处理新参数用起来）也按这条主线排。
> **其余全部保留、没有做优先级削减**：§1（`1-1` / `1-7` / `1-8` / `1-24` / `1-25` / `1-26` / `1-27` / `1-31` / `1-32`）、
> §1.A（`1-11` ~ `1-15`）、§1.B（`1-17` / `1-18` / `1-23`）、§1.C（`1-30`）、§2-1。
> 磁盘：`out/` 的中间产物已按 §3 清掉（7 个任务、释放 29.4 GB，55 GB → 27 GB）。
>
> **2026-10-16 · 0-5 落地（镜头库加模板：8 → 11 个）** —— `quote` / `counter` / `compare` 三个模板已进 `src/shots/`。
> 这一条**不只是"照 `title.js` 抄三个文件"**：还要动 `src/shots/index.js`（登记）、`tools/test-shots.mjs`
> （模板集合是**手写**的、`typeOk()` 原来不认 `object[]`、一条夹具把 `quote` 当"不存在的模板名"用 ⇒ 顺着红出来）、
> 以及 10 处文档 / 注释里的"8 个模板"。**顺带被出图抓出来的三处画面问题**（都已修，证据在 §4 那一行）。
> 新增夹具 `tasks/_shots-lab/`（6 段：三个模板的默认画面 + 三个非默认分支）。
>
> **2026-10-16 深夜 · 便宜小包（§1.B-25 / 1.B-26 / 1.B-27 + 第二轮清磁盘）** —— 主线（0-6）之外的四件小事一次收掉：
> ① **`anim cuts`**：切点两侧 ±1.5s 各出一张接触表（三点采样一个都不落在切点上），画着信号色方框的那格就是切点；
>    两条流程纪律（自检最多 3 轮 / 发布前派只挑毛病不夸的审查者）进 `AGENTS.md` §10.12。
> ② **并发子代理 brief 模板**：`docs/SCENE-BRIEF-TEMPLATE.md` §10（纯新增 104 行）。
> ③ **运动规则表 + 3 个 kit 函数**：`docs/MOTION.md` + `src/kit/motion.js` + `tools/test-motion.mjs`（42 项，挂 `unit:motion`）。
> ④ **清磁盘**：`out/` 27.6 → 25.9 GB（释放 1.77 GB）。
> ⚠ 顺带发现并处理：`AGENTS.md` 已经顶到工作区的**指令字节预算**（65536 B）—— 这轮加的内容一度把尾部约 1 KB
> 挤成静默截断，已把新增压到最小并合并几处重复表述（现在 64829 + 本轮新增，余量不足 600 B）。**下次再往里加
> 契约之前先瘦身**（把"想做真 3D""旁白/口播"这类已有专题文档的整节改成指针）。

> **2026-10-18 · 一支真成片（本地任务，名称略）首次同时踩爆两个引擎 bug，都已修** ——
> 拍板的选题开工。**顺带修掉两个引擎 bug，都是这一支片子第一次同时触发的**：
> ① **字幕层从第二帧起不再更新** —— `_drawCaptions` 直接画在 `cap2d.ctx` 上、没走 `layer.clear()`，
>    而 `Layer2D.upload()` 有一条 `if (this._uploaded) return this` 的短路（`_uploaded` **只有 `clear()` / `fill()` 会重置**）
>    ⇒ 纹理只上传一次，整片字幕永远停在第一句（实测：多帧连渲时 t=130 / t=175 都显示 t=6 的那句）。
>    修法：`_drawCaptions` 开头先 `layer.clear()`（`src/core/engine.js`）。**以前没有任何任务开过 `captions: true`，所以这条一直没被发现。**
> ② **中文折行把标点甩到行首**（"…四块七毛五的咖啡 / ，吵了一小时…"）—— `TextKit.wrap()` 新增**避头标点**
>    （`src/core/text.js` 的 `NO_LINE_START`）：断行点正好落在标点上时不断行，宁可让那一行超出一个标点的宽度。
> **验收**：`hashes demo` / `hashes beat --baseline` 各 **11/11 max 0**（老片子逐像素没变）；
> `tools/regress-all.mjs --only unit` **23/23**；成片 `check` **skipped 无 / 版面守门无 ⚠ / motion.json 11 条断言全过**。

> **2026-10-24 · 拆解 `Ebony-Vinyl/EAC-design-world`，四条一次收掉（1-39 ~ 1-42）** ——
> 那个项目和我们做的是同一件事的两半（它把 HTML/CSS 逐帧 seek，我们把 GLSL 逐帧算），
> 拆解报告在 [`REFERENCE-eac-design-world.md`](REFERENCE-eac-design-world.md)（AGPL-3.0：代码一行不抄，只借思路与口径）。
> 本轮落地的四件：**`anim qa`**（成片级黑场/静帧/音量扫描，纯 ffmpeg）、
> **`anim subs` 的 ASS 转义**、**`type.write` 的 `blur` 通道**（+ `title.blur`）、
> **11 个模板的 `use/energy/avoid`**（+ `anim shots --use`）。逐条证据见 §4。

> **2026-10-24 ·「基线不再冻结引擎」落地后，第一批被这条原则锁住的改进（解禁后的首批收账）** ——
> 用户拍板「修改引擎不需要保证老片子画面不变」之后，把那些"为了不改 demo/beat 画面而没做"的事逐个收掉：
>
> ① **修好 `type.write` 的 `align`**（BACKLOG 0-3 那个"不修"条目）。修法是让 `align` 按**整行**对齐
>    （内部量整行宽再偏一次，逐字 `fillText` 时归 `left`），`write({align})` 与 `writeLine({anchor})` 从此等价。
>    修前 `kinetic` 的「都是时间的函数」7 字实测 x 875..2029，右边 109px 被切；修后居中、不出画。
>    同步改了对齐语义的文档（ENGINE/COOKBOOK/AGENTS），新增几何量具 `tools/test-text-align.mjs`（13 项）。
>
> ② **补齐 `public/fonts/` 缺失的 4 个字体**。`Archivo / IBM Plex Mono / Cormorant Garamond`
>    的 `@font-face` 声明一直在，但 `.woff2` 一个都不在仓库 → 全引擎拉丁字回退微软雅黑、等宽回退
>    Consolas，「换风格连字体一起换」这条支柱失效（审计原话）。现在真文件到位（都 OFL，THIRD-PARTY 登记）。
>    已交付的 fidus / sodium 拉丁字形随之变化（中文、布局、配色未变），基线已 `--accept --note` 更新。
>
> ③ **顺手抓到并修了一个真 bug：`hashes --accept` 会把基线采样密度悄悄缩水**。没写 `--every` 时
>    `--accept` 回落到默认 4 帧，而基线通常是 11 帧 —— 一次 accept 就砍掉 64% 的检查点，且不报错。
>    修法：`--accept` 沿用基线自己那批采样时刻（实测演示了 0-3 与字体两次 accept 后 demo 只剩 4 帧）。
>    守门 `tools/test-hashes-policy.mjs` 新增 1 项。
>
> ④ **`grainScale` 默认改 `'auto'`**：1080p 走 `screen`（老行为逐像素不变），`--scale 2+` 自动 `design`
>    （4K 颗粒不会细一半，这是确定的缺陷）。显式 `screen` / `design` 仍钉死。结论：AgX 当全局默认**不做**
>    —— 实测 sodium 深色主题会被 AgX 去饱和 14% 而无死白可救，AgX 只该给白底/高光多的风格。
>
> ⑤ **交叠期转场默认从交叉溶解改成甩镜**（`transitionPass`）。溶解把两屏字叠一起会糊；
>    甩镜沿摄影机方向把旧帧推出、前半程透明度就到 0。作者可显式 `transition: 'mix'`（溶解）/
>    `'none'`（硬切）。`transition` 进 TIMELINE_KEYS / cut / configToCut / build 四接。
>    **本轮没做 1-1（几何自检）**：核实它卡的不是基线冻结，而是"没有任务 import `src/kit/blocks.js`"
>    （sodium 里的 "blocks" 只是 changelog 文字不是引用）——直接接进 `check` 仍是永远绿的假覆盖。
>    要做必须**先做一个夹具任务**（用 blocks.js 建一个"被铺面=朝镜头面"的可判场景），是另一档工作量，
>    留给下一轮单独做。其余盘点的条目（tonemap 全局默认 / dither tpdf / bloomKaris 全局开）经实测**都不该一刀切改默认**。

---

## 0. 拍板区（2026-10-17 0-6 落地后**已空**，2026-10-18 重新开了三条 —— 其余待办仍进 §1 / §2 / §3）

> 来源：（2026-10-18 那支成片的复盘，文档只留本地；活条目已全部收编如下）：
> 12 个真实撞到的坑 + 引擎改进建议）。三条都是**引擎能力**，不是这一支片子的返工。

| # | 拍什么 | 代价 | 详见 |
|---|---|---|---|
| P-1 | **字幕层要不要做厚** —— 离线回归（连渲 3 帧字幕应不同）+ 完整 CJK 断行（避尾 / 悬挂 / 中西间距）+ 字幕与画面标注的冲突检测 | 约 2–3 天 | 复盘 §3.A-1 / A-3 / A-4 |
| P-2 | **3D 舞台要不要进 src/kit/** —— 房间 / 长桌 / 座位参数化，seats[].facing 由参数给（堵住「靠背朝错」这类 bug） | 约 2–3 天 | 复盘 §3.B-1 |
| P-3 | **--segments 块级失效值不值得做** —— 改一段只重渲一块；这轮那种返工从 81 分钟降到 ~15 分钟 | 约 2–3 天 | 复盘 §3.C-2 |
| P-4 | **自适应运动模糊的收敛判据要不要改** —— 静止画面上它一路加到 72 子帧（实测 0.9 fps），根因是 `makeShot` 让摄影机抖动跟着**子帧时间**走。三条候选修法（排除 shake / 加"停滞熔断" / 让 `perf` 报子帧分布） | 约半天–1 天 | [HANDOFF-spectrum-friction.md](HANDOFF-spectrum-friction.md) §1 |
| P-5 | **`anim mix` 要不要加显式 `--target -14`** —— 现在只报不归一化（立场正确），但没有官方"怎么贴靶子"的做法，每支新片子都要自己写一个脚本 | 约半天 | [同 §5](HANDOFF-spectrum-friction.md) |
| ~~P-6~~ | **已拍板（2026-10-25）：成片保留 60fps**。渲染时间不减半 ⇒ 靠 1-44 草稿档 / 1-43 排队 / 1-45 增量重渲补回来；`fps` 全局默认仍 60 | — | [HANDOFF-directions.md](HANDOFF-directions.md) §9 |
| ~~P-7~~ | **已拍板（2026-10-25）：竖屏提前**，排 W4–W5（tokens 之后、块级增量重渲之前） | 已并入 1-52 | 同 §9 |
| ~~P-8~~ | **已拍板（2026-10-25）：可以拆 Opus 5.5 案例，好的就学**；纪律 = 只学手法与配方，**不抄素材/文案/代码** | 已并入 1-48 | 同 §9 |

另有半天以内、**不需要拍板**的改进列在复盘 §3（A-2 旁白表加载失败要可见 /
D-1 flush 后画线要报 / D-2 给 f.dt / D-4 lint 排除 note / E-1 out/.render-lock）。
**C-1 与 F-1 已落地**（F-1 见 2026-10-25 的 W1/W2 批次；C-1 见 §4 2026-10-31 深夜）。

> **2026-10-25 · 《把信号拆开》（`tasks/spectrum`）做完之后的摩擦点** ——
> 那一轮**没改引擎**，摩擦全在"用法 / 默认值 / 报错时机"。逐条带复现命令与根因（已核到代码）：
> [`docs/HANDOFF-spectrum-friction.md`](HANDOFF-spectrum-friction.md)。
> 上面 P-4 / P-5 是其中**需要拍板**的两条；其余（渲染卡死要用 `--segments`、`--only` 平移、
> 片段没音轨、focus 对图形主体不友好、标注可以合并成一行）已在 §1 各自条目里登记或直接进文档。

> **2026-10-25 · 方向定案：把 anim 当「一个人的内容工厂」** —— 用户明确三件事：① 这是**方便自己做视频**的
> 内容工厂（不是对外产品）；② **开源延后**到"足够完善"；③ **只有他自己用**。因此评估口径换成
> **"每支片子的边际工时 + 画面下限"**，分发层（MCP / Agent Skills / WebMCP / OTIO / 跨生态视频 CI / 商业化）
> **全部砍掉**，VLM 自动评审当 gate 也砍（judge 会把 78–90% 的画面失败判成通过，见
> [arXiv 2609.28564](https://arxiv.org/abs/2609.28564)）。
> 完整背景、外部证据、四阶段路线与判据在 **[HANDOFF-directions.md](HANDOFF-directions.md)**（自包含）；
> 活条目落在下面 **§1.F**（1-43 ~ 1-55）；三条待拍板 **P-6 / P-7 / P-8 已于同日拍板**：
> 成片**保留 60fps**、**竖屏提前**（W4–W5）、**可以拆 Opus 案例**（只学手法，不抄素材/文案/代码）。
> 目前 §0 **没有待拍板项**。
> **同一天的工程批次交接单**：[HANDOFF-2026-10-25.md](HANDOFF-2026-10-25.md)
> （W1+W2 已完成的证据、踩掉的坑、以及接管的上一会话 WIP 清单）。
>
> **2026-10-30 · 图元层 + 介质层**：从用户提供的 341 条风格素材包里挑出三件事落地（填充面 `src/core/fill.js`、
> 仪器视图 `src/kit/views.js`、九套版式风格 `src/style/panels.js`）。交接单：
> [HANDOFF-2026-10-30.md](HANDOFF-2026-10-30.md)；素材包分析：
> [REFERENCE-style-pack.md](REFERENCE-style-pack.md) 与 [REFERENCE-style-pack-capability.md](REFERENCE-style-pack-capability.md)。
>
> **2026-10-31 · AGENTS 瘦身 + 参数化转场 + 纸艺层叠**：AGENTS.md 63795 → 55015 B（-13.8%，零章节删除）；
> **1-13** 参数化转场落地（`wipe` / `iris` / `glitch` / `pixel` / `dissolve`，共 8 种模式，`push` 源码逐字符未变）；
> **1-66** 剪纸 / 纸艺层叠（`src/kit/paper.js`，覆盖素材包 20 条）。交接单：
> [HANDOFF-2026-10-31.md](HANDOFF-2026-10-31.md)。验收 `regress-all --ci` **53/53**。
>
> **2026-10-31 晚 · 像素精灵 + 多方向排线（同一天的第二轮）**：接着 [HANDOFF-2026-10-31.md](HANDOFF-2026-10-31.md) §5
> 那张「按复用度排序」的缺口表往下做，收掉第 9 / 10 两行：
> **1-67** 像素精灵（`src/kit/pixel.js` + 模板 `shot('pixel')`，调色板 / 块 / 抖动 / 12fps 台阶四件事齐全）；
> **1-68** 木刻铜版多方向排线（`views.woodcut`：按明暗**加方向**，亮部一道 / 中间调两道 / 暗部三道）。
> **两条的最贵发现都是「出图才看得见」的比例**：像素层是「压栅格必须块内平均 + 读回要翻 y + 天空只跨两档」，
> 排线是「低通半径要盖住底图特征尺度 + 线距不能与像素栅格成整数比（12px 出次谐波横带，22px 才干净）」。
> 验收 `regress-all --ci` **55/55**（新增 `unit:pixel` / `unit:woodcut`）。
>
> **2026-10-30 晚 · 介质层第二批 + 三条拍板（用户当场定的）**：
> ① **`style.view` 做、默认 off** —— 八种成像提成风格包字段，只有显式声明的风格才换介质（1-63）；
> ② **H/K/Z 三组 65 条素材放着不投入** —— 正文只有一句话（「粗线条，网点，速度线」）、只有 3 张静帧，
>   做出来就是猜配色；只当名字列表用，要落地先向素材包作者要截图；
> ③ 本轮范围 = **胶片磨损 → N 版套印**（1-64 / 1-65）。
>
> 落地：`post.weave/flicker/scratch`（1-64）、`halftone` 的 N 版套印（1-65）、两套新风格
> `h-riso`（双版套印）/ `h-vhs`（CRT + 磨损）、夹具 `tasks/_wear-lab` 与 `tasks/_style-view-lab`；
> 交接单 [HANDOFF-2026-10-30-media.md](HANDOFF-2026-10-30-media.md)。
>
> ⚠ 本轮**改了一处已交付的可视行为**：`crt` 成像的亮度补偿 1.55 裸乘会把浅底画面打成 20%+ 死白
> （`check _style-view-lab` 当场红），改成亮部软肩；`_view-lab` 基线已按流程 `--accept --note`。

---

## 1. 引擎 / 工具（已确认还开着）

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| 1-1 | **`check` 增加几何自检**：随机取几个"已知应该可见"的面，验证"被铺的面 = 朝镜头的面" | 这类"不报错但画面全错"的几何 bug 目前**只能靠眼睛**（`facesToward` 反向那次出图核对了 20+ 帧才定位到）。判据可以先做成纯 JS 的（`tools/test-blocks.mjs` 已有正反用例可复用）。<br>⚠ **2026-10-10 核正：先解决「假覆盖」再动手** —— 今天**没有任何 `tasks/` 引用 `src/kit/blocks.js`**（老任务各自带一份私有拷贝），所以直接把它接进 `check` 会做出一个**永远绿**的检查（在现有任务集上不可能被触发）。要么先迁一个任务过来用 kit，要么专门做一个夹具任务 —— 否则这条等于没做 | [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第四轮 §6 **F**（⬜ 未做） |
| 1-7 | **渲染提速的下一刀（2026-10-17 重估；ⓐ 已落地，剩 ⓑ/ⓒ）** | **ⓐ R8/RG8 回读已做（2026-10-17，0-8）**：`readNV12()` 的 Y/UV 平面改成 R8/RG8 直接回读，总回读 **10.37 → 3.11MB/帧**、紧凑化循环删除；实测 `_calib` 720 帧 **47.8s → 44.5s（15.1 → 16.2 fps，1.07×；三次 44.3–44.6s）**，`probe-r8` / `probe-nv12` / `verify` / `hashes` 全绿（PERF.md §5.2/§5.4a/§5.6）。**剩下**：ⓑ **WebCodecs**（浏览器内编码 38.7ms/帧、传输 3.11MB→27KB（314×），粗算 81→47ms = 1.7×，PERF.md §5.4b 已实测可行未落地；代价：放弃 CRF、`--segments`/音轨/`verify` 全要适配编码分片 + `-c copy` 封装）；ⓒ 渲染侧本身（独显 `--gpu high` 对填充重段已实测 2.15×，这个已经能用）。旧②「GPU 编码 8bit 回读」与旧③「PBO」仍关（只值 1.5% / 6%） | [`PERF.md`](PERF.md) §5.2/§5.3/§5.4/§5.6 · `src/core/gl.js` 的 `RT.format` / `readNV12` |
| 1-8 | **`dur: { vo }` 只能配内联旁白表** | 外部 `narration.json` 是页面启动后才 fetch 的，`build()` 时还没有表。想做"配置档 + 外挂旁白表"要先改这个时序 | [`history/STATUS-rounds-7-10.md` §15.5](history/STATUS-rounds-7-10.md) |
| 1-31 | **`lint-fabricated-numbers` 判据 ③ 的假阴性：`values: [0.3, 0.7, 0.95]` 这种纯数字数组元素两边都不认**（判据 ① 只认字面量数字、③ 只认算出来的） | 本仓库的图表任务**全是这个写法** ⇒ 那串数**实际上没人验**（子代理 2026-10-16 实测：6 个有事实表的任务 194 个显示位里，`values` 元素一个都没被两条判据覆盖）。要做就得把 `values` 的元素纳进判据 ①（代价：所有图表任务染红，得逐个登记进 FACTS.md）；**先想清楚要不要**，别顺手加。另两条同类假阴性：裸变量实参 `type.write(cnt, …)`、跨文件流向 | 子代理报告（2026-10-16）· `tools/lint-fabricated-numbers.mjs` 文件头的诚实清单 |
| 1-32 | **`String(cnt).padStart(2, '0')` 里的补零字符 `'0'` 被当成显示位字面量**（判据 ① 的假阳性） | 它其实是**格式参数**，不是画面上的数字。消掉要改判据 ① 的"实参里任意字面量"口径，会动**所有任务**的条数（本轮没做：夹具里刻意留着并登记了一行 `0`）。⚠ 改之前先量一遍"会影响几个任务、几条" | 同上 |
| 1-33 | **1-27 留下的一半：三条运动上限接进守门**<br>**①错峰跨度：已完成（2026-10-26）** —— `tools/lint-motion-caps.mjs` 从源码字面量算 `items × stagger`（判据与 `waterfallOver()` 同口径 0.5s），`anim check` 每次都跑：默认 warn、`--strict` 进 errs、没有可判对象进 skipped；读不出元素个数（简写 / 函数参数）记 **unchecked** 而不是通过。验证 `tools/test-motion-caps.mjs` 27 项 + 夹具 `tasks/_motion-lab`<br>**②辉光峰值：已完成（2026-10-26）** —— 只认**显式声明** `halo: { peak: 0.62 }`（或 `halo: 0.62`），峰值 > 0.45 即报；不扫裸 `alpha`（分不清辉光与正文淡入，假阳性会淹掉真命中）。没有 halo 的场景**不算「没验」**（设计上没做辉光）<br>**③碰撞式转场 40–50%：已完成（2026-10-26）** —— `src/core/trans.js` 出 `VICTIM_RATIO_RANGE = [0.40, 0.50]` / `VICTIM_RATIO_DEFAULT`（区间中点，由常量算出）/ `planCollision({ enterDur, ratio })`（越界夹回 + 非空说明；`enterDur ≤ 0` ⇒ victimDur 0 + degenerate；NaN / ±Inf 当场抛）/ `victimSpan()`；`transitionPass(gl, { victimRatio })` 把比例喂 uniform `fadeAt`，**不传则行为逐像素不变**（Pass 源码与 HEAD 逐字节相同，773 B）。`src/kit/index.js` 与 `kit/world.js` 都已转发。验证 `tools/test-transition-collision.mjs` **30 项**（含 120 组扫描恒落 [40%,50%]、说明带原值/区间/出处）<br>⚠ 三条上限的数值本身仍是**外部经验值**（`docs/MOTION.md` §0），要变成我方实测得拿一段 `anim cuts` 做 A/B | — |

### 1.A 画面能力（2026-10 拆解参考项目 `world.execute (me) ;` 之后列的，**按建议顺序**）

> 来源：`docs/REFERENCE-world-execute.md`（对外部开源项目的逐文件拆解，每条都有 `文件:行号` 证据）。
> 后处理那四条同源、**已落地**（见 §0-6），下面是还没做的。

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| ~~1-11~~ | **已完成（2026-10-30）**：仪器视图 —— `src/kit/views.js`（八种成像：`halftone` 半调 / `ascii` 字符画 / `dither` 1-bit / `posterize` 分级平涂 / `thermal` 热成像 / `pixel` 像素 / `crt` 显像管 / `engrave` 雕版排线）+ `instrumented(ctx, opts, draw)` 一行式入口 + `renderCapture` / `applyView`。**踩掉三个不报错的坑**：① 字符画的字模表手写顺序不单调（`=` 10 点排在 `o` 8 点前）⇒ 中灰底被印成一片白，改成运行时按**实际着墨点数**稳定排序，并由 `tools/test-views.mjs` 钉住；② 极性写反（`dither` 的黑白、`thermal` 的底色）在深色底片上「看着还挺像」，做成显式常量 `SCREEN_POLARITY`；③ 引擎 `GLSL_COMMON` 的 `hatch()` 返回的是「暗度附加值」不是「墨覆盖率」，直接当墨用会得到整屏斜纹的反相版画 —— 排线自己写。夹具 `tasks/_view-lab`（8 段，`check --quick` 0 红、8/8 段有画面）；回归 `tools/test-views.mjs`（27 项，挂 `unit:views`）；文档 `docs/COOKBOOK.md` §16、`docs/REFERENCE-style-pack.md` | 能力清单来自用户提供的 341 条风格素材包（见 `docs/REFERENCE-style-pack.md` §3），**代码一行没抄**；对应素材包条目：L29 / O19 / E3 / L39 / K28 / X13 / L30 / L31 / O10 |
| 1-12 | **相机接力 `relay`**：段与段之间不是"切"，而是**相机一路飞过去、内容中途换手**（对方 305 个镜头里 22% 的切点用它） | 四块：① `cam.js` 加位姿混合（look 点直线插值、朝向四元数 slerp、**画幅大小按对数插值** `exp(lerp(log a, log b))`、相机位置由 look+dist **反推**——这样是绕主体摆动而不是切角）；② `trans.js` 加 relay 转场（两段用**同一个混合位姿**各渲一遍、只交叉画面、**文字整段交接不做溶解**）；③ `kit` 加相机探针协议（镜头在设相机处登记，引擎能"只跑到相机那一步"读出位姿、再 drive 回去）；④ `timeline.js` 让 `overlap` 能声明 `relay`。**先只对 `makeThreeShot` 与 `camera3` 生效**（它们的相机是现成的现成数据），2D 段不参与 | 同上 §4 ②（对方 `src/engine/rig.js`） |
| ~~1-13~~ | **已完成（2026-10-31）**：参数化转场 —— `wipe` / `iris` / `glitch` / `pixel` / `dissolve` 五种新转场，加上原有的 `push` / `mix` / `none`，共 **8 种模式**，段上写 `transition: '<名字>'` 即可。
六支 shader 独立成 `src/core/transition-frag.js`（共用 `under`/`k`/`dir`/`push`/`blur`/`fadeAt`），`trans.js` 出模式表 `TRANSITION_MODES` + `resolveTransitionMode()`（**写错当场抛并列出可用值**）+ `transitionFadeAt()`；引擎在 `composite()` 里按模式缓存 Pass。
**`push` 的源码与从前逐字符相同**（`test-transition-modes` 与 `test-transition-collision` 各钉一遍）；不写 `transition` = `push` = 逐像素与从前一致。
**踩掉四个不报错的坑**：① `wipe`/`iris` 的掩码写反（`1 - smoothstep` 让旧帧越擦越多，只在 alpha 归零时整体消失）；② 掩码型转场又叠了一层全局淡出 ⇒ 中段发灰；③ `dissolve` 自写 `vnoise()` 撞上 `GLSL_COMMON` 已有的同名函数 ⇒ `function already has a body`；④ 直接 hash 每个像素得到白噪声 ⇒ 屏幕像雪花而不是「被吃掉」，改用 `fbm`。
验证 `tools/test-transition-modes.mjs` **24 项**（两张表无孤儿 / 写错必抛 / 源码不变 / 不重复声明 GLSL_COMMON）+ 夹具 `tasks/_trans-lab`（8 模式 × A→B，`overlap: 1.2`）+ `docs/MOTION.md` §3.6 / `docs/ENGINE.md` §3.7.6 | 2026-10-31 |
| 1-14 | **零状态 GPU 粒子**：位置 = `f(粒子序号, 时间, uniform)` 的纯函数 —— 没有 per-particle 状态、没有 CPU 上传 | 对方 `ProcPoints` 的做法。实现是一个 `Pass` + 用 `gl_VertexID` 索引的点精灵，`setup` 建一次、`render` 只更新 uniform。**天然满足"每帧是 t 的纯函数"**，也不会踩子帧乱序的坑；性能上 CPU 每帧零 per-particle 工作 | 同上（对方 `ch/*/ProcPoints`） |
| 1-15 | **段间引用**：把任意另一段在任意时刻的画面画进当前画面（画中画 / 闪回 / 记忆墙） | 需要一个"按 `id` + `t` 重渲某一段到离屏 RT"的引擎接口，外加递归保护（被引用的段不能再引用回来）。确定性上是安全的（每帧是 t 的纯函数，重画任意时刻本来就是允许的） | 同上 §4 ⑤（对方 `engine.renderShotAt`） |

> 拆解里**不建议照抄**的也记一笔，免得以后又想起来：305 镜 / 0.5 秒一刀（MV 的类型特征，不是我们的信息密度需求）、
> 实时渲染作为交付形态（我方交付 mp4）、音频加密与域校验（版权场景不同）、把构建产物入库（他们有自己的构建管线）。
> 另外**我方不比对方弱**的几条也别丢：确定性纪律（子帧乱序 / 渲染期不写文件 / `hashes` 基线）、镜头骨架封装
> （`makeShot` / `makeThreeShot`）、`world: 'auto'` 的共享背景配方、字幕层的"画面只放标注"分工。

### 1.B 画面 / 验证能力（2026-10-10 拆解三个外部项目之后列的，**按建议顺序**）

> 来源（每个项目一份逐文件证据报告，各条都有 `文件:行号` 或原文引用）：
> [`REFERENCE-video-use.md`](REFERENCE-video-use.md)（browser-use/video-use，MIT，28.5k stars）·
> [`REFERENCE-hyperframes.md`](REFERENCE-hyperframes.md)（heygen-com/hyperframes，Apache-2.0）·
> [`REFERENCE-hypit.md`](REFERENCE-hypit.md)（hypit-ai/hypit，Apache-2.0 with conditions）；
> 三者的横向对比、"为什么这三条撞在一起"以及统一的不建议清单，见
> [`REFERENCE-agent-video-projects.md`](REFERENCE-agent-video-projects.md)。
>
> **拆这三个项目是因为它们各自长出了一层我们缺的东西**，而且三处结论互相印证：
> ①验证要变成"一张图 / 一条断言"而不是"若干张待解读的图"；②作者不该猜秒数；③**空的结果不能算通过**。
> **许可证一律"抄机制不抄代码"**（hypit 还带多租户/再分发/LOGO 三条附加条件，代码不可入 MIT 仓库）。

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| 1-23 | **`variants` 覆写 + `narration.json` 可显式指定**：同一支片子出多个版本（换风格 / 换配色 / 换语言 / 剪短版）<br>**全部完成（2026-10-26）**。三块：<br>① **变体** —— `export const variants = {…}` + `--variant` 深合并（普通对象递归、**数组与原始值整体替换**），产物与分块缓存落 `out/<任务>/<变体>/`（`taskOut()` 统一出口，15 处调用点全部改口）；未知变体名抛错并列出可用的。验证 `tools/test-variants.mjs` 16 项 + 实跑 `still --variant dark`（noir 皮、落 out/_info-lab/dark/）与 `chapters --variant paper`（时间线整体替换成 2 段）。<br>② **钉住时长** —— `anim say --pin-timing`：同 id 且新旁白仍放得下就沿用上一版的 `stretch`/`slot`，时间线逐位不动，只重出改过那句音频；放不下才重解那一段并警告长了多少。验证 `tools/test-pin-timing.mjs` 15 项 + `test-pin-timing-e2e.mjs` 9 项（真跑 CLI + 假驱动）。<br>③ **表可指向另一份** —— `anim say --table <名字>` 把这一轮写到 `audio/<名字>.timing.json` 与`audio/<名字>.narration.json`，**默认那份一个字节不动**；`--pin-table` 钉指定表。表名走字符白名单（防路径穿越）。于是多语言 / 剪短版 / 回放旧表都只是改 `task.config.mjs` 里那行 `narration: './audio/<名字>.narration.json'`。验证：实跑 `say _say-pin-lab --table en` → 默认表 SHA256 未变 + 新表与提示行都在；`tools/test-tasks-meta.mjs` 15 项含接线自检 | 同 §5 Phase 2 |
| 1-24 | **`--parallel` 先说清事实、再决定动不动**：现有两个已知毛病 + 并发度上限 + 收益要重测 | ① 它**静默忽略 `--segments`**（CLI 里 `--parallel` 分支在 `--segments` 之前 return）、只转发 10 个参数（`--idle` / `--force` / `--keep-raw` / `--only` 不生效）—— 这是 1-19 同类的"静默降级"；② 并发度现在硬编码 `2..8`，应按 `min(cpu-2, 内存/3GiB, 段数)` 起算并**默认不开**（对方经验值：**一个 Chrome 按 1.5GiB 预留、只准用一半内存**）；③ **收益必须先量**：NV12 之后实测 4 进程 720 帧 **6.1 fps < 单进程 7.5 fps**（瓶颈在传输与核显争用），所以"多进程"不是免费加速。**可抄的只有它的 `distributeFrameRange`（十行：连续块、可从任意帧开工），不要抄它的调度器** | [`REFERENCE-hypit.md`](REFERENCE-hypit.md) §4.1/§5.3（`ordered-frame-sink.ts` / `concurrency.ts`）· 本地实测见 [`PERF.md`](PERF.md):67–74（"并行渲不同区间：⚠ 历史结论，已不是首选"） |

> **§1.B 里不建议做的**（列出来免得以后又想起来）：镜头包 npm 分发（我们是单仓、11 个模板 —— 先把 1-21 的 spec 写对）、
> 分布式 / 云渲染（我们的瓶颈是 GPU 填充率，搬上 CPU 云只会更慢；分块已经有 `--segments`）、
> GUI 的时间反向求解器（我们的作者读代码，改时间就是改代码）、
> 任何引入生成模型 / 素材目录的机制（会毁掉确定性保证与"不需要素材"的定位）、
> DOM 盒子式的布局审计与超时属性豁免（我们的画面没有盒子；而且**豁免会静默地多关掉几条别的检查** ——
> 我们已有的 `world: false` 是受控豁免，将来加豁免必须写明"这还会关掉什么"）。
> 另外三条**对方比我们弱、不要倒过来学**：DOM 副本式运动模糊（我们是逐子帧物理积分）、
> "允许有累积状态"的 seek 确定性模型（我们是纯函数）、逐词高亮 / 人脸驱动的字幕（与 [`CAPTIONS.md`](CAPTIONS.md) 的实验结论正面冲突）。

### 1.C 素材能力（**还没做，也没有排期** —— 只是想清楚了一半）

| # | 事 | 现在能确定的 | 还不知道的 |
|---|---|---|---|
| 1-30 | **从已有素材里挑片段**（裁切 / 拼接真实视频段，即 B-roll 那一层） | ① 我方的**结构性优势不能弄丢**：现在是"一次编码、无接缝、字幕画在后处理之后、每帧可 seek"；② 真做素材裁切时，"预烘焙视频段拼进成片"必撞的五条硬规则已经拆出来了（字幕必须在滤镜链**最后**、逐段抽帧后无损 `-c copy` 拼、每个接缝补 30ms 音频淡入淡出、overlay 用 `setpts=PTS-STARTPTS+T/TB` 落位、母版字幕按输出时间轴偏移）——我们**已经对了三条**，不会返工；③ 必须先决定**素材段的合成层级**（在 ffmpeg 层拼好当"底"、代码镜头合成上去？还是把素材当引擎里的一张图层？）—— 前者会失去"代码镜头逐帧可 seek"的便利 | 值不值得做（用户目前是"大量可视化的科普/介绍片"，不是实拍剪辑）；观众反馈里到底缺不缺"真实画面" |

> **还没做、也还没排期的一条**：**一条旁白出多语言版本**。现在 `VOICE` 一行换音色、`say`+`mix` 重跑即可；
> 多语言要重写整份 `SCENE` 文案与 `words` —— 先等 **1-23**（`variants` + `narration.json` 可指定）落地再谈，
> 否则会做两遍。

### 1.D 连贯 / 节奏（2026-10-17 拆解外部项目 `onetake` 之后列的，**按性价比排序**）

> 来源：[`REFERENCE-onetake.md`](REFERENCE-onetake.md)（feitangyuan/onetake 的拆解报告，每条都有原文引用）。
> 那个项目的核心资产是**把「像不像 PPT」变成可度量的验收**（边界 carry 分类 + carry score，四个版本 0.00/0.40/0.75/0.83 与人审结论逐版一致）。
> **许可证是 PolyForm Noncommercial：代码、色板字面值一律不抄**，只抄思路、判据、数值口径，用我们的 JS/GLSL 重写。
> 第 1、2 条不引入画面变化（纯增量工具），先做；第 3 条是画面能力，与 1-13（参数化转场）合并推进。

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| ~~1-34~~ | **已完成（2026-10-17）**：`anim carry` 落地 —— 判据/块匹配/汇总在 `src/timeline.js`（`planCarryBoundaries` / `classifyCarry` / `summarizeCarry`），实测 demo 0.50（两个硬切 bare）/ beat 1.00（共享背景 carry），见 §4 | | |
| ~~1-35 前半~~ | **已完成（2026-10-17）**：`check` 的「节奏（静态）」腿（CoV）落地 —— `rhythmStats()` 纯函数，默认只报读数、`--strict` 才进 errs；单段/`--only` 进 skipped。后半（静帧占比）记成 **1-38** | | |
| ~~1-36~~ | **已完成（2026-10-17）**：`src/kit/carry.js` 落地（六个纯函数 + 三个判据常量）+ `tools/test-carry.mjs`（33 项）+ index.js 再导出 + regress-all 登记，见 §4 | | |
| ~~1-37~~ | **夹具半完成（2026-10-17）**：`tasks/_carry-lab/` 落地（六个 carry 函数各一段真画 + rhythm 标定段，**看图验收 9/9 合格**，挂回归 `check:_carry-lab`）。**剩下**：把 stills 升级成「六帧 + 速度曲线」接片图（`anim gallery` / tools 脚本）+ 把速度谱升级成【我方实测】 | 夹具上直接加：每个动作出 6 个时刻（进场景中点前后各三）→ `writeContactSheet` 拼 + 速度曲线（数值微分 hop/morphRect 即可） | 同上 §5（速度谱出处表） |
| ~~1-38~~ | **已完成（2026-10-17）**：`anim rhythm` 量具落地 —— `rhythmSegments()` 纯函数（`src/timeline.js`）+ CLI 子命令（降采样帧差 → 静段区间表）；标定样本 `tasks/_carry-lab` 的 rhythm 段量出 hold 16.50→17.50s。**关键发现**：hold 段必须 `return { grain: 0, dither: 'off' }`（默认 grain 与 dither 种子来自帧号、暗部 sRGB 放大 ~6.4/255，不关就永远量不出死静）——已写进 MOTION.md 与 DIAGNOSIS §1.9c | | 同上 §3 |

### 1.E 参考拆解 EAC design world（2026-10-24，**按性价比排序**）

> 来源：[`REFERENCE-eac-design-world.md`](REFERENCE-eac-design-world.md)（对 `Ebony-Vinyl/EAC-design-world` 的逐文件拆解，
> 钉 `cde9fa6` / v0.5.0）。那个项目和我们是同一件事的两半（它把 HTML/CSS 逐帧 seek，我们把 GLSL 逐帧算），
> **许可证 AGPL-3.0：代码一行不抄**，只借思路、阈值口径与文档格式；它 vendor 的 Shotcraft 配方是 Apache-2.0，可改写。
> 第 1、2 条不引入画面变化（纯工具 / 纯文本），先做；第 3 条动引擎的文字通道，要过 `hashes` 基线。

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| ~~1-39~~ | **已完成（2026-10-24）**：`anim qa <任务>` 成片级技术扫描 —— 解码校验 + `blackdetect` + `freezedetect` + `volumedetect`，纯 ffmpeg（不起 Vite / 不起 Chrome）。判据拆成纯函数在 `scripts/lib/media.mjs`：`parseDetectIntervals()`（含"片尾只有 start"的开口区间）/ `classifyMediaScan()`（片头 0.5s、片尾 1.2s 白名单；静帧 ≥3s 才警；落在黑场里的静帧去重）/ `scanMediaFile()`。默认只报读数、`--strict` 才 gate；`--json` / `--no-decode` 都明说"没验"。验收见 §4 | | |
| ~~1-40~~ | **已完成（2026-10-24）**：`anim subs` 的 ASS 文本转义（`assText()`：反斜杠后插 U+2060、花括号转义、控制字符剔除、换行收成 `\N`）+ `assTime()` 向上取整（顺带修掉 `1.999 → .100` 的三位百分秒坏值）。纯函数导出后由 `tools/test-subs.mjs` 覆盖（含"cmdSubs 真的接了 assText"的接线自检）。验收见 §4 | | |
| ~~1-41~~ | **已完成（2026-10-24）**：`type.write` 的 `blur` 通道（数值=常量 / 数组=随缓动收敛，与 `alpha` 同构；Canvas2D `c.filter`，`blurPx < 0.05` 时**完全不碰 filter**）+ `title` 模板的 `blur` 参数（默认 0）。目视夹具 `tasks/_blur-lab/`（blur 0 / 20 / 20 三段）；`hashes demo` 与 `hashes beat --baseline` 各 11/11 max 0。验收见 §4 | | |
| ~~1-42~~ | **已完成（2026-10-24）**：11 个镜头模板补 `meta.use` / `energy` / `avoid`（`SHOT_ENERGY` 五档），`listShots()` 原样带出、`shotsCatalog()` 进 `--json`、`anim shots` 打印并支持 `--use <词>`（`filterShots()`，匹配面 = 名 / summary / use / energy / avoid）。`tools/test-shots.mjs` 124 → **129 项**。验收见 §4 | | |

### 1.F 个人内容工厂（2026-10-25 定的主线，**按"周末能多出一支"排序**）

> 来源：[HANDOFF-directions.md](HANDOFF-directions.md)（这一轮的方向结论：硬约束 C-1~C-8、现状读数、外部证据、四阶段路线）。
> 判断口径只有两条：**每支片子的边际工时**（现在 3 小时/支，顺利时）与**画面下限**。
> 前三条（1-43 ~ 1-45）解决"等渲染"；1-46 ~ 1-49 解决"劣质感"；其后是复利与选题。

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| ~~1-43~~ | **已完成（2026-10-25）**：`anim queue <任务…> [video 选项…]` 落地 —— 顺序跑（并行实测更慢）、每支结束响一声 / 全部结束响三声（`--silent` 静音）、**某支失败不中断后续**、最后汇总并按失败数给退出码；实测 `queue _calib --from 0 --to 1 --samples 1` 一次跑通，坏任务名报错退出码 1。文档进了 `AGENTS.md` §7 与 `anim help` | **判据（还差一步）**：周末连续两天各用 `queue` 跑两支无人值守，产物 `verify`/`qa` 通过 —— 代码与文档到位，只等真实周末验证 | [同 §5 Phase 1](HANDOFF-directions.md) |
| ~~1-44~~ | **已完成（2026-10-25）**：`--draft` 落地 —— `--scale` 放开到 **0.25..4**（`scripts/anim.mjs` 校验 + `src/app.js` 的 clamp），draft = 半分辨率 + `samples 1`（都可被显式选项覆盖），输出帧就是 960×540。读数（`_calib` 60 帧，`samples=1`）：**13.5 → 33.5 fps = 2.5×**；走 `auto` 的片子差距 8–24×。读数进了 `PERF.md` A1。**判据修正**：没有按原写的"PSNR ≥30dB"验（draft 字看着糊是正常的，本来就是分辨率）—— 改验"输出尺寸正确 + 渲染路径无报错 + 速度提升" | — | 同 §5 Phase 1 |
| ~~1-45~~ | **已完成（2026-10-26）**：块级增量重渲 —— `scripts/lib/blocksig.mjs`（纯函数）+ `renderSegments` 逐块比对签名。签名 = 渲染参数 + **引擎签名**（`src/**` 变了整批失效，保守且正确）+ 这一块**真正跨过**的段的场景文件与段参数（段 id → 源文件靠静态扫 `id:` / `makeShot(` / `shot(`；扫不到记 `?<id>` ⇒ 那块每次重渲）。块的 key 用时间边界，时间线一挪位就不复用。判据实测（`demo` 4 块 / 999 帧 / `--draft`）：全渲 **47s** → 什么都不改 **0.9s** → 只改 `chart.js` **15.3s（只重渲第 2 块）**；参数变仍整批重渲并给出原因（`samples: "1" → "2"`）。验证：`tools/test-block-sig.mjs` **21 项** | 同 §5 Phase 1 · P-3 |
| ~~1-46~~ | **已完成（2026-10-25，W3）**：设计 token 层 —— `src/style/tokens.js` + 新风格包 `flat` + `ctx.style.tokens` 接线；**语义字号**（`size: 'hero'/'h1'/'h2'/'body'/'label'/'mono'`）已接进 `type.write`/`writeLine`/`karaoke`/`wrap`/`paragraph`/`writeOnPath`（`resolveTypeSize()` 纯函数，写错**抛**而不是回落到 64），引擎在 `applyStyleFonts()` 里把**这套风格的** token 下发到每个图层的 `TextKit`。四套风格给了各自的覆盖：blueprint 120 / paper 128 / terminal 112 / noir 152（print 与 flat 吃默认 136）。验证：`tools/test-tokens.mjs` **38 项**（含"拼错必须抛"与"每套风格 6 档齐全"）+ `test-style.mjs` 66 项；样片 `out/_token-lab/styles/{print,blueprint,paper,terminal,flat,noir}/`，接触表 `_sheet.png`。文档：`docs/STYLE.md` §4.1 + `AGENTS.md` §5 一行 | 同 §7 |
| ~~1-47~~ | **已完成（2026-10-25）**：对比图落地 —— 新夹具 `tasks/_token-lab/`（同一份"方波拆成 4 条正弦"内容，两套 token），成品 `out/_token-lab/{before,after}/f_0002.400.png`。实际画的是**傅里叶拆方波**而不是 spectrum 段（公平起见同几何同文案）。**原地踩掉一个引擎坑**：`type.write` 传**数组型** `alpha` 必须配 `t`，否则取 k=0 → 整行隐形（第一版
出处行不出来就这原因）。判断等作者看图；若"一眼更高级"成立 ⇒ 1-46 铺开 | — | 同 §5 Phase 2 |
| ~~1-48~~ | **已完成（2026-10-26）**：**模板 11 → 20**。四批：`bigtype` `scan` `device` `lineart`（第一批）→ `morph` `layers` `lockup`（第二批）→ `timeline` `radial`（收尾批）。原计划（kinetic bumper / device mock / lineart / big-type / scan-grid / countUp / chart-morph / paper-layer / lockup）<br>**第一批已完成（2026-10-26）**：`bigtype` / `scan` / `device` / `lineart`（**11 → 15**）。每个都带 `defaults` + `meta.use/energy/avoid` + `spec` + 整帧背景 Pass；夹具 `tasks/_shots2-lab/`（4 段默认 + 4 段非默认分支）；`tools/test-shots.mjs` **153 项**全绿；`check _shots2-lab` **0 红**（3 条 skipped 是夹具本来就没有的：无交叠段 / 未声明 focus / 无 motion 断言）。<br>**第二批已完成（2026-10-26）**：`morph`（柱 → 折线 → 排线面积）/ `layers`（带透视的分层纸片）/ `lockup`（署名定版）（**15 → 18**）。夹具 `tasks/_shots3-lab/`（3 段默认 + 3 段非默认分支）；`tools/test-shots.mjs` **171 项**全绿；`check _shots3-lab` 完整跑过（三点×双路径）**0 红**，`check _shots2-lab --quick` 也 **0 红**。`kinetic bumper` 与 `countUp` 分别与现有 `kinetic` / `counter` 重合，**不单独立项**。<br>**收尾批已完成（2026-10-26）：`timeline`（横向事件轴）/ `radial`（径向分布）（18 → 20）**。夹具 `tasks/_shots4-lab/`（4 段，含 7 事件与单节点两个边界）；`tools/test-shots.mjs` **183 项**全绿（`typeOk` 补了 `string[]` 档）；`check _shots4-lab` 0 红。**1-48 至此关闭**（11 → 20，目标 20+ 达成） | 做法照第一批：新文件 `src/shots/<名字>.js` → `index.js` 注册 → `tools/test-shots.mjs` 的 `TEMPLATES` 加名字（手写表，多一个少一个都红）→ 夹具加一段默认 + 一段非默认 → `check` + `still` 看图 → 文档里把「15 个」改成新数。**P-8 已定：可以拆 Opus 5.5 案例，只学手法与配方、不抄素材/文案/代码** | 同 §5 Phase 2 |
| ~~1-58~~ | **`anim tasks --json`：片子清单变成机器可读**<br>**已完成（2026-10-26）**：`node scripts/anim.mjs tasks --json` → `{ schema: 'anim.tasks/1', count, tasks: [{ id, title, width, height, fps, scale, style, captions, sceneCount, audio, variants, duration, durationSource }] }`。<br>解析抽成纯函数 `parseTaskMeta()`（离线可测），`duration` 只在有 `audio/timing.json` 时给出、否则 `null` + `durationSource: null`（**不猜**）；`variants` 只列名字，且**变体块里的 style/captions 不许污染任务级字段**（第一版就踩了：`_info-lab` 被读成 noir）。<br>验证：`tools/test-tasks-meta.mjs` 15 项（含真实任务解析、spectrum 的 style/captions/时长）+ 实跑 25 个任务 | — | `REFERENCE-remotion.md` §2① |
| ~~1-59~~ | **配置档任务的按段切片签名（1-45 的后续）**——**已完成（2026-10-26）**：`blocksig.mjs` 新增 `configNodeHashes()`：按 `id: '<id>'` 找到所属对象字面量、括号配平截出这一段源码、取 FNV-1a 哈希；`sceneFileIndex()` 顺带产出 `configHashes`（键是 `文件#id`），`blockSignature()` 优先用它，截不出来就退回整文件 mtime（保守）。<br>**实测收益**（`video --draft --samples 1 --segments 8`，12 块）：改一段 footer ⇒ 之前 **10 块重渲**、现在 **1 块**；什么都不改 ⇒ **12/12 跳过**（4.4s 出片）。<br>**踩到的坑**：判「id 是否落在字符串里」第一版只数单引号，`sub: "id: 'fake'"` 会漏 ⇒ 现在单双引号一起数。<br>验证：`tools/test-block-sig.mjs` **31 项**（新增 10 项：切片命中 / 嵌套对象 / 字符串里的 id 不误切 /只有改动段的签名变 / 截不出退回 stat） | — | `scripts/lib/blocksig.mjs`；1-45 的判据 |
| ~~1-60~~ | **`analyze` 的 bpm 估计偏 4%（已修，2026-10-28）**：合成床名义 80bpm，分析器报 **83.3**（首拍还偏 50ms），于是所有「踩拍」画面的时间轴整体偏移。三处病灶：① `lag = Math.round(period*fps)` 把周期量化到整帧；② 自相关乘了「偏好 120bpm」的高斯（中心 120 / σ55）——**先验偏置**；③ 打分只用全带起音包络，半拍踩镲让 2× 网格（把半拍当一拍）永远满分。<br>**改法**：自相关改**分数延迟**并去掉先验；精修改成「按强度加权的格点精确率 × 召回（调和平均）」，且**锚在底鼓序列**上（低音才是拍子，踩镲不是）；倍频歧义由数据裁决。<br>**实测**：nekohome **80.0**（原 83.3）· spectrum **72.0** · beat（合成 120）**120.0**；卡点复测 nekohome **9/9** 在 ±30ms（残差 0ms）。<br>回归：`tools/test-tempo.mjs` **11 项**（合成鼓 80/96/120/140 偏差 ≤0.08%；半拍踩镲诱饵不再把拍长认成半拍；**拍网格置信度** 合成鼓 0.85–0.95 / 噪声 0.30）<br>**配套两条**（同日）：① `analysis.json` 多了 `tempo: { score, precision, recall }` —— 软失败可判（bpm 有值 ≠ 可信）；`check` 在 score < 75% 时提醒、`--strict` 进 errs。② `tools/lint-beat-align.mjs`（**卡点检测**）接进 `check`：切点对不上拍会 warn，`--strict` 下硬门是 **≥90%**（初版工具曾把 spectrum 判成 3/6、59ms —— **那是尺子不准**：起音按 10ms 帧量、周期只到 ±0.5%，33 秒就漂 200ms。加**最小二乘精修**后三支片子全部 9/9、9/9、6/6，残差 ≤3ms；没有任何已交付片子真的错位） | — | `src/core/audio-analysis.js`；`tools/lint-beat-align.mjs` |
| ~~1-61~~ | **「事件密度」守门（2026-10-28）**：片子可以零报错、`qa` 全绿，但**观众第 8 秒就走人**——这类失败原来一条读数都看不见。新增 `tools/lint-event-density.mjs`：解码 4fps/480×270 灰度算帧间差，报「**最长静止跨度**」与「**稀薄窗口占比**」（低于均值一半的 2 秒窗口），判据 3.5s / 25%，接进 `check`（没有成片时只 skipped）。<br>**实测 `nekohome-intro-ja`**：最长静止 **4.0s → 3.3s**（已达标）· 稀薄窗口 **44% → 39%**（仍超 25%；下一步靠缩短片长，而不是继续堆动效）。<br>同轮做的画面改动：① 片头改「钩子式」（先给头像+一句反差，3.2s 才出片名）；② 角色卡素材位加下扫线+角标呼吸；③ tsundere 两块素材位各加下扫线；④ log 卡加横扫高光、进度条按整段走；⑤ 片名段加矢量排线。教训：**2px 游标、0.09 alpha 的文字水印，检测器和人眼都看不见** —— 要动就得给足像素面积。 | — | `tools/lint-event-density.mjs`、`tasks/nekohome-intro-ja/scenes/cards.js` |
| 1-62 | **选型引擎：`tags` / `w` / `fits` + 确定性抽签（2026-10-30 完成，学 JIZURA 的"部件表"）**：每个模板自报四件选型元数据（`tags` 封闭词表 `SHOT_TAGS` / `w` 抽取权重 0.4 冷门–1.5 主力 / `fits(q)` 适用条件，brief 见 `pick.js` 头注释 / `fitsNote` 人话版）；新文件 `src/shots/pick.js` 的 `pickShot` / `pickSequence` / `eligibleShots` = **先按条件筛、再按权重抽、seed 决定抽到谁**（同查询+同 seed 永远同结果；换 seed = 重抽一版；`exclude` = 只换这一项；抽一串版内不重复）。角色锁由各模板自己的 fits 组合子自带（`contentOk`/`endingOnly`/`transitionOnly`/`musicOk`：outro/lockup 只进 `slot:'ending'`，whip 只进 `slot:'transition'`，不指明槽就抽不到）。CLI：`anim shots --pick --slot content --tags data --points 5 --seed 7`（`--n` 抽一串 / `--music` `--no-music` `--shot` `--no-shot` / `--exclude` / `--json` schema `anim.shots.pick/1`；拼错 slot/tags 点名词表；筛空抛错并说清是哪一步筛空的）。**顺带的登记收敛**：`SHOTS` 改由 `REGISTRY` 单表派生（键=各工厂自报 `meta.name`），删掉 23 个没人外部 import 的具名导出——加模板=加一行 import+数组塞一行；**没有**用 `import.meta.glob`：CLI（裸 Node）与浏览器（Vite）共用这份登记，glob 是 Vite 专属 API，为省一行 import 引入双环境分叉不值（`SHOT_ENERGY` 迁到 pick.js、index.js 转发，老读者不受影响）。`shots --json` 载海新增 `tags`/`w`/`fitsNote`（函数本体不进 JSON）；`filterShots` 匹配面加 tags；**不带 `--pick` 的人读输出一个字没变**。<br>**验证**：`tools/test-shot-pick.mjs` **36 项**（合成池密闭单测 + 真库 200-seed 端到端）+ `tools/test-shots.mjs` §2.6 **207 项全绿**；timeline-audit / block-sig / timeline-guard / gates-meta / info / variants 六个老回归全过 | 判据：同 seed 同结果；无 slot 时角色锁 0 泄漏（200 seed）；60 seed 两候选都出现、200 seed 重权显著多抽；筛空诊断点名"哪一步筛空的"；`anim shots` 人读输出与改动前逐字节一致 | [`docs/REFERENCE-jizura.md`](REFERENCE-jizura.md) §2/§3/§6；契约在 [`docs/ENGINE.md`](ENGINE.md) §14.10 |
| ~~1-70~~ | **填充面：`fillPoly` / `fillCircle` / `fillSector`** —— 引擎的矢量层只会画线段，`fillRect` 是「一行行矩形」，圆 / 山体 / 扇区只能描边逼近。这是 23 个模板看起来都是「线 + 矩形」的**图元原因**（不是审美选择）；素材包 A–G 26 条参考实现里 **11 条**要 `beginPath + arc + fill`。**已完成（2026-10-30）**：`src/core/fill.js`（扫描线数学：偶奇规则带洞 / 圆按行 sqrt / 扇区按角度二分裁剪，纯函数可离线测）+ `LineBatch` 三个方法（`fillPoly` / `fillCircle` / `fillSector`）+ kit 转发。**踩掉一个真 bug**：扇区第一版在「这一行两端都在角度区间外、但中间在区间内」时直接返回整行 —— 饼图里被裁的那几行整行涂黑（缺口），且在深色底片上「看着像设计」。修法是把这一支也做成两次二分。**另一个坑**：`clipArc` 里不能用 `cos(a)*outer` 反推 x（正确半径是 `sqrt(outer²+d²)`），否则饼图被压成花瓣。验证：`tools/test-fill.mjs` **39 项**（含**角度方向断言** —— 0=右 / π/2=下 / π=左 / 3π/2=上，写反画面照样出）+ 独立稠密采样对拍（圆 / 扇环 / 扇形 / 带洞矩形，结构 0 不一致、端点差 = 步长）+ 夹具 `tasks/_fill-lab`（一屏六种面，`check` 0 红，`hashes` 3/3 一致）。文档 `docs/COOKBOOK.md` §17 | 判据来自用户提供的 341 条风格素材包（`docs/REFERENCE-style-pack.md`）；对应条目：A5 / B2 / B3 / C1 / E1 / E2 / D4 / C3 | **⚠ 编号由 1-62 改为 1-70**（PR 的「选型引擎」也占 1-62；它的分支基点早于本轮提交 ⇒ 不知道已被占用，而那边在代码 / 文档里有 40+ 处引用，所以这边让号）。
| ~~1-66~~ | **已完成（2026-10-31）**：**剪纸 / 纸艺层叠** —— `src/kit/paper.js`（`tornEdge` / `paperShape` / `paperFace` / `paperStack` / `paperGrain` / `shadowColor` / `coreColorOf` / `translateShape`），覆盖素材包 **20 条**（E2 K20 K21 K22 L24 L26 L27 L37 M12 O17 O41 O57 O67 O73 O94 Z5 Z6 Z7 Z8 Z11），是 `REFERENCE-style-pack-capability.md` §3 缺口表里复用度最高的一项（★★★★☆）。
**一张纸要像纸只有三件事**，缺一件就退化成「彩色多边形」：硬投影（不透明、由纸色乘暗 —— 半透明黑会在扫描行之间出条纹）/ 分形撕边 + 白芯 / 纸色纤维。
**踩掉三个只有出图才看得见的比例**（现在都是硬断言）：① 撕边幅度 = **边长 × 1.5–3%**（12px 在 2040px 的纸上缩略图里就是直线）；② 撕边**采样密度必须跟边长走**（默认 40 点 ⇒ 每 51px 才一个点，小尺度毛刺被 `fillPoly` 的折线抹平 —— 出图放大才看出来）；③ 白芯只浅 **7%**（35% ⇒ 雪白高光带，读起来像贴纸白边）。
第② 条是这轮最值钱的发现：**几何本身是对的，是采样把细节吃掉了**，而 `check` 三点采样永远绕得过去。
验证 `tools/test-paper.mjs` **24 项** + 夹具 `tasks/_paper-lab` + 文档 `docs/MOTION.md` §3.7 / `docs/COOKBOOK.md` §18 / AGENTS §3.5 一行 | 2026-10-31 |
| ~~1-67~~ | **已完成（2026-10-31）**：**像素精灵 / 调色板量化 / 5x7 像素字** —— `src/kit/pixel.js`（`paletteOf` 五张调色板 / `ditherQuantize` Bayer 抖动量化 / `SPRITES` 内建精灵 / `pixelText` 点阵字 / `snapTime` 12fps 台阶 / `pixelGradient` 抖动渐变）+ 镜头模板 `shot('pixel')`（自带整帧：抖出来的天空、地面、精灵队列、边框，最后瓦片压栅格），覆盖素材包 **7 条**（K28 L49 L51 O77 R5 V13 X13），是 `REFERENCE-style-pack-capability.md` §3 缺口表第 9 行。<br>**真像素艺术是四条硬约束**，缺一条就只是「糊了」：调色板（4–8 色）/ 块（一切落在同一栅格）/ **有序抖动**（Bayer，不是渐变）/ **12fps 台阶**（不是 60fps 平滑）。<br>**踩掉五个只有出图才看得见的**（现在都有单测或注释钉着）：① **压栅格必须块内平均** —— `texture(src, vUv)` 在 8:1 下是点采样，一格取一个像素 ⇒ 块随机跳变、中文标题被打成碎片；② **读回是自下而上的** —— 不翻 y 整个画面上下颠倒（机器人跑到天花板上）；③ **天空只跨两档色** —— 跨 3/4 张色表就成一道彩虹；④ **文字画在压栅格之后**，且最后那次 `post.pixel` 取**半格**（CJK 笔画 ≈ 字号/10，整格会把笔画整根吃掉）；⑤ **两级栅格相位必须相同**（后处理取 0.5× 时与瓦片相位差出摩尔纹）。<br>验证 `tools/test-pixel.mjs` **45 项**（抖动阈值按块坐标 / 量化只在最近两色 / 覆盖率随距离单调 / 胶囊端点内缩半格 / 字模表每项恰好 7 行 × 5 列 / 名字写错必抛）+ 模板 `shot('pixel')` + 夹具 `tasks/_pixel-lab`（4 段：四阶绿 / 八色 / 一比特 / 琥珀，`check` 0 红）+ 文档 `docs/COOKBOOK.md` §19 / AGENTS §3.5 一行 | 2026-10-31 |
| ~~1-68~~ | **已完成（2026-10-31）**：**多方向排线（木刻 / 铜版）** —— `src/kit/views.js` 的第 9 种成像 `woodcut`：按明暗**加方向**（亮部一道线 / 中间调交叉两道 / 暗部再叠第三道，每层更细），线沿长度方向有断口。覆盖素材包 **5 条**（L30 L31 O3 O10 Z10），是缺口表第 10 行。<br>**与 `engrave` 的差别是这件事的全部意义**：`engrave` 只有一个方向，明暗全靠线宽 ⇒ 暗部只能加粗到粘成一片实黑，读起来是「阴影」不是「刻痕」。<br>**五条纪律，每条都是出图之后补的**：① 每层更细（否则三层立刻饱和成实黑）；② 层边界要抖（硬切会在中间调出一块块补丁）；③ 断线**段要长**（3 格一段出图是一排点划线）；④ 明暗取 **24 点黄金角螺旋**局部平均（网格采样会与底图自带的周期拍频，整屏水波纹）；⑤ **线距 ≥ 22px**（12px 时 45° 线的周期投影 8.5px 与 `fillRect` 行距凑成近整数比 ⇒ 整屏很宽的次谐波横带，看着像「油墨没推开」）。低于 22 会被**夹住并写 warning**（`WOODCUT_MIN_CELL`）。<br>第 ④⑤ 条可推广成一句：**任何「按亮度重新画线」的介质，都要问「我的采样尺度比底图最小特征大吗、我的周期与底图周期成整数比吗」** —— 两个答案只要有一个是「不」，出图就是一层人造纹理，而 `check` 的三点采样永远绕得过去。<br>验证 `tools/test-woodcut.mjs` **14 项**（五条纪律的常数 + 下限保护 + 与 engrave 是两个分支 + 两份夹具配置语义逐字相同 + 文档接线）+ 夹具 `tasks/_hatch-lab`（多方向）/ `_hatch-lab-eng`（单方向对照，两份时间线逐字相同）+ 文档 `docs/COOKBOOK.md` §16.4 / AGENTS §3.5 一行 | 2026-10-31 |
| ~~1-69~~ | **已完成（2026-10-31 晚）**：**手绘笔迹** —— `src/kit/stroke.js`（`catmullRom` / `resampleByLength` / `pressureEnvelope` / `pressureProfile` / `strokeRing` / `revealSamples` / `boilSamples` / `inkOn` / `drawStroke` / `drawStrokeChain` / `strokeArc`）+ 镜头模板 `shot('handwrite')`（白板 / 纸感笔记两种介质）。覆盖素材包 **17 条**（K3 K8 K9 K10 K11 L17 L22 M1 M2 X1 X3 X7 X18 X23 X29 Z12 Z14），是缺口表第 6 行。<br>**这一层的全部信息量在「宽度沿弧长的分布」**：落笔细 → 行笔粗 → 收笔细。`lines.polyline` 是等宽描边、`boil.js` 只是「手不稳」—— 两者都拿不出笔压，所以「一笔一笔真的写出来」这件事以前做不出来。<br>**最贵的一课是几何的，不是数值的**：轮廓法（中心线 ± 半宽 → 多边形 → `fillPoly`）**只在曲率半径 ≥ 半宽时合法**。曲率半径比半宽小的地方（拐得比笔还粗的弯、两端圆头相接处）上下两条偏移边**必然相交**，而 `fillPoly` 是偶奇规则 ⇒ 自交区被算成「外面」⇒ 笔画中间出现一个**针孔**（8 倍放大是一个白点，全屏看像「纸上有水渍」）。**夹斜率夹不住它**（自交来自曲率、不来自宽度跳变；实测一条直角折返路径 width=6 就已经 1 处自交）。解法是换画法：`drawStroke` 的 auto 用 `canFillOutline()` 判，急弯自动退到**胶囊链**，且每段端点沿切向**外扩半个局部线宽**（不外扩时拐角处的内切缝会露白点，ratio 0.5 → 0.35 才补掉）。<br>另外三条（出图才看得见）：② 笔迹**不许半透明**（扫描行的抗锯齿边会叠加出横向细纹）⇒ `inkOn()` 先与纸色混合再整块不透明地画；③ 两端宽度趋近 0 时 `fillPoly` 的扫描行会**穿透**（出图是一串虚线点）⇒ `minW` 1.2 是物理下限；④ 端点圆头必须用**这一端自己的半宽**（用平均值会在收笔处鼓一个「墨滴」）。<br>验证 `tools/test-stroke.mjs` **21 项**（几何断言，不是源码字符串：等距重采样 / 包络单调 / 双向斜率夹 / 圆头探出半宽且用本端宽度 / 曲率半径 < 半宽 ⇒ 判成不可填且轮廓确实自交 / auto 在直笔迹画一次 `fillPoly`、急弯走胶囊链 / 弧长截断的笔尖是插值出来的）+ 模板 `shot('handwrite')` + 夹具 `tasks/_handwrite-lab`（4 段：白板 / 纸感 / 换种子 / boil 0）+ 文档 `docs/COOKBOOK.md` §20 / AGENTS §3.5 一行 | 2026-10-31 晚 |
| 1-49 | **母题库**：`sodium` 积木 / `spectrum` 波形格阵 / `bikeshed` 会议室 抽进 `src/kit/motifs/` | 抽完之后 `beast`/`fidus`/`nekohome` 三份私有 `_kit.js` 可删；画面变化用 `hashes --accept --note` 记录 | 同 §5 Phase 2 |
| ~~1-50~~ | **已完成（2026-10-26）**：`src/kit/info.js` 的 `infoShot(id, { title, kicker, caption, source, foot, draw })` —— 眉标/标题/面板底/侧标注/出处行/页脚/四段错峰全包，用户只写 `draw(ctx, rect)`。<br>**顺带修了一个真分叉**：`timeline.js` 的 build 只搬 `cut()` 的 focus、不回落 `scene.focus` ⇒ 引擎渲染知道主体、`anim check` 的版面守门却说「没声明」（infoShot 的场景级 focus 就栽在这）。补 `?? scene?.focus` 后两条路径同源。<br>验证：`tools/test-info.mjs` **11 项**（挂 `regress-all` 的 `unit:info`）+ 夹具 `tasks/_info-lab`（3 段：默认 / 画柱 / noFocus+全空字段）`check` **0 红**（18 帧 × 3 点 × 双路径 6.3s；bare 的「主体未声明」是刻意豁免路径的预期读数）。<br>**判据数字**：夹具三个信息段共 69 行（每个 `draw` 平均 ~15 行），对照 promo 1529 / spectrum 767 / pdoom-lab 1187 行每支 —— 信息段这一类的手写占比压到 <30% 成立 | 后续不在本条：`rect` 几何按 1920×1080 基准近似（竖屏要 `noFocus: true` 自己声明）；infoShot 尚未接旁白 cue（`dur: { vo }` 配合跟 1-23 一起做更顺） | 同 §5 Phase 3 |
| ~~1-51~~ | **已完成（2026-10-26）**：`tools/test-gates-meta.mjs`（**37 项**，挂 `regress-all` 的 `meta:gates`）。每一节都是同一骨架：**注入缺陷 ⇒ 必须报**（红证明）+ **去掉缺陷 ⇒ 不许报**（对照组，防"夹具本身永远报"）。覆盖：版面三条（blocks / in-focus / off-subject，含"没声明 focus ⇒ 不判"）、背景守门（missing / blackTail）、采样四个出口（tol / cap / stall / **NaN 不许被当成收敛**）、误差量具（全 0 直方图 ⇒ 0，正是那个 bug 的形状）、节奏节拍器（等长 ⇒ metronome）。文末一张**覆盖表**列出每个判据的"红证明在哪"，并**点名已知缺口**（`lint-narration-dup` 没有纯 JS 红证明）。实测踩到的三处夹具坑都写进注释：块要靠行距拉开才不被 `textGroups` 合并、`offSubject` 不数第一个"看的地方"（maxOffSubject=2 要 4 块才越线）、`blackTail` 读的是**第二条**样本 | 同 §5 Phase 3 |
| ~~1-52~~ | **已完成（2026-10-26，W4–W5）**：竖屏 1080×1920 落地 —— `GRID_PORTRAIT`（1080×1920 基准：`pad 88` / 字幕带 `[1180,1344]` / `contentBottom 1112` / `footerY 1622`）+ `fitStyleToFrame()` 在 `H > W` 时换栅格与字号（**按短边 = 宽**缩放，`× W/1080`，不是按高）；字号阶梯 ×1.35（`PORTRAIT_TYPE_SCALE`，语义字号自动跟随）；字幕改竖屏参数（`size ×1.35` / 每行 12 字 / `position: 'bottom'`）；`bands()` 的字幕保留带在竖屏按 84% 内容宽算（否则冲突判成假阴性）。**判据没有放宽** —— 实测 `check _portrait-lab` 一屏最多 4 块（上限 6）、主体区 0 块字（主体是图形）、两条路径一致；第一版夹具触发过两次都是**画面该改**（三个读数合并成一行 / 读数别写在字幕带上沿）。验证：`tools/test-portrait.mjs` **39 项**（含"横屏原样返回同一个对象"）+ 夹具 `tasks/_portrait-lab/`（1080×1920 + 字幕）。文档：`docs/LAYOUT.md` §6.5、`docs/STYLE.md` §4.1 | 同 §8 |
| ~~1-53~~ | **已完成（2026-10-26）**：`anim cover <任务> -t <秒> --title … --sub …` + `anim chapters <任务> [--min 4] [--json]`。<br>**封面**：页面侧 `__anim.cover()` 渲染那一帧后，在 Canvas2D 上压「底部渐变蒙版 → 主标题（超宽自动缩到 78%→）信号色短线→副标」；字用**引擎那套字体**（Noto Sans SC / Archivo / Plex Mono），与成片的字同源 —— 不用 ffmpeg drawtext 另找一份。`--scale 2` 出 4K 且文件名带 `@2x`（不覆盖 1080p 那张）。实测：1080p 17.9% 亮像素落在标题带、副标 17.5%（>0.25 阈值，信号色亮度 0.43）；4K 封面 3840×2160。<br>**章节**：纯函数 `planChapters()`（首段必是 00:00 / 短于 `--min` 的段并进上一章 / 起点取段自己的 start）→ `mm:ss 段名`，写 `out/<任务>/chapters.txt`；`--json` 机器可读。验证 `tools/test-cover-chapters.mjs` **18 项**（挂 `regress-all` 的 `unit:cover`）。<br>踩到的两处：`opt('json')` 取的是值不是开关（要用 `flag()`）；4K 与 1080p 默认同名会互相覆盖 | — | 同 §5 Phase 3 |
| ~~1-54~~ | **已完成（2026-10-25）**：`tasks/_ideas.md` 落地（🟡候选 / 🔵在做 / 🟢已发 三档 + 一行一条的格式 + "池子少于 3 条就该补"）。判据仍是**连续 4 个周末选题环节 ≤5 分钟** —— 文件到位，效果要等 4 周后回看 | — | 同 §5 Phase 4 |
| ~~1-55~~ | **已完成（2026-10-25）**：`docs/SCENE-BRIEF-TEMPLATE.md` **新增 §11「选题 → brief」** —— 可复制的指令（七块产出）+ 四条判据（无编造数字 / 视觉主角一个名词 / "要新写" ≤2 段 / anti-list ≥3 条）+ 与 §4/§5/§7/§8/§10 的对应表。作者的动作只剩"抽一行 + 审一份 brief" | 前提是模型弱（DeepSeek v4.1-flash / GLM-5.3）—— brief 越像规格书，出片越稳（Opus 案例的共识）。判据：一份 brief 直接喂给场景 agent，作者不需补结构性信息 | 同 §5 Phase 4 |

| 1-56 | **绿幕 / 透明导出**（2026-10-26 从 `REFERENCE-jizura.md` 拆出，**不排期**）：`video --alpha` 背景层出纯色、文字层单独出一条，后期合成用 | 判据：两条轨帧数与主片一致（ffprobe 复核）；`qtrle` 或 PNG 序列两种可选。对"一个人做片子"收益中等，先登记 | [`docs/REFERENCE-jizura.md`](REFERENCE-jizura.md) §4 |
| ~~1-57~~ | **已完成（2026-10-26）**：字幕断行质量 —— `src/core/cjk.js` 的 `breakCaption()`（纯函数）：**行首禁则**（`，。、）」` 挂到上一行末尾）、**行尾禁则**（`「（` 推到下一行）、**不拆词**（`24fps`/`v0.9.0` 算一个单元）、**两行平衡**（不再 15+1 孤儿行）、**超长句不丢字**（缩字号 ×0.86 → 仍不行就多给一行 + `console.warn` 一次；旧实现 `rows.slice(0, maxLines)` 会静默吃掉后半句）。验证 `tools/test-cjk.mjs` **28 项**（含 `rows.join("") === 原文` 这条硬断言）；默认行为，无需配置，`maxCharsPerLine/maxLines` 照旧生效。文档 `docs/CAPTIONS.md` §3.5 | 同 §5 Phase 3 |
---

## 2. 内容 / 片子

| # | 事 | 说明 | 出处 |
|---|---|---|---|
| ~~2-1~~ | **已完成（2026-10-18）**：一支真成片（本地任务，名称略）—— 8 段 / 193.5 秒 / Three.js 真网格会议室（4 段共用一台 `camAt(t)`）+ 四个 2D 镜头；它同时就是 2-1 的 Three.js 落地点。**（原始条目留档）** 开拍时先照 `tasks/_three-lab/scenes/_stage.js` 把"舞台"钉死再填内容 | [`STATUS.md` §19.7](STATUS.md) · [`THREE.md`](THREE.md) |

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

这些在旧文档里被写成"没做"，后来都做掉了 —— 列在这里是为了不再被重新提起：

| 事 | 哪一轮做的 |
|---|---|
| B 档「配置档」（时间线里直接写 `{ type: 'chart', … }`） | 第八轮，[`history/STATUS-rounds-7-10.md` §15](history/STATUS-rounds-7-10.md)（§14.6 里还写着"这是路线图的下一步"） |
| `src/kit/blocks.js`（3D 线段 + 深度排序 + `facesToward` + 盒子/排线 + 连续摄影机 + 世界切片） | 第四轮 §4 A，已落地 |
| `src/kit/panel.js`（2D 面板层：`panel` / `tile` / `chips` / `arrowH` / `bufBox`） | 同上 §4 B，已落地 |
| 摄影机关键帧支持**按段名 + 段内秒**（`{ id: 'ctm', at: 3.0, … }`） | 同上 §4 C，已落地（`src/kit/blocks.js`） |
| "**alpha 管在不在，tone 管亮不亮**"写进 COOKBOOK | 同上 §4 E → [`COOKBOOK.md` §2.5](COOKBOOK.md) |
| `docs/SCENE-BRIEF-TEMPLATE.md` 成文 | 同上 §6 → 已成文（其 §5 原为"本片必须与上一支不同的三项"；2026-10-17 用户拍板降为"风格对照表，同味风险是提示不是门"） |
| "用 `anim say` 真做一支带旁白的片子" | `beast` / `sodium` / `optifine` 三支都用了 `anim say`（§13.4.8 写这条时还没有样本） |
| 整份 `regress-all` 没跑 | 已跑：**32/32 通过**（`node tools/regress-all.mjs`，约 12 分钟） |
| `--segments` 收尾截掉视频尾巴（`-shortest`） | 第四轮 §1 已修并验证，同源两处（`renderParallel` / `renderToFile`）也补了 `-af apad` |
| 导入模型 `.glb` / `.gltf` | **用户明确说不需要**（几何全部程序化）；将来要加不用返工（`setup(ctx)` 本来就是异步的） |
| `anim say` 标点对齐判据收窄（只差标点不再报警，漏**实义**字符才报） | **第九轮**（2026-10-10，`839d0b1`）：判据从"跳过字符数 > 0"改成"跳过**实义**字符"；90 句真实旁白 **90/90 → 0/90** 命中，三条契约（拼回原文 / 真时间戳 / 不退化近似）仍 90/90；注入真异常时恰好那 1 句报出 |
| `check` 的「空 ≠ 干净」（`skipped:`）+ 产物守门按「已知原因 / 原因未知」分档措辞 | **第九轮**（`9693291` `afccab1` `5432cf6`）：5 个"没跑成"的落点一律进 `skipped:`（按 `what` 聚合 ×N），结论行永远带"另有 N 项没跑"；`--strict` 才把它变成非零（**默认不改退出码**）。离线单测固化在 `tools/test-check-skipped.mjs`（24 项，含**静态接线自检**） |
| 音频响度数字守门（LUFS / true peak / LRA） | **第九轮**（`ca53061` 库 + `099eec3` 接线）：`measureLoudness` / `assessLoudness` / `formatLoudness` 在 `scripts/lib/media.mjs`；`anim check`（对 `packaging` 轨）与 `anim mix` 各报一次，靶子 **-14 LUFS / -1 dBTP**。**只报数字，不 gate、不自动归一化**（归一化 = 所有带旁白片子重出）。量具 `tools/test-loudness.mjs`（34 项）；实测 `sodium-mix.mp3` = **-20.9 LUFS / -2.96 dBTP / LRA 8.3** |
| `tools/sheet-audio.mjs`：接触表 + 波形 + 静音带 + **旁白词级标签** + 时间标尺叠进同一张 PNG | **第九轮**（`314c290` `33f2754`）：**不重新渲染**（从已有成片 mp4 抽帧，不起 Vite / Chrome），横轴共用同一时间窗。sodium 实测 `out/sodium/sheet-audio_0-12_vo.png`：22/28 词标签画出、揭晓落在 8.80–9.60s（与设计 `cue × stretch = 9.557s` 对得上）。边界：**只在决策点调用，不拿它当扫描工具** |
| `docs/DIAGNOSIS.md`（输出词 → 含义 → 修法 三列表） | **第九轮**（`64b85cd` `fea8566` `e919a7a`）：211 行三列表；词全部 grep 自代码，每条带 `文件:行号` + 函数名；另有 §2 退出码语义、§3「空 ≠ 干净」的读法、§5 已知分叉。`AGENTS.md` §8 / §10 各加一行链接，§10 清单补了判据型命令与 `--quick` / `--strict` |
| `anim shots --json`（机器可读的模板参数表）+ `anim note`（`NOTES.json` 评论文件） | **第九轮**（`a5f9a37` `2fb8e7a` `002e7ec`）：schema `anim.shots/1`，字段契约在 `ENGINE.md` §14.9（**它是 1-21 的输入契约**，`requires` / `outputs` 的位置已留好）；`anim note` 读写 `out/<任务>/NOTES.json`，`anim clean` **绝不删它** |
| 出片路径也能发现非有限值（1-4） | **第九轮**（`0773383`）：扫描挂在**页面侧**（出片推的是 NV12，帧里已无浮点信息），扫那一帧自己的 float RT、**不额外渲一帧**，走既有 `diag` 文本通道上报（**不参与帧计数**）。一次扫描 40ms、**默认每 30 帧一次（实测 +0.35%）**——`engine.js` 那句"只给诊断用、不进每帧渲染路径"被数字推翻：不进每帧，但每 30 帧便宜到可以默认开。`--scan-nf 0` 关、`--nf-stop` 扫到就停（默认只报告不中断）。顺手修掉：提前收工后在途帧写已 `end()` 的 stdin 会**崩进程**（`ERR_STREAM_WRITE_AFTER_END`） |
| `anim say` 的批量容错：失败也继续、最后统一补跑（1-6） | **第九轮**（`71a39cb` `e4e1f70`）：失败不抛 → 记 pending → 整批跑完后统一补跑（最多 2 轮、每轮隔 2s）；失败句**不写表**（0 时长混进去会让 slot 静默算错）。顺手修了两个真 bug：重试额度不是"每句"的（报告说 3 次、实际给 5 次）、偶发 `--write-words` 失败会**永久**关掉后面所有句的词级时间戳。`test-say.mjs` 78/78 |
| 配置档 `post` / `world` / `maxSamples` 的首个真实用例（1-9） | **第九轮**（`72d68dd` `8cb1e1b`）：新夹具 `tasks/_config-lab/`（只有 `task.config.mjs`，30.70s / 5 段）。实测出三个字段各自的坑（**模板 `render()` 返回的 post 会盖掉同名的键**、`world: false` 不进守门表、`maxSamples` 只往下压且合法档只有 8·3ⁿ）与**守门口径不齐**（见头部 ①）。`docs/CONFIG-ONLY.md` 新增 §3.1 |
| raymarch vs 投影线段批的同段成本对照（1-10） | **第九轮**（`f5f4865`）：走廊段实测 **raymarch 0.83 fps vs 线段批 1.26 fps = 1.52×**（整片口径只有 1.07×，因为那段只占 23%）。⚠ 同时记了**画面差异**：raymarch 有软阴影 / AO / 雕刻排线，线段批是纯线框 —— 便宜的那版是**少给了这些**。数据在 `docs/PERF.md` §6 |
| 镜头模板的声明式 spec + `check` 依赖前置校验（1-21） | **第九轮**（`de22220` `9ed47a6` `7ad2b4d` `537fd92` `abe393e`）：8 个模板各带 `requires` / `outputs`；`anim shots --json` 长出 `requireTokens` / `requires` / `outputs`（schema 仍是 `anim.shots/1`，只加字段）。`check` 在 `openSession` **之前**静态校验：模板要 `music` 而任务没配 `audio` ⇒ **errs**（退出码 1）；配了没跑 `analyze` ⇒ **skipped**（提示）。`test-shots.mjs` 106 项。⚠ `under` 令牌未接线（见头部 ②） |
| **第九轮头部记的 9 条 + 1-5（第十轮全部收掉）** | **第十轮（2026-10-16）**，逐条： |
| ① 背景守门口径与引擎不齐 | 守门与段级审计都读 `it.handlesTransition ?? 场景那份`；`anim audit _config-lab` 实测由 `handlesTransition=n` 变 **`=Y`**（`src/app.js` 的 `worldAudit()`） |
| ② `under` 令牌只声明、没接线 | `shot()` 把模板的 `spec.requires` **搬到场景对象**（`src/shots/index.js`）→ 纯函数 `auditUnderRequires()`（`src/timeline.js`）→ 页面侧 `__anim.underAudit()` → `check` / `anim audit` 打印并分档：**没有交叠 ⇒ errs**（画面几乎是黑的且不报错）、**第 1 段 / `--only` ⇒ skipped**（明说「没判」）、交叠了但没声明 `handlesTransition` ⇒ 一行提醒。离线判据 `tools/test-timeline-audit.mjs`（26 项，含接线自检） |
| ③ 「算出来的数字」判不出来 | `tools/lint-fabricated-numbers.mjs` 新增**判据 ③**：模板串插值 / 字符串拼接 / `String()` / `.padStart()` / `.toFixed()` / `values` 里的变量，**单列一段并明说「没验」**（0 处也打一行）；**退出码语义不变**（不进 `unmatched`）；`--json` 长出 `tasks[].computed` / `skippedComputed` / `summary.computed`。真任务实测 **38 处**；自测 139 → **183 项**；夹具 `tools/fixtures/lint-numbers/tasks/zz-fake-computed/` |
| ④ `analyzeTaskAudio` 缺 ffmpeg 只 warn 一句 | 返回值从裸 `null` 改成 `{ file, skipped, message }`（`no-audio` / `no-ffmpeg`）；`cmdVideo` 显式报「这一次渲染里 f.beat / f.a 全是 0」，`cmdCheck` 在没有 ffmpeg 时进 `skipped`（`音频分析（analyze）`） |
| ⑤ `measureLoudness` 没有 `-t` 截断 | 新增 `{ seconds }`；`check --quick` 用它只量前 60 秒。**实测**（sodium-mix，246s）：整条 6.9s → 前 60s **1.7s（省 76%）**，读数确实会变（真峰 -2.96 → -4.52 dBTP / LRA 8.3 → 6.5）⇒ 必须打出来。⚠ 关键坑：`-t` 必须是**输入侧**选项（放输出侧 muxer 只写 1.5s，但滤镜图仍吃到整条轨 —— 单测 `tools/test-loudness.mjs` ⑦ 当场抓出来的） |
| ⑥ `sheet-audio --sheet` 没对着真产物验过 | 验的过程**抓到一个真 bug**：栅格行数写死 4×4 ⇒ 8 格（4×2）的接触表被按 4×4 复算、**7 格落在图外**。修法：行数由 PNG 高度解出来（`guessSheetTile(W,H,cols)`），并在排版前就把源栅格解好（以表里的实际格数为准）。sodium 8 格表实测切成 4×2、22/28 词标签画出（图见 `out/_staging/sodium-sheet-8tiles.png`） |
| ⑦ `worldAudit` 只采交叠窗中点 | 采样计划抽成纯函数 `planWorldAudit()`：每段采**两个**时刻（交叠窗中点 **判** + 窗后中点 **只读数**）。⚠ **第一版把同一条判据也压在窗后点上，`check demo` 当场假报**（甩镜尾巴按设计就是 0.037–0.051）—— 判定改成纯函数 `worldAuditVerdict()` 并且**只判第一个点**，单测钉死这个假报 |
| ⑧ 4K `--scan-nf` 代价没实测 / `--parallel` 没跑过 | 都实测了，写在 `docs/PERF.md` §7：单次扫描 1080p **+38ms** → 4K **+152ms**（**4.0× 线性**，默认档在 4K 仍只 +1.8%）；`video _style-sampler --parallel 2` **第一次真跑**：1020 帧 / 4 段 / ffprobe 复核通过 / 实测 **1.75×**（887.3s 的工作量 508.8s 跑完） |
| ⑨ 注释里约 15 处死链 | 全仓库 **34 个文件 / 91 行**指向已归档 `docs/IMPROVEMENTS*.md` 的引用改到 `docs/history/…`（含**运行时会打印的输出词**，`docs/DIAGNOSIS.md` §1.6 / §5 已标已修） |
| 1-5 `probe-alpha` 注释里的 `max≈0.06` | 改成 **0.10**（`readPixels` 是 sRGB 编码后的显示空间，`lin2srgb(0.01) ≈ 0.1005`），并写明「**别照着它去改 blank** —— 把 0.10 掰成 0.06 会让 ⑤⑥ 两条判据集体失真」 |
| 「画面上的数字必须有出处」（1-22） | **第九轮**（`88a384d` `c0d15f6` `ff8f86b`）：`AGENTS.md` §10.10 硬规则 + `docs/FACTS-TEMPLATE.md`「★ 数字的硬规则」；`tools/lint-fabricated-numbers.mjs`（判据限定"数值显示位"，没有 `FACTS.md` 的任务**安静跳过**）。实测 6 个有事实表的任务 / 194 个显示位 / 10 个命中（**全是没登记的镜号**）。自测 + 夹具在 `tools/fixtures/lint-numbers/`，已挂 `unit:lint-numbers`（**不是 gate**，与 `lint-narration-dup` 同例）。⚠ **第十轮把自测从 139 项扩到 183 项**（新增判据 ③，见上）—— 这一行里的 139 是当时的数字 |
| **顺带修掉的两个"回归自己的"问题**（跑整份 `regress-all` 时暴露的） | ① `tools/probe-tts-edge.mjs`：TTS 服务端挂掉（edge-tts 全线 **403**）时 `runSay()` 不抛、只把 `timing` 留成 `null`，探针却直接读 `res.timing.scenes[0]` ⇒ 崩成 `TypeError`、**退出码 1**，而它自己的契约写的是"连不上会「跳过」退出码 2"。现在没拿到表就明说跳过（+ 一行首句失败原因）、退出 2。<br>② `tools/regress-all.mjs`：新增**第三种结局 `SKIP(没跑)`**（只对显式声明 `allowSkip: true` 的项、退出码 2 生效；别的工具里 2 是用法错，不能一刀切）。汇总里单独列「跳过 N 项（没跑 ≠ 通过）」，**不计入真失败**。顺手把 `tools/test-loudness.mjs`（39 项）挂进清单（`unit:loudness`）—— 之前它**不在**回归清单里 |
| **钠那期三条外部批评变成判据（0-7 方案 1）** | **第十一轮（2026-10-16）**：新增 `src/layout.js`（纯函数判据）+ `tools/test-layout.mjs`（31 项）+ [`docs/LAYOUT.md`](LAYOUT.md)；`check` 多一段「版面守门」，复述率接进 gate。逐条见下面「第十一轮的验收证据」 |
| 一屏几块字（读数面板算一块）| `src/core/text.js` 的 `noteText` 记实际绘制 → `gl.paint.blocks` → `textGroups()` 单链聚类（阈值**随字号缩放**：`min(gap, 较小字号×0.8)`，地板 12px）。判据 ① `maxBlocks=6`：钠 `glass` 一帧 **9 块 / 49 次绘制**被点名 |
| 「不知道要看哪个主体」| 判据 ② `maxOffSubject=2`：主体 = 落在 `focus` 里的块 ∪ 最大的一块，按**图连通**合成「看的地方」。⚠ **不要求声明 focus** —— 钠 12 段全没声明，这条照样点名 11/12 段 |
| 「元素互相遮挡」| 判据 ③ `maxInFocus=2`：只对声明了 `focus` 的段跑；没声明 ⇒ `check` 进 `skipped`（**没判 ≠ 通过**）。`focus` 三处写法（场景 / `cut()` / 配置档节点）都接了 |
| 版面母题豁免 | 页眉（y ≤ 11.5%H）与说明条+脚注（底边 ≥ 90%H）**既不算判据也不算读数**。没有它的话钠每段都必然超限，判据立刻变噪声（实测：加上之前 7/12 段「超限」里有一半是页眉） |
| 复位述率 gate | `lint-narration-dup` 的命中在 `--strict` 下进 `errs`（默认仍只 warn）。钠实测 `[旁白复述] 12 句旁白被逐字写进画面` |
| **顺带抓到并修掉的两个 bug** | ① `TextKit` 上**没有 `gl`**（`Layer2D` 只存了自己的 `this.gl`）⇒ 记账判据恒假、`blocks` 永远是空的**而且不报错**；`paint.layer` 原来存的是 Layer2D（也不匹配）—— 靠一个探针才查出来。② `--strict` 一跑就 `ReferenceError: errs is not defined`：复述率那档 `errs.push` 而 `errs` 在它下面几十行（TDZ），被 catch 吞成假 skipped ⇒ 改成**先攒进 `staticErrs`、后面统一并** |
| `check` 现在会逐条打印为什么红 | 以前只打一行「✗ 有 N 个问题」（数字有、理由没有）。新增 12 条上限的明细段，`reportErrors()` 早就是这么做的 |
| **用户拍板不做（2026-10-16 深夜 · 待办复核）** —— 以下五条是**用户明确决定不做**的，别再翻出来 | 第十二轮 |
| 0-1 `tasks/nekohome` 的 `disp()/dcss()/dscale()` 颜色绕行**不回改**；只在 `_kit.js` 顶部把注释更正为"历史绕行补丁，不是设计要求"（**已改**） | 第十二轮 |
| 0-2 `sodium` 12 句 / `optifine` 3 句**画面文字逐字复述旁白不返工**（已交付；复述是观感打折，不是错误） | 第十二轮 |
| 0-3 `kinetic` 模板"居中长行顶出右边"**已修（2026-10-24）** —— 把它写成"不修"的理由（"修它会改 demo 的画面，要重存 hashes 基线"）在基线策略改版后作废。真正的修法是让 `type.write` 的 `align` 按整行对齐（详见 §0 批注 ①），`kinetic` 的「都是时间的函数」从被截 109px 变成完整居中 | 原第十二轮"不修" → **2026-10-24 落地** |
| 0-4 / 2-2 `tasks/nekoseek` **不立项**（前置分析留在 `tasks/nekoseek/ANALYSIS.md`；它仍不是任务） | 第十二轮 |
| 0-7②③ 钠差评后续的两支样片（60–90 秒单主题 / 「一页一图」最小样张）**不做**（① 版面守门已落地） | 第十二轮 |
| 磁盘：`out/` 的 `*.parts/` 等中间产物已清（7 个任务、释放 29.4 GB）—— §3 的表已换成清理后的读数 | 第十二轮 |
| ~~1-49~~（部分） | **已抽（2026-10-26）：`spectrum` 的三个母题** —— `src/kit/motifs/` 落地：`fourier`（方波级数 / 本轮 / 项数生长 / 画圆）、`dct`（8×8 二维 DCT·IDCT / 有损重建 / 按 min-max 归一）、`waveform`（采样折线 / 游标 / 刻度），统一从 `src/kit/index.js` 再导出。验证：`tools/test-motifs.mjs` **38 项**（级数 RMS 随项数递减、Gibbs 过冲 1.15–1.22、本轮末端 == `squareWave()` 到 1e-12、DCT 往返 <1e-9、归一化不改形状、采样不出 NaN 且 x 单调）+ 夹具 `tasks/_motif-lab`（两段样片）。文档 `docs/MOTIFS.md`。**没做的部分**：`sodium` 积木 / `bikeshed` 会议室 / `beast`·`fidus`·`nekohome` 的私有 `_kit.js` —— 这些任务目录被 `.gitignore` 排除（含真实素材），**本 checkout 里没有**，抽不了也删不了 | 同 §5 Phase 2 |
| ~~1-63~~ | **已完成（2026-10-30 晚）**：`style.view` 整片介质 —— 八种成像提成**风格包字段**，引擎在「全部段合成完 → post 之前」把整帧换成像（`src/core/engine.js` 的 `composite`；字幕在 post 之后，永远清晰）。`resolveView()` 校验模式名（写错**当场抛**，列出可用清单）；`applyStyleView()` 先拷离屏再成像（读自己写自己是 GL 未定义行为）。**默认 off**（31 套里只有 `h-riso` / `h-vhs` 写了它）—— `hashes demo` / `beat` 各 **11/11 max 0** 证明老片子一个像素没变。示范：`still _style-sampler -t 2.4 --style h-riso`；夹具 `_style-view-lab`。**顺手修掉一个真雷**：`crt` 的亮度补偿 1.55 裸乘会把浅底画面打成 23% 死白（`check _style-view-lab` 当场红），改成亮部软肩（`_view-lab` 基线已 `--accept --note`） | 2026-10-30 晚（用户拍板：做、默认 off） |
| ~~1-64~~ | **已完成（2026-10-30 晚）**：胶片磨损 `post.weave` / `flicker` / `scratch` —— 片门晃动（双频亚像素行漂移）/ 曝光闪烁（1.3Hz 慢波下陷，只压暗）/ 划痕（每 5 秒生死窗的竖痕，**亮底发暗、暗底发亮**——它是「没显影的缝」）。全部由 `wearT`（引擎每帧喂 `t`）驱动，**0 = 逐像素不变**，覆盖素材包 17 条磨损条目。**踩掉两个不报错的坑**：① 只压暗的划痕在深色段**完全隐形**、亮纸段又被亮度因子归零——改成极性混合；② 夹具第一版放在竖直网格线标题上，划痕被网格埋掉。验证 `tools/test-post-wear.mjs`（23 项：默认全 0 / uniform 接线 / 0 时走不到磨损代码 / 磨损函数不读 seed）+ 夹具 `_wear-lab`（`check` 0 红）+ 风格 `h-vhs` | 2026-10-30 晚 |
| ~~1-65~~ | **已完成（2026-10-30 晚）**：N 版套印 —— `halftone` 加 `passes`（1 = 单版**逐像素不变**，2..4 = 分版）与 `misreg`（套准偏移，逻辑像素）。分版规则「越深的版越晚进入」（`th = i/N · 0.8`），版序浅墨→深墨；每版网角错开 30°、偏移方向按黄金角散开；套准偏移让相邻版边界长出彩色边——**没有它，N 版只是多色网点图、不像印出来的**。⚠ 第一版用的是 disjoint 分版 `(1-l)*N - i`：纸面（亮度 0.62）就有 72% 强调色覆盖 ⇒ 整屏被染成红、纸色全丢（出图当场抓到）。夹具 `_view-lab` 的 `halftone2` / `halftone4`；风格示范 `h-riso` | 2026-10-30 晚 |
| ~~C-1~~ | **已完成（2026-10-31 深夜）**：`video --dry-run` **按档预估** —— 一次命令给出草稿档（绝对 `scale 0.5 + samples 1`）与成片档（任务 scale + `samples auto`）各自的实测 fps 与分钟数，不再只量手上那组参数；缺的档另起短会话真测 10 帧，某档失败明说「没测成」而不硬推。非标准参数另列「本次参数」，`--json` 保留旧字段并新增 `tiers[]`。纯逻辑在 `scripts/lib/tier-estimate.mjs`；验证 `tools/test-tier-estimate.mjs` **12 项**（挂 `unit:dry-run-tiers`）+ `_calib` 三条真机路径（默认 / `--draft` / `--samples 8 --json`）。同轮用户拍板：**整支片子先 `--draft --segments 10` 给用户审，只有用户明确说定稿/正式版/全渲染才跑成片**，已写进 `AGENTS.md` §1 与 §7 | 2026-10-31 深夜 |
