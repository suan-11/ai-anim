// @ts-check
/**
 * 引擎：把「时间」变成「一帧」。
 *
 * 渲染一帧做的事：
 *   1) 找出这一时刻有哪些段在播（允许重叠 = 转场）
 *   2) 每段画进一个 HDR 目标，按需跟上下的段交叉溶解
 *   3) 叠上 Canvas2D 图层（文字/UI）
 *   4) 跑后处理（泛光/光晕/颗粒/暗角/调色）
 *   5) 写进 outRT（**线性光**，编码在最后一步：屏幕走 blitPass 的 toSRGB，导出走 readPixels(rt,'srgb')）
 *
 * 运动模糊：离屏渲染时一帧会被拆成 N 个子帧（散在快门时间内）求平均。
 * N 可以自适应（8 → 24 → 72 → 216），判据是「再加一组子帧，画面变化是否小于容差」。
 * 静止帧停在 8，普通运镜 24，甩镜/砸字会吃到 72 或 216。
 */

import { GL, RT, Pass, Compositor, Layer2D } from './gl.js';
import { Post, DEFAULT_POST } from './post.js';
import { P as DEFAULT_PALETTE } from './palette.js';
import { Scene as SceneBase, frameSeed } from './scene.js';
import { TextKit } from './text.js';
import { makeNarration, makeNarrationReader } from './narration.js';
import { makeCaptionLayer, resolveCaptionStyle } from './captions.js';
import { SILENT } from './audio.js';
import * as U from './util.js';
// 交叠期的默认转场（甩镜）。`transitions.js` 只依赖 gl/util，不会再反向依赖 engine —— 无环。
import { transitionPass, cameraDir, resolveTransitionMode } from './trans.js';
// 画幅适配（竖屏，BACKLOG 1-52）：栅格与字号阶梯要按实际 W/H 换一套。
// 依赖方向是 core → style 的唯一一处，且只用一个纯函数（`style/index.js` 不反向 import 引擎）。
import { fitStyleToFrame } from '../style/index.js';
// 整片介质（`style.view`，2026-10-30）：合成完 → post 之前把整帧换成一种成像方式。
// 依赖方向 core → kit 的唯一一处：`kit/views.js` 只 import `core/gl.js`，不反向依赖引擎 —— 无环。
import { applyStyleView } from '../kit/views.js';
// 自适应子帧的**判据**（误差分位 / 停滞熔断 / 档位）在纯函数模块里，见文件头
import {
  BASE_SAMPLES, MAX_SAMPLES, DEFAULT_TOL,
  fixedOffsets, ternaryOffsets, levelsFor, snapMaxSamples,
  quantileFromHist, samplingVerdict,
  jitterOffset, NO_JITTER, JITTER_PERIOD,
} from './sampling.js';

/** @typedef {import('./post.js').PostParams} PostParams */

/**
 * @typedef {Object} TimelineItem
 * @property {string} id            名字（要唯一）
 * @property {any} scene            场景对象 或 () => Promise<场景对象>（懒加载）
 * @property {number} start         起点（秒）
 * @property {number} end           终点（秒）
 * @property {Record<string, any>} [params] 传给场景的参数
 * @property {Partial<PostParams>} [post]   这一段的默认后处理
 * @property {boolean} [handlesTransition]  自己处理与上一段的衔接
 * @property {number} [maxSamples]  这一段的自适应采样上限（噪声收敛慢的场景用）
 * @property {string} [note]        备注，只在 timeline 列表里显示
 */


