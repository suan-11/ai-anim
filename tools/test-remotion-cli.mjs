import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveAudioTracks } from '../scripts/lib/cli/audio.mjs';
import {
  extractRenderer, nativeChunkRanges, overlapAwareChunkRanges, remotionCommand, remotionPartsDirectory,
  remotionScaleWarning, remotionVideoName, resolveRemotionBinariesDir, resolveSamples, videoFrameRange,
} from '../scripts/lib/cli/remotion.mjs';
import { finalVideo } from '../scripts/lib/cli/paths.mjs';
import { findUnsupportedFlag, peekTaskName, REMOTION_SUPPORTED_CMDS, resolveRenderer } from '../scripts/lib/cli/renderer.mjs';
import { readTaskAudioSpec } from '../scripts/lib/media.mjs';
import { readRegistry } from '../scripts/lib/remotion-registry.mjs';

assert.deepEqual(extractRenderer(['demo', '-t', '0']), { renderer: null, explicit: false, args: ['demo', '-t', '0'] });
assert.deepEqual(extractRenderer(['--renderer', 'remotion', 'example-config-only']), {
  renderer: 'remotion', explicit: true, args: ['example-config-only'],
});
assert.deepEqual(extractRenderer(['demo', '--renderer=legacy']), { renderer: 'legacy', explicit: true, args: ['demo'] });
assert.throws(() => extractRenderer(['--renderer', '--draft']), /remotion 或 legacy/);
assert.throws(() => extractRenderer(['--renderer=legacy', '--renderer=remotion']), /只能指定一次/);

const supportedCommands = ['still', 'shot', 'video', 'check', 'review', 'verify', 'qa'];
assert.deepEqual([...REMOTION_SUPPORTED_CMDS].sort(), [...supportedCommands].sort());
for (const cmd of supportedCommands) assert.ok(remotionCommand(cmd, 'remotion'), 'Remotion command: ' + cmd);
assert.ok(!remotionCommand('video', 'legacy'));
assert.ok(!remotionCommand('queue', 'remotion'));
assert.throws(() => remotionCommand('sheet', 'remotion'), /暂不支持 --renderer remotion/);

// 选路优先级与默认值：登记表是完整数据源，避免新增任务或命令悄悄漏测。
const registry = readRegistry();
const registeredTasks = Object.keys(registry.tasks);
assert.ok(registeredTasks.length > 0, 'Remotion registry must contain registered tasks');
assert.equal(peekTaskName(['-t', '1,2', 'paperfold']), 'paperfold');
assert.equal(peekTaskName(['--segments', '10', 'nekohome-intro-ja']), 'nekohome-intro-ja');
assert.equal(peekTaskName(['--sheet', 'out/contact.png', 'paperfold', '--quick']), 'paperfold');
assert.equal(peekTaskName(['--from=0', '--to=2', 'paperfold']), 'paperfold');

for (const task of registeredTasks) {
  for (const cmd of supportedCommands) {
    const route = resolveRenderer(cmd, [task], { registry, env: {} });
    assert.equal(route.renderer, 'remotion', task + ' ' + cmd + ' 默认应走 remotion');
    assert.equal(route.source, 'auto');
    assert.equal(route.task, task);
    assert.equal(route.fallbackFlag, null);
  }
}
for (const task of ['demo', 'not-in-registry']) {
  for (const cmd of supportedCommands) {
    const route = resolveRenderer(cmd, [task], { registry, env: {} });
    assert.equal(route.renderer, 'legacy', task + ' ' + cmd + ' 未登记时应走 legacy');
    assert.equal(route.source, 'auto');
    assert.equal(route.task, task);
  }
}
assert.equal(resolveRenderer('sheet', ['example-config-only'], { registry, env: {} }).renderer, 'legacy');
assert.equal(resolveRenderer('sheet', ['example-config-only'], { registry, env: {} }).source, 'auto');

