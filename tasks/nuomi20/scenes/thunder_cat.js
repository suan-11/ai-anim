// 雷霆猫娘 · 小糯米渡劫
// 纯代码：雨幕 + 分叉闪电 + 猫耳/猫脸霓虹轮廓 + 眼睛发光 + 雷击闪白/震屏。
import { makeShot } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';

export default makeShot('thunder_cat', {
  setup(ctx) {
    const { W, H } = ctx.gl;
    const r = ctx.rng(23);
    this.rain = Array.from({ length: 110 }, () => ({
      x: r() * W,
      y: r() * H,
      len: 16 + r() * 54,
      speed: 0.5 + r() * 0.9,
    }));
    this.bolts = Array.from({ length: 9 }, (_, i) => {
      const x0 = W * (0.08 + 0.84 * ((i + 0.3 + r() * 0.4) / 9));
      const points = [];
      let x = x0;
      let y = -30;
      for (let j = 0; j <= 12; j += 1) {
        x += (r() - 0.5) * W * 0.04;
        y = (H + 60) * (j / 12) - 30;
        points.push([x, y]);
      }
      return {
        points,
        start: 0.1 + i * 0.58 + r() * 0.12,
        life: 0.3 + r() * 0.12,
        width: 1 + r() * 1.5,
      };
    });
  },

  draw(ctx, { enter }) {
    const { f, gl, P, text, type, comp, lines } = ctx;
    const { W, H } = gl;
    const lt = f.lt;

    gl.clear(ctx.out, [0.003, 0.005, 0.014]);

    // 雨
    lines.begin();
    for (const d of this.rain) {
      const y = (d.y + lt * 650 * d.speed) % (H + 80) - 40;
      const x = d.x + y * 0.06;
      lines.seg(x, y, x - 7, y + d.len, 1, [0.05, 0.16, 0.24]);
    }
    lines.flush(ctx.out);

    // 闪电束
    let flash = 0;
    lines.begin();
    for (const b of this.bolts) {
      const age = lt - b.start;
      if (age < 0 || age > b.life) continue;
      const grow = Math.min(1, age / 0.1);
      const fade = Math.max(0, 1 - age / b.life);
      flash += fade;
      const n = Math.max(2, Math.floor(b.points.length * grow));
      for (let i = 1; i < n; i += 1) {
        const [x1, y1] = b.points[i - 1];
        const [x2, y2] = b.points[i];
        lines.seg(x1, y1, x2, y2, 10, [0.12, 0.55, 0.9].map((v) => v * fade));
        lines.seg(x1, y1, x2, y2, 2, [1.7, 2.4, 2.8].map((v) => v * fade));
      }
    }
    lines.flush(ctx.out);

    // 猫脸/猫耳轮廓
    const cx = W * 0.5;
    const cy = H * 0.47;
    const r = H * 0.20;
    const rx = r;
    const ry = r * 0.82;
    const pts = [];
    for (let i = 0; i <= 44; i += 1) {
      const a = (i / 44) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    const ears = [
      [[cx - rx * 0.82, cy - ry * 0.62], [cx - rx * 0.98, cy - ry * 1.5], [cx - rx * 0.3, cy - ry * 0.86]],
      [[cx + rx * 0.82, cy - ry * 0.62], [cx + rx * 0.98, cy - ry * 1.5], [cx + rx * 0.3, cy - ry * 0.86]],
    ];
    const glow = [0.08, 0.5, 0.9];
    const bone = [1.4, 1.8, 2.2];

    lines.begin();
    const stroke = (path, width, color, closed = false) => {
      for (let i = 1; i < path.length; i += 1) {
        const [x1, y1] = path[i - 1];
        const [x2, y2] = path[i];
        lines.seg(x1, y1, x2, y2, width, color);
      }
      if (closed) {
        const [x1, y1] = path[path.length - 1];
        const [x2, y2] = path[0];
        lines.seg(x1, y1, x2, y2, width, color);
      }
    };
    for (const layer of [[16, glow], [3, bone]]) {
      stroke(pts, layer[0], layer[1], true);
      for (const ear of ears) stroke(ear, layer[0], layer[1], true);
    }

    // 眼睛：杏仁形 + 竖瞳
    const eyeY = cy - ry * 0.12;
    for (const side of [-1, 1]) {
      const ex = cx + side * rx * 0.38;
      const eye = [
        [ex - rx * 0.18, eyeY],
        [ex, eyeY - ry * 0.13],
        [ex + rx * 0.18, eyeY],
        [ex, eyeY + ry * 0.1],
      ];
      stroke(eye, 12, [0.7, 0.35, 0.05], true);
      stroke(eye, 2.5, [2.2, 1.2, 0.15], true);
      lines.seg(ex, eyeY - ry * 0.1, ex, eyeY + ry * 0.09, 2.2, [1.8, 0.7, 0.05]);
    }

    // 鼻/嘴/胡须
    lines.seg(cx, cy + ry * 0.16, cx, cy + ry * 0.24, 2, bone);
    lines.seg(cx, cy + ry * 0.24, cx - rx * 0.12, cy + ry * 0.32, 2, bone);
    lines.seg(cx, cy + ry * 0.24, cx + rx * 0.12, cy + ry * 0.32, 2, bone);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i += 1) {
        const y = cy + ry * (0.08 + i * 0.09);
        lines.seg(cx + side * rx * 0.48, y, cx + side * rx * (0.95 + i * 0.05), y - 8 + i * 6, 1.2, [0.5, 0.75, 0.95]);
      }
    }
    lines.flush(ctx.out);

    // 文字
    text.clear();
    type.writeLine('小糯米渡劫', W / 2, H * 0.83, {
      anchor: 'center',
      size: Math.round(W * 0.034),
      weight: 800,
      family: 'sans',
      color: css(P.bone),
      ...enter(0.2),
    });
    type.writeLine('THUNDER / NUOMI', W / 2, H * 0.88, {
      anchor: 'center',
      size: Math.round(W * 0.010),
      weight: 600,
      family: 'mono',
      color: css(P.signal),
      ...enter(0.3),
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return {
      flash: Math.min(1, flash) * 0.05,
      shake: [Math.min(1, flash) * 14, -Math.min(1, flash) * 9],
      zoom: 1 + Math.min(1, flash) * 0.018,
      ca: Math.min(1, flash) * 0.7,
      bloom: 0.8,
      bloomThreshold: 0.62,
      grain: 0.03,
      vignette: 0.6,
    };
  },
});
