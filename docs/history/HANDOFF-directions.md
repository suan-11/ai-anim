# HANDOFF · 方向与路线：把 anim 当「一个人的内容工厂」（2026-10-25）

> **📦 已归档（2026-11-01）**：原在 `docs/HANDOFF-directions.md`，方向已定案、四阶段路线已基本落地（销账见 BACKLOG §0 与 §1.F），移入 `docs/history/`。
> 归档目录的索引见 [`README.md`](./README.md)；活的待办一律以 [`../BACKLOG.md`](../BACKLOG.md) 为准 —— 别把本文的"留给下一步"当成待办，那是**当时**的状态。

> **【一次性交接文档】** 假设读者看不到产生它的对话。本文记录 **2026-10-25 这一轮的方向结论**：
> 项目定位、外部证据、路线分期、判据，以及**还没拍板的三件事**。
> **待办仍然只以 [`BACKLOG.md`](../BACKLOG.md) 为准**（本轮新增落在 §0 的 P-6/P-7 与 §1.F），
> 本文负责"为什么这么做、怎么算做完"。
>
> 关联：[HANDOFF-spectrum-friction.md](HANDOFF-spectrum-friction.md)（用法摩擦）、
> [PERF.md](../PERF.md)（渲染实测）、[BACKLOG.md §0](../BACKLOG.md)（拍板区）。

---

## 0. 一句话

**这个项目是"一个人的内容工厂"，不是产品。** 唯一的评价标准是两件事：
**每支片子的边际工时**、**画面的下限**。所有"能不能被别人用"的问题（MCP / skill 分发 / 开源 / 商业化）全部延后。

---

## 1. 硬约束（不可改的前提，所有方案都要绕开它们）

| # | 约束 | 来源 |
|---|---|---|
| C-1 | 作者是**高一住校生**，只有周末能干活，**每周末至少 2 支**片子 | 用户口述 2026-10-25 |
| C-2 | 片长 **1–3 分钟**，**1080p60**，发 **B 站** | 同上 |
| C-3 | **画面由 agent 写**（DeepSeek v4.1-flash-1017 / GLM-5.3），作者只审 | 同上 |
| C-4 | **拿不到 Opus 5.5 级模型** ⇒ 不能靠"模型本身好看"，必须靠模板把下限抬起来 | 同上 |
| C-5 | 只自用；**开源延后到"足够完善"** | 同上 |
| C-6 | **当前一支片子至少 3 小时**（顺利时），其中相当一部分是等渲染 | 同上 |
| C-7 | 返工被回避：**"不是重大瑕疵就不返工"**，因为重渲太贵 | 同上 |
| C-8 | 竖屏版需要（B 站竖屏是独立流量池） | 同上 |

---

## 2. 现状读数（全部可在本仓库复现，命令见 §11）

### 2.1 规模与复用

| 读数 | 值 | 出处 |
|---|---|---|
| 已交付真片子 | 7 支（`sodium` `optifine` `bikeshed` `fidus` `nekohome` `beast` `promo`） | `tasks/` |
| 每支场景代码 | **1472–3981 行**（合计约 1.65 万行） | `wc -l tasks/*/scenes/*.js` |
| 场景文件总数 | 120；其中**只有 8 个** import `src/shots/` 模板 | `grep -l "src/shots"` |
| 私有 `_kit.js` 拷贝 | 3 份（`beast` / `fidus` / `nekohome`） | 重复劳动的痕迹 |

### 2.2 "劣质感"的四个可量测来源（这是本轮最重要的发现）

统计对象：`tasks/*/scenes/*.js` 全部 120 个文件。

| 项 | 读数 | 诊断 |
|---|---|---|
| **字号** | **24 种取值**，且集中在 **15–30px**（24px×62 次、30px×60、22px×55、20px×54、19px×45、21px×44）；常规最大 96 | **没有层级**。整屏都是"注释体"，没有"主张"。专业动效 H1 通常 120–160px、正文 40–56、标注 24–28（比例 2.2–2.6×） |
| **线宽** | **0.16–1.9px**，十几种取值，**没有 4px 以上的主笔** | 视觉重量均匀 = 画面平。高级感来自对比：1px 发丝线 + 6px 主笔 |
| **缓动** | `prog()` **304 次**、`smoothstep` 87 次、`spring` **只有 4 次** | 绝大多数运动是匀速/平滑插值 —— 无回弹、无预备、无错峰 = **机械 = 廉价** |
| **质感层** | 默认 `bloom 0.22 / grain 0.014 / vignette 0.40` | 偏"干净"。高级感恰恰来自极轻的瑕疵（颗粒、暗角、边缘微辉光） |

