# 参考拆解：Nutlope/hallmark —— anti-AI-slop 设计 skill（网页域）

> 拆解日期 **2026-11-16**。上游：<https://github.com/Nutlope/hallmark>（README 标 Together AI 出品）。
> 主体在 `skills/hallmark/`：`SKILL.md` 17.8 KB + `references/`（gates / craft / layout / anatomy / imagery /
> flow / fonts / data-viz / interaction-and-states + 17 个 macrostructures + 4 个 genres + 50 套 theme /md）
> + `scripts/`（sloplint / capture / theme / refcheck / imagegen 等 Node 工具 + 夹具）。已稀疏克隆对照（6.8 MB）。
>
> 本文只回答一件事：**它有哪些东西是 ai-anim 该拿的**。

---

## 0. 一句话结论（先给）

**不同域，搬「判据组织」，不搬「具体门」。** hallmark 是给**网页/UI** 用的 anti-slop skill，
ai-anim 是**动画引擎** —— 它那 85 条具体门（`overflow-x: clip`、`:focus-visible`、hero 首屏折叠、
禁紫蓝渐变、禁 eyebrow、禁 tracked-caps…）对我们的成片**一条都不适用**。

但它是目前最成熟的一份「**怎么把'反 AI 味'写成可判、可豁免、可计数**」的工程范本。
我们这块（`lint-anti-ppt` / warn-vs-`--strict` / 风格反疲劳 / 自检≤3 轮）已有雏形，缺的正是它的**组织方式**。

---

## 1. 它到底是什么

| 层 | 内容 | 规模 |
|---|---|---|
| 契约 | `SKILL.md`：The Floor（16 条铁律）/ Flow（8 步）/ 7 个 verbs | 17.8 KB |
| 判据 | `references/gates.md`：**85 条编号 gate**，每条带 tier + class + tell + fix | ~24 KB |
| 方法库 | `craft / layout / anatomy / imagery / flow / fonts / data-viz / interaction-and-states / direction / macrostructures(17) / genres(4)` | 20+ 份 |
| 材质 | 50 套 theme（paper / type / colour / surfaces / texture）+ 755 张 CC 照片 | 6.8 MB |
| 工具 | `sloplint.mjs`（静态+渲染两层）、`capture.mjs`、`theme.mjs`、`refcheck.mjs` 等 | Node |

**核心机制**（这是我们该学的部分）：

1. **门分四层**：`Floor`（永不可豁免）/ `Reflex`（模型默认，可豁免但**须记录**）/ `Finish`（工艺细节，只报不阻塞）/ `Ledger`（记账）。
2. **判级**：`FAIL`（Floor，不交付）· `REFLEX`（未回应的 Reflex）· `WAIVED`（豁免成立，可见）· `WARN`（疑似，确认或驳回）· `ANSWERED`（Finish 有记录的理由）· `NOTE`（记账）。
   **关键一句：「0 FAIL 只对 Floor 成立」** —— 判级分离，才让"全绿"有明确含义。
3. **豁免三字段**：`gate + guard 证据 + reason`；理由必须**关于这一页**、与它共享一个词、<24 字/样板话/逐字复用一律拒绝；同一 gate 连豁 3 次 = house style，要进 `design.md`。
4. **编号 tell + fix**，退役编号**永不复用**（同我们的章节锚点）。
5. **预发射 6 轴自评**：Philosophy / Hierarchy / Execution / Specificity / Restraint / Variety，1–5 分，<3 先改再建。
6. **反收敛**：mirror test（相邻 prompt 会不会撞同一套）+ rotation log + **Variety 轴对最近 3 次**。
7. **预算化验收**：一次批检 + 一次批改 + 至多一次确认。

---

## 2. 逐项对照（我们已有 / 缺什么）

