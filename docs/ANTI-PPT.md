# 反 PPT 味：用连续世界，而不是页面（`docs/ANTI-PPT.md`）

> 一句话：**PPT 味 = 用「页面」组织信息；去 PPT 味 = 用「连续世界 + 因果运动 + 状态差 + 声音空间」组织信息。**
> 极缓慢的全局漂移只是让页面在动，不是解药 —— 它不会让世界变，只会让画面在动。

## 一、七条原则（判据的语义来源）

1. **写时间轴脚本，不写页面大纲** —— 每行是一个镜头。
2. **每个镜头必须有状态差** —— 位置 / 可见性 / 空间关系 / 材质 / 光照 / 状态至少变一项；只变透明度、缩放**不算**。
3. **每个镜头至少一个有效运动** —— 揭示 / 因果 / 变形；不要用全局缓慢漂移凑数。
4. **用接力物让镜头长在一起** —— 同一个对象跨镜头边界存活、变形、被接住。
5. **文字不要「入场」，要被世界触发** —— 遮挡后显影、光照到才出现、动作留下文字。
6. **声音要有层次，并驱动状态而非位移** —— 环境 / 动作 / 音乐分层；包络驱动光照、材质、景深、曝光。
7. **节奏要敢不均匀、敢停** —— 建立 / 信息 / 冲击 / 呼吸交替；每 10 秒埋一个钩子。

## 二、引擎里怎么声明（两个新字段）

时间线节点（`cut(scene, {…})` 与配置档节点**都支持**）：

```js
cut(title, {
  dur: 4,
  state: { from: ['empty-frame'], to: ['title'], diff: ['visibility', 'light'] },
  relayTo: 'baseline',      // 标题下那条基线 → 下一段变成图表的 x 轴
}),
```

| 字段 | 形状 | 判据怎么用 |
|---|---|---|
| `state` | `{ from: string[], to: string[], diff: string[] }` | `diff` 里至少一项属于**硬集合**（`visibility/position/space/material/light/state/shape/text/focus/topology/ownership`）；只写 `opacity/alpha/fade/scale/zoom/blur` ⇒ 判失败 |
| `relayTo` | 字符串（对象名） | 连续 ≥3 段没有它 ⇒ 判失败（没有东西活到下一镜） |

两个字段都进了 `TIMELINE_KEYS` 白名单，并且**搬到 `build()` 出来的段上**（`seg.state` / `seg.relayTo`）——
量具读的是段，不是配置：这条路径漏一段，声明就等于没写（本轮实测踩过一次）。

## 三、判据：`tools/lint-anti-ppt.mjs`

```sh
node tools/lint-anti-ppt.mjs <任务>              # 结构 5 条 + 声音层次 + 成片运动
node tools/lint-anti-ppt.mjs <任务> --strict     # 状态差要 100%、钩子 0 漏
node tools/lint-anti-ppt.mjs <任务> --json
```

| 判据 | 抓什么 | 门槛 |
|---|---|---|
| C1 状态差 | 没声明 / 只动透明度缩放 | 声明率 ≥70%（`--strict` 100%），且每条 `diff` 命中硬集合 |
| C2 接力物 | 连续三段没有 `relayTo` | 断链最长 ≤2 |
| C3 转场 | `transition: mix\|dissolve`、或有 `overlap` 没 `handlesTransition` | 0 段 |
| C4 节奏 | 镜头时长太均匀（CoV）、30s 内没有呼吸镜头 | CoV ≥0.25、每 30s 一段 ≥2.5s |
| C5 钩子 | 10s 窗口里没有强事件（≤1.2s 冲击段 / 光照·材质变化 / wipe·iris·glitch·pixel） | 漏 ≤25%（`--strict` 0） |
| C6 声音层次 | 只有一条轨 | **只报不 gate** |
| C7 匀速漂移 | 成片帧间差变异系数太低（一直在动但没事件）、长时间完全静止 | CV ≥0.30、最长静止 ≤3.5s |

**歌词片豁免**：过半段带 `params.mode` 时，C4/C5 不 gate —— 切点由歌决定，
那时候该管的是「歌词对得上人声」（`tools/lint-lyric-sync.mjs`）。这条会在输出里写明，不假装通过。

C7 要有成片（`out/<任务>/*.mp4`）才跑；没有时进「没跑」，不当通过。

