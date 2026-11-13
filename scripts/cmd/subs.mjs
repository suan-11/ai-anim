// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { opt } from "../lib/cli/args.mjs";
import { die, log, warn } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
/** 秒 → `HH:MM:SS,mmm`（SRT） */
function srtTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * 秒 → `H:MM:SS.cc`（ASS，百分秒）。**时间向上取整**，字幕宁可晚 10ms 也不早显一帧。
 *
 * ⚠ 旧实现是 `Math.round(小数部分 × 100)`：`1.999` 会被舍成 `cs = 100`，输出
 * `0:00:01.100`（ASS 的百分秒字段只有两位）—— 一个**不报错但时间轴错位**的坏值。
 * 现在先化成整数百分秒再拆分，`cs % 100` 天然落在 0..99。
 */
function assTime(sec) {
  const cs = Math.max(0, Math.ceil(Number(sec) * 100 - 1e-7));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, ss = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/**
 * ASS 的 `Dialogue:` 文本转义。**不做就会静默坏掉**，而且导出时看不出任何异常。
 *
 * ASS 不是纯文本格式：`\N` 是硬换行、`{...}` 是覆盖块（样式指令）。旁白里一句
 * `C:\new\table` 会被渲成两行，`{...}` 会整段消失 —— 平台上传的软字幕于是和画面里的
 * 字幕不是一回事（而这条命令存在的唯一理由就是"和画面一致"）。
 *
 * 三种写法：
 *   · **反斜杠**：ASS 没有通用转义（`\\` 不可靠），在 `\` 后面插 **U+2060 词连接符**，
 *     让 `\N` / `\n` / `\h` 不再是两字符序列 —— 渲染时零宽、不可见。上游 EAC design world
 *     的 `literalText()` 用的是同一手法（`src/media/captions.mjs:78-84`，那个仓库是 AGPL：
 *     这里只借"插零宽连接符"这条**知识**，实现与命名都是我们自己的）；
 *   · **花括号**：`\{` / `\}` 是 libass 认的字面量转义；
 *   · **换行**：文本里本来就该是一行（`wrapCaption` 已经切好），残留的 `\n` 统一成 `\N`。
 */
function assText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0085\u2028\u2029]/gu, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, '')
    .replace(/\\/g, '\\\u2060')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\\N');
}

/**
 * 字幕断行：每行最多 `per` 个字（**Netflix 简体中文规范是 16 字/行、最多 2 行**），
 * 先按标点贪心装；超过两行时在中点附近找标点切一刀，绝不把收尾标点留在行首。
 */
function wrapCaption(text, per = 16) {
  const s = String(text);
  if (s.length <= per) return [s];
  const parts = s.match(/[^，。、；：！？]{1,}[，。、；：！？]?/g) ?? [s];
  const rows = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + p).length > per) { rows.push(cur); cur = ''; }
    cur += p;
  }
  if (cur) rows.push(cur);
  if (rows.length <= 2) return rows;
  const mid = Math.ceil(s.length / 2);
  let cut = -1;
  for (let i = mid; i >= Math.max(1, mid - 10); i--) if ('，。、；：！？'.includes(s[i - 1])) { cut = i; break; }
  if (cut < 0) for (let i = mid; i < Math.min(s.length, mid + 10); i++) if ('，。、；：！？'.includes(s[i - 1])) { cut = i; break; }
  if (cut <= 0 || cut >= s.length) cut = mid;
  return [s.slice(0, cut), s.slice(cut)];
}

/**
 * `anim subs <任务>` —— 从旁白表导出 `.srt` / `.ass`（**给视频平台上传用**）。
 *
 * 为什么要有它：以前这一步是 `out/_staging/make-srt.mjs` —— 一个活在**渲染产物目录**里的
 * 手抄脚本（`out/` 会被 `anim clean` 清掉、不在版本管理视野内、没有任何回归），
 * 换一支片子就要再抄一份（optifine 与 sodium 各有一份，几乎逐字相同）。
 * 现在它是 CLI 的一条命令，断行按 Netflix 简体中文规范（16 字/行、最多 2 行）。
 *
 * ⚠ 别和引擎内字幕叠着用：`task.captions: true` 时字幕**已经烧进画面**了，
 *   再拿这份 `.ass` 过一遍 ffmpeg 就是两层字幕（观众反馈里"两条字幕"的一种）。
 */
