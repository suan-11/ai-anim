// @ts-check
/**
 * 镜头模板：`scan` —— **扫描格阵**：一条扫描线从左走到右，走到的格子留下读数（BACKLOG 1-48）。
 *
 * 和 `grid` 的分工要说清楚，否则会被当成同一个模板：
 *   · `grid` 的亮度来自**音频包络**（`ctx.music`），必须配音乐 + 先跑 analyze，看的是"信号长什么样"；
 *   · `scan` 不读音频：它画的是**一次有序的读取**（扫描线 + 已经读过的格子留下的静态图案），
 *     格子的差异来自 `hash2(i, j)`（确定性伪随机，不是 Math.random），所以它哪里都能用。
 *
 * 动效只有一条时间轴：`sweep`（0..1）从 t=0.5 走到 4.0 秒，走完就停在右边界。
 * 每个格子的状态都只是 `sweep` 的函数 —— 扫过的格子**不会自己回退**，因为它们真的"被读过了"。
 *
 * ```js
 * export default shot('scan', { cols: 24, rows: 10, label: '已扫' });
 * ```
 */


import { contentOk } from './pick.js';
import { Pass } from '../core/gl.js';
import { css, ease, prog, clamp, mixColor, hash2 } from '../core/util.js';

/** 全部参数 = "什么都不传时的画面"。 */
const DEFAULTS = {
  id: 'scan',
  kicker: 'SCAN / 顺序读取',
  label: '已扫',
  cols: 26,
  rows: 12,
  footer: '扫描 = 一次有序的读取 · 走过的格子留在原地',
};

/**
 * @param {{ id?: string, kicker?: string, label?: string, cols?: number, rows?: number,
 *           footer?: string }} [opts]
 * @returns {any} 场景对象
 */
export function scanShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,

    setup(ctx) {
      const P = ctx.P;
      // 整帧背景：墨底 + 一层粗网格（"仪器面板"）+ 扫描线附近的一条竖向辉光（uniform 每帧更新）
      this.bg = new Pass(ctx.gl, /* glsl */ `
        uniform vec3 ink, ink2, graphite, signal;
        uniform float scanX, boxTop, boxBot;
        void main() {
          vec2 p = FRAG_PX / RES_LOGICAL;
          vec3 col = mix(ink, ink2, smoothstep(0.0, 1.0, p.y));
          // 粗网格：60 逻辑像素一格，靠 fwidth 保持"一根细线"
          vec2 d = abs(fract(FRAG_PX / 60.0) - 0.5) * 60.0;
          vec2 w = vec2(fwidth(FRAG_PX.x), fwidth(FRAG_PX.y));
          float grid = 1.0 - smoothstep(min(w.x, w.y), min(w.x, w.y) * 2.5, min(d.x, d.y));
          // 扫描线附近：只在内容框的纵向范围内发光，越靠线越亮
          float inside = step(boxTop, RES_LOGICAL.y - FRAG_PX.y) * step(RES_LOGICAL.y - FRAG_PX.y, boxBot);
          float band = exp(-pow((FRAG_PX.x - scanX) / 46.0, 2.0)) * inside;
          if (luma(ink) > 0.25) {
            col = mix(col, graphite, grid * 0.22);
            col = mix(col, signal, band * 0.14);
          } else {
            col += graphite * grid * 0.10;
            col += signal * band * 0.11;
          }
          col += (hash12(FRAG_PX + fract(t) * 41.0) - 0.5) * 0.011;
          fragColor = vec4(col, 1.0);
        }`, {
        ink: P.ink, ink2: P.ink2, graphite: P.graphite, signal: P.signal,
        scanX: -200, boxTop: 0, boxBot: 1080,
      }, { key: 'shot_scan_bg', blend: false });
    },

    render(ctx) {
      const { f, gl, P, text, type, comp, lines, grid } = ctx;
      const { W, H } = gl;
      const t = f.lt;

      const pad = grid?.pad ?? Math.round(W * 0.0625);
      const tagY = grid?.top ?? 92;
      const footerY = grid?.footerY ?? 1018;
      const L = pad;
      const R = W - pad;
      const T = Math.round(H * 0.235);
      const B = grid?.contentBottom ?? Math.round(H * 0.833);

      const cols = Math.round(clamp(Number(o.cols) || 26, 6, 64));
      const rows = Math.round(clamp(Number(o.rows) || 12, 3, 40));
      const cw = (R - L) / cols;
      const ch = (B - T) / rows;

      // 扫描进度：一条时间轴，只由 f.lt 决定（任意 seek 都对）
      const sweep = ease.inOutCubic(prog(t, 0.5, 4.0));
      const scanCol = sweep * cols;
      const scanX = L + scanCol * cw;

      this.bg.set({ scanX, boxTop: T, boxBot: B }).render(gl, ctx.out, f.t, f.dt);

      lines.begin();
      // 内容框：四角短角标（比整圈框更像仪表）
      const corner = Math.max(10, Math.min(22, Math.round(cw * 0.6)));
      const edge = [P.graphite[0], P.graphite[1], P.graphite[2], 0.9];
      for (const [cx, cy, sx, sy] of [[L, T, 1, 1], [R, T, -1, 1], [L, B, 1, -1], [R, B, -1, -1]]) {
        lines.seg(cx, cy, cx + corner * sx, cy, 2, edge);
        lines.seg(cx, cy, cx, cy + corner * sy, 2, edge);
      }

      // 格子：没扫到 = 只有一根细边；扫到 = 按 hash2 的值填一块，扫描线所在列偏信号色
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = L + i * cw;
          const y = T + j * ch;
          const v = hash2(i * 17 + 3, j * 23 + 7);      // 每格的"读数"，确定性
          const d = scanCol - (i + 0.5);
          const inset = Math.max(3, Math.round(Math.min(cw, ch) * 0.16));
          if (d <= 0) {
            // 还没读到：一根细边，越靠扫描线越亮（"马上要读到了"）
            const near = clamp(1 - Math.abs(scanCol - (i + 0.5)) / 3.0);
            const a = 0.18 + 0.40 * near;
            lines.rect(x + inset, y + inset, cw - inset * 2, ch - inset * 2, 1,
              [P.graphite[0] * (1 + near), P.graphite[1] * (1 + near), P.graphite[2] * (1 + near), a]);
            continue;
          }
          // 已读到：填一块（亮度 = 读数），刚扫过的几列叠一层信号色。
          // ⚠ 这里用**不透明**的调好的颜色，不用半透明 fillRect：fillRect 是"一叠胶囊"，
          //   相邻两条的柔边会互相叠加 ⇒ 半透明的块会出现横向条纹、而且比写的 alpha 亮得多
          //   （实测 a=0.1 就已经是中灰）。不透明 + 颜色里调亮度，才能画出"暗底上的暗块"。
          const hot = clamp(1 - d / 1.6);
          // 亮度只有 2%–12% 的骨白：暗底上的"读数块"，不是一屏灰砖（26% 就已经是中灰了）
          const base2 = mixColor(P.ink2, P.bone, 0.02 + 0.10 * v);
          const accent = v > 0.90 ? mixColor(base2, P.ember, 0.45) : base2;   // 极少数格子带一点热色
          const c = mixColor(accent, P.signal, hot * 0.70);
          lines.fillRect(x + inset, y + inset, cw - inset * 2, ch - inset * 2, [c[0], c[1], c[2], 1], 2);
        }
      }

      // 扫描线本体：一条信号色竖线 + 上下两个十字标（越过边界就收起，别贴着框外）
      if (scanCol > 0.001 && scanCol < cols - 0.001) {
        lines.seg(scanX, T - 10, scanX, B + 10, 2.5, P.signal);
        lines.seg(scanX - 7, T - 10, scanX + 7, T - 10, 2.5, P.signal);
        lines.seg(scanX - 7, B + 10, scanX + 7, B + 10, 2.5, P.signal);
      }
      lines.flush(ctx.out);

      // 文字层：页眉两条 + 页脚一条（页眉/页脚都在版面母题保留带里，不进版面判据）
      text.clear();
      type.write(String(o.kicker ?? ''), pad, tagY, {
        size: 22, family: 'mono', tracking: 6, color: css(P.signal, 0.9),
      });
      const pct = Math.round(Math.min(1, scanCol / cols) * 100);
      type.write(`${String(o.label ?? '已扫')} ${String(pct).padStart(3, ' ')}%`, W - pad, tagY, {
        size: 22, family: 'mono', tracking: 2, color: css(P.bone, 0.9), align: 'right',
      });
      type.writeLine(String(o.footer ?? ''), Math.round(W / 2), footerY, {
        size: 24, family: 'mono', color: css(P.ash, 0.85), anchor: 'center',
        alpha: [0, 1], t: t - 1.2,
      });
      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      return {
        bloom: 0.34,
        bloomThreshold: 1.0,
        halation: 0.20,
        grain: 0.030,
        vignette: 0.40,
      };
    },
  };
}

