// @ts-check
import { die, warn } from "./log.mjs";
import { getSession } from "./session.mjs";
/* ------------------------------ 空 ≠ 干净（BACKLOG 1-19）与守门措辞（1-3）：纯函数 */

/**
 * 「空 ≠ 干净」的收集器（`docs/BACKLOG.md` 1-19）。
 *
 * 三个外部参考项目独立指向同一个失败模式：**浏览器没跑起来时那几个 section 是空的**，
 * 而空输出「读起来像一份干净的报告，其实什么都没跑」（对方原话：*empty, not clean —
 * which reads like a clean file but means nothing ran*）。
 *
 * 这条在本 CLI 里有四个真实落点，以前每一个都只是**少打一行**（背景守门 catch、
 * `lint-narration-dup` 没跑成、多子帧路径失败、非有限值扫不出来）：
 * 读输出的 agent 看到的是「这次 check 没报错」＝ 通过。现在它们一律进这个列表。
 *
 * ⚠ **`skipped` 不许改变退出码**：`tools/regress-all.mjs` 里有 10 个 `check:*` 项依赖
 *   `check` 的退出码语义（"零退出 = 这次体检没发现问题"）。想把它当门用只能显式加
 *   `--strict`（默认关）。
 *
 * @typedef {{ what: string, why: string }} SkippedAudit
 * @param {SkippedAudit[]} list
 * @param {string} what 是什么没跑（一句话，读的人据此判断"这块地方没验过"）
 * @param {unknown} why 为什么没跑（原始原因：异常 / 退出码 / 页面能力缺失）
 * @returns {SkippedAudit[]} 同一个数组（便于 `skipped = pushSkipped(skipped, …)` 一行写）
 */
function pushSkipped(list, what, why) {
  list.push({ what: String(what), why: firstLine(why) });
  return list;
}

/** 取一句话（多行异常的堆栈不带进报告里）。 */
function firstLine(x) {
  const s = String(x == null ? '' : (x.message ? x.message : x));
  const line = s.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return line.trim() || '(没有说明)';
}

/**
 * 版面守门那一行里的「主体区 …」怎么写（**纯函数**，离线单测钉住 —— 见 `tools/test-layout.mjs`）。
 *
 * 为什么不是一句 `${w.inFocus} 块`：一段的主体是**图形**（方波 / 格阵 / 波形，文字只是标注）时，
 * 主体区里天然一个字块都没有 —— 而"主体是图形"与"这一段什么都没画"在读数上原本长得一样，
 * 简报里那条「主体区 0 块看起来像没画东西」说的就是它（交接单 F）。
 *
 * 所以分这几种写法，**判据一个字都没放松**（判据 ② 在 0 块时本来就恒成立）：
 *   · 主体区有字          → `N 块`（照旧）；
 *   · 0 块 + 画了图形     → `0 块字（这一帧的主体是图形：N 次非文字绘制）`；
 *   · 0 块 + 一笔都没有   → `0 块字，而且**一笔非文字绘制都没有**`（比原来的措辞更明确）；
 *   · 没声明 focus        → `未声明`（判据没跑，不许说成通过）。
 *
 * @param {any} w `layoutReport()` 的那一行（读 `focus` / `inFocus` / `focusNote` / `nonTextDraws`）
 * @returns {string}
 */
function focusReading(w) {
  if (!w?.focus) return '未声明';
  const n = Number.isFinite(w.inFocus) ? w.inFocus : 0;
  if (n > 0) return `${n} 块`;
  const draws = Number.isFinite(w.nonTextDraws) ? w.nonTextDraws : 0;
  switch (w.focusNote) {
    case 'graphics': {
      // 拆开报"矢量批次 / 全屏 Pass"：`lines.flush()` **一次**里可以有几百条线段，
      // 只说一个总数会让人以为"只画了 3 个东西"（hook 那条整条方波就是 1 个批次）。
      const lns = Number.isFinite(w.nonTextLines) ? w.nonTextLines : 0;
      const ps = Number.isFinite(w.nonTextPasses) ? w.nonTextPasses : 0;
      return `0 块字（这一帧的主体是图形：${draws} 次非文字绘制`
        + `（矢量批次 ${lns} · 全屏 Pass ${ps}）；${w.blocks} 块字全是标注）`;
    }
    case 'empty':
      return '0 块字，而且**一笔非文字绘制都没有**（这一屏看起来确实没画东西）';
    default:
      // `unjudged`（拿不到绘制账 / 错帧卡片）：宁可说"没判"，也不说 0
      return '0 块字（这一帧的绘制账没读到 —— 主体是图形还是空屏**没判**）';
  }
}

