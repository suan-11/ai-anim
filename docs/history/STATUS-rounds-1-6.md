# STATUS 归档：第一～六轮的详细记录（§1–§13）

> 这是 `docs/STATUS.md` 的**历史归档**：第一～六轮（§1–§13）的详细记录逐字搬到这里，
> **章节号原样保留** —— 仓库里其它文档、注释、提交信息里写的「`docs/STATUS.md` §10」
> 「STATUS.md §6.3」这类引用，仍然可以按同一个 § 号在本文件里找到
> （这些节在原文件里现在只剩索引表里的一行）。
> **当前状态见 `docs/STATUS.md`**（轮次索引）；第七～十轮在 [`STATUS-rounds-7-10.md`](STATUS-rounds-7-10.md)，第十一～十二轮在 [`STATUS-rounds-11-12.md`](STATUS-rounds-11-12.md)。
> 本文与代码不一致时**以代码为准**。
>
> 原文件里的 `## 0. 本轮结论摘要` 是**第一轮**的结论摘要，按内容归到这份归档（见下面 §0）。

---

## §0 第一轮的结论摘要

| 编号 | 问题 | 状态 | 验证方式 |
|---|---|---|---|
| P0-1 | 导出缺 linear→sRGB 编码（导出比预览暗） | ✅ 已修 | 标定夹具逐值比对（188/137/225） |
| P0-2 | 渲染中断仍报「✓ 出片成功」 | ✅ 已修 | 注入式回归 `tools/smoke-interrupt.mjs` |
| P0-3 | `check`/`still` 测不到多子帧路径 | ✅ 已修 | 注入式回归 `tools/smoke-overexposure.mjs` |
| P1-1 | `post.center` 声明了但没接线 | ✅ 已修 | 看图（绕 (200,200) 推近，锚点不动） |
| P1-2 | 没有场景级变换 | ✅ 已加 `ctx.setXform` | 数学单测（误差 9e-13 px）+ 看图 |
| P1-3 | 字体没有任务级入口 | ✅ 已加 `task.fonts` | `tools/probe-fonts.mjs`（宽度≠回退） |
| P1-4 | 转场没有库 | ✅ 已加 `src/core/trans.js` | `tools/probe-trans2.mjs` + 看图 |
| P1-5 | 渲染成本高且不能断点续渲 | ✅ 已加 `video --segments` | 720 帧/12.000s 逐帧核对；重跑 0.2s 全跳过 |
| P1-6 | 推流没有背压 | ✅ 已修 | 见 §7.1（附看门狗误报的修复） |
| **P1-7** | **真 4K（`--scale 2`）矢量不出图** | ✅ **根因定位并修好，`--scale` 已解禁** | 80px 白带子在两个倍率下逻辑位置/尺寸逐像素一致；`demo` 4K 出图看过 |
| P1-8 | `--only` 保留全局时间，几乎总是取到段外 | ✅ 已修 | `--only ribbon -t 1.2` 现在能出图 |
| P2 | 文档里的过时结论 | ✅ 已改 | 见 §6、`HANDOFF.md` 顶部更正 |
| — | `nekohome` 的颜色绕行代码 | ⚠ 待决定 | 见 §8（需要用户拍板，会改动已成片的外观） |

---

## 1. P0-1 导出缺 linear→sRGB 编码

### 1.1 问题

整条渲染链在线性光里跑。浏览器预览经过 `gl.blitPass` 的 `toSRGB()` 编码，**导出没有**：
`gl.readPixels()` 读的是编码前的 `outRT`（线性值），而 `src/app.js` 的 `png()` 与 `stream()` 都走它。

### 1.2 证据（`tasks/_calib` 标定夹具，场景只 `gl.clear` 一个已知线性色）

| 场景线性值 | 修复前导出 | 修复前显示（画布） | 正确 sRGB |
|---|---|---|---|
| 0.5 / 0.25 / 0.75 | **128 / 64 / 192** | 187 / 137 / 224 | 188 / 137 / 225 |
| 0.05 | **13** | 64 | 64 |
| 1.0 | 255 | 255 | 255 |

修复前导出值 = 线性值 × 255（"线性直出"）；显示值 = 正确 sRGB。
复现：`node tools/probe-colorspace.mjs _calib`。

### 1.3 ⚠ 对 `HANDOFF.md` 旧结论的更正（重要）

`HANDOFF.md` 原来写「修好编码后 `tasks/nekohome` 的 `disp/dcss/dscale` 必须回改」。这条的**连带影响写反了**：

- 实测**预览一直是对的**（0.5 显示 187 ≈ 正确 188），错的是**导出**（128）；
- 所以 `_kit.js` 里那三个函数不是"让预览正确"，而是"让没编码的导出看起来正确"，
  代价是 **GLSL/矢量通道偏亮、Canvas2D 通道偏暗**（两边都错，只是错得不明显）。

### 1.4 改了什么

| 文件 | 改动 |
|---|---|
| `src/core/gl.js` | `readPixels(rt, encode)` 新增第二参数：`'none'`（默认，线性原值，给调试）/ `'srgb'`（编码）。新增 `readDisplayPixels(rt)` |
| `src/core/engine.js` | `readPixels()` 改为走 `'srgb'`（导出唯一正确入口）；新增 `readLinearPixels()` 保留线性读回 |
| `src/app.js` | 注明 `png()` / `pixels()` / `stream()` 返回的都是显示空间 |

**没有动** `engine.dumpRT()` / `_dumpStages()`（仍读线性原值，排查需要）。

### 1.5 验收

```
t=0  导出 188,137,225   显示 187,137,224   （一致，误差 ≤1）
t=1  导出 64,64,64      显示 64,64,64
t=2  导出 255,255,255   显示 255,255,255
```

**影响面**：所有历史成片都比设计稿暗，重出会整体变亮。`tasks/nekohome` 的实测平均亮度
从 0.163 级别升到 **0.382** 级别（`check` 输出）—— 这是"修好"，不是"跑偏"。

---

## 2. P0-2 渲染中断仍然报「✓ 出片成功」

`cmdVideo` 原本只看 ffmpeg 退出码，**从不比对帧数**。渲染中途断流（典型触发：渲染期间改
`tasks/` 或 `src/` 下的文件 → 私有 Vite HMR 重载页面 → WebSocket 断开）会留下一个几秒钟的短 mp4
并照样打印 `✓`。

**改法**：`frames < total` 时 `die()`（非零退出）、**删除不完整的 mp4**，并点名最可能的原因。

**验收**（`tools/smoke-interrupt.mjs`，注入式）：起一次真渲染，等推帧开始后 append 一行到
`tasks/_calib/scenes/probe.js`，结果：

```
✗ 只渲染了 32/900 帧，成片不完整，已删除 out\_calib\_calib.mp4。
退出码 1（期望非 0）  → PASS
点名帧数不足  → PASS
清理不完整产物  → PASS
```

> 这个回归脚本**抓到了自己的 bug**：第一版的提示语写着"已删除"，但 `die()` 并没有真的删文件
> （残留 141111 字节的短 mp4）。断言"残留 mp4 大小为 0"才把它暴露出来 ——
> **日志说的话必须与实际行为一致，所以断言要断在行为上，不是断在日志文本上。**

---

## 3. P0-3 `check` / `still` 测不到多子帧路径

`check` 与 `still` 默认 `samples=1`，而出片是 `samples=auto`。「运动模糊求平均整帧过曝 n 倍」
那个 bug **只存在于多子帧路径**，于是 `check` 一路报「没问题」。

**改法**：
- `src/app.js` 的 `stats()` 新增 `blownRatio`（亮度>0.99 占比）与 `clippedRatio`（三通道 253+ 的"死白"占比）；
- `check` 每段渲染**两次**（`samples:1` 与 `samples:auto`），打印两者亮度与实际子帧数；
- 判据：① 单帧近全黑；② 多子帧过曝（>0.99 占 >20% 或死白 >15%）；③ **两条路径亮度差 >1.3×**；
- `still --samples 1` 会打印一行提醒。

> 坑：`lastSamples` 必须在跑完 `auto` 那一帧之后、跑 `samples:1` 之前读——它会被下一次渲染覆盖
> （第一版就踩了，5 段全报「1 子帧」）。

**验收**（`tools/smoke-overexposure.mjs`）：把 `engine.js` 的 `clear(this.avgRT, …)` 注释掉重放历史 bug，
`check` 报出 `kinetic 单帧 0.148 → 多子帧 0.868（5.85×）`、`whip 14.08×`、`outro 13.68×`，退出码 1；
不注入时 `check demo` 退出码 0。

---

## 4. P1-1 / P1-2 / P1-3

### 4.1 `post.center`（绕任意锚点推近）

`pFinal` 里声明了 `uniform vec2 center`，默认值里也有，但 `render()` 的赋值清单**漏了它** →
永远绕画面中心。现在 `PostParams.center` 定义为**逻辑像素、y 向下**（不填 = 画面中心），
在 `Post.render` 里换算成 uv。

**验收**：`_calib` 的 `xf` 场景 `zoom: 1.5, center: [200,200]` —— 左上角 (200,200) 的标记点**原地不动**，
白框向外扩张。见 `out/_calib/xf4/f_0005.500.png`。

### 4.2 `ctx.setXform`（场景级变换）

新增 `SceneCtx.xform` / `ctx.setXform({ x, y, scale, rot, anchor, edge })`。
引擎在 `composite()` 里把**整张前景**（含它自己的文字图层）用一张全屏 Pass 重采样到 `xformRT`
（绝不"读自己写自己"）。`edge: 'clamp'`（默认）画面外夹到边缘，适合整体运镜；
`edge: 'black'` 画面外为黑，适合**视差**（背景不动、只有前景动）。

数学：`xformForward()`（逻辑空间正向）+ 换基到 uv + **求逆**（shader 要的是"输出点采源图哪里"）。
⚠ 换基之后与 y 有关的项会变号，所以不能把正向矩阵直接当采样矩阵用（第一版就是这么错的）。

**验收**：`tools/test-xform-math.mjs` 六组变换最大误差 **9e-13 px**；出图确认平移/缩放/旋转与文字同走。

### 4.3 `task.fonts`（任务级字体）

以前只能用改**全局** `public/fonts/fonts.css` 的办法，两个任务想用不同字体就打架。
现在 `task.config.mjs` 里写：

```js
fonts: './fonts/brand.css'                                  // 自己写 @font-face 的样式表
fonts: ['./fonts/Brand-600.woff2']                          // 字体文件，自动包成 @font-face
fonts: [{ file: './fonts/Brand-600.woff2', family: 'Brand', weight: '600' }]
```

`app.js` 的 `loadTaskFonts()` 在第一帧之前 await 完成（否则离屏截帧会拍到方框）。

**验收**：`tools/probe-fonts.mjs` —— `document.fonts.check()` 为 true，且同一串字用该字体量出的宽度
**不等于**回退字体（629.8 vs 689.5），证明真的换了字形而不是静默回退。

---

## 5. P1-4 转场库 `src/core/trans.js`

从 `tasks/nekohome/scenes/_kit.js` 里把那套**已经验证过**的"一镜到底"配方反向抽进引擎：

| 导出 | 作用 |
|---|---|
| `transitionPass(gl, opts)` | 把上一段那一帧沿摄影机方向**加速甩出去** + 方向拖尾（不是原地淡出） |
| `cameraAt(t)` / `cameraDir(t)` / `cameraPost(t, extra)` | 全片**一台摄影机**，只用整片时间驱动 |
| `enterOffset(t, k, amount)` | 前景从**反方向**落位 |
| `makeTransitionKit(ctx)` | 一句装好；每帧 `tk.openFrame(ctx, 背景Pass)` 即可 |

配方四条（写进了 `AGENTS.md` §11）：全片一层背景、全片一台摄影机、一个走完全片的母题、
交叠期把旧的甩走并让新的反向落位。

**验收**（`tools/probe-trans2.mjs`）：同一时刻渲染"只有 A"与"A+B 交叠"两份，逐像素差分
（两边跑同一套确定性代码，差异只可能来自转场）：A 的领地差异 4.9–9.5%、结束时亮度 21.1%→15.3%、
全程锐利度不塌 → PASS。视觉上见 `out/_calib/trans/`：ALPHA 带着方向拖尾被推走、BRAVO 从反方向带模糊落位。

---

## 6. P1-5 / P1-6 / P1-7 / P1-8

### 6.1 `video --segments`（分段渲染 + 拼接）

```sh
node scripts/anim.mjs video <任务> --segments 4        # 切 4 块；切点优先落在段边界
node scripts/anim.mjs video <任务> --segments 4 --force # 忽略已存在的分块，全部重渲
```

- 已渲好的块**自动跳过**（放在 `out/<任务>/<任务>.parts/`）；
- 音轨单独切一次再和拼好的画面一起封装（比每块带音轨更稳）；
- 帧数不足时**保留**已渲好的块并报错，修完直接重跑即可。

**验收**：720 帧 / 12 秒的片子分 5 块渲完，`ffprobe` 得 `nb_read_frames=720, duration=12.000000`；
再跑一次 0.2 秒全部跳过。

### 6.2 推流背压

`ff.stdin.write()` 的返回值原本被忽略。现在返回 `false`（内核缓冲满）时**停发 ack**，
页面自然停下来等，`drain` 之后再把攒下的 ack 补上。

> 顺带修了一个更严重的**看门狗误报**：原判据是"距上一帧超过 15 秒"，但页面是 `inflight`
> 多帧在途、收满最后几帧后会有一段"等 ffmpeg 排空"的时间 —— 于是正常收尾被判成"渲染停滞"，
> 提前收工。现在判据改成**没有进展**（收帧数与页面 `sent` 都不动）+ 30 秒阈值（`--idle` 可调）。

### 6.3 P1-7 真 4K（`--scale 2`）：这是本轮最大的发现

**症状**：`SCALE=2` 时用 `lines` 画的矢量全部消失（文字、Canvas2D、后处理都正常）。
这正是 CLI 一直**显式拒绝 `--scale`** 的原因，`ENGINE.md`/`AGENTS.md`/`COOKBOOK.md` 都把它写成已知限制。

**根因**：`LineBatch` 的**顶点着色器**用**物理**分辨率换算裁剪空间：

```glsl
vec2 clip = (p / res) * 2.0 - 1.0;   // ✗ p 是逻辑像素，res 是物理分辨率
```

`p` 本来就是逻辑像素，除以物理尺寸后 SCALE=2 时只得到正确 NDC 的一半 → 几何落在别处、
或被裁掉，于是片元着色器**一个像素都没跑到**（实测：诊断版 FS 在 scale 1 命中 82 行、
scale 2 命中 0 行；而 uniform `res`/`PX_SCALE` 在两边都是对的）。

**修法**：顶点着色器改用**逻辑**分辨率，与 SCALE 无关：

```glsl
vec2 clip = (p / RES_LOGICAL) * 2.0 - 1.0;   // ✓
```

**验收**：`tools/probe-ribbon.mjs` —— 一根 80px 纯白矢量带子（逻辑 300–1620 × y 360–440）
在 scale 1 与 scale 2 下量出来**逻辑位置与高度完全一致**（360–439，高 80）；
`node scripts/anim.mjs still demo -t 6.5 --scale 2` 出图确认柱状图的矢量、网格、坐标轴、文字、泛光都在。

**顺手解禁**：`scripts/anim.mjs` 里那段"拒绝 scale>1"的代码删掉了，改成只校验 1..4。

### 6.4 P1-7b GL 程序缓存跨上下文串味

