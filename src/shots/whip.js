// @ts-check
/**
 * 镜头模板：`whip` —— 甩镜转场（方向性模糊 + 速度线）。
 * 原场景：甩镜转场。演示——handlesTransition + 用 ctx.under 拿上一段的成帧做自定义转场。
 *
 * 关键点：
 *   · timeline 里写 { handlesTransition: true }，并与上一段重叠（overlap）
 *   · f.tin 从 0 走到 1，就是"转场进度"
 *   · ctx.under 是上一个场景这一时刻的成帧（HDR 纹理），可以直接采样
 *
 * ```js
 * export default shot('whip', { streaks: 26, dir: [1, 0.12] });
 * ```
 */


import { transitionOnly } from './pick.js';
import { Pass } from '../core/gl.js';
import { ease } from '../core/util.js';

/** 全部参数 = "什么都不传时的画面"（demo 用的就是这一套）。 */
const DEFAULTS = {
  id: 'whip',
  streaks: 26,          // 斜向速度线的条数
  dir: [1, 0.12],       // 甩的方向（uv 空间）—— 注意 Pass 构造里的默认值 [1, 0.15] 是另一回事，不要动
};

export function whipShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,
    handlesTransition: true,

    setup(ctx) {
      const P = ctx.P;
      // 把 under 揉成一团甩过去：方向性模糊 + 缩放 + 边缘拉伸
      this.whip = new Pass(ctx.gl, /* glsl */ `
      uniform sampler2D under;
      uniform float k;        // 0 → 1 转场进度
      uniform vec2  dir;      // 甩的方向（uv 空间）
      void main() {
        vec2 uv = vUv;
        // 越接近中段，采样拉得越长（运动模糊）
        float amt = sin(k * PI) * 0.06;
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 10; i++) {
          float f = float(i) / 9.0;
          vec2 o = dir * (f - 0.5) * amt * (0.35 + uv.y);
          float w = 1.0 - abs(f - 0.5) * 0.7;
          acc += texture(under, clamp(uv + o, 0.0, 1.0)).rgb * w;
          wsum += w;
        }
        vec3 col = acc / wsum;
        col *= 1.0 - 0.25 * smoothstep(0.5, 1.0, k);
        col *= mix(1.0, 0.15, smoothstep(0.6, 1.0, k));
        col += C_SIGNAL * 0.25 * smoothstep(0.75, 1.0, k) * (1.0 - smoothstep(0.9, 1.0, k));
        fragColor = vec4(max(col, vec3(0.0)), 1.0);
      }`, { under: { value: null }, k: 0, dir: [1, 0.15] }, { key: 'demo_whip', blend: false });
    },

    render(ctx) {
      const { f, gl, P, lines } = ctx;
      const { W, H } = gl;

      // 转场进度：优先用 tin（与上一段重叠时的入场进度），没有 under 就当作普通场景
      const k = ctx.under ? ease.inOutCubic(f.tin) : 1;

      gl.clear(ctx.out, [0, 0, 0]);
      if (ctx.under) {
        this.whip.u.under.value = { tex: ctx.under.tex ?? ctx.under, __tex: true };
        this.whip.u.k.value = k;
        this.whip.u.dir.value = o.dir;
        this.whip.render(gl, ctx.out, f.t, f.dt);
      }

      // 斜向速度线：转场最激烈的时候最亮
      const energy = Math.sin(Math.min(1, k) * Math.PI);
      lines.begin();
      for (let i = 0; i < o.streaks; i++) {
        const seed = i * 0.37;
        const y0 = ((seed * 977) % 1) * H;
        const len = 220 + ((seed * 331) % 1) * 520;
        const x0 = ((seed * 613) % 1) * W - len * 0.3;
        const a = energy * (0.35 + 0.65 * ((seed * 149) % 1));
        lines.seg(x0, y0, x0 + len, y0 - len * 0.12, 1.5 + 2.5 * a,
          [P.bone[0] * a, P.bone[1] * a, P.bone[2] * a]);
      }
      // 一道信号色的主轴
      lines.seg(-100 + k * (W + 200), H * 0.5, -100 + k * (W + 200) + 400, H * 0.5 - 60, 5, P.signal);
      lines.flush(ctx.out);

      return {
        bloom: 0.6,
        halation: 0.4,
        grain: 0.05,
        // 注意：径向模糊（radialBlur/blur）与色差（ca）在最终合成里是互斥的——
        // 只要开了径向模糊，整段色差就被跳过。甩镜这里要的是"拉丝"，所以选径向模糊。
        radialBlur: 0.8 * energy,
        shake: [Math.sin(f.t * 90) * 14 * energy, Math.cos(f.t * 77) * 10 * energy],
        fade: 0.35 * Math.max(0, k - 0.75) * 4,
        exposure: 1 + 0.25 * energy,
      };
    },
  };
}

