// @ts-check
/**
 * 镜头模板：`compare` —— 对比镜头（同一批指标、两个版本，左右并排的两条水平条）。
 *
 * 与原有的 8 个模板不同：这一支是照 `src/shots/title.js` 的形状**新写**的（BACKLOG 0-5），
 * 没有"逐像素不变"的 hashes 基线可对。验收：`node tools/test-shots.mjs` + 出图看图。
 *
 * ```js
 * export default shot('compare', {
 *   aTitle: '优化前', bTitle: '优化后',
 *   rows: [{ label: '单帧耗时', a: 0.88, b: 0.34 }],
 * });
 * ```
 */


import { contentOk, within } from './pick.js';
import { Pass } from '../core/gl.js';
import { css, ease, prog, clamp } from '../core/util.js';
import { drawIcon } from '../kit/icons.js';

/** 全部参数 = "什么都不传时的画面"。rows 里每一项是 `{ label, a, b }`，a/b 都是 0..1。 */
const DEFAULTS = {
  id: 'compare',
  title: '优化前后',
  sub: 'COMPARE / 同一批指标，两个版本',
  aTitle: '优化前',
  bTitle: '优化后',
  rows: [
    { label: '单帧耗时', a: 0.88, b: 0.34 },
    { label: '峰值内存', a: 0.72, b: 0.46 },
    { label: '包体积', a: 0.61, b: 0.52 },
    { label: '首屏时间', a: 0.80, b: 0.28 },
  ],
  footer: '示意数据 —— 换成真实数值之前不要当结论',
  // 可选的行业图标（与 rows 同序；空数组 = 不画，旧画面逐像素不变）。
  // ⚠ 必须写在这里：shot() 的参数白名单就是 DEFAULTS —— 只写进 meta/spec 会报「没有参数 icons」。
  icons: [],
};

/**
 * @param {{ id?: string, title?: string, sub?: string, aTitle?: string, bTitle?: string,
 *           rows?: { label: string, a: number, b: number }[], footer?: string }} [opts]
 *   每个参数都可选；不传就用 `DEFAULTS`。
 * @returns {any} 场景对象（`{ id, setup, render }`，可以直接放进时间线）
 */
