// @ts-check
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CASES, VIDEOS, classifyPngComparison, classifyVideoComparison, compareFfprobeSpecs,
  computeRgbaDiffWithTol, resolveBundleRelPath, resolveSafeRunDir, validateManifest,
} from '../tools/cross-gpu-repro.mjs';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };

// 1) CASES / VIDEOS 基线配置完整性（含 R1 outro、paperfold --noaudio、Three.js 乱序重复帧）
{
  const native = CASES.find((c) => c.id === 'native-example-config-only');
  ok(Boolean(native) && [684, 708, 739].every((f) => native.frameSequence.includes(f)), 'CASES 包含 R1 outro 关键帧 684/708/739');
  const pf1 = CASES.find((c) => c.id === 'paperfold-s1');
  ok(Boolean(pf1) && pf1.frameSequence.filter((f) => f === 204).length === 2 && pf1.frameSequence.filter((f) => f === 48).length === 2,
    'paperfold-s1 包含乱序重复帧 204 与 48');
  const tl4 = CASES.find((c) => c.id === 'three-lab-s4');
  ok(Boolean(tl4) && tl4.inputProps.samples === 4 && tl4.frameSequence.filter((f) => f === 339).length === 2,
    'three-lab-s4 包含多子帧配置与乱序重复帧 339');
  const pfVid = VIDEOS.find((v) => v.id === 'paperfold-overlap-draft');
  ok(Boolean(pfVid) && pfVid.args.includes('--noaudio') && pfVid.audioExpected === false,
    'paperfold 代表草稿强制携带 --noaudio 且不期待音轨');
}

// 2) manifest 校验
{
  const valid = {
    schema: 'cross-gpu-bundle/1',
    cases: [{
      id: 'c1',
      compositionId: 'ExampleConfigOnly',
      width: 1920,
      height: 1080,
      frameSequence: [60, 60],
      baselines: {
        60: { baselinePath: 'baseline/frames/c1/f_60.png', sha256: 'abc' },
      },
    }],
    videos: [{
      id: 'v1',
      baselinePath: 'baseline/videos/v1.mp4',
      args: ['video', 'example-config-only'],
      ffprobe: { width: 960, height: 540, fps: 60, nbFrames: 834, duration: 13.9, audioStreamCount: 0, codecName: 'h264' },
    }],
  };
  ok(validateManifest(valid).schema === 'cross-gpu-bundle/1', '合法 manifest 通过校验');
  assert.throws(() => validateManifest({ ...valid, schema: 'bad' }), /schema/);
  assert.throws(() => validateManifest({ ...valid, cases: [] }), /不能为空/);
  assert.throws(() => validateManifest({
    ...valid,
    cases: [{ ...valid.cases[0], frameSequence: [60, 210] }],
  }), /缺少基准记录/);
}

// 3) resolveSafeRunDir 与 resolveBundleRelPath 隔离保护
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'anim-xrepro-'));
  try {
    const bundle = path.join(tmp, 'bundle');
    const safeDefault = resolveSafeRunDir(bundle, null, 'ANGLE (AMD, Radeon)', '2026-11-28T10-00-00Z');
    ok(safeDefault.startsWith(path.join(bundle, 'runs') + path.sep), '默认 runDir 落入 runs/<id>/ 隔离目录');

    const safeCustom = resolveSafeRunDir(bundle, path.join(bundle, 'runs', 'manual'));
    ok(safeCustom === path.join(bundle, 'runs', 'manual'), '允许显式指定 runs/ 下子目录');

    assert.throws(() => resolveSafeRunDir(bundle, bundle), /根目录/);
    assert.throws(() => resolveSafeRunDir(bundle, path.join(bundle, 'baseline')), /baseline/);
    assert.throws(() => resolveSafeRunDir(bundle, path.join(bundle, 'baseline', 'frames')), /baseline/);
    assert.throws(() => resolveSafeRunDir(bundle, tmp), /包含 baseline/);
    assert.throws(() => resolveBundleRelPath(bundle, '../escape.png'), /非法 bundle 相对路径/);
    ok(resolveBundleRelPath(bundle, 'baseline/frames/a.png') === path.join(bundle, 'baseline', 'frames', 'a.png'), '合法相对路径正确解析');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// 4) computeRgbaDiffWithTol 与分级判定
{
  const a = Buffer.from([10, 20, 30, 255, 100, 100, 100, 255]);
  const b = Buffer.from([12, 20, 30, 255, 100, 110, 100, 255]); // deltas: [2, 0, 0, 0, 0, 10, 0, 0] -> sum=12, mean=1.5, max=10, >8 count=1/8=12.5%
  const d = computeRgbaDiffWithTol(a, b, 8);
  ok(d.max === 10 && Math.abs(d.mean - 1.5) < 1e-9 && Math.abs(d.overTolPct - 12.5) < 1e-9, 'computeRgbaDiffWithTol 正确统计 max/mean/overTolPct');

  ok(classifyPngComparison({ sha256Match: true, diff: null }).status === 'exact', 'SHA-256 一致判为 exact');
  ok(classifyPngComparison({ sha256Match: false, diff: { max: 4, mean: 0.8, overTolPct: 0.2 } }).status === 'within-tolerance',
    'SHA-256 不同但容差内判为 within-tolerance 且 pass');
  const pngFail = classifyPngComparison({ sha256Match: false, diff: { max: 50, mean: 4.2, overTolPct: 3.1 } });
  ok(pngFail.status === 'diverged' && pngFail.pass === false, 'PNG 超容差判为 diverged 且 fail');

  ok(classifyVideoComparison({ sha256Match: false, diff: { max: 12, mean: 2.5, over16Pct: 0.4 } }).pass === true,
    '视频关键帧容差内判 pass');
  ok(classifyVideoComparison({ sha256Match: false, diff: { max: 80, mean: 7.5, over16Pct: 6.0 } }).pass === false,
    '视频关键帧超容差判 fail');
}

// 5) 媒体流规格比对
{
  const exp = { width: 960, height: 540, fps: 60, nbFrames: 834, duration: 13.9, audioStreamCount: 0, codecName: 'h264' };
  ok(compareFfprobeSpecs(exp, { ...exp }).ok === true, '一致的媒体流规格通过');
  const bad = compareFfprobeSpecs(exp, { ...exp, audioStreamCount: 1, nbFrames: 830 });
  ok(bad.ok === false && bad.mismatches.length === 2, '音轨数或帧数不符被捕获');
}

console.log(`\ntest-cross-gpu-repro: PASS（${passed} 项）`);