`LineBatch._program()` 用**固定的** `'linebatch_v1'` 当程序缓存键。一个页面里出现第二个 WebGL2
上下文时（页面上另开 canvas、诊断脚本、将来的多视图预览），第二个上下文会从 `gl.programs`
里拿到**第一个上下文的 program 对象** —— 那是别的上下文的对象，画不出任何东西而且不报错。
现在 key 带上 `gl.instanceId` 做隔离。

### 6.5 P1-8 `--only` 的时间语义

`--only` 原本只做"过滤 + 改名"，段的时间仍然是**全局时间**。于是
`still <任务> -t 1 --only chart` 几乎总是取到段外（全黑），还会顺带报一堆"空档"。
现在 `--only` 会把选中的段**平移到时间轴开头**，`-t` 就是段内时间。

**验收**：`still _calib -t 1.2 --only ribbon` 直接出图（带子 360–439）。
⚠ 副作用（已写进 `ENGINE.md`）：段的 `f.t` 变了，而 `music` 仍按整片时间 —— 用 `--only` 迭代时
"踩拍子"的段落和成片对不上，这是刻意的取舍（看单段不要跨到整片时间轴上找）。

---

## 7. 新增的诊断/回归工具（都在 `tools/`，不参与出片）

| 脚本 | 用途 |
|---|---|
| `probe-colorspace.mjs [task]` | 对比"导出（readPixels）"与"浏览器显示（画布）"的像素值 —— 色彩空间标定 |
| `probe-samples.mjs [task]` | 打印各入口实际用掉的子帧数 |
| `probe-timeline.mjs [task]` | 打印页面实际加载到的时间线与探针像素 |
| `probe-ribbon.mjs [t] [scales]` | **4K 验收**：粗矢量带子在两个倍率下的逻辑位置/尺寸 |
| `probe-fonts.mjs [task]` | 任务字体是否真的生效（宽度 ≠ 回退） |
| `probe-trans2.mjs [task]` | 转场是"推走"还是"糊在一起"（确定性 A/B 差分） |
| `test-xform-math.mjs` | `xformMatrix` 纯数学单测（不需要 GPU） |
| `png-rows.mjs <png> [x]` | 直接量一张 PNG 的逐行亮度（判断"那根线到底在不在"） |
| `smoke-interrupt.mjs` | 注入式回归：渲染中断必须非零退出 |
| `smoke-overexposure.mjs` | 注入式回归：`check` 必须挡住"多子帧过曝" |

`tasks/_calib/` 是**标定夹具**（不是片子）：`probe`（已知线性色）、`xf`（变换 + post 锚点）、
`ribbon`（4K 验收）、`trans`（转场）。

### 7.1 用 `png-rows.mjs` 时的坑

它从 `ffprobe` 读真实尺寸。早先的版本写死 1920×1080，读 3840×2160 的 PNG 时会按错误步长
采样，得出"4K 画面全黑"的**假结论**——同一个错误的探针差点让我把已经修好的 4K 判成没修好。

---

## 8. 待用户拍板：`tasks/nekohome` 的颜色绕行代码

`tasks/nekohome/scenes/_kit.js` 顶部有 `disp() / dcss() / dscale()` 三个函数，注释写着
"引擎最后是把线性值当显示值直接写进 8bit 输出的"。按 §1.3 的实测，这个判断只对了一半：

| 通道 | 现在的做法 | 结果 | 改成 `P.xxx` / `css(P.xxx)` 后 |
|---|---|---|---|
| GLSL / `lines` | `disp()` = 显示值当线性值用 | 偏**亮**（bone 约 249 而非 238） | 回到设计稿本来的亮度 |
| Canvas2D 文字 | `dcss()` = 显示值再喂给 `css()` | 偏**亮**（会线性化两次） | 与官网字色一致 |

**为什么没有直接改**：这会让**已经交付的成片外观发生变化**（整体略暗一点点、层次回来），
而且 `tasks/nekohome` 里大量 `dscale(P, …, 1.35)` 这类系数是照着现在的观感调的。
这是"改一个内容已定稿的片子"，不该由我单方面决定。

**两个选项**：
- A：改回 `P.xxx` + `css(P.xxx)`，然后重新出片核对（约 43 分钟 + 一次观感复核）；
- B：保持现状（它能跑、也没有报错），只在 `_kit.js` 里把注释更正为"这是历史绕行，不是设计要求"。

---

## 9. 回归清单（本轮跑过，全部通过）

```sh
node scripts/anim.mjs check demo        # ✓ 5 段，两条路径一致
node scripts/anim.mjs check beat        # ✓ 3 段
node scripts/anim.mjs check nekohome    # ✓ 8 段
node tools/test-xform-math.mjs          # ✓ 最大误差 9e-13 px
node tools/probe-ribbon.mjs 11.2 1,2    # ✓ 两个倍率几何一致（4K）
node tools/probe-trans2.mjs _calib      # ✓ 推走而非糊掉
node tools/probe-fonts.mjs _calib       # ✓ 任务字体生效
node tools/probe-colorspace.mjs _calib  # ✓ 导出=显示
node tools/smoke-interrupt.mjs          # ✓ 中断非零退出 + 真的删掉不完整产物
node tools/smoke-overexposure.mjs       # ✓ 过曝被拦住
node scripts/anim.mjs video _calib --from 0 --to 12 --segments 3 --samples 1 --noaudio
                                        # ✓ 720 帧 / 12.000s，重跑 0.2s 全跳过
node scripts/anim.mjs still demo -t 6.5 --scale 2   # ✓ 真 4K，矢量在
```

> `probe-colorspace` / `probe-ribbon` / `probe-fonts` / `probe-trans2` 跑在 `tasks/_calib` 上，
> 所以那个标定夹具**故意留在仓库里**（它是回归工具的一部分，不是"没删掉的临时任务"）。

---

## 10. 本轮：`docs/IMPROVEMENTS.md` 的 17 条

### 10.0 一句话

**这一轮卡住上一轮的，不是渲染能力，是「引擎不把错误说出来」。** 所以本轮的重点全都落在
**产物与状态的守门** 上：出片产物用 ffprobe 复核、背压不再被误判成卡死、漏画背景能被点名、
诊断命令（`verify` / `hashes` / `probe` / `audit`）补齐。修完的结果是：
**上面那三类"静默产出废品"的情况，现在都会以非零退出码 + 一句点名的话结束。**

### 10.1 逐条状态

| 编号 | 问题 | 状态 | 验收方式（可复现） |
|---|---|---|---|
| P0-1 | `--idle 30` 把 ffmpeg 背压误判成卡死 → 产出没有 moov 的废文件 | ✅ 修 | `node tools/smoke-backpressure.mjs demo 0.5 30 12` |
| P0-2 | 漏画共享背景 → 整段静默黑底，`check` 抓不到 | ✅ 修 | `node tools/smoke-background.mjs` |
| P0-3 | CLI 的「✓ 出片成功」不可信 | ✅ 修 | 见 §10.2；`video`/每块/拼接后都会 ffprobe 复核 |
| P1-1 | 通用镜头工具重复写了三遍 | ✅ 修 | 抽出 `src/kit/`；`fidus` 改为转发后 `hashes --baseline` 逐像素一致 |
| P1-2 | 「一层背景 + 一台摄影机」配方没进引擎 | ✅ 修 | `src/kit/world.js` + `cut(shot,{world:'auto'})`；`demo` 的 `check` 走新路径 |
| P1-3 | `type.write` 的 `alpha` 只在 `stagger>0` 时生效 | ✅ 修 | `node scripts/anim.mjs probe-alpha _calib`（4 项全 PASS） |
| P1-4 | `type.write` 的 `align` 是逐字生效的 | ✅ 修 | 新增 `type.writeLine(text,x,y,{anchor})`；脚手架已改用它 |
| P1-5 | `LineBatch` 没有填充图元；alpha 没写进文档 | ✅ 修 | 新增 `lines.fillRect(...)`；文档补 alpha 说明 |
| P1-6 | `post` 参数没有方向与单位（`fade` 尤其反直觉） | ✅ 修 | `AGENTS.md` §5 / `ENGINE.md` §8 给了 0/1 含义表 |
| P2-1 | `check` 每段只采一个点（正中） | ✅ 修 | 改为 15%/50%/85% 三点 + 段内亮度不均告警 + `--sheet` |
| P2-2 | 没有「成片 vs 静帧」的自动比对 | ✅ 修 | `node scripts/anim.mjs verify <任务>` |
| P2-3 | 耗时没有预估 | ✅ 修 | `node scripts/anim.mjs video demo --dry-run` |
| P2-4 | `--segments` 的语义与注释承诺不符 | ✅ 修 | `node tools/test-segment-cuts.mjs`（4 项/档全 PASS） |
| §4 | 文档与脚手架的事实错误 | ✅ 修 | 见 §10.4 |
| §4 | `FACTS.md` 格式应沉淀 | ✅ 修 | 新增 `docs/FACTS-TEMPLATE.md` |
| §5 | 沙箱/管道的前置条件没写 | ✅ 修 | `AGENTS.md` §1 加了前置条件段 |
| — | `docs/HANDOFF.md` 已过期但被并列引用 | ✅ 修 | 移入 `docs/history/`，链接与顶部说明都改了 |

### 10.2 P0-1 / P0-3：为什么「自己数的帧数」不可信

上一轮的废品是这样产生的：`ff.stdin.write()` 返回 false → 按设计**停发 ack** → 页面（发一帧等一个 ack）
停下来等 → 看门狗的续命判据是「页面侧的 `sent` 在涨」，而页面正在等 ack、`sent` 当然不涨 →
判「渲染停滞」→ 收工 → `stdin.end()` → ffmpeg 拿到半截流、**永远不写 moov**。
日志里进度条跑到 330/330，产物却打不开。

三处改动：

1. **判据改成"四个信号全静止才算卡死"**：收到新帧 / 页面 `sent` 在涨 / ffmpeg 在排水
   （`stdin.writableLength` 在变短，或刚 drain 过）/ 输出文件在变大 —— 任一条成立就续命。
2. **把两种"没帧"分开报**：背压是「在等 ffmpeg 排水」，不是「渲染停滞」。
   上一轮的第一反应是去查页面崩没崩、WS 断没断，全查错了。
3. **产物守门**：每块渲完、拼接完、收尾时都用 `ffprobe` 复核**实际写出来的文件**，
   帧数不符就报错并删掉废产物。`--idle` 默认值也从 30 提到 300。

验收（`tools/smoke-backpressure.mjs`，用 `tools/slow-ffmpeg.mjs` 按字节速率限速以稳定复现背压）：

```
$ ANIM_FFMPEG="node tools/slow-ffmpeg.mjs" ANIM_SLOW_MBPS=12 node tools/smoke-backpressure.mjs demo 0.5 30 12
  15/15 帧  2.4 fps  ETA 0s  背压中(积压 55.4MB)
✓ out/demo/smoke-backpressure.mp4
  15 帧（ffprobe 复核 15 帧），用时 10.1s
退出码 0（期望 0）  → PASS
没有被误判成停滞  → PASS
真的发生了背压  → PASS
产物可打开且帧数正确：ffprobe 15 / 期望 15  → PASS
```

> 守门还当场抓到了我自己的一个 bug：`ffprobe` 的路径推导把包装器名
> `slow-ffmpeg.mjs` 里的 "ffmpeg" 替换成了 "ffprobe"，于是 ffprobe 收到 ffmpeg 的
> `-loglevel error` 参数直接 `Unrecognized option` 退出，守门误报。
> **守门自己出错时必须是"报错"而不是"放行"** —— 这次它报了，所以立刻被看见。

### 10.3 P0-2：怎么把「静默黑底」变成可测的

漏画背景的段，画面看上去有 grain 和暗角，亮度统计也远超"全黑"阈值
（实测 0.054，而判据是 0.004 的 13 倍），所以**亮度判据永远抓不到**。

改法分两层：

**① 地基层：共享背景成为一等公民**

```js
// task.config.mjs
export const world = (ctx) => worldPass(ctx, { grid: 60 });
// 时间线
cut(shot, { dur: 6, world: 'auto' });   // 引擎每帧先铺背景，再调场景 render
cut(shot, { dur: 6, world: false });    // 明确表示"我自己负责整帧"
```

**② 守门层：按「实际发生的绘制」记账**

`gl.js` 里给每次绘制记账（`paint.full` = 不透明全屏覆盖次数、`paint.any` = 绘制总次数、
`paint.lines` = 矢量批次数），引擎在每段 `render` 前后重置并记录。判据：

> 一个**声明了 `handlesTransition`（或共享背景）**的交叠段，在交叠期如果
> **一次整帧覆盖都没有**，那它的底就是黑的。

两个必须踩对的细节（都踩过）：

- **`blend:false` ≠ 铺满整帧**：合成器的图层绘制也是 `blend:false`（它自己保留 rect 外的像素）。
  第一版把它算成"覆盖了整帧"，于是一段**只有文字**的场景被判成合格。
  现在 `Compositor.draw` 显式传 `noFull`。
- **混合状态不能靠猜**：`_notePaint` 原来自已去读 `g.isEnabled(g.BLEND)`，而某次内部 Pass
  会把 BLEND 关掉并留着，于是后面一次带混合的绘制被误记成"覆盖整帧"。
  现在由**调用方**（Pass 知道自己设了什么）显式给出。

验收（`tools/smoke-background.mjs`，往 `_calib` 注入一个"只写字不铺底"的段）：

```
⚠ 背景守门：1/2 个交叠段**没有铺满整帧的背景**
  [bgcheck] t=17.15s  整帧覆盖绘制 0 次（本帧总绘制 1 次），声明了 handlesTransition
    → 这些段的底是纯黑（只有 grain 和暗角），而且亮度统计抓不到。
退出码 1（期望非 0）  → PASS
点名了漏画背景的段  → PASS
```

不注入时：`demo` 1/1 段通过、`nekohome` 7/7 段通过、`_calib` 2/2 段通过。

### 10.4 P1-1 / P1-2：`src/kit/`，以及「怎么证明重构没改画面」

`tasks/nekohome` 与 `tasks/fidus` 的 `_kit.js` 各约 450 行，语义几乎一样的有一大批。
本轮把**通用件**收进引擎（`src/kit/`），任务里只留这支片子特有的视觉：

| 文件 | 内容 |
|---|---|
| `layout.js` | `put` / `writeLine` / `fade` / `typed` / `codeRow` / `seqRnd`（不碰 GPU） |
| `elements.js` | `panel` / `fillRect` / `kicker` / `footer` / `reticle` / `marker` |
| `world.js` | `worldPass` / `cameraAt` / `cameraDir` / `cameraPost` / `enterOffset` / `makeWorldKit` |
| `shot.js` | `makeShot(id, {setup, draw, post})` —— 把"一个镜头的骨架"包成函数 |

**验收方式（这是本轮新增的能力）**：`anim.mjs hashes <任务> --save` 存一份基线
（原始像素 + 每帧 delta 压缩），重构后 `--baseline` 逐像素比对：

```
$ node scripts/anim.mjs hashes fidus --times 0.5,5,12,20,30,40,50,59.5 --save
$ node scripts/anim.mjs hashes fidus --baseline
  t=0.500  ✓ 画面一致  max 2  mean 0.0000  >16 0.0000%
  ...
  t=40.000  ✓ 画面一致  max 6  mean 0.0019  >16 0.0000%
✓ 8 帧全部与基线一致（画面没有被改动）
```

> **判据不是"哈希相等"，而是"差了多少"。** 实测：GPU 在少数 tile 上有最后一位噪声，
> 交叠到 90%+ 的转场帧会把它放大到 max 8–10/255（`demo` 的 t=10/t=12 在同一份基线上
> 反复重渲稳定复现）。判据取「>16 的像素一个都没有 + mean < 0.002」——
> 16/255 已经是看得出来的台阶，而噪声天花板是 10，中间留了一档。
> 一开始用 `max ≤ 2` 判，被自己的噪声打回来了两次。