export class Engine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ width?: number, height?: number, scale?: number, palette?: any, fps?: number }} [opts]
   */
  constructor(canvas, opts = {}) {
    this.gl = new GL(canvas, { scale: opts.scale ?? 1 });
    this.gl.resize(opts.width ?? 1920, opts.height ?? 1080, opts.scale ?? 1);
    // P 必须在 Post 之前赋值：Pass 在构造时就把调色板常量注入 shader 源码，
    // 顺序反了的话，任务覆盖的 palette 只在场景里生效，后处理链里还是默认配色。
    this.P = opts.palette ?? DEFAULT_PALETTE;
    this.fps = opts.fps ?? 60;
    this.comp = new Compositor(this.gl);
    this.post = new Post(this.gl, this.P);
    /**
     * HUD 专用的 Canvas2D 图层。
     * 每个时间线条目（每段场景）有**自己**的图层（item._layer），互不干扰——
     * 用一张共享画布的话，两段重叠时（转场）会互相擦除，HUD 也会把场景的文字擦掉。
     */
    this.hud2d = new Layer2D(this.gl);
    this.text = this.hud2d;
    this.type = this.hud2d.type;
    /** @type {TimelineItem[]} */
    this.timeline = [];
    /** @type {Map<string, any>} */
    this.scenes = new Map();
    this.music = SILENT;
    this.lyrics = null;
    /**
     * 口播 / 旁白时间轴（`docs/NARRATION.md` A 档）。
     * 由 `load()` 用 `makeNarrationReader()` 包成查询接口；没配 `task.narration` 时
     * 是一个"永远返回 null"的空实现，所以场景里可以无条件写 `ctx.narration.at(f.t)`。
     */
    this.narration = makeNarrationReader(null);
    /**
     * 风格包（`docs/STYLE.md`）：由 `src/tasks.js` 用 `resolveStyle()` 解析好传进来。
     * 形状见 `src/style/index.js`；`null` = 没有风格概念的老行为（等价于 `print`）。
     */
    this.style = null;
    /**
     * 引擎级**字幕层**（`task.captions` 打开时非 null）。
     * 建在 `load()` 里（那时才知道 W/H/P/narration），每帧在**后处理之后**画一次。
     */
    this.captions = null;
    /** 字幕专用的 Canvas2D 图层（与调试 HUD 分开：两者开关独立、生命周期独立）。 */
    this.cap2d = null;
    /** 装载期的错误（setup 失败、共享背景建不出来、--only 写错…） */
    this.errors = [];
    /**
     * 运行期的**警告**（不是错误）：kit 的版面冲突（`assertInBand`）、
     * 说明条写成了句子（`captionNote` 太长）之类。
     *
     * 单独一条通道的理由：这些东西**每一帧都会发生**，走 `console.warn` 会刷屏，
     * 而 `check` 又必须看得到它们（"不报错但画面错"是这仓库最贵的一类 bug）。
     * 场景侧通过 `ctx.warnings` 拿到同一个数组。
     * @type {string[]}
     */
    this.warnings = [];
    /**
     * **场景 render 抛的异常**，结构化记着（段名 / 时刻 / 帧号 / 栈）。
     *
     * 与 `errors`（字符串，人看）分开的原因：CLI 要拿它做**机器判据** ——
     * `check` 必须失败、`video` 必须不出片（`docs/history/IMPROVEMENTS-1-3.md` P0-3）。
     * 去重交给 `app.js` / CLI 那侧做（同一段每帧都抛，这里如实全记）。
     * @type {{ id: string, t: number, idx: number, message: string, stack: string }[]}
     */
    this.renderErrors = [];
    this.hud = true;
    this.hudInfo = { title: '', note: '' };
    this.duration = 0;
    this.startTime = 0;

    // 三个 HDR 目标轮转，保证转场时「上一个场景」的成帧还在
    this.pool = [new RT(this.gl, this.gl.pw, this.gl.ph, { depth: true }),
                 new RT(this.gl, this.gl.pw, this.gl.ph, { depth: true }),
                 new RT(this.gl, this.gl.pw, this.gl.ph, { depth: true })];
    this.mixRT = new RT(this.gl, this.gl.pw, this.gl.ph);
    this.avgRT = new RT(this.gl, this.gl.pw, this.gl.ph);
    this.sumRT = new RT(this.gl, this.gl.pw, this.gl.ph);
    this.newRT = new RT(this.gl, this.gl.pw, this.gl.ph);
    /** 场景级变换（ctx.setXform）的外部目标：绝不「读自己写自己」 */
    this.xformRT = new RT(this.gl, this.gl.pw, this.gl.ph);
    /**
     * 误差归约的目标：1/16 分辨率、每格一个 8bit 值（0..255 级）。
     *
     * ⚠ **必须是 8bit**（`float: false`）。从前的写法是默认浮点 RT，然后用
     * `readPixels(RGBA, UNSIGNED_BYTE)` 读它 —— WebGL2 对 RGBA16F + UNSIGNED_BYTE 抛
     * `INVALID_OPERATION`，缓冲原样不动（全 0）⇒ 误差恒为 0 ⇒ 自适应采样**从来没起过作用**
     * 每一帧都在第 1 级"收敛"。这个 bug 不报错、只少画拖影，活了很久
     * （`docs/HANDOFF-spectrum-friction.md` §1 把它误判成"静止画面上不收敛"）。
     * 见 `tools/probe-sampling.mjs` 与 `tools/test-sampling.mjs`。
     */
    this.errRT = new RT(this.gl, Math.ceil(this.gl.pw / 16), Math.ceil(this.gl.ph / 16), { float: false, nearest: true });
    this.outRT = new RT(this.gl, this.gl.pw, this.gl.ph, { float: false });
    this.errBuf = new Uint8Array(this.errRT.w * this.errRT.h * 4);
    /** 误差直方图（256 桶，复用）。`_sampleError` 用它取 99 分位而不是最大值。 */
    this._errHist = new Uint32Array(256);
    this.errPass = null;

    this.lines = null; // 由 load() 建（需要 palette 就绪）
    this.lastT = -1;
    this.lastSamples = 1;
    /**
     * 上一帧**为什么**停在这个子帧数上（`'tol'` 收敛 / `'stall'` 停滞熔断 / `'cap'` 到上限 /
     * `'more'` 还在加 / `null` 没走自适应）。`video` 收尾与 `perf` 会打出来 ——
     * 作者以前只能靠"实测帧率反推"，因为引擎从不解释自己（`docs/HANDOFF-spectrum-friction.md` §1）。
     */
    this.lastSampleReason = null;
    /** 上一帧判定时的误差（0..1，显示空间；`NaN` = 第一级就到上限，没量过） */
    this.lastSampleErr = NaN;
    /** 上一帧允许的上限（已收成 8/24/72/216 档位）与被谁压下来的 */
    this.lastMaxSamples = null;
    this.lastCappedBy = [];
    this.lastErrors = [];
    this.lastPost = { ...DEFAULT_POST };
    /**
     * 最近一帧的「非有限值」扫描结果（`render(t, { scanNf: true })` 才会填，否则 null）。
     * 出片路径（`src/app.js` 的 `stream()`）读它并推一条 `diag: 'nonFinite'` —— 见 `_scanFrameNonFinite`。
     * @type {null | { t: number, subT: number, idx: number, sub: number, id: string|null, ids: string[],
     *                 w: number, h: number, pixels: number, nan: number, inf: number, huge: number,
     *                 hugeMax: number, bad: number,
     *                 first: null | { x: number, y: number, r: number, g: number, b: number, kind: string } }}
     */
    this.lastNonFinite = null;
  }

  /* ------------------------------------------------------------ 装载 */

  /**
   * @param {{ timeline: TimelineItem[], music?: any, lyrics?: any, title?: string,
   *           duration?: number, only?: string|null, worldPass?: any }} spec
   */
  async load(spec) {
    this.timeline = (spec.timeline ?? []).slice().sort((a, b) => a.start - b.start);
    this.renderErrors.length = 0;
    this.duration = spec.duration ?? Math.max(0, ...this.timeline.map((i) => i.end));
    this.music = spec.music ?? SILENT;
    this.lyrics = spec.lyrics ?? null;
    /**
     * 旁白表：`load()` 时归一 + 包一次，之后每帧只做纯查询（不依赖上一帧）。
     * 场景里既可以从 `ctx.narration` 拿，也可以从 `f.narration` 拿 —— 同一个对象。
     *
     * ⚠ `load()` 收的既可以是**原始 spec**（`{ lines: [...] }` 或数组，直接跑引擎的测试用），
     *   也可以是 `src/tasks.js` 归一好的表（有 `source` / `totalSpeech` 那些派生量）。
     *   判据是"有没有 `lines` 且每行带 `end`"—— 归一次很便宜，不做这个判断的话
     *   原始 spec 会被当成归一表，`lines` 全部变空、`ctx.narration.at()` 恒为 null
     *   （这个坑当场踩了：`probe-alpha` 的旁白用例全 FAIL，而 `lineCount` 是 undefined）。
     */
    const narrSpec = spec.narration ?? null;
    const narrReady = narrSpec && Array.isArray(narrSpec.lines)
      && narrSpec.lines.every((l) => l && typeof l === 'object' && l.end != null);
    this.narration = makeNarrationReader(
      narrReady ? narrSpec : makeNarration(narrSpec, { duration: this.duration }),
    );
    this.hudInfo.title = spec.title ?? '';
    /**
     * 风格包（`docs/STYLE.md`）：`style: 'paper'` 一行换掉整片观感。
     *
     * 解析（`resolveStyle`）在 `src/tasks.js` 里做 —— 那里能把"哪个文件写错了"带进报错。
     * 引擎这边只负责用：`ctx.style` 给场景、`style.grid` 给字幕带与 kit 元件、
     * `style.post` 作为后处理基线、`style.fonts` 注入字体栈（见 `applyStyleFonts()`）。
     *
     * 颜色（`style.palette`）不在这里合并：`P` 必须在 `new Engine()` 之前定好
     * （`Post` 构造时就把调色板常量注进 shader 源码了），所以 `src/app.js` 负责合成。
     */
    this.style = fitStyleToFrame(spec.styleResolved ?? spec.style ?? null, this.gl.w, this.gl.h);

    /**
     * 字幕层：`task.captions` 打开时建。
     *
     * ⚠ 默认**关**：老任务不写 `captions` 就一个像素都不变（编年体验：字幕以前是出锅之后
     * 用 ffmpeg 烧的，见 `docs/CAPTIONS.md`）。开了之后场景里一行都不用写 ——
     * 引擎每帧自动画"此刻该显示的那句旁白"。
     */
    {
      const capStyle = resolveCaptionStyle(this.style, spec.captions);
      this.captions = capStyle
        ? makeCaptionLayer({
          narration: this.narration,
          style: capStyle,
          P: this.P,
          W: this.gl.w,
          H: this.gl.h,
          grid: this._scaledGrid(),
        })
        : null;
      if (this.captions && !this.cap2d) this.cap2d = new Layer2D(this.gl);
    }
    /**
     * 全片共享的背景 Pass（`task.worldPass(ctx)` 的返回值）。
     *
     * 为什么要在引擎里有一等公民的位置：做一支片子时「全片只有一层背景」是让镜头切换
     * 不"跳"的关键（见 trans.js 顶部那四条配方），而**场景作者忘了调用它就是静默黑底** ——
     * 做 fidus 时 9 段里 8 段这样，且 check 的亮度统计抓不到（文字和 grain 自己就有亮度）。
     * 现在两种用法都不靠"记得"：
     *   · `cut(shot, { world: 'auto' })` —— 引擎每帧先画共享背景，再调场景 render；
     *   · `ctx.world`                    —— 场景自己画（转场时也拿得到）。
     * 没声明 world 的段引擎不碰底，行为与以前完全一致（老任务不受影响）。
     */
    this.worldPass = spec.worldPass ?? null;
    /**
     * **解析好的**共享背景 Pass（而不是 task 给的那个函数）。
     *
     * 为什么在这里解析一次：`task.world` 是个 `(ctx) => Pass` 的工厂，`ctx` 里的
     * `gl` / `P` 在 `load()` 时就已经就绪，而 Pass 的构造（以及它的程序缓存 key）
     * 每帧重建一次既浪费又容易和「场景自己 setup 里建一次」的行为不一致。
     * 引擎级 world 的语义就是「全片同一张」，所以解析一次、全片复用。
     */
    this.world = null;

    const { LineBatch } = await import('./gl.js');
    this.lines = new LineBatch(this.gl, 60000);

    // --only a,b：只加载指定的段。用来快速迭代单段，也用来隔离别人写坏的场景。
    //
    // ⚠ 语义（踩过）：`--only` 会**把选中的段平移到时间轴开头**，
    //   所以 `still <任务> -t 1 --only chart` 里的 `-t 1` 指"chart 段内第 1 秒"。
    //   以前这里只做过滤、保留全局时间，于是 `--only` 之后你几乎总是取到段外（全黑），
    //   而且日志里还会顺带报一堆"空档"。
    const only = spec.only ? String(spec.only).split(',').map((s) => s.trim()).filter(Boolean) : null;
    this.only = only;
    if (only) {
      const known = new Set(this.timeline.map((i) => i.id));
      const missing = only.filter((id) => !known.has(id));
      if (missing.length) {
        this.errors.push(
          `--only 里这些段不存在: ${missing.join(', ')}。现有段: ${[...known].join(', ')}`,
        );
      }
      this.timeline = this.timeline.filter((i) => only.includes(i.id));
      if (!this.timeline.length) {
        throw new Error(`--only ${only.join(',')} 没有匹配到任何段，时间线是空的`);
      }
      // 平移到 0 起点：段的相对先后与重叠保持不变
      const shift = Math.min(...this.timeline.map((i) => i.start));
      for (const it of this.timeline) { it.start -= shift; it.end -= shift; }
      this.timeline.sort((a, b) => a.start - b.start);
      this.onlyDuration = Math.max(...this.timeline.map((i) => i.end));
      // 导出/预览都用这个时长；整片时长仍可从 task.duration 查到
      this.fullDuration = this.duration;
      this.duration = this.onlyDuration;
    }

    // 懒加载并按需 setup。每段场景分到自己的 Canvas2D 图层。
    for (const item of this.timeline) {
      try {
        item._layer = new Layer2D(this.gl);
        let scene = item.scene;
        if (typeof scene === 'function') scene = await scene();
        if (scene?.default) scene = scene.default;
        if (typeof scene === 'function') scene = new scene();
        item._scene = scene;
        if (scene?.setup) await scene.setup(this._ctxFor(item, 0, 1));
      } catch (err) {
        this.errors.push(`[${item.id}] setup 失败: ${fmtErr(err)}`);
      }
    }
    // 共享背景解析一次（见 this.world 的注释）。setup 之后再解析：
    // 那时 palette、lines、图层都已就绪，工厂里想用 ctx 的任何东西都拿得到。
    if (this.worldPass) {
      try {
        const ctx0 = this._ctxFor({ id: '__world', start: 0, end: 1, params: {} }, 0, 0, {});
        this.world = typeof this.worldPass === 'function' ? this.worldPass(ctx0) : this.worldPass;
      } catch (err) {
        // 不静默：共享背景建不出来意味着每一段都会黑底，必须立刻说出来
        this.worldError = fmtErr(err);
        this.errors.push(`[共享背景] 创建失败: ${this.worldError}`);
      }
    } else {
      this.worldError = `(spec.worldPass 是 ${spec.worldPass === null ? 'null' : typeof spec.worldPass}，task.world 没有传到引擎)`;
    }
    // 风格包的字体栈要**在所有图层建好之后**注入（每段场景各有一个 TextKit 实例）
    this.applyStyleFonts();
    return this;
  }

  /**
   * 把风格包里**与图层有关**的两样东西注入每一个 Canvas2D 图层（HUD / 字幕 / 每段自己的图层）：
   *
   *   ① **字体栈**：模板与场景里写的都是逻辑名（`family: 'sans'`），真正的字体栈在
   *      `TextKit.families` 上。换风格时"全片连标题带字幕一起换字体"只改这一处映射 ——
   *      11 个镜头模板一行都不用动。
   *   ② **设计 token**（`src/style/tokens.js`）：`type.write('…', x, y, { size: 'hero' })`
   *      里的语义字号要按这套风格取值（noir 的 hero 与 print 的不是一个数）。
   *      `null` = 没有风格包 ⇒ 回落到 `TOKENS`，老任务一个像素都不变。
   *
   * ⚠ 一段的图层可能在 `load()` 之后才建（`--only`、懒加载），所以 HUD 与字幕层
   * 每次都要重刷；`import` 进来的老任务没写 `style.fonts` 时字体那一路是空操作。
   */
  applyStyleFonts() {
    const fonts = this.style?.fonts;
    const tokens = this.style?.tokens ?? null;
    const layers = [this.hud2d, this.cap2d, ...this.timeline.map((it) => it._layer)];
    for (const layer of layers) {
      const text = layer?.type;
      if (!text) continue;
      if (fonts && Object.keys(fonts).length) text.setFamilies?.(fonts);
      text.setTokens?.(tokens);
    }
    return this;
  }

  /**
   * 风格栅格（**已经是实际分辨率下的版本**）：`load()` 里 `fitStyleToFrame()` 按画幅
   * 换过栅格与字号阶梯 —— 横屏原样、竖屏换成 1080×1920 那一套再按短边缩放。
   * 所以这里不再二次缩放（以前按 `H/1080` 缩放，竖屏会得到 ×1.777 的页边距）。
   */
  _scaledGrid() {
    return this.style?.grid ?? null;
  }

  /** 检查时间线本身的问题（重叠顺序、空档、越界）。 */
  validate() {
    const problems = [];
    const items = this.timeline;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!(it.end > it.start)) problems.push(`[${it.id}] end(${it.end}) 必须大于 start(${it.start})`);
      if (!it._scene) problems.push(`[${it.id}] 场景没加载成功`);
      if (i > 0 && it.start < items[i - 1].start) problems.push(`[${it.id}] 起点比上一段还早`);
      if (it.end - it.start < 1 / this.fps) problems.push(`[${it.id}] 只有 ${(it.end - it.start).toFixed(3)}s，不到一帧`);
    }
    const cover = [];
    let cursor = 0;
    for (const it of items) {
      if (it.start > cursor + 1e-6) cover.push(`${cursor.toFixed(2)}–${it.start.toFixed(2)}s 没有场景（会渲染成黑）`);
      cursor = Math.max(cursor, it.end);
    }
    return { problems, gaps: cover };
  }

  /* ------------------------------------------------------------ 帧上下文 */

  _ctxFor(item, t, idx, extras = {}) {
    const f = {
      t,
      dt: extras.dt ?? 1 / this.fps,
      lt: t - item.start,
      p: U.sat((t - item.start) / Math.max(1e-6, item.end - item.start)),
      start: item.start,
      end: item.end,
      fps: this.fps,
      idx,
      seed: frameSeed(idx),
      beat: 0, bar: 0, beatPhase: 0,
      preview: extras.preview ?? false,
      seeked: false,
      tin: extras.tin ?? 1,
      tout: extras.tout ?? 0,
      under: extras.under ?? null,
      a: this.music.at ? this.music.at(t) : {},
      params: item.params ?? {},
      /** 口播查询接口（`docs/NARRATION.md` A 档）：`f.narration.at(t)` / `.current(t)` … */
      narration: this.narration,
    };
    const beat = this.music.beatAt ? this.music.beatAt(t) : t * 2;
    f.beat = beat; f.bar = beat / 4;
    f.beatPhase = beat - Math.floor(beat);

    const ctx = {
      f, gl: this.gl, out: extras.out, under: f.under,
      comp: this.comp, P: this.P,
      // 这一段自己的 2D 图层与排版工具（画文字/图形都用它，别用 engine.text）
      text: item._layer ?? this.hud2d, type: (item._layer ?? this.hud2d).type,
      lines: this.lines, music: this.music, lyrics: this.lyrics,
      narration: this.narration,
      /**
       * 运行期警告通道（同一个数组实例）：kit 元件发现"文字压进字幕带"、
       * "说明条写成了句子"这类问题时 push 到这里，`check` 会打印出来。
       * 用 `ctx.warnings.push(...)` 而不是 `console.warn` —— 前者每帧都发生也不会刷屏。
       */
      warnings: this.warnings,
      /**
       * 此刻该显示的那句旁白 + 字幕保留带（`docs/CAPTIONS.md`）。
       * `active(t)` / `band` / `style` —— 场景用它来**避让**（字幕带是引擎保留区）。
       * 没开字幕时是一个安全空实现，所以场景可以无条件写 `ctx.captions?.band`。
       */
      captions: this.captions ?? {
        active: () => null, lines: [], style: null,
        band: { x0: 0, x1: this.gl.w, y0: this.gl.h - 94, y1: this.gl.h - 26 },
      },
      /** 风格包（见 `src/style/index.js`）：`palette` / `grid` / `post` / `captions` / `motif` */
      style: this.style,
      /** 风格栅格（已按分辨率缩放）：kit 元件与场景排版用它，别再自己写 120 / 964 这类魔数 */
      grid: this._scaledGrid(),
      /**
       * **主体声明**（版面守门，见 docs/LAYOUT.md）：这一段观众该看哪里。
       * 来源两处，**时间线上的那份优先**（同一支片子里某一段想换主体时不必改场景）：
       *   · 场景对象上的 `focus`（`export default { id, focus: 'center', render } `）；
       *   · 时间线段上的 `focus`（`cut(shot, { focus: { x, y, w, h } })`）。
       * 归一成绝对矩形是判据的事（`src/layout.js` 的 `resolveFocus()`），这里只做搬运。
       * 没声明就是 `null` —— 判据因此说"没判"，不会说"通过"。
       */
      focus: item.focus ?? item._scene?.focus ?? null,
      params: f.params, W: this.gl.w, H: this.gl.h,
      start: item.start, end: item.end, item,
      util: U, rng: U.rng,
      /** 便捷：把整帧清成一个颜色 */
      clear: (c = [0, 0, 0]) => this.gl.clear(extras.out, c),
    };
    return ctx;
  }

  /* ------------------------------------------------------------ 合成 */

  /** 把 t 时刻所有在播的段合成到一张 HDR 纹理上。返回 {tex, post}。 */
  composite(t, idx, subDt, seeked = false, opts = {}) {
    const skipScene = !!opts.skipScene;
    const items = this.timeline.filter((i) => t >= i.start && t < i.end);
    let under = null;
    let outTex = null;
    let post = { ...DEFAULT_POST };
    /**
     * 风格包的后处理**基线**（`docs/STYLE.md`）。
     *
     * 合并顺序是 `DEFAULT_POST → item.post → 场景 return 的 post → style.post`，
     * 也就是风格的这几项**最后生效**。为什么让它盖过模板：风格里的 bloom/grain/vignette
     * 描述的是**介质**（"这是纸、这是磷光屏"），不是某个镜头的设计 ——
     * 浅底风格（`paper`）如果不把 bloom 压下来，整片会糊成一片白。
     * 反过来，`print`（默认风格）的 `post` 是空对象，所以老任务一个像素都不变。
     */
    const stylePost = this.style?.post ?? null;

    for (let k = 0; k < items.length; k++) {
      const item = items[k];
      const rt = this.pool[k % this.pool.length];
      const prev = items[k - 1], next = items[k + 1];
      const tin = prev ? U.sat((t - item.start) / Math.max(1e-3, prev.end - item.start)) : 1;
      const tout = next ? U.sat((t - next.start) / Math.max(1e-3, item.end - next.start)) : 0;
      // `_scene` 有值就说明已经过了 setup（这一步在 composite 里做，因为 ctx 每帧都在变）
      const layer = item._layer;
      const scene = item._scene;
      if (!scene) {
        // 场景没加载成功（setup 抛异常，见 load()）——同样必须是"一眼看出崩了"，不是暗红整帧
        this.gl.clear(rt, [0.12, 0, 0]);
        this._errorCard(rt, item, item.id, t, idx, `场景没有加载成功（setup 失败或 --only 选错了段）`);
        // `_errorCard` 里已经 upload 过图层，所以这里可以安全地提交（见下面的长注释）
        if (layer?._uploaded) this.comp.draw(this.gl, layer, rt, { premult: false });
        if (this.gl.paint) this.gl.paint.markError = true;
        under = rt; outTex = rt;
        continue;
      }

      // 场景必须整帧覆盖 out；先清一遍兜底（场景忘了画就是纯黑，肉眼可见地错）
      this.gl.clear(rt, [0, 0, 0]);
      const ctx = this._ctxFor(item, t, idx, { out: rt, dt: subDt, tin, tout, under: k > 0 ? under : null, seeked });
      // 共享背景（一等地基，见 load() 的注释）：声明了 world 的段由引擎先铺底，
      // 场景只管前景。'auto' = task.worldPass；对象 = 这一段专用；false = 本段自己负责。
      ctx.world = resolveWorld(this, item);
      // `skipScene` 只给 `check` 的背景守门用（worldAudit）：只跑背景、不跑场景，
      // 这样「这一段到底铺了底没有」是可测的，而不是靠作者记得调用。
      if (skipScene) {
        this.gl.beginPaint(rt, layer);
        if (ctx.world && item.world !== false) {
          try { ctx.world.render(this.gl, rt, t, subDt); } catch { /* 记在下面统一处理 */ }
        }
        item._lastPaint = this.gl.paint;
        this.gl.paint = null;
        under = rt;
        continue;
      }
      if (ctx.world && item.world !== false) {
        try {
          ctx.world.render(this.gl, rt, t, subDt);
        } catch (err) {
          this.errors.push(`[${item.id}] 共享背景渲染出错: ${fmtErr(err)}`);
        }
      }
      // 绘制记账：这一段到底往画面里画了东西没有（"什么都没画"以前抓不到）。
      // 同时记**文字入口**（layer = 这一段自己的 2D 图层）：版面守门要用它数"一屏几块字"，
      // 而引擎自己的字幕层/HUD 层画在别的图层上，天然不算进这一段（见 src/layout.js）。
      this.gl.beginPaint(rt, layer);
      // 场景级变换（§3.5）：让「一道前景」整体平移/缩放/旋转 —— 一台摄影机、视差、反向落位都靠它。
      // 每段各自持有一个对象，每帧先归零；场景必须显式调用 ctx.setXform(...) 才算数。
      ctx.xform = item._xform ?? (item._xform = { x: 0, y: 0, scale: 1, rot: 0, anchor: null, p: 0, q: 0, on: false, edge: 'clamp' });
      ctx.xform.on = false;
      ctx.xform.edge = 'clamp';
      ctx.setXform = (o = {}) => {
        const x = ctx.xform;
        x.x = o.x ?? 0; x.y = o.y ?? 0;
        x.scale = o.scale ?? 1; x.rot = o.rot ?? 0;
        x.anchor = o.anchor ?? null;
        // p/q：透视（keystone）系数，见 xformForward 的注释。
        // 用 cam.js 的 camXform(cam, ...) 算，或者自己按 project() 的 k 反算。
        x.p = o.p ?? 0; x.q = o.q ?? 0;
        // clamp：画面外采样夹到边缘（"整个画面被推走"的运镜，推荐）
        // black：画面外采到黑（视差：背景不动、只有前景在动时用，否则会把背景色拉出条纹）
        x.edge = o.edge === 'black' ? 'black' : 'clamp';
        x.on = true;
        return x;
      };
      let drewErrorCard = false;
      try {
        const ov = scene.render(ctx);
        if (ov && typeof ov === 'object') post = { ...post, ...(item.post ?? {}), ...ov, ...stylePost };
        else if (item.post) post = { ...post, ...item.post, ...stylePost };
        // 工作台的实时覆盖：**最后**合并 —— 滑块一拖就变，不用重载页面也不用重渲整片。
        // 只有 dev 预览会设它；导出路径永远不设，所以成片一个像素都不受影响。
        if (this.livePost) post = { ...post, ...this.livePost };
      } catch (err) {
        /**
         * 场景抛错 = **硬错误**，绝不能画一帧意思不明的纯色糊过去
         * （`docs/history/IMPROVEMENTS-1-3.md` P0-3）。
         *
         * 旧行为有多贵：beast 的 outro 里 `const slot = ctx.params?.slot` 遮蔽了
         * `_kit.js` 的 `slot()` 画格子函数 → TypeError。引擎 catch 住，把整帧涂成
         * **暗红 (0.15,0,0)**，文字图形全无，而 `check` 三处采样全绿、控制台一个字都没有
         * —— 我是靠抽帧看到"121.2s 之后整屏暗红"才发现的。
         *
         * 现在两件事一起做：
         *   ① 记进 `renderErrors`（带段名/帧号/栈），CLI 的 check/video 会拿它**非零退出**；
         *   ② 画一张**一眼能看出来是崩了**的错帧卡片（不是"某个奇怪的底色"）。
         */
        const msg = fmtErr(err);
        this.renderErrors.push({
          id: item.id, t, idx, message: msg,
          stack: err && err.stack ? String(err.stack) : '',
        });
        this.errors.push(`[${item.id}] t=${t.toFixed(3)} 渲染出错: ${msg}`);
        // ⚠ 后处理参数必须**回到默认**：错帧卡片不能继承上一段/上一帧的调色、暗角、泛光，
        //   否则"亮红框 + 暗红底"会被压成一片灰暗红，一眼看不出是崩了（实测边框被暗角
        //   从 (242,41,41) 压到 (106,22,22)，等于把"明显的错"变成"奇怪的底色"）。
        post = { ...DEFAULT_POST, ...stylePost };
        this._errorCard(rt, item, item.id, t, idx, msg);
        drewErrorCard = true;
        if (this.gl.paint) this.gl.paint.markError = true;
      }
      // 把这一段的 Canvas2D 图层（场景的文字/图形）"提交"进 rt。
      //
      // ⚠⚠ 只有当这一帧**真的往图层里画过东西**时才能调 `comp.draw`：图层纹理是
      //   第一次 `upload()` 才 `texImage2D(SRGB8_ALPHA8)` 分配出来的，没分配过的图层
      //   采样出来是**未定义的**；某些驱动/格式组合下会把整个 rect 写成 0，
      //   于是"场景只 clear 了一个颜色、一个字都没写"的那种段整帧变黑
      //   （诊断过程见 docs/history/IMPROVEMENTS-1-3.md P0-3 的"顺带发现"：
      //    `probe` / `ribbon` 两个纯 clear 的标定段在 check 里读数是 0.000，
      //    而 `xf`/`xa`/`xb`（都写了字）正常 —— 差别就在这）。
      //   判据用 `layer._uploaded`：场景调用 `text.upload()` 会把它置 true，
      //   而老的、正确的工作方式（场景自己调 `comp.draw(gl, text, out)`）也是先 upload，
      //   所以这个判据与历史行为完全一致 —— 只是额外把错帧卡片的图层也提交进去。
      if (layer && (layer._uploaded || drewErrorCard)) {
        this.comp.draw(this.gl, layer, rt, { premult: false });
      }
      // 记下这一段的绘制情况，给 `check` 的背景守门用（worldAudit）
      item._lastPaint = this.gl.paint;
      this.gl.paint = null;

      // 变换整张前景（含它自己的文字图层）——用一张外部目标做，绝不「读自己写自己」
      if (ctx.xform.on && !isIdentityXform(ctx.xform)) {
        assertXform(ctx.xform, item.id, t, this.errors);
        // ⚠ 这是引擎内部的搬运，不是"这一段画了东西"：记账先摘掉（否则会污染 worldAudit）
        const keepPaint = this.gl.paint;
        this.gl.paint = null;   // beginPaint 的记账在这条路上同样要摘掉
        const xp = this._xformPass();
        xp.u.m.value = xformMatrix(this.gl, ctx.xform);
        xp.u.src.value = { tex: rt.tex, __tex: true };
        xp.u.edge.value = ctx.xform.edge === 'black' ? 1 : 0;
        xp.render(this.gl, this.xformRT, t, subDt);
        this.gl.paint = keepPaint;
        outTex = this.xformRT;
      } else {
        outTex = rt;
      }

      /**
       * 交叠期怎么处理「上一段那一帧」。
       *
       * **2026-10-24 起默认改成「甩走」**（`transitionPass`），不再交叉溶解。
       *
       * 为什么要改：交叉溶解把**两张完整的图**叠在一起 —— 文字量大的画面里两屏字互相
       * 透过去，观众看到的是"糊成一片"，而不是"镜头切过去了"。`trans.js` 的配方注释里
       * 早就写着「文字量大的画面不要用交叉溶解」（NekoHome 那支 48 秒片子上验证过），
       * 但它一直是**要作者自己记得写** `handlesTransition: true` 才生效 ——
       * 忘了写就静默退回交叉溶解。这条与「漏了 openFrame 就纯黑」是同一类毛病：
       * 默认行为不该是最差的那个。
       *
       * 现在的默认：上一段沿**摄影机方向加速甩出去**（带方向拖尾、在前半程就把透明度
       * 收到 0，所以不会两屏字长时间叠着）。作者仍然可以：
       *   · `handlesTransition: true` → 完全自己做（`makeTransitionKit` 那套）；
       *   · 想要老的溶解 → 段上写 `transition: 'mix'`（`cut()` 或配置档节点的 `transition`）。
       *
       * 换句话说：**旧行为从"默认"降级成"显式选项"，新行为成为默认。**
       */
      // 优先级：段对象（`cut` 的 opts / 配置档节点）> 场景对象（`export default { transition }`）
      // 模式名写错**当场抛**（`resolveTransitionMode`）—— 静默回落成甩镜等于"我要的擦除没出现"，
      // 而画面照样出、check 照样绿（与"参数名拼错要抛"同一条纪律）。
      const transMode = resolveTransitionMode(
        item.transition ?? item._scene?.transition,
        `段 "${item.id}" 的 transition`,
      );
      if (k > 0 && !scene.handlesTransition && under) {
        if (transMode === 'mix') {
          this.comp.mixTo(this.gl, under, outTex, tin, this.mixRT);
          outTex = this.mixRT;
        } else if (transMode !== 'none') {
          outTex = this._pushTransition(outTex, under, tin, t, subDt, transMode);
        }
      }
      under = outTex;
    }
    if (!outTex) { this.gl.clear(this.pool[0], [0, 0, 0]); outTex = this.pool[0]; }
    // 整片介质（`style.view`）。默认 off —— 风格包没写 `view` 时这条路一行都不执行，
    // 一个像素都不变。位置在「所有段合成完」之后：多段交叠 / 甩镜转场也要一起被印上，
    // 否则切点两侧一边是网点一边是原图。
    // ⚠ `skipScene`（背景守门）时不跑：守门要量的是背景本身，不是它被印成什么介质。
    const styleView = this.style?.view;
    if (styleView && !skipScene && outTex) {
      if (!this._viewSlot) this._viewSlot = { rt: null, pass: null };
      try {
        outTex = applyStyleView({
          gl: this.gl, out: outTex, P: this.P, comp: this.comp,
          f: { t, dt: subDt }, _views: this._viewSlot,
        }, styleView);
      } catch (err) {
        this.errors.push(`[style.view] ${fmtErr(err)}`);
      }
    }

    return { tex: outTex, post, t };
  }

  /**
   * 错帧卡片：场景抛异常时画的东西。
   *
   * 设计目标只有一个 —— **任何人（包括只看缩略图的 agent）一眼就知道"这不是画面，这是崩了"**。
   * 旧的「整帧暗红」做不到这一点：它在缩略图里像一层"刻意的暗红底"，于是被发现得很晚。
   *
   *   · 底：暗红（不是纯黑，也不会被误认成"漏画背景"那个纯黑坑）
   *   · 红框：贴着画面边缘的一圈厚红边（相对亮度 ≈ 0.42，暗红底只有 0.19，差一倍多，
   *     缩略图里也看得见）
   *   · 文字：段名 / 帧号 / 时刻 / 异常首行 —— 让人不用翻日志就知道是哪一段
   *
   * ⚠ 走**这一段的 Canvas2D 图层**（`item._layer`），不是 HUD 层：HUD 只在预览里画，
   *   而错帧卡片恰恰只有在**没有人看着屏幕**的离屏渲染里才重要。
   *   `composite()` 在场景 render 之后会 `comp.draw(layer, rt)`，所以这里只准备图层内容；别的
   *   调用方（worldAudit 之类）拿到的是"底色 + 红框"这一层保底，也够用。
   */
  _errorCard(rt, item, id, t, idx, message) {
    const gl = this.gl;
    gl.clear(rt, [0.16, 0.010, 0.010]);
    const layer = item?._layer;
    if (!layer) return;
    try {
      const c = layer.ctx;
      const W = gl.w, H = gl.h;
      // 图层自己的变换得复位：场景可能中途 throw，留下了一个没 restore 的状态
      c.setTransform(layer.scale, 0, 0, layer.scale, 0, 0);
      c.restore();                       // 把场景留下的栈清干净
      c.save();
      c.globalAlpha = 1;
      c.clearRect(0, 0, W, H);
      const bh = Math.max(14, Math.round(H * 0.035));
      c.fillStyle = 'rgb(242, 41, 41)';
      c.fillRect(0, 0, W, bh);
      c.fillRect(0, H - bh, W, bh);
      c.fillRect(0, 0, bh, H);
      c.fillRect(W - bh, 0, bh, H);
      c.fillStyle = 'rgba(0,0,0,0.62)';
      const bandH = Math.max(120, Math.round(H * 0.20));
      c.fillRect(0, (H - bandH) / 2, W, bandH);
      const size = Math.max(18, Math.round(H * 0.042));
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.fillStyle = 'rgb(255, 96, 82)';
      c.font = `700 ${size}px "IBM Plex Mono", Consolas, monospace`;
      c.fillText('✗ SCENE ERROR', W / 2, H * 0.5 - size * 0.65);
      c.fillStyle = 'rgba(255,255,255,0.94)';
      c.font = `500 ${Math.round(size * 0.52)}px "IBM Plex Mono", Consolas, monospace`;
      c.fillText(`${id}   frame ${idx}   t=${t.toFixed(3)}s`, W / 2, H * 0.5 + size * 0.25);
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.font = `400 ${Math.round(size * 0.44)}px "IBM Plex Mono", Consolas, monospace`;
      c.fillText(String(message).split('\n')[0].slice(0, 140), W / 2, H * 0.5 + size * 1.1);
      c.textAlign = 'start';
      c.restore();
      layer.upload();
    } catch { /* 连错帧卡片都画不出来时，至少底色和红框已经在 rt 里了 */ }
  }

  /* ------------------------------------------------------------ 渲染一帧 */

  /**
   * 渲染时刻 t 的一帧。
   * @param {number} t
   * @param {{ samples?: number|'auto', shutter?: number, tol?: number, toScreen?: boolean, preview?: boolean,
   *           seeked?: boolean, skipScene?: boolean, scanNf?: boolean }} [opts]
   *   `scanNf: true` = 顺便扫这一帧的**浮点** RT 有没有 NaN / ±Inf（出片路径用，见 `_scanFrameNonFinite`）；
   *   结果落在 `this.lastNonFinite`。默认 false：这条路径**不进每帧的渲染**。
   * @returns {{ samples: number, errors: number[] }}
   */
  render(t, opts = {}) {
    const gl = this.gl;
    // 抖动的默认态是"不抖"：单子帧路径（草稿 / 预览 / 探针）拿到的必须是**没抖过的**那一帧，
    // 否则同一时刻渲两次会因为上一次遗留的偏移而不同（这类"跨帧依赖"最难查）。
    gl.jitter[0] = NO_JITTER[0];
    gl.jitter[1] = NO_JITTER[1];
    const idx = Math.floor(t * this.fps + 1e-6);
    const shutter = opts.shutter ?? 0.5;
    const preview = opts.preview ?? false;
    let wanted = opts.samples ?? (preview ? 1 : 'auto');
    let n = 1;
    let post = { ...DEFAULT_POST };
    let outTex = null;
    const scanNf = !!opts.scanNf;
    this.lastNonFinite = null;
    this.errors.length && (this.errors = this.errors.slice(-40));

    if (wanted === 1) {
      const r = this.composite(t, idx, 1 / this.fps, opts.seeked, { skipScene: opts.skipScene });
      outTex = r.tex; post = r.post;
      // 单子帧这条路拿到的就是 t 这一帧本身，与 `check` 的 `probeNonFinite(t)` 判据完全一致
      if (scanNf) this._scanFrameNonFinite(t, idx, r.tex, 1, t);
      this.lastSamples = 1;
      this.lastErrors = [];
      // 单子帧这条路**没有**做自适应判定：把上一帧的结论清掉，别让调用方读到过期的原因
      this.lastSampleReason = null;
      this.lastSampleErr = NaN;
      this.lastMaxSamples = null;
      this.lastCappedBy = [];
    } else {
      const tol = opts.tol ?? DEFAULT_TOL;
      const adaptive = wanted === 'auto';
      // 自适应采样要求每个子帧都能独立渲染（乱序、任意个数），所以有状态场景直接被拒绝
      const active0 = this.timeline.filter((i) => t >= i.start && t < i.end);
      for (const it of active0) {
        const sc = it._scene;
        if (sc && (sc.stateful || sc.integrates)) {
          throw new Error(`[${it.id}] 声明了 stateful/integrates，无法做运动模糊采样。` +
            `把状态改成「由 t 直接求值」（例如粒子位置 = f(出生时间)），或对该段用 { samples: 1 }。`);
        }
      }
      /**
       * 这一帧允许的上限：引擎顶档 → 逐段 `maxSamples` 取最小 → **收到合法档位**。
       *
       * 收档位这一步以前是 `Math.max(BASE_SAMPLES, min(...))`，于是 `maxSamples: 36` 会被
       * 当成"能跑到 36"—— 而子帧序列只有 8/24/72/216 四种密度（`ternaryOffsets` 是嵌套的），
       * 36 实际上只会跑 24，**而且没人知道**。现在由 `snapMaxSamples()` 明确收档，
       * 作者写 36 得到的仍是 24，但它会出现在 `check` 的提示里（见 scripts/anim.mjs）。
       */
      let maxSamples = adaptive ? MAX_SAMPLES : /** @type {number} */ (wanted);
      for (const it of active0) if (it.maxSamples) maxSamples = Math.min(maxSamples, it.maxSamples);
      maxSamples = adaptive ? snapMaxSamples(maxSamples) : Math.max(BASE_SAMPLES, maxSamples);
      /** 这一段是**谁**把上限压下来的（`maxSamples` 报错时要知道改哪一行） */
      const cappedBy = adaptive
        ? active0.filter((it) => it.maxSamples && it.maxSamples < MAX_SAMPLES).map((it) => it.id)
        : [];

      const levels = adaptive ? levelsFor(maxSamples) : 0;
      const offsets = adaptive ? ternaryOffsets(levels) : fixedOffsets(/** @type {number} */ (wanted));
      /**
       * 抖动只在"子帧数是抖动周期整数倍"时开。
       *
       * 为什么：`JITTER_GRID` 的 4 个位置均值是 0，但**只取前 k 个**时均值不是 0 ——
       * `samples: 2` 的平均偏移是 -0.125px，整帧内容会被平移零点几个像素（1080p 上看得出，
       * 而且只在多子帧路径上出现，单帧预览一切正常）。
       * 自适应档位是 8·3^L（8/24/72/216），全部是 4 的倍数 ⇒ 不受影响；
       * 定长档（`--samples 2` / `6` 这类）不是 4 的倍数时干脆不抖 —— 少一次超采样，
       * 好过画面莫名平移。
       */
      const jitterOn = adaptive || offsets.length % JITTER_PERIOD === 0;
      const step = (1 / this.fps) * shutter;
      const acc = this._accumPass();

      this.gl.clear(this.sumRT, [0, 0, 0], 0);
      this.lastErrors = [];
      this._nearest = Infinity;
      let done = 0;

      /**
       * 渲染 offsets[from..to) 并累加（加性混合）到 target。
       *
       * ## 子像素抖动（2026-10-31）：这才是"多子帧 AA"真正生效的地方
       *
       * 在这之前，静止画面的 8 个子帧是**同一时刻、同一位置**渲染 8 次 ⇒ 平均 = 同一张图，
       * 多子帧只贡献运动模糊。引擎注释里那句"逐像素 SDF + 多子帧"实现上只兑现了前半句。
       *
       * 现在每个子帧按 `jitterOffset(i)` 把**整帧**平移一个亚像素位置再栅格化，累加后就是
       * **4× 超采样**：填充面的 2px 台阶、shader 背景的高频纹样、raymarch 的硬边都一次性变干净，
       * 而**渲染时间一分不多**（这些子帧本来就要渲）。
       *
       * 两条纪律（都与 `src/core/sampling.js` 的 `JITTER_GRID` 绑在一起）：
       *   · 周期 4 = 第一级判据"前半 4 帧 vs 后半 4 帧"的粒度 —— 两半抖动序列逐位相同，
       *     静止画面才仍然判得出"静止"（否则一路加到 216 子帧，实测会慢 27 倍）；
       *   · 偏移在 `composite()` 之前设、之后立刻归零 —— 累加 pass / 后处理**绝不能**吃到抖动
       *     （它们是重采样已有图像，再抖一次就是把画面又平移一次）。
       */
      const addSamples = (from, to, target) => {
        for (let i = from; i < to; i++) {
          const subT = Math.max(0, t + step * offsets[i]);
          const j = jitterOn ? jitterOffset(i) : NO_JITTER;
          this.gl.jitter[0] = j[0];
          this.gl.jitter[1] = j[1];
          let r;
          try {
            r = this.composite(subT, idx, step, opts.seeked && i === 0);
          } finally {
            this.gl.jitter[0] = NO_JITTER[0];
            this.gl.jitter[1] = NO_JITTER[1];
          }
          // 非有限值扫描只扫**第一个子帧**：池里的 RT 下一步就会被后面的子帧覆盖，
          // 而累加 pass 会把 NaN/Inf 丢掉（`bad ? vec3(0.0) : c`）—— 只有这里还看得见它们。
          if (scanNf && i === 0) this._scanFrameNonFinite(t, idx, r.tex, 0, subT);
          acc.u.src.value = { tex: r.tex.tex ?? r.tex, __tex: true };
          acc.render(this.gl, target, subT, 1 / this.fps);
          const d = Math.abs(offsets[i] - 0.125);
          if (d < this._nearest - 1e-9) { this._nearest = d; post = r.post; }
        }
      };

      if (adaptive) {
        /**
         * 第一级：8 个等距子帧，但**分成两半**各累一半 —— 这样在还没"上一级"可比的时候，
         * 就有一个合法的判据：**快门窗口前半段与后半段长得一样吗？**
         *
         * 这一条是这一轮最重要的行为改动。"画面主体静止"的片子（图表、方波、格阵）以前
         * 每一帧都被迫跑 24 个子帧 —— 因为旧代码在 8 个子帧之后**无条件**进入下一级，
         * 而判据又永远读 0、于是 24 之后立刻"收敛"。作者实测 0.9 fps，唯一的办法是
         * 逐段写 `maxSamples: 8`（`docs/HANDOFF-spectrum-friction.md` §1）。
         * 现在静止帧在**第一级**就判停：8 子帧，比原来快 3 倍，而画面**一个像素都不差**
         * （静止画面求 N 次平均 = 同一张图）。
         *
         * 为什么"两半比较"是合法的：两半覆盖快门窗口的两个半边，静止 ⇒ 逐像素相同（差 0）；
         * 有运动 ⇒ 两半必然不同，差异量就是"这一帧要不要模糊"。它比"8 对 16"更保守一点
         * （有运动就一定超阈值 ⇒ 继续加到 24），这正是我们要的方向：**宁可多一档，不要漏拖影**。
         */
        const half = BASE_SAMPLES >> 1;
        /**
         * ⚠ `newRT` 是**加性**累加的目标，必须先清零（2026-10-25 修）。
         *
         * 下面这条 `addSamples` 是加法混合（`acc.blendFn = 'add'`），而 `newRT` 在两帧之间
         * 不会自己变干净 —— 以前它只在 `while` 循环里（新一级开始前）被清过，**第一级从来没清**。
         * 于是第 N 次自适应渲染的"前半段"= 本次 4 个子帧 + 上一帧留下的残影：
         *   · 残影亮 ⇒ 整帧越渲越亮（demo 的 `check` 报「多子帧比单帧亮 1.98×」正是它）；
         *   · 残影暗 ⇒ 整帧偏暗。
         * 这类"同一帧渲两次不一样"的错误在静止画面上最刺眼，而它不报错。
         */
        this.gl.clear(this.newRT, [0, 0, 0], 0);
        addSamples(0, half, this.newRT);
        addSamples(half, BASE_SAMPLES, this.sumRT);
        done = BASE_SAMPLES;
        this._groupA = half;
        this._groupB = half;
        /** @type {{ err: number, prevErr?: number }[]} */
        const hist = [];
        let verdict;
        if (done >= maxSamples) {
          // `maxSamples: 8`（作者的提速旋钮）：一级到底，不用量
          verdict = { stop: true, reason: /** @type {string} */ ('cap'), err: NaN };
        } else {
          const err0 = this._sampleError(half, half);
          hist.push({ err: err0 });
          this.lastErrors.push(err0);
          verdict = samplingVerdict(hist, { tol, maxSamples, samples: done });
          // 第一级的"停"只有一个合法解释：两半一致 = 这一帧是静止的
          if (verdict.stop && verdict.reason === 'tol') verdict = { ...verdict, reason: 'static' };
        }
        /**
         * ⚠ **前半段必须并进总和 —— 包括「一级到底」那条捷径**（2026-10-25 修）。
         *
         * 第一级把 8 个子帧拆成两半：前半先在 `newRT` 里（为了算"两半一致吗"），
         * 后半直接进 `sumRT`。合并这一行以前写在 `else` 分支里，于是
         * **`maxSamples: 8` 的段永远不合并**：`sumRT` 只有后半 4 个子帧，而下面的除数
         * 仍是 `done = 8` ⇒ `avgRT = 4 帧之和 / 8` = 一半的光。
         *
         * 症状是在**显示空间**上暗 0.73×（线性 0.5 → sRGB ≈ 0.73），而不是"看不出来"：
         * `check` 报「单子帧与多子帧亮度差了 0.73×」，而 `maxSamples: 8` 正是 HANDOFF
         * 里那个"提速旋钮"（spectrum 全片都写着它）⇒ **凡是给段写了 maxSamples: 8 的片子，
         * 成片都比预览暗 27%**。搬运：`docs/HANDOFF-spectrum-friction.md` §1 的绕法用了它。
         *
         * 除数与累加数必须始终一致，这是 `copyOver(1/n)` 那条注释的同一条纪律。
         */
        acc.u.src.value = { tex: this.newRT.tex, __tex: true };
        acc.render(this.gl, this.sumRT, t, 1 / this.fps);
        this._groupA = BASE_SAMPLES;
        this._groupB = BASE_SAMPLES;
        while (!verdict.stop && done < maxSamples) {
          const from = done, to = Math.min(maxSamples, done * 3);
          this.gl.clear(this.newRT, [0, 0, 0], 0);
          addSamples(from, to, this.newRT);
          // 误差：**新一组**（offsets[done..to)）与**已有总和**（offsets[0..done)）在显示空间里的
          // 高分位差异。两者的均值权重分别是 1/(to-from) 与 1/done —— 见 _sampleError。
          const err = this._sampleError(done, to - from);
          hist.push({ err, prevErr: hist.length ? hist[hist.length - 1].err : undefined });
          this.lastErrors.push(err);
          // 把新样本并进总累加
          acc.u.src.value = { tex: this.newRT.tex, __tex: true };
          acc.render(this.gl, this.sumRT, t, 1 / this.fps);
          done = to;
          this._groupA = done;
          this._groupB = to - from;
          verdict = samplingVerdict(hist, { tol, maxSamples, samples: done });
        }
        this.lastSampleReason = verdict.reason;
        this.lastSampleErr = verdict.err;
        this.lastMaxSamples = maxSamples;
        this.lastCappedBy = cappedBy;
      } else {
        addSamples(0, /** @type {number} */ (wanted), this.sumRT);
        done = /** @type {number} */ (wanted);
      }

      n = done;
      // 求平均：sumRT / n -> avgRT
      // ⚠ avgRT 必须先清空：copyOver 走的是 alpha 混合（compositor_copy 写的是
      //   vec4(rgb, opacity)），目标不清零就变成 avg ← sum/n + avg·(1-1/n) 的反馈积分，
      //   稳态正好是平均值的 n 倍——子帧一多整帧就过曝（这个 bug 让所有开了运动模糊的
      //   渲染都比单帧亮 n 倍，出片直接白掉）。
      this.gl.clear(this.avgRT, [0, 0, 0], 0);
      this.comp.copyOver(this.gl, this.sumRT, this.avgRT, 1 / n);
      outTex = this.avgRT;
      this.lastSamples = n;
    }

    // HUD / 信息层：在场景之后、后处理之前叠上去（这样 HUD 的高光也能参与泛光）
    this._hudOut = null;
    if (this.hud && !preview) this._drawHud(t, idx, outTex);

    // 后处理 -> outRT（线性）。屏幕那条路在下一行 blitPass 里编码成 sRGB；
    // 导出那条路在 readPixels(outRT,'srgb') 里编码。两条路必须都编码，否则预览与成片不一致。
    this.lastBeat = this.music.beatAt ? this.music.beatAt(t) : 0;
    if (this.dumpStages) this._dumpStages(outTex, post);
    // 拖动快路径（opts.skipPost）：拖 scrub 时只关心构图，泛光/颗粒/色差/暗角这一整套先跳过。
    // 松手后（或按「精确帧」）仍走完整链路 —— 所以这条路径不会掩盖「预览好看、导出翻车」。
    if (opts.skipPost) {
      this.lastPost = post;
      if (this.captions) this._drawCaptions(t);
      if (opts.toScreen !== false) {
        gl.blitPass.u.src.value = { tex: outTex.tex, __tex: true };
        gl.blitPass.render(gl, null, t, 1 / this.fps);
      }
      this.lastT = t;
      return { samples: n, errors: this.lastErrors, skippedPost: true };
    }
    // 第 6 参 t：胶片磨损（post.weave/flicker/scratch）的动画时间源 —— t 的纯函数，可 seek。
    // 其余 post 全程不用它，磨损全 0 时逐像素与旧版一致。
    this.post.render(gl, this._hudOut ?? outTex, this.outRT, post, frameSeed(idx), t);
    this.lastPost = post;
    // 字幕：**后处理之后**叠上去（信息层，见 _drawCaptions 的注释）
    if (this.captions) this._drawCaptions(t);
    if (opts.toScreen !== false) {
      gl.blitPass.u.src.value = { tex: this.outRT.tex, __tex: true };
      gl.blitPass.render(gl, null, t, 1 / this.fps);
    }
    this.lastT = t;
    return { samples: n, errors: this.lastErrors };
  }

  /**
   * 场景级变换用的全屏 Pass：把整帧按 3×3 矩阵重采样（trans.js 的 xformMatrix 算好）。
   * 越界处采样会夹到边缘，所以背景色会被"拉丝"。想避免就把变换控制在画面内，
   * 或者让场景多画一圈余量（推荐：余量按 scale/位移量算）。
   */
  /**
   * 交叠期的**甩镜**转场：把上一段那一帧沿摄影机方向加速推出去，本段从反方向压进来。
   *
   * 与交叉溶解的区别（这是它取代溶解成为默认的原因）：溶解是「两张图叠在一起」，
   * 文字量大的画面里两屏字互相透过去 ⇒ 观众看到"糊"；甩镜是「镜头没停，画面被带走了」
   * ⇒ 同一时刻只有一屏字是清楚的。透明度在前半程就收到 0，所以不会长时间双影。
   *
   * 实现上只需要**一次全屏合成**：
   *   1. 先把本段的帧拷进 `mixRT`（`blitBack` 不读自己写自己，安全）；
   *   2. 再把 `under`（上一段）用 `transitionPass` 以 `blend: true` **叠上去** ——
   *      shader 里位置随 k 加速外移、带方向拖尾、alpha 随 k 收到 0。
   *
   * ⚠ `blitBack` 与 `transitionPass` 都是引擎内部的搬运：记账（`gl.paint`）要摘掉，
   *   否则「这一段到底画了东西没有」会被这次拷贝污染（与 `_snapshot` 同一条理由）。
   *
   * @param {any} outTex 本段已经画好的帧
   * @param {any} under 上一段的帧
   * @param {number} k 入场进度（0→1）
   * @param {number} t 整片时间
   * @param {number} dt 子帧步长
   * @returns {any} 合成后的帧（仍是 `mixRT`）
   */
  _pushTransition(outTex, under, k, t, dt, mode = 'push') {
    const gl = this.gl;
    const keepPaint = gl.paint;
    gl.paint = null;
    try {
      this.comp.blitBack(gl, outTex, this.mixRT);
      // 每种模式一支 Pass（`'push'` 的那支与从前逐字符相同）；按模式缓存，
      // 别每帧新建 —— Pass 编译一次就要几十毫秒，转场每帧都跑。
      this._transPasses ??= new Map();
      let pass = this._transPasses.get(mode);
      if (!pass) {
        pass = transitionPass(gl, { mode, key: mode === 'push' ? 'engine_push' : `engine_trans_${mode}` });
        this._transPasses.set(mode, pass);
      }
      const u = pass.u;
      u.under.value = { tex: /** @type {any} */ (under).tex ?? under, __tex: true };
      u.k.value = U.sat(k);
      u.dir.value = cameraDir(t, dt);
      pass.render(gl, this.mixRT, t, dt);
    } finally {
      gl.paint = keepPaint;
    }
    return this.mixRT;
  }

  _xformPass() {
    if (!this._xform) {
      this._xform = new Pass(this.gl, /* glsl */ `
        uniform sampler2D src;
        uniform mat3 m;
        uniform float edge;   // 0 = 画面外夹到边缘（默认）；1 = 画面外采样为黑
        void main() {
          vec3 q = m * vec3(vUv, 1.0);
          vec2 uv = q.xy;
          if (edge > 0.5) {
            // 视差用：背景不动、只有前景在动时，空旷处要给黑/透明，不能把背景色拉成条纹
            if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
              fragColor = vec4(0.0, 0.0, 0.0, 1.0);
              return;
            }
          }
          fragColor = vec4(texture(src, clamp(uv, vec2(0.0), vec2(1.0))).rgb, 1.0);
        }`, { src: { value: null }, m: [1, 0, 0, 0, 1, 0, 0, 0, 1], edge: 0 }, { key: 'engine_xform', blend: false, jitter: false });
    }
    return this._xform;
  }

  /**
   * 子帧累加用的 Pass：把自己加进目标（加性混合），并把非有限像素丢掉——
   * 几百个子帧里只要有一个 NaN，均值就会被污染成一片亮斑。
   */
  _accumPass() {
    if (!this._accum) {
      this._accum = new Pass(this.gl, /* glsl */ `
        uniform sampler2D src;
        void main() {
          vec3 c = texture(src, vUv).rgb;
          bool bad = any(isnan(c)) || any(greaterThan(abs(c), vec3(5e4)));
          fragColor = vec4(bad ? vec3(0.0) : c, 0.0);
        }`, { src: { value: null } }, { key: 'engine_accum', blend: false, jitter: false });
      // 纯加法：src*1 + dst*1（alpha 不动）
      const m = this._accum.prog;
      this._accum.blend = true;
      this._accum.blendFn = 'add';
    }
    return this._accum;
  }

  /**
   * 采样误差：把「已累的子帧均值」和「这一级新加的子帧均值」投到显示空间比较，
   * 取**高分位**（默认 99%）而不是最大值/平均值 —— 理由写在 `src/core/sampling.js` 头部。
   *
   * ## 三个曾经同时错在这里的地方（2026-10-25 修）
   *
   * ① **读数永远为 0**：`errRT` 原来是默认的 RGBA16F，却用 `readPixels(RGBA, UNSIGNED_BYTE)`
   *    读 —— WebGL2 对这种组合抛 `INVALID_OPERATION`，缓冲原样不动（全 0），于是误差恒为 0、
   *    每帧都在第一级"收敛"。现在 `errRT` 是 8bit（见构造函数），shader 里量化到 0..255。
   * ② **权重算错**：旧代码把"新一组"的权重写成 `(to-from)*2`（`_groupB`），而那个 RT 里只有
   *    `to-from` 个样本的**和**，均值权重应当是 `1/(to-from)`。差一个 2 倍 → 读数整体偏小一半。
   *    现在两个权重都由调用方按真实样本数传进来。
   * ③ **HDR 没有上限**：`pow(26.25, 1/2.2)` 这种输入是允许的，于是**泛光源**（线性值 5~30）
   *    与普通像素的差异会把误差顶到天上 —— 而泛光是后处理做的、本来就与子帧无关。
   *    现在两边都先夹到 0..1（显示空间的上界），再比较。
   * ④ **判据是最大值**：8160 个格子里只要有一格抖 1 级就会把读数顶到 1/255（看不见）。
   *    现在是**直方图 + 99 分位**（`src/core/sampling.js` 的 `quantileFromHist`），
   *    单个坏格子再也决定不了整帧要不要 216 个子帧。
   *
   * @param {number} nA 已有总和（`sumRT`）里累的**样本数**
   * @param {number} nB 新一组（`newRT`）里的**样本数**
   * @returns {number} 0..1（显示空间 0..255 除以 255），高分位
   */
  _sampleError(nA, nB) {
    const gl = this.gl;
    if (!this._errPass) {
      /**
       * 每个格子取 **4×4 = 16 个采样点的最大值**，而不是只采格心一个点。
       *
       * 为什么必须这样：这个目标是 1/16 分辨率（120×68 格，每格盖 16×16 像素），而"细线
       * 甩过去"恰恰只占几像素宽 —— 只采格心的话，一条 2px 的移动竖线在多数帧里
       * **一个格子都碰不到**，误差读 0、判定"收敛"（实测：`_calib` 的 ribbon 段与 216 子帧
       * 的真值差 13 级，而格心采样读到 0）。4×4 个点、间距 4px，配上 bilinear 采样自带的
       * ~1px footprint，合起来覆盖整格。
       */
      this._errPass = new Pass(gl, /* glsl */ `
        uniform sampler2D a; uniform sampler2D b;
        uniform float wA; uniform float wB;
        uniform vec2 texel;      // 源图一个像素的 uv 尺寸（= 1/帧尺寸）
        uniform float cellPx;    // 一格盖多少像素（16）
        float errAt(vec2 uv) {
          // 夹到 0..1：这是**显示空间**的比较，HDR 的 26 与 5 在观众眼里都是"白"。
          vec3 A = clamp(texture(a, uv).rgb * wA, 0.0, 1.0);
          vec3 B = clamp(texture(b, uv).rgb * wB, 0.0, 1.0);
          A = pow(A, vec3(1.0 / 2.2));
          B = pow(B, vec3(1.0 / 2.2));
          return max(abs(A.r - B.r), max(abs(A.g - B.g), abs(A.b - B.b)));
        }
        void main() {
          float e = 0.0;
          for (int j = 0; j < 4; j++) {
            for (int i = 0; i < 4; i++) {
              vec2 off = ((vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5) * cellPx;
              e = max(e, errAt(vUv + off * texel));
            }
          }
          // 写 0..1（**不是** 0..255）：目标是 RGBA8，颜色会被夹到 [0,1] 再量化成 8bit ——
          // 写成 255.0 会被夹成 1.0，读回来恒是 255（那正是这个 bug 的第二副面孔）。
          fragColor = vec4(vec3(e), 1.0);
        }`, { a: { value: null }, b: { value: null }, wA: 1, wB: 1, texel: [1, 1], cellPx: 16 }, { key: 'engine_err', blend: false });
    }
    this._errPass.u.a.value = { tex: this.sumRT.tex, __tex: true };
    this._errPass.u.b.value = { tex: this.newRT.tex, __tex: true };
    // sumRT 里累的是 offsets[0..done)，newRT 里是这一级新加的 (done..to) 个。
    // 权重就是**均值权重 = 1 / 样本数**（漏掉它读的就是"和"而不是"均值"：
    // 子帧一多，"和"必然更大，误差会凭空涨上去 —— 旧代码的 `(to-from)*2` 是另一个方向的错）。
    this._errPass.u.wA.value = 1 / Math.max(1, Number(nA) || this._groupA);
    this._errPass.u.wB.value = 1 / Math.max(1, Number(nB) || this._groupB);
    this._errPass.u.texel.value = [1 / this.gl.pw, 1 / this.gl.ph];
    this._errPass.u.cellPx.value = this.gl.pw / this.errRT.w;
    this._errPass.render(gl, this.errRT, 0, 1 / this.fps);
    const g = gl.ctx;
    this.errRT.bind();
    g.readPixels(0, 0, this.errRT.w, this.errRT.h, g.RGBA, g.UNSIGNED_BYTE, this.errBuf);
    // 直方图 → 高分位（浏览器里跑 256 桶的累计，8160 个格子，代价可忽略）
    const hist = this._errHist ?? (this._errHist = new Uint32Array(256));
    hist.fill(0);
    for (let i = 0; i < this.errBuf.length; i += 4) hist[this.errBuf[i]]++;
    return quantileFromHist(hist) / 255;
  }

  /* ------------------------------------------------------------ HUD */

  /**
   * 字幕层：把"此刻该显示的那句旁白"画到 `outRT` 上（**后处理之后**）。
   *
   * 两件刻意做的事：
   *   ① **不吃后处理**。字幕是信息层，让它过泛光/颗粒/色差会把字糊掉
   *      （引擎自己的经验规则是"骨白正文永远不要 bloom"），可读性优先于质感统一。
   *   ② **没画东西就不 upload**。Canvas2D 图层的纹理是第一次 `upload()` 才分配的，
   *      没画过就调 `comp.draw`，采样出来是未定义的（见 composite 里那段警告）。
   */
  _drawCaptions(t) {
    const layer = this.cap2d;
    if (!layer || !this.captions) return null;
    // ⚠ 必须走 layer.clear()，不能只 clearRect：upload() 有一条"同一帧内只传一次"的
    // 短路（`if (this._uploaded) return this`），而 `_uploaded` **只有 clear() / fill() 会重置**。
    // 直接画在 ctx 上而不重置它 ⇒ 第一帧上传之后再也不会更新，整片字幕永远是第一句
    // （2026-10-18 一支开 captions 的成片实测：多帧连渲时 t=130 / t=175 都显示 t=6 的那句）。
    layer.clear();
    const c = layer.ctx;
    c.save();
    c.setTransform(layer.scale, 0, 0, layer.scale, 0, 0);
    let line = null;
    try {
      line = this.captions.draw(layer, t);
    } catch (err) {
      // 字幕画挂了不该让整帧崩（它是附加层）：记进 errors，check 会报出来
      this.errors.push(`[字幕] t=${t.toFixed(3)} 出错: ${fmtErr(err)}`);
    }
    c.restore();
    if (!line) return null;
    layer.upload();
    this.comp.draw(this.gl, layer, this.outRT, { premult: false });
    return line;
  }

  /**
   * HUD 画在一张独立的 HDR 目标上（先拷贝场景成帧再叠字），
   * 这样不会污染池子里的场景目标（转场时还要用）。
   */
  _drawHud(t, idx, sceneTex) {
    const gl = this.gl;
    const layer = this.hud2d;
    const c = layer.ctx;
    const { W, H } = gl;
    c.save();
    c.setTransform(layer.scale, 0, 0, layer.scale, 0, 0);
    c.clearRect(0, 0, W, H);
    const pad = 30;
    const lines = [
      `${U.timecode(t, this.fps)}   frame ${idx}   t=${t.toFixed(2)}s`,
      `${this._activeId(t)}   beat ${(this.lastBeat ?? 0).toFixed(2)}   bar ${((this.lastBeat ?? 0) / 4).toFixed(2)}`,
      `samples ${this.lastSamples}${this.lastErrors.length ? '   err ' + this.lastErrors.map((e) => (e * 255).toFixed(1)).join(' / ') : ''}`,
    ];
    c.font = '400 17px "IBM Plex Mono", Consolas, monospace';
    c.fillStyle = 'rgba(238,233,223,0.42)';
    lines.forEach((s, i) => c.fillText(s, pad, H - pad - (lines.length - 1 - i) * 22));
    if (this.hudInfo.title) {
      c.font = '600 17px "IBM Plex Mono", Consolas, monospace';
      c.fillStyle = 'rgba(255,77,18,0.85)';
      c.fillText(this.hudInfo.title, pad, pad + 2);
    }
    // 交互提示只给预览看，不进成片
    if (this.hudInfo.hint) {
      c.font = '400 15px "IBM Plex Mono", Consolas, monospace';
      c.fillStyle = 'rgba(238,233,223,0.3)';
      c.fillText(this.hudInfo.hint, pad, H - pad - lines.length * 22 - 8);
    }
    c.restore();

    layer.upload();
    this.hudRT = this.hudRT ?? new RT(gl, gl.pw, gl.ph);
    this.comp.copyOver(gl, sceneTex, this.hudRT, 1);
    this.comp.draw(gl, layer, this.hudRT, { premult: false });
    this._hudOut = this.hudRT;
    return this.hudRT;
  }

  _activeId(t) {
    const it = this.timeline.find((i) => t >= i.start && t < i.end);
    return it ? `${it.id} +${(t - it.start).toFixed(2)}s` : '—';
  }

  /* ------------------------------------------------------------ 调试 */

  /** 把某张目标转成 PNG dataURL（人肉排查用）。 */
  dumpRT(rt, label = '') {
    const gl = this.gl;
    const buf = gl.readPixels(rt);
    const cv = document.createElement('canvas');
    cv.width = rt.w; cv.height = rt.h;
    const c = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    const img = c.createImageData(rt.w, rt.h);
    const row = rt.w * 4;
    for (let y = 0; y < rt.h; y++) {
      const src = (rt.h - 1 - y) * row;
      img.data.set(buf.subarray(src, src + row), y * row);
    }
    c.putImageData(img, 0, 0);
    return { label, png: cv.toDataURL('image/png') };
  }

  /** 打开后，每次 render 都会记录各阶段的图像（很慢，只在排查时用）。 */
  _dumpStages(sceneTex, post) {
    const h = /** @type {any} */ (globalThis);
    h.__stages = h.__stages ?? [];
    if (h.__stages.length > 40) return;
    h.__stages.push({
      t: this.lastT,
      scene: this.dumpRT(sceneTex, 'scene').png,
      layer: this.text.canvas.toDataURL('image/png'),
      bloom: { bloom: post.bloom, threshold: post.bloomThreshold },
    });
  }

  /* ------------------------------------------------------------ 输出 */

  /**
   * 读回当前帧，**已做 linear→sRGB 编码**（RGBA8，自下而上）。
   *
   * 这是导出/存图/推流给 ffmpeg 的唯一正确入口：整条渲染链都在线性光里跑，
   * 画布那条路由 `gl.blitPass` 的 shader 编码，而 readPixels 读的是编码前的值。
   * 少了这一步，导出的 PNG / mp4 会比浏览器预览暗一大截、暗部糊死
   * （实拍：线性 0.5 若不编码导出成 128，正确是 188）。见 docs/ENGINE.md §2.3。
   *
   * ⚠ 返回的是**复用缓冲**：下一次读回会覆盖它。要留存请 `new Uint8Array(buf)`
   * 或传 `{ copy: true }`。为什么这么设计见 `gl.js` 的 `readPixels`（1080p 每帧
   * 省 ~190ms：分配 33MB Float32Array 是这条路径上最大的开销）。
   * @param {{ copy?: boolean }} [opts]
   */
  readPixels(opts) { return this.gl.readPixels(this.outRT, 'srgb', opts); }

  /** 读回**线性**原始值（0..255 表示线性 0..1）。只给排查用，不要拿它存图。 */
  readLinearPixels(opts) { return this.gl.readPixels(this.outRT, 'none', opts); }

  /**
   * 读回当前帧，编码成 **NV12**（BT.709 limited range，4:2:0）—— 出片推流走这条。
   *
   * 与 `readPixels()` 的关系：数学上等价，都是"线性光 → sRGB → 交付格式"，区别只在于
   * 交付格式是 RGBA（8.3MB/帧）还是 YUV420（3.11MB/帧），后者省掉 62% 的传输量。
   * 成片本来就是 yuv420p，所以这不是新增一次色度损失（详见 `gl.js` 的 `readNV12`）。
   *
   * ⚠ 同样返回**复用缓冲**（下一次调用会覆盖）。
   * @returns {Uint8Array} NV12，行序自下而上
   */
  readNV12() { return this.gl.readNV12(this.outRT); }

  /**
   * 扫一张**浮点**渲染目标里的非有限值（NaN / ±Inf）与"量级爆掉"的像素。
   *
   * 为什么需要它（`docs/history/STATUS-rounds-1-6.md` §13.4）：场景 shader 一旦写出 NaN 或 Inf，引擎里
   * **没有任何一步会报错**，而两种非有限值在显示上**完全一样**——都是"整屏白 + 暗角"
   * （实测 `nan` 与 `inf` 两张 PNG 逐字节相同）。更绕的是它还会随采样数变脸：
   * `samples: 1` 直通后处理 → 整屏白；多子帧走 `_accumPass()`，那一层会把非有限值
   * **丢掉**（`bad ? vec3(0.0) : c`）→ 同一段在成片里反而发黑。于是"单帧白、成片黑"
   * 会被 `check` 报成"运动模糊累加有问题"，指向完全错误的方向。
   *
   * 直接读浮点缓冲就没有这些歧义：NaN / Inf 分别数出来，还给出第一个坏像素的屏幕位置。
   * 代价是整屏 4 通道回读（1080p ≈ 8 MB），所以**只给诊断用**，不进每帧的渲染路径。
   *
   * @param {any} rt 浮点渲染目标（`composite()` 返回的 `tex`）
   * @param {{ huge?: number }} [opts] `huge` = 量级阈值（默认 5e4，与 `_accumPass` 一致）
   */
  scanNonFinite(rt, opts = {}) {
    const hugeAt = opts.huge ?? 5e4;
    const out = {
      w: 0, h: 0, pixels: 0, nan: 0, inf: 0, huge: 0, hugeMax: 0, bad: 0,
      first: /** @type {null|{x:number,y:number,r:number,g:number,b:number,kind:string}} */ (null),
    };
    if (!rt || rt.float === false) return out;   // 8bit 目标存不下 NaN，无需扫
    const g = this.gl.ctx;
    const n = rt.w * rt.h * 4;
    if (!this._scanBuf || this._scanBuf.length < n) this._scanBuf = new Float32Array(n);
    const buf = this._scanBuf;
    g.bindFramebuffer(g.FRAMEBUFFER, rt.fbo);
    g.readPixels(0, 0, rt.w, rt.h, g.RGBA, g.FLOAT, buf);
    out.w = rt.w; out.h = rt.h; out.pixels = rt.w * rt.h;
    for (let p = 0; p < out.pixels; p++) {
      const i = p * 4;
      let kind = '';
      for (let k = 0; k < 3; k++) {
        const v = buf[i + k];
        if (Number.isNaN(v)) { out.nan++; kind = kind || 'NaN'; }
        else if (!Number.isFinite(v)) { out.inf++; kind = kind || (v > 0 ? '+Inf' : '-Inf'); }
        else if (Math.abs(v) > hugeAt) { out.huge++; kind = kind || `量级 ${Math.abs(v).toExponential(1)}`; if (Math.abs(v) > out.hugeMax) out.hugeMax = Math.abs(v); }
      }
      if (kind) {
        out.bad++;
        if (!out.first) {
          out.first = {
            x: p % rt.w, y: rt.h - 1 - Math.floor(p / rt.w),
            r: buf[i], g: buf[i + 1], b: buf[i + 2], kind,
          };
        }
      }
    }
    return out;
  }

  /**
   * 扫**这一帧刚刚合成出来**的那张浮点 RT（出片路径用，`docs/BACKLOG.md` 1-4）。
   *
   * 与 `probeNonFinite(t)` 的唯一区别是**不额外渲一帧**：直接读当前帧的合成结果。
   * 代价因此只剩「整屏 4 通道浮点回读 + 一次 JS 扫描」—— 1080p 约 8 MB 回读，
   * 不重跑场景。出片时由 `render(t, { scanNf: true })` 每 N 帧调一次。
   *
   * ⚠ **多子帧时扫的是第一个子帧**（`offsets[0]` 那一张），不是恰好 t 的那一张：
   *   合成用的池化 RT 会被下一个子帧当场覆盖，所以只能在它刚渲出来时读（`sub` 记 0）。
   *   单子帧时 `sub` = 1、`subT` === t，与 `check` 的判据（在 t 处渲一个子帧）完全一致。
   *   `subT` 会一起报出去：**段名按 `subT` 取**，否则紧挨切点的那一帧会被标成下一段
   *   （`t` 落在新段、而扫到的那张图还是旧段的 —— 实测踩过：Inf 段被标成 NaN）。
   *   判据本身与 `check` 共用 `scanNonFinite()`：NaN / ±Inf / 量级>5e4 分开数，给出首个坏像素。
   *
   * @param {number} t @param {number} idx @param {any} rt @param {number} sub @param {number} subT
   */
  _scanFrameNonFinite(t, idx, rt, sub, subT) {
    // 只有浮点 RT 存得下 NaN/Inf；`composite()` 理论上总是还 RT 对象，这里仍然守一道
    if (!rt || !rt.fbo) return null;
    const scan = this.scanNonFinite(rt);
    const ids = this.timeline.filter((i) => subT >= i.start && subT < i.end).map((i) => i.id);
    this.lastNonFinite = { t, subT, idx, sub, id: ids[0] ?? null, ids, ...scan };
    return this.lastNonFinite;
  }

  /**
   * 在 t 时刻**渲染一个子帧**并扫它的非有限值（`check` 用它把"整屏白"变成一句点名的话）。
   * 刻意只渲一个子帧：多子帧路径会把非有限值丢掉（见 `scanNonFinite` 的注释）。
   * @param {number} t
   */
  probeNonFinite(t) {
    const idx = Math.floor(t * this.fps + 1e-6);
    const r = this.composite(t, idx, 1 / this.fps);
    const scan = this.scanNonFinite(r.tex);
    return { t, id: this._activeId(t), ...scan };
  }

  /** 释放资源。 */
  dispose() {
    this.lines?.dispose?.();
    this.hud2d.dispose();
    // 字幕层是独立的图层，别漏了释放（它只在 captions 打开时才建）
    this.cap2d?.dispose();
    for (const it of this.timeline) {
      it._layer?.dispose();
      it._scene?.dispose?.();
    }
    this.post.dispose();
    for (const rt of this.pool) rt.dispose();
    this.mixRT.dispose(); this.avgRT.dispose(); this.sumRT.dispose();
    this.newRT.dispose(); this.errRT.dispose(); this.outRT.dispose();
    this.xformRT.dispose();
    this.hudRT?.dispose();
    this.comp.sink?.dispose();
    this.comp.alt?.dispose();
    this.gl.dispose();
  }
}

