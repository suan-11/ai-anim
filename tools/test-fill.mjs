#!/usr/bin/env node
// @ts-check
/**
 * 填充面的**纯逻辑**回归（src/core/fill.js + LineBatch 的转发）。
 *
 *   node tools/test-fill.mjs
 *
 * 扫描线填充的错都**不会抛异常**：形状少一行、洞没挖出来、扇区的角反了 ——
 * 画面照样出，只是「看着有点不对」。所以每一条都钉成可判的量：
 * 覆盖面积、行数、跨度的左右端、带洞时中间是不是空的。
 */

import {
  polySpans, circleSpans, sectorSpans,
  ringEdges, crossingsAt, angWithin, subtractInterval, SPAN_OVERLAP,
} from '../src/core/fill.js';

let fail = 0;
let pass = 0;
/** @param {boolean} cond @param {string} msg */
function ok(cond, msg) {
  if (cond) { pass++; console.log('✓ ' + msg); } else { fail++; console.error('✗ ' + msg); }
}
/** @param {string} msg */
function section(msg) { console.log('\n── ' + msg + ' ──'); }

/** 跨度覆盖的总面积 */
const areaOf = (spans) => spans.reduce((a, s) => a + s.w * Math.min(s.h, Math.abs(s.w) >= 0 ? s.h : s.h), 0);

/* ════════════════════════════════════════════════ 多边形 */

section('正方形：行数、左右端、面积都对');
{
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const sp = polySpans(sq, 1);
  ok(sp.length === 10, '边长 10、步进 1 ⇒ 10 行（实际 ' + sp.length + '）');
  ok(sp.every((s) => Math.abs(s.x - 0) < 1e-9), '每行左端都在 x=0');
  ok(sp.every((s) => Math.abs(s.x + s.w - 10) < 1e-9), '每行右端都在 x=10');
  // 面积按行高算（h 含 SPAN_OVERLAP，所以用步进算而不是 h）
  const area = sp.reduce((a, s) => a + s.w * (s.h - SPAN_OVERLAP), 0);
  ok(Math.abs(area - 100) < 1e-6, '覆盖面积 = 100（实际 ' + area.toFixed(4) + '）');
}

section('差一行的边界：宽高为 0 的多边形不产出跨度');
{
  ok(polySpans([[0, 0], [10, 0], [10, 0], [0, 0]], 1).length === 0, '退化成一条线 ⇒ 0 行');
  ok(polySpans([], 1).length === 0, '空环 ⇒ 0 行');
  ok(polySpans([[0, 0], [1, 0]], 1).length === 0, '只有两个点 ⇒ 0 行（构不成面）');
}

section('带洞：中间几行必须断开成两段');
{
  const holed = polySpans([[[0, 0], [10, 0], [10, 10], [0, 10]], [[3, 3], [7, 3], [7, 7], [3, 7]]], 1);
  const mid = holed.filter((s) => s.y > 3.5 && s.y < 6.5);
  ok(mid.length > 0, '洞的高度范围内有跨度');
  // 每一行应该是 [0,3] 与 [7,10] 两段
  const ys = [...new Set(mid.map((s) => s.y))];
  let allOk = true;
  for (const y of ys) {
    const row = mid.filter((s) => s.y === y).sort((a, b) => a.x - b.x);
    if (row.length !== 2) { allOk = false; break; }
    if (Math.abs(row[0].x) > 1e-9 || Math.abs(row[0].x + row[0].w - 3) > 1e-9) { allOk = false; break; }
    if (Math.abs(row[1].x - 7) > 1e-9 || Math.abs(row[1].x + row[1].w - 10) > 1e-9) { allOk = false; break; }
  }
  ok(allOk, '洞内的每一行都是 [0,3] + [7,10] 两段（共 ' + ys.length + ' 行）');
  const solid = holed.filter((s) => s.y < 2.5 || s.y > 7.5);
  ok(solid.length > 0 && solid.every((s) => Math.abs(s.w - 10) < 1e-9), '洞外仍是整段 10 宽');
}

section('凹多边形（L 形）：下半截的宽度只有一半');
{
  const L = [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]];
  const sp = polySpans(L, 1);
  const top = sp.filter((s) => s.y < 4.5);
  const bottom = sp.filter((s) => s.y > 5.5);
  ok(top.every((s) => Math.abs(s.w - 10) < 1e-9), '上半截宽 10');
  ok(bottom.every((s) => Math.abs(s.w - 5) < 1e-9), '下半截宽 5');
}

