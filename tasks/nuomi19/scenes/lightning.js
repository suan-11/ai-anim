// 雷霆特效 · 小糯米渡劫
// 纯代码：确定性闪电折线 + 雨幕 + 闪白/震屏/色差。没有图片、没有视频素材。
import { makeShot } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';

const TAU = Math.PI * 2;

export default makeShot('thunder_nuomi', {
  setup(ctx) {
    const { W, H } = ctx.gl;
    const r = ctx.rng(19);
    this.rain = Array.from({ length: 90 }, () => ({
      x: r() * W,
      y: r() * H,
      len: 18 + r() * 48,
      speed: 0.55 + r() * 0.9,
    }));

    this.bolts = Array.from({ length: 10 }, (_, i) => {
      const baseX = W * (0.08 + 0.84 * ((i + 0.35 + r() * 0.3) / 10));
      const points = [];
      let x = baseX;
      let y = -40;
      for (let j = 0; j <= 11; j += 1) {
        x += (r() - 0.5) * W * 0.045;
        y = (H + 80) * (j / 11) - 40;
        points.push([x, y]);
      }
      const branches = [];
      for (let b = 0; b < 3; b += 1) {
        const at = points[3 + Math.floor(r() * 7)];
        if (!at) continue;
        let bx = at[0];
        let by = at[1];
        const branch = [];
        for (let j = 0; j < 5; j += 1) {
          bx += (r() - 0.5) * W * 0.05;
          by += 30 + r() * 70;
          branch.push([bx, by]);
        }
        branches.push(branch);
      }
      return {
        points,
        branches,
        start: 0.15 + i * 0.48 + r() * 0.12,
        life: 0.28 + r() * 0.12,
        width: 1.2 + r() * 1.6,
      };
    });
  },

  draw(ctx, { enter }) {
    const { f, gl, P, text, type, comp, lines } = ctx;
    const { W, H } = gl;
    const lt = f.lt;

    gl.clear(ctx.out, [0.004, 0.006, 0.016]);

    // 雨幕：斜向短线，速度是 t 的纯函数
    lines.begin();
    for (const drop of this.rain) {
      const y = (drop.y + lt * 620 * drop.speed) % (H + 80) - 40;
      const x = drop.x + y * 0.08;
      lines.seg(x, y, x - 8, y + drop.len, 1, [0.06, 0.18, 0.28]);
    }
    lines.flush(ctx.out);

    let flash = 0;
    lines.begin();
    for (const bolt of this.bolts) {
      const age = lt - bolt.start;
      if (age < 0 || age > bolt.life) continue;
      const grow = Math.min(1, age / 0.12);
      const fade = Math.max(0, 1 - age / bolt.life);
      flash += fade * 0.9;

      const count = Math.max(2, Math.floor(bolt.points.length * grow));
      const core = [1.7, 2.5, 2.9];
      const glow = [0.25, 0.85, 1.15].map((v) => v * fade);
      const branchColor = [0.45, 1.2, 1.6].map((v) => v * fade);

      for (let i = 1; i < count; i += 1) {
        const [x1, y1] = bolt.points[i - 1];
        const [x2, y2] = bolt.points[i];
        lines.seg(x1, y1, x2, y2, 9, glow);
        lines.seg(x1, y1, x2, y2, 2.2, core.map((v) => v * fade));
      }
      for (const branch of bolt.branches) {
        const n = Math.max(2, Math.floor(branch.length * grow));
        for (let i = 1; i < n; i += 1) {
          const [x1, y1] = branch[i - 1];
          const [x2, y2] = branch[i];
          lines.seg(x1, y1, x2, y2, 5, glow);
          lines.seg(x1, y1, x2, y2, 1.2, branchColor);
        }
      }
    }
    lines.flush(ctx.out);

    // 标题：闪电亮起时被照亮，仍保持可读
    text.clear();
    type.writeLine('小糯米渡劫', W / 2, H * 0.44, {
      anchor: 'center',
      size: Math.round(W * 0.082),
      weight: 900,
      family: 'sans',
      color: css(P.bone),
      ...enter(0.12),
    });
    type.writeLine('THUNDER / 第 9 条命', W / 2, H * 0.55, {
      anchor: 'center',
      size: Math.round(W * 0.014),
      weight: 600,
      family: 'mono',
      color: css(P.signal),
      ...enter(0.2),
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    const pulse = Math.max(0, Math.sin(lt * 7.1) * 0.04);
    return {
      flash: Math.min(1, flash) * 0.06,
      shake: [Math.min(1, flash) * 16, -Math.min(1, flash) * 10],
      zoom: 1 + Math.min(1, flash) * 0.02,
      ca: Math.min(1, flash) * 0.6,
      bloom: 0.65,
      bloomThreshold: 0.72,
      grain: 0.03 + pulse,
      vignette: 0.55,
    };
  },
});
