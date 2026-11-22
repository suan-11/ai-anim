// @ts-check
/**
 * 05 · css_bridge —— CIELAB 蓝→白偏紫 vs Oklab 色相直走，以及 CSS Color 4 标准（手写定制）。
 * 严格按 f.lt 对齐 timing.mjs 真实词时间戳（slot = 13.000s）。
 */
import { Pass } from '../../../src/core/gl.js';
import { makeShot } from '../../../src/kit/index.js';
import {
  GLSL_OKLAB_MATH, RAIL_BOX, css, drawHeader, drawSpectrumRail, evalBlueWhiteCielabLin,
  lerp, linToOklab, oklabPost, sat, smoothstep, spring, withAlpha,
} from './_oklab.js';

const R_X = 964;
const R_Y = 272;
const R_W = 796;
const R_H = 580;

const A_MIN = -0.14;
const A_MAX = 0.16;
const B_MIN = -0.35;
const B_MAX = 0.04;

function abToScreen(a, b, dx = 0, dy = 0) {
  const u = (a - A_MIN) / (A_MAX - A_MIN);
  const v = 1 - (b - B_MIN) / (B_MAX - B_MIN);
  return [R_X + u * R_W + dx, R_Y + v * R_H + dy];
}

const CSS_FRAG = /* glsl */ `
${GLSL_OKLAB_MATH}
uniform vec2 uOffset;
uniform float uEnter;
uniform float uSweep;
uniform float uStripLit;
uniform float uSwVis;
uniform float uCssPop;
uniform float uProbeU;

void main() {
  vec2 p = vec2(FRAG_PX.x, RES_LOGICAL.y - FRAG_PX.y) - uOffset;
  float alpha = 0.0;
  vec3 col = vec3(0.0);

  // 1) 左上同轴双对比带 (x=160..920, y=332..488)：整体柔和显影，绝不截断灰暗半边
  float x0 = 160.0;
  float w = 760.0;
  float u = sat((p.x - x0) / w);
  float stripA = smoothstep(0.0, 0.55, uStripLit) * uEnter;

  float mCie = roundBoxMask(p, vec2(x0, 332.0), vec2(w, 70.0), 8.0);
  if (mCie > 0.001) {
    col = mix(col, evalBlueWhiteCielab(u), mCie * stripA);
    alpha = max(alpha, mCie * stripA);
  }
  float eCie = roundBoxEdge(p, vec2(x0, 332.0), vec2(w, 70.0), 8.0, 1.2);
  if (eCie > 0.001) {
    col = mix(col, C_SIGNAL * 0.85, eCie * 0.72 * stripA);
    alpha = max(alpha, eCie * 0.72 * stripA);
  }

  float mOk = roundBoxMask(p, vec2(x0, 418.0), vec2(w, 70.0), 8.0);
  if (mOk > 0.001) {
    col = mix(col, evalBlueWhiteOklab(u), mOk * stripA);
    alpha = max(alpha, mOk * stripA);
  }
  float eOk = roundBoxEdge(p, vec2(x0, 418.0), vec2(w, 70.0), 8.0, 1.3);
  if (eOk > 0.001) {
    col = mix(col, C_BONE * 0.78, eOk * 0.80 * stripA);
    alpha = max(alpha, eOk * 0.80 * stripA);
  }

  // 2) 左下 +a 紫色偏移对比槽 (x=160..716, y=684..844，曲线域收窄至 264..702 左侧对齐 +0.078) + 实时对照样块 (x=736..920)
  float mWave = roundBoxMask(p, vec2(160.0, 684.0), vec2(556.0, 160.0), 8.0);
  if (mWave > 0.001) {
    col = mix(col, C_INK * 0.76, mWave * 0.76 * uEnter);
    alpha = max(alpha, mWave * 0.76 * uEnter);
  }
  float eWave = roundBoxEdge(p, vec2(160.0, 684.0), vec2(556.0, 160.0), 8.0, 1.0);
  if (eWave > 0.001) {
    col = mix(col, C_GRAPHITE * 0.90, eWave * 0.58 * uEnter);
    alpha = max(alpha, eWave * 0.58 * uEnter);
  }

  float wu = (p.x - 264.0) / 438.0;
  if (mWave > 0.001 && wu >= 0.0 && wu <= uSweep) {
    vec3 cieLin = evalBlueWhiteCielab(wu);
    float cieA = linToOklab(cieLin).y;
    float yZero = 824.0;
    float yBulge = 824.0 - clamp(cieA / 0.085, 0.0, 1.0) * 133.0;
    if (p.y >= yBulge && p.y <= yZero) {
      float bandA = (0.16 + 0.16 * uCssPop) * smoothstep(0.0, 0.04, wu) * uEnter;
      col = mix(col, C_SIGNAL, bandA);
    }
  }

  if (uSwVis > 0.01) {
    float ms1 = roundBoxMask(p, vec2(736.0, 684.0), vec2(86.0, 160.0), 8.0);
    if (ms1 > 0.001) {
      col = mix(col, evalBlueWhiteCielab(uProbeU), ms1 * uSwVis * uEnter);
      alpha = max(alpha, ms1 * uSwVis * uEnter);
    }
    float es1 = roundBoxEdge(p, vec2(736.0, 684.0), vec2(86.0, 160.0), 8.0, 1.5);
    if (es1 > 0.001) {
      col = mix(col, C_SIGNAL, es1 * 0.85 * uSwVis * uEnter);
      alpha = max(alpha, es1 * 0.85 * uSwVis * uEnter);
    }

    float ms2 = roundBoxMask(p, vec2(834.0, 684.0), vec2(86.0, 160.0), 8.0);
    if (ms2 > 0.001) {
      col = mix(col, evalBlueWhiteOklab(uProbeU), ms2 * uSwVis * uEnter);
      alpha = max(alpha, ms2 * uSwVis * uEnter);
    }
    float es2 = roundBoxEdge(p, vec2(834.0, 684.0), vec2(86.0, 160.0), 8.0, 1.5);
    if (es2 > 0.001) {
      col = mix(col, C_BONE * 0.88, es2 * 0.85 * uSwVis * uEnter);
      alpha = max(alpha, es2 * 0.85 * uSwVis * uEnter);
    }
  }

  // 3) 右侧 Oklab (a, b) 暗棚极坐标参考平面 (纯暗底衬托高反差文字，蓝→紫扇区低亮示意色相，零黑色贴片补丁)
  float rX = 964.0, rY = 272.0, rW = 796.0, rH = 580.0;
  float mRight = roundBoxMask(p, vec2(rX, rY), vec2(rW, rH), 12.0);
  if (mRight > 0.001) {
    float uu = (p.x - rX) / rW;
    float vv = 1.0 - (p.y - rY) / rH;
    float aVal = mix(-0.14, 0.16, uu);
    float bVal = mix(-0.35, 0.04, vv);
    float chroma = length(vec2(aVal, bVal));
    float ang = atan(bVal, aVal);

    vec3 studio = mix(C_INK * 0.70, C_INK * 0.80, vv);
    float sectorMask = smoothstep(-2.15, -1.80, ang) * (1.0 - smoothstep(-0.75, -0.35, ang));
    float radialFade = smoothstep(0.035, 0.14, chroma) * (1.0 - smoothstep(0.28, 0.34, chroma));
    vec3 hueRef = sat(oklabToLin(vec3(0.56, aVal * 0.85, bVal * 0.85)));
    vec3 sliceCol = mix(studio, hueRef * 0.16, 0.72 * sectorMask * radialFade);

    float ringDist = min(abs(chroma - 0.10), min(abs(chroma - 0.20), abs(chroma - 0.30)));
    float ringLine = 1.0 - smoothstep(0.0008, 0.0022, ringDist);
    float ringArc = smoothstep(-2.3, -2.0, ang) * (1.0 - smoothstep(-0.55, -0.20, ang));
    sliceCol = mix(sliceCol, C_GRAPHITE * 0.95, ringLine * 0.32 * ringArc);

    col = mix(col, sliceCol, mRight * 0.94 * uEnter);
    alpha = max(alpha, mRight * 0.94 * uEnter);
  }
  float eRight = roundBoxEdge(p, vec2(rX, rY), vec2(rW, rH), 12.0, 1.2);
  if (eRight > 0.001) {
    col = mix(col, C_GRAPHITE * 1.12, eRight * 0.68 * uEnter);
    alpha = max(alpha, eRight * 0.68 * uEnter);
  }

  fragColor = vec4(col, sat(alpha));
}
`;

