// @ts-check
/**
 * 「一条走完全片的背景 + 一台走完全片的摄影机」。
 *
 * 这是让镜头切换不"跳"的那套配方（四条，缺一条就露馅 —— 详见 `docs/ENGINE.md`
 * 与 `src/core/trans.js` 顶部的说明）：
 *
 *   ① 全片只有一层背景：同一个 shader、参数只由**整片时间 `f.t`** 驱动
 *      → 切点两侧的背景逐像素一致，世界没有变，只有前景在换。
 *   ② 全片一台摄影机：`cameraPost(f.t, {...})` 交给 post 的 zoom/shake，全帧一起动。
 *   ③ 一个走完全片的母题：一条指针 / 一道扫描线 / 一颗星。眼睛有得跟，切了也像没切。
 *   ④ 交叠期把上一帧甩走，新内容从**反方向**落位。
 *
 * ## 为什么这一层在引擎里
 *
 * 这套配方在 NekoHome 那支片子里验证过，但**只存在于那份任务代码的注释里**；
 * 下一支片子（fidus）又把 `worldPass` / `camAt` / `camDir` / `transPass` / `cutOut`
 * 各写了一遍，而且 9 段里 8 段漏了调用 —— 于是那 8 段的底是纯黑且不报错。
 * 现在形状是：
 *
 * ```js
 * // task.config.mjs
 * export const world = (ctx) => worldPass(ctx, { grid: 60, accent: ctx.P.cyan });
 *
 * // scenes/shot.js
 * export default {
 *   id: 'shot_a',
 *   handlesTransition: true,
 *   setup(ctx) { this.wk = makeWorldKit(ctx); },
 *   render(ctx) {
 *     const k = this.wk.openFrame(ctx);          // ← 不会再漏：漏了 check 会报
 *     const [dx, dy] = enterOffset(ctx.f.t, k);
 *     // …前景…
 *     return cameraPost(ctx.f.t, { bloom: 0.3 });
 *   },
 * };
 * ```
 *
 * 更省事的写法是 `makeShot()`：把 openFrame / 摄影机 / post 全包好，
 * 场景只需要画前景（见 `src/kit/shot.js`）。
 */

import { Pass } from '../core/gl.js';
import { sat } from '../core/util.js';
import {
  transitionPass as coreTransitionPass, makeCameraProfile, openTransitionFrame,
  TRANSITION_MODES, resolveTransitionMode, transitionFadeAt, isPassTransition,
} from '../core/trans.js';

// 碰撞式转场的判据转发（BACKLOG 1-33 ③）：场景侧从 kit 里就能拿到，不必回头 import core
export { planCollision, victimSpan, VICTIM_RATIO_RANGE, VICTIM_RATIO_DEFAULT } from '../core/trans.js';
// 转场模式表（BACKLOG 1-13）：同上，场景里想自己判断时不用 import core
export { TRANSITION_MODES, resolveTransitionMode, transitionFadeAt, isPassTransition } from '../core/trans.js';

/**
 * 把「上一段那一帧」沿摄影机方向甩出去，并加方向拖尾。
 *
 * 与交叉溶解的区别：溶解是「两张图叠在一起」，甩出去是「镜头没停，画面被带走了」。
 * 位移随 k **加速**（k²），拖尾宽度同时变宽 —— 这两个一起给速度感；
 * 透明度在 k=0.55 之前就降到 0，避免两屏文字长时间叠着。
 *
 * 实现在 `src/core/trans.js`（引擎级），这里只做转发 —— 同一件事不该有第二份实现。
 *
 * `victimRatio` 是 §4.4 那条「受害者退出时长 = 入侵者入场时长 × 40–50%」的入口
 * （判据与夹取在 `src/core/trans.js` 的 `planCollision` / `VICTIM_RATIO_RANGE`）。
 * **不传 = `fadeAt` 还是 0.55，逐像素与从前一致。**
 *
 * `mode` 是**转场模式**（BACKLOG 1-13）：`'push'`（默认，甩镜）/ `'wipe'` 擦除 /
 * `'iris'` 光圈 / `'glitch'` 故障 / `'pixel'` 像素块 / `'dissolve'` 阈值溶解。
 * 写错**当场抛**并列出可用值（`TRANSITION_MODES`）。不写 = `'push'` = 逐像素与从前一致。
 *
 * @param {{ push?: number, blur?: number, fadeAt?: number, key?: string, victimRatio?: number,
 *           mode?: string, where?: string }} [opts]
 */
export function transitionPass(gl, opts = {}) {
  return coreTransitionPass(gl, opts);
}