scanShot.defaults = DEFAULTS;
scanShot.meta = {
  name: 'scan',
  summary: '扫描格阵：扫描线从左到右，走过的格子按确定性读数填块、扫描线所在列偏信号色，右上角跟一个已扫百分比。',
  notes: '不读音乐（与 grid 的分工：grid 的亮度来自音频包络，scan 的来自 hash2 的确定性读数）。'
    + '背景是自带的整帧 Pass（key `shot_scan_bg`），不需要时间线的 world。'
    + '扫描只走一次（t=0.5 → 4.0 秒，inOutCubic），段长不足 4 秒会停在半路 —— 那也算"没扫完"，不是 bug。'
    + '读数百分比是**这一段自己的进度**，不是外部数据的统计值。',
  use: '把"逐格读取 / 覆盖 / 推进"这件事可视化 —— 一格一格来，看得见进度',
  energy: '中',
  avoid: '要读出具体数值（改用 counter / chart）；格数超过 40×20 时填充批次会变贵',
  params: [
    { name: 'id', type: 'string', desc: '段名（HUD / --only / 报错里用它）' },
    { name: 'kicker', type: 'string', desc: '左上眉标' },
    { name: 'label', type: 'string', desc: '右上读数的前缀（后面跟已扫百分比）' },
    { name: 'cols', type: 'number', desc: '列数（6..64）' },
    { name: 'rows', type: 'number', desc: '行数（3..40）' },
    { name: 'footer', type: 'string', desc: '底部一行（页脚带里，最后淡入；空串则不画）' },
  ],
};

/**
 * 声明式 spec（docs/ENGINE.md §14.9）。
 *
 * requires: [] —— 不读 ctx.music / ctx.under（与 grid 的本质区别）。
 * outputs.visual = 'full-frame' —— setup() 里那张整帧背景 Pass。
 */
scanShot.spec = {
  params: {
    id: 'string', kicker: 'string', label: 'string', cols: 'number', rows: 'number', footer: 'string',
  },
  requires: [],
  outputs: { visual: 'full-frame', handlesTransition: false },
};

/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
scanShot.tags = ['process', 'tech', 'graphic'];
scanShot.w = 0.7;
scanShot.fits = contentOk;
scanShot.fitsNote = '示意推进，无硬条件；收尾位/转场位抽不到';