// 每条命令的 Remotion 受支持参数仍应保持默认路径。
const supportedArgs = {
  still: ['-t', '0,1', '--scale', '1', '--samples', '1'],
  shot: ['--from', '0', '--to', '2', '--scale', '1', '--crf', '20', '--samples', '1', '--fps', '60', '--vcodec', 'libx264', '--draft', '--noaudio'],
  video: ['--from', '0', '--to', '2', '--scale', '1', '--crf', '20', '--samples', '1', '--fps', '60', '--vcodec', 'libx264', '--draft', '--noaudio', '--segments', '10', '--force', '--dry-run'],
  check: ['--quick', '--gpu', 'high', '--strict'],
  review: ['--round', '1', '--samples', 'auto', '--scale', '1', '--attention', '--attention-step', '0.25', '--video', 'review.mp4', '--shutter', '0.5'],
  verify: ['--file', 'video.mp4', '--out', 'result.mp4', '--from', '0', '--times', '1,2', '--samples', '1', '--tol', '18', '--scale', '1', '--fps', '60'],
  qa: ['--file', 'video.mp4', '--head', '0.5', '--tail', '1.2', '--freeze', '3', '--expect-size', '1920x1080', '--expect-fps', '60', '--expect-duration', '10', '--audio', 'none', '--dur-tol', '0.5'],
};
for (const cmd of supportedCommands) {
  assert.equal(findUnsupportedFlag(cmd, supportedArgs[cmd]), null, cmd + ' 的 Remotion 支持参数不应触发回退');
  const route = resolveRenderer(cmd, [...supportedArgs[cmd], 'paperfold'], { registry, env: {} });
  assert.equal(route.renderer, 'remotion', cmd + ' 的支持参数应保留 Remotion 路由');
  assert.equal(route.task, 'paperfold');
}

// 常见仅 legacy 支持的参数必须在默认模式触发可观测回退，而不是误入 Remotion 后静默忽略。
const fallbackCases = {
  still: [['--only', 'hook'], ['--variant=alt'], ['--style', 'paper'], ['--gpu', 'high'], ['--shutter', '0.5']],
  shot: [['--only', 'hook'], ['--variant=alt'], ['--style', 'paper'], ['--gpu', 'high'], ['--shutter', '0.5']],
  video: [['--only', 'hook'], ['--variant=alt'], ['--style', 'paper'], ['--gpu', 'high'], ['--shutter', '0.5']],
  check: [['--only', 'hook'], ['--variant=alt'], ['--style', 'paper']],
  review: [['--only', 'hook'], ['--variant=alt'], ['--style', 'paper']],
  verify: [['--only', 'hook'], ['--variant=alt'], ['--style', 'paper']],
};
for (const [cmd, cases] of Object.entries(fallbackCases)) {
  for (const args of cases) {
    const flag = args[0].split('=')[0];
    assert.equal(findUnsupportedFlag(cmd, args), flag, cmd + ' ' + args.join(' ') + ' should be detected');
    const route = resolveRenderer(cmd, [...args, 'paperfold'], { registry, env: {} });
    assert.equal(route.renderer, 'legacy', cmd + ' ' + args.join(' ') + ' should fall back');
    assert.equal(route.source, 'auto-fallback');
    assert.equal(route.fallbackFlag, flag);
    assert.equal(route.task, 'paperfold', 'an unsupported option value must not be mistaken for the task');
  }
}
assert.equal(findUnsupportedFlag('qa', ['--only', 'hook']), null, 'qa uses shared file-inspection options, not render options');