| 维度 | hallmark | ai-anim 现状 | 差距 |
|---|---|---|---|
| 反指标 | 85 条编号 tell+fix，sloplint 静态+渲染 | `lint-anti-ppt`（20 项）、`check` 多条判据 | 判据**没编号化**、没统一的 tell/fix 一行式 |
| 门分层 | Floor/Reflex/Finish/Ledger + 6 级判级 | warn vs `--strict`、「没验≠通过」 | **没有显式三层**，全绿含义模糊 |
| 豁免 | 三字段 + guard 证据 + 连豁 3 次升级 house style | `allowOverlap` 等零散豁免，`--accept --note` | 豁免**没统一格式/计数**，易被"骗过 check" |
| 自评 | 6 轴 1–5 分，<3 先改 | brief 阶段（SCENE-BRIEF） | brief **没量化自评** |
| 反收敛 | mirror test + rotation log + Variety 对最近 3 次 | 风格反疲劳（相邻两片换脸） | 只量**风格**，没量**结构**是否撞 |
| 验收预算 | 一批检 + 一批改 + 至多一次确认 | 自检≤3 轮 | 基本一致 |
| 材质库 | 50 主题 + 755 照片 | 32 风格包 + 镜头模板 + kit | 不同域，各有一套 |

---

## 3. 值得拿的三点（落成待办）

### ① 豁免纪律（最值）—— 对应 BACKLOG 1-80
我们的豁免现在是"写个 `allowOverlap` 就完"，hallmark 要求 **guard 证据 + 理由 + 计数**，连豁 3 次升级 house style。
这能堵住「为了骗过 check 乱豁免」—— 正是我们反复踩的坑（`--accept` 无痕、`world:false` 乱写）。
**做法**：给 `check` / `lint-*` 的豁免统一成一个可记录块（判据 id + guard + reason），并统计同一判据的连续豁免次数；≥3 次在 report 里升 house style 警告。

### ② 结构反收敛 —— 对应 BACKLOG 1-81
我们风格反疲劳只管"配色换没换"，hallmark 的 **Variety 轴 + mirror test** 量的是
"分段结构/英雄区/导航/收尾是否跟最近 3 支撞"。这跟 **1-75（风格辨识信号）** 和刚做的 **`anim ref`** 能接上 ——
用 ref 量出的切点/结构做"撞没撞"的参照。
**做法**：给 `anim check`（或新 `anim variety`）加一条"结构指纹"：段长 CoV / 切点类型分布 / 每段运动量向量，
与 `out/_history/` 最近 3 支比对，>N 个维度同构 ⇒ 报"结构收敛"。

### ③ 门分层 + 「0 FAIL 只对 Floor」—— 对应 BACKLOG 1-82
把我们散落的判据显式分成「绝不可过 / 可豁免 / 只报」，让"全绿"这句话有明确含义。
**做法**：给每条判据标 `tier: floor|reflex|finish`，report 汇总时分层计数（`Floor 0 FAIL · Reflex 2 (1 waived) · Finish 3 answered`），与现有的 `--strict` 语义对齐（strict 才把 reflex 当门）。

---

## 4. 明确**不拿**的（避免抄错）

- **85 条具体门**：CSS / DOM / 首屏 / 表单 —— 成片没有这些对象。
- **50 主题 + 755 照片 + 17 macrostructures**：不同域（网页排版 vs 镜头时间线）。
- **`:focus-visible` / reduced-motion / overflow-x**：交互网页的特有约束。
- **Verbs（redesign/audit）**：对源码页面有意义，对成片不是。

> 一句话：**学它怎么组织判据（分层/豁免/计数/反收敛），不学它判什么。**

---

## 5. 落成的待办（BACKLOG §1.H）

| 编号 | 事 | 依据 |
|---|---|---|
| ~~1-80~~ | 豁免纪律：判据 id + guard + reason + 连续豁免计数（≥3 升 house style）。**2026-11-20 已接进 check 的两个判定点**（`layout.overlap` / `background.coverage`），见 [WAIVERS.md](WAIVERS.md) | 本文 §3① |
| 1-81 | 结构反收敛：结构指纹 vs 最近 3 支，>N 维同构报"收敛" | 本文 §3② |
| ~~1-82~~ | 判据分层 tier + 分层计数报告（"0 FAIL 只对 Floor"）。**2026-11-20 已接进 check**（`CHECK_TIERS` + 收尾「判据分层」行），见 [WAIVERS.md](WAIVERS.md) §3 | 本文 §3③ |

---

## 附：来源与许可

- 上游 README 标 **Together AI** 出品；仓库根 `LICENSE`（`skills/hallmark/LICENSE`）。
- 本次拆解读的是 `skills/hallmark/SKILL.md` + `references/gates.md` 的 §1–§4；其余 references 未逐份读透（需要时可再展开）。
- 与 [REFERENCE-garden-skills.md](REFERENCE-garden-skills.md) 同类：**学入口，不学结构**。
