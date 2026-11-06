# 运动人格与三条「审美判据」（可选声明，不僵化）

> 这套东西回答的是**「这一支片子怎么动」** —— 风格包管视觉（配色/字体/母题），这里管运动。
> 灵感与数值来源：[LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill)（MIT，已 vendor 在 `skills/motion-design/`）。

## 为什么需要

换风格只换**看**，不换**动**。于是同一支片子里每个镜头各弹各的：一个 overshoot 20%、下一个 2%，
观众说不出哪里不对，只觉得「不像一个人做的」。这一层只回答一件事：**属于哪种运动气质**，其余由它给**区间**。

## 用法：一个可选字段

```js
// task.config.mjs
motion: {
  personality: 'premium',   // premium / corporate / playful / energetic
  emotion: 'calm',          // 自由文本，只进报告
  intensity: 1,             // 整体缩放系数（0.7 = 这一档收 30%）
  exempt: ['overshoot'],    // 显式豁免；也可行内写 // motion:allow overshoot
},
```

| 人格 | 时长档 quick / standard / slow（秒） | 回弹上限 |
|---|---|---|
| `playful` | 0.12–0.3 / 0.24–0.5 / 0.4–0.8 | 20% |
| `premium` | 0.3–0.55 / 0.45–0.8 / 0.7–1.4 | 4% |
| `corporate` | 0.18–0.35 / 0.3–0.55 / 0.45–0.9 | 3% |
| `energetic` | 0.08–0.2 / 0.16–0.36 / 0.3–0.6 | 30% |

> 数值是把 skill 里的 UI 毫秒表**换算成秒并向外放宽** —— 参考区间，不是规格。

## 三条判据（默认只报不拦，`--strict` 才当门）

```sh
node tools/lint-motion-persona.mjs <任务> [--strict]   # 时长档 / 缓动族 / 回弹
node tools/lint-easing-direction.mjs <任务> [--strict] # 进 out* · 出 in* · 位移别线性
node tools/lint-concurrency.mjs <任务> [--strict]      # 一屏里有多少东西在动（1/3 规则）
```

| 判据 | 抓什么 | 豁免 |
|---|---|---|
| P1 时长档 | 场景里 `prog(t, a, b)` 字面量跨度太快 / 太慢的比例（>35% 才报） | `exempt: ['duration']` |
| P2 缓动族 | 缓动名不属于这一档；**拼错的**单独点名（会静默退化成 linear） | `exempt: ['easing']` |
| P3 回弹 | `spring(stiffness, damping)` 的预估 overshoot 超上限；`outBack/outElastic` 视为回弹族 | `exempt: ['overshoot']` |
| D1/D2/D3 | 位移配线性 / 入场用 ease-in / 出场用 ease-out（只做行内共现，不做语义分析） | 行内 `// motion:allow easing` |
| C1 同时运动 | 相邻帧变化面积占比 >1/3 或运动主体数偏多（从成片解帧算，切点 ±0.25s 自动跳过） | `--area` / `--blocks` |

## 设计原则（改之前先读）

1. **可选**：不写 `motion` ⇒ 判据退出码 2（skipped），**不假装通过也不扣分**；
2. **区间不是定值**：`intensity` 可整档缩放；阈值都能用命令行覆盖；
3. **可豁免**：`motion.exempt` 或行内注释 —— 等距尺、机械感、匀速滚动屏用线性是**对的**。

## 自检

```sh
node tools/test-motion-persona.mjs    # 32 项（声明解析 / 区间缩放 / overshoot / 扫描器 / 三类方向矛盾 / 豁免）
node tools/test-concurrency.mjs       # 14 项（栅格面积 / 连通分量 / 阈值 / 碎块不计）
```

两条都是纯 JS，不需要 GPU、不联网。
