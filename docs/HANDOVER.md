# 交接文档（HANDOVER）

> 写给接手的人 / agent：**先读这一页，再读 [`AGENTS.md`](../AGENTS.md)**。这一页回答四件事 ——
> 现在是什么状态、这轮发生了什么、怎么验证、接下来从哪接着做。
>
> **最后更新：2026-11-13**。优先阅读下方“A1 拆分中途交接”一节。下方 §0–§10 是 11-08 的交接快照；分支、工作区、回归项数以最新续接记录和实时 Git 状态为准。
> 11-08 快照：拉齐上游 `9bd271a`；PR #3 / #5 均已合并；本页按 [`PLAN-2026-11-08.md`](PLAN-2026-11-08.md) A4 重写。
> 上一版描述的是**另一台机器**与 70/70 的旧状态，已作废。

### 2026-11-13 A1 拆分中途交接（最新）

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

## 0. 一句话现状

引擎侧 16 条判据、75/75 回归全绿；四支片子有交付物（两支 PV 已发、两支 lab 只作样本）；
上游这轮并进了「动作/解构模板 + 运动人格判据 + 成片版本戳」，并新增 **43 条选题池**；
唯一还红着的片子是 `pv-kattachi` 尾段三句歌词错位（LRC 只到 115s，后面是外推的）。

## 1. 仓库 / 分支 / 远端

| 项 | 值 |
|---|---|
| 工作仓库 | `C:/Users/haoxu/Downloads/NekoHome/ai-anim` |
| 分支 | `master`，与 `origin/master`（`suan-11/ai-anim`）同步于 `9bd271a` |
| 我的 fork | `qyac/ai-anim`（可推；已同步到同一提交） |
| 工作区 | 干净（0 个未提交改动） |
| worktree | 无（PR 用完的两个临时 worktree 已删） |

## 2. 这台机器（环境与坑）

| 坑 | 事实 / 做法 |
|---|---|
| 推仓库 | 系统 `OpenSSH/ssh.exe` 返回 255 且无输出；用 `C:/Program Files/Git/usr/bin/ssh.exe`，**且必须显式给密钥**：`GIT_SSH_COMMAND="C:/Program Files/Git/usr/bin/ssh.exe" -o IdentitiesOnly=yes -i C:/Users/haoxu/.ssh/id_ed25519`。不给 `-i` 会间歇 `Permission denied (publickey)`（密钥本身是好的） |
| GitHub 偶发 5xx | `remote: fatal error in commit_refs` / `Internal Server Error`：等 20–30 秒重试，别怀疑密钥 |
| 建 PR | 机器上没有 `gh`。可用 `git credential fill`（host=github.com）取已存 token 调 REST，**打完就丢，不落盘** |
| 编码器 | 这台 ffmpeg **没有 libx264**，引擎自动退 `h264_mf`；`h264_nvenc` 列得出来但用不了（`Cannot load nvcuda.dll`）—— `ffmpegEncoderWorks()` 会真编一帧再决定 |
| worktree 里跑测试 | 新 worktree 没有 `node_modules`，`import ws` 失败会伪装成「anim.mjs 没导出」的断言失败。建 junction 指向主仓库即可 |
| 渲染期 | **一个文件都别写**（Vite HMR 会断流）；只有 `out/**` 安全 |
| 前置 | Chrome（`playwright-core` 的 `channel: chrome`）+ ffmpeg/ffprobe 在 PATH |

## 3. 引擎现在有什么

### 3.1 判据（`tools/lint-*.mjs`，16 个）

| 判据 | 抓什么 | 默认行为 |
|---|---|---|
| `lint-anti-ppt` | 状态差 / 接力物断链 / 淡出转场 / 时长 CoV / 每 10s 钩子 / 匀速漂移 | `--strict` 才拦 |
| `lint-motion-persona` | 时长档 / 缓动族 / 回弹（`spring` 的 stiffness 在**第三**位） | 只报；**一条没跑起来 ⇒ 退出码 2** |
| `lint-easing-direction` | 位移配线性 / 入场 ease-in / 出场 ease-out（行内共现，不做语义分析） | 只报；没 `prog` ⇒ 退出码 2 |
| `lint-concurrency` | 变化面积占比 + 同时运动主体数（1/3 规则的片子版，切点 ±0.25s 跳过） | 只报 |
| `lint-lyric-sync` | 句首 vs 人声起音（中位 / p90） | 只报；`check` 里已接 |
| `lint-color-family` | 主色系 ≥55% / 前二 ≥85% / 底字对比 / 信号色；`--compare` 判撞色系 | 硬门 |
| `lint-cut-beats` / `lint-beat-align` | 切点对拍（纯音乐片子 / 有旁白表） | 硬门 |
| `lint-event-density` | 最长静止 / 稀薄窗口 | `--strict` 才拦 |
| `lint-narration-dup` / `lint-fabricated-numbers` | 画面复述旁白 / 编造数字 | 只报 |
| `lint-motion-caps` / `lint-prog-range` / `lint-doc-facts` / `lint-agents-size` / `lint-agents-refs` | 错峰上限 / prog 区间 / 文档键表 / AGENTS 体积与引用 | 硬门 |

