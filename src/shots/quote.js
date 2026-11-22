// @ts-check
/**
 * 镜头模板：`quote` —— 引言 / 引用镜头（大段引文 + 出处 + 一条生长的竖线）。
 *
 * 与仓库里原有的 8 个模板不同：这一支**不是**从某个已出片任务的场景里搬过来的，
 * 而是照 `src/shots/title.js` 的形状新写的（BACKLOG 0-5）。所以它没有
 * "逐像素不变"的 hashes 基线可对 —— 它的验收是两条：
 *   · `node tools/test-shots.mjs`（登记 / meta↔defaults / spec↔meta / 报错路径）；
 *   · `node scripts/anim.mjs still <任务> -t …` 出图，用眼睛看（新画面的唯一可靠验收）。
 *
 * ```js
 * export default shot('quote', { text: '…', cite: '出处' });
 * ```
 */


import { contentOk, atMost } from './pick.js';
import { Pass } from '../core/gl.js';
import { css, ease, prog } from '../core/util.js';

/** 全部参数 = "什么都不传时的画面"。 */
const DEFAULTS = {
  id: 'quote',
  label: 'NOTE',
  text: '把每一帧写成时间的函数，\n画面就成了一道可以求解的方程。',
  cite: 'anim · 设计手记',
  role: '确定性渲染',
  align: 'left',
};

/**
 * 一行的"视觉长度"：CJK / 全角算 1，其余（拉丁、数字、标点）算 0.55。
 * 只用来**选字号档位**，精确排版交给 type.wrap 的折行。
 */
function visualLen(s) {
  let n = 0;
  for (const ch of String(s)) {
    n += /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55;
  }
  return n;
}

/**
 * @param {{ id?: string, label?: string, text?: string, cite?: string,
 *           role?: string, align?: 'left'|'center' }} [opts]
 *   每个参数都可选；不传就用 `DEFAULTS`。
 * @returns {any} 场景对象（`{ id, setup, render }`，可以直接放进时间线）
 */