/**
 * 把 `skipped` 列表渲染成输出里的那一段（纯函数，可离线单测）。
 *
 * 三条刻意的设计：
 *   ① 标题就是 `skipped:` —— 与外部三份参考报告的用词对齐，读的人一眼知道这是"没跑"；
 *   ② 每一条既有 **what**（是什么没跑）也有 **why**（为什么），缺一个就又会退化成"少打一行"；
 *   ③ 这一段**永远出现**（哪怕是 `skipped: 无`）—— 否则"确实全跑了"与"这段整个没执行"
 *      在输出里长得一样，那正是 1-19 要消灭的东西。
 *
 * @param {SkippedAudit[]} skipped
 * @returns {string[]} 要打印的行（不带缩进；调用方决定 warn 还是 log）
 */
function formatSkipped(skipped) {
  const list = Array.isArray(skipped) ? skipped : [];
  if (!list.length) return ['skipped: 无（这次体检的每一项审计都真的跑了）'];
  /**
   * 按 **what** 聚合（同一件事失败 N 次只占一行，写出 ×N）。
   * 为什么必须聚合：多子帧路径与非有限值扫描是**每个采样点**各一次 —— 页面一崩就是
   * 「13 段 × 3 点 × 2 项」几十条，一段 60 行的 skipped 没人会读，等于又变回"少打一行"。
   * 聚合只动显示，不动收集（`why` 保留第一次的原文，多行内联提示照旧带着时刻）。
   */
  const groups = new Map();
  for (const s of list) {
    const key = String(s?.what ?? '?');
    const g = groups.get(key);
    if (g) g.n++;
    else groups.set(key, { n: 1, why: String(s?.why ?? '(没有说明)') });
  }
  const lines = [`skipped: ${list.length} 项没跑 —— 这些地方**没有验过**，不要当成通过：`];
  for (const [what, g] of groups) lines.push(`  · ${what}${g.n > 1 ? ` ×${g.n}` : ''}：${g.why}`);
  lines.push('  （想让"有跳过"变成非零退出：加 --strict —— 默认不改退出码，见 docs/BACKLOG.md 1-19）');
  return lines;
}

/**
 * 结论行（纯函数，可离线单测）：**必须把"跳过了 N 项"写进去**。
 *
 * 1-19 的判据就是这个：结论行里只要没有 skipped 的身影，"N 项没跑"和"全跑过了"
 * 在收尾处就长得一模一样。
 *
 * @param {{ problems?: number, skipped?: number, quick?: boolean }} o
 */
function checkVerdictLine(o = {}) {
  const problems = Number(o.problems ?? 0);
  const skipped = Number(o.skipped ?? 0);
  const tail = skipped
    ? `（另有 ${skipped} 项**没跑**，见上面的 skipped）`
    : '（skipped: 无）';
  if (problems) return `✗ 有 ${problems} 个问题${tail}`;
  return `✓ 没有发现问题${tail}`;
}

