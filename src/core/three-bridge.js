// @ts-check
/**
 * Three.js 桥 —— 引擎的**第 3 种 3D：真网格**（前两种见 `docs/ENGINE.md` §3.7：
 * 解析投影线段批、raymarch）。它给的是那两种给不了的东西：**导入/程序化的三角网格**
 * 与一整套现成的摄影机/材质/光照/实例化/阴影生态。
 *
 * ## 为什么是「一个图层」而不是「两支片子拼起来」
 *
 * 各渲各的 mp4 再 concat，两边是两套 sRGB / 色调映射 / 泛光 / 颗粒实现 —— 接缝一定看得出来，
 * `verify` 也失去意义。这里走的是另一条：Three.js 的画面**进引擎的合成器**，
 * 之后与别的镜头**完全相同**（同一套后处理、同一条 NV12 推流、同一个 verify）。
 * 接缝因此退化成一次普通镜头切换（配方见 `src/core/trans.js` 顶部那四条）。
 *
 * ## 链路（路线 A：独立 GL context + canvas 上传）
 *
 *   Three.js 渲进自己的 offscreen canvas
 *     → `texImage2D(SRGB8_ALPHA8)` 上传成引擎的一张纹理（硬件把 sRGB 解码成线性光）
 *     → 一个 `blend:false` 的全屏 Pass 铺满 `ctx.out`
 *     → 图层合成 → 后处理（泛光/光晕/颗粒/暗角）→ `readNV12()` 推流
 *
 * 选路线 A 而不是「和引擎共用一个 GL context」是**故意的**：共用上下文时，
 * 两边各自管绑定/混合/viewport/VAO/program，互相污染是这类集成最经典的坑，
 * 而且**不报错、只是画面诡异**（同 `docs/history/STATUS-rounds-1-6.md` §13.4 那三个静默失效）。
 * 代价是每帧一次 1080p 拷贝 —— 离线渲染每帧多花几毫秒，无所谓。
 *
 * ## 四件必须记住的引擎约定（都会静默出问题）
 *
 * 1. **整帧记账**：引擎靠 `gl._notePaint()` 回答「这一段到底铺了底没有」。
 *    本桥的合成 Pass 是 `blend:false` 的全屏绘制，所以会记进 `paint.full` ——
 *    `check` 的**背景守门**就是看这个数。别把它设成 `noFull`。
 * 2. **运动模糊 = 多子帧求平均**：一帧会被拆成 8 / 24 / 72 / 216 个子帧，
 *    每个子帧 `t` 都略有不同 ⇒ **Three.js 每子帧都要重渲一遍**（`render()` 里就是这么做的）。
 * 3. **必须可任意 seek**：`anim determinism` / `anim probe` 会正着渲、倒着渲、跳着渲。
 *    所以摆位一律写成 `t` 的函数（`update(ctx)` 里读 `ctx.f.t`），
 *    **绝不要 `this.x += v * dt`** —— 子帧乱序时那种写法没有意义。
 * 4. **确定性铁律**（`AGENTS.md` §4）：不用 `Math.random()` / `Date.now()` / `performance.now()`。
 *    ⚠ Three.js 本身不是不确定的 —— 只要你也这么写，它就是确定性的。
 *    别把「用了 Three.js」当成破例的理由。
 *
 * ## 颜色：两边是同一套线性光
 *
 * 引擎整条链都在**线性光**里跑，最后一步才编码 sRGB。所以：
 *   · Three.js 保持默认的 `outputColorSpace = SRGBColorSpace`（画布上是 sRGB 字节）；
 *   · 上传时用 `SRGB8_ALPHA8`，硬件解码回线性 → 与引擎的线性空间接上；
 *   · 调色板用 `linearColor(THREE, ctx.P.signal)` 取（**线性值**），
 *     不要用 `new THREE.Color('#ff4d12')` —— 后者按 sRGB 解释，颜色会偏亮一档。
 *
 * ## 朝向
 *
 * Three.js 画布第 0 行是**画面顶部**；引擎的全屏 Pass 里 `vUv.y = 1` 才是顶部。
 * 所以合成 Pass 采样时翻了 y（`vec2(vUv.x, 1.0 - vUv.y)`），默认 `flipY: 1`。
 * 这条**必须实测**：`tasks/_three-lab` 里有一段 `calib`（四个象限颜色不一样），
 * `anim still _three-lab -t … --only calib` 出图就能一眼看出颜色与朝向对不对。
 *
 * ## 用哪两个入口
 *
 * ```js
 * // ① 要一个完整镜头（推荐，和 src/kit/shot.js 的 makeShot 同一个形状）
 * export default makeThreeShot('lab_cube', {
 *   async setup(ctx, api) { …建几何/材质/灯光（api.THREE / api.scene / api.camera）… },
 *   update(ctx, api) { …按 ctx.f.t 摆相机与物体（纯函数）… },
 *   overlay(ctx, api) { …3D 之上叠引擎的矢量与文字（可选）… },
 * });
 *
 * // ② 只要那条链路（自己控制合成顺序、或把 3D 当背景再手画前景）
 * async setup(ctx) { const THREE = await loadThree(); this.b = getThreeBridge(ctx, THREE); … }
 * render(ctx) { this.b.render(this.scene, this.camera); this.b.composite(ctx.gl, ctx.out); … }
 * ```
 */