/**
 * 全片共用的背景 Pass：一层可参数化的"坐标系网格 + 取样带"。
 *
 * 它是**通用底**，不是某一支片子的视觉：想要自己的世界就照这个签名写一个
 * `(ctx) => Pass`，只要保证「参数只跟整片时间走」这一条。
 * 这里的 `warp` 是留给"世界还没对齐"这类叙事的旋钮（0 = 正，1 = 完全歪）。
 *
 * @param {any} ctx SceneCtx（只要有 gl 和 P；task.config 里传的就是这个）
 * @param {{ grid?: number, sweep?: number, warp?: number, accent?: number[], vignette?: number }} [opts]
 */
/**
 * 调色板指纹（短 hash）：只用来区分"这份颜色组合"，不追求抗碰撞 ——
 * 目的是让缓存 key 在**换风格**时失效，避免复用上一套的 Pass 实例。
 * @param {any} P 调色板（linear 值，数组）
 * @param {any} accent 强调色（线性值）
 */
function paletteFingerprint(P, accent) {
  const q = (v) => Math.round((Array.isArray(v) ? v[0] * 7 + v[1] * 13 + v[2] * 17 : (v?.r ?? 0)) * 1000);
  let h = 2166136261;
  for (const v of [q(P.ink), q(P.ink2), q(P.bone), q(accent)]) {
    h ^= v & 0xffff;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36).slice(0, 6);
}

