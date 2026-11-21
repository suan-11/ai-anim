// @ts-check
/**
 * 01 · hook —— sRGB 红绿平均陷阱与物理光强塌陷（风格帧 #1）。
 * 所有节拍点严格按 f.lt 对齐 narration.json 真实词时间戳（slot = 21.000s）。
 */
import { Pass } from '../../../src/core/gl.js';
import { makeShot } from '../../../src/kit/index.js';
import {
  GLSL_OKLAB_MATH, RAIL_BOX, css, drawHeader, drawSpectrumRail, oklabPost,
  sat, smoothstep, spring, srgbToLinScalar, withAlpha,
} from './_oklab.js';

const X0 = 400;
const W_STRIP = 1360;
const Y_SRGB = 224;
const H_STRIP = 104;
const Y_LIN = 344;
const Y_GRAPH_BOT = 832;

const HOOK_FRAG = /* glsl */ `
${GLSL_OKLAB_MATH}
uniform vec2 uOffset;
uniform float uEnter;
uniform float uSweepU;
uniform float uTailFill;
uniform float uRevealLin;
uniform float uPeakGlow;
uniform float uSwatchPop;
uniform float uSwatchFocus;

void main() {
  vec2 p = vec2(FRAG_PX.x, RES_LOGICAL.y - FRAG_PX.y) - uOffset;
  float x0 = 400.0;
  float w = 1360.0;
  float u = (p.x - x0) / w;

  float alpha = 0.0;
  vec3 col = vec3(0.0);

  // 1) 上条带：sRGB 编码平均 —— [0, uSweepU] 同步扫亮
  float mTop = roundBoxMask(p, vec2(x0, 224.0), vec2(w, 104.0), 8.0);
  if (mTop > 0.001 && u >= 0.0 && u <= 1.0) {
    vec3 cSrgb = evalRedGreenSrgb(u);
    float litEnd = uTailFill > 0.001 ? 0.5 + 0.5 * uTailFill : uSweepU;
    float lit = 1.0 - smoothstep(litEnd - 0.015, litEnd + 0.005, u);
    col = mix(col, cSrgb * mix(0.42, 1.0, sat(lit)), mTop * uEnter);
    alpha = max(alpha, mTop * uEnter);
  }
  float eTop = roundBoxEdge(p, vec2(x0, 224.0), vec2(w, 104.0), 8.0, 1.2);
  if (eTop > 0.001) {
    col = mix(col, C_GRAPHITE * 1.2, eTop * 0.72 * uEnter);
    alpha = max(alpha, eTop * 0.72 * uEnter);
  }

  // 2) 下条带：Linear 线性平均 —— 揭晓前维持纯净中性暗轨（零浑浊待机），7.5s 居中拉开
  float mBot = roundBoxMask(p, vec2(x0, 344.0), vec2(w, 104.0), 8.0);
  if (mBot > 0.001 && u >= 0.0 && u <= 1.0) {
    vec3 cLin = evalRedGreenLinear(u);
    float dCenter = abs(u - 0.5) * 2.0;
    float curtain = 1.0 - smoothstep(uRevealLin * 1.08 - 0.08, uRevealLin * 1.08, dCenter);
    float glint = exp(-pow((dCenter - uRevealLin) * 16.0, 2.0)) * smoothstep(0.02, 0.2, uRevealLin) * (1.0 - smoothstep(0.88, 1.0, uRevealLin));
    vec3 standby = C_INK * 0.85;
    vec3 show = mix(standby, cLin, curtain) + C_BONE * (0.28 * glint);
    col = mix(col, show, mBot * uEnter);
    alpha = max(alpha, mBot * uEnter);
  }
  float eBot = roundBoxEdge(p, vec2(x0, 344.0), vec2(w, 104.0), 8.0, 1.2);
  if (eBot > 0.001) {
    col = mix(col, mix(C_GRAPHITE * 0.85, C_BONE * 0.68, uRevealLin), eBot * 0.68 * uEnter);
    alpha = max(alpha, eBot * 0.68 * uEnter);
  }

  // 3) 图表凹陷底衬 (y=466..832) 与误差面积填充
  float gBox = roundBoxMask(p, vec2(x0, 466.0), vec2(w, 366.0), 8.0);
  if (gBox > 0.001) {
    col = mix(col, C_INK * 0.76, gBox * 0.72 * uEnter);
    alpha = max(alpha, gBox * 0.72 * uEnter);
  }
  float egBox = roundBoxEdge(p, vec2(x0, 466.0), vec2(w, 366.0), 8.0, 1.0);
  if (egBox > 0.001) {
    col = mix(col, C_GRAPHITE * 0.85, egBox * 0.55 * uEnter);
    alpha = max(alpha, egBox * 0.55 * uEnter);
  }

  float curveEnd = uTailFill > 0.001 ? 0.5 + 0.5 * uTailFill : uSweepU;
  if (gBox > 0.001 && u >= 0.0 && u <= curveEnd) {
    float srgbInt = 0.5 * (toLinear(vec3(1.0 - u, u, 0.0)).r + toLinear(vec3(1.0 - u, u, 0.0)).g);
    float yLin = 832.0 - (0.50 / 0.56) * 262.0;
    float ySrgb = 832.0 - (srgbInt / 0.56) * 262.0;
    if (p.y >= yLin && p.y <= ySrgb) {
      float bandA = (0.14 + 0.24 * uPeakGlow) * smoothstep(0.0, 0.03, u) * uEnter;
      col = mix(col, C_SIGNAL, bandA);
    }
  }

  // 4) hook-3 放大采样对照块（t=14.35s 起在图区右上方以 spring 推开；14.5..19.8s 前后交替高光左右样块）
  if (uSwatchPop > 0.01) {
    float dxSep = 42.0 * uSwatchPop;
    vec2 s1Pos = vec2(1596.0 - dxSep - 32.0, 486.0);
    vec2 s2Pos = vec2(1596.0 + dxSep - 32.0, 486.0);
    float sw1Glow = max(0.0, -uSwatchFocus);
    float sw2Glow = max(0.0, uSwatchFocus);
    float ms1 = roundBoxMask(p, s1Pos, vec2(64.0, 64.0), 8.0);
    if (ms1 > 0.001) {
      col = mix(col, evalRedGreenSrgb(0.5) * (0.86 + 0.14 * sw1Glow), ms1 * uSwatchPop * uEnter);
      alpha = max(alpha, ms1 * uSwatchPop * uEnter);
    }
    float es1 = roundBoxEdge(p, s1Pos, vec2(64.0, 64.0), 8.0, 1.6 + 1.1 * sw1Glow);
    if (es1 > 0.001) {
      col = mix(col, C_SIGNAL * (0.9 + 0.2 * sw1Glow), es1 * uSwatchPop * uEnter);
      alpha = max(alpha, es1 * uSwatchPop * uEnter);
    }
    float ms2 = roundBoxMask(p, s2Pos, vec2(64.0, 64.0), 8.0);
    if (ms2 > 0.001) {
      col = mix(col, evalRedGreenLinear(0.5) * (0.88 + 0.12 * sw2Glow), ms2 * uSwatchPop * uEnter);
      alpha = max(alpha, ms2 * uSwatchPop * uEnter);
    }
    float es2 = roundBoxEdge(p, s2Pos, vec2(64.0, 64.0), 8.0, 1.6 + 1.1 * sw2Glow);
    if (es2 > 0.001) {
      col = mix(col, C_BONE * (0.80 + 0.20 * sw2Glow), es2 * uSwatchPop * uEnter);
      alpha = max(alpha, es2 * uSwatchPop * uEnter);
    }
  }

  fragColor = vec4(col, sat(alpha));
}
`;