### 10.5 P2-1 / P2-2：诊断效率

- **`check` 每段采三个点**（15% / 50% / 85%），各测单子帧与多子帧。原因很实在：
  上一轮遇到的压字、漏字、准星压字三个问题，全都出在**入场的头 1 秒**，而旧 `check`
  只采正中——一次都没报。现在还会报「段内亮度不均」（最低 → 最高跨过阈值）。
- **`anim.mjs verify <任务>`**：从成片里抽帧，与同一时刻重新渲染的帧逐像素比。

  两个必须踩对的细节：① `-ss <t> -frames:v 1` 拿到的是"t 之后的第一帧"，会整体差半帧，
  要按**帧中心的 pts** 用 `select` 选；② ffmpeg 的 rawvideo **行序自上而下**，而
  `engine.readPixels()` 是**自下而上**（WebGL 原生）—— 不翻转就会得到
  「mean≈20、31% 像素超阈值」的全线不一致，而两张图肉眼看是同一画面。
  （这条把我骗了三轮，最后是靠"翻转后再比"的对照实验定位的。）

  实测：正确时 `mean 2.7–3.1`（h264 往返的正常代价），拿错片子验时 `mean 25.08`。

### 10.6 §4 文档与脚手架的事实错误（逐条）

| 位置 | 原来 | 现在 |
|---|---|---|
| `anim.mjs new` 的模板 | `scale: 1, // 只能填 1；真 4K（2）有已知问题，CLI 会拒绝` | `scale: 1, // 1..4；2 = 真 4K（矢量/文字/后处理在 4K 下都验过）` |
| 同一个模板 | 没有共享背景的位置 | 注释里给了 `export const world`，时间线用 `{ world: 'auto' }` |
| 脚手架场景 | `align: 'center'` + 逐字动画（会偏） | 改用 `type.writeLine(..., { anchor })` |
| 脚手架场景 | `alpha: [0,1]` 配 `stagger: 0.05`（绕开老 bug） | 干净写法，不再需要 hack |
| `docs/HANDOFF.md` | 与 ENGINE/COOKBOOK/ROADMAP/STATUS 并列，实际已过期 | 移入 `docs/history/`，`AGENTS.md` §9 与 `IMPROVEMENTS.md` 的链接都改了 |
| `AGENTS.md` §5 | post 参数只有名字；`LineBatch` 没提 alpha | 补了 0/1 含义表 + alpha 说明 + `writeLine`/`fillRect` |
| `AGENTS.md` §9 | 没提 `src/kit/` | 补了 `src/kit/` 与 `docs/history/`、`FACTS-TEMPLATE.md` |
| `AGENTS.md` §10 | 「用 ffprobe 核对（别只看 CLI 的 ✓）」—— 把验收推给人 | 改成「CLI 自己会复核」，并补了背景守门与 FACTS 两条 |
| `AGENTS.md` §1 | 没有前置条件 | 补了 Chrome / ffmpeg / 沙箱 `spawn EPERM` / PowerShell 管道 三条 |
| `tasks/<任务>/FACTS.md` | 只有两份实例，无模板 | 新增 `docs/FACTS-TEMPLATE.md` |

### 10.7 本轮新增/修改的工具

| 脚本 | 用途 |
|---|---|
| `tools/smoke-backpressure.mjs` + `tools/slow-ffmpeg.mjs` | P0-1 回归：背压不能被判成停滞（限速 ffmpeg 的输入，稳定复现） |
| `tools/smoke-background.mjs` | P0-2 回归：漏画背景必须被 `check` 点名 |
| `tools/test-segment-cuts.mjs` | P2-4 单测：分块切点只落在安全处、块数合理 |
| `anim.mjs verify` | P2-2 成片验收（抽帧 vs 重渲，逐像素） |
| `anim.mjs hashes [--save/--baseline]` | 重构验收：画面是否逐像素没变 |
| `anim.mjs diff` / `probe` | 确定性定标：同一时刻渲两次差多少 / 渲染顺序会不会改变结果 |
| `anim.mjs audit [--debug]` | 每个交叠段在交叠期到底画了什么 |
| `anim.mjs probe-alpha` | P1-3 验收：`alpha` 是否真的随 t 动画 |
| `anim.mjs dumppx` | 把浏览器那一帧的裸像素吐到文件（排查色彩/翻转这类问题时用） |

### 10.8 本轮跑过的全套回归

```sh
node scripts/anim.mjs check demo          # ✓ 5 段 + 背景守门 1/1
node scripts/anim.mjs check beat          # ✓ 3 段
node scripts/anim.mjs check nekohome      # ✓ 8 段 + 背景守门 7/7
node scripts/anim.mjs probe-alpha _calib  # ✓ alpha 正确随 t 动画（4 项）
node scripts/anim.mjs hashes demo --baseline     # ✓ 9 帧逐像素一致
node scripts/anim.mjs hashes fidus --baseline    # ✓ 8 帧逐像素一致（kit 重构后）
node scripts/anim.mjs probe demo --times 4,12,6  # ✓ 渲染顺序不影响结果
node scripts/anim.mjs verify demo --file out/demo/shot_0-3.mp4 --times 0.5,1.5,2.5 --samples 2
                                          # ✓ mean 2.7–3.1（与重渲一致）
node tools/smoke-backpressure.mjs demo 0.5 30 12 # ✓ 四项 PASS
node tools/smoke-background.mjs                  # ✓ 两项 PASS
node tools/smoke-interrupt.mjs                   # ✓ 非零退出 + 产物被删
node tools/smoke-overexposure.mjs                # ✓ 过曝被拦住
node tools/test-segment-cuts.mjs                 # ✓ 分块规划全部通过
node tools/test-xform-math.mjs                   # ✓ 最大误差 9e-13 px
node tools/probe-ribbon.mjs 11.2 1,2             # ✓ 两个倍率几何一致（4K）
node tools/probe-fonts.mjs _calib                # ✓ 任务字体生效
node scripts/anim.mjs video beat --from 0 --to 4 --segments 2 --samples 2
                                                 # ✓ 240 帧（带音轨）、逐块 ffprobe 通过
```

### 10.9 本轮**没有**解决的一条 ⚠（诚实记录）

`node tools/probe-trans2.mjs _calib` 的**判据②** 报 FAIL：它要求「交叠结束时 A 的领地明显变暗
（< 基线的 75%）」，实测是 `25.32% → 24.79%`。

**结论：这条判据已经过时，但脚本本身还有一个 bug。** 依据有两条，都是实测：

1. 我直接把转场那一步的输出单独量了一遍（把 under 换成纯色、颜色换成 alpha 语义）：
   转场保留量随 k 下降得非常快 —— `k=0.3 → 63%`、`k=0.5 → 16%`、**`k≥0.55 → 4%（≈0）`**。
   也就是说 `k=0.95` 时上一帧早就没了。所以「A 的领地没有变暗」**不是转场没生效**，
   而是那块区域的亮度本来就由 B 自己的背景/元素决定，判据把"世界"和"上一段的内容"混为一谈了。
   → 这个数值我没有改，因为"应该改成什么"需要设计者拍板（是量 A 元素的残留、还是量别的东西）。
2. 脚本的 `region()` 注释写「A 的方块在 (260,220)、文字在 y≈540」，但代码用的是
   `[w*0.06, h*0.14, w*0.36, h*0.5]`（y 0.14–0.64），而且索引按 `（h-1-y)` 取
   —— **行序与注释不符**。同一份脚本里 `probe` 系的其他工具都按自上而下取行。
   → 这条我也没有自行改：改了会让判据变成什么，同样需要先确认设计意图。

**这两条留给下一个会话**：先确认 `probe-trans2` 到底想量什么，再改脚本与判据。
在改之前，请不要把它当作回归清单里的必过项（它不在 §10.8 里）。

> **第四轮的结论（见 §12.3）**：①"行序写反了"这条怀疑**不成立** —— `engine.readPixels()` 是
> **自下而上**（`src/app.js` 有明确注释），脚本里 `(h - 1 - y)` 配"自上而下的逻辑 y"是对的；
> ②判据②失败的真实原因是**量错了东西**（在一片以"全片共用背景"为主的大区域里量平均亮度，
> 背景逐像素一致 ⇒ 永远不变暗）。脚本与判据在第四轮已按"紧盒子 + 模板匹配"重写。

---

## 11. 第三轮：`docs/IMPROVEMENTS-2.md`

### 11.0 一句话

这一轮要修的还是同一类东西，但更靠上游：**引擎不但要"出错时响"，还要"写错时不认"**。
做 `tasks/beast` 那轮最贵的三口 —— 数值型 `alpha` 静默吞掉整块字形、伪时间线被静默接受、
场景抛异常画成一整帧暗红而 `check` 全绿 —— 都属于"看起来完全正常"的失败。
P0 三条的落点就是把它们变成**非零退出 + 一句点名的话**。

| 编号 | 问题 | 状态 | 验收方式 |
|---|---|---|---|
| P0-1 | 数值型 `alpha` 让整个字形**不画** | ✅ 修 | `node scripts/anim.mjs probe-alpha _calib`（6 项全 PASS） |
| P0-2 | `seq()` 接受伪节点，静默退化成假时间线 | ✅ 修 | `node tools/test-timeline-guard.mjs`（16 项全 PASS） |
| P0-3 | 场景抛异常 → 整帧暗红，`check` 全绿 | ✅ 修 | `node tools/smoke-scene-error.mjs`（10 项全 PASS） |
| P1-1 | 分块复用不校验渲染参数 | ✅ 修 | 改 `--samples` 后重跑 → 全部重渲并点名原因 |
| P1-2 | "跨会话不确定性" | ✅ **根因查明：不是引擎的问题，是探针取时错了** | 见 §11.6；`tools/probe-determinism.mjs` |
| P1-3 | `verify` 取时 / 抽帧口径在帧边界上差一帧 | ✅ 修 | 正例全过 + 反例全拦（§11.7） |
| P1-4 | `analyze` 从**混音**里测 bpm，被人声带偏 | ✅ 修 | `audio: { music, vo, mix }`；beast 136 → 120 bpm |
| P1-5 | 口播 / 旁白层缺失 | 🟡 **A 档最小可用已落地**（B/C 档见 §12.2） | 见 §11.15（`test-narration` 32/32、`probe-alpha` ⑦⑧⑨） |
| P2-1 | 并行渲染要手工切区间 + 手工拼接 | ✅ 修 `--parallel N` | `node tools/test-parallel.mjs demo 6`（6 项全 PASS） |
| P2-2 | 渲染期间不能碰工作区，连写文档也不行 | ✅ 修 | `node tools/smoke-worktree-edit.mjs`（8 项全 PASS） |
| P2-3 | `prog()` 的 easing 名写错静默退化成 linear | ✅ 修 | 见 §11.13 |
| P2-4 | `check` 与 `gpu` 的 GPU 串不一致 | ✅ 修 | 两条命令现在都打 ANGLE 全串（§11.11） |
| P2-5 | `out/<任务>/` 堆 GB 级中间产物，无清理提示 | ✅ 修 `anim clean` | `clean demo --dry-run` 列出 423.3 MB |
| P2-6 | `video --out/-o` 没写进 `--help` | ✅ 修 | `node scripts/anim.mjs help` |

### 11.1 P0-1 数值型 `alpha` 是"常量不透明度"，不是"要动画"

**根因**（`src/core/text.js`）：`animated = stagger > 0 || opts.alpha !== undefined`。
数值型 `alpha` 与 `t` 无关，却被算成"要按 t 求进度" → `k = sat((t - 0)/0.45)`，
而 `opts.t` 缺省 0 ⇒ `k = 0` ⇒ `if (k <= 0) continue` ⇒ **这一笔直接不画**。
传 `alpha: 1` 也一样，与"alpha = 1 应该不透明"的直觉完全相反。

**改法**：把两种写法分开，不再混在一个 `animated` 里。

```js
const alphaIsRamp = Array.isArray(opts.alpha);          // [a0,a1]：随 t 插值
const perGlyphAnim = stagger > 0 || alphaIsRamp;         // 只有这两种才需要进度 k
const constAlpha = alphaIsRamp ? 1 : clamp(opts.alpha ?? 1);   // 数值型：常量，乘进 al
```

两个顺手的修正：
· `constAlpha <= 0` 时提前返回，**配对 `c.restore()`**（`c.save()` 已经执行过，直接
  `return this` 会让 Canvas2D 状态栈一帧帧涨上去）；
· `src/kit/layout.js` 的 `fade()` 注释补上"数组型 vs 数值型 alpha 语义不同"。

**验收**（`anim probe-alpha`，在真实引擎里挂临时时间线量亮度，机械判据）：
在原有的 4 项（数组型随 t 动画）之外加了 2 项：

```
⑤ alpha:1（数值）画得出来（t=0 0.06225、t=2 0.06211 > 0.004）  → PASS
⑥ alpha:0.5 是半透明常量（0.04398 在 (0.001, 0.05291) 且 t=2 同值 0.04384）  → PASS
```

复现：改回旧条件后 ⑤ 立刻变 FAIL（t=0 与 t=2 都是 0，字形整个不画）。

### 11.2 P0-2 时间线必须"写错就抛"

**根因**（`src/timeline.js`）：`seq()` 只把数组原样收下，`build()` 里 `walk()` 对不认识的对象
直接当成一个 cut 处理 —— 于是 `{ scene, opt }`（忘了调 `cut()`）被当成 N 段匿名场景，
每段默认 4 秒：`check` 报「时长 48.00s、段名 scene/scene_2/…」，
而真实时间线是 127.5s / 12 个具名段，末尾照样 `✓ 没有发现问题`。

**改法**：
1. `seq()` / `par()` **在构造时**逐项校验（写错的地方离抛错的地方越近越好排）；
2. `build()` 兜底再校验一次（手搓 plan 绕过了第 1 层），并检查整个 plan 的形状与 `kind` 白名单；
3. 报错**指路**：`你是不是忘了调 cut()？把 { scene: SHOT[id], opt: {...} } 改成 cut(SHOT[id], {...})`；
4. `src/tasks.js` 把 `build()` 的异常包成 `tasks/<名字>/task.config.mjs 的时间线不合法：…`；
5. `check` 把**段名 + 时长**逐行摊开打印（以前只有头上一行汇总，假时间线混得过去）。

判据是"必然写错"的两条形状：有 `kind` → 放行；没 `kind` 但有 `scene` → **必须给 `dur`/`end`**
（那才算手写了一整段）。只给 `{scene, opt}` / `{scene}` 一律拒绝。

**验收**（`tools/test-timeline-guard.mjs`，纯 JS 单测，不需要 GPU）：16 项全 PASS ——
伪节点 / `undefined` / 字符串 / 数字 / `seq(非数组)` / `par(非数组)` / 嵌套伪节点 /
`build()` 兜底 / `undefined` plan / 认不出的 `kind` 全部抛错；
正常 `cut()` / `at()` / `par(overlap,…)` / 手写 `{scene, dur}` / `describe()` 不受影响。

### 11.3 P0-3 场景抛异常 = 硬失败，而且必须是"一眼看出崩了"

**根因**（`src/core/engine.js`）：`composite()` 里 `catch` 住场景异常，把整帧
`gl.clear(rt, [0.15, 0, 0])` —— 一层**意思不明的暗红**。三件事同时发生：

1. CLI 的 `check` 只在开头读一次 `info`（装载期的错误），而 render 期的异常是在**那之后**
   产生的 → 三次采样全绿；
2. `video` 完全不看渲染期异常 → 错帧**正常地**流进成片，帧数够、`ffprobe` 也挑不出毛病；
3. 覆盖掉的是一张"看起来像刻意的暗红底"的帧，人眼要抽帧才认得出。

