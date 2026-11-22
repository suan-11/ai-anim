// @ts-check
/**
 * 01 · hook —— sRGB 红绿平均陷阱与物理光强塌陷（风格帧 #1）。
 * 所有节拍点严格按 f.lt 对齐 narration.json 真实词时间戳（slot = 21.000s）。
 */
import { Pass } from '../../../src/core/gl.js';
import { makeShot } from '../../../src/kit/index.js';
import {
  GLSL_OKLAB_MATH, RAIL_BOX, css, drawHeader, drawSpectrumRail, lerp, oklabPost,
  sat, smoothstep, spring, srgbToLinScalar, withAlpha,
} from './_oklab.js';

const X0 = 400;
const W_STRIP = 1360;
const Y_SRGB = 224;
const H_STRIP = 104;
const Y_LIN = 344;
const Y_GRAPH_BOT = 840;

const HOOK_FRAG = /* glsl */ `
${GLSL_OKLAB_MATH}
uniform vec2 uOffset;
uniform float uEnter;
uniform float uSweepU;
uniform float uCurveEnd;
uniform float uRevealLin;
uniform float uSrgbH;
uniform float uLinY;
uniform float uLinH;
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

  // 1) 上条带：sRGB 编码平均 —— t < 6.8s 以全高 224px 饱满铺展扫亮（零空心黑框待机），6.8s 起平滑上收让位 Linear
  float mTop = roundBoxMask(p, vec2(x0, 224.0), vec2(w, uSrgbH), 8.0);
  if (mTop > 0.001 && u >= 0.0 && u <= 1.0) {
    vec3 cSrgb = evalRedGreenSrgb(u);
    float lit = 1.0 - smoothstep(uCurveEnd - 0.015, uCurveEnd + 0.005, u);
    col = mix(col, cSrgb * mix(0.24, 1.0, sat(lit)), mTop * uEnter);
    alpha = max(alpha, mTop * uEnter);
  }
  float sw1Glow = max(0.0, -uSwatchFocus);
  float sw2Glow = max(0.0, uSwatchFocus);
  float eTop = roundBoxEdge(p, vec2(x0, 224.0), vec2(w, uSrgbH), 8.0, 1.2 + 0.8 * sw1Glow);
  if (eTop > 0.001) {
    vec3 etCol = mix(C_GRAPHITE * 1.2, C_SIGNAL, sw1Glow * 0.65);
    col = mix(col, etCol, eTop * mix(0.72, 0.95, sw1Glow) * uEnter);
    alpha = max(alpha, eTop * mix(0.72, 0.95, sw1Glow) * uEnter);
  }

  // 2) 下条带：Linear 线性平均 —— 仅在 uRevealLin > 0.01 时自下居中拉开，绝不在片头空框占位
  if (uRevealLin > 0.01 && uLinH > 2.0) {
    float mBot = roundBoxMask(p, vec2(x0, uLinY), vec2(w, uLinH), 8.0);
    if (mBot > 0.001 && u >= 0.0 && u <= 1.0) {
      vec3 cLin = evalRedGreenLinear(u);
      float dCenter = abs(u - 0.5) * 2.0;
      float curtain = 1.0 - smoothstep(uRevealLin * 1.08 - 0.08, uRevealLin * 1.08, dCenter);
      float glint = exp(-pow((dCenter - uRevealLin) * 16.0, 2.0)) * smoothstep(0.02, 0.2, uRevealLin) * (1.0 - smoothstep(0.88, 1.0, uRevealLin));
      vec3 standby = C_INK * 0.85;
      vec3 show = mix(standby, cLin, curtain) + C_BONE * (0.28 * glint);
      col = mix(col, show, mBot * uRevealLin * uEnter);
      alpha = max(alpha, mBot * uRevealLin * uEnter);
    }
    float eBot = roundBoxEdge(p, vec2(x0, uLinY), vec2(w, uLinH), 8.0, 1.2 + 0.8 * sw2Glow);
    if (eBot > 0.001) {
      vec3 ebCol = mix(C_BONE * 0.68, C_BONE * 1.1, sw2Glow * 0.65);
      col = mix(col, ebCol, eBot * mix(0.72, 0.96, sw2Glow) * uRevealLin * uEnter);
      alpha = max(alpha, eBot * mix(0.72, 0.96, sw2Glow) * uRevealLin * uEnter);
    }
  }

  // 3) 图表凹陷底衬 (y=466..840) 与误差面积填充
  float gBox = roundBoxMask(p, vec2(x0, 466.0), vec2(w, 374.0), 8.0);
  if (gBox > 0.001) {
    col = mix(col, C_INK * 0.76, gBox * 0.72 * uEnter);
    alpha = max(alpha, gBox * 0.72 * uEnter);
  }
  float egBox = roundBoxEdge(p, vec2(x0, 466.0), vec2(w, 374.0), 8.0, 1.0);
  if (egBox > 0.001) {
    col = mix(col, C_GRAPHITE * 0.85, egBox * 0.55 * uEnter);
    alpha = max(alpha, egBox * 0.55 * uEnter);
  }

  if (gBox > 0.001 && u >= 0.0 && u <= uCurveEnd) {
    float srgbInt = 0.5 * (toLinear(vec3(1.0 - u, u, 0.0)).r + toLinear(vec3(1.0 - u, u, 0.0)).g);
    float yLin = 840.0 - (0.50 / 0.56) * 276.0;
    float ySrgb = 840.0 - (srgbInt / 0.56) * 276.0;
    if (p.y >= yLin && p.y <= ySrgb) {
      float bandA = (0.14 + 0.24 * uPeakGlow) * smoothstep(0.0, 0.03, u) * uEnter;
      col = mix(col, C_SIGNAL, bandA);
    }
  }

  // 4) hook-3 放大采样对照块（t=14.20s 起在图区右上方以 spring 推开；聚焦时样块平滑微胀并点亮对应色带）
  if (uSwatchPop > 0.01) {
    float dxSep = 42.0 * uSwatchPop;
    float s1Grow = 5.0 * sw1Glow;
    float s2Grow = 5.0 * sw2Glow;
    vec2 s1Pos = vec2(1596.0 - dxSep - 32.0 - s1Grow * 0.5, 486.0 - s1Grow * 0.5);
    vec2 s2Pos = vec2(1596.0 + dxSep - 32.0 - s2Grow * 0.5, 486.0 - s2Grow * 0.5);
    float ms1 = roundBoxMask(p, s1Pos, vec2(64.0 + s1Grow, 64.0 + s1Grow), 8.0);
    if (ms1 > 0.001) {
      col = mix(col, evalRedGreenSrgb(0.5) * (0.86 + 0.14 * sw1Glow), ms1 * uSwatchPop * uEnter);
      alpha = max(alpha, ms1 * uSwatchPop * uEnter);
    }
    float es1 = roundBoxEdge(p, s1Pos, vec2(64.0 + s1Grow, 64.0 + s1Grow), 8.0, 1.6 + 1.1 * sw1Glow);
    if (es1 > 0.001) {
      col = mix(col, C_SIGNAL * (0.9 + 0.2 * sw1Glow), es1 * uSwatchPop * uEnter);
      alpha = max(alpha, es1 * uSwatchPop * uEnter);
    }
    float ms2 = roundBoxMask(p, s2Pos, vec2(64.0 + s2Grow, 64.0 + s2Grow), 8.0);
    if (ms2 > 0.001) {
      col = mix(col, evalRedGreenLinear(0.5) * (0.88 + 0.12 * sw2Glow), ms2 * uSwatchPop * uEnter);
      alpha = max(alpha, ms2 * uSwatchPop * uEnter);
    }
    float es2 = roundBoxEdge(p, s2Pos, vec2(64.0 + s2Grow, 64.0 + s2Grow), 8.0, 1.6 + 1.1 * sw2Glow);
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
      uCurveEnd: 0,
      uRevealLin: 0,
      uSrgbH: 224,
      uLinY: 448,
      uLinH: 4,
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
    // 0.5..5.4s 快速扫亮整条红绿带与光强凹谷，5.4..7.0s 从容归中点 0.50，7.0..8.6s Linear 从中打开
    const curveEndU = smoothstep(0.5, 5.4, t);
    const probeU = t < 5.4 ? curveEndU : lerp(1.0, 0.50, smoothstep(5.4, 7.0, t));
    const revealLin = smoothstep(7.0, 8.6, t);
    const srgbH = lerp(224, 104, revealLin);
    const linY = lerp(448, 344, revealLin);
    const linH = lerp(4, 104, revealLin);

    // 9.45s ("128"): 锁定中点框与 50% / sRGB 坐标；12.15s ("百分之二十一"): 弹出 21.4% 橙字与唯一推镜峰值；14.20s ("hook-3"): 放大并置样块交替聚焦
    const bracketIn = sat(spring((t - 9.45) * 2.0, 1, 120, 15));
    const pop214 = sat(spring((t - 12.15) * 2.0, 1, 120, 14));
    const swatchPop = sat(spring((t - 14.20) * 1.9, 1, 120, 14));
    const swFocusL = smoothstep(14.25, 14.70, t) * (1 - smoothstep(15.60, 15.95, t));
    const swFocusR = smoothstep(15.85, 16.35, t) * (1 - smoothstep(18.60, 19.20, t));
    const swatchFocus = swFocusR - swFocusL;
    const dualPop = smoothstep(17.2, 17.8, t) * (1 - 0.55 * smoothstep(19.0, 19.7, t));
    const wireU = smoothstep(14.4, 17.6, t);

    this.pass.set({
      uOffset: [dx, dy],
      uEnter: vis,
      uSweepU: probeU,
      uCurveEnd: curveEndU,
      uRevealLin: revealLin,
      uSrgbH: srgbH,
      uLinY: linY,
      uLinH: linH,
      uPeakGlow: pop214,
      uSwatchPop: swatchPop,
      uSwatchFocus: swatchFocus,
    }).render(gl, ctx.out, f.t, f.dt);

    lines.begin();
    const ox = X0 + dx;
    const gBot = Y_GRAPH_BOT + dy;
    const gSpan = 276;
    const yAt = (val) => gBot - (val / 0.56) * gSpan;
    const y50 = yAt(0.50);
    const y214 = yAt(0.214);

    // 坐标轴裁齐至 y50 - 24（withAlpha 确保真透明衰减）
    lines.seg(ox, gBot, ox + W_STRIP, gBot, 1.4, withAlpha(P.graphite, 0.75 * vis));
    lines.seg(ox, y50 - 24, ox, gBot, 1.4, withAlpha(P.graphite, 0.75 * vis));
    lines.seg(ox - 8, y50, ox, y50, 1.8, withAlpha(P.bone, 0.75 * vis));
    if (bracketIn > 0.02) {
      lines.seg(ox - 8, y214, ox, y214, 1.8, withAlpha(P.signal, 0.85 * bracketIn * vis));
    }
    lines.seg(ox - 8, gBot, ox, gBot, 1.8, withAlpha(P.graphite, 0.9 * vis));

    // 左栏实时对比量柱：t < 7.2s 只画活的 sRGB 单柱（不空画 Lin 框），Lin 随 revealLin 滑入
    const mX = 172 + dx;
    const mFull = gBot - y50;
    const curSrgbInt = 0.5 * (srgbToLinScalar(1 - probeU) + srgbToLinScalar(probeU));
    const sVal = t < 7.0 ? curSrgbInt : 0.214;
    const hS = (gBot - yAt(sVal)) * sat(smoothstep(0.4, 1.0, t));
    const hL = mFull * revealLin;
    const mSrgbBord = swFocusL > 0.04 || dualPop > 0.04
      ? [lerp(P.graphite[0], P.signal[0], Math.max(swFocusL, dualPop)), lerp(P.graphite[1], P.signal[1], Math.max(swFocusL, dualPop)), lerp(P.graphite[2], P.signal[2], Math.max(swFocusL, dualPop)), 0.88 * vis]
      : withAlpha(P.graphite, 0.65 * vis);
    lines.fillRect(mX, y50, 34, mFull, withAlpha(P.ink, 0.9 * vis), 4);
    lines.rect(mX, y50, 34, mFull, 1.2 + 0.8 * Math.max(swFocusL, dualPop), mSrgbBord);
    if (revealLin > 0.05) {
      const mLinBord = swFocusR > 0.04 || dualPop > 0.04
        ? withAlpha(P.bone, (0.65 + 0.30 * Math.max(swFocusR, dualPop)) * revealLin * vis)
        : withAlpha(P.graphite, 0.65 * revealLin * vis);
      lines.fillRect(mX + 56, y50, 34, mFull, withAlpha(P.ink, 0.9 * revealLin * vis), 4);
      lines.rect(mX + 56, y50, 34, mFull, 1.2 + 0.8 * Math.max(swFocusR, dualPop), mLinBord);
    }
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

    if (dualPop > 0.04) {
      lines.seg(mX + 106, y50, mX + 106, y214, 1.8, withAlpha(P.signal, 0.72 * dualPop * k));
      lines.seg(mX + 101, y50, mX + 106, y50, 1.5, withAlpha(P.bone, 0.72 * dualPop * k));
      lines.seg(mX + 101, y214, mX + 106, y214, 1.5, withAlpha(P.signal, 0.72 * dualPop * k));
    }

    // 引导线严格止于右柱外沿到坐标轴左侧，不穿过柱身，且 y214 引导直抵纵轴 ox 无悬空断点
    if (bracketIn > 0.02) {
      lines.seg(mX + 96, y214, ox, y214, 1.2, withAlpha(P.signal, 0.45 * bracketIn * vis));
    }
    lines.seg(revealLin > 0.05 ? mX + 96 : mX + 40, y50, 326 + dx, y50, 1.2, withAlpha(P.bone, 0.35 * vis));

    for (let i = 0; i < 40; i++) {
      const sx = ox + (i / 40) * W_STRIP;
      lines.seg(sx, y50, sx + W_STRIP / 66, y50, 1.8, withAlpha(P.bone, 0.34 * (0.30 + 0.70 * revealLin) * vis));
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
    if (t >= 7.0) {
      if (bracketIn < 0.98) {
        lines.seg(midX, Y_SRGB + dy - 6, midX, Y_SRGB + dy - 2, 1.8, withAlpha(P.bone, 0.85 * (1 - bracketIn) * vis));
      }
      if (revealLin > 0.05) {
        lines.seg(midX, Y_SRGB + srgbH + dy + 4, midX, linY + dy - 4, 2.0, withAlpha(P.bone, 0.82 * revealLin * vis));
      }
      lines.seg(midX, linY + linH + dy + 2, midX, 465 + dy, 2.0, withAlpha(P.bone, 0.78 * vis));
      lines.seg(midX, 467 + dy, midX, gBot, 2.0, withAlpha(P.bone, 0.78 * vis));
      const dotCol = [
        lerp(P.bone[0], P.signal[0], bracketIn),
        lerp(P.bone[1], P.signal[1], bracketIn),
        lerp(P.bone[2], P.signal[2], bracketIn),
        vis,
      ];
      lines.fillCircle(midX, y214, lerp(6.5, 7.0, bracketIn), dotCol);
    }
    if (bracketIn > 0.02) {
      const boxW = 44 * bracketIn;
      lines.rect(midX - boxW * 0.5, Y_SRGB + dy - 4, boxW, srgbH + 8, 2.4, withAlpha(P.signal, bracketIn * k));
      lines.rect(midX - boxW * 0.5, linY + dy - 4, boxW, linH + 8, 2.4, withAlpha(P.bone, 0.9 * revealLin * k));
      lines.fillCircle(midX, y50, 7 * bracketIn, withAlpha(P.bone, revealLin * k));
    }

    // 扫描游标：断开色带内部及图框边界，仅画外沿间隙与图区下垂
    if (t < 7.0) {
      const sx = ox + probeU * W_STRIP;
      const sv = 0.5 * (srgbToLinScalar(1 - probeU) + srgbToLinScalar(probeU));
      lines.seg(sx, Y_SRGB + dy - 6, sx, Y_SRGB + dy - 2, 1.8, withAlpha(P.bone, 0.85 * vis));
      lines.seg(sx, Y_SRGB + srgbH + dy + 2, sx, 465 + dy, 1.8, withAlpha(P.bone, 0.78 * vis));
      lines.seg(sx, 467 + dy, sx, gBot, 1.8, withAlpha(P.bone, 0.78 * vis));
      lines.fillCircle(sx, yAt(sv), 6.5, withAlpha(P.bone, vis));
    }

    // hook-3：从中点竖线 xStart = midX + 1 严密接至高亮框外沿 (s1x - 5)，并与样块高亮框保持 >=1px 净空
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
      lines.seg(xCorner, yMid, s1x - 5, yMid, 1.4, gCol);
      lines.seg(s1x + 69, yMid, s2x - 6, yMid, 1.5, withAlpha(P.bone, 0.55 * swatchPop * k));
      if (swFocusL > 0.04) {
        const g1 = 5 * swFocusL;
        lines.rect(s1x - 5 - g1 * 0.5, 486 + dy - 5 - g1 * 0.5, 74 + g1, 74 + g1, 2.0, withAlpha(P.signal, 0.85 * swFocusL * swatchPop * k));
      }
      if (swFocusR > 0.04) {
        const g2 = 5 * swFocusR;
        lines.rect(s2x - 5 - g2 * 0.5, 486 + dy - 5 - g2 * 0.5, 74 + g2, 74 + g2, 2.0, withAlpha(P.bone, 0.85 * swFocusR * swatchPop * k));
      }
      if (wireU > 0.01 && wireU < 0.99 && t >= 14.4 && t <= 17.8) {
        let pxW = xStart, pyW = yTop;
        if (wireU < 0.60) {
          pxW = lerp(xStart, xCorner, wireU / 0.60);
        } else if (wireU < 0.75) {
          pxW = xCorner;
          pyW = lerp(yTop, yMid, (wireU - 0.60) / 0.15);
        } else {
          pxW = lerp(xCorner, s1x - 5, (wireU - 0.75) / 0.25);
          pyW = yMid;
        }
        lines.fillCircle(pxW, pyW, 4.5, withAlpha(P.bone, 0.90 * swatchPop * k));
      }
    }

    // 标尺平滑承接并提前 1.3s 归零接下一镜，始终使用 k 透度
    const railU = t < 7.0 ? probeU : t < 19.1 ? 0.50 : lerp(0.50, 0.0, smoothstep(19.1, 20.4, t));
    drawSpectrumRail(ctx, { ...RAIL_BOX, probeU: railU, alpha: k, dx, dy });
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
      type.writeLine('sRGB 编码平均', 160 + dx, Y_SRGB + srgbH * 0.5 + 6 + dy, {
        anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(P.bone, 0.92 * labA),
      });
      if (revealLin > 0.08) {
        type.writeLine('Linear 线性平均', 160 + dx, linY + linH * 0.5 + 6 + dy, {
          anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(P.bone, 0.94 * revealLin * labA),
        });
      }
    }

    type.writeLine('50%', X0 - 14 + dx, y50 + 6, {
      anchor: 'right', size: 20, weight: 600, family: 'mono', color: css(P.ash, 0.85 * vis),
    });
    type.writeLine('0%', X0 - 14 + dx, gBot - 5, {
      anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.72 * vis),
    });
    type.writeLine('sRGB', mX + 17, gBot + 22, {
      anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(bracketIn > 0.1 ? P.signal : P.bone, 0.90 * vis),
    });
    if (revealLin > 0.08) {
      type.writeLine('Lin', mX + 73, gBot + 22, {
        anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.bone, 0.95 * revealLin * vis),
      });
    }

    if (bracketIn > 0.02) {
      const dyBrk = (1 - bracketIn) * 14;
      type.writeLine('50%', midX + 36, 546 + dyBrk + dy, {
        anchor: 'left', size: 72, weight: 800, family: 'mono', color: css(P.bone, bracketIn * k),
      });
      type.writeLine('Linear 物理光强', midX + 36, 578 + dyBrk * 0.4 + dy, {
        anchor: 'left', size: 20, weight: 500, family: 'sans', color: css(P.ash, 0.95 * bracketIn * k),
      });
      // 拉足 32px 基线间距 (826 - 794 = 32)，底部留足 14px 边距 (gBot = 840)
      type.writeLine('sRGB (128,128,0)', midX - 36, 826 + dyBrk * 0.4 + dy, {
        anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.95 * bracketIn * k),
      });
      if (pop214 < 0.98) {
        type.writeLine('物理光强 ?%', midX - 36, 790 + dyBrk * 0.4 + dy, {
          anchor: 'right', size: 20, weight: 600, family: 'sans', color: css(P.ash, 0.72 * bracketIn * (1 - pop214) * k),
        });
      }
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
      type.writeLine('21.4%', midX - 36, 794 + dyPop + dy, {
        anchor: 'right', size: 72, weight: 800, family: 'mono', color: css(P.signal, pop214 * k),
      });
    }

    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    const zoomRelease = 1 - smoothstep(19.1, 20.3, t);
    const zoomBoost = 0.022 * pop214 * zoomRelease;
    return oklabPost(f, { zoomBoost });
  },
});