/* ------------------------------------------------------------------ 采样序列 */

/**
 * 逻辑空间里「点 → 点的正向变换」，列主序 9 元素。
 *
 * 三条入口，优先级从高到低：
 *
 *   ① **`xf.proj`（推荐做透视时用）**：直接给一个完整的 3×3 射影矩阵（列主序 9 元素）。
 *      这是唯一**不需要任何参数化技巧**的路子 —— 想要什么透视就写什么矩阵，
 *      不用去凑 `scale`/`rot`/`p`/`q` 那几个参数能不能表示出来。
 *      `src/core/cam.js` 的 `camXform()` 走的就是这条路。
 *   ② `xf.p`/`xf.q`：keystone 系数，按 `x' = A(x,y) / (1 + p·x + q·y)` 压过去，
 *      参照点是画面中心（`A` 是绕 anchor 旋转缩放 + 平移）。
 *   ③ 什么都不给：纯相似变换（原来那套，行为一字未改）。
 *
 * ⚠ 为什么要有 ①：②那种参数化**表达不了"带旋转的透视"**（分母的梯度方向和仿射里
 *   内容自身的朝向被绑在一起了），硬凑会在偏心/旋转/缩放的机位上整体错位。
 *   我在这里连续错过五次，每次都不崩溃、只是"画面偏了一点" —— 所以现在宁可多一条
 *   直给矩阵的路。一致性由 `tools/test-cam-math.mjs` 的
 *   「camXform 与 project(k) 逐像素一致」（8 组机位 × 5 个世界点）钉住。
 *
 * @param {number} W 逻辑宽
 * @param {number} H 逻辑高
 * @param {{x?:number,y?:number,scale?:number,rot?:number,anchor?:number[]|null,p?:number,q?:number,proj?:number[]}} xf
 * @returns {number[]} 列主序 9 元素
 */
