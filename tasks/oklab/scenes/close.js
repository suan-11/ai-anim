// @ts-check
/**
 * 06 · close —— 三代色带校准重聚 + 曲线弹直 + 蓝白验证与终局定帧（风格帧 #3）。
 * 严格按 f.lt 对齐 narration.json 真实词时间戳（slot = 15.000s）。
 */
import { Pass } from '../../../src/core/gl.js';
import { makeShot } from '../../../src/kit/index.js';
import {
  GLSL_OKLAB_MATH, RAIL_BOX, css, drawHeader, drawSpectrumRail, lerp, linToOklab,
  oklabPost, prog, sat, smoothstep, spring, srgbToLinScalar, withAlpha,
} from './_oklab.js';

const X0 = 400;
const W_STRIP = 1360;

// 底栏三列严格收进与主图 / RAIL_BOX 同轴的 x=400..1760
const C1_X = 400;
const C2_X = 916;
const C3_X = 1432;
const BAR_W = 480;
const BAR_Y = 784;
const BAR_H = 62;
const CARD_W = 328;

const CLOSE_FRAG = /* glsl */ `
${GLSL_OKLAB_MATH}
uniform vec2 uOffset;
uniform float uEnter;
uniform float uHeroGrow;
uniform float uSnap;
uniform float uBlueOn;
uniform float uCardOn;
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

  // 2) Oklab 主角条带：待机期纯净深暗空轨（绝不显 0.22 泥褐），3.8s 起居中幕布拉开明艳色带
  float mO = roundBoxMask(p, vec2(x0, uOkY), vec2(w, uOkH), 10.0);
  if (mO > 0.001 && u >= 0.0 && u <= 1.0) {
    float dC = abs(u - 0.5) * 2.0;
    float curtain = uHeroGrow > 0.01 ? (1.0 - smoothstep(uHeroGrow * 1.08 - 0.08, uHeroGrow * 1.08, dC)) : 0.0;
    float glint = exp(-pow((dC - uHeroGrow) * 16.0, 2.0)) * smoothstep(0.02, 0.2, uHeroGrow) * (1.0 - smoothstep(0.88, 1.0, uHeroGrow));
    vec3 okFill = mix(C_INK * 0.85, evalRedGreenOklab(u), curtain) + C_BONE * (0.26 * glint);
    col = mix(col, okFill, mO * uEnter);
    alpha = max(alpha, mO * uEnter);
  }
  float eO = roundBoxEdge(p, vec2(x0, uOkY), vec2(w, uOkH), 10.0, 1.8);
  if (eO > 0.001) {
    col = mix(col, mix(C_GRAPHITE * 0.58, C_BONE * 0.90, uHeroGrow), eO * mix(0.32, 0.95, uHeroGrow) * uEnter);
    alpha = max(alpha, eO * mix(0.32, 0.95, uHeroGrow) * uEnter);
  }

  // 3) 曲线凹陷底衬 (gTop=468, gBot=714, gH=222 全段恒定，均分上下呼吸)
  float gBot = 714.0;
  float gTop = 468.0;
  float gH = 222.0;
  float gMask = roundBoxMask(p, vec2(x0, gTop), vec2(w, 254.0), 8.0);
  if (gMask > 0.001) {
    col = mix(col, C_INK * 0.76, gMask * 0.72 * uEnter);
    alpha = max(alpha, gMask * 0.72 * uEnter);
  }
  float egMask = roundBoxEdge(p, vec2(x0, gTop), vec2(w, 254.0), 8.0, 1.0);
  if (egMask > 0.001) {
    col = mix(col, C_GRAPHITE * 0.85, egMask * 0.55 * uEnter);
    alpha = max(alpha, egMask * 0.55 * uEnter);
  }

  if (gMask > 0.001 && u >= 0.0 && u <= 1.0 && uSnap > 0.01) {
    vec3 srgbLin = evalRedGreenSrgb(u);
    float sL = linToOklab(srgbLin).x;
    float oL = mix(0.6280, 0.8664, u);
    float curL = mix(sL, oL, uSnap);
    float ySrgb = gBot - clamp((sL - 0.52) / 0.38, 0.0, 1.0) * gH;
    float yCur = gBot - clamp((curL - 0.52) / 0.38, 0.0, 1.0) * gH;
    if (p.y >= yCur && p.y <= ySrgb) {
      col = mix(col, C_SIGNAL, 0.22 * uSnap * uEnter);
    }
  }

  // 4) 同轴底部辅证三栏 (x=400..1760, y=784..846 等高齐平)：7.8s 起才展开蓝白带与规格卡，杜绝提前空黑框占位
  if (uBlueOn > 0.005) {
    float mCie = roundBoxMask(p, vec2(400.0, 784.0), vec2(480.0, 62.0), 8.0);
    if (mCie > 0.001) {
      float bu = sat((p.x - 400.0) / 480.0);
      vec3 cieShow = evalBlueWhiteCielab(bu) * 0.86;
      col = mix(col, cieShow, mCie * uBlueOn * uEnter);
      alpha = max(alpha, mCie * uBlueOn * uEnter);
    }
    float eCie = roundBoxEdge(p, vec2(400.0, 784.0), vec2(480.0, 62.0), 8.0, 1.2);
    if (eCie > 0.001) {
      col = mix(col, C_GRAPHITE * 1.12, eCie * 0.85 * uBlueOn * uEnter);
      alpha = max(alpha, eCie * 0.85 * uBlueOn * uEnter);
    }

    float mOkB = roundBoxMask(p, vec2(916.0, 784.0), vec2(480.0, 62.0), 8.0);
    if (mOkB > 0.001) {
      float bu = sat((p.x - 916.0) / 480.0);
      vec3 okbShow = evalBlueWhiteOklab(bu) * 0.90;
      col = mix(col, okbShow, mOkB * uBlueOn * uEnter);
      alpha = max(alpha, mOkB * uBlueOn * uEnter);
    }
    float eOkB = roundBoxEdge(p, vec2(916.0, 784.0), vec2(480.0, 62.0), 8.0, 1.4);
    if (eOkB > 0.001) {
      col = mix(col, C_BONE * 0.72, eOkB * 0.90 * uBlueOn * uEnter);
      alpha = max(alpha, eOkB * 0.90 * uBlueOn * uEnter);
    }
  }

  if (uCardOn > 0.005) {
    float mCard = roundBoxMask(p, vec2(1432.0, 784.0), vec2(328.0, 62.0), 8.0);
    if (mCard > 0.001) {
      col = mix(col, C_INK * 0.92, mCard * 0.82 * uCardOn * uEnter);
      alpha = max(alpha, mCard * 0.82 * uCardOn * uEnter);
    }
    float eCard = roundBoxEdge(p, vec2(1432.0, 784.0), vec2(328.0, 62.0), 8.0, 1.2);
    if (eCard > 0.001) {
      col = mix(col, C_GRAPHITE * 1.1, eCard * 0.75 * uCardOn * uEnter);
      alpha = max(alpha, eCard * 0.75 * uCardOn * uEnter);
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
    const midReady = smoothstep(1.60, 2.25, t);

    const heroGrow = smoothstep(3.8, 5.4, t);
    const snap = sat(spring((t - 7.35) * 1.9, 1, 120, 14));
    const blueOn = sat(smoothstep(7.8, 8.9, t));
    const sweepBlueU = t < 8.6 ? 0.15 : lerp(0.15, 0.50, smoothstep(8.6, 11.2, t));
    const finA = sat(spring((t - 10.4) * 2.0, 1, 120, 15));
    const endFade = prog(f.lt, Math.max(0, (f.end - f.start) - 0.85), f.end - f.start);

    const srgbY = 224;
    const srgbH = 26;
    const linY = 260;
    const linH = 26;
    const okY = lerp(312, 306, heroGrow);
    const okH = lerp(68, 128, heroGrow);

    this.pass.set({
      uOffset: [dx, dy],
      uEnter: vis,
      uHeroGrow: heroGrow,
      uSnap: snap,
      uBlueOn: blueOn,
      uCardOn: finA,
      uSrgbY: srgbY,
      uSrgbH: srgbH,
      uLinY: linY,
      uLinH: linH,
      uOkY: okY,
      uOkH: okH,
    }).render(gl, ctx.out, f.t, f.dt);

    lines.begin();
    const ox = X0 + dx;
    const gBot = 714 + dy;
    const gH = 222;
    const yAtL = (val) => gBot - sat((val - 0.52) / 0.38) * gH;

    lines.seg(ox, gBot, ox + W_STRIP, gBot, 1.2, withAlpha(P.graphite, 0.55 * vis));
    lines.seg(ox, yAtL(0.8664) - 10, ox, gBot, 1.2, withAlpha(P.graphite, 0.55 * vis));
    lines.seg(ox - 8, yAtL(0.8664), ox, yAtL(0.8664), 1.6, withAlpha(P.ash, 0.72 * vis));
    lines.seg(ox - 8, yAtL(0.6280), ox, yAtL(0.6280), 1.6, withAlpha(P.ash, 0.72 * vis));

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
      lines.seg(tipX, tipY, tipX, gBot, 1.4, withAlpha(P.bone, 0.35 * tipFadeOut * k));
      lines.fillCircle(tipX, tipY, 6.5, withAlpha(P.bone, tipFadeOut * k));
    }

    // 中点锚定与引导：外沿刻度绝不穿条带或穿图框，折线直指中点读数（含 L=0.581 橙色引线）
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
      // 下外沿引线止于 464（在图框顶边 468 之前干净收止）
      lines.seg(midX, okY + okH + dy + 2, midX, 464 + dy, 1.8, withAlpha(P.bone, 0.65 * heroGrow * k));
    }
    const dipCalloutA = sat((t - 0.9) / 0.55) * (1 - snap) * k;
    if (dipCalloutA > 0.02) {
      lines.seg(midX - 18, 538 + dy, midX, 538 + dy, 1.4, withAlpha(P.signal, 0.45 * dipCalloutA));
      lines.seg(midX, 538 + dy, midX, yDip, 1.4, withAlpha(P.signal, 0.45 * dipCalloutA));
    }
    if (midReady > 0.02) {
      // 从中点左侧 72px 读数右端折线指向 (midX, midY)
      lines.seg(midX - 18, 538 + dy, midX, 538 + dy, 1.4, withAlpha(P.bone, 0.45 * snap * k));
      lines.seg(midX, 538 + dy, midX, midY, 1.4, withAlpha(P.bone, 0.45 * snap * k));
      lines.fillCircle(midX, midY, 8 * midReady, withAlpha(P.signal, midReady * k));
    }

    if (blueOn > 0.02) {
      const c1CurX = C1_X + sweepBlueU * BAR_W + dx;
      const c2CurX = C2_X + sweepBlueU * BAR_W + dx;
      lines.seg(c1CurX, BAR_Y + dy - 4, c1CurX, BAR_Y + BAR_H + dy + 4, 2.2, withAlpha(P.signal, blueOn * k));
      lines.seg(c2CurX, BAR_Y + dy - 4, c2CurX, BAR_Y + BAR_H + dy + 4, 4.2, withAlpha(P.ink, 0.85 * blueOn * k));
      lines.seg(c2CurX, BAR_Y + dy - 4, c2CurX, BAR_Y + BAR_H + dy + 4, 2.0, withAlpha(P.bone, blueOn * k));
    }

    // 标尺透度始终用 k，保证 t=85.00s 切点不断并由前段 0.50 平滑归零展开
    const railU = t < 0.25 ? lerp(0.50, 0.0, smoothstep(0, 0.25, t)) : t < 2.85 ? curveTrace : t < 3.8 ? lerp(1.0, 0.50, returnMid) : t < 8.6 ? 0.50 : sweepBlueU;
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

    type.writeLine('sRGB (128,128,0)', 160 + dx, 244 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'mono', color: css(P.bone, (0.95 - 0.35 * heroGrow) * labRefA),
    });
    type.writeLine('Linear (188,188,0)', 160 + dx, 280 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'mono', color: css(P.bone, (0.92 - 0.30 * heroGrow) * labRefA),
    });

    const okLabelY = okY + okH * 0.5 + 7 + dy;
    if (heroGrow > 0.15) {
      type.writeLine('Oklab (208,168,0)', 160 + dx, okLabelY, {
        anchor: 'left', size: 20, weight: 700, family: 'mono', color: css(P.bone, heroGrow * labOkA),
      });
    } else {
      type.writeLine('Oklab', 160 + dx, okLabelY, {
        anchor: 'left', size: 20, weight: 700, family: 'mono', color: css(P.ash, 0.55 * labOkA),
      });
    }

    // 主数字群落直挂中点 x=1080 左侧安全区（远离左端，inFocus #1）
    type.writeLine('感知亮度 L: 0.628 → 0.866', midX - 28, 494 + dy, {
      anchor: 'right', size: 20, weight: 500, family: 'sans', color: css(P.ash, 0.88 * labOkA),
    });
    const preSnapA = sat((t - 0.9) / 0.55) * (1 - snap) * k;
    if (preSnapA > 0.02) {
      type.writeLine('L = 0.581', midX - 28, 562 + dy, {
        anchor: 'right', size: 72, weight: 800, family: 'mono', color: css(P.signal, preSnapA),
      });
    }
    if (snap > 0.02) {
      type.writeLine('L = 0.747', midX - 28, 562 + (1 - snap) * 14 + dy, {
        anchor: 'right', size: 72, weight: 800, family: 'mono', color: css(P.bone, snap * k),
      });
    }

    // 底部同轴三列 x=400..1760 (inFocus #2: 齐高 BAR_Y=784..846 + 左对齐规格卡)
    if (blueOn > 0.02) {
      type.writeLine('CIELAB · 偏紫', C1_X + dx, 774 + dy, {
        anchor: 'left', size: 20, weight: 600, family: 'sans', color: css(P.bone, 0.88 * blueOn * k),
      });
      type.writeLine('Oklab · 蓝→白', C2_X + dx, 774 + dy, {
        anchor: 'left', size: 20, weight: 700, family: 'sans', color: css(P.bone, 0.94 * blueOn * k),
      });
    }

    if (finA > 0.02) {
      type.writeLine('Oklab · 2020', C3_X + 24 + dx, 808 + dy, {
        anchor: 'left', size: 20, weight: 700, family: 'mono', color: css(P.bone, 0.92 * finA * k),
      });
      type.writeLine('CSS Color 4 · oklab()', C3_X + 24 + dx, 834 + dy, {
        anchor: 'left', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.92 * finA * k),
      });
    }

    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    const zoomBoost = 0.022 * snap;
    return oklabPost(f, { zoomBoost, fade: endFade });
  },
});