import { Pass } from './gl.js';

/* ------------------------------------------------------------------ 依赖 */

/** @type {any} 缓存的 three 模块 */
let _three = null;

/**
 * 动态 `import('three')`。
 *
 * 为什么不是 `import * as THREE from 'three'`：**不用 Three.js 的任务不该被它拖下水**。
 * 静态 import 会让 three 进入每个任务的模块图（页面首帧多下载几百 KB），
 * 动态 import 只在实际用到时才加载 —— 只有 `setup()` 里 `await` 一次。
 *
 * 没装就抛一条**能照着做**的错：`npm install three`。
 */
export async function loadThree() {
  if (_three) return _three;
  try {
    _three = await import('three');
  } catch (err) {
    throw new Error(
      '这个镜头用了 Three.js，但依赖没装。跑一次：\n' +
      '  npm install three\n' +
      `（原始错误：${err && err.message ? err.message : err}）`,
    );
  }
  return _three;
}

/* ------------------------------------------------------------------ 合成用 shader */

/**
 * 把 Three.js 的画布铺到目标上。
 *
 * ⚠ 颜色这一笔**故意不用 `SRGB8_ALPHA8`**（`Layer2D` 用的是那个）：画布给的 RGB 是
 * **预乘过 alpha、而且是在 sRGB 编码空间里预乘的**（实测：半透明红在画布上读到 R'≈0.5
 * 而不是 1.0 —— 见 `tasks/_three-calib` 的 `alpha` 段，那里量到 161 而不是 225）。
 * 硬件 sRGB 解码**救不了这个**（解码发生在乘 alpha 之后，除法补不回来），
 * 所以按普通 RGBA8 上传，在 shader 里**先反预乘（仍在编码空间）、再解码到线性**。
 * 两步顺序不能颠倒 —— 颠倒了半透明处就暗一档（这是量出来的，不是推出来的）。
 *
 * · `flipY`：见文件头「朝向」。1 = 翻转（默认，正确的那一个）。
 * · `gain`：整体的线性增益，给"让 3D 也吃到一点 HDR 余量/曝光"用（默认 1）。
 * · `opacity`：整体不透明度（给自定义转场用）。
 * · `premult`：1 = 源是预乘 alpha（`'over'` 模式要反预乘）；0 = 不透明/加法。
 * · `useAlpha`：1 = 用画布的 alpha 做**正常混合**（3D 浮在引擎已经画好的东西之上）；
 *   0 = 整帧不透明覆盖。见 `ThreeBridge.composite()` 的 mode。
 */