**改法**（四层，缺一层就还会漏）：

| 层 | 改动 |
|---|---|
| 引擎 | 异常记进结构化的 `engine.renderErrors`（段名 / 时刻 / 帧号 / 栈），不再只塞一句字符串 |
| 引擎 | 画**错帧卡片**：暗红底 + 贴边亮红框 + `✗ SCENE ERROR` / 段名 / 帧号 / 异常首行；后处理参数**回默认**（否则暗角把亮红框压成灰暗红，实测 242→106，等于把"明显的错"变回"奇怪的底色"） |
| 推流 | 页面通过 WebSocket 主动推 `{diag:'renderError'}`（**不能用 `page.evaluate` 去问** —— 那会在回 ack 前调用，和同步渲染循环互相等死）；连续 5 帧异常就**停止渲染** |
| CLI | `check` / `still` / `video` / `--segments` 的每一块都在渲染后回读一次；`pageerror` 也算失败 |

产物处理：`video` 判异常**在帧数检查之前**，并且**删掉产物**（帧数可能是齐的）。
分块模式只删出问题的那一块，已渲好的块保留。

**验收**（`tools/smoke-scene-error.mjs`，注入式，建一个临时夹具任务 `_boom`）：

```
① still 必须非零退出并点名 boom          PASS ×3
② check 必须非零退出，并把场景异常当成错误  PASS ×3
③ 那一帧必须是错帧卡片（贴边亮红框 + 暗红底）
     上边框 rgb(229,38,38) / 中心 rgb(61,0,0) / 对比 0.308 vs 0.051   PASS ×3
④ 夹具自检：换成正常场景后 check 回到 0    PASS
```

### 11.4 ⚠ 顺带发现并修掉的一个**真回归**（这条不在 `IMPROVEMENTS-2.md` 里）

修 P0-3 时为了让错帧卡片画进画面，我让 `composite()` 在场景 render 之后统一
`comp.draw(gl, item._layer, rt)` 提交这一段的 Canvas2D 图层。**这一下把所有"一个字都不写、
只 `gl.clear` 一个颜色"的段打成全黑**：

* 现象：`_calib` 的 `probe` / `ribbon` 两段 `check` 读数 **0.000**（而 `xf`/`xa`/`xb` 正常），
  同一条时间线在三个不同 `t` 上 `hashes` **完全相同**；
* 定位：先排除"读回坏了"和"后处理压黑了"（把 `pFinal` 的数学原样搬到 Node 里跑，
  0.05 线性 → sRGB 63，亮度 0.247），再缩小到"只有不写字的段会黑"；
* 根因：图层纹理是**第一次 `upload()` 才 `texImage2D(SRGB8_ALPHA8)` 分配**的。
  没分配过的图层采样结果未定义，这一笔会把整个 rect 写成 0 —— 于是场景刚画的底色被抹掉；
* 修法：提交图层前判 `layer._uploaded`（场景调过 `text.upload()` 才为真）。
  这与历史行为**完全一致**（老的正确写法本来就是"先 upload 再 comp.draw"），
  只是额外把错帧卡片的图层也提交进去（`drewErrorCard` 分支）。

**验收**：`_calib` 的 `probe` 从 0.000 → **0.977**（t=1.5 是纯白帧），`_z` 最小夹具
（只 clear `[0.5,0.25,0.75]`）从 0.000 → **0.603**（正确 sRGB 亮度 0.605）。
最小夹具 `tasks/_z` 用完已删除；这个回归值得记一笔，因为**它差点被当成"标定夹具本来就这样"**。

### 11.5 顺手加的：`check --quick`

冒烟用：每段只在 50% 采一个点、只跑单子帧。用途是"改完引擎先扫一遍有没有哪一段直接抛异常"，
**不替代完整 `check`**（它不看多子帧路径、也不看入场头 1 秒）。
`tools/smoke-scene-error.mjs` 与后续注入式回归都靠它把耗时压到可接受。

### 11.6 ⚠⚠ **重大更正：P1-2 的"跨会话不确定性"不成立 —— 是探针取时错了**

`docs/IMPROVEMENTS-2.md` P1-2 写的是：「同一时刻、从不同起点开渲结果不同 …
从 85s 起渲的成片窗口 vs 从 110s 起渲的同一窗口 = 34.8 dB … **每帧是 t 的纯函数**这句话
在像素层面不成立」。**这条结论是错的**，而且它把我也误导了整整一段（先怀疑自适应采样、
又怀疑音频解码位置、再怀疑渲染历史）。

**真正的证据（绕开编码器，逐字节）**：把推给 ffmpeg 的**原始 RGBA** 落盘
（新增 `video --keep-raw`），再在**另一个会话**里渲同一时刻，逐字节比：

| 实验 | 结果 |
|---|---|
| 推流 60 帧的原始字节 vs 另一会话顺着渲的同一串帧 | **60/60 逐字节相同** |
| 同一条 `video` 命令跑两遍的原始字节 | **完全相同**（`Buffer.equals` = true） |
| 帧序号对应关系（成片第 k 帧 vs raw 第 0..7 帧的差分矩阵） | 干净的对角线 —— **帧序没乱、没丢、没重** |
| `still -t 0.500`（= 成片第 30 帧的采样时刻）vs raw 第 30 帧 | **逐字节相同** |

**那"34.8 dB"到底是什么？** 是**取时差半帧**，与"会话起点"无关：

* 出片那条路（`src/app.js` 的 `stream()`）是 `t = from + i/fps` —— 第 N 帧就是在 **`t = N/fps`**
  （帧的**起点**）渲的；
* 当年的验收探针却按"帧中心"的直觉取 `t = (N+0.5)/fps`（`docs/STATUS.md` §10.5 里
  那条"要按帧中心的 pts 用 select 选"就是错的来源）；
* 引擎的采样时刻**就是调用方给的 t**（`f.t` / `f.lt` 都由它算），所以 `samples>1` 时
  运动模糊的子帧窗跟着 t 走：半帧的偏移 → 子帧窗整体平移 → 运动中的画面差一大截。
  实测同一个帧号 `t=0.5000` vs `t=0.5083`：**mean 8.4、>16 占 8.4%** ——
  和当年那个"35 dB"完全同量级。

**所以修的是"探针"，不是"引擎"**：

| 位置 | 原来 | 现在 |
|---|---|---|
| `ffmpegFrame()` | `select='between(t, t±0.5/fps)'`（闭区间 + 6 位小数） | `select=eq(n\,N)`，N 由**帧号**算 |
| `cmdVerify()` 参考帧 | `t = (N+0.5)/fps`（帧中心） | `t = clipFrom + N/fps`（**帧起点**，与 `stream()` 一致） |
| 默认探针 | 含 `it.start - 1/fps`（正好是帧边界，`floor(t*fps+1e-6)` 会掉到前一帧） | 抬到帧内（`+0.25` 帧） |
| 默认探针范围 | 可能落在成片**外面**（`--to` 出来的片段比任务短）→ 拿"不存在的第 N 帧"去比 | 钳在成片覆盖的区间里，帧号范围二次校验 |

**验收**：`node tools/probe-determinism.mjs beat 1 2`
（推流 raw → 另一会话逐帧 → 逐字节比 → 帧起点 still → 逐字节比 → 不同帧号必须不同）。

```
① 成片第 N 帧 == 另一个会话渲的同一时刻（逐字节）   PASS  60 帧全部逐字节相同
② verify 的帧号抽帧口径：帧起点 still == 成片同一帧  PASS  5 个探针 max 全 0（末帧 28，见下）
③ 不同帧号必须不同                                PASS  mean 36.195
④ 记录"帧内取时偏一点画面就不一样"                  已记录（t=0.500 vs 0.508333 → mean 8.405）
```

> **仍然诚实记录一处**：**末帧**（成片最后一帧）逐字节比 max 28 / mean 5.5 ——
> 边界的子帧取整差一点，肉眼看不出（>64 的像素 0.000%），但它确实不是逐字节相同。
> 我把它留在数据里没有掩盖：判据分开看 `max`（抽错帧 ≈ 230）与 `mean`（子帧差 ≤ 6）。

### 11.7 P1-3 的验收判据为什么从"写死 6"改成 `--tol 18`

修完帧号口径之后，`verify` 在**高频画面**上仍然会误报：`tasks/beat` 的 `intro` 场景是
480 根 2px 细竖线，h264 的 yuv420p 色度二次采样在这种画面上让 mean 到 7.7、>16 占 16.7%
—— 而**同一帧的原始字节与成片是逐字节相同的**（§11.6 ①）。

所以判据不是"渲染对不对"的问题，是"编码器能保住多少细节"的问题。实测三档：

| 情况 | mean | >16 | >64 |
|---|---|---|---|
| 正确匹配（普通画面） | 1.4–4.1 | 0.005–2.4% | 0.000–0.009% |
| 正确匹配（高频细密画面） | 7.0–7.7 | 13.2–16.7% | **0.008–0.024%** |
| 拿错成片 | **26.5 / 43.8** | 31.8 / 73.2% | **13.6 / 16.3%** |

结论：**能分开的判据是 `mean`（差 3–4 倍），不是 `>16`**。默认取 `--tol 18`，
中间留着 2.3× 余量；要更严用 `--tol 6`，或直接 `--samples 1`（那条路上没有子帧近似，
与成片**逐字节相同**，是最强的验收）。

**验收**（同一批命令，正例全过 + 反例全拦）：

```
verify demo --file out/demo/_vfix.mp4 --samples 2   → 4 个时刻全 ✓（mean 1.41/3.28/4.11/7.04）
verify beat --file out/beat/_vtest0.mp4 --samples 2 → 3 个时刻全 ✓（mean 1.67/7.74/4.23）
verify demo --file out/beat/_vtest0.mp4 --times 0.0208,2.0042
                                                    → 2/2 ✗（mean 43.75 / 26.47）← 反例被拦
verify demo --file out/demo/_vfix.mp4 --from 1 --times 0.0208
                                                    → 1/1 ✗（mean 7.68）  ← 帧号口径错也被拦
```

### 11.8 这一轮为定位问题新增的诊断命令（都保留，后面还会用到）

| 命令 | 用途 |
|---|---|
| `video --keep-raw <文件> [--keep-raw-frames N]` | 把**推给 ffmpeg 的原始 RGBA** 另存一份 —— 绕开编码器做对照的唯一办法 |
| `dumpframe <任务> -t … [--run-up] [--via frame\|render]` | 落一张裸帧 + 打印引擎内部量（lastSamples / lastPost / hud…） |
| `dumpframes <任务> --from --to` | 顺着渲一串裸帧（与 `--keep-raw` 逐帧对照）；**必须分批 evaluate**（60 帧 base64 ≈ 660 MB 会撞 `ERR_STRING_TOO_LONG`） |
| `determinism <任务> --from --frames` | 顺向/反向/单次 seek 三种序列的指纹对照，逐帧找分叉点 |
| `window.__animEngine`（`src/app.js`） | 把引擎实例挂出来，诊断脚本要读内部量时用 |

`tools/` 侧：`probe-determinism.mjs`（跨会话确定性复验）、`probe-frame-drift.mjs`（逐帧裸字节对照）、
`probe-stream-raw.mjs` / `probe-stream-raw-scan.mjs`（raw ↔ still 的定位）、`test-timeline-guard.mjs`、
`smoke-scene-error.mjs`。

### 11.9 P1-1 分块复用必须校验渲染参数

**问题**（`IMPROVEMENTS-2.md` P1-1）：`out/<任务>/<任务>.parts/` 里的分块只按时间区间命名，
复用时不看任何参数。做 x264 vs NVENC 对照时第二次运行**秒完成**并报「✓ 出片成功」——
其实那些块是上一次渲的，看起来像"NVENC 快得离谱"。

**改法**：分块目录旁边写一份 `params.json`，指纹由两半组成：

| 半边 | 内容 |
|---|---|
| 渲染参数 | `fps / samples / shutter / scale / vcodec / crf / cq / preset / x264 / tol` |
| 场景签名 | `tasks/<任务>/`（除 audio、fonts）与 `src/` 下所有源文件的 `路径:大小:mtime` |

不匹配就**全部重渲**（用户拍板：不做"部分复用"，混合参数的片子自己都不自洽），并打印差异：

```
⚠ 分块参数与上一次不同，**全部重渲**（不复用旧块）：
  · samples: "1" → "2"
  → 提示：上一次是 fps=60 samples=1 … ；本次是 fps=60 samples=2 …
```

复用命中时会打印当前指纹，避免"我到底复用了什么"这种疑问：

```
[1/4] 0.00–4.00s  已存在，跳过（fps=60 samples=1 shutter=0.5 scale=task vcodec=libx264 crf=16 …）
```

**验收**：同参数重跑 → 4/4 跳过、用时 0.9s；只改 `--samples 1→2` → 4/4 重渲并点名 `samples` 变了。

### 11.10 P1-4 音频分轨：节拍从 music 轨测，混音交给 ffmpeg

**问题**（`IMPROVEMENTS-2.md` P1-4）：引擎只有"一条音轨"的抽象。做带旁白的片子时交进去的
是**旁白 + 配乐**的混音，于是 `analyze` 从混音里测 bpm —— **被人声带偏**：
beast 那轮实测 136bpm，配乐床实际 96bpm。`f.beat` 全错，镜头对不上拍子，
最后只能把母题带的呼吸周期**写死** 0.625s。

**改法**：`task.audio` 支持分轨，缺省规则尽量不让人写全：

```js
audio: './audio/track.mp3'                                        // 老写法：一条轨两用
audio: { music: './audio/beast.mp3',    // ← 只用来分析节拍
         vo:    './audio/beast-vo.mp3',
         mix:   './audio/beast-vo.mp3' }                          // ← 交给 ffmpeg 封装
```

* 分析源 = `music ?? mix ?? vo`；封装源 = `mix ?? music ?? vo`；
* 没有独立 music 轨时**明确警告**"节拍是从人声/混音里测的，`f.beat` 可能不准"；
* 浏览器那侧 `ctx.music`（`f.beat` / `f.a` / `music.*`）一律指向分析源 —— 由
  `src/tasks.js` 的 `normalizeAudio()` 归一，`src/app.js` 不用改语义。

**实测（`tasks/beast` 已改成这个写法）**：

| 分析源 | bpm | 检出 kick 数 | 中位 kick 间隔 |
|---|---|---|---|
| `beast-vo.mp3`（混音，旧的） | **136** | 230 | 0.3251s |
| `beast.mp3`（music 轨，新的） | **120** | 125 | 0.5108s |

> **诚实记录**：music 轨测出的是 120bpm，而 `IMPROVEMENTS-2.md` 里记的配乐床是 96bpm。
> 也就是说**人声污染这一条确实解决了**（136→120、kick 数 230→125 干净了一倍），
> 但分析器自身在 96/120 上仍有偏差 —— 这是 `audio-analysis.js` 的**另一个独立问题**，
> 不在 P1-4 的范围里，留在这里不掩盖。

### 11.11 P2-1 `video --parallel N`：切片并行 + 自动拼接

**改法**：`--parallel 3` → 切 3 段、起 3 个独立子进程（各自私有 Vite + Chrome）、
逐段过 ffprobe 守门、最后自己拼好。切点复用 `planSegmentCuts()`（**只落在段边界、
且不在转场交叠里** —— 在转场中间切，那一段开头拿不到上一帧，甩镜缺一半）。

**踩到的坑（这次实测确认了文档里那条建议）**：拼接**必须带 `-copyts`**。

