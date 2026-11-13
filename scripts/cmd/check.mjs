// @ts-check
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { flag, opt } from "../lib/cli/args.mjs";
import { resolveAudioTracks } from "../lib/cli/audio.mjs";
import { checkVerdictLine, collectRenderErrors, firstLine, focusReading, formatSkipped, pushSkipped, reportErrors } from "../lib/cli/gates.mjs";
import { log, warn } from "../lib/cli/log.mjs";
import { checkFfmpeg } from "../lib/cli/media.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, evaluateSafe, getSession, openSession } from "../lib/cli/session.mjs";
import { writeContactSheet } from "../lib/cli/sheet.mjs";
import { blankJsComments as sharedBlankJsComments } from "../lib/js-source.mjs";
import { describeNarrationError, narrationConfigProblem } from "../lib/narration-error.mjs";
import { layoutReport, layoutSummary } from "../../src/layout.js";
import { build } from "../../src/timeline.js";
import { decodeDiffSeries, motionStats } from "../../tools/lib/diff-series.mjs";
/* ---------------- 镜头模板的依赖前置校验（BACKLOG 1-21 / docs/ENGINE.md §14.9）：纯函数区 */

/**
 * 把 JS 源码里的**注释换成空格**（长度与换行原样保留 ⇒ 行号不变），**字符串字面量原样留着**。
 *
 * 为什么需要它：依赖扫描要认的是 `shot('wave', …)` / `{ type: 'wave', … }` 里的那个**字符串**，
 * 所以不能像 `tools/test-shots.mjs` 的 `maskNonCode()` 那样把字符串一起抹掉；但注释里的举例
 * 绝不能被当成"真的用了这个模板"（`tasks/_config-lab/task.config.mjs` 的文件头就写着
 * `{ type: 'chart', …, post }`，`tasks/beat/task.config.mjs` 的注释里也提到过模板名）。
 *
 * 模板字符串（GLSL）按普通字符串处理：里面的 `//` 是 shader 注释，不是 JS 注释。
 */
function blankJsComments(src) {
  return sharedBlankJsComments(src);
}

/**
 * 纯函数：从任务源码文本里找出**用了哪些镜头模板**（`docs/ENGINE.md` §3.2 / §14.8 的两种写法）。
 *
 *   · 手写场景：`export default shot('chart', { … })`      → 认 `shot('名字'`
 *   · 配置档：  `{ type: 'chart', values: […] }`            → 认 `type: '名字'`
 *
 * 只认**已知模板名**：拼错的模板名由 `timeline.js` / `shot()` 抛错（带任务名与可用清单），
 * 这里再报一遍只会让读的人不知道该信哪条。
 *
 * ⚠ 它是**静态**的：不加载模块、不建 GL、不起浏览器，所以只能看字面量写法
 * （`const n = 'wave'; shot(n)` 这种扫不到 —— 代价是"少报一次"，不是"报错"）。
 *
 * @param {{ file: string, text: string }[]} files
 * @param {Iterable<string>} known 已知模板名（`SHOTS` 的键）
 * @returns {{ shot: string, file: string, line: number }[]}
 */
function scanShotUsage(files, known) {
  const names = new Set(known ?? []);
  const found = [];
  for (const f of Array.isArray(files) ? files : []) {
    const code = blankJsComments(f?.text ?? '');
    const lines = code.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      // ⚠ 两个分支都要吃掉分隔符：`{ type: '…'` 与行首的 `type: '…'`
      for (const m of lines[i].matchAll(/(?:\bshot\s*\(\s*|(?:^|[,{[\s])type\s*:\s*)['"]([\w-]+)['"]/g)) {
        if (!names.has(m[1])) continue;
        found.push({ shot: m[1], file: String(f?.file ?? ''), line: i + 1 });
      }
    }
  }
  return found;
}

/**
 * 纯函数：把「模板声明的 `spec.requires`」+「任务的事实」变成问题清单。
 *
 * **两档严重性是刻意分开的**（BACKLOG 1-21 的验收口径就在这一条上）：
 *
 *   · `missing-audio` → **error**（进 `errs` ⇒ 退出码 1）。
 *     依据：`src/app.js:150` 只在 `task.config.mjs` **有 `audio` 字段**时才 `MusicData.load(...)`，
 *     否则 `Engine` 拿到的是 `SILENT`（`src/core/audio.js:181`）。`wave`/`pulse`/`grid` 读的是
 *     包络数组与打击事件表 —— 空音乐的包络**恒为 0**、事件表**恒为空**：不抛错、只是画不出东西。
 *     这不是"提示"，是"这一段不可能对"，所以它该红。
 *     ⚠ 但**只有真的没配 `audio`** 才红 —— 别让"某个模板声明了 requires"把用它的任务一律染红。
 *
 *   · `missing-analysis` → **hint**（进 `skipped`，默认不改退出码）。
 *     依据：配了 `audio` 只是"还没跑那一步"——`video` 出片前会自动补一次分析
 *     （`cmdVideo` 里那句 `await analyzeTaskAudio(task)`），浏览器里也有"现算"的退路
 *     （`src/core/audio.js:69-88`）。所以它属于「没跑 ≠ 通过」，不属于「坏了」。
 *
 * 同一件事只报一次（按 `令牌:模板名` 去重）：根因是任务级的，模板出现在 3 段里也只是一件事。
 *
 * @param {{ shot: string, file: string, line: number }[]} usage `scanShotUsage()` 的结果
 * @param {(name: string) => any} specOf 模板名 → `spec`（没有 spec 的给 undefined ⇒ 不参与校验）
 * @param {{ audioDeclared?: boolean, audioPath?: string|null, audioSource?: string|null,
 *           analysisFile?: string|null, analysisExpected?: string|null }} facts
 * @returns {{ level: 'error'|'hint', kind: string, shot: string, where: string,
 *             message: string, fix: string }[]}
 */
function shotDependencyIssues(usage, specOf, facts) {
  const f = facts ?? {};
  const out = [];
  const seen = new Set();
  for (const u of Array.isArray(usage) ? usage : []) {
    const spec = typeof specOf === 'function' ? (specOf(u.shot) ?? {}) : {};
    const req = Array.isArray(spec.requires) ? spec.requires : [];
    if (!req.length) continue;
    const where = `${u.file}:${u.line}`;

    if (req.includes('music') && !f.audioDeclared) {
      if (seen.has(`music:${u.shot}`)) continue;
      seen.add(`music:${u.shot}`);
      out.push({
        level: 'error',
        kind: 'missing-audio',
        shot: u.shot,
        where,
        message: `模板 "${u.shot}" 读 ctx.music（音频包络 + 真实打击事件），但这支任务**没有配 audio**`
          + (f.audioSource
            ? ` —— ${f.audioSource} 这个音频文件在任务目录里，可 task.config.mjs 里没有 audio: 字段，`
              + '而页面正是按那个字段决定要不要加载音乐的'
            : '')
          + '；引擎给场景的是 SILENT（空音乐），这一段的画面只能是黑的',
        fix: "tasks/<任务>/task.config.mjs 里加一行 audio: './audio/xxx.mp3'，"
          + '然后 node scripts/anim.mjs analyze <任务>（出片前 CLI 也会自动补一次分析）',
      });
      // 根因已经报了：别再报它的派生项（"还没跑 analyze"是同一件事的下游）
      continue;
    }

    if (req.includes('analyze') && !f.analysisFile) {
      if (seen.has(`analyze:${u.shot}`)) continue;
      seen.add(`analyze:${u.shot}`);
      out.push({
        level: 'hint',
        kind: 'missing-analysis',
        shot: u.shot,
        where,
        message: `模板 "${u.shot}" 读音频包络，但还没有**预计算**的音频分析数据（${f.analysisExpected ?? 'audio/<文件>.analysis.json'}）`
          + ' —— 引擎会退到在浏览器里现算一份（`src/core/audio.js` 的第 2 条路：能用，但慢，'
          + '而且和成片用的不是同一份数据）；`video` 出片前 CLI 会自动补上正式的那一份',
        fix: 'node scripts/anim.mjs analyze <任务>（几秒钟，跑一次就够）',
      });
    }
  }
  return out;
}

/** `check` 的 skipped 段里，这一项的 what（同一个 what 会被 formatSkipped 聚合成一行）。 */
const SHOT_DEP_WHAT = '镜头模板依赖（spec.requires）';

/**
 * **在"开浏览器之前"这一步就查得了**的依赖令牌（靠任务源码文本 + 任务事实）。
 *
 * 词表（`src/shots/index.js` 的 `SHOT_REQUIRES`）里其余的令牌属于**时间线层**：
 * 它们的真假只有在 `build()` 排完时间之后才成立，文本扫描判不准（假报比不报贵）。
 *   · `'under'`（2026-10-16 起）—— 由**段级审计**查：`src/timeline.js` 的
 *     `auditUnderRequires()` → 页面侧 `__anim.underAudit()` → `cmdCheck` 打印并 gate
 *     （没有交叠 ⇒ errs；第 1 段 / `--only` 之后没得比 ⇒ 进 skipped）。
 *     所以这里那句"还没接线"必须改成"不在这一步查"，否则报告会把**已经验过**的说成没验。
 *
 * 为什么不把"这一步查不了的令牌"塞进 `skipped`：那是**引擎自己的**分工（对每个用 `whip`
 * 的任务都一样、任务作者也改不了），塞进去会让 `--strict` 永远红、还会把真正的"这次没跑"淹掉。
 * 它该说的是"**换到下面那一段去查**"，而不是"没验"。
 */
const SHOT_DEP_GATED = ['music', 'analyze'];

/**
 * 纯函数：把依赖校验渲染成 `check` 要打印的那些行 + 要进 `errs` 的串 + 要进 `skipped` 的条目。
 *
 * 三种结局都要**说话**（"空 ≠ 干净"，`docs/BACKLOG.md` 1-19）：
 *   · 任务根本没用到模板 → 明说"这一项没有可查的对象"，而不是安静地什么都不打；
 *   · 用到且都满足      → 打出"谁需要什么、在哪用到、事实是什么"；
 *   · 有没满足的        → 逐条点名 `文件:行号` + 给下一步命令。
 *
 * @param {{ scanned?: number, usage?: any[], issues?: any[], facts?: any, only?: string|null }} o
 * @returns {{ lines: { sev: 'log'|'warn', text: string }[], errors: string[],
 *             skipped: { what: string, why: string }[] }}
 */
function shotDependencyReport(o = {}) {
  const scanned = Number(o.scanned ?? 0);
  const usage = Array.isArray(o.usage) ? o.usage : [];
  const issues = Array.isArray(o.issues) ? o.issues : [];
  const facts = o.facts ?? {};
  const names = [...new Set(usage.map((u) => u.shot))];
  /** @type {{ sev: 'log'|'warn', text: string }[]} */
  const lines = [];
  const errors = [];
  const skipped = [];

  if (!names.length) {
    lines.push({
      sev: 'log',
      text: `镜头模板依赖：这支任务没有用到 src/shots/ 的模板（静态扫了 ${scanned} 个文件；`
        + "只认 shot('名字') 与 { type: '名字' } 两种字面量写法）—— 这一项**没有可查的对象**，"
        + '不是"依赖都对"',
    });
    return { lines, errors, skipped };
  }

  lines.push({
    sev: 'log',
    text: `镜头模板依赖：扫了 ${scanned} 个文件，用到 ${names.length} 个模板（${names.join(' / ')}）`,
  });
  for (const u of usage) {
    const req = Array.isArray(u.requires) ? u.requires : [];
    if (!req.length) continue;
    lines.push({
      sev: 'log',
      text: `  ${String(u.shot).padEnd(8)} 需要 ${req.join(' + ')}    ${u.file}:${u.line}`,
    });
  }
  const free = names.filter((n) => !usage.some((u) => u.shot === n && (u.requires ?? []).length));
  if (free.length) lines.push({ sev: 'log', text: `  ${free.join(' / ')}：没有声明任何依赖（requires: []）` });

  // 声明了、但这一次**查不了**的令牌：必须说出来（否则"✓ 都满足"就成了假话）
  const declared = [...new Set(usage.flatMap((u) => (Array.isArray(u.requires) ? u.requires : [])))];
  const ungated = declared.filter((t) => !SHOT_DEP_GATED.includes(t));

  if (!issues.length) {
    const have = [];
    if (facts.audioPath) have.push(`music = ${facts.audioPath}`);
    if (facts.analysisFile) have.push(`analyze = ${facts.analysisFile}`);
    lines.push({
      sev: 'log',
      text: `  ✓ ${ungated.length ? '能查的那几条依赖' : '声明的依赖'}都满足${have.length ? `（${have.join(' · ')}）` : ''}`,
    });
  } else {
    const nErr = issues.filter((i) => i.level === 'error').length;
    lines.push({
      sev: 'warn',
      text: `⚠ 镜头模板声明的依赖有 ${issues.length} 项没满足`
        + `（${nErr} 项是**画面不可能是对的**硬问题，${issues.length - nErr} 项是"这一步还没跑"）：`,
    });
    for (const it of issues) {
      const mark = it.level === 'error' ? '✗' : '⚠';
      lines.push({ sev: 'warn', text: `  ${mark} [${it.where}] ${it.message}` });
      lines.push({ sev: 'warn', text: `  → ${it.fix}` });
      if (it.level === 'error') errors.push(`[镜头模板依赖] ${it.shot}（${it.where}）：${it.message}`);
      else skipped.push({ what: SHOT_DEP_WHAT, why: `${it.shot}（${it.where}）：${it.message}` });
    }
  }

  if (ungated.length) {
    // `under` 已经接线了，只是**不在这两步里**：它在时间线展开之后由段级审计判
    // （见 `cmdCheck` 的「依赖 under」那一段）。说成"还没接线"会把验过的说成没验。
    const late = ungated.filter((t) => t === 'under');
    const never = ungated.filter((t) => t !== 'under');
    if (late.length) {
      lines.push({
        sev: 'log',
        text: `  · ${late.map((t) => `'${t}'`).join(' / ')} 是**时间线层**的依赖（交叠够不够），这一步判不准 —— `
          + '它在时间线展开之后由段级审计查，见下面「依赖 under」那一段；'
          + '那一段没出现就是**没验**，别当成满足（docs/ENGINE.md §14.9 读法 3）',
      });
    }
    if (never.length) {
      lines.push({
        sev: 'log',
        text: `  ⚠ ${never.map((t) => `'${t}'`).join(' / ')} 这一条**还没接线**：这次没有验它`
          + '（交叠是时间线层的声明，静态扫描判不准 —— 假报比不报更贵，见 docs/ENGINE.md §14.9 读法 3）',
      });
    }
  }
  if (o.only) {
    lines.push({
      sev: 'log',
      text: `  （--only ${o.only} 只挑了几段试渲染；这一项是**整个任务**范围的静态扫描）`,
    });
  }
  lines.push({
    sev: 'log',
    text: '  （依赖来自模板自己的 spec.requires —— 看某个模板：node scripts/anim.mjs shots <名字> --json；'
      + '契约：docs/ENGINE.md §14.9）',
  });
  return { lines, errors, skipped };
}

/**
 * 读任务里可能"取镜头模板"的源码文本（`task.config.mjs` + `scenes/**.js`）。
 * 只读文件、不加载模块（任务配置是 Vite 模块，CLI 侧 import 不了 —— 与 `resolveAudioTracks()` 同理）。
 *
 * @param {string} task
 * @returns {{ file: string, text: string }[]}
 */
function taskShotSources(task) {
  const out = [];
  const add = (file) => {
    try {
      out.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), text: readFileSync(file, 'utf8') });
    } catch { /* 读不到就不算扫过（调用方会打印扫了几个文件） */ }
  };
  add(path.join(ROOT, 'tasks', task, 'task.config.mjs'));
  const walk = (dir) => {
    let ents = [];
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of [...ents].sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.js')) add(p);
    }
  };
  walk(path.join(ROOT, 'tasks', task, 'scenes'));
  return out;
}