/* ════════════════════════════════════════════════ 圆 / 扇 */

section('圆：行数、对称、面积接近 πr²');
{
  const r = 10;
  const sp = circleSpans(0, 0, r, 0.5);
  ok(sp.length === 40, '直径 20、步进 0.5 ⇒ 40 行（实际 ' + sp.length + '）');
  const area = sp.reduce((a, s) => a + s.w * (s.h - SPAN_OVERLAP), 0);
  const exact = Math.PI * r * r;
  ok(Math.abs(area - exact) / exact < 0.02, '面积误差 < 2%（' + area.toFixed(2) + ' vs ' + exact.toFixed(2) + '）');
  const mid = sp.filter((s) => Math.abs(s.y) < 0.6);
  ok(mid.every((s) => Math.abs(s.x + s.w / 2) < 1e-9), '最宽的那一行以圆心对称');
  ok(circleSpans(0, 0, 0, 1).length === 0, '半径 0 ⇒ 0 行');
}

section('扇区：角度真的裁掉了不该有的部分');
{
  const sp = sectorSpans(0, 0, 0, 10, 0, Math.PI / 2, 1);
  ok(sp.length > 0, '第一象限有跨度');
  ok(sp.every((s) => s.x >= -1e-6), '没有一段落在 x<0（左半边被裁掉）');
  ok(sp.every((s) => s.y >= -1e-6), '没有一段落在 y<0（上半边被裁掉）');
  const full = sectorSpans(0, 0, 0, 10, 0, Math.PI * 2, 1);
  const spFull = circleSpans(0, 0, 10, 1);
  ok(Math.abs(full.length - spFull.length) <= 1, '整圈扇区 ≈ 整圆的行数（' + full.length + ' vs ' + spFull.length + '）');
  // 扇环：内圈必须空
  const ring = sectorSpans(0, 0, 6, 10, 0, Math.PI * 2, 1);
  const inner = ring.filter((s) => Math.hypot(s.x + s.w / 2, s.y) < 5);
  ok(inner.length === 0, '扇环的内部（半径 < 5）是空的');
}


section('方向：角度约定（最容易写反的一条）');
{
  // 约定：0 = +x（右），π/2 = **下**（y 向下为正），-π/2 = 上。
  // 这四条如果反了，画面照样出，只是整个扇区镜像 —— 人眼很难当场发现。
  const centroid = (sp) => {
    let sx = 0, sw = 0;
    for (const s of sp) { sx += (s.x + s.w / 2) * s.w; sw += s.w; }
    return sw > 0 ? sx / sw : NaN;
  };
  const cyOf = (sp) => {
    let sy = 0, sw = 0;
    for (const s of sp) { sy += s.y * s.w; sw += s.w; }
    return sw > 0 ? sy / sw : NaN;
  };
  const dirOf = (sp) => {
    const cx = centroid(sp); const cy = cyOf(sp);
    return Math.abs(cx) > Math.abs(cy) ? (cx > 0 ? 'right' : 'left') : (cy > 0 ? 'down' : 'up');
  };
  ok(dirOf(sectorSpans(0, 0, 0, 100, -Math.PI / 2, Math.PI / 2, 1)) === 'right', '[-π/2, π/2] 是**右**半边');
  ok(dirOf(sectorSpans(0, 0, 0, 100, 0, Math.PI, 1)) === 'down', '[0, π] 是**下**半边（y 向下为正）');
  ok(dirOf(sectorSpans(0, 0, 0, 100, Math.PI / 2, Math.PI * 1.5, 1)) === 'left', '[π/2, 3π/2] 是**左**半边');
  ok(dirOf(sectorSpans(0, 0, 0, 100, Math.PI, Math.PI * 2, 1)) === 'up', '[π, 2π] 是**上**半边');
}

