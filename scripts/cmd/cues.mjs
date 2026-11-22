// @ts-check
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build, isConfigNode } from "../../src/timeline.js";
import { flag, opt, rest } from "../lib/cli/args.mjs";
import { log, warn } from "../lib/cli/log.mjs";
import { ROOT, pickTask } from "../lib/cli/paths.mjs";
import { buildCuesData, formatCuesText } from "../lib/cues.mjs";

function parseListFlag(name) {
  const eq = rest.find((a) => a.startsWith(`--${name}=`));
  const raw = eq ? eq.slice(name.length + 3) : opt(name, '');
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * `anim cues <任务> [--scene a,b] [--all-words] [--json]`
 * 从 `audio/timing.{mjs,json}` 或 `audio/narration.json` 输出精简词点与切点速查表，
 * 全部时刻已换算为段内 `f.lt`，避免创作场景时通篇翻读 25–30 KB 的 `timing.mjs`。
 */
async function cmdCues() {
  const task = pickTask();
  const dir = path.join(ROOT, 'tasks', task);
  const asJson = flag('json');
  const allWords = flag('all-words');
  const sceneFilter = parseListFlag('scene');
  if (!sceneFilter.length) sceneFilter.push(...parseListFlag('only'));

  let timing = null;
  let narration = null;
  let timeline = null;

  const timingMjs = path.join(dir, 'audio', 'timing.mjs');
  const timingJson = path.join(dir, 'audio', 'timing.json');
  if (existsSync(timingMjs)) {
    const mod = await import(`${pathToFileURL(timingMjs).href}?t=${Date.now()}`);
    timing = mod.default ?? mod;
  } else if (existsSync(timingJson)) {
    timing = JSON.parse(readFileSync(timingJson, 'utf8'));
  }

  if (!timing) {
    let narPath = path.join(dir, 'audio', 'narration.json');
    const cfgPath = path.join(dir, 'task.config.mjs');
    let cfgSpec = null;
    if (existsSync(cfgPath)) {
      try {
        const mod = await import(`${pathToFileURL(cfgPath).href}?t=${Date.now()}`);
        cfgSpec = mod.default ?? mod;
      } catch { /* ignore config import failure; narration.json still works */ }
    }
    if (!existsSync(narPath) && typeof cfgSpec?.narration === 'string') {
      narPath = path.resolve(dir, cfgSpec.narration);
    }
    if (existsSync(narPath)) {
      narration = JSON.parse(readFileSync(narPath, 'utf8'));
    } else if (cfgSpec?.narration && typeof cfgSpec.narration === 'object') {
      narration = cfgSpec.narration;
    }

    if (cfgSpec?.timeline) {
      try {
        const raw = cfgSpec.timeline;
        timeline = (!Array.isArray(raw) || raw.some(isConfigNode))
          ? build(raw, narration ? { narration } : {})
          : raw;
      } catch {
        timeline = null;
      }
    }
  }

  if (!timing && !narration) {
    warn(`任务 "${task}" 没有 audio/timing.{mjs,json} 或 audio/narration.json —— 请先跑 anim say ${task} 生成配音时间表`);
    process.exitCode = 1;
    return;
  }

  const data = buildCuesData({ timing, narration, timeline, task }, { allWords });
  if (sceneFilter.length) {
    const valid = new Set(data.scenes.map((s) => s.id));
    const missing = sceneFilter.filter((id) => !valid.has(id));
    if (missing.length) {
      warn(`--scene 里这些段不存在：${missing.join(', ')}。可用段名：${[...valid].join(', ') || '(空)'}`);
      process.exitCode = 1;
      return;
    }
  }

  if (asJson) {
    const out = sceneFilter.length
      ? { ...data, scenes: data.scenes.filter((s) => sceneFilter.includes(s.id)) }
      : data;
    log(JSON.stringify(out, null, 2));
    return;
  }

  log(formatCuesText(data, { sceneFilter }));
}

export { cmdCues as run };
