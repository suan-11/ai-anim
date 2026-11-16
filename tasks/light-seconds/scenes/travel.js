import { keys, prog, rng, css, sat } from '../../../src/core/util.js';

// 一束光向外走：屏幕时间 → 光行时间（对数式推进），里程碑依次点亮。
// 与「深渊下潜」刻意反着来：亮底 / 横向 / 线稿 —— 结构、风格、题材都不同（反收敛）。
const LT_KEYS = [[0, 0], [1.6, 0], [4, 1.3], [5.4, 1.3], [9, 499], [10.4, 499], [14, 1.32e8], [20, 1.32e8]];
const PX_KEYS = [[0, 0.08], [1.6, 0.08], [4, 0.30], [5.4, 0.32], [9, 0.55], [10.4, 0.57], [14, 0.80], [20, 0.84]];
const MILE = [
  { x: 0.30, t: 4, name: '月球', val: '1.3 秒' },
  { x: 0.55, t: 9, name: '太阳', val: '8.3 分钟' },
  { x: 0.80, t: 14, name: '比邻星', val: '4.2 年' },
];
function fmtTime(s) {
  if (s < 60) return s.toFixed(1) + ' 秒';
  if (s < 3600) return (s / 60).toFixed(1) + ' 分钟';
  return (s / (365.25 * 24 * 3600)).toFixed(1) + ' 年';
}
export default {
  id: 'light-seconds',
  setup(ctx) {
    const r = rng(11);
    this.motes = [];
    for (let i = 0; i < 46; i++) this.motes.push({ x: r() * ctx.W, y: r() * ctx.H, s: 6 + r() * 16, ph: r() * 6.28, rad: 0.8 + r() * 1.6 });
  },
  render(ctx) {
    const t = ctx.f.t;
    const { W, H, P, text } = ctx;
    const lt = keys(t, LT_KEYS);
    const px = keys(t, PX_KEYS) * W;
    const y = H * 0.56;
    const x0 = W * 0.08;

    text.clear();
    const c = text.ctx;
    c.fillStyle = '#fbfbfd'; c.fillRect(0, 0, W, H);

    // 极淡的全屏浮尘（持续微动，画面不死气）
    c.fillStyle = 'rgba(31,111,235,0.10)';
    for (const m of this.motes) {
      const mx = (m.x + t * m.s) % (W + 20) - 10;
      const my = m.y + 5 * Math.sin(t * 0.4 + m.ph);
      c.beginPath(); c.arc(mx, my, m.rad, 0, 6.283); c.fill();
    }

    // 光路
    c.strokeStyle = 'rgba(16,24,40,0.12)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x0, y); c.lineTo(W * 0.9, y); c.stroke();
    c.strokeStyle = css(P.signal, 0.9); c.lineWidth = 4;
    c.beginPath(); c.moveTo(x0, y); c.lineTo(px, y); c.stroke();

    // 沿光路流动的光子
    const span = px - x0;
    if (span > 24) {
      c.fillStyle = 'rgba(31,111,235,0.55)';
      for (let i = 0; i < 16; i++) {
        const fx = x0 + ((t * 300 + i * (span / 16)) % span);
        c.beginPath(); c.arc(fx, y, 3, 0, 6.283); c.fill();
      }
    }

    // 里程碑
    c.textAlign = 'center';
    for (const m of MILE) {
      const mx = m.x * W;
      const on = prog(t, m.t, m.t + 0.6);
      c.strokeStyle = css(P.signal, 0.25 + 0.75 * on); c.lineWidth = 3;
      c.beginPath(); c.moveTo(mx, y - 16); c.lineTo(mx, y + 16); c.stroke();
      c.fillStyle = css(P.signal, on);
      c.beginPath(); c.arc(mx, y, 7 + 3 * on, 0, 6.283); c.fill();
      if (on > 0.01) {
        c.fillStyle = `rgba(16,24,40,${on})`; c.font = '600 34px sans-serif';
        c.fillText(m.name, mx, y - 60);
        c.font = '30px sans-serif'; c.fillStyle = `rgba(31,111,235,${on})`;
        c.fillText(m.val, mx, y + 70);
      }
    }

    // 光头波前环（持续扩散）
    for (let k = 0; k < 3; k++) {
      const ph = ((t * 1.1 + k / 3) % 1);
      const rr = 12 + ph * 66;
      c.strokeStyle = `rgba(31,111,235,${0.35 * (1 - ph)})`; c.lineWidth = 2;
      c.beginPath(); c.arc(px, y, rr, 0, 6.283); c.stroke();
    }
    const glow = c.createRadialGradient(px, y, 0, px, y, 46);
    glow.addColorStop(0, 'rgba(31,111,235,0.55)');
    glow.addColorStop(1, 'rgba(31,111,235,0)');
    c.fillStyle = glow; c.beginPath(); c.arc(px, y, 46, 0, 6.283); c.fill();
    c.fillStyle = css(P.signal, 1); c.beginPath(); c.arc(px, y, 11, 0, 6.283); c.fill();

    // 顶部读数
    c.textAlign = 'left';
    c.fillStyle = 'rgba(16,24,40,0.7)'; c.font = '600 40px sans-serif';
    c.fillText('光 · 299 792 km/s', 140, 150);
    c.fillStyle = '#101828'; c.font = '700 110px monospace';
    c.fillText(fmtTime(lt), 140, 268);
    c.fillStyle = 'rgba(16,24,40,0.55)'; c.font = '30px sans-serif';
    c.fillText('光已经走了', 140, 318);

    const endA = prog(t, 16.5, 17.2) * (1 - prog(t, 19.4, 20));
    if (endA > 0.01) {
      c.fillStyle = `rgba(31,111,235,${endA})`; c.font = '600 46px sans-serif';
      c.fillText('光是最快的东西 · 但宇宙更大', 140, H - 120);
    }

    text.upload();
    ctx.comp.draw(ctx.gl, text, ctx.out, { premult: false });
    const fade = sat((1 - prog(t, 0, 0.7)) + prog(t, 19.5, 20));
    return { grain: 0.02, vignette: 0.06, bloom: 0.10, fade };
  },
};
