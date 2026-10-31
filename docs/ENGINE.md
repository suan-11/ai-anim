# ENGINE.md —— 确定性代码动画引擎 · 规格参考

面向大模型 / 需要改引擎的人的精确参考。所有 API 名称、参数名、默认值都取自 `src/` 里的真实代码。
本篇只讲「引擎是什么、有什么」，怎么组合出效果看 `docs/COOKBOOK.md`。

阅读顺序建议：§1 心智模型 → §3 场景契约 → §4 Pass → §5 文字 → §6 矢量 → §7 合成 → §8 后处理 → §9 时间线 → §10 音频 → §11 运动模糊 → §12 CLI → §13 排错 → §14 镜头库。

---

## 1. 心智模型：渲染必须是 `f.t` 的纯函数

### 1.1 为什么

离屏导出把**一帧**拆成多个**子帧**（运动模糊），散在快门时间窗内，**顺序不保证**，最后求平均：

```
一帧(t) ──┬─ 子帧 t-0.004 ─┐
          ├─ 子帧 t+0.001 ─┤
          ├─ 子帧 t-0.002 ─┼─ 独立渲染 ── 平均 ── 后处理 ── sRGB ── 一帧像素
          └─ 子帧 t+0.003 ─┘
```

于是同一个 `render()` 会在几乎相同的 `t` 上被调用 8～216 次，顺序任意、可能跳过、可能重来（换机重渲）。
只要「第 `t` 秒的画面 = f(t)」，这一切自动成立；只要有一点跨帧状态，结果就不可复现，而且**通常不报错，只是画面抖**。

### 1.2 由这一条推导出的禁令

| 禁止 | 后果 | 正确做法 |
|---|---|---|
| `Math.random()` | 每个子帧各抽一次，平均后变成均匀灰雾/抖动 | `rng(seed)`（`setup` 里预计算成数组），或 `hash1/hash2/hash3` |
| `Date.now()` / `performance.now()` | 同一帧的不同子帧拿到不同时间，预览与成片不一致 | 时间只能来自 `f.t` / `f.lt` |
| `new Date()` | 同上 | 同上 |
| 逐帧累积状态 `this.x += v*dt` | 子帧乱序、可任意 seek，累积值没有意义 | 写成时间的函数：`x = f(f.t - birth)` |
| 用 `Math.floor(t*60)` 做按帧抖动 | 一帧内的子帧会取到**不同**帧号 → 双重曝光/撕裂 | 用 `f.idx`（引擎已保证一帧内所有子帧共享同一个 `idx`）；噪声种子用 `f.seed` |
| 拿**逐帧白噪声**当"手持"抖动（`shake: [(hash2(f.idx,1)-.5)*2*amp, …]`） | 60fps 下每 16.7ms 跳到一个新位置 = **振动**，不是手持；5px 就能被看成"地震"（promo 那轮的实际反馈） | 用 `shakeSmooth(f.t, amp)`（`src/core/cam.js`，是 `t` 的平滑函数，一帧内子帧只差 ~0.02px）；真要震屏才用逐帧噪声，写成 `handheld(cam, f.t, f.idx, { mode: 'grain' })`。见 `docs/history/IMPROVEMENTS-1-3.md` |
| 写文件 / 发网络请求 / 改全局状态于 `render()` 内 | 并行与重渲都会失控 | 放 `setup()` |

`frameIdx(t, fps)`（`util.js`）的实现是 `Math.floor(t * fps + 1e-6)`，那个 `1e-6` 是为了让 `t=2.0, fps=60`（浮点算出 119.99999）落在 120 而不是 119。**不要自己写这个公式**，用 `f.idx`。

### 1.3 粒子的正确写法：出生时间是坐标，不是积分

错误（逐帧积分）：

```js
// ✗ 子帧乱序时完全错乱
this.particles.forEach((p) => { p.x += p.vx * f.dt; p.y += p.vy * f.dt; });
```

正确（位置的解析解）：

```js
// ✓ 每个粒子记录出生时刻 t0，位置 = f(t - t0)
setup(ctx) {
  const r = ctx.rng(1337);
  this.parts = Array.from({ length: 900 }, () => ({
    x0: r() * 1920, y0: 1080,        // 出生点
    t0: r() * 8,                     // 出生时刻（秒）
    vx: (r() - 0.5) * 260,           // 初速（px/s）
    vy: -420 - r() * 380,
    g: 520 + r() * 200,              // 重力（px/s²）
    life: 2.2 + r() * 1.4,
    seed: r(),
  }));
},

render(ctx) {
  const { f, lines, P } = ctx;
  lines.begin();
  for (const p of this.parts) {
    const age = f.lt - p.t0;                       // 只依赖时间
    if (age < 0 || age > p.life) continue;         // 还没出生 / 已经死了
    const x = p.x0 + p.vx * age;                   // 解析解，不是积分
    const y = p.y0 + p.vy * age + 0.5 * p.g * age * age;
    const k = 1 - age / p.life;                    // 0..1 生命进度
    lines.seg(x, y, x - p.vx * 0.02, y - (p.vy + p.g * age) * 0.02, 2 + 3 * k,
      [P.signal[0] * k, P.signal[1] * k, P.signal[2] * k]);
  }
  lines.flush(ctx.out);
}
```

验收标准：任意 seek 到某个 `t`，画面必须和「从头播到 t」完全一样。

### 1.4 有状态场景：引擎会拒绝渲染

如果场景对象上声明了 `stateful: true` 或 `integrates: true`，**只要这一帧需要多于 1 个子帧，`Engine.render` 直接抛错**：

```
[<id>] 声明了 stateful/integrates，无法做运动模糊采样。
把状态改成「由 t 直接求值」（例如粒子位置 = f(出生时间)），或对该段用 { samples: 1 }。
```

`{ samples: 1 }` 只能通过 `engine.render(t, { samples: 1 })` 传（预览就是这条路），CLI 上用 `--samples 1`。

---

## 2. 渲染管线总览

### 2.1 一次 `Engine.render(t, opts)` 的完整流程

```
① composite(t)
   ├─ 找出所有满足 start <= t < end 的段（半开区间）
   ├─ 每段用自己的 HDR RenderTarget（pool 三张轮转），先 gl.clear(rt,[0,0,0]) 兜底
   ├─ scene.render(ctx) 必须把整帧画进 ctx.out
   ├─ 场景返回值（可选）→ 与 DEFAULT_POST + item.post 合并，成为这一段的后处理参数
   └─ 相邻两段重叠时：mixTo(under, rt, tin) 交叉溶解（除非下一段 handlesTransition）

② 运动模糊（仅当 samples !== 1）
   ├─ 子帧 t + (1/fps)*shutter*u（u 居中分布于 [-0.5, 0.5]）
   ├─ 每个子帧独立跑一遍 ①，写进累加缓冲（加性混合，NaN/超大值被丢弃）
   └─ 平均 → avgRT；自适应时 8 → 24 → 72 → 216，见 §11

③ HUD（仅 engine.hud && !preview）：把 ctx.text 之外的引擎图层叠在场景上

④ Post.render(gl, src, outRT, post, seed)
   亮部提取 → bloom 4 级金字塔 + halation（偏红更宽）→ 合成
   → 软肩/曝光/色差/对比/饱和/暗角/闪光/淡黑/颗粒/抖动 → sRGB

⑤ toScreen !== false 时 blit 到画布
```

顺序上有一个必须记住的点：**HUD 在场景之后、后处理之前**叠上去，所以 HUD 也会吃到泛光和颗粒（这是故意的：字幕高光也能晕开）。

### 2.2 坐标与单位约定

| 名字 | 含义 | 典型值 |
|---|---|---|
| 逻辑分辨率 `W × H` | 场景布局用的坐标系，`Engine` 默认 `1920×1080` | `gl.w`, `gl.h` |
| `SCALE` | 输出倍率，`scale: 2` = 真 4K（不是放大） | `gl.scale` |
| 物理分辨率 `PW × PH` | 实际帧缓冲 = `round(W*SCALE) × round(H*SCALE)` | `gl.pw`, `gl.ph` |

坐标原点在**左上角，y 向下**（逻辑像素）。`gl_FragCoord` 是 y 向上的物理像素。shader 里：

- `vec2 p = FRAG_PX;` 拿到的是**逻辑像素**，但 y 方向跟着 `gl_FragCoord`，即**向上**（宏就是 `gl_FragCoord.xy / PX_SCALE`，只做了单位换算，没有翻 Y）。
- 需要「y 向下」的坐标就自己 `p.y = RES_LOGICAL.y - p.y;`，或者用 `vUv`（y 向上，翻转关系明确）。
- 纯粹的径向/网格图案对 y 方向不敏感，所以 demo 里把 `FRAG_PX / RES_LOGICAL` 当「y 向下」用也是自洽的（只是上下镜像）——把它当 0..1 的屏幕参数用就好，需要和场景里的 y 向下坐标对齐时记得翻。
- 要 uv：`vUv` 是 y 向上的 0..1。
- 不随分辨率变化的线宽：`fwidth(...)`，或 `GLSL_COMMON` 的 `pxLine(d, a, b)`（按物理像素算「一根 1 逻辑像素的线」）。
- 逻辑像素步长：`uStep(1.0)`。

`Layer2D` 的 Canvas2D 被 `setTransform(scale,0,0,scale,0,0)` 缩放，所以**里面也一律用逻辑像素**。上传时 `UNPACK_FLIP_Y_WEBGL=false`，Y 翻转由 `Compositor` 的 shader 负责（两边都翻会得到上下颠倒的画面）。

### 2.3 色彩空间

- 场景 → 后处理全程工作在**线性光**（`RT` 默认 `RGBA16F`）。`P.signal` 这类调色板值是**线性**的，可以直接喂 `LineBatch` / `Pass` uniform。
- `Layer2D` 上传用 `SRGB8_ALPHA8`，硬件把 Canvas2D 的 sRGB 值解码成线性，所以合成之后也还是线性。
- Canvas2D 里取色**必须**用 `css(线性色, alpha)`（`util.js` 的 `css` 会把线性值转回 sRGB 字符串）；直接把线性值塞进 `fillStyle` 会偏暗。
- **末端编码（两条路都要做，漏一条就会"预览对、导出暗"）**：
  - 屏幕：`gl.blitPass` 的 shader 做 `toSRGB()`，然后 blit 到画布；
  - 导出：`engine.readPixels()` 内部读 `outRT` 时做 `linearToSrgb`（`gl.readPixels(rt, 'srgb')`）。
  - `Post.render()` 写进 `outRT` 的仍然是**线性值**——别以为后处理链末尾已经编码过了。
  - 要读原始线性值（排查用）走 `engine.readLinearPixels()`；它**不能**拿来存图。

  实测标定（`tasks/_calib` 的 `probe` 场景，只 `gl.clear` 一个已知线性色）：

  | 线性值 | 正确 sRGB | 编码前的导出（曾经的样子） |
  |---|---|---|
  | 0.5 | 188 | 128 |
  | 0.25 | 64 | 64 |
  | 0.05 | 64 | **13** ← 暗部糊死 |

  复现与对拍：`node tools/probe-colorspace.mjs _calib`（对比"导出"与"浏览器画布"两条路）。

---

## 3. Scene 契约与 SceneCtx

### 3.1 场景对象

```js
export default {
  id: 'xxx',                  // 可选；默认 id 取文件名
  handlesTransition: false,   // true = 自己处理与上一段的重叠（可以用 ctx.under）
  stateful: false,            // 见 §1.4；true 会让运动模糊抛错
  integrates: false,          // 同上
  setup(ctx) {},              // 只调一次：建 Pass / LineBatch / 预计算
  render(ctx) {},             // 每帧：把这一帧画进 ctx.out，可返回后处理参数
  dispose() {},               // 可选：释放 GPU 资源
};
```

`setup(ctx)` 收到的 `ctx` 是 `t = item.start`、`idx = 0` 的那一版（`out` 已存在）。场景可以是对象、类（会被 `new`）、或 `() => import('./scenes/x.js')` 的懒加载函数；有 `default` 导出会自动解包。`src/core/scene.js` 也导出 `class Scene` 基类，用不用都行。

> ⚠ **别在场景对象上写 `post: {...}`** —— 它会被**静默忽略**（`scene.js` 的 JSDoc 里提到过它，
> 但 `engine.js` 只读时间线的 `item.post` 与 `render()` 的返回值）。要固定观感就写
> `cut(scene, { post: {...} })`，或者由 `render()` 返回（`makeShot` 的 `post:` 是它自己的参数，那条路有效）。

`id` 的推导顺序（`timeline.js` 的 `nameOf`）：显式 `id` → 懒加载函数源码里匹配 `scenes/<name>.js` → 函数名 → 对象的 `id` → 构造函数名 → `'scene'`；重名自动加 `_2`。

### 3.2 `Frame`（`ctx.f`）每个字段

| 字段 | 类型 | 含义 |
|---|---|---|
| `t` | number | 整片时间（秒）。子帧采样时它是**子帧时刻**，不是帧中心 |
| `dt` | number | 本帧步长。离屏多子帧时 = `(1/fps) * shutter`（子帧间距），不是 `1/fps` |
| `lt` | number | 段内时间 = `t - start` |
| `p` | number | 段内进度 0..1 = `sat(lt / (end-start))` |
| `start` / `end` | number | 本段起止（秒） |
| `beat` | number | 连续拍号（来自 `music.beatAt(t)`；无音频时退化为 `t*2`） |
| `bar` | number | `beat / 4` |
| `beatPhase` | number | `beat - floor(beat)` |
| `fps` | number | 输出帧率 |
| `idx` | number | 帧号 `floor(t*fps + 1e-6)`；**一帧内所有子帧共享同一个值** |
| `seed` | number | `frameSeed(idx)`，0..99999 的确定性种子 |
| `preview` | boolean | `true` = 实时预览（1 子帧），`false` = 离屏导出 |
| `seeked` | boolean | 本帧之前时间跳变过（CLI 的 `still`/`stream` 恒为 true） |
| `tin` | number | 入场进度 0..1，见 §9.4 |
| `tout` | number | 出场进度 0..1，见 §9.4 |
| `under` | RT \| null | 上一个场景这一时刻的成帧；只有 `handlesTransition` 且 `k>0` 时非 null |
| `a` | object | 音频特征快照，见 §10.3 |
| `params` | object | 这一段的参数（= `ctx.params`） |

### 3.3 `SceneCtx`（`ctx`）每个字段

| 字段 | 说明 |
|---|---|
| `f` | `Frame`，见上表 |
| `gl` | `GL` 实例。`gl.ctx` 是 WebGL2RenderingContext，`gl.w/h` 逻辑尺寸，`gl.pw/ph` 物理尺寸，`gl.scale` 倍率，`gl.aspect` |
| `out` | 本帧输出的 HDR `RT`。**必须整帧覆盖**（先 `gl.clear(ctx.out, ...)` 或用一个不透明全屏 Pass） |
| `comp` | `Compositor`，叠图层 / 自定义转场 |
| `P` | `Palette`（`makePalette(task.palette)`）。`P.ink/P.bone/...` 是线性 `[r,g,b]`，`P.css(name, a)` 给 Canvas2D，`P.dim(name, k)` 变暗 |
| `text` | 这一段的 `Layer2D`（Canvas2D 图层）。**画字/画 2D 图形只用它** |
| `type` | `text.type`，这一段的 `TextKit`。**一层一个**，别跨段共用 |
| `lines` | `LineBatch`（引擎级，容量 60000 条线段） |
| `music` | `MusicData`（没有音频时是 `SILENT` 空对象，方法都能调） |
| `lyrics` | 歌词 JSON（没有就是 `null`） |
| `world` | 这一段的共享背景：`'auto'`（= `task.world`，全片复用）/ 一个 `Pass` / 一个 `(ctx) => Pass` 工厂 / `false`（本段自己铺底）。引擎在场景 `render()` **之前**就把它画进 `ctx.out` —— 所以场景里别再铺一遍，也别指望 `setXform` 能把它留下（§3.5 要点 2） |
| `narration` | 旁白查询（没配旁白时所有方法安全返回 `null`）：`at(t)` / `recent(t, hold=1.2)` / `typed(t)` / `progress(t)` / `in(t, id)` / `line(id)` / `durOf(id)` / `until(t)`；`at(t)` 返回的句子自带 `p` / `remain` / **`typedText`** / `restText` / `charIndex` / `words`（`typedText` 就是打字机文本，`words` 直接喂 `type.karaoke`） |
| `params` | 这一段的时间线参数 |
| `style` | **风格包**（`docs/STYLE.md`，`src/style/index.js`）：`{ name, label, motif, palette, fonts, post, grid, captions }`。不写 `task.style` 时它是 `print`（= 引擎从前的默认观感，零像素变化）。颜色已经通过 `P` 生效，这里给的是"这一片用的是什么介质"这类元信息 + 栅格/母题 |
| `grid` | **风格栅格**（已按分辨率缩放）：`{ pad, top, footerLineY, footerY, captionLineY, captionY, contentBottom, captionBand }`。别在场景里再写 `120` / `964` 这类魔数 —— kit 的 `bandsOf(ctx)` 就是读它 |
| `captions` | **引擎字幕层**（`docs/CAPTIONS.md`）：`active(t)`（此刻该显示的那句，含"说完再留一会儿"）/ `band`（字幕保留带矩形）/ `style` / `lines`。没开字幕时是一个安全空实现（`band` 也给了默认值），所以场景可以无条件读 `ctx.captions.band` 来避让 |
| `warnings` | 运行期**警告**通道（与 `engine.warnings` 是同一个数组）：kit 的 `assertInBand()`（文字压进字幕带）、`captionNote()`（说明条写成了句子）会往这里 push。用 `ctx.warnings.push('…')` 而不是 `console.warn` —— 它每帧都会发生；`anim check` 会把它们打出来 |
| `W` / `H` | 逻辑分辨率（= `gl.w` / `gl.h`） |
| `start` / `end` | 本段起止 |
| `item` | 时间线条目本体（`{id,start,end,post,maxSamples,...,_scene,_layer}`） |
| `under` | 同 `f.under` |
| `xform` | 这一段自己的变换参数对象（见 §3.5） |
| `setXform(o)` | **声明场景级变换**（见 §3.5）。不调用 = 这一帧不做变换 |
| `util` | `util.js` 的全部导出（`clamp/lerp/ease/prog/keys/rng/hash2/...`）。**别只记得那几个**：`hsv(h,s,v)` 造**线性**色（除 `P.*` 外唯一的程序化配色入口）、`spring(elapsed,…)` 解析弹簧、`hit/pulse/pingPong/cycle` 周期脉冲、`pointAtLength/polylineLengths` 沿路径、`noise1/2/3`+`fbm1/2` 确定性噪声、`rngArray` 预算随机、`remap/invLerp/rot2/mixColor/scaleColor`、`pad/timecode/bar` |
| `rng` | `util.rng` 的便捷引用 |
| `clear(color)` | 便捷：`gl.clear(ctx.out, color)`，默认 `[0,0,0]` |

注意：**`engine.text` / `engine.type` 是 HUD 专用的**，多段重叠（转场）时它们的画布会被互相擦掉，场景里一律用 `ctx.text` / `ctx.type`。每个时间线条目都有自己独立的 `Layer2D`（`item._layer`），内存按段数线性增长（1080p 一层约 8MB）。

### 3.4 `render()` 的返回值 = 这一帧的后处理参数`render` 可以返回一个普通对象，字段是 `PostParams` 的子集（§8），会和 `DEFAULT_POST` 合并：

```js
render(ctx) {
  // ...
  return { bloom: 0.45, grain: 0.03, shake: [2, -1], flash: 0.05 };
}
```

合并优先级（低 → 高）：`DEFAULT_POST` → 时间线的 `cut(..., { post })` → `render()` 的返回值。

> 隐藏约束：多段重叠时，**最后一个成功返回 post 的段说了算**（`composite()` 里按顺序覆盖同一个 `post` 对象）；如果所有段都没返回，则用 `item.post`。转场期间想让参数连续，最好让两段返回一致的量级。
>
> 另一个隐藏约束：运动模糊时用的是**离帧中心最近的那个子帧**的 post（子帧偏移里最接近 `+0.125` 的那个），不是平均值。

### 3.5 `ctx.setXform`：场景级变换（一台摄影机 / 视差）

把**这一段的整张前景**（`lines` + 文字图层，也就是整个 `ctx.out`）当作**一组**做平移/缩放/旋转。
引擎的做法是：场景 `render()` 跑完后，如果这一帧调用过 `setXform`，就用一张全屏 Pass 把
`ctx.out` 重采样到另一张目标（绝不"读自己写自己"）。

```js
render(ctx) {
  const { f, W, H } = ctx;
  // 全片同一台摄影机：参数只跟**整片时间** f.t 走，切镜头时不断
  ctx.setXform({ x: 40 * Math.sin(f.t * 0.3), y: 12 * Math.cos(f.t * 0.21), scale: 1 + 0.01 * Math.sin(f.t) });
  // …照常画前景…
}
```

| 字段 | 默认 | 语义 |
|---|---|---|
| `x` / `y` | `0` | 位移（**逻辑像素**，y 向下） |
| `scale` | `1` | 缩放（必须 > 0） |
| `rot` | `0` | 旋转（弧度，屏幕坐标下顺时针为正） |
| `anchor` | `[W/2, H/2]` | 缩放/旋转的锚点（逻辑像素） |
| `p` / `q` | `0` | **透视（keystone）系数**：`x' = A(x,y) / (1 + p·x̂ + q·ŷ)`（`x̂/ŷ` 以 `anchor` 为原点）。实用值 `1e-4`～`1e-3`；大到 `1/画面尺度` 时地平线进画面、那条线会翻面 |
| `proj` | 无 | 直接给一个 **3×3 射影矩阵**（列主序 9 元素，`[8]` 会被归一化成 1）。这是做透视唯一"不用凑参数"的路子 —— `cam.js` 的 `camXform(cam, W, H, k)` 走的就是它 |
| `edge` | `'clamp'` | 画面外采样：`'clamp'` 夹到边缘（整体运镜，边缘会被拉成条纹）；`'black'` 为黑（整层被推走后在空旷处留黑 —— **分层视差**时配合使用：背景留在原地，前景推走后露出的就是黑） |

三条要点：

1. **每帧都要调**。引擎每帧先把 `xform.on` 归零，`setXform` 是唯一的开启方式；
   不调用就是"这一帧没有变换"（不产生任何额外开销）。
