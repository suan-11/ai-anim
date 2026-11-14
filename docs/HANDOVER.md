# 交接文档（HANDOVER）

> 写给接手的人 / agent：**先读这一页，再读 [`AGENTS.md`](../AGENTS.md)**。这一页回答四件事 ——
> 现在是什么状态、这轮发生了什么、怎么验证、接下来从哪接着做。
>
> **最后更新：2026-11-14**。**先读下面「2026-11-14 交接」一节**（当前状态 + 唯一待决事项）。其余续接记录按时间倒序保留；分支、工作区、回归项数以实时 Git 为准。
> 11-08 快照：拉齐上游 `9bd271a`；PR #3 / #5 均已合并；本页按 [`PLAN-2026-11-08.md`](PLAN-2026-11-08.md) A4 重写。
> 上一版描述的是**另一台机器**与 70/70 的旧状态，已作废。

### 2026-11-14 交接（当前状态，先读这节）

**一句话**：`PLAN-2026-11-08` 三线 11 项**全部收口**，CI **80/80**，工作区干净（HEAD `4fe3eec`）。唯一待决的是 `pv-kattachi` 歌词同步的最后一段（见下）。

**这轮做完的**（34 个提交，`29635e7..4fe3eec`）：
- A1–A6 工程健康：CLI 拆分（anim.mjs 303 行 + 42 命令模块）/ AGENTS 49912B / BACKLOG·HANDOVER 归档 / 依赖体检（修「装了 playwright-core≠有浏览器」误判）/ 孤儿工具。
- B0 分段计时：`anim perf --breakdown`。本机 AMD 核显，渲染占 87–94% ⇒ **不上 WebCodecs**（PERF §8）。
- C1–C4 画面下限：版面几何判据（字压字/出画/撞字幕）/ 分镜三件套（`placeholder` + `anim board`）/ 被拍摄感预设（`filmed·filmed-doc·filmed-super8`）/ C7 运动节奏进 check。
- 样片草稿已出：`trans-showcase` / `_lens-travel` / `fish-print`（各自 `out/<任务>/`，接触表 `sheet_*.png`）。

**⚠ 唯一待决：`pv-kattachi` 歌词同步**（`tasks/pv-kattachi/`）
- 已入库的修复（`4fe3eec`）：尾段 4 句按人声起音重排，`lint-lyric-sync` p90 **563→525ms**（判据 ≤400）。
- 查透的结论：64 句里 **52 句与官方 LRC（`audio/lrc-jp.json`）逐毫秒一致**；剩约 12 句是「LRC 与人声起音本身差 0.5–1.3s」。
  尾句「ずっと待っているわ」附近**没有自己的干净起音**（最近起音是邻句的）——**机器吸附不安全**（`tools/retime-lyrics.mjs` 模拟全吸附 p90 反而更差），**必须人工核听**这 12 句。
- **已渲草稿并逐帧验证**：尾段 214.46/220.36/226.35/229.32s 四句都落在人声起音上。但草稿（960×540）**覆盖了旧的全质量成片**（11/1 那版，同步本来就更差）。
- **待用户拍板**（上一轮已问，未答）：
  - **A** 直接全质量重渲（本机约 **5.75h**，dry-run 0.69fps）；
  - **B**（推荐）先人工核听那 12 句、精修后再一次性出全质量；
  - **C** `--samples 8` 压运动模糊换速度（质感与原片略差）。
- 核听入口：`node tools/lint-lyric-sync.mjs pv-kattachi`（列最差句）；`node tools/retime-lyrics.mjs pv-kattachi`（dry-run 预测，别直接 --apply）。

**接手第一步**：`node tools/regress-all.mjs --ci`（应 80/80）→ 读本节 → 若继续 pv-kattachi，先等用户对 A/B/C 表态，**别擅自全渲或瞎吸附歌词**。

