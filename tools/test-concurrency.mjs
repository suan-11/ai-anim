#!/usr/bin/env node
/**
 * tools/test-concurrency.mjs —— 「同时运动元素」判据的离线回归（纯 JS，不需要 ffmpeg/GPU）。
 *
 * 断言的是两个纯函数：栅格化变化面积、连通分量计数。合成帧构造，毫秒级。
 */
import assert from 'node:assert/strict';
import { cellMask, components } from './lint-concurrency.mjs';

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; console.log('  ✓ ' + m); };

const W = 64, H = 48, CELL = 8;   // 8×6 = 48 个块
const blank = () => new Uint8Array(W * H);
const fill = (buf, x0, y0, w, h, v) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) buf[y * W + x] = v;
};

console.log('变化面积');
{
  const a = blank(), b = blank();
  const m = cellMask(a, b, W, H, CELL, 6);
  eq(m.share, 0, '两帧一样 ⇒ 0%');
  eq(components(m).count, 0, '没有变化块 ⇒ 0 个主体');
}
{
  const a = blank(), b = blank().fill(40);
  const m = cellMask(a, b, W, H, CELL, 6);
  eq(m.share, 1, '整屏均匀变化 40 ⇒ 100%');
  eq(components(m).count, 1, '整屏连成 1 个主体（不是 48 个）');
}
{
  const a = blank(), b = blank();
  fill(b, 16, 16, 16, 16, 50);      // 2×2 个块
  const m = cellMask(a, b, W, H, CELL, 6);
  ok(Math.abs(m.share - 4 / 48) < 1e-9, '只变了 4 个块 ⇒ ' + (m.share * 100).toFixed(1) + '%');
  eq(components(m).count, 1, '相邻块算一个主体');
}
{
  const a = blank(), b = blank();
  fill(b, 0, 0, 16, 16, 50);        // 左上 2×2
  fill(b, 48, 32, 16, 16, 50);      // 右下 2×2
  eq(components(cellMask(a, b, W, H, CELL, 6)).count, 2, '两块分开 ⇒ 2 个主体');
}
{
  const a = blank(), b = blank();
  fill(b, 0, 0, 8, 8, 50);          // 单个块
  eq(components(cellMask(a, b, W, H, CELL, 6)).count, 0, '单个碎块不算主体（minCells=2）');
}
{
  const a = blank(), b = blank().fill(3);
  eq(cellMask(a, b, W, H, CELL, 6).share, 0, '变化量低于阈值 ⇒ 不算动（噪点不算）');
}

console.log('连通分量');
{
  const cols = 4, rows = 3;
  const mask = new Uint8Array([1,1,0,0, 1,1,0,0, 0,0,0,0]);
  eq(components({ cols, rows, mask }).count, 1, '2×2 方块 = 1 个');
  eq(components({ cols, rows, mask }).sizes, [4], '面积 4 块');
}
{
  const cols = 5, rows = 1;
  const mask = new Uint8Array([1,0,1,0,1]);
  eq(components({ cols, rows, mask }).count, 0, '隔一个的单块都不算（minCells=2）');
}
{
  const cols = 6, rows = 1;
  const mask = new Uint8Array([1,1,0,1,1,1]);
  eq(components({ cols, rows, mask }).count, 2, '两段分开 ⇒ 2 个');
  eq(components({ cols, rows, mask }).sizes, [3, 2], '面积从大到小');
}

console.log('\n✓ 同时运动判据：' + passed + ' 项通过');
