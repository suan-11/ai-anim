// @ts-check
/**
 * regress-all 的前置依赖体检（A5，2026-11-13；PLAN-2026-11-08 §3）。
 *
 * 为什么要有这一层：没有把 ffmpeg 放进 PATH 的机器上，`regress-all --ci` 曾经红一片，
 * 满屏 ENOENT 堆栈里没有一句"缺 ffmpeg"。现在：
 *   · 跑之前按筛选出的清单的 `needs` 声明，统一探测一次 ffmpeg / ffprobe / Chrome；
 *   · 缺依赖 ⇒ 对应项记 skipped(env)（没跑 ≠ 通过），一行说清缺什么、最常见的修法；
 *   · 汇总明确写"环境问题，不是代码问题"，整体仍以非零码退出。
 *
 * 全部纯函数 + 可注入 IO：单测在 tools/test-regress-env.mjs，不碰真环境。
 * ffmpeg/ffprobe 的 argv 语义与 CLI 一致（ANIM_FFMPEG / ANIM_FFPROBE 包装器，
 * parseCmdline 直接取自 scripts/lib/media.mjs，不另抄一份）。
 */

import { parseCmdline } from '../../scripts/lib/media.mjs';

/** 唯一的合法依赖名（needs 声明与 test-ci-coverage 的守门共用这套词表）。 */
export const KNOWN_DEPS = ['ffmpeg', 'ffprobe', 'chrome'];

/** 一批项的 needs 并集（按 KNOWN_DEPS 顺序、去重）。 */
export function collectNeeds(items) {
  const s = new Set();
  for (const it of items) for (const d of it.needs ?? []) s.add(d);
  return KNOWN_DEPS.filter((d) => s.has(d));
}

/** 按缺失依赖把项分成 runnable / skipped；skipped 带上具体缺哪几个。 */
export function planEnvSkips(items, missing) {
  const miss = new Set(missing);
  const runnable = [];
  const skipped = [];
  for (const it of items) {
    const m = (it.needs ?? []).filter((d) => miss.has(d));
    if (m.length) skipped.push({ item: it, missing: m });
    else runnable.push(it);
  }
  return { runnable, skipped };
}

/**
 * 探测分组键：项可能在自己的 env 里覆写 ANIM_FFMPEG / ANIM_FFPROBE
 * （smoke:backpressure 的慢速包装器）—— 要用**它自己的 env** 探，不是全局的。
 * 其它 env 变量（ANIM_SLOW_MBPS 等）不影响探测，不进键。
 */
export function envOverrideKey(it) {
  const e = it.env ?? {};
  return JSON.stringify([e.ANIM_FFMPEG ?? null, e.ANIM_FFPROBE ?? null]);
}

/** ffmpeg 不在 PATH 时的常见安装位置（用于"找到了但 PATH 没带上"的提示）。 */
export function ffmpegCandidates(platform, env) {
  if (platform === 'win32') {
    const c = [];
    if (env.LOCALAPPDATA) c.push(env.LOCALAPPDATA + '\\Microsoft\\WinGet\\Links\\ffmpeg.exe');
    if (env.ProgramFiles) c.push(env.ProgramFiles + '\\ffmpeg\\bin\\ffmpeg.exe');
    c.push('C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe');
    return c;
  }
  if (platform === 'darwin') return ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  return ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/snap/bin/ffmpeg'];
}

/** 与 ffmpeg 同一批目录，只换可执行文件名（ffprobe 与 ffmpeg 同包发行）。 */
export function depCandidates(dep, platform, env) {
  return ffmpegCandidates(platform, env).map((p) => p.replace(/ffmpeg(\.exe)?$/, dep + '$1'));
}

/** 每个缺失依赖一行：缺什么 + 最常见的修法。ok 时返回 null。 */
export function depHint(dep, info) {
  if (info.ok) return null;
  if (dep === 'chrome') {
    return "缺 Chrome：装 Google Chrome（引擎走 playwright-core 的 channel:'chrome'，不是 bundled Chromium）";
  }
  const envVar = dep === 'ffmpeg' ? 'ANIM_FFMPEG' : 'ANIM_FFPROBE';
  if (info.foundAt) {
    return `缺 ${dep}：在 ${info.foundAt} 找到了，但当前 shell 的 PATH 没带上它 —— 重开 shell（让新 PATH 生效），或设 ${envVar}="${info.foundAt}"`;
  }
  return `缺 ${dep}：装一个并放进 PATH，或设 ${envVar} 指向可执行文件（允许包装器命令）`;
}

/**
 * 把 needs 里的依赖各探一次。IO 全部注入（可单测）：
 *   io.tryRun(argv) -> { status, spawnError? }   media.mjs 的 tryRun 语义：命令不存在不抛
 *   io.exists(p) -> boolean
 *   io.chromePath() -> string（没有 Chrome 时抛）
 * @param {string[]} needs
 * @param {{ env: Record<string,string|undefined>, platform: string, tryRun: Function, exists: Function, chromePath: Function }} io
 */
export async function probeDeps(needs, io) {
  const out = {};
  for (const dep of needs) {
    if (dep === 'chrome') {
      try {
        const p = io.chromePath();
        out[dep] = { ok: !!p && io.exists(p), path: p };
      } catch (e) {
        out[dep] = { ok: false, detail: String(e && e.message ? e.message : e) };
      }
      continue;
    }
    const envVar = dep === 'ffmpeg' ? 'ANIM_FFMPEG' : 'ANIM_FFPROBE';
    const argv = parseCmdline(io.env[envVar] || dep);
    const r = io.tryRun([...argv, '-version']);
    if (r.status === 0) { out[dep] = { ok: true, argv0: argv[0] }; continue; }
    const foundAt = depCandidates(dep, io.platform, io.env).find((p) => io.exists(p));
    out[dep] = { ok: false, argv0: argv[0], foundAt, spawnError: r.spawnError };
  }
  return out;
}

/** 体检输出行：每个缺失依赖一行；全 ok 时是空数组。 */
export function envReport(probe) {
  const lines = [];
  for (const [dep, info] of Object.entries(probe)) {
    const h = depHint(dep, info);
    if (h) lines.push(h);
  }
  return lines;
}
