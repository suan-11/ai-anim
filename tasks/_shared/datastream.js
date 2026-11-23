// @ts-check
/** 第二主体层：横向滚动数据流带（大面积持续运动，提分散度/热点多样性）。
 *
 * 为什么存在：单主体柱阵 concentration≈0.44 是结构性天花板——显著性全集中在
 * 下半部，分散度卡在 0.56。加一条占画面上半部的滚动刻度/数字带，形成上下双锚点：
 * concentration 降（两个强区域）、hotspot 在上下间跳（多样性涨）。
 * 符合 AGENTS.md §10.11.6「补大面积持续运动，别补 2px 游标」。
 *
 * 纪律：① release 满活跃 / hold 半 / pressure 静（保谷深）；② 纯 t 函数；
 * ③ 带内元素是「数据刻度」语义（不是装饰），与科普主题一致。
 */
import { withAlpha } from '../../src/kit/index.js';
import { rng, sat } from '../../src/core/util.js';

/** 预计算流带内容（确定性）：一组刻度值+位置偏移。 */
export function makeStream(seed = 31, count = 28) {
  const r = rng(seed);
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({
      v: Math.floor(r() * 90 + 10),                  // 两位数刻度值
      w: 0.6 + r() * 0.8,                            // 宽度权重
      tick: r() > 0.4,                               // 是否带刻度线
      h: 0.5 + r() * 0.5,                            // 高度权重
    });
  }
  return { items, speed: 0.06 + r() * 0.04 };         // 滚动速度（归一化/秒）
}

function streamGate(rd) {
  if (!rd || !rd.role) return 0.5;
  if (rd.role === 'release') return 1;
  if (rd.role === 'hold') return 0.35;
  if (rd.role === 'residue') return 0.2 * (1 - (rd.u ?? 0));
  return 0;
}

/**
 * 画滚动数据流带。y=带中心（逻辑px），h=带高，x0/x1=左右边界。
 * 内容：横向滚动的竖刻度线 + 数字标注（用 lines 画刻度，数字交给调用方 text 层或省略）。
 * 这里只画矢量部分（刻度线+顶底边线+移动高亮块），保证局部对比强。
 */
export function drawStream(ctx, stream, t, rd, { y = 180, h = 110, x0 = 160, x1 = 1760, alpha = 0.8 } = {}) {
  const gate = streamGate(rd);
  if (gate < 0.03) return;
  const { lines, P } = ctx;
  const a = alpha * gate;
  const W = x1 - x0;
  const scroll = (t * stream.speed) % 1;
  // 顶底边线（带的轮廓，局部对比源）
  lines.seg(x0, y - h / 2, x1, y - h / 2, 1.5, withAlpha(P.graphite, a * 0.5));
  lines.seg(x0, y + h / 2, x1, y + h / 2, 1.5, withAlpha(P.graphite, a * 0.5));
  // 滚动刻度（signal 红主刻度 + graphite 次刻度）
  const n = stream.items.length;
  for (let i = 0; i < n; i++) {
    const it = stream.items[i];
    const u = ((i / n + scroll) % 1);
    const x = x0 + u * W;
    const th = h * 0.5 * it.h;
    const col = it.tick ? withAlpha(P.signal, a * 0.75) : withAlpha(P.graphite, a * 0.45);
    lines.seg(x, y - th, x, y + th, it.tick ? 2.5 : 1, col);
    if (it.tick) {
      lines.seg(x - 6 * it.w, y - th, x + 6 * it.w, y - th, 2, col);
    }
  }
  // 移动高亮块（signal 红框 + 中心竖线）
  const hu = (t * stream.speed * 2.3) % 1;
  const hx = x0 + hu * W;
  const hw = 90;
  lines.fillRect(hx - hw / 2, y - h / 2 + 4, hw, h - 8, withAlpha(P.signal, a * 0.15));
  lines.rect(hx - hw / 2, y - h / 2 + 4, hw, h - 8, 2.5, withAlpha(P.signal, a * 0.8));
  lines.seg(hx, y - h / 2 + 8, hx, y + h / 2 - 8, 3, withAlpha(P.signal, a * 0.9));
}