section('进度环：缺口回到起点那一侧，覆盖比例对');
{
  // 从正上（-π/2 = 270°）开始走 72%，缺口应该落在 169°→270°（左上象限）。
  const sp = sectorSpans(0, 0, 58, 86, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.72, 1);
  const hit = (deg) => {
    const a = (deg * Math.PI) / 180;
    const x = Math.cos(a) * 72; const y = Math.sin(a) * 72;
    return sp.some((s) => Math.abs(s.y - y) < 1.2 && x >= s.x - 1.5 && x <= s.x + s.w + 1.5);
  };
  ok(hit(270), '起点（270° = 正上）有墨');
  ok(hit(0), '00% 之后的 0°（右）也有墨');
  ok(!hit(200), '缺口 200°（左上）没有墨');
  ok(!hit(250), '缺口 250°（正上偏左）没有墨');
  const whole = sectorSpans(0, 0, 58, 86, 0, Math.PI * 2, 1);
  ok(whole.length > 0 && !whole.some((s) => s.w < 0), '整圈不出现负宽度');
}

/* ════════════════════════════════════════════════ 小工具 */

section('工具函数');
{
  const e = ringEdges([[0, 0], [10, 0], [10, 10], [0, 10]]);
  ok(e.length === 2, '正方形有 2 条非水平边（实际 ' + e.length + '）');
  ok(crossingsAt(e, 5).length === 2, 'y=5 上有 2 个交点');
  ok(crossingsAt(e, -1).length === 0, '图形外没有交点');
  ok(angWithin(0, 0, 0.5), '角度 0 落在 ±0.5 内');
  ok(!angWithin(1, 0, 0.5), '角度 1 不在 ±0.5 内');
  ok(angWithin(Math.PI * 2 - 0.1, 0, 0.5), '跨 2π 也对（2π-0.1 落在 0 附近）');
  const sub = subtractInterval([0, 10], [3, 7]);
  ok(sub.length === 2 && sub[0][1] === 3 && sub[1][0] === 7, '区间相减得到两段');
  ok(subtractInterval([0, 10], [5, 6]).length === 2, '减掉中间一段 ⇒ 两段');
  ok(subtractInterval([0, 10], [-1, 11]).length === 0, '完全覆盖 ⇒ 空');
}


/* ════════════════════════════════════════════════ 带（band）与 alpha 账 */

section('SPAN_OVERLAP = 0：相邻扫描行不许重叠');
{
  // 这条是 2026-10-31「半透明填充被画浓」的根因。当时每一行画成胶囊（1.5px 圆头余量）,
  // 再叠 SPAN_OVERLAP 的 0.5px 补缝，相邻行的抗锯齿边互相叠加 ⇒ alpha 0.5 的面被叠成
  // 194/200/222/236（行距 2/1/0.5/0.25），正确值 188。行距越细越浓 —— 于是
  // 「把行距调小换平滑」这条路当时根本走不通。现在填充走硬边带，行高必须严格等于行距。
  ok(SPAN_OVERLAP === 0, 'SPAN_OVERLAP 必须是 0（实际 ' + SPAN_OVERLAP + '）—— 非 0 会把半透明面叠浓');
  const sp = circleSpans(0, 0, 10, 1);
  ok(sp.every((s) => Math.abs(s.h - 1) < 1e-9), '圆跨度的高度 = 行距 1（不再多出重叠量）');
  const sp2 = polySpans([[0, 0], [10, 0], [10, 10], [0, 10]], 2);
  ok(sp2.every((s) => Math.abs(s.h - 2) < 1e-9), '多边形跨度的高度 = 行距 2');
  const sorted = [...sp2].sort((a, b) => a.y - b.y);
  let seams = true;
  for (let i = 1; i < sorted.length; i++) {
    const prevBottom = sorted[i - 1].y + sorted[i - 1].h / 2;
    const curTop = sorted[i].y - sorted[i].h / 2;
    if (Math.abs(prevBottom - curTop) > 1e-9) seams = false;
  }
  ok(seams, '相邻跨度的边界严格相接（有重叠 ⇒ 半透明面被叠两遍）');
}

section('行距越细，覆盖面积不变（否则就是细行距 = 更浓）');
{
  const sq = [[0, 0], [20, 0], [20, 20], [0, 20]];
  const areas = [2, 1, 0.5].map((step) => {
    const sp = polySpans(sq, step);
    return sp.reduce((a, s) => a + s.w * (s.h - SPAN_OVERLAP), 0);
  });
  const spread = Math.max(...areas) - Math.min(...areas);
  ok(spread < 1e-6, '20x20 方块的覆盖面积与行距无关（2/1/0.5 三档：' + areas.map((a) => a.toFixed(2)).join(' / ') + '）');
}

console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : ''));
process.exit(fail ? 1 : 0);