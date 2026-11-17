// @ts-check
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { flag, opt } from "../lib/cli/args.mjs";
import { log, warn, die } from "../lib/cli/log.mjs";
import { ROOT, pickTask } from "../lib/cli/paths.mjs";
import { build } from "../../src/timeline.js";
import { fingerprint, convergence, FINGERPRINT_DIMS } from "../lib/structure-fingerprint.mjs";
/* 命令：variety —— 结构反收敛（BACKLOG 1-81）。量结构指纹，跟 out/_history/ 最近几支比是否撞结构。 */

async function cmdVariety() {
  const task = pickTask();
  const cfgPath = path.join(ROOT, "tasks", task, "task.config.mjs");
  if (!existsSync(cfgPath)) die(`没有任务 ${task}（tasks/${task}/task.config.mjs 不存在）`);
  const mod = await import(new URL("../../tasks/" + task + "/task.config.mjs", import.meta.url).href);
  const cfg = mod.default ?? mod.config;
  const segs = build(cfg.timeline, { bpm: 120, duration: cfg.duration ?? 0 });
  const fp = fingerprint(segs);
  const histDir = path.join(ROOT, "out", "_history");
  const history = [];
  if (existsSync(histDir)) {
    for (const f of readdirSync(histDir).filter((x) => x.endsWith(".json"))) {
      try { const j = JSON.parse(readFileSync(path.join(histDir, f), "utf8")); if (j.name !== task && j.fingerprint) history.push(j); } catch { /* 坏文件跳过 */ }
    }
  }
  history.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  const recent = history.slice(0, Math.max(1, Number(opt("last", "3"))));
  const verdict = convergence(fp, recent);

  log(`结构指纹 ${task}：${fp.segCount} 段 / ${fp.totalDur.toFixed(1)}s / 段长CoV ${fp.durCov.toFixed(2)} / 段长离散 ${fp.durSpread.toFixed(2)}`);
  log(`  转场分布：${Object.entries(fp.transDist).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(" / ") || "（无）"}`);
  if (!verdict.applicable) {
    log("  ○ " + verdict.reason);
  } else if (!recent.length) {
    log("  历史：out/_history/ 还没有别的片子 —— 用 --save 存一支当参照");
  } else if (verdict.converged) {
    for (const m of verdict.matches) warn(`  ⚠ 结构收敛：跟 ${m.name} 有 ${m.similarDims}/${FINGERPRINT_DIMS.length} 维同构（${m.dims.join("/")}）—— 换个结构，别只换配色`);
  } else {
    log(`  ✓ 跟最近 ${recent.length} 支结构不同构（同构维数 < ${verdict.minDims}）`);
  }
  if (flag("save")) {
    mkdirSync(histDir, { recursive: true });
    writeFileSync(path.join(histDir, task + ".json"), JSON.stringify({ name: task, fingerprint: fp, savedAt: Date.now() }, null, 2));
    log(`  已存 out/_history/${task}.json`);
  }
  if (flag("json")) console.log(JSON.stringify({ task, fingerprint: fp, verdict }, null, 2));
  if (verdict.converged && flag("strict")) process.exitCode = 1;
}
export { cmdVariety as run };