export function compareShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,

    setup(ctx) {
      // 整帧背景：墨底（上深下浅）+ 细横线（账本纸）+ 中轴一条极淡的亮带（分栏感）
      this.bg = new Pass(ctx.gl, /* glsl */ `
        void main() {
          vec2 p = FRAG_PX / RES_LOGICAL;
          vec3 col = mix(C_INK, C_INK2, smoothstep(0.0, 1.0, p.y));
          float band = abs(fract(FRAG_PX.y / 44.0) - 0.5) * 2.0;
          float w = fwidth(FRAG_PX.y / 44.0) * 1.5;
          float axis = 1.0 - smoothstep(0.0, 2.0, abs(FRAG_PX.x - RES_LOGICAL.x * 0.5));
          if (luma(C_INK) > 0.25) {
            col = mix(col, C_GRAPHITE, (1.0 - smoothstep(w, w * 3.0, band)) * 0.25);
            col = mix(col, C_SIGNAL, axis * 0.14);
          } else {
            col += C_GRAPHITE * (1.0 - smoothstep(w, w * 3.0, band)) * 0.16;
            col += C_SIGNAL * axis * 0.02;
          }
          col += (hash12(FRAG_PX + fract(t) * 37.0) - 0.5) * 0.012;
          fragColor = vec4(col, 1.0);
        }`, {}, { key: 'shot_compare_bg', blend: false });
    },

    render(ctx) {
      const { f, gl, P, text, type, comp, lines } = ctx;
      const { W, H } = gl;
      const t = f.lt;

      this.bg.render(gl, ctx.out, f.t, f.dt);

      const rows = Array.isArray(o.rows) ? o.rows : [];
      const n = Math.max(1, rows.length);

      const L = W * 0.10;
      // 每行可选一个图标（默认空数组 = 不画，旧画面逐像素不变）。
      // 图标画在行标签左侧，颜色跟调色板；用途：✅/❌/⚠ 这种"这一行是好是坏"的快速判读。
      const rowIcons = Array.isArray(o.icons) ? o.icons : [];
      const labelR = W * 0.30;          // 行标签右对齐到这里
      const trackX = W * 0.33;          // 条形的起点
      const trackW = W * 0.46;
      const valueX = trackX + trackW + 26;   // 右侧读数的左边缘
      const areaTop = H * 0.32;
      const areaBottom = H * 0.82;
      // 行高有上限、行区垂直居中：只有两行时不该把两行摊到整屏
      // （2026-10-16 出图看出来的 —— 两行版行距 270px，中间空掉一大片）。
      // 默认 4 行时 rowH = 135px，与加这条之前完全一样。
      const rowH = Math.min((areaBottom - areaTop) / n, H * 0.185);
      const top = areaTop + ((areaBottom - areaTop) - rowH * n) * 0.5;
      const barH = Math.min(18, rowH * 0.22);
      const gap = barH * 1.05;

      // 1) 标题 + 副标
      text.clear();
      type.writeLine(String(o.title == null ? '' : o.title), L, H * 0.155, {
        size: 52, weight: 700, family: 'sans', color: css(P.bone),
        stagger: 0.03, staggerDur: 0.6, from: 'none', t: t - 0.1,
      });
      type.writeLine(String(o.sub == null ? '' : o.sub), L, H * 0.155 + 40, {
        size: 20, family: 'mono', tracking: 4, color: css(P.ash),
        alpha: [0, 1], t: t - 0.45,
      });

      // 2) 图例（右上）：两个色块 + 两个名字，B 在右、A 在左
      const legendY = H * 0.165;
      const lx = W * 0.90;
      const nameA = String(o.aTitle == null ? '' : o.aTitle);
      const nameB = String(o.bTitle == null ? '' : o.bTitle);
      const wA = type.measure(nameA, { size: 24, weight: 600, family: 'sans' });
      const wB = type.measure(nameB, { size: 24, weight: 600, family: 'sans' });
      const bTextX = lx - wB;
      const bChipX = bTextX - 32;
      const aTextX = bChipX - 34 - wA;
      const aChipX = aTextX - 32;
      lines.begin();
      lines.fillRect(aChipX, legendY - 17, 18, 18, [P.ash[0], P.ash[1], P.ash[2], 0.55]);
      lines.fillRect(bChipX, legendY - 17, 18, 18, [P.signal[0], P.signal[1], P.signal[2], 0.95]);
      lines.flush(ctx.out);
      type.writeLine(nameA, aTextX, legendY, {
        size: 24, weight: 600, family: 'sans', color: css(P.ash), alpha: [0, 1], t: t - 0.6,
      });
      type.writeLine(nameB, bTextX, legendY, {
        size: 24, weight: 600, family: 'sans', color: css(P.bone), alpha: [0, 1], t: t - 0.7,
      });

      // 3) 每一行：标签 + 两条水平条（上 A 下 B）+ 右侧一组读数
      //    条形用 fillRect（一条批里的一次填充）；端点帽与分隔线是普通线段。
      lines.begin();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || {};
        const yc = top + rowH * (i + 0.5);
        const aV = clamp(Number(row.a) || 0);
        const bV = clamp(Number(row.b) || 0);
        const delay = 0.55 + i * 0.20;
        const ka = ease.outCubic(prog(t, delay, delay + 0.75));
        const kb = ease.outCubic(prog(t, delay + 0.16, delay + 0.91));
        const yA = yc - gap * 0.5 - barH;
        const yB = yc + gap * 0.5;

        // 轨道底线（条没长到的地方也看得见"刻度"）
        lines.seg(trackX, yA + barH * 0.5, trackX + trackW, yA + barH * 0.5, 1, P.graphite);
        lines.seg(trackX, yB + barH * 0.5, trackX + trackW, yB + barH * 0.5, 1, P.graphite);
        // A / B 的条
        if (ka > 0.001) {
          lines.fillRect(trackX, yA, trackW * aV * ka, barH, [P.ash[0], P.ash[1], P.ash[2], 0.5]);
        }
        if (kb > 0.001) {
          lines.fillRect(trackX, yB, trackW * bV * kb, barH, [P.signal[0], P.signal[1], P.signal[2], 0.9]);
        }
        // 到位后加一根端点帽（读数落位的那一下）
        if (ka > 0.995) lines.seg(trackX + trackW * aV, yA - 4, trackX + trackW * aV, yA + barH + 4, 2, P.ash);
        if (kb > 0.995) lines.seg(trackX + trackW * bV, yB - 4, trackX + trackW * bV, yB + barH + 4, 2.5, P.signal);
        // 行分隔线
        if (i < rows.length - 1) {
          const ya = yc + rowH * 0.5;
          lines.seg(L, ya, W * 0.90, ya, 1, [P.graphite[0] * 0.6, P.graphite[1] * 0.6, P.graphite[2] * 0.6]);
        }
      }
      lines.flush(ctx.out);

      // 4) 行标签与读数（文字层）
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || {};
        const yc = top + rowH * (i + 0.5);
        const aV = clamp(Number(row.a) || 0);
        const bV = clamp(Number(row.b) || 0);
        const delay = 0.55 + i * 0.20;
        // 可选的行业图标（icons[i]）：画在标签左侧；没给就什么都不画
        if (rowIcons[i]) {
          // 固定列：图标居中在 W*0.135，和右对齐的标签（labelR）之间留够空隙。
          // 之前把它放在 labelR 左侧 = 直接压在标签文字上，24px 时几乎看不见（实测）。
          const iconSize = Math.min(26, rowH * 0.32);
          const ap = clamp((t - delay) * 3);
          const iconCx = W * 0.135;
          drawIcon(lines, String(rowIcons[i]), iconCx - iconSize / 2,
            yc - iconSize / 2 + 4, iconSize, [P.ash[0], P.ash[1], P.ash[2], 0.9 * ap], { lw: 1.7 });
          // 图标是在第二次 flush 之后才加进批里的：这里立刻提交，否则这一段永远画不出来
          lines.flush(ctx.out);
        }
        type.writeLine(String(row.label == null ? '' : row.label), labelR, yc + 9, {
          size: 27, weight: 600, family: 'sans', color: css(P.bone),
          anchor: 'right', alpha: [0, 1], t: t - delay,
        });
        // 两个读数合成一行画（"88 → 34"）：这样一屏少 4 块字（docs/LAYOUT.md 的块数判据）
        type.writeLine(Math.round(aV * 100) + ' \u2192 ' + Math.round(bV * 100), valueX, yc + 8, {
          size: 24, family: 'mono', color: css(P.ash),
          alpha: [0, 1], t: t - (delay + 0.75),
        });
      }

      const footer = String(o.footer == null ? '' : o.footer);
      if (footer) {
        type.writeLine(footer, W * 0.5, H * 0.93, {
          size: 22, family: 'mono', tracking: 2, color: css(P.ash, 0.75),
          anchor: 'center', alpha: [0, 1], t: t - 2.2,
        });
      }

      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      return {
        bloom: 0.26,
        bloomThreshold: 1.1,
        halation: 0.14,
        grain: 0.04,
        vignette: 0.34,
        saturation: 0.98,
        contrast: 1.03,
      };
    },
  };
}

