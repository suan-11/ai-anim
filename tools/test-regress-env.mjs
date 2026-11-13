// @ts-check
/**
 * 前置依赖体检（A5，PLAN-2026-11-08 §3）的回归：全部纯函数 + 注入 IO，不碰真环境。
 *
 *   node tools/test-regress-env.mjs
 *
 * 钉的是三件事：
 *   ① 判据本身（needs 并集 / 缺谁跳谁 / 包装器 env 分组 / 常见位置提示）；
 *   ② 探测语义与 CLI 一致（ANIM_FFMPEG/ANIM_FFPROBE 包装器、-version、命令不存在不抛）；
 *   ③ 接线自检：regress-all 真的在跑前体检、缺依赖真的进 skipped(env) 且退出码非零、
 *      test-ci-coverage 真的有 needs 守门（防"判据写了但没接上"）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KNOWN_DEPS, collectNeeds, planEnvSkips, envOverrideKey,
  ffmpegCandidates, depCandidates, depHint, probeDeps, envReport,
} from './lib/regress-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          -> ' + detail : '')); }
};

/* ── ① collectNeeds / planEnvSkips ── */
ok('KNOWN_DEPS 词表', JSON.stringify(KNOWN_DEPS) === JSON.stringify(['ffmpeg', 'ffprobe', 'chrome']));
ok('collectNeeds 并集去重且按词表序', JSON.stringify(collectNeeds([
  { needs: ['chrome', 'ffmpeg'] }, { needs: ['ffmpeg'] }, { needs: [] }, {},
])) === JSON.stringify(['ffmpeg', 'chrome']));
ok('collectNeeds 空清单', collectNeeds([]).length === 0);

const A = { name: 'a', needs: ['ffmpeg'] };
const B = { name: 'b', needs: ['ffmpeg', 'chrome'] };
const C = { name: 'c', needs: [] };
const D = { name: 'd' };
{
  const r = planEnvSkips([A, B, C, D], []);
  ok('没有缺失 ⇒ 全跑', r.runnable.length === 4 && r.skipped.length === 0);
}
{
  const r = planEnvSkips([A, B, C, D], ['ffmpeg']);
  ok('缺 ffmpeg ⇒ 只跳声明了它的项', r.runnable.map((x) => x.name).join(',') === 'c,d'
    && r.skipped.map((x) => x.item.name).join(',') === 'a,b');
  ok('skipped 带具体缺失', JSON.stringify(r.skipped[1].missing) === JSON.stringify(['ffmpeg']));
}
{
  const r = planEnvSkips([A, B], ['chrome']);
  ok('只缺 chrome ⇒ 只跳需要 chrome 的', r.runnable.map((x) => x.name).join(',') === 'a'
    && r.skipped[0].item.name === 'b' && JSON.stringify(r.skipped[0].missing) === JSON.stringify(['chrome']));
}
ok('needs:[] 与不写 needs 都不跳', planEnvSkips([C, D], ['ffmpeg', 'ffprobe', 'chrome']).skipped.length === 0);

/* ── ② envOverrideKey：包装器分组 ── */
ok('无 env 与空 env 同键', envOverrideKey({}) === envOverrideKey({ env: {} }));
ok('ANIM_FFMPEG 覆写 ⇒ 不同键', envOverrideKey({ env: { ANIM_FFMPEG: '"node" tools/slow-ffmpeg.mjs' } }) !== envOverrideKey({}));
ok('无关 env 不进键', envOverrideKey({ env: { ANIM_SLOW_MBPS: '12' } }) === envOverrideKey({}));

