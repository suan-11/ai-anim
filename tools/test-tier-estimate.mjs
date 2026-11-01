#!/usr/bin/env node
/**
 * `test-tier-estimate.mjs` —— C-1（dry-run 按档预估）的离线回归。
 *
 * 纯 JS，不需要 GPU / Chrome。测的是「档位归类 / 档位计划 / 分钟数换算」的纯逻辑，
 * 外加 anim.mjs 的**接线自检**（真路径不走这些函数的话，全绿也没用）。
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRAFT_SCALE, DRAFT_ENCODE_MS, classifyTier, planTiers, estimateTier } from '../scripts/lib/tier-estimate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('✓', name); };

/* ---------------------------------------------------------- classifyTier */
ok('草稿档：绝对 scale 0.5 + samples "1"（字符串/数字都认）', () => {
  assert.equal(classifyTier({ scale: 0.5, samples: '1' }, 1), 'draft');
  assert.equal(classifyTier({ scale: 0.5, samples: 1 }, 1), 'draft');
});

ok('成片档：任务 scale + samples auto（含 config scale 2 的 4K 任务）', () => {
  assert.equal(classifyTier({ scale: 1, samples: 'auto' }, 1), 'final');
  assert.equal(classifyTier({ scale: 2, samples: 'auto' }, 2), 'final');
});

ok('其余一律 custom：半分辨率但 samples auto / 满分辨率但 samples 1 / --samples 8', () => {
  assert.equal(classifyTier({ scale: 0.5, samples: 'auto' }, 1), 'custom');
  assert.equal(classifyTier({ scale: 1, samples: '1' }, 1), 'custom');
  assert.equal(classifyTier({ scale: 1, samples: '8' }, 1), 'custom');
  assert.equal(classifyTier({ scale: 2, samples: '1' }, 1), 'custom');
});

/* ---------------------------------------------------------- planTiers */
ok('本次是成片档 → 两行：final 标 current，draft 待测', () => {
  const t = planTiers({ configScale: 1, scale: 1, samples: 'auto' });
  assert.equal(t.length, 2);
  assert.deepEqual(t.map((x) => x.id), ['draft', 'final']);
  assert.equal(t.find((x) => x.id === 'final').current, true);
  assert.equal(t.find((x) => x.id === 'draft').current, false);
});

ok('本次是草稿档 → draft 标 current，final 待测', () => {
  const t = planTiers({ configScale: 1, scale: 0.5, samples: '1' });
  assert.equal(t.length, 2);
  assert.equal(t.find((x) => x.id === 'draft').current, true);
  assert.equal(t.find((x) => x.id === 'final').current, false);
});

ok('草稿档的 scale 是绝对 0.5：就算成片是 4K（config scale 2），草稿也不是 1.0', () => {
  const t = planTiers({ configScale: 2, scale: 2, samples: 'auto' });
  assert.equal(t.find((x) => x.id === 'draft').scale, DRAFT_SCALE);
  assert.equal(t.find((x) => x.id === 'final').scale, 2);
});

ok('非标准参数（--samples 8）→ 补一行「本次参数」，它才是 current', () => {
  const t = planTiers({ configScale: 1, scale: 1, samples: '8' });
  assert.equal(t.length, 3);
  assert.deepEqual(t.map((x) => x.id), ['draft', 'final', 'custom']);
  assert.equal(t.filter((x) => x.current).length, 1);
  assert.equal(t.find((x) => x.current).id, 'custom');
});

ok('current 永远恰好一个（plan 的第一性：先测当前会话那档）', () => {
  for (const cfg of [[1, 0.5, '1'], [1, 1, 'auto'], [1, 1, '8'], [2, 0.5, '1'], [2, 2, 'auto'], [1, 2, '2'], [1, 4, 'auto']]) {
    const [configScale, scale, samples] = cfg;
    assert.equal(planTiers({ configScale, scale, samples }).filter((x) => x.current).length, 1,
      `configScale=${configScale} scale=${scale} samples=${samples}`);
  }
});

/* ---------------------------------------------------------- estimateTier */
ok('帧数 = round(秒 × fps)，至少 1 帧；分钟数含编码开销', () => {
  const e = estimateTier({ seconds: 5, fps: 60, perFrameMs: 200, encodeMs: 4 });
  assert.equal(e.frames, 300);
  assert.equal(e.perFrameMs, 204);
  assert.ok(Math.abs(e.minutes - 300 * 204 / 60000) < 1e-9);
  const tiny = estimateTier({ seconds: 0.001, fps: 60, perFrameMs: 1, encodeMs: 0 });
  assert.equal(tiny.frames, 1);
});

ok('档位常数：草稿档 scale 绝对 0.5、编码 2ms（1080p 那档的一半）', () => {
  assert.equal(DRAFT_SCALE, 0.5);
  assert.equal(DRAFT_ENCODE_MS, 2);
});

/* ---------------------------------------------------------- 接线自检（真路径不走这些函数 = 白测） */
{
  const src = readFileSync(path.join(ROOT, 'scripts', 'anim.mjs'), 'utf8');
  ok('anim.mjs 真用了 tier-estimate（import + planTiers + estimateTier 都在 printEstimate 路径上）', () => {
    assert.ok(/from '\.\/lib\/tier-estimate\.mjs'/.test(src), '找不到 import');
    const i = src.indexOf('async function printEstimate');
    const j = src.indexOf('命令：video / shot / perf', i);
    assert.ok(i > 0 && j > i, 'printEstimate 位置变了？');
    const body = src.slice(i, j);
    for (const token of ['planTiers(', 'estimateTier(', 'measureSpeed(', 'openSession({ task, scale: t.scale', '← 本次参数']) {
      assert.ok(body.includes(token), `printEstimate 里找不到 ${token}`);
    }
  });
  ok('help 文案与诊断词同步：--dry-run 说「按档预估」', () => {
    assert.ok(src.includes('按档预估'), 'help/输出里要出现「按档预估」');
  });
}

console.log(`\n${n}/${n} 通过`);
