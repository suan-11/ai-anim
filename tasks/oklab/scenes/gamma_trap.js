// @ts-check
/**
 * 02 · gamma_trap —— sRGB Gamma 2.2 编码压缩与人眼暗部敏感区间（手写定制）。
 * 所有节拍严格按 f.lt 对齐 timing.mjs 真实词时间戳（slot = 15.500s）。
 */
import { Pass } from '../../../src/core/gl.js';
import { makeShot } from '../../../src/kit/index.js';
import {
  GLSL_OKLAB_MATH, RAIL_BOX, css, drawHeader, drawSpectrumRail, lerp,
  oklabPost, sat, smoothstep, spring, srgbToLinScalar, withAlpha,
} from './_oklab.js';

const X_PLOT = 800;
const W_PLOT = 860;
const Y_BOT = 786;
const H_PLOT = 430;

const GAMMA_FRAG = /* glsl */ `
${GLSL_OKLAB_MATH}
uniform vec2 uOffset;
uniform float uEnter;
uniform float uBend;
uniform float uTrace;
uniform float uDarkFocus;
uniform float uSnap128;
uniform float uIntroSweep;
uniform float uTilesOn;

float evalCurve(float x, float bend) {
  float lin = toLinear(vec3(sat(x))).r;
  return mix(sat(x), lin, bend);
}

void main() {
  vec2 p = vec2(FRAG_PX.x, RES_LOGICAL.y - FRAG_PX.y) - uOffset;
  float alpha = 0.0;
  vec3 col = vec3(0.0);

  // 1) 左上对偶灰阶带（随入场统一柔和显现，绝不在 cut 后半秒沦为空心暗框，也不切亮度断崖）
  float mS = roundBoxMask(p, vec2(172.0, 298.0), vec2(220.0, 74.0), 8.0);
  float stripFade = smoothstep(0.0, 0.45, uEnter);
  if (mS > 0.001) {
    float gu = sat((p.x - 172.0) / 220.0);
    col = mix(col, toLinear(vec3(gu)), mS * stripFade);
    alpha = max(alpha, mS * stripFade);
  }
  float eS = roundBoxEdge(p, vec2(172.0, 298.0), vec2(220.0, 74.0), 8.0, 1.2);
  if (eS > 0.001) {
    col = mix(col, C_GRAPHITE * 1.15, eS * 0.78 * uEnter);
    alpha = max(alpha, eS * 0.78 * uEnter);
  }

  float mL = roundBoxMask(p, vec2(416.0, 298.0), vec2(220.0, 74.0), 8.0);
  if (mL > 0.001) {
    float gu = sat((p.x - 416.0) / 220.0);
    col = mix(col, vec3(gu), mL * stripFade);
    alpha = max(alpha, mL * stripFade);
  }
  float eL = roundBoxEdge(p, vec2(416.0, 298.0), vec2(220.0, 74.0), 8.0, 1.2);
  if (eL > 0.001) {
    col = mix(col, C_GRAPHITE * 1.15, eL * 0.78 * uEnter);
    alpha = max(alpha, eL * 0.78 * uEnter);
  }

  // 2) 左下 8 阶离散暗部敏感度对比（y=474..544 与 562..632：严格保持全 8 阶物理灰度单调递增，只用橙框突显暗部加密区）
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float su = (fi + 0.5) / 8.0;
    float cx = 172.0 + fi * 59.0;
    float tileRev = mix(0.18, 1.0, smoothstep(fi * 0.09, fi * 0.09 + 0.24, uTilesOn));

    float mt = roundBoxMask(p, vec2(cx, 474.0), vec2(51.0, 70.0), 6.0);
    if (mt > 0.001) {
      vec3 cTop = toLinear(vec3(su)) * tileRev;
      col = mix(col, cTop, mt * uEnter);
      alpha = max(alpha, mt * uEnter);
    }
    float et = roundBoxEdge(p, vec2(cx, 474.0), vec2(51.0, 70.0), 6.0, i < 4 && uDarkFocus > 0.2 ? 1.8 : 1.0);
    if (et > 0.001) {
      vec3 ec = i < 4 ? mix(C_GRAPHITE * 1.1, C_SIGNAL, 0.85 * uDarkFocus) : C_GRAPHITE;
      col = mix(col, ec, et * 0.85 * uEnter);
      alpha = max(alpha, et * 0.85 * uEnter);
    }

    float mb = roundBoxMask(p, vec2(cx, 562.0), vec2(51.0, 70.0), 6.0);
    if (mb > 0.001) {
      vec3 cBot = vec3(su) * tileRev;
      col = mix(col, cBot, mb * uEnter);
      alpha = max(alpha, mb * uEnter);
    }
    float eb = roundBoxEdge(p, vec2(cx, 562.0), vec2(51.0, 70.0), 6.0, 1.0);
    if (eb > 0.001) {
      col = mix(col, C_GRAPHITE * 1.05, eb * 0.68 * uEnter);
      alpha = max(alpha, eb * 0.68 * uEnter);
    }
  }

  // 3) 右侧凹陷传输曲线坐标系框 (x=700..1760, y=272..852, h=580 与 3 行字幕隔开 >=32px)
  float mRight = roundBoxMask(p, vec2(700.0, 272.0), vec2(1060.0, 580.0), 12.0);
  if (mRight > 0.001) {
    col = mix(col, C_INK * 0.76, mRight * 0.76 * uEnter);
    alpha = max(alpha, mRight * 0.76 * uEnter);
  }
  float eRight = roundBoxEdge(p, vec2(700.0, 272.0), vec2(1060.0, 580.0), 12.0, 1.1);
  if (eRight > 0.001) {
    col = mix(col, C_GRAPHITE * 0.92, eRight * 0.60 * uEnter);
    alpha = max(alpha, eRight * 0.60 * uEnter);
  }

  float xu = (p.x - 800.0) / 860.0;
  if (mRight > 0.001 && xu >= 0.0 && xu <= uTrace && uBend > 0.01) {
    float yRef = 786.0 - xu * 430.0;
    float yVal = 786.0 - evalCurve(xu, uBend) * 430.0;
    if (p.y >= yRef && p.y <= yVal) {
      float bandA = (0.12 + 0.16 * uSnap128) * uBend * smoothstep(0.0, 0.03, xu) * uEnter;
      col = mix(col, C_SIGNAL, bandA);
    }
  }

  // 4) 左下实时光强对比仪表框 (x=172..636, y=660..852)：上沿多留 8px 给 50%/21.4% 刻度呼吸
  float mMeter = roundBoxMask(p, vec2(172.0, 660.0), vec2(464.0, 192.0), 10.0);
  if (mMeter > 0.001) {
    col = mix(col, C_INK * 0.82, mMeter * 0.80 * uEnter);
    alpha = max(alpha, mMeter * 0.80 * uEnter);
  }
  float eMeter = roundBoxEdge(p, vec2(172.0, 660.0), vec2(464.0, 192.0), 10.0, 1.1);
  if (eMeter > 0.001) {
    col = mix(col, C_GRAPHITE * 1.05, eMeter * 0.65 * uEnter);
    alpha = max(alpha, eMeter * 0.65 * uEnter);
  }
  float meterX = mix(uTrace, 0.50, max(uSnap128, smoothstep(0.0, 0.45, uBend)));
  float meterSrgb = evalCurve(meterX, uBend);
  // 上条：sRGB 物理输出 (x=264..612，左侧留出 184..252 清晰标签栏；空轨提亮 + 描边)
  float mBgTop = roundBoxMask(p, vec2(264.0, 708.0), vec2(348.0, 34.0), 6.0);
  if (mBgTop > 0.001) {
    col = mix(col, C_INK * 1.68, mBgTop * 0.92 * uEnter);
  }
  float eBgTop = roundBoxEdge(p, vec2(264.0, 708.0), vec2(348.0, 34.0), 6.0, 1.0);
  if (eBgTop > 0.001) {
    col = mix(col, C_GRAPHITE * 0.65, eBgTop * 0.80 * uEnter);
  }
  float mBarSrgb = roundBoxMask(p, vec2(264.0, 708.0), vec2(max(8.0, 348.0 * meterSrgb), 34.0), 6.0);
  if (mBarSrgb > 0.001 && meterSrgb > 0.005) {
    vec3 barCol = mix(C_BONE * 0.78, C_SIGNAL, max(smoothstep(0.15, 0.65, uBend), uSnap128));
    col = mix(col, barCol, mBarSrgb * 0.94 * uEnter);
  }
  // 下条：线性参考 0 -> meterX (固定落在 50% 物理光强)
  float mBgBot = roundBoxMask(p, vec2(264.0, 778.0), vec2(348.0, 34.0), 6.0);
  if (mBgBot > 0.001) {
    col = mix(col, C_INK * 1.68, mBgBot * 0.92 * uEnter);
  }
  float eBgBot = roundBoxEdge(p, vec2(264.0, 778.0), vec2(348.0, 34.0), 6.0, 1.0);
  if (eBgBot > 0.001) {
    col = mix(col, C_GRAPHITE * 0.65, eBgBot * 0.80 * uEnter);
  }
  float mBarLin = roundBoxMask(p, vec2(264.0, 778.0), vec2(max(8.0, 348.0 * meterX), 34.0), 6.0);
  if (mBarLin > 0.001 && meterX > 0.005) {
    col = mix(col, C_BONE * 0.86, mBarLin * 0.90 * uEnter);
  }

  fragColor = vec4(col, sat(alpha));
}
`;

