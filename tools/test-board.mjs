#!/usr/bin/env node
// @ts-check
/**
 * tools/test-board.mjs —— 分镜板排版纯函数（C2）：段表 → 采样时刻 + 标注。离线，不起浏览器。
 */
import assert from 'node:assert/strict';
import { planBoard } from '../scripts/lib/cli/board.mjs';

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
const segs = [
  { id: 'hook', start: 0, end: 4, note: '开场' },
  { id: 'chart', start: 4, end: 9 },
  { id: 'outro', start: 9, end: 12, note: '收尾' },
];

// 默认段中点
{
  const { times, labels } = planBoard(segs);
  ok(times.length === 3 && labels.length === 3, '每段一格（时刻与标注各 3）');
  ok(Math.abs(times[0] - 2) < 1e-9 && Math.abs(times[1] - 6.5) < 1e-9 && Math.abs(times[2] - 10.5) < 1e-9, '默认取段中点');
  ok(labels[0] === 'hook · 4.0s · 开场', '标注 = id · 时长 · note');
  ok(labels[1] === 'chart · 5.0s', '无 note 时只有 id · 时长');
}
// --at 调段内位置
{
  const { times } = planBoard(segs, { at: 0 });
  ok(Math.abs(times[0] - 0) < 1e-9 && Math.abs(times[1] - 4) < 1e-9, 'at=0 取段首');
  const t1 = planBoard(segs, { at: 1 }).times;
  ok(Math.abs(t1[0] - 4) < 1e-9 && Math.abs(t1[2] - 12) < 1e-9, 'at=1 取段尾');
  const tc = planBoard(segs, { at: 5 }).times;
  ok(Math.abs(tc[0] - 4) < 1e-9, 'at 越界夹到 1');
}
// 长 note 截断（不撑爆格子）
{
  const long = [{ id: 'x', start: 0, end: 2, note: '这是一段特别特别长的备注说明文字用来验证截断逻辑是否正确工作，还要再加一些字确保超过四十四个字符的上限' }];
  const { labels } = planBoard(long);
  ok(labels[0].length <= 44 && labels[0].endsWith('…'), '超长标注截断到 44 字符并加省略号');
}
// 空段表
{
  const { times, labels } = planBoard([]);
  ok(times.length === 0 && labels.length === 0, '空段表 → 空结果');
}

console.log('\n✓ 分镜板排版：' + passed + ' 项通过');