**环境坑（本机，勿忘）**：AMD 核显无独显 / ffmpeg LGPL 无 libx264（自动兜底 h264_mf）/ 推送走 qyac、ssh 用 Git 自带那个（AGENTS §1）/ PowerShell 别用管道接原生输出、看 `$LASTEXITCODE`。
### 2026-11-13 A1 拆分中途交接（历史）

用户要求按 PLAN 继续后，当前工作推进至 A1 的机械拆分阶段。用户随后要求准备交接，A1 仍为部分完成。

已落盘的结构与验证如下。

- `scripts/anim.mjs` 从 8531 行缩为 312 行，保留帮助文案、参数初始化、分发表、IS_MAIN 和旧导出转发。
- `scripts/cmd/` 有 42 个命令模块，均导出 `run`。`scripts/lib/cli/` 新增 audio / gates / media / notes / paths / session / sheet / sources 八个共享模块，保留既有 args / log。
- 会话状态在 session 模块内，其他模块使用 `getSession()`，避免异步开关会话后的旧值问题。相对 import 路径和帮助文本读取位置随模块迁移调整。
- help、tasks --json、shots --json、styles 的 stdout / stderr / 退出码与迁移前逐字节一致，原入口 37 个导出均保留。对照脚本为 `out/_cli-split/compare.mjs`。
- `tools/test-cli-layout.mjs` 已加入 regress-all 清单，检查入口行数、命令与文件双向覆盖、会话状态私有和旧导出。
- 迁移前基线 CI 为 76/76。首次拆分后为 72/76，四个失败涉及旧源码读取位置和 import 路径断言。补齐 check-skipped / hashes-policy / subs 的拼接源码读取并适配 tier-estimate 的相对路径后，针对性测试已通过，断言未删除。当前 77 项完整交接复验的结果见下方验证记录。

验证记录将在打包前更新。原始日志位于 `out/_cli-split/`，交接包也附此目录副本。

接手后按以下顺序继续验收。

1. 运行 `node tools/test-cli-layout.mjs` 与 `node tools/regress-all.mjs --ci`，对照 `before/*.log` 的原有测试断言条数。
2. 完成迁移后的 `still demo -t 1,6`、`check demo --quick`、两秒草稿视频对拍。迁移前的两张图、check 日志与 120 帧视频已保存在 `out/_cli-split/before/`。视频输出使用 `-o out/_cli-split/after/demo.mp4`，避免覆盖现有完整成片。
3. 对比静帧像素和视频解码帧。尚未执行这项验收，命令列表一致只覆盖 CLI 的只读入口。
4. 更新 DIAGNOSIS 等文档中 `scripts/anim.mjs:旧行号` 的位置。多处行号在拆分前已过期，应按诊断消息与函数定位，不能直接按旧行数偏移映射。
5. 核查命令的正常与错误路径、长行 import / export 的可读性，再将 A1 改为完成。

本轮开始时已有 `pv-kattachi`、`trans-showcase` 两份任务配置改动，以及 anim.mjs 的三处 smoke 文件过滤修改。后者随代码迁到 `scripts/cmd/check.mjs` 两处和 `report.mjs` 一处，提交时单独保留为未提交差异。交接包包含这些工作区差异和原始 `before/existing.patch`。临时执行基线用的 `scripts/.anim-a1-baseline.mjs` 已清理，原文件副本保存在 `before/anim.mjs`。

用户已认可的运镜继续保留在 `tasks/_lens-travel/`，9 秒有声版 `out/_lens-travel/lens-travel-v2.mp4`，对应 PR #9。黑白九块与鱼印方向仍已放弃。

### 2026-11-13 运镜认可与 PLAN 复核

