// @ts-check
/**
 * 镜头模板：`grid` —— 频谱网格（把音频包络当数据源，逐格点亮）。
 *
 * ```js
 * export default shot('grid', { label: 'AUDIO → GEOMETRY' });
 * ```
 *
 * 注意原文读的是**段内时间** `f.lt`（不是整片时间）：窗口是相对本段开头的。
 */


import { musicOk } from './pick.js';
import { css, hash2 } from '../core/util.js';

/** 全部参数 = "什么都不传时的画面"（beat 用的就是这一套）。 */
const DEFAULTS = {
  id: 'grid',
  label: 'AUDIO → GEOMETRY',
  cols: 32,        // 列数
  rows: 12,        // 行数
  window: 2.2,     // 显示最近多少秒
};

/**
 * @param {{ id?: string, label?: string, cols?: number, rows?: number, window?: number }} [opts]
 * @returns {any} 场景对象
 */
export function gridShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,

    render(ctx) {
      const { f, gl, P, text, type, comp, lines, music } = ctx;
      const { W, H } = gl;
      const t = f.lt;
      const a = f.a;

      gl.clear(ctx.out, [P.bg[0], P.bg[1], P.bg[2]]);

      // 24×12 的格子，每格的历史波形取自包络数组（真的是「读数据」，不是随机）
      const cols = o.cols, rows = o.rows;
      const cw = W / cols, ch = (H * 0.68) / rows;
      const y0 = H * 0.10;
      const window = o.window;   // 显示最近 2.2 秒

      lines.begin();
      for (let x = 0; x < cols; x++) {
        const tt = Math.max(0, t - window + (window * x) / cols);
        const fi = Math.min(music.rms.length - 1, Math.round(tt * music.fps));
        // 每一列用一个频段，让画面有横向的结构
        const bandIdx = x % 3;
        const env = bandIdx === 0 ? (music.low[fi] ?? 0) : bandIdx === 1 ? (music.mid[fi] ?? 0) : (music.high[fi] ?? 0);
        const litRows = Math.round(env * rows);
        for (let y = 0; y < rows; y++) {
          const on = y < litRows;
          const px = x * cw, py = y0 + (rows - 1 - y) * ch;
          if (!on) {
            lines.rect(px + 3, py + 3, cw - 6, ch - 6, 1, [P.graphite[0] * 0.4, P.graphite[1] * 0.4, P.graphite[2] * 0.4]);
            continue;
          }
          // 点亮的格子：越高越偏信号色
          const k = y / rows;
          const col = [
            P.signal[0] * (0.5 + k) + P.ember[0] * (1 - k) * 0.3,
            P.signal[1] * (0.5 + k) + P.ember[1] * (1 - k) * 0.3,
            P.signal[2] * (0.5 + k) + P.ember[2] * (1 - k) * 0.3,
          ];
          // 用 hash 给每格一点点差异，避免死板
          const j = 0.75 + hash2(x, y) * 0.5;
          lines.rect(px + 3, py + 3, cw - 6, ch - 6, 1, [col[0] * j, col[1] * j, col[2] * j]);
        }
      }

      // 当前时刻的竖直扫描线
      const sx = W * 0.94;
      lines.seg(sx, y0, sx, y0 + rows * ch, 3, P.bone);
      lines.flush(ctx.out);

      // 文字：当前拍 + 四条读数
      text.clear();
      type.write(o.label, 60, 70, { size: 22, family: 'mono', tracking: 6, color: css(P.signal, 0.9) });
      type.write(`beat ${(f.beat % 4).toFixed(2)}`, 60, 130, { size: 34, family: 'mono', color: css(P.bone) });

      const readouts = [
        ['rms', a.rms], ['low', a.low], ['mid', a.mid], ['high', a.high],
        ['vocal', a.vocal], ['flux', a.flux],
      ];
      readouts.forEach(([name, v], i) => {
        const col = i % 3, row = Math.floor(i / 3);
        const x = 60 + col * 300, y = H - 150 + row * 38;
        type.write(`${String(name).padEnd(6)} ${v.toFixed(2)}`, x, y, {
          size: 22, family: 'mono', color: css(P.ash),
        });
      });
      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      return {
        bloom: 0.55,
        bloomThreshold: 0.8,
        halation: 0.32,
        grain: 0.03,
        vignette: 0.42,
        saturation: 1.05,
        shake: [a.kick * 5, a.snare * 3],
      };
    },
  };
}

gridShot.defaults = DEFAULTS;

gridShot.meta = {
  name: 'grid',
  summary: '频谱网格：每列一个频段（low/mid/high 轮换），按包络高度点亮格子，右侧一道扫描线，左下六条读数。',
  notes: '**需要音乐**：task.config.mjs 里配 `audio`，并先跑 `node scripts/anim.mjs analyze <任务>`。'
    + '它读 `ctx.music` 的包络数组（`rms` / `low` / `mid` / `high`，按 `music.fps` 索引）'
    + '与 `f.a` / `f.beat`；没有音乐分析结果时画面会黑。'
    + '⚠ 原文注释写「24×12 的格子」，但代码实际是 `cols = 32`：**32 才是出过片的那个值**，'
    + '`DEFAULTS.cols` 保持 32（`rows` 才是 12）。'
    + '读的是段内时间 `f.lt`。',
  use: '展示多路信号/频段的整体形态 —— 看整块，不读单值',
  energy: '中高',
  avoid: '要读单个数值时；无音频的任务',
  params: [
    { name: 'id', type: 'string', desc: '段名（--only / HUD / 报错里用它）' },
    { name: 'label', type: 'string', desc: '左上角那行等宽小字' },
    { name: 'cols', type: 'number', desc: '列数' },
    { name: 'rows', type: 'number', desc: '行数' },
    { name: 'window', type: 'number', desc: '显示最近多少秒' },
  ],
};

/**
 * 声明式 spec（`docs/ENGINE.md` §14.9；`anim shots --json` 与 `check` 的依赖前置校验读它）。
 *
 * `requires: ['music', 'analyze']` 的**依据是逐行代码**：
 *   · `music.rms.length` / `music.fps`（`grid.js:56`）与 `music.low/mid/high[fi]`（`grid.js:59`）
 *     —— 每一列的点亮高度全靠包络数组。
 * 空音乐（`SILENT`）时 `env` 恒为 0 ⇒ **一格都不会点亮**，画面只剩暗格与文字。
 * `outputs.visual = 'full-frame'` 的依据是 `gl.clear(ctx.out, …)`（`grid.js:45`）。
 */
gridShot.spec = {
  params: {
    id: 'string', label: 'string', cols: 'number', rows: 'number', window: 'number',
  },
  requires: ['music', 'analyze'],
  outputs: { visual: 'full-frame', handlesTransition: false },
};

/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
gridShot.tags = ['music', 'tech', 'data'];
gridShot.w = 0.8;
gridShot.fits = musicOk;
gridShot.fitsNote = '要音频（hasMusic !== false）；收尾位/转场位抽不到';
