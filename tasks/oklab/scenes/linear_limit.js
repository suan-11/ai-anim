// @ts-check
/**
 * 03 · linear_limit —— 线性光平均虽回到 50%，但感知亮度与色相仍非均匀（手写定制）。
 * 严格按 f.lt 对齐 timing.mjs 真实词时间戳（slot = 13.500s）。
 */
import { Pass } from '../../../src/core/gl.js';
import { makeShot } from '../../../src/kit/index.js';
import {
  GLSL_OKLAB_MATH, RAIL_BOX, css, drawHeader, drawSpectrumRail, lerp, linToOklab,
  oklabPost, sat, smoothstep, spring, withAlpha,
} from './_oklab.js';

const X0 = 400;
const W_STRIP = 1360;

const LINEAR_FRAG = /* glsl */ `
${GLSL_OKLAB_MATH}
uniform vec2 uOffset;
uniform float uEnter;
uniform float uSweep;
uniform float uBinsOn;
uniform float uPeakDev;
uniform float uHueScan;

void main() {
  vec2 p = vec2(FRAG_PX.x, RES_LOGICAL.y - FRAG_PX.y) - uOffset;
  float x0 = 400.0;
  float w = 1360.0;
  float u = (p.x - x0) / w;

  float alpha = 0.0;
  vec3 col = vec3(0.0);

  // 1) 主连续带：Linear 线性平均红→绿 (y=224..316)
  float mMain = roundBoxMask(p, vec2(x0, 224.0), vec2(w, 92.0), 8.0);
  if (mMain > 0.001 && u >= 0.0 && u <= 1.0) {
    float lit = 1.0 - smoothstep(uSweep - 0.02, uSweep + 0.008, u);
    vec3 cLin = evalRedGreenLinear(u) * mix(0.24, 1.0, lit);
    col = mix(col, cLin, mMain * uEnter);
    alpha = max(alpha, mMain * uEnter);
  }
  float eMain = roundBoxEdge(p, vec2(x0, 224.0), vec2(w, 92.0), 8.0, 1.2);
  if (eMain > 0.001) {
    col = mix(col, C_GRAPHITE * 1.15, eMain * 0.78 * uEnter);
    alpha = max(alpha, eMain * 0.78 * uEnter);
  }

  // 2) 十等分物理步距离散色块 (y=332..394)
  float binW = (w - 9.0 * 8.0) / 10.0;
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float bx = x0 + fi * (binW + 8.0);
    float bu = (fi + 0.5) / 10.0;
    float mb = roundBoxMask(p, vec2(bx, 332.0), vec2(binW, 62.0), 6.0);
    if (mb > 0.001) {
      float rev = smoothstep(fi * 0.08, fi * 0.08 + 0.16, uBinsOn);
      vec3 cBin = evalRedGreenLinear(bu) * mix(0.22, 1.0, rev);
      col = mix(col, cBin, mb * uEnter);
      alpha = max(alpha, mb * uEnter);
    }
    float eb = roundBoxEdge(p, vec2(bx, 332.0), vec2(binW, 62.0), 6.0, ((i == 4 || i == 5) && uPeakDev > 0.2) || (((i == 2 || i == 3) || i >= 8) && uHueScan > 0.01) ? 1.5 : 1.0);
    if (eb > 0.001) {
      vec3 ec = (i == 4 || i == 5) ? mix(C_GRAPHITE, C_BONE * 0.88, uPeakDev) : C_GRAPHITE;
      if ((i == 2 || i == 3) || i >= 8) {
        float huePulse = smoothstep(0.0, 0.2, uHueScan) * (1.0 - smoothstep(0.85, 1.0, uHueScan));
        ec = mix(ec, C_SIGNAL, 0.85 * huePulse);
      }
      col = mix(col, ec, eb * 0.75 * uEnter);
      alpha = max(alpha, eb * 0.75 * uEnter);
    }
  }

  // 3) 右侧感知偏差残差图凹陷底衬 (与顶部光谱条与底部标尺同轴 x=400..1760, y=446..804)
  float gTop = 446.0;
  float gBot = 790.0;
  float gH = 260.0;
  float mGraph = roundBoxMask(p, vec2(x0, gTop), vec2(w, 358.0), 10.0);
  if (mGraph > 0.001) {
    col = mix(col, C_INK * 0.76, mGraph * 0.76 * uEnter);
    alpha = max(alpha, mGraph * 0.76 * uEnter);
  }
  float eGraph = roundBoxEdge(p, vec2(x0, gTop), vec2(w, 358.0), 10.0, 1.1);
  if (eGraph > 0.001) {
    col = mix(col, C_GRAPHITE * 0.92, eGraph * 0.60 * uEnter);
    alpha = max(alpha, eGraph * 0.60 * uEnter);
  }

  if (mGraph > 0.001 && u >= 0.0 && u <= uSweep) {
    vec3 linRgb = evalRedGreenLinear(u);
    float realL = linToOklab(linRgb).x;
    float idealL = mix(0.6280, 0.8664, u);
    float dev = max(0.0, realL - idealL);
    float yDev = gBot - clamp(dev / 0.028, 0.0, 1.0) * gH;
    if (p.y >= yDev && p.y <= gBot) {
      float bandA = (0.18 + 0.22 * uPeakDev) * smoothstep(0.0, 0.03, u) * uEnter;
      col = mix(col, C_SIGNAL, bandA);
    }
  }

  fragColor = vec4(col, sat(alpha));
}
`;