export function quoteShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,

    setup(ctx) {
      // 整帧背景：深墨底 + 45° 细排线 + 左上一点暖光。
      // 距离用 FRAG_PX（物理像素）算、线宽用 fwidth ⇒ 4K 下还是同样细的一根线。
      this.bg = new Pass(ctx.gl, /* glsl */ `
        void main() {
          vec2 p = FRAG_PX / RES_LOGICAL;
          vec2 c = p - vec2(0.42, 0.5);
          float r = length(c * vec2(RES_LOGICAL.x / RES_LOGICAL.y, 1.0));
          vec3 col = mix(C_INK2, C_INK, smoothstep(0.08, 0.98, r));
          float s = (FRAG_PX.x + FRAG_PX.y) * 0.5;
          float band = abs(fract(s / 26.0) - 0.5) * 2.0;
          float w = fwidth(s / 26.0) * 1.2;
          if (luma(C_INK) > 0.25) {
            col = mix(col, C_GRAPHITE, (1.0 - smoothstep(w, w * 3.0, band)) * 0.22);
            col = mix(col, C_SIGNAL, 0.04 * exp(-dot(c, c) * 5.0));
          } else {
            col += C_GRAPHITE * (1.0 - smoothstep(w, w * 3.0, band)) * 0.15;
            col += C_SIGNAL * 0.05 * exp(-dot(c, c) * 5.0);
          }
          col += (hash12(FRAG_PX + fract(t) * 71.0) - 0.5) * 0.012;
          fragColor = vec4(col, 1.0);
        }`, {}, { key: 'shot_quote_bg', blend: false });
    },

    render(ctx) {
      const { f, gl, P, text, type, comp, lines } = ctx;
      const { W, H } = gl;
      const t = f.lt;

      this.bg.render(gl, ctx.out, f.t, f.dt);

      const center = o.align === 'center';
      const padX = W * 0.13;
      const bodyX = center ? W * 0.5 : padX + 58;
      const maxW = W * (center ? 0.68 : 0.72);

      // 字号按"去掉空白后的字符数"分档：引文越长字越小，保证不溢出。
      // 分档是纯函数 ⇒ 同一个 text 在任何段长、任何帧上字号都一样（可重放）。
      // ⚠ 看的是**最长那一行**，不是总字数：text 里写了换行时，决定溢不溢出的永远是那一行。
      //   2026-10-16 出图修正 —— 第一版按总字数分档，三行的引文最长行 19 字拿到了 72px，
      //   那一帧直接顶到屏幕两边（out/_shots-lab/stills/f_0021.000.png 看得见）。
      let longest = 0;
      for (const para of String(o.text).split('\n')) longest = Math.max(longest, visualLen(para));
      const size = longest <= 12 ? 92 : longest <= 18 ? 78 : longest <= 26 ? 64 : longest <= 36 ? 52 : 42;
      const style = { size, weight: 600, family: 'sans' };
      const rows = type.wrap(o.text, style, maxW);
      const lh = size * 1.46;
      const y0 = H * 0.5 - (rows.length * lh) * 0.5 + size * 0.42;

      // 1) 矢量：竖线从上往下生长（左对齐），或一条短横线展开（居中）
      const grow = ease.outCubic(prog(t, 0.35, 1.25));
      const top = y0 - size * 1.04;
      const bot = y0 + (rows.length - 1) * lh + size * 0.36;
      lines.begin();
      if (center) {
        const hw = 110 * grow;
        lines.seg(bodyX - hw, top - 8, bodyX + hw, top - 8, 3, P.signal);
      } else {
        // 只有一根竖线：顶端那道横臂与排印引号是重复的信息（出图之后去掉的）
        lines.seg(padX, top, padX, top + (bot - top) * grow, 4, P.signal);
      }
      lines.flush(ctx.out);

      // 2) 文字层
      text.clear();

      // 眉标：放在页眉保留带里（y ≈ 10.5%H）—— 这一带不算"一屏几块字"（docs/LAYOUT.md）
      const label = String(o.label == null ? '' : o.label);
      if (label) {
        const typed = Math.floor(ease.outCubic(prog(t, 0.15, 1.3)) * label.length);
        type.write(label.slice(0, typed), padX, H * 0.105, {
          size: 26, family: 'mono', tracking: 7, color: css(P.signal, 0.95),
        });
      }

      // 排印引号：大字、低不透明度，只在左对齐时出现
      if (!center) {
        type.write('\u201C', padX - 16, y0 - size * 0.34, {
          size: size * 2.2, weight: 900, family: 'serif', color: css(P.signal, 0.15),
        });
      }

      // 引文：整行逐行上浮，行内再逐字（stagger）
      let li = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowY = y0 + i * lh;
        if (row) {
          type.writeLine(row, bodyX, rowY, {
            size, weight: 600, family: 'sans', color: css(P.bone),
            stagger: 0.028, staggerDur: 0.5, from: 'up', dist: 36,
            t: t - (0.5 + li * 0.18),
            anchor: center ? 'center' : 'left',
          });
        }
        li++;
      }

      // 出处：引文块下方，最后淡入（cite 主 + role 次）
      const citeY = bot + 86;
      const cite = String(o.cite == null ? '' : o.cite);
      const role = String(o.role == null ? '' : o.role);
      const roleStr = role ? '· ' + role : '';
      const roleStyle = { size: 24, family: 'mono', color: css(P.ash, 0.7), tracking: 1 };
      // 出处与角色画在**同一行**：center 时整组居中（先 measure 再摆），left 时紧跟在 cite 右边。
      // 2026-10-16 出图修正：center 原来让 role 另起一行 —— 多一块字、也让"一屏几块"更挤。
      const citeW = cite ? type.measure(cite, { size: 28, weight: 600, family: 'sans' }) : 0;
      const roleW = roleStr ? type.measure(roleStr, roleStyle) : 0;
      const gx = center ? W * 0.5 - (citeW + (roleStr ? 14 + roleW : 0)) * 0.5 : bodyX;
      if (cite) {
        type.writeLine(cite, gx, citeY, {
          size: 28, weight: 600, family: 'sans', color: css(P.ash),
          alpha: [0, 1], t: t - 1.25,
        });
      }
      if (roleStr) {
        type.writeLine(roleStr, gx + citeW + 14, citeY - 1, {
          ...roleStyle, alpha: [0, 1], t: t - 1.45,
        });
      }

      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      return {
        bloom: 0.30,
        bloomThreshold: 1.10,
        halation: 0.16,
        grain: 0.032,
        vignette: 0.44,
        exposure: 1 + 0.015 * Math.sin(t * 1.1),
      };
    },
  };
}

