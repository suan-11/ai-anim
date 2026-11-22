// @ts-check
/**
 * 06 · close —— 三代色带校准重聚 + 曲线弹直 + 蓝白验证与终局定帧（风格帧 #3）。
 * 严格按 f.lt 对齐 narration.json 真实词时间戳（slot = 15.000s）。
 */
import { Pass } from '../../../src/core/gl.js';
import { makeShot } from '../../../src/kit/index.js';
import {
  GLSL_OKLAB_MATH, RAIL_BOX, css, drawHeader, drawSpectrumRail, lerp, linToOklab,
  mul, oklabPost, prog, sat, smoothstep, spring, srgbToLinScalar, withAlpha,
} from './_oklab.js';

const X0 = 400;
const W_STRIP = 1360;

// 底栏三列严格居中对称 (x=400..1760：C1 400..800，C2 880..1280 中心严格对齐 x=1080，C3 1360..1760，BAR_H=70)
const C1_X = 400;
const C2_X = 880;
const C3_X = 1360;
const BAR_W = 400;
const BAR_Y = 786;
const BAR_H = 62;
const CARD_W = 400;

const CLOSE_FRAG = /* glsl */ `
${GLSL_OKLAB_MATH}
uniform vec2 uOffset;
uniform float uEnter;
uniform float uHeroGrow;
uniform float uSnap;
uniform float uBlueOn;
uniform float uCardOn;
uniform float uCalibSweep;
uniform float uCardGlow;
uniform float uCurveTrace;
uniform float uSrgbY;
uniform float uSrgbH;
uniform float uLinY;
uniform float uLinH;
uniform float uOkY;
uniform float uOkH;

void main() {
  vec2 p = vec2(FRAG_PX.x, RES_LOGICAL.y - FRAG_PX.y) - uOffset;
  float x0 = 400.0;
  float w = 1360.0;
  float u = (p.x - x0) / w;

  float alpha = 0.0;
  vec3 col = vec3(0.0);

  // 1) sRGB 与 Linear 旧方案条带（直接浮于暗调摄影棚，26px 高 + 10px 干净间隔）
  float dimTone = mix(0.96, 0.42, uHeroGrow);
  float mS = roundBoxMask(p, vec2(x0, uSrgbY), vec2(w, uSrgbH), 6.0);
  if (mS > 0.001 && u >= 0.0 && u <= 1.0) {
    col = mix(col, evalRedGreenSrgb(u) * dimTone, mS * uEnter);
    alpha = max(alpha, mS * uEnter);
  }
  float mL = roundBoxMask(p, vec2(x0, uLinY), vec2(w, uLinH), 6.0);
  if (mL > 0.001 && u >= 0.0 && u <= 1.0) {
    col = mix(col, evalRedGreenLinear(u) * (dimTone + 0.06), mL * uEnter);
    alpha = max(alpha, mL * uEnter);
  }

  // 2) Oklab 主角条带：待机期 (t < 3.55s) 绝不占位画空心黑框，伴随 heroGrow 居中弹簧展开并拉开明艳色带
  if (uHeroGrow > 0.01 && uOkH > 2.0) {
    float mO = roundBoxMask(p, vec2(x0, uOkY), vec2(w, uOkH), 10.0);
    if (mO > 0.001 && u >= 0.0 && u <= 1.0) {
      float dC = abs(u - 0.5) * 2.0;
      float curtain = 1.0 - smoothstep(uHeroGrow * 1.08 - 0.08, uHeroGrow * 1.08, dC);
      float glint = exp(-pow((dC - uHeroGrow) * 16.0, 2.0)) * smoothstep(0.02, 0.2, uHeroGrow) * (1.0 - smoothstep(0.88, 1.0, uHeroGrow));
      vec3 okFill = mix(C_INK * 0.85, evalRedGreenOklab(u), curtain) + C_BONE * (0.26 * glint);
      float sheenWin = smoothstep(0.0, 0.12, uCalibSweep) * (1.0 - smoothstep(0.88, 1.0, uCalibSweep));
      float sheen = exp(-pow((u - uCalibSweep) * 14.0, 2.0)) * sheenWin;
      okFill += C_BONE * (0.28 * sheen);
      col = mix(col, okFill, mO * uHeroGrow * uEnter);
      alpha = max(alpha, mO * uHeroGrow * uEnter);
    }
    float eO = roundBoxEdge(p, vec2(x0, uOkY), vec2(w, uOkH), 10.0, 1.8);
    if (eO > 0.001) {
      col = mix(col, C_BONE * 0.90, eO * 0.95 * uHeroGrow * uEnter);
      alpha = max(alpha, eO * 0.95 * uHeroGrow * uEnter);
    }
  }

  // 3) 曲线凹陷底衬：gBot 从 824 动态收至 696，顶部预留 34px 呼吸净空，纵轴 L ∈ [0.48, 0.89]
  float gTop = mix(408.0, 468.0, uHeroGrow);
  float gBot = mix(824.0, 696.0, uBlueOn);
  float gBoxH = max(160.0, gBot - gTop);
  float gH = max(120.0, gBoxH - 34.0);
  float gMask = roundBoxMask(p, vec2(x0, gTop), vec2(w, gBoxH), 8.0);
  if (gMask > 0.001) {
    col = mix(col, C_INK * 0.76, gMask * 0.72 * uEnter);
    alpha = max(alpha, gMask * 0.72 * uEnter);
  }
  float egMask = roundBoxEdge(p, vec2(x0, gTop), vec2(w, gBoxH), 8.0, 1.0);
  if (egMask > 0.001) {
    col = mix(col, C_GRAPHITE * 0.85, egMask * 0.55 * uEnter);
    alpha = max(alpha, egMask * 0.55 * uEnter);
  }

  if (gMask > 0.001 && u >= 0.0 && u <= 1.0) {
    vec3 srgbLin = evalRedGreenSrgb(u);
    float sL = linToOklab(srgbLin).x;
    float oL = mix(0.6280, 0.8664, u);
    float ySrgb = gBot - clamp((sL - 0.48) / 0.41, 0.0, 1.0) * gH;
    float yIdeal = gBot - clamp((oL - 0.48) / 0.41, 0.0, 1.0) * gH;
    float curL = mix(sL, oL, uSnap);
    float yCur = gBot - clamp((curL - 0.48) / 0.41, 0.0, 1.0) * gH;
    if (u <= uCurveTrace && uSnap < 0.99 && p.y >= yIdeal && p.y <= ySrgb) {
      col = mix(col, C_SIGNAL, 0.14 * (1.0 - uSnap) * smoothstep(0.0, 0.04, u) * uEnter);
    }
    if (uSnap > 0.01 && p.y >= yCur && p.y <= ySrgb) {
      col = mix(col, C_SIGNAL, 0.22 * uSnap * uEnter);
    }
  }

  // 4) 同轴底部辅证三栏 (x=400..1760：C1 400..800，C2 880..1280 居中对齐 midX=1080，C3 1360..1760，h=70)
  if (uBlueOn > 0.005) {
    float mCie = roundBoxMask(p, vec2(400.0, 786.0), vec2(400.0, 62.0), 8.0);
    if (mCie > 0.001) {
      float bu = sat((p.x - 400.0) / 400.0);
      vec3 cieShow = evalBlueWhiteCielab(bu) * 0.86;
      col = mix(col, cieShow, mCie * uBlueOn * uEnter);
      alpha = max(alpha, mCie * uBlueOn * uEnter);
    }
    float eCie = roundBoxEdge(p, vec2(400.0, 786.0), vec2(400.0, 62.0), 8.0, 1.2);
    if (eCie > 0.001) {
      col = mix(col, C_GRAPHITE * 1.12, eCie * 0.85 * uBlueOn * uEnter);
      alpha = max(alpha, eCie * 0.85 * uBlueOn * uEnter);
    }

    float mOkB = roundBoxMask(p, vec2(880.0, 786.0), vec2(400.0, 62.0), 8.0);
    if (mOkB > 0.001) {
      float bu = sat((p.x - 880.0) / 400.0);
      vec3 okbShow = evalBlueWhiteOklab(bu) * 0.90;
      col = mix(col, okbShow, mOkB * uBlueOn * uEnter);
      alpha = max(alpha, mOkB * uBlueOn * uEnter);
    }
    float eOkB = roundBoxEdge(p, vec2(880.0, 786.0), vec2(400.0, 62.0), 8.0, 1.4);
    if (eOkB > 0.001) {
      col = mix(col, C_BONE * 0.72, eOkB * 0.90 * uBlueOn * uEnter);
      alpha = max(alpha, eOkB * 0.90 * uBlueOn * uEnter);
    }
  }

  if (uCardOn > 0.005) {
    float mCard = roundBoxMask(p, vec2(1360.0, 786.0), vec2(400.0, 62.0), 8.0);
    if (mCard > 0.001) {
      col = mix(col, C_INK * 0.92, mCard * 0.82 * uCardOn * uEnter);
      alpha = max(alpha, mCard * 0.82 * uCardOn * uEnter);
    }
    float eCard = roundBoxEdge(p, vec2(1360.0, 786.0), vec2(400.0, 62.0), 8.0, 1.2);
    if (eCard > 0.001) {
      vec3 ecCol = mix(C_GRAPHITE * 1.1, C_BONE * 0.92, uCardGlow * 0.75);
      col = mix(col, ecCol, eCard * (0.75 + 0.20 * uCardGlow) * uCardOn * uEnter);
      alpha = max(alpha, eCard * (0.75 + 0.20 * uCardGlow) * uCardOn * uEnter);
    }
  }

  fragColor = vec4(col, sat(alpha));
}
`;

