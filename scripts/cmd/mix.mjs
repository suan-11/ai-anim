// @ts-check
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { flag, opt } from "../lib/cli/args.mjs";
import { die, log } from "../lib/cli/log.mjs";
import { ROOT, pickTask } from "../lib/cli/paths.mjs";
/**
 * `anim mix` —— 旁白摆位 + 用旁白自己的包络给音乐做闪避，混成**一条**交给引擎的音轨。
 * 引擎只有一条音轨、没有 sidechain（`docs/NARRATION.md` §1），所以这一步必须在外面做。
 */

/**
 * `anim mix --sfx …` 的三种写法：
 *   `auto`        —— 按切点自动摆 whoosh（第一条段除外），一条命令就有声音设计；
 *   `<json 路径>`  —— 读一个 { items: [{ file, at, gain }] } 的表（file 可以是类别名，也可以是绝对/相对路径）；
 *   `whoosh,click` —— 逗号分隔的类别，按**均匀间隔**摆开（临时试听用，正式片子写 json）。
 * 不给就是 undefined（老路径，一个字节都不变）。
 */
async function resolveSfxOpt(task) {
  if (!flag('sfx')) return undefined;
  const raw = opt('sfx');
  if (raw === undefined) die('--sfx 后面要跟一个值：auto / 一个 json 路径 / 若干类别名（逗号分隔）。');
  const { findSfx } = await import("../lib/mix.mjs");
  const { designSfx, summarize } = await import("../lib/sfx-rules.mjs");
  const { build } = await import("../../src/timeline.js");
  const dir = path.join(ROOT, 'tasks', task);
  const mod = await import(pathToFileURL(path.join(dir, 'task.config.mjs')).href);
  const cfg = mod.default ?? mod.config;
  const segs = build(cfg.timeline, { bpm: 120, duration: cfg.duration ?? 0 });
  if (raw === 'auto') {
    // 语义摆位：不按"每个切点一声风"，而是按段在做什么选声音（title→撞+闪、chart→UI 声、
    // 歌词换族→风、glitch→故障、outro→断电）。规则表见 scripts/lib/sfx-rules.mjs 头注释。
    const { items, missing } = designSfx(segs);
    if (!items.length) {
      die('--sfx auto 一条都没排上：库里缺这些类别（' + (missing.join(' / ') || '?') + '）。'
        + '\n  先跑 node tools/sfx-fetch.mjs --get <id> --category <类别> --dir assets/sfx 补上。');
    }
    log('· 音效语义摆位：' + items.length + ' 条（' + summarize(items) + '）');
    if (missing.length) log('  ⚠ 库里缺这些类别，已跳过：' + missing.join(' / '));
    return items;
  }
  if (/\.json$/i.test(raw)) {
    const file = path.resolve(ROOT, raw);
    if (!existsSync(file)) die('没有这个音效表：' + raw);
    const spec = JSON.parse(readFileSync(file, 'utf8'));
    const items = (spec.items ?? []).map((it) => ({
      ...it,
      file: /[\\/]/.test(it.file) || /\.mp3$/i.test(it.file) ? path.resolve(dir, it.file) : findSfx(it.file),
    }));
    log(`· 音效表 ${raw}：${items.length} 条`);
    return items;
  }
  const kinds = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const total = segs.length ? segs[segs.length - 1].end : 0;
  const items = [];
  kinds.forEach((k, i) => {
    const step = total / (kinds.length + 1);
    items.push({ file: findSfx(k), at: Number((step * (i + 1)).toFixed(2)), gain: 0.45 });
  });
  log(`· 音效 ${kinds.join(' / ')}：按均匀间隔摆了 ${items.length} 条（试听用；正式片子写成 json）`);
  return items;
}
async function cmdMix() {
  const task = pickTask();
  const { runMix } = await import("../lib/mix.mjs");
  /**
   * `--target` 的三种写法都在 `mix.mjs` 的 `resolveLoudnessTarget()` 里收口（预设名 / 数字 /
   * 都不给）。这里**只做透传**，不在这里判数字合不合法 —— 判据只有一份，单测直接断言那个
   * 纯函数；在 CLI 里再抄一遍，两边迟早漂成"命令行放行、lib 拒绝"这种最难查的错。
   * 唯一的例外是"写了 `--target` 却没跟值"：那会让 opt() 拿到 undefined，归一化就**静默
   * 不发生** —— 必须当场拒绝。
   */
  const rawTarget = opt('target');
  if (flag('target') && rawTarget === undefined) die('--target 后面要跟一个值：streaming / cinema / off，或一个数字（如 -14）。');
  const rawLra = opt('lra');
  const lra = rawTarget !== undefined && rawLra !== undefined ? Number(rawLra) : undefined;
  if (lra !== undefined && !Number.isFinite(lra)) die(`--lra 要一个数字（现在给的是 "${rawLra}"）。`);
  /**
   * ⚠ 参数错（预设名写错 / 数字超范围 / 只给 `--lra`）在 lib 里是**抛异常**的 —— 那是给单测
   * 直接断言用的形状。CLI 这一侧要把它变成一行 `✗ …`：抛出去的 stack 会盖住真正的错因，
   * 作者看到的是 20 行 node 内部帧，找不到"是我把 streaming 拼错了"。
   * 判据仍只有 lib 那一份（这里只换呈现，不重写判据）。
   */
  try {
    return runMix(task, {
      taskDir: path.join(ROOT, 'tasks', task),
      music: opt('music'),
      out: opt('out') ?? opt('o'),
      voOnly: flag('vo-only'),
      bitrate: opt('bitrate'),
      target: rawTarget,
      lra,
      // 多语言/多变体：不给它，--table ja 会去读 zh 的 timing 并**覆盖 zh 的混音**（实测踩过）
      table: opt('table'),
      sfx: await resolveSfxOpt(task),
    });
  } catch (e) {
    if (e && /^(不认识的 --target|靶子的 |给了 LRA)/.test(String(e.message))) die(String(e.message));
    throw e;
  }
}
export { cmdMix as run };