| 拼接方式 | avg_frame_rate | duration | 说明 |
|---|---|---|---|
| `concat` 不带 `-copyts` | `43200/719` ≈ 60.08 | 11.983 | 接缝处时间戳错开 |
| 各段先转 MPEG-TS 再 `concat` | `43200/719` ≈ 60.08 | 11.983 | 同样不均匀 |
| **`concat` + `-copyts`** | **`60/1`** | **12.000000** | ✅ 用这个 |

这类废品很阴：**帧数是 720 没错、能播、但帧在时间轴上不是均匀铺开的**。
所以顺手给 CLI 加了一条 `checkTimestamps()` 守门（首帧 PTS + 帧距 + 逐帧数出来的帧数），
`--parallel` 与 `--segments` 两条拼接路径都过它。

> 这条守门自己出过两次假警报，都记下来免得下次再踩：
> ① `ffprobe` 的 csv 输出在 Windows 上带 `\r`，`Number('2.000000\r')` 是 NaN，
>    一半读数被当成无效值丢掉 → 报出"缺一帧"的假问题；
> ② `-read_intervals %+#N` 在 N 超过剩余帧数时**不截断，而是把第一帧重复 N 遍** →
>    数组里两个 `0.000000` 挨着，被算成"帧距 0、差了一整帧"。
>    现在改用 `-of default=nw=1` 并**按值去重**（真实视频不可能有两帧同 PTS）。
> **教训：守门判据自己也要能证伪** —— 我在 `-copyts` 上白折腾了一轮，只因为判据在骗我。

**验收**（`node tools/test-parallel.mjs demo 6`，用 libx264 排除编码器噪声）：

```
串行：360 帧  avg 60/1  duration 6  首帧 PTS 0
并行：360 帧  avg 60/1  duration 6  首帧 PTS 0
  PASS  帧数一致
  PASS  并行版首帧 PTS = 0
  PASS  并行版平均帧率 = 60/1
  PASS  并行版 duration = 6
  PASS  逐帧 PSNR 56.507192（>45 即"画面上是同一支片子"）
```

### 11.12 P2-2 渲染期间的工作区：放宽 watch + 模块图 mtime 守门

原来 `vite.config.mjs` 的 `watch.ignored` 只有 `**/out/**`，于是 25–60 分钟的长渲染期间
**连往 `docs/` 写一个 markdown 都不敢**（一改就 HMR 重载 → WebSocket 断流 → 推帧提前结束，
而 CLI 还报 ✓）。

两层改法：

1. **放宽 watch**：把确定不在模块图里的东西全部排除 —— `**/*.md`、`docs/`、
   `tasks/*/audio/`、`tasks/*/fonts/`、`FACTS.md`、`SCRIPT.md`、`timing.{json,mjs}`、
   `**/*.analysis.json`、`**/*.rgba`、`**/*.yuv`。
   真正在模块图里的（`src/`、`tasks/*/scenes/`、`task.config.mjs`）**故意不排除**。
2. **模块图 mtime 守门**：渲染开始/结束各取一次 `src/` + `tasks/` 下源文件的 mtime，
   变了就**点名是哪个文件**，并**删掉产物 + 非零退出**（帧数可能是齐的，
   但画面混合了两个版本，不该被当成成片）。

**验收**（`tools/smoke-worktree-edit.mjs`，一次真渲染中途动工作区）：

```
PASS  推流已经开始（浏览器已连接）
PASS  渲染确实在推进（≥60/480 帧）
A) 渲染中途往 docs/ 写 markdown …
PASS  写 docs/ 之后帧数继续涨（60 → 120）      ← HMR 放宽生效
PASS  没有出现"停滞/断流/推流失败"
B) 再改 tasks/demo/scenes/chart.js …
PASS  CLI 报出了"渲染期间源文件被改动"
PASS  并且点名了具体文件名
PASS  退出码 1（混合了两个版本的产物不该被当成成片）
PASS  那个可疑的产物已经被删掉
```

> 这个 smoke 自己也踩了一次：第一版在渲染**开始前**就把场景文件改名备份，
> 结果模块图直接加载失败、渲染根本没起来（测试等超时）。现在改成"开始时不动文件、
> 推帧跑起来之后再追加"，并且注入的那一行是**幂等清理**的（上一次被中断也不会污染源文件）。

### 11.13 P2-3 / P2-4 / P2-5 / P2-6

| 编号 | 改法 | 验收 |
|---|---|---|
| P2-3 | `prog()` / `keys()` 遇到不认识的缓动名时 `console.warn` **一次**（同名去重），并列出可用名 | 见 §11.13 下面的说明 |
| P2-4 | GPU 信息在 `gl.js` **一处采集**（`rendererInfo` / `rendererLabel`），`check` 与 `gpu` 都读它；拿不到 unmasked 时明确写"（unmasked renderer 不可用）" | 两条命令现在都打 `ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 …, D3D11)` |
| P2-5 | 新增 `anim clean <任务>`：默认只删分块 / 裸帧 / `_stitched.mp4`（**不动成片与 stills**），`--all` 才删成片，`--dry-run` 只列清单；`video` 收尾时打印中间产物体积与清理命令 | `clean demo --dry-run` 列出 `423.3 MB / 6 个文件`；真删后打印释放量 |
| P2-6 | `--out/-o`、`--parallel`、`--keep-raw`、`--quick`、`clean` 等全部写进 `--help`（help 自动打印文件头 JSDoc，所以只改一处） | `node scripts/anim.mjs help` |

**P2-3 的验收**（`prog` 是纯函数，直接在 Node 里跑即可 —— 但要绕开 Vite 的 `import.meta`，
所以验的是同一段逻辑）：

```js
// src/core/util.js 的 prog()
prog(t, 0, 1, 'outCubicc')   // → console.warn: 未知的缓动名 "outCubicc"（prog）—— 已退化成 linear
prog(t, 0, 1, 'outCubicc')   // → 不再重复警告（同名去重）
```

### 11.14 本轮新增的命令与开关一览

| 命令 / 开关 | 用途 |
|---|---|
| `video --parallel N` | 切片并行渲染 + 自动拼接（P2-1） |
| `video --keep-raw <文件>` | 把推给 ffmpeg 的原始 RGBA 另存（绕开编码器做对照） |
| `clean <任务> [--all\|--dry-run]` | 清中间产物（P2-5） |
| `determinism <任务> --from --frames` | 顺向/反向/单次 seek 三种序列的指纹对照 |
| `dumpframe` / `dumpframes` | 落裸帧（单张 / 一串），配 `--keep-raw` 做逐字节对照 |
| `check --quick` | 每段一个点、只跑单子帧的冒烟检查 |
| `verify --from --samples --tol` | 成片验收：按帧号抽帧 + 可调阈值 |
| `task.audio` 的 `{ music, vo, mix }` | 音频分轨（P1-4） |

对应的 `tools/` 回归脚本：`test-parallel.mjs`、`smoke-worktree-edit.mjs`、`smoke-scene-error.mjs`、
`test-timeline-guard.mjs`、`test-narration.mjs`、`test-easing-warn.mjs`、`probe-determinism.mjs`、
`probe-frame-drift.mjs`、`probe-stream-raw*.mjs`。

### 11.15 第三轮回归清单（⏸ = 本会话被叫停时正在跑，下次请接着跑完）

```sh
# —— 纯 JS 单测（不需要 GPU）——
node tools/test-timeline-guard.mjs    # ✅ 16/16 通过（P0-2）
node tools/test-easing-warn.mjs       # ✅ 7/7 通过（P2-3）
node tools/test-narration.mjs         # ✅ 32/32 通过（P1-5 纯函数部分）
node tools/test-xform-math.mjs        # ✅ 最大误差 9.09e-13 px（旧回归，未受影响）
node tools/test-segment-cuts.mjs      # ✅ 分块规划全部通过（旧回归，未受影响）

# —— 注入式 / 端到端回归 ——
node tools/smoke-scene-error.mjs      # ✅ 10/10 通过（P0-3）
node tools/smoke-background.mjs       # ⏸ 上次跑的输出是 "✗ 有 4 个问题 / 退出码 1（期望非 0）→ PASS /
                                      #    点名了漏画背景的段 → PASS"，但**末行总结没读到**就被叫停了。
                                      #    这个脚本是"注入一个漏画背景的段、要求 check 挡住"，
                                      #    前两项已经 PASS，估计是 PASS；重跑一次确认末行即可。
node tools/smoke-overexposure.mjs     # ⏸ 同上，只读到 "总判定：PASS ✓ check 能挡住这个 bug / 已还原 engine.js"，
                                      #    看起来是 PASS，重跑一次拿完整输出。
node tools/smoke-worktree-edit.mjs    # ✅ 8/8 通过（P2-2）
node tools/smoke-interrupt.mjs        # ⏸ 本轮尚未重跑（P0-2 旧回归，改动没碰那条路）
node tools/smoke-backpressure.mjs     # ⏸ 本轮尚未重跑（旧回归；需要 ANIM_FFMPEG 限速包装器）

# —— 引擎级 ——
node scripts/anim.mjs probe-alpha _calib
    # ✅ 9/9 通过：①②③④ 数组型 alpha 随 t 动画（P1-3）
    #              ⑤⑥  数值型 alpha 是常量不透明度（P0-1）
    #              ⑦⑧⑨ 旁白层接线（P1-5）
node tools/probe-determinism.mjs beat 1 2
    # ✅ 全部通过：60 帧原始字节跨会话逐字节相同；帧起点 still == 成片同一帧（P1-2 的更正）
node tools/test-parallel.mjs demo 6   # ✅ 6/6 通过（P2-1）
node tools/probe-ribbon.mjs 11.2 1,2  # ⏸ 本轮尚未重跑（真 4K 旧回归）
node tools/probe-fonts.mjs _calib     # ⏸ 同上
node tools/probe-colorspace.mjs _calib# ⏸ 同上
node tools/probe-trans2.mjs _calib    # ⏸ 同上（这个脚本本身还有一条过时判据，见 §10.9）
node tools/probe-stream-raw.mjs       # 诊断工具，不是回归

# —— 逐任务 check（改了引擎，三个任务都要过一遍）——
node scripts/anim.mjs check demo --quick
node scripts/anim.mjs check beat --quick
node scripts/anim.mjs check _calib --quick      # ✅ 本会话跑过：probe 0.977、xf 0.096、ribbon 0.126 …
node scripts/anim.mjs check nekohome --quick    # ⏸
node scripts/anim.mjs check fidus --quick       # ⏸
node scripts/anim.mjs check beast --quick       # ✅ 本会话跑过（12 段、127.5s、bpm 120），退出码 1 是
                                                #    check 报的别的问题，需看一眼是不是新引入的

# —— 画面没变（重构验收）——
node scripts/anim.mjs hashes demo --baseline    # ⏸ 本会话为了修 chart.js 污染重存过基线，
                                                #    现在 out/demo/hashes.json 是**当前**画面的基线，
                                                #    再跑 --baseline 只能自比。
node scripts/anim.mjs hashes fidus --baseline   # ⏸ 同上待跑
```

### 11.16 下次会话的**建议起点**（本会话被叫停时的位置）

1. **先把 §11.15 里标 ⏸ 的跑完**，重点是 `smoke-background` / `smoke-overexposure` 的末行总结、
   以及 `check fidus` / `check nekohome`（这两个任务本轮完全没验过）。
2. **`check beast` 退出码 1 要复查**：本会话跑 `check beast --quick` 时它报了问题（时间线与
   bpm 都正常），看起来不像本轮改动引入的，但没来得及看是哪些问题。
3. **`tasks/beast` 的 `task.config.mjs` 已改成音频分轨写法**（P1-4 的验证）：
   `audio: { music: './audio/beast.mp3', vo: './audio/beast-vo.mp3', mix: './audio/beast-vo.mp3' }`，
   同时 `audio/beast.analysis.json` 被重算成 120bpm。**这会让 beast 成片重渲时画面节奏变化**
   （`f.beat` 变了），所以 `beast.mp4` 现在与代码不一致 —— 要么重出片，要么把配置改回单轨。
   这条**需要用户拍板**（要不要为了正确的拍子重出那支已交付的片子）。
4. **`docs/IMPROVEMENTS-2.md` 还没标记落地状态**（本会话只更新了 STATUS.md）。
   下次应给它加一张"状态"表或逐条打 ✅，并把 §11.6 那条**更正**写回它的 P1-2 段落。
5. 没做的事（`IMPROVEMENTS-2.md` 里明确排在后面的档位）：**B 档 TTS 入口**（`anim say`）、
   **C 档词级时间戳**（喂 `type.karaoke`）。A 档（分轨 + 旁白表 + `dur: { vo }`）已落地。
6. 文档同步：`AGENTS.md`（新命令 `--parallel` / `clean` / `determinism` / `dumpframe(s)`、
   `task.audio` 分轨、`task.narration`）、`docs/ROADMAP.md`、`docs/NARRATION.md` 的 A 档
   从"该补什么"改成"已补什么"。本会话**没有动这三份**。

### 11.17 本会话的几条"元教训"（比具体 bug 更值得记）

1. **判据自己会骗人。** 这一轮在 `-copyts` 上白折腾了一轮，只因为 `checkTimestamps()`
   把 ffprobe 的 `\r` 读成 NaN、又把 `-read_intervals` 的重复首帧当成"缺帧"。
   两次假警报都指向"引擎有问题"，而真相是**量具坏了**。
   → 写守门时先问：**这个读数能不能被证伪？**
2. **"看起来像工程问题"的，可能是取时口径问题。** P1-2 那条"跨会话不确定性"
   曾让上一轮怀疑自适应采样、音频解码位置、渲染历史；真相是探针按"帧中心"取时，
   而 `stream()` 是在**帧起点**渲的。半帧偏移就够了。
   → 结论要落回**代码里那一行**（这里是 `t = from + i/fps`），别落在直觉上。
3. **参考帧/基线要和控制变量一起量。** `probe-alpha` 的 `blank` 参考帧
   一直读 0.10012（而不是 0.062），我没能定位到根因 —— 它是个**常量偏移**，
   所以相对判据仍然成立，但这是一笔没查清的账。**下次别把它当"已知正常"**。
4. **加一个功能会连带吓到旧断言。** 「提交场景图层」这一笔
   （P0-3 顺带加的）把"只 clear 不写字"的段打成全黑（§11.4）——
   而它差点被当成"标定夹具本来就这样"。**改动落地后要拿一个已知正常的样本比一遍。**

---

## 12. 第四轮：把第三轮没收完的尾收完

### 12.0 一句话

第三轮结束时留了两摊事：**§11.15 里标 ⏸ 的回归没跑完**，以及
**口播/旁白只做了 A 档**（B 档 TTS 入口、C 档词级时间戳没做）。
这一轮两摊都收了，顺手把 §10.9 留给"下一个会话"的 `probe-trans2` 判据重写掉。

| 编号 | 事 | 状态 | 验收方式 |
|---|---|---|---|
| §11.15 | ⏸ 的回归清单 | ✅ 跑完（26 项，见 §12.1） | `node tools/regress-all.mjs` |
| §11.16.2 | `check beast` 退出码 1 | ✅ **没能复现**（这次退出码 0，12 段全过） | `node scripts/anim.mjs check beast --quick` |
| §11.16.3 | beast 成片与代码不一致 | ✅ 用户拍板：**不重出**，配置改回单轨（§12.5） | 见 §12.5 的试算数字 |
| §10.9 | `probe-trans2` 的过时判据 | ✅ 判据重写（§12.3） | `node tools/probe-trans2.mjs _calib` |
| P1-5 B 档 | `anim say` / `anim mix` | ✅ 落地（§12.2） | `node tools/test-say.mjs`（30/30）、`node tools/probe-tts-edge.mjs`（9/9） |
| P1-5 C 档 | 词级时间戳 → `type.karaoke` | ✅ 落地（§12.2） | `node tools/test-karaoke.mjs`（80/80） |
| §11.16.4/6 | `IMPROVEMENTS-2.md` 状态、`NARRATION.md`/`ROADMAP.md` 同步 | ✅ 落地 | 这三份已改（`AGENTS.md` 见 §12.6） |

