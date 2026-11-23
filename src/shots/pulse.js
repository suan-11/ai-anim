// @ts-check
/**
 * 镜头模板：`pulse` —— 同心圆 + 中心方块（每拍扩一圈的脉冲）。
 *
 * ```js
 * export default shot('pulse', { title: '节奏不需要手抄' });
 * ```
 *
 * 注意原文读的是**段内时间** `f.lt`（不是整片时间）：同心圆的年龄是相对本段开头的。
 */


import { musicOk } from './pick.js';
import { css, prog } from '../core/util.js';

/** 全部参数 = "什么都不传时的画面"（beat 用的就是这一套）。 */
const DEFAULTS = {
  id: 'pulse',
  title: '节奏不需要手抄',
};

/**
 * @param {{ id?: string, title?: string }} [opts]
 * @returns {any} 场景对象
 */
export function pulseShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,

    render(ctx) {
      const { f, gl, P, text, type, comp, lines, music } = ctx;
      const { W, H } = gl;
      const t = f.lt;
      const a = f.a;
      const rhythm = f.rhythm;

      const field = [P.bg[0] * 0.8, P.bg[1] * 0.8, P.bg[2] * 0.8];
      gl.clear(ctx.out, field);

      const cx = W * 0.5, cy = H * (rhythm ? 0.42 : 0.46);
      lines.begin();
      if (rhythm) {
        const { beat_role: role, intensity, info_density: density, resistance, elapsed, progress } = rhythm;
        const reach = 60 + intensity * 54;
        // 阻力越高，扩散花的时间越长。回落与收束都从事件起点直接计算。
        const release = role === 'release' ? prog(elapsed, 0, 0.85 + 2.4 * resistance, 'outCubic') : 0;
        const gather = role === 'pressure' ? progress ** (1 + 2 * resistance) : 0;
        const decay = role === 'residue' ? 1 - prog(progress, 0, 1, 'outQuad') : 1 - progress * 0.45;
        // The crest travels during the whole event. Its rebound dies at the block boundary.
        const rebound = Math.sin(progress * Math.PI * 4) * Math.sin(progress * Math.PI);
        const frontRadius = role === 'release' ? 92 + release * 192 + progress * 94 + 78 * rebound
          : role === 'residue' ? 378 - 136 * progress ** 1.45 + 68 * rebound
          : 242 - 125 * (0.25 * progress + 0.75 * gather) + 52 * rebound;
        const frontWidth = role === 'release' ? 48 + intensity * 12
          : role === 'residue' ? 108 - 58 * progress : 50 + (12 + intensity * 12) * (0.3 * progress + 0.7 * gather);
        const frontLight = (0.35 + 0.055 * intensity) * (0.63 + 0.37 * decay);
        lines.fillCircle(cx, cy, frontRadius + frontWidth * 0.5, P.signal.map((c) => c * frontLight), 2);
        lines.fillCircle(cx, cy, frontRadius - frontWidth * 0.5, field, 2);
        lines.circle(cx, cy, frontRadius, 2 + intensity, P.ember, 96);
        const spacing = (28 + release * reach * 0.088) * (1 - gather * 0.62);
        for (let i = 1; i <= density + 1; i++) {
          const radius = 58 + i * spacing + release * reach * 0.17;
          const light = (0.22 + release * 0.58) * (0.4 + 0.6 * decay) / Math.sqrt(i);
          lines.circle(cx, cy, radius, 1.5 + intensity * 0.38,
            [P.signal[0] * light, P.signal[1] * light, P.signal[2] * light], 96);
        }

        // The same core expands, winds back and gathers with the crest.
        const size = role === 'release' ? 52 + 68 * release - 16 * progress + 16 * rebound
          : role === 'residue' ? 104 - 29 * progress + 13 * rebound
          : 75 - 23 * gather + 10 * rebound;
        const angle = role === 'release' ? Math.PI * 0.5 * (release + 2 * progress)
          : role === 'residue' ? Math.PI * 0.5 * (3 - 0.5 * progress + 0.26 * rebound)
          : Math.PI * 0.5 * (2.5 - 0.5 * gather);
        const core = Array.from({ length: 4 }, (_, i) => {
          const a = angle + Math.PI * (0.25 + i * 0.5);
          return [cx + Math.cos(a) * size, cy + Math.sin(a) * size];
        });
        lines.fillPoly(core, P.signal.map((c) => c * 0.2), 2);
        lines.polyline(core, 4, P.bone, true);
        lines.circle(cx, cy, size * 0.35, 3, P.ember, 40);
      } else {
        for (let i = 0; i < 8; i++) {
          const kt = music.nearestBeat(t - (i + 1) * 0.5);
          const age = t - kt;
          if (age < 0 || age > 3.2) continue;
          const r = 60 + age * 340;
          const fade = Math.exp(-age / 1.2);
          const hit = music.hit('kick', kt + 0.001, 0.2);
          lines.circle(cx, cy, r, 1.5 + hit * 8,
            [P.signal[0] * fade, P.signal[1] * fade, P.signal[2] * fade], 96);
        }
        const s = 40 + a.low * 90;
        lines.rect(cx - s, cy - s, s * 2, s * 2, 3, P.bone);
        lines.circle(cx, cy, s * 0.6 + a.high * 30, 2, P.signal, 40);
      }
      lines.flush(ctx.out);

      // 文字
      text.clear();
      const titleAlpha = rhythm ? 1 - prog(t, 0.8, 1.65, 'inOutCubic') : 1;
      if (titleAlpha > 0) {
        type.write(o.title, W * 0.5, H * 0.86, {
          size: rhythm ? 42 : 64, weight: 700, family: 'sans', align: 'center',
          color: css(P.bone, titleAlpha), stagger: 0.06, from: 'up', dist: 40, t,
        });
      }
      const readout = rhythm
        ? `${rhythm.beat_role.toUpperCase()}  /  ${music.bpm.toFixed(1)} BPM`
        : `${music.beats.length} 拍 · ${music.kicks.length} kick · ${music.snares.length} snare`;
      type.write(readout, W * 0.5, H * 0.86 + 62, {
        size: rhythm ? 20 : 24, family: 'mono', tracking: 3, align: 'center', color: css(P.signal, rhythm ? 0.65 : 0.85),
      });
      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      return {
        bloom: rhythm ? 0.06 + 0.11 * rhythm.intensity : 0.5,
        bloomThreshold: 0.85,
        halation: 0.3,
        grain: rhythm ? 0 : 0.03,
        ...(rhythm ? { dither: 'off' } : { zoom: 1 + a.low * 0.02, shake: [a.kick * 4, -a.kick * 3], ca: a.kick * 0.4 }),
        vignette: 0.45,
      };
    },
  };
}

