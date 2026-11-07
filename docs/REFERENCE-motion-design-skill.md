# 参考资料：LottieFiles `motion-design-skill`（已 vendor 进 `skills/motion-design/`）

> 来源：[LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill)（MIT，作者 LottieFiles，v1.0.0）。
> 2026-11-06 全文 vendor 到本仓库 `skills/motion-design/`，保留原文与许可（见该目录的 LICENSE 条目在仓库根 LICENSE 之外单列）。
> 这份文档只回答一件事：**它和 `ai-anim` 已有的东西是什么关系，哪些该抄进引擎，哪些不该。**
>
> **纪律（与其余 `REFERENCE-*.md` 同一条）**：**只学手法与配方，不抄素材 / 不抄文案 / 不抄代码。**
> 它是 MIT，所以这份 vendor 可以直接跟着仓库走（见 `skills/motion-design/LICENSE` 与
> `NOTICE.md`），但引擎侧**只吸收判据与区间**，不把它的文档结构搬进 `src/`。

## 一、它是什么

一套 **给 agent 的动效审美操作系统**：

- `SKILL.md`（约 500 行）：8 步 checklist、四种「运动人格」（Playful / Premium / Corporate / Energetic）、
  属性选择、时长与缓动表、常见模式、质量标准；
- `director/`（8 篇）：三支柱（情绪意图 / 视觉叙事 / 运动工艺）、迪士尼 12 原则的 UI 版、情绪→运动映射、编排、叙事结构、语境适配；
- `patterns/`（4 篇）：进场退出、状态反馈（成功/错误/loading/hover）、环境运动、多元素错峰；
- `reference/`（4 篇）：时长与缓动查表、属性选择、质量清单、**毛病排查**（看起来机械 / 太慢 / 太廉价 / 太吵…）。

**关键定位**：它教的是**产品 UI 动效**（毫秒级：hover <100ms、按钮 120–180ms、模态 300–400ms、页面 400–600ms）。
我们是**片子**（秒级：镜头 1–13s、段落 30–60s）。它的**数值表基本不能直接用**，但**判断顺序和分层逻辑**可以。

## 二、和我们已有的东西怎么对（重要：别重复造）

| 它的概念 | `ai-anim` 现状 | 结论 |
|---|---|---|
| 8 步 checklist（先情绪、再人格、再属性、再时长…） | 我们从**段表与参数**出发，没有「意图」这一层；`docs/MOTION.md` §2 有运动规则表 | **缺意图层 —— 值得抄**（见 §三 ①） |
| 四种运动人格（时长/缓动/overshoot 三件套） | 无；风格包换的是**视觉**（配色/字体/母题），不换**运动** | **值得抄**（风格包加一个 `motion` 字段） |
| 三层运动（primary / secondary / ambient） | 有 `worldPass`（环境层）+ 母题，但**没有判据**；`lint-event-density` 只能量「有没有在动」 | 部分有；**判据缺** |
| 1/3 规则（位移 ≤1/3 容器、同时运动元素 ≤1/3） | 无 | 位移靠人看；**同时运动元素可机器量**（见 §三 ③） |
| 缓动方向（进 ease-out / 出 ease-in / 循环 sine / 旋转 linear） | `src/core/util.js` 有 easing 工具，但**没有判据**；`docs/MOTION.md` §3 讲「到达用二值」 | **可机器化**，且我们正好缺（见 §三 ②） |
| 时长 ↔ 距离缩放（50px=0.8× … 全屏 1.8–2×） | 无 | 片子语境下可用「镜头景别 vs 时长」近似，**先不做** |
| stagger 总时长 <500ms | **已有**：`tools/lint-motion-caps.mjs` + `waterfallStagger()`（`docs/MOTION.md` §3.2） | 不重复 |
| overshoot 3–10%（Playful 10–20%） | 无判据 | 可机器化，低成本（扫 `spring(` 参数） |
| 质量清单五档（visual / technical / emotional / performance / a11y） | 我们有一整套硬判据（`check` / `report` / 各种 lint），**比它硬** | 不抄，但 a11y 那条我们确实没有 |
| 毛病排查（机械感 / 太慢 / 廉价 / 太吵 / 没个性） | `docs/DIAGNOSIS.md` 是**引擎错误**词典，不是审美 | **值得抄成一张审美症状表**（见 §三 ④） |
| `prefers-reduced-motion` 替代 | 片子场景不存在该系统偏好；但「同一条片子出无动效版」是我们的空白 | 记进 BACKLOG |

## 三、值得抄的四件事（按性价比排序）

### ① 意图层：给片子声明「运动人格」（**最该先做**）

我们换风格只换视觉；它的观察是：**运动本身要有统一人格**，否则同一支片子里每个镜头各弹各的。
落点：`task.config.mjs` 加一个可选字段（引擎只读、不改默认渲染）

```js
motion: { personality: 'premium', emotion: 'calm' },   // 或 playful / corporate / energetic
```

