// @ts-check
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { opt } from "./args.mjs";
import { ROOT } from "./paths.mjs";
import { isGlobalSource } from "../engine-graph.mjs";
/* ------------------------------------------------------------------ 分块复用指纹 */

/**
 * 分块的**渲染参数指纹**（`docs/history/IMPROVEMENTS-1-3.md` P1-1）。
 *
 * 为什么必须要有：`out/<任务>/<任务>.parts/` 里的分块只按时间区间命名，
 * 复用时不看任何参数。于是做了 x264 vs NVENC 对照实验时，第二次运行**秒完成**
 * 并报「✓ 出片成功」—— 其实那些块是上一次渲的，看起来像"NVENC 快得离谱"。
 * 这个坑差点让我得出错误结论。
 *
 * 指纹由**两半**组成，缺一不可：
 *   · 渲染参数：fps / samples / shutter / scale / vcodec / crf|cq / preset / x264-params；
 *   · 场景与引擎的 mtime 签名：tasks/<任务>/ 下所有源文件 + 引擎的 .js 文件。
 * 后一半是"改了场景但忘了 --force"这种更常见的情况。
 *
 * @returns {{ params: Record<string, any>, scene: string, text: string }}
 */
function renderFingerprint(task, { fps, samples, shutter }) {
  const vcodec = opt('vcodec', 'libx264');
  const isNvenc = vcodec.endsWith('_nvenc');
  const params = {
    fps: Number(fps),
    samples: String(samples),
    shutter: Number(shutter),
    scale: Number(opt('scale', '0')) || 'task',
    vcodec,
    crf: vcodec.startsWith('libx264') ? String(opt('crf', '16')) : null,
    cq: isNvenc ? String(opt('cq', '19')) : null,
    preset: String(opt('preset', '')),
    x264: String(opt('x264', 'aq-mode=3')),
    tol: opt('tol', null),
  };
  const text = `fps=${params.fps} samples=${params.samples} shutter=${params.shutter} scale=${params.scale} `
    + `vcodec=${params.vcodec} crf=${params.crf} cq=${params.cq} preset=${params.preset} x264=${params.x264}`;
  return { params, scene: sceneSignature(task), text };
}

/** 这些目录改了**不会**影响画面（音频/字体是运行时素材，out 是产物） */
const SKIP_DIRS = new Set(['node_modules', 'out', '.git', 'audio', 'fonts']);
/** mtime 快照关心的源文件（只看会进模块图的那几类） */
const MTIME_EXT = /\.(js|mjs|css|html|json)$/i;
/** 场景签名关心的文件（多算了字体：字体换了画面就变） */
const SOURCE_EXT = /\.(js|mjs|json|css|woff2?|ttf|otf)$/i;

/**
 * 递归收集目录下匹配 `accept` 的文件，跳过产物/素材目录。
 * `sourceMtimes()` 与 `sourceFiles()` 共用这一份 —— 以前两处各写一个 walk，
 * 排除表已经差点漂移（一个排 audio，另一个也排，但扩展名表不同步）。
 *
 * @param {string} dir
 * @param {RegExp} accept
 * @param {string[]} [out]
 * @returns {string[]}
 */