2. ⚠ **它是"整张 `ctx.out`"的变换，连引擎铺的共享背景一起动**（共享背景是先画进同一个 `rt` 再整体重采样的）——
   所以 **`setXform` 本身做不出视差**（把远景画进背景 `Pass` 也没用，它照样被推走）。要视差只有三条路：
   ① 全程不用 `setXform`，两层各自把偏移乘进自己的绘制坐标（远景 ×0.2、近景 ×1.0，**按最大位移留出画面余量**）；
   ② 拆成两段用 `overlap` 叠起来（两段各有自己的 `rt`，这才互不干扰）；
   ③ 想要"整层（含文字排版）跟着一台摄影机走"的**透视**，用 `camXform(cam, W, H, k)` 填上面的 `proj`
      —— 它天生就是"整层一起"，但 `k ≠ 0` 时文字会跟着透视，这是 2.5D 运镜的主力（见 §3.7.4）。
3. **越界处的行为想清楚**：`clamp` 会把边缘像素拉出条纹，`black` 会在空旷处留黑。
   要"整屏永远有内容"，就让场景多画一圈余量（按最大位移/缩放算）。

参数不合法（`NaN`、`scale <= 0`、`anchor` 不是 `[x, y]`）会被点名记进 `engine.errors`，
不会静默出黑屏。数学单测：`node tools/test-xform-math.mjs`。

> 想少写代码地"全片一台摄影机"，用 `src/core/trans.js` 的 `cameraPost(t)` —— 它把
> `zoom` / `shake` 交给后处理（**全帧**一起动，连背景一起），比 `setXform` 更省事，
> 区别是它没法让背景和前景走不同的量。

### 3.6 最小可跑场景

```js
// tasks/<任务>/scenes/hello.js
import { css, prog, ease } from '../../../src/core/util.js';

export default {
  id: 'hello',

  render(ctx) {
    const { f, gl, P, text, type, comp, lines } = ctx;
    const { W, H } = gl;

    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);       // ① 整帧覆盖

    lines.begin();                                            // ② 矢量
    const k = ease.outCubic(prog(f.lt, 0.2, 1.4));
    lines.seg(W * 0.2, H * 0.5, W * 0.2 + W * 0.6 * k, H * 0.5, 3, P.signal);
    lines.flush(ctx.out);

    text.clear();                                             // ③ 文字
    type.write('写代码，就是做动画', W * 0.2, H * 0.40, {
      size: 120, weight: 800, family: 'sans', color: css(P.bone),
      stagger: 0.07, from: 'up', dist: 60, t: f.lt,
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });          // ④ 叠上去

    return { bloom: 0.35, grain: 0.03 };                       // ⑤ 后处理
  },
};
```

---

## 3.7 3D（前两种）：`cam.js`（解析投影）与 `glsl3d.js`（raymarch）

引擎自带两种**手写**的"真 3D"，都写在场景里、都只依赖 `f.t`
（**没有深度缓冲、没有场景图** —— 想要那两样见 §3.8：第 3 种，真网格）：

| 种类 | 用什么 | 成本 | 什么时候用 | 参考实现 |
|---|---|---|---|---|
| ① 解析投影 + 线段批 | `camera3` / `project3` / `clipSegment` / `depthScale` / `widthAt`（`cam.js`），几何交给 `ctx.lines` | 极低 | 建筑线框、柱林、塔、任何"用线能画出来"的 3D；**几何要自己给** | `tasks/pdoom-lab/scenes/{corridor,stack,columns,loop}.js` |
| ② 真 raymarch | `GLSL3D_PRE` / `GLSL3D_KERNELS` + 场景自己的 SDF（`glsl3d.js`） | 高（GPU，每像素几十次 SDF） | 无限重复的晶格、圆角融合、内部空腔、雕版排线质感；**几何只是数学式子** | `tasks/pdoom-lab/scenes/corridor.js` + `_corridor.js` |
| ③ 真网格（Three.js） | `src/core/three-bridge.js` + `src/kit/three.js` 的 `makeThreeShot()` | 中（独立 GL 上下文 + 每子帧一次全屏合成） | 要**深度缓冲/场景图/实例化/材质光照**，或以后要导入 `.glb`；代价是多一个依赖 | `tasks/_three-lab`（沙盒）、`tasks/_three-calib`（标定） |

### 3.7.1 世界坐标约定（① 和 ② 共用，写错不会报错）

* **右手系**：`+x` 在**画面右**、`+y` 在**画面上**、`-z` 是"朝屏幕里"。
  `camera3()` 的基向量就是按这个来的：`right = cross(fwd, worldUp)`、`up = cross(right, fwd)`。
* `project3(cam, W, H, x, y, z)` 返回 `{ x, y, w }`：`x/y` 是**逻辑像素**（`y` 向下，和 `lines` 一致），
  `w` 是相机空间深度（**只有 `w > 0` 才在镜头前方**）。

* `clipSegment(a, b, near)` **就地修改** `a`/`b`：两端都在镜头后 → 返回 `false` 直接丢掉；
  一端在后 → 截到近平面上。少了这一步，镜头穿过物体时会画出翻面的长线。
* `depthScale(cam3, w, H)` 给"近大远小"的倍率（线宽 / 字号乘它）。

> ⚠ 这两条以前都写反过（`docs/history/STATUS-rounds-1-6.md` §13.4.2）：`camera3` 的手性反了会让**整幅画面左右镜像**，
> `rayDir` 多翻一次 y 会让**整个世界上下颠倒**。两者都**不报错**，而且左右/上下对称的场景里
> 完全看不出来。现在 `tools/test-cam-math.mjs`（33 项）与 `tools/probe-raymarch.mjs`（`ray` 变体）
> 各自钉了一半，改动 `cam.js` / `glsl3d.js` 之后跑一下。

### 3.7.2 raymarch 的最小骨架（顺序不能换）

```js
import { Pass } from '../../../src/core/gl.js';
import { GLSL3D_PRE, GLSL3D_KERNELS, cam3Uniforms } from '../../../src/core/glsl3d.js';
import { camera3 } from '../../../src/core/cam.js';

const SDF = `
  float sdScene(vec3 p) { return min(sdSphere(p - vec3(0.0, 1.0, 0.0), 1.0), p.y); }
  float sdSceneM(vec3 p, out float mat) { mat = 1.0; return sdScene(p); }
  #define MAP(p) sdScene(p)              // march/normal/AO/shadow 都按这两个宏调用场景
  #define MAP_MAT(p, m) sdSceneM(p, m)
`;

const FRAG = `
  uniform vec3 camPos, camR, camU, camF; uniform float focal;
  ${GLSL3D_PRE}        // ① rayDir / SDF 图元 / 3D 噪声
  ${SDF}               // ② 场景自己的 SDF（可以用 ① 里的 sdBox3 / repXZ / smin…）+ MAP/MAP_MAT
  ${GLSL3D_KERNELS}    // ③ march / marchNormal / calcAO / softShadow / hatch / fog（它们**用** MAP）
  void main() {
    vec3 ro; vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, camPos, camR, camU, camF, focal, ro);
    float mat; float hit = march(ro, rd, mat, 96, 44.0);   // 步数上限 / tmax
    vec3 col = C_INK;
    if (hit > 0.0) {
      vec3 p = ro + rd * hit, n = marchNormal(p, 0.002);
      col = shadeEngraved(p, n, rd, normalize(vec3(0.4, 0.8, 0.3)), C_EMBER, C_INK, C_BONE, 40.0, 0.5, calcAO(p, n));
    }
    fragColor = vec4(fog(col, hit < 0.0 ? 60.0 : hit, 6.0, 0.04), 1.0);
  }`;

setup(ctx) {
  this.pass = new Pass(ctx.gl, FRAG, {
    ...cam3Uniforms(camera3({ pos: [0, 0, 4], target: [0, 1, 0], fov: 50, H: 1080 })),
  }, { key: 'my_raymarch', palette: ctx.P });     // ← palette 要显式传，否则任务配色不生效
}
```

四条硬要求：

1. **`MAP` / `MAP_MAT` 必须在 `${GLSL3D_KERNELS}` 之前定义**。GLSL 的预处理器只认"出现位置
   之后"的宏；把 ①③ 合成一块放在场景之前，`march()` 里的 `MAP_MAT` 就会报
   `no matching overloaded function found`（读起来像签名不对，其实是宏没定义）。
2. **相机 uniform 用 `cam3Uniforms(...)`**，别手写字段名：`camera3()` 给的是
   `{pos,right,up,fwd,focal}`，shader 要的是 `{camPos,camR,camU,camF,focal}` ——
   对不上时 `Pass` 会静默跳过它们（保持 0），`normalize(vec3(0))` → NaN → **整屏白**。
   `cam3Uniforms()` 两种形状都认，认不出来**直接抛错**。
3. **`palette: ctx.P` 要显式传**（`Pass` 默认注入的是默认调色板，任务覆盖的颜色不会生效）。
4. **排线的坐标是世界/表面坐标**，不是屏幕坐标：传 `gl_FragCoord` 一类的东西，镜头一动排线就
   跟着爬（那是电视雪花）。用 `engrave3(p, n, darkness, freq, angle)`，它在角度/接缝处会退化时
   换成自带导数的 `hatchD(u, d, du)`。

性能上：march 步数给 96–160 就够（108 个子帧的运动模糊会把成本乘 108 倍）；
`softShadow` 的 `tmax` 给小一点（3 个单位）能省掉大半步数；远处交给 `fog` 收掉。

### 3.7.3 「整屏白 / 整屏黑 / 一片死平」怎么查

引擎里**没有一种失败长得像它的原因**（`docs/history/STATUS-rounds-1-6.md` §13.4），先看这张表再去改代码：

| 你看到的 | 真正发生了什么 | 怎么确认 |
|---|---|---|
| 整屏白（四角有暗角） | 场景往 HDR 缓冲写了 **NaN 或 ±Inf**（两者显示**完全一样**） | `node scripts/anim.mjs check <任务>` —— 会报「非有限值：NaN n / Inf n」并给第一个坏像素坐标 |
| 单帧白、成片黑 | 同上：`samples > 1` 走累加，`_accumPass()` 会把非有限值丢掉 | 同上（`check` 还会报"单子帧与多子帧亮度差了 N×"） |
| 一片**平**的亮色，没有明暗 | 每条光线都打空 → 全落到背景分支；或相机 uniform 全 0 | `node tools/probe-raymarch.mjs --only ray,hit_mask`：`ray` 该有渐变、`hit_mask` 该有形状 |
| 地板在天上 / 左右镜像 | 射线或基向量翻错了一次（`FRAG_PX` 的 y 向上、`camera3` 右手系） | `tools/probe-raymarch.mjs` 的 `ray` 变体（左半 R<0.5、右半 R>0.5、上半 G>0.5）；场景里把 `params.dbg` 切到法线图一眼可见 |

`tools/probe-raymarch.mjs` 是这一层的专用量具：它把"引擎里的一条 shader"拆成 14 个变体，
同一个浏览器会话里逐个渲染，**直接读 RGBA16F 浮点缓冲**（8bit 读回分不出 NaN 和 Inf），
并给 14 条判据与退出码。想看某个变体最终显示成什么样，加 `--png <变体名>`。

### 3.7.4 `${GLSL3D_KERNELS}` 里还有什么（写 raymarch 之前先扫一眼）

这些东西文档别处没点名，但它们直接决定画面"贵不贵"：

| 想要 | 用什么 | 备注 |
|---|---|---|
| 噪声（云、地形、浮尘、材质扰动） | `snoise3(v)`、`fbm3(v)`（4 个八度） | **raymarch 里别用 `vnoise(vec3)`** —— 值噪声在步进里会出现方块状色阶 |
| 无限重复（晶格、隧道、柱列） | `repY(p, period)`、`rep3(p, period)`、`repXZ(p, period)` | §3.7 举例的"无限晶格"就是它 |
| 变形 | `opTwistY(p, k)`、`opTaperY(p, k)` | 螺纹、锥化 |
| 图元 / 布尔 | `sdRoundBox`、`sdPlane`、`opSub`、`opInt`、`opU` | 圆角盒、地面、掏空、相交、软并 |
| **正交**投影（剖面图 / 工程图 / 蓝图） | `rayDirOrtho(...)` | 与透视的 `rayDir` 并列；想做"正投影"只有这一条路 |
| 硬边更准的法线 | `marchNormalCD(p, e)`（中心差分，6 次 `MAP`） | 默认 `marchNormal` 是四面体差分（4 次）；盒子棱角糊就换它 |
| 只要"有没有挡住"的射线 | `marchDist(ro, rd, tmax, steps)` | 省一半 `MAP` |
| 版画 / 排线 | `hatch(float u, float d)`、`hatchD`、`crossHatch(uv,d,freq,angle)`、`engrave3(p,n,d,freq,angle)` | 3D 表面**必须**用 `hatch(float,…)` 那个（`fwidth` 抗锯齿）；`GLSL_COMMON` 的 `hatch(vec2,…)` 一运动就闪 |
| 一步到位的材质 | `shadeEngraved(p, n, rd, lightDir, lightCol, inkCol, paperCol, freq, angle, ao)` | §3.7.2 的示例用的就是它；`ao` 传 `calcAO(p, n)` |
| 体积光尘 / 高度雾 | `dust(ro, rd, t0, t1, density, scale, col)`、`fogH(col, t, y, near, k, hFall)` | 光柱里的浮尘、低处更浓的雾 |
| 卡住时看步数 | `marchSteps(ro, rd, steps, tmax)` | 判断"是打空了还是步数不够" |
| 一整块 | `GLSL3D`（= `GLSL3D_PRE` + `GLSL3D_KERNELS`） | 顺序已经拼好，但场景自己的 `MAP/MAP_MAT` 仍要插在中间（§3.7.2 第 1 条） |

### 3.7.5 2D 世界摄影机：`cam.js` 的另一半（运镜主力）

`cam.js` 不只是 3D 那套。它还有一台**吃世界坐标的 2D 摄影机** —— 这是"画面显得便宜"与"像拍出来的"分界：
后处理的 `zoom`/`shake` 只能整帧缩放与抖动，而它有关键帧、有不动点、有速度、有方向性拖影。

```js
import { makeCam, projectLine, camXform, smearTimes, smearAlpha, handheld } from '../../../src/core/cam.js';

setup(ctx) {
  // 关键帧： [t, {x, y}, zoom, rot?, 这一段用的缓动]
  this.CAM = makeCam([
    [0.0, { x: 0,   y: 2.0 }, 0.80,  0.02],
    [1.2, { x: 0.3, y: 2.0 }, 0.80,  0.02, 'linear'],    // 停一拍
    [1.9, { x: 3.2, y: 0.4 }, 2.60, -0.06, 'outExpo'],   // 甩过去并推近
  ]);
  this.path = [[0, 0], [1, 2], [3, 1]];                  // 世界坐标里的折线
},

render(ctx) {
  const { f, lines, P, W, H } = ctx;
  const cam = handheld(this.CAM.at(f.t), f.t, f.idx, { amp: 0.004 });   // 平滑手持（默认 smooth，不是白噪声）
  lines.begin();
  // 几何上的方向性拖影 = 真甩镜：只糊动的几何，不糊背景
  // （后处理会把不动的背景一起糊掉，看起来像镜头脏了 —— cam.js 的原话）
  const ts = smearTimes(this.CAM, f.t, f.dt);
  const al = smearAlpha(ts.length);                     // ⚠ 参数是"几份"，不是索引
  for (const tt of ts) {
    lines.polyline(projectLine(this.CAM.at(tt), W, H, this.path), 2, [P.signal[0], P.signal[1], P.signal[2], al]);
  }
  lines.flush(ctx.out);
  ctx.setXform(camXform(cam, W, H, 0.0006));   // 整层（含文字排版）跟同一台摄影机；k≠0 就是透视
  // …文字照常画…
}
```

| 想要 | 用什么 |
|---|---|
| 关键帧机位（zoom 对数插值、自动不动点） | `makeCam(ks)` → `CAM.at(t)` |
| 世界坐标 → 屏幕 | `project(cam, W, H, x, y)`、`projectLine(cam, W, H, pts)`（直接喂 `lines.polyline`） |
| 整层透视（"低头看一张摊在桌上的纸"） | `camXform(cam, W, H, k, { edge })` → `ctx.setXform(...)`（内部填 `proj`；`k=0` 时与 `project(k=0)` 逐像素一致） |
| 甩镜的方向性拖影（在几何上做） | `smearTimes(cam, t, dt)` + `smearAlpha(份数)` + `camVelocity(cam, t, dt)` |
| 平滑手持（唯一正确的手持） | `handheld(cam, t, idx, { amp })` / `shakeSmooth(t, amp, { hz })` |
| 换机位不断裂 | `mixCam(a, b, k)` |
| 镜头跟着某个元素走 | `unproject(cam, W, H, sx, sy)` |

⚠ **`cam.js` 与 `src/kit/world.js` 各有一份 `cameraAt` / `cameraPost` / `enterOffset`，数值不同**
（`trans.js` 的 `enterOffset` 默认 150、`kit/world.js` 默认 130；`cameraAt` 的 shake 一份 38/13、一份 22/9）。
**一支片子里只用一套**，别混着 import —— 混了不会报错，只会"幅度怎么和文档写的不一样"。

### 3.7.6 转场四件套：`src/core/trans.js`

| 想要 | 用什么 |
|---|---|
| 交叠期把上一帧**甩走**（不是原地淡出） | `transitionPass(gl, { push = 0.36, blur = 0.085, fadeAt = 0.55, victimRatio })` —— **文字量大的画面必须用它**，交叉溶解会把两屏字叠糊 |
| 每帧第一句就"铺背景 + 甩走上一帧" | `makeTransitionKit(ctx)` → `const k = tk.openFrame(ctx)`（返回入场进度） |
| 全片一台摄影机 | `cameraPost(f.t, { …这一段的 post })`（= `cameraAt(f.t)` + 你的参数；**用 `f.t` 不是 `f.lt`**） |
| 新内容从**反方向**落位 | `enterOffset(f.t, k, 220)` → `[dx, dy]` 直接加到坐标上 |
| 摄影机此刻的运动方向 | `cameraDir(t, dt)` |

**八种转场模式（BACKLOG 1-13）**：段上写 `transition: '<名字>'`（配置档节点 / `cut` 的 opts 都行）。

| 名字 | 走哪条路 | shader |
|---|---|---|
| `'push'`（默认） | `transitionPass` → `_pushTransition` | `TRANSITION_FRAG.push`（**与 2026-10-30 之前逐字符相同**） |
| `'mix'` | `compositor.mixTo`（交叉溶解） | `compositor_mix` |
| `'none'` | 什么都不做（硬切） | — |
| `'wipe' / 'iris' / 'glitch' / 'pixel' / 'dissolve'` | `transitionPass({ mode })` | `src/core/transition-frag.js` |

- 模式名在 `TRANSITION_MODES`（`src/core/trans.js`）里定义**一次**，写错当场抛并列出可用值。
- 六支 shader 共用六个 uniform：`under` / `k` / `dir` / `push` / `blur` / `fadeAt`；
  **`fragColor` 的 alpha = "旧帧还剩多少"**。
- 引擎按模式缓存 Pass（`this._transPasses`）—— 别在场景里每帧新建 `Pass`，编译一次几十毫秒。
- `transitionFadeAt(mode)` 给每种模式一个"旧帧最晚什么时候退干净"的默认值（`push` 仍是 **0.55**）。
  ⚠ 掩码型转场（wipe/iris/pixel/dissolve）**不要**再叠全局淡出：两个 fade 相乘会让中段发灰。
- 与 `victimRatio` **正交**：两个都给就都生效（模式决定"长什么样"，比例决定"旧的走多快"）。
- `docs/MOTION.md` §3.6 有每种的画面描述与选型建议；夹具 `tasks/_trans-lab`。

---

## 3.8 第 3 种 3D：真网格（Three.js，`src/core/three-bridge.js`）

前两种（§3.7）都**没有深度缓冲、没有场景图**；这一种有。做法是把 Three.js 渲出来的画面
当成**引擎的一张图层**，所以从合成器往后的每一步 —— 后处理（泛光/颗粒/暗角/调色）、
NV12 推流、`verify`、`hashes` —— 与别的镜头**完全相同**。

这也是"拼接"唯一正确的做法：各渲各的 mp4 再 `ffmpeg concat`，两边是两套 sRGB/色调映射/
泛光/颗粒实现，接缝一定看得出来，`verify` 也失去意义。

```
Three.js 渲进自己的 offscreen canvas
  → texImage2D(RGBA8) 上传成引擎的一张纹理
  → 一个 blend:false 的全屏 Pass 铺进 ctx.out（**记 paint.full**，背景守门看的就是这个数）
  → 图层合成 → 后处理 → readNV12() → WebSocket → ffmpeg
```

| | 说明 |
|---|---|
| 路线 | **独立 GL 上下文 + canvas 上传**（**不是**共用上下文）。共用时两边各自管绑定/混合/viewport/VAO/program，互相污染**不报错、只是画面诡异** |
| 依赖 | `three`（在 `dependencies` 里）。**动态 `import('three')`**：不用它的任务不会被拖进模块图；`vite.config.mjs` 的 `optimizeDeps.include` 让它开机就预打包（否则 Vite 会在渲染中途发现新依赖 → 整页刷新 → 推流断） |
| 入口 | `src/kit/three.js` 的 `makeThreeShot()`（整镜头，与 `makeShot` 同形状）；`src/core/three-bridge.js` 的 `loadThree()` / `getThreeBridge()` / `ThreeBridge`（机制）。写法与坑见 **`docs/THREE.md`** |
| 三种合成 | `cover`（不透明整帧 → 记 `paint.full`）/ `over`（直通 alpha，浮在引擎背景上）/ `add`（加法） |
| 子帧 | **每个子帧都重渲一次 Three.js** ⇒ 运动模糊是真的（8–216 次/帧）；一帧内子帧乱序 ⇒ 与别的场景同一条铁律：只吃 `f.t`、不用 `Math.random`、不做逐帧累积 |
| 生命周期 | 每个 GL 实例**共享一个**桥（按 `alpha/antialias/shadows` 分签名）；`GL.onDispose[]` 负责把它的上下文一起丢掉 |

### 3.8.1 颜色：为什么半透明**不能**用 `SRGB8_ALPHA8`

这一节是**量出来的**，不是推出来的（`tasks/_three-calib` + `tools/probe-three.mjs`）：