/**
 * 产物守门失败 → 「这是哪一类失败 + 下一步该做什么」（纯函数，可离线单测）。
 *
 * `docs/BACKLOG.md` 1-3：以前守门失败一律补一句"重跑即可"。但**拼接 / 封装那一步是确定性的**
 * —— 同一份输入、同一条命令，跑一千次还是同样的帧数差，重跑只是白等（上一轮就照着重跑了
 * 一次，白等 30 秒，帧数一模一样）。反过来，分块渲染那一步**确实**能靠重跑恢复（已渲好的块
 * 会跳过），所以也不能一刀切删掉"重跑"。正确的做法是按「已知原因（确定性、重跑无意义） /
 * 未知原因（可能是瞬时、重跑有意义）」分开说，并且各自给出**下一步做什么**。
 *
 * 判据只吃**已经算好的事实**（`problems` 就是 `checkVideoFile()` 返回的那个字符串数组），
 * 所以这里不会与 ffprobe 的调用时机耦合。
 *
 * @param {{
 *   problems: string[],        // checkVideoFile() 的问题列表（原样，别改写）
 *   expected?: number|null,    // 期望帧数
 *   got?: number|null,         // 渲染侧/ffprobe 给的帧数（拿不到就不传）
 *   phase: string,             // 'chunk' | 'stitch' | 'final' | 'parallel' | 'render'
 *   step?: string,             // 人话的"哪一步"（默认按 phase 取）
 *   chunk?: { i: number, n: number, range?: string },  // 分块路径才有
 *   reusable?: boolean,        // 分块路径：已渲好的块会被复用（= 重跑真的能只补没渲完的块）
 *   retryable?: boolean,       // 调用方**已判定**能靠重跑恢复（例如纯渲染帧数不足）
 * }} o
 * @returns {{ kind: 'input'|'transient'|'encode'|'stitch'|'scene'|'unknown',
 *             known: boolean, retryWorthwhile: boolean,
 *             headline: string, next: string[], retryLine: string }}
 */