whipShot.defaults = DEFAULTS;
whipShot.meta = {
  name: 'whip',
  summary: '甩镜转场：把上一段的成帧（ctx.under）按方向性模糊甩走，叠一层斜向速度线与一道信号色主轴，配径向模糊 + 震屏。',
  notes: '这是**转场镜头**，时间线里要写 cut(whip, { dur, overlap, handlesTransition: true })，'
    + '它读 ctx.under（上一段的成帧）来做甩镜。没有 under 时按 k = 1 画普通一帧（画面几乎是黑的 + 速度线），'
    + '所以单独播这一段（--only whip）看起来是"甩到头"的样子，属正常。'
    + 'dir 是 uv 空间的甩动方向；Pass 构造里那个 [1, 0.15] 是 demo 原文的初始 uniform 默认值，'
    + '每帧都会被 dir 覆盖，改它没有效果。'
    + '⚠ 自己声明了 handlesTransition，所以不要再让引擎做交叉溶解（会两屏叠一起）。',
  // ⚠ params 的 name 集合必须与 DEFAULTS 的键集合**完全相等**（tools/test-shots.mjs 会断言）
  use: '两段之间要速度感：把上一段的成帧甩走（必须和上一段交叠）',
  energy: '高',
  avoid: '文字多的切点（甩动的字会糊成一片）；不能单独当一段画面',
  params: [
    { name: 'id', type: 'string', desc: '段名（HUD / --only / 报错里用它）' },
    { name: 'streaks', type: 'number', desc: '斜向速度线的条数' },
    { name: 'dir', type: '[number, number]', desc: '甩的方向（uv 空间，如 [1, 0.12]）' },
  ],
};

/**
 * 声明式 spec（`docs/ENGINE.md` §14.9；`anim shots --json` 与 `check` 的依赖前置校验读它）。
 *
 * `requires: ['under']` 的依据：`render()` 里 `const k = ctx.under ? ease.inOutCubic(f.tin) : 1;`
 * （`whip.js:69`）—— 它把**上一段的成帧**当源纹理甩走，所以时间线上必须与上一段交叠
 * （§14.4：`cut(whip, { dur, overlap, handlesTransition: true })`）。
 * `under` **已经接线**（2026-10-16，BACKLOG 头部 ② 的收口）：它不是靠任务源码的静态扫描判的
 * （交叠是**时间线层**的声明：多行对象 / `seq()` / `--only` 之后的段表都不一样，文本扫描判不准），
 * 而是靠**时间线展开之后的段级审计** —— `shot()` 把这个 `requires` 搬到场景对象上
 * （`src/shots/index.js`），`src/timeline.js` 的 `auditUnderRequires()` 再按段判"它到底有没有
 * 上一段可以甩"，由 `check` / `anim audit` 打印（没有交叠 ⇒ **硬问题**，退出码 1；
 * 第 1 段 / `--only` 之后没得比 ⇒ 进 `skipped`，明说"没验"）。
 * `outputs.visual = 'transition'` 的依据是它读 `ctx.under` 而不是自己铺底（`whip.js:71-76`）。
 */
whipShot.spec = {
  params: { id: 'string', streaks: 'number', dir: '[number, number]' },
  requires: ['under'],
  outputs: { visual: 'transition', handlesTransition: true },
};

/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
whipShot.tags = ['transition'];
whipShot.w = 1.0;
whipShot.fits = transitionOnly;
whipShot.fitsNote = '只抽转场位（slot: transition）';