* 引擎整条链在**线性光**里跑，Three.js 侧保持 `outputColorSpace = SRGBColorSpace`
  （画布上是 sRGB 字节），`toneMapping` 保持 `NoToneMapping` —— 曝光与调色由引擎统一做，别调两次。
* **不透明**时，按 `SRGB8_ALPHA8` 上传、硬件解码回线性是对的（`Layer2D` 走的就是这条）。
* **半透明不行**：画布给的 RGB 是**预乘过 alpha、而且是在 sRGB 编码空间里预乘的**
  —— 实测半透明红在画布上读到的是 R'≈0.5 而不是 1.0。硬件解码发生在乘 alpha **之后**，
  除法补不回来：半透明红 over 线性 0.5 灰得到 **161**，正确值是 **225**。
* 所以桥按普通 **RGBA8** 上传，在 shader 里**先反预乘（仍在编码空间）、再 `toLinear()`**。
  顺序不能颠倒。修完实测 **223 / 206**（期望 225 / 207，差的那点是 8bit alpha 量化）。
* 不透明那条路（`cover`）与 `lines` 画的同一个线性值**逐字节相同**（Δ0–1），
  这是"两条颜色管线在同一个空间里"的直接证据。

### 3.8.2 记账：为什么 `'over'` 那一段要自己再铺一次背景

`gl._notePaint()` 只把 **`blend:false` 的全屏绘制**记进 `paint.full`，而 `check` 的背景守门
看的就是这个数。`'cover'` 那一笔天然记上；`'over'`/`'add'` 带混合，记不上 ——
所以 `makeThreeShot` 在 `'over'`/`'add'` 下会在**本段自己的 render 里**再铺一次 `ctx.world`。

⚠ 不能只靠时间线上的 `world: 'auto'`：引擎铺那一笔发生在 `composite()` 里
**`gl.paint` 重置之前**，守门看不到它（`engine.js`）。

### 3.8.3 与 ① 的对齐：为什么过渡镜头能逐像素接上

three 的 `PerspectiveCamera` 与 `cam.js` 的 `project3()` 是**同一个公式**：

```
x_px = (x_view / −z_view) · focal + W/2,   focal = (H/2) / tan(fov/2)
```

（three 那侧：`m[0] = 2n/width`，而 `width = aspect·2n·tan(fov/2)` ⇒ 同一个 `focal`。）

⇒ 同一个世界原点、同一个 `pos/target/fov` 之下，**引擎画的线框与 Three.js 画的实体逐像素同位**。
`tasks/_three-lab` 的 B 段（**纯引擎自绘**：解析投影 + 线段批 + 扫描线填充）就是靠这条
与前后两段 Three.js 镜头对齐的 —— 这就是"中间用同一个易实现且表现相同的画面做转场"能成立的原因。
`api.project(x, y, z)` 走同一条数学，所以引擎画的标签/引线也贴得住 3D 物体。

---

## 4. `Pass`：全屏 shader

### 4.1 构造与渲染

```js
import { Pass } from '../../../src/core/gl.js';

this.bg = new Pass(
  ctx.gl,
  /* glsl */ `
    uniform vec3 ink;
    void main() { fragColor = vec4(ink, 1.0); }
  `,
  { ink: [0.01, 0.01, 0.01] },              // uniform 初值
  { key: 'demo_bg', blend: false },          // 可选：程序缓存键 / 是否混合
);

// 渲染
this.bg.u.ink.value = P.ink;                 // 直接改
this.bg.set({ ink: P.ink2 });                // 或批量设
this.bg.render(ctx.gl, ctx.out, f.t, f.dt);  // (gl, target, time, dt)
```

`render(gl, target = null, time = 0, dt = 1/60)` 自动设置这些 uniform：`t = time`、`dt`、`res = [gl.pw, gl.ph]`、`RES_LOGICAL = [gl.w, gl.h]`、`PX_SCALE = gl.scale`。`target = null` 表示直接画到画布。

### 4.2 uniform 值 → GLSL 类型的推导规则

| JS 值 | GLSL |
|---|---|
| number | `float`（`uniform1f`） |
| boolean | `int`（0/1） |
| `[2]` / `[3]` / `[4]` | `vec2` / `vec3` / `vec4` |
| `[9]` / `[16]` | `mat3` / `mat4` |
| 长度 > 16 的数组 / Float32Array | `float[]`（`uniform1fv`） |
| `RT` / `Layer2D` / `tex(x)` | `sampler2D`，纹理单元按声明顺序自动分配 |

shader 里没声明的名字会被静默跳过（不报错），所以写错 uniform 名只会得到黑/零值。
⚠ **数组长度只有 `2/3/4/9/16` 和 `> 16` 有意义**：长度 5–8 与 10–15 的数组**没有任何分支**，
会被**静默忽略**（shader 里保持 0）。要传 6 个数就拆成 `vec3 + vec3`，或凑成长度 9/16。

### 4.3 `GLSL_COMMON` 提供的东西（**不要重复声明**）

`Pass` 的最终源码是：`#version 300 es` + `precision highp float; precision highp int;` + 调色板常量 + `GLSL_COMMON` + 你的片段代码。所以下面这些名字**已经存在**：

**精度与接口**

| 名字 | 说明 |
|---|---|
| `precision highp float/int` | 已声明，不要再写 |
| `in vec2 vUv` | 0..1 的 uv，y 向上。不要重新声明 |
| `out vec4 fragColor` | 输出。不要重新声明 |
| `FRAG_PX` | 宏：`gl_FragCoord.xy / PX_SCALE`，物理像素 → 逻辑像素 |
| `gl_FragCoord` | 物理像素，y 向上（GLSL 原生） |

**引擎注入的 uniform（不要在源码里写 uniform 声明，直接改值即可）**

`uniform float t; uniform float dt; uniform vec2 res; uniform vec2 RES_LOGICAL; uniform float PX_SCALE;`

**调色板常量**：`C_INK` `C_INK2` `C_GRAPHITE` `C_ASH` `C_BONE` `C_SIGNAL` `C_EMBER` `C_BLOOD` `C_ACID`，以及对应的 `C_XXX_SRGB`。任务用 `palette: { signal: '#00e0ff' }` 覆盖后，常量值也随之改变（键名大写、非字母数字变 `_`）。

**常量**：`PI = 3.141592653589793`、`TAU = 6.283185307179586`

**函数**

| 类别 | 名字 |
|---|---|
| 饱和度 | `float sat(float)`、`vec3 sat(vec3)` |
| 亮度 | `luma(vec3)`（Rec.709 权重） |
| 像素步长 | `uStep(float px)` → `vec2(px/RES_LOGICAL)` |
| AA | `aaFill(d, aa)`、`aaStroke(d, w, aa)`、`pxLine(d, a, b)` |
| 哈希 | `hash11(float)`、`hash12(vec2)`、`hash13(vec3)`、`hash22(vec2)`、`hash33(vec3)` |
| 噪声 | `vnoise(vec2)`、`vnoise(vec3)`、`fbm(vec2)`（5 个倍频）、`curl2(vec2 p, float e)` |
| 2D SDF | `sdCircle(p,r)`、`sdBox(p,b)`、`sdSegment(p,a,b)`、`sdRound(p,b,r)`、`sdRing(p,r,w)`、`sdTri(p,r)` |
| 平滑布尔 | `smin(a,b,k)`、`smax(a,b,k)` |
| 3D SDF | `sdSphere(p,r)`、`sdBox3(p,b)`、`sdTorus(p,t)`、`sdCapsule3(p,a,b,r)` —— 法线**别用这一层的**，见下面的警告 |
| 版画 | `hatch(vec2 u, float d)`（2D 装饰：**不抗锯齿**、线宽对 `d` 是阶跃）、`engrave(uv, darkness, freq, angle)`；**3D 表面 / 运动会闪的画面必须用 `${GLSL3D_KERNELS}` 里的 `hatch(float u, float d)`**（`fwidth` 抗锯齿、线宽连续），另有 `hatchD` / `crossHatch` / `engrave3` |
| 热色带 | `heat(float x)`（依赖 `C_BLOOD/C_SIGNAL/C_EMBER`） |
| 色彩空间 | `toSRGB(vec3)`、`toLinear(vec3)` |

写 shader 时的四条硬规则：

1. 只写 `void main(){ ... }` 和**你自己的** uniform；`vUv` / `fragColor` / `t` / `res` 之类已在 `GLSL_COMMON`，重复声明会编译失败。
2. 声明自己的变量名别撞上表里的函数名（例如局部变量叫 `sat`、`luma`、`line` 中的 `line` 没问题，`sat` 有问题）。
3. 不开 MSAA（`antialias: false`）。抗锯齿靠逐像素 SDF + 多子帧，所以**自己用 `aaFill` / `fwidth` 做边缘**，不要指望硬件。
4. ⚠ **`GLSL_COMMON` 里的 `sdfNormal(p, e, d)` 是坏的，不要调用**：它把四个基向量相加，而那四项恒等于 `(0,0,0)`
   ⇒ `normalize(vec3(0))` ⇒ **NaN ⇒ 整屏白（四角有暗角）且不报错**。raymarch 的法线一律用
   `glsl3d.js` 的 `marchNormal(p, e)`（四面体差分，4 次 `MAP`）或 `marchNormalCD(p, e)`（中心差分，硬边更准，6 次 `MAP`）。
   排查见 §3.7.3 与 `node tools/probe-raymarch.mjs`。

### 4.4 程序缓存键

`opts.key` 决定程序缓存（`gl.programs`）。默认 key 是片段源码的哈希，所以同一个源码会复用；**同一个 key 但源码不同会拿到旧程序**。共用 key 是有意的优化（后处理链每个 Pass 一个 key），写自己的 shader 时给个唯一 key 最省事。

### 4.5 混合模式

`Pass` 默认 `blend: true`，用直通 alpha（`SRC_ALPHA, ONE_MINUS_SRC_ALPHA`）。三个选择：

- `{ blend: false }` —— 覆盖写。**背景、后处理每一级都必须是它**，否则会和上一帧内容叠加。
- 默认（不写）—— 正常 alpha 叠加（半透明图层）。
- `pass.blend = true; pass.blendFn = 'add' | 'max'` —— 纯加法（子帧累加）/ 取最大；引擎内部的累加与误差 Pass 用这两种。

### 4.6 最小可跑示例（全屏可 seek 的噪声底）

```js
setup(ctx) {
  this.bg = new Pass(ctx.gl, /* glsl */ `
    uniform float speed;
    void main() {
      vec2 p = (FRAG_PX - 0.5 * RES_LOGICAL) / RES_LOGICAL.y;
      float f = fbm(p * 3.0 + vec2(t * speed, -t * speed * 0.6));
      vec3 col = mix(C_INK, C_INK2, smoothstep(0.25, 0.8, f));
      col += C_SIGNAL * 0.06 * exp(-9.0 * dot(p, p));
      fragColor = vec4(col, 1.0);
    }`, { speed: 0.08 }, { key: 'my_bg', blend: false });
},
render(ctx) {
  this.bg.render(ctx.gl, ctx.out, ctx.f.t, ctx.f.dt);
}
```

---

## 5. `Layer2D` + `TextKit`：文字与 2D 图形

### 5.1 生命周期（顺序错了就什么都看不见）

```js
text.clear();                          // ① 每帧开头清空（不写就叠上一帧的字）
type.write('...', x, y, { ... });      // ② 画
text.upload();                         // ③ 上传到 GPU（同一帧内多次调用只传一次）
comp.draw(gl, text, ctx.out, { premult: false });   // ④ 叠到场景上
```

`Layer2D` 其他方法：`fill(cssColor)` 铺满整块画布、`resize(scale)`（引擎在 `scale` 变化时内部调用）、`clear()`、`upload()`、`dispose()`。`ctx.text.ctx` 就是那个 Canvas2D 上下文，想画自定义图形可以直接用它。

**一层一个 `TextKit`**（`text.type`）：`TextKit` 把字体/对齐状态存在它包装的 ctx 上，共用会把字画到别的画布上（历史事故：文字全部凭空消失）。跨段共用同一个 `TextKit` 也是错的。

### 5.2 `TextKit` API

#### `font(style)` → CSS font 字符串

`style` 字段与默认值：

| 字段 | 默认 | 说明 |
|---|---|---|
| `size` | `64` | px（逻辑像素） |
| `weight` | `400` | `400` / `700` / `800` / `900` 或字符串 |
| `italic` | `false` | |
| `family` | `'sans'` | `'sans'` / `'mono'` / `'serif'`，或任意 CSS 字体栈字符串 |
| `tracking` | `0` | 额外字距（px/字），可为负 |
| `align` | `'left'` | **整行对齐**：`x` 是这一行的左沿 / 中心 / 右沿。与 `writeLine(..., { anchor })` 同义、画面逐字节相同。见下面 §3.4 的说明（2026-10-24 修正，之前是逐字生效的） |
| `baseline` | `'alphabetic'` | Canvas2D 的 textBaseline |

`FAMILIES`：`sans` = `'Archivo', 'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif`；`mono` = `'IBM Plex Mono', 'Sarasa Mono SC', 'Consolas', monospace`；`serif` = `'Cormorant Garamond', 'Noto Serif SC', 'Songti SC', serif`。网页字体从 `/fonts/fonts.css` 加载，缺失时静默回退系统字体。

#### `measure(text, style)` → number

整串宽度，**含 tracking**：`ctx.measureText(text).width + max(0, 字素数-1) * tracking`。
（注意：内部对单字测量也走这个公式，所以对单字测量在 `tracking != 0` 时会多算 `max(0,0)*tracking = 0`，即单字测量不含 tracking。）

#### `layout(text, style)` → `{ clusters, cum, x }`

- `clusters[i]`：第 i 个字素簇（中文一个字、emoji 一个整体）。
- `cum[i]`：第 i 个簇**之前**的累计宽度（带真实 kerning）；`cum[length]` 是整行宽度。
- `x[i]`：第 i 个簇的位置 = `cum[i] + i * tracking`，**相对传入的 x**。

#### `write(text, x, y, opts)` → this

`opts` = 排版字段（上表）+ 下列动画字段：

| 字段 | 默认 | 语义 |
|---|---|---|
| `color` | `'#fff'`（内部 `css([1,1,1])`） | CSS 颜色字符串，或**字符串数组**（按 `i % len` 循环，一个标题里混色很方便） |
| `alpha` | 无 | **两种写法语义不同**：`[a0, a1]`（数组）= 随 `t` 插值（`{ alpha: [0, 1], t: f.lt, staggerDur: 1 }` 就是干净的整行淡入，**必须配 `t`**）；`0.6`（数值）= **常量不透明度**，与 `t` 无关 —— 想要固定透明度就直接写数值，别为了"保险"写成 `[0.6, 0.6]`（那反而引入对 `t` 的依赖） |
| `blur` | 无 | **1-41 新增，与 `alpha` 同构**：`[b0, b1]`（数组，px）= 随进场进度从 b0 收到 b1（"从虚焦里浮出来"）；数值 = **常量虚焦**。实现是 Canvas2D 的 `ctx.filter = 'blur(Npx)'`，逐字设置、画完立刻复位；**`blurPx < 0.05` 时完全不碰 filter**（不传 = 老画面逐字节不变）。⚠ 它跟**位移共用缓动 `e`**（不是线性 `k`）—— 分开缓动会出现"位移到位了、字还糊着"。`title` 模板的 `blur` 参数就是它的用法示例 |
| `stagger` | `0` | 每个字延迟多少秒。`> 0` 启用逐字错开 |
| `staggerDur` | `0.45` | 每个字**自己**的动画时长（秒） |
| `from` | `'none'` | `'up'` / `'down'` / `'left'` / `'right'` / `'scale'` / `'none'` |
| `dist` | `size * 0.6` | `up/down/left/right` 是位移距离（px）；**`from: 'scale'` 时它先被除以字号**才是起始缩放增量（`起始 scale = 1 + dist / size`，默认 `size*0.6` ⇒ **1.6×**）—— 想要 1.4× 就写 `dist: size * 0.4`，写 `dist: 0.4` 会几乎不动 |
| `t` | `0` | 场景局部时间（配合 `stagger` / `alpha` 用） |
| `seed` | 无 | 抖动随机种子（当前实现未使用） |

语义细节（都是代码事实，不是约定）：

- 第 i 个字的进度 `k = sat((t - i*stagger) / staggerDur)`；**只有 `stagger > 0` 或 `alpha` / `blur` 是数组时才走这条公式**，否则 `k = 1`（整串立即出现）。
  > 两个历史坑，现在都修好了（`docs/history/IMPROVEMENTS-1-3.md` P1-3 → `docs/history/IMPROVEMENTS-1-3.md` P0-1）：
  > ① 以前条件是 `stagger > 0`，于是 `stagger: 0` + `alpha: [0,1]` 的"整行淡入"取不到起始值、整行直接以终值出现（两个任务的 `_kit.js` 只好写 `stagger: 1e-4` 绕过）；
  > ② 后来把**数值型** `alpha` 也当成"要动画"，于是 `alpha: 0.5` 配缺省的 `t = 0` 取到 `k = 0` —— 而 `k <= 0` 是 `continue`，**整个字形不画**（不是画成透明）。症状是"一整块字凭空消失、其余画面完全正常"，`check` 的亮度统计看不出来（tasks/beast 的字典大格与兽语卡就是这么没的）。
  > 现在：数组型才按 `t` 插值，数值型就是常量不透明度；`alpha <= 0` 时这一行整体不画（这是调用方的本意）。
- 缓动固定是 `outCubic`：`e = 1 - (1-k)^3`。
- `from !== 'none'` 时**一定会**额外乘 `globalAlpha = e`，也就是逐字入场自带淡入；`from: 'none'` + `stagger > 0` 则是「逐字硬出现」。
- `from: 'up'` 是「从下方浮上来」：`dy = (1-e) * dist`（y 向下，所以正数是往下偏）。
- 空格与 `\n` 会被跳过不画（但位置仍然占了），所以用 `slice(0, n)` 做打字机不会跳位。
- ✅ `align` 是**整行**对齐的（`x` = 左沿 / 中心 / 右沿），与 `writeLine(..., { anchor })` 等价。

  > **这一条在 2026-10-24 之前是反的**，值得记一笔（BACKLOG 0-3）：`write` 内部对每个簇
  > 调用 `fillText(cl, x + X[i], y)`，而 Canvas2D 的 `textAlign` 对**每次调用**都生效，
  > 所以当时 `align: 'center'` 是**每个字各自居中**（整行从 x 往右排）、`'right'` 是
  > 整行向右溢出一个行宽。文档把它写成"引擎特性"（"别用 align，用 writeLine"），
  > 于是 `src/shots/` 里 5 个模板的多字行**一直被裁**（`kinetic` 的「都是时间的函数」
  > 实测 x 875..2029，右边 109px 出画）。没修的理由是「修它会改 `demo` 的画面、
  > 要重存 `hashes` 基线」—— 那条理由在基线策略改版后作废。
  > 现在两种写法都按整行算，`writeLine` 只是语义更清楚的一层转发。
  > 判据：`node tools/test-text-align.mjs`（几何量到像素，不需要 GPU）。

#### `writeLine(text, x, y, { anchor: 'left'|'center'|'right', ...opts })` → 这一行的宽度

按锚点写一行：`anchor: 'center'` 时 `x` 是整行中心，`'right'` 时 `x` 是右边缘。
**与 `write(..., { align })` 完全等价**（内部就是转发），保留它是因为"锚点"这个词比"对齐"
更贴这件事，而已经写了它的任务代码不用改。锚点与逐字动画可以一起用。

```js
type.writeLine('中文标题', 960, 400, { anchor: 'center', size: 120, weight: 800, color: css(P.bone) });
type.writeLine('右下角的小字', 1800, 1000, { anchor: 'right', size: 24, family: 'mono', ...fade(f.lt, 0.4) });
```

（两个历史任务的 `_kit.js` 里各写过一份 `put()` 做同一件事，现在引擎自带。）

#### `karaoke(text, words, x, y, t, opts)` → this

逐词卡拉OK。`words` 是 `{w, start, end}[]`，每项是**原文本的一段**，按顺序拼起来必须等于 `text`；空白和标点也各算一项，这样位置对得上。

```js
render(ctx) {
  const { type, text, comp, gl, P } = ctx;
  const line = '代码即素材 万物皆可渲染';
  const T0 = 2.0, STEP = 0.55, CHUNK = 2;         // 每 2 个字一组
  const words = [];
  for (let i = 0, k = 0; i < line.length; i += CHUNK, k++) {
    words.push({ w: line.slice(i, i + CHUNK), start: T0 + k * STEP, end: T0 + (k + 1) * STEP });
  }
  text.clear();
  type.karaoke(line, words, 160, 620, ctx.f.lt, {
    size: 84, weight: 800, family: 'sans',
    base: css(P.ash), sung: css(P.signal), dim: 0.35, lead: 0.25, sweep: true,
  });
  text.upload();
  comp.draw(gl, text, ctx.out, { premult: false });
}
```

| 选项 | 默认 | 语义 |
|---|---|---|
| `base` | `css([0.62,0.6,0.57])` | 未唱到的颜色 |
| `sung` | `css([1,1,1])` | 已唱到的颜色 |
| `dim` | `0.35` | 未到 `start - lead` 时的整体不透明度 |
| `lead` | `0.25` | 提前量（秒）：字可以稍微早亮，不能早于声音太多 |
| `sweep` | `true` | `true` = 按词内进度从左到右擦出（clip 一段矩形）；`false` = 整段跳到 `sung` |

实现细节：进度 `ease = 1 - (1 - sat((t - start + lead) / max(0.04, end - start)))^3`；`lit = t >= start - lead`。`sweep` 时用 `rect(x0 - size, y - size*1.3, wpx*ease + size, size*2.6)` 做 clip，所以**左边会多刷一个 size 的余量**（防止斜体/字面伸出被切）。

`wordsOf(line, times)`（`text.js` 导出）能按空白把一行切成 words 骨架，时间由 `times` 数组补：`wordsOf('a b c', [[0,0.3],[0.3,0.6],[0.6,1]])`。

#### `wrap(text, style, maxWidth = 1200)` → `string[]`

按宽度折行。中文（`\u4e00-\u9fff`、全角标点）逐字断，拉丁按词断；`\n` 强制换行并保留空行。单 token 超过 `maxWidth` 时不会硬切（整 token 独占一行）。