**结论**：画面是"均匀"的，不是"有主次"的。均匀 = 信息图/PPT；有主次 = 动效。
**这不是模型强弱问题** —— DeepSeek/GLM 不会设计，但会**填参数**，所以正确做法是把审美从模型手里拿走，落成 token（§7）。

### 2.3 渲染时间

| 读数 | 值 | 出处 |
|---|---|---|
| `spectrum` 75.83s / 60fps = 4550 帧 | 实测分块总 **1859.5s ≈ 31 分钟**（`maxSamples: 8` ⇒ 2.45 fps） | [HANDOFF-spectrum-friction.md](HANDOFF-spectrum-friction.md) §0 |
| 1–3 分钟片子（3600–10800 帧） | 约 **24–73 分钟/支** | 同上换算 |
| 独显 `--gpu high` | 填充重的段实测 **2.15×** | [PERF.md](../PERF.md) §2 |
| `--scale` | 只接受 **1..4**，**没有草稿/半分辨率档** | `scripts/anim.mjs:910` |
| `fps` | 默认 **60**，是任务字段（可改 30） | `src/tasks.js:21` |
| 块级复用 | `--segments` 能跳"已渲好的块"，但**判断不了哪块变了** ⇒ 改一段要重渲整块 | [BACKLOG P-3](../BACKLOG.md) |

---

## 3. 外部证据（决定"做什么"也决定"不做什么"）

### 3.1 支持我们的架构

| 事实 | 出处 |
|---|---|
| **Opus 5.5 于 2026-09-22 发布**（比 Opus 5 便宜 40%、编码对标 Fable 5.1），随即出现"用代码拍视频"的公开案例潮（HTML Canvas / p5 / Three / Remotion / Manim + 无头浏览器逐帧 + FFmpeg） | <https://www.anthropic.com/claude-opus-5-5> · <https://github.com/joeseesun/opus-video-prompts>（18 份提示词 / 54 个案例） |
| 高分案例的 brief 已经把"最佳实践"写成规格：**纯 `seek(t)`、闭合解弹簧、逐字 stagger 卡 BPM、一台正交相机、4 子帧混合运动模糊、全渲前先导出 8 张静帧查排版** | <https://www.ai-primer.com/creative/stories/claude-opus-coded-motion-graphics> |
| 换句话说：**anim 从第一天起的设计就是这套做法**。别人是"每次让模型重新写一遍"，我们是"写进引擎" | 本轮结论 |
| 同一批案例的作者自陈：**素材库/参考库为空时，输出就是泛泛的** | 同上 |

### 3.2 证明"生成模型吃不掉这块需求"

| 事实 | 出处 |
|---|---|
| 10 个 SOTA 视频生成模型**多数连可读、跨帧一致的屏幕文字都画不出来** | <https://arxiv.org/abs/2505.04946>（T2VTextBench） |
| GPT-5 端到端做数据视频只有 **2.13/5**、执行成功率 48.6–86.2%；换成**声明式 spec + 多 agent** 后 3.89/5、>95% | <https://ar5iv.labs.arxiv.org/html/2609.33403>（DataMagic, IEEE VIS 2026） |
| 新加坡 GovTech 2026-03 实测 Veo / Seedance 2.0 / Kling 3.0：信息型视频存在"可用性鸿沟"（文字漂成外星字形、数字图表不可信）⇒ 改模块化管线 | <https://blog.ai.gov.sg/video-generation-landscape-analysis-the-road-to-informative-video/> |

### 3.3 证明"不要做 VLM 自动门"

| 事实 | 出处 |
|---|---|
| 给 judge 看执行日志后，开源 VLM 把 **78–90% 的画面失败判成通过**；闭环里 judge 通过率 1.00、人工标注 0.28 | <https://arxiv.org/abs/2609.28564>（Don't Read the Log） |
| HeyGen 2026-09 的 Code2Video 基准（168 个动效 brief + 专用 judge）针对的正是"代码能编译但没品味" | <https://www.heygen.com/research/introducing-code2video-benchmark> |