export default makeShot('close', {
  setup(ctx) {
    this.pass = new Pass(ctx.gl, CLOSE_FRAG, {
      uOffset: [0, 0],
      uEnter: 1,
      uHeroGrow: 0,
      uSnap: 0,
      uBlueOn: 0,
      uCardOn: 0,
      uCalibSweep: 0,
      uCardGlow: 0,
      uCurveTrace: 0,
      uSrgbY: 224,
      uSrgbH: 26,
      uLinY: 260,
      uLinH: 26,
      uOkY: 312,
      uOkH: 68,
    }, { palette: ctx.P, key: 'oklab_close' });
  },

  draw(ctx, { k, dx, dy }) {
    const { f, gl, lines, text, type, comp, P } = ctx;
    const t = f.lt;

    const vis = k;
    const labRefA = k;
    const labOkA = k;

    const curveTrace = smoothstep(0.25, 2.85, t);
    const tipFadeOut = 1 - smoothstep(2.85, 3.25, t);
    const returnMid = smoothstep(2.85, 3.70, t);
    const midReady = smoothstep(3.15, 3.75, t);

    const heroGrow = smoothstep(3.55, 5.20, t);
    const blueOn = sat(smoothstep(5.4, 6.7, t));
    const snap = sat(spring((t - 7.35) * 1.9, 1, 120, 14));
    const sweepBlueU = t < 6.4 ? 0.15 : lerp(0.15, 0.50, smoothstep(6.4, 10.2, t));
    const finA = sat(spring((t - 6.7) * 2.0, 1, 120, 15));
    const calibSweep = smoothstep(8.4, 10.4, t);
    const alignPulse = smoothstep(10.2, 10.9, t) * (1 - 0.65 * smoothstep(11.6, 12.4, t));
    const cardGlow = smoothstep(10.4, 11.2, t) * (1 - 0.65 * smoothstep(11.8, 12.5, t));
    const endFade = prog(f.lt, Math.max(0, (f.end - f.start) - 0.85), f.end - f.start);

    // 待机期 (t < 3.55s) 由 sRGB 与 Linear 各以 74px 高撑满上半区、下接动态图框 (gTop=408..gBot=824)；5.4s 起底栏居中 3 列对接
    const srgbY = 224;
    const srgbH = lerp(74, 26, heroGrow);
    const linY = lerp(310, 260, heroGrow);
    const linH = lerp(74, 26, heroGrow);
    const okY = lerp(380, 306, heroGrow);
    const okH = lerp(4, 128, heroGrow);

    this.pass.set({
      uOffset: [dx, dy],
      uEnter: vis,
      uHeroGrow: heroGrow,
      uSnap: snap,
      uBlueOn: blueOn,
      uCardOn: finA,
      uCalibSweep: calibSweep,
      uCardGlow: cardGlow,
      uCurveTrace: curveTrace,
      uSrgbY: srgbY,
      uSrgbH: srgbH,
      uLinY: linY,
      uLinH: linH,
      uOkY: okY,
      uOkH: okH,
    }).render(gl, ctx.out, f.t, f.dt);

    lines.begin();
    const ox = X0 + dx;
    const gTop = lerp(408, 468, heroGrow) + dy;
    const gBot = lerp(824, 696, blueOn) + dy;
    const gH = Math.max(120, gBot - gTop - 34);
    const yAtL = (val) => gBot - sat((val - 0.48) / 0.41) * gH;

    lines.seg(ox, Math.min(gTop + 12, yAtL(0.8664) - 10), ox, gBot, 1.2, withAlpha(P.graphite, 0.55 * vis));
    lines.seg(ox - 8, yAtL(0.8664), ox, yAtL(0.8664), 1.6, withAlpha(P.ash, 0.72 * vis));
    lines.seg(ox - 8, yAtL(0.6280), ox, yAtL(0.6280), 1.6, withAlpha(P.ash, 0.72 * vis));
    if (snap > 0.1) {
      lines.seg(ox - 8, yAtL(0.7472), ox, yAtL(0.7472), 1.8, withAlpha(P.signal, 0.88 * snap * k));
    }
    for (const lv of [0.6280, 0.7472, 0.8664]) {
      const ylv = yAtL(lv);
      const gc = lv === 0.7472 && snap > 0.1
        ? withAlpha(P.signal, 0.34 * snap * k)
        : withAlpha(P.graphite, 0.28 * vis);
      if (lv === 0.7472 && snap > 0.1) {
        const startX = ox + 432;
        const maxX = ox + W_STRIP * 0.5;
        const segs = 8;
        for (let i = 0; i < segs; i++) {
          if (i % 2 === 1) continue;
          lines.seg(lerp(startX, maxX, i / segs), ylv, lerp(startX, maxX, (i + 1) / segs), ylv, 1.1, gc);
        }
      } else {
        const maxX = ox + W_STRIP;
        const segs = 26;
        const avoidNum = t >= 3.25 && ylv >= gTop + 48 && ylv <= gTop + 136;
        for (let i = 0; i < segs; i++) {
          if (i % 2 === 1) continue;
          const sx0 = lerp(ox, maxX, i / segs);
          const sx1 = lerp(ox, maxX, (i + 1) / segs);
          if (avoidNum && sx1 >= ox + 12 && sx0 <= ox + 428) continue;
          lines.seg(sx0, ylv, sx1, ylv, 1.1, gc);
        }
      }
    }

    const steps = 64;
    if (curveTrace > 0.005) {
      const cMax = Math.max(1, Math.floor(curveTrace * steps));
      for (let i = 0; i < cMax; i++) {
        const u0 = i / steps;
        const u1 = (i + 1) / steps;
        const l0 = srgbToLinScalar(1 - u0), g0 = srgbToLinScalar(u0);
        const l1 = srgbToLinScalar(1 - u1), g1 = srgbToLinScalar(u1);
        const sL0 = linToOklab(l0, g0, 0)[0];
        const sL1 = linToOklab(l1, g1, 0)[0];
        const okL0 = lerp(0.6280, 0.8664, u0);
        const okL1 = lerp(0.6280, 0.8664, u1);
        if (i % 2 === 0 && snap < 0.05) {
          lines.seg(ox + u0 * W_STRIP, yAtL(okL0), ox + u1 * W_STRIP, yAtL(okL1), 1.5, withAlpha(P.bone, 0.36 * (1 - snap / 0.05) * vis));
        }
        if (i % 2 === 0 && snap > 0.02) {
          lines.seg(ox + u0 * W_STRIP, yAtL(sL0), ox + u1 * W_STRIP, yAtL(sL1), 1.6, withAlpha(P.ash, 0.42 * k));
        }
        const cur0 = lerp(sL0, okL0, snap);
        const cur1 = lerp(sL1, okL1, snap);
        lines.seg(ox + u0 * W_STRIP, yAtL(cur0), ox + u1 * W_STRIP, yAtL(cur1), 4.0, withAlpha(P.signal, vis));
      }

      // 曲线左右端点精细刻度小锚点 (L=0.628 与 L=0.866)
      lines.fillCircle(ox, yAtL(0.6280), 4.2 * curveTrace, withAlpha(P.bone, 0.72 * vis));
      if (curveTrace > 0.96) {
        lines.fillCircle(ox + W_STRIP, yAtL(0.8664), 4.2, withAlpha(P.bone, 0.72 * vis));
      }
    }

    if (curveTrace > 0.02 && tipFadeOut > 0.02) {
      const tipX = ox + curveTrace * W_STRIP;
      const tR = srgbToLinScalar(1 - curveTrace), tG = srgbToLinScalar(curveTrace);
      const tipL = linToOklab(tR, tG, 0)[0];
      const tipY = yAtL(tipL);
      lines.seg(tipX, tipY, tipX, yAtL(lerp(0.6280, 0.8664, curveTrace)), 1.4, withAlpha(P.bone, 0.42 * tipFadeOut * k));
      lines.fillCircle(tipX, tipY, 6.5, withAlpha(P.bone, tipFadeOut * k));
    }

    // 中点锚定与引导：hero 居中框 + 断开 C2 色带的垂直同轴对准线 (x=1080)
    const midX = ox + W_STRIP * 0.5;
    const midL = lerp(0.5807, 0.7472, snap);
    const midY = yAtL(midL);
    const yDip = yAtL(0.5807);
    const dipGuideA = midReady * (1 - snap) * k;
    if (dipGuideA > 0.02) {
      for (let i = 0; i < 16; i++) {
        if (i % 2 === 1) continue;
        const fx0 = ox + (midX - ox) * (i / 16);
        const fx1 = ox + (midX - ox) * ((i + 1) / 16);
        lines.seg(fx0, yDip, fx1, yDip, 1.4, withAlpha(P.signal, 0.55 * dipGuideA));
      }
      lines.seg(ox - 7, yDip, ox, yDip, 2.0, withAlpha(P.signal, dipGuideA));
    }
    if (heroGrow > 0.1) {
      lines.seg(midX, okY + okH + dy + 2, midX, gTop - 4, 1.8, withAlpha(P.bone, (0.65 + 0.35 * alignPulse) * heroGrow * k));
    }
    if (snap > 0.05) {
      lines.rect(midX - 24, okY + dy - 3, 48, okH + 6, 1.8, withAlpha(P.bone, 0.85 * snap * k));
    }
    const calloutY = gTop + 82;
    const calloutStartX = ox + 432;
    const dipCalloutA = sat((t - 3.30) / 0.45) * (1 - snap) * k;
    if (dipCalloutA > 0.02) {
      lines.seg(calloutStartX, calloutY, midX, calloutY, 1.4, withAlpha(P.signal, 0.45 * dipCalloutA));
      lines.seg(midX, calloutY, midX, yDip, 1.4, withAlpha(P.signal, 0.45 * dipCalloutA));
    }
    if (midReady > 0.02) {
      lines.fillCircle(midX, midY, 8 * midReady, withAlpha(P.signal, midReady * k));
    }
    if (alignPulse > 0.02) {
      // 直抵 C2 色带顶沿 (x=1080 在 C2 标签右方 75px 净空，绝不遮字) 并续接 RAIL_BOX
      lines.seg(midX, gBot + 4, midX, BAR_Y + dy - 4, 1.6, withAlpha(P.bone, 0.45 * alignPulse * k));
      lines.seg(midX, BAR_Y + BAR_H + dy + 6, midX, RAIL_BOX.y + dy - 8, 1.6, withAlpha(P.bone, 0.55 * alignPulse * k));
      lines.circle(midX, midY, 12 + 4 * alignPulse, 1.8, withAlpha(P.bone, 0.75 * alignPulse * k));
    }

    if (blueOn > 0.02) {
      const c1CurX = C1_X + sweepBlueU * BAR_W + dx;
      const c2CurX = C2_X + sweepBlueU * BAR_W + dx;
      lines.seg(c1CurX, BAR_Y + dy - 2, c1CurX, BAR_Y + BAR_H + dy + 2, 2.2, withAlpha(P.signal, blueOn * k));
      lines.seg(c2CurX, BAR_Y + dy - 2, c2CurX, BAR_Y + BAR_H + dy + 2, 4.2, withAlpha(P.ink, 0.85 * blueOn * k));
      lines.seg(c2CurX, BAR_Y + dy - 2, c2CurX, BAR_Y + BAR_H + dy + 2, 2.0, withAlpha(P.bone, blueOn * k));
    }

    // 标尺平滑承接上一镜 0.0 -> 0.25..2.85 随曲线扫至 1.0 -> 3.80 后稳锁中点 0.50
    const railU = t < 0.25 ? 0.0 : t < 2.85 ? curveTrace : t < 3.8 ? lerp(1.0, 0.50, returnMid) : 0.50;
    drawSpectrumRail(ctx, { ...RAIL_BOX, probeU: railU, alpha: k, dx, dy });
    lines.flush(ctx.out);

    // ── 文字层：严格 3 档字号 (20 / 28 / 72)，offSubject=2 / inFocus=2 ──
    text.clear();
    drawHeader(ctx, {
      num: '06',
      title: '终局校准',
      rightLabel: 'sRGB → Oklab',
      t, alpha: vis, dx, dy,
    });

    const srgbLabelY = srgbY + srgbH * 0.5 + 7 + dy;
    const linLabelY = linY + linH * 0.5 + 7 + dy;
    type.writeLine('sRGB (128,128,0)', 160 + dx, srgbLabelY, {
      anchor: 'left', size: 20, weight: 600, family: 'mono', color: css(mul(P.bone, lerp(0.96, 0.56, heroGrow)), labRefA),
    });
    type.writeLine('Linear (188,188,0)', 160 + dx, linLabelY, {
      anchor: 'left', size: 20, weight: 600, family: 'mono', color: css(mul(P.bone, lerp(0.92, 0.58, heroGrow)), labRefA),
    });

    const okLabelY = okY + okH * 0.5 + 7 + dy;
    if (heroGrow > 0.08) {
      type.writeLine('Oklab (208,168,0)', 160 + dx, okLabelY, {
        anchor: 'left', size: 20, weight: 700, family: 'mono', color: css(P.bone, heroGrow * labOkA),
      });
    }

    // 主数字群落左对齐于图区左上净空（纵轴刻度 0.866 / 0.747 / 0.628 置于轴外 ox-14 纳入 FOCUS_CLOSE）
    type.writeLine('0.866', ox - 14, yAtL(0.8664) + 6, {
      anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.78 * vis),
    });
    if (snap > 0.1) {
      type.writeLine('0.747', ox - 14, yAtL(0.7472) + 6, {
        anchor: 'right', size: 20, weight: 600, family: 'mono', color: css(P.signal, 0.92 * snap * k),
      });
    }
    type.writeLine('0.628', ox - 14, yAtL(0.6280) + 6, {
      anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.78 * vis),
    });
    type.writeLine('感知亮度 L: 0.628 → 0.866', ox + 20, gTop + 26, {
      anchor: 'left', size: 20, weight: 500, family: 'sans', color: css(P.ash, 0.88 * labOkA),
    });
    const preSnapA = sat((t - 3.30) / 0.45) * (1 - snap) * k;
    if (preSnapA > 0.02) {
      type.writeLine('L = 0.581', ox + 20, gTop + 116, {
        anchor: 'left', size: 72, weight: 800, family: 'mono', color: css(P.signal, preSnapA),
      });
    }
    if (snap > 0.02) {
      type.writeLine('L = 0.747', ox + 20, gTop + 116 + (1 - snap) * 14, {
        anchor: 'left', size: 72, weight: 800, family: 'mono', color: css(P.bone, snap * k),
      });
    }

    // 底部同轴居中三列 x=400..1760 (C2 中心严格等于 1080 = midX)
    if (blueOn > 0.02) {
      type.writeLine('CIELAB · 偏紫', C1_X + dx, 772 + dy, {
        anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(P.bone, 0.88 * blueOn * k),
      });
      type.writeLine('Oklab · 蓝→白', C2_X + dx, 772 + dy, {
        anchor: 'left', size: 20, weight: 700, family: 'sans', color: css(P.bone, 0.94 * blueOn * k),
      });
    }

    if (finA > 0.02) {
      type.writeLine('Oklab · 2020', C3_X + 24 + dx, 807 + dy, {
        anchor: 'left', size: 20, weight: 700, family: 'mono', color: css(P.bone, 0.92 * finA * k),
      });
      type.writeLine('CSS Color 4 · oklab()', C3_X + 24 + dx, 836 + dy, {
        anchor: 'left', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.92 * finA * k),
      });
    }

    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    const zoomBoost = 0.022 * snap;
    return oklabPost(f, { zoomBoost, fade: endFade });
  },
});