export function worldPass(ctx, opts = {}) {
  const P = ctx.P;
  const grid = opts.grid ?? 60;
  const accent = opts.accent ?? P.cyan ?? P.signal;
  const vig = opts.vignette ?? 0.9;
  /**
   * 母题（`docs/STYLE.md`）：背景长什么样，由风格包决定。
   *
   * 这一条是"反审美疲劳"里最省事的一刀 —— 引擎从前的共享底只有**一种**网格
   * （60px 细格 + 一道扫描带），每支片子都一样。现在：
   *   `grid`（默认，= 从前逐像素不变）/ `blueprint` 坐标纸 + 图框 /
   *   `paper` 纸面横格 / `scan` 终端扫描线 / `noir` 电影暗角 / `flat` **纯色（不画母题）**。
   *
   * 用法（`task.config.mjs`）：
   * ```js
   * export const world = (ctx) => worldPass(ctx, { motif: 'auto' });  // 跟着 ctx.style.motif 走
   * ```
   * `motif: 'auto'` 或缺省时读 `ctx.style.motif`；`ctx.style` 不存在就用 `grid`（老行为）。
   */
  const motifName = (!opts.motif || opts.motif === 'auto')
    ? (ctx?.style?.motif ?? 'grid')
    : String(opts.motif);
  /** GLSL 里用的是 float（`Pass` 的数字 uniform 一律走 `uniform1f`；声明成 int 会静默失效） */
  const MOTIF_ID = { grid: 0, blueprint: 1, paper: 2, scan: 3, noir: 4, flat: 5 };
  const motif = MOTIF_ID[motifName] ?? 0;
  return new Pass(ctx.gl, /* glsl */ `
    uniform vec3 cInk, cInk2, cLine, cAccent;
    uniform float warp, spacing, sweep, vig, motif;
    void main() {
      vec2 res = RES_LOGICAL;
      vec2 q = FRAG_PX;
      vec2 c = res * vec2(0.5, 0.46);

      // 「还没解算出来」的坐标系：平移 + 一点点旋转的错位
      // （纸面/胶片那两类母题几乎不需要这种错位，所以按母题缩放）
      float warpK = (motif > 1.5 && motif < 2.5) ? warp * 0.12 : warp;
      vec2 d = (q - c) / res.y;
      vec2 off = vec2(
        sin(d.y * 5.3 + t * 0.37) + 0.45 * sin(d.y * 11.0 - t * 0.21),
        sin(d.x * 4.1 + t * 0.29) + 0.45 * sin(d.x * 9.0 + t * 0.17)
      ) * 20.0 * warpK;
      float a = 0.040 * warpK * sin(t * 0.13);
      vec2 r = q - c;
      q = c + vec2(r.x * cos(a) - r.y * sin(a), r.x * sin(a) + r.y * cos(a)) + off;

      // 底色：中心浅、四角压暗
      vec2 e = (q / res - vec2(0.5, 0.46)) / vec2(0.92, 0.86);
      vec3 col = mix(cInk2, cInk, smoothstep(0.0, 1.0, length(e)));
      vec2 fw = vec2(fwidth(q.x), fwidth(q.y));
      float mask = 1.0 - smoothstep(0.18, 0.95, length(e));

      if (motif < 0.5) {
        // ── grid：引擎从前的默认底（这一段逐像素不变，老任务的基线靠它） ──
        vec2 gu = q / spacing;
        vec2 g = abs(fract(gu) - 0.5) * spacing;
        float fine = 1.0 - smoothstep(fw.x * 0.6, fw.x * 1.9, min(g.x, g.y));
        vec2 g5 = abs(fract(gu / 5.0) - 0.5) * spacing * 5.0;
        float coarse = 1.0 - smoothstep(fw.x * 0.6, fw.x * 1.9, min(g5.x, g5.y));
        col += cLine * 0.016 * fine * mask;
        col += cLine * 0.022 * coarse * mask;

        // 取样带：一道很淡的横向扫描线，慢慢往下走
        // 压得比网格还轻，因为它会横穿文字
        float band = fract((FRAG_PX.y / res.y) - sweep);
        col += cAccent * 0.013 * (1.0 - smoothstep(0.0, 0.085, band)) * mask;

        // 边界：还没解算的时候四角留一点暗示
        col += cAccent * 0.024 * warp * smoothstep(0.55, 1.15, length(e) * vig);
      } else if (motif < 1.5) {
        // ── blueprint：坐标纸（细格 + 每 8 格一根亮线）+ 图框 ──
        vec2 gu = q / spacing;
        vec2 g = abs(fract(gu) - 0.5) * spacing;
        float fine = 1.0 - smoothstep(fw.x * 0.7, fw.x * 2.2, min(g.x, g.y));
        col += cLine * 0.028 * fine * mask;
        vec2 g8 = abs(fract(gu / 8.0) - 0.5) * spacing * 8.0;
        float coarse = 1.0 - smoothstep(fw.x * 0.7, fw.x * 2.0, min(g8.x, g8.y));
        col += cAccent * 0.05 * coarse * mask;
        // 图框：离画面边缘 46px 处一条亮线（工程图的图廓）
        float edge = min(min(FRAG_PX.x, res.x - FRAG_PX.x), min(FRAG_PX.y, res.y - FRAG_PX.y));
        col += cAccent * 0.10 * (1.0 - smoothstep(0.0, 1.6, abs(edge - 46.0)));
        col += cAccent * 0.03 * smoothstep(0.6, 1.2, length(e) * vig);
      } else if (motif < 2.5) {
        // ── paper：纸面（极淡的横格 + 一点纤维噪声），几乎不做错位 ──
        float rule = abs(fract(q.y / 36.0) - 0.5) * 36.0;
        float line = 1.0 - smoothstep(fw.y * 0.8, fw.y * 2.6, rule);
        col -= cLine * 0.020 * line * mask;
        // 纤维：确定性哈希噪声（不是逐帧抖动 —— 这个 shader 只吃 t，但噪声取的是像素坐标，本来就静止）
        float fiber = fract(sin(dot(floor(q * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
        col += (fiber - 0.5) * 0.012 * mask;
        col -= cLine * 0.020 * smoothstep(0.55, 1.15, length(e) * vig);
      } else if (motif < 3.5) {
        // ── scan：终端（每 4px 一道暗扫描线 + 一条缓慢下移的回扫亮带） ──
        float s = 1.0 - smoothstep(0.0, 1.4, abs(fract(FRAG_PX.y / 4.0) - 0.5) * 4.0);
        col -= cLine * 0.045 * s;
        float band = fract((FRAG_PX.y / res.y) - sweep);
        col += cAccent * 0.05 * (1.0 - smoothstep(0.0, 0.06, band));
        // 字符格：淡淡的等宽栅格，暗示"屏幕在等下一行输出"
        vec2 cell = abs(fract(q / vec2(22.0, 30.0)) - 0.5);
        float grid2 = 1.0 - smoothstep(0.44, 0.5, max(cell.x, cell.y));
        col += cAccent * 0.020 * (1.0 - grid2) * mask;
        col += cAccent * 0.05 * smoothstep(0.5, 1.2, length(e) * vig);
      } else if (motif < 4.5) {
        // ── noir：电影（中心柔光 + 很重的暗角） ──
        col += cLine * 0.035 * (1.0 - smoothstep(0.0, 0.9, length(e)));
        col *= 1.0 - smoothstep(0.30, 1.25, length(e)) * 0.72;
        col += cAccent * 0.02 * warp * smoothstep(0.7, 1.3, length(e) * vig);
      } else {
        // ── flat：纯色 —— **什么母题都不画**（BACKLOG 1-46，设计 token 的承载风格） ──
        //   用户 2026-10-25 原话：「网格直接去掉」。高级感靠排版/线宽三档/弹簧，不靠背景。
        //   上面的"中心浅、四角压暗"就是全部；这里只把四角再轻收一点，给画面一个**边界**
        //   （不是网格！是一道连续的渐变 —— 没有它，整片像"还没擦干净的黑板"）。
        col *= 1.0 - smoothstep(0.55, 1.35, length(e)) * 0.22;
      }

      fragColor = vec4(col, 1.0);
    }`, {
    cInk: P.ink, cInk2: P.ink2, cLine: P.bone, cAccent: accent,
    warp: opts.warp ?? 1, spacing: grid, sweep: 0, vig, motif,
  }, {
    // ⚠ key 必须带上**调色板指纹**：Pass 是按 key 缓存的，颜色虽然是 uniform，
    //   但同一个 key 会复用上一套风格建好的那个实例 —— 换风格后背景还是上一个配色。
    //   这正是「15 套 MG 风格包渲出来背景不变」的直接原因（实测：mg-bauhaus 的米白底渲成近黑）。
    key: `kit_world_${motifName}_${grid}_${vig}_${paletteFingerprint(P, accent)}`,
    blend: false,
  });
}

