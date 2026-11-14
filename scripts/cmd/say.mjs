// @ts-check
import path from "node:path";
import { flag, opt } from "../lib/cli/args.mjs";
import { ROOT, pickTask } from "../lib/cli/paths.mjs";
/* ------------------------------------------------------------------ 口播/旁白（B/C 档） */

/**
 * `anim say` —— 把 TTS 接进来：逐句合成 → 量真实时长 → 反推每段的 `stretch`/`slot` → 写表。
 *
 * 实现整体在 `scripts/lib/say.mjs`（CLI 侧、不进浏览器）。这里只做参数搬运，
 * 因为 `scripts/lib/*` 里的东西要被 `tools/test-say.mjs` 直接 import（不需要经过 CLI）。
 *
 * ⚠ 这条路**不渲染画面**：它只产出"每段多长、旁白摆在哪"，所以换音色/改旁白
 * 都不需要动场景代码（`docs/NARRATION.md` §5.4）。
 */
async function cmdSay() {
  const task = pickTask();
  const { runSay } = await import("../lib/say.mjs");
  const r = await runSay(task, {
    taskDir: path.join(ROOT, 'tasks', task),
    script: opt('script'),
    voice: opt('voice'),
    rate: opt('rate'),
    bpm: opt('bpm') ? Number(opt('bpm')) : undefined,
    tail: opt('tail') ? Number(opt('tail')) : undefined,
    maxStretch: opt('max-stretch') ? Number(opt('max-stretch')) : undefined,
    tts: opt('tts'),
    force: flag('force'),
    dryRun: flag('dry-run'),
    noVo: flag('no-vo'),
    // BACKLOG 1-23：拿上一版 audio/timing.json 当钉子 —— 时间线不动，改一句词不重排全片
    pinTiming: flag('pin-timing'),
    // 表写到另一份（不动默认那份）：多语言 / 剪短版 / 手写表回放
    table: opt('table'),
    pinTable: opt('pin-table'),
  });
  return r;
}
export { cmdSay as run };