// 优先级：显式 --renderer > ANIM_RENDERER > auto；flag/env 均为强制选路，不自动回退。
{
  const r = resolveRenderer('video', ['paperfold', '--renderer', 'legacy'], { registry, env: { ANIM_RENDERER: 'remotion' } });
  assert.equal(r.renderer, 'legacy');
  assert.equal(r.source, 'flag');
  assert.equal(r.args.includes('--renderer'), false);
}
{
  const r = resolveRenderer('video', ['paperfold', '--renderer=remotion', '--gpu', 'high'], { registry, env: { ANIM_RENDERER: 'legacy' } });
  assert.equal(r.renderer, 'remotion');
  assert.equal(r.source, 'flag');
  assert.equal(r.fallbackFlag, null);
  assert.deepEqual(r.args, ['paperfold', '--gpu', 'high']);
}
{
  const r = resolveRenderer('video', ['demo'], { registry, env: { ANIM_RENDERER: 'remotion' } });
  assert.equal(r.renderer, 'remotion');
  assert.equal(r.source, 'env');
  assert.equal(r.task, 'demo');
}
{
  const r = resolveRenderer('video', ['paperfold', '--gpu', 'high'], { registry, env: { ANIM_RENDERER: 'legacy' } });
  assert.equal(r.renderer, 'legacy');
  assert.equal(r.source, 'env');
  assert.equal(r.fallbackFlag, null);
}
{
  const r = resolveRenderer('video', ['paperfold', '--gpu', 'high'], { registry, env: { ANIM_RENDERER: 'remotion' } });
  assert.equal(r.renderer, 'remotion');
  assert.equal(r.source, 'env');
  assert.equal(r.fallbackFlag, null);
}
assert.equal(resolveRenderer('video', ['paperfold', '--renderer=legacy'], { registry, env: { ANIM_RENDERER: 'invalid' } }).renderer, 'legacy');
assert.throws(() => resolveRenderer('video', ['demo'], { registry, env: { ANIM_RENDERER: 'invalid' } }), /ANIM_RENDERER/);
assert.equal(resolveRenderer('help', ['--renderer=invalid'], { registry, env: {} }).renderer, 'legacy');
const queuedRemotion = resolveRenderer('queue', ['paperfold', '--renderer=remotion'], { registry, env: {} });
assert.equal(queuedRemotion.renderer, 'legacy', 'queue itself stays on legacy while the child renderer is selected');
assert.deepEqual(queuedRemotion.args, ['paperfold', '--renderer=remotion'], 'queue forwards renderer selection to video unchanged');
assert.equal(resolveRenderer('queue', ['paperfold'], { registry, env: { ANIM_RENDERER: 'remotion' } }).renderer, 'legacy',
  'queue orchestration stays legacy even when child videos inherit ANIM_RENDERER');

assert.deepEqual(videoFrameRange(3.45, 3.55, 60, 834), [207, 212]);
assert.deepEqual(videoFrameRange(0, 13.9, 60, 834), [0, 833]);
assert.throws(() => videoFrameRange(0, 0.001, 60, 834), /不足一帧/);
assert.throws(() => videoFrameRange(12, 14, 60, 834), /影片内/);
const segments = [0, 210, 474, 684].map((startFrame) => ({ startFrame }));
assert.deepEqual(nativeChunkRanges(207, 212, 20, segments), [[207, 209], [210, 212]]);
assert.deepEqual(nativeChunkRanges(207, 212, 2, segments), [[207, 208], [209, 209], [210, 211], [212, 212]]);

const task = 'example-config-only';
const full = { short: false, draft: false, from: 0, to: 13.9, duration: 13.9 };
assert.equal(remotionVideoName(task, full), 'example-config-only.remotion.mp4');
assert.equal(remotionVideoName(task, { ...full, draft: true }), 'example-config-only.remotion.draft.mp4');
assert.equal(remotionVideoName(task, { ...full, from: 1, to: 2 }), 'example-config-only.remotion.1-2.mp4');
assert.equal(remotionVideoName(task, { ...full, short: true, to: 4 }), 'shot_0-4.remotion.mp4');
assert.equal(remotionPartsDirectory(path.join('out', task, 'example-config-only.remotion.mp4')),
  path.join('out', task, 'example-config-only.remotion.parts'));

assert.equal(resolveSamples({ eval: 'task-eval' }, { draft: true }), 1);
assert.equal(resolveSamples({ eval: 'task-eval' }, { draft: false }), 'auto');
assert.equal(resolveSamples({ eval: 'task-eval' }, { draft: true, samplesOpt: 'auto' }), 'auto');
assert.equal(resolveSamples({ eval: 'config-only' }, { draft: true }), 1);
assert.equal(remotionScaleWarning({ eval: 'task-eval' }, 2),
  'Remotion 下 --scale 2 只是放大位图，不是真 4K；要真 4K 用 --renderer legacy --scale 2');
assert.equal(remotionScaleWarning({ eval: 'config-only' }, 2), null);
assert.equal(remotionScaleWarning({ eval: 'task-eval' }, 1), null);