#### `paragraph(text, x, y, style, opts)` → 行数

`opts.lineHeight` 默认 `size * 1.35`，`opts.width` 默认 `1200`。内部就是 `wrap` + 逐行 `write`，`opts` 的其余字段（`stagger`/`from`/`t`/`color`…）会透传给每一行。

#### `writeOnPath(text, pts, style, opts)` → `[x, y, angle, cluster][]`

沿折线（逻辑像素 `[[x,y],...]`）按弧长排字。

| 选项 | 默认 | 语义 |
|---|---|---|
| `offset` | `0` | 起点沿路径的弧长偏移（滚动效果就动它） |
| `tilt` | `0` | 额外旋转（弧度），`-PI/2` 之类的整体倾斜 |
| `color` / `alpha` | 白 / 1 | |
| `perChar(cluster, index)` | 无 | 返回 `{ dy, scale, alpha }` 逐字微调 |

基线用 `fillText(cl, 0, size * 0.34)` 落在路径上。

#### `clearCache()`

字体 / DPR 改变后调用。`app.js` 在字体加载完成后对每层都调一次。

---

## 6. `LineBatch`：矢量线段批

```js
const L = new LineBatch(gl, 60000);   // capacity = 最多多少条线段
L.begin();
L.seg(x0, y0, x1, y1, width, color);
L.polyline(pts, width, color, closed);
L.circle(cx, cy, r, width, color, segs);
L.rect(x, y, w, h, width, color);
L.tick(x, y, len, width, color, angle);
L.flush(target);                       // 返回画了多少条线段
```

| 方法 | 签名（含默认值） | 说明 |
|---|---|---|
| `begin()` | — | 重置写入偏移。**每帧都要调** |
| `seg(ax, ay, bx, by, width=1, color=[1,1,1])` | 一条线段（GPU 端画成胶囊） |
| `polyline(pts, width=1, color=[1,1,1], closed=false)` | `pts` 是 `[[x,y],...]` |
| `circle(cx, cy, r, width=1, color=[1,1,1], segs=48)` | 折线近似 |
| `rect(x, y, w, h, width=1, color=[1,1,1])` | 描边（不是填充），`closed=true` |
| `fillRect(x, y, w, h, color=[1,1,1], step=2)` | **填充**矩形：沿 y 用密排横线铺满（线宽=步进）。`step` 越小边缘越准、批里条数越多 |
| `tick(x, y, len=8, width=1, color=[1,1,1], angle=0)` | 以 `(x,y)` 为中心、长 `len` 的**一条**线段（`angle` 方向）—— 不是十字；要十字就画两次（相差 90°） |
| `flush(target=null)` | 上传并绘制，返回线段数；`target=null` = 画到画布 |

关键事实：

- **颜色是线性值**，`[r,g,b]` 或 **`[r,g,b,a]`**。分量 **可以 > 1**，超过 1 就会在后处理里泛光（这是「发光」的手段，配合 `bloomThreshold`）。
- **`a` 是真半透明**：片元输出是 premultiplied（`rgb * a, a`），混合是 `ONE, ONE_MINUS_SRC_ALPHA`，所以
  `lines.seg(x, y, x2, y2, w, [r, g, b, 0.05])` 得到的是**叠加上去的一层淡墨**，不是"和黑色混"。
  做面板底、网格、水印都用它，比调低 `r,g,b` 更正确（后者会把颜色往黑里拉）。
  > 这条以前没写进文档，结果是读源码才知道能传 4 个分量（`docs/history/IMPROVEMENTS-1-3.md` P1-5）。
- `width` 是逻辑像素，内部带 1.5px 的 AA 余量；`flush` 时用 `gl_FragCoord` 反算距离，所以 4K 下同样粗细。
- 容量上限：构造函数给的 `capacity` 条线段；每次 `_push` 检查 `offset + 6 > capacity * 6`，满了**静默丢弃**后面的（宁可少画不崩）。引擎级 `ctx.lines` 的容量是 **60000**。
- 引擎只有**一个** `LineBatch` 实例（`ctx.lines`），所有段共用。它的 `begin()` 会清掉上一段没 `flush` 的内容，所以每段自己 `begin` + `flush` 即可。
- `flush` 用 `ONE, ONE_MINUS_SRC_ALPHA` 混合，写进 `target`（HDR），可以反复 `begin`/`flush` 分批。
- 顶点数据在 CPU 侧是一个预分配的 `Float32Array`，每帧只做 `bufferSubData`，不要每帧 `new LineBatch`。
- 还有 `dispose()`；引擎在 `Engine.dispose()` 里统一释放。

**最常见的性能优化**：一条线段 = 6 个顶点。60000 条的缓冲区约 18MB，`bufferSubData` 只传实际用到的部分，所以「少画几条」比「少建对象」更省。


---

## 7. `Compositor`：图层叠加与转场

```js
comp.draw(gl, tex0, target, opts);
```

| `opts` 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `'normal'` | `'normal'`(0) `'add'`(1) `'screen'`(2) `'multiply'`(3) `'max'`(4) `'min'`(5) `'overlay'`(6)，也可直接给数字 |
| `opacity` | `1` | 乘在源的 alpha 上 |
| `tint` | `[1,1,1]` | 线性 RGB 乘子（给源上色/调亮） |
| `rect` | `[0, 0, gl.w, gl.h]` | 目标区域（**逻辑像素，y 向下**） |
| `uvRect` | `[0, 0, 1, 1]` | 源的采样矩形 `(u0, v0, du, dv)`，做精灵图/裁剪 |
| `premult` | `false` | 源纹理是否已乘过 alpha。**Canvas2D 图层照理要传 true**，但引擎上传时关了 `UNPACK_PREMULTIPLY_ALPHA_WEBGL`，所以 `Layer2D` 实际按直通 alpha 处理 —— 官方示例与脚手架统一写 `{ premult: false }`。用 `RT` 当源时也保持默认 |

各 mode 的公式（`dst` = 目标已有像素，`s` = 源，`a` = `clamp(s.a * opacity)`）：

```
normal    mix(dst, s.rgb, a)
add       dst + s.rgb * a
screen    1 - (1-dst) * (1 - s.rgb*a)
multiply  dst * mix(1, s.rgb, a)
max       max(dst, s.rgb * a)
min       min(dst, mix(1, s.rgb, a))
overlay   mix(dst, dst<0.5 ? 2*dst*s : 1-2*(1-dst)*(1-s), a)
```

**为什么不能「读自己写自己」**：WebGL 规范里「纹理既是当前 framebuffer 的附件、又当采样源」是未定义行为，实测采出来全黑 —— 于是整帧被静默丢掉。`Compositor` 的做法是先把 `target` 拷进内部快照（`work`/`alt` 交替，避免上次的快照还在被采样），再「读快照 + 读图层 → 写回 target」。多一次 4K 下 1–2ms 的拷贝换绝对正确。

`rect` 之外的像素原样保留（shader 里先取 `dst` 再判断 `inside`），所以不需要中间缓冲，也不会擦掉未被覆盖的区域。

其他方法：

| 方法 | 用途 |
|---|---|
| `copyOver(gl, tex, target, opacity = 1)` | 等比拷贝（带 opacity）。求平均用它：`copyOver(gl, sumRT, avgRT, 1/n)` |
| `blitBack(gl, from, target)` | 整幅拷贝；`from === target` 时是 no-op |
| `mixTo(gl, aTex, bTex, k, target)` | 两张图按 `k` 混合。**引擎的默认转场就是它**（`mixTo(under, rt, tin)`） |

`Compositor` 内部缓冲（`work`/`alt`/`sink`）在尺寸变化时自动重建。

**自定义转场的最小骨架**（`handlesTransition` 场景）：

```js
render(ctx) {
  const { f, gl, comp } = ctx;
  const k = ctx.under ? ease.inOutCubic(f.tin) : 1;
  if (ctx.under) {
    // 方案 A：用 compositor 自带的混合
    comp.copyOver(gl, ctx.under, ctx.out, 1);
    comp.draw(gl, 我的这一帧纹理, ctx.out, { mode: 'screen', opacity: k });
  } else {
    // 方案 B：自己写一个 Pass，采样 under，做任意形变
  }
}
```

注意 `ctx.under` 是**上一段这一时刻的成帧**（HDR 纹理），不是视频帧，可以随便采样/扭曲。

---

## 8. 后处理参数全表

`DEFAULT_POST`（`src/core/post.js`）—— 场景 `render` 返回值与 `cut(..., { post })` 都是它的子集。

> **每个参数都写清「0 是什么、1 是什么、往哪个方向」**。以前这张表只列了名字，结果最典型的一次踩坑是
> 「开场从黑淡入」写成了 `fade: 1 - prog(...)` —— 以为 `fade` 是亮度，于是**整场都是黑的**。
> `fade` 是「黑掉的量」，不是「亮度」（`docs/history/IMPROVEMENTS-1-3.md` P1-6）。

| 参数 | 类型 | 默认 | 0 / 1 的含义与方向 | 该调它的场景 |
|---|---|---|---|---|
| `exposure` | number | `1` | **1 = 不变**，2 = 亮一倍，0.5 = 暗一半（线性乘子） | 整体亮度。跟音频呼吸：`1 + a.rms * 0.15` |
| `shoulder` | number | `0.85` | 软肩**起点**（线性亮度）：低于它的部分不动，高于它的被指数压回。0.8 更"胶片"，0.95 更硬。⚠ **实测（`_post-lab`）：输入 1.0 时输出已经 254/255、输入 2.0 就完全并到纯白**；调低到 0.60 实测**只是压暗、不增加层次**（1.0→245、2.0 仍并白，目检并白起点反而早一级）—— 高光多的画面靠它救不回来，要层次就换 `tonemap` | 白底/大字场景压高光 |
| `tonemap` | `'off'\|'agx'\|'aces'` | `'off'` | 高光滚降算子，和 `shoulder` **二选一**（非 `'off'` 时 `shoulder` 不生效）。`'agx'` 高光层次最好（裸算子 1.0→209、2.0→243；配 `exposure: 0.75` 后 1.0→200、2.0→238、4.0→247），代价是**霓虹去饱和**（橙 253,253,120 → 237,218,151，保饱和排序 现状 > ACES > AgX）；`'aces'` 折中（裸 1.0→238；配 exp 0.85 后 1.0→232，霓虹 248,241,131 接近现状）。换算子会整体变亮，**一般要配一档负曝光**：AgX 配 `exposure: 0.75`、ACES 配 `0.85`（实测暗部黑位均值 75.1 → 73.5 / 71.3，反而更沉）。**目检并白起点**（12 级亮度阶梯 2^-4…2^7）：现状第 6 级（输入 2）、ACES+0.85 第 7 级、AgX+0.75 第 9 级 —— AgX 比现状多约 3 级高光层次。标定夹具：`tasks/_post-lab/` | 高光多、大片死白、需要电影感层次的镜头 |
| `bloom` | number | `0.35` | 泛光强度，0 = 关，1 = 很强 | 纸面/白底压到 0.2，暗底+信号色 0.5–0.6 |
| `bloomThreshold` | number | `0.9` | 进入泛光的亮度阈值（对 HDR 值取 `max(r,g,b)`）：**越高越只有极亮处发光** | **正文 0.85 以上不要过阈**（字会糊） |
| `bloomRadius` | number | `1` | 扩散半径**倍率**，1 = 基准，2 = 更糊更宽 | 大光晕 |
| `bloomKaris` | boolean | `false` | 亮部提取时按 `1/(1+luma)` 加权、平均后再还原（Karis 平均）：一个**孤立**的极亮像素不会在降采样里独占一格、在泛光里变成随帧跳动的方块（fireflies）。⚠ 本机标定卡（亮点是 8×8 与 2×2 逻辑像素）**单点读数几乎无差**（极差 ≤2/255），但**并排目检可见轻微差别**（ON 的白芯略小略暗、光晕收窄、晕里带轻微暖粉偏移；两档都无方块伪影，帧间跳动要用连续帧验）—— 收益主要在真正的亚像素级高光上，用之前先在你的镜头上对比 | 粒子/火花/星点这类"小而极亮"的元素多的镜头 |
| `halation` | number | `0.25` | 光晕强度（偏红、更宽、只吃极亮处），0 = 关 | 胶片感、暖高光 |
| `ca` | number | `0` | 色差强度：0 = 无，0.5 明显，1 = 很夸张。**半径越大分离越多** | 甩镜/冲击：`0.9 * energy` |
| `grain` | number | `0.035` | 颗粒**幅度**（显示空间，暗部更明显），0 = 干净 | 胶片感 0.02–0.05 |
| `grainScale` | `'screen'\|'design'\|'auto'` | `'auto'` | 颗粒撒在哪个栅格上：`'screen'` = 物理像素、`'design'` = 逻辑分辨率（**跨分辨率观感一致**）。颗粒和抖动共用这个栅格。**默认 `'auto'`（2026-10-24 改）**：`--scale 1` → `screen`（老行为，逐像素不变）、`--scale 2+` → `design`。理由：`screen` 在 4K 下颗粒**细一半**是确定的缺陷，而 1080p 下两种栅格完全相同（逻辑像素 = 物理像素），所以一刀刀改成 design 只会让基线无谓地变一遍。**4K 实测（2026-10-17）**：`screen` 颗粒 lag-1 自相关 ≈ -0.05（单物理像素）、`design` ≈ +0.51（2×2 物理像素、与 1080p 同大小），两者幅度 std 一致（0.0594 / 0.0593 —— 只有栅格不同、强度相同）；目检确认 `design` 颗粒明显更粗且密度一致，4K 成片下变换回 1080p 后颗粒感仍保留。⚠ 显式写 `'screen'` 就**钉死**老行为（4K 出片会细一半，知道自己在做什么才这么写） | 一般不用写（auto 是对的）；要复现某次 4K 的旧观感才显式写 `'screen'` |
| `vignette` | number | `0.35` | 暗角**深度**：0 = 无，1 = 四角全黑 | 0.28（纸面）～0.45（暗调） |
| `saturation` | number | `1` | 1 = 不变，0 = 灰度，>1 = 更艳 | 0.96 印刷感，1.05+ 冲击 |
| `contrast` | number | `1` | 围绕中灰 `0.18` 缩放：1 = 不变，>1 更硬 | 1.04 印刷感 |
| `lift` | number | `0` | 黑位**抬升量**（直接加在 rgb 上）：0 = 纯黑，0.05 = 发灰的雾感 | 褪色/回忆镜头 |
| `tint` | number[3] | `[1,1,1]` | 线性乘子，1 = 不变。偏暖 `[1, 0.9, 0.8]`，偏冷 `[0.85, 0.95, 1.1]` | 统一色调 |
| `invert` | number | `0` | 0 = 正常，1 = 反相（用于闪白/负片） | 冲击帧 |
| `shake` | number[2] | `[0,0]` | 位移 `[dx, dy]`，正值向右/向下。单位是**物理像素**（shader 里 `uv += shake/outSize`，而 `outSize` 是物理分辨率），所以 4K 下同样数值的视觉位移是 1080p 的一半 —— ⚠ 和 `center`（逻辑像素）**不是同一把尺子**，要跨分辨率一致就乘 `scale` | 手持：`shakeSmooth(f.t, amp)`（会动的片子 ≤2px）；撞击：`[a.kick*4, -a.kick*3]` |
| `zoom` | number | `1` | 以 `center` 为锚点缩放：**>1 推近**，<1 拉远 | 推镜：1.02–1.08；甩镜 1.1+ |
| `flash` | number | `0` | 整帧**加白量**：0 = 无，0.3 = 明显闪，1 = 全白 | 切点/撞击的一瞬 |
| `fade` | number | `0` | 整帧**黑掉的量**：0 = 不黑（正常），1 = 全黑。⚠ **不是亮度** | 开场：`fade = 1 - prog(t, 0, 1)`；收尾：`fade = prog(t, T-1, T)` |
| `blur` | number | `0` | 全屏模糊强度（与 `radialBlur` 共用 12 抽样径向路径），0 = 不糊 | 冲击、速度感 |
| `radialBlur` | number | `0` | 径向模糊（向 `center` 收缩）：0 = 无，~1 明显 | 甩镜/冲击的主力 |
| `center` | number[2] | 画面中心 | zoom / 径向模糊 / 色差的锚点，**逻辑像素、y 向下**。想做「绕某个元素推近」就把它设成那个元素的坐标 | 局部推镜 |
| `dither` | `'rpdf'\|'tpdf'\|'off'` | `'rpdf'` | 输出前的 8bit 抖动。`'rpdf'` = 矩形分布（引擎一直以来的行为）；`'tpdf'` = 三角分布（两个均匀分布相加），理论上噪声感更弱、去色带更干净。⚠ **本机标定卡实测两者几乎无差别**（暗部渐变的灰度级数 17 → 18，均值 75.15 → 75.11）—— 单帧看不出收益，保留它是为了暗部大面积渐变 + 运动的场合 | 暗部渐变多、且帧间噪声"沸腾"看得出来时试 `'tpdf'` |
| `weave` | number | `0` | 胶片**片门晃动**：整帧按行做亚像素水平漂移（0 = 关）。双频叠加（2.9 / 4.7 Hz，不成整数比 —— 单频会像"机械晃动"），幅度单位是**逻辑像素**（要跨分辨率一致就照抄这个单位；与 `shake` 的物理像素不同）。由 `t` 驱动（可任意 seek） | 老放映机 / 录像带：0.3–0.6。⚠ 超过 1 就是"地震"（§4 铁律第 5 条同一个教训） |
| `flicker` | number | `0` | **曝光闪烁**：整帧亮度按 1.3 Hz 慢波下陷，1 ≈ 最深 ±14%，只压暗不提亮（放映机的光是"被挡掉"的） | 胶片投影感 0.15–0.35；别超过 0.6（观众会开始等它闪） |
| `scratch` | number | `0` | **划痕**：几根慢漂移的竖向细痕（每 5 秒一个生死窗）。亮底上发暗、暗底上发亮 —— 它是"没显影的缝"，不是叠一道白线。位置/宽度/深度全是 `t` 的哈希（可 seek、不抖动） | 做旧 0.15–0.4；夹具 `tasks/_wear-lab`，风格示范 `h-vhs` |

执行顺序（`pFinal`，改不了）：**片门晃动 `weave`（采样前动 uv）** → 像素化 → 缩放/位移 → 径向模糊或色差（**二选一，`blur||radialBlur` 优先，此时 `ca` 被忽略**）→ `exposure` → **高光滚降（`tonemap` 非 `'off'` 时用它，否则用 `shoulder`）** → `invert` → 饱和度 → 对比 → `lift` → `tint` → 暗角 → **`flicker` → `scratch`（胶片磨损，2026-10-30）** → `flash` → `fade` → 颗粒 → 抖动。

> `tonemap` 是**这一层的唯一分叉**：它和 `shoulder` 抢同一个位置，所以两个都写时以 `tonemap` 为准（`shoulder` 静默失效）。
> 想同时要"AgX 的高光"和"原来的暗部"就用曝光补偿，不要试图把两者叠起来。

> 想要"甩镜拖尾 **和** 色差"同时有？**别指望 `radialBlur`** —— 它是全帧糊的，还会把 `ca` 挤掉。
> 在**几何上**做拖影：`cam.js` 的 `smearTimes(cam, t, dt)` + `smearAlpha(份数)`（§3.7.5），
> 只糊动的几何、不糊背景，然后把 post 的 `ca` 留给色差。

**抖动（`shake`）**：幅度和**频率**都得对，而"像不像手持"取决于**频率**。

| 幅度 | 频率 | 观感 |
|---|---|---|
| ≤ 2px | 任意 | 呼吸（安全） |
| 3–5px | 0.5–1.5Hz | 手持（`shakeSmooth` 默认 0.85Hz ≈ 1.2 秒一个来回，就是这一档） |
| **10–50px** | **< 0.1Hz**（十几秒一个来回） | **手持漂移** —— `cameraAt()` / `cameraPost()`（`src/core/trans.js`、`src/kit/world.js`）就在这一档：横向峰值 ≈51px / ≈31px。**这不是 bug，是"全片一台摄影机"的观感**，别把它压到 ≤2px（压了就变成三脚架上的静帧） |
| ≥ 5px | ≥ 1Hz 或逐帧换位置 | 冲击 / 不稳 —— 要么是故意的震屏，要么就是错的 |

> ⚠ **逐帧白噪声（`hash2(f.idx)`）不是手持，是振动**：60fps 下每 16.7ms 跳到一个新位置，
> 幅度只有 5px 也会被看成"地震"。这条是 `tasks/promo` 那轮的实测教训（成片相邻帧互相关：
> RMS 3.64px / 相邻帧差 13px → 改成 `shakeSmooth` 后 0.27px / 1px）。
> 判据：**逐帧变化量 ≈ 幅度** 就是白噪声的指纹（平滑抖动是它的 1/20）。完整报告见 `docs/history/IMPROVEMENTS-1-3.md`。
>
> 两个必做：①用 `t` 的平滑函数；②幅度**随"镜头停住"衰减**（`amp * (1 - 0.75 * settle)`）——
> 镜头刹住了画面还在晃，才是"越到后面越像地震"。
> 体检命令：`node scripts/anim.mjs shake <任务>`（`video` 出片收尾也会自动看一眼）。

经验规则（来自 `post.js` 头部注释，实测有效）：

> **只有「信号色」——信号橙、火花、被唱到的词、要发光的东西——才允许超过 0.85 线性亮度去发光。骨白正文永远不要 bloom，否则像糊了一层油。**

具体做法：正文用 `css(P.bone)`（线性亮度约 0.82），发光元素用 `P.signal` 且乘一个 >1 的系数（如 `[P.signal[0]*2.2, ...]`），或者把 `bloomThreshold` 提到 0.95+ 只让最亮的东西过阈。

泛光链结构（`Post._build()`）：4 级金字塔，level 0 = 物理分辨率的一半，每级减半；halation 从 level 0 的亮部图走一路 `mul = [1.0, 0.34, 0.16]` 更宽的模糊；自下而上按 `k = 0.75` 累加合成。改分辨率时链会自动重建。

---

## 9. 时间线：`seq` / `cut` / `par` / `at`

```js
import { seq, cut, par, at } from '../../src/timeline.js';
```

### 9.1 四个构造器

