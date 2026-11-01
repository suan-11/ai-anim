// @ts-check
/**
 * 后处理链。顺序是固定的，也是让画面「像片子而不像 demo」的关键：
 *
 *   场景 HDR ──▶ 亮部提取 ──▶ bloom 金字塔（4 级）  ┐
 *                    └─────▶ halation（偏红、更宽） ├─▶ 合成 ──▶ sRGB
 *   HUD/字幕层（线性）─┘                            ┘
 *
 * 合成阶段一次性做完：软肩压缩、曝光、色差、暗角、胶片颗粒、抖动。
 *
 * 经验值：只有「信号色」（信号橙、火花、被唱到的词）才允许超过 0.85 线性亮度去发光。
 * 骨白正文永远不要 bloom，否则像糊了一层油。
 */

import { Pass, RT } from './gl.js';

/** @typedef {import('./gl.js').GL} GL */

/**
 * @typedef {Object} PostParams
 * @property {number} exposure     曝光倍率（1 = 不变）
 * @property {number} shoulder     软肩起点：超过它的亮部被压回来（0.8 比较胶片）
 * @property {number} bloom        泛光强度
 * @property {number} bloomThreshold 进入泛光的亮度阈值（对 HDR 值）
 * @property {number} bloomRadius  泛光扩散半径倍率
 * @property {number} halation     光晕（偏红、更宽、只对极亮处）
 * @property {number} ca           色差（RGB 分离；whip pan / 冲击时用）
 * @property {number} grain        胶片颗粒
 * @property {number} vignette     暗角
 * @property {number} saturation   饱和度（1 = 不变）
 * @property {number} contrast     对比（围绕中灰）
 * @property {number} lift         黑位抬升（做褪色/雾感）
 * @property {number[]} tint       整体染色（线性 RGB 乘子）
 * @property {number} invert       反相（0/1，闪白用）
 * @property {number[]} shake      画面位移（**物理像素**，y 向下为正 —— ⚠ 与 `center` 的单位不同）
 *                                 shader 里是 `uv += shake / outSize`，而 `outSize = [gl.pw, gl.ph]`
 *                                 是**物理**分辨率，所以 `--scale 2`（4K）下同样数值的视觉位移只有
 *                                 1080p 的一半。要跨分辨率一致就自己乘 `scale`。
 *                                 （`docs/ENGINE.md` §5 的 post 表里写的就是这条；曾经这里的
 *                                 JSDoc 误写成"逻辑像素"，与实现矛盾 —— 见 docs/history/IMPROVEMENTS-1-3.md 建议 D。）
 * @property {number} zoom         画面缩放（1 = 不变，>1 推近）
 * @property {number} flash        整帧加白（0..1）
 * @property {number} fade         整帧变黑（0..1）
 * @property {number} blur         全屏模糊（冲击用）
 * @property {number} radialBlur   径向模糊强度（向画面中心收缩）
 * @property {number[]} center     zoom / 径向模糊 / 色差的锚点，**逻辑像素、y 向下**（默认画面中心）。
 *                                 想做「绕某个元素推近」就把它设成那个元素的坐标。
 * @property {'off'|'agx'|'aces'} [tonemap] 高光滚降算子（默认 `'off'` = 只用下面的 `shoulder` 软肩）。
 *                                 `'agx'` 是 AgX（高光柔和滚降、亮霓虹不偏色，当前业界电影级默认）；
 *                                 `'aces'` 是 Narkowicz 的 ACES 拟合（更饱和、对比更硬）。
 *                                 ⚠ 开了之后 `shoulder` 不再生效（两者是同一位置的两种做法），
 *                                 而且**会改变画面** —— 老任务要么不写，要么就得重存 `hashes` 基线。
 * @property {'rpdf'|'tpdf'|'off'} [dither] 输出前的 8bit 抖动（默认 `'rpdf'` = 矩形分布，引擎一直以来的行为）。
 *                                 `'tpdf'` 是三角分布（两个均匀分布相加），去色带更干净、噪声感更弱。
 * @property {boolean} [bloomKaris] 泛光的亮部提取用 **Karis 加权平均**（`c/(1+luma(c))` 之后再还原）：
 *                                 极亮的单个像素不会在降采样时"炸"成一个方块（fireflies）。默认 `false` = 现状。
 * @property {number} [weave]       胶片「画面晃动」：整帧按行做亚像素水平漂移（0 = 关，默认关）。
 *                                 约 ±2 物理像素的低频波（不成整数比的双频叠加），老放映机片门
 *                                 没压稳的那种晃。由整片时间 t 驱动（每帧是 t 的纯函数，可任意 seek）。
 * @property {number} [flicker]     胶片「亮度闪烁」：整帧亮度按慢波轻微起伏（0 = 关，默认关）。
 *                                 1 ≈ 最大 ±14% 的凹陷，0.3 左右是「看上去是放出来的」的常用档。
 * @property {number} [scratch]     胶片「划痕」：几根缓慢漂移的竖向细痕（0 = 关，默认关）。
 *                                 暗处显白、亮处显黑（是「乳剂被刮掉」，不是叠加白线）；
 *                                 每根的生死与位置都由 t 的哈希决定 —— 逐帧确定。
 *                                 覆盖素材包 G1/G2/L2/L6/L16/L34/L53/O4/O16/O26/O47/O56/O66/O83/O84/O86/O91
 *                                 那 17 条「胶片磨损」类条目的介质感（docs/REFERENCE-style-pack.md）。
 * @property {'screen'|'design'|'auto'} [grainScale] 颗粒撒在哪个栅格上。**默认 `'auto'`**（2026-10-24）：
 *                                 `--scale 1`（1080p）→ `'screen'`（物理像素，引擎一直以来的行为）；
 *                                 `--scale 2+`（4K）→ `'design'`（按逻辑分辨率，颗粒大小与 1080p 一致）。
 *                                 `'screen'` 在 4K 下会让颗粒细一半 —— 那是缺陷，所以 auto 会避开它。
 *                                 显式写 `'screen'` / `'design'` 时照旧生效（老任务想钉死行为就写死它）。
 */