function decideGateFailure(o) {
  const problems = (o?.problems ?? []).map((s) => String(s));
  const phase = String(o?.phase ?? 'final');
  const text = problems.join('\n');

  /** 已知的确定性根因是否命中？（命中则与"可能是瞬时的"互斥） */
  const empty = /0 字节/.test(text);
  const noFrames = /读不到帧数|没有可解码的画面/.test(text);
  const fpsBad = /帧率 .* ≠ 期望/.test(text);
  const noMoov = /moov atom not found|没 finalize/.test(text);
  const unreadable = /打不开|读不出/.test(text);
  // ⚠ "ffprobe 退出码 N" 单独拿出来判：它既可能是文件坏了（确定性），
  //   也可能是 ffprobe 不在 PATH / 起不来（环境问题，属于**瞬时**那一类，
  //   说成"已知原因"就会把人指偏）。只有环境那类才走 unknown。
  const probeEnv = /ENOENT|不是内部或外部命令|command not found|not recognized/i.test(text);
  const probeExit = /退出码/.test(text) && !probeEnv;
  const frameDiff = /数出 (\d+) 帧，期望 (\d+) 帧/.exec(text);
  const expected = o?.expected ?? (frameDiff ? Number(frameDiff[2]) : null);
  const got = o?.got ?? (frameDiff ? Number(frameDiff[1]) : null);
  const diff = frameDiff ? Number(frameDiff[1]) - Number(frameDiff[2]) : null;

  /**
   * 分块路径**默认**是"重跑有意义"的（已渲好的块会跳过，重跑只补这一块）；
   * 其余调用方必须自己声明 `retryable` —— 默认 false，因为守门失败的第一嫌疑
   * 永远是**确定性的**（同样的输入 ⇒ 同样的结果），说成"重跑就好"会把人指偏。
   */
  const chunkRetry = phase === 'chunk' && o?.reusable !== false;
  const retryable = o?.retryable === true || chunkRetry;

  let kind = 'unknown';
  if (empty || noFrames || noMoov || unreadable || probeExit) {
    // 「文件根本读不出来」这一类：ffmpeg 没把文件写完（半截流 / 没写 moov），
    // 或者根本读不到流。它**不是**"渲染少渲了几帧"。
    kind = 'encode';
  } else if (fpsBad) {
    // 帧数对、帧率/时间戳不对 = 拼接时的 `-copyts` 那类问题，与容器记账有关
    kind = 'stitch';
  } else if (frameDiff) {
    if (phase === 'chunk' && (o?.reusable !== false)) kind = 'scene';
    else if (phase === 'stitch' || phase === 'final' || phase === 'parallel') kind = 'stitch';
    else if (Math.abs(diff) >= 1 && Math.abs(diff) <= 60) kind = 'stitch';   // 差几帧 ⇒ 音轨记账切尾
    else kind = 'unknown';
  } else {
    kind = 'unknown';
  }
  // 调用方**确知**是哪一类时可以直接指定（例如 checkTimestamps 的报错文案里没有上面那些
  // 关键词，但"帧数对、时间戳不齐"在语义上就是拼接这一步的问题）。
  if (!o?.hint && text && /帧距不齐|首帧 PTS|时间戳/.test(text) && !frameDiff) kind = 'stitch';
  if (o?.hint) kind = String(o.hint);

  const STEP = {
    chunk: '分块渲染（这一块）', stitch: '拼接 / 封装', final: '产物守门', parallel: '并行渲染',
    render: '渲染',
  };
  const step = o?.step ?? STEP[phase] ?? '产物守门';
  const chunkTag = o?.chunk ? `第 ${o.chunk.i}/${o.chunk.n} 块${o.chunk.range ? `（${o.chunk.range}）` : ''}` : '';
  const nExp = expected != null ? `${expected} 帧` : '期望帧数';
  const nGot = got != null ? `${got} 帧` : '实际帧数';

  /** 已知原因：确定性、重跑无意义 —— 给出**该做什么**，不给"重跑"。 */
  const knownNext = {
    encode: [
      `已知原因（确定性）：${chunkTag ? chunkTag + '的' : ''}这个文件 ffmpeg 没写完 —— 半截流 / 没写 moov / 0 字节，渲染进程还没 finalize 就被结束了。`,
      '下一步：① 先把预期帧数与实际帧数对一遍（差几帧 ⇒ 尾部被切；差很多 ⇒ 中途断流）；',
      '        ② 帧数差在个位数且这条命令带音轨 ⇒ 看封装参数是不是 -af apad 与 -shortest 成对（AAC 的记账时长比视频短几十毫秒，会把视频尾巴切掉）；',
      '        ③ 差几十上百帧 ⇒ 是渲染中途断流：渲染期间不要写仓库里任何文件（改一次就 HMR 重载 → 断流），渲染时也别让别的进程清理 out/；',
      '        ④ 修完再跑 —— 这一步的结果由文件与参数决定，**不修任何东西的重跑一定是同一个错**。',
    ],
    stitch: [
      `已知原因（确定性）：拼接 / 封装这一步出错，画面本身没问题（各块都已经单独通过守门）。`,
      frameDiff && diff != null && Math.abs(diff) <= 60
        ? `  上面这条「${nGot} ≠ ${nExp}（差 ${diff > 0 ? '+' : ''}${diff}）」是**尾部被切掉**的典型签名：音轨封装用了 -shortest 却没有 -af apad —— AAC 有 priming/padding，音频流的记账时长比视频短几十毫秒，于是视频尾巴被当成"多余"切掉几帧。`
        : '  先看上面那条 ffprobe 到底差了几帧、差在哪个方向，再对号入座。',
      '下一步：① 核对封装参数：`-af apad` 与 `-shortest` 必须**成对**出现（apad 让音轨变无限长，-shortest 才会停在视频最后一帧）；',
      '        ② 核对拼接参数：concat 必须带 `-copyts`（否则帧数对、时间戳不均匀，帧率会变成 60.08 那种）；',
      '        ③ 改完再跑同一条命令 —— 已渲好的块会跳过，不需要重渲画面。',
    ],
    scene: [
      chunkTag
        ? `已知原因（确定性）：这一块**自己**少渲了 ${Math.abs(diff ?? 0)} 帧 —— 画面停在半路，多半是场景在某个时刻抛异常 / 页面在渲染途中崩了（HMR 重载也走这条路）。`
        : '已知原因（确定性）：渲染侧没有收满帧 —— 画面停在半路。',
      '下一步：① 先定位是哪一段、哪个时刻：node scripts/anim.mjs check <任务>（会点名段与时刻）；',
      '        ② 出那一帧的图看：node scripts/anim.mjs still <任务> -t <时刻> --only <段>；',
      '        ③ 渲染期间**一个文件都别写**（连 docs/*.md 也不行：编辑器的原子写挡不住 watch，撞 EBUSY 会让 Vite 崩）；',
      '        ④ 改完再跑同一条命令 —— 已渲好的块会跳过，重跑只补没渲完的块。',
    ],
    input: [
      `已知原因（确定性）：ffprobe 在这个文件里读不到视频流（帧数 / 分辨率都拿不到），所以"帧数对不对"这件事**根本没有验过** —— 它不等于"验过了、没问题"。`,
      '下一步：① 确认产物真的被写出来了（文件大小 > 0）、路径就是命令行里那一条；',
      '        ② 若是从别处拷来的文件，重新跑一遍出片命令（分块路径下已渲好的块会跳过）。',
    ],
  };

  /** 未知原因：可能是瞬时 —— 重跑**可能**好，但要先做一件比重跑便宜的事。 */
  const unknownNext = [
    '这条不匹配任何已知的确定性根因，所以**可能是瞬时的**（磁盘满 / 内存或句柄耗尽 / 杀软或同步盘锁住了文件 / GPU 掉线 / 被外部进程中断）。',
    '下一步（按这个顺序）：① 先看那条原始报错本身（上面的 · 行），别跳过它去重跑；',
    '                      ② 确认磁盘还有空间、out/ 没被别的进程（清理 / 同步盘）碰过；',
    retryable
      ? '                      ③ 再重跑同一条命令：已渲好的部分会跳过，代价只是没渲完的那部分。'
      : '                      ③ 确认上面两条之后可以重跑一次；若**同样**的错再来一次，它就属于确定性失败，别再重跑，按 check → still 的顺序定位。',
  ];

  const next = knownNext[kind] ?? unknownNext;
  const where = chunkTag ? `${chunkTag} ` : '';
  const what = kind === 'stitch' ? '拼接 / 封装出错'
    : kind === 'encode' ? '文件没写完（半截流 / 没写 moov）'
      : kind === 'scene' ? '画面没渲完'
        : kind === 'input' ? '产物读不出视频流'
          : '产物读不出来';
  const headline = kind === 'unknown'
    ? `${step}失败：原因未知（可能是瞬时，也可能是没被识别出来的确定性根因）。`
    : `${step}失败：${where}${what} —— 这是**已知原因**（确定性），重跑不会有不同结果。`;
  // ⚠ 收尾那句必须与 `kind` 一致：未知原因那一档**不能**说"重跑一定得到同样的结果"
  //   （那正好和它自己的 "可能是瞬时的" 打架 —— 样例输出就是这么发现这处矛盾的）。
  const retryLine = retryable && kind !== 'unknown'
    ? '  重跑有意义（已渲好的部分会跳过）：但先按上面的「下一步」做一件事再跑，别原地空转。'
    : kind === 'unknown'
      ? '  重跑**可能**有用（这类失败不保证可复现）；但先把上面那几件事查一遍再跑，别拿重跑当诊断。'
      : '  ⚠ 不要直接重跑同一条命令：这一步是确定性的，不修任何东西的重跑会得到**同样的**结果。';

  return {
    kind, known: kind !== 'unknown', retryWorthwhile: retryable, headline, next, retryLine,
    expected, got, diff,
  };
}