```js
cut(scene, {
  id,                      // 默认取场景文件名
  dur = 4,                 // 时长（秒），缺省 4
  at,                      // 直接指定起点（秒或 {beat}/{bar}），会覆盖游标
  params = {},             // 传给场景，ctx.params
  post,                    // 这一段的后处理默认值（被 render 返回值覆盖）
  maxSamples,              // 这一段的自适应采样上限（只能收紧，见 §11）
  handlesTransition,       // 自己处理与上一段的重叠
  note,                    // 备注，只出现在列表里
  overlap = 0,             // 与前一段重叠多少秒（= 转场）
});

seq(items, { start = 0 }); // 顺序排列，游标依次推进
par(overlap, items);       // 同一时间起点；overlap = 与「上一组」的重叠秒数
at(a, b, scene, opts);     // 便捷：独占 [a, b) 的一段（等价 cut(scene, {...opts, at: a, dur: b - a})）
```

时间既可以是秒，也可以是 `{ beat: 16 }` / `{ bar: 4 }`（由音频分析的拍网格解析，解析规则见 §9.5）。

### 9.2 展开语义（`build(plan, music)`）

- `seq`：游标从 `start` 开始，每个 `cut` 的起点是 `cursor - overlap`（不小于 0），结束后游标 = `start + dur`。
- `par(overlap, items)`：这一组整体从 `cursor - overlap` 开始，组内每项都以这个时刻为起点；返回值是本组最晚的结束时刻。
- `cut.at`：起点用它，**但游标仍然按 `at + dur` 走**（后面的段接着它）。在 `seq` 里混用 `at` 容易做出意外的重叠/空档。
- `id` 重名自动加 `_2`；最后按 `start` 排序。
- **什么时候会走 `build()`**（`src/tasks.js` 的 `loadTask`）：`timeline` **不是数组**（`seq()` / `par()` 这类），**或者数组里至少有一个配置档节点**（§9.7）。
  纯数组、里面全是已经展开好的段 → 保持旧行为，**不经过 `build()`**。
- `music` 参数：`{ beats, downbeats, bpm }`（`loadTask` 还会塞 `narration`，给 `dur: { vo }` 查句子时长）。

### 9.3 `params` / `post` / `maxSamples` / `handlesTransition`

| 字段 | 落点 |
|---|---|
| `params` | `ctx.params` 与 `f.params`（同一个对象引用，别改） |
| `post` | 这一段的 `PostParams` 默认值，优先级低于 `render()` 返回值 |
| `maxSamples` | 与全局上限取 `min`，自适应时用来压掉噪声场景的多余采样 |
| `handlesTransition` | `true` 时引擎**不做**默认交叉溶解，把 `ctx.under` 交给场景自己用 |

### 9.4 `tin` / `tout` / `ctx.under` —— 转场的精确语义

设当前段是 `A`（上一个在播段是 `P`，下一个是 `N`），`composite()` 里的定义是：

```js
tin  = P ? sat((t - A.start) / max(1e-3, P.end - A.start)) : 1;
tout = N ? sat((t - N.start) / max(1e-3, A.end - N.start)) : 0;
```

- 只有在**与上一段重叠**时 `tin` 才小于 1：`t = P.end` 时（重叠段开始）`tin = 0`，`t = A.end` 时 `tin = 1`，即 `tin` 就是**默认转场（交叉溶解）的进度**，也是「上一段的淡出进度」。
- `tout` 只有在**与下一段重叠**时才从 0 涨到 1，`t < N.start` 时恒为 0：它描述的是「下一段压进来多少」，即当前段的**出场进度**。用它做出场效果（收暗、推走）。
- `ctx.under` = 上一个场景**这一时刻**渲染出来的 HDR 纹理。默认转场时引擎会 `mixTo(under, 本段, tin)`；`handlesTransition: true` 时引擎不动手，`ctx.under` 直接给你。

最小示例（默认交叉溶解，什么都不用做）：

```js
seq([
  cut(a, { dur: 4 }),
  cut(b, { dur: 4, overlap: 0.5 }),          // 0.5s 交叉溶解，b 的 f.tin 从 0 走到 1
])
```

自定义转场（甩镜）：见 §7 末尾和 `tasks/demo/scenes/whip.js`。

### 9.5 `at` / `dur` / `overlap` 各接受什么

```js
seq([
  cut(opening, { dur: { bar: 4 } }),                    // ✓ dur 支持 { beat } / { bar }（按拍网格算秒）
  cut(main,    { at: { beat: 16 }, dur: 8 }),           // ✓ at 支持 {beat}/{bar}；dur 给秒也行
  cut(speech,  { dur: { vo: 'line-2' } }),              // ✓ dur 还能取某句旁白的长度（{ vo: 'id', tail?: 秒 }）
  cut(ending,  { dur: 4, overlap: 1.7 }),               // ✓ overlap 是秒
]);
```

`build()` 里三个字段各走一条解析（`src/timeline.js`）：

| 字段 | 接受 | 解析 |
|---|---|---|
| `at` | 秒 / `{ beat }` / `{ bar }` | `resolveTime()`（`{ bar: n }` = 第 `4n` 拍） |
| `dur` | 秒 / `{ beat }` / `{ bar }` / `{ vo: 'line-id' }`（可带 `tail`） | `resolveDur()`；**不写 = 4 秒** |
| `overlap` | **只接受秒数** | 直接参与 `cursor - overlap` |

`beatTime(music, beat)` 的解析规则：`beat` 落在拍表内就线性插值（`b[k] + frac*(b[k+1]-b[k])`）；
超出末尾就按最后一拍的间隔外推；没有拍表就退化成 `beat * 60 / bpm`（`bpm` 也没有时按 120）。

`{ vo: 'line-id' }` 取的是**那句旁白自己的时长**（不是"到下一句之前"）；句子不存在、或任务没配
`narration` 时**抛错并列出旁白表里的 id**（不静默退化成 4 秒）。也可以照老办法先手算成秒：

```js
import { MusicData } from '../../src/core/audio.js';   // 或直接用 music.timeOfBeat
const t16 = music.timeOfBeat(16), t24 = music.timeOfBeat(24);
seq([ cut(opening, { dur: t16 - 0 }), cut(main, { at: t16, dur: t24 - t16 }) ]);
```

### 9.6 硬切 / 转场 / 空档

- **硬切** = 两段首尾相接（默认，最像剪辑师）。
- **转场** = 让两段重叠：`cut(..., { overlap: 0.5 })` 或 `par(0.5, [...])`。
- **空档** = 任何时刻没有在播的段（半开区间 `[start, end)`），会渲染成黑。`Engine.validate()` 返回 `{ problems, gaps }`，`check` 命令会报「x–ys 没有场景（会渲染成黑）」。

### 9.7 配置档节点（B 档）：时间线里直接写镜头模板

时间线的每一项可以直接写 `src/shots/` 的镜头模板（§14），**不需要 `scene`、也不需要场景文件**：

```js
export default {
  title: '我的片子',
  timeline: [                                   // 数组、seq([...]) 都行
    { type: 'title', title: '我的片子', sub: '副标题', dur: { beat: 8 } },
    { type: 'chart', values: [0.3, 0.7, 0.95], title: '成绩', dur: 5, id: 'bars' },
    { type: 'outro', dur: 3 },
  ],
};
```

**判据**（`isConfigNode(node)`，`src/timeline.js`）：`node` 是对象、`typeof node.type === 'string'`、
并且 **`node.scene == null`**。带 `scene` 的一律走 §9.1 那条路。

**展开**（`configToCut(node, where)`）：`build()` 遇到配置档节点时把它展开成与 `cut()` **形状完全相同**的对象
（`{ kind: 'cut', scene, id, dur, at, overlap, params: {}, post, maxSamples, handlesTransition, note, world }`），
其中 `scene = shot(type, 模板参数)`；之后的排版（`cursor - overlap`、`id` 去重、按 `start` 排序）
与手写场景**走同一条路**。

**节点的键分两类**（分错就是报错）：

| 类别 | 键 | 落点 |
|---|---|---|
| **时间线字段** | `type` `id` `dur` `at` `overlap` `params` `post` `maxSamples` `handlesTransition` `note` `world` `worldPass` `focus` `carry` `transition` | 与 `cut(scene, {…})` 的第二参数同义；`worldPass: true` 等价于 `world: 'auto'`；`transition` 默认 `push`，可选 `wipe` / `iris` / `glitch` / `pixel` / `dissolve` / `mix` / `none`（§3.7.6） |
| **模板参数** | **其余所有键** | `shot(type, { ...其余键, ...params })`（显式写在 `params` 里的优先）；`id != null` 时也一并传给模板 |

- `id` 不写 → `scene.id`（模板自己的默认段名，例如 `'chart'`）；重名仍然自动加 `_2`。
  段名出现在 HUD、`--only`、报错里。
- `dur` 不写 → 4 秒（§9.5）。
- **`TIMELINE_KEYS` 就是上表第一行，它是公开 API**：往时间线节点上加新的时间线字段时必须同步加进那张 `Set`，
  否则它会被当成模板参数、被 `shot()` 当作"参数名拼错"抛出去。
- **写错就抛**（不静默吃默认值）。参数名拼错时错误信息是三层拼起来的
  （`src/tasks.js` 说哪个文件、`src/timeline.js` 说数组里第几项、`src/shots/index.js` 列可用参数）：

  ```
  tasks/<任务>/task.config.mjs 的时间线不合法：
  timeline[1] 这一段（type: "chart"）取不到镜头模板：
    镜头模板 "chart" 没有参数 "value"（大概是拼错了）。可用参数：id / values / title / sub / footer / peak
  ```

  模板名写错时同一位置是 `未知的镜头模板 "quote2"。可用的：title / chart / kinetic / whip / outro / wave / pulse / grid / quote / counter / compare（看参数：node scripts/anim.mjs shots <名字>）`。
- **混写禁令**：同一条时间线里**不能**同时出现「配置档节点」与「已经展开好的段」（手搓的、带 `start` / `end` 的
  无 `kind` 对象）—— 后者会被 `build()` 当成一个节点重新排、它的 `start`/`end` 被静默丢掉，
  所以 `build()` 直接抛「时间线里不能混写「配置档节点」和「已经展开好的段」」。
  **可以**和 `cut(scene, …)` / `seq()` 混写（它们有 `kind`，走正常路径）。
- 需要音乐的模板（`wave` / `pulse` / `grid`）与转场模板（`whip`，自带 `handlesTransition: true`）
  在配置档里同样成立，见 §14.3 / §14.4。
- 选路条件见 §9.2 最后几条；教程 `docs/CONFIG-ONLY.md`，完整示例 `tasks/example-config-only/`。

---

## 10. 音频

### 10.1 预计算流程（推荐路径）

```sh
node scripts/anim.mjs analyze <任务名>     # 或直接 video，会自动补一次
```

做的事（`scripts/anim.mjs` 的 `analyzeTaskAudio`）：

1. `ffmpeg -i <音频> -ac 1 -ar 22050 -c:a pcm_s16le out/<任务>/<名>.mono22k.wav`
2. 读 16bit PCM WAV → `analyzePCM(pcm, sampleRate)`
3. 写 `tasks/<任务>/audio/<名>.analysis.json`（包络降精度到 3 位小数，事件时间 4 位小数）

产物 json 的字段：`duration, fps, bpm, beats[], downbeats[], kicks[], snares[], hats[], sections[]`，以及包络 `rms low bass mid high vocal flux centroid`。

- `fps` 是**特征帧率** = `sampleRate / HOP`（`HOP = 1024`，`FFT_N = 2048`）。CLI 转的是 22.05kHz，所以实测 `fps = 21.533`（仓库里的 `demo-loop.analysis.json` 就是这个值）；`audio-analysis.js` 里注释写的 43.07 是 44.1kHz 的情况。
- 包络数组按下标访问：`index = round(t * music.fps)`，**不做插值**（是阶梯状）。要平滑就自己做 `smooth` 或取多个下标平均。
- `dt.json` 存的是特征帧**索引**，不是秒 —— 用手写 json 时注意这一点。
- 分析是确定性的：同样的 PCM + 同样的参数 = 完全一样的输出，Node 与浏览器走同一份代码（`audio-analysis.js` 不依赖宿主）。

浏览器端（预览、没有 json 时）走同一套：`fetch` 音频 → `decodeToMono`（`AudioContext(sampleRate: 44100).decodeAudioData`）→ `analyzePCM`。**脚本自己拼的 wav 有时不被 Chrome 解码**，用 mp3/m4a；失败了就生成 json。

### 10.2 `MusicData` 的全部查询接口

`ctx.music`（没音频时是 `SILENT`，方法都能安全调用）：

| 成员 | 签名 | 说明 |
|---|---|---|
| `at(t)` | → `{rms,low,bass,mid,high,vocal,flux,centroid,kick,snare,hat}` | 特征快照。包络查表（不插值，越界夹住）；`kick/snare/hat` 是 ±0.06s 窗内的**线性衰减**强度 `s*(1-d/0.06)` |
| `beatAt(t)` | → number | 连续拍号（3.4 = 第 3 拍走了 40%）。有拍表就按邻拍插值；`t` 在第一拍之前向回外推；没拍表退化 `t*bpm/60` |
| `barAt(t)` | → number | `beatAt(t)/4` |
| `timeOfBeat(i)` | → number | 第 `i` 拍的时刻。支持负数与超出末尾（按周期外推） |
| `nearestBeat(t)` | → number | 最近的拍时刻（线性扫描整个拍表） |
| `hits(kind, t0, t1)` | → `{t,s}[]` | 落在 `[t0, t1)` 的打击事件。`kind` ∈ `'kick'｜'snare'｜'hat'`（内部按 `kind + 's'` 取数组） |
| `hit(kind, t, halfLife = 0.12)` | → number | 在 `t` 附近衰减的脉冲 `min(1, max s*exp(-(t-h.t)/halfLife))`，只考虑 `h.t <= t` 的事件，超过 `halfLife*8` 提前退出。做撞击位移/闪白最省事 |
| `pulse(t, period = 1, halfLife = 0.15)` | → number | 与拍表无关的周期脉冲（`exp(-since/halfLife)`），做呼吸/闪动 |
| `sectionAt(t)` | → `{t, energy}` \| `null` | 当前段落（能量突变切出来的），做镜头切换参考 |
| 字段 | `duration, fps, bpm, beats, downbeats, kicks, snares, hats, sections, rms, low, bass, mid, high, vocal, flux, centroid` | 数组是 `Float32Array`；`hasAudio`、`url`、`frameDt = 1/fps` |
| 静态 | `MusicData.load(url, { analysisUrl, onProgress })` | 优先吃 json，失败再解码 + 现算 |

注意 `at(t)` 的 `kick/snare/hat`（±60ms 窗，瞬时）和 `hit('kick', t, hl)`（衰减脉冲）是两种不同的东西：前者适合「这一帧正好在鼓点上」的判定，后者适合「咚一下然后衰减」的动画。**逐帧累积式的 hit 不能用**——它是时间的函数，安全。

### 10.3 `f.a` 各字段

`f.a = music.at(t)`。字段与典型用法：

| 字段 | 范围 | 典型用法 |
|---|---|---|
| `rms` | 0..1 | 整体响度 → 背景亮度、`exposure` |
| `low` | 0..1 | 20–140Hz → 低频呼吸、缩放 |
| `bass` | 0..1 | 140–400Hz |
| `mid` | 0..1 | 400–2000Hz（人声主体） |
| `high` | 0..1 | 2k–14kHz → 镲片、细节抖动 |
| `vocal` | 0..1 | 400–6000Hz 近似人声 |
| `flux` | 0..1 | 起音强度（谱通量，已平滑） |
| `centroid` | 0..1 | 谱质心（音色明亮度） |
| `kick` / `snare` / `hat` | 0..1 | 打击事件强度（±60ms 窗、线性衰减） |

`f.beat` / `f.bar` / `f.beatPhase` 由 `music.beatAt(t)` 派生；**没有音频时 `beat = t*2`**（相当于 120bpm），所以场景里有 `f.beat` 也能跑。

---

## 11. 运动模糊与自适应采样

### 11.1 子帧从哪来

```
step = (1/fps) * shutter          // shutter 默认 0.5，即半帧时长（180° 快门）
subT = max(0, t + step * u)       // u ∈ [-0.5, 0.5] 居中分布
samples = 固定 N 或自适应
result = mean(render(subT) for each subT)
```

`fixedOffsets(n)` 给等距居中的 `u`：`u[i] = (i + 0.5)/n - 0.5`。
自适应用 `ternaryOffsets(levels)`：先 8 个等距，之后每一级把每个间隔三等分、在两侧各插一个新样本，排序后仍是等距居中序列。

### 11.2 收敛判据

- 起始 `BASE_SAMPLES = 8`，硬上限 `MAX_SAMPLES = 216`。
- 每次加倍采样数（×3，见下）后算一次误差：
  `err = max over 缩略图( |A - B| )`，其中 `A`/`B` 是「前一组子帧均值」与「新一组子帧均值」投到显示空间（`pow(1/2.2)`）后的值，返回 0..1。
- `err < tol`（`DEFAULT_TOL = 2.5`，即显示空间 0..255 里的 2.5 级）就停。

于是**采样数只可能是这些值：8 → 24 → 72 → 216**：

| 值 | 什么镜头停在它 |
|---|---|
| 8 | 静止帧、说话头、几乎没有位移 |
| 24 | 普通运镜、缓动字 |
| 72 | 甩镜、砸字、快速擦除 |
| 216 | 极端抖动/高对比边缘扫过整屏（偶尔） |

`video` 命令结束时打印的 `子帧分布 8子帧:120帧 24子帧:45帧 ...` 就是这个分布。

### 11.3 为什么有状态场景不允许

自适应采样会**先渲染 8 帧**再决定要不要继续；如果 8 帧不够，它会**再渲染 16 帧**并把它们并进已有的累加。一个依赖「上一次 render」的场景在这个过程里会拿到错乱的历史，结果不可复现。所以引擎直接拒绝（§1.4）。同理，用 `--samples 24` 这种固定值时也不能用。

### 11.4 CLI 上的控制

| 参数 | 默认 | 说明 |
|---|---|---|
| `--samples N\|auto` | `still` 1，`shot` 8，`video` auto | `1` = 关掉运动模糊（出图快） |
| `--shutter 0.2` | `0.5` | 快门宽度（帧长的比例）。越小拖影越短 |
| `--tol 2.5` | `2.5` | 收敛容差（显示空间 0..255 的级数）。调大 = 更早停、更快、更容易有台阶 |
| `--only a,b` | 无 | 只加载这些段 |

单段的 `maxSamples` 只能**收紧**：`maxSamples = min(全局上限, 段上的 maxSamples)`，再 `max(8, ...)`。

### 11.5 拖影有台阶怎么调

1. 先看是不是**噪声随时间连续变化**（shader 里用了 `t` 直接播种的噪声）：改成 `hash12(FRAG_PX + f.seed)` 之类按帧固定。
2. 调大 `--samples` 或调小 `--tol`（1.0 左右）。
3. 还不行就调小 `--shutter`（拖影短了，台阶自然不明显）。
4. `preview` 恒为 1 子帧，所以预览里的拖影一定会比成片「硬」——这是正常现象，不要用预览判断模糊质量。

---

## 12. CLI 全部命令与参数

入口：`node scripts/anim.mjs <命令> [参数]`。无参数时打印文件头部的用法。出图/出片都落在 `out/<任务名>/`（`still` 在 `out/<任务名>/stills/`）；只有 `analyze` 把 json 写回 `tasks/<任务>/audio/`。