⇒ **"让视觉模型当 gate"砍掉**；只保留"可机械判定"的判据（越界 / 静帧 / 复述 / 数字无出处），这些 `check`/`rhythm`/`layout`/`lint-*` 已经在做。

### 3.4 竞品坐标（决定"不做什么"）

| 项目 | 状态 | 对我们的意义 |
|---|---|---|
| Remotion | 67k stars，极活跃；**官方 MCP 已废弃**，改押 Agent Skills（`npx skills add`）+ WebMCP；≤3 人免费、公司版按用量、Automators $0.01/渲染 + $100/月保底 | 它抢的是"分发与入口"，**我们自用 ⇒ 不跟** |
| Revideo（归 Midrender） | 活跃（v0.11.0，MIT，4.1k stars） | 同类；我们用不上 |
| Motion Canvas | **实质停滞**（最后实质提交 2025-02） | 不再作为对标 |
| Shotstack / json2video / Creatomate / Plainly | 卖"云渲染 + 模板批量"，按分钟/credits 收费 | 不竞争：我们本地、确定、on-prem 天然 |
| Manim | 41.8k stars 活跃，AI 层只有社区实验（manim-mcp 等） | 验证"LLM 写代码→渲染"需求真实 |
| OpenTimelineIO | 本体活跃，但只是交换格式；**没有人做 OTIO-native agent 引擎** | 空白点，但自用 ⇒ 暂不做 |
| 解说视频服务市场 | 3.15B(2025) → 5.97B(2032)，CAGR 9.6% | 只是背景 |

---

## 4. 已拍板的决定（2026-10-25，用户口述）

1. **定位**：内容是自己的，工具也只自己用 ⇒ 评估口径换成"边际工时 + 画面下限"。
2. **开源**：延后，等"足够完善"。
3. **分发层全砍**：MCP server、Skill 包、WebMCP、`anim otio`、跨生态视频 CI、商业化。
4. **画面继续投资**（因为拿不到 Opus 级模型）：方向是**把配方固化成模板与 token**，不是"让模型画得更花"。
5. **VLM 自评当门：砍**（证据见 §3.3）；最多留"自动接触表 + 候选问题清单"当筛片助手。
6. **60fps 保留（P-6 已定，2026-10-25）**：B 站动效内容 60fps 是加分项；省时间靠草稿档 + 增量重渲 + 排队，**不靠降帧率**。
7. **竖屏提前做（P-7 已定，2026-10-25）**：用户原话「竖屏早点好」⇒ 排到 **W4–W5**（tokens 之后、块级增量重渲之前）。
8. **模板扩张可以拆 Opus 5.5 案例（P-8 已定，2026-10-25）**：用户原话「可以拆 Opus 的，只要好的就学」——
   **只学手法与配方，不抄素材 / 不抄文案 / 不抄代码**（与 §1.E、`REFERENCE-*` 的拆解同一条纪律）。
9. 由此定下画面路线的方针：**不是"让弱模型更聪明"，而是"把强模型的好看固化成模板"**（见 §5 Phase 2）。

---

## 5. 路线（四阶段，按"周末能多出一支"排序）

### Phase 1 · 渲染吞吐（先做，收益立刻可感）

| # | 事 | 判据（怎么算做完） |
|---|---|---|
| 1-43 | **睡前排队渲两支** + 完成提示（BEL / 提示音）。一条命令跑完两支队，早上收片 | 周末两天各跑一次"排队渲两支"，全程无人值守、产物 `verify`/`qa` 通过 |
| 1-44 | **草稿档 `--draft`**：半分辨率（960×540）+ `samples 1` + 关颗粒/泛光。用来审节奏与信息密度；定稿仍出 1080p60 | 同一场景：draft 单帧与成片单帧下采样后 PSNR ≥ 30dB（只差分辨率）；实测渲染时间 ≥ 5× 更快（目标 6–8×） |
| 1-45 | **块级增量重渲（P-3 落地）**：按"场景源码 hash + 段参数 hash"判断块是否失效，改一段只重渲受影响块 | 改 1 段后 `video --segments` 只重渲该块；3 分钟片子的返工从 ~70 分钟降到 ≤15 分钟（附实测时间表进 PERF.md） |

