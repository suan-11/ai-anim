// @ts-check
/**
 * 镜头模板：`lineart` —— **一笔线稿**：一条折线按弧长自己画出来，笔尖带着当前节点的名字（BACKLOG 1-48）。
 *
 * 和 `chart` 的区别：chart 画的是"按值比高低"的柱，lineart 画的是**一件事接一件事**的形状
 * （流程 / 时间线 / 路径 / 生长曲线）。它刻意不画坐标轴、不标数值 —— 数值该给 `chart` / `counter`。
 *
 * 三个细节是手写时最容易漏的：
 *   1. **按弧长画**（`polylineLengths` + `pointAtLength`），不是按点数 —— 否则长段走得快、短段走得慢；
 *   2. **走过的节点留在原地**（小圆点 + 一根短刻度），笔尖当前所在的那个节点才有名字；
 *   3. 整条路径先以"幽灵线"（很淡）铺一遍，观众一开始就知道这条路有多长。
 *
 * ```js
 * export default shot('lineart', { labels: '采集|清洗|建模|校验|发布' });
 * ```
 */


import { contentOk, atMost } from './pick.js';
import { Pass } from '../core/gl.js';
import { css, ease, prog, clamp, polylineLengths, pointAtLength } from '../core/util.js';

/** 全部参数 = "什么都不传时的画面"。`points` 是**归一化**坐标（0..1，按内容框映射）。 */
const DEFAULTS = {
  id: 'lineart',
  kicker: 'LINEART / 一笔线稿',
  points: [0.05, 0.78, 0.27, 0.55, 0.46, 0.66, 0.66, 0.36, 0.84, 0.46, 0.97, 0.20],
  labels: '采集|清洗|建模|校验|发布',
  footer: '一步接一步 —— 走过的节点留在原地',
};

/** 把参数里的归一化点映射到内容框；点数不足时退回默认，保证画得出来。 */
function pathOf(src, box) {
  const arr = Array.isArray(src) ? src.map(Number).filter((v) => Number.isFinite(v)) : [];
  const flat = arr.length >= 4 && arr.length % 2 === 0 ? arr : DEFAULTS.points;
  const pts = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    pts.push([box.x + box.w * clamp(flat[i], 0, 1), box.y + box.h * clamp(flat[i + 1], 0, 1)]);
  }
  return pts;
}

/**
 * @param {{ id?: string, kicker?: string, points?: number[], labels?: string, footer?: string }} [opts]
 * @returns {any} 场景对象
 */