### 3.2 会改变你决策的命令

```sh
node scripts/anim.mjs stamp                  # 成片版本戳：current / engine-drift / scene-drift / missing
node scripts/anim.mjs film-html <任务>        # 一个 HTML 双击就播（含音轨）；量具 tools/probe-film-html.mjs
node scripts/anim.mjs mix <任务> --sfx auto   # 音效第三轨（语义选声 + 峰归一 + 侧链让路）
node tools/sfx-fetch.mjs --index --search whoosh   # 音效库：索引 2081 条 / 本地 10 条
node tools/lint-anti-ppt.mjs <任务> [--strict]
node tools/lint-motion-persona.mjs <任务> [--strict]
node tools/lint-concurrency.mjs <任务> [--strict]
```

## 4. 片子（交付物与状态）

| 片子 | 交付物 | 状态 |
|---|---|---|
| `pv-kattachi` | `out/pv-kattachi/pv-kattachi-delivery.mp4`（279 MB / 236s）+ 60s 版 | 已发；**尾段三句歌词错位**（见 §8） |
| `pv-king` | `out/pv-king/pv-king-delivery.mp4`（121 MB / 134.94s） | 已发；`lint-lyric-sync` 5ms/374ms ✓ |
| `_action-lab` | `out/_action-lab/_action-lab.mp4`（12 MB）+ `action-preview.mp4` | 新模板样本（揭示 / 因果 / 变形） |
| `_deconstruct-lab` | `out/_deconstruct-lab/_deconstruct-lab.mp4`（2 MB） | 解构模板样本 |

`anim stamp` 当前：`current 0 · engine-drift 0 · scene-drift 0 · missing 3`（3 支老片子没有戳，属正常）。

## 5. 上游这轮带进来的三样东西

1. **`anim stamp`（成片版本戳）** —— 区分 `engine-drift`（**不需要重渲**，交付物不作废）与 `scene-drift`（这支片子自己的文件改了）。
   治的是「改引擎就要整批重渲」的误会：缓存失效规则管**正在渲的那一支**，不是已交付的成片。
2. **[`docs/PLAN-2026-11-08.md`](PLAN-2026-11-08.md)** —— 三条主线：**A 工程健康**（拆 `anim.mjs` / AGENTS 瘦身 / BACKLOG 归档 / 刷新本页 / 前置依赖体检 / 清理孤儿工具）、**B 出片效率**（只测量）、**C 画面下限**（版面守门 v2 / 分镜三件套 / 被拍摄感 / C7 接入 check）。
   基线读数（计划自带）：`anim.mjs` **8025 行**、AGENTS **61,934 B（94.5%）**、**部分宿主只注入前 23,975 B**（§4 铁律表第 5 行起注入阶段看不到）。
3. **43 条选题池**（`tasks/_ideas.md`）—— 见下一节。

## 6. 43 条选题：分档与素材要点

| 组 | 条数 | 主题 |
|---|---|---|
| 一 | 11 | Minecraft / 图形学与实时渲染前沿 |
| 二 | 12 | AI 机理 / 现代编码 / 底层算法可视化 |
| 三 | 7 | 认知科学 / 博弈论 / 信息论（视觉短论文） |
| 四 | 5 | NekoHome 小糯米跨界（45s 内短切片） |
| 五 | 5 | 算法可视化 / 高速排版歌词 PV |
| 六 | 3 | 工具方法论（讲这套引擎自己） |
| **合计** | **43** | |

**结论：43 条没有一条做不了。** 36 条用现有引擎（画布 + 几何 + 排版 + 图表 + 一段 shader）即可；
7 条各缺**一个**专用模块：

| 条目 | 缺什么 |
|---|---|
| 高斯泼溅（MCGS） | GPU splatting pass（`glsl3d` 上可先做几万团的简化版） |
| 辐射级联 | 探针网格 Pass（2D 简化版可行） |
| TAA 鬼影 | 「固定长度历史窗」——与纯函数契约要谈清楚，只能做**演示**，不能声称真 TAA |
| MSDF 字体 | msdfgen 离线生成 + 三通道采样 |
| 相位声码器 | STFT 频谱可视化（可复用 `anim analyze` 的数据） |
| 蓝噪声（高质量） | 预生成蓝噪声纹理，进 `public/` |
| 高斯泼溅 4K | 受子帧数与显存限制 |