/** 默认后处理参数。场景返回的 post 对象会与它合并。 */
export const DEFAULT_POST = /** @type {PostParams} */ ({
  exposure: 1,
  shoulder: 0.85,
  bloom: 0.35,
  bloomThreshold: 0.9,
  bloomRadius: 1,
  halation: 0.25,
  ca: 0.0,
  grain: 0.035,
  vignette: 0.35,
  saturation: 1.0,
  contrast: 1.0,
  lift: 0.0,
  tint: [1, 1, 1],
  invert: 0,
  shake: [0, 0],
  zoom: 1,
  center: null,
  flash: 0,
  fade: 0,
  blur: 0,
  radialBlur: 0,
  tonemap: 'off',
  dither: 'rpdf',
  bloomKaris: false,
  // 胶片磨损三件套（weave / flicker / scratch）：默认全 0 —— 不写就一个像素都不变。
  // 动画时间不由这里给：render() 第 6 参 t 由引擎每帧喂进 uniform（详见 pFinal 的 shader 注释）。
  weave: 0,
  flicker: 0,
  scratch: 0,
  /**
   * 颗粒栅格。**默认 `'auto'`**（2026-10-24 改）：1080p 出片用 `'screen'`（= 引擎一直以来的
   * 物理像素栅格，逐像素不变），`--scale 2` 出 4K 时自动切 `'design'`（按逻辑分辨率撒，
   * 颗粒与 1080p 同大小）。理由见 `grainDesignFor()`。
   */
  grainScale: 'auto',
});

const LEVELS = 4;

/**
 * 颗粒撒在哪个栅格上 —— `'auto'` 的解析（2026-10-24）。
 *
 * **为什么默认值从 `'screen'` 改成 `'auto'`**：`'screen'` 在 4K 下会让颗粒**细一半**
 * （颗粒撒在物理像素上，逻辑 1px 变成物理 2×2），这是**确定的缺陷**，不是观感取舍 ——
 * 实测 lag-1 自相关 `screen` ≈ -0.05（单物理像素）vs `design` ≈ +0.51（2×2 物理像素、
 * 与 1080p 同大小），两者幅度 std 一致（0.0594 / 0.0593，= 只有栅格不同、强度相同）。
 *
 * **但它不该一刀切成 `'design'`**：1080p 下 `design` 与 `screen` 的栅格**完全相同**
 * （逻辑像素 = 物理像素），改默认值不会带来任何收益，只会让基线无谓地变一遍。
 * 所以这里做的是**按分辨率自动选**：`scale === 1` 走 `screen`（老行为逐像素不变），
 * `scale > 1` 走 `design`（跨分辨率观感一致）。作者显式写 `'screen'` / `'design'` 时照旧生效。
 *
 * @param {PostParams} p
 * @param {GL} gl
 * @returns {number} 1 = design 栅格，0 = screen 栅格
 */