| 命令 | 作用 | 关键参数（默认值） |
|---|---|---|
| `tasks` | 列出任务（名字、标题、场景数、音频） | — |
| `new <名字>` | 生成任务骨架（`task.config.mjs` + `scenes/title.js` + `scenes/shapes.js` + `audio/`） | 名字只能 `[\w.-]+` |
| `shots [名字]` | 列出镜头模板（A 档 `src/shots/`）与参数；给名字则打该模板的**全部参数与默认值** | `--json`（机器可读的参数表，字段契约见 §14.9） |
| `check [task]` | 静态扫描禁止写法 + 逐段试渲染中间帧 + **单子帧 vs 多子帧比对**（全黑/过曝/两条路径不一致/段内亮度不均/漏铺背景/NaN·Inf 都会报） | `--only id,id`、`--quick`（只采 50% 一个点、只跑单子帧）、`--sheet` |
| `verify <task>` | **成片验收**：从 mp4 抽帧，与同一 t 重新渲染的帧按**帧号**逐像素比（拼接错位/帧数不对/色彩空间不一致/成片是旧版本） | `--file x.mp4`、`--from 1`（成片在任务时间轴上的起点）、`--samples 1`、`--tol 18` |
| `hashes <task>` | 画面**变更探测器**：`--save` 存基线（已存在时拒绝覆盖）、`--baseline` 与基线逐像素比（变了 ⇒ 退出码 1，并落 `out/<任务>/hashes-diff.png` 前后对比图）、`--accept --note "…"` 有意改画面（确认后存新基线，原因进 `notes`） | `--every 2`（每 2 秒一帧；默认取 0/25%/50%/75%）、`--times 1,2.5`、`--only`、`--force` |
| `probe <task>` | 按给定顺序渲一串时刻，比粗指纹 ⇒ **渲染顺序会不会改变结果** | `--times 4,12` |
| `diff <task>` | 同一时刻渲两次，差了多少（与 `probe` 互补） | `--times 12` |
| `audit <task>` | 每个**交叠段**在交叠期到底画了什么（背景守门：有没有整帧覆盖） | `--debug` |
| `probe-alpha <task>` | 「整行淡入」（`alpha`）到底生效没有 + 旁白接线 | — |
| `determinism <task>` | 顺向 / 反向 / 单次 seek 三种渲染序列是否一致 | `--from 0`、`--frames 40` |
| `shake <task>` | **抖动体检**：整片 `post.shake` 的幅度 / 逐帧变化量 ⇒「平滑手持」还是「逐帧白噪声（60fps 下是振动）」+ 收尾有没有"停住了还在晃"；有问题退出码 1 | `--from 0`、`--to 全片`、`--batch 240`、`--json` |
| `still <task>` | 出单帧 PNG（agent 看图用） | `-t 1`（逗号分隔多个时刻）、`-o/--out out/<task>/stills`、`--samples 1`、`--shutter 0.5`、`--scale`、`--only` |
| `sheet <task>` | 接触表：一张图里 `n` 帧 | `--from 0`、`--to 10`、`-n 12`、`--cols 4`、`--cell 480`、`-o`、`--samples 1`、`--shutter 0.5`、`--only` |
| `video <task>` | 逐帧渲染 + ffmpeg 出 mp4（带音轨） | `--from 0`、`--to` 全片、`--fps` 任务值、`--samples auto`、`--shutter 0.5`、`--scale`、`--segments`（**不带值时 10**；N = 目标块时长/秒，默认不分块）、`--force`、`--idle 300`、`--dry-run`（C-1：草稿档/成片档各测 10 帧，分别给分钟数；非常规参数另列「本次参数」）、`--parallel N`（把片子切 N 段并行渲染再自己拼，**不带值 = 2**；每段一个无头 Chrome，别超物理核数。⚠ 瓶颈搬到"传输"之后已不是首选：4 进程 720 帧 6.1 fps < 单进程 7.5 fps）、`--gpu auto\|high`、`--crf 16`（无音轨 20）、`--preset slow`（无音轨 veryfast）、`--vcodec libx264`、`--x264 aq-mode=3`、`--noaudio`、`--inflight 4`、`-o out/<task>/<task>.mp4`、`--only` |
| `shot <task>` | 无音轨短预览 mp4（快） | 同 `video`，但 `--to from+4`、`--samples 8`、`--crf 20`、`--preset veryfast`，输出 `shot_<from>-<to>.mp4` |
| `perf <task>` | 性能测量（每帧 ms 的 avg/p50/p95/max + 子帧分布） | `--from 0`、`--to from+5`、`--samples 1`、`--shutter 0.5`、`--encode 8`（估算编码开销 ms）、`--only` |
| `gpu` | 打印 GPU / WebGL 能力（renderer、vendor、浮点 RT 支持、maxTex） | `--headed` |
| `analyze <task>` | 音频 → `audio/<名>.analysis.json` | — |
| `say <task>` | **口播**：读 `narration.mjs` → 逐句 TTS → 量真实时长 → 反推每段 `stretch`/`slot` → 写 `timing.{json,mjs}` + `narration.json` + `<任务>-vo.mp3`（不渲染画面） | `--voice`、`--rate`、`--script 文件`、`--bpm N`、`--tail 1.2`、`--max-stretch 1.9`、`--tts "<命令>"`、`--dry-run`（不写文件，但仍会合成/复用音频量时长）、`--force`、`--no-vo` |
| `mix <task>` | 旁白摆到绝对时刻 + 用旁白包络给音乐**闪避** → `audio/<任务>-mix.mp3`（引擎只认一条音轨） | `--music x.mp3`（不给就从 `task.audio` 取）、`--out`、`--vo-only`、`--bitrate 192k` |
| `clean <task>` | 清中间产物（默认**不动**成片与 stills） | `--all`、`--dry-run` |
| `note <task> "文字" --at 12.5` | **评论文件** `out/<任务>/NOTES.json`：追加 / 列出 / 标记已解决（"第 12.5 秒这里字幕太小"的落点；`at` 是秒）。⚠ `clean` **绝不**删它 | `--at 12.5`、`--list [--json]`、`--resolve n1`、`--text "…"`；形状与纪律见 §12.7 |
| `dumppx <task>` | 导出浏览器那一帧的**裸像素**（对照实验用） | `--times 1.5`、`--out x.raw` |
| `dumpframe <task>` / `dumpframes <task>` | 落一张/一串裸帧 + 引擎内部量 | `-t 0.5 --run-up`、`--from 0 --to 1` |
| `help` | 打印用法 | — |

全局参数：

| 参数 | 说明 |
|---|---|
| `--url http://…` | 复用已经跑着的 Vite 服务（默认先探测 `http://127.0.0.1:5173`，没有就自己起一个随机端口，设 `ANIM_NO_HMR=1`） |
| `--headed` | 显示浏览器窗口（调 GPU/看控制台用） |
| `--gpu auto\|high` | 无头 Chrome 挑哪块 GPU：`auto`（默认）= 系统挑，笔记本上通常是核显；`high` = `--force_high_performance_gpu`。实测**填充重**的段（raymarch）**2.15×**，轻场景反而略慢 ~14% ⇒ 先 `anim perf <任务> --gpu high` 量再定（`docs/PERF.md` §2①；旧说"独显更慢"已被推翻） |
| `ANIM_FFMPEG` 环境变量 | 指定 ffmpeg 路径（默认 `ffmpeg`） |

**`--only a,b` 的时间语义（容易踩）**：它会把选中的段**平移到时间轴开头**，所以
`still <任务> -t 1.6 --only chart` 里的 `-t` 是**段内时间**。副作用是段的 `f.t` 变了，
而 `music` 仍按整片时间 —— 用 `--only` 迭代时"踩拍子"的段落和成片对不上。
（段之间的相对先后与重叠保持不变。）

**`--segments N`**：分块渲染再 `ffmpeg concat` 拼起来。**N 是目标块时长（秒），不是「等分几份」** ——
实际块数 ≈ 片长 ÷ N，不带值的裸 `--segments` 等于 10 秒（`renderSegments()`；语义变过，见 `docs/history/IMPROVEMENTS-1-3.md` P2-4）。
切点优先落在**段边界**上，所以每块都是完整镜头、转场不会跨块。已渲好的块
（`out/<任务>/<任务>.parts/`）会自动跳过，改一个镜头只需重渲它所在的那块；`--force` 全重渲。

运行机制（决定了它的能力边界）：

- 无头 Chrome + `playwright-core`，`channel: 'chrome'`，参数里带 `--enable-unsafe-swiftshader`，页面 URL 形如 `/?task=x&offline=1&hud=0&scale=…`。
- 出帧走 `window.__anim`（见 §12.1）：`video`/`shot` 用 `stream()` 逐帧渲染 → WebSocket 推给 ffmpeg；`still`/`sheet` 用 `still()`/`frame()`。
- ffmpeg 参数：`rawvideo nv12` 输入（页面在 GPU 上就转好了 NV12，见 §12.1）→ `vflip` → （`scale>1` 时）`scale=W:H:flags=lanczos` → `setparams`（bt709 + `range=limited`）→ `libx264 -tune grain` → `yuv420p`，有音轨时 `aac 320k -shortest`。
- 有看门狗：**默认 `--idle 300` 秒没有任何「进展」才报**（判据是四个信号全静止：收帧数、页面 `sent`、
  ffmpeg 在排水、产物文件在变大；任一在动就续命），而且要等到 `1.5 × --idle` 才真正收工。
  报的时候会打印页面推流状态、已连接客户端、ffmpeg 退出码与最近一次进展，
  并**分清「在等 ffmpeg 排水」和「渲染停滞」**（混为一谈会把人引向错误的排查方向，`docs/history/IMPROVEMENTS-1-3.md` P0-1）。
- 渲染是**同步逐帧**的，`--inflight` 控制页面侧在途帧数（背压），4K 时别调大。

### 12.1 `window.__anim` 协议（app.js 暴露给 CLI / agent）

| 方法 | 返回 | 说明 |
|---|---|---|
| `info()` | `{task,width,height,scale,pw,ph,fps,duration,bpm,timeline[],errors,timelineProblems,gaps,renderer}` | 元信息 |
| `frame(t, {samples, shutter, tol, preview, seeked})` | `{samples, errors}` | 渲染一帧；`seeked` 恒为 true |
| `still(t, opts)` | `{png, samples, errors}` | 渲染并返回 PNG dataURL |
| `png()` | dataURL | 当前帧转 PNG（自己处理 WebGL 自下而上的行序） |
| `pixels(t, opts)` | `Uint8Array` | 当前帧 RGBA（自下而上） |
| `stats(t, opts)` | `{mean, max, darkRatio, blownRatio, clippedRatio, pixels}` | 画面统计。`mean < 0.004` = 几乎全黑；`blownRatio` = 亮度 >0.99 的占比，`clippedRatio` = 三通道都 ≥253 的占比（真·死白） |
| `stream({from,to,fps,ws,samples,shutter,inflight})` | `{total, ws}` | 逐帧渲染推流：每帧 `[12 字节帧头 = 子帧数 \| shake.dx \| shake.dy，都是 float32][**NV12** 像素 = Y 平面 w×h + 交错 UV w/2×h/2]`，收 ack 才继续。帧头长度由 `scripts/anim.mjs` 的 `FRAME_HEADER` 与 `app.js` 的 `stream().step()` 两处共同约定，改要同时改；载荷格式与 CLI 的 `-pix_fmt nv12` 配对（`engine.readNV12()`，见 `docs/PERF.md` §5.4a） |
| `nv12(t, opts)`（引擎侧：`engine.readNV12()`） | `Uint8Array` | 线性光 → sRGB → **BT.709 limited 的 NV12**（每帧 3.11MB，比 RGBA 少 62%）。与 `readPixels()` 数学等价，只是交付格式不同；量具 `tools/probe-nv12.mjs` |
| `status()` | `{state, task, error, message}` | `state ∈ booting/ready/error` |
| `framePixels(t, opts)` | `{pixels, bytes}` | 一帧的 RGBA（自下而上、**显示空间**）以 base64 返回 —— `verify` 走的就是它（避免 830 万个数字过 `page.evaluate`） |
| `nonFinite(t)` | `{nan, inf, first, …}` | 直接读**浮点**缓冲数 NaN / ±Inf（8bit 回读里两者长得一样），「整屏白」的唯一可靠判据；`check` 与 `probe-raymarch` 用它 |
| `hash(t, {samples, pixels})` | `{hash, bytes, samples, pixels?}` | 像素指纹（`pixels: true` 时附 base64 原始帧，喂给 `diffTo`）。⚠ 只对 `samples: 1` 稳定（多子帧数会浮动） |
| `diffTo(prev, t, opts)` / `diffToB64(b64, t, opts)` | `{max, mean, over16, over32, …}` | 与参考帧的逐通道差 —— `hashes --baseline` 走 `diffToB64`（base64 传参，11 帧从"几分钟"降到 8.5 秒） |
| `hashTimes(t, n)` | `string[]` | 同一时刻连渲 n 次，抓「只有第一帧不一样」（惰性编译/未初始化缓冲） |
| `diff(t1, t2, opts)` | `{max, mean, over8, over32, samples}` | 两个时刻之间的逐像素差（`anim diff`） |
| `probe(times)` | `{results[]}` | 按给定顺序渲染一串时刻，返回每帧粗指纹 + 亮度（`anim probe`：渲染顺序会不会改变结果） |
| `worldAudit()` | `{results[], timeline}` | 每个**交叠段**在交叠期画了什么：有没有一次整帧覆盖（`missing`）—— 背景守门（`anim audit`） |
| `renderErrors()` / `takeRenderErrors()` | `string[]` | 场景抛出的异常（取走即清空）——「场景抛错 = 硬失败」靠它 |
| `debug(t)` | 时间线 / 活跃段 / 推流状态 | 卡住时定位 |
| `lastSamples` / `lastErrors` | getter | 最近一帧的子帧数与各级采样误差 |
| `ready` | Promise | 等就绪（CLI 用） |

> **`stream()` 的背压**：页面发完一帧就等 ack（`inflight` 个在途）。CLI 侧若
> `ff.stdin.write()` 返回 `false`（内核缓冲满）就**停发 ack**，等 `drain` 再把攒下的补上 ——
> 1080p 一帧 RGBA 是 8.3MB，不回 ack 还继续写会把内存堆爆。

### 12.4 任务自带字体（`task.fonts`）

不想动全局的 `public/fonts/fonts.css`（两个任务想用不同字体就会打架）就在任务配置里写：

```js
// tasks/<任务>/task.config.mjs
fonts: './fonts/brand.css',                                  // 自己写 @font-face 的样式表
fonts: ['./fonts/Brand-600.woff2'],                          // 字体文件，自动包成 @font-face
fonts: [{ file: './fonts/Brand-600.woff2', family: 'Brand', weight: '600', style: 'normal' }],
```

路径**相对任务目录**。加载在**第一帧之前** await 完成 —— 离屏截帧时字体还没就绪
会拍到一片方框（`font-display` 也救不了已经画进 Canvas2D 的那一帧）。
场景里用 `family: 'Brand'` 引用即可（`FAMILIES` 里没有的名字会原样当 CSS 字体栈用）。

### 12.5 URL 参数（`npm run dev` 与 CLI 共用）

| 参数 | 默认 | 说明 |
|---|---|---|
| `?task=demo` | 第一个任务 | 选任务 |
| `&t=1.5` | `0` | 起始时刻 |
| `&scale=2` | 任务 `scale` | 输出倍率（夹在 1..4） |
| `&w=` `&h=` `&fps=` | 任务配置 | 覆盖逻辑分辨率 / 帧率 |
| `&offline=1` | 关 | 关 HUD（CLI 恒开） |
| `&hud=0` | 关 | 关 HUD |

**预览键位**（`app.js`）：`空格` 播放/暂停、`←`/`→` ±1s（按 `Shift` ±5s）、`,`/`.` ±1 帧、`[`/`]` 上一段/下一段、`Home`/`End` 片头/片尾、`h` 显示/隐藏 HUD。

预览循环用 `requestAnimationFrame` + 墙钟推进 `clock`，与音频对齐（偏差 > 60ms 就硬拉 `audio.currentTime`），每帧 `engine.render(clock, { preview: true, toScreen: true, samples: 1 })`。预览恒 1 子帧，所以看运动模糊要出片。

### 12.6 目录与任务契约

```
tasks/<任务>/
  task.config.mjs      export default { ... }（TaskSpec）
  scenes/*.js          场景（配置档任务可以没有：时间线里直接写 { type: '…' }，见 §9.7）
  audio/               音频 + <名>.analysis.json
```

`TaskSpec`（`src/tasks.js`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `title` | — | 显示名 |
| `width` / `height` | `1920` / `1080` | 逻辑分辨率 |
| `fps` | `60` | 帧率 |
| `scale` | `1` | 1 = 1080p，2 = 真 4K（**1..4 都可用**，见 §12 的 `--scale`） |
| `duration` | 时间线最后一个 `end` | 总时长 |
| `palette` | `{}` | 覆盖调色板，键名会变成 `C_XXX` |
| `audio` | — | 相对任务目录，如 `'./audio/track.mp3'` |
| `analysis` | 自动猜 `<音频名>.analysis.json` | 预计算特征 json |
| `lyrics` | — | 歌词 json |
| `fonts` | — | 任务自带的字体（**相对任务目录**）：`.css` 当样式表加载；字体文件自动包成 `@font-face`。见 §12.4 |
| `timeline` | — | 数组（里面可以直接写配置档节点 `{ type: '…' }`，见 §9.7），或 `seq()/par()` 方案（自动 `build`） |

任务发现用 `import.meta.glob('/tasks/*/task.config.mjs')`（**注意 glob 必须以 `/` 开头**，相对路径匹配不到）。新建任务目录后 **dev 服务要重启**才能看到；CLI 不受影响。

### 12.7 `out/<任务>/NOTES.json`：评论文件（`anim note`，BACKLOG 1-29）

「第 12.5 秒这里字幕太小」这类反馈**不该**逼你去跑一次渲染、也不该只活在对话记录里。
`anim note` 把它写成一个**普通项目文件**（外部参考项目的 Studio 对 `FEEDBACK.json` 就是这么做的：
读写走文件、不轮询、不重编译 —— `docs/REFERENCE-hypit.md` §5.5）：

```sh
node scripts/anim.mjs note demo "第 12.5 秒这里字幕太小" --at 12.5    # 追加（--at 是秒，可省 → null）
node scripts/anim.mjs note demo --list [--json]                       # 列出（○ 未解决 / ✓ 已解决）
node scripts/anim.mjs note demo --resolve n1                          # 把某条标记成已解决
```

```json
{ "schema": "anim.notes/1", "task": "demo",
  "notes": [ { "id": "n1", "at": 12.5, "text": "第 12.5 秒这里字幕太小",
               "createdAt": "2026-10-10T14:04:48.606Z", "resolved": false, "resolvedAt": null } ] }
```

| 字段 | 说明 |
|---|---|
| `id` | 文件内唯一（`n1` `n2` …，追加时单调往上）。`--resolve` 用的就是它 |
| `at` | **秒**（可为小数）；`null` = 这条不针对某一时刻（写 `--at` 才不是 null） |
| `text` | 正文（非空：空正文条目会让整份文件读不动 —— 宁可停下来让人补，也不静默丢一条） |
| `createdAt` / `resolvedAt` | ISO 8601（UTC，`Z`）；显示时按本机时区 |
| `resolved` | 布尔。`--resolve` 置 true 并写 `resolvedAt`；**重复 resolve 不改 `resolvedAt`**（幂等，不 churn 文件） |

四条纪律：

1. **空 ≠ 干净**：文件空 / 半截 JSON / 形状不对 / 某条没正文，一律抛**可读的**错（报到行列 + 怎么修），
   **绝不**当成"还没有评论" —— 那是静默丢反馈（与 `check` 的 `skipped` 同一条纪律，BACKLOG 1-19）。
   `--list` 也会说清"文件还没建"（`--json` 里是 `exists`）：`0 条` 不等于"这份文件干净"。
   能修的字段就修，**修了什么进 warnings**（打到 stderr）：缺 `id` 自动补一个最小的空闲号、
   重复 `id` 改名（**显式写进去的 id 优先**，不会被自动补的挤走 —— 人可能已经用 `--resolve n1` 引用过它）、
   `at` 不是 ≥0 的秒数就按"没有时刻"算。哪一样都比"这条评论不显示了"好。
2. **不覆盖坏文件**：读不动就停下，不拿新内容去盖它（这个文件是反馈的唯一落点）。
3. **`anim clean` 绝不删它**（判据只有 `PROTECTED_OUT_FILES` 一处；clean 的输出里会明说"评论保留"）。
   ⚠ 但 `out/` 在 `.gitignore` 里 —— 评论**不进版本控制**，要长期留存得自己拷走。
4. **写盘只走 `fs.writeFileSync(…, 'utf8')`**（有中文），读只走 `parseNotesJson()`。
   读写都是**纯函数**（`scripts/anim.mjs` 前部那一片，末尾 export）：`await import('./scripts/anim.mjs')`
   就能离线断言（`IS_MAIN` 入口门保证 import 不会执行任何命令）。
   ⚠ BACKLOG 原文里的 `run`（"这条评论是对哪一次渲染说的"）**这一版没有实现** —— 渲染产物还没有 run id；
   它作为**未知字段原样保留**（信封与条目都是），所以将来加它不会抹掉已经手写进去的值。

---

## 13. 排错清单

先跑 `node scripts/anim.mjs check <任务>`：它会扫描 `Math.random` 之类、逐段试渲染、报每段平均亮度、打印浏览器控制台错误，并给出时间线空档。