export function xformForward(W, H, xf) {
  if (Array.isArray(xf.proj) && xf.proj.length === 9) {
    // 完整射影矩阵：只做一次归一化（让第 3 行第 3 列 = 1），其余原样
    const m = xf.proj.map(Number);
    const w = m[8];
    if (Number.isFinite(w) && Math.abs(w) > 1e-12) for (let i = 0; i < 9; i++) m[i] /= w;
    return m;
  }
  const anchor = Array.isArray(xf.anchor) ? xf.anchor : [W / 2, H / 2];
  const [ax, ay] = anchor;
  const c = Math.cos(xf.rot ?? 0), s = Math.sin(xf.rot ?? 0);
  const k = xf.scale ?? 1;
  const a = k * c, b = k * s, cc = -k * s, d = k * c;
  const tx = ax - (a * ax + cc * ay) + (xf.x ?? 0);
  const ty = ay - (b * ax + d * ay) + (xf.y ?? 0);
  const p = xf.p ?? 0, q = xf.q ?? 0;
  // 第 3 行（齐次分量）：分母 `1 + p·x + q·y`，但**以参照点为基准** —— 射影除法在参照点
  // （默认画面中心）处必须等于 1：`1 + p·pr.x + q·pr.y = 1` 要求常数项是
  // `1 − p·pr.x − q·pr.y`。漏掉那个 `1` 会让整层被一个固定比例缩掉（同样不报错）。
  return [
    a, b, 0,
    cc, d, 0,
    tx, ty, 1 - p * (W / 2) - q * (H / 2),
  ];
}
/**
 * 场景级变换 → uv 空间（0..1，y 向上）的采样矩阵，喂给 shader 的 `mat3 m`。
 *
 * shader 要回答的是「输出像素 (u,v) 应该采源图哪里」，也就是**正向变换的逆**。
 * 场景给的是**逻辑像素、y 向下**的直觉参数（x/y 位移、scale、rot 弧度、anchor 锚点），
 * 而 shader 里是 uv、y 向上 —— 先换基（F = 逻辑 → uv），再在 uv 空间求逆：
 *
 *   M_fwd_uv = F · M_logical_fwd · F⁻¹        M_uv = M_fwd_uv⁻¹
 *
 * ⚠ 换基之后正向变换里与 y 有关的项会变号（y 方向反了），所以这里**必须**求逆，
 *   不能直接把 M_logical_fwd 当成采样矩阵用 —— 那会得到反向的位移与缩放（踩过）。
 *
 * @param {import('./gl.js').GL} gl
 * @param {{x:number,y:number,scale:number,rot:number,anchor:number[]|null}} xf
 * @returns {number[]} 列主序 9 元素（直接喂 mat3 uniform）
 */
