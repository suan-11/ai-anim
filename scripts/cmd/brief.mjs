// @ts-check
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { flag } from "../lib/cli/args.mjs";
import { log, warn } from "../lib/cli/log.mjs";
import { ROOT, pickTask } from "../lib/cli/paths.mjs";
import { lintBrief } from "../lib/brief-lint.mjs";

/**
 * `anim brief <任务> [--json]` —— 校验结构化分镜 `tasks/<任务>/brief.mjs`。
 */
async function cmdBrief() {
  const task = pickTask();
  const asJson = flag('json');
  const briefPath = path.join(ROOT, 'tasks', task, 'brief.mjs');
  if (!existsSync(briefPath)) {
    const msg = `找不到 ${path.relative(ROOT, briefPath)} —— 请先编写结构化分镜（可用 anim new 创建模板）`;
    if (asJson) {
      log(JSON.stringify({ task, ok: false, errors: [{ code: 'BRIEF-MISSING', seg: null, msg }], warnings: [] }, null, 2));
    } else {
      warn(`✗ ${msg}`);
    }
    process.exitCode = 1;
    return;
  }

  const mod = await import(`${pathToFileURL(briefPath).href}?t=${Date.now()}`);
  const brief = mod.default ?? mod.brief ?? mod;
  const res = lintBrief(brief);
  const ok = res.errors.length === 0;

  if (asJson) {
    log(JSON.stringify({ task, ok, ...res }, null, 2));
    if (!ok) process.exitCode = 1;
    return;
  }

  log(`分镜校验：${task}`);
  log(`  · 立意：${brief?.logline ?? '—'}（${brief?.duration ?? '?'}s · 风格 ${brief?.style?.name ?? '?'}）`);
  log(`  · 世界：背景=${brief?.world?.background ?? '—'} | 摄影机=${brief?.world?.camera ?? '—'} | 母题=${brief?.world?.motif ?? '—'}`);
  log(`  · 分段：共 ${res.stats.totalSegs} 段（手写 ${res.stats.customSegs} · 模板 ${res.stats.templateSegs}，模板占比 ${(res.stats.templateRatio * 100).toFixed(0)}%）`);
  log('');
  const segs = Array.isArray(brief?.segments) ? brief.segments : [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i] ?? {};
    const b = s.build === 'custom' ? 'custom' : (s.build?.shot ? `tpl:${s.build.shot}` : '?');
    const os = Array.isArray(s.onscreen) ? s.onscreen.join(' / ') : '—';
    log(`  ${String(i + 1).padStart(2)}. [${s.role ?? '?'}] ${String(s.id ?? '?').padEnd(12)} (${b})  主角=${s.hero ?? '?'}  接力→${s.relayTo || '—'}  屏字=[${os}]`);
  }

  if (res.warnings.length) {
    log('\n提示：');
    for (const w of res.warnings) log(`  ⚠ [${w.code}]${w.seg ? ` (${w.seg})` : ''} ${w.msg}`);
  }
  if (!ok) {
    log('\n不合格项：');
    for (const e of res.errors) log(`  ✗ [${e.code}]${e.seg ? ` (${e.seg})` : ''} ${e.msg}`);
    log(`\n✗ 分镜校验未通过（${res.errors.length} 条错误）—— 请先改完再写场景代码`);
    process.exitCode = 1;
  } else {
    log('\n✓ 分镜校验全部通过 —— 可以开始手写 3 个风格帧段（hook / mechanism / close）');
  }
}

export { cmdBrief as run };