**为什么排第一**：C-7（不敢返工）的根因是 C-6（重渲太贵）。这三条把"一支 3 小时"压到"一支 1.5 小时"。

### Phase 2 · 画面下限（"劣质感"→ token）

| # | 事 | 判据 |
|---|---|---|
| 1-46 | **`src/style/tokens.js`**（草案见 §7）+ 进 `AGENTS.md` 的硬规则「一屏只有一个 hero 级元素」 | 5 套风格各出一张样片；`check` 的版面守门不新增假报 |
| 1-47 | **先用一段验证诊断**：拿 `spectrum` 的波形段改写 token 版（只改字号/线宽/缓动，不改内容）出左右对比图 | 左（现）右（token）并排；用户看图判断"是否一眼更高级" —— 不做完这一步不铺开 |
| 1-48 | **模板 11 → 20+**：从 Opus 案例的视觉语言里挑适合科普片的配方（kinetic bumper / device mock / lineart / big-type / scan-grid / countUp / chart-morph / paper-layer / lockup） | 每个新模板有默认参数 + `use/energy/avoid` 元数据 + `tools/test-shots.mjs` 夹具；新片子能用模板覆盖 ≥50% 段落 |
| 1-49 | **母题库**：把 `sodium` 积木 / `spectrum` 波形格阵 / `bikeshed` 会议室抽进 `src/kit/motifs/` | 抽完后那 3 个任务的私有 `_kit.js` 可删；`hashes` 基线可用 `--accept` 记录变化 |

### Phase 3 · 复利与稳定

| # | 事 | 判据 |
|---|---|---|
| 1-50 | **`infoShot` 段落骨架**（标题 + 旁白 cue + 图形区 + 标注 + 出处行的标准段落） | 新片子手写行数占比 < 30%（现在 ≈100%） |
| 1-51 | **判据元测试**：每个守门判据都要有一条"能红"的证明（注入错误 → 必须报） | `regress-all` 新增 `meta:` 组，全部通过；至少覆盖 `check` 背景守门 / `layout` 三条 / `carry` / `rhythm` / `sampling` |
| 1-52 | **竖屏（1080×1920）**（清单见 §8） | `still` 出竖屏样片；版面守门在竖屏下不假报；字幕避开 B 站底部 UI |
| 1-53 | **B 站配套**：`anim cover <任务> -t <秒>`（1920×1080 压字封面）+ 章节时间码导出 | 每支片子上传前 30 秒内能出封面与章节 |

### Phase 4 · 选题（最便宜，别拖到最后）

| # | 事 | 判据 |
|---|---|---|
| 1-54 | **选题池 `tasks/_ideas.md`**：平时随手记一行，周末从池子里抽 | 连续 4 个周末，选题环节耗时 ≤5 分钟 |
| 1-55 | **brief 生成**：让 agent 按 `docs/SCENE-BRIEF-TEMPLATE.md` 一次写全"选题 + FACTS 骨架 + 分段表 + 每段视觉母题"，作者只审 brief | 一份 brief 直接喂给场景 agent，不需要作者补写任何结构性信息 |

---

## 6. 12 周周末排期

> **排序依据（2026-10-25 拍板）**：P-6 保留 60fps、P-7 竖屏提前、P-8 可拆 Opus 案例。
> 于是草稿档与选题被提到最前（它们最快兑现"周末时间"），竖屏插在 tokens 之后。