/* ── ③ 常见安装位置 ── */
{
  const c = ffmpegCandidates('win32', { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local', ProgramFiles: 'C:\\Program Files' });
  ok('win32 含 WinGet Links', c.some((p) => p.includes('WinGet\\Links\\ffmpeg.exe')));
  ok('win32 含 C:\\ffmpeg 兜底', c.includes('C:\\ffmpeg\\bin\\ffmpeg.exe'));
  ok('win32 无 LOCALAPPDATA 也不崩', ffmpegCandidates('win32', {}).length >= 2);
  ok('darwin 含 homebrew', ffmpegCandidates('darwin', {}).includes('/opt/homebrew/bin/ffmpeg'));
  ok('linux 含 /usr/bin', ffmpegCandidates('linux', {}).includes('/usr/bin/ffmpeg'));
  const fp = depCandidates('ffprobe', 'win32', { LOCALAPPDATA: 'C:\\L' });
  ok('ffprobe 候选只换文件名不换目录', fp[0] === 'C:\\L\\Microsoft\\WinGet\\Links\\ffprobe.exe');
  ok('linux ffprobe 候选', depCandidates('ffprobe', 'linux', {}).includes('/usr/bin/ffprobe'));
}

/* ── ④ probeDeps（注入 IO）── */
const mkIo = (over = {}) => ({
  env: {}, platform: 'linux',
  tryRun: () => ({ status: 0 }),
  exists: () => false,
  chromePath: () => '/usr/bin/google-chrome',
  ...over,
});
{
  const calls = [];
  const probe = await probeDeps(['ffmpeg', 'ffprobe'], mkIo({ tryRun: (argv) => { calls.push(argv); return { status: 0 }; } }));
  ok('ffmpeg/ffprobe 用 -version 探', JSON.stringify(calls) === JSON.stringify([['ffmpeg', '-version'], ['ffprobe', '-version']]));
  ok('status 0 ⇒ ok', probe.ffmpeg.ok === true && probe.ffprobe.ok === true);
}
{
  const calls = [];
  const probe = await probeDeps(['ffmpeg'], mkIo({
    env: { ANIM_FFMPEG: '"node" tools/slow-ffmpeg.mjs' },
    tryRun: (argv) => { calls.push(argv); return { status: 0 }; },
  }));
  ok('ANIM_FFMPEG 包装器按 argv 拆', JSON.stringify(calls[0]) === JSON.stringify(['node', 'tools/slow-ffmpeg.mjs', '-version']));
  ok('包装器可用 ⇒ ok', probe.ffmpeg.ok === true);
}
{
  const probe = await probeDeps(['ffmpeg'], mkIo({
    tryRun: () => ({ status: null, spawnError: 'ENOENT' }),
    exists: (p) => p === '/usr/local/bin/ffmpeg',
  }));
  ok('命令不在但常见位置有 ⇒ foundAt', probe.ffmpeg.ok === false && probe.ffmpeg.foundAt === '/usr/local/bin/ffmpeg');
}
{
  const probe = await probeDeps(['ffprobe'], mkIo({
    env: { ANIM_FFPROBE: '/opt/ffprobe' },
    tryRun: () => ({ status: 1 }),
  }));
  ok('ANIM_FFPROBE 生效且失败 ⇒ 不 ok', probe.ffprobe.ok === false && probe.ffprobe.argv0 === '/opt/ffprobe');
}
{
  const probe = await probeDeps(['chrome'], mkIo({ exists: (p) => p === '/usr/bin/google-chrome' }));
  ok('chrome 可执行文件在 ⇒ ok', probe.chrome.ok === true);
  const probe2 = await probeDeps(['chrome'], mkIo({ chromePath: () => { throw new Error('Executable does not exist'); } }));
  ok('chromePath 抛 ⇒ 不 ok 且不冒泡', probe2.chrome.ok === false && /Executable/.test(probe2.chrome.detail));
  const probe3 = await probeDeps(['chrome'], mkIo({ exists: () => false }));
  ok('路径返回但文件不在 ⇒ 不 ok', probe3.chrome.ok === false);
}
{
  const calls = [];
  await probeDeps(['ffmpeg'], mkIo({ tryRun: (a) => { calls.push(a); return { status: 0 }; } }));
  ok('只探需要的依赖', calls.length === 1);
}

/* ── ⑤ 提示文案 ── */
{
  const h = depHint('ffmpeg', { ok: false, foundAt: '/opt/ffmpeg/bin/ffmpeg' });
  ok('foundAt 提示给 ANIM_FFMPEG 与重开 shell', h.includes('ANIM_FFMPEG') && h.includes('/opt/ffmpeg/bin/ffmpeg') && h.includes('重开 shell'));
  const h2 = depHint('ffmpeg', { ok: false });
  ok('无 foundAt 提示装一个进 PATH', h2.includes('PATH') && h2.includes('ANIM_FFMPEG'));
  ok('ffprobe 提示用 ANIM_FFPROBE', depHint('ffprobe', { ok: false }).includes('ANIM_FFPROBE'));
  ok('chrome 提示装 Chrome', depHint('chrome', { ok: false }).includes('Chrome'));
  ok('ok 时无提示', depHint('ffmpeg', { ok: true }) === null);
  ok('envReport 全 ok ⇒ 空', envReport({ ffmpeg: { ok: true }, chrome: { ok: true } }).length === 0);
  ok('envReport 每个缺失一行', envReport({ ffmpeg: { ok: false }, ffprobe: { ok: true }, chrome: { ok: false } }).length === 2);
}

/* ── ⑥ 接线自检（读源码，防"判据写了但没接上"）── */
{
  const reg = readFileSync(path.join(ROOT, 'tools', 'regress-all.mjs'), 'utf8');
  ok('regress-all import 了 regress-env', /from '\.\/lib\/regress-env\.mjs'/.test(reg));
  ok('regress-all 跑前调 probeDeps', /await probeDeps\(/.test(reg));
  ok('regress-all 用 planEnvSkips 分流', /planEnvSkips\(/.test(reg));
  ok('缺依赖进 skipped(env) 且退出码非零', /envSkip: true/.test(reg) && /process\.exit\(failed\.length \|\| envSkipped\.length \? 1 : 0\)/.test(reg));
  ok('汇明确写环境问题不是代码问题', reg.includes('环境问题，不是代码问题'));
  ok('check:demo 声明了 needs', /name: 'check:demo', needs: \['chrome'\]/.test(reg));
  ok('unit:loudness 声明了 ffmpeg+ffprobe', /name: 'unit:loudness', needs: \['ffmpeg', 'ffprobe'\]/.test(reg));
  ok('smoke:backpressure 声明了 needs', /name: 'smoke:backpressure', needs: \[/.test(reg));
  const gate = readFileSync(path.join(ROOT, 'tools', 'test-ci-coverage.mjs'), 'utf8');
  ok('test-ci-coverage 有 needs 守门', gate.includes('依赖项都显式声明了 needs'));
  ok('守门词表与 KNOWN_DEPS 一致', gate.includes("['ffmpeg', 'ffprobe', 'chrome']"));
}

console.log('');
console.log(fail ? '✗ ' + fail + ' 项失败（共 ' + (pass + fail) + ' 项）' : '✓ ' + pass + ' 项全部通过（共 ' + pass + ' 项）');
process.exitCode = fail ? 1 : 0;