| 症状 | 原因 | 处置 |
|---|---|---|
| **整帧黑** | 场景没覆盖整帧（忘了 `gl.clear(ctx.out, ...)` 也没用全屏 Pass）；或 `Pass` 用了 `blend: true` 但 shader 输出 alpha=0；或画到了别的目标（把 `ctx.out` 写成了 `ctx.gl` 之类） | 每个 `render()` 第一行就覆盖整帧；背景 Pass 加 `{ blend: false }`。`check` 的 `平均亮度` 低于 0.004 会直接点名 |
| **整帧黑（只有转场时）** | `handlesTransition: true` 但场景没画东西就直接返回 | 自己处理转场时必须把最终画面画进 `ctx.out`（`tasks/demo/scenes/whip.js` 是完整例子） |
| **文字全不见** | ① 忘了 `ctx.text.clear()`；② 忘了 `text.upload()`；③ 忘了 `comp.draw(gl, text, ctx.out, { premult: false })`；④ 用了 `engine.text` 而不是 `ctx.text`；⑤ 多个图层共用了一个 `TextKit` | 一条链走全：`clear` → `write` → `upload` → `comp.draw`。`TextKit` 必须来自 `ctx.type` |
| **文字位置全错/画到别的画布上** | 跨段共用了 `TextKit`（它把字体状态存在 ctx 上） | 一层一个 `ctx.type`，新建图层要 `type.clearCache()` |
| **画面上下颠倒** | 自己翻了 Y（Canvas2D 图层不用翻，`Compositor` 已经翻了） | `Layer2D.upload()` 里 `UNPACK_FLIP_Y_WEBGL = false`，别动它 |
| **预览对、导出不对** | `Math.random()` / `Date.now()` / 逐帧累积状态 / 用 `Math.floor(t*60)` 抖帧 | 改 `rng(seed)` / `f.t` / 时间函数 / `f.idx`；`check` 会扫出前三种 |
| **导出报 `stateful/integrates` 无法采样** | 场景声明了有状态 | 写成解析解，或该段 `samples: 1`（牺牲运动模糊） |
| **shader 编译报错** | 重复声明了 `GLSL_COMMON` 里的名字（`vUv`/`fragColor`/`t`/`dt`/`res`/`RES_LOGICAL`/`PX_SCALE`/`PI`/`TAU`/`sat`/`luma`/`fbm`/`sdBox`…），或用错 GLSL ES 3.00 语法 | 报错信息里会附上出错那一行的源码（`fragment shader (key): ERROR: 0:NN` 后带行内容）。删掉重复声明即可 |
| **uniform 设了没反应** | 名字在 shader 里不存在（静默跳过），或值类型长度不对（`[1,1,1]` → `vec3`） | 对着 §4.2 的表检查；`Pass` 不会为拼错的 uniform 报错（但会为"值是 `undefined`/`NaN`"打一条 warn，见下一行） |
| **音频解码失败** | Chrome 不认脚本拼的 WAV / 文件格式怪 | `node scripts/anim.mjs analyze <任务>` 生成预计算 json，或把音频换成 mp3/m4a |
| **`f.a` 全是 0 / `f.beat` 是 `t*2`** | 任务没配 `audio`，或分析没跑成（`SILENT` 退化对象） | 跑 `analyze`；确认 `audio:` 路径相对任务目录且文件存在 |
| **拍子对不上画面** | 时间线用了秒而不是拍号；或分析出的 `bpm` 与音乐不符 | 用 `music.timeOfBeat(n)` / `{ beat: n }` 定切割点，别手抄秒数 |
| **拖影有台阶/双重曝光** | 采样不足；或 shader 里噪声随 `t` 连续变化（子帧各不同）；或抖帧用了 `Math.floor(t*60)` | 加大 `--samples`、调小 `--tol`/`--shutter`；噪声改用 `f.seed`/`f.idx` 播种 |
| **画面有粉/紫色块或亮斑** | 某个子帧算出 NaN/Inf（`pow(负数)`、`0/0`、`normalize(0)`） | 累加 Pass 会丢弃非有限像素（超过 5e4 也丢），但那一点就成了空洞；在 shader 里夹住 `max(x, 0.0)` |
| **整屏白（四角有暗角）** | 场景写出了 **NaN 或 ±Inf** —— 两者在后处理之后**显示完全一样**（实测两帧 PNG 逐字节相同），别想从画面上分辨 | `check` 会扫浮点缓冲并点名「非有限值：NaN n / Inf n（首个坏像素 x,y）」；raymarch 段用 `node tools/probe-raymarch.mjs --only nan,inf,full` 一比就知道 |
| **同一个场景：`still --samples 1` 是白的、成片/`check` 是黑的** | `_accumPass()` 会把非有限值丢掉（`bad ? vec3(0.0) : c`），所以多子帧那条路把证据擦掉了 | 同上；`check` 里紧跟"两条路径亮度差了 N×"那句会补一句指向非有限值 |
| **3D 画面上下颠倒 / 左右镜像** | shader 里把 `FRAG_PX` 的 y 又翻了一次（它**本来就是 y 向上**，和 JS 侧相反）；或 `camera3()` 的手性被改坏（`right = cross(fwd,worldUp)`） | `node tools/test-cam-math.mjs`（手性）+ `node tools/probe-raymarch.mjs --only ray`（朝向）；场景里把 `params.dbg` 切到法线图，地板该在下方（法线朝上） |
| **Three.js 的画面上下颠倒 / 半透明偏暗 / 颜色偏亮一档** | 桥的三处接缝：画布第 0 行是**画面顶部**（全屏 Pass 的 `vUv.y=1` 才是顶部，要翻）；画布 RGB 是**编码空间里预乘过 alpha** 的（要反预乘再解码，顺序不能颠倒）；取色别用 `new THREE.Color('#…')`（那按 sRGB 解释） | `node tools/probe-three.mjs`（10 条判据一次问完：朝向 / 两条颜色管线一致 / 线性 alpha）。详见 §3.8.1 |
| **uniform 设了没反应** | 名字在 shader 里不存在（静默跳过），或值类型长度不对（`[1,1,1]` → `vec3`）；**值是 `undefined` 时也一样静默** | 对着 §4.2 的表检查；`Pass` 现在会对"声明了但值是 `undefined`/`NaN`"的 uniform 打一条 `console.warn`（每个名字一次），`check` 末尾会打印控制台 |
| **颜色偏暗/偏灰（Canvas2D）** | 把线性色直接塞进 `fillStyle` | 一律用 `css(P.xxx, alpha)` |
| **导出的图/成片比浏览器预览暗、暗部糊死** | 导出路径没做 linear→sRGB 编码 | 已经在引擎里修好（`engine.readPixels()` 走 `'srgb'`）。自己写读回时别用 `readLinearPixels()` 存图；详见 §2.3 |
| **泛光糊成一片油** | 骨白正文过了 `bloomThreshold` | 抬 `bloomThreshold`（0.95+）或压 `bloom`；只让信号色 >0.85 线性亮度 |
| **拖影/画面在 4K 下不对** | shader 里写了 `gl_FragCoord` 当逻辑坐标 | 用 `FRAG_PX`（= `gl_FragCoord / PX_SCALE`）或 `fwidth` |
| **4K 下矢量（`lines`）消失** | 曾经是引擎 bug（`LineBatch` 顶点着色器用物理分辨率换算裁剪空间），**已修** | 若又出现：`node tools/probe-ribbon.mjs 11.2 1,2` 一比就知道；顶点用逻辑像素、别用 `res` |
| **渲染卡住不出帧** | WebSocket 连不上（端口不通）、页面报错后没继续推帧 | CLI 有看门狗（默认 **300s** 没有任何**进展**才报 —— 收帧数、页面 `sent`、ffmpeg 排水、产物变大四个信号全静止，且要到 `1.5 ×` 才收工；`--idle` 可调）。先 `gpu` 确认 WebGL 可用 |
| **`video` 报了「只渲染了 N/M 帧」** | 渲染期间写了仓库里的**任何**文件（私有 Vite HMR 重载 → WebSocket 断开），或页面崩了 | 渲染期间一个文件都别写（`docs/*.md` 也不行，见 `AGENTS.md` §7 / `docs/history/STATUS-rounds-7-10.md` §14.5）；长片子用 `--segments` 分块，已渲好的块会保留 |
| **`--only` 之后画面全黑** | `--only` 会把选中的段平移到时间轴开头，`-t` 是段内时间（旧版本保留全局时间，几乎必然取到段外） | 用段内时间；或去掉 `--only` 用整片时间 |
| **`check` 报「空档」** | 时间线有两段之间没有场景覆盖 | 补一段，或让相邻段的 `end`/`start` 精确相接 |
| **新建的任务 dev 里看不到** | `import.meta.glob` 需要重启 dev 服务 | 重启 `npm run dev`（CLI 不受影响） |
| **`still --scale 2` 没生效** | CLI 只在 `--scale` 为真值时才透传；`0` 会被当成「用任务配置」 | 传 `--scale 2`，别传 `0` |
| **报「这一段（type: …）取不到镜头模板」** | 配置档节点（§9.7）的模板名或参数名写错了 | 报错里已经列了可用模板 / 可用参数；`node scripts/anim.mjs shots <名字>` 查全表 |

**「画面没做对」但 `check` 也说不出所以然时，先看 `tools/` 里有没有现成的量具，别靠眼睛猜**：

```sh
node tools/probe-fonts.mjs <任务>        # 任务字体真的加载并被用上了吗（宽度 ≠ 回退字体才算数）
node tools/probe-timeline.mjs <任务>     # 页面**实际加载到**的时间线（段 id / 起止 / 源文件）
node tools/probe-determinism.mjs <任务> 1 2   # 两个独立会话逐字节比（+ 帧号抽帧稳不稳）
node tools/probe-trans2.mjs <任务>       # 交叠期到底是"把上一镜推走"还是"两屏糊在一起"
node tools/probe-nv12.mjs <任务>         # GPU 的 NV12 vs CPU 参考实现（改编码路径后必跑）
node tools/test-world.mjs                # 共享背景两条路（world:'auto' / world:false）的画面判据
node tools/test-narration.mjs            # 旁白层：叠句 / 留白 / 占比 / dur:{vo} 写错必须抛
node tools/test-easing-warn.mjs          # 缓动名写错必须警告（不是静默退化成 linear）
```

完整清单（各脚本的判据与适用场合）见 `docs/history/STATUS-rounds-1-6.md` §11.15。

### 已知的「代码与直觉不符」（写文档时逐条核对出来的）

1. `ease.inBack`（先退后进）与 `ease.outBack`（冲过头再回弹）**曾经是同一个函数**（都用 outBack 公式），已修成两个不同的函数。
   顺带一条：缓动名写错时 `prog()` / `keys()` 只 `console.warn` 一次并**退化成 `linear`** —— 画面"动起来有点平"先查拼写。
2. **想要弹簧/回弹，用 `util.spring(elapsed, target = 1, stiffness = 90, damping = 18)`**：它是指数弹簧的**解析解**（从 0 出发、初速 0，追向 target），只吃"距起点的秒数"，所以天然满足确定性契约 —— `y = y0 + spring(f.lt - t0) * 位移` 就是一段带回弹的落位，`spring(f.lt - t0, 1, 140, 12)` 更弹。
   **不要自己写 `x += v*dt` 的逐帧弹簧**（曾经有个 `springStep` 就是这么干的，不符合确定性契约，已从 `util.js` 删除）。
3. `MusicData.at()` 的包络查表是 `Math.round(t*fps)` 的**阶梯**，不插值；`fps` 实测是 21.533（22.05kHz / 1024），不是 `audio-analysis.js` 注释里写的 43.07。
4. `f.tout` 在本段与下一段不重叠时**恒为 0**，它不是「本段进度」而是「被下一段压入的进度」。
5. `at` 与 `dur` 都解析 `{beat}`/`{bar}`（`resolveTime` / `resolveDur`），`dur` 还接受 `{ vo: 'line-id' }`；但 **`overlap` 只接受秒数**（`build()` 里直接 `cursor - node.overlap`）。写 `overlap: { bar: 1 }` 会得到 `NaN`。
6. 运动模糊用的后处理参数取自**离帧中心最近的子帧**，不是所有子帧的平均。
7. 多段重叠时，post 参数由**最后一个返回 post 的段**决定。
8. `Compositor.draw` 的 `premult` 默认是 `false`，而 Canvas2D 画布通常是预乘的——但因为 `Layer2D.upload()` 关掉了 `UNPACK_PREMULTIPLY_ALPHA_WEBGL`，`false` 反而是这里正确的选择。别自作主张传 `true`。
9. `LineBatch` 超容量时**静默丢弃**多余线段（不报错、不崩）。`ctx.lines` 容量 60000 条。
10. `Pass` 的程序缓存键是 `opts.key`；给不同 shader 起同一个 key 会拿到**旧程序**。
11. `pFinal` 里 `blur`/`radialBlur` 与 `ca` **互斥**：只要 `blur > 0` 或 `radialBlur > 0`，`ca` 就不生效。
12. **调色板的两个真实边界**（已修一半，别照旧说法绕路）：后处理链的 `C_*` 常量**跟随任务调色板**（`Engine` 构造时先把 `this.P` 赋好再建 `Post`，顺序有注释钉着）；但场景里 `new Pass(...)` **不传 `palette` 时注入的是默认调色板** —— 要跟任务配色一致就显式写 `palette: ctx.P`（`Pass` 第三种参数），别把颜色一个个当 uniform 传进去。只给 uniform 的 Pass（例如 `cam3Uniforms`）不受影响。
13. `engine.hud` 为真且 `preview` 为假时才画 HUD，且 HUD 在**后处理之前**叠加，所以 HUD 会参与泛光与颗粒。
14. `MusicData.hits(kind, t0, t1)` 内部取的是 `this[kind + 's']`，所以 kind 必须写单数 `'kick'｜'snare'｜'hat'`。
15. **shader 里的 `FRAG_PX` 是 y 向上**（它就是 `gl_FragCoord / PX_SCALE`，第 0 行在画面**底部**），
    而 JS 侧的"逻辑像素"是 y **向下**（`post.center`、`ctx.setXform` 的 anchor、`lines` / `type` 的坐标）。
    两套约定并存，混起来就是"整个世界上下颠倒"。要 y 向下的 shader 坐标自己写 `RES_LOGICAL.y - FRAG_PX.y`。
16. `Pass.render()` 对**值是 `undefined`** 的 uniform 是静默跳过的（shader 里保持 0）。
    典型事故：`cam3Uniforms(camera3(...))` 字段名对不上 → 四个相机向量全 0 → `normalize(vec3(0))`
    → NaN → 整屏白（§3.7.3）。现在会打一条 `console.warn`，但**它只是 warn，不会中断渲染**。
17. `_accumPass()` 会把非有限值（NaN/±Inf）和 `|c| > 5e4` 的像素**丢掉**。
    所以"同一段单帧白、成片黑"是它的正常行为，不是渲染错了。

---

## 14. `src/shots/`：A 档镜头库（取一个整镜头）

一句话：**`shot('名字', { 参数 })` 返回一个普通场景对象。** 常见镜头因此从「一个手写的 `scenes/xxx.js`」变成一行。

```js
// tasks/<任务>/scenes/chart.js
import { shot } from '../../../src/shots/index.js';

export default shot('chart', {
  values: [0.3, 0.7, 0.95],
  title: '这一轮的成绩',
});
```

### 14.1 API

| 导出 | 签名 | 说明 |
|---|---|---|
| `shot` | `shot(name, opts?) → Scene` | 取模板，返回**普通场景对象**（`{ id, setup?, render }`），能直接放进 `cut(...)` |
| `SHOTS` | `{ 名字: 工厂函数 }` | 名字 → 工厂。B 档的 `{ type: '名字' }` 分发读的就是这张表（见 §9.7 / §14.8） |
| `listShots` | `listShots() → [{ name, summary, notes, params }]` | `params` 每项是 `{ name, type, desc, default }`；CLI 的 `anim shots` 用的就是它 |
| `xxxShot` | `titleShot(opts)` … | 每个模板模块自己导出的工厂；模块同时被 `src/shots/index.js` 再导出 |

- **`opts.id` 覆盖段名**（`--only` / HUD / 报错里用的名字）。不传就用模板名，个别模板另有默认值
  （例如 `wave` 默认 `id: 'wave'`，但 beat 那个任务的段名叫 `intro`，所以那边写 `shot('wave', { id: 'intro' })`）。
- 每个工厂函数上挂着 **`.defaults`**（全部参数的默认值 = "什么都不传时的画面"）与
  **`.meta`**（`{ name, summary, notes, params }`）。`listShots()` 的默认值就是从 `.defaults` 取的 ——
  唯一来源，所以"文档里写的默认值"与"代码实际用的默认值"不可能对不上。
- **参数名写错会抛错**，不静默忽略：`shot('chart', { value: [...] })`（少个 `s`）会点名
  「没有参数 "value"」并列出可用参数；未知模板名抛 `未知的镜头模板 "xxx"`。
- 查询方式：`node scripts/anim.mjs shots`（列全部 25 个）、`node scripts/anim.mjs shots chart`（某个模板的全部参数与默认值）；
  **机器可读**的那一份是 `node scripts/anim.mjs shots --json`（字段契约见 §14.9）。

### 14.2 25 个模板

| 名字 | 画什么 | 参数（默认值） |
|---|---|---|
| `title` | 大标题入场：眉标逐字打出 → 主标题逐字上浮 → 副标淡入 → 右下角读数 | `id` `eyebrow` `title` `sub` `readout` `blur`（默认的眉标/主标题/副标各有一句示例文案；`readout: true`；`blur: 0` = 不糊，18 左右是"从虚焦里浮出来"——1-41） |
| `chart` | 图表：坐标轴 + 逐条生长的柱子（内部排线、"到顶弹一下"）+ 扫描线 + 跟读的读数 | `id` `values`（12 个数）`title` `sub` `footer` `peak`（`0.95`，判"最高"的阈值：≥ peak 的柱子用信号色） |
| `kinetic` | 动态大字 + GLSL 背景（域扭曲 fbm）+ 左下角计数器阵列 + 四角取景框 | `id` `headline`（**正好两行**大字）`sub` `cellCols`（`8`）`cellRows`（`5`）`cellSeed`（`31`） |
| `whip` | **转场镜头**：把上一帧（`ctx.under`）揉成一团甩走 + 斜向速度线 | `id` `streaks`（`26`）`dir`（`[1, 0.12]`，uv 空间的甩镜方向） |
| `outro` | 片尾：细线收拢再展开成刻度尺、大字入场、结尾压黑 | `id` `title` `sub` `signature` |
| `wave` | 波形：以当前时刻为右端显示最近 `window` 秒的包络 + 每个 kick 一道横线 | `id` `label` `cols`（`240`）`window`（`1.2`） |
| `pulse` | 同心圆：每次 kick 扩一圈 + 跟着低频呼吸的中心方块 | `id` `title` |
| `grid` | 频谱网格：每列一个频段、逐格点亮 + 当前时刻扫描线 | `id` `label` `cols`（`32`）`rows`（`12`）`window`（`2.2`） |
| `quote` | 引言：眉标逐字打出 + 一条生长的竖线 + 大段引文逐行上浮 + 出处署名（`align: 'center'` 是居中版） | `id` `label` `text`（两行示例引文）`cite` `role` `align`（`'left'`） |
| `counter` | 计数：环形刻度盘 + 从正上方扫过的进度弧 + 从 `from` 滚到 `to` 的大数字（等宽、千分位、固定小数位） | `id` `from`（`0`）`to`（`96`）`decimals`（`0`）`unit` `label` `sub` `footer` |
| `compare` | 对比：一行一个指标，上下两条水平条（A 灰 / B 信号色）+ 右侧一组 `A → B` 读数 | `id` `title` `sub` `aTitle` `bTitle` `rows`（4 项 `{ label, a, b }`）`footer` |
| `bigtype` | 一屏一句：hero 级大字逐行上浮 + 一处关键词换信号色（**切段画**，不是叠色重画）+ 左侧引导线与下划线（1-48） | `id` `kicker` `line1` `line2` `mark` `footer` |
| `scan` | 扫描格阵：扫描线从左走到右，走过的格子按 `hash2` 的确定性读数填块、当前列偏信号色；**不读音乐**（与 `grid` 的分工） | `id` `kicker` `label` `cols`（`26`）`rows`（`12`）`footer` |
| `device` | 界面窗口：四条边依次展开 + 标题栏（三个圆点 + 一行等宽小字）+ 一句标题 + 逐行填出来的内容骨架 + 闪烁光标 | `id` `kicker` `chrome` `title` `rows`（4 个宽度比例）`footer` |
| `lineart` | 一笔线稿：折线按**弧长**自己画出来（幽灵线先铺全貌）+ 走过的节点留圆点/刻度 + 笔尖带当前节点的名字 | `id` `kicker` `points`（归一化 0..1 的 x,y 对）`labels`（`|` 分隔）`footer` |
| `morph` | 图表形变：同一组数先当柱子立起来 → 缩回基线只剩顶端刻度 → 刻度连成折线 → 折线下铺排线面积 | `id` `values`（9 个数）`title` `sub` `footer` |
| `layers` | 分层纸片：带透视的梯形纸页从后往前往上落位（实心 + 横线 + 左侧信号色标记），最前面那张写标题 | `id` `kicker` `sheets`（`4`）`title` `footer` |
| `isometric` | 等距 2.5D 体块：地面网格上一格格方块长起来（2:1 等距投影），按 `gx+gy+gz` 从远到近画、每个盒子只画朝镜头的三个面（画家算法，`src/shots/isometric.js`） | `id` `kicker` `title` `sub` `cols`（`7`）`rows`（`5`）`cell`（`78`）`height`（`150`）`footer` |
| `cel` | 逐帧手绘 · 线条沸腾：暖纸底上重描线条，抖动来自 `hash(帧组, 线号)`（每 2 帧换一次 = 12fps 手感），圆不圆、线不直；`src/kit/boil.js` | `id` `kicker` `title` `sub` `amp`（`1.8`，抖动像素）`footer` |
| `liquid` | 液体动态：`src/kit/liquid.js` 的域扭曲 fbm 流体底 + 一圈圈 `ripple(t - birth)` 的液滴涟漪（不是粒子系统） | `id` `kicker` `title` `sub` `drops`（`3`）`footer` |
| `lockup` | 署名定版：环/菱形/方块标记画出来 + 字标 + 副标 + 从中间展开的分隔线 + 署名行，停住不压黑 | `id` `mark`（`'ring'`）`kicker` `name` `tagline` `meta` `footer` |
| `timeline` | 横向事件轴：轴从左画到右，笔尖路过的事件节点依次弹出（外圈+信号色中心点+短刻度），事件名上下交替淡入 | `id` `kicker` `title` `events`（4 个名字）`footer` |
| `radial` | 径向分布：中心呼吸核 + 一圈轮辐（节点/名字/沿辐条的读数条）+ 外圈慢转的缺口环 | `id` `kicker` `title` `nodes`（5 个）`weights`（读数条 0..1）`footer` |
| `pixel` | 像素风：4–8 色调色板 + 整块栅格 + Bayer 抖出来的渐变 + 12fps 台阶的精灵队列；中文标题走引擎文字层，最后与图一起压进同一栅格（1-67） | `id` `kicker` `title` `sub` `footer` `palette`（`'gameboy'`；nes / amber / pico / bit1 或自给色表）`cell`（`8`）`crawl`（`'bot'`） |
| `handwrite` | 手写讲解：白板 / 纸感，一笔一笔按弧长生长（落笔细、行笔粗、收笔细），每 2 帧重描；标题用手写体栈（1-69） | `id` `kicker` `title` `sub` `footer` `mode`（`'whiteboard'` / `'paper'`）`seed`（`3`）`boil`（`1.4`，0 = 一笔画完） |

`values` / `headline` 这类数组参数的**元素个数决定画面**（柱子数、两行大字），不是随便塞几个都行。

每个模板的工厂函数上还挂着一份**声明式 `spec`**（参数类型 `params` / 依赖 `requires` / 产出 `outputs`）：
它是 §14.9 那份机器可读载荷里 `requires`、`outputs` 两个字段的来源，也是 `check` 的**依赖前置校验**
读的那份事实（"用了 `wave` 却没配 `audio`"要在**开浏览器之前**就报出来，而不是等出图发现全黑）。
看某个模板的 spec：`node scripts/anim.mjs shots wave --json`。
⚠ 加 spec **只是加声明**：`shot('名字', {…})` / `{ type: '名字', … }` 两种调用签名一个字都没变，
`defaults` 与绘制代码也一个字没动（`tools/test-shots.mjs` §9 把"spec 与 defaults / `meta.params` /
场景对象逐项一致"变成断言）。

### 14.3 需要音乐的三个模板

`wave` / `pulse` / `grid` 读 `ctx.music`（§10.2）：包络数组（`rms` / `low` / `high`，每帧一个值、按 `music.fps` 索引）、
`music.hits('kick', …)` 的**真实打击事件**、`music.bpm`。

- 任务要在 `task.config.mjs` 里配 `audio`，并且**先跑一次** `node scripts/anim.mjs analyze <任务>`；
  没有分析结果时 `music` 为空，画面会黑。
- `wave` 读的是**整片时间 `f.t`**（不是段内时间 `f.lt`）——它画的是"这一刻往前 N 秒的音乐"，放在时间线哪个位置就读那一刻。

### 14.4 每个模板都自己铺满整帧（`whip` 是转场）

- **25 个模板都自己画整帧背景**（`gl.clear(ctx.out, …)` 或自带的全屏 `Pass`），所以一个模板镜头就是**一段完整的画面**，
  不要在同一个 `cut` 里把两个模板叠起来。
- `whip` 用 `ctx.under`（上一段的成帧）做甩镜，所以**必须**在时间线上给它交叠与转场声明：

  ```js
  cut(whip, { dur: 1, overlap: 0.5, handlesTransition: true }),
  ```

  它自己也声明了 `handlesTransition`（转场由它处理，别让引擎再做交叉溶解，否则两屏会叠在一起）。
  配错了（没有 overlap / 没声明 `handlesTransition`）它就没有东西可甩 —— 它仍然会画一帧（速度线 + 近黑底），
  但那不是你想要的那个转场。
  在配置档里（§9.7）写 `{ type: 'whip', dur: 1, overlap: 0.5 }` 即可：`handlesTransition` 由模板自带，不用再写一遍。