| 周末 | 做什么 | 当周就能感到的变化 |
|---|---|---|
| W1 ✅ | **1-43 排队渲两支 + 1-54 选题池 + 1-55 brief 生成** —— **已完成 2026-10-25**（`anim queue` / `tasks/_ideas.md` / SCENE-BRIEF §11） | 不用守渲染；选题从"空想"变成"从池子里抽 + 审一份 brief" |
| W2 ✅ | **1-44 草稿档 + 1-47 token 对比图** —— **已完成 2026-10-25**（`--draft` 实测 2.5×·auto 8–24×；`src/style/tokens.js` 与夹具 `tasks/_token-lab/` 与两张对比图） | 一晚上能验 3–5 版；知道"劣质感"到底改哪 |
| W3 | **1-46 tokens 铺进 `src/style/`**，5 套风格各出样片 | 老场景不改内容就变好看 |
| W4–W5 | **1-52 竖屏 1080×1920**（P-7 提前） | 能出竖屏版；版面守门在竖屏不假报 |
| W6 | **1-45 块级增量重渲** | 敢返工（返工从 ~70 分钟降到 ≤15 分钟） |
| W7–W8 | **1-48 新模板 9 个**（可拆 Opus 案例的配方，见 P-8） | 新片子的画面下限抬起来 |
| W9–W10 | **1-49 母题库 + 1-50 `infoShot`** | 每支少写 1000+ 行 |
| W11 | **1-51 判据元测试** | 交付更稳（替代"没有第二个人 review"） |
| W12 | **1-53 封面 + 章节** | 上传更省事；B 站点击率受益 |

> **周末名义工时 3 小时/支 × 2 支 = 6 小时**。按上表逐步落地后目标是 **1.5 小时/支**，
> 省出来的时间用于**多迭代一轮**（而不是多接一支）—— 这是"画面变好看"的唯一可持续路径。

---

## 7. 设计 token 草案（对应 §2.2 的四个来源）

目标：**模型只填名字，不填数字**（C-3/C-4：弱模型不会设计，但会填参数）。

```js
// src/style/tokens.js（草案）
export const TOKENS = {
  type:   { hero: 136, h1: 96, h2: 56, body: 40, label: 24, mono: 22 }, // 比例 2.2–2.6×
  weight: { hero: 800, h1: 700, h2: 650, body: 500, label: 600 },
  rule:   { hair: 1, body: 2.5, hero: 6 },        // 线宽只准这三档
  motion: { enter: 'spring', drift: 'smooth', stagger: 0.07, over: 1.05 },
  pad:    { x: 128, y: 96, block: 48 },            // 内容不超版面 60%
  texture:{ grain: 0.03, bloom: 0.30, vignette: 0.55, ca: 0.08 },
};
```

三条硬规则（进 `AGENTS.md`，由 `check`/lint 提示）：

1. **一屏只有一个 hero 级元素**；其余最多 h2 + label。
2. **线宽只用三档**（`rule.hair/body/hero`），不许写 0.16 / 1.15 这种小数。
3. **入场一律 `motion.enter`（spring）+ 错峰 `motion.stagger`**；`prog()` 只用于"持续变化"（进度条、游标）。

> 为什么这三条有效：§2.2 四行读数分别对应"没有层级 / 没有粗细对比 / 没有回弹 / 没有质感"。
> token 是把这四件事**从 24 种字号、十几种线宽、304 次 `prog` 收紧到几档**。

---

## 8. 竖屏（1080×1920）要动的四处

1. **grid 按画幅走**：`GRID_BASE`（`src/style/index.js`）里的 `pad / top / footerLineY / captionBand` 全按 1920×1080 写死 ⇒ 竖屏要一套独立值，并随 `min(w,h)` 换算。
2. **字号阶梯按短边缩放**：竖屏短边 1080（比横屏 1080 相同，但视觉占位更小），需要 1.3–1.6× 的放大系数，否则字看起来更小。
3. **版面守门**（`src/layout.js`）：`maxBlocks=6` / `maxOffSubject=2` / `maxInFocus=2` 的几何是按横屏标定的，竖屏要重新标定，否则全是假报（**别直接放宽，先量**）。
4. **字幕带**：竖屏字幕抬到底部 60–70%，避开 B 站下方进度条与推荐位；`captions.position` 与 `grid.captionBand` 要一起改。

---

## 9. 拍板记录（三件都已在 2026-10-25 定下）

| # | 问题 | 决定 | 对路线的影响 |
|---|---|---|---|
| **P-6** | 成片要不要保留 60fps | **保留 60fps** | 渲染时间不减半 ⇒ 靠 1-44 草稿档 / 1-43 排队 / 1-45 增量重渲 补回来；`fps` 全局默认保持 60 |
| **P-7** | 竖屏的优先级 | **提前**（W4–W5） | 插在 tokens（1-46）之后、块级重渲（1-45）之前；草稿档也要能出竖屏比例 |
| **P-8** | 模板扩张要不要"拆 Opus 案例" | **可以拆，好的就学** | 1-48 的做法定为"从案例里提取配方 → 用 anim 的 API 重写"；纪律：只学手法，不抄素材/文案/代码 |