// The canonical final render is chosen by mtime when both renderer outputs exist.
{
  const root = mkdtempSync(path.join(tmpdir(), 'anim-final-video-'));
  const dir = path.join(root, 'out', 'fixture');
  mkdirSync(dir, { recursive: true });
  const legacy = path.join(dir, 'fixture.mp4');
  const remotion = path.join(dir, 'fixture.remotion.mp4');
  const hints = [];
  try {
    assert.equal(finalVideo('fixture', { root, onBoth: (message) => hints.push(message) }), null);
    writeFileSync(legacy, 'legacy');
    assert.equal(finalVideo('fixture', { root, onBoth: (message) => hints.push(message) }), legacy);
    writeFileSync(remotion, 'remotion');
    utimesSync(legacy, 1000, 1000);
    utimesSync(remotion, 2000, 2000);
    assert.equal(finalVideo('fixture', { root, onBoth: (message) => hints.push(message) }), remotion);
    assert.match(hints[0], /取较新的/);
    utimesSync(legacy, 3000, 3000);
    assert.equal(finalVideo('fixture', { root, onBoth: (message) => hints.push(message) }), legacy);
    assert.equal(hints.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function rejects(args, reason, env = {}) {
  const result = spawnSync(process.execPath, ['scripts/anim.mjs', ...args], {
    encoding: 'utf8', env: { ...process.env, ANIM_RENDERER: '', ...env },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, reason);
}

rejects(['video', 'demo', '--renderer=remotion'], /未验证 Remotion 出片/);
rejects(['sheet', task, '--renderer=remotion'], /sheet 暂不支持 --renderer remotion/);
rejects(['still', task, '--renderer', 'remotion', '--only', 'title'], /Remotion 的 still 暂不支持 --only/);
rejects(['shot', task, '--renderer', 'remotion', '--only', 'title'], /Remotion 的 shot 暂不支持 --only/);
rejects(['video', task, '--renderer', 'remotion', '--only', 'title'], /Remotion 的 video 暂不支持 --only/);
rejects(['video', task, '--only', 'title'], /Remotion 的 video 暂不支持 --only/, { ANIM_RENDERER: 'remotion' });
rejects(['check', task, '--renderer', 'remotion', '--only', 'hook'], /暂不支持 --only/);
rejects(['video', task, '--renderer', 'remotion', '--segments', '0'], /--segments.*正数秒数/);
rejects(['video', task, '--renderer', 'remotion', '--force'], /--force 必须与 --segments/);

// 交叠感知分块：切点绝不落在交叠窗内，覆盖完整无缝
{
  const segs = [
    { id: 'hook', startFrame: 0, endFrame: 216 },
    { id: 'bridge', startFrame: 202, endFrame: 389 },
    { id: 'mechanism', startFrame: 374, endFrame: 662 },
    { id: 'data', startFrame: 648, endFrame: 878 },
    { id: 'close', startFrame: 864, endFrame: 1152 },
  ];
  const overlaps = [[202, 216], [374, 389], [648, 662], [864, 878]];
  for (const size of [10, 24, 50, 240]) {
    const chunks = overlapAwareChunkRanges(0, 1151, size, segs);
    let expect = 0;
    for (const [s, e] of chunks) {
      assert.equal(s, expect, 'chunk gap');
      expect = e + 1;
      for (const [os, oe] of overlaps) {
        assert.ok(!(expect > os && expect < oe), `cut ${expect} inside overlap [${os},${oe})`);
      }
    }
    assert.equal(expect, 1152, 'full coverage');
  }
  // 硬切边界优先：example-config-only 四段全硬切
  const hard = [{ startFrame: 0 }, { startFrame: 210 }, { startFrame: 474 }, { startFrame: 684 }];
  assert.deepEqual(nativeChunkRanges(207, 212, 20, hard), [[207, 209], [210, 212]]);
}

// T2-R2-B：inline audio:{...} + 注释剥离（resolveAudioTracks + readTaskAudioSpec）
{
  const pf = resolveAudioTracks('paperfold');
  assert.equal(pf.isSplit, true, 'paperfold 应识别为分轨配置');
  assert.equal(pf.vo, null, '缺失 paperfold-vo.mp3 时 vo 应为 null');
  assert.equal(pf.mix, null, '缺失 paperfold-mix.mp3 时 mix 应为 null');
  assert.ok(pf.music && pf.music.endsWith(path.join('tasks', 'paperfold', 'audio', 'bed.mp3')), 'paperfold music 应解析为 bed.mp3');
  assert.equal(pf.packaging, pf.music, 'paperfold 缺失 mix 时 packaging 退回 music');

  const tmpRoot = mkdtempSync(path.join(tmpdir(), 'anim-audio-inline-'));
  try {
    const taskDir = path.join(tmpRoot, 'tasks', 'inline_case');
    mkdirSync(path.join(taskDir, 'audio'), { recursive: true });
    writeFileSync(path.join(taskDir, 'audio', 'bed.mp3'), 'stub-mp3');
    writeFileSync(path.join(taskDir, 'task.config.mjs'), [
      'export default {',
      "  // audio: './audio/fake.mp3',",
      "  /* audio: { mix: './audio/fake-mix.mp3' }, */",
      "  narration:'./audio/narration.json', audio:{music:'./audio/bed.mp3',vo:'./audio/v.mp3',mix:'./audio/m.mp3'},",
      '};',
    ].join('\n'));
    const tracks = resolveAudioTracks('inline_case', tmpRoot);
    assert.equal(tracks.isSplit, true);
    assert.equal(tracks.vo, null);
    assert.equal(tracks.mix, null);
    assert.equal(tracks.music, path.join(taskDir, 'audio', 'bed.mp3'));
    assert.equal(tracks.packaging, tracks.music);
    assert.deepEqual(readTaskAudioSpec(taskDir), {
      music: './audio/bed.mp3',
      vo: './audio/v.mp3',
      mix: './audio/m.mp3',
    });

    const commentOnlyDir = path.join(tmpRoot, 'tasks', 'comment_only');
    mkdirSync(path.join(commentOnlyDir, 'audio'), { recursive: true });
    writeFileSync(path.join(commentOnlyDir, 'audio', 'fallback.mp3'), 'stub-mp3');
    writeFileSync(path.join(commentOnlyDir, 'task.config.mjs'), [
      'export default {',
      "  // audio: './audio/ignored.mp3',",
      '  timeline: [],',
      '};',
    ].join('\n'));
    assert.equal(readTaskAudioSpec(commentOnlyDir), null);
    const fb = resolveAudioTracks('comment_only', tmpRoot);
    assert.equal(fb.isSplit, false);
    assert.equal(fb.mix, path.join(commentOnlyDir, 'audio', 'fallback.mp3'));
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// resolveRemotionBinariesDir：离线 DI 测试（保护用户目录 + size/mtimeMs 更新 + 失败清理）
{
  const tmpRoot = mkdtempSync(path.join(tmpdir(), 'anim-bindir-di-'));
  try {
    const exe = (n) => (process.platform === 'win32' ? `${n}.exe` : n);
    const bundledDir = path.join(tmpRoot, 'bundled');
    const userDir = path.join(tmpRoot, 'user-dir');
    const fallbackTmp = path.join(tmpRoot, 'tmp-base');
    const homeBase = path.join(tmpRoot, 'home-base');
    mkdirSync(bundledDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    mkdirSync(fallbackTmp, { recursive: true });
    mkdirSync(homeBase, { recursive: true });

    const libName = process.platform === 'win32' ? 'avutil.dll' : process.platform === 'darwin' ? 'libavutil.dylib' : 'libavutil.so';
    writeFileSync(path.join(bundledDir, exe('ffmpeg')), 'ff-1');
    writeFileSync(path.join(bundledDir, exe('ffprobe')), 'fp-1');
    writeFileSync(path.join(bundledDir, exe('remotion')), 'rm-1');
    writeFileSync(path.join(bundledDir, libName), 'AAAA');
    writeFileSync(path.join(userDir, 'keep.txt'), 'user-data');

    const logs = [];
    // 1) 健康 bundled 环境：直接返回 null，零复制
    const healthy = resolveRemotionBinariesDir({
      bundledDir,
      env: { ANIM_REMOTION_BINARIES_DIR: userDir },
      tmpdir: fallbackTmp,
      homedir: null,
      canRunFfmpeg: () => true,
      canRunRemotionBin: () => true,
      findSystemBinary: () => null,
      log: (m) => logs.push(m),
    });
    assert.equal(healthy, null);
    assert.equal(existsSync(path.join(fallbackTmp, 'ai-anim-remotion-bin')), false);

    // 2) bundled 与 userDir 探针失败、fallbackTmp 成功：userDir 与 keep.txt 绝不被删除
    const fallbackDir = path.join(fallbackTmp, 'ai-anim-remotion-bin');
    const switched = resolveRemotionBinariesDir({
      bundledDir,
      env: { ANIM_REMOTION_BINARIES_DIR: userDir },
      tmpdir: fallbackTmp,
      homedir: null,
      canRunFfmpeg: (binPath, cwd) => cwd === fallbackDir && existsSync(binPath),
      canRunRemotionBin: (binPath, cwd) => cwd === fallbackDir && existsSync(binPath),
      findSystemBinary: () => null,
      log: (m) => logs.push(m),
    });
    assert.equal(switched, fallbackDir);
    assert.equal(readFileSync(path.join(userDir, 'keep.txt'), 'utf8'), 'user-data', '用户目录中的原有文件必须完好无损');
    assert.equal(existsSync(path.join(userDir, exe('remotion'))), false, '失败的 userDir 新复制文件应被清理');
    assert.equal(readFileSync(path.join(fallbackDir, libName), 'utf8'), 'AAAA');

    // 3) syncCopy：同字节数但更新的 mtimeMs 必须触发覆盖；mtimeMs >= src 时跳过覆盖
    const srcLib = path.join(bundledDir, libName);
    const dstLib = path.join(fallbackDir, libName);
    const oldDstMtime = statSync(dstLib).mtimeMs;
    writeFileSync(srcLib, 'BBBB'); // 同为 4 字节
    const newerTime = new Date(oldDstMtime + 5000);
    utimesSync(srcLib, newerTime, newerTime);
    const updated = resolveRemotionBinariesDir({
      bundledDir,
      env: {},
      tmpdir: fallbackTmp,
      homedir: null,
      canRunFfmpeg: (binPath, cwd) => cwd === fallbackDir && existsSync(binPath),
      canRunRemotionBin: (binPath, cwd) => cwd === fallbackDir && existsSync(binPath),
      findSystemBinary: () => null,
      log: (m) => logs.push(m),
    });
    assert.equal(updated, fallbackDir);
    assert.equal(readFileSync(dstLib, 'utf8'), 'BBBB', '同大小但更新的源文件应刷新目标文件');

    writeFileSync(dstLib, 'KEEP'); // 4 字节且 mtimeMs >= src
    const keepTime = new Date(statSync(srcLib).mtimeMs + 5000);
    utimesSync(dstLib, keepTime, keepTime);
    resolveRemotionBinariesDir({
      bundledDir,
      env: {},
      tmpdir: fallbackTmp,
      homedir: null,
      canRunFfmpeg: (binPath, cwd) => cwd === fallbackDir && existsSync(binPath),
      canRunRemotionBin: (binPath, cwd) => cwd === fallbackDir && existsSync(binPath),
      findSystemBinary: () => null,
      log: (m) => logs.push(m),
    });
    assert.equal(readFileSync(dstLib, 'utf8'), 'KEEP', 'dst.mtimeMs >= src.mtimeMs 且同大小时不应重复覆盖');

    // 4) 所有候选都失败：新建的非用户目录（homeBase 下）应被清理，userDir 仍保留
    const emptyTmp = path.join(tmpRoot, 'empty-tmp');
    mkdirSync(emptyTmp, { recursive: true });
    const allFail = resolveRemotionBinariesDir({
      bundledDir,
      env: { ANIM_REMOTION_BINARIES_DIR: userDir },
      tmpdir: emptyTmp,
      homedir: homeBase,
      canRunFfmpeg: () => false,
      canRunRemotionBin: () => false,
      findSystemBinary: () => null,
      log: (m) => logs.push(m),
    });
    assert.equal(allFail, null);
    assert.equal(existsSync(path.join(emptyTmp, 'ai-anim-remotion-bin')), false);
    assert.equal(existsSync(path.join(homeBase, '.cache', 'ai-anim-remotion-bin')), false);
    assert.equal(readFileSync(path.join(userDir, 'keep.txt'), 'utf8'), 'user-data');
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

console.log('test-remotion-cli: PASS（渲染器选择、默认选路、自动回退、兼容报错、切片区间、分块目录、成片选择、采样默认、scale 提示、交付命名、交叠避切、inline audio 与 binariesDir 防护）');