/**
 * 守门失败的报告正文（纯函数，可离线单测）：问题列表 + 分类 + 下一步。
 * @param {{ problems: string[], title?: string }} o
 * @param {Parameters<typeof decideGateFailure>[0]} ctx
 * @returns {string[]}
 */
function gateFailureLines(o, ctx) {
  const d = decideGateFailure({ ...ctx, problems: o.problems });
  const lines = [o.title ?? '产物验收不通过：', ...(o.problems ?? []).map((b) => `  · ${b}`)];
  if (ctx && ctx.note) lines.push(`  （${ctx.note}）`);
  lines.push('', `  ${d.headline}`, ...d.next.map((l) => `  ${l}`), d.retryLine);
  return lines;
}

function reportErrors(info) {
  const errs = [...(info.timelineProblems ?? [])];
  for (const e of info.errors ?? []) errs.push(e);
  if (errs.length) {
    warn('\n⚠ 有错误：');
    for (const e of errs.slice(0, 20)) warn('  ' + e);
  }
  if (info.gaps?.length) {
    warn('\n⚠ 时间线有空档（这些时间段会渲染成黑色）：');
    for (const g of info.gaps) warn('  ' + g);
  }
  return errs;
}

/**
 * 渲染完之后问页面「有哪些场景抛过异常」。
 *
 * ⚠ 时机必须在推流**结束之后**：契约禁止在回 ack 前调 `page.evaluate`
 *   （页面正跑同步渲染循环等 ack，我们却去问它 → 死锁）。收尾阶段循环已经停了，
 *   这时候问是安全的，而且能补上 WS 诊断可能漏掉的部分。
 *
 * ⚠ 默认**取走并清零**（`take`）：分块渲染时每一块都是独立的一次 `renderToFile`，
 *   如果只读不清，第 2 块会把第 1 块的异常也算到自己头上。
 *
 * @param {{ take?: boolean }} [opts]
 * @returns {Promise<{ count: number, text: string[] }>}
 */