export function grainDesignFor(p, gl) {
  const mode = p.grainScale ?? 'auto';
  if (mode === 'design') return 1;
  if (mode === 'screen') return 0;
  // 'auto'：物理分辨率高于逻辑分辨率（--scale 2+）才需要按逻辑栅格撒
  return gl.pw > gl.w ? 1 : 0;
}

export class Post {
  /**
   * @param {GL} gl
   * @param {any} [palette] 必须和场景用同一个调色板，否则后处理里的 C_* 常量对不上
   */
  constructor(gl, palette = null) {
    this.gl = gl;
    this.palette = palette;
    this.params = { ...DEFAULT_POST };
    /** @type {{ a: RT, b: RT, bright: RT, hal: RT, halTmp: RT, halBlur: RT }[]} */
    this.chain = [];
    this.ok = false;
  }

  _build() {
    const gl = this.gl;
    const { pw, ph } = gl;
    if (this.ok && this.pw === pw && this.ph === ph) return;
    this.dispose();
    this.pw = pw; this.ph = ph;
    this.chain = [];
    let w = Math.max(1, pw >> 1), h = Math.max(1, ph >> 1);
    for (let i = 0; i < LEVELS; i++) {
      this.chain.push({
        a: new RT(gl, w, h),
        b: new RT(gl, w, h),
        bright: new RT(gl, w, h),
        hal: new RT(gl, w, h),
        halTmp: new RT(gl, w, h),
        halBlur: new RT(gl, w, h),
      });
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
    this.combine = new RT(gl, pw, ph);
    this.final = new RT(gl, pw, ph);
    this._passes();
    this.ok = true;
  }

  _passes() {
    const gl = this.gl;
    const pal = { palette: this.palette };

    // 亮部提取（带软阈值），同时降采样
    // karis：采样时按 1/(1+luma) 加权、平均之后再还原 —— 一个极亮的孤立像素不会在降采样里
    // 独占一个格子（"fireflies"），泛光里就不会出现随帧跳动的方块。
    this.pBright = new Pass(gl, /* glsl */ `
      uniform sampler2D src; uniform vec2 texel; uniform float threshold; uniform float knee; uniform float karis;
      vec3 tap(vec2 o) {
        vec3 s = texture(src, vUv + texel * o).rgb;
        return karis > 0.5 ? s / (1.0 + luma(s)) : s;
      }
      void main() {
        vec2 t = texel;
        // 4 抽样降采样（顺便抗闪烁）
        vec3 c = (tap(vec2(-0.5, -0.5)) + tap(vec2(0.5, -0.5))
                + tap(vec2(-0.5,  0.5)) + tap(vec2(0.5,  0.5))) * 0.25;
        if (karis > 0.5) c = c / max(1.0 - luma(c), 1e-3);
        float l = max(c.r, max(c.g, c.b));
        // 软阈值：threshold 以下为 0，threshold+knee 以上全过
        float k = max(knee, 1e-4);
        float w = clamp((l - threshold) / k, 0.0, 1.0);
        w = w * w * (3.0 - 2.0 * w);
        fragColor = vec4(c * w, 1.0);
      }`, { src: { value: null }, texel: [0, 0], threshold: 0.9, knee: 1.0, karis: 0 },
      { key: 'post_bright', blend: false, jitter: false, ...pal });

    // 可分离高斯模糊（9 抽样，sigma≈2.2）
    this.pBlur = new Pass(gl, /* glsl */ `
      uniform sampler2D src; uniform vec2 dir; uniform float radius;
      void main() {
        vec2 d = dir * radius;
        vec3 c = texture(src, vUv).rgb * 0.2270270270;
        c += (texture(src, vUv + d * 1.3846153846).rgb + texture(src, vUv - d * 1.3846153846).rgb) * 0.3162162162;
        c += (texture(src, vUv + d * 3.2307692308).rgb + texture(src, vUv - d * 3.2307692308).rgb) * 0.0702702703;
        fragColor = vec4(c, 1.0);
      }`, { src: { value: null }, dir: [1, 0], radius: 1 },
      { key: 'post_blur', blend: false, jitter: false, ...pal });

    // 染色（halation 走偏红的一路）
    this.pTint = new Pass(gl, /* glsl */ `
      uniform sampler2D src; uniform vec3 mul;
      void main() { fragColor = vec4(texture(src, vUv).rgb * mul, 1.0); }`,
      { src: { value: null }, mul: [1, 1, 1] }, { key: 'post_tint', blend: false, jitter: false, ...pal });

    // 金字塔向上合并
    this.pUp = new Pass(gl, /* glsl */ `
      uniform sampler2D src; uniform sampler2D add; uniform float k;
      void main() { fragColor = vec4(texture(src, vUv).rgb + texture(add, vUv).rgb * k, 1.0); }`,
      { src: { value: null }, add: { value: null }, k: 1 }, { key: 'post_up', blend: false, jitter: false, ...pal });

    // 场景 + 泛光 + 光晕
    this.pCombine = new Pass(gl, /* glsl */ `
      uniform sampler2D src;
      uniform sampler2D bloomTex;
      uniform sampler2D halTex;
      uniform float bloom, halation;
      void main() {
        vec3 c = texture(src, vUv).rgb;
        c += texture(bloomTex, vUv).rgb * bloom;
        c += texture(halTex, vUv).rgb * halation * vec3(1.0, 0.42, 0.22);
        fragColor = vec4(c, 1.0);
      }`, { src: { value: null }, bloomTex: { value: null }, halTex: { value: null }, bloom: 0.35, halation: 0.25 },
      { key: 'post_combine', blend: false, jitter: false, ...pal });

    // 最终调色 + 颗粒，转 sRGB 之前的一切都在这里
    this.pFinal = new Pass(gl, /* glsl */ `
      uniform sampler2D src;
      uniform vec2  outSize;      // 物理像素
      uniform vec2  designSize;   // 逻辑分辨率（grainScale 'design' 用）
      uniform float exposure, shoulder, ca, grain, vignette, saturation, contrast, lift, invert;
      uniform vec3  tint;
      uniform vec2  shake;
      uniform float zoom, flash, fade, blurAmt, radialBlur, seed;
      uniform vec2  center;
      uniform float tonemap, ditherMode, grainDesign;
      uniform float pixel;
      // 胶片磨损三件套（全部 0 = 逐像素等于没有它们）。动画时间来自 Pass.render 的 t。
      uniform float weave, flicker, scratch, wearT;

      float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }

      // ───────────────────────── 胶片磨损（BACKLOG 4.2，2026-10-30）─────────────────────────
      // 三条都是「介质是胶片」这句话的物理来源，全由 wearT（= 整片时间 t）驱动：
      //
      // · weave（片门晃动）：真机器的抖**不是**单频正弦，是两个不成整数比的低频叠加
      //   （输片齿轮的齿频 + 片门松隙的半频）。频率取 2.9 / 4.7 Hz 这种无理数比，峰值
      //   ±2 物理像素 —— 再大观众就在数晃动而不是看内容了。相位随行号 y 微调：
      //   输片是整帧动，但片门上下受力不匀，轻微的行间相位差让画面「活」而不「扭」。
      // · flicker（放映闪炼）：灯与光路的慢波（主瓣 1.3 Hz），只**压暗**不提亮 ——
      //   放映机的闪烁是光被挡掉，画面不会凭空多光。中心带一点行差（灯罩效应）。
      // · scratch（划痕）：乳剂刮伤是**竖向**的（输片方向），位置几天不变、边缘几微米
      //   地游移。所以每根划痕用 t 的低频哈希决定「生 / 死 / 横向位置 / 宽度」，
      //   而不是逐帧随机（那是数字噪点，不是胶片）。只做**暗痕**：刮掉的乳剂挡不住光，
      //   投影出来是「画面里多了一道不显影的细缝」—— 亮部几乎看不见，暗部显白。
      //   （先试过叠白线，在浅底风格上一眼假；暗痕在两种底色上都成立。）

      /** 哈希到 0..1（与 rand 同族，输入一维更顺手） */
      float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

      /** 片门晃动的水平位移（物理像素）。amp = weave × 2.0 */
      float weaveDx(float y, float amp) {
        if (amp <= 0.0) return 0.0;
        float ph = y * 0.004;                        // 行间相位差：极小，只是让行不至于完全同步
        float a = sin(wearT * 2.9 + ph);             // 输片齿轮的基频
        float b = 0.5 * sin(wearT * 4.7 + 1.7 + ph * 1.6);  // 半频的片门松隙
        return (a + b) * amp;
      }

      /** 放映闪烁的增益（0.86..1.0）。k = flicker，1 = 最深 ±14% */
      float flickerGain(float y, float k) {
        if (k <= 0.0) return 1.0;
        float slow = 0.5 + 0.5 * sin(wearT * 1.3 + 0.9);
        slow *= 0.75 + 0.25 * (0.5 + 0.5 * sin(wearT * 3.1 + 2.0));   // 深浅随时间变
        return 1.0 - k * 0.14 * slow * (1.0 - 0.15 * y / max(RES_LOGICAL.y, 1.0));
      }

      /**
       * 划痕的「暗化量」：0 = 这一点没有划痕，>0 越暗。
       * 位置 = t 的慢波游移（几秒尺度），生死 = 每个 5 秒窗掷一次骰子。
       */
      float scratchDarken(vec2 px, float k) {
        if (k <= 0.0) return 0.0;
        float dark = 0.0;
        // 两根候选划痕：窗口内「存在吗 / 在哪 / 多宽 / 多深」全由哈希定
        for (int i = 0; i < 2; i++) {
          float fi = float(i);
          float w = floor(wearT / 5.0) + fi * 17.0;    // 每 5 秒一个新状态（错开两根）
          float alive = step(0.45, hash1(w + fi * 3.7));        // 55% 的窗口里存在
          float x0 = hash1(w + 11.3 + fi * 5.1) * RES_LOGICAL.x;
          float drift = sin(wearT * 0.23 + fi * 2.1) * 1.2;     // 边缘微游移（秒级）
          float wdt = 0.5 + 1.3 * hash1(w + 7.7 + fi * 9.4);    // 半宽（物理像素）
          float depth = 0.35 + 0.65 * hash1(w + 3.1 + fi * 13.9);
          float d = abs(px.x - (x0 + drift));
          float line = 1.0 - smoothstep(wdt * 0.4, wdt, d);
          dark = max(dark, alive * line * depth * (1.0 - 0.25 * px.y / max(RES_LOGICAL.y, 1.0)));
        }
        return k * dark;
      }

      vec3 shoulderCurve(vec3 x, float k) {
        // 软肩：k 以下线性，以上指数压回来，保住高光层次而不是硬切
        vec3 a = max(x - k, vec3(0.0));
        return min(x, vec3(k)) + (1.0 - exp(-a / max(1.0 - k, 1e-3))) * (1.0 - k);
      }

      // AgX（Benjamin Wrensch 的 minimal 版）：高光柔和滚降，亮霓虹不偏色。
      // 输入是线性 HDR，输出是**线性显示值**（0..1），后面照常走 blitPass / readPixels 的 sRGB 编码。
      vec3 agxContrast(vec3 x) {
        vec3 x2 = x * x, x4 = x2 * x2;
        return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
      }
      vec3 tonemapAgX(vec3 v) {
        const mat3 m = mat3(
          0.842479062253094,  0.0423282422610123, 0.0423756549057051,
          0.0784335999999992, 0.878468636469772,  0.0784336,
          0.0792237451477643, 0.0791661274605434, 0.879142973793104);
        const mat3 mi = mat3(
           1.19687900512017,   -0.0528968517574562, -0.0529716355144438,
          -0.0980208811401368,  1.15190312990417,   -0.0980434501171241,
          -0.0990297440797205, -0.0989611768448433,  1.15107367264116);
        const float lo = -12.47393, hi = 4.026069;
        v = clamp(log2(max(m * v, vec3(1e-10))), lo, hi);
        v = agxContrast((v - lo) / (hi - lo));
        return pow(max(mi * v, 0.0), vec3(2.2));
      }
      // Narkowicz 的 ACES 拟合：比 AgX 更饱和、对比更硬。
      vec3 tonemapACES(vec3 x) {
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }

      void main() {
        vec2 uv = vUv;
        float physY = vUv.y * outSize.y;             // 物理像素 y（weave/flicker 按屏幕行走）
        // 胶片磨损先动 uv（weave 是「片身晃」，要在一切几何采样之前发生）
        if (weave > 0.0) uv.x += weaveDx(physY, weave * 2.0) / outSize.x;
        // **像素化**（post.pixel = 一个像素块占多少物理像素，0 = 关）：
        // 先把 uv 吸附到 N×N 网格，再采样 —— 等价于"降分辨率再放大"，块状边界干净。
        if (pixel > 0.5) {
          vec2 P = outSize / pixel;
          uv = (floor(uv * P) + 0.5) / P;
        }
        uv = (uv - center) / zoom + center;
        uv += shake / outSize;
        vec2 d = uv - center;
        float r2 = dot(d, d);
        vec3 c;

        if (blurAmt > 0.0 || radialBlur > 0.0) {
          // 径向模糊：沿指向中心的方向取 12 个抽样
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 12; i++) {
            float f = float(i) / 11.0;
            float s = 1.0 - f * (radialBlur * 0.12 + blurAmt * 0.01);
            acc += texture(src, center + d * s).rgb;
          }
          c = acc / 12.0;
        } else if (ca > 0.0) {
          // 色差：RGB 三通道按半径分离
          float k = ca * 0.004 * (0.25 + r2 * 2.0);
          c = vec3(
            texture(src, uv + d * k).r,
            texture(src, uv).g,
            texture(src, uv - d * k).b
          );
        } else {
          c = texture(src, uv).rgb;
        }

        c *= exposure;
        // 高光滚降：三选一。默认 'off' 走原来的软肩（老任务一像素不变）
        if (tonemap > 1.5)      c = tonemapACES(c);
        else if (tonemap > 0.5) c = tonemapAgX(c);
        else                    c = shoulderCurve(c, shoulder);
        c = mix(c, vec3(1.0) - c, invert);

        // 对比与饱和（围绕中灰 0.18）
        float l = luma(c);
        c = mix(vec3(l), c, saturation);
        c = (c - 0.18) * contrast + 0.18;
        c = max(c, vec3(0.0)) + lift;
        c *= tint;

        // 暗角
        if (vignette > 0.0) c *= 1.0 - vignette * smoothstep(0.25, 0.95, r2 * 2.2);

        // 胶片磨损的「介质感」两件：闪烁（亮度慢波）与划痕（乳剂刮痕）。
        // 放在调色之后、flash/fade 之前 —— 它们属于「放映这一侧」，不属于镜头内容。
        if (flicker > 0.0) c *= flickerGain(physY, flicker);
        if (scratch > 0.0) {
          vec2 spx = vec2(vUv.x * outSize.x, physY);
          float d = scratchDarken(spx, scratch);
          if (d > 0.0001) {
            // ⚠ 极性：划痕是「一条没显影的缝」，不是「一道白线」也不是「一道黑线」——
            //   亮底上它**发暗**（脏东西挡住了光），暗底上它**发亮**（乳剂被刮掉、光漏过来）。
            //   只往一个方向拉会在其中一种底上整条隐形（实测第一版只压暗：深色段完全看不见，
            //   而亮纸段又被亮度衰减因子归零 —— 夹具里两段都没有划痕）。
            vec3 seam = luma(c) > 0.35 ? vec3(0.015) : vec3(0.95);
            c = mix(c, seam, clamp(d * 0.55, 0.0, 1.0));
          }
        }

        c += flash;
        c *= (1.0 - fade);

        // 颗粒与抖动的栅格：'design' 按逻辑分辨率撒（--scale 2 出 4K 时颗粒不会细一半），
        // 'screen' 按物理像素（引擎一直以来的行为）。
        vec2 gp = grainDesign > 0.5 ? floor(vUv * designSize) : gl_FragCoord.xy;

        // 胶片颗粒：在显示空间加，暗部更明显（跟真胶片一样）
        if (grain > 0.0) {
          float g = rand(gp + seed) - 0.5;
          float amp = grain * (1.0 - 0.65 * luma(toSRGB(max(c, vec3(0.0)))));
          c += g * amp;
        }

        // 抖动：打散 8bit 量化带来的色带。
        // tpdf = 两个均匀分布相加（三角分布），去色带的噪声感比 rpdf 更弱。
        if (ditherMode > 1.5) {
          c += (rand(gp * 1.37 + seed * 1.7) + rand(gp * 2.11 + seed * 3.1) - 1.0) / 255.0;
        } else if (ditherMode > 0.5) {
          c += (rand(gp * 1.37 + seed * 1.7) - 0.5) / 255.0;
        }

        fragColor = vec4(max(c, vec3(0.0)), 1.0);
      }`,
      {
        src: { value: null }, outSize: [1920, 1080], designSize: [1920, 1080],
        exposure: 1, shoulder: 0.85, ca: 0, grain: 0.035, vignette: 0.35,
        saturation: 1, contrast: 1, lift: 0, invert: 0, tint: [1, 1, 1],
        shake: [0, 0], zoom: 1, flash: 0, fade: 0,
        blurAmt: 0, radialBlur: 0, seed: 0, center: [0.5, 0.5],
        tonemap: 0, ditherMode: 1, grainDesign: 0, pixel: 0,
        weave: 0, flicker: 0, scratch: 0, wearT: 0,
      }, { key: 'post_final', blend: false, jitter: false, ...pal });
  }

  /**
   * 跑完整条后处理链。
   * @param {GL} gl
   * @param {any} srcTex 场景合成的 HDR 纹理（线性）
   * @param {RT} dst 输出目标（物理分辨率）
   * @param {PostParams} p
   * @param {number} seed 每帧固定的随机种子（用帧号算，不要用时间）
   * @param {number} [t=0] 整片时间（秒）—— 胶片磨损（weave/flicker/scratch）的动画时间源。
   *                       引擎每帧喂 f.t，所以磨损是 t 的纯函数：可任意 seek、子帧乱序
   *                       也不串味（与 §4 铁律同一条约束）。不传 = 磨损静止（0 时不生效）。
   */
  render(gl, srcTex, dst, p, seed = 0, t = 0) {
    this._build();
    const src = { tex: /** @type {any} */ (srcTex).tex ?? srcTex, __tex: true };
    const chain = this.chain;

    // 1) 亮部提取（同时降采样到第 0 级）
    this.pBright.u.src.value = src;
    this.pBright.u.texel.value = [1 / gl.pw, 1 / gl.ph];
    this.pBright.u.threshold.value = p.bloomThreshold;
    this.pBright.u.knee.value = Math.max(0.15, p.bloomThreshold * 0.6);
    this.pBright.u.karis.value = p.bloomKaris ? 1 : 0;
    this.pBright.render(gl, chain[0].bright);

    // halation 单独走一路：偏红、更宽
    this.pTint.u.src.value = { tex: chain[0].bright.tex, __tex: true };
    this.pTint.u.mul.value = [1.0, 0.34, 0.16];
    this.pTint.render(gl, chain[0].halTmp);
    this._blur(chain[0].halTmp, chain[0].hal, chain[0].halBlur,
      1 / chain[0].hal.w, 1 / chain[0].hal.h, p.bloomRadius * 2.0);

    // 泛光第 0 级
    this._blur(chain[0].bright, chain[0].a, chain[0].b,
      1 / chain[0].a.w, 1 / chain[0].a.h, p.bloomRadius);

    // 2) 逐级降采样 + 模糊（得到越来越宽的光晕）
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1], cur = chain[i];
      this.pBright.u.src.value = { tex: prev.a.tex, __tex: true };
      this.pBright.u.texel.value = [1 / prev.a.w, 1 / prev.a.h];
      this.pBright.u.threshold.value = 0.0;   // 已经是亮部图，直接降采样
      this.pBright.u.knee.value = 1.0;
      this.pBright.u.karis.value = 0;         // ⚠ Karis 只对第 0 级有意义，别让上一轮的值漏进来
      this.pBright.render(gl, cur.bright);
      this._blur(cur.bright, cur.a, cur.b, 1 / cur.a.w, 1 / cur.a.h, p.bloomRadius * (1 + i * 0.6));
    }

