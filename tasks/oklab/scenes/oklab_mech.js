// @ts-check
/**
 * 04 · oklab_mech —— Oklab 无框流式三步变换管线 + 动态 L(u) 色域切片（风格帧 #2）。
 * 严格按 f.lt 对齐 narration.json 真实词时间戳（slot = 24.500s）。
 */
import { Pass } from '../../../src/core/gl.js';
import { makeShot } from '../../../src/kit/index.js';
import {
  GLSL_OKLAB_MATH, RAIL_BOX, css, drawHeader, drawSpectrumRail, lerp, linToOklab,
  oklabPost, oklabToLin, sat, smoothstep, spring, withAlpha,
} from './_oklab.js';

const R_X = 924;
const R_Y = 212;
const R_W = 836;
const R_H = 640;

// 色域切面视窗：a ∈ [-0.34, +0.30], b ∈ [-0.40, +0.32]（右留 L 标尺、底留 72px 读数净空、pG 距顶标 >=32px、L=0.628..0.866 零压字）
const A_MIN = -0.34;
const A_MAX = 0.30;
const B_MIN = -0.40;
const B_MAX = 0.32;

function abToScreen(a, b, dx = 0, dy = 0) {
  const u = (a - A_MIN) / (A_MAX - A_MIN);
  const v = 1 - (b - B_MIN) / (B_MAX - B_MIN);
  return [R_X + u * R_W + dx, R_Y + v * R_H + dy];
}