export default makeShot('gamma_trap', {
  setup(ctx) {
    this.pass = new Pass(ctx.gl, GAMMA_FRAG, {
      uOffset: [0, 0],
      uEnter: 1,
      uBend: 0,
      uTrace: 0,
      uDarkFocus: 0,
      uSnap128: 0,
      uIntroSweep: 0,
      uTilesOn: 0,
    }, { palette: ctx.P, key: 'oklab_gamma_trap' });
  },

  draw(ctx, { k, dx, dy }) {
    const { f, gl, lines, text, type, comp, P } = ctx;
    const t = f.lt;
    const vis = k;

    const trace = smoothstep(0.3, 3.6, t);
    const introSweep = smoothstep(0.3, 3.4, t);
    const tilesOn = smoothstep(0.5, 2.3, t);
    const darkFocus = smoothstep(3.9, 4.5, t) * (1 - smoothstep(5.6, 6.2, t));
    const bend = smoothstep(5.85, 7.55, t);
    const snap128 = sat(spring((t - 10.18) * 2.0, 1, 120, 14));

    this.pass.set({
      uOffset: [dx, dy],
      uEnter: vis,
      uBend: bend,
      uTrace: trace,
      uDarkFocus: darkFocus,
      uSnap128: snap128,
      uIntroSweep: introSweep,
      uTilesOn: tilesOn,
    }).render(gl, ctx.out, f.t, f.dt);

    lines.begin();

    // 左栏灰阶带开场追踪细游标 (0..3.6s) + 底部等亮度对照桥 (y=373..396)
    if (t < 3.6) {
      const stripScanA = (1 - smoothstep(3.3, 3.6, t)) * smoothstep(0.2, 0.5, t) * vis;
      lines.seg(172 + trace * 220 + dx, 298 + dy, 172 + trace * 220 + dx, 372 + dy, 1.8, withAlpha(P.bone, 0.72 * stripScanA));
      lines.seg(416 + trace * 220 + dx, 298 + dy, 416 + trace * 220 + dx, 372 + dy, 1.8, withAlpha(P.bone, 0.72 * stripScanA));
    }
    const sxMid = 172 + 110 + dx;
    const lx214 = 416 + 0.214 * 220 + dx;
    const bridgeTickA = sat(bend / 0.25) * vis;
    if (bridgeTickA > 0.01) {
      lines.seg(sxMid, 373 + dy, sxMid, 382 + dy, 2.0, withAlpha(P.signal, bridgeTickA));
      lines.seg(lx214, 373 + dy, lx214, 382 + dy, 2.0, withAlpha(P.signal, Math.max(bend * 0.5, snap128) * bridgeTickA));
    }
    if (bend > 0.15) {
      const bridgeA = sat((bend - 0.15) / 0.45) * vis;
      lines.seg(sxMid, 382 + dy, sxMid, 396 + dy, 1.5, withAlpha(P.signal, 0.75 * bridgeA));
      lines.seg(sxMid, 396 + dy, lx214, 396 + dy, 1.5, withAlpha(P.signal, 0.75 * bridgeA));
      lines.seg(lx214, 396 + dy, lx214, 382 + dy, 1.5, withAlpha(P.signal, 0.75 * bridgeA));
    }

    // 暗部关注括号精确紧贴上排 sRGB 前 4 格下沿 (y=552, 绝不套在下方 Linear 行外)
    if (darkFocus > 0.05) {
      const brkY = 552 + dy;
      const bw4 = 4 * 59 - 8;
      lines.seg(172 + dx, brkY - 5, 172 + dx, brkY, 1.8, withAlpha(P.signal, 0.88 * darkFocus * vis));
      lines.seg(172 + dx, brkY, 172 + bw4 + dx, brkY, 1.8, withAlpha(P.signal, 0.88 * darkFocus * vis));
      lines.seg(172 + bw4 + dx, brkY, 172 + bw4 + dx, brkY - 5, 1.8, withAlpha(P.signal, 0.88 * darkFocus * vis));
    }

    const gx0 = X_PLOT + dx;
    const gyBot = Y_BOT + dy;
    const xAt = (u) => gx0 + u * W_PLOT;
    const yAt = (v) => gyBot - v * H_PLOT;
    const curveY = (u) => lerp(u, srgbToLinScalar(u), bend);

    lines.seg(gx0, gyBot, gx0 + W_PLOT, gyBot, 1.5, withAlpha(P.graphite, 0.82 * vis));
    lines.seg(gx0, gyBot - H_PLOT, gx0, gyBot, 1.5, withAlpha(P.graphite, 0.82 * vis));
    lines.seg(gx0 - 8, yAt(1.0), gx0, yAt(1.0), 1.6, withAlpha(P.ash, 0.72 * vis));
    // 右图校准网格参考线 (0.25 / 0.50 / 0.75) 使 p15 读作精密仪表网格而非大片暗空
    for (const q of [0.25, 0.5, 0.75]) {
      const yq = yAt(q);
      const xq = xAt(q);
      const gcH = withAlpha(P.graphite, 0.24 * vis);
      for (let i = 0; i < 24; i++) {
        if (i % 2 === 1) continue;
        lines.seg(lerp(gx0, gx0 + W_PLOT, i / 24), yq, lerp(gx0, gx0 + W_PLOT, (i + 1) / 24), yq, 1.1, gcH);
      }
      for (let i = 0; i < 16; i++) {
        if (i % 2 === 1) continue;
        lines.seg(xq, lerp(gyBot, yAt(1.0), i / 16), xq, lerp(gyBot, yAt(1.0), (i + 1) / 16), 1.0, withAlpha(P.graphite, 0.22 * vis));
      }
    }
    if (snap128 > 0.02) {
      lines.seg(gx0 - 8, yAt(0.214), gx0, yAt(0.214), 2.0, withAlpha(P.signal, snap128 * vis));
    }
    if (bend > 0.08) {
      lines.seg(xAt(0.5), gyBot, xAt(0.5), gyBot + 8, 2.0, withAlpha(P.signal, sat((bend - 0.08) / 0.4) * vis));
    }

    for (let i = 0; i < 24; i++) {
      if (i % 2 === 1) continue;
      const u0 = i / 24, u1 = (i + 1) / 24;
      lines.seg(xAt(u0), yAt(u0), xAt(u1), yAt(u1), 1.6, withAlpha(P.ash, 0.42 * vis));
    }

    const steps = 64;
    const cMax = Math.max(1, Math.floor(trace * steps));
    if (trace > 0.01) {
      for (let i = 0; i < cMax; i++) {
        const u0 = i / steps, u1 = (i + 1) / steps;
        lines.seg(xAt(u0), yAt(curveY(u0)), xAt(u1), yAt(curveY(u1)), 3.8, withAlpha(P.signal, vis));
      }
      lines.fillCircle(xAt(trace), yAt(curveY(trace)), 6.0, withAlpha(P.bone, (1 - smoothstep(3.5, 4.0, t)) * (1 - snap128) * vis));
    }

    if (snap128 > 0.02) {
      const mx = xAt(0.5);
      const my = yAt(curveY(0.5));
      for (let i = 0; i < 14; i++) {
        if (i % 2 === 1) continue;
        const fx0 = lerp(mx, gx0, i / 14);
        const fx1 = lerp(mx, gx0, (i + 1) / 14);
        lines.seg(fx0, my, fx1, my, 1.8, withAlpha(P.signal, 0.78 * snap128 * k));
      }
      lines.seg(mx, gyBot, mx, my, 2.2, withAlpha(P.bone, 0.85 * snap128 * k));
      lines.fillCircle(mx, my, 8.5 * snap128, withAlpha(P.signal, k));
      lines.circle(mx, my, 12 * snap128, 2.0, withAlpha(P.bone, 0.9 * k));
      if (snap128 > 0.5) {
        const rPulse = 13 + 3.5 * Math.sin(Math.max(0, t - 10.18) * 2.2);
        lines.circle(mx, my, rPulse, 1.5, withAlpha(P.signal, 0.45 * snap128 * k));
      }
    }

    // 左下光强对比仪表刻度 (50% 参考线 + 21.4% 压缩对照刻度)
    const mx0 = 264 + dx;
    const mw = 348;
    const x50m = mx0 + mw * 0.50;
    const x214m = mx0 + mw * 0.214;
    lines.seg(x50m, 700 + dy, x50m, 820 + dy, 1.5, withAlpha(P.bone, 0.55 * vis));
    if (bend > 0.15 || snap128 > 0.02) {
      const mSigA = Math.max(sat((bend - 0.15) / 0.5) * 0.65, snap128) * vis;
      const x214Bot = snap128 > 0.05 ? 758 + dy : 746 + dy;
      lines.seg(x214m, 700 + dy, x214m, x214Bot, 2.0, withAlpha(P.signal, 0.90 * mSigA));
      if (snap128 > 0.05) {
        lines.seg(x214m, 758 + dy, x50m, 758 + dy, 1.4, withAlpha(P.signal, 0.55 * snap128 * k));
      }
    }

    // 4.0..5.85s 暗部前 4 格逐格扫亮并与曲线联动；10.8..14.0s 左下仪表盘 50% vs 21.4% 落差卡尺扫动
    if (darkFocus > 0.04) {
      const tileStep = smoothstep(4.0, 5.7, t);
      const tileIdx = Math.min(3, Math.floor(tileStep * 3.999));
      lines.rect(172 + tileIdx * 59 + dx - 2, 474 + dy - 2, 55, 74, 2.0, withAlpha(P.bone, 0.88 * darkFocus * vis));
      const uStep = (tileIdx + 0.5) / 8;
      lines.fillCircle(xAt(uStep), yAt(curveY(uStep)), 5.5, withAlpha(P.bone, 0.90 * darkFocus * vis));
    }
    const meterPulse = t > 10.8 && t < 14.0 ? smoothstep(10.8, 11.4, t) * (1 - smoothstep(13.4, 14.0, t)) : 0;
    if (meterPulse > 0.02) {
      const uGap = smoothstep(11.0, 12.8, t);
      lines.fillRect(x214m, 708 + dy, x50m - x214m, 34, withAlpha(P.signal, 0.18 * meterPulse * k), 4);
      lines.seg(x214m, 754 + dy, x214m, 762 + dy, 2.0, withAlpha(P.signal, 0.90 * meterPulse * k));
      lines.seg(x50m, 754 + dy, x50m, 762 + dy, 2.0, withAlpha(P.bone, 0.85 * meterPulse * k));
      lines.seg(x214m, 758 + dy, x50m, 758 + dy, 1.8, withAlpha(P.signal, 0.85 * meterPulse * k));
      lines.fillCircle(lerp(x50m, x214m, uGap), 758 + dy, 4.8, withAlpha(P.bone, 0.95 * meterPulse * k));
    }

    const railU = t < 0.35
      ? 0.0
      : t < 3.6
        ? trace
        : t < 6.8
          ? lerp(1.0, 0.50, smoothstep(3.6, 6.8, t))
          : t < 13.4
            ? 0.50
            : lerp(0.50, 0.0, smoothstep(13.4, 14.55, t));
    drawSpectrumRail(ctx, { ...RAIL_BOX, probeU: railU, alpha: k, dx, dy });
    lines.flush(ctx.out);

    text.clear();
    drawHeader(ctx, {
      num: '02',
      title: 'sRGB 编码压缩',
      rightLabel: 'γ ≈ 2.2 · IEC 61966-2-1',
      t, alpha: vis, dx, dy,
    });

    // offSubject #1 (y=280 -> top=264, 与 3 行字幕底 239.6 及下方条带 298 均有净空；直到 snap128>0.2 才揭晓 0.214，不提前剧透)
    type.writeLine(snap128 > 0.2 ? 'sRGB 中点 0.5' : 'sRGB 编码 (0→1)', 172 + dx, 280 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(P.bone, 0.92 * vis),
    });
    type.writeLine(snap128 > 0.2 ? 'Linear 等亮 0.214' : 'Linear 光强 (0→1)', 416 + dx, 280 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(P.ash, 0.90 * vis),
    });

    // inFocus #1 (暗部加密 y=450 归入上组；7.15s 对齐 "2.2 次" 词时间戳)
    type.writeLine('暗部加密 · 上 sRGB / 下 Linear', 172 + dx, 450 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(darkFocus > 0.25 ? P.signal : P.bone, 0.90 * vis),
    });

    type.writeLine('100%', X_PLOT - 14 + dx, yAt(1.0) + 6, {
      anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.82 * vis),
    });
    const popGamma = t >= 7.15 ? sat(spring((t - 7.15) * 2.4, 1, 120, 14)) : 0;
    if (popGamma < 0.98) {
      type.writeLine('sRGB', 844 + dx, 370 + dy, {
        anchor: 'left', size: 72, weight: 800, family: 'mono', color: css(P.bone, 0.78 * (1 - popGamma) * vis),
      });
    }
    if (popGamma > 0.02) {
      const gCol = [
        lerp(P.signal[0], P.bone[0] * 0.92, snap128 * 0.92),
        lerp(P.signal[1], P.bone[1] * 0.92, snap128 * 0.92),
        lerp(P.signal[2], P.bone[2] * 0.92, snap128 * 0.92),
      ];
      type.writeLine('γ ≈ 2.2', 844 + dx, 370 + (1 - popGamma) * 10 + dy, {
        anchor: 'left', size: 72, weight: 800, family: 'mono', color: css(gCol, popGamma * lerp(1.0, 0.88, snap128) * vis),
      });
    }
    type.writeLine(t < 7.15 ? '虚线 = 线性光强 · 纵轴 0%→100%' : '非线性编码压缩 · 纵轴线性光强', 844 + dx, 418 + dy, {
      anchor: 'left', size: 20, weight: 500, family: 'sans', color: css(P.ash, 0.76 * vis),
    });

    // inFocus #2 (左下仪表盘标注 + 右图 0.214 与横轴 0 / 0.5 / 1.0)
    type.writeLine('50%', x50m, 694 + dy, {
      anchor: 'center', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.82 * vis),
    });
    if (snap128 > 0.1) {
      type.writeLine('21.4%', x214m, 694 + dy, {
        anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.signal, 0.92 * snap128 * k),
      });
    }
    type.writeLine('sRGB', 184 + dx, 731 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'mono', color: css(snap128 > 0.1 ? P.signal : P.bone, 0.90 * vis),
    });
    type.writeLine('Lin', 184 + dx, 801 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'mono', color: css(P.bone, 0.90 * vis),
    });

    if (snap128 > 0.02) {
      type.writeLine('21.4%', X_PLOT - 14 + dx, yAt(0.214) + 6, {
        anchor: 'right', size: 20, weight: 600, family: 'mono', color: css(P.signal, 0.92 * snap128 * k),
      });
      type.writeLine('0.214', 1644 + dx, 716 + (1 - snap128) * 12 + dy, {
        anchor: 'right', size: 72, weight: 800, family: 'mono', color: css(P.signal, snap128 * k),
      });
      type.writeLine('sRGB 128 → 21.4% 光强', 1644 + dx, 756 + (1 - snap128) * 6 + dy, {
        anchor: 'right', size: 20, weight: 600, family: 'mono', color: css(P.bone, 0.94 * snap128 * k),
      });
    } else {
      const preLabel = t >= 7.15 ? 'x = 0.5 · 待测中点' : '编码输入 x = 0 → 1.0';
      type.writeLine(preLabel, 1644 + dx, 756 + dy, {
        anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.58 * vis),
      });
    }
    type.writeLine('0%', X_PLOT - 14 + dx, gyBot, {
      anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.75 * vis),
    });
    type.writeLine('0', xAt(0), gyBot + 26, {
      anchor: 'center', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.68 * vis),
    });
    type.writeLine('0.5', xAt(0.5), gyBot + 26, {
      anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(snap128 > 0.1 ? P.signal : P.ash, (bend > 0.08 ? 0.90 : 0.45) * vis),
    });
    type.writeLine('1.0', xAt(1.0), gyBot + 26, {
      anchor: 'center', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.68 * vis),
    });

    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    const zoomRelease = 1 - smoothstep(13.4, 14.55, t);
    const zoomBoost = 0.022 * snap128 * zoomRelease;
    return oklabPost(f, { zoomBoost });
  },
});