/**
 * 纯函数：任务配置文本里**有没有 `audio` 字段** —— 这就是"页面会不会加载音乐"的开关
 * （`src/app.js:150`：`if (preTask.audio) music = await MusicData.load(...)`；否则一直是 `SILENT`）。
 *
 * ⚠ 这是**文本**判据（CLI 侧 import 不了任务配置，见 `resolveAudioTracks()` 的同款注释），
 * 所以刻意放宽到"三面都认"：对象字面量里的 `audio:`（行首或 `,{` 之后都算）、
 * 以及 `const audio = …` 这种先在变量里写、再 shorthand 进对象的写法。
 * 宁可**漏报**（少报一条真问题）也不能误报 —— 误报会把一个本来正常的任务变成非零退出。
 * 注释先被抹掉（`blankJsComments`），所以"注释里写着 audio: …"不算。
 *
 * @param {string} text task.config.mjs 的源码文本
 */
function audioDeclaredInConfig(text) {
  const code = blankJsComments(text);
  return /(^|[,{[\s])audio\s*:/.test(code)
    || /(^|\n)[^\S\n]*(?:const|let|var)\s+audio\s*=/.test(code);
}

/**
 * 收集依赖校验的事实（**这一层做 IO，判据在 `shotDependencyIssues()` 里**）。
 *
 * `audioDeclared` 只看 `task.config.mjs` 里**有没有 `audio` 字段**（`audioDeclaredInConfig()`），
 * 而不是 `resolveAudioTracks()` 那条"扫 `audio/` 目录"的兜底 —— 后者只影响 CLI 侧的分析与封装，
 * **不会**让页面加载音乐。两者的差别正是"任务在 audio/ 里放了 mp3、却忘了写 audio: 字段"
 * 这种静默失败能被点名的地方。
 *
 * @param {string} task
 */
function shotDependencyFacts(task) {
  const dir = path.join(ROOT, 'tasks', task);
  let cfg = '';
  try { cfg = readFileSync(path.join(dir, 'task.config.mjs'), 'utf8'); } catch { /* 读不到＝没配 */ }
  const code = blankJsComments(cfg);
  const audioDeclared = audioDeclaredInConfig(cfg);
  const lit = /(^|[,{[\s])audio\s*:\s*(\{[^}]*\}|'[^']*'|"[^"]*")/.exec(code);
  const declaredValue = lit ? lit[2].replace(/^['"]|['"]$/g, '') : null;

  const tracks = resolveAudioTracks(task);
  const rel = (p) => (p ? path.relative(ROOT, p).replace(/\\/g, '/') : null);
  const audioSource = tracks.analysisSource ? rel(tracks.analysisSource) : null;
  const base = tracks.analysisSource ? tracks.analysisSource.replace(/\.[^.]+$/, '') : null;
  const analysisExpected = base
    ? rel(path.join(ROOT, 'tasks', task, 'audio', `${path.basename(base)}.analysis.json`))
    : null;
  const analysisFile = analysisExpected && existsSync(path.join(ROOT, analysisExpected))
    ? analysisExpected
    : null;
  // 展示用的 music 路径：页面上真正加载的是 `audio:` 字段指的那个文件
  const audioPath = audioDeclared && declaredValue
    ? `tasks/${task}/${declaredValue.replace(/^\.\//, '')}`
    : audioSource;

  return { audioDeclared, declaredValue, audioSource, analysisExpected, analysisFile, audioPath };
}

/* ------------------------------------------------------------------ 命令：check */

/**
 * 体检：静态检查 + 逐段试渲染 + 亮度统计 + 背景守门。
 *
 * **每段采三个点（15% / 50% / 85%）**，不是只采中点：入场头 1 秒恰恰是最容易出问题的地方
 * （文字没出来、位移方向不对、元素互相压字），而以前只看中点，那一段完全没被采到
 * （docs/history/IMPROVEMENTS-1-3.md P2-1）。
 *
 * 每个点渲两次：单子帧与多子帧（成片走的路径）。两条路径的亮度必须一致 ——
 * 运动模糊求平均出过错，而那个 bug 只存在于多子帧那条路。
 */
async function cmdCheck() {
  const task = pickTask();
  log(`检查任务 ${task} …`);

  /**
   * 「空 ≠ 干净」（`docs/BACKLOG.md` 1-19）：任何**没跑成 / 被跳过 / 不可用**的审计都进这里，
   * 末尾统一打一段 `skipped:`。以前它们只是"少打一行"，读输出的 agent 会把
   * 「没报错」当成「通过」——三个外部参考项目独立指向的正是这个失败模式。
   *
   * ⚠ 这个列表**不参与退出码**（`tools/regress-all.mjs` 有 10 个 `check:*` 项依赖
   *   `check` 的退出码语义）；要 gate 就显式加 `--strict`。
   */
  const skipped = [];
  const strict = flag('strict');

  // 1) 静态：非确定性写法（这是整个引擎的地基，必须拦）
  const statics = scanScenes(task);
  for (const s of statics) warn(`⚠ ${s}`);


  /**
   * 静态检查阶段（开浏览器**之前**）攒下的错误 —— `errs` 要等 `openSession` 之后才构造
   * （它读的是页面回传的 `info`），所以这一段先攒在这儿，下面 `const errs = [...staticErrs, ...]`。
   * ⚠ 2026-10-16：复述率那一档最早直接写 `errs.push(...)`，而 `errs` 在它下几十行 ——
   *   `--strict` 一跑就 `ReferenceError: errs is not defined`，还被 catch 吞成一句
   *   "旁白复述检查没跑成"（假 skipped）。**先攒后并**，别在 try 里引用后面的 const。
   */
  const staticErrs = [];
  // 1.05) 静态：旁白表（narration）配了但加载不了 —— A-2。以前只在页面侧 console.warn 一句
  //（src/app.js 的 catch），滚进日志就没了：成片照常渲、check 照样绿，作者根本不知道
  // ctx.narration 是空的（字幕不出现、dur:{vo} 解不出来）。现在 Node 侧直接验证配置指向的
  // 文件（不起浏览器；判定纯函数在 scripts/lib/narration-error.mjs），--strict 下进 errs。
  {
    const cfgPath = path.join(ROOT, 'tasks', task, 'task.config.mjs');
    if (existsSync(cfgPath)) {
      const cfgSrc = readFileSync(cfgPath, 'utf8');
      // 只认"真的把 narration 当配置字段写"的那一行（注释里的示例不算——先剥行注释）
      const m = /^\s*narration\s*:\s*(['"])([^'"]+)\1/m.exec(cfgSrc.replace(/^\s*\/\/.*$/gm, ''));
      if (m) {
        const problem = narrationConfigProblem({ narration: m[2] }, { taskDir: path.join(ROOT, 'tasks', task) });
        if (problem) {
          warn('⚠ ' + describeNarrationError(problem));
          warn('  → 修法：确认 tasks/' + task + '/' + m[2].replace(/^\.\//, '') + ' 存在且是 say 生成的合法 JSON；暂时不要就先把 narration 这行删掉');
          if (strict) staticErrs.push('[旁白表] ' + describeNarrationError(problem));
        }
      }
    }
  }

  // 1.5) 静态：**画面文字逐字复述旁白**（`docs/CAPTIONS.md`）。
  //
  // 为什么放在 check 里：观众对 sodium 的反馈是"两条字幕同时出现（页面介绍 + 语音字幕）
  // 看着好迷糊"，而逐字比对发现那支片子 43 句旁白里有 12 句被抄成了画面说明条
  // （optifine 3 句、beast 0 句）。这类重复在**渲染上看不出任何异常** —— 画面照样出、
  // 亮度照样正常，只有把两边文本对一遍才发现得了。
  //
  // ⚠ 只 warn 不 fail：已经交付的片子（sodium/optifine）必然命中，让 check 非零退出
  //   会把回归清单永久染红，反而没人看了。要卡死就在交付自检里跑那条命令（AGENTS.md §10.9）。
  {
    const lint = path.join(ROOT, 'tools', 'lint-narration-dup.mjs');
    try {
      const { spawnSync } = await import('node:child_process');
      if (existsSync(lint)) {
        const r = spawnSync(process.execPath, [lint, task], { encoding: 'utf8', timeout: 30000 });
        const txt = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
        if (r.status === 1) {
          warn('⚠ 画面文字在复述旁白 —— 同屏两套完整句子就是观众说的"两条字幕"：');
          for (const line of txt.split(/\r?\n/).slice(0, 12)) warn(`  ${line}`);
          warn('  → 画面只留标注（名词 / 数字 / 单位 / 出处），句子交给旁白与字幕；见 docs/CAPTIONS.md');
          // 观众对 sodium 的反馈「不如纯看字幕了 / 不明所以」：43 句旁白里 12 句被逐字抄进了画面。
          // 默认只 warn（已交付的片子必然命中，让 check 非零退出会把回归清单永久染红）；
          // --strict 下进 errs —— 交付自检跑 --strict、回归清单跑默认，两边都照顾到。
          if (strict) {
            const hit = /(\d+)\s*句被逐字写进画面/.exec(txt);
            staticErrs.push('[旁白复述] ' + (hit ? hit[1] + ' 句旁白被逐字写进画面' : '画面文字在复述旁白'));
          }
        } else if (r.status === 2) {
          warn(`⚠ lint-narration-dup 没跑成：${String(txt).split(/\r?\n/)[0]}`);
          pushSkipped(skipped, '旁白复述检查（lint-narration-dup）', `它自己以退出码 2 退出（工具内部错误，不是"没命中"）：${String(txt).split(/\r?\n/)[0] || '(没有输出)'}`);
        } else if (r.status !== 0) {
          warn(`⚠ lint-narration-dup 异常退出（status ${r.status}，signal ${r.signal ?? '无'}）`);
          pushSkipped(skipped, '旁白复述检查（lint-narration-dup）', `退出码 ${r.status} / signal ${r.signal ?? '无'} —— 这一项既没报"命中"也没报"干净"，等于没验`);
        }
      } else {
        pushSkipped(skipped, '旁白复述检查（lint-narration-dup）', `工具不存在：${path.relative(ROOT, lint)}`);
      }
    } catch (err) {
      // 受限沙箱里 spawn 可能被拒（EPERM）：这不是 check 的失败，但也**不是通过**
      warn(`（旁白复述检查跳过：${firstLine(err)}）`);
      pushSkipped(skipped, '旁白复述检查（lint-narration-dup）', `起不了这个子进程：${firstLine(err)}`);
    }
  }

  // 1.54) **卡点**：切点有没有落在拍上（tools/lint-beat-align.mjs）。
  //
  // 为什么放在 check 里：切点差 60ms 观众说不出哪里怪，只会觉得"没跟着音乐走"。
  // 判据用**从音频自己重建的网格**（不信 analysis.json 的 bpm 估计 —— 实测它对合成床偏 4%）。
  {
    const tool = path.join(ROOT, 'tools', 'lint-beat-align.mjs');
    try {
      const { spawnSync } = await import('node:child_process');
      // 多语言任务（nekohome-intro-ja）的段长来自 ../nekohome-intro/audio/ja.timing.json ——
      // 这里把"可用的 timing 文件"交给工具，别因为它不在本任务目录就跳过卡点
      const timingCandidates = [
        path.join(ROOT, 'tasks', task, 'audio', 'timing.json'),
        path.join(ROOT, 'tasks', task, 'audio', 'ja.timing.json'),
      ];
      const timingForBeat = timingCandidates.find((p) => existsSync(p)) ?? null;
      if (existsSync(tool) && timingForBeat) {
        const r = spawnSync(process.execPath, [tool, task, '--json', '--timing', timingForBeat], { encoding: 'utf8', timeout: 60000 });
        let j = null;
        try { j = JSON.parse(`${r.stdout ?? ''}${r.stderr ?? ''}`); } catch { j = null; }
        if (j && j.rows) {
          const bad = j.rows.filter((x) => !x.ok);
          // 硬门（--strict）：交付前要求 ≥90% 的切点落在拍上（4-6 段的短片允许一个例外）
          const need = Math.max(1, Math.ceil(j.rows.length * 0.9));
          if (bad.length) {
            const worst = bad.slice().sort((a, b) => Math.abs(b.offMs) - Math.abs(a.offMs))[0];
            warn(`⚠ 卡点：${bad.length}/${j.rows.length} 个切点没落在拍上（判据 ±${j.tolMs}ms，实测 ${j.bpm.toFixed(2)} BPM）`);
            for (const b of bad.slice(0, 4)) warn(`  · ${b.id}  ${b.offMs >= 0 ? '+' : ''}${b.offMs.toFixed(0)}ms 离最近拍`);
            warn(`  → 段长改用 { beat: n } / { bar: n }，或把 narration.mjs 的 BPM 设成实测的 ${j.bpm.toFixed(2)}`);
            if (strict && j.rows.length - bad.length < need) {
              staticErrs.push(`[卡点] 只有 ${j.rows.length - bad.length}/${j.rows.length} 个切点对得上拍子（要求 ≥${need}，最差 ${Math.abs(worst.offMs).toFixed(0)}ms）`);
            }
          } else {
            log(`  ✓ 卡点：${j.rows.length}/${j.rows.length} 个切点都在 ±${j.tolMs}ms 内（实测 ${j.bpm.toFixed(2)} BPM）`);
          }
        } else if (r.status === 2) {
          pushSkipped(skipped, '卡点（beat-align）', `这条片子没有可检测的音轨或起音太少：${firstLine(`${r.stdout ?? ''}${r.stderr ?? ''}`)}`);
        }
        // 分析器给出的拍网格置信度（软失败：bpm 有值但网格不可信）
        if (j && j.track) {
          const ap = path.join(ROOT, j.track.replace(/\.[^.]+$/, '.analysis.json'));
          if (existsSync(ap)) {
            try {
              const tq = JSON.parse(readFileSync(ap, 'utf8')).tempo;
              if (tq && typeof tq.score === 'number' && tq.score < 0.75) {
                warn(`⚠ 拍网格置信度偏低（${(tq.score * 100).toFixed(0)}%，精确率 ${(tq.precision * 100).toFixed(0)}% / 召回 ${(tq.recall * 100).toFixed(0)}%）`
                  + ` —— bpm 有值不等于可信，别让画面重度依赖 f.beat`);
                if (strict) staticErrs.push(`[拍网格] 置信度 ${(tq.score * 100).toFixed(0)}% < 75%`);
              }
            } catch { /* 读不出来就算了 */ }
          }
        }
      } else if (!existsSync(path.join(ROOT, 'tasks', task, 'audio', 'timing.json'))) {
        pushSkipped(skipped, '卡点（beat-align）', '没有 audio/timing.json —— 这条片子的段长不是由旁白/节拍解出来的，没得对');
      } else {
        pushSkipped(skipped, '卡点（beat-align）', '工具不存在：tools/lint-beat-align.mjs');
      }
    } catch (err) {
      pushSkipped(skipped, '卡点（beat-align）', `起不了这个子进程：${firstLine(err)}`);
    }
  }


  // 1.542) **歌词同步**：词句段首跟不跟得上人声（tools/lint-lyric-sync.mjs）。
  //
  // 为什么在 check 里：卡点只量「切点离拍多远」，可歌词片被观众听出来的问题是「这句字先出来/后出来」。
  // 实测第一版 PV 按字数均摊句长 → 句首离真人声中位 366ms、最差 8.7s（前奏猜错），用户一句「没有卡点啊喂」。
  // 判据（工具里）：中位 ≤150ms 且 p90 ≤400ms；不是歌词片时它退出码 2 → 进 skipped，不算失败。
  {
    const tool = path.join(ROOT, 'tools', 'lint-lyric-sync.mjs');
    if (!existsSync(tool)) {
      pushSkipped(skipped, '歌词同步（lyric-sync）', '工具不存在：tools/lint-lyric-sync.mjs');
    } else {
      try {
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(process.execPath, [tool, task, '--json'], { encoding: 'utf8', timeout: 60000 });
        let j = null;
        try { j = JSON.parse((r.stdout ?? '') + (r.stderr ?? '')); } catch { j = null; }
        if (j && typeof j.medianMs === 'number') {
          if (j.ok) {
            log('  ✓ 歌词同步：' + j.lines + ' 句都在人声上（中位 ' + j.medianMs + 'ms · p90 ' + j.p90Ms + 'ms）');
          } else {
            warn('⚠ 歌词同步：中位 ' + j.medianMs + 'ms / p90 ' + j.p90Ms + 'ms（判据 ≤' + j.medianTol + '/' + j.p90Tol + 'ms）');
            for (const w of (j.worst ?? []).slice(0, 3)) {
              warn('  · ' + w.start.toFixed(2) + 's  ' + (w.dMs >= 0 ? '+' : '') + w.dMs + 'ms  ' + w.text);
            }
            warn('  → 句首用官方 LRC / 人声起音，别按字数均摊');
            if (strict) staticErrs.push('[歌词同步] 中位 ' + j.medianMs + 'ms / p90 ' + j.p90Ms + 'ms 超判据');
          }
        } else if (r.status === 2) {
          pushSkipped(skipped, '歌词同步（lyric-sync）', '不是歌词片或没有分析：' + firstLine((r.stdout ?? '') + (r.stderr ?? '')));
        }
      } catch (err) {
        pushSkipped(skipped, '歌词同步（lyric-sync）', '起不了这个子进程：' + firstLine(err));
      }
    }
  }

  // 1.542a) **运动人格**（tools/lint-motion-persona.mjs）：可选声明，没写就 exit 2 → skipped。
  //
  // 为什么在 check 里：风格管视觉、不管运动 —— 而「太快像抖、太慢像卡住」是观众最先说出口的那句。
  // 三条判据（时长档 / 缓动族 / 回弹）都是**区间 + 可豁免**，默认只报；`--strict` 才进 staticErrs。
  // ⚠ 退出码 2 有两种含义，都必须进 skipped 而不是失败：① 没声明 motion；② 声明了但一条判据都没跑起来。
  {
    const tool = path.join(ROOT, 'tools', 'lint-motion-persona.mjs');
    if (!existsSync(tool)) {
      pushSkipped(skipped, '运动人格（motion-persona）', '工具不存在：tools/lint-motion-persona.mjs');
    } else {
      try {
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(process.execPath, [tool, task, '--json'], { encoding: 'utf8', timeout: 60000 });
        let j = null;
        try { j = JSON.parse((r.stdout ?? '') + (r.stderr ?? '')); } catch { j = null; }
        // 退出码语义：2 = 没得判/没验 → skipped；0 / 1 = 真跑过（1 只在 --strict 下）
        if (j && Array.isArray(j.problems) && r.status !== 2) {
          if ((j.problems ?? []).length) {
            warn('⚠ 运动人格：' + j.problems.length + ' 条（默认只报；--strict 才当门）');
            for (const p of j.problems.slice(0, 3)) warn('  · ' + p);
            if (strict) staticErrs.push('[运动人格] ' + j.problems.length + ' 条超出「' + (j.motion?.persona ?? '?') + '」的参考区间');
          } else {
            log('  ✓ 运动人格：' + j.evaluated + ' 条判据都在「' + (j.motion?.persona ?? '?') + '」的区间内'
              + ((j.skipped ?? []).length ? '（另有 ' + j.skipped.length + ' 条没验）' : ''));
          }
        } else if (r.status === 2) {
          pushSkipped(skipped, '运动人格（motion-persona）', '没声明 motion，或声明了但三条判据一条都没跑起来（看 node tools/lint-motion-persona.mjs ' + task + '）');
        }
      } catch (err) {
        pushSkipped(skipped, '运动人格（motion-persona）', '起不了这个子进程：' + firstLine(err));
      }
    }
  }

  // 1.542a2) **缓动方向**（tools/lint-easing-direction.mjs）：位移别配线性、入场别用 ease-out、出场别用 ease-in。
  // 与「运动人格」互补：人格判「这一档该用什么」，方向判「这一处的搭配是不是反的」。
  // 纯静态（扫场景源码里的 prog / keys），不需要渲染；行内可 `// motion:allow easing` 豁免。
  {
    const tool = path.join(ROOT, 'tools', 'lint-easing-direction.mjs');
    if (!existsSync(tool)) {
      pushSkipped(skipped, '缓动方向（easing-direction）', '工具不存在：tools/lint-easing-direction.mjs');
    } else {
      try {
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(process.execPath, [tool, task, '--json'], { encoding: 'utf8', timeout: 60000 });
        let j = null;
        try { j = JSON.parse((r.stdout ?? '') + (r.stderr ?? '')); } catch { j = null; }
        if (j && typeof j.progCount === 'number') {
          if (j.progCount === 0) {
            pushSkipped(skipped, '缓动方向（easing-direction）', '扫了 ' + j.files + ' 个文件但一处 prog 都没有 —— 这一项没得判');
          } else if ((j.issues ?? []).length) {
            warn('⚠ 缓动方向：' + j.issues.length + ' 处（默认只报；--strict 才当门）');
            for (const it of j.issues.slice(0, 3)) warn('  · ' + (it.file ?? '') + ':' + (it.line ?? '?') + ' ' + (it.kind ?? ''));
            if (strict) staticErrs.push('[缓动方向] ' + j.issues.length + ' 处搭配是反的（位移配线性 / 方向与出入场相反）');
          } else {
            log('  ✓ 缓动方向：' + j.progCount + ' 处 prog 没有反配');
          }
        } else if (r.status === 2) {
          pushSkipped(skipped, '缓动方向（easing-direction）', '这一项没得判：' + firstLine((r.stdout ?? '') + (r.stderr ?? '')));
        }
      } catch (err) {
        pushSkipped(skipped, '缓动方向（easing-direction）', '起不了这个子进程：' + firstLine(err));
      }
    }
  }
  // 1.542a3) **同时运动**（tools/lint-concurrency.mjs）：一帧里有三分之一的画面在动，眼睛就不知道看哪。
  //
  // ⚠ 它必须读**成片**（解码 mp4 算变化块的连通分量），所以只在 out/<任务>/ 里已经有 mp4 时才跑；
  //   没有成片就进 skipped —— 这正是「这一项没验」，不是通过。
  {
    const tool = path.join(ROOT, 'tools', 'lint-concurrency.mjs');
    const outDir = path.join(ROOT, 'out', task);
    const vids = existsSync(outDir)
      ? readdirSync(outDir).filter((f) => f.endsWith('.mp4') && !/^part_|_stitched|^smoke-/.test(f))
      : [];
    if (!existsSync(tool)) {
      pushSkipped(skipped, '同时运动（concurrency）', '工具不存在：tools/lint-concurrency.mjs');
    } else if (!vids.length) {
      pushSkipped(skipped, '同时运动（concurrency）', '还没有成片（先 anim video）；它从 mp4 解帧算连通分量');
    } else {
      try {
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(process.execPath, [tool, task, '--json'], { encoding: 'utf8', timeout: 180000 });
        let j = null;
        try { j = JSON.parse((r.stdout ?? '') + (r.stderr ?? '')); } catch { j = null; }
        if (j && typeof j.medShare === 'number') {
          const info = '面积中位 ' + (j.medShare * 100).toFixed(0) + '% / 最大 ' + (j.maxShare * 100).toFixed(0)
            + '% · 主体中位 ' + j.medBlocks + ' / 最大 ' + j.maxBlocks + ' 个';
          if ((j.problems ?? []).length) {
            warn('⚠ 同时运动：' + info + '（默认只报；--strict 才当门）');
            for (const p of j.problems.slice(0, 1)) warn('  · ' + p);
            if (strict) staticErrs.push('[同时运动] ' + j.problems.length + ' 条超参考（' + info + '）');
          } else {
            log('  ✓ 同时运动：' + info);
          }
        } else if (r.status === 2) {
          pushSkipped(skipped, '同时运动（concurrency）', '跑不了：' + firstLine((r.stdout ?? '') + (r.stderr ?? '')));
        }
      } catch (err) {
        pushSkipped(skipped, '同时运动（concurrency）', '起不了这个子进程：' + firstLine(err));
      }
    }
  }
  // 1.542b) **色系**：这支片子的颜色在不在一个色系里（tools/lint-color-family.mjs）。
  //
  // 为什么在 check 里：换风格最常翻的车不是「配色丑」，是**色系散了** ——
  // 底色偏冷、强调色偏暖、第二强调色又落在第三个色系；观众说不出哪里怪，只觉得脏。
  {
    const tool = path.join(ROOT, 'tools', 'lint-color-family.mjs');
    if (!existsSync(tool)) {
      pushSkipped(skipped, '色系（color-family）', '工具不存在：tools/lint-color-family.mjs');
    } else {
      try {
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(process.execPath, [tool, '--task', task, '--json'], { encoding: 'utf8', timeout: 60000 });
        let j = null;
        // --json 时工具只吐 JSON（人读的那些行被 quiet 掉了），所以整段解析即可
        try { j = JSON.parse((r.stdout ?? '').trim()); } catch { j = null; }
        const row = j && Array.isArray(j.rows) ? j.rows[0] : null;
        if (row) {
          if (row.ok) {
            log('  ✓ 色系：' + row.families + '（主色系 ' + Math.round(row.top * 100) + '% · 底/字对比 ' + row.contrast.toFixed(2) + '）');
          } else {
            warn('⚠ 色系散了：' + row.families + '（主色系 ' + Math.round(row.top * 100) + '% · 前二 ' + Math.round(row.top2 * 100) + '%）');
            for (const p of row.problems ?? []) warn('  · ' + p);
            warn('  → 强调色（ember/blood/acid）跟着 signal 走；或换一套风格（docs/STYLE.md）');
            if (strict) staticErrs.push('[色系] ' + (row.problems ?? []).join('；'));
          }
        }
      } catch (err) {
        pushSkipped(skipped, '色系（color-family）', '起不了这个子进程：' + firstLine(err));
      }
    }
  }
  // 1.545) **事件密度**：观众每一秒有没有新东西看（tools/lint-event-density.mjs）。
  //
  // 为什么在 check 里：片子可以零报错、qa 全绿，但观众第 8 秒就走人。
  // 实测 nekohome-intro-ja：8–15s 连续 7 秒帧间差 < 0.3，全片 44% 的 2 秒窗口低于均值一半。
  // ⚠ 它量的是**成片**（mp4 的帧间差）—— 还没出片时只报 skipped，不当失败。
  {
    const tool = path.join(ROOT, 'tools', 'lint-event-density.mjs');
    const outDir = path.join(ROOT, 'out', task);
    const mp4 = existsSync(outDir)
      ? readdirSync(outDir).filter((f) => f.endsWith('.mp4') && !/^part_|_stitched|^smoke-/.test(f))[0]
      : null;
    if (!existsSync(tool)) {
      pushSkipped(skipped, '事件密度（event-density）', '工具不存在：tools/lint-event-density.mjs');
    } else if (!mp4) {
      pushSkipped(skipped, '事件密度（event-density）',
        '还没有成片可量 —— 先跑 anim video，再回头体检（它看的是 mp4 的帧间差）');
    } else {
      try {
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(process.execPath, [tool, task, '--json'], { encoding: 'utf8', timeout: 120000 });
        let j = null;
        try { j = JSON.parse(r.stdout ?? ''); } catch { j = null; }
        if (j && j.windows) {
          if (j.problems?.length) {
            warn(`⚠ 事件密度：${j.problems.join('；')}`);
            warn(`  → 最静的窗口：${j.worst.map((w) => w.t + 's(' + w.v + ')').join('  ')}`);
            warn('  → 补法：给这几段加持续运动（推近/逐条落位/扫描线），或把段缩短、并进相邻段');
            if (strict) staticErrs.push(`[事件密度] ${j.problems.join('；')}`);
          } else {
            log(`  ✓ 事件密度：最长静止 ${j.staticSpan.toFixed(1)}s · 稀薄窗口 ${(j.thinShare * 100).toFixed(0)}%（平均帧间差 ${j.mean}）`);
          }
        }
      } catch (err) {
        pushSkipped(skipped, '事件密度（event-density）', `起不了子进程：${firstLine(err)}`);
      }
    }
  }

  // 1.545b) **运动节奏（C7）**：成片帧间差的 CV + 最长静止（C4：与 anti-ppt C7 共用 diff-series）。
  //
  // 为什么在 check 里：匀速漂移（每帧都在动但方差极小）是"页面在动、世界没变"的典型，
  // 事件密度看"有没有动"，C7 看"动得有有没有事件"。两条互补。
  // ⚠ 量的是**成片**（mp4 帧间差）—— 没出片只报 skipped。歌词片（过半段带 params.mode）CV 不 gate。
  {
    const outDir = path.join(ROOT, 'out', task);
    const mp4 = existsSync(outDir)
      ? readdirSync(outDir).filter((f) => f.endsWith('.mp4') && !/^part_|_stitched|^smoke-/.test(f))[0]
      : null;
    if (!mp4) {
      pushSkipped(skipped, '运动节奏（C7）', '还没有成片可量 —— 先跑 anim video（它看的是 mp4 的帧间差）');
    } else {
      try {
        const series = decodeDiffSeries(path.join(outDir, mp4));
        if (!series) {
          pushSkipped(skipped, '运动节奏（C7）', '解码失败或帧数太少（<8）');
        } else {
          const m = motionStats(series.diff, series.fps);
          let lyricFilm = false;
          try {
            const cfg = (await import(new URL('../../tasks/' + task + '/task.config.mjs', import.meta.url).href)).default;
            const segs = build(cfg.timeline, { bpm: 120, duration: cfg.duration ?? 0 });
            lyricFilm = segs.filter((s) => s?.params?.mode).length > segs.length * 0.5;
          } catch { /* 读不到配置就当非歌词片 */ }
          const reading = `CV ${m.cv.toFixed(2)} · 平均帧间差 ${m.mean.toFixed(2)} · 最长静止 ${m.staticSpan.toFixed(1)}s`;
          const probs = [];
          if (m.cv < 0.30 && !lyricFilm) probs.push(`像匀速漂移（CV ${m.cv.toFixed(2)} < 0.30）—— 一直动但没有事件`);
          if (m.staticSpan > 3.5) probs.push(`最长静止 ${m.staticSpan.toFixed(1)}s > 3.5s`);
          if (probs.length) {
            warn(`⚠ 运动节奏（C7）：${reading}` + (lyricFilm ? '（歌词片：CV 不 gate）' : ''));
            for (const p of probs) warn('  · ' + p);
            if (strict) staticErrs.push(`[运动节奏C7] ${probs.join('；')}`);
          } else {
            log(`  ✓ 运动节奏（C7）：${reading}` + (lyricFilm ? '（歌词片）' : ''));
          }
        }
      } catch (err) {
        pushSkipped(skipped, '运动节奏（C7）', `起不了子进程：${firstLine(err)}`);
      }
    }
  }

  // 1.545c) **分镜占位**（C2）：时间线里还有 placeholder 占位卡 ⇒ 这片子还没做完。
  // 默认 warn，--strict 进 errs。占位卡是「写场景前先对齐意图」的草稿，不是交付画面。
  {
    try {
      const cfg = (await import(new URL('../../tasks/' + task + '/task.config.mjs', import.meta.url).href)).default;
      const segs = build(cfg.timeline, { bpm: 120, duration: cfg.duration ?? 0 });
      const ph = segs.filter((s) => s?.scene?.isPlaceholder);
      if (ph.length) {
        warn(`⚠ 分镜占位：时间线里还有 ${ph.length} 段 placeholder（${ph.map((s) => s.id).join(' / ')}）—— 这是草稿，交付前逐段换成真镜头`);
        warn('  → 协作顺序：分镜表 → placeholder 时间线 → anim board 确认 → 逐段替换（docs/SCENE-BRIEF-TEMPLATE.md §11）');
        if (strict) staticErrs.push(`[分镜占位] 还有 ${ph.length} 段 placeholder 未替换`);
      }
    } catch { /* 读不到配置就不判 */ }
  }

  // 1.55) 静态：**运动上限**（BACKLOG 1-33；判据与 src/kit/motion.js 的 waterfallOver 逐字一致）。
  //
  // 为什么放在 check 里：错峰跨度「items × stagger ≤ 0.5s」是"一组元素像一个节拍到达"的判据，
  // 写超了画面不会报任何错 —— 只会"看着有点拖"。waterfallStagger() 能在运行时压回去，
  // 但作者得先想起来调用它；这一层从**源码字面量**里算跨度，把"想不起来"变成一条读数。
  //
  // ⚠ 默认只 warn：0.5 是外部经验值（docs/MOTION.md §0），不是实测结论；
  //   --strict 下进 errs（交付自检跑 --strict，回归清单跑默认）。
  //   "没有可判的对象"进 skipped —— 空不等于干净。
  {
    const lint = path.join(ROOT, 'tools', 'lint-motion-caps.mjs');
    try {
      const { spawnSync } = await import('node:child_process');
      if (existsSync(lint)) {
        const r = spawnSync(process.execPath, [lint, task, '--json'], { encoding: 'utf8', timeout: 30000 });
        const txt = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
        let j = null;
        try { j = JSON.parse(txt); } catch { j = null; }
        if (r.status === 0 && j) {
          if (j.over && j.over.length) {
            const stag = j.over.filter((o) => o.kind !== 'halo');
            const halo = j.over.filter((o) => o.kind === 'halo');
            warn(`⚠ 运动上限：${j.over.length} 处越线（错峰 ${stag.length} · 辉光峰值 ${halo.length}）：`);
            for (const o of stag.slice(0, 6)) {
              warn(`  · ${o.file}:${o.line}  stagger ${o.stagger} × ${o.items} 项 = ${o.span.toFixed(3)}s > ${j.cap}s`);
            }
            for (const o of halo.slice(0, 6)) {
              warn(`  · ${o.file}:${o.line}  halo.peak ${o.peak} > 0.45（辉光峰值上限）`);
            }
            if (stag.length) warn('  → 错峰：用 waterfallStagger(items, stagger).stagger 喂 type.write（按 0.5s/items 压回）');
            if (halo.length) warn('  → 辉光：峰值降到 0.45 以下（超限的辉光会把主体糊掉）；见 docs/MOTION.md §4');
            if (strict) staticErrs.push('[运动上限] ' + j.over.length + ' 处越线（错峰跨度 / 辉光峰值）');
          }
          if (!j.over.length && !j.checked.length) {
            pushSkipped(skipped, '运动上限（stagger 跨度）',
              `这个任务里没有可判的 stagger 字面量（可判 0 处、读不出 ${j.unchecked.length} 处）—— 没验`);
          } else if (j.unchecked.length && !j.over.length) {
            warn(`（运动上限：可判 ${j.checked.length} 处都在上限内；另有 ${j.unchecked.length} 处读不出元素个数 —— 那些**没验**）`);
          }
        } else if (r.status === 2) {
          pushSkipped(skipped, '运动上限（stagger 跨度）', `工具自己退出码 2（不是"没命中"）：${firstLine(txt)}`);
        } else if (r.status !== 0) {
          pushSkipped(skipped, '运动上限（stagger 跨度）', `退出码 ${r.status}，输出不是可解析的 JSON —— 没验`);
        }
      } else {
        pushSkipped(skipped, '运动上限（stagger 跨度）', `工具不存在：${path.relative(ROOT, lint)}`);
      }
    } catch (err) {
      pushSkipped(skipped, '运动上限（stagger 跨度）', `起不了这个子进程：${firstLine(err)}`);
    }
  }

  /**
   * 1.6) 镜头模板的**依赖前置校验**（BACKLOG 1-21 / `docs/ENGINE.md` §14.9）。
   *
   * 为什么放在开浏览器**之前**：`wave` / `pulse` / `grid` 读 `ctx.music`（音频包络 + 真实打击事件），
   * 忘了配 `audio`（或还没跑 `analyze`）时画面是黑的 —— 而这件事以前只能等逐段试渲染
   * （起一个私有 Vite + 无头 Chrome、几十秒之后）由亮度统计报一句「几乎全黑，场景可能没画东西」，
   * **方向完全错**：既不点名是哪个模板，也不提音乐。
   *
   * 现在它是**静态**的：任务源码文本（配置档 + `scenes/**.js`）+ 模板自己的 `spec.requires`
   * + 音频/分析文件在不在 —— 毫秒级，而且**渲染起不来也能报**（受限沙箱里 check 照样有用）。
   *
   * 两档严重性（判据在 `shotDependencyIssues()` 的注释里）：
   *   · 任务根本没配 `audio` ⇒ **errs**（这一段不可能对，退出码 1）；
   *   · 配了 `audio` 但没跑过 `analyze` ⇒ **skipped**（"这一步还没跑"，默认不改退出码）。
   * ⚠ `errs` 在 `openSession` 之后才构造（`reportErrors()` 的返回值），所以这里先攒进 `depErrs`，
   *   下面用 `const errs = [...depErrs, ...reportErrors(info)]` 合起来 —— 退出码语义一个字没动。
   */
  const depErrs = [];
  try {
    const { SHOTS } = await import("../../src/shots/index.js");
    const files = taskShotSources(task);
    const usage = scanShotUsage(files, Object.keys(SHOTS ?? {}));
    const facts = shotDependencyFacts(task);
    const specOf = (n) => (SHOTS?.[n] ? SHOTS[n].spec : undefined);
    const issues = shotDependencyIssues(usage, specOf, facts);
    const rows = usage.map((u) => ({ ...u, requires: specOf(u.shot)?.requires ?? [] }));
    const dep = shotDependencyReport({
      scanned: files.length, usage: rows, issues, facts, only: opt('only', null),
    });
    for (const l of dep.lines) (l.sev === 'warn' ? warn : log)(l.text);
    depErrs.push(...dep.errors);
    for (const s of dep.skipped) pushSkipped(skipped, s.what, s.why);
  } catch (err) {
    // 「空 ≠ 干净」：这一项**没跑成**也要说话（不然"没报错"会被读成"依赖都对"）
    warn(`（镜头模板依赖校验没跑成：${firstLine(err)}）`);
    pushSkipped(skipped, SHOT_DEP_WHAT, `静态扫描起不来：${firstLine(err)}`);
  }


  /**
   * 1.7) **画面语义断言的声明文件**（BACKLOG 1-18）：`tasks/<任务>/motion.json`。
   *
   * 放在开浏览器**之前**做两件事（与 1.5 / 1.6 同一条"静态阶段能报的不等渲染"的道理）：
   *   · 文件不存在 → `pushSkipped`：任务没有声明任何断言，这一项**没判**（绝不当通过）；
   *   · JSON 解析失败 → **静态错误**（进 `staticErrs`，最后并进 `errs` gate 退出码）——
   *     声明文件本身坏了，后面的断言一条都验不了，这是硬问题。
   * 采样计划与判读（`planMotionAsserts` / `motionVerdict`）在下面的试渲染段里跑 ——
   * 它们需要 build() 之后的段表（`info.timeline`），而段表只有页面装完才有。
   */
  let motionSpec = null;
  {
    const motionPath = path.join(ROOT, 'tasks', task, 'motion.json');
    if (!existsSync(motionPath)) {
      pushSkipped(skipped, '画面语义断言（motion.json）', '任务没有声明任何断言——没判 ≠ 通过');
    } else {
      try {
        const parsed = JSON.parse(readFileSync(motionPath, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          staticErrs.push('[画面语义断言] ' + path.relative(ROOT, motionPath)
            + ' 的内容该是对象（{ "assert": [...], "thresholds": {...} }），收到 ' + (Array.isArray(parsed) ? '数组' : typeof parsed));
        } else {
          motionSpec = parsed;
        }
      } catch (err) {
        staticErrs.push('[画面语义断言] motion.json 解析失败：' + firstLine(err));
      }
    }
  }

  /**
   * 1.8) **词锚点的降级记录**（BACKLOG 1-17，2026-10-17）：`tasks/<任务>/audio/anchors.json`。
   *
   * `anim say` 解锚时，被锚句拿不到真词级时间戳（words 为空 / approx）会**退回手写秒数**，
   * 并把原因写进这个文件的 `degraded`—— 改词后那些段**不会自动重排**（时间表落在手写 cue 上）。
   * `say` 自己已经打过一遍；check 再报一遍是因为两件事看的时机不同：
   * say 看「合成这一刻」，check 看「交付这一刻」—— 改词重跑之间夹一次 check 是常态。
   * 文件不存在 = 脚本里没写锚点（或还没跑过 say）= 没有可报的降级，不打扰。
   */
  {
    const anchorsPath = path.join(ROOT, 'tasks', task, 'audio', 'anchors.json');
    if (existsSync(anchorsPath)) {
      try {
        const a = JSON.parse(readFileSync(anchorsPath, 'utf8'));
        const deg = Array.isArray(a?.degraded) ? a.degraded : [];
        if (deg.length) {
          warn('⚠ ' + deg.length + ' 个词锚点降级成了手写秒数（改词不会自动重排）：');
          for (const d of deg.slice(0, 12)) warn('  [' + d.id + '] ' + d.kind + ' 锚点：' + d.why);
          if (deg.length > 12) warn('  …以及另外 ' + (deg.length - 12) + ' 个');
          warn('  → 拿到真词级时间戳（重跑 say 且驱动支持）后锚点会自动接管；降级期间时间表落在手写 cue/internal 上。');
        }
      } catch (err) {
        warn('(词锚点降级记录读不了：' + firstLine(err) + ')');
      }
    }
  }

  // 2) 试渲染每一段的三个采样点（有 GPU 就能立刻抓到 shader 编译错误和 NaN）
  await openSession({ task, only: opt('only', undefined) });
  try {
    const info = getSession().info;
    log(`\n分辨率 ${info.width}×${info.height}×${info.scale}  @${info.fps}fps  时长 ${info.duration.toFixed(2)}s  ${info.timeline.length} 段  bpm ${Number(info.bpm).toFixed(1)}`);
    log(`GPU: ${info.rendererLabel || info.renderer}`);
    // 段名 + 时长摊开打印（P0-2）：写错时间线时，"片长/段名不对"必须一眼能看出来。
    // 以前 `check` 只在头上给一行汇总，伪时间线（12 段 × 默认 4s = 48s）就混过去了。
    log(`\n时间线（段名 / 时长 / 起止）：`);
    for (const it of info.timeline) {
      log(`  ${String(it.id).padEnd(16)} ${it.start.toFixed(2).padStart(8)} → ${it.end.toFixed(2).padStart(8)}  (${(it.end - it.start).toFixed(2)}s)${it.note ? '  ' + it.note : ''}`);
    }
    const errs = [...staticErrs, ...depErrs, ...reportErrors(info)];
    // `--quick` 的判据要在这之前就知道（响度那一档、试渲染那一档都用它）。
    // ⚠ 它只是**冒烟**：每段只采 50% 一个点、只跑单子帧、响度只量前 60 秒 ——
    //   不看多子帧路径、不看入场头 1 秒。结论行里会写清"哪些没跑"。
    const quick = flag('quick');
    // 音轨：说清"节拍是从哪条轨测的"（P1-4 —— 从混音里测会被旁白带偏）
    const tracks = resolveAudioTracks(task);
    if (tracks.analysisSource) log(`音频：${tracks.note}`);

    // 「音频分析」这一项**跑没跑**必须说出来（BACKLOG 头部 ④，2026-10-16）。
    //
    // 以前只有 `analyzeTaskAudio()` 在缺 ffmpeg 时 warn 一句然后返回 null —— 而那一步**只有
    // 出片路径（cmdVideo）会走**：`check` 不跑 analyze，于是"这支片子的画面压根踩不了拍子"
    // 在体检里一个字都不会提（除非用了声明 `requires: ['analyze']` 的模板）。
    // 现在这里明说，并且进 `skipped`（"没跑 ≠ 通过"）；`--strict` 会把它当失败。
    if (tracks.analysisSource) {
      const abase = tracks.analysisSource.replace(/\.[^.]+$/, '');
      const apath = path.join(ROOT, 'tasks', task, 'audio', path.basename(abase) + '.analysis.json');
      if (!existsSync(apath) && !(await checkFfmpeg())) {
        warn('⚠ 音频分析：还没有预计算的分析数据（' + path.relative(ROOT, apath) + ' 不存在），');
        warn('  而这台机器上**没有 ffmpeg** ⇒ 这一步连补都补不了：画面不会踩拍子（f.beat / f.a 全是 0）。');
        warn('  → 装 ffmpeg（或用 ANIM_FFMPEG 指定），再跑 node scripts/anim.mjs analyze ' + task);
        pushSkipped(skipped, '音频分析（analyze）', '没有 ffmpeg：这一步连补都补不了 —— 没验');
      }
    }

    // 音频的数字守门（1-20）：你听不见，就报数字。放在这里是因为它 spawnSync 会阻塞事件循环，
    // 绝不能夹在渲染会话中间（渲染靠 stdin 控制通道）。
    if (tracks.packaging) {
      const { measureLoudness, formatLoudness, assessLoudness } = await import("../lib/media.mjs");
      const t0 = Date.now();
      // `--quick` 用省时档：只量前 60 秒（BACKLOG 头部 ⑤ —— 4 分钟的轨整条量要 12–14s，
      // 而快捷冒烟只是想看数字有没有离谱）。**必须写在输出里**：整合响度是整段的量，
      // 截断读数不是一个可以当结论用的数字。
      const win = quick ? 60 : null;
      try {
        const m = measureLoudness(tracks.packaging, win ? { seconds: win } : undefined);
        const a = assessLoudness(m);
        log(`响度：${formatLoudness(m)}（packaging = ${path.basename(tracks.packaging)}，真峰=true peak）`
          + `  ${a.tier === 'ok' ? '✓' : a.tier === 'warn' ? '⚠' : '✗'} ${a.verdict}`);
        if (m.seconds) {
          warn(`  ⚠ 这个读数**只量了前 ${m.seconds}s**（--quick 的省时档）—— 整合响度是整段的量，`
            + '别拿它当全片结论；要结论就去掉 --quick。');
        }
        if (a.tier === 'error') warn(`  → 靶子是 ${m.target.i} LUFS / ${m.target.tp} dBTP（主流平台归一化目标）。`
          + `这一条只报数字、不自动归一化 —— 归一化会改动所有带旁白片子的音轨，等于已交付片子全部重出。`);
        log(`  （量了 ${((Date.now() - t0) / 1000).toFixed(1)}s；4 分钟的轨约 12s${win ? '，这里只量了前 60s' : ''}）`);
      } catch (e) {
        warn(`⚠ 响度没量成（${e.kind}）：${String(e.message).split('\n')[0]}`);
      }
    }

    // 风格包与字幕层（docs/STYLE.md / docs/CAPTIONS.md）—— 这两件事以前"没有任何入口"，
    // 于是每支片子都长得像上一支、而语音字幕干脆不在引擎里（出锅之后才用 ffmpeg 烧）。
    // check 把它们打出来，是为了让"这支片子长什么样"变成一件**看得见**的事。
    if (info.style) {
      log(`风格：${info.style.name}（${info.style.label}）· 背景母题 ${info.style.motif}`
        + (info.style.fonts ? ` · 自定义字体 ${info.style.fonts} 族` : ''));
    }
    if (info.captions?.on) {
      const b = info.captions.band;
      log(`字幕：引擎字幕层已开 · 保留带 y ${b.y0}–${b.y1} / x ${b.x0}–${b.x1}`
        + ` · 说完再留 ${info.captions.hold}s${info.captions.karaoke ? ' · 逐词高亮（研究上属负效应，慎用）' : ''}`);
    } else if (info.narrationLines > 0) {
      warn(`⚠ 这支片子有 ${info.narrationLines} 句旁白，但**没开字幕层** —— 观众看不到语音字幕。`);
      warn('  → task.config.mjs 里加一行 captions: true（用法与理由见 docs/CAPTIONS.md）。');
      warn('  → 以前字幕是出锅后用 ffmpeg 烧的，生成脚本还在 out/_staging/（out/ 会被 clean 清掉）。');
    }
    for (const w of info.warnings ?? []) warn(`⚠ ${w}`);

    // 字幕会不会**跨越场景切换**？（`docs/CAPTIONS.md`）
    //
    // 依据是 Netflix 的 timed-text 规范：「字幕不得跨越场景切换」—— 换镜头可以，
    // 换场景不行。出图时才发现的实例：`_style-sampler` 第一版旁白表里 4 句**全都**跨了段，
    // 于是每一段开头都会看到上一句字幕还在淡出（同一屏上两句字）。
    // 片尾最后一句豁免（画面结束在它后面，没有"下一个场景"）。
    if (info.captions?.on && (info.narration ?? []).length) {
      const hold = info.captions.hold ?? 1.06;
      const segs = info.timeline ?? [];
      const crossed = [];
      for (const l of info.narration) {
        const seg = segs.find((it) => l.start >= it.start - 1e-6 && l.start < it.end);
        if (!seg || seg === segs[segs.length - 1]) continue;
        const until = l.end + hold;
        if (until > seg.end + 0.05) crossed.push({ l, seg, until });
      }
      if (crossed.length) {
        warn(`⚠ ${crossed.length} 句字幕**跨越了场景切换**（规范要求字幕不得跨 scene change）：`);
        for (const c of crossed.slice(0, 6)) {
          warn(`  [${c.l.id}]「${String(c.l.text).slice(0, 18)}…」说到 ${c.l.end.toFixed(1)}s，`
            + `加上停留要到 ${c.until.toFixed(1)}s 才消失，而 ${c.seg.id} 段在 ${c.seg.end.toFixed(1)}s 就切走了`);
        }
        warn('  → 让这句说早一点 / 说短一点，或者把这一段放长（段长本来就该由旁白决定，docs/NARRATION.md）');
      }
    }

    // 背景守门（P0-2）：先问页面里有没有"声明了 handlesTransition 却没画共享背景"的段。
    // 那类段的底会是纯黑，而亮度统计抓不到（文字/面板/grain 自己就有亮度）。
    let world = null;
    try {
      world = await evaluateSafe(() => /** @type {any} */ (window).__anim.worldAudit(), undefined, 'worldAudit()');
      // ⚠ 口径：`world: false` 的段在下面单独一栏（`selfRows`），但它们**也是**"声明了转场"的段 ——
      //   统计"多少段声明了转场/共享背景"要把两栏合起来看，否则 whip 会被算成 0（2026-10-16 实测）。
      const risky = [...(world?.results ?? [])].filter((r) => r.handlesTransition || r.declaredWorld !== 'none');
      // 声明了 `world: false`（"整帧底我自己负责"）的段：**不判铺底**，但这次真的采了读数
      // （BACKLOG 头部 ⑦）。以前它们一行都不出现，于是"交叠窗之后那 1 秒"连个数字都没有。
      const selfRows = world?.selfBase ?? [];
      if (selfRows.length) {
        const darkSelf = selfRows.filter((r) => r.dark && (r.handlesTransition || r.declaredWorld !== 'none'));
        log(`\n背景守门（world: false 的段，**不判铺底**，只给读数）：${selfRows.length} 段`);
        for (const r of selfRows) {
          const means = (r.samples ?? []).filter((s) => typeof s.mean === 'number')
            .map((s) => `t=${s.t.toFixed(2)}s 亮度 ${s.mean.toFixed(3)}`).join('  ·  ');
          log(`  ${String(r.id).padEnd(14)} 整帧覆盖 ${String(r.full).padStart(3)} 次  ${means}`);
        }
        if (darkSelf.length) {
          // ⚠ 只 warn、不进 errs（2026-10-16 实测）：窗后中点**不是判据点** —— 转场模板在窗后
          //   走"没有 under"的分支，本来就可能是近黑的（whip 设计值 0.037–0.051）。这里只是把
          //   "真的低到 0.004 以下"（= 除了一层清屏色什么都没有）这件事**报出来**给人看；
          //   逐段亮度守门（15%/50%/85% 三点）才是那条 gate。
          warn(`⚠ 其中有 ${darkSelf.length} 段是**转场段**，窗后中点采到了"一片黑"（mean < 0.004）：${darkSelf.map((r) => r.id).join(', ')}`);
          warn('  → 这是**读数**不是判据：声明 world: false 是"底我自己负责"，不是"这段没人看着"。');
          warn('    甩镜尾巴的近黑（0.037–0.051）是模板设计；真的低到 0.004 以下才值得去看那一帧。');
        }
      }
      if (world?.results?.length) {
        const missing = world.results.filter((r) => r.missing);
        if (missing.length) {
          warn(`\n⚠ 背景守门：${missing.length}/${world.results.length} 个交叠段**没有铺满整帧的背景**`);
          for (const m of missing) {
            warn(`  [${m.id}] t=${m.t.toFixed(2)}s  整帧覆盖绘制 ${m.full} 次（本帧总绘制 ${m.drawAny} 次）${m.handlesTransition ? '，声明了 handlesTransition' : ''}`);
          }
          warn(`  → 这些段的底是纯黑（只有 grain 和暗角），而且亮度统计抓不到。`);
          warn(`    改法三选一：① 在 render 开头画一次全屏背景（scene 自己的 Pass，或 ctx.world）；`);
          warn(`                ② 时间线里写 cut(shot, { world: 'auto' })，由引擎先铺共享背景；`);
          warn(`                ③ 确实是刻意不铺底 → 明确写 cut(shot, { world: false })。`);
          errs.push(`[背景守门] 没铺背景的段：${missing.map((m) => m.id).join(', ')}`);
        } else {
          const riskyAll = [...risky, ...selfRows.filter((r) => r.handlesTransition || r.declaredWorld !== 'none')];
          log(`\n背景守门：${world.results.length} 个交叠段在**交叠窗中点**都铺满了整帧背景（窗后中点只做读数，不判）`
            + `（其中 ${riskyAll.length} 段声明了转场/共享背景）`
            + (selfRows.length
              ? `；另有 ${selfRows.length} 段声明了 world: false（不判铺底，读数见上）`
              : ''));
        }
      } else {
        // 「空 ≠ 干净」：审计跑通了、但一个交叠段都没被翻出来 —— 也就是**零条断言**。
        // 以前这里一行都不打，输出里于是看不出"背景守门这次等于没验"。
        const nSeg = world?.timeline ?? info.timeline?.length ?? 0;
        warn(`\n⚠ 背景守门这次**一条都没验**：时间线 ${nSeg} 段里没有"与前一段交叠"的段（--only 之后更常见）。`);
        warn('  → 这不是"背景都对"，是"没有可查的对象"；有转场的片子这一行不该出现。');
        pushSkipped(skipped, '背景守门（worldAudit）', `跑了，但零条断言（时间线 ${nSeg} 段里没有交叠段，--only 之后更常见）—— 不能算通过`);
      }
    } catch (err) {
      if (err && err.readable) throw err;      // 页面失联：照实抛出，不要吞成"背景守门不可用"
      log(`\n（背景守门不可用：${firstLine(err)}）`);
      pushSkipped(skipped, '背景守门（worldAudit）', firstLine(err));
    }

    // 依赖令牌 `under` 的**段级审计**（BACKLOG 头部 ② 的收口，2026-10-16）。
    //
    // 为什么必须在这里、而不是像 `music`/`analyze` 那样在开浏览器之前用文本扫描判：
    // `whip` 这类模板的画面来自"把上一段的成帧（ctx.under）甩走"，而引擎**只在两段交叠的
    // 那一小段**里给得出 ctx.under（engine.js：`under: k > 0 ? under : null`；交叠窗之外
    // 这一段就是 items[0]，没有"上一段"）。于是"交叠够不够"只在 build() 排完时间之后
    // 才是个事实 —— 源码文本里看不出来（对象可以跨行、可以 seq() 拼、--only 之后段表还会变）。
    //
    // 判据是纯函数 `src/timeline.js` 的 `auditUnderRequires()`（离线单测
    // `tools/test-timeline-audit.mjs`）：missing = 硬问题（画面几乎是黑的且不报错）⇒ errs；
    // noPrev = **没判**（--only 之后必然出现）⇒ 进 skipped，绝不说成"都满足"。
    try {
      const ua = await evaluateSafe(() => /** @type {any} */ (window).__anim.underAudit(), undefined, 'underAudit()');
      const rows = ua?.results ?? [];
      const missing = rows.filter((x) => x.missing);
      const dbl = rows.filter((x) => x.doubleTransition);
      const noPrev = rows.filter((x) => x.noPrev);
      const judged = rows.filter((x) => !x.noPrev);
      if (!rows.length) {
        log(`\n依赖 under：这次**没有可查的对象**（时间线 ${ua?.timeline ?? '?'} 段里没有哪一段声明要读 ctx.under）`
          + '—— 不是"依赖都对"');
      } else {
        // 只在"上面已经打过别的行"时才不补空行 —— 否则标题会粘在上一段输出尾巴上
        const pad = (missing.length || judged.length) ? '' : '\n';
        if (missing.length) {
          warn(`\n⚠ 依赖 under：${missing.length}/${rows.length} 段声明要读 ctx.under，却**与上一段没有交叠**`);
          for (const m of missing) {
            warn(`  [${m.id}] 第 ${m.index + 1} 段 ${m.start.toFixed(2)} → ${m.end.toFixed(2)}s：与上一段没有 overlap`);
          }
          warn('  → ctx.under 只在两段交叠的那一小段里有值，没有交叠时模板退回"没有 under"那条分支 ——');
          warn('    画面几乎是黑的、**而且一个字都不报**（这正是 BACKLOG 1-21 记的"只声明、没接线"）。');
          warn('    改法：给这一段写 overlap（{ type: \'whip\', dur, overlap: 0.5 } 或 cut(whip, { overlap: 0.5 })），');
          warn('          或者把它换成一个自己铺底的模板。');
          errs.push(`[under] 声明要读 ctx.under 却没有交叠的段：${missing.map((m) => m.id).join(', ')}`);
        } else if (judged.length) {
          log(`\n依赖 under：${judged.length}/${rows.length} 段声明要读 ctx.under，都真的与上一段交叠了`);
        }
        if (noPrev.length) {
          const ids = noPrev.map((m) => m.id).join(', ');
          warn(`${pad}⚠ 依赖 under：${noPrev.length} 段**没判**（它在展开后的时间线里是第 1 段，没有"上一段"可比）：${ids}`);
          warn('  → 这不是通过：--only 会把选中的段平移到时间轴开头，所以只挑一段试渲染时必然出现这一行。');
          pushSkipped(skipped, '依赖 under（段级审计）',
            `${noPrev.length} 段没有上一段可比（第 1 段 / --only 之后）：${ids} —— 没验`);
        }
        if (dbl.length) {
          warn(`⚠ 依赖 under：${dbl.length} 段读了 ctx.under，却没声明 handlesTransition（${dbl.map((m) => m.id).join(', ')}）`);
          warn('  → 引擎会在这上面**再叠一次交叉溶解**（engine.js: k > 0 && !scene.handlesTransition），');
          warn('    "甩走"会被稀释成两屏叠一起。改法：场景/时间线上写 handlesTransition: true。');
        }
      }
    } catch (err) {
      if (err && err.readable) throw err;      // 页面失联：照实抛出
      log(`\n（依赖 under 的段级审计不可用：${firstLine(err)}）`);
      pushSkipped(skipped, '依赖 under（段级审计）', firstLine(err));
    }

    /** 采样点 -> 这一帧的版面判定（按段聚合；`check` 汇总时只用它，不额外渲染） */
    const layoutSeen = new Map();
    /** 有几个采样点的记账没读成（读不成 = 那些点没验，收尾进 skipped） */
    let layoutSkipped = 0;
    /** 汇总那一段跑没跑（跑挂了就别再跑，免得刷两遍错） */
    let layoutErrs = false;

    const t0 = Date.now();
    const statsAt = (t, opts) => evaluateSafe(
      ([tt, oo]) => /** @type {any} */ (window).__anim.stats(tt, oo), [t, opts],
      `stats(t=${t.toFixed(2)}s)`,
    );
    // --quick：每段只在 50% 采一个点、只跑单子帧（`quick` 在上面已经取过了 ——
    // 响度那一档也要用它）。用于**快速冒烟**（改完引擎先扫一遍「有没有哪一段直接抛异常」），
    // 不替代完整 check —— 它不看多子帧路径、也不看入场头 1 秒。
    log(quick
      ? '\n--quick：每段只采 50% 一个点、只跑单子帧（冒烟用；完整体检请去掉 --quick）'
      : '\n每段：15% / 50% / 85% 三个点，各测单子帧与多子帧（成片走的路径）');
    let points = 0;
    for (const it of info.timeline) {
      const dur = it.end - it.start;
      const at = (quick ? [0.5] : [0.15, 0.5, 0.85]).map((k) => it.start + dur * k);
      const rows = [];
      for (const t of at) {
        // ⚠ 多子帧路径必须单独验一次：运动模糊整帧过曝 n 倍那个 bug 只存在于这条路，
        //   而 check 以前只跑 samples:1，于是它一路报「没问题」，成片却白到发光。
        let multi = null;
        let multiNote = '';
        let used = 0;
        if (!quick) {
          try {
            multi = await statsAt(t, { samples: 'auto' });
            // ⚠ 必须在跑完这一帧之后、跑 samples:1 之前取：lastSamples 会被下一次渲染覆盖
            used = await getSession().page.evaluate(() => /** @type {any} */ (window).__anim.lastSamples);
          } catch (err) {
            // 页面失联（HMR 重载 / 崩了）是**致命**诊断，别降级成"多子帧不可用"混过去
            if (err && err.readable) throw err;
            multiNote = `  ← ⚠ 多子帧这一条路径**没跑**（skipped）：${firstLine(err)}`;
            // ⚠ what 里**不带时刻**：时刻跟着这一行的内联提示，而 skipped 那一段是按 what
            //   聚合的（带时刻就聚合不起来 —— 页面一崩就是几十行，等于又变回"少打一行"）。
            pushSkipped(skipped, '多子帧路径（成片走的那条）', `[${it.id} t=${t.toFixed(2)}s] ${firstLine(err)}`);
          }
        }
        const one = await statsAt(t, { samples: 1 });
        points++;
        rows.push({ t, one, multi, used });

        // 版面守门（docs/LAYOUT.md）：**白拿**这一帧的记账 —— layoutRows() 不渲染，
        // 读的就是上面 statsAt / multi 那两次渲染留下的 gl.paint.blocks。
        // 必须**点名段**：交叠期同时画着两段，而问题问的是「这一段这一帧画了几块字」。
        try {
          const lr = await getSession().page.evaluate(
            (id) => /** @type {any} */ (window).__anim.layoutRows({ id }), it.id,
          );
          for (const row of lr ?? []) {
            if (!row || !row.id) continue;
            const list = layoutSeen.get(row.id) ?? [];
            list.push({ t: row.verdict?.t ?? 0, verdict: row.verdict });
            layoutSeen.set(row.id, list);
          }
        } catch (err) {
          if (err && err.readable) throw err;      // 页面失联：照实抛出
          layoutSkipped++;
        }

        const tag = `${it.id.padEnd(14)} t=${t.toFixed(2)}s`;
        const parts = [`  ${tag}  单帧 ${one.mean.toFixed(3)}`];
        if (multi) parts.push(`多子帧 ${multi.mean.toFixed(3)}（${used} 子帧）`);
        log(parts.join('  ') + multiNote);

        // 非有限值扫描（`docs/history/STATUS-rounds-1-6.md` §13.4）：场景 shader 写出 NaN / ±Inf 时，
        // 引擎**不会报任何错**：单帧直通后处理 → 整屏白；多子帧被累加 pass 丢掉 → 发黑。
        // 8bit 读回分不出这两者，`stats()` 也分不出，于是 check 只会说
        // 「单子帧与多子帧亮度差了 N×：这是运动模糊求平均/累加的问题」—— 方向完全错。
        // 这里读浮点缓冲直接点名，把"整屏白"从"看图才发现"变成"check 就报"。
        let nf = null;
        try {
          nf = await getSession().page.evaluate(
            (tt) => /** @type {any} */ (window).__anim.nonFinite(tt), t,
          );
        } catch (err) {
          nf = { error: firstLine(err) };
        }
        if (nf && nf.error) {
          // 「空 ≠ 干净」（1-19）：这一项**没跑成**（不是"扫了、没扫到"）。以前它静默消失，
          // 于是"整屏白 = NaN/Inf"这条最贵的诊断会在最需要它的时候不见踪影。
          warn(`      ← ⚠ 非有限值扫描**没跑**（skipped）：${nf.error}`);
          pushSkipped(skipped, '非有限值扫描（NaN/Inf）', `[${it.id} t=${t.toFixed(2)}s] ${nf.error}`);
        }
        if (nf && !nf.error && nf.bad > 0) {
          const pct = ((nf.bad / Math.max(1, nf.pixels)) * 100).toFixed(1);
          const where = nf.first ? `（首个坏像素 x=${nf.first.x} y=${nf.first.y}，${nf.first.kind}）` : '';
          warn(`      ← ⚠ 非有限值：NaN ${nf.nan} / Inf ${nf.inf} / 量级>5e4 ${nf.huge} 像素${where}`);
          warn(`        这是「整屏白 / 单帧白多帧黑」的一类根因：shader 里除了 0、开了 normalize(0)`);
          warn(`        （多半是相机 uniform 全 0）或 pow(0, 负数)。见 node tools/probe-raymarch.mjs`);
          errs.push(
            `[${it.id}] t=${t.toFixed(2)} 场景输出里有非有限值：NaN ${nf.nan} / Inf ${nf.inf} / ` +
            `量级>5e4 ${nf.huge} 像素（占 ${pct}%）${where}`,
          );
        }

        if (one.mean < 0.004) {
          const msg = `[${it.id}] t=${t.toFixed(2)} 几乎全黑（mean=${one.mean.toFixed(4)}），场景可能没画东西`;
          warn(`      ← 几乎是全黑，场景可能没画东西`);
          errs.push(msg);
        }
        if (multi) {
          // 过曝：亮度顶到 0.99 以上的像素太多，或整块死白
          if (multi.blownRatio > 0.2 || multi.clippedRatio > 0.15) {
            const msg = `[${it.id}] t=${t.toFixed(2)} 过曝：亮度>0.99 的像素占 ${(multi.blownRatio * 100).toFixed(1)}%，死白占 ${(multi.clippedRatio * 100).toFixed(1)}%`;
            warn(`      ← 过曝（>0.99 占 ${(multi.blownRatio * 100).toFixed(1)}%，死白 ${(multi.clippedRatio * 100).toFixed(1)}%）`);
            errs.push(msg);
          }
          // 单帧与多子帧的亮度必须一致：不一致 = 运动模糊路径有系统性错误（曾经过曝 n 倍）
          const ratio = multi.mean / Math.max(one.mean, 1e-6);
          if (ratio > 1.3 || ratio < 1 / 1.3) {
            const msg = `[${it.id}] t=${t.toFixed(2)} 单子帧与多子帧亮度差了 ${ratio.toFixed(2)}×（单帧 ${one.mean.toFixed(3)} → 多子帧 ${multi.mean.toFixed(3)}）`;
            warn(`      ← 两条路径不一致（${ratio.toFixed(2)}×）：这是运动模糊求平均/累加的问题，成片会和预览完全不同`);
            // 但如果是"非有限值"，方向就完全不同（累加 pass 会把 NaN/Inf 丢掉 → 单帧白、多帧黑）：
            // 上面那条扫描已经点名了，这里补一句，免得读者照着"累加 bug"去查。
            if (nf && !nf.error && nf.bad > 0) {
              warn(`        ⚠ 但这一帧同时有非有限值 —— 先修那个：累加 pass 丢掉 NaN/Inf 正是"单帧白、多帧黑"的成因。`);
            }
            errs.push(msg);
          }
        }
      }
      // 「这一整段都偏暗」——只看单点会漏掉，因为一个亮点就能把判据顶过去
      const lo = Math.min(...rows.map((r) => r.one.mean));
      const hi = Math.max(...rows.map((r) => r.one.mean));
      if (lo < 0.02 && hi > 0.06) {
        const msg = `[${it.id}] 段内亮度很不均（最低 ${lo.toFixed(3)} → 最高 ${hi.toFixed(3)}）：入场/出场某一段可能没画上东西`;
        warn(`      ← 段内亮度不均（${lo.toFixed(3)} → ${hi.toFixed(3)}）：查入场的头 1 秒和收尾`);
        errs.push(msg);
      }
    }
    log(`\n试渲染 ${info.timeline.length} 段 × ${quick ? 1 : 3} 个点 × ${quick ? 1 : 2} 条路径（共 ${points * (quick ? 1 : 2)} 帧）用了 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // 渲染期间攒下的**运行期警告**（ctx.warnings / engine.warnings：D-1 的孤儿线、
    // kit 的字幕带冲突等）：info 快照取在渲染**之前**（:2558），所以这里必须重取一次。
    // 只打新增的（seen 里记渲染前已有的），每条只打一次 —— 同一句每帧都发生也不刷屏。
    try {
      const after = await getSession().page.evaluate(() => /** @type {any} */ (window).__anim.info());
      const seenWarnings = new Set(info.warnings ?? []);
      let nWarn = 0;
      for (const w of after.warnings ?? []) {
        if (seenWarnings.has(w)) continue;
        seenWarnings.add(w);
        warn(`⚠ ${w}`);
        nWarn++;
      }
      if (nWarn) warn('  → 上面是**渲染中**攒出来的运行期警告（每帧都发生也只报一次）；修掉它们或确认无害。');
    } catch (err) {
      pushSkipped(skipped, '运行期警告收集', '页面失联：' + firstLine(err));
    }

    /**
     * **版面守门**（`docs/LAYOUT.md`，2026-10-16）：钠那期三条外部批评里的两条 ——
     * 「元素互相遮挡害得我搞不清楚到底要看哪个主体」「不如纯看字幕了」—— 都发生在**信息设计**
     * 这一层，而引擎当时对此**一条判据都没有**（`check` 只管亮度 / 背景 / 非有限值 / 依赖令牌）。
     *
     * 判据（都在纯函数 `src/layout.js` 里，离线单测 `tools/test-layout.mjs`）：
     *   ① **每屏几块字**：把挨得近的文字合成「块」（26px 一道的读数面板算一块）再数，超过上限就报；
     *   ② **主体之外还有几个「看的地方」**（「不知道看哪个主体」的直接读数）；
     *   ③ 声明了 `focus` 的段另加一条「主体区里压着几块」。
     *
     * 退出码：**默认只 warn**（「先只报不改退出码」，同 1-19 的 skipped 与 lint-narration-dup），
     * `--strict` 才进 errs —— 现在每个任务都必然超限（这套阈值是一条新纪律），
     * 让 check 默认非零退出会把回归清单永久染红，反而没人看了。
     */
    if (!layoutErrs) {
      try {
        const rows = layoutReport([...layoutSeen.entries()].map(([id, samples]) => ({ id, samples })));
        const summary = layoutSummary(rows);
        const limits = info.layoutLimits ?? {};
        if (!rows.length) {
          warn('\n⚠ 版面守门这次**一条都没验**：一个采样点都没拿到绘制记账。');
          pushSkipped(skipped, '版面守门（layoutAudit）', '时间线里没有段可采样 —— 不能算通过');
        } else {
          log(`\n版面守门：${summary.judged}/${summary.segments} 段采到了文字绘制 · 最挤的一帧 ${summary.peak} 块`
            + `（上限 ${limits.maxBlocks ?? '?'}；主体之外 ≤ ${limits.maxOffSubject ?? '?'}）`
            + `${quick ? '（--quick：每段只采 50% 一个点）' : ''}`);
          for (const r of rows) {
            const w = r.worst;
            if (!w) { warn(`  ${String(r.id).padEnd(14)} 没采到（渲染失败或这一段没有文字）`); continue; }
            const mark = r.violations.length ? '⚠' : ' ';
            const extra = r.violations.length
              ? `  ← ${r.violations.map((v) => v.detail).join('；')}（${r.over}/${r.samples} 个采样点超限）`
              : '';
            log(`  ${mark} ${String(r.id).padEnd(14)} t=${w.t.toFixed(2)}s  ${w.blocks} 块（${w.draws} 次文字绘制）`
              + `  主体区 ${focusReading(w)}${extra}`);
          }
          if (summary.violates.length) {
            warn(`\n⚠ 版面守门：${summary.violates.length}/${summary.judged} 段**一屏的东西太多**`);
            warn('  观众对钠那期的原话：「有些动画元素相互遮挡害得我搞不清楚到底要看哪个主体」。');
            warn('  → 改法（都不需要动引擎）：① 读数**一次只揭一个**（同屏别一次亮 6 个数）；');
            warn('    ② 画面文字只放**标注**（名词 / 数字 / 出处），句子交给旁白与字幕；');
            warn('    ③ 场景里声明 focus（或时间线上写 focus: { x, y, w, h } / focus: center）——');
            warn('      声明之后「主体区里压了几块 / 主体之外还有几个看的地方」才有判据（见 docs/LAYOUT.md）；');
            warn('    ④ 几个**一行读得完**的标注合成一行（kit 的 labelRow）：判据 ② 数的是"看的地方"，');
            warn('      分三处写的 LOW / MID / HIGH 是三个入口，写成一行就只是一块（docs/LAYOUT.md §1 的「标注可以合并成一行」）。');
            if (strict) {
              for (const r of summary.violates) {
                errs.push(`[版面守门] ${r.id}：${r.violations.map((v) => v.detail).join('；')}`);
              }
            }
          }
          if (summary.noFocus.length) {
            warn(`\n⚠ 版面守门：${summary.noFocus.length} 段**没有主体声明** ——「这一段看哪里」没判`
              + '（数量判据跑了，但「主体区里压了几块 / 主体之外还有几个看的地方」这两条**没跑**）。');
            warn(`  段：${summary.noFocus.join(', ')}`);
            pushSkipped(skipped, '版面守门·主体声明（focus）',
              `${summary.noFocus.length} 段声明不了主体（场景读不到 focus）：${summary.noFocus.join(', ')} —— 约束没验`);
          }
          if (summary.unjudged.length) {
            pushSkipped(skipped, '版面守门（layoutAudit）',
              `${summary.unjudged.length} 段一次采样都没拿到：${summary.unjudged.join(', ')} —— 没验`);
          }
        }
      } catch (err) {
        layoutErrs = true;
        log(`\n（版面守门汇总失败：${firstLine(err)}）`);
        pushSkipped(skipped, '版面守门（layoutAudit）', firstLine(err));
      }
    }
    if (layoutSkipped) {
      pushSkipped(skipped, '版面守门（采样）', `${layoutSkipped} 个采样点的记账没读成 —— 那些点没验`);
    }

    /**
     * 节奏腿（BACKLOG 1-35，2026-10-17）：镜头长度变异系数（CoV）—— **纯静态**，零渲染。
     *
     * 判据【外部经验值】：CoV ≥ 0.25 否则整片是节拍器（onetake 的 motion-web 三版教训：
     * v1 匀速 dolly / v2 等长硬切都被否「依然是 PPT」，v3 镜头 0.22–2.2s 通过；
     * 两条通过片实测 0.44 / 0.67）。**默认只报读数**（与版面守门同例 —— 已交付的
     * 匀速片子必然命中，让它 gate 会把回归清单永久染红）；`--strict` 才进 errs。
     * 单段 / `--only`：不存在镜头长度分布 ⇒ 进 skipped（「没判 ≠ 通过」）。
     *
     * 静帧占比（≥25%、最长静段 ≥1s）这一半**需要逐帧渲染**，不在这里跑 ——
     * `anim carry` 顺路看，或将来 `check --rhythm`；先把免费的这半做进来。
     */
    {
      const { rhythmStats } = await import("../../src/timeline.js");
      const r = rhythmStats(info.timeline ?? []);
      if (r.noRhythm) {
        pushSkipped(skipped, '节奏（镜头长度 CoV）', `时间线只有 ${r.count} 段，没有长度分布可判 —— 这一条没跑`);
      } else {
        const mark = r.metronome ? '⚠' : ' ';
        log(`\n节奏（静态）：${r.count} 段镜头长度 CoV ${r.cov.toFixed(2)}（最短 ${r.min.toFixed(2)}s / 最长 ${r.max.toFixed(2)}s）`
          + `  ${r.metronome ? '⚠ 低于 0.25 —— 节拍器' : '· ≥ 0.25'}`);
        if (r.metronome) {
          warn('  匀速镜头长度在观众眼里就是"一格一格翻灯片"，不管每个镜头内部多好看（onetake 的三版教训）。');
          warn('  → 镜头长度该由旁白与信息量决定（docs/NARRATION.md），长枪 8–13s、短击 2–4s、burst 里 0.2–0.5s，别平摊。');
          if (strict) errs.push(`[节奏] 镜头长度 CoV ${r.cov.toFixed(2)} < 0.25 —— 节拍器（${r.count} 段，最短 ${r.min.toFixed(2)}s / 最长 ${r.max.toFixed(2)}s）`);
        }
      }
    }

    /**
     * **画面语义断言**（BACKLOG 1-18，2026-10-17）：`tasks/<任务>/motion.json` 里的四种断言 ——
     * before（纯静态，不渲染）/ appearsBy / keepsMoving / noEdgeContent。
     *
     * 采样计划与判读都是纯函数（`src/timeline.js` 的 `planMotionAsserts` / `motionVerdict`，
     * 离线单测 `tools/test-motion-assert.mjs`）；页面侧只负责按计划渲帧算 changedRatio
     * （`__anim.motionAudit`，写法对照 worldAudit）。两条元设计（REFERENCE-hyperframes §4.2）：
     *   ① **持久性感知** —— 单点超限、下一采样点恢复的瞬态降级 info，永不 gate；
     *   ② **空 ≠ 干净** —— 没声明的段 / 没跑成的行都进 skipped，绝不当通过。
     *
     * 退出码：命中**默认只 warn**（同版面守门的"先只报不改退出码"——已交付的片子没写过
     * motion.json，一命中就 gate 会把回归清单永久染红）；`--strict` 才进 errs。
     * `--quick`：渲染类只跑 appearsBy，keepsMoving / noEdgeContent 这次没跑（明说）。
     */
    if (motionSpec) {
      const m0 = Date.now();
      const { planMotionAsserts, motionVerdict } = await import("../../src/timeline.js");
      const plan = planMotionAsserts(info.timeline ?? [], motionSpec);
      const tot = plan.totals;
      log('\n画面语义断言（motion.json）：' + tot.asserts + ' 条断言 —— 静态 before ' + tot.static
        + ' 条 · 渲染类 ' + tot.render + ' 条（阈值 changed ' + plan.thresholds.changed + ' / edgeSafe ' + plan.thresholds.edgeSafe + '）');
      if (tot.missing) warn('其中 ' + tot.missing + ' 条断言的段名在时间线里找不到（段名拼错，或 --only 之后段表变了）—— 单列，绝不当通过');
      if (tot.ignored) warn('其中 ' + tot.ignored + ' 条断言形状不认识、没生效（断言名该是 before / appearsBy / keepsMoving / noEdgeContent）');
      // --quick 省时档：渲染类只跑 appearsBy（2 帧/条）；keepsMoving 全段逐 0.5s 扫太贵、这次没跑
      const quickRows = quick ? plan.render.filter((r) => r.kind === 'appearsBy') : plan.render;
      const planRun = quick ? { ...plan, render: quickRows } : plan;
      if (quick) {
        const skipKeeps = plan.render.filter((r) => r.kind === 'keepsMoving');
        const skipEdge = plan.render.filter((r) => r.kind === 'noEdgeContent');
        if (skipKeeps.length) {
          pushSkipped(skipped, '画面语义断言（keepsMoving）',
            '--quick 省时档：' + skipKeeps.length + ' 条 keepsMoving 这次没跑（全段逐 0.5s 扫帧太贵）—— 没判 ≠ 通过');
        }
        if (skipEdge.length) {
          pushSkipped(skipped, '画面语义断言（noEdgeContent）',
            '--quick 省时档：' + skipEdge.length + ' 条 noEdgeContent 这次没跑（只跑 appearsBy）—— 没判 ≠ 通过');
        }
      }
      /** 实际要渲的帧数（报告「试渲染时间涨了多少」的口径；noEdgeContent 的记账白拿，只算渲的 1 帧） */
      const framesRun = quickRows.reduce((n, r) =>
        n + (r.kind === 'appearsBy' ? 2 : r.kind === 'keepsMoving' ? r.times.length * 2 : r.times.length), 0);
      let rows = null;
      if (quickRows.length) {
        try {
          const audit = await evaluateSafe(
            (rs) => /** @type {any} */ (window).__anim.motionAudit(rs), quickRows, 'motionAudit()',
          );
          rows = audit?.rows ?? null;
        } catch (err) {
          if (err && err.readable) throw err;      // 页面失联：照实抛出
          log('（画面语义断言不可用：' + firstLine(err) + '）');
          pushSkipped(skipped, '画面语义断言（motionAudit）', firstLine(err));
        }
      }
      const v = motionVerdict(planRun, rows);
      if (v.errors.length) {
        warn('\n画面语义断言：' + v.errors.length + ' 条命中');
        for (const e of v.errors.slice(0, 12)) warn('  · [' + e.kind + '] ' + e.id + ' —— ' + e.message);
        if (v.errors.length > 12) warn('  · …另有 ' + (v.errors.length - 12) + ' 条');
        warn('  → 改时间线 / 改场景让断言成立，或删掉 motion.json 里对应的断言（断言是验收口径，不是装饰）。');
        if (strict) {
          for (const e of v.errors) errs.push('[画面语义断言·' + e.kind + '] ' + e.id + '：' + e.message);
        }
      }
      for (const inf of v.infos) {
        // 持久性感知的降级（单点瞬态）：打出来给人看，**永不 gate**
        log('  ℹ [' + inf.kind + '] ' + inf.id + ' —— ' + inf.message);
      }
      for (const s of v.skipped) {
        pushSkipped(skipped, '画面语义断言（' + (s.kind || '其他') + '）', s.id ? '[' + s.id + '] ' + s.why : s.why);
      }
      log('  判定：' + v.passed + ' 条通过 · ' + v.errors.length + ' 条命中（' + (strict ? '--strict：已进 errs' : '默认只 warn，--strict 才 gate')
        + '） · ' + v.infos.length + ' 条瞬态（info，不 gate） · ' + v.skipped.length + ' 条没判');
      log('  （画面语义断言用了 ' + ((Date.now() - m0) / 1000).toFixed(1) + 's、多渲 ' + framesRun + ' 帧'
        + (quick ? '；--quick 下 keepsMoving / noEdgeContent 这次没跑' : '') + '）');
    }



    /**
     * P0-3：**场景抛异常必须是硬失败**。
     *
     * 这条以前完全缺失，而它正是 beast 那轮最贵的一口：`check` 只读一次 `info`
     * （装载期的错误），而 render 期的异常是在**它之后**才产生的 ——
     * 于是"某个时刻起整屏暗红"这件事，三次采样全绿、控制台一个字都没有。
     * 现在渲染完再回读一次，并且**当成错误**（不是附注）。
     */
    const rerr = await collectRenderErrors({ take: false });
    if (rerr.count) {
      warn(`\n⚠ 场景在渲染时抛异常：${rerr.count} 帧`);
      for (const line of rerr.text.slice(0, 10)) warn('  · ' + line);
      warn(`  → 那些帧画出来的是**错帧卡片**（暗红底 + 红框 + ✗ SCENE ERROR），不是画面内容。`);
      errs.push(...rerr.text.map((t) => `[场景异常] ${t}`));
    }

    // 浏览器控制台里的 pageerror 一律算失败：场景里的 TypeError 会先在这里露出来
    // （以前只在末尾附注打印，很容易被漏读）。
    const pageErrs = getSession().consoleLog.filter((l) => l.startsWith('[pageerror]'));
    for (const l of pageErrs) errs.push(`[浏览器异常] ${l}`);

    // 3) 可选：把每个采样点拼成接触表，一张图看全片（--sheet）
    if (flag('sheet')) {
      const all = [];
      for (const it of info.timeline) {
        const dur = it.end - it.start;
        for (const k of [0.15, 0.5, 0.85]) all.push(it.start + dur * k);
      }
      // ⚠ `--sheet` 可以**不带值**：`opt('sheet', …)` 在「选项存在但后面没跟值」时返回 undefined
      //   （opt 取的是 `rest[i + 1]`），直接喂 path.resolve 会 `ERR_INVALID_ARG_TYPE`。
      //   2026-10-16 跑 `check _shots-lab --quick --sheet` 撞到的**既有 bug**（AGENTS.md 里
      //   那条 `check <task> [--sheet]` 一直是这样写的，只是没人跑过带 flag 的那条路）。
      //   另一个坑：`--sheet --quick` 时 opt 会把下一个 flag 当成值 ⇒ 用 startsWith('-') 挡掉。
      const sheetArg = opt('sheet', '');
      const sheetPath = path.resolve(ROOT, sheetArg && !String(sheetArg).startsWith('-') ? sheetArg
        : taskOut(task, 'check', 'contact.png'));
      await writeContactSheet(all, sheetPath);
      log(`✓ 接触表 ${path.relative(ROOT, sheetPath)}（${all.length} 格，每段 15%/50%/85%）`);
    }

    if (getSession().consoleLog.length) {
      warn('\n浏览器控制台：');
      for (const l of getSession().consoleLog.slice(0, 15)) warn('  ' + l);
    }

    /**
     * 「空 ≠ 干净」（`docs/BACKLOG.md` 1-19）：把**没跑成 / 被跳过 / 不可用**的审计
     * 明明白白列出来，并且写进结论行。这一段永远出现（哪怕是 `skipped: 无`）——
     * 否则"确实全跑了"和"这一段整个没执行"在输出里长得一模一样。
     *
     * ⚠ 不改退出码：`tools/regress-all.mjs` 有 10 个 `check:*` 项依赖它。
     *   要把它当门用就显式 `--strict`（默认关）。
     */
    const skippedLines = formatSkipped(skipped);
    if (skipped.length) { warn(''); for (const line of skippedLines) warn(line); }
    else log(`\n${skippedLines[0]}`);
    if (strict && skipped.length) {
      warn(`  --strict：把 ${skipped.length} 项"没跑"当成失败（退出码 1）。`);
      process.exitCode = 1;
    }
    if (errs.length) {
      /**
       * 逐条打印**为什么红**。
       *
       * 以前这里只打一行"✗ 有 N 个问题" —— 每条错误各自的 warn 早就打过了
       * （背景守门 / under / 亮度 / 非有限值），但 `--strict` 新接入的两类**只在 errs 里、
       * 不在上面任何一行**（`[旁白复述]` 与 `[版面守门]`），于是"退出码 1 + 只给个数字"。
       * 这与 `reportErrors()` 的既有做法一致（那里也是把 errs 逐条打出来）。
       * 上限 12 条：再多也没人读，后面还有结论行。
       */
      warn(`\n✗ 为什么红（${errs.length} 条）：`);
      for (const e of errs.slice(0, 12)) warn(`  · ${e}`);
      if (errs.length > 12) warn(`  · …另有 ${errs.length - 12} 条`);
      warn(`\n${checkVerdictLine({ problems: errs.length, skipped: skipped.length })}`);
      process.exitCode = 1;
    } else {
      // ⚠ `--quick` **只跑单子帧** —— 结论行不许说"两条路径都验过了"。
      //    那正是 1-19 要消灭的东西（没跑却说跑了）：`--quick` 本身不是失败，
      //    但它是**省掉了一半检验**，必须在结论行里如实讲出来，否则读输出的 agent
      //    会把"冒烟过了"当成"完整体检过了"（2026-10-10 主代理跑 `check demo --quick` 时抓到）。
      log(`\n${checkVerdictLine({ skipped: skipped.length })}${quick
        ? '（--quick：**只验了单子帧**这一条路径 —— 多子帧（成片真正走的那条）与入场头 1 秒这次都没看，交付前请去掉 --quick 再跑一次）'
        : '（单子帧与多子帧两条路径都验过了）'}`);
    }
  } finally { await closeSession(); }
}

/** 扫描场景源码里的非确定性写法。 */
function scanScenes(task) {
  const out = [];
  const dir = path.join(ROOT, 'tasks', task, 'scenes');
  if (!existsSync(dir)) return out;
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  const bad = [
    [/Math\.random\s*\(/, 'Math.random() —— 换成 rng(seed)（离线渲染会乱序多次调用本函数）'],
    [/Date\.now\s*\(/, 'Date.now() —— 时间只能来自 f.t'],
    [/performance\.now\s*\(/, 'performance.now() —— 时间只能来自 f.t'],
    [/new\s+Date\s*\(/, 'new Date() —— 时间只能来自 f.t'],
  ];
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return; // 注释里提到不算
      for (const [re, why] of bad) if (re.test(line)) out.push(`${f}:${i + 1} ${why}`);
    });
  }
  return out;
}

export { SHOT_DEP_WHAT, audioDeclaredInConfig, blankJsComments, scanShotUsage, shotDependencyFacts, shotDependencyIssues, shotDependencyReport, taskShotSources };
export { cmdCheck as run };