## 四、参照样本

`tasks/demo/task.config.mjs` 是**全绿的样本**：5 段、每段都写了 `state.diff` 与 `relayTo`，
`node tools/lint-anti-ppt.mjs demo` 应该没有不合格项。新片子照它抄结构。

## 五、当前存量片子的体检结果（2026-11-04 首次跑）

| 片子 | 结论 |
|---|---|
| `demo` | ✓ 全绿（参照样本） |
| `pv-king` | ✗ 状态差 0% / 接力物 46 段全断 —— 但 C7 成片运动 **CV 1.24、最长静止 0.8s**（画面本身是活的，缺的是「世界在变」的声明与接力） |
| `_style-sampler` | ✗ 同上（它是风格对比片，本来就是四页纸，属于**有意为之**的例外） |

⚠ 存量片子不要求立刻回填声明 —— 但**新片子**必须先写这两个字段，否则判据红。

## 六、实施状态（P1 / P2）

- **已落地**：`reveal` / `cascade` / `transform` 三类有效运动模板（参数以 `anim shots <名字>` 为准）。共享舞台和核心物，动作按镜头进度伸缩。
- **已落地**：`TextKit.reveal()` 空间触发文字（`wipe` 遮挡显影 / `light` 光束扫过 / `trace` 动作留字），进度由动作传入；见 §七。
- **P1**：非均匀时长模板 + 呼吸镜头自动插入；
- **P1**：声音层加环境音（现在是 music / vo / sfx 三层，缺 ambient）；
- **P2**：真三维视差与「镜头穿场景」；
- **P2**：后处理「被拍摄感」预设；
- **P2**：`anim check` 里直接跑 C7（现在要单独跑）。

## 七、动作模板与触发文字

`tasks/_action-lab/task.config.mjs` 是 18 秒的动作示例：遮挡板打开 → 核心触碰叶片并逐个翻倒 → 同一轮廓变成波带和圆角方形 → 收回核心。三段共用核心的位置、尺寸与色彩；零 overlap 硬切接力。镜头时长 4.2 / 8.4 / 5.4 秒，包含动作前蓄力、接触回弹、变形中停顿。

```sh
node scripts/anim.mjs check _action-lab --quick
node scripts/anim.mjs video _action-lab --draft --segments 10
node tools/lint-anti-ppt.mjs _action-lab --strict
```

```js
// 配置档的一项。morph 负责图表，transform 负责闭合物体轮廓。
{ type: 'cascade', dur: 6, count: 7, title: '一次触碰，层层传递', world: false }

// shutterProgress 来自遮挡物本身；不要为文字另开一条不同步的时间轴。
type.reveal('发现', x, y, {
  size: 72, align: 'center', color: css(P.bone),
  progress: shutterProgress, mode: 'wipe', direction: 'right',
});
```

`progress` 是有限数（夹到 0..1）；`direction` 可用 `right/left/up/down`。默认按量出的整行宽度裁切，支持 `bounds: {x,y,w,h}` 与世界中的遮挡物共用裁切范围。`light` 的 `beam` 为相对宽度，扫过后文字消失；`trace` 横向按字素完整留下字符，竖向按扫描边缘留下。Canvas 裁切只作用于本次调用，异常也会恢复；不修改前面已经画好的图层。`progress:1` 的 wipe/trace（无显式 bounds）与普通 write 相同。

运动数学回归：`tools/test-action-motion.mjs`；整段 seek / 数值健全：`tools/scene-harness.mjs _action-lab`。无声示例只验证视觉运动，环境音、自动节奏编排与 C7 接线仍在上面的待办中。

## 八、三维解构（deconstruct）

`shot('deconstruct', { spread: 2.15 })`：27 个真实三维圆角模块错峰分离，中心模块保持锚定，镜头在展开后绕到侧面观察内部，再按原拓扑归位。构件、引线和重组共用同一份 `deconstructPose(index,p,spread)`；`spread` 的合法范围为 1.4..2.8，镜头拉远量随展开距离改变。Three.js 提供深度遮挡、材质、真实阴影与投影标注；独立预览为 `tasks/_deconstruct-lab`（10.8 秒）。

```sh
node scripts/anim.mjs still _deconstruct-lab -t 0.7,4.5,6.3,10.5
node scripts/anim.mjs video _deconstruct-lab --draft --segments 10
```