用户已明确认可镜组穿行的运镜，后续可参照 `tasks/_lens-travel/` 的偏轴路径、近景遮挡、弧长参数化速度与减速抵达。视频 `out/_lens-travel/lens-travel-v2.mp4` 为 9 秒、1920×1080、60fps、540 帧、4 子帧，含程序合成声音。已提交 [PR #9](https://github.com/suan-11/ai-anim/pull/9)，本地提交 `dbbc2d8`。模型采用简化镜组，山景由程序绘制。黑白九块与鱼印方向仍已放弃。

PLAN 已按本地代码逐项核对，当前 11 项中完成 2 项、部分完成 4 项、未完成 5 项，详细证据见 [计划顶部进度表](PLAN-2026-11-08.md)。本次发现转场模式数新增后 relay 测试仍为旧数量，已补齐断言，完整回归复跑 76/76 通过。A5 的 Chrome 回退检测还有包存在即认为浏览器可用的问题，已记录为部分完成。

下方为此前打包交接时的历史记录。旧交接包的源码快照为 `b34cfd6`，本节的运镜与计划复核发生在打包之后。

### 2026-11-13 打包交接记录

用户最新决定为放弃黑白粗剪、九块拆合及其内容填充方案。“鱼印”也已放弃。前面关于继续加强相机呼吸、填充九块内容的建议已失效。此前用户认可解构效果，并要求转场避开常规 PPT 效果。接手后从解构镜头的内容、空间运动和镜头衔接重新设计。

当前交接包含源码、历史和参考输出。废弃实验保留在 Git 中供追溯，代码留存与视觉方案认可分开记录。

| 项目 | 交接时核实的状态 |
|---|---|
| 本地分支 | `master`，交接文档提交前为 `f078898`，比本地 `origin/master` 引用领先 44 个提交 |
| PR | [PR #8](https://github.com/suan-11/ai-anim/pull/8) 已关闭且已合并，head 为 `2bf56b4` |
| PR 内容 | `tasks/_rough-cut/` 与 `tasks/fish-print/`；合并发生后用户放弃方案 |
| 工作区修改 | `tasks/pv-kattachi/task.config.mjs`，既有歌词尾段同步改动，6 行增加 / 4 行删除，尚待核听 |
| Git 关系 | 本地 master 含更多引擎与转场提交，PR 分支为另行摘取的提交历史，SHA 不同 |
| 当前转场示例 | `tasks/_trans-structure/scenes/dynamic.js` 实际使用 `seam → corners`，较早交接中写的 diamond 已过时 |

本轮产生的代码与预览如下。

- `1a2dd65` 修复黑白样片片尾合拢，输出 `out/_rough-cut/rough-cut-handoff-v3.mp4`。这条路线已放弃。
- `327c2b6`、`a9032ee`、`f078898` 新增并修订鱼印手写场景、刻版图案及合成音效。输出 `out/fish-print/fish-print-preview.mp4`，12.4 秒、960×540、60fps、744 帧，含音轨。这条路线已放弃。
- 鱼印检测的最后记录为单帧 / 多子帧共 30 个采样通过，事件密度 17%，反 PPT strict 通过。响度 -28.2 LUFS，8 项检查跳过，详见 `out/fish-print/check.txt`。这些是技术检查记录，用户已否定其视觉方案。
- 转场模式测试本次交接重新运行，24 项通过。GPU 探针上轮为 48/48 通过，真实路径 seam/corners 通过，本次打包未重新运行 GPU 探针或完整 CI。
- `out/_deconstruct-lab/deconstruct-inspect-draft.mp4` 可用于回看此前的解构方向。`out/_trans-structure/structure-corners-draft.mp4` 是已有 diamond/corners 草稿，与当前 seam/corners 源码存在版本差异。当前 seam 路径尚无对应的完整导出视频。

接手入口及命令如下。Windows 机器依赖 Node、npm、Chrome 和 ffmpeg，依赖版本见 package-lock.json。项目内 `AGENTS.md` 提供渲染契约。

```powershell
git status --short --branch
npm ci
node tools/test-transition-modes.mjs
node tools/probe-slide-transitions.mjs
node scripts/anim.mjs check _deconstruct-lab
node scripts/anim.mjs still _deconstruct-lab -t 2.5,5.9,7.05
node scripts/anim.mjs video _trans-structure --draft
```

恢复工作区时先阅读交接包根目录 START-HERE.md。源码快照使用已提交版本，歌词同步修改另附完整文件和 patch，按需要恢复。后续创作先回看解构参考，并依据具体内容设计一条完整镜头。

### 2026-11-10 续接

- 接手基点 `29635e7`，已有 `turn` 百叶翻面；旋转/镜碎的旧方案已撤回，参见 [`MOTION-SPIN-SHATTER.md`](MOTION-SPIN-SHATTER.md) §7，别按旧会话表重新加回来。
- 解构模板从同步径向展开改为 **Y 分层 → X 分列 → Z 展开纵深**，按逆序归位；三轴都有间隙才轻微转动，先退转角再合拢。相机提前退让、展开后侧看，标注错峰，页脚等归位后出现。
- `tools/test-action-motion.mjs` 9/9：包括三档 spread × 201 时刻的保守包围盒无交叠与倒序 seek；镜头库测试 243/243；完整 `check _deconstruct-lab` 通过（三时刻 × 单/24 子帧；无音轨、无交叠等六项按工具报告跳过）。
- 草稿 `out/_deconstruct-lab/deconstruct-staged-draft.mp4`：960×540 / 60fps / 10.8s / 648 帧，ffprobe 复核通过；已看拆层、展开、收拢关键帧与草稿末帧。事件密度显式指定这份文件：最长静止 0.5s、稀薄窗口 20%（旧片 40%）。草稿为 samples=1，供审节奏，未出正式版。
- 接手时 CI 回归 75/76；唯一失败 `mix-loudnorm` 是沙箱临时目录 rename EPERM，沙箱外复跑 53/53 通过。
- `pv-kattachi` 配置和本页在接手前已有未提交修改，保留；歌词最后一句起音仍需人工核听，lint 下降本身不证明歌词语义对齐。
- 解构观察阶段续改：引线按弧长连续经过折点，到达后才揭示文字；核心/外层标注、材质高亮共用纯函数时序。外层被指向的网格使用独立材质，观察结束恢复原色；其余结构引线在聚焦时适度减弱。动作测试现为 10/10（新增折点连续性、文字不抢跑与高亮互斥）。
- 续改验证：沙箱外完整 CI **76/76** 全绿，完整 `check` 单/24 子帧路径通过（仍有上列六项跳过）。新版草稿 `out/_deconstruct-lab/deconstruct-inspect-draft.mp4`（648 帧，ffprobe 复核通过）；已看 5.9/6.8/7.05s 关键帧和草稿抽帧，显式对这份 mp4 跑事件密度 `--strict` 通过（最长静止 0.5s、稀薄窗口 20%）。

### 转场续改（2026-11-10）

- 新增 `transition: 'split'`（两半对开）和 `'slats'`（八条交错滑出）。保持原纹理比例，间隙露出下一镜头；随摄影机主方向选择横/竖轴。不改默认 push shader。
- 修正时间线 `handlesTransition: false` 覆盖模板标记失效的问题：引擎遵守段上覆盖，显式 false 时不给模板 `ctx.under`，避免先甩镜再叠转场。不写覆盖值时保持旧路径。
- 样片：`tasks/_trans-structure/`；草稿 `out/_trans-structure/structure-transitions-draft.mp4`，14.15s / 960×540 / 60fps / 849 帧，ffprobe 复核通过，已看转场关键帧和草稿抽帧。
- 验证：完整 CI 76/76；`probe-slide-transitions.mjs` 横竖屏 × 四方向 × 两模式共 16 场景通过（首尾、覆盖单调、纹理坐标、乱序 seek），另验真实时间线 split/slats 路由及模板不重复甩镜。探针已登记回归清单，需 Chrome，不在 CI 上运行。
- 完整 `check _trans-structure` 三时刻 × 单/多子帧共 18 帧通过，另有无音轨等五项跳过；事件密度对新版草稿读数通过。尚未出正式版。


### 2026-11-11 夜（引擎侧收口）

- **BACKLOG 1-74 已修**：`gl.clear()` 现在算一次「整帧覆盖绘制」（`src/core/gl.js` 的 `clear` 调 `_notePaint`）。
  背景守门原来只数 `Pass.render`，而 `AGENTS.md` §3 教场景写的第一句正是 `gl.clear(ctx.out, …)` ——
  于是「只靠 clear 铺底」的模板（`outro`）被误判成没铺底。引擎在 `beginPaint` **之前**那次兜底黑屏不会被数。
- **协作者的四个转场 + 引擎覆盖修复已提交**（`1efc05c` / `df8f402`）：`diamond` / `frame` / `split` / `slats`；
  `handlesTransition` 改为「时间线覆盖优先」，显式 `false` 时不再把旧帧交给场景（避免叠两次甩镜）；
  GPU 探针 `tools/probe-slide-transitions.mjs` 32 场景通过（首尾 / 覆盖单调 / UV 不拉伸 / 乱序 seek），需 Chrome、不在 CI 跑。
- **三条审美判据全部接进 `anim check`**（`f718734` / `233dbbb`）：运动人格、缓动方向（源码级）、
  同时运动（需要成片 mp4，没有就 skipped）。**退出码 2 一律记 skipped —— 没验 ≠ 通过**；默认只报，`--strict` 才当门。
- **`docs/MOTION.md` §3.6 转场表补全到 15 种**（`1cd42f2`），并写明六个可选旋钮（`cols`/`stagger`/`bands`/`shards`/`seed`/`power`）。
- **新工具 `tools/retime-lyrics.mjs`**（`9a0e00f`）：预测把歌词句首吸附到人声起音后的中位/p90。
  ⚠ 实测结论：**逐句吸附不安全** —— pv-kattachi 从 中位 103 / p90 525 变成 92 / 602（更差），
  因为它会把人声起音认成「别的字」的起音。所以默认 dry-run，`--apply` 只在整片统一偏移时用。
- **`pv-kattachi` 仍然红**：`lint-lyric-sync` 中位 103ms（过）、p90 525ms（超），最差 229.32s +1346ms。
  它的配置改动还在工作区**未提交**（不是本轮产物）；要收口得人工核听最后几句 + 重渲（约 100 分钟）。

## 0. 当前状态（2026-11-13，本机口径）

> 旧的 §0–§10（上一台机器：qyac 远端 / 70-75 回归 / RTX 2060 参考机）已归档到
> [`history/HANDOVER-2026-11-04.md`](history/HANDOVER-2026-11-04.md)。下面是**这台机器**的现状。

- **引擎**：确定性代码渲染（WebGL2 + 无头 Chrome + ffmpeg）。`render(t)` 是 t 的纯函数。CI **80/80**（`node tools/regress-all.mjs --ci`）。
- **CLI 已拆分**（A1）：`scripts/anim.mjs` 303 行入口 + `scripts/cmd/` 42 命令 + `scripts/lib/cli/` 共用件；布局测试 `tools/test-cli-layout.mjs` 进 CI。
- **转场 17 种**：push/mix/none/wipe/iris/sweep/diamond/frame/turn/split/slats/glitch/pixel/dissolve/relay/corners/seam。旋转/镜碎旧族已撤（`MOTION-SPIN-SHATTER.md` §7 复盘）。
- **判据接进 check**：运动人格 / 缓动方向 / 同时运动 / 事件密度 / 运动节奏 C7（`tools/lib/diff-series.mjs` 共享解码）。退出码 2 一律 skipped（没验≠通过），默认只报、`--strict` 才当门。

### 这台机器（环境与坑）

- **GPU：只有 AMD 核显（Radeon 0x1636）+ Gameviewer 虚拟显示卡，没有独显**。`--gpu auto` 与 `--gpu high` 都命中核显。
  B0 实测（PERF §8）：渲染占比 87–94%、ffmpeg 背压 <3% ⇒ 瓶颈在 GPU 渲染，**不上 WebCodecs**；杠杆是降子帧/优化着色器/换独显机。
- **ffmpeg 是 LGPL 构建**：没有 `libx264`；`h264_nvenc` 列得出但无 NVIDIA 不可用。引擎自动兜底 `h264_mf` / `libopenh264`。
- **远端**：`origin` = 上游 `suan-11/ai-anim`（只读，拉取用）；推送走 `qyac`。ssh 用 Git 自带那个（见 AGENTS §1）。
- **PowerShell**：别用管道接原生程序输出（`| Select-Object` 会被拒）；`$LASTEXITCODE` 才是真退出码。

### PLAN 进度（`PLAN-2026-11-08.md`）

- **✅ PLAN 全部收口（2026-11-14）**：A1 CLI 拆分 / A2 AGENTS≤50KB / A3 BACKLOG 归档 / A4 HANDOVER 归档刷新 / A5 回归依赖体检 / A6 孤儿工具 / B0 分段计时 / C1 版面守门 v2 / C2 分镜三件套 / C3 被拍摄感预设 / C4 C7 进 check —— **11 项全完成，CI 80/80**。计划归档 `history/PLAN-2026-11-08.md`。
- **新增能力**：`anim board`（分镜板）/ `placeholder` 占位镜头 / post 预设 `filmed·filmed-doc·filmed-super8` / 版面几何判据（字压字·出画·撞字幕）/ `anim perf --breakdown`。
- **样片（2026-11-14 草稿，已出）**：`trans-showcase`（五种转场）/ `_lens-travel`（穿镜组运镜）/ `fish-print`（木刻鱼印）——都在各自 `out/<任务>/` 下，接触表 `sheet_*.png`。
- **欠账**：`pv-kattachi` 尾段歌词（p90 525ms 超，需人工核听 + 重渲）；其余见 [`BACKLOG.md`](BACKLOG.md)。

### 怎么验证（按顺序）

```sh
node tools/regress-all.mjs --ci        # 80/80
node scripts/anim.mjs check <任务>      # 静态 + 试渲染 + 各判据读数
node scripts/anim.mjs still <任务> -t … # 出图，真的用 Read 看
node scripts/anim.mjs video <任务> --draft --segments 10   # 草稿给用户，等反馈再出正式
```
### 动态切入切出续改（2026-11-11）

- `tasks/_trans-structure/scenes/dynamic.js` 给三段全屏镜头加了确定性的镜头层运动：入场带 92px 推入与 5.5% overscan 后落定，出场在交叠窗内带 34px 方向性带速并轻抬画面。变换只作用于场景前景，`split` / `slats` 的纹理坐标与默认 push shader 保持不变。
- `_trans-structure` 改为 `seq(dynamicTimeline())`，保留原来的 2.4 / 10.8 / 2.7 秒时长和两个转场模式。新草稿 `out/_trans-structure/structure-dynamic-draft.mp4`：960×540 / 60fps / 14.15s / 849 帧，ffprobe 复核通过；已抽查两个切点的导出帧。
- 验证：`check _trans-structure` 18/18 单帧与多子帧通过，`probe-slide-transitions.mjs` 16/16 GPU 场景通过，真实时间线 split/slats 路由通过。该草稿仍是审节奏用的 samples=1 预览，尚未出正式版。

- 动态草稿后续精修：把 `_trans-structure` 的切点从整屏对开 / 交错条带换为 `iris` 中心扩散与 `sweep` 角度扫描，镜头层运动收窄为 46px 入场、18px 出场和 2.6% overscan。草稿 `out/_trans-structure/structure-refined-draft.mp4` 已完成 849 帧、ffprobe 通过，并抽查连续切点帧。`probe-slide-transitions.mjs` 保留 split/slats 的 GPU 覆盖测试，同时改验真实时间线的 iris/sweep 路由。

### 2026-11-12 交接补充 1：转场库与样片状态

- 当前工作区基于提交 `1627466`，转场实现已在提交 `1efc05c` 入库。新增 `diamond` 与 `frame` 两种中心几何转场，保留 `iris`、`sweep`、`split`、`slats` 以及默认 `push`。
- `tasks/_trans-structure/` 当前真实时间线使用 `diamond` 进入解构镜，使用 `frame` 进入片尾卡。镜头层运动是 46px 入场、18px 出场和 2.6% overscan，代码位于 [`scenes/dynamic.js`](../tasks/_trans-structure/scenes/dynamic.js)。
- 最新交接草稿 [`structure-handover-draft.mp4`](../out/_trans-structure/structure-handover-draft.mp4)：960×540、60fps、14.15s、849 帧，ffprobe 已复核。关键抽帧位于 `out/_trans-structure/stills/f_0001.980.png` 与 `f_0011.900.png`。
- 验证结果：`node tools/test-transition-modes.mjs` 24 项通过，`node tools/probe-slide-transitions.mjs` 32/32 GPU 场景通过，`node scripts/anim.mjs check _trans-structure` 18/18 单帧与多子帧通过。探针覆盖横竖画布、四方向、首尾、覆盖单调、UV 坐标和乱序 seek，并验真实时间线 `diamond` / `frame` 路由。
- 工作区仍有 `tasks/pv-kattachi/task.config.mjs` 的既有未提交修改，属于歌词同步工作，不要在本轮转场交接里覆盖或重置。
- 下一步若继续优化，优先观察 `structure-handover-draft.mp4` 的两个交叠窗，再决定是否把 `frame` 的边缘亮度或 `diamond` 的边缘宽度收窄。正式版仍需用户明确要求后再去掉 `--draft`。

### 2026-11-12 续做转场

- 新增 `corners` 转场：四角的旧画面沿圆弧向中心收紧，片尾卡使用 `diamond → corners`，文案改为 `02 / CORNERS`。
- GPU 探针扩展到横竖画布 × 四方向 × 五种几何模式，共 **40/40** 场景通过。`test-transition-modes` 24 项通过。
- 最新草稿 [`structure-corners-draft.mp4`](../out/_trans-structure/structure-corners-draft.mp4)：960×540 / 60fps / 14.15s / 849 帧，ffprobe 通过。抽帧检查 `11.7s / 11.9s / 12.2s`，四角边缘连续，片尾标题在过渡中仍可读。
- 当前任务完整 `check _trans-structure` 通过 18/18 单帧与多子帧路径。正式版仍需用户明确要求后再去掉 `--draft`。

### 2026-11-13 交接补充 2：先写时间线，再填视觉

- 根据本轮反馈，新增手写任务 `tasks/_rough-cut/`，没有使用 `src/shots/` 模板。它只包含黑底、一个持续变化的九模块主形状和一条缓慢相机呼吸曲线。
- 时间结构分成四段：`seed 1.6s`、`split 3.0s`、`suspend 5.4s`、`return 2.4s`。总长 12.4s，段长 CoV 0.53。主形状依据整片绝对时间连续从单块拆成模块、悬停、再归位。
- 黑白粗剪草稿 [`rough-cut-structure-draft-v2.mp4`](../out/_rough-cut/rough-cut-structure-draft-v2.mp4)：960×540 / 60fps / 12.4s / 744 帧，ffprobe 通过。它是后续添加声音、接力线和视觉词汇前的时间骨架。
- `lint-anti-ppt _rough-cut` 已通过：状态差 4/4、接力物 4/4、钩子 2/2、无淡出转场。`check _rough-cut` 的单帧与多子帧路径通过，事件密度仍提示 33% 稀薄窗口，后续优先让 `suspend` 段的相机呼吸再明显一点。
- 同轮新增 `seam` 转场，沿一条弯曲结构缝撑开旧画面。GPU 探针已扩展到 48/48 场景，转场模式测试 24 项通过。当前 `_trans-structure` 仍使用 `diamond → corners`，`seam` 先作为可选模式保留。