export function lineartShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,

    setup(ctx) {
      const P = ctx.P;
      // 整帧背景：墨底 + 竖向淡网格（"坐标纸"）+ 左上角一团弱光
      this.bg = new Pass(ctx.gl, /* glsl */ `
        uniform vec3 ink, ink2, graphite, signal;
        void main() {
          vec2 p = FRAG_PX / RES_LOGICAL;
          vec3 col = mix(ink, ink2, smoothstep(0.0, 1.0, p.y));
          vec2 d = abs(fract(FRAG_PX / 80.0) - 0.5) * 80.0;
          vec2 w = vec2(fwidth(FRAG_PX.x), fwidth(FRAG_PX.y));
          float grid = 1.0 - smoothstep(min(w.x, w.y), min(w.x, w.y) * 2.5, min(d.x, d.y));
          float glow = exp(-pow((p.x - 0.16) * 2.8, 2.0) - pow((p.y - 0.24) * 3.2, 2.0));
          if (luma(ink) > 0.25) {
            col = mix(col, graphite, grid * 0.22);
            col = mix(col, signal, glow * 0.05);
          } else {
            col += graphite * grid * 0.075;
            col += signal * glow * 0.035;
          }
          col += (hash12(FRAG_PX + fract(t) * 43.0) - 0.5) * 0.010;
          fragColor = vec4(col, 1.0);
        }`, {
        ink: P.ink, ink2: P.ink2, graphite: P.graphite, signal: P.signal,
      }, { key: 'shot_lineart_bg', blend: false });
    },

    render(ctx) {
      const { f, gl, P, text, type, comp, lines, grid } = ctx;
      const { W, H } = gl;
      const t = f.lt;

      this.bg.render(gl, ctx.out, f.t, f.dt);

      const tokens = ctx.style?.tokens ?? {};
      const rule = tokens.rule ?? { hair: 1, body: 2.5, hero: 6 };
      const pad = grid?.pad ?? Math.round(W * 0.0625);
      const tagY = grid?.top ?? 92;
      const footerY = grid?.footerY ?? 1018;
      const contentBottom = grid?.contentBottom ?? Math.round(H * 0.833);

      const box = {
        x: pad + Math.round(W * 0.020),
        y: Math.round(H * 0.30),
        w: W - pad * 2 - Math.round(W * 0.040),
        h: contentBottom - Math.round(H * 0.30),
      };
      const pts = pathOf(o.points, box);
      const acc = polylineLengths(pts);
      const total = acc[acc.length - 1] || 1;

      // 画到哪：一条时间轴（t=0.5 → 3.6 秒走完），任意 seek 都对
      const p = ease.inOutCubic(prog(t, 0.5, 3.6));
      const drawn = total * p;

      lines.begin();

      // 1) 幽灵线：整条路径先铺一遍（很淡），让观众知道这条路有多长
      for (let i = 1; i < pts.length; i++) {
        lines.seg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], 1.5,
          [P.graphite[0], P.graphite[1], P.graphite[2], 0.40]);
      }

      // 2) 已画出的部分：按弧长切段，最后一段只画到 drawn
      for (let i = 1; i < pts.length; i++) {
        if (drawn <= acc[i - 1]) break;
        const a = pts[i - 1];
        const [bx, by] = drawn >= acc[i]
          ? pts[i]
          : pointAtLength(pts, acc, drawn).slice(0, 2);
        lines.seg(a[0], a[1], bx, by, (rule.body ?? 2.5) * 1.4, P.bone);
      }

      // 3) 走过的节点：小圆点 + 一根短刻度（上下各一半）；还没走到的只画一个空圈
      const labels = String(o.labels ?? '').split('|').map((s) => s.trim()).filter(Boolean);
      pts.forEach(([x, y], i) => {
        const reached = drawn >= acc[i] - 0.001;
        if (reached) {
          lines.seg(x, y - 11, x, y + 11, 1.5, [P.bone[0], P.bone[1], P.bone[2], 0.75]);
          lines.circle(x, y, 5.5, 2, P.bone, 20);
        } else {
          lines.circle(x, y, 4.5, 1.2, [P.graphite[0], P.graphite[1], P.graphite[2], 0.85], 20);
        }
      });

      // 4) 笔尖：当前点上的信号色光点 + 一圈扩散的环（环也是 p 的函数，可回放）
      const [hx, hy] = pointAtLength(pts, acc, drawn).slice(0, 2);
      const halo = 10 + 26 * clamp(1 - p, 0, 1);
      lines.circle(hx, hy, halo * 0.45, 1.5, [P.signal[0], P.signal[1], P.signal[2], 0.55], 24);
      lines.circle(hx, hy, halo, 1, [P.signal[0], P.signal[1], P.signal[2], 0.22], 32);
      lines.circle(hx, hy, 6.5, 2.5, P.signal, 24);

      // 5) 内容框四角角标（版式，不是主线）
      const corner = 16;
      const ec = [P.graphite[0], P.graphite[1], P.graphite[2], 0.55];
      for (const [cx, cy, sx, sy] of [
        [box.x, box.y, 1, 1], [box.x + box.w, box.y, -1, 1],
        [box.x, box.y + box.h, 1, -1], [box.x + box.w, box.y + box.h, -1, -1],
      ]) {
        lines.seg(cx, cy, cx + corner * sx, cy, 1.5, ec);
        lines.seg(cx, cy, cx, cy + corner * sy, 1.5, ec);
      }
      lines.flush(ctx.out);

      // 6) 文字：笔尖带着"当前节点"的名字（一屏只有这一块字在跟着动）
      text.clear();
      type.write(String(o.kicker ?? ''), pad, tagY, {
        size: 22, family: 'mono', tracking: 6, color: css(P.signal, 0.9),
      });
      // 当前节点 = 最后一个已经走过的点（没走到第一个点时就是第一个）
      let cur = 0;
      for (let i = 0; i < pts.length; i++) if (drawn >= acc[i] - 0.001) cur = i;
      const name = labels[Math.min(cur, labels.length - 1)] ?? '';
      if (name) {
        // 标签放在笔尖右上方；靠近右边时翻到左侧，免得顶出画面
        const right = hx + 120 < box.x + box.w;
        type.writeLine(name, right ? hx + 16 : hx - 16, hy - 18, {
          size: 26, family: 'mono', tracking: 2, color: css(P.bone, 0.95),
          anchor: right ? 'left' : 'right',
          alpha: [0.0, 1], t: t - 0.6,
        });
      }
      type.writeLine(String(o.footer ?? ''), Math.round(W / 2), footerY, {
        size: 24, family: 'mono', color: css(P.ash, 0.85), anchor: 'center',
        alpha: [0, 1], t: t - 1.6,
      });
      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      return {
        bloom: 0.30,
        bloomThreshold: 1.0,
        halation: 0.18,
        grain: 0.030,
        vignette: 0.44,
      };
    },
  };
}