> 现在没有待拍板项。下一件要作者决策的事会在 [BACKLOG.md](../BACKLOG.md) §0 出现。

---

## 10. 刻意没做的与原因（免得以后又被翻出来）

| 没做 | 原因 |
|---|---|
| MCP server / Agent Skills / WebMCP / OTIO 导出 | 只有作者一个人用，这些解决"别人怎么发现它"，不解决工时（§4-3） |
| VLM 自动评审当 gate | judge 会把 78–90% 的失败判成通过（§3.3） |
| 开源准备（README/贡献指南/CI） | 用户明确"够完善再开源"（§4-2） |
| 跨生态视频 CI（对任意 mp4 跑 verify/qa） | 同上，是产品化的事 |
| 继续堆"炫技"画面能力 | "画得好"已被商品化（Opus 5.5 潮）；我们拿不到该模型，所以走"模板固化"而不是"画面军备" |
| 30fps 作全局默认 | **P-6 已定：不做**（2026-10-25，成片保留 60fps） |
| AgX tonemap 作全局默认 | 2026-10-24 已实测否决（`sodium` 深色去饱和 14%） |

---

## 11. 复现命令（§2 的每个读数）

```sh
# 2.1 规模与复用
wc -l tasks/*/scenes/*.js | tail -1
grep -l "from '.*src/shots" tasks/*/scenes/*.js tasks/*/task.config.mjs | wc -l
ls tasks/*/scenes/_kit.js

# 2.2 字号 / 线宽 / 缓动（Node 一遍扫完；别用 PowerShell 写文件，见 MEMORY）
node -e "
const fs=require('fs'),path=require('path');const sizes={},ease={};
for(const t of fs.readdirSync('tasks')){const d=path.join('tasks',t,'scenes');if(!fs.existsSync(d))continue;
 for(const f of fs.readdirSync(d)){if(!f.endsWith('.js'))continue;const s=fs.readFileSync(path.join(d,f),'utf8');
  for(const m of s.matchAll(/size:\s*(\d+(?:\.\d+)?)/g))sizes[m[1]]=(sizes[m[1]]||0)+1;
  for(const m of s.matchAll(/(spring\(|smoothstep\(|prog\()/g))ease[m[1]]=(ease[m[1]]||0)+1;}}
console.log(Object.entries(sizes).sort((a,b)=>b[1]-a[1]).slice(0,24));
console.log(ease);"

# 2.3 渲染时间
node scripts/anim.mjs video <任务> --dry-run        # 预估（注意它量的是 samples=1，不是 auto）
node scripts/anim.mjs qa <任务>
```

**今晚就能用的排队渲两支**（睡觉前贴进终端，早上收片）：

```sh
node scripts/anim.mjs video <任务A> --segments 10 --gpu high && \
node scripts/anim.mjs video <任务B> --segments 10 --gpu high
```

> ⚠ 渲染期间**一个文件都别写**（连 `docs/*.md` 也不行，会把私有 Vite 打崩；
> 见 `docs/history/STATUS-rounds-7-10.md` §14.5）。

---

## 12. 相关文档

| 文档 | 讲什么 |
|---|---|
| [BACKLOG.md](../BACKLOG.md) | **唯一待办清单**（本轮新增：§0 的 P-6/P-7、§1.F 的 1-43 ~ 1-55） |
| [HANDOFF-spectrum-friction.md](HANDOFF-spectrum-friction.md) | 《把信号拆开》那一轮的用法摩擦（P-3/P-4/P-5 的来源） |
| [PERF.md](../PERF.md) | 渲染实测与瓶颈 |
| [MOTION.md](../MOTION.md) | 运动规则表（token 的 `motion` 组要在这里对齐上限） |
| [STYLE.md](../STYLE.md) | 风格包（token 的落点） |
| [LAYOUT.md](../LAYOUT.md) | 版面守门（竖屏要重新标定的地方） |