const MECH_FRAG = /* glsl */ `
${GLSL_OKLAB_MATH}
uniform vec2 uOffset;
uniform float uEnter;
uniform float uSliceL;
uniform float uSliceLit;
uniform float uPathU;
uniform float uCbrtU;
uniform float uTone1;
uniform float uTone2;
uniform float uTone3;
uniform float uStage3Show;
uniform float uSliceReveal;
uniform float uMapReveal;

void main() {
  vec2 p = vec2(FRAG_PX.x, RES_LOGICAL.y - FRAG_PX.y) - uOffset;
  float alpha = 0.0;
  vec3 col = vec3(0.0);

  // ── 无框流式管线：直接浮于暗调摄影棚，Stage 1 (RGB -> M1) · Stage 2 (x^1/3) · Stage 3 (M2 -> 校准带) ──
  // Stage 1: 真实 [1-u, u, 0] RGB 输入格（B=0 常暗）+ 3×3 M1 权重矩阵
  for (int r = 0; r < 3; r++) {
    float ry = 294.0 + float(r) * 42.0;
    float mIn = roundBoxMask(p, vec2(180.0, ry), vec2(24.0, 24.0), 4.0);
    float eIn = roundBoxEdge(p, vec2(180.0, ry), vec2(24.0, 24.0), 4.0, 1.0);
    if (mIn > 0.001) {
      vec3 pc = r == 0 ? vec3(1.0, 0.08, 0.08) * (0.28 + 0.72 * (1.0 - uPathU)) * uTone1
              : r == 1 ? vec3(0.08, 0.95, 0.12) * (0.22 + 0.78 * uPathU) * uTone1
              : vec3(0.14, 0.24, 0.55) * 0.06;
      col = mix(col, pc, mIn * uEnter);
      alpha = max(alpha, mIn * uEnter);
    }
    if (eIn > 0.001) {
      col = mix(col, C_GRAPHITE, eIn * 0.65 * uTone1 * uEnter);
      alpha = max(alpha, eIn * 0.65 * uTone1 * uEnter);
    }
  }
  mat3 mw = mat3(
    0.412, 0.212, 0.088,
    0.536, 0.681, 0.282,
    0.051, 0.107, 0.630
  );
  for (int row = 0; row < 3; row++) {
    for (int cIdx = 0; cIdx < 3; cIdx++) {
      float cx = 240.0 + float(cIdx) * 26.0;
      float cy = 294.0 + float(row) * 42.0;
      float mc = roundBoxMask(p, vec2(cx, cy + 1.0), vec2(21.0, 21.0), 4.0);
      if (mc > 0.001) {
        float wv = mw[cIdx][row];
        vec3 cellC = mix(C_INK * 1.15, mix(C_BONE, C_SIGNAL, wv > 0.45 ? 0.58 : 0.0), (0.18 + 0.82 * wv) * uTone1);
        col = mix(col, cellC, mc * uEnter);
        alpha = max(alpha, mc * uEnter);
      }
    }
  }

  // Stage 2: x^(1/3) 暗部感知拉伸阴影面积
  float px0 = 560.0, pw = 304.0, pyBot = 414.0, ph = 122.0;
  float xu = (p.x - px0) / pw;
  if (xu >= 0.0 && xu <= uCbrtU && p.y <= pyBot && p.y >= pyBot - ph) {
    float yLin = pyBot - xu * ph;
    float yCurve = pyBot - pow(max(xu, 1e-5), 1.0 / 3.0) * ph;
    if (p.y >= yCurve && p.y <= yLin) {
      float areaA = (0.10 + 0.22 * uTone2) * uEnter;
      col = mix(col, C_SIGNAL, areaA);
      alpha = max(alpha, areaA);
    }
  }

  // Stage 3: M2 三列真实 GLSL 感知条（L / a / b）+ Oklab 红→绿条带：t=1.2..2.8s 提前铺出低亮度真渐变预演（零黑洞、零空黑框）
  if (uStage3Show > 0.005) {
    float bw = 214.0, bh = 52.0, by = 548.0;
    float s3A = uStage3Show * uEnter;
    float m2Lit = smoothstep(0.24, 1.0, uTone3);
    float mBarL = roundBoxMask(p, vec2(180.0, by), vec2(bw, bh), 6.0);
    if (mBarL > 0.001) {
      float bu = sat((p.x - 180.0) / bw);
      vec3 cL = sat(oklabToLin(vec3(bu, 0.0, 0.0)));
      col = mix(col, cL * mix(0.28, 1.0, m2Lit), mBarL * s3A);
      alpha = max(alpha, mBarL * s3A);
    }
    float eBarL = roundBoxEdge(p, vec2(180.0, by), vec2(bw, bh), 6.0, 1.2);
    if (eBarL > 0.001) {
      col = mix(col, C_GRAPHITE * 1.15, eBarL * mix(0.35, 0.90, m2Lit) * s3A);
      alpha = max(alpha, eBarL * mix(0.35, 0.90, m2Lit) * s3A);
    }

    float mBarA = roundBoxMask(p, vec2(415.0, by), vec2(bw, bh), 6.0);
    if (mBarA > 0.001) {
      float bu = sat((p.x - 415.0) / bw);
      vec3 cA = sat(oklabToLin(vec3(0.747, mix(-0.30, 0.30, bu), 0.0)));
      col = mix(col, cA * mix(0.28, 1.0, m2Lit), mBarA * s3A);
      alpha = max(alpha, mBarA * s3A);
    }
    float eBarA = roundBoxEdge(p, vec2(415.0, by), vec2(bw, bh), 6.0, 1.2);
    if (eBarA > 0.001) {
      col = mix(col, C_GRAPHITE * 1.15, eBarA * mix(0.35, 0.90, m2Lit) * s3A);
      alpha = max(alpha, eBarA * mix(0.35, 0.90, m2Lit) * s3A);
    }

    float mBarB = roundBoxMask(p, vec2(650.0, by), vec2(bw, bh), 6.0);
    if (mBarB > 0.001) {
      float bu = sat((p.x - 650.0) / bw);
      vec3 cB = sat(oklabToLin(vec3(0.747, 0.0, mix(-0.30, 0.30, bu))));
      col = mix(col, cB * mix(0.28, 1.0, m2Lit), mBarB * s3A);
      alpha = max(alpha, mBarB * s3A);
    }
    float eBarB = roundBoxEdge(p, vec2(650.0, by), vec2(bw, bh), 6.0, 1.2);
    if (eBarB > 0.001) {
      col = mix(col, C_GRAPHITE * 1.15, eBarB * mix(0.35, 0.90, m2Lit) * s3A);
      alpha = max(alpha, eBarB * mix(0.35, 0.90, m2Lit) * s3A);
    }

    float mMap = roundBoxMask(p, vec2(180.0, 668.0), vec2(684.0, 136.0), 8.0);
    if (mMap > 0.001) {
      float mu = sat((p.x - 180.0) / 684.0);
      float rev = 1.0 - smoothstep(uMapReveal - 0.025, uMapReveal + 0.005, mu);
      vec3 show = evalRedGreenOklab(mu) * mix(0.24, 1.0, sat(rev * uMapReveal * 4.0));
      col = mix(col, show, mMap * s3A);
      alpha = max(alpha, mMap * s3A);
    }
    float eMap = roundBoxEdge(p, vec2(180.0, 668.0), vec2(684.0, 136.0), 8.0, 1.3);
    if (eMap > 0.001) {
      col = mix(col, C_GRAPHITE * 1.18, eMap * mix(0.35, 0.92, m2Lit) * s3A);
      alpha = max(alpha, eMap * mix(0.35, 0.92, m2Lit) * s3A);
    }
  }

  // ── 右侧：随探针实时 L = uSliceL 变形的真实 Oklab (a, b) 色域切片（开场 0.15..2.6s 自左向右显影）──
  float rX = 924.0, rY = 212.0, rW = 836.0, rH = 640.0;
  float mRight = roundBoxMask(p, vec2(rX, rY), vec2(rW, rH), 12.0);
  if (mRight > 0.001) {
    float uu = (p.x - rX) / rW;
    float vv = 1.0 - (p.y - rY) / rH;
    float aVal = mix(-0.34, 0.30, uu);
    float bVal = mix(-0.40, 0.32, vv);
    vec3 lin = oklabToLin(vec3(uSliceL, aVal, bVal));
    bool inside = inSrgbGamut(lin);

    vec3 outCol = mix(C_INK * 0.68, C_INK * 0.84, vv);
    vec3 inCol = mix(outCol, sat(lin), uSliceLit);
    vec3 sliceCol = inside ? inCol : outCol;

    vec3 linDx = oklabToLin(vec3(uSliceL, aVal + 0.0022, bVal));
    vec3 linDy = oklabToLin(vec3(uSliceL, aVal, bVal + 0.0022));
    if (inside != inSrgbGamut(linDx) || inside != inSrgbGamut(linDy)) {
      sliceCol = mix(sliceCol, C_BONE * 0.82, 0.88);
    }
    float revEdge = uSliceReveal * 1.06 - 0.03;
    float revS = 1.0 - smoothstep(revEdge - 0.04, revEdge + 0.01, uu);
    sliceCol = mix(outCol, sliceCol, revS);
    col = mix(col, sliceCol, mRight * 0.90 * uEnter);
    alpha = max(alpha, mRight * 0.90 * uEnter);
  }
  float eRight = roundBoxEdge(p, vec2(rX, rY), vec2(rW, rH), 12.0, 1.2);
  if (eRight > 0.001) {
    col = mix(col, C_GRAPHITE * 1.15, eRight * 0.68 * uEnter);
    alpha = max(alpha, eRight * 0.68 * uEnter);
  }

  fragColor = vec4(col, sat(alpha));
}
`;