const THREE_COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D src;
uniform float flipY;
uniform float gain;
uniform float opacity;
uniform float useAlpha;
uniform float premult;
void main() {
  vec2 uv = flipY > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
  vec4 s = texture(src, uv);              // RGBA8：画布上的 sRGB 编码值（可能预乘过）
  vec3 enc = premult > 0.5 ? s.rgb / max(s.a, 1e-4) : s.rgb;
  vec3 c = toLinear(clamp(enc, 0.0, 1.0)) * (gain * opacity);
  float a = useAlpha > 0.5 ? s.a * opacity : 1.0;
  fragColor = vec4(c, a);
}`;

/* ------------------------------------------------------------------ 桥 */

/**
 * 一个 Three.js 渲染器 + 一块 offscreen 画布 + 一个"铺满整帧"的合成 Pass。
 *
 * **每个 GL 实例共享一个**（`getThreeBridge`）：合成是逐场景**顺序**发生的
 * （引擎的 `composite()` 一段画完再画下一段），所以两块画布没有必要 ——
 * 一段渲完立刻上传、立刻画进它自己的 rt，下一个场景再覆盖同一块画布即可。
 * 这样并发段（转场交叠）也不会互相踩，而且只多占一个 GL 上下文。
 */
export class ThreeBridge {
  /**
   * @param {any} gl 引擎的 GL 实例
   * @param {any} THREE three 模块
   * @param {{ antialias?: boolean, shadows?: boolean, alpha?: boolean }} [opts]
   *        `alpha: true` ⇒ 画布带透明通道（3D 浮在引擎画的背景之上，见 `composite` 的 `mode: 'over'`）
   */
  constructor(gl, THREE, opts = {}) {
    this.gl = gl;
    this.THREE = THREE;
    this.alpha = !!opts.alpha;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1;
    this.canvas.height = 1;
    /** 共享的 three 渲染器。想开阴影/换 tone mapping 直接改它（`bridge.renderer`）。 */
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: this.alpha,
      antialias: opts.antialias !== false,
      // 与引擎自己那个上下文同一个理由：读回/上传必须拿到**已经画完**的那一帧
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
      // ⚠ 这一条是"3D 浮在背景之上"能不能对的关键：`false` = 画布里存的是**直通 alpha**
      //   （RGB 已经除过 alpha），于是引擎这边按 `SRC_ALPHA / ONE_MINUS_SRC_ALPHA` 混合
      //   就是数学上正确的 over。写 true 的话 RGB 是预乘的，再乘一次 alpha ⇒ 半透明处偏暗。
      //   `tasks/_three-calib` 的 `alpha` 段就是量这一条的（linear 0.75 应为 224，预乘会得到 188）。
      premultipliedAlpha: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // 引擎的曝光/调色在后处理链里统一做，three 这一侧不要再动（否则等于调两次）
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, this.alpha ? 0 : 1);
    if (opts.shadows) this.renderer.shadowMap.enabled = true;
    /** three 的尺寸是否已经与引擎的物理分辨率对齐（scale 变了要重设） */
    this._pw = 0;
    this._ph = 0;
    this._alloc = false;

    const g = gl.ctx;
    this.tex = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, this.tex);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);

    this.pass = new Pass(gl, THREE_COMPOSITE_FRAG, {
      src: { value: null }, flipY: 1, gain: 1, opacity: 1, useAlpha: 0, premult: 0,
    }, { key: 'three_bridge', blend: false, jitter: false });   // 合成的是 three 自己渲好的图：不吃抖动

    this._v3 = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this.stats = { renders: 0, uploads: 0 };
  }

  /** 让 three 的渲染分辨率跟上引擎的物理分辨率（`--scale 2` 就是真 4K）。 */
  _syncSize() {
    const { pw, ph } = this.gl;
    if (this._pw === pw && this._ph === ph) return;
    this._pw = pw; this._ph = ph;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(pw, ph, false);   // updateStyle=false：这块画布不进 DOM
    this._alloc = false;                    // 尺寸变了要重新 texImage2D 分配
  }

  /** 相机按引擎的逻辑宽高比（与物理宽高比相同，缩放不改变它）。正交相机不动。 */
  syncCamera(camera) {
    if (!camera || camera.isPerspectiveCamera !== true) return;
    if (Math.abs((camera.aspect ?? 0) - this.gl.w / this.gl.h) > 1e-6) {
      camera.aspect = this.gl.w / this.gl.h;
      camera.updateProjectionMatrix();
    }
  }

  /** 渲一帧进那块画布。**每子帧都要调**（运动模糊就是这么来的）。 */
  render(scene, camera) {
    this._syncSize();
    this.syncCamera(camera);
    this.renderer.render(scene, camera);
    this.stats.renders++;
    return this;
  }

  /**
   * 上传画布 → 引擎纹理。
   *
   * ⚠ 三个坑（前两个与 `gl.js` 的 `Layer2D.upload` 同一套，别改成"每次 texImage2D"）：
   *   1) Chrome 对「同一张 canvas 连续 texImage2D」只留最后一次提交，纹理会是上一帧的；
   *      所以第一次分配存储、之后一律 `texSubImage2D`。
   *   2) 不要翻转 Y：朝向由合成 Pass 的 `flipY` 负责（两边都翻会互相抵消）。
   *   3) **不要用 `SRGB8_ALPHA8`**：画布的数据是"在 sRGB 编码空间里预乘过 alpha"的，
   *      硬件解码会把半透明的颜色解错（见 `THREE_COMPOSITE_FRAG` 上面的长注释）。
   *      这里按普通 RGBA8 上传，解码与反预乘都在 shader 里做。
   */
  upload() {
    const g = this.gl.ctx;
    g.bindTexture(g.TEXTURE_2D, this.tex);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (!this._alloc) {
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, this.canvas);
      this._alloc = true;
    } else {
      g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, g.RGBA, g.UNSIGNED_BYTE, this.canvas);
    }
    this.stats.uploads++;
    return this.tex;
  }

  /**
   * 把当前画面铺进一张渲染目标。
   *
   * `mode` 三选一（默认 `'cover'`）：
   *
   * | mode | 做什么 | 记账 | 什么时候用 |
   * |---|---|---|---|
   * | `'cover'` | **不透明整帧覆盖** | `blend:false` ⇒ 记进 `paint.full` | 3D 自带背景（清屏色 + 三维网格） |
   * | `'over'` | 用画布 alpha 做正常混合（直通 alpha） | 不算整帧覆盖 | 3D **浮在引擎画的背景上**（背景逐像素不变） |
   * | `'add'` | 加法叠加（发光体） | 同上 | 线框/全息感，背景亮一点也不会盖掉 |
   *
   * ⚠ `'over'` / `'add'` 都**不算整帧覆盖**，所以那一段必须自己有背景来源 ——
   * 时间线上写 `world: 'auto'`（引擎铺共享背景），或者场景自己画一整屏 Pass。
   * 否则 `check` 的背景守门会点名"这一段没铺整帧背景"（它是对的）。
   *
   * 也可以不用这里、直接用 `comp.draw`（`bridge.tex` 是裸纹理：
   * `ctx.comp.draw(ctx.gl, bridge.tex, ctx.out, { mode: 'screen', opacity: 0.6 })`；
   * 朝向与 Layer2D 一致，不用翻）。
   *
   * @param {any} gl
   * @param {any} target 一般是 `ctx.out`
   * @param {{ mode?: 'cover'|'over'|'add', opacity?: number, gain?: number, flipY?: boolean, t?: number, dt?: number }} [opts]
   */
  composite(gl, target, opts = {}) {
    const mode = opts.mode ?? 'cover';
    this.upload();
    const p = this.pass;
    p.u.src.value = { tex: this.tex, __tex: true };
    p.u.flipY.value = opts.flipY === false ? 0 : 1;
    p.u.gain.value = opts.gain ?? 1;
    p.u.opacity.value = opts.opacity ?? 1;
    p.u.useAlpha.value = mode === 'cover' ? 0 : 1;
    // 'over' 要反预乘（画布是预乘的）；'add' 直接用预乘值 —— 那正是"3D 先落在黑底上再相加"
    p.u.premult.value = mode === 'over' ? 1 : 0;
    p.blend = mode !== 'cover';
    p.blendFn = mode === 'add' ? 'add' : undefined;
    p.noFull = false;
    p.render(gl, target, opts.t ?? 0, opts.dt ?? 1 / 60);
    return this;
  }

  /**
   * 世界坐标（**与 `src/core/cam.js` 同一套约定**：+x 右、+y 上、-z 朝屏幕里）
   * → 引擎的逻辑像素（原点左上、y 向下）。给"把标签/引线贴在 3D 物体上"用。
   *
   * 返回 `visible`：相机身后或远平面之外的点是**投影不出来**的，
   * 拿它去画标签会得到一个"镜像的鬼影"（这个坑很贵，所以直接在这里判掉）。
   *
   * @returns {{ x: number, y: number, z: number, visible: boolean }} z < 0 = 在相机前方
   */
  project(x, y, z) {
    const cam = this._projCam;
    if (!cam) return { x: 0, y: 0, z: 0, visible: false };
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const v = this._v3.set(x, y, z).project(cam);
    const view = this._view.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    return {
      x: (v.x * 0.5 + 0.5) * this.gl.w,
      y: (1 - (v.y * 0.5 + 0.5)) * this.gl.h,
      z: view.z,
      visible: view.z < -1e-6 && v.z <= 1 && v.x > -1.2 && v.x < 1.2 && v.y > -1.2 && v.y < 1.2,
    };
  }

  /** `project()` 要知道当前相机 —— `makeThreeShot` 每子帧会设一次。 */
  setProjectCamera(camera) { this._projCam = camera; return this; }

  dispose() {
    try { this.renderer.dispose(); } catch { /* 上下文已经没了就算了 */ }
    this.gl.ctx.deleteTexture(this.tex);
    // 主动丢上下文：不丢的话反复新建（dev 下改场景 = 重新 setup）会把 Chrome 的
    // "最多 16 个 WebGL 上下文"吃满，然后**新建的那个是空的**（页面看起来像没画）。
    try { this.renderer.forceContextLoss?.(); } catch { /* 同上 */ }
  }
}

/** @type {WeakMap<any, Map<string, ThreeBridge>>} 每个 GL 实例一组桥（按配置签名分） */
const _bridges = new WeakMap();

/**
 * 取（或建）本 GL 实例的桥。**只能同步调用** —— 所以 three 模块要自己先 `await loadThree()`。
 *
 * ```js
 * async setup(ctx) {
 *   const THREE = await loadThree();
 *   this.bridge = getThreeBridge(ctx, THREE);
 * }
 * ```
 *
 * 同一套配置（alpha / antialias / shadows）**全片共享一个**：合成是逐场景顺序发生的，
 * 一块画布够用，而且只多占一个 GL 上下文。配置不同才会再建一个。
 */
export function getThreeBridge(ctx, THREE, opts = {}) {
  const gl = ctx.gl;
  const sig = `${opts.alpha ? 'a' : '-'}${opts.antialias === false ? 'n' : 'A'}${opts.shadows ? 's' : '-'}`;
  let bag = _bridges.get(gl);
  if (!bag) { bag = new Map(); _bridges.set(gl, bag); }
  let b = bag.get(sig);
  if (!b) {
    b = new ThreeBridge(gl, THREE, opts);
    bag.set(sig, b);
    // 引擎 dispose() 时把上下文一起收掉（不注册的话 dev 下改一次场景漏一个上下文）
    (gl.onDispose ?? (gl.onDispose = [])).push(() => b.dispose());
  }
  return b;
}

/* ------------------------------------------------------------------ 颜色 */

/** 线性 [r,g,b] → THREE.Color（**线性**空间，不是 sRGB —— 见文件头「颜色」）。 */
export function linearColor(THREE, rgb, mul = 1) {
  const c = new THREE.Color();
  c.setRGB(rgb[0] * mul, rgb[1] * mul, rgb[2] * mul, THREE.LinearSRGBColorSpace);
  return c;
}

/** 取调色板里的颜色：`paletteColor(THREE, ctx.P, 'signal', 0.6)`。 */
export function paletteColor(THREE, P, name, mul = 1) {
  const rgb = P[name];
  if (!rgb) throw new Error(`调色板里没有 '${name}'。有：${P.names().join(' / ')}`);
  return linearColor(THREE, rgb, mul);
}