compareShot.defaults = DEFAULTS;
compareShot.meta = {
  name: 'compare',
  summary: '对比镜头：一行一个指标，指标名在左、两条水平条（上 A 灰 / 下 B 信号色）在中、'
    + '右侧一组读数（A → B），逐行长出来；顶部标题副标、右上图例、底部脚注。',
  notes: 'rows 里每一项是 { label, a, b }，a/b 是 0..1 的比例（画面上的读数是它的百分比取整）。'
    + '行数决定行高：默认 4 行时一行约 H*0.125；行数越多越挤，超过 6 行建议拆成两段。'
    + '⚠ 这是**信息型**镜头：一屏会有 8 块以上的字（标题 + 副标 + 图例 + 每行"标签 + 读数"），'
    + '超过 docs/LAYOUT.md 那个"一屏 ≤ 6 块"的软上限 —— 版面守门会 warn，那是读数不是错误；'
    + '要它安静就减行数，或者别把这段塞进"一屏只让观众看一件事"的位置。'
    + '背景是本模板自带的整帧 Pass（key shot_compare_bg），不需要时间线的 world。',
  // ⚠ params 的 name 集合必须与 DEFAULTS 的键集合**完全相等**（tools/test-shots.mjs 会断言）
  use: '2–4 个指标、两组值的对比（前后 / 方案 A vs B）',
  energy: '中低',
  avoid: '超过 4 行会挤；只有一组值时用 counter 或 chart',
  params: [
    { name: 'id', type: 'string', desc: '段名（HUD / --only / 报错里用它）' },
    { name: 'title', type: 'string', desc: '左上主标题（逐字入场）' },
    { name: 'sub', type: 'string', desc: '标题下的等宽副标（整行淡入）' },
    { name: 'aTitle', type: 'string', desc: 'A 条（上面那条、灰色）的图例名' },
    { name: 'bTitle', type: 'string', desc: 'B 条（下面那条、信号色）的图例名' },
    { name: 'rows', type: 'object[]', desc: '每行一个 { label, a, b }：a / b 都是 0..1 的比例' },
    { name: 'icons', type: 'string[]', desc: '可选的行业图标（与 rows 同序，名字见 anim icons）；不写就不画' },
    { name: 'footer', type: 'string', desc: '底部一行（脚注带里，最后淡入；空串则不画）' },
  ],
};

/**
 * 声明式 spec（docs/ENGINE.md §14.9；anim shots --json 与 check 的依赖前置校验读它）。
 *
 * requires: [] 的依据：render() 只读 f.lt / P / 参数与自带的背景 Pass ——
 * 条长与读数都是参数与 t 的纯函数，不读 ctx.music、不读 ctx.under。
 * outputs.visual = 'full-frame' 的依据是 setup() 里那张整帧背景 Pass。
 */
compareShot.spec = {
  params: {
    id: 'string', title: 'string', sub: 'string', aTitle: 'string', bTitle: 'string',
    rows: 'object[]', footer: 'string', icons: 'string[]',
  },
  requires: [],
  outputs: { visual: 'full-frame', handlesTransition: false },
};

/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
compareShot.tags = ['data', 'editorial'];
compareShot.w = 1.1;
compareShot.fits = (q) => contentOk(q) && within(q?.rows, 2, 4);
compareShot.fitsNote = '2–4 个指标（rows）；收尾位/转场位抽不到';