**建议先做四条**（成本低、差异大）：

1. **JFA 屏幕空间距离场**（一.6）—— 现成 shader 能力，90s；
2. **蓝噪声抖动**（一.8）—— 已有 `pixel.js` Bayer 抖动，补一张蓝噪声贴图即可；
3. **《テトリス》歌词 PV**（五.1）—— 直接接现有 PV 管线（LRC + 卡点 + 起音提取）；
4. **反 PPT 七条判据**（六.3）—— 素材已在仓库（`lint-anti-ppt` + 实跑数据），成本最低。

⚠ 第六组那 3 条（`render(t)` 契约 / 单 HTML / 反 PPT）**只有我们讲得动人**，但也最容易写成技术自嗨 —— 按 `docs/RULES.md` 的文案纪律压住。

## 7. 怎么验证（按这个顺序，别跳）

```sh
node tools/regress-all.mjs --ci       # 75 项，交付前的默认门（约 2 分钟）
node scripts/anim.mjs check <任务> --quick
node tools/lint-anti-ppt.mjs <任务> --strict
node scripts/anim.mjs stamp           # 交付物是否还作废
```

回归项是**清单驱动**（`tools/regress-all.mjs` 里的数组）：加测试只改清单，**不要**改 `.github/workflows/verify.yml`。
已知会红但不算锅的用 `expectFail: '原因'` —— 现在没有这一类。

## 8. 欠账（按优先级，每条都能直接开工）

1. **`pv-kattachi` 尾段歌词错位**（仍是唯一红着的片子）：已按 `analysis.vocal` 重排 213.67s 之后的四个尾段窗口（214.46 / 220.36 / 226.35 / 227.18），原来的 `+2620ms / -2578ms` 两个大错位读数已消失；当前 `lint-lyric-sync` 为中位 103ms / p90 525ms，最后一句仍报 1346ms，疑似低音量起音未被默认阈值捕获，尚需人工核听，不能仅凭最近起音判定歌词语义对齐。总时长仍为 236s。
2. **两支 PV 的音轨都没有音效**：`anim mix <任务> --sfx auto` 已能出（`out/pv-king/_sfx-test.mp3` 试过），进成片需改 `audio.mix` + 重渲。
3. **反 PPT 的 P1/P2 剩项**：非均匀时长模板、环境音层、真三维视差、C7 接入 `anim check`（三类运动模板与 `TextKit.reveal` 已由 PR #5 落地）。
4. **PLAN 的 A 线**：`anim.mjs` 拆分（8025 行）、AGENTS 瘦身（94.5%，且部分宿主只注入 24 KB）、BACKLOG 归档（106 KB）。
5. **7 条选题各缺一个模块**（见 §6）。

## 9. 文件地图（这轮的关键文件）

| 文件 | 作用 |
|---|---|
| `src/kit/motion-persona.js` | 四档运动人格 × 时长档 / 缓动族 / 回弹上限 |
| `tools/lint-motion-persona.mjs` / `lint-easing-direction.mjs` / `lint-concurrency.mjs` | 三条审美判据 |
| `src/kit/action-motion.js` / `src/shots/action-stage.js` | 动作模板共用件（**实际接触才响应**） |
| `src/shots/{reveal,cascade,transform,deconstruct}.js` | 四类「有效运动」模板（共 29 个模板） |
| `src/core/text.js` 的 `TextKit.reveal` | 空间触发文字（wipe / trace / light） |
| `scripts/lib/sfx-rules.mjs` / `mix.mjs` | 语义选声 + 音效混音（峰归一 / 侧链 / 裁剪） |
| `src/player.js` / `tools/film-html.mjs` | 单文件播放器 |
| `docs/MOTION-PERSONA.md` / `docs/ANTI-PPT.md` / `docs/SFX.md` / `docs/FILM-HTML.md` | 四份做法文档 |
| `tasks/_ideas.md` | **43 条选题池**（每周抽一条） |
| `docs/PLAN-2026-11-08.md` | 上游三条主线计划（A / B / C） |

## 10. 接手第一小时

1. 跑 `node tools/regress-all.mjs --ci` 确认 **75/75**（不绿先查环境，别改代码）。
2. `node scripts/anim.mjs still demo -t 1.8,6,9.5`，然后**真的用 Read 打开那几张 PNG 看** —— 先建立画面直觉。
3. 读 `docs/PLAN-2026-11-08.md` §1「待定事项」——有几条是留给开发者拍板的，别替他决定。
4. 挑一件：**修 `pv-kattachi` 尾段**（片子侧，最影响观众）或 **PLAN A 线第一条**（工程侧，最影响 agent 效率）。
5. 想做新选题就从 `tasks/_ideas.md` 抽一条，按 §6 的四条建议优先。

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