function walkSourceTree(dir, accept, out = []) {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkSourceTree(p, accept, out);
    } else if (accept.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * 模块图内文件的 mtime 快照（`路径 -> mtimeMs`）。渲染前后各取一次，
 * 用来把"渲染期间改了文件"从"静默断流"变成一句点名的话（P2-2）。
 * @returns {Map<string, number>}
 */
function sourceMtimes() {
  const map = new Map();
  for (const dir of [path.join(ROOT, 'tasks'), path.join(ROOT, 'src')]) {
    for (const p of walkSourceTree(dir, MTIME_EXT)) {
      try { map.set(p, statSync(p).mtimeMs); } catch { /* ignore */ }
    }
  }
  const vite = path.join(ROOT, 'vite.config.mjs');
  try { map.set(vite, statSync(vite).mtimeMs); } catch { /* ignore */ }
  return map;
}

/**
 * 对比渲染前后的 mtime 快照，返回变化过的文件（相对路径 + 方向）。
 * @returns {string[]}
 */
function changedSources(before, after) {
  if (!before || !after) return [];
  const out = [];
  for (const [f, t] of after) {
    const b = before.get(f);
    if (b === undefined) out.push(`${path.relative(ROOT, f)}（新增）`);
    else if (Math.abs(b - t) > 1) out.push(`${path.relative(ROOT, f)}（改动）`);
  }
  for (const [f] of before) if (!after.has(f)) out.push(`${path.relative(ROOT, f)}（删除）`);
  return out;
}

/**
 * 列出会影响画面的源文件：任务目录 + 引擎 src/（排除 out/ 之类）。
 */
function sourceFiles(task) {
  return [
    ...walkSourceTree(path.join(ROOT, 'tasks', task), SOURCE_EXT),
    ...walkSourceTree(path.join(ROOT, 'src'), SOURCE_EXT),
  ];
}

/**
 * 场景签名 = 所有源文件的 `相对路径:大小:mtime`。任何一个变了就变。
 * 用 mtime + size 而不是内容哈希：几千个文件读一遍内容太慢，而
 * "改了文件 → mtime 变"对这里的用途（判断"这一块是不是拿旧代码渲的"）已经够。
 */
function sceneSignature(task) {
  const parts = [];
  for (const f of sourceFiles(task)) {
    try {
      const st = statSync(f);
      parts.push(`${path.relative(ROOT, f)}:${st.size}:${Math.round(st.mtimeMs)}`);
    } catch { /* 读不到就跳过 */ }
  }
  parts.sort();
  return parts.join('|');
}

/**
 * 引擎改动 → **原子签名表**（BACKLOG 1-45 的细化版）。
 *
 * ## 以前的做法与代价
 *
 * 老版本把 `src/` 下**所有**文件的 mtime 拼成一个总签名，塞进每一块 ⇒ 改一行引擎注释
 * 就等于整片重渲。对一个 70 分钟的片子，这把「改一个镜头」和「改一个底层函数」的代价拉平了。
 *
 * ## 现在的做法
 *
 *   · **地基**（`src/core/` `src/style/` `src/app.js` `src/timeline.js` `public/` …）仍然
 *     合成**一个**总签名 `g:` —— 它们被所有块依赖，改动就是整批失效（省时间也更不易错）；
 *   · **其余源文件**（`src/kit/` `src/shots/` 这些通用件）各自一个原子签名
 *     `f:<相对路径>:<大小>:<mtime>`，**只有真正用到它的块**才把它们拼进自己的块签名。
 *
 * 于是「改了 `src/shots/chart.js`，而这片子根本没用 chart」⇒ 块的签名不变 ⇒ 直接复用。
 * 实测（本仓 138 个场景）：改 `chart.js` 只波及 8 个场景 / 2 个任务；改 `kit/pixel.js` 53 个。
 *
 * ## 保守规则（错了就是"拿旧块冒充新画面"，比多渲一块贵得多）
 *
 *   · 文件消失（被删）也进表 —— 否则删掉一个模板会被当成"没变"；
 *   · 读不到（权限 / 刚被删）记 `missing`，照样让签名变；
 *   · 解析不出 import 的文件由 `classifyEngineChange()` 直接判整批，不进这张表。
 *
 * @returns {{ global: string, atoms: Map<string, string> }}
 *   `global` 是地基的总签名（打进每一块）；`atoms` 是 `相对路径 -> 原子签名`
 */
function engineAtoms() {
  const files = [];
  walkSourceTree(path.join(ROOT, 'src'), SOURCE_EXT, files);
  walkSourceTree(path.join(ROOT, 'public'), SOURCE_EXT, files);
  const keys = new Set(files.map((f) => path.relative(ROOT, f).split(path.sep).join('/')));
  for (const extra of ['vite.config.mjs']) {
    if (existsSync(path.join(ROOT, extra))) keys.add(extra);
  }
  /** @type {Map<string, string>} */
  const atoms = new Map();
  /** @type {string[]} */
  const globalParts = [];
  for (const rel of [...keys].sort()) {
    let sig;
    try {
      const st = statSync(path.join(ROOT, rel));
      sig = `${rel}:${st.size}:${Math.round(st.mtimeMs)}`;
    } catch {
      // ⚠ 读不到**不等于没变**：旧文件被删掉时这里会抛，必须留痕（否则整批复用旧画面）
      sig = `${rel}:missing`;
    }
    atoms.set(rel, sig);
    if (isGlobalSource(rel)) globalParts.push(sig);
  }
  return { global: globalParts.join('|'), atoms };
}

/**
 * 读/写分块目录旁的指纹文件。返回 `{ changed: string[], fingerprint }`。
 * @returns {{ changed: string[], fp: ReturnType<typeof renderFingerprint> }}
 */
function segmentManifest(segDir, task, optsNow) {
  const fp = renderFingerprint(task, optsNow);
  const file = path.join(segDir, 'params.json');
  let prev = null;
  try { prev = JSON.parse(readFileSync(file, 'utf8')); } catch { /* 第一次跑 */ }
  const changed = [];
  if (!prev) changed.push('首次渲染（没有参数记录）');
  else {
    for (const k of Object.keys(fp.params)) {
      if (JSON.stringify(prev.params?.[k]) !== JSON.stringify(fp.params[k])) {
        changed.push(`${k}: ${JSON.stringify(prev.params?.[k])} → ${JSON.stringify(fp.params[k])}`);
      }
    }
    if (prev.scene !== fp.scene) changed.push('tasks/ 或 src/ 下的源文件变了（改了场景或引擎）');
  }
  return { changed, fp, file, prev };
}

export { changedSources, engineAtoms, segmentManifest, sourceMtimes };
