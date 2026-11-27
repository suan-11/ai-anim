// @ts-check
/** 多锚点动态层：画面里多个独立运动的显著性热点，牵引视线多处移动（提复杂度）。
 *
 * 为什么存在：复杂度 = 分散度0.5 + 热点多样0.3 + 信息密度0.2。benford 单主体柱阵
 * hotspot 几乎不动（位移中位 0.016），热点多样只有 0.19 拖垮总分。这里加一层
 * 「数据探针」：3-5 个独立轨道的小标记在主体周围各自运动，每个都是局部对比源，
 * hotspot 会被轮流吸引 → 多样性上去；同时它们分散在画面各处 → 分散度也涨。
 *
 * 纪律：① 只在 release/hold 活跃期出现（pressure 深蹲期必须静，否则谷填平）；
 * ② 标记小而亮（局部对比强但不盖主体）；③ 全部是 t 的纯函数（确定性铁律）。
 *
 * 用法（场景 draw 内，lines.flush 前）：
 *   this.probes = makeProbes(7, 4);                 // setup 里
 *   drawProbes(ctx, this.probes, f.t, rd, { cx, cy, spread });  // draw 里
 */
import { withAlpha } from '../../src/kit/index.js';
import { rng, sat, smoothstep } from '../../src/core/util.js';

/** 预计算探针轨道（确定性）。每个探针：椭圆轨道中心/半径/角速度/相位/大小。
 * 角速度要够快（≥1.2 rad/s）：0.5s 采样间隔内位移须 >0.1 归一化才计入热点多样性。 */
export function makeProbes(seed = 7, count = 4) {
  const r = rng(seed);
  const probes = [];
  for (let i = 0; i < count; i++) {
    probes.push({
      // 轨道中心分布在主体周围四个象限（归一化偏移，调用方乘 spread）
      ox: (r() - 0.5) * 2, oy: (r() - 0.5) * 1.6,
      rx: 0.30 + r() * 0.35, ry: 0.22 + r() * 0.28,   // 大椭圆半径（归一化）
      w: (1.2 + r() * 1.2) * (r() > 0.5 ? 1 : -1),     // 快角速度 rad/s，方向随机
      ph: r() * Math.PI * 2,
      sz: 14 + r() * 10,                                // 标记半径 px：降采样10倍后仍≥2px才有对比
      blink: 2 + r() * 4,                               // 闪烁频率
    });
  }
  return probes;
}

/** 节奏门控活跃度：release 满、hold 半、pressure/residue 静（保谷深）。 */
function probeGate(rd) {
  if (!rd || !rd.role) return 0.5;
  if (rd.role === 'release') return 1;
  if (rd.role === 'hold') return 0.45 + 0.15 * Math.sin((rd.u ?? 0) * Math.PI);
  if (rd.role === 'residue') return 0.25 * (1 - (rd.u ?? 0));
  return 0;                                          // pressure 深蹲期全静
}

/** 主体内部高亮轮换：在 n 个锚点里轮流点亮一个（hotspot 跟着跳 → 热点多样性）。
 * 只在 release 期活跃（hold/pressure 必须静，否则填谷破坏注意力曲线）。
 * 返回当前应高亮的索引 + 过渡进度。周期 period 秒/个。 */
export function spotlightIndex(t, rd, n, period = 1.2) {
  if (!rd || rd.role !== 'release' || n < 2) return { idx: -1, blend: 0, gate: 0 };
  const phase = t / period;
  const idx = Math.floor(phase) % n;
  const frac = phase - Math.floor(phase);
  // 每个锚点亮 70% 周期，30% 过渡到下一个（smoothstep 渐变）
  const blend = frac < 0.7 ? 1 : 1 - (frac - 0.7) / 0.3;
  return { idx, next: (idx + 1) % n, blend, gate: 1 };
}

/** 给第 i 个锚点算高亮权重（0.65 底 + 0.35 高亮——底够高保分散度，差够大牵引 hotspot）。 */
export function spotlightWeight(sp, i) {
  if (sp.idx < 0) return 1;
  if (i === sp.idx) return 0.65 + 0.35 * sp.blend;
  if (i === sp.next && sp.blend < 1) return 0.65 + 0.35 * (1 - sp.blend);
  return 0.65;
}

/**
 * 画探针层。cx/cy=主体中心（逻辑px），spread=分布半径（逻辑px）。
 * 每个探针 = 实心菱形 + 十字 + 短尾迹（局部对比源，要够亮才能抢过主体的 hotspot 吸引力）。
 */
export function drawProbes(ctx, probes, t, rd, { cx, cy, spread = 380, alpha = 0.95 } = {}) {
  const gate = probeGate(rd);
  if (gate < 0.03) return;
  const { lines, P } = ctx;
  const a = alpha * gate;
  for (const p of probes) {
    const ang = t * p.w + p.ph;
    const x = cx + p.ox * spread * 0.55 + Math.cos(ang) * p.rx * spread;
    const y = cy + p.oy * spread * 0.45 + Math.sin(ang) * p.ry * spread;
    const blink = 0.6 + 0.4 * Math.sin(t * p.blink + p.ph);
    const s = p.sz * (0.9 + 0.5 * blink);            // 原图 14-24px → 降采样后 1.4-2.4px 可辨
    // signal 红实心菱形（与主体同色系但独立运动）+ 外圈环
    lines.fillPoly([[x,y-s],[x+s*0.7,y],[x,y+s],[x-s*0.7,y]], withAlpha(P.signal, a*blink*0.9));
    lines.circle(x, y, s*1.5, 2.5, withAlpha(P.signal, a*blink*0.7));
    // 十字外延
    lines.seg(x - s * 2.2, y, x + s * 2.2, y, 2.5, withAlpha(P.signal, a * blink));
    lines.seg(x, y - s * 2.2, x, y + s * 2.2, 2.5, withAlpha(P.signal, a * blink));
    // 短尾迹（运动方向感，提帧间变化）
    const tx = x - Math.cos(ang) * s * 6 * Math.sign(p.w);
    const ty = y - Math.sin(ang) * s * 6 * Math.sign(p.w);
    lines.seg(tx, ty, x, y, 1.5, withAlpha(P.signal, a * blink * 0.5));
  }
}