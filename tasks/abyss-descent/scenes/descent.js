import { keys, prog, rng, css, sat, lerp } from '../../../src/core/util.js';

// 一次连续下潜：深度 / 黑暗 / 压强全是 t 的纯函数。没有"段"，只有一台往下走的摄影机。
const DEPTH_KEYS = [[0, 0], [2, 0], [7, 1000], [9, 1000], [14, 4000], [16, 4000], [21, 10935], [26, 10935]];
const MAXD = 11000;

const BEATS = [
  [0.4, 3.0, '海平面', '一切从 0 米开始'],
  [3.4, 6.8, '阳光层', '光还能照进来的地方'],
  [7.2, 9.0, '1000 米', '最后一缕阳光消失'],
  [9.4, 13.6, '午夜层', '从此只有黑暗'],
  [14.0, 16.0, '4000 米', '深渊平原'],
  [16.4, 20.6, '把珠峰放进来', '8849 米的珠峰，头顶还有约 2 公里海水'],
  [21.0, 23.4, '挑战者深渊', '地球最深处 · 10935 米'],
  [23.6, 26.0, '压强 ≈ 1086 bar', '约为海面的 1000 倍'],
];

export default {
  id: 'abyss-descent',
  setup(ctx) {
    const r = rng(7);
    this.snow = [];
    for (let i = 0; i < 90; i++) {
      this.snow.push({ x: r() * ctx.W, y: r() * ctx.H, rad: 0.7 + r() * 2.1, drift: 18 + r() * 46, ph: r() * 6.28 });
    }
  },
  render(ctx) {
    const t = ctx.f.t;
    const { W, H, P, text, type } = ctx;
    const depth = keys(t, DEPTH_KEYS);
    const surface = 1 - sat(depth / 1200);           // 阳光在 1200m 内耗尽
    const deep = sat(depth / MAXD);

    text.clear();
    const c = text.ctx;
    // 背景：随深度变暗的海水梯度
    const top = [lerp(3, 14, surface), lerp(8, 58, surface), lerp(16, 96, surface)];
    const bot = [lerp(1, 4, surface), lerp(3, 16, surface), lerp(7, 32, surface)];
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgb(${top[0] | 0},${top[1] | 0},${top[2] | 0})`);
    g.addColorStop(1, `rgb(${bot[0] | 0},${bot[1] | 0},${bot[2] | 0})`);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // 海洋雪：相对下潜向上漂（确定性，位置是 t 的函数）
    const snowA = 0.10 + 0.22 * sat(depth / 4000);
    c.fillStyle = `rgba(214,232,246,${snowA})`;
    for (const p of this.snow) {
      const y = ((p.y - t * p.drift) % (H + 40) + (H + 40)) % (H + 40) - 20;
      const x = p.x + 6 * Math.sin(t * 0.5 + p.ph);
      c.beginPath(); c.arc(x, y, p.rad, 0, 6.283); c.fill();
    }

    // 右侧深度标尺
    const gx = W - 150, gy0 = 150, gy1 = H - 150;
    c.strokeStyle = 'rgba(160,200,230,0.35)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(gx, gy0); c.lineTo(gx, gy1); c.stroke();
    c.fillStyle = 'rgba(160,200,230,0.55)'; c.font = '24px sans-serif'; c.textAlign = 'left';
    for (let d = 0; d <= MAXD; d += 2000) {
      const y = gy0 + (d / MAXD) * (gy1 - gy0);
      c.beginPath(); c.moveTo(gx - 10, y); c.lineTo(gx + 10, y); c.stroke();
      c.fillText(String(d), gx + 20, y + 8);
    }
    const my = gy0 + (depth / MAXD) * (gy1 - gy0);
    c.fillStyle = css(P.signal, 1);
    c.beginPath(); c.moveTo(gx - 26, my); c.lineTo(gx - 6, my - 9); c.lineTo(gx - 6, my + 9); c.closePath(); c.fill();
    c.fillRect(gx - 6, my - 2, 20, 4);

    // 珠峰对比（16.4–20.6s）：两根柱，真实数字
    const everA = prog(t, 16.4, 17.0) * (1 - prog(t, 20.0, 20.6));
    if (everA > 0.01) {
      const bx = 150, by = 980, bh = 240;
      const eh = (8849 / 10935) * bh;
      c.globalAlpha = everA;
      c.fillStyle = 'rgba(120,160,190,0.55)';
      c.fillRect(bx, by - eh, 100, eh);
      c.fillStyle = css(P.signal, 0.9);
      c.fillRect(bx + 250, by - bh, 100, bh);
      c.fillStyle = 'rgba(214,232,246,0.9)'; c.font = '26px sans-serif';
      c.fillText('珠峰 8849 m', bx, by + 36);
      c.fillText('深渊 10935 m', bx + 250, by + 36);
      c.globalAlpha = 1;
    }

    // 大号深度读数（等宽，逐帧更新）
    type.write(Math.round(depth) + ' m', 140, 210, { size: 120, weight: 700, family: 'mono', color: css(P.bone, 1) });

    // 叙事节拍
    for (const [a, b, title, sub] of BEATS) {
      if (t < a || t > b) continue;
      const al = prog(t, a, a + 0.5) * (1 - prog(t, b - 0.5, b));
      type.write(title, 140, 430, { size: 66, weight: 700, family: 'sans', color: css(P.signal, al) });
      type.write(sub, 140, 505, { size: 34, weight: 400, family: 'sans', color: css(P.bone, al * 0.9) });
    }

    text.upload();
    ctx.comp.draw(ctx.gl, text, ctx.out, { premult: false });

    const fade = sat((1 - prog(t, 0, 0.8)) + prog(t, 25.2, 26));
    return { grain: 0.05, vignette: 0.42, bloom: 0.12, fade };
  },
};