pulseShot.defaults = DEFAULTS;

pulseShot.meta = {
  name: 'pulse',
  summary: '同心圆：8 圈从最近 8 个拍点扩出去，中心方块跟着低频呼吸，底下是标题与拍数读数。',
  notes: '**需要音乐**：task.config.mjs 里配 `audio`，并先跑 `node scripts/anim.mjs analyze <任务>`。'
    + '它读 `ctx.music` 的 `nearestBeat` / `hit(\'kick\', …)` 与 `f.a` 的包络快照；没有音乐分析结果时画面会黑。'
    + '标题下面那行副标（`N 拍 · M kick · K snare`）是**从音频分析结果算出来的**'
    + '（`music.beats` / `music.kicks` / `music.snares` 的长度），不是参数 —— 换音乐它自己会变。'
    + '读的是段内时间 `f.lt`。',
  use: '强调节拍或周期性（心跳、脉冲、每一拍）',
  energy: '中低',
  avoid: '没有音乐的片子；需要精确读数时',
  params: [
    { name: 'id', type: 'string', desc: '段名（--only / HUD / 报错里用它）' },
    { name: 'title', type: 'string', desc: '底部那行标题' },
  ],
};

/**
 * 声明式 spec（`docs/ENGINE.md` §14.9；`anim shots --json` 与 `check` 的依赖前置校验读它）。
 *
 * `requires: ['music', 'analyze']` 的**依据是逐行代码**：
 *   · `music.nearestBeat(t - (i + 1) * 0.5)`（`pulse.js:45`）—— 拍点网格；
 *   · `music.hit('kick', kt + 0.001, 0.2)`（`pulse.js:50`）—— 真实打击事件；
 *   · `music.beats.length` / `music.kicks.length` / `music.snares.length`（`pulse.js:67`）—— 读数。
 * 空音乐（`SILENT`）时这些都不抛错，只是同心圆全都不出现（画面只剩中枢方块与文字）。
 * `outputs.visual = 'full-frame'` 的依据是 `gl.clear(ctx.out, …)`（`pulse.js:39`）。
 */
pulseShot.spec = {
  params: { id: 'string', title: 'string' },
  requires: ['music', 'analyze'],
  outputs: { visual: 'full-frame', handlesTransition: false },
};

/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
pulseShot.tags = ['music', 'structure'];
pulseShot.w = 0.8;
pulseShot.fits = musicOk;
pulseShot.fitsNote = '要音频（hasMusic !== false）；收尾位/转场位抽不到';