async function collectRenderErrors(opts = {}) {
  if (!getSession()) return { count: 0, text: [] };
  try {
    return await getSession().page.evaluate(
      (take) => {
        const api = /** @type {any} */ (window).__anim;
        return take ? api.takeRenderErrors() : api.renderErrors();
      },
      opts.take !== false,
    );
  } catch {
    return { count: 0, text: [] };
  }
}

/**
 * 场景抛异常 = 硬失败（P0-3）：**不产出、非零退出、点名是哪一段**。
 *
 * 为什么不能只警告：错帧卡片会**正常地**流进成片（帧数够、ffprobe 也挑不出毛病），
 * 于是 CLI 打印 ✓、成片里却有一段是崩溃卡片。旧行为更糟 —— 整帧暗红，
 * 连"这是崩了"都看不出来（beast 那次 check 三次全绿）。
 */
function failOnRenderErrors(errs, extra = '') {
  if (!errs || !errs.count) return;
  warn(`\n✗ 有 ${errs.count} 帧渲染时场景抛异常，画面不可用：`);
  for (const line of errs.text.slice(0, 8)) warn('  · ' + line);
  if (errs.text.length > 8) warn(`  · …还有 ${errs.text.length - 8} 处的段`);
  warn(`\n  这些帧画出的是**错帧卡片**（暗红底 + 红框 + ✗ SCENE ERROR），不是画面内容。`);
  // ⚠ 措辞按「已知 / 未知」分开（`docs/BACKLOG.md` 1-3）：场景抛异常是**确定性**的 ——
  //   同一份代码、同一个时刻，跑多少次都是同一个异常。以前这里只说"复现"，
  //   读的人很容易顺手重跑一遍出片命令，白等一整片的时间（而且产物还是会被删掉）。
  warn(`  ${knownCauseHeadline('scene')}`);
  warn(`  下一步：① 复现并点名：node scripts/anim.mjs check <任务>（会报段名与时刻）；`);
  warn(`          ② 看那一帧的图：node scripts/anim.mjs still <任务> -t <时刻> --only <段>；`);
  warn(`          ③ 改代码 —— **不要直接重跑出片**：不修代码的重跑会得到同样的错帧卡片。`);
  if (extra) warn('\n' + extra);
  process.exitCode = 1;
  die(`场景抛异常，已停止（不产出成片）。`);
}

/**
 * 一句"这是已知原因 / 原因未知"的定性（纯函数，与 `decideGateFailure` 同一套口径）。
 * @param {'scene'|'interrupted'} kind
 */
function knownCauseHeadline(kind) {
  if (kind === 'scene') {
    return '这是**已知原因**（确定性）：场景代码在某个时刻抛异常，重跑不会有不同结果。';
  }
  if (kind === 'interrupted') {
    return '这是**已知原因**（确定性）：画面渲染到一半停了（断流/崩溃），同一份代码、同样的环境重跑会停在同一个地方。';
  }
  return '这条不匹配任何已知的确定性根因，可能是瞬时的（磁盘满 / 内存耗尽 / 被外部中断 / GPU 掉线）。';
}

export { checkVerdictLine, collectRenderErrors, decideGateFailure, failOnRenderErrors, firstLine, focusReading, formatSkipped, gateFailureLines, knownCauseHeadline, pushSkipped, reportErrors };