### 12.1 回归清单：26 项一次跑完（新增 `tools/regress-all.mjs`）

上一轮的教训是"清单散在文档里，没人记得哪些跑过"。现在清单**写死在代码里**，
逐项一份日志（`out/_regress/<名字>.log`）+ 一张汇总（`out/_regress/summary.md`）：

```sh
node tools/regress-all.mjs              # 全部（串行；约 20 分钟）
node tools/regress-all.mjs --only smoke # 只跑名字里含 smoke 的
node tools/regress-all.mjs --list
```

**结果：23/26 通过**（第三轮那批 ⏸ 的现在都有完整输出了）：

| 组 | 结果 |
|---|---|
| 5 个纯 JS 单测 | ✅ 全过（`timeline-guard` 16、`easing-warn` 7、`narration` 32→44、`xform-math`、`segment-cuts`） |
| 5 个注入式 smoke | ✅ 全过（`scene-error` 10/10、`background`、`overexposure`、`worktree-edit` 8/8、`interrupt`、`backpressure`）—— 上一轮只读到一半的两个（`background`/`overexposure`）这次末行总结是 PASS |
| 逐任务 `check --quick` | ✅ 6/6（beast / demo / beat / _calib / nekohome / fidus）。**`check beast` 这次退出码 0**，§11.16.2 记的那次退出码 1 没能复现 |
| 引擎级探针 | ✅ `probe-alpha` 9/9、`ribbon`、`fonts`、`colorspace`、`determinism`（60 帧逐字节相同）、`test-parallel` 6/6 |
| 画面没变 | `hashes fidus` 首次报「没有基线文件」→ 已 `--save` 重存基线（见下） |

**两次"真失败"都不是回归的问题，都记下来：**

1. **`check:fidus` 报 `net::ERR_CONNECTION_REFUSED`** —— 是**我自己造成的**：
   跑回归的同时我在 `scripts/lib/` 里写文件，私有 Vite 的文件监听去 watch 编辑器产生的
   `.say.mjs.<pid>.<uuid>.tmpdir/say.mjs.tmp`，撞上 `EBUSY` **直接把 Vite 进程搞崩**。
   重跑（不并发写文件）就过了。→ 元教训见 §12.4.1。
2. **`hashes:fidus` 报「没有基线文件 `out/fidus/hashes.json`」** —— 上一轮存过，后来
   `out/` 被清过。这一轮用 `hashes fidus --save` 重存了基线；**它现在等于"当前画面"**，
   所以下次重构要拿它当基线用（别再 `--save` 覆盖它）。
   同一批里 `hashes demo --baseline` 是"拿当前基线跟自己比"，没有信息量，**已从清单里删掉**。

### 12.2 口播/旁白 B 档 + C 档落地

`docs/NARRATION.md` 顶部原来写着"引擎还没有这一层"，现在 A/B/C 三档都有了：

| 档 | 落了什么 | 代码 |
|---|---|---|
| A（第三轮） | `task.audio` 分轨、`task.narration`、`ctx.narration`、`dur: { vo: id }` | `src/core/narration.js`、`src/tasks.js` |
| **B（本轮）** | `anim say`（TTS → 量真实时长 → 反推 `stretch`/`slot` → 写表）、`anim mix`（摆位 + 闪避 → 一条混音轨） | `scripts/lib/say.mjs`、`scripts/lib/mix.mjs`、`tools/tts-edge.py` |
| **C（本轮）** | 词级时间戳写进 `narration.json` 的 `lines[].words`（整片绝对时间），`type.karaoke` 直接吃；`ctx.narration.recent(t, hold)` 让字幕在话音落下后多留一会儿 | `tools/tts-edge.py`、`src/core/narration.js`、`src/core/text.js` |

**离线回归**（不需要联网、不需要 GPU）：

```
node tools/test-say.mjs        → 30/30（合成、量长、stretch/slot/start 解算、叠句与 MAX_STRETCH 报警、
                                 缓存命中、三张表一致、词级时间戳真/近似两条路、mix 的摆位与闪避）
node tools/test-karaoke.mjs    → 80/80（字符区间按 w 累加、start/end 只当秒、拼不上要报警；
                                 把修复回退掉 → 9 项 FAIL，这条回归是有效的）
node tools/test-narration.mjs  → 44/44（新增 ⑥ recent() 与 ⑦ 词级时间戳两组）
```

**真 TTS 通电**（联网，`node tools/probe-tts-edge.mjs` → 9/9）：

```
驱动：python3 tools/tts-edge.py（仓库自带驱动）        音色 zh-CN-YunxiNeural
① 两句都合成出来了   2 句        时长 1.05s / 2.01s（**说到哪算到哪**，不是文件时长）
② 词级时间戳是真的（无 approx）   3 段 / 6 段      词拼起来等于原句 ✓
  先 0.681–0.956s ／ 看 0.956–1.069s ／ 一句话。1.081–1.569s
```

这条路上有 **4 个实测坑**，都不是猜的：

1. **`edge-tts` 7.x 命令行的 `--write-subtitles` 只给整句**（默认 `SentenceBoundary`，实测
   12 个字的句子只有一条 cue）。要词级时间戳必须用 `edge_tts` 库的 `boundary="WordBoundary"`
   —— 这就是仓库里多一个 `tools/tts-edge.py` 的原因（薄薄一层，不引入新的 TTS 依赖）。
2. **每句音频的尾巴上挂着约 0.9s 静音**（实测：1.872s 的文件里 0.934–1.872 全是静音；
   CLI 与库两条路产出的文件**逐项一致**）。旧写法（beast 那版）直接用 ffprobe 的**文件时长**
   当"这句念了多久"，于是把静音算进了句子长度 —— beast 的 `affix-1` 记的是 4.68s，
   实际说到 3.88s。**27 句合计 21.6s 是虚的**（占 127.5s 片子的 17%）。
   现在 `probeSpeechEnd()` 用 `silencedetect` 找末尾那段静音，取它的起点 +0.12s。
3. **词级时间戳不含标点**（`先看一句话。` → `先 / 看 / 一句话`）。第一版严格判"拼接必须等于原文"，
   结果把**本来可用的真时间戳**判成不可用、悄悄退化成"按字数近似"（探针当场抓到：
   dry-run beast 报 0 句真词级时间戳）。现在改成 `alignWords()`：按顺序对齐、把标点并进相邻词，
   拼回来仍然等于原文，并打印一句汇总（不再逐句刷屏）。
4. **节拍源解析**：分析文件名是 `audio/<去掉扩展名的音轨名>.analysis.json`
   （`beast.mp3` → `beast.analysis.json`）；找不到时**不能**随便扫一个 `*.analysis.json` 就用 ——
   beast 的 `audio/` 里还有一份 `beast-vo.analysis.json`（从**人声**测出来的 136bpm），
   正好是 P1-4 要躲开的那份污染数据（第一次试算就抓到了，见 §12.5）。

**顺手修掉的稳定性问题**：`edge-tts` 会偶发 `NoAudioReceived`（服务端抖动）。
第一版把它当致命错误抛出 —— **27 句跑到第 23 句整条命令挂掉**，而重跑就能过。
现在同一句重试 2 次（退避 0.6s），只有"明确不认识的选项"才降级成不带 `--write-words`。

### 12.3 `probe-trans2` 判据重写（收掉 §10.9 那笔账）

原来三条判据，第②条要求"交叠结束时 A 的领地明显变暗（< 基线的 75%）"，实测 25.32% → 24.79%，
永远过不了。**第四轮重写后：`node tools/probe-trans2.mjs _calib` → 总判定 PASS，退出码 0，耗时 10.4s**
（脚本自起自收 Vite/Chrome，不依赖外部服务）。

| 判据 | 现在量什么 |
|---|---|
| ① 交叠期 A 的方块确实被改动 | 紧盒子（x 250–470 / y 210–430，套住 A 那个描边方块）里 `mean|lum_only − lum_both| > 1%` |
| ② A 的方块到交叠 95% 已经不在了 | `ratio = lum_both / lum_only` < 0.5；**自检**：基线处 ratio > 0.9（否则这个比值本身无意义） |
| ③ 是"被推走"而不是"原地糊掉" | 48×48 模板（中心 (262,222)）在 ±360px 内搜索最大 NCC，**分层判**：找到可信匹配（NCC ≥ 0.75）就要求它够锐；位移 ≥ 24px **只在 k ≥ 40% 上要求**；"匹配不上"由 ② 的 ratio < 0.5 兜底放行；且至少要有一个探针量到真实位移 |

**实测输出（第四轮，脚本自起自收 Vite/Chrome，跑完约 10 秒）：**

```
探针             t       ②ratio   ①Δlum    ③NCC    ③offset(px)     说明
交叠外 基线      2.000    1.000    0.00%    1.000      (0,0)       同一帧自匹配
交叠 10%        2.460    1.058    8.88%    0.985     (16,-4)     形状还在原处（只挪 16px）
交叠 40%        2.640    0.751   16.88%    0.965    (200,-16)    形状还在、挪了 201px
交叠 70%        2.820    0.486   16.61%    0.505         —        无可信匹配（元素已不在）
交叠 95%        2.970    0.441   17.34%    0.393         —        无可信匹配（元素已不在）
```

**三条判据的实测结论**：

```
① PASS  4 个探针全部超过阈值（最小 8.88%）
② PASS  基线 ratio 1.000 > 0.9（自检：两个会话此时渲同一段同一 t，应逐像素一致）
        交叠 95% ratio 0.441 < 0.5（31.00% → 13.66%），且残留比全程单调下降 1.06 → 0.75 → 0.49 → 0.44
③ PASS  10%：NCC 0.985（锐）；k=0.1 < 0.4 不要求位移（push·k² 此时设计上只有 ~6.9px）
        40%：NCC 0.965（锐）+ 位移 (200,-16) = 200.6px ≥ 24px
        70%/95%：无可信匹配（NCC 0.505 / 0.393）+ ②的 ratio 0.486 / 0.441 < 0.5 → 元素确实已不在画面里，放行
        总闸门：至少有一个探针量到真实位移 ✓
```

另外有**两条独立证据**（不进判据，只用来交叉核对）：
- **A 的大字盒子**（x250–800/y470–620）也有 6.47%–8.59% 的平均亮度差（方块是 8.88%–17.34%）——
  两个独立元素都在变，说明是**整段被带走**，而不是量具恰好盯住了一个会动的目标。
- 退出码**分层**：`0` = 判据全过，`1` = 判据没过，`4` = **脚本自己坏了**（异常）。
  加参考行时踩过一次 `Cannot access 'inOverlap' before initialization` → exit 4，
  一眼就能和"转场有问题"区分开 —— 这正是"量具坏了"和"被测对象坏了"必须分开报的落地做法。

**③ 为什么分层（这条理由值得记）**：第一版要求"每个探针位移 ≥ 24px"，于是 10% 处 FAIL
（NCC 0.985 但只挪了 16.5px）。查 `src/core/trans.js` 才发现位移是 **`push·k²`**（`push=0.36`）——
k=0.1 时**设计上就只有 6.7px**：那个二次方是故意的"速度感"，在那儿量位移等于**在量缓动曲线**，
不是在量"推走 vs 糊掉"。分层之后：位移只在加速起来之后（k ≥ 40%）要求，锐利度对所有探针都要求。
还有一条**防止量具坏掉却当通过**的护栏（这条很关键）：**元素还在（ratio ≥ 0.5）却匹配不上 → 判 FAIL
并说明"这更像量具/判据的问题，必须人工看"**；只有 ratio < 0.5 时才允许"匹配不上"作为"已被送走"的证据。

**①②③ 是互补的**（值得记住）：② 只能证"元素不在了"，**分不清"被推走"和"原地淡出"**
（`transitionPass` 在 k≥0.55 之后把上一帧整体 alpha 归零，所以 95% 的 ratio=0.441 完全可能是"原地淡到 0"）；
把两者分开的是 ③ 的位移 —— 若哪天有人把 `fadeAt` 调大、让 A 留在原地慢慢淡，② 仍会 PASS，③ 会在 40% 抓住它。
⚠ ③ 量到的位移**偏大**：方向拖尾（k=0.4 时 b≈0.052 ≈100px 涂抹）会把 NCC 峰值往运动方向带
（实测 200.6px vs 理论 107.4px），所以"≥24px"这条是**宽松**的。

### 12.3.1 三条自检：量具先证明自己，再报判据

这一轮最值钱的东西不是判据本身，是**脚本里的三条自检 —— 任何一条不过就不跑判据、直接非零退出**：

```
✓ 自检 1  积分图 NCC vs 暴力实现对拍（9 个位置，含模板行下方与画面边界）最大差 4.7e-8
✓ 自检 2  已知位移 (50,-30) 被找回为 (50,-30)，NCC 1.0000
✓ 自检 A  行序：与引擎自己的 PNG 逐像素比 —— 按 (ph-1-y) 取 1044/1044 点完全相等，不翻只有 443/1044
```

自检 A 顺手把 §10.9 那条怀疑彻底否掉了：**`engine.readPixels()` 是自下而上**，
旧脚本 `(h-1-y)` 配自上而下的逻辑 y **本来就是对的**（`src/app.js:419`、`src/core/gl.js:447` 都写明）。
它不是靠读注释，而是拿引擎自己的 PNG 解码回像素逐点比 —— 这条自检**不依赖夹具几何**，很难自欺
（中途试过"硬编码方块位置看最亮行落在哪"，实测最亮行与源码坐标差了约 20px，那种判据不可靠）。
写 NCC 的过程中**错了 4 次**（行号索引、模板原点取成搜索中心、把行前缀差当单像素、协方差漏项），
**4 个错全是自检抓出来的** —— 否则它们都会以"元素已被推走"的样子出现在报告里（§11.17.1 的教训第二次应验）。

> ⚠ **一条被实测证伪的说法（别写进文档）**：子代理怀疑"旧脚本没设 viewport（Chrome 默认 1280×720）
> 却按 1920 宽算下标 → 越界读到 NaN，所以那个 25.35% 不是那块区域的亮度"。
> 我另写探针实测了三种 viewport：`readPixels()` 的长度**恒为 8294400 = 1920×1080×4，与 viewport 无关**
> （它读的是引擎自己的离屏 RT，尺寸由 task.config 决定）。所以旧脚本**没有**越界，
> 那个 `25.32% → 24.79%` 是**真实读数** —— 也正因为它怎么读都不变，判据才永远不可能 PASS。
> 新脚本保留"物理/逻辑尺寸硬校验"是**好加固**（把 `scale=1` 的隐含假设写死，避免像
> `tools/png-rows.mjs` 当年写死 1920 宽度那样把 4K 判成全黑），但理由**不是**"旧版读到 NaN"。

**为什么原来那条必然失败**：它在一大片（x 6%–42% / y 14%–64%）里量平均亮度，而那片的亮度
**主要由全片共用的背景决定**（"一镜到底"配方的要求就是背景逐像素一致）⇒ 背景永远不变暗。
**判据把"世界"和"上一段的内容"混为一谈了。**

**关于 §10.9 那条怀疑**：见上面 §12.3.1 的自检 A（结论：怀疑不成立，`(h-1-y)` 本来就对）。

> ✅ **这条现在有验收了**：脚本自带三条自检，**任何一条不过就不跑判据、直接非零退出**
> （第一版自检确实不过，脚本拒绝报判据 —— 这个设计是对的，§11.17.1 的教训：判据自己会骗人）。

