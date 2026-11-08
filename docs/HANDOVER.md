# 交接文档（HANDOVER）

> 写给接手的人 / agent：**先读这一页，再读 [`AGENTS.md`](../AGENTS.md)**。这一页回答四件事 ——
> 现在是什么状态、这轮发生了什么、怎么验证、接下来从哪接着做。
>
> **最后更新：2026-11-08**（拉齐上游 `9bd271a`；PR #3 / #5 均已合并；本页按 [`PLAN-2026-11-08.md`](PLAN-2026-11-08.md) A4 重写）。
> 上一版描述的是**另一台机器**与 70/70 的旧状态，已作废。

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

1. **`pv-kattachi` 尾段歌词错位**（唯一红着的片子）：`lint-lyric-sync` 报 217.08s `+2620ms`、223.77s `-2578ms`、229.32s `+1346ms`。
   原因：QQ 音乐 LRC 只到 115.34s，尾段三句**按字数外推**。修法 = 按人声起音重排尾段 + 重渲（约 100 分钟）。
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
