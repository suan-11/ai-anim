// @ts-check
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { flag } from "../lib/cli/args.mjs";
import { firstLine } from "../lib/cli/gates.mjs";
import { log } from "../lib/cli/log.mjs";
import { ROOT, pickTask } from "../lib/cli/paths.mjs";
/* ------------------------------------------------------------------ 分发 */


/**
 * `anim report <任务>` —— **一屏自检**：把四条机器判据汇总成一张表。
 *
 *   node scripts/anim.mjs report <任务> [--json] [--strict]
 *
 * 为什么要它：判据各自是独立工具（卡点 / 事件密度 / 底色 / 成片一致性），
 * Agent 改完一次要跑四次、还得自己拼结论。这里一次跑完、一次给结论 ——
 * 「确定性可复现」要能被一句话验收，否则它只是文档里的承诺。
 *
 * 每条判据都只**读**已有产物（成片 mp4 / analysis.json / timing.json），不重新渲染；
 * 没有产物的项标 skipped，并在结尾说明为什么跳过。
 */
async function cmdReport() {
  const task = pickTask();
  const asJson = flag('json');
  const strict = flag('strict');
  const { spawnSync } = await import('node:child_process');
  const outDir = path.join(ROOT, 'out', task);
  const taskDir = path.join(ROOT, 'tasks', task);
  /** @type {{id:string, ok:boolean|null, summary:string, detail?:string}[]} */
  const rows = [];
  const skipped = [];

  const runTool = (tool, args) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', tool), ...args], { encoding: 'utf8', timeout: 180000 });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  // ① 成片
  // 优先 <task>.mp4（成片本体）；-web / -draft 之类的变体只在没有本体时才用
  const mp4s = existsSync(outDir)
    ? readdirSync(outDir).filter((f) => f.endsWith('.mp4') && !/^part_|_stitched|^smoke-/.test(f))
    : [];
  const mp4 = mp4s.includes(task + '.mp4') ? task + '.mp4' : (mp4s[0] ?? null);
  if (!mp4) skipped.push('成片：out/' + task + '/ 里还没有 mp4（先跑 anim video）');
  else {
    const st = statSync(path.join(outDir, mp4));
    rows.push({ id: '成片', ok: true, summary: mp4 + ' · ' + (st.size / 1048576).toFixed(1) + ' MB' });
  }

  // ② 卡点（只在**有音乐**时才判：没有音乐的片子，拍网格是从人声里估的，199 BPM 是念稿节奏）
  const hasMusic = /audio:\s*\{[^}]*music:|music:\s*'\.\//.test(existsSync(path.join(taskDir, 'task.config.mjs')) ? readFileSync(path.join(taskDir, 'task.config.mjs'), 'utf8') : '');
  if (!hasMusic) {
    skipped.push('卡点：这支没有音乐轨（拍网格只能从人声估，判据不成立）');
  } else if (!existsSync(path.join(taskDir, 'audio', 'timing.json')) && !existsSync(path.join(taskDir, 'audio', 'ja.timing.json'))) {
    skipped.push('卡点：没有 timing 表（段长不是由旁白/节拍解出来的）');
  } else {
    // 多语言任务（ja.timing.json）要把表显式传过去，否则工具会去找默认的 timing.json
    const jaTiming = path.join(taskDir, 'audio', 'ja.timing.json');
    const timingArg = existsSync(jaTiming) ? ['--timing', jaTiming] : [];
    const r = runTool('lint-beat-align.mjs', [task, '--json', ...timingArg]);
    try {
      const j = JSON.parse(r.stdout);
      const bad = (j.rows ?? []).filter((x) => !x.ok).length;
      rows.push({
        id: '卡点', ok: bad === 0,
        summary: (j.rows.length - bad) + '/' + j.rows.length + ' 切点在 ±' + j.tolMs + 'ms 内 · 实测 ' + j.bpm.toFixed(2) + ' BPM',
      });
    } catch { skipped.push('卡点：lint-beat-align 没有给出 JSON（' + firstLine(r.stderr) + '）'); }
  }

  // ③ 事件密度
  if (!mp4) skipped.push('事件密度：要先有成片（它量的是 mp4 的帧间差）');
  else {
    const r = runTool('lint-event-density.mjs', [task, '--json']);
    try {
      const j = JSON.parse(r.stdout);
      rows.push({
        id: '事件密度', ok: !(j.problems ?? []).length,
        summary: '最长静止 ' + j.staticSpan.toFixed(1) + 's · 稀薄窗口 ' + (j.thinShare * 100).toFixed(0) + '%',
        detail: (j.problems ?? []).join('；'),
      });
    } catch { skipped.push('事件密度：工具没有给出 JSON'); }
  }

  // ④ 风格 / 底色
  try {
    const { resolveStyle } = await import("../../src/style/index.js");
    const st = resolveStyle({ style: readStyleName(taskDir) });
    const bg = st?.palette?.bg ?? st?.palette?.ink ?? '(默认)';
    rows.push({ id: '风格', ok: true, summary: (st?.name ?? 'print') + ' · 底色 ' + bg + ' · 母题 ' + (st?.motif ?? 'grid') });
  } catch (err) {
    skipped.push('风格：读不出来（' + firstLine(err) + '）');
  }

  // ⑤ 成片一致性（qa 只读文件，不起浏览器）
  if (!mp4) skipped.push('一致性：要先有成片');
  else {
    const qa = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'anim.mjs'), 'qa', task], { encoding: 'utf8', timeout: 300000 });
    const txt = (qa.stdout ?? '') + (qa.stderr ?? '');
    const m = /结论：(.+)/.exec(txt);
    const line = m ? m[1].trim() : firstLine(txt);
    const ok = /0 错/.test(line) && !/⚠/.test(line);
    rows.push({ id: '一致性(qa)', ok, summary: line });
  }

  const bad = rows.filter((r) => r.ok === false);
  if (asJson) {
    console.log(JSON.stringify({ task, rows, skipped, ok: bad.length === 0 }, null, 2));
  } else {
    log('');
    log('自检报告 —— ' + task);
    for (const r of rows) {
      const mark = r.ok === false ? '✗' : '✓';
      log('  ' + mark + ' ' + r.id.padEnd(10) + r.summary);
      if (r.detail) log('    ' + r.detail);
    }
    for (const s of skipped) log('  – ' + s);
    log('');
    log(bad.length ? '✗ ' + bad.length + ' 项未通过：' + bad.map((b) => b.id).join('、') : '✓ 全部通过（' + rows.length + ' 项）');
  }
  if (strict && bad.length) process.exitCode = 1;
}

/** 读任务的 style 名（配置档里一行 `style: 'xxx'`；没有就 return 空 → 默认 print） */
function readStyleName(taskDir) {
  try {
    const src = readFileSync(path.join(taskDir, 'task.config.mjs'), 'utf8');
    const m = /style:\s*'([^']+)'/.exec(src);
    return m ? m[1] : undefined;
  } catch { return undefined; }
}
export { cmdReport as run };