export default makeShot('linear_limit', {
  setup(ctx) {
    this.pass = new Pass(ctx.gl, LINEAR_FRAG, {
      uOffset: [0, 0],
      uEnter: 1,
      uSweep: 0,
      uBinsOn: 0,
      uPeakDev: 0,
      uHueScan: 0,
    }, { palette: ctx.P, key: 'oklab_linear_limit' });

    this.stepLs = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      this.stepLs.push(linToOklab(1 - u, u, 0)[0]);
    }
    this.hueRates = [];
    for (let i = 0; i <= 64; i++) {
      const u = i / 64;
      const u0 = Math.max(0, u - 0.05);
      const u1 = Math.min(1, u + 0.05);
      const o0 = linToOklab(1 - u0, u0, 0);
      const o1 = linToOklab(1 - u1, u1, 0);
      const h0 = Math.atan2(o0[2], o0[1]) * 180 / Math.PI;
      const h1 = Math.atan2(o1[2], o1[1]) * 180 / Math.PI;
      this.hueRates.push(Math.abs(h1 - h0) * (0.1 / (u1 - u0)));
    }
  },

  draw(ctx, { k, dx, dy }) {
    const { f, gl, lines, text, type, comp, P } = ctx;
    const t = f.lt;
    const vis = k;

    const sweep = smoothstep(0.5, 5.0, t);
    const binsOn = smoothstep(1.0, 5.2, t);
    const pop188 = sat(spring((t - 5.55) * 2.2, 1, 120, 14));
    const popDev = sat(spring((t - 8.20) * 2.0, 1, 120, 14));
    const hueScan = smoothstep(9.2, 11.5, t);
    const hueWin = t > 9.2 && t < 12.1 ? smoothstep(9.2, 9.6, t) * (1 - smoothstep(11.6, 12.1, t)) : 0;

    this.pass.set({
      uOffset: [dx, dy],
      uEnter: vis,
      uSweep: sweep,
      uBinsOn: binsOn,
      uPeakDev: popDev,
      uHueScan: hueScan,
    }).render(gl, ctx.out, f.t, f.dt);

    lines.begin();
    const ox = X0 + dx;
    const px0 = ox;
    const pW = W_STRIP;
    const gBot = 790 + dy;
    const gH = 260;
    const devAt = (u) => Math.max(0, linToOklab(1 - u, u, 0)[0] - lerp(0.6280, 0.8664, u));
    const yAtDev = (d) => gBot - sat(d / 0.028) * gH;
    const yAtHue = (dh) => gBot - sat(dh / 21.5) * 192;

    // 1) 左栏收窄至 x=160..288 (maxStep=0.040 使白虚线落在 y=613.2，与右轴 +0.021 水平差 >=30px、垂直错开 25px)
    const dX = 160 + dx;
    const dBot = 786 + dy;
    const dH = 290;
    const maxStep = 0.040;
    lines.seg(dX, dBot - dH, dX, dBot, 1.2, withAlpha(P.graphite, 0.72 * vis));
    lines.seg(dX, dBot, dX + 128, dBot, 1.2, withAlpha(P.graphite, 0.72 * vis));
    for (let i = 0; i < 10; i++) {
      const dL = Math.max(0, this.stepLs[i + 1] - this.stepLs[i]);
      const barShow = smoothstep(i * 0.35 + 0.6, i * 0.35 + 1.3, t);
      const barH = (dL / maxStep) * dH * barShow;
      if (barH <= 1.5) continue;
      const bx = dX + 3 + i * 12.5;
      const byTop = dBot - barH;
      const bu = (i + 0.5) / 10;
      const isSkewEnd = i <= 1 || i >= 8;
      const barA = (isSkewEnd && popDev > 0.1 ? 0.92 : 0.72) * barShow * vis;
      lines.fillRect(bx, byTop, 8.5, barH, [1 - bu, bu, 0, barA], 2);
      if (isSkewEnd && popDev > 0.1) {
        lines.rect(bx, byTop, 8.5, barH, 1.6, withAlpha(P.signal, 0.92 * popDev * barShow * vis));
      } else {
        lines.rect(bx, byTop, 8.5, barH, 1.0, withAlpha(P.graphite, 0.65 * barShow * vis));
      }
    }
    const idealStepH = (0.02384 / maxStep) * dH;
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 1) continue;
      lines.seg(dX + (i / 10) * 128, dBot - idealStepH, dX + ((i + 1) / 10) * 128, dBot - idealStepH, 1.4, withAlpha(P.bone, 0.62 * vis));
    }
    lines.seg(dX, 461 + dy, dX + 6, 461 + dy, 1.4, withAlpha(P.bone, 0.68 * vis));
    lines.seg(dX + 10, 461 + dy, dX + 16, 461 + dy, 1.4, withAlpha(P.bone, 0.68 * vis));

    // 2) 右图 (与顶条/底标尺同轴 x=400..1760)：左纵轴 ΔL ∈ [0, +0.028] + 右纵轴 Δh 刻度 (随曲线渐显) + +0.021 虚线校准线
    const hueAxisVis = smoothstep(2.5, 3.8, t) * vis;
    lines.seg(px0, 472 + dy, px0, gBot, 1.3, withAlpha(P.graphite, 0.72 * vis));
    lines.seg(px0 + pW, 472 + dy, px0 + pW, gBot, 1.1, withAlpha(P.graphite, 0.50 * hueAxisVis));
    lines.seg(px0, gBot, px0 + pW, gBot, 1.5, withAlpha(P.bone, 0.50 * vis));
    const yPeakRef = yAtDev(0.0211);
    const yHue19 = yAtHue(19.0);
    lines.seg(px0 - 6, yPeakRef, px0, yPeakRef, 1.4, withAlpha(P.signal, 0.85 * vis));
    lines.seg(px0 - 6, gBot, px0, gBot, 1.4, withAlpha(P.ash, 0.72 * vis));
    if (hueAxisVis > 0.02) {
      lines.seg(px0 + pW - 6, yHue19, px0 + pW, yHue19, 1.4, withAlpha(P.ash, 0.72 * hueAxisVis));
      lines.seg(px0 + pW - 6, gBot, px0 + pW, gBot, 1.4, withAlpha(P.ash, 0.68 * hueAxisVis));
    }
    for (let i = 0; i < 24; i++) {
      if (i % 2 === 1) continue;
      lines.seg(lerp(px0, px0 + pW, i / 24), yPeakRef, lerp(px0, px0 + pW, (i + 1) / 24), yPeakRef, 1.0, withAlpha(P.graphite, 0.30 * vis));
    }

    const steps = 64;
    const cMax = Math.max(1, Math.floor(sweep * steps));
    if (sweep > 0.01) {
      // 色相步距率曲线 Δh(u)（红橙急剧陡转 19.0° vs 绿区停滞 3.3°）+ 感知亮度偏差拱弧 ΔL(u)
      for (let i = 0; i < cMax; i++) {
        const u0 = i / steps, u1 = (i + 1) / steps;
        if (i % 2 === 0) {
          lines.seg(px0 + u0 * pW, yAtHue(this.hueRates[i]), px0 + u1 * pW, yAtHue(this.hueRates[i + 1]), 2.2, withAlpha(P.bone, (0.48 + 0.42 * hueWin) * vis));
        }
        lines.seg(px0 + u0 * pW, yAtDev(devAt(u0)), px0 + u1 * pW, yAtDev(devAt(u1)), 3.8, withAlpha(P.signal, vis));
      }
      if (t < 5.0) {
        lines.fillCircle(px0 + sweep * pW, yAtDev(devAt(sweep)), 6.5, withAlpha(P.bone, vis));
      }
    }

    const midX = ox + 0.5 * W_STRIP;
    const yReal50 = yAtDev(devAt(0.5));
    if (t >= 5.0) {
      const mShow = smoothstep(5.0, 5.8, t) * vis;
      lines.seg(midX, 218 + dy, midX, 222 + dy, 2.0, withAlpha(P.bone, 0.8 * mShow));
      lines.seg(midX, 318 + dy, midX, 330 + dy, 2.0, withAlpha(P.bone, 0.8 * mShow));
      lines.seg(midX, 396 + dy, midX, 444 + dy, 2.0, withAlpha(P.bone, 0.72 * mShow));
      lines.seg(midX, 444 + dy, midX, yReal50, 1.6, withAlpha(P.bone, (0.35 + 0.35 * popDev) * mShow));
      if (popDev < 0.9) {
        lines.fillCircle(midX, yReal50, 5.5, withAlpha(P.bone, (1 - popDev) * mShow));
      }
      lines.rect(midX - 24, 220 + dy, 48, 100, 2.2, withAlpha(P.bone, 0.9 * pop188 * k));
    }
    if (popDev > 0.02) {
      lines.seg(midX, gBot, midX, yReal50, 2.8, withAlpha(P.signal, popDev * k));
      lines.fillCircle(midX, gBot, 5.5, withAlpha(P.bone, 0.90 * popDev * k));
      lines.fillCircle(midX, yReal50, 8.0, withAlpha(P.signal, popDev * k));
      const pulseR = 11.5 + 3.5 * Math.sin(Math.max(0, t - 8.2) * 2.2);
      lines.circle(midX, yReal50, pulseR, 1.6, withAlpha(P.signal, 0.48 * popDev * k));
    }
    if (hueWin > 0.02) {
      const binW = (W_STRIP - 9 * 8) / 10;
      const b2Start = ox + 2 * (binW + 8);
      const b3End = ox + 4 * binW + 3 * 8;
      const b8Start = ox + 8 * (binW + 8);
      const b9End = ox + W_STRIP;
      const brY = 402 + dy;
      lines.seg(b2Start, brY - 4, b2Start, brY, 1.6, withAlpha(P.signal, 0.85 * hueWin * k));
      lines.seg(b2Start, brY, b3End, brY, 1.6, withAlpha(P.signal, 0.85 * hueWin * k));
      lines.seg(b3End, brY, b3End, brY - 4, 1.6, withAlpha(P.signal, 0.85 * hueWin * k));
      lines.seg(b8Start, brY - 4, b8Start, brY, 1.6, withAlpha(P.signal, 0.85 * hueWin * k));
      lines.seg(b8Start, brY, b9End, brY, 1.6, withAlpha(P.signal, 0.85 * hueWin * k));
      lines.seg(b9End, brY, b9End, brY - 4, 1.6, withAlpha(P.signal, 0.85 * hueWin * k));
      const uSlope = lerp(0.05, 0.90, hueScan);
      const hIdx = uSlope * 64;
      const hi0 = Math.min(63, Math.floor(hIdx));
      const curHue = lerp(this.hueRates[hi0], this.hueRates[hi0 + 1], hIdx - hi0);
      lines.fillCircle(ox + uSlope * W_STRIP, yAtHue(curHue), 5.5, withAlpha(P.bone, 0.92 * hueWin * k));
    }

    // 标尺与活跃探针 100% 同步且全程平滑无跳变：8.50..9.20 平滑回到 0.05，11.50..12.90 归零接 oklab_mech
    const railU = t < 0.5
      ? 0.0
      : t < 5.0
        ? sweep
        : t < 5.8
          ? lerp(1.0, 0.50, smoothstep(5.0, 5.8, t))
          : t < 8.50
            ? 0.50
            : t < 9.20
              ? lerp(0.50, 0.05, smoothstep(8.50, 9.20, t))
              : t < 11.50
                ? lerp(0.05, 0.90, hueScan)
                : t < 12.90
                  ? lerp(0.90, 0.0, smoothstep(11.50, 12.90, t))
                  : 0.0;
    drawSpectrumRail(ctx, { ...RAIL_BOX, probeU: railU, alpha: k, dx, dy });
    lines.flush(ctx.out);

    text.clear();
    drawHeader(ctx, {
      num: '03',
      title: '线性光限度',
      rightLabel: 'Linear RGB ≠ 感知均匀',
      t, alpha: vis, dx, dy,
    });

    type.writeLine('Linear 光强平均', 172 + dx, 264 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(P.bone, 0.92 * vis),
    });
    if (pop188 < 0.98) {
      type.writeLine('50% 物理光强', 172 + dx, 294 + dy, {
        anchor: 'left', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.78 * (1 - pop188) * vis),
      });
    }
    if (pop188 > 0.02) {
      type.writeLine('(188,188,0)', 172 + dx, 294 + dy, {
        anchor: 'left', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.85 * pop188 * vis),
      });
    }

    type.writeLine('感知步距落差 ΔL', 160 + dx, 442 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(P.bone, 0.90 * vis),
    });
    type.writeLine('理想等步距', 182 + dx, 468 + dy, {
      anchor: 'left', size: 20, weight: 500, family: 'sans', color: css(P.ash, 0.72 * vis),
    });
    type.writeLine('0', 167 + dx, 808 + dy, {
      anchor: 'center', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.68 * vis),
    });
    type.writeLine('0.5', 224 + dx, 808 + dy, {
      anchor: 'center', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.68 * vis),
    });
    type.writeLine('1', 280 + dx, 808 + dy, {
      anchor: 'center', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.68 * vis),
    });
    type.writeLine('+0.021', ox - 10, yPeakRef - 6, {
      anchor: 'right', size: 20, weight: 600, family: 'mono', color: css(P.signal, 0.88 * vis),
    });
    type.writeLine('0', ox - 10, gBot + 6, {
      anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.74 * vis),
    });
    if (hueAxisVis > 0.02) {
      type.writeLine('Δh 19.0°', px0 + pW - 10, yHue19 + 2, {
        anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.72 * hueAxisVis),
      });
      type.writeLine('0°', px0 + pW - 6, 822 + dy, {
        anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.68 * hueAxisVis),
      });
    }
    type.writeLine('— ΔL 亮度偏差 · -- Δh 色相 (19.0°→3.3°)', 1062 + dx, 474 + dy, {
      anchor: 'right', size: 20, weight: 500, family: 'sans', color: css(P.ash, 0.78 * vis),
    });

    // t < 5.55 不提前剧透 188，对齐旁白 "188" (@5.70s) 平滑交叉淡换至 188
    if (pop188 < 0.98) {
      type.writeLine('50%', 436 + dx, 518 + dy, {
        anchor: 'left', size: 72, weight: 800, family: 'mono', color: css(P.bone, 0.72 * (1 - pop188) * vis),
      });
      type.writeLine('Linear 物理光强平均', 436 + dx, 552 + dy, {
        anchor: 'left', size: 20, weight: 500, family: 'sans', color: css(P.ash, 0.88 * (1 - pop188) * vis),
      });
    }
    if (pop188 > 0.02) {
      type.writeLine('188', 436 + dx, 518 + (1 - pop188) * 10 + dy, {
        anchor: 'left', size: 72, weight: 800, family: 'mono', color: css(P.bone, pop188 * k),
      });
      type.writeLine('Linear (188,188,0) · 50%', 436 + dx, 552 + dy, {
        anchor: 'left', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.92 * pop188 * k),
      });
    }

    if (popDev > 0.02) {
      type.writeLine('L = 0.768', 1724 + dx, 518 + (1 - popDev) * 12 + dy, {
        anchor: 'right', size: 72, weight: 800, family: 'mono', color: css(P.signal, popDev * k),
      });
      type.writeLine('+0.021 偏差 · 物理 50% ≠ 感知均匀', 1724 + dx, 552 + dy, {
        anchor: 'right', size: 20, weight: 600, family: 'sans', color: css(P.bone, 0.94 * popDev * k),
      });
    }

    if (hueWin > 0.05) {
      const binW = (W_STRIP - 9 * 8) / 10;
      type.writeLine('Δh 19.0°', ox + 3 * binW + 2.5 * 8, 424 + dy, {
        anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.signal, 0.92 * hueWin * k),
      });
      type.writeLine('Δh 3.3°', ox + 9 * binW + 8.5 * 8, 424 + dy, {
        anchor: 'center', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.78 * hueWin * k),
      });
    }

    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    const zoomRelease = 1 - smoothstep(11.6, 12.8, t);
    const zoomBoost = 0.022 * popDev * zoomRelease;
    return oklabPost(f, { zoomBoost });
  },
});