export default makeShot('css_bridge', {
  setup(ctx) {
    this.pass = new Pass(ctx.gl, CSS_FRAG, {
      uOffset: [0, 0],
      uEnter: 1,
      uSweep: 0,
      uStripLit: 0,
      uSwVis: 0,
      uCssPop: 0,
      uProbeU: 0,
    }, { palette: ctx.P, key: 'oklab_css_bridge' });

    this.okB = linToOklab(0, 0, 1);
    this.okW = linToOklab(1, 1, 1);
    this.ciePts = [];
    for (let i = 0; i <= 48; i++) {
      const u = i / 48;
      const lin = evalBlueWhiteCielabLin(u);
      const lab = linToOklab(lin[0], lin[1], lin[2]);
      this.ciePts.push([lab[1], lab[2]]);
    }
  },

  draw(ctx, { k, dx, dy }) {
    const { f, gl, lines, text, type, comp, P } = ctx;
    const t = f.lt;
    const vis = k;

    // 0.4..3.25s 停靠 CIELAB 偏紫峰谷 (u=0.42) 精准卡 "偏紫"@3.27 -> 3.6..6.8s 至 u=0.68 保留鲜明紫/蓝反差 -> 8.70s 锁定 0.50
    const probeU = t < 3.25
      ? lerp(0.0, 0.42, smoothstep(0.4, 3.25, t))
      : t < 6.8
        ? lerp(0.42, 0.68, smoothstep(3.6, 6.8, t))
        : lerp(0.68, 0.50, smoothstep(6.8, 8.70, t));
    const sweepFwd = t < 3.25
      ? lerp(0.0, 0.42, smoothstep(0.4, 3.25, t))
      : lerp(0.42, 1.0, smoothstep(3.6, 5.8, t));
    const waveFwd = sweepFwd;
    const stripLit = smoothstep(0.0, 0.75, t);
    const swVis = smoothstep(0.35, 0.85, t);
    const popPurple = sat(spring((t - 3.25) * 2.0, 1, 120, 15));
    const popPurpleWin = t > 3.20 && t < 4.9 ? smoothstep(3.20, 3.55, t) * (1 - smoothstep(4.2, 4.9, t)) : 0;
    const popCss = sat(spring((t - 8.70) * 2.0, 1, 120, 14));
    const sw1Hold = smoothstep(9.0, 9.4, t) * (1 - smoothstep(10.0, 10.3, t));
    const sw2Hold = smoothstep(10.2, 10.5, t) * (1 - smoothstep(11.3, 11.6, t));

    this.pass.set({
      uOffset: [dx, dy],
      uEnter: vis,
      uSweep: waveFwd,
      uStripLit: stripLit,
      uSwVis: swVis,
      uCssPop: popCss,
      uProbeU: probeU,
    }).render(gl, ctx.out, f.t, f.dt);

    lines.begin();

    const sx = 160 + probeU * 760 + dx;
    lines.seg(sx, 328 + dy, sx, 406 + dy, 2.2, withAlpha(P.signal, vis));
    lines.seg(sx, 414 + dy, sx, 492 + dy, 4.4, withAlpha(P.ink, 0.85 * vis));
    lines.seg(sx, 414 + dy, sx, 492 + dy, 2.2, withAlpha(P.bone, vis));

    const wX0 = 264 + dx;
    const wW = 438;
    const wYZero = 824 + dy;
    lines.seg(wX0, 700 + dy, wX0, wYZero, 1.3, withAlpha(P.graphite, 0.72 * vis));
    lines.seg(wX0 - 4, 702 + dy, wX0, 702 + dy, 1.4, withAlpha(P.signal, 0.72 * vis));
    lines.seg(wX0 - 4, wYZero, wX0, wYZero, 1.4, withAlpha(P.ash, 0.68 * vis));
    lines.seg(wX0, wYZero, wX0 + wW, wYZero, 1.4, withAlpha(P.bone, 0.55 * vis));
    for (let i = 0; i < 18; i++) {
      if (i % 2 === 1) continue;
      lines.seg(lerp(wX0, wX0 + wW, i / 18), 702 + dy, lerp(wX0, wX0 + wW, (i + 1) / 18), 702 + dy, 1.0, withAlpha(P.graphite, 0.36 * vis));
    }
    const wSteps = 48;
    const wMax = Math.max(1, Math.floor(waveFwd * wSteps));
    if (waveFwd > 0.02) {
      for (let i = 0; i < wMax; i++) {
        const u0 = i / wSteps, u1 = (i + 1) / wSteps;
        const a0 = this.ciePts[i][0], a1 = this.ciePts[i + 1][0];
        const y0 = wYZero - sat(a0 / 0.085) * 133;
        const y1 = wYZero - sat(a1 / 0.085) * 133;
        lines.seg(wX0 + u0 * wW, y0, wX0 + u1 * wW, y1, 3.2, withAlpha(P.signal, vis));
      }
      const wTrackU = Math.min(probeU, waveFwd);
      const wProbeX = wX0 + wTrackU * wW;
      const idxF = wTrackU * 48;
      const idx0 = Math.min(47, Math.floor(idxF));
      const aInterp = lerp(this.ciePts[idx0][0], this.ciePts[idx0 + 1][0], idxF - idx0);
      lines.fillCircle(wProbeX, wYZero - sat(aInterp / 0.085) * 133, 5.5, withAlpha(P.signal, vis));
      lines.fillCircle(wProbeX, wYZero, 5.0, withAlpha(P.bone, vis));
    }

    const [wx, wy] = abToScreen(0, 0, dx, dy);
    const [bx, by] = abToScreen(this.okB[1], this.okB[2], dx, dy);
    const spokeAngles = [-1.95, -1.75, -1.52, -1.28, -1.05];
    for (const ang of spokeAngles) {
      const sa = Math.cos(ang) * 0.28;
      const sb = Math.sin(ang) * 0.28;
      const [ex, ey] = abToScreen(sa, sb, dx, dy);
      lines.seg(wx, wy, lerp(wx, ex, 0.92), lerp(wy, ey, 0.92), 1.0, withAlpha(P.bone, 0.18 * vis));
    }

    lines.seg(bx, by, lerp(bx, wx, sweepFwd), lerp(by, wy, sweepFwd), 3.4, withAlpha(P.bone, 0.95 * vis));

    const pMax = Math.max(1, Math.floor(sweepFwd * 48));
    if (sweepFwd > 0.02) {
      for (let i = 0; i < pMax; i++) {
        const u0 = i / 48, u1 = (i + 1) / 48;
        const [x0, y0] = abToScreen(this.ciePts[i][0], this.ciePts[i][1], dx, dy);
        const [x1, y1] = abToScreen(this.ciePts[i + 1][0], this.ciePts[i + 1][1], dx, dy);
        lines.seg(x0, y0, x1, y1, 3.6, withAlpha(P.signal, vis));
        if (i % 4 === 0) {
          const oxP = lerp(bx, wx, u0), oyP = lerp(by, wy, u0);
          lines.seg(oxP, oyP, x0, y0, 1.2, withAlpha(P.signal, 0.32 * vis));
        }
      }
    }

    lines.fillCircle(wx, wy, 9.0, withAlpha(P.ink, 0.68 * vis));
    lines.circle(wx, wy, 6.5, 2.0, withAlpha(P.bone, vis));
    lines.fillCircle(bx, by, 6.5, [0.15, 0.35, 1.0, vis]);
    lines.circle(bx, by, 8.5, 2.0, withAlpha(P.bone, 0.85 * vis));

    const idxP = probeU * 48;
    const i0 = Math.min(47, Math.floor(idxP));
    const frac = idxP - i0;
    const curCieA = lerp(this.ciePts[i0][0], this.ciePts[i0 + 1][0], frac);
    const curCieB = lerp(this.ciePts[i0][1], this.ciePts[i0 + 1][1], frac);
    const [cPx, cPy] = abToScreen(curCieA, curCieB, dx, dy);
    const oPx = lerp(bx, wx, probeU), oPy = lerp(by, wy, probeU);
    if (popCss > 0.1) {
      lines.seg(oPx, oPy, cPx, cPy, 1.8, withAlpha(P.bone, 0.75 * popCss * k));
    }
    lines.fillCircle(cPx, cPy, 7.5, withAlpha(P.signal, vis));
    lines.circle(cPx, cPy, 10, 2.0, withAlpha(P.bone, 0.85 * vis));
    lines.fillCircle(oPx, oPy, 7.5, withAlpha(P.bone, vis));

    // 3.25s 偏紫峰值脉冲圈 + 9.0..11.5s 对照样块交替高光框 + 末尾 1.5s 标尺平滑归零衔接 close
    if (popPurpleWin > 0.04) {
      lines.circle(cPx, cPy, 13 + 5 * popPurpleWin, 1.8, withAlpha(P.signal, 0.80 * popPurpleWin * vis));
      lines.rect(732 + dx, 680 + dy, 94, 168, 2.4, withAlpha(P.signal, 0.92 * popPurpleWin * vis));
    }
    if (sw1Hold > 0.04) {
      lines.rect(732 + dx, 680 + dy, 94, 168, 2.4, withAlpha(P.signal, 0.92 * sw1Hold * k));
    }
    if (sw2Hold > 0.04) {
      lines.rect(830 + dx, 680 + dy, 94, 168, 2.4, withAlpha(P.bone, 0.92 * sw2Hold * k));
    }

    const railU = t < 0.4 ? 0.0 : t < 10.9 ? probeU : lerp(0.50, 0.0, smoothstep(10.9, 12.15, t));
    drawSpectrumRail(ctx, { ...RAIL_BOX, probeU: railU, alpha: k, dx, dy });
    lines.flush(ctx.out);

    text.clear();
    drawHeader(ctx, {
      num: '05',
      title: '蓝白与 CSS 标准',
      rightLabel: 'W3C CSS Color Module Level 4',
      t, alpha: vis, dx, dy,
    });

    // offSubject #1 (y=268..298 -> top=252 与 3 行字幕底 239.6 隔空，底距色带 332 有 34px 呼吸空间)
    type.writeLine(t < 3.25 ? '上 · CIELAB (蓝→白)' : '上 · CIELAB (蓝→白偏紫)', 160 + dx, 268 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(P.signal, 0.94 * vis),
    });
    type.writeLine('下 · Oklab (蓝→白恒定色相)', 160 + dx, 298 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(P.bone, 0.92 * vis),
    });

    // inFocus #1 (W(1,1,1) 提至点上方，彻底避开进场 CIELAB 弧线与橙点)
    type.writeLine('W(1,1,1)', wx + 12, wy - 18, {
      anchor: 'left', size: 20, weight: 600, family: 'mono', color: css(P.bone, 0.95 * vis),
    });
    type.writeLine(t < 3.25 ? '+a' : '+a 偏紫', R_X + R_W - 28 + dx, 354 + dy, {
      anchor: 'right', size: 20, weight: 600, family: 'sans', color: css(P.bone, Math.max(0.75, popPurple) * vis),
    });

    // offSubject #2 (左下 72px 在 t=8.70s 做一次决定性切换；+0.078 严格对齐 702 峰值虚线且左缘 >= 182 >> 160)
    if (popCss < 0.98) {
      type.writeLine('CIELAB vs Oklab', 160 + dx, 596 + dy, {
        anchor: 'left', size: 72, weight: 800, family: 'mono', color: css(P.bone, 0.78 * (1 - popCss) * vis),
      });
    }
    if (popCss > 0.02) {
      type.writeLine('CSS Color 4', 160 + dx, 596 + (1 - popCss) * 12 + dy, {
        anchor: 'left', size: 72, weight: 800, family: 'mono', color: css(P.bone, popCss * k),
      });
    }
    const subStr = t >= 8.70
      ? 'oklab(0.726 -0.016 -0.156) · oklch()'
      : (t >= 3.25 ? 'B(0,0,1) → W(1,1,1) · 恒定色相' : 'B(0,0,1) → W(1,1,1)');
    type.writeLine(subStr, 160 + dx, 633 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'mono', color: css(t >= 8.70 ? P.bone : P.ash, 0.92 * vis),
    });
    type.writeLine(t < 3.25 ? 'a 轴偏移' : 'a 轴偏移 (+a 偏紫)', 160 + dx, 669 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(P.ash, 0.88 * vis),
    });
    if (swVis > 0.02) {
      type.writeLine('CIELAB', 779 + dx, 669 + dy, {
        anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.signal, 0.90 * swVis * vis),
      });
      type.writeLine('Oklab', 877 + dx, 669 + dy, {
        anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.bone, 0.92 * swVis * vis),
      });
    }
    type.writeLine('+0.078', 254 + dx, 703 + dy, {
      anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.signal, 0.85 * vis),
    });
    type.writeLine('0', 254 + dx, 824 + dy, {
      anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.78 * vis),
    });

    // inFocus #2 (底部同排 y=818：左 Oklab (a, b) 净暗蓝底 + 右 B(0,0,1) -> W(1,1,1))
    type.writeLine('Oklab (a, b)', R_X + 24 + dx, 818 + dy, {
      anchor: 'left', size: 20, weight: 700, family: 'sans', color: css(P.bone, 0.94 * vis),
    });
    type.writeLine('B(0,0,1) → W(1,1,1)', R_X + R_W - 28 + dx, 818 + dy, {
      anchor: 'right', size: 20, weight: 600, family: 'mono', color: css(P.ash, 0.88 * vis),
    });

    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    const zoomRelease = 1 - smoothstep(10.8, 11.95, t);
    const zoomBoost = 0.022 * popCss * zoomRelease;
    return oklabPost(f, { zoomBoost });
  },
});