判据据此给**预算**（时长档、缓动族、overshoot 上限），而不是画面。

### ② 缓动方向判据（可机器化，成本低）

「空间位移用线性」「入场用 ease-in」「出场用 ease-out」这三条，都是**扫源码就能判**的。
我们 `src/core/util.js` 已有 easing，`docs/MOTION.md` 也写了规则，**唯独没人量**。

### ③ 同时运动元素数（1/3 规则的可测版，成本中）

渲染两帧（`t` 与 `t+dt/2`），统计**变化像素的连通块数** ÷ 屏上元素块数。
我们已经有 `dumppx`（裸像素）与 `probe-*` 那一套探针，加一个 `probe-concurrency.mjs` 即可。

### ④ 审美症状表（纯文档，零风险）

把它的 troubleshooting 翻成我们的语境（片子），并入 `docs/MOTION.md` 或新开 §：

| 观众说 | 多半是 | 改法 |
|---|---|---|
| 「像 PPT」 | 每镜各建一套元素、没有接力物 | `state.diff` + `relayTo`（`docs/ANTI-PPT.md`） |
| 「机械 / 不像人做的」 | 全片同一缓动、直线路径、无次级运动 | 换缓动族 + 弧形路径 + 环境层 |
| 「廉价」 | 只有 primary 层、只动透明度 | 加 secondary（阴影/图标反应）+ ambient |
| 「太吵」 | 同时动的东西太多、幅度过大 | 1/3 规则、主体之外压到 10–20% |
| 「太快 / 太慢」 | 时长不在档位、缺 settle | 档位表 + 50–100ms 收尾 |

## 四、不该抄的（以及为什么）

1. **毫秒级数值表**（hover <100ms、模态 300–400ms）：那是 UI 交互时延预算；我们的最小单位是**帧**（1/60s），镜头以**秒**计。
   直接照搬到片子里会得到「一秒钟闪 8 个信息」的东西。
2. **a11y 的 `prefers-reduced-motion`**：片子没有系统偏好；真要对应的是「无动效版导出」，那是另一件事。
3. **五档质量清单当门**：它的清单是**人读**的；我们已经有可执行的 `check` / `report` / 六个 lint，
   再加一层软清单只会让「哪些是真门」变模糊。

## 五、怎么用（对 agent 的要求）

写新镜头／审片子时：

1. 先读 `skills/motion-design/SKILL.md` 的 8 步 checklist，**在场景文件头注释里写一句「这一镜要观众感觉到什么」**；
2. 参数选择查 `skills/motion-design/reference/timing-easing-tables.md`（换算成秒；低于 0.2s 的一律当「帧级抖动」处理）；
3. 排查毛病查 `skills/motion-design/reference/troubleshooting.md`，但**判据仍以我们的 lint 为准**（它只是提问清单）。

### 已经落地的三条（2026-11-06）

| 从它这儿来的 | 我们的落点 | 判据 |
|---|---|---|
| 运动人格（四种气质 × 时长/缓动/回弹） | `motion.personality` 可选声明（`src/kit/motion-persona.js`） | `tools/lint-motion-persona.mjs` |
| 缓动方向（进 out* / 出 in* / 位移别线性） | 无新 API，只量现有写法 | `tools/lint-easing-direction.mjs` |
| 1/3 规则（同时运动元素 ≤1/3） | 从成片解帧算变化面积与主体数 | `tools/lint-concurrency.mjs` |

三条都**默认只报不拦**（`--strict` 才当门）、都可豁免 —— 审美参考不该变成硬规格。

用法与四档区间表：`docs/MOTION-PERSONA.md`；离线回归：`tools/test-motion-persona.mjs` /
`tools/test-concurrency.mjs`（纯 JS，无 GPU、不联网）。

**三条判据在评审后各自补过一处「假绿灯」**（合入时一并生效，别再按老版本复述）：

| 判据 | 曾经的问题 | 现在 |
|---|---|---|
| P3 回弹 | `scanSprings` 按「第 2、3 个数字」取参，抓到的是 `target` 与 `stiffness` ⇒ `spring(dt,1,140,12)` 被读成 `(1,140)`、ζ=70 ⇒ **恒判 0% 回弹** | 按引擎签名 `spring(elapsed, target, stiffness, damping)` 取第 3、4 位；参数是表达式时记「判不了」而不是拿默认值顶替 |
| 扫描范围 | 只收 `.js` ⇒ 纯配置档任务扫到 0 个文件却打 ✓ | 统一 `scenes/**/*.js ∪ *.mjs ∪ task.config.mjs`；全空 ⇒ 退出码 2 |
| 嵌套括号 | 正则 `/prog\(([^)]*)\)/` 在第一个 `)` 处断 ⇒ 写对的缓动名被误报 D1 | 按括号深度切参（同 `lint-prog-range.mjs` 的 `argsOf`） |

⚠ 它是**方法论**，不是引擎契约。任何与 `AGENTS.md` / `docs/MOTION.md` 冲突的地方，**以我们的判据为准**。