quoteShot.defaults = DEFAULTS;
quoteShot.meta = {
  name: 'quote',
  summary: '引言镜头：眉标逐字打出 + 一条生长的竖线 + 大段引文逐行上浮 + 出处署名淡入'
    + '（align: left 是左侧竖线 + 排印引号，center 是居中 + 上方短横线）。',
  notes: '引文的字号按**最长那一行**的视觉长度自动分档（CJK 算 1、拉丁与数字算 0.55：'
    + '<=12 给 92px、<=18 给 78、<=26 给 64、<=36 给 52、更长 42）—— 不是按总字数：'
    + '写了换行时决定溢不溢出的永远是那最长的一行。所以同一个 text 在任何段长下字号都一样；'
    + '想强制断行就在 text 里写反斜杠 n。'
    + '⚠ 切进来的**头 0.5 秒画面几乎只有背景**（引文第一行 t=0.5 才起步、眉标 0.15s 才开始打字）——'
    + '硬切到这里会看到半秒空场（`anim cuts` 的接触表上看得一清二楚）；要和上一段接得紧就写 overlap 0.5，'
    + '或者让上一段多留半秒。'
    + '⚠ 引文超过 4 行时"一屏几块字"会超过 6 块的软上限（docs/LAYOUT.md），'
    + 'check 的版面守门会 warn —— 那是读数不是错误。'
    + '背景是本模板自带的整帧 Pass（key shot_quote_bg），所以它自己铺满整帧，'
    + '不需要时间线的 world，也不能和别的模板叠在同一段。',
  // ⚠ params 的 name 集合必须与 DEFAULTS 的键集合**完全相等**（tools/test-shots.mjs 会断言）
  use: '引用一句话（人物 / 文档 / 结论），需要出处署名',
  energy: '低',
  avoid: '引文超过约 4 行；把旁白原句逐字抄进画面（lint-narration-dup 会点名）',
  params: [
    { name: 'id', type: 'string', desc: '段名（HUD / --only / 报错里用它）' },
    { name: 'label', type: 'string', desc: '左上眉标（等宽小字，逐字打出；空串则不画）' },
    { name: 'text', type: 'string', desc: '引文（反斜杠 n 是强制断行；过长自动折行且字号自动分档）' },
    { name: 'cite', type: 'string', desc: '出处署名（引文块下方，整行淡入）' },
    { name: 'role', type: 'string', desc: '署名的第二段（更小更暗；空串则不画）' },
    { name: 'align', type: 'string', desc: "'left'（默认：左侧竖线 + 排印引号）或 'center'（居中 + 上方短横线）" },
  ],
};

/**
 * 声明式 spec（docs/ENGINE.md §14.9；anim shots --json 与 check 的依赖前置校验读它）。
 *
 * requires: [] 的依据：render() 只读 f.lt / P / 参数与自带的背景 Pass ——
 * 不读 ctx.music、不读 ctx.under，省掉谁都不会让画面变黑。
 * outputs.visual = 'full-frame' 的依据是 setup() 里那张整帧背景 Pass。
 */
quoteShot.spec = {
  params: {
    id: 'string', label: 'string', text: 'string', cite: 'string', role: 'string', align: 'string',
  },
  requires: [],
  outputs: { visual: 'full-frame', handlesTransition: false },
};

/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
quoteShot.tags = ['editorial', 'calm', 'emotional'];
quoteShot.w = 1.1;
quoteShot.fits = (q) => contentOk(q) && atMost(q?.rows, 4);
quoteShot.fitsNote = '引文 ≤4 行（rows）；收尾位/转场位抽不到';