export default makeShot('oklab_mech', {
  setup(ctx) {
    this.pass = new Pass(ctx.gl, MECH_FRAG, {
      uOffset: [0, 0],
      uEnter: 1,
      uSliceL: 0.628,
      uSliceLit: 0.35,
      uPathU: 0,
      uCbrtU: 0,
      uTone1: 0.26,
      uTone2: 0.26,
      uTone3: 0.24,
      uStage3Show: 0,
      uSliceReveal: 0,
      uMapReveal: 0,
    }, { palette: ctx.P, key: 'oklab_mech' });
  },

  draw(ctx, { k, dx, dy }) {
    const { f, gl, lines, text, type, comp, P } = ctx;
    const t = f.lt;

    const vis = k;
    // 开场即亮 M1 + 色域自左向右扫显 + 4.2s 起立根绘制 + 9.4s 探针诚实滑向 0.747 + 17.4s 恒 L 检视次级运动
    const sliceReveal = smoothstep(0.15, 2.6, t);
    const chordTrace = smoothstep(0.4, 2.8, t);
    const tone1 = 0.26 + 0.74 * smoothstep(0.2, 2.6, t) - 0.54 * smoothstep(6.6, 7.6, t);
    const tone2 = 0.28 + 0.72 * smoothstep(5.4, 6.8, t) - 0.55 * smoothstep(9.6, 10.6, t);
    const tone3 = 0.24 + 0.76 * smoothstep(9.4, 10.8, t) - 0.42 * smoothstep(16.2, 17.4, t);
    const sliceLit = 0.28 + 0.44 * smoothstep(0.2, 2.6, t) + 0.26 * smoothstep(8.8, 11.4, t);
    const stage3Show = smoothstep(1.2, 2.8, t);
    const mapReveal = smoothstep(9.6, 13.8, t);

    const cbrtEndU = smoothstep(4.2, 8.8, t);
    const probeU = 0.5 * smoothstep(9.4, 16.55, t);
    const peakLock = sat(spring((t - 16.55) * 1.8, 1, 120, 15));

    // 17.4..22.8s 恒定 L=0.747 切面上的诚实次级检视扫描（绝不改变 L 数值与切片形状）
    const tailScanWin = t > 17.4 && t < 22.8 ? smoothstep(17.4, 18.0, t) * (1 - smoothstep(22.2, 22.8, t)) : 0;
    const tailScanU = smoothstep(17.4, 22.8, t);

    const okR = linToOklab(1, 0, 0);
    const okG = linToOklab(0, 1, 0);
    const curL = lerp(okR[0], okG[0], probeU);
    const curA = lerp(okR[1], okG[1], probeU);
    const curB = lerp(okR[2], okG[2], probeU);

    this.pass.set({
      uOffset: [dx, dy],
      uEnter: vis,
      uSliceL: curL,
      uSliceLit: sliceLit,
      uPathU: probeU,
      uCbrtU: cbrtEndU,
      uTone1: tone1,
      uTone2: tone2,
      uTone3: tone3,
      uStage3Show: stage3Show,
      uSliceReveal: sliceReveal,
      uMapReveal: mapReveal,
    }).render(gl, ctx.out, f.t, f.dt);

    lines.begin();

    // 轻量流式细隔线 + 带箭头实接管线
    if (stage3Show > 0.02) {
      lines.seg(160 + dx, 456 + dy, 888 + dx, 456 + dy, 1.0, withAlpha(P.graphite, 0.28 * stage3Show * vis));
      lines.seg(868 + dx, 574 + dy, 920 + dx, 574 + dy, 1.6, withAlpha(P.bone, 0.55 * tone3 * stage3Show * vis));
      lines.seg(914 + dx, 569 + dy, 920 + dx, 574 + dy, 1.6, withAlpha(P.bone, 0.55 * tone3 * stage3Show * vis));
      lines.seg(914 + dx, 579 + dy, 920 + dx, 574 + dy, 1.6, withAlpha(P.bone, 0.55 * tone3 * stage3Show * vis));
    }
    lines.seg(522 + dx, 264 + dy, 522 + dx, 414 + dy, 1.0, withAlpha(P.graphite, 0.20 * vis));
    lines.seg(496 + dx, 348 + dy, 554 + dx, 348 + dy, 1.6, withAlpha(P.bone, 0.55 * tone1 * vis));
    lines.seg(548 + dx, 343 + dy, 554 + dx, 348 + dy, 1.6, withAlpha(P.bone, 0.55 * tone1 * vis));
    lines.seg(548 + dx, 353 + dy, 554 + dx, 348 + dy, 1.6, withAlpha(P.bone, 0.55 * tone1 * vis));

    // Stage 1: [ ] 矩阵括号 + 汇流母线从顶端落入 L/M/S 柱（绝不横穿柱间空隙）
    const lmsTop = 294 + dy;
    lines.seg(233 + dx, lmsTop - 2, 227 + dx, lmsTop - 2, 1.8, withAlpha(P.bone, 0.72 * tone1 * vis));
    lines.seg(227 + dx, lmsTop - 2, 227 + dx, lmsTop + 108, 1.8, withAlpha(P.bone, 0.72 * tone1 * vis));
    lines.seg(227 + dx, lmsTop + 108, 233 + dx, lmsTop + 108, 1.8, withAlpha(P.bone, 0.72 * tone1 * vis));
    lines.seg(314 + dx, lmsTop - 2, 320 + dx, lmsTop - 2, 1.8, withAlpha(P.bone, 0.72 * tone1 * vis));
    lines.seg(320 + dx, lmsTop - 2, 320 + dx, lmsTop + 108, 1.8, withAlpha(P.bone, 0.72 * tone1 * vis));
    lines.seg(320 + dx, lmsTop + 108, 314 + dx, lmsTop + 108, 1.8, withAlpha(P.bone, 0.72 * tone1 * vis));

    const linR = 1 - probeU;
    const linG = probeU;
    const lms = [
      0.4122214708 * linR + 0.5363325363 * linG,
      0.2119034982 * linR + 0.6806995451 * linG,
      0.0883024619 * linR + 0.2817188376 * linG,
    ];
    for (let i = 0; i < 3; i++) {
      const inY = 306 + i * 42 + dy;
      lines.seg(204 + dx, inY, 226 + dx, inY, 1.4, withAlpha(P.graphite, 0.75 * tone1 * vis));
    }

    const colXs = [358, 408, 458];
    const barBot = 414 + dy;
    const barMaxH = 120;
    const busX = 336 + dx;
    const busTopY = 282 + dy;
    for (let i = 0; i < 3; i++) {
      const inY = 306 + i * 42 + dy;
      lines.seg(321 + dx, inY, busX, inY, 1.4, withAlpha(P.graphite, 0.78 * tone1 * vis));
    }
    lines.seg(busX, busTopY, busX, 390 + dy, 1.4, withAlpha(P.graphite, 0.78 * tone1 * vis));
    lines.seg(busX, busTopY, 474 + dx, busTopY, 1.4, withAlpha(P.graphite, 0.78 * tone1 * vis));
    for (let i = 0; i < 3; i++) {
      const bx = colXs[i] + dx;
      lines.seg(bx + 16, busTopY, bx + 16, barBot - barMaxH, 1.4, withAlpha(P.graphite, 0.78 * tone1 * vis));
      lines.fillRect(bx, barBot - barMaxH, 32, barMaxH, withAlpha(P.ink, 0.90 * vis), 4);
      lines.rect(bx, barBot - barMaxH, 32, barMaxH, 1.2, withAlpha(P.graphite, 0.72 * tone1 * vis));
      const fillH = Math.max(8, barMaxH * sat(lms[i]));
      const barCol = i === 0 && tone1 > 0.75
        ? withAlpha(P.signal, tone1 * vis)
        : withAlpha(P.bone, (0.86 - i * 0.14) * tone1 * vis);
      lines.fillRect(bx, barBot - fillH, 32, fillH, barCol, 4);
    }
    if (t >= 0.6 && t < 6.4) {
      const flowU = ((t - 0.6) * 0.45) % 1;
      const fx = lerp(204, 336, flowU) + dx;
      const flowWin = sat(smoothstep(0.6, 1.1, t)) * (1 - smoothstep(5.8, 6.4, t));
      lines.fillCircle(fx, 306 + dy, 3.8, withAlpha(P.signal, 0.85 * flowWin * vis));
    }

    // Stage 2: x^(1/3) 曲线（4.2s 起描线，9.4s 后由 L/M/S 三颗实心锥体点平滑滑行）
    const cx0 = 560 + dx;
    const cyBot = 414 + dy;
    const cw = 304;
    const ch = 122;
    lines.seg(cx0, cyBot, cx0 + cw, cyBot, 1.5, withAlpha(P.graphite, 0.85 * tone2 * vis));
    lines.seg(cx0, cyBot, cx0, cyBot - ch, 1.5, withAlpha(P.graphite, 0.85 * tone2 * vis));
    for (let i = 0; i < 14; i++) {
      const f0 = i / 14, f1 = (i + 0.55) / 14;
      lines.seg(cx0 + f0 * cw, cyBot - f0 * ch, cx0 + f1 * cw, cyBot - f1 * ch, 1.4, withAlpha(P.ash, 0.42 * tone2 * vis));
    }
    if (cbrtEndU > 0.02) {
      const cSteps = 44;
      const cMax = Math.max(2, Math.floor(cbrtEndU * cSteps));
      for (let i = 0; i < cMax; i++) {
        const u0 = i / cSteps, u1 = (i + 1) / cSteps;
        lines.seg(
          cx0 + u0 * cw, cyBot - Math.cbrt(u0) * ch,
          cx0 + u1 * cw, cyBot - Math.cbrt(u1) * ch,
          3.4, withAlpha(P.signal, Math.max(tone2, 0.55) * vis),
        );
      }
      if (t < 9.4) {
        lines.fillCircle(cx0 + cbrtEndU * cw, cyBot - Math.cbrt(cbrtEndU) * ch, 6.5, withAlpha(P.signal, tone2 * vis));
      } else {
        const lmsFade = sat((t - 9.4) / 0.5);
        for (let i = 0; i < 3; i++) {
          const xv = sat(lms[i]);
          lines.fillCircle(
            cx0 + xv * cw,
            cyBot - Math.cbrt(xv) * ch,
            i === 0 ? 6.0 : 4.5,
            i === 0 ? withAlpha(P.signal, 0.92 * lmsFade * k) : withAlpha(P.bone, (0.85 - i * 0.2) * lmsFade * k),
          );
        }
      }
    }

    // Stage 3: 并排 L / a / b 轴 + 下方校准带（1.2..2.8s 低亮真渐变预演同步淡入，9.4s 起游标推进，17.4..22.8s 恒 L 游标检视）
    if (stage3Show > 0.02) {
      const bxXs = [180, 415, 650];
      const bw = 214;
      const mVals = [
        sat(curL),
        sat((curA + 0.30) / 0.60),
        sat((curB + 0.30) / 0.60),
      ];
      const barTop = 548 + dy;
      const m2Fade = sat((tone3 - 0.1) / 0.9);
      for (let i = 0; i < 3; i++) {
        const xx = bxXs[i] + dx;
        const barAlpha = Math.max(0.28, m2Fade) * stage3Show;
        if (i > 0) {
          lines.seg(xx + bw * 0.5, barTop - 8, xx + bw * 0.5, barTop - 2, 1.6, withAlpha(P.bone, 0.52 * barAlpha * vis));
        } else {
          lines.seg(xx + bw * 0.747, barTop - 10, xx + bw * 0.747, barTop - 2, 2.2, withAlpha(P.signal, 0.92 * barAlpha * vis));
        }
        const nx = xx + mVals[i] * bw;
        lines.seg(nx, barTop + 2, nx, barTop + 50, 2.8, withAlpha(P.bone, barAlpha * vis));
        lines.fillCircle(nx, barTop + 26, 6.0, i === 0 ? withAlpha(P.signal, barAlpha * vis) : withAlpha(P.bone, barAlpha * vis));
      }
      if (mapReveal > 0.02) {
        const mapPx = 180 + probeU * 684 + dx;
        lines.seg(mapPx, 660 + dy, mapPx, 668 + dy, 2.2, withAlpha(P.bone, 0.9 * mapReveal * stage3Show * k));
        lines.seg(mapPx, 804 + dy, mapPx, 812 + dy, 2.2, withAlpha(P.bone, 0.9 * mapReveal * stage3Show * k));
      }
      if (tailScanWin > 0.02) {
        const txMap = 180 + tailScanU * 684 + dx;
        lines.seg(txMap, 666 + dy, txMap, 806 + dy, 1.8, withAlpha(P.bone, 0.68 * tailScanWin * k));
      }
    }

    // 右侧动态 L=curL 色域切片：a=0 竖轴 260..696，右沿 L 高度标尺 314..650
    const [ax0, ay0] = abToScreen(A_MIN, 0, dx, dy);
    const [ax1, ay1] = abToScreen(A_MAX, 0, dx, dy);
    const [bx0, by0] = abToScreen(0, B_MIN, dx, dy);
    const [bx1, by1] = abToScreen(0, B_MAX, dx, dy);
    lines.seg(ax0 + 20, ay0, ax1 - 36, ay1, 1.2, withAlpha(P.bone, 0.22 * vis));
    lines.seg(bx0, Math.min(by0 - 20, 696 + dy), bx1, Math.max(by1 + 48, 260 + dy), 1.2, withAlpha(P.bone, 0.22 * vis));

    // 右侧 L 高度标尺 (L ∈ [0.55, 0.92])
    const lRailX = R_X + R_W - 22 + dx;
    const lRailTop = 314 + dy;
    const lRailBot = 650 + dy;
    const yAtAlt = (L) => lerp(lRailBot, lRailTop, sat((L - 0.55) / 0.37));
    lines.seg(lRailX, lRailTop, lRailX, lRailBot, 1.6, withAlpha(P.graphite, 0.72 * vis));
    lines.seg(lRailX - 6, yAtAlt(0.628), lRailX + 4, yAtAlt(0.628), 2.0, [1, 0.25, 0.25, 0.85 * vis]);
    lines.seg(lRailX - 6, yAtAlt(0.866), lRailX + 4, yAtAlt(0.866), 2.0, [0.25, 0.95, 0.3, 0.85 * vis]);
    lines.seg(lRailX - 8, yAtAlt(0.747), lRailX + 4, yAtAlt(0.747), 2.0, withAlpha(P.bone, 0.75 * vis));
    lines.fillCircle(lRailX, yAtAlt(curL), 5.5, withAlpha(P.signal, vis));

    const [pRx, pRy] = abToScreen(okR[1], okR[2], dx, dy);
    const [pGx, pGy] = abToScreen(okG[1], okG[2], dx, dy);
    const [pPx, pPy] = abToScreen(curA, curB, dx, dy);

    if (chordTrace > 0.02) {
      for (let i = 0; i < 24; i++) {
        if (i % 2 === 1) continue;
        const f0 = (i / 24) * chordTrace;
        const f1 = Math.min(chordTrace, (i + 1) / 24);
        if (f1 <= f0) continue;
        lines.seg(lerp(pRx, pGx, f0), lerp(pRy, pGy, f0), lerp(pRx, pGx, f1), lerp(pRy, pGy, f1), 1.8, withAlpha(P.bone, 0.42 * vis));
      }
      lines.circle(pGx, pGy, 6, 1.8, [0.2, 0.95, 0.25, 0.82 * chordTrace * vis]);
    }
    if (probeU > 0.005) {
      lines.seg(pRx, pRy, pPx, pPy, 3.0, withAlpha(P.bone, 0.92 * vis));
    }
    lines.circle(pRx, pRy, 6, 1.8, [1, 0.2, 0.2, 0.82 * vis]);

    const pLin = oklabToLin(curL, curA, curB);
    const pCol = [sat(pLin[0]), sat(pLin[1]), sat(pLin[2]), vis];
    lines.fillCircle(pPx, pPy, 10, pCol);
    lines.circle(pPx, pPy, 12.5, 2.6, withAlpha(P.bone, vis));

    if (tailScanWin > 0.02) {
      const scanX = lerp(pRx, pGx, tailScanU);
      const scanY = lerp(pRy, pGy, tailScanU);
      lines.circle(scanX, scanY, 6.5, 1.8, withAlpha(P.bone, 0.82 * tailScanWin * k));
    }

    if (peakLock > 0.02) {
      const midLin = oklabToLin(lerp(okR[0], okG[0], 0.5), lerp(okR[1], okG[1], 0.5), lerp(okR[2], okG[2], 0.5));
      const swCol = [sat(midLin[0]), sat(midLin[1]), sat(midLin[2]), peakLock * k];
      lines.fillRect(1542 + dx, 804 + dy, 18, 18, swCol, 4);
      lines.rect(1542 + dx, 804 + dy, 18, 18, 1.2, withAlpha(P.bone, 0.8 * peakLock * k));
    }

    drawSpectrumRail(ctx, { ...RAIL_BOX, probeU, alpha: k, dx, dy });
    lines.flush(ctx.out);

    // ── 文字层：严格 3 档字号 (20 / 28 / 72) + offSubject <= 2 + inFocus = 2 ──
    text.clear();
    drawHeader(ctx, {
      num: '04',
      title: 'Oklab · 2020',
      rightLabel: 'M1 → x^(1/3) → M2',
      t, alpha: vis, dx, dy,
    });

    // 左上群落 (offSubject #1: y=224 与 y=256 间距 32<=37 合并成 1 块)
    type.writeLine('M1 · RGB → LMS', 160 + dx, 224 + dy, {
      anchor: 'left', size: 20, weight: 700, family: 'mono', color: css(P.bone, (0.45 + 0.52 * tone1) * vis),
    });
    const cbrtCol = tone2 > 0.5
      ? css(P.signal, (0.55 + 0.45 * tone2) * vis)
      : css(P.bone, (0.45 + 0.50 * tone2) * vis);
    type.writeLine('立方根 x^(1/3)', 548 + dx, 224 + dy, {
      anchor: 'left', size: 20, weight: 700, family: 'sans', color: cbrtCol,
    });
    type.writeLine('RGB', 176 + dx, 256 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'mono', color: css(P.ash, 0.85 * tone1 * vis),
    });
    type.writeLine('L', 374 + dx, 256 + dy, {
      anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.ash, 0.85 * tone1 * vis),
    });
    type.writeLine('M', 424 + dx, 256 + dy, {
      anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.ash, 0.85 * tone1 * vis),
    });
    type.writeLine('S', 474 + dx, 256 + dy, {
      anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.ash, 0.85 * tone1 * vis),
    });
    type.writeLine('LMS → LMS^(1/3)', 548 + dx, 256 + dy, {
      anchor: 'left', size: 20, weight: 500, family: 'mono', color: css(P.ash, 0.85 * tone2 * vis),
    });

    // 左下群落 (offSubject #2: y=486 与 y=518 间距 32<=37 合并成 1 块，横跨 <=1664 与 '+a' 并组维持 offSubject=2)
    if (stage3Show > 0.02) {
      const s3T = stage3Show * vis;
      type.writeLine('M2 · (L, a, b) → Oklab 红→绿', 160 + dx, 486 + dy, {
        anchor: 'left', size: 20, weight: 700, family: 'sans', color: css(P.bone, (0.45 + 0.52 * tone3) * s3T),
      });
      type.writeLine('L · 0.747', 287 + dx, 518 + dy, {
        anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.signal, 0.92 * tone3 * s3T),
      });
      type.writeLine('a', 522 + dx, 518 + dy, {
        anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.ash, 0.88 * tone3 * s3T),
      });
      type.writeLine('b', 757 + dx, 518 + dy, {
        anchor: 'center', size: 20, weight: 600, family: 'mono', color: css(P.ash, 0.88 * tone3 * s3T),
      });
    }

    // 右侧切面群落 1 (inFocus #1: y=294 与左上 bot=261 间距 >16 严格分离；与 pG y=337 净空 32px)
    type.writeLine('Oklab (a, b)', R_X + 24 + dx, 294 + dy, {
      anchor: 'left', size: 20, weight: 700, family: 'sans', color: css(P.bone, 0.94 * vis),
    });
    type.writeLine('+b', bx1 + 14, 294 + dy, {
      anchor: 'left', size: 20, weight: 600, family: 'mono', color: css(P.ash, 0.82 * vis),
    });
    type.writeLine('L', lRailX, 294 + dy, {
      anchor: 'center', size: 20, weight: 700, family: 'mono', color: css(P.signal, 0.92 * vis),
    });
    type.writeLine('+a', 1664 + dx, ay0 - 10, {
      anchor: 'right', size: 20, weight: 600, family: 'mono', color: css(P.ash, 0.82 * vis),
    });

    // 右侧切面群落 2 (inFocus #2: 100% 数值诚实：静停 0.628 -> 滑移实算 -> 锁定 0.747)
    if (t < 9.4) {
      type.writeLine('L = 0.628', R_X + R_W - 28 + dx, 782 + dy, {
        anchor: 'right', size: 72, weight: 800, family: 'mono', color: css(P.bone, 0.68 * vis),
      });
    } else if (t < 16.55) {
      type.writeLine(`L = ${curL.toFixed(3)}`, R_X + R_W - 28 + dx, 782 + dy, {
        anchor: 'right', size: 72, weight: 800, family: 'mono', color: css(P.bone, 0.86 * vis),
      });
    } else {
      type.writeLine('L = 0.747', R_X + R_W - 28 + dx, 782 + dy, {
        anchor: 'right', size: 72, weight: 800, family: 'mono', color: css(P.bone, peakLock * k),
      });
      type.writeLine('(208, 168, 0)', R_X + R_W - 28 + dx, 820 + dy, {
        anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.bone, 0.90 * peakLock * k),
      });
    }

    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    const zoomBoost = 0.022 * peakLock;
    return oklabPost(f, { zoomBoost });
  },
});