export default makeShot('hook', {
  setup(ctx) {
    this.pass = new Pass(ctx.gl, HOOK_FRAG, {
      uOffset: [0, 0],
      uEnter: 1,
      uSweepU: 0,
      uTailFill: 0,
      uRevealLin: 0,
      uPeakGlow: 0,
      uSwatchPop: 0,
      uSwatchFocus: 0,
    }, { palette: ctx.P, key: 'oklab_hook' });
  },

  draw(ctx, { k, dx, dy }) {
    const { f, gl, lines, text, type, comp, P } = ctx;
    const t = f.lt;

    const introA = smoothstep(0.0, 0.45, t);
    const vis = k * introA;
    const sweepU = 0.5 * smoothstep(1.2, 7.5, t);
    const tailFill = smoothstep(7.5, 9.6, t);
    const curveEndU = tailFill > 0.001 ? 0.5 + 0.5 * tailFill : sweepU;
    const revealLin = smoothstep(7.5, 9.0, t);

    // 9.45s ("128"): 锁定中点框与 50% / sRGB 坐标；12.10s ("百分之二十一"): 弹出 21.4% 橙字与唯一推镜峰值；14.35s ("hook-3"): 放大并置样块交替聚焦
    const bracketIn = sat(spring((t - 9.45) * 2.0, 1, 120, 15));
    const pop214 = sat(spring((t - 12.10) * 2.0, 1, 120, 14));
    const swatchPop = sat(spring((t - 14.35) * 1.9, 1, 120, 14));
    const swFocusL = smoothstep(14.5, 15.1, t) * (1 - smoothstep(16.7, 17.3, t));
    const swFocusR = smoothstep(17.0, 17.6, t) * (1 - smoothstep(19.5, 20.1, t));
    const swatchFocus = swFocusR - swFocusL;

    this.pass.set({
      uOffset: [dx, dy],
      uEnter: vis,
      uSweepU: sweepU,
      uTailFill: tailFill,
      uRevealLin: revealLin,
      uPeakGlow: pop214,
      uSwatchPop: swatchPop,
      uSwatchFocus: swatchFocus,
    }).render(gl, ctx.out, f.t, f.dt);

    lines.begin();
    const ox = X0 + dx;
    const gBot = Y_GRAPH_BOT + dy;
    const gSpan = 262;
    const yAt = (val) => gBot - (val / 0.56) * gSpan;
    const y50 = yAt(0.50);
    const y214 = yAt(0.214);

    // 坐标轴裁齐至 y50 - 24（withAlpha 确保真透明衰减）
    lines.seg(ox, gBot, ox + W_STRIP, gBot, 1.4, withAlpha(P.graphite, 0.75 * vis));
    lines.seg(ox, y50 - 24, ox, gBot, 1.4, withAlpha(P.graphite, 0.75 * vis));
    lines.seg(ox - 8, y50, ox, y50, 1.8, withAlpha(P.bone, 0.75 * vis));
    lines.seg(ox - 8, y214, ox, y214, 1.8, withAlpha(P.signal, 0.85 * vis));
    lines.seg(ox - 8, gBot, ox, gBot, 1.8, withAlpha(P.graphite, 0.9 * vis));

    // 左栏实时对比量柱：t < 7.5s Lin 柱维持空框不喧宾夺主，sRGB 柱用中性白、待误差锁定时才转信号橙
    const mX = 172 + dx;
    const mFull = gBot - y50;
    const curSrgbInt = 0.5 * (srgbToLinScalar(1 - sweepU) + srgbToLinScalar(sweepU));
    const sVal = t < 7.5 ? curSrgbInt : 0.214;
    const hS = (gBot - yAt(sVal)) * sat(smoothstep(0.6, 1.2, t));
    const hL = mFull * revealLin;
    lines.fillRect(mX, y50, 34, mFull, withAlpha(P.ink, 0.9 * vis), 4);
    lines.fillRect(mX + 56, y50, 34, mFull, withAlpha(P.ink, 0.9 * vis), 4);
    lines.rect(mX, y50, 34, mFull, 1.2, withAlpha(P.graphite, 0.65 * vis));
    lines.rect(mX + 56, y50, 34, mFull, 1.2, withAlpha(P.graphite, 0.65 * vis));
    const sColor = bracketIn > 0.1
      ? [
          P.bone[0] + (P.signal[0] - P.bone[0]) * bracketIn,
          P.bone[1] + (P.signal[1] - P.bone[1]) * bracketIn,
          P.bone[2] + (P.signal[2] - P.bone[2]) * bracketIn,
          vis,
        ]
      : withAlpha(P.bone, 0.75 * vis);
    if (hS > 0.5) lines.fillRect(mX, gBot - hS, 34, hS, sColor, 4);
    if (hL > 0.5) lines.fillRect(mX + 56, gBot - hL, 34, hL, withAlpha(P.bone, 0.95 * revealLin * vis), 4);

    // 引导线严格止于右柱外沿到坐标轴左侧，不穿过柱身
    lines.seg(mX + 96, y214, 326 + dx, y214, 1.2, withAlpha(P.signal, 0.45 * vis));
    lines.seg(mX + 96, y50, 326 + dx, y50, 1.2, withAlpha(P.bone, 0.35 * vis));

    for (let i = 0; i < 40; i++) {
      const sx = ox + (i / 40) * W_STRIP;
      lines.seg(sx, y50, sx + W_STRIP / 66, y50, 1.8, withAlpha(P.bone, 0.34 * (0.25 + 0.75 * revealLin) * vis));
    }
    if (bracketIn > 0.05) {
      for (let i = 0; i < 20; i++) {
        const sx = ox + (i / 20) * (W_STRIP * 0.5);
        lines.seg(sx, y214, sx + W_STRIP / 66, y214, 1.5, withAlpha(P.signal, (0.32 + 0.45 * pop214) * bracketIn * k));
      }
    }

    const steps = 80;
    const maxStep = Math.max(1, Math.floor(curveEndU * steps));
    for (let i = 0; i < maxStep; i++) {
      const u0 = i / steps;
      const u1 = (i + 1) / steps;
      const v0 = 0.5 * (srgbToLinScalar(1 - u0) + srgbToLinScalar(u0));
      const v1 = 0.5 * (srgbToLinScalar(1 - u1) + srgbToLinScalar(u1));
      lines.seg(ox + u0 * W_STRIP, yAt(v0), ox + u1 * W_STRIP, yAt(v1), 3.6, withAlpha(P.signal, vis));
    }

    const midX = ox + 0.5 * W_STRIP;
    if (t >= 7.5) {
      const lockA = sat((t - 7.5) / 0.6) * k;
      lines.seg(midX, Y_SRGB + dy - 10, midX, Y_SRGB + dy - 5, 2.0, withAlpha(P.bone, 0.82 * lockA));
      lines.seg(midX, Y_SRGB + H_STRIP + dy + 5, midX, Y_LIN + dy - 5, 2.0, withAlpha(P.bone, 0.82 * lockA));
      lines.seg(midX, Y_LIN + H_STRIP + dy + 5, midX, 465 + dy, 2.0, withAlpha(P.bone, 0.72 * lockA));
      lines.seg(midX, 467 + dy, midX, gBot, 2.0, withAlpha(P.bone, 0.72 * lockA));
    }
    if (bracketIn > 0.02) {
      const boxW = 44 * bracketIn;
      lines.rect(midX - boxW * 0.5, Y_SRGB + dy - 4, boxW, H_STRIP + 8, 2.4, withAlpha(P.signal, bracketIn * k));
      lines.rect(midX - boxW * 0.5, Y_LIN + dy - 4, boxW, H_STRIP + 8, 2.4, withAlpha(P.bone, 0.9 * revealLin * k));
      lines.fillCircle(midX, y214, 7 * bracketIn, withAlpha(P.signal, bracketIn * k));
      lines.fillCircle(midX, y50, 7 * bracketIn, withAlpha(P.bone, revealLin * k));
    }

    // 扫描游标：断开两条色带内部及图框边界，仅画外沿间隙与图区下垂
    if (t < 7.6) {
      const sx = ox + sweepU * W_STRIP;
      const sv = 0.5 * (srgbToLinScalar(1 - sweepU) + srgbToLinScalar(sweepU));
      lines.seg(sx, Y_SRGB + dy - 6, sx, Y_SRGB + dy - 2, 1.8, withAlpha(P.bone, 0.85 * vis));
      lines.seg(sx, Y_SRGB + H_STRIP + dy + 2, sx, Y_LIN + dy - 2, 1.8, withAlpha(P.bone, 0.85 * vis));
      lines.seg(sx, Y_LIN + H_STRIP + dy + 2, sx, 465 + dy, 1.8, withAlpha(P.bone, 0.78 * vis));
      lines.seg(sx, 467 + dy, sx, gBot, 1.8, withAlpha(P.bone, 0.78 * vis));
      lines.fillCircle(sx, yAt(sv), 6.5, withAlpha(P.bone, vis));
    }

    // hook-3：从中点竖线 xStart = midX + 1 严密接至 s1Pos.x = 1522，并于 14.5..19.8s 交替高亮左右样块
    if (swatchPop > 0.1) {
      const wireA = (0.45 + 0.30 * Math.abs(swatchFocus)) * swatchPop * k;
      const gCol = withAlpha(P.ash, wireA);
      const dxSep = 42 * swatchPop;
      const s1x = 1596 - dxSep - 32 + dx;
      const s2x = 1596 + dxSep - 32 + dx;
      const xStart = midX + 1;
      const xCorner = 1496 + dx;
      const yTop = 476 + dy;
      const yMid = 518 + dy;
      for (let i = 0; i < 16; i++) {
        if (i % 2 === 1) continue;
        const x0d = xStart + (xCorner - xStart) * (i / 16);
        const x1d = xStart + (xCorner - xStart) * ((i + 1) / 16);
        lines.seg(x0d, yTop, x1d, yTop, 1.4, gCol);
      }
      lines.seg(xCorner, yTop, xCorner, yMid, 1.4, gCol);
      lines.seg(xCorner, yMid, s1x, yMid, 1.4, gCol);
      lines.seg(s1x + 66, yMid, s2x - 2, yMid, 1.5, withAlpha(P.bone, 0.55 * swatchPop * k));
      if (swFocusL > 0.04) {
        lines.rect(s1x - 5, 486 + dy - 5, 74, 74, 2.0, withAlpha(P.signal, 0.85 * swFocusL * swatchPop * k));
      }
      if (swFocusR > 0.04) {
        lines.rect(s2x - 5, 486 + dy - 5, 74, 74, 2.0, withAlpha(P.bone, 0.85 * swFocusR * swatchPop * k));
      }
    }

    // 标尺始终使用 k 透度（绝不乘 introA 导致切点归零）
    drawSpectrumRail(ctx, { ...RAIL_BOX, probeU: t < 7.6 ? sweepU : 0.50, alpha: k, dx, dy });
    lines.flush(ctx.out);

    // ── 文字层：严格 3 档字号 (20 / 28 / 72) + 全量补齐 dx/dy ──
    text.clear();
    drawHeader(ctx, {
      num: '01',
      title: '红绿平均陷阱',
      rightLabel: 'sRGB vs Linear',
      t, dx, dy,
    });

    const labA = sat((t - 0.25) / 0.5) * k;
    if (labA > 0.01) {
      type.writeLine('sRGB 编码平均', 160 + dx, Y_SRGB + 58 + dy, {
        anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(P.bone, 0.92 * labA),
      });
      type.writeLine('Linear 线性平均', 160 + dx, Y_LIN + 58 + dy, {
        anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(P.bone, (0.42 + 0.54 * revealLin) * labA),
      });
    }

    type.writeLine('50%', X0 - 14 + dx, y50 + 6 + dy, {
      anchor: 'right', size: 20, weight: 600, family: 'mono', color: css(P.ash, 0.85 * vis),
    });
    type.writeLine('0%', X0 - 14 + dx, gBot - 5 + dy, {
      anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.72 * vis),
    });
    type.writeLine('sRGB', mX + 17, gBot + 24, {
      anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(bracketIn > 0.1 ? P.signal : P.bone, 0.90 * vis),
    });
    type.writeLine('Lin', mX + 73, gBot + 24, {
      anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.bone, (0.35 + 0.60 * revealLin) * vis),
    });

    if (bracketIn > 0.02) {
      const dyBrk = (1 - bracketIn) * 14;
      type.writeLine('50%', midX + 36, 546 + dyBrk + dy, {
        anchor: 'left', size: 72, weight: 800, family: 'mono', color: css(P.bone, bracketIn * k),
      });
      type.writeLine('Linear (188,188,0)', midX + 36, 578 + dyBrk * 0.4 + dy, {
        anchor: 'left', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.95 * bracketIn * k),
      });
      type.writeLine('sRGB (128,128,0)', midX - 36, 820 + dyBrk * 0.4 + dy, {
        anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.95 * bracketIn * k),
      });
    }
    if (swatchPop > 0.02) {
      const swLabY = 574 + (1 - swatchPop) * 8 + dy;
      type.writeLine('sRGB', 1554 + dx, swLabY, {
        anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.signal, swatchPop * k),
      });
      type.writeLine('Lin', 1638 + dx, swLabY, {
        anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.bone, swatchPop * k),
      });
    }
    if (pop214 > 0.02) {
      const dyPop = (1 - pop214) * 14;
      type.writeLine('21.4%', midX - 36, 796 + dyPop + dy, {
        anchor: 'right', size: 72, weight: 800, family: 'mono', color: css(P.signal, pop214 * k),
      });
    }

    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    const zoomBoost = 0.022 * pop214;
    return oklabPost(f, { zoomBoost });
  },
});
