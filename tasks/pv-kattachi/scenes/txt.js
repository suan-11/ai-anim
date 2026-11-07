// @ts-check
/**
 * PV 的字体场景：**不画人物**，一句话 + 一种字幕效果。
 *
 * 每种 mode 都是 `f.lt` 的纯函数（可 seek、可子帧）；节拍来自 `f.beat` / `f.a`，
 * 所以同一段在任何时刻重渲都一致。
 *
 * 直接用 `text.ctx`（Canvas2D）画，是因为下面这些效果 `type.write` 不覆盖：
 * 描边镂空 / 硬边揭示 / 三色错位 / 竖排 / 切片错行 / 叠影纵深。
 * `type.write` 只用在「逐字入场」这类它本来就擅长的地方。
 */

import { css, prog, sat, clamp, mixColor } from '../../../src/core/util.js';
import { Pass } from '../../../src/core/gl.js';

/** 主色：一句白，一句红。红只给关键词（避免满屏红） */
const INK = [0.94, 0.92, 0.88];

function hash(i, j) {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export default {
  id: 'txt',

  setup(ctx) {
    const Q = ctx.P;
    // 底：黑 + 极轻的横向扫描纹 + 中心微光（打字幕时底不能抢）
    this.bg = new Pass(ctx.gl, /* glsl */ `
      uniform vec3 cInk, cSig;
      uniform float pulse, scan;
      void main() {
        vec2 p = vUv;
        vec3 col = cInk * (0.86 + 0.14 * pulse);
        float line = step(0.5, fract(p.y * 240.0));
        col += vec3(0.02) * line * scan;
        float glow = exp(-pow(length((p - 0.5) * vec2(1.0, 1.4)) * 3.2, 2.0));
        col += cSig * glow * 0.05;
        col *= 1.0 - 0.45 * smoothstep(0.45, 1.15, length((p - 0.5) * vec2(1.0, 1.0)) * 1.4);
        fragColor = vec4(col, 1.0);
      }`, { cInk: Q.ink, cSig: Q.signal, pulse: 0, scan: 0.5 }, { key: 'pv_bg', blend: false });
  },

  render(ctx) {
    const { f, gl, P: Q, text, type, comp, lines, W, H } = ctx;
    const o = ctx.params ?? {};
    const mode = o.mode ?? 'mask';
    const t = f.lt;
    const sig = Q.signal;
    const beatPulse = f.a?.kick ?? 0;
    // 底：每拍泵一下（0 → 1）
    const pump = Math.pow(beatPulse, 1.6);
    this.bg.render(gl, ctx.out, f.t, f.dt);
    // 底再叠一个 pulse uniform 的做法不可行（Pass 参数在 setup 固定），所以用一层快速矩形闪光代替

    const c = text.ctx;
    text.clear();
    const size = o.size ?? Math.round(Math.min(W, H) * 0.2);
    const fam = o.family ?? 'sans';
    const weight = o.weight ?? 900;
    const main = String(o.text ?? '分かっちゃいないね');
    // 自适应字号：横向一句话必须塞进 84% 宽（216px × 10 字 ≈ 2400px，实测会左右出血）
    const fitW = (str, px, frac = 0.84) => {
      type.font({ size: px, weight, family: fam });
      const w = [...str].reduce((a, ch) => a + c.measureText(ch).width, 0);
      return w > W * frac ? Math.max(28, Math.floor((px * W * frac) / w)) : px;
    };
    const sub = String(o.sub ?? '');
    const cx = W / 2, cy = H / 2;
    const total = Math.max(0.4, f.end - f.start);
    const k = sat(t / total);

    /** 逐字位置 */
    const layout = (str, px) => {
      type.font({ size: px, weight, family: fam });
      const chars = [...str];
      const widths = chars.map((ch) => c.measureText(ch).width);
      const sum = widths.reduce((a, b) => a + b, 0);
      let x = cx - sum / 2;
      return chars.map((ch, i) => {
        const at = x;
        x += widths[i];
        return { ch, x: at, w: widths[i], i };
      });
    };

    const setFont = (px) => { type.font({ size: px, weight, family: fam }); };
    c.textBaseline = 'middle';
    c.textAlign = 'left';

    const drawStroke = (glyphs, px, color, lw = 2, alpha = 1) => {
      setFont(px);
      c.lineWidth = lw;
      c.strokeStyle = cssArr(color, alpha);
      for (const g of glyphs) c.strokeText(g.ch, g.x, cy);
    };
    const drawFill = (glyphs, px, color, alpha = 1) => {
      setFont(px);
      c.fillStyle = cssArr(color, alpha);
      for (const g of glyphs) c.fillText(g.ch, g.x, cy);
    };

    if (mode === 'mask') {
      // 硬边揭示：clip 从左往右推开，字先白后红点睛
      const px = fitW(main, size);
      const gl2 = layout(main, px);
      const reveal = sat(prog(t, 0.1, 1.0));
      c.save();
      c.beginPath();
      c.rect(0, 0, W * reveal, H);
      c.clip();
      drawFill(gl2, px, INK);
      c.restore();
      // 揭示边缘一道亮线
      if (reveal < 0.999) {
        lines.begin();
        lines.seg(W * reveal, H * 0.2, W * reveal, H * 0.8, 3, [sig[0], sig[1], sig[2], 0.85]);
        lines.flush(ctx.out);
      }
    } else if (mode === 'outline') {
      const px = fitW(main, size);
      // 描边镂空 → 后半段填色
      const gl2 = layout(main, px);
      const fillK = sat(prog(t, 0.9, 1.6));
      drawStroke(gl2, px, INK, 3);
      if (fillK > 0) drawFill(gl2, px, INK, fillK * 0.92);
    } else if (mode === 'glitch') {
      const px = fitW(main, size);
      // 三色错位 + 切片：每 2 帧换一次偏移，抖动量确定
      const gl2 = layout(main, px);
      const g = Math.floor(f.t * 12);
      const dx = (hash(g, 1) - 0.5) * 16;
      const dy = (hash(g, 2) - 0.5) * 8;
      c.globalAlpha = 0.85;
      c.save(); c.translate(dx, dy); drawFill(gl2, px, [sig[0], sig[1], sig[2]]); c.restore();
      c.save(); c.translate(-dx * 0.6, -dy); drawFill(gl2, px, [0.3, 0.9, 1.0]); c.restore();
      c.globalAlpha = 1;
      drawFill(gl2, px, INK);
      // 切 3 条横带错位
      for (let i = 0; i < 3; i++) {
        const y0 = cy - size * 0.5 + (i + 0.5) * (size / 3);
        const off = (hash(g, 10 + i) - 0.5) * 40 * (0.5 + beatPulse);
        c.save();
        c.beginPath();
        c.rect(0, y0 - size / 6, W, size / 3);
        c.clip();
        c.translate(off, 0);
        drawFill(gl2, px, [sig[0], sig[1], sig[2]], 0.9);
        c.restore();
      }
    } else if (mode === 'vertical') {
      // 竖排：逐字从上方落下，字距随拍收紧
      const chars = [...main];
      // 竖排按**高度**自适应：整列要塞进 78% 高
      const pxFit = Math.min(Math.round(size * 0.62), Math.floor((H * 0.78) / (chars.length * 1.06)));
      const px = Math.max(28, pxFit);
      const gapK = 1.0 - 0.12 * Math.sin(t * 2.2);
      const step = px * 1.06 * gapK;
      const top = cy - (chars.length - 1) * step * 0.5;
      setFont(px);
      chars.forEach((ch, i) => {
        const p = sat(prog(t, 0.08 + i * 0.09, 0.5 + i * 0.09));
        const y = top + i * step - (1 - p) * 60;
        c.fillStyle = cssArr(i % 3 === 2 ? [sig[0], sig[1], sig[2]] : INK, p);
        c.fillText(ch, cx - px * 0.5, y);
      });
    } else if (mode === 'split') {
      const px = fitW(main, size);
      // 上下两半错开滑入（同一句话被切成两截）
      const gl2 = layout(main, px);
      const off = (1 - sat(prog(t, 0.1, 0.9))) * size * 1.2;
      c.save();
      c.beginPath(); c.rect(0, 0, W, cy); c.clip();
      c.translate(-off, 0);
      drawFill(gl2, px, INK);
      c.restore();
      c.save();
      c.beginPath(); c.rect(0, cy, W, H - cy); c.clip();
      c.translate(off, 0);
      drawFill(gl2, px, [sig[0], sig[1], sig[2]]);
      c.restore();
    } else if (mode === 'stack') {
      const px = fitW(main, size);
      // 叠影纵深：同一句话重复 6 层，alpha 与位移递减
      const gl2 = layout(main, px);
      for (let i = 5; i >= 1; i--) {
        const dyy = i * (6 + 10 * (1 - k));
        c.save(); c.translate(0, dyy);
        drawFill(gl2, px, INK, 0.10 / i);
        c.restore();
      }
      drawFill(gl2, px, INK);
    } else if (mode === 'karaoke') {
      const px = fitW(main, size);
      // 逐字擦亮：亮到哪 = 时间走到哪（不用词级时间戳，按字数均分）
      const gl2 = layout(main, px);
      const lit = sat(prog(t, 0.2, Math.max(1.2, total * 0.75)));
      drawFill(gl2, px, [0.35, 0.34, 0.33]);
      const n = gl2.length;
      const upto = lit * n;
      for (const g of gl2) {
        const on = sat(upto - g.i);
        if (on > 0) drawFill([g], px, [sig[0], sig[1], sig[2]], on);
      }
    } else if (mode === 'ticker') {
      const px = fitW(main, size);
      // 底部滚动字条（等宽）+ 主句随拍弹
      const gl2 = layout(main, px);
      const bounce = 1 + 0.05 * pump;
      c.save();
      c.translate(cx, cy); c.scale(bounce, bounce); c.translate(-cx, -cy);
      drawFill(gl2, px, INK);
      c.restore();
      const px2 = Math.round(size * 0.13);
      type.font({ size: px2, weight: 600, family: 'mono' });
      const strip = (o.ticker ?? 'KATTACHI INAI NE · 分かっちゃいないね · ');
      const wStrip = c.measureText(strip).width;
      const x0 = -((t * 160) % wStrip);
      c.fillStyle = cssArr([sig[0], sig[1], sig[2]], 0.85);
      for (let x = x0; x < W; x += wStrip) c.fillText(strip, x, H - 96);
    } else if (mode === 'rain') {
      const px = fitW(main, size);
      // 字符雨：列里落下标题的字（确定性），主句同时出现
      const px3 = Math.round(size * 0.16);
      type.font({ size: px3, weight: 700, family: 'mono' });
      const cols = 26;
      for (let i = 0; i < cols; i++) {
        const colX = (i + 0.5) * (W / cols);
        const speed = 60 + hash(i, 3) * 220;
        const y = ((t * speed + hash(i, 7) * H) % (H + 200)) - 100;
        const ch = main[i % main.length];
        const a = 0.10 + 0.25 * hash(i, Math.floor(f.t * 8));
        c.fillStyle = cssArr(INK, a);
        c.fillText(ch, colX, y);
      }
      drawFill(layout(main, px), px, INK, 0.95);
    }

    // 副句（所有 mode 通用）：底部一行等宽
    if (sub) {
      const px4 = Math.round(size * 0.15);
      type.font({ size: px4, weight: 500, family: 'mono' });
      c.fillStyle = cssArr([0.55, 0.54, 0.52], sat(prog(t, 0.5, 1.1)));
      // 竖排时副句挪到左下角，别压在字列上
      if (mode === 'vertical') c.fillText(sub, 120, H - 96);
      else c.fillText(sub, cx - c.measureText(sub).width / 2, cy + size * 0.62);
    }

    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    void clamp; void mixColor;
    return { bloom: 0.28 + 0.25 * pump, grain: 0.03, vignette: 0.55 };
  },
};

/** [r,g,b] + alpha → css rgba */
function cssArr(rgb, a = 1) {
  const q = (v) => Math.round(clamp(v, 0, 1) * 255);
  return `rgba(${q(rgb[0])},${q(rgb[1])},${q(rgb[2])},${clamp(a, 0, 1)})`;
}