### 12.4 元教训（这一轮新学到的）

1. **渲染期间不能写"任何"仓库文件，不只是 `src/` 和 `tasks/`。**
   P2-2 放宽 `watch.ignored` 只保护了 `docs/**`、`**/*.md`、`tasks/*/audio/**` 等几类；
   在 `scripts/`、`tools/` 里写文件仍然会打断渲染 —— 私有 Vite 会去 watch 编辑器写文件时
   产生的临时文件（`.xxx.tmpdir/…tmp`），撞 `EBUSY` **直接让 Vite 进程崩掉**，
   渲染报 `net::ERR_CONNECTION_REFUSED`。本轮 `check:fidus` 就是这么假失败的。
   → 结论收紧为：**渲染期间只写 `vite.config.mjs` 的 `ignored` 里那几类**。
2. **量具自己会骗人（第二次）。** 我写了一段临时脚本量 beast 27 句的尾部静音，
   得到"0.00s/句"，差点据此把"21.6s 是虚的"这个结论撤回去。真相是那段脚本的
   正则跨行匹配把静音段配错了。**把同一句话重新合成一遍、与存档文件并排量**（跨来源对照）
   才看清：两者逐项一致、尾巴那 0.916s 都在。
   → 单点读数可疑时，**换一条独立的路径再量一次**，不要在同一段代码上反复推论。
3. **ffmpeg 的 `silencedetect` 在文件结尾会补一条 `silence_end`。**
   `probeSpeechEnd()` 第一版假设"末尾那段静音没有 end"，于是永远判不出尾巴静音（trimmed 恒为 0）。
   判据改成"这段静音一直延续到文件末尾（`end >= 文件时长 − 0.08`）"才对。
4. **写文件工具本身也会留下证据。** 我用 PowerShell 的 `Set-Content` 改一个含中文的测试脚本，
   整个文件的非 ASCII 立刻变成乱码（这个坑 `MEMORY.md` 里记过两次，这次又踩了一次）。
   含中文的源文件**只能用文件编辑工具**。
5. **"听起来合理"的归因，也要先证伪再用。** 子代理把 `probe-trans2` 旧判据的失败归因成
   "没设 viewport（Chrome 默认 1280×720）→ 越界读到 NaN，所以那个 25.35% 是假的"——
   这个解释很顺、也能"解释"为什么判据永远不过。我另写探针实测三种 viewport：
   `readPixels()` 长度恒为 `1920×1080×4`，**与 viewport 无关**（它读引擎自己的离屏 RT）⇒ 归因**被证伪**，
   旧数字是真实读数。有意思的是**反例就在那个子代理自己的输出里**（它第一版用的是默认视口，
   打印出来却是 `pw/ph = 1920 1080`）。→ **先证伪，再写进文档**；尤其当"错的归因"会让一条判据
   看起来"本来就该失败"时（那正是它最危险的地方）。

### 12.5 beast：用户拍板不重出，配置改回单轨

第三轮为了让 `analyze` 从 `music` 轨测节拍，把 `tasks/beast/task.config.mjs` 改成了分轨写法；
代价是 `f.beat` 从 136bpm 变 120bpm ⇒ **`beast.mp4` 与代码不再一致**（§11.16.3 留给用户拍板）。

**这一轮把试算做出来了**（`node scripts/anim.mjs say beast --dry-run`，只算不写）：

| | 旧（成片用的这张表） | 新（真语音时长 + 120bpm 取整） |
|---|---|---|
| 总长 | 127.5s | **113.00s** |
| 每段放慢 | — | 1.37–1.69 |
| 每句时长 | **含约 0.9s 尾部静音** | 说到哪算到哪（27 句共裁掉 **21.6s**） |

**用户选的是"不出片、配置改回单轨"**：`audio: './audio/beast-vo.mp3'`，
让代码与那支已交付的成片重新一致。配置里现在写清了这段历史与试算数字，
下次想重出时照着做即可（画面代码一个字都不用改）。
`audio/beast.analysis.json`（120bpm）留着当证据，没有删。

> 诚实记录两笔：① 那次 `--dry-run` 会**合成/复用音频**来量时长（它不写 `timing`/`narration`，
> 也不出旁白轨），所以它在 `tasks/beast/audio/vo/` 里刷新了 27 个 `.sha1` 缓存戳
> （内容相同的音频没有变），并留下了 `.words.json`（已删）。② 试算中用掉的一次 TTS
> 在 `honest-1` 上偶发失败，所以那句没有词级时间戳 —— 那次输出里如实打了出来。

### 12.6 `AGENTS.md` 同步 + 本次改动的文件清单

`AGENTS.md`（给下一个 agent 的操作契约）补了：`anim say` / `anim mix` 两条命令、
`narration.mjs` 的位置与导出、`task.narration` 与 `dur: { vo }`、词级时间戳 → `type.karaoke`
的写法、`tools/regress-all.mjs`、以及 §12.4.1 那条"渲染期间只能写哪几类文件"的收紧。

| 文件 | 改动 |
|---|---|
| `scripts/lib/media.mjs` | 新增：命令行解析、ffprobe/ffmpeg 包装、解码/编码、`probeSpeechEnd`（尾巴静音） |
| `scripts/lib/say.mjs` | 新增：`anim say`（旁白脚本 → TTS → 时长表 → `narration.json`）、`solveTiming`/`alignWords` |
| `scripts/lib/mix.mjs` | 新增：`anim mix`（摆位 + 闪避 + 归一 → 一条混音轨） |
| `scripts/anim.mjs` | 分发加 `say` / `mix`，help 头补全参数 |
| `tools/tts-edge.py` | 新增：默认 TTS 驱动（`edge_tts` 库 + `WordBoundary` 词级时间戳） |
| `tools/stub-tts.mjs` | 新增：确定性假驱动（离线回归用） |
| `tools/test-say.mjs` / `tools/probe-tts-edge.mjs` | 新增：B/C 档的离线回归与真 TTS 通电探针 |
| `tools/test-karaoke.mjs` | 新增：C 档 karaoke 回归（80 项） |
| `tools/regress-all.mjs` | 新增：把整份回归清单变成一条命令 |
| `tools/probe-trans2.mjs` | 重写判据（§12.3） |
| `src/core/text.js` | `karaoke()` 修掉"秒/字符下标混用"（+ `karaokeSpans`、写错就响一次） |
| `src/core/narration.js` | 词级时间戳（`words` / `normalizeWords` / `wordsApprox`）、`recent(t, hold)` |
| `docs/NARRATION.md` / `docs/ROADMAP.md` / `docs/IMPROVEMENTS-2.md` | 状态同步（B/C 档落地、P2-2 结论收紧） |
| `tasks/beast/task.config.mjs` | 音频改回单轨 + 写明历史与试算（§12.5） |
| `tasks/_calib/task.config.mjs` | 清掉上一轮被中断时残留的 `bgcheck` 注入（§12.1 的前置） |

### 12.7 下次会话的建议起点

1. **用 `anim say` 真做一支带旁白的片子**（新的，别动 beast）：B/C 档目前只在
   `_saytest`/探针夹具上验过，"在真实创作流程里好不好用"还没有样本。
   几条已知要留意的：`--dry-run` 也会合成；换音色后 `slot` 会变 ⇒ 要重出片；
   词级时间戳现在只接了 `type.karaoke`，还没做"字幕整行 + 说到哪亮哪"的现成镜头模板。
2. **`edge-tts` 的偶发失败**：现在同一句重试 2 次。如果要跑很长的旁白（几百句），
   值得再加一层"失败也继续、最后统一补跑失败的句子"。
3. **`probe-alpha` 的 `blank` 参考帧常量偏移**（§11.17.3）仍然没查清：读 0.10012 而不是 0.062。
4. `hashes fidus` 的基线已重存为当前画面 —— 下次改 `src/kit/` 或 fidus 场景时
   拿它当基线跑 `--baseline`。

---

## 13. 第五轮：pdoom-video 那套「3D + 一镜到底」搬进来了多少

> **本轮（第六轮）把这一节里"没做完"的那一块收掉了 —— 见 §13.4。**
> 一句话：raymarch 是好的，坏的是三个"不报错"的接缝（相机 uniform 字段名、`FRAG_PX` 的 y 方向、
> `camera3` 的手性），顺带把"整屏白"变成了 `check` 能点名的一句话。

参考实现在 `out/_ref/pdoom-video/`（只读克隆）。这一轮做了三块引擎能力 + 一支验证片
`tasks/pdoom-lab`（32 秒 / 5 段 / 全硬切）。下面是**逐条对照 + 验收证据 + 没做完的部分**。

### 13.1 先纠正一个前提：pdoom 的"一镜到底"不是转场做出来的

把它的 `app/src/timeline.ts` 读完之后，这条是这一轮最重要的发现：

* 全片 22 段是**严格分区、零重叠** —— 相邻段的边界在代码里是**同一个变量**
  （`E('loss','loss', b.loss, b.pre1)` 这种写法），所以 `start_{n+1} == end_n`；
* 引擎里那条默认交叉溶解分支（`engine.ts:344`）**从未被执行过**（`active` 每帧只有一条）；
* 全项目**没有一个场景**设置 `handlesTransition`，也**没有一处**读 `f.under`。

它做到"切了像没切"靠的是四件事（`tasks/pdoom-lab/scenes/_world.js` 顶部有完整说明）：

1. **全片一台摄影机**，参数只跟整片时间 `f.t` 走 —— 切点两侧运动方向、滚转、速度连续；
2. **一个走完全片的母题**（那颗火花）—— 眼睛有得跟；
3. **手工几何交接常量**：把"对象在切点那一刻的屏幕坐标/布局"抽成常量，两段都引它。
   pdoom 抄了 6 组（`ROOM`/`EYE`/`THREAD`/`CARET`/`HANDOFF`/`ROLL_IN`），
   更强的做法是抽共享模块（`room-shrooms.ts`）—— 本片的 `HANDOFF` 就是这一条；
4. **pre-lap / post-lap**：运动提前起、过后落（`stack.ts` 每拍提前 0.22 拍；`fuse.ts`
   的推镜穿过切点还在加速；`hook.ts:194` 出段主动"停表"把抖动和变焦归零）。

**结论：本地引擎那套 `overlap` + 甩走上一帧的转场，并不是做 pdoom 手法的前提。**
两套可以并存（`cut()` 的 `overlap` 默认就是 0）；`tasks/pdoom-lab` 全程零 overlap 也过
`check` 的全部守门。

### 13.2 新增的引擎能力（三条，都有离线单测）

| 能力 | 位置 | 验收 |
|---|---|---|
| **世界摄影机**：关键帧插值 / zoom 对数插值 / 推近自动不动点 / `mixCam` / 速度与拖影采样 / 按帧号播种的手持抖动 | `src/core/cam.js` | `node tools/test-cam-math.mjs`（**31 项全绿**） |
| **3D 投影**（第 1 类"3D"）：`camera3` / `project3` / `clipSegment` / `depthScale` / `widthAt` / `projectLine` | 同上 | 同上 |
| **投影 `setXform`**：`camXform()` 直接产出完整 3×3 射影矩阵（`xformForward` 认 `proj` 字段），整层矢量+文字按同一条透视变形 | `src/core/cam.js` + `src/core/engine.js` | 「camXform 与 project(k) 逐像素一致」：8 组机位（含偏心/缩放/旋转/k 正负）× 5 个世界点，**逐点 1e-6**；`tools/test-xform-math.mjs` 仍然 PASS（老行为一字未改） |
| **raymarch 内核**：3D 噪声 / 相机 ray / SDF 图元 / march / 四面体法线 / 软阴影 / AO / **雕刻排线（含密度 LOD）** / 雾 | `src/core/glsl3d.js` | ✅ **已通电**（第六轮）：走廊段用它出画 + `tools/probe-raymarch.mjs` 14 条判据 —— 见 §13.4 |

关于 `camXform`：**它在实现里连续错了五次、正推又错两次**，每一次的表现都只是
"整层偏一点、缩一点"——**不崩溃、不报错、`check` 也查不出来**（矩阵转置、少一层缩放、
把 W/2 乘进系数、平移从世界原点量、分母符号写反）。最后改成**运行时数值解**
（5 个世界点 → 两个 5 元线性方程组，高斯消元 + 部分主元 + 两次自检），
没有推导也就没有符号可以写反。这段经历写在函数注释里，改它之前先跑那条断言。

### 13.3 验证片 `tasks/pdoom-lab`

5 段 32 秒，**全硬切（零 overlap）**，段长都是整数拍：

| 段 | 内容 | 演示的东西 |
|---|---|---|
| `corridor` | 石柱走廊，门框扑面 | 第 1 类 3D（`project3` + 线段批 + 近平面裁剪 + 深度衰减） |
| `map` | 一张图纸 | keystone 透视（`project(k)`）、world 坐标排版 |
| `stack` | 无限下落的塔 | "一镜到底"：世界位置是连续函数、摄影机只跟随；沿速度拷份做拖影 |
| `columns` | 柱林横摇 | 3D 线段批的日常用法 + 甩镜时几何多重绘制 |
| `loop` | 收尾回到第一帧 | 与 `corridor` **共用同一份世界**（第六轮起是同一份 SDF，见 §13.4.5），摄影机减速回到首帧位姿 |

验收：`node scripts/anim.mjs check pdoom-lab` —— **✓ 没有问题**（三点采样 + 单/多子帧两条
路径 + 背景守门全过）；每段都出图并用 Read 看过；`hashes --save` 基线已存
（`out/pdoom-lab/hashes.json`），下次改引擎或场景可以 `--baseline` 证明画面没变。
（第六轮改了 `camera3` 的手性并把走廊换成 raymarch，基线已按当时的画面重存，见 §13.4.5。）

### 13.4 ✅ 收尾（第六轮）：raymarch 通电 —— 整屏白的真因不在 raymarch

第五轮把 raymarch 写成"待通电"，理由是"那一版在引擎里稳定整屏白"。这一轮把它跑通了，
结论是**整屏白跟 raymarch 内核无关**：内核一直是好的，坏的是三个**不会报错**的接缝。
下面按"当时怎么想的 / 实测是什么"记，接手的人不用再猜。

#### 13.4.1 先纠正第五轮的两条推断

| 第五轮的推断 | 实测结果 |
|---|---|
| 「WebGL 里 NaN 画出来是白的 → 怀疑 `fwidth` 在非一致控制流里」 | **症状对、机理不对，而且 `fwidth` 是清白的**。NaN 确实显示成整屏白，但**+Inf 显示出来一模一样**：注入 NaN 与注入 `1.0/0.0` 的两帧，PNG **逐字节相同**（sha256 `1cd077b8…`，1920×1080）。所以"整屏白"只能定位到"非有限值"，指不到具体哪个函数。`fwidth_branch` / `fwidth_mask` 两个变体（同一个 `hatch`，一次在 `if (hit>0.0)` 里、一次在分支外算）**画面完全一致**，把 `fwidth` 排除了。 |
| 「`ctx.params` 没传到 `setup`/`render`（`params: { dbg: 7 }` 读出 undefined），大概是 `_ctxFor` 的时机」 | **没有复现**。`cut(scene,{params})` → `build()` → `_ctxFor()` → `ctx.params` 这条链是通的：`tools/probe-raymarch.mjs --inspect` 打出 `{"id":"corridor","params":{"dbg":1}}`，而走廊段的材质号/法线调试图（`params: { dbg: 1/2 }`）确实渲染出来了（本节的三张图就是这么来的）。当时那次 undefined 没留下可复现的证据；**这一类"参数没到"现在有两条常驻自检**：`Pass` 会对"声明了但值没给的 uniform"点名告警，走廊段本身也常驻读 `params.impl`/`params.dbg`。 |