    // 3) 自下而上合并成一张泛光图
    let acc = chain[chain.length - 1].a;
    for (let i = chain.length - 2; i >= 0; i--) {
      this.pUp.u.src.value = { tex: acc.tex, __tex: true };
      this.pUp.u.add.value = { tex: chain[i].a.tex, __tex: true };
      this.pUp.u.k.value = 0.75;
      this.pUp.render(gl, chain[i].b);
      acc = chain[i].b;
    }

    // 4) 合成 + 调色
    this.pCombine.u.src.value = src;
    this.pCombine.u.bloomTex.value = { tex: acc.tex, __tex: true };
    this.pCombine.u.halTex.value = { tex: chain[0].hal.tex, __tex: true };
    this.pCombine.u.bloom.value = p.bloom;
    this.pCombine.u.halation.value = p.halation;
    this.pCombine.render(gl, this.combine);

    const f = this.pFinal;
    f.u.src.value = { tex: this.combine.tex, __tex: true };
    // zoom / 径向模糊 / 色差都绕 center 转。场景给的是**逻辑像素、y 向下**，
    // shader 里是 0..1、y 向上，所以在这里换算（不填就是画面中心）。
    // 曾经这里漏了赋值，于是 center 永远是默认值，"绕某个元素推近" 做不出来。
    const c = p.center;
    f.set({
      outSize: [gl.pw, gl.ph],
      designSize: [gl.w, gl.h],
      exposure: p.exposure, shoulder: p.shoulder, ca: p.ca, grain: p.grain,
      vignette: p.vignette, saturation: p.saturation, contrast: p.contrast,
      lift: p.lift, invert: p.invert, tint: p.tint,
      shake: p.shake, zoom: p.zoom, flash: p.flash, fade: p.fade,
      blurAmt: p.blur ?? 0, radialBlur: p.radialBlur ?? 0,
      seed: seed % 1000,
      tonemap: p.tonemap === 'agx' ? 1 : p.tonemap === 'aces' ? 2 : 0,
      ditherMode: p.dither === 'tpdf' ? 2 : p.dither === 'off' ? 0 : 1,
      // 像素化：一个色块占多少物理像素（0 = 关）。见 shader 里 pixel 那段注释。
      pixel: Number(p.pixel) > 0 ? Number(p.pixel) : 0,
      grainDesign: grainDesignFor(p, gl),
      // 胶片磨损三件套：数值透传（0 = 关），时间 = 整片 t（见 render() 的 JSDoc）
      weave: Number(p.weave) > 0 ? Number(p.weave) : 0,
      flicker: Number(p.flicker) > 0 ? Number(p.flicker) : 0,
      scratch: Number(p.scratch) > 0 ? Number(p.scratch) : 0,
      wearT: t,
      center: Array.isArray(c) && c.length >= 2
        ? [c[0] / gl.w, 1 - c[1] / gl.h]
        : [0.5, 0.5],
    });
    f.render(gl, dst);
    this.params = p;
    return dst;
  }

  _blur(srcRT, target, tmp, tx, ty, radius = 1) {
    const gl = this.gl;
    this.pBlur.u.src.value = { tex: srcRT.tex, __tex: true };
    this.pBlur.u.dir.value = [tx, 0];
    this.pBlur.u.radius.value = radius;
    this.pBlur.render(gl, tmp);
    this.pBlur.u.src.value = { tex: tmp.tex, __tex: true };
    this.pBlur.u.dir.value = [0, ty];
    this.pBlur.render(gl, target);
    return target;
  }

  dispose() {
    for (const c of this.chain) {
      c.a.dispose(); c.b.dispose(); c.bright.dispose();
      c.hal.dispose(); c.halTmp.dispose(); c.halBlur.dispose();
    }
    this.chain = [];
    this.combine?.dispose();
    this.final?.dispose();
    this.ok = false;
  }
}
