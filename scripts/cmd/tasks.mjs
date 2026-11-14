// @ts-check
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { flag } from "../lib/cli/args.mjs";
import { log } from "../lib/cli/log.mjs";
import { ROOT, taskNames } from "../lib/cli/paths.mjs";
/* ------------------------------------------------------------------ 命令：tasks */

/**
 * `anim tasks --json` 的字段契约（BACKLOG 1-58）。
 *
 * 为什么要它：任何"批量跑一批片子"的东西（`anim queue`、变体矩阵、外部脚本）都要先知道
 * **有哪些片子、每片多大多长、什么风格、有没有旁白、有哪些变体**。以前只有人能读的一行文本。
 * 出处：Remotion 的 `getCompositions()` —— 把片子清单与输入声明成机器可读的（见 docs/REFERENCE-remotion.md §2①）。
 *
 * schema 串沿用 `anim.shots --json` 的惯例：**只许加字段，不许改已有字段的含义**。
 */
const TASKS_SCHEMA = 'anim.tasks/1';

/**
 * 从任务配置源码里抠出元信息（**纯函数**，离线可测）。
 *
 * ⚠ 这里是**静态解析**，不是执行配置：
 *   · `duration` 只有存在 `audio/timing.json`（旁白解算产物）时才知道，否则是 null + `durationSource: null`；
 *   · `variants` 只列名字（键），不展开它们的覆盖内容；
 *   · 解析不出来的一律留 null，**不猜**（与"空 ≠ 干净"同一条纪律）。
 *
 * @param {{ id: string, cfgText: string, sceneCount?: number, audio?: string[],
 *           timingTotal?: number|null }} a
 */
function parseTaskMeta(a) {
  const cfg = String(a.cfgText ?? '');
  // ⚠ 只看 variants 之前的部分：变体里的 style / captions 是**变体的**，不是任务级的
  //   （第一版没切，_info-lab 被读成 style: noir —— 它只有 dark 变体是 noir）
  const baseText = cfg.split(/export\s+const\s+variants/)[0];
  const pick = (re) => { const m = re.exec(baseText); return m ? m[1] : null; };
  const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  // style 可以是字符串、也可以是 { name: '...' } —— 两种都认，认不出就是 null（= 默认 print）
  const style = pick(/\bstyle:\s*['"]([^'"]+)['"]/) ?? pick(/\bstyle:\s*\{[^}]*?name:\s*['"]([^'"]+)['"]/);
  // captions: true / false（不写 = 没开）
  const capRaw = pick(/\bcaptions:\s*(true|false)\b/);
  const variants = [];
  const vm = /export\s+const\s+variants\s*=\s*\{([\s\S]*?)\n\};/.exec(cfg);
  if (vm) for (const m of vm[1].matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm)) variants.push(m[1]);
  return {
    id: a.id,
    title: pick(/\btitle:\s*['"]([^'"]+)['"]/) ?? a.id,
    width: num(pick(/\bwidth:\s*(\d+)/)),
    height: num(pick(/\bheight:\s*(\d+)/)),
    fps: num(pick(/\bfps:\s*(\d+)/)),
    scale: num(pick(/\bscale:\s*(\d+)/)),
    style,
    captions: capRaw == null ? false : capRaw === 'true',
    sceneCount: Number.isFinite(a.sceneCount) ? a.sceneCount : 0,
    audio: Array.isArray(a.audio) ? a.audio : [],
    variants,
    duration: Number.isFinite(a.timingTotal) ? a.timingTotal : null,
    durationSource: Number.isFinite(a.timingTotal) ? 'audio/timing.json' : null,
  };
}

function cmdTasks() {
  const names = taskNames();
  if (!names.length) { log('(还没有任务) 跑：node scripts/anim.mjs new 我的第一个动画'); return; }

  /** 一个任务的元信息（--json 与人类可读两条路共用同一份，避免两套口径漂移）。 */
  const metaOf = (n) => {
    const dir = path.join(ROOT, 'tasks', n);
    const cfg = readFileSync(path.join(dir, 'task.config.mjs'), 'utf8');
    const scenes = existsSync(path.join(dir, 'scenes'))
      ? readdirSync(path.join(dir, 'scenes')).filter((f) => f.endsWith('.js')).length
      : 0;
    const audio = existsSync(path.join(dir, 'audio'))
      ? readdirSync(path.join(dir, 'audio')).filter((f) => /\.(mp3|wav|m4a|flac|ogg)$/i.test(f))
      : [];
    let timingTotal = null;
    const timing = path.join(dir, 'audio', 'timing.json');
    if (existsSync(timing)) {
      try { timingTotal = Number(JSON.parse(readFileSync(timing, 'utf8'))?.total) || null; } catch { timingTotal = null; }
    }
    return parseTaskMeta({ id: n, cfgText: cfg, sceneCount: scenes, audio, timingTotal });
  };

  if (flag('json')) {
    const tasks = names.map(metaOf);
    log(JSON.stringify({ schema: TASKS_SCHEMA, count: tasks.length, tasks }, null, 2));
    return;
  }

  log('任务列表：');
  for (const m of names.map(metaOf)) {
    const size = m.width && m.height ? ` ${m.width}×${m.height}` : '';
    const dur = m.duration != null ? ` ${m.duration.toFixed(1)}s` : '';
    const varTag = m.variants.length ? `  变体 ${m.variants.join('/')}` : '';
    log(`  ${m.id.padEnd(16)} “${m.title}”${size}${m.fps ? ' @' + m.fps : ''}${dur}  ${m.sceneCount} 个场景`
      + `${m.audio.length ? '  ♪ ' + m.audio.join(',') : ''}${m.style ? '  风格 ' + m.style : ''}${varTag}`);
  }
  log('\n（机器可读：node scripts/anim.mjs tasks --json   · schema ' + TASKS_SCHEMA + '）');
}

export { TASKS_SCHEMA, parseTaskMeta };
export { cmdTasks as run };