export function xformMatrix(gl, xf) {
  const W = gl.w, H = gl.h;
  const m = xformForward(W, H, xf);          // 逻辑空间正向
  // 换基到 uv：u = x/W, v = 1 - y/H
  const F = [
    [1 / W, 0, 0],
    [0, -1 / H, 1],
    [0, 0, 1],
  ];
  const Finv = [
    [W, 0, 0],
    [0, -H, H],
    [0, 0, 1],
  ];
  const m3 = [
    [m[0], m[3], m[6]],
    [m[1], m[4], m[7]],
    [m[2], m[5], m[8]],
  ];
  const fwd = mm3(mm3(F, m3), Finv);
  const inv = invert3(fwd);
  // 转回列主序
  return [inv[0][0], inv[1][0], inv[2][0], inv[0][1], inv[1][1], inv[2][1], inv[0][2], inv[1][2], inv[2][2]];
}

/** 3×3（行主序二维数组）相乘 */
function mm3(a, b) {
  const o = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    o[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  }
  return o;
}

/** 3×3 求逆（行主序）。奇异时退回单位阵（宁可不动，不要产出 NaN 整帧）。 */
function invert3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

function isIdentityXform(x) {
  return x.x === 0 && x.y === 0 && x.scale === 1 && (x.rot ?? 0) === 0 && (x.p ?? 0) === 0 && (x.q ?? 0) === 0;
}