lineartShot.defaults = DEFAULTS;
lineartShot.meta = {
  name: 'lineart',
  summary: '一笔线稿：一条折线按弧长自己画出来，走过的节点留小圆点与刻度，笔尖带一个信号色光点与当前节点的名字（幽灵线先铺出全貌）。',
  notes: '背景是自带的整帧 Pass（key `shot_lineart_bg`），不需要时间线的 world。'
    + '`points` 是**归一化**坐标（0..1，成对出现），按内容框映射 —— 换画幅不用重算数字。'
    + '`labels` 用 `|` 分隔，按顺序对到节点；节点数多于标签时多出来的节点不标名字。'
    + '画线用的是**弧长**（`polylineLengths` / `pointAtLength`），不是点数 —— 否则长段走得快、短段走得慢。'
    + '它不画坐标轴、不标数值：要比高低用 `chart`，要读一个数用 `counter`。',
  use: '流程 / 时间线 / 路径 / 生长曲线 —— 一件事接一件事的**形状**',
  energy: '中低',
  avoid: '需要读出具体数值或比较高低时（改用 chart / counter）；节点超过 7 个时名字会挤在一起',
  params: [
    { name: 'id', type: 'string', desc: '段名（HUD / --only / 报错里用它）' },
    { name: 'kicker', type: 'string', desc: '左上眉标' },
    { name: 'points', type: 'number[]', desc: '归一化坐标（0..1，x,y 成对）；长度不足 4 或奇数时退回默认路径' },
    { name: 'labels', type: 'string', desc: '节点名字，用 | 分隔，按顺序对到节点（空串则不标名字）' },
    { name: 'footer', type: 'string', desc: '底部一行（页脚带里，最后淡入；空串则不画）' },
  ],
};

/**
 * 声明式 spec（docs/ENGINE.md §14.9）。
 *
 * requires: [] —— 只读 f.lt / P / 参数与自带背景 Pass。
 * outputs.visual = 'full-frame' —— setup() 里的整帧背景 Pass。
 */
lineartShot.spec = {
  params: {
    id: 'string', kicker: 'string', points: 'number[]', labels: 'string', footer: 'string',
  },
  requires: [],
  outputs: { visual: 'full-frame', handlesTransition: false },
};

/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
lineartShot.tags = ['flow', 'handmade', 'graphic'];
lineartShot.w = 0.8;
lineartShot.fits = (q) => contentOk(q) && atMost(q?.points, 7);
lineartShot.fitsNote = '≤7 个节点（points）；收尾位/转场位抽不到';