async function cmdSubs() {
  const task = pickTask();
  const narPath = path.join(ROOT, 'tasks', task, 'audio', 'narration.json');
  /** @type {any} */
  let data = null;
  /** task.config.mjs 导入失败的原因（有的话；别静默吞掉 —— 见下面的注释） */
  let inlineErr = null;
  if (existsSync(narPath)) {
    try { data = JSON.parse(readFileSync(narPath, 'utf8')); } catch (e) {
      die(`${path.relative(ROOT, narPath)} 读不动：${e.message}`);
    }
  } else {
    // 内联写法：task.config.mjs 里直接写 narration: { lines: [...] }
    //
    // ⚠ 这里的 catch **不能**静默（本命令第一版就栽在这上面）：`pathToFileURL` 忘了 import
    //   时抛的是 ReferenceError，被吞掉之后报出来的是"这个任务没有旁白表"——
    //   方向完全错（任务明明有）。所以把原因留下来，报错时一起打。
    try {
      const cfg = path.join(ROOT, 'tasks', task, 'task.config.mjs');
      const mod = await import(pathToFileURL(cfg).href);
      const spec = mod.default ?? mod;
      if (spec?.narration && typeof spec.narration === 'object') data = spec.narration;
    } catch (err) {
      inlineErr = String(err && err.message ? err.message : err).split('\n')[0];
    }
  }
  const lines = (data?.lines ?? []).filter((l) => Number.isFinite(Number(l.start)) && Number(l.dur) > 0);
  if (!lines.length) {
    die(
      `tasks/${task} 没有可用的旁白表（看 ${path.relative(ROOT, narPath)}，或 task.config.mjs 里的 narration）。\n` +
      (inlineErr ? `  ⚠ task.config.mjs 导入失败：${inlineErr}\n` : '') +
      `  有旁白的任务先用 anim say 生成：node scripts/anim.mjs say ${task}`,
    );
  }

  const outDir = path.resolve(ROOT, opt('out', opt('o', taskOut(task))));
  mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `${opt('name', task)}`);
  const per = Math.max(8, Number(opt('per', '16')) || 16);

  let srt = '';
  let ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Alignment=2 = 底部居中；MarginV=64 是离底边的距离；白字 + 深色描边（平台上传的通用观感）
    'Style: Main,Microsoft YaHei,46,&H00FFFFFF,&H000000FF,&H00141414,&HA0000000,0,0,0,0,100,100,1,0,1,3,1,2,80,80,64,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  let n = 0;
  let tooLong = 0;
  for (const l of lines) {
    const a = Number(l.start);
    // 说完之后再多留一点：规范建议对白结束后 +0.5s，读起来不赶
    const b = a + Number(l.dur) + 0.5;
    const rows = wrapCaption(String(l.text ?? ''), per);
    if ([...String(l.text ?? '')].length / Math.max(0.1, Number(l.dur)) > 9) tooLong++;
    n++;
    srt += `${n}\n${srtTime(a)} --> ${srtTime(b)}\n${rows.join('\n')}\n\n`;
    // ⚠ 逐行转义再拼 `\N`：直接把原文拼进去，含 `\` / `{}` 的那一行会被 ASS 解释成
    //   换行或覆盖块（见 assText 的注释）。`\N` 只能出现在我们自己的行间。
    ass += `\nDialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,${rows.map(assText).join('\\N')}`;
  }
  ass += '\n';
  writeFileSync(`${base}.srt`, srt, 'utf8');
  writeFileSync(`${base}.ass`, ass, 'utf8');
  log(`✓ ${path.relative(ROOT, `${base}.srt`)}  ${n} 条（每行 ≤${per} 字、最多 2 行）`);
  log(`✓ ${path.relative(ROOT, `${base}.ass`)}  ${n} 条（底部居中，MarginV=64）`);
  if (tooLong) {
    warn(`⚠ 有 ${tooLong} 句的语速超过 9 字/秒（Netflix 简体中文的成人上限，建议按 8–9 校核）—— 观众读不完。`);
  }
  log('');
  log('这份文件是给**视频平台上传**用的（软字幕）。');
  log('⚠ 如果这支片子在 task.config.mjs 里开了 captions: true，字幕**已经烧进画面**了 ——');
  log('  不要再把这份 .ass 过一遍 ffmpeg，否则就是两层字幕（docs/CAPTIONS.md）。');
}

export { assText, assTime };
export { cmdSubs as run };