#### 13.4.2 三个真因（都是"写错了但画面照样出"的那种）

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| ① | 相机 uniform 全 0 → `normalize(vec3(0.0))` → NaN → **整屏白** | `cam3Uniforms()` 只认 `{camPos,camR,camU,camF,focal}`，而 `camera3()` 吐出的是 `{pos,right,up,fwd,focal}`；字段名对不上时它返回四个 `undefined`，`Pass` **静默跳过**这几项（保持 0） | `cam3Uniforms()` 两种形状都认，**认不出来直接抛错**；`Pass.render()` 对"值是 `undefined` / `NaN`"的 uniform 点名告警（每个名字一次） |
| ② | 整个世界**上下颠倒**（地板在天上），对称的画面看不出来 | `rayDir()` 照抄 pdoom 的 `px = (FRAG_PX - res*0.5) * vec2(1,-1)`，但本引擎的 `FRAG_PX = gl_FragCoord/PX_SCALE` **y 本来就是向上的**；多翻一次 = 上下镜像。`GLSL_COMMON` 里那句"逻辑像素"没写清是 y 向下（JS 侧）还是 y 向上（shader 侧），是这条的温床 | `rayDir` / `rayDirOrtho` 去掉那次翻转；`GLSL_COMMON` 明确写出"**只有 FRAG_PX 是 y 向上**，`post.center`/`setXform`/`lines`/`type` 都是 y 向下" |
| ③ | 整幅画面**左右镜像**（世界 `x=+1.5` 落在画面左半边） | `camera3()` 写的是 `right = (fz,0,-fx)` = `cross(worldUp, fwd)`，而注释和常识都是 `cross(fwd, worldUp)` —— 基座成了左手的。第五轮的四个 proj3 场景左右近似对称，**谁都没看出来**（连 `test-cam-math` 的 31 项也没钉这一条） | 改成 `right = cross(fwd,worldUp)`、`up = cross(right,fwd)`；`tools/test-cam-math.mjs` 补两条手性断言（世界 +x 在右半边、`right×up = -fwd`），`tools/probe-raymarch.mjs` 的 `ray` 变体也钉住 |

**怎么发现 ②③ 的**（值得复用）：给走廊段做了一个 `params: { dbg: N }` 调试开关
（1 = 材质号、2 = 法线、3 = 命中距离），法线图一开就露馅 —— 绿（法线朝上 = 地板）跑到了
画面**上半**，青（法线 -x）跑到了**右**半边，两个方向同时反。**在"看不出对错"的场景里，
把中间量画出来比盯着成品图猜快一个数量级**，而且这个开关是零成本的（不传 `params` 就是正常画面）。

#### 13.4.3 「整屏白」现在不再是哑巴

以前这一类事故只能靠抽帧看出来，`check` 三处采样全绿。原因有两层：

* **8bit 读回分不出 NaN 和 Inf**：`gl.readPixels()` 里 `Inf → 255`、`NaN → 0`，
  而后处理链会把两者压成**同一个白画面**（上面那张 sha256 相同的证据）；
* **多子帧那条路反而把证据擦掉了**：`engine._accumPass()` 会把非有限值（以及 `|c| > 5e4`）
  **丢掉**（`bad ? vec3(0.0) : c`）—— 于是同一段 `samples: 1` 是白的、成片里是黑的。
  `check` 会报「单子帧与多子帧亮度差了 N×：这是运动模糊求平均/累加的问题」，
  **指的方向完全是错的**。

现在 `check` 每个采样点会多走一次**浮点**回读（`window.__anim.nonFinite(t)` →
`engine.probeNonFinite()` → 只渲一个子帧、直接读 RGBA16F），把 NaN / ±Inf / 量级>5e4
分开数出来并点名，还给出第一个坏像素的屏幕坐标：

```
corridor       t=3.75s  单帧 1.000  多子帧 0.004（24 子帧）
      ← ⚠ 非有限值：NaN 0 / Inf 2073600 / 量级>5e4 0 像素（首个坏像素 x=0 y=1079，+Inf）
        这是「整屏白 / 单帧白多帧黑」的一类根因：shader 里除了 0、开了 normalize(0)
        （多半是相机 uniform 全 0）或 pow(0, 负数)。见 node tools/probe-raymarch.mjs
```
（上面是拿探针的 `inf` 变体故意注入 +Inf 时的真实输出形态；正常段这一行不会出现。）

#### 13.4.4 新增的常驻工具：`tools/probe-raymarch.mjs`

一条命令把"引擎里的一条 shader"拆成 14 个**可单独开关的变体**，在同一个浏览器会话里
逐个渲染，并**直接读 HDR 浮点缓冲**（8bit 读回看不见 NaN）：

```sh
node tools/probe-raymarch.mjs                 # 全部变体 + 14 条判据（PASS/FAIL，退出码）
node tools/probe-raymarch.mjs --only ray,full # 只看几个
node tools/probe-raymarch.mjs --png full,nan  # 额外存走完整引擎链的 PNG
node tools/probe-raymarch.mjs --inspect       # 只打时间线（含 params），查"参数到没到"
```

| 变体 | 它回答什么 |
|---|---|
| `flat` | 引擎里"画一条 Pass"这条路通不通（注入常量色，逐像素核对） |
| `ray` | 相机 uniform / 手性 / 朝向（左半 R<0.5、右半 R>0.5、上半 G>0.5） |
| `hit_mask` `hit_t` `normal` | SDF 步进与法线对不对 |
| `engrave` `fwidth_branch` `fwidth_mask` | 排线、以及"`fwidth` 在分支里"这个老怀疑（实测两者一致） |
| `full` | 全链路（排线 + AO + 软阴影 + 雾）；断言"地板比天花板亮" |
| `nan` `inf` `huge` | 三种非有限值长什么样：**NaN 与 Inf 的 PNG 逐字节相同**，`1e30` 被 RGBA16F 夹到 65504 |
| `zerocam` | 复现"相机 uniform 全 0"的后果 |

它同时是 **`engine.nonFinite()` 的回归**（`nan`/`inf` 必须被报出、`full` 必须干净），
已经进 `tools/regress-all.mjs`（`probe:raymarch`、`unit:cam-math`、`check:pdoom-lab`）。

#### 13.4.5 走廊段现在是真 raymarch（第 ② 种 3D）

`tasks/pdoom-lab/scenes/corridor.js` 改回 raymarch，世界（SDF）抽成
`scenes/_corridor.js`，**第 5 段 `loop.js` 引同一份** —— 于是"回到第一帧"不是两边抄同一串数字，
而是字面上的同一个 SDF（`_corridor.js` 顶部有一张尺寸对照表，对着 `_world.js` 的线段版）。
两种实现都留着：`cut(corridor, { params: { impl: 'lines' } })` 退回投影线段批（第 ① 种）。

| 段 | 现在演示什么 |
|---|---|
| `corridor` | **真 raymarch**：盒内腔 + `floor(z/4)` 重复门框 + 雕版排线 + AO/软阴影 + 雾；`params.dbg` 可切材质号/法线/命中距离 |
| `map` | 2.5D 图纸：`project(k)` keystone + `camXform`（**唯一不用 `camera3` 的段**） |
| `stack` | 一镜到底：世界在落、摄影机只跟随；沿速度拷份做拖影 |
| `columns` | 投影像段批的日常用法 |
| `loop` | 与 `corridor` **同一份 SDF**，摄影机减速回到首帧位姿 |

验收（本轮全跑过）：

```sh
node scripts/anim.mjs check pdoom-lab     # ✓ 没有问题（15 个采样点 × 两条路径 + 背景守门 + 非有限值扫描）
node tools/probe-raymarch.mjs             # ✓ 14/14 判据
node tools/test-cam-math.mjs              # ✓ 33 项（含两条新手性断言）
node tools/probe-raymarch.mjs --inspect   # params 确实进了 render 路径
```

`hashes --baseline` 与**改之前**的基线对比（这是"改动到底动了哪些像素"的直接证据）：

| t | 段 | 结果 | 说明 |
|---|---|---|---|
| 0 / 4 | `corridor` | ✗ 变了（mean 24.4 / 20.5） | 换了实现（线段批 → raymarch），预期 |
| **8 / 12** | **`map`** | **✓ 逐像素一致（max 0）** | 这一段不用 `camera3`（走 2D 的 `project(k)`），所以手性修复**碰不到它** —— 反过来说明改动范围是可控的 |
| 16 / 20 | `stack` | ✗ 变了（mean 1.5 / 1.6） | 手性修复 = 左右镜像：只是线几何换边，所以均值差很小（3% 像素 >16） |
| 24 | `columns` | ✗ 变了（mean 0.9） | 同上 |
| 28 | `loop` | ✗ 变了（mean 0.03 + 新 SDF） | 同上 + 换成同一份 SDF |

改完**已重存基线**（`out/pdoom-lab/hashes.json`，16 帧），下次改引擎拿它比。

#### 13.4.6 这一轮学到的（比具体 bug 更值得记）

1. **"症状"能对上，不等于"机理"能对上。** 第五轮认定是 NaN，方向对了，但结论停在
   "怀疑 `fwidth`"，于是把力气花在了一个**根本不是问题**的地方（实测两个变体画面一致）。
   真正省时间的一步是**把中间量画出来**（`params.dbg`）和**直接读浮点缓冲**。
2. **"引擎里没有一种失败长得像它的原因"是这一轮最贵的三个 bug 的共同点**：
   uniform 静默为 0、坐标轴静默镜像、rayDir 静默多翻一次 y —— 三个都不报错、都不崩溃，
   而且**对称的场景里全都看不出来**。修法都是同一个套路：**要么说清楚（注释/文档），
   要么直接抛错（`cam3Uniforms`），要么留一个能测的判据（探针 / 单测 / `check` 的扫描）**。
3. **常量/手势类的"约定"必须写在注入点旁边。** `FRAG_PX` 的 y 方向写在 `GLSL_COMMON`
   里，`rayDir` 就不会抄错；`camera3` 的手性写在 `camera3` 里，下一个场景就不会镜像。
   写在文档里的约定，写代码的人（包括我）不会回头翻。
4. **改动范围要能被"反证"**：`map` 段逐像素没变，是"这次只动了 3D 投影层"最有力的一句话。
   → 大改动之后，**找一个"本该不受影响"的样本比一遍**，比"我看了几张图觉得没问题"可靠得多。
5. **量具也会骗人，而且这次是真的骗了一次。** 全量回归里 `smoke:worktree-edit` 红了：
   "写 `docs/` 之后帧数继续涨（60 → 60）"。查下去不是引擎的问题，是**这条判据写死了 5 秒窗口**，
   而 `video demo --samples 1` 在这台机器上实测只有 **3.0 fps**（480 帧 157.7s）、进度行又**每 30 帧才重画一次**
   —— 5 秒里读数根本不会变。改成"**等到帧数真的涨**（最多 60s）"就绿了；顺手修掉同一文件里的一个竞态：
   `await child.on('close')` 挂得太晚会变成 "unsettled top-level await"（Node 退出码 13）。
   → 判据写"等固定时间"的地方，都要问一句：**这段时间里那个读数真的有机会变吗？**

#### 13.4.7 这一轮改动的文件

| 文件 | 改了什么 |
|---|---|
| `src/core/cam.js` | `camera3()` 的手性（`right = cross(fwd,worldUp)`、`up = cross(right,fwd)`）—— **会改变所有 proj3 场景的画面** |
| `src/core/glsl3d.js` | `rayDir`/`rayDirOrtho` 去掉多余的一次 y 翻转；`cam3Uniforms()` 两种机位形状都认、认不出来抛错；头注释重写成可复制的骨架 + "整屏白怎么查"对照表 |
| `src/core/gl.js` | `GLSL_COMMON` 里写清 `FRAG_PX` 是 **y 向上**（与 JS 侧相反）；`Pass.render()` 对"值是 `undefined`/`NaN`"的 uniform 点名告警（每个名字一次） |
| `src/core/engine.js` | 新增 `scanNonFinite(rt)` / `probeNonFinite(t)`：直接读浮点缓冲，NaN / ±Inf / 量级>5e4 分开数 |
| `src/app.js` | `window.__anim.nonFinite(t)` |
| `scripts/anim.mjs` | `check` 每个采样点多走一次非有限值扫描并**非零退出**；"两条路径亮度差"那句补上正确指向 |
| `tasks/pdoom-lab/scenes/_corridor.js` | **新**：走廊世界的 SDF + shader（第 1 段与第 5 段共用） |
| `tasks/pdoom-lab/scenes/corridor.js` | 改回真 raymarch；`params.impl === 'lines'` 保留线段版；`params.dbg` 材质号/法线/命中距离 |
| `tasks/pdoom-lab/scenes/loop.js` | 收尾段改用**同一份 SDF**（"回到第一帧"是字面上的同一个世界） |
| `tasks/pdoom-lab/task.config.mjs` | 注释写清三个诊断开关与它们的用法 |
| `tools/probe-raymarch.mjs` | **新**：14 个变体 + 14 条判据 + `--inspect` / `--png` / `--nf` |
| `tools/test-cam-math.mjs` | 31 → **33 项**（补两条手性断言） |
| `tools/smoke-worktree-edit.mjs` | 判据从"等 5 秒"改成"等帧数真的涨"；修掉 `close` 监听挂太晚的竞态 |
| `tools/regress-all.mjs` | 新增 `unit:cam-math` / `probe:raymarch` / `check:pdoom-lab` |
| `docs/ENGINE.md` | 新增 §3.7（3D：投影 + raymarch、坐标约定、整屏白对照表）；§13 排错表加 3 行；"代码与直觉不符"加 3 条 |
| `AGENTS.md` | 新增 §5.5「想做真 3D 时」、`check` 的非有限值扫描、`probe-raymarch` 进工具清单与排错表 |
| `docs/STATUS.md` | 本节 |

**回归**：`node tools/regress-all.mjs` —— 31 项（原 26 项 + 本轮 5 项）。

#### 13.4.8 这一轮**没做**的（仍然开着，别当成已完成）

| 事 | 为什么还开着 | 从哪接着做 |
|---|---|---|
| 用 `anim say` 真做一支带旁白的片子 | 旁白层只在 `_saytest` / 探针夹具上验过，"在真实创作流程里好不好用"仍然没有样本（§12.7 第 1 条，两轮没动） | 新开一个任务，别改 beast |
| `edge-tts` 的偶发失败 | 现在同一句重试 2 次；几百句的长旁白值得加"失败也继续、最后统一补跑" | §12.7 第 2 条 |
| `probe-alpha` 的 `blank` 参考帧常量偏移（读 0.10012 而不是 0.062） | 一轮没查清，两轮没动 | §11.17.3；**别把它当"已知正常"** |
| `_accumPass()` 丢掉非有限值时**不吭声** | `check` 现在能扫出来了（本轮的扫描），但**渲染成片时**它仍然是静默丢弃 —— 想更早发现只能在 `video` 里也开扫描（每帧多一次浮点回读，代价要实测） | 本轮 `scanNonFinite` 已经可复用 |
| 走廊段的成本 | raymarch 比线段批贵（`still --samples 1` 实测 ~0.4–0.6s/帧，`check` 30 帧 19.3s）；没有和线段版做过严格对照 | `cut(corridor, { params: { impl: 'lines' } })` 换个实现跑 `video --dry-run` 就能对照 |
| ROUTE 上的其它"3D 手法" | pdoom 还有 `fuse` 的引线、`banknote` 的团花这些非 raymarch 的花样，本轮没碰 | `out/_ref/pdoom-video/docs/TREATMENT.md` |

---

