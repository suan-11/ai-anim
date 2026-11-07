# 参考拆解：LottieFiles/motion-design-skill（动效审美）

> **纪律（与其余 `REFERENCE-*.md` 同一条）**：**只学手法与配方，不抄素材 / 不抄文案 / 不抄代码。**
> 时间：2026-11-06 读的 v1.0.0（`skills/motion-design/SKILL.md` 的 `metadata.version`）。
> 它是 **MIT**，所以这份 vendor 可以直接跟着仓库走（见 `skills/motion-design/LICENSE` 与
> `NOTICE.md`），但引擎侧**只吸收判据与区间**，不把它的文档结构搬进 `src/`。

---

## 0. 一句话结论（先给）

**它是一份"提问清单"，不是规格表。** 我们缺的正是这一层：`AGENTS.md` / `docs/MOTION.md` 只写
**可执行的判据**（上限、比例、时长档），不写「先想清楚要观众感觉到什么」。
→ 落地两件事：`src/kit/motion-persona.js`（四档人格给**区间**，不是定值）+ 三条判据
（`lint-motion-persona` / `lint-easing-direction` / `lint-concurrency`）。

## 1. 它是什么（坐标）

| | |
|---|---|
| 形态 | 一份 skill 目录：`SKILL.md` + `director/`（8 篇导演层）+ `patterns/`（4 篇）+ `reference/`（4 篇） |
| 体量 | 17 个 md，约 1.5k 行；没有代码、没有素材 |
| 内容 | 情绪映射 / 运动人格 / 叙事结构 / 迪士尼 12 原则 / 编排 / 上下文适配 / 缓动与时长表 / 排错 |
| 许可 | MIT（`LICENSE` 与 `NOTICE.md` 随目录走） |

## 2. 值得抄的四件

1. **「运动人格」是一个声明，不是一套参数** —— 用形容词（premium / playful / corporate / energetic）
   给**区间**，镜头落在区间内任意位置。这正好补上「风格包只换视觉、不换运动」的缺口。
2. **时长表按「快 / 标准 / 慢」分三档**，每档给区间而不是单值（`reference/timing-easing-tables.md`）。
   我们换算成秒并**向外放宽**（UI 里 120–180ms 的按钮，在片子里对应 0.2–0.5s 的镜头动作）。
3. **缓动按方向分族**：进场用 ease-out（减速）、出场用 ease-in（加速）、屏上用 in-out。
   这条是 `lint-easing-direction` 的 D1–D3。
4. **「同时运动元素」不超过三分之一** —— 它写成导演口诀，我们做成可测判据（`lint-concurrency`，
   从成片解帧量变化面积占比与连通分量）。

## 3. 不该抄的三件

1. **不搬它的文档树** —— `director/` `patterns/` 是给人读的教学结构，进 `src/` 只会变成没人维护的第二份规范。
2. **不把形容词做成硬开关** —— 人格只决定**参考区间**，写片子的人有权力越界（`motion.exempt` / 行内 `// motion:allow`）。
   「审美参考不该变成物理规格」。
3. **不抄它的绝对毫秒数** —— 那是 **UI 交互**的尺度；片子里的动作普遍慢 2–3 倍，直接照搬会显得局促。

## 4. 落地在哪

| 它的东西 | 我们的位置 |
|---|---|
| 运动人格 + 区间 | `src/kit/motion-persona.js`（`PERSONAS` / `resolveMotion`） |
| 时长档判据 | `tools/lint-motion-persona.mjs` 的 P1 |
| 缓动族判据 | 同文件 P2 + `tools/lint-easing-direction.mjs` |
| 回弹上限 | 同文件 P3（`overshootOf`） |
| 1/3 规则 | `tools/lint-concurrency.mjs` |
| 用法与设计原则 | `docs/MOTION-PERSONA.md` |

回归：`tools/test-motion-persona.mjs` / `tools/test-concurrency.mjs`（纯 JS，无 GPU、不联网）。