/**
 * 这一套摄影机的参数（`makeShot` / `makeThreeShot` 默认就是它）：
 * 比 `trans.js` 那套更"稳"一点 —— 幅度小、频率慢、基准略微推近（1.035）。
 * 实现与 `trans.js` 共用 `makeCameraProfile()`，这里只给参数。
 */
const CAM = makeCameraProfile({
  zoomBase: 1.035,
  zoomAmp: 0.03,
  zoomW: [0.085, 0.27],
  zoomPhase: [-1.1, 2.0],
  shake: [[22, 0.17, 0], [9, 0.43, 0.7], [14, 0.14, 1.3], [6, 0.37, 0]],
  enterAmount: 130,
  enterY: 0.5,
});

/** 全片一台摄影机：**只用整片时间 `t`**，所以切镜头时它不会断。 */
export const cameraAt = CAM.cameraAt;

/** 摄影机当前的运动方向（单位向量，屏幕坐标系 y 向下）—— 转场拖尾与前景入场都沿它。 */
export const cameraDir = CAM.cameraDir;

/**
 * 段落收尾用的 post：摄影机 + 这一段的固定观感，合成一个对象直接 return。
 * @param {number} t 整片时间（`f.t`）
 * @param {Record<string, any>} [extra] 这一段自己的调色/泛光等
 */
export const cameraPost = CAM.cameraPost;

/**
 * 前景的入场位移：方向与摄影机**相反**（上一镜往这边被甩走，新内容就从反方向落位）。
 * 直接加在文字的 x/y 或矢量的坐标上即可。
 */
export const enterOffset = CAM.enterOffset;

/**
 * 场景侧的转场套件。一句 `this.wk = makeWorldKit(ctx)` 装好，
 * 每帧第一句 `const k = this.wk.openFrame(ctx)` 就没别的事了。
 *
 * `openFrame` 做两件事：
 *   ① 画全片唯一的那层背景（同一个 Pass、只跟 `f.t` 走）；
 *   ② 交叠期把上一段那一帧沿摄影机方向甩出去（不是原地淡出 —— 两屏文字叠着会糊）。
 *
 * 返回的 `k` 是入场进度：1 = 已经站稳，按平常那样画即可。
 *
 * `opts` **原样交给 `transitionPass()`** —— 所以 `transitionPass` 的旋钮在这里都能用
 * （`push` / `blur` / `fadeAt` / `victimRatio`）；`opts.background` 是这一层的背景。
 * 一个都不给 = 从前的行为（`fadeAt` 0.55）。
 */
export function makeWorldKit(ctx, opts = {}) {
  const pass = transitionPass(ctx.gl, opts);
  let background = opts.background ?? null;
  return {
    pass,
    /**
     * @param {any} c SceneCtx
     * @param {{ render: (gl: any, target: any, t: number, dt: number) => any } | null} [bg]
     *        覆盖这一次用的背景（不传就用 setup 时给的 / 引擎的 ctx.world）
     * @returns {number} 入场进度 k
     */
    openFrame(c, bg = undefined) {
      const world = bg === undefined ? (background ?? c.world) : bg;
      // 相机接力（BACKLOG 1-12）：ctx.relay?.pose 存在 = 引擎正在做位姿混合 + mixTo 换手，
      // 交叠帧里"把上一帧甩走"的那一步必须跳过 —— 否则 B 段 RT 里先甩一遍、
      // composite 再换手混一遍 = 双重转场。只铺背景并照常返回 k（enterOffset 等下游不受影响）。
      // 背景 render 仍然要跑：relay 段的画面底还是这一层（world: 'auto' 的铺底职责不变）。
      if (c?.relay?.pose) {
        if (world) world.render(c.gl, c.out, c.f.t, c.f.dt);
        return c.under ? sat(c.f.tin) : 1;
      }
      return openTransitionFrame(c, { pass, background: world, dir: cameraDir, opts });
    },
    /** 换一层背景（例如片头/片尾要换世界）。 */
    setBackground(p) { background = p; return this; },
  };
}
