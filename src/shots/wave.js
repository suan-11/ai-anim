// @ts-check
/**
 * 镜头模板：`wave` —— 波形（音频包络驱动的历史窗口）。
 *
 * ```js
 * export default shot('wave', { id: 'intro' });   // BEAT 那个任务的段名叫 intro
 * ```
 *
 * 注意原文读的是**整片时间** `f.t`（不是段内时间 `f.lt`）：这个镜头放在时间线的哪个
 * 位置，读到的就是那一刻的音乐包络。beat 的这段在片头，所以两者相同 —— 别顺手改成 `f.lt`。
 */


import { musicOk } from './pick.js';
import { css } from '../core/util.js';

/** 全部参数 = "什么都不传时的画面"（beat 用的就是这一套）。 */
const DEFAULTS = {
  id: 'wave',
  label: 'BEAT',       // 左上角那行等宽小字
  cols: 240,           // 波形竖线的条数
  window: 1.2,         // 显示最近多少秒
};

/**
 * @param {{ id?: string, label?: string, cols?: number, window?: number }} [opts]
 * @returns {any} 场景对象
 */
export function waveShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,

    render(ctx) {
      const { f, gl, P, text, type, comp, lines, music } = ctx;
      const { W, H } = gl;
      const t = f.t;
      const a = f.a;   // 音频特征快照：rms/low/mid/high/vocal/kick/snare/hat

      // 背景亮度跟着整体响度走
      const bg = 0.5 + a.rms * 1.6;
      gl.clear(ctx.out, [P.ink[0] * bg, P.ink[1] * bg, P.ink[2] * bg]);

      // 波形：直接查音频包络数组（music.rms / low / high 都是每帧一个值）
      const midY = H * 0.5;
      const cols = o.cols;
      lines.begin();
      for (let i = 0; i < cols; i++) {
        // 时间窗：以当前时刻为右端，向左 1.2 秒
        const tt = Math.max(0, t - o.window + (o.window * i) / cols);
        const fi = Math.min(music.rms.length - 1, Math.round(tt * music.fps));
        const env = music.rms[fi] ?? 0;
        const lowE = music.low[fi] ?? 0;
        const highE = music.high[fi] ?? 0;
        const x = (W * i) / (cols - 1);
        const h = 20 + env * 300 + lowE * 90;
        const near = i / cols;   // 越靠右（越接近现在）越亮
        const col = near > 0.94 ? P.signal : [P.bone[0] * near, P.bone[1] * near, P.bone[2] * near];
        lines.seg(x, midY - h * 0.5 - highE * 40, x, midY + h * 0.5 + highE * 40, 2 + near * 1.5, col);
      }

      // 每个 kick 打一道横线（用的是真实打击事件，不是节拍网格）
      const kicks = music.hits('kick', t - 2.2, t);
      for (const k of kicks) {
        const e = Math.exp(-(t - k.t) / 0.5);
        lines.seg(0, H * 0.5 - e * 340, W, H * 0.5 - e * 340, 1.5,
          [P.signal[0] * e, P.signal[1] * e, P.signal[2] * e]);
      }
      lines.flush(ctx.out);

      // 文字：拍号 + bpm + 三条频段读数
      text.clear();
      const beat = f.beat;
      type.write(o.label, 70, 100, { size: 22, family: 'mono', tracking: 6, color: css(P.signal, 0.9) });
      type.write((beat % 4).toFixed(2), 70, 190, { size: 84, weight: 800, family: 'mono', color: css(P.bone) });
      type.write(`bar ${Math.floor(beat / 4)}   ${music.bpm.toFixed(1)} bpm`, 70, 236, {
        size: 22, family: 'mono', tracking: 3, color: css(P.ash),
      });

      const bands = [['LOW', a.low, P.signal], ['MID', a.mid, P.bone], ['HIGH', a.high, P.ash]];
      bands.forEach(([name, val, col], i) => {
        const y = H - 190 + i * 46;
        type.write(String(name), W - 430, y, { size: 20, family: 'mono', tracking: 4, color: css(P.ash) });
        type.write('█'.repeat(Math.round(val * 30)).padEnd(30, '░'), W - 340, y, {
          size: 20, family: 'mono', color: css(col, 0.9),
        });
      });
      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      return {
        bloom: 0.35 + a.high * 0.3,
        halation: 0.2,
        grain: 0.035,
        vignette: 0.4,
        // 鼓点闪一下 + 轻微位移，这是"有劲儿"的来源
        flash: a.kick * 0.05,
        shake: [a.kick * 3, a.snare * 2],
        exposure: 1 + a.rms * 0.15,
      };
    },
  };
}

waveShot.defaults = DEFAULTS;

waveShot.meta = {
  name: 'wave',
  summary: '波形：以当前时刻为右端的历史窗口，逐列查音频包络数组画竖线，kick 事件打横线。',
  notes: '**需要音乐**：task.config.mjs 里配 `audio`，并先跑 `node scripts/anim.mjs analyze <任务>`。'
    + '它读 `ctx.music` 的包络数组（`rms` / `low` / `high`，每帧一个值、按 `music.fps` 索引）'
    + '与 `music.hits(\'kick\', t - 2.2, t)` 的真实打击事件，以及 `music.bpm`。'
    + '没有音乐分析结果时 `music` 为空、画面会黑。'
    + '读的是整片时间 `f.t`，不是段内时间。'
    + 'beat 那个任务的段名是 `intro`，所以那边写 `shot(\'wave\', { id: \'intro\' })`。',
  use: '讲声音/节奏本身，要让观众"看见拍子"',
  energy: '中',
  avoid: '任务没配 audio（会黑）；旁白为主、音乐很弱的段落',
  params: [
    { name: 'id', type: 'string', desc: '段名（--only / HUD / 报错里用它）' },
    { name: 'label', type: 'string', desc: '左上角那行等宽小字' },
    { name: 'cols', type: 'number', desc: '波形竖线的条数' },
    { name: 'window', type: 'number', desc: '显示最近多少秒' },
  ],
};

/**
 * 声明式 spec（`docs/ENGINE.md` §14.9；`anim shots --json` 与 `check` 的依赖前置校验读它）。
 *
 * `requires: ['music', 'analyze']` 的**依据是逐行代码**，不是散文：
 *   · `music.rms[fi]` / `music.low[fi]` / `music.high[fi]`（`wave.js:53-56`）—— 包络数组；
 *   · `music.hits('kick', t - 2.2, t)`（`wave.js:65`）—— 真实打击事件；
 *   · `music.bpm.toFixed(1)`（`wave.js:78`）。
 * `ctx.music` 是引擎给的 `SILENT`（空音乐：单帧 0 包络 + 空事件表）时这些都不报错，
 * 画面只会是"一屏很暗的短线"—— 所以这件事必须在**开浏览器之前**报出来。
 * `outputs.visual = 'full-frame'` 的依据是 `gl.clear(ctx.out, …)`（`wave.js:44`）。
 */
waveShot.spec = {
  params: { id: 'string', label: 'string', cols: 'number', window: 'number' },
  requires: ['music', 'analyze'],
  outputs: { visual: 'full-frame', handlesTransition: false },
};

/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
waveShot.tags = ['music', 'data'];
waveShot.w = 0.9;
waveShot.fits = musicOk;
waveShot.fitsNote = '要音频（hasMusic !== false）；收尾位/转场位抽不到';