/**
 * 解析一段的共享背景：
 *   `'auto'`        → 用 task.config 里 `export const world` 的那张（load 时已解析好、全片复用）
 *   传对象           → 这一段专用，直接用
 *   传工厂函数       → 这一段专用，现建一个
 *   `false` / 不写   → 引擎不碰底（场景自己负责 / 或者就是纯黑）
 */
function resolveWorld(engine, item) {
  const w = item.world;
  if (w === false || w == null) return null;
  if (w === 'auto') return engine.world ?? null;
  if (typeof w === 'function') return w(engine._ctxFor(item, 0, 0, {}));
  return w;
}

/** 变换参数写错时点名报错，而不是让画面静默变成黑/拉伸。 */
function assertXform(x, id, t, errors) {
  const bad = [];
  if (!Number.isFinite(x.x) || !Number.isFinite(x.y)) bad.push('x/y');
  if (!Number.isFinite(x.scale) || x.scale <= 0) bad.push('scale 必须是 > 0 的有限数');
  if (x.rot != null && !Number.isFinite(x.rot)) bad.push('rot');
  if (x.p != null && !Number.isFinite(x.p)) bad.push('p（透视系数）');
  if (x.q != null && !Number.isFinite(x.q)) bad.push('q（透视系数）');
  if (x.anchor && (x.anchor.length < 2 || !Number.isFinite(x.anchor[0]) || !Number.isFinite(x.anchor[1]))) bad.push('anchor 必须是 [x, y]');
  if (!bad.length) return;
  const msg = `[${id}] setXform 参数不合法：${bad.join('、')}（t=${t.toFixed(2)}）`;
  if (!errors.includes(msg)) errors.push(msg);
}

/*
 * 子帧偏移的两种排法（`fixedOffsets` / `ternaryOffsets`）搬去了 `src/core/sampling.js` ——
 * 它们与"什么时候停"的判据是同一件事的两半，分开放的话判据永远测不到（那个模块是纯函数，
 * 有离线回归 `tools/test-sampling.mjs`）。
 */

function fmtErr(e) {
  const s = e && e.stack ? e.stack : String(e);
  return s.split('\n').slice(0, 3).join(' | ');
}