### 14.5 与 `makeShot()` 的关系：两条并行的路，不是叠在一起

两者都返回普通场景对象，但解决的是**不同的问题**，各自都交付一整段画面：

| | `src/shots/` 的模板（§14） | `src/kit/shot.js` 的 `makeShot()`（§3.5） |
|---|---|---|
| 交付什么 | **画面本身**（柱子、字、背景、post 全在里面） | **骨架**：`handlesTransition`、共享背景、交叠期把上一帧甩走、`cameraPost(f.t, …)` |
| 你写什么 | `shot('chart', { 参数 })` | `draw(ctx, { k, dx, dy, enter })` 里的前景代码 |
| 背景 | 模板自己铺 | `makeShot` 铺（或 `cut(shot, { world: 'auto' })` 让引擎铺） |
| 什么时候用 | 25 个常见镜头之一 | 要有新视觉，但又不想自己记那四件容易漏的事 |

**不要指望把模板塞进 `makeShot().draw()`**：模板的 `render` 会自己 `gl.clear(ctx.out, …)` / 画全屏 Pass，
覆盖掉 `makeShot` 铺的背景。要用模板就用模板，要自己画就用 `makeShot`，一段里二选一。

### 14.6 与手写场景混用

模板返回的就是普通场景对象，所以同一条时间线里可以一段用模板、一段手写：

```js
timeline: seq([
  cut(shot('title', { title: '写代码，就是做动画' }), { dur: 4 }),
  cut(myHandwrittenRaymarch, { dur: 8, world: 'auto' }),             // 模板没有的新视觉 → 手写
  cut(shot('outro', { title: '完' }), { dur: 4 }),
]),
```

一个任务里也不必把每个 `scenes/*.js` 都换成模板——**只对没想法的那几段用模板**是正常用法。

### 14.7 边界与纪律

- **只放"反复出现、与具体片子无关"的整镜头。** 某一支片子特有的视觉母题（fidus 的准星、nekohome 的窗口边框）
  留在那个任务的 `scenes/_kit.js` 里。全新视觉（raymarch 晶格、燃烧的引线）仍然要手写场景 —— 这是 A 档，不是 DSL。
- **模板里的绘制代码是从已经出过片的场景逐字搬过来的**（`tasks/demo/scenes/`、`tasks/beat/scenes/`），
  所以这两个任务的画面默认是"模板与手写场景等价"的机械判据。**动模板之前先给自己定档**（2026-10-24 起）：
  保画面的改动（重构 / 性能）跑 `--baseline` 必须全绿；有意的视觉改进走 `--accept --note`（先出前后对比图）：

  ```sh
  node scripts/anim.mjs hashes demo --baseline     # 与基线逐像素比：没有像素差 > 16/255，且平均差 < 0.002
  node scripts/anim.mjs hashes beat --baseline
  node scripts/anim.mjs hashes demo --accept --note "title 模板的入场改成 18px 虚焦收敛"   # 有意改画面
  ```

  基线是**变更探测器**，不是"画面永远不许变"（理由与拍板记录见 [`BACKLOG.md`](BACKLOG.md) §4）：
  有意改的时候它先落 `out/demo/hashes-diff.png`（左=改动前、右=改动后），确认后才更新基线。

### 14.8 直接写进时间线（B 档 / 配置档）

`shot(...)` 不是唯一入口：时间线的每一项也可以**直接写模板** `{ type: '名字', …模板参数 }`。
展开规则、字段分流、默认值与"写错就抛"见 §9.7；那里最终调用的就是 §14.1 的 `shot(type, {…})`，
所以**同一份模板、同一份参数表、同一份报错**。

```js
// tasks/<任务>/task.config.mjs —— 不需要 scenes/*.js，也不需要任何 import
export default {
  title: '我的片子',
  timeline: [
    { type: 'title', title: '标题', sub: '副标题', dur: { beat: 8 } },
    { type: 'chart', values: [0.3, 0.7, 0.95], title: '成绩', dur: 5, id: 'bars' },
    { type: 'whip',  dur: 1, overlap: 0.5 },       // 转场模板自带 handlesTransition
    { type: 'outro', title: '完', dur: 3 },
  ],
};
```

- `type` 就是 §14.2 表里的名字；除时间线字段以外的键都是模板参数，`id` / `dur` 不写有默认值。
- 两种写法**可以混在同一条时间线里**（`cut(shot('chart', {…}), { dur: 5 })` 与 `{ type: 'chart', … }`
  产出的是同一个场景对象）。
- 教程 `docs/CONFIG-ONLY.md`；离线回归 `node tools/test-timeline-guard.mjs`（纯 JS，不需要 GPU）。

### 14.9 机器可读的参数表：`anim shots --json`（BACKLOG 1-29 前半 → 1-21 的输入契约）

人读的那张表机器不好用（要对齐、要正则、中文列宽）。`--json` 把**同一份数据**
（都来自 `listShots()`，§14.1）以固定字段名打出来：

```sh
node scripts/anim.mjs shots --json          # 25 个模板
node scripts/anim.mjs shots chart --json    # 只给一个模板（同样是这个形状，count = 1）
```

```json
{
  "schema": "anim.shots/1",
  "count": 1,
  "requireTokens": {
    "music": "画面读 `ctx.music`（音频包络 / 真实打击事件 / 拍号）—— 任务要在 task.config.mjs 里配 `audio`"
  },
  "shots": [
    {
      "name": "chart",
      "summary": "柱状图逐条生长：坐标轴 + 刻度 + 排线柱体 + 扫描线与跟随读数",
      "notes": "背景是本模板自带的整帧纸面 Pass（key `demo_chart_paper`）…",
      "params": [
        { "name": "values", "type": "number[]", "desc": "每根柱子的值（0..1；默认 12 个…）",
          "default": [0.18, 0.34, 0.27], "required": false }
      ],
      "requires": [],
      "outputs": { "visual": "full-frame", "handlesTransition": false },
      "use": "一屏一组可比的量（3–8 根柱），让观众看出谁高谁低",
      "energy": "中",
      "avoid": "超过 8 个值、或需要精确读小数时改 counter；没有出处的数字不要画",
      "tags": ["data", "editorial", "graphic"],
      "w": 1.4,
      "fitsNote": "3–8 个值（points）；收尾位/转场位抽不到"
    }
  ]
}
```

| 字段 | 类型 | 含义 |
|---|---|---|
| `schema` | string | `"anim.shots/1"`（`SHOTS_SCHEMA`）。**字段名或含义变了就要改这个串** |
| `count` | number | 本次输出的模板数（给了模板名就是 1） |
| `requireTokens` | object | 依赖令牌的词表（令牌 → 一句话含义），来自 `src/shots/index.js` 的 `SHOT_REQUIRES`。**1-21 新增**；调用方没给词表时这个键不出现 |
| `shots[]` | array | 一个模板一个对象，**顺序 = `SHOTS` 的登记顺序**（与 §14.2 那张表一致） |
| `shots[].name` | string | 模板名 = `shot('名字')` / `{ type: '名字' }` 里的那个名字 |
| `shots[].summary` | string | 一句话摘要（人读表格里的那一列） |
| `shots[].notes` | string | 长注释。**"需要音乐"这类依赖现在同时在 `requires` 里**（散文留着讲细节）：`wave`/`pulse`/`grid` 见 §14.3 |
| `shots[].params[]` | array | 参数表，顺序 = 模板自己 `meta.params` 的顺序（不是默认值的键序） |
| `params[].name` / `.type` / `.desc` | string | 参数名 / 类型（`string` `number` `number[]` `boolean` `object[]` …）/ 说明。`type` 以模板的 `spec.params` 为准（没有 spec 时回落到 `meta.params[].type`） |
| `params[].default` | any \| null | 默认值（=「什么都不传时的画面」，取自工厂函数的 `.defaults`） |
| `params[].required` | boolean | **没有默认值**（不传时模板拿到 `undefined`）。此时 `default` 恒为 `null` —— JSON 里没有 `undefined`，由 `required` 区分 |
| `shots[].requires` | string[] | **1-21 新增**：依赖令牌（取值见 `requireTokens`）。`[]` = 明确声明"不需要外部输入" |
| `shots[].outputs` | object | **1-21 新增**：`{ visual: 'full-frame' \| 'transition', handlesTransition: boolean }`。`visual` 的值域见 `src/shots/index.js` 的 `SHOT_VISUALS`；`handlesTransition` 与场景对象上那个字段必须一致（`tools/test-shots.mjs` §9 断言） |
| `shots[].use` | string | **1-42 新增**（可选键）：什么时候该用它，一句话。来源是模板的 `meta.use`（见 §14.2） |
| `shots[].energy` | string | **1-42 新增**（可选键）：能量档位，取值见 `src/shots/index.js` 的 `SHOT_ENERGY`（低 / 中低 / 中 / 中高 / 高） |
| `shots[].avoid` | string | **1-42 新增**（可选键）：什么时候**别**用它。`avoid` 与 `use` 一样进 `filterShots()` 的检索面 |
| `shots[].tags` | string[] | **1-62 新增**（可选键）：气质/职能词，取值见 `src/shots/pick.js` 的 `SHOT_TAGS`（封闭词表，只许加）。§14.10 |
| `shots[].w` | number | **1-62 新增**（可选键）：抽取权重，0.4（冷门）– 1.5（主力）。§14.10 |
| `shots[].fitsNote` | string | **1-62 新增**（可选键）：适用条件的人话版。**真条件是工厂上的 `fits(q)` 函数，不进 JSON**（序列化会丢函数），`--json` 的读者看 `fitsNote`。§14.10 |

**角色槽只有一个实现**：`slotOf(s)` 从 `tags` 派生（含 `ending` → 收尾位、含 `transition` → 转场位、其余 → 正文位），
`slotOk(s, q)` 决定放行；选型与「筛空诊断」共用它。诊断按 `energy → tags → exclude → slot → fits` 逐步重放，
**哪一步归零就点名哪一步**（2026-10-31 修：此前 slot 语义藏在各模板的 `fits()` 里，`slot=ending` 的落空被误报成「fits 筛空了」）。

三条**读法**（与字段名一样是契约的一部分）：

1. **`required: true` ⟺ 缺默认值**，不代表"画面离不开它"。当前 25 个模板的每一个参数都有默认值 ⇒
   全是 `false`：省掉任何参数都不会报错，画面就是模板自带的那一段。
2. **缺字段 ≠ `false` / 空**：`requires` 与 `outputs` 是 **1-21 补上的声明式 spec**
   （`src/shots/*.js` 的 `xxxShot.spec`）—— 现在 25 个模板都有了。**没有 spec 的模板，这两个键
   根本不出现**，读到"没有这个键"要理解成**"还没声明过"**，不能当成"不需要"。
   1-21 只加字段、没改任何已有字段名 ⇒ `schema` 仍是 `anim.shots/1`，老的读者不会坏。
   （`required` 已经按同一条规矩设计：模板哪天去掉某个参数的默认值，它自动变成 `true`，
   `--json` 与这一节都不用改。）
3. **`requires` 是"依赖"，不是"错误"**：消费它的是 `scripts/anim.mjs` 的 `cmdCheck`
   （判据 `shotDependencyIssues()` / 报告 `shotDependencyReport()`）：模板要 `'music'` 而任务
   **没配 `audio`** ⇒ 进 `errs`（这一段画面只能是黑的，退出码 1）；配了 `audio` 但还没跑
   `analyze` ⇒ 进 `skipped`（"这一步还没跑"，默认不改退出码）。
   `'under'`（`whip` 要上一段的成帧）走**另一条路**：交叠是时间线层的声明，任务源码的静态文本
   扫描判不准（多行对象 / `seq()` / `--only` 之后的段表都不一样），所以它在**时间线展开之后**
   由段级审计判 —— `shot()` 把 `spec.requires` 搬到场景对象上（`src/shots/index.js`），
   `src/timeline.js` 的 `auditUnderRequires()` 读段对象给出三档事实，`check` / `anim audit`
   打印：**没有交叠 ⇒ 硬问题**（`ctx.under` 恒为 null，画面几乎是黑的且不报错，进 `errs`）；
   **第 1 段 / `--only` 之后 ⇒ 没有"上一段"可比，进 `skipped`**（不许说成"满足"）；
   交叠了但没声明 `handlesTransition` ⇒ 引擎会再叠一次交叉溶解，报一行警告。
   （2026-10-16 接线，BACKLOG 头部 ②；离线单测 `tools/test-timeline-audit.mjs`（19 项）。）
4. **`use` / `energy` / `avoid` 是"选片依据"，不是门**（1-42）：它们只被 `anim shots` 的打印与
   `filterShots()` 消费，**不进任何 gate、不影响画面**。缺这三个键的模板照常可用 ——
   与第 2 条同一条读法（"没有 ≠ 空"）。`energy` 的取值范围是 `SHOT_ENERGY`（只许加档，不许改档名），
   由 `tools/test-shots.mjs` §2.5 断言。

- **确定性**：载荷只来自 `listShots()`，不含时间戳 / 随机 / 环境信息 ⇒ 同一份 `src/shots/`
  永远得到同一个字符串，可以直接 `diff`、可以当基线存。
- **这份输出不许悄悄变**：1-21（`check` 用它把「`wave` 需要 `audio` + 先跑 `analyze`」提前报出来）
  与将来的 catalog 都吃它；要改就先动 `SHOTS_SCHEMA`，并**同步这一节**。
- **不带 `--json` 的人读输出一个字都不变**（两条路同一份数据，只是呈现不同）。
- 机器读者按**退出码**判成败：模板名给错时 **stdout 是空的**、stderr 一行
  `✗ 没有镜头模板 "…"。可用的：…`、退出码 1 —— 别去解析人读的那张表。
- 实现：`scripts/anim.mjs` 的 `shotsCatalog()`（**纯函数**）。离线断言直接
  `await import('./scripts/anim.mjs')` 拿它 —— 本文件有 `IS_MAIN` 入口门，import 不会执行任何命令。
- ⚠ **落盘时别用 PowerShell 的 `>`**：它会给文件加 BOM / 写成 UTF-16，
  `JSON.parse` 当场就炸（实测 `node scripts/anim.mjs shots --json > x.json` 之后
  `SyntaxError: Unexpected token '\uFFFD'` —— 而 CLI 的输出本身是干净的）。
  判据很简单：**载荷的第一个字节必须是 `{`（0x7B）**。要落文件就在 `node -e` 里
  `execFileSync(process.execPath, ['scripts/anim.mjs','shots','--json'], { encoding: 'utf8' })`
  拿到字符串再 `writeFileSync(…, 'utf8')`；这条对 `anim note --list --json` 同样适用。

---

### 14.10 选型：`tags` / `w` / `fits` 与确定性抽签 `anim shots --pick`（BACKLOG 1-62）

学 [`REFERENCE-jizura.md`](REFERENCE-jizura.md) §2 的核心设计：JIZURA 真正值钱的不是部件多，
而是**每个部件带元数据**（`tags` 气质、`w` 抽取权重、`fits(n)` 适用条件），选镜头 = **先按条件筛、
再按权重抽、seed 决定抽到谁** —— 内容的作者只写内容，不负责选型。落在引擎里是三层：

**① 每个模板自报四件选型元数据**（挂在工厂函数上，`src/shots/<名>.js` 文件尾；全员都有，
`tools/test-shots.mjs` §2.6 断言）：

| 字段 | 含义 |
|---|---|
| `tags` | 气质/职能词，取值在封闭词表 `SHOT_TAGS` 里（气质 `calm pop graphic editorial emotional tech handmade`；职能 `title data flow structure process music ending transition`）。**词表只许加不许改** |
| `w` | 抽取权重：0.4–0.7 冷门 / 0.9–1.2 常用 / 1.2–1.5 主力。改它不改画面，只改 `--pick` 抽到谁 |
| `fits(q)` | 适用条件，`q` 是选型 brief（见下）。**缺省字段 = 不设限**；`slot` 是例外——不指明角色槽时，角色锁定模板（`outro`/`lockup`/`whip`）**不可抽** |
| `fitsNote` | `fits` 的人话版（`--json` 里读者看的就是它；函数本体不序列化） |

**② brief（`fits` 的查询对象）**：`slot`（`opening`/`content`/`ending`/`transition`，词表 `SHOT_SLOTS`）、
`chars`（主文本字数）、`rows`（行数）、`points`（数据点/事件/节点/层数）、`hasMusic`、
`hasScreenshot`、`energy`（五档，硬筛）、`tags`（**任一命中即可**）、`exclude`（模板名数组）、`seed`。
拼错点名（`slot`/`tags` 不在词表直接抛错，不当成"筛空"）。

**③ 抽签**（`src/shots/pick.js`，纯函数；同一个 list + 同一个 q 永远同一个结果，`rng(seed)` 与画面的
随机数同源同纪律）：

```js
import { pickShot, pickSequence } from '../../src/shots/pick.js';
import { listShots } from '../../src/shots/index.js';

const r = pickShot(listShots(), { slot: 'content', tags: ['data'], points: 5, seed: 7 });
// → { name: 'chart', w: 1.4, tags: [...], fitsNote, pool: [...], seed }
const seq = pickSequence(listShots(), { slot: 'content', seed: 3 }, 6);  // 版内不重复的一串
```

CLI 一条路：`anim shots --pick --slot content --tags data --points 5 --seed 7`
（`--n 6` 抽一串；`--music` / `--no-music` / `--shot` / `--no-shot` 是两个布尔 brief；
`--exclude chart` = "只换这一项"；`--json` 给 `anim.shots.pick/1`）。
筛空**不返回 undefined**：抛错并说清是哪一步筛空的、筛前还剩谁 —— 放宽哪个条件一看便知。

两条边界：
- `--pick` 只负责**选型**；选完之后时间线里照旧写 `{ type: '<名字>', … }`（§14.8）或 `shot('<名字>', …)`。
  它不改任何模板的画面（`w`/`tags`/`fits` 不进渲染路径），`anim shots` 不带 `--pick` 的人读输出一个字不变。
- 登记仍是**一张手写表**（`src/shots/index.js` 的 `REGISTRY` 数组，键取各工厂的 `meta.name`）：
  没用 `import.meta.glob` 自动扫目录 —— **这是硬约束，不是取舍**：`src/shots/index.js` 被
  `src/timeline.js` 与 6+ 个 CLI 工具（`test-timeline-audit` / `test-block-sig` / `gen-shot-cards` /
  `test-shot-pick`…）在**裸 Node 里直接 import**，而 glob 是 Vite 专属 API（同 `src/tasks.js`
  顶层的下场：Node import 当场炸，所以那个文件也从进不了 Node 工具链）。
  想让"加模板连 index.js 都不改"，先得给 Node 做 glob 的 loader polyfill —— 那是另一个量级的工程。

---

## 附：一页速查

```js
// 场景
export default {
  id, handlesTransition, stateful, integrates,
  setup(ctx) {}, render(ctx) { /* 画进 ctx.out */ return { bloom, grain, ... }; }, dispose() {}
};

// ctx
{ f, gl, out, comp, P, text, type, lines, music, lyrics, params, W, H, start, end, item, under, util, rng, clear }

// f
{ t, dt, lt, p, start, end, beat, bar, beatPhase, fps, idx, seed, preview, seeked, tin, tout, under, a, params }

// 每帧四件事
gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);          // 覆盖
lines.begin(); … ; lines.flush(ctx.out);                    // 矢量（颜色是线性值，可 >1）
text.clear(); type.write(...); text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
return { bloom: 0.4, grain: 0.03 };                         // 后处理

// 时间线
seq([ cut(a, { dur: 4 }), cut(b, { dur: 3, overlap: 0.5 }), par(1.0, [cut(c, {dur:2}), cut(d, {dur:2})]) ])

// 镜头库（A 档，§14）：一行一个整镜头；参数写错会抛错
import { shot, SHOTS, listShots } from '../../src/shots/index.js';
export default shot('chart', { values: [0.3, 0.7, 0.95], title: '成绩' });   // 25 个：title chart kinetic whip outro wave pulse grid quote counter compare bigtype scan device lineart morph layers isometric cel liquid lockup timeline radial pixel handwrite
export default shot('wave', { id: 'intro' });                               // id 覆盖段名（wave/pulse/grid 需要音乐）

// 配置档（B 档，§9.7 / §14.8）：时间线里直接写模板；任务可以没有 scenes/、整个文件没有任何 import
timeline: [ { type: 'title', title: '标题', dur: { beat: 8 } },
            { type: 'chart', values: [0.3, 0.7, 0.95], dur: 5, id: 'bars' },
            { type: 'outro', dur: 3 } ]                                     // 数组、seq([...]) 都行
// 时间线字段 = type id dur at overlap params post maxSamples handlesTransition note world worldPass focus carry transition
// 其余所有键都是模板参数 → shot(type, {…})（写错就抛，并列出可用参数）

// 第 3 种 3D（真网格，§3.8 / docs/THREE.md）：Three.js 镜头，与 makeShot 同形状
import { makeThreeShot } from '../../../src/kit/index.js';
export default makeThreeShot('cube', {
  background: 'over',                       // 'cover' 自带背景 / 'over' 浮在引擎背景上（配 world: 'auto'）
  bridge: { alpha: true },                  // 'over' 必须开
  camera: { fov: 34, pos: [4, 3, 6], target: [0, 1, 0] },
  async setup(ctx, api) { /* 建 THREE.Scene / 材质 / 灯光，api.palette('signal') 取**线性**色 */ },
  update(ctx, api) { api.scene.rotation.y = ctx.f.t * 0.4; },   // ⚠ 只吃 t，不做累积
  overlay(ctx, api) { const p = api.project(1, 0.5, 0.8); /* 引擎的文字/引线贴在 3D 上 */ },
});

// 命令
node scripts/anim.mjs tasks | new <名> | shots [名字] | check <名> | still <名> -t 1,2 | sheet <名> --from 0 --to 10 -n 12
node scripts/anim.mjs shot <名> --from 0 --to 6 | video <名> [--scale 2] | perf <名> | gpu | analyze <名> | hashes <名> --baseline
node tools/probe-three.mjs                  # 第 3 种 3D 的桥：朝向 / 颜色管线 / 线性 alpha
```
