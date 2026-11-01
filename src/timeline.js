// @ts-check
/**
 * 时间线 DSL。目标是让「剪辑」这件事在代码里一眼能读：
 *
 *   import { seq, cut, par, to } from '../../src/timeline.js';
 *   import hello from './scenes/hello.js';
 *
 *   export default {
 *     title: '演示',
 *     timeline: seq([
 *       cut(hello, { dur: 4 }),
 *       cut(other, { dur: 6, params: { variant: 'b' } }),
 *       par(2.0, [cut(a, { dur: 4 }), cut(b, { dur: 4, fadeIn: true })]),  // 重叠 2s 交叉溶解
 *     ]),
 *   };
 *
 * 规则：
 *   - 硬切 = 两段首尾相接（默认就是硬切，最像剪辑师）
 *   - 转场 = 让两段重叠：par(overlap, [...])，或给 cut 传 { overlap: 0.5 }
 *   - 时间既可以写秒，也可以写 { beat: 16 } / { bar: 4 }，由 music 解析
 *
 * 场景名与 id：id 默认取场景文件名，重复时自动加 _2。id 会出现在 HUD 和错误里。
 *
 * ## 配置档（B 档）：不写场景文件，直接写镜头模板
 *
 * `src/shots/` 的镜头模板可以**直接写进时间线**，没有 `scene`、只有 `type`：
 *
 *   export default {
 *     timeline: [                                   // 数组、seq([...]) 都行
 *       { type: 'title', title: '我的片子', dur: { beat: 8 } },
 *       { type: 'chart', values: [0.3, 0.7, 0.95], title: '成绩', dur: 5 },
 *       { type: 'outro', title: '完', dur: 3 },
 *     ],
 *   };
 *
 * 规则（都靠"写错就抛"兜底）：
 *   - **时间线字段**：`type` `id` `dur` `at` `overlap` `params` `post` `maxSamples`
 *     `handlesTransition` `note` `world`/`worldPass`；
 *   - **其余所有键**都当模板参数交给 `shot(type, {…})`（键名写错会抛错并列出可用参数）；
 *   - `id` 不写就用模板自己的默认段名；
 *   - `dur` 不写 = 4 秒（与 `cut(scene)` 一致）；
 *   - 一条时间线里不要混"配置档节点"和**已经展开好的**段（带 start/end 的那种）。
 *   —— 展开发生在 `build()` 里，由 `src/tasks.js` 负责选路；见 `docs/CONFIG-ONLY.md`。
 */

import { shot } from './shots/index.js';

/** 配置档节点：`{ type: 'chart', values: […], dur: 5 }`（只有 type，没有 scene）。 */
export function isConfigNode(node) {
  return !!(node && typeof node === 'object' && typeof node.type === 'string' && node.scene == null);
}

/**
 * 配置档节点里属于**时间线**的键；其余键都是镜头模板的参数。
 * ⚠ 这张表是公开 API：往时间线节点上加新字段时，记得同时加到这里，
 *   否则它会被当成模板参数、被 `shot()` 当成"参数名拼错"抛出去。
 */
const TIMELINE_KEYS = new Set([
  'type', 'id', 'dur', 'at', 'overlap', 'params', 'post', 'maxSamples',
  'handlesTransition', 'note', 'world', 'worldPass',
  // 主体声明（版面守门，docs/LAYOUT.md）：配置档节点上也写得了 ——
  // 不加进这张表它就会被当成模板参数，"参数名拼错"抛出去（正是这张表存在的理由）。
  'focus',
  // 连贯声明（carry 审计，BACKLOG 1-34 / docs/REFERENCE-onetake.md §2.3①）：
  // 取值 morph = 跨元素合成的衔接（量具判 bare、但对观众成立）、
  // anchor = 刻意锚定、any = 交给量具（不豁免不预设）。
  'carry',
  // 交叠期的转场模式（2026-10-24）：默认 push（甩镜）、显式 mix = 交叉溶解、
  // none = 不处理（硬切）。配置档节点上也能写 —— 不加进这张表它会被当成模板参数。
  'transition',
  // 相机接力的运动曲线与换手窗（BACKLOG 1-12）：{ move, handover }（move 取 glide/whip，
  // handover 是换手窗 [w0, w1]），只在 transition 取 relay 的段上有意义。
  // 配置档节点上也能写 —— 不加进这张表它会被当成模板参数。
  // ⚠ 注释里别写带单引号的词：tools/lint-doc-facts.mjs 用单引号提取器解析这张表。
  'transitionOpts',
]);

/**
 * 把配置档节点展开成 `cut()` 的形状。
 *
 * 模板参数 = 节点上除时间线字段以外的**所有**键（也可以显式写在 `params` 里，它优先）。
 * 键名写错会**抛错**：`{ type: 'chart', value: […] }`（少个 s）→ 指名"没有参数 value"，
 * 而不是静默吃默认值画出一张看起来正常的图（`docs/history/IMPROVEMENTS-1-3.md` 那类 bug 的通用解法）。
 */
function configToCut(node, where) {
  const { type, id, dur, at, overlap, params, post, maxSamples, handlesTransition, note, world, worldPass, focus, carry, transition, transitionOpts, ...rest } = node;
  const tparams = { ...rest, ...(params ?? {}) };
  if (id != null) tparams.id = id;          // ⚠ 不能写成 tparams.id = id：undefined 会盖掉模板默认段名
  let scene;
  try {
    scene = shot(type, tparams);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    throw new Error(`${where} 这一段（type: ${JSON.stringify(type)}）取不到镜头模板：\n  ${msg}`);
  }
  // 展开后的形状与 cut() 完全一致 —— 后面的排版（start/dur/overlap/id 去重）走同一条路
  return {
    kind: 'cut',
    scene,
    id: id ?? scene.id,
    dur,
    at,
    overlap,
    params: {},
    post,
    maxSamples,
    handlesTransition,
    note,
    world: worldPass ? 'auto' : world,
    focus,
    carry,
    transition,
    // 相机接力的运动曲线与换手窗（BACKLOG 1-12）：照 transition 键的同一条路径落到段上
    transitionOpts,
  };
}

/**
 * 声明一段。
 * @param {any} scene 场景对象、类，或 () => import('./scenes/x.js') 懒加载
 * @param {{ id?: string, dur?: number, params?: Record<string, any>, post?: any,
 *           maxSamples?: number, handlesTransition?: boolean, note?: string,
 *           overlap?: number, at?: number, world?: any, worldPass?: boolean,
 *           focus?: 'center'|{x:number,y:number,w:number,h:number}|{cx:number,cy:number,w:number,h:number} }} [opts]
 *        `world`：这一段用的**共享背景**（两种写法）——
 *          `world: 'auto'`（或 `worldPass: true`）→ 用 ctx.worldPass（task.config 里那个）；
 *          `world: new Pass(...)`                → 这一段专用；
 *          `world: false`                        → 明确表示"本段自己负责整帧底"。
 *        不写 = 场景自己在 render 里画背景（引擎不做任何假设）。
 *        `focus`：**主体声明**（版面守门，见 docs/LAYOUT.md）—— 「这一段观众看哪里」。
 *        不写时引擎会退回场景对象自己声明的那份（`export default { focus: 'center' }`）。
 */
export function cut(scene, opts = {}) {
  return {
    kind: 'cut',
    scene,
    id: opts.id ?? nameOf(scene),
    dur: opts.dur,
    at: opts.at,
    params: opts.params ?? {},
    post: opts.post,
    maxSamples: opts.maxSamples,
    handlesTransition: opts.handlesTransition,
    note: opts.note,
    overlap: opts.overlap ?? 0,
    world: opts.worldPass ? 'auto' : opts.world,
    // 主体声明（版面守门）：与 world 一样在这里白名单化 —— 忘了这一行就会静默丢失
    focus: opts.focus,
    // 连贯声明（carry 审计）：段对象上声明这条缝的衔接方式（'morph' | 'anchor' | 'any'），
    // 场景对象上声明的那份由 planCarryBoundaries 自己读（it.carry ?? scene.carry）。
    carry: opts.carry,
    // 交叠期的转场模式（2026-10-24 起默认为 'push' 甩镜）：'mix' = 交叉溶解、'none' = 硬切。
    transition: opts.transition,
    // 相机接力（BACKLOG 1-12）：{ move?: 'glide'|'whip', handover?: [w0,w1] }，
    // 只在 transition: 'relay' 时被 engine composite 读（不透传 = 静默丢失，与 focus 同一条教训）。
    transitionOpts: opts.transitionOpts,
  };
}

/**
 * 顺序排列。每一项依次接上；cut 里给了 overlap 的话就和前一段重叠那么多秒。
 * @param {any[]} items
 * @param {{ start?: number }} [opts]
 */
export function seq(items, opts = {}) {
  if (!Array.isArray(items)) {
    throw new Error(`seq() 需要数组，收到 ${typeName(items)}。写法：seq([cut(a,{dur:4}), cut(b,{dur:6})])`);
  }
  // ⚠ 立刻校验，而不是等到 build()：写错的地方离抛错的地方越近越好排。
  for (let i = 0; i < items.length; i++) assertNode(items[i], `seq([...]) 第 ${i} 项`);
  return { kind: 'seq', items, start: opts.start ?? 0 };
}

/**
 * 并行/重叠：把若干项放在同一个时间起点，用 overlapBefore 控制与前一组重叠多久。
 * @param {number} overlap 与「上一组」的重叠秒数
 * @param {any[]} items
 */
export function par(overlap, items) {
  if (!Array.isArray(items)) {
    throw new Error(`par() 的第二个参数需要数组，收到 ${typeName(items)}。写法：par(0.5, [cut(a,{dur:4})])`);
  }
  for (let i = 0; i < items.length; i++) assertNode(items[i], `par(${overlap}, [...]) 第 ${i} 项`);
  return { kind: 'par', overlap, items };
}

/** 便捷：一段独占 [a, b) 的场景。 */
export function at(a, b, scene, opts = {}) {
  return cut(scene, { ...opts, at: a, dur: b - a });
}

/**
 * 把 seq/par/cut 结构展开成引擎要的扁平时间线。
 * @param {any} plan
 * @param {{ beats?: number[], downbeats?: number[], bpm?: number, duration?: number,
 *           narration?: ReturnType<import('./core/narration.js').makeNarration> }} [music]
 */
export function build(plan, music = {}) {
  /** @type {any[]} */
  const out = [];
  const used = new Map();

  /**
   * 整个 plan 的形状也得先过一遍。两个都会**静默产出空时间线**、然后在很远的地方
   * 报一句"没有场景"：
   *   · 漏了 seq()/数组：`timeline: { scene, dur: 4 }`；
   *   · 认不出的 kind：`timeline: { kind: 'sequence', items: [...] }`（拼错了名字）。
   */
  if (!Array.isArray(plan) && !(plan && typeof plan === 'object' && plan.kind)
      && !(plan && typeof plan === 'object' && plan.scene)
      && !isConfigNode(plan)) {
    throw new Error(
      `build() 收到的不是时间线：${plan === undefined ? 'undefined' : previewKeys(plan)}\n` +
      `  task.config.mjs 里应该写 timeline: seq([cut(a,{dur:4}), …]) 或 timeline: [cut(…)]。`,
    );
  }
  if (plan && typeof plan === 'object' && plan.kind && !['seq', 'par', 'cut'].includes(plan.kind)) {
    throw new Error(
      `build() 认不出这个时间线节点：kind = ${JSON.stringify(plan.kind)}\n` +
      `  只认 'seq' / 'par' / 'cut'（由 seq() / par() / cut() 产出）。` +
      (typeof plan.kind === 'string' ? ` 你是不是想写 '${plan.kind.trim().toLowerCase()}'？` : ''),
    );
  }
  assertNode(plan, 'timeline');

  const resolveTime = (v, fallback) => {
    if (v == null) return fallback;
    if (typeof v === 'number') return v;
    if (typeof v === 'object' && v.beat != null) return beatTime(music, v.beat);
    if (typeof v === 'object' && v.bar != null) return beatTime(music, v.bar * 4);
    return fallback;
  };

  // 「配置档节点」与「已经展开好的段」混在同一条时间线里 → 后者会被重新排一遍、
  // 绝对时间被静默丢掉。这类混写没有正当用法（两种写法各写各的），所以直接抛。
  let sawConfig = false;
  let sawLaidOut = false;

  /** 返回这一组结束的时刻 */
  const walk = (node, cursor, where) => {
    if (Array.isArray(node)) {
      let c = cursor;
      for (let i = 0; i < node.length; i++) c = walk(node[i], c, `${where}[${i}]`);
      return c;
    }
    if (!node) return cursor;
    if (node.kind === 'seq') {
      let c = resolveTime(node.start, cursor);
      const items = Array.isArray(node.items) ? node.items : [];
      for (let i = 0; i < items.length; i++) c = walk(items[i], c, `${where}.items[${i}]`);
      return c;
    }
    if (node.kind === 'par') {
      const start = Math.max(0, cursor - (node.overlap ?? 0));
      let end = start;
      const items = Array.isArray(node.items) ? node.items : [];
      for (let i = 0; i < items.length; i++) {
        const e = walk(items[i], start, `${where}.items[${i}]`);
        if (e > end) end = e;
      }
      return end;
    }
    // 走到这里必须是一个 cut。`seq([...])` / `par()` 已经在构造时校验过，
    // 但**手搓的 plan**（`timeline: { kind:'seq', items:[...] }`，或整个 plan 写错）
    // 绕过了那层 —— 所以这里再兜一次底（P0-2：静默降级比直接报错贵得多）。
    if (node.kind !== 'cut') assertNode(node, where);
    // 配置档（B 档）：`{ type: 'chart', values: […], dur: 5 }` —— 在这里展开成 cut 的形状，
    // 后面的排版逻辑（start/dur/overlap/id 去重）与手写场景走**同一条路**。
    if (isConfigNode(node)) sawConfig = true;
    else if (!node.kind && node.scene && typeof node.start === 'number' && typeof node.end === 'number') sawLaidOut = true;
    const c = isConfigNode(node) ? configToCut(node, where) : node;
    const start = resolveTime(c.at, Math.max(0, cursor - (c.overlap ?? 0)));
    // dur 也支持 { beat: 8 } / { bar: 2 }：用拍网格算，镜头长度天然对齐音乐
    // 以及 { vo: 'line-id' }：直接取某句旁白的时长（`docs/NARRATION.md` A 档）——
    // 省掉"在外面把每句话量一遍、再手抄回时间线"这一步。
    const dur = resolveDur(c.dur, music, 4);
    let id = c.id || 'scene';
    if (used.has(id)) { const n = used.get(id) + 1; used.set(id, n); id = `${id}_${n}`; } else used.set(id, 1);
    out.push({
      id,
      scene: c.scene,
      start,
      end: start + dur,
      params: c.params,
      post: c.post,
      maxSamples: c.maxSamples,
      handlesTransition: c.handlesTransition,
      // 主体声明（版面守门，见 docs/LAYOUT.md）：搬运到段上，引擎的 ctx.focus 读它。
      // 场景对象自己也可以声明一份，段上这份优先 —— 同一支片子里某一段想换主体时不必去改场景文件。
      // ⚠ 2026-10-26 前这里只写 c.focus：场景对象上声明的 focus（如 kit/info.js 的 infoShot）
      //   对 `anim check` 的版面守门**不可见**（守门读 it.focus，不读 scene.focus），
      //   引擎渲染倒是能合并（item.focus ?? scene.focus）—— 于是出现"渲染知道主体、
      //   审计却说没声明"的分叉。补上 ?? scene?.focus 后两条路径同源。
      focus: c.focus ?? c.scene?.focus ?? null,
      note: c.note,
      // 共享背景：'auto' = 用 task.worldPass；对象 = 本段专用 Pass；false = 本段自己负责底
      world: c.world,
      // 连贯声明（carry 审计，BACKLOG 1-34）：搬运到段上，`planCarryBoundaries()` 读它。
      carry: c.carry,
      // 交叠期转场模式（2026-10-24）：默认 'push'（甩镜），'mix' / 'none' 显式退回。
      // 搬到段上，`composite()` 的默认转场逻辑读它（等于把配置档节点的 transition 带到引擎）。
      transition: c.transition,
      // 相机接力（BACKLOG 1-12）：{ move, handover } 落到段上，composite() 的 relay 分支读它
      // —— 照 transition 键的同一条路径走（cut() / 配置档节点两种写法都到得了）。
      transitionOpts: c.transitionOpts,
    });
    return start + dur;
  };

  walk(plan, 0, 'timeline');
  if (sawConfig && sawLaidOut) {
    throw new Error(
      '时间线里不能混写「配置档节点」和「已经展开好的段」：\n' +
      '  · 配置档节点 = { type: \'chart\', values: […], dur: 5 }（要由 build() 排时间）；\n' +
      '  · 展开好的段 = { id, scene, start, end, … }（绝对时间是有意义的）。\n' +
      '  build() 会把后者也当成一个节点重新排，它的 start/end 就被静默丢掉了。\n' +
      '  → 统一成一种写法：都写配置档，或者都写 cut()/seq()。',
    );
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/* ------------------------------------------------------------------ 校验 */

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'Array';
  return typeof v;
}

/** 只打印前几个 key，别把一个巨大的对象灌进日志 */
function previewKeys(v) {
  try {
    const ks = Object.keys(v);
    return ks.length ? `{ ${ks.slice(0, 6).join(', ')}${ks.length > 6 ? ', …' : ''} }` : '{}';
  } catch { return String(v); }
}

/**
 * 校验一个"应该长成时间线节点"的东西 —— 不是就**立刻抛错**。
 *
 * 为什么必须抛（`docs/history/IMPROVEMENTS-1-3.md` P0-2）：做 beast 时我写了个助手
 * `const seg = (id) => ({ scene: SHOT[id], opt: {...} })`，忘了让它返回 `cut(scene, opt)`。
 * 旧 `seq()` 照单全收，引擎把它当成 N 段匿名场景：每段默认 4 秒 → `check` 报
 * 「时长 48.00s、段名 scene/scene_2/…」，真实时间线是 127.5s / 12 个具名段，
 * 而末尾照样打印 `✓ 没有发现问题`。**片长和段名全错，却一路绿灯** —— 这类静默降级
 * 比直接报错贵得多（我会照着错的时间线去调镜头长度）。
 *
 * 判据（两条，都是"必然写错"的形状）：
 *   ① 有 `kind` —— cut() / seq() / par() 的返回值，放行；
 *   ② 没有 `kind`，但有 `scene` —— **必须同时给出 `dur` 或 `end`**，那才算"手写了一整段"。
 *      只给 `{ scene, opt }` / `{ scene }` 一律拒绝：那正是"忘了调 cut()"的形状，
 *      而 `opt`（本该是 `params`/`dur`/`overlap`）会被静默丢掉、每段退化成默认 4 秒。
 */
export function assertNode(node, where = 'timeline') {
  // 数组 = 一串节点（`timeline: [ {...}, {...} ]` 的配置档写法就走这条），walk() 会逐项走
  if (Array.isArray(node)) return node;
  if (node && typeof node === 'object' && node.kind) return node;
  if (node && typeof node === 'object' && node.scene && (node.dur != null || node.end != null)) return node;
  // 配置档（B 档）：`{ type: 'chart', … }` —— 形状本身就无歧义，不要求给 dur（不给 = 4 秒）
  if (isConfigNode(node)) return node;

  const got = node && typeof node === 'object' ? previewKeys(node) : `${typeName(node)} ${String(node)}`;
  const looksLikeForgottenCut = !!(node && typeof node === 'object' && node.scene);
  throw new Error(
    `这不是时间线节点：${where} = ${got}\n` +
    `  时间线的每一项必须是 cut(scene, { dur }) / seq([...]) / par(秒, [...]) / at(a, b, scene) 的返回值，\n` +
    `  或者一个**配置档节点**：{ type: 'chart', values: […], dur: 5 }（见 docs/CONFIG-ONLY.md）；\n` +
    `  手写整段的话要给出时长：{ scene, dur: 4 } 或 { scene, start: 0, end: 4 }。\n` +
    (looksLikeForgottenCut
      ? `  ⚠ 有 scene 但没有时长 —— 你是不是忘了调 cut()？\n` +
        `     把 \`{ scene: SHOT[id], opt: {...} }\` 改成 \`cut(SHOT[id], {...})\`；\n` +
        `     否则 opt 里的 dur/overlap/params 会被全部忽略，每段退化成默认 4 秒。`
      : `  ⚠ 检查这里是不是拼错了变量（比如写成了 undefined），或者 type 写成了非字符串。`),
  );
}

/**
 * 把秒数 / `{ beat }` / `{ bar }` / `{ vo }` 解析成秒。
 *
 * `{ vo: 'line-id' }` 取的是**那句旁白自己的时长**（不是"到下一句之前"）——
 * 于是 `cut(shot, { dur: { vo: 'hook-1' } })` 的意思是"这一段和这句话一样长"。
 * 句子不存在时抛错（名字写错要立刻知道，别静默退化成默认 4 秒）。
 *
 * @param {any} v
 * @param {{ beats?: number[], bpm?: number, narration?: any }} music
 * @param {number} fallback
 */
function resolveDur(v, music, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error(`dur 必须是有限数（秒），收到 ${v}。NaN/±Inf 会把这一段的 end 污染成 NaN，整条时间线跟着错。`);
    }
    return v;
  }
  if (typeof v === 'object' && v.beat != null) return beatTime(music, v.beat) - beatTime(music, 0);
  if (typeof v === 'object' && v.bar != null) return beatTime(music, v.bar * 4) - beatTime(music, 0);
  if (typeof v === 'object' && v.vo != null) {
    const id = String(v.vo);
    const line = music?.narration?.lines?.find((l) => l.id === id);
    if (!line) {
      const known = (music?.narration?.lines ?? []).map((l) => l.id);
      throw new Error(
        `dur: { vo: '${id}' } 找不到这句旁白。` +
        (known.length
          ? `\n  旁白表里有：${known.join(', ')}`
          : `\n  任务没有配 narration（task.config.mjs 里加 narration: './narration.json' 或内联 { lines: [...] }）。`) +
        `\n  ⚠ 别把它静默当成默认 4 秒 —— 段长错了会让整条时间线跟着错。`,
      );
    }
    if (v.tail != null) {
      const tail = Number(v.tail);
      if (!Number.isFinite(tail)) {
        throw new Error(
          `dur: { vo: '${id}', tail: ${JSON.stringify(v.tail)} } 里的 tail 必须是有限数（秒）。` +
          `  NaN 会把这一段的 end 一起污染成 NaN，整条时间线跟着错，而且报错指不到这里。`,
        );
      }
      if (tail < 0) {
        throw new Error(
          `dur: { vo: '${id}', tail: ${tail} } 里的 tail 不能是负数 —— ${tail}s 会把段截得比旁白本身还短。` +
          `  想截短就换普通数字 dur。`,
        );
      }
      return line.dur + tail;
    }
    return line.dur;
  }
  return fallback;
}

function beatTime(music, beat) {
  const b = music?.beats ?? [];
  if (!b.length) return (beat * 60) / (music?.bpm || 120);
  const k = Math.floor(beat);
  const frac = beat - k;
  if (k < 0) return b[0] + k * (60 / (music.bpm || 120));
  if (k + 1 < b.length) return b[k] + frac * (b[k + 1] - b[k]);
  if (b.length) {
    const p = b.length > 1 ? b[b.length - 1] - b[b.length - 2] : 60 / (music.bpm || 120);
    return b[b.length - 1] + (k - b.length + 1 + frac) * p;
  }
  return (beat * 60) / (music?.bpm || 120);
}

/** 从懒加载函数或类里猜一个名字，做默认 id。 */
function nameOf(scene) {
  if (typeof scene === 'string') return scene;
  if (typeof scene === 'function') {
    const s = String(scene);
    const m = s.match(/scenes\/([\w.-]+)\.js/);
    if (m) return m[1];
    return scene.name || 'scene';
  }
  if (scene?.default) return nameOf(scene.default);
  // 场景对象可以自己声明 id（推荐：一眼能在 HUD/错误里认出是哪段）
  if (scene?.id) return scene.id;
  if (scene?.constructor?.name && scene.constructor.name !== 'Object') return scene.constructor.name;
  return 'scene';
}

/** 懒加载一个场景模块：cut(() => import('./scenes/x.js')) 的简写 */
export function lazy(loader) { return loader; }

/**
 * **段级审计：依赖令牌 `under` 真的满足吗？**（BACKLOG 头部 ② 的收口，2026-10-16）
 *
 * 为什么这件事必须放在**时间线展开之后**做：`whip` 这类转场模板的画面来自
 * 「把上一段的成帧（`ctx.under`）甩走」，而引擎只在**两段交叠的那一小段**里给得出 `ctx.under`
 * （`src/core/engine.js` 的 `under: k > 0 ? under : null` —— 交叠窗之外这一段就是
 * `items[0]`，没有"上一段"）。所以"交叠够不够"只在 `build()` 排完时间之后才是个事实，
 * 而**任务源码文本**里看不出来（对象可以跨行、可以 `seq()` 拼、`--only` 之后段表还会变）——
 * 这正是 1-21 当初把 `under` 记成"只声明、没接线"的理由（"假报比不报贵"）。
 *
 * 现在段对象自己带着模板的 `requires`（`src/shots/index.js` 的 `shot()` 搬运），
 * 于是这条依赖可以**判准**，而不是靠猜：
 *
 *   · `missing`           —— 这一段是**第一段**（`i === 0`）之外的段，却与**上一段没有交叠**
 *     （`start >= prev.end`）。`ctx.under` 恒为 `null` ⇒ 模板退回"没有 under"那条分支，
 *     甩镜类画面**几乎是黑的**，而且不报错。**这是硬问题**。
 *   · `noPrev`            —— 它就是第一段：没有"上一段"可比，**不判**。
 *     （`--only` 会把选中的段平移到时间轴开头，所以这条同样覆盖"只挑一段试渲染"的场景。
 *      `noPrev` **不是通过** —— "`空 ≠ 干净`"，调用方必须把这句说出来。）
 *   · `doubleTransition`  —— 与上一段交叠了，但**没声明 `handlesTransition`**：
 *     引擎于是会在这上面再叠一次交叉溶解（`engine.js` 的 `k > 0 && !scene.handlesTransition`），
 *     "甩走"被稀释成两屏叠一起。**是观感问题，不是没画**。
 *
 * 判据全部来自**已展开的段对象**（`start` / `end` / `handlesTransition` / `requires`），
 * 不读源码文本、不猜，所以可以离线单测（`tools/test-timeline-audit.mjs`）。
 *
 * ⚠ 场景对象有两个放法，两个都要认：`build()` 的产物放在 `scene`（还没解析），
 *   引擎跑起来之后是 `_scene`（setup 过的那个）。**单测就是这么发现漏的** ——
 *   只认 `_scene` 时，`build()` 直接喂进来的一条都查不到（"零命中"看着像"全都满足"）。
 *
 * ⚠ 口径必须与引擎**逐字一致**：`handlesTransition` 读**场景**那一份兜底
 *   （`it.handlesTransition ?? it._scene?.handlesTransition`）——
 *   配置档节点上没写时段对象上是 `undefined`，而模板自带的那份在**场景**上
 *   （背景守门 ① 就是因为两者不齐而少算了一段）。
 *
 * @param {any[]} items `build()` 的产物（或引擎 `engine.timeline`）
 * @returns {{ id: string, index: number, start: number, end: number, requires: string[],
 *             handlesTransition: boolean, overlaps: boolean, noPrev: boolean,
 *             missing: boolean, doubleTransition: boolean }[]}
 */
export function auditUnderRequires(items) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i] ?? {};
    // ⚠ 场景对象有两个放法，两条路都要认（单测就是这么发现漏的）：
    //   · `build()` 的产物把场景放在 `scene`（还没解析）；
    //   · 引擎跑起来之后是 `_scene`（setup 过的那个，`engine.js` 里赋值）。
    //   优先 `_scene`，回落到 `scene`。
    const scene = it._scene ?? it.scene ?? null;
    const req = Array.isArray(it.requires) ? it.requires
      : (Array.isArray(scene?.requires) ? scene.requires : null);
    if (!req || !req.includes('under')) continue;
    const handlesTransition = !!(it.handlesTransition ?? scene?.handlesTransition);
    const prev = i > 0 ? list[i - 1] : null;
    // ⚠ 与背景守门同一条判据：比 start 与上一段的 end，不是比结束时刻
    //   （结束时刻被 overlap 推走过，用它判断会把整段漏掉）。
    const overlaps = !!prev && Number(it.start) < Number(prev.end);
    const noPrev = i === 0;
    out.push({
      id: String(it.id ?? `scene_#${i}`),
      index: i,
      start: Number(it.start ?? 0),
      end: Number(it.end ?? 0),
      requires: [...req],
      handlesTransition,
      overlaps,
      noPrev,
      missing: !noPrev && !overlaps,
      doubleTransition: !noPrev && overlaps && !handlesTransition,
    });
  }
  return out;
}

/**
 * **背景守门的采样计划**（纯函数，BACKLOG 头部 ①⑦ 的收口，2026-10-16）。
 *
 * 为什么要抽出来：`src/app.js` 的 `worldAudit()` 要"渲染一帧、看它有没有铺底"，
 * 而**在哪几个时刻渲染、哪几段判、哪几段只给读数**全是纯逻辑 —— 混在页面侧的 GPU 代码里就
 * 只能靠肉眼验证。抽到这里之后，`tools/test-timeline-audit.mjs` 能离线钉住三件事：
 *
 *   ① **采两个时刻**：交叠窗中点（**判**"这一段铺没铺底"）+ **交叠窗之后的中点**（**只读数**）。
 *      以前只有前者，于是"交叠窗之外那一秒"连个数字都没有（`_config-lab` 的甩镜
 *      19.50–20.50 就是这样一段没人看的区间）。段短到没有窗后部分时只采一个点。
 *      ⚠ 窗后点**不参与判据** —— 理由与实测数字在 `worldAuditVerdict()` 的注释里。
 *   ② **口径与引擎逐字一致**：`handlesTransition` 读段上那份，段上没有读**场景**那份
 *      （`_scene` 或 `scene`；引擎读的是场景那份 —— 配置档节点没写时它到不了段对象）。
 *   ③ **`world: false` 的段单独一类**：`judged: false`（"整帧底我自己负责"是合法声明，
 *      不判它铺没铺底），但**照样给采样时刻** —— 声明不等于"这段没人看着"。
 *
 * 判据（与 `worldAudit()` 里的注释同一份）：只查"与前一段交叠"的段 ——
 * 只有那时才有转场语义（`tin` / `tout` / `under` 才有意义）。比较用 `start < prev.end`，
 * **不是**比结束时刻（结束时刻被 overlap 推走过，用它判断会把整段漏掉）。
 *
 * @param {any[]} items `build()` 的产物或引擎的 `engine.timeline`
 * @returns {{ id: string, index: number, start: number, end: number, times: number[],
 *             handlesTransition: boolean, selfBase: boolean, declaredWorld: string,
 *             risky: boolean, judged: boolean }[]}
 */
export function planWorldAudit(items) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (let i = 1; i < list.length; i++) {
    const it = list[i] ?? {}, prev = list[i - 1] ?? {};
    const start = Number(it.start ?? 0), end = Number(it.end ?? 0), prevEnd = Number(prev.end ?? 0);
    if (!(start < prevEnd)) continue;                 // 没有交叠 ⇒ 没有转场语义 ⇒ 不查
    const scene = it._scene ?? it.scene ?? null;
    const handlesTransition = !!(it.handlesTransition ?? scene?.handlesTransition);
    const selfBase = it.world === false;
    const declaredWorld = selfBase ? 'self' : (it.world === 'auto' ? 'auto' : (it.world ? 'custom' : 'none'));
    // 只有"声明了 handlesTransition / 转场"的段会被判为问题：
    // 没有转场语义的简单段清个底色就够了，不该被要求画全屏 Pass。
    const risky = handlesTransition || declaredWorld !== 'none';
    const span = Math.min(prevEnd, end) - start;
    const times = [start + Math.max(0.02, span * 0.5)];
    const tailSpan = end - prevEnd;
    if (tailSpan > 0.05) times.push(prevEnd + tailSpan * 0.5);
    out.push({
      id: String(it.id ?? `scene_#${i}`), index: i, start, end, times,
      handlesTransition, selfBase, declaredWorld, risky,
      /** `judged === false` ⇒ 只给读数，不判"铺没铺底"（当前只有 `world: false` 这一类） */
      judged: !selfBase,
    });
  }
  return out;
}

/**
 * **背景守门的判定**（纯函数）：把采样计划 + 每一刻的绘制账目/亮度变成两个事实。
 *
 * ⚠ 这一条是**踩过假报之后**才长成这样的（2026-10-16，BACKLOG 头部 ⑦）：
 *   · **判据只落在第一个采样点（交叠窗中点）**：`full === 0 && risky` ⇒ `missing`。
 *   · 第二个采样点（**交叠窗之后**的中点）**只做读数，不判**。
 *     为什么：`ctx.under` 只在交叠窗里有值 ⇒ 窗后那一段，转场模板走的是"没有 under"的分支，
 *     而那条分支**本来就可能是近黑的**（`whip` 的设计：把画面甩走之后只剩
 *     `col *= mix(1.0, 0.15, k)` 压出来的 15% + 颗粒，实测 0.037–0.051，
 *     `tasks/demo` 与 `tasks/_config-lab` 都是这个数）。第一版把同一条 `full === 0` 判据
 *     也压在窗后点上，于是 `check demo` 当场把一个**设计如此**的尾巴报成了"没铺背景"——
 *     "假报比不报更贵"，所以窗后点退回成读数。
 *   · `blackTail` 是**读数型**的事实（窗后中点 < 0.004）：它不 gate，只给报告一行 ——
 *     真正"拿不到 under"那种事故由**段级审计**（`auditUnderRequires()`，没有交叠 ⇒ 硬问题）抓住。
 *
 * @param {{ judged?: boolean, risky?: boolean }|null} plan `planWorldAudit()` 的一项
 * @param {{ full?: number, mean?: number, error?: string }[]} samples 按计划渲染出来的读数
 * @returns {{ missing: boolean, blackTail: boolean, tail: object|null }}
 */
export function worldAuditVerdict(plan, samples) {
  const p = plan ?? {};
  const list = Array.isArray(samples) ? samples : [];
  const first = list[0] ?? null;
  const tail = list.length > 1 ? list[1] : null;
  // `world: false`（"整帧底我自己负责"）不进这条判据 —— 那是它的声明
  const missing = !!p.judged && !!p.risky && !!first && !first.error && first.full === 0;
  const blackTail = !!p.risky && !!tail && !tail.error
    && typeof tail.mean === 'number' && tail.mean < 0.004;
  return { missing, blackTail, tail };
}

/* ================================================================ carry（连贯度审计） */

/**
 * **carry（连贯）审计的边界计划**（纯函数，BACKLOG 1-34，2026-10-17）。
 *
 * 出自外部项目 onetake 的拆解（`docs/REFERENCE-onetake.md` §2）：**「像不像 PPT」的核心
 * 不是节奏，是「每个镜头边界上有没有东西活下来并变成下一个画面」**。它的 probe 在同一条
 * 片子的四个版本上量出 carry 0.00 / 0.40 / 0.75 / 0.83，与人审结论逐版一致，而**节奏腿
 * 在四版里全都通过** —— 连贯是节奏看不见的另一个维度。判据（全部【外部经验值】）：
 *
 *   · **carried**  ：边界两侧有区域配得上对，且移动 ≥ 画面对角线的 2% 或缩放 ≥ 10%；
 *   · **anchored** ：唯一幸存区域很大（≥ 画面 3%）且基本没动（作为锚定）；
 *   · **bare**     ：什么都不剩 —— 互相替换，无论节奏多好都读作换灯片。
 *
 * 豁免（probe 的口径）：burst（≥3 次相邻硬切）、片尾 1.2s、显式登记（见下）。
 * **显式登记**是我们补的：跨元素合成的 carry（卡片淡出 + 同位置新页淡入）probe 会判成
 * bare，但它对观众是成立的 —— 对方用 `__meta.cuts` 登记这类缝，我们用段对象上的
 * `carry: 'morph' | 'anchor'` 声明（写在 `cut(...)` 的第二参数 / 配置档节点上）。
 *
 * ⚠ 它自己写的两条**盲区**（抄判据必须连盲区一起抄，REFERENCE-onetake.md §2.3）：
 *   ① 连续世界（一镜到底、没有内部切点）**没有边界可判** —— continuity 1.00 over
 *     0 boundaries 的 PASS **不是证据**，那时 carry 只能靠眼睛；本函数把这种情况
 *     报成 `noBoundaries`，调用方必须说「没边界可判」而不是「通过」。
 *   ② 块匹配在**低对比画面**上会假红/假绿 —— 读数给出匹配质量，人要抽查。
 *
 * @param {any[]} items `build()` 的产物或 `engine.timeline`（同 `auditUnderRequires` 的口径）
 * @param {{ tailExempt?: number }} [opts] `tailExempt` 片尾豁免秒数（默认 1.2，probe 口径）
 * @returns {{ id: string, at: number, index: number, prevId: string, overlap: number,
 *   registered: string | null, exemptTail: boolean }[]}
 *   `at` = 边界时刻（有交叠取交叠中点、硬切取切点本身）；`registered` = 段对象上
 *   `carry` 声明的值（'morph' | 'anchor' | 'any'）；`overlap` = 交叠秒数（硬切为 0）
 */
export function planCarryBoundaries(items, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const tailExempt = Number.isFinite(opts.tailExempt) ? /** @type {number} */ (opts.tailExempt) : 1.2;
  const dur = list.length ? Math.max(...list.map((i) => Number(i?.end ?? 0))) : 0;
  const out = [];
  for (let i = 1; i < list.length; i++) {
    const it = list[i] ?? {}, prev = list[i - 1] ?? {};
    const start = Number(it.start ?? 0), prevEnd = Number(prev.end ?? 0);
    const overlap = Math.max(0, prevEnd - start);
    // 硬切（overlap = 0）也判：probe 的口径是"边界"不区分转场/硬切 ——
    // 硬切上什么都没活下来，恰恰是最常见的 bare。
    const at = overlap > 0.02 ? start + overlap * 0.5 : start;
    const carry = it.carry ?? (it._scene ?? it.scene ?? {}).carry ?? null;
    const lastStart = list.length ? Math.max(0, dur - tailExempt) : 0;
    out.push({
      id: String(it.id ?? `scene_#${i}`),
      prevId: String(prev.id ?? `scene_#${i - 1}`),
      index: i,
      at,
      overlap,
      registered: typeof carry === 'string' && carry ? carry : null,
      exemptTail: at >= lastStart,
    });
  }
  return out;
}

/**
 * **carry 的单边界判定**（纯函数）：把"边界两侧各渲一帧的块匹配结果"变成 carried / anchored / bare。
 *
 * 块匹配的口径（自定，判据阈值是 onetake probe 的【外部经验值】）：
 *   · 把两帧各切成 `grid` × `grid` 的块，块均值四舍五入到 `quant`（显示空间 0..255）；
 *   · 在 maxShift 半径内找 A 帧每块在 B 帧里的最近配对（块灰度差的绝对值）；
 *   · 匹配差 ≤ tolerance 视为"同一块内容"，统计其位移/缩放；
 *   · **carried**：有足够块数（≥ minBlocks）配对成功且平均位移 ≥ 对角线的 2%
 *     或平均尺度变化 ≥ 10%；**anchored**：配对区域 ≥ 画面 3% 且平均位移 < 2% 对角线；
 *     其余 = **bare**。
 *
 * @param {object} match 单个边界的块匹配结果（页面侧算，字段见 `cmdCarry`）：
 *   `{ matched: number, total: number, avgShiftFrac: number, avgScale: number, quality: number }`
 * @param {object} [opts] `{ diagFrac = 0.02, anchorFrac = 0.03, scaleFrac = 0.10, minBlocks = 6 }`
 * @returns {{ verdict: 'carried'|'anchored'|'bare', reason: string }}
 */
export function classifyCarry(match, opts = {}) {
  const m = match ?? {};
  const diagFrac = opts.diagFrac ?? 0.02;
  const anchorFrac = opts.anchorFrac ?? 0.03;
  const scaleFrac = opts.scaleFrac ?? 0.10;
  const minBlocks = opts.minBlocks ?? 6;
  const matched = Number(m.matched ?? 0);
  const total = Math.max(1, Number(m.total ?? 0));
  const cover = matched / total;                    // 配对成功区域占画面比例
  const shift = Number(m.avgShiftFrac ?? 0);        // 平均位移（对角线的比例）
  const scale = Number(m.avgScale ?? 1);            // 平均尺度（配对块边长之比）
  if (matched >= minBlocks && shift >= diagFrac) {
    return { verdict: 'carried', reason: `配对 ${matched} 块平均位移 ${(shift * 100).toFixed(1)}% 对角线（≥${diagFrac * 100}%）` };
  }
  if (matched >= minBlocks && Math.abs(scale - 1) >= scaleFrac) {
    return { verdict: 'carried', reason: `配对 ${matched} 块平均缩放 ${(scale - 1 >= 0 ? '+' : '') + ((scale - 1) * 100).toFixed(1)}%（≥${scaleFrac * 100}%）` };
  }
  if (cover >= anchorFrac && shift < diagFrac) {
    return { verdict: 'anchored', reason: `${(cover * 100).toFixed(0)}% 的画面基本没动（<${diagFrac * 100}% 对角线）—— 幸存物是锚` };
  }
  return { verdict: 'bare', reason: `只有 ${matched} 块配对成功（覆盖 ${(cover * 100).toFixed(1)}%，位移 ${(shift * 100).toFixed(2)}% 对角线）—— 两个画面在互相替换` };
}

/**
 * **carry score 汇总**（纯函数）：`score = (carried + anchored/2) / 计入的边界数`。
 *
 * 豁免不计入分母：burst（一个边界的前后 1.5s 里还有 ≥2 个别的边界 ⇒ 硬切连击）、
 * 片尾 `exemptTail`、显式登记（`registered` 有值的边界按登记值计：'morph' 计 carried、
 * 'anchor' 计 anchored、'any' 不计也不豁免 —— 留给 `anim carry` 报读数）。
 *
 * @param {{ verdict: 'carried'|'anchored'|'bare'|'exempt', registered: string|null,
 *           exemptTail: boolean, at: number }[]} rows 每个边界一行（`classifyCarry` 的产物 + 计划字段）
 * @param {{ failBelow?: number, warnBelow?: number }} [opts] `failBelow` 默认 0.5、`warnBelow` 默认 0.7（probe 口径）
 * @returns {{ score: number, judged: number, exempt: number, carried: number, anchored: number,
 *   bare: number, tier: 'pass'|'warn'|'fail', noBoundaries: boolean }}
 */
export function summarizeCarry(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const failBelow = opts.failBelow ?? 0.5;
  const warnBelow = opts.warnBelow ?? 0.7;
  if (!list.length) return { score: 0, judged: 0, exempt: 0, carried: 0, anchored: 0, bare: 0, tier: 'fail', noBoundaries: true };
  // burst：相邻边界（1.5s 内 ≥3 个）整组豁免 —— staccato 硬切是合法的 bare
  const times = list.map((r) => Number(r.at ?? 0));
  const burstSet = new Set();
  for (let i = 0; i < times.length; i++) {
    let run = [times[i]];
    for (let j = i + 1; j < times.length && times[j] - run[run.length - 1] <= 1.5; j++) run.push(times[j]);
    if (run.length >= 3) { for (const t of run) burstSet.add(t); }
  }
  let carried = 0, anchored = 0, bare = 0, exempt = 0;
  for (const r of list) {
    const reg = r.registered;
    if (r.exemptTail || burstSet.has(Number(r.at ?? 0))) { exempt++; continue; }
    if (reg === 'morph') { carried++; continue; }        // 显式登记的合成 carry
    if (reg === 'anchor') { anchored++; continue; }
    if (r.verdict === 'carried') carried++;
    else if (r.verdict === 'anchored') anchored++;
    else bare++;
  }
  const judged = carried + anchored + bare;
  if (!judged) return { score: 0, judged: 0, exempt, carried: 0, anchored: 0, bare: 0, tier: 'fail', noBoundaries: true };
  const score = (carried + anchored / 2) / judged;
  return {
    score, judged, exempt, carried, anchored, bare,
    tier: score < failBelow ? 'fail' : score < warnBelow ? 'warn' : 'pass',
    noBoundaries: false,
  };
}

/* ================================================================ 节奏（rhythm） */

/**
 * **节奏的静态读数**（纯函数，BACKLOG 1-35，2026-10-17）。
 *
 * 出自 onetake 的节奏教训（`docs/REFERENCE-onetake.md` §3）：motion-web 同一条片子
 * v1 匀速 dolly / v2 等长硬切，两版都被否「依然是 PPT」；v3 镜头长度 0.22–2.2s 通过。
 * **判据**（【外部经验值】）：**镜头长度的变异系数（CoV）≥ 0.25**，否则整片读作节拍器 ——
 * 匀速镜头长度在观众眼里就是"一格一格翻灯片"，不管每个镜头内部多好看。
 * （对方两条通过片的实测：0.44 / 0.67 —— 都远超线。）
 *
 * 单段 / `--only` 之后**没有节奏可言**：一段片子不存在镜头长度分布，报 `noRhythm`，
 * 调用方必须说「没判」而不是「通过」（「空 ≠ 干净」）。
 *
 * @param {any[]} items `build()` 的产物或 `engine.timeline`
 * @returns {{ count: number, cov: number, min: number, max: number, durs: number[],
 *   metronome: boolean, noRhythm: boolean }}
 *   `cov` = 标准差 / 均值（样本标准差，n-1）；`metronome` = cov < 0.25
 */
export function rhythmStats(items) {
  const list = Array.isArray(items) ? items : [];
  const durs = list.map((i) => Math.max(0, Number(i?.end ?? 0) - Number(i?.start ?? 0))).filter((d) => d > 0);
  if (durs.length < 2) {
    return { count: durs.length, cov: 0, min: durs[0] ?? 0, max: durs[0] ?? 0, durs, metronome: false, noRhythm: true };
  }
  const mean = durs.reduce((a, b) => a + b, 0) / durs.length;
  const varr = durs.reduce((a, b) => a + (b - mean) ** 2, 0) / (durs.length - 1);
  const cov = mean > 0 ? Math.sqrt(varr) / mean : 0;
  return {
    count: durs.length,
    cov,
    min: Math.min(...durs),
    max: Math.max(...durs),
    durs,
    metronome: cov < 0.25,
    noRhythm: false,
  };
}

/**
 * **静/动分段判定**（纯函数，BACKLOG 1-38，2026-10-17）。
 *
 * 把「一串采样帧的帧差」变成「静段区间表」。判据（【外部经验值】，
 * `docs/REFERENCE-onetake.md` §3）：
 *   · **死静帧占比 ≥ 25%**，且**最长静段 ≥ 1s** —— 「停顿才让动作落得下来」；
 *     永远在动的片子读作屏保（Never let the frame be always in motion）。
 *   · ⚠ **rest 必须真空静**：1→1.05 的慢推、持续 drift 在量具眼里永远不静
 *     （clearing 首渲 rest 0.178 假红、改真空静后 0.294 —— 对方自己踩的坑）。
 *
 * 帧差口径：降采样渲相邻两帧、逐像素差分，**差过阈值（显示空间 6/255）
 * 的像素占比 < 0.5%** 视为「这一步是静的」。连续静步 ≥ `minHold` 秒合成一个静段
 * （孤立单步静是镜头间的呼吸，不算 hold）。
 *
 * @param {{ t: number, movedFrac: number }[]} steps 采样步：`t` = 帧时刻、
 *   `movedFrac` = 与前一帧差过阈值的像素占比 0..1（第一帧给 1 = 强制算动）
 * @param {{ step?: number, stillFrac?: number, minHold?: number }} [opts]
 *   `step` 采样步长秒（默认 0.5，调用方保证 steps 间距与它一致）；`stillFrac` 判静阈值
 *   （默认 0.005）；`minHold` 成段最小秒数（默认 1.0）
 * @returns {{ stillRatio: number, longest: number, holds: { from: number, to: number }[],
 *   total: number }}
 *   `stillRatio` = 静步占比（等步长时 = 时间占比）；`holds` = 静段区间；`longest` = 最长静段秒
 */
export function rhythmSegments(steps, opts = {}) {
  const list = Array.isArray(steps) ? steps.filter((s) => s && Number.isFinite(s.t)) : [];
  const step = opts.step ?? 0.5;
  const stillFrac = opts.stillFrac ?? 0.005;
  const minHold = opts.minHold ?? 1.0;
  if (list.length < 2) return { stillRatio: 0, longest: 0, holds: [], total: 0 };
  const flags = list.map((s, i) => (i === 0 ? false : Number(s.movedFrac ?? 1) < stillFrac));
  const holds = [];
  let runStart = -1;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] && runStart < 0) runStart = i;
    if ((!flags[i] || i === flags.length - 1) && runStart >= 0) {
      const end = flags[i] ? i : i - 1;
      const from = list[runStart].t;
      const dur = (end - runStart + 1) * step;
      if (dur >= minHold) holds.push({ from, to: from + dur });
      runStart = -1;
    }
  }
  const stillSteps = flags.filter(Boolean).length;
  return {
    stillRatio: stillSteps / flags.length,
    longest: holds.reduce((m, h) => Math.max(m, h.to - h.from), 0),
    holds,
    total: list[list.length - 1].t - list[0].t,
  };
}


/* ================================================================ 画面语义断言（motion.json，BACKLOG 1-18） */

/**
 * motion.json 的 `assert` 数组里认识的四种断言（每一项形如 `{ "before": ["段A", "段B"] }`，
 * **一项只有一个键**）。出处：hyperframes 的 lint 规则集（`docs/REFERENCE-hyperframes.md` §4.2），
 * 对应关系：`before`→`motion_out_of_order`、`appearsBy`→`motion_appears_late`、
 * `keepsMoving`→`motion_frozen`、`noEdgeContent`→`canvas_content_at_edge`。
 * @type {string[]}
 */
export const MOTION_ASSERT_KINDS = ['before', 'appearsBy', 'keepsMoving', 'noEdgeContent'];

/**
 * 画面语义断言的默认阈值（任务可以用 motion.json 的 `thresholds` 覆盖，只认认识的键 ——
 * 与 `layoutLimits()` 同一条规矩：写错键名不许静默生效）。
 *   · `changed`：changedRatio 判据 —— 「发生可见变化的像素占比」（|Δ亮度| > 1/255）。
 *     appearsBy 要 ≥ 它才算「出现了」；keepsMoving 里 < 它的一对相邻帧记「静」。
 *     0.0015 = 每 4 像素取 1 的下采样口径下，1080p 约 25 万个采样点里 ~380 个在变 ——
 *     排掉 1 个 LSB 的 GPU 回读噪声，又抓得住真实的入场变化。
 *   · `edgeSafe`：四边安全带的宽度（占边长比例，默认 3%）—— 文字块 bbox 压进这条带即压边。
 */
export const MOTION_ASSERT_DEFAULTS = Object.freeze({ changed: 0.0015, edgeSafe: 0.03 });

/** keepsMoving 的采样步长（秒）：段内每 0.5s 取一对相邻帧（帧距 = 1/fps，页面侧定）。 */
export const MOTION_STEP = 0.5;

/**
 * **画面语义断言的采样计划**（纯函数，BACKLOG 1-18，2026-10-17）。
 *
 * 任务在 `tasks/<任务>/motion.json` 里声明断言：
 *
 *     {
 *       "assert": [
 *         { "before": ["段A", "段B"] },
 *         { "appearsBy": ["段A", 2.0] },
 *         { "keepsMoving": ["段B", 1.5] },
 *         { "noEdgeContent": ["段A"] }
 *       ],
 *       "thresholds": { "changed": 0.0015, "edgeSafe": 0.03 }
 *     }
 *
 * 四种断言的判据（与 `motionVerdict()` / 页面侧 `__anim.motionAudit()` 共用同一份口径）：
 *   · **before(A,B)**：B 的 `start` ≥ A 的 `end` —— **纯静态**，时间线（build() 的产物）里就有，
 *     一帧都不渲染；
 *   · **appearsBy(段, t)**：段头 +0.05s 的帧与段头 +t 的帧做像素差 —— changedRatio ≥
 *     `thresholds.changed` 才算「出现了」（一点基线、一点判据，单次测量，没有降级一说）；
 *   · **keepsMoving(段, maxStaticSec)**：段内每 `MOTION_STEP`（0.5s）一对相邻帧（帧距 = 1/fps，
 *     页面侧定）—— changedRatio < `thresholds.changed` 记「静」，**最长连续静 > maxStaticSec**
 *     才命中（rest 本来就是合法的，"有停顿"不是错）；
 *   · **noEdgeContent(段)**：四边 `thresholds.edgeSafe`（默认 3%）带内**文字块** bbox 压边。
 *     数据源 `gl.paint.blocks`（版面守门那套记账，见 src/app.js 的 layoutRows 与 src/layout.js）。
 *     ⚠ 第一版**只判文字块** —— 对方原版是像素级的"帧边缘出现锐利内容"；这条边界写进了
 *     docs/MOTION.md §6，别把它当成"任何元素压边都能抓"。
 *
 * 两条元设计（REFERENCE-hyperframes §4.2，必须一起抄，判读都在 `motionVerdict()`）：
 *   ① **持久性感知**：单点超限、下一采样点恢复的瞬态 → info，**永不 gate**（入场/出场本来就是
 *     瞬态的）；跨采样点保持才 gate。
 *   ② **空 ≠ 干净**：没声明的段 = 「没判」不是「通过」（`uncovered` 单列）；断言里的段名
 *     找不到（**--only 之后段表会变** / 段名拼错）→ **单列 `missing`，绝不当通过**；
 *     不认识的断言形状单列 `ignored`（写了但没生效 ≠ 通过）。
 *
 * @param {any[]} timeline `build()` 的产物或引擎的 `engine.timeline`
 * @param {{ assert?: any[], thresholds?: Record<string, number> }|null} [motion] motion.json 的内容
 * @returns {{ thresholds: { changed: number, edgeSafe: number },
 *   static: { key: string, kind: 'before', names: string[], index: number,
 *             a: { id: string, start: number, end: number },
 *             b: { id: string, start: number, end: number }, gap: number, ok: boolean }[],
 *   render: { key: string, kind: string, names: any[], id: string, segIndex: number,
 *             start: number, end: number, times: number[], param: number|null }[],
 *   missing: { key: string, kind: string, names: any[], unknown: string[] }[],
 *   ignored: { kind: string, reason: string }[],
 *   covered: string[], uncovered: string[],
 *   totals: { asserts: number, static: number, render: number, missing: number,
 *             ignored: number, frames: number } }}
 *   `totals.frames` = 渲染类断言预计要多渲的帧数（appearsBy 每条 2 帧 / keepsMoving 每对 2 帧 /
 *   noEdgeContent 每点 1 帧 —— 报告「试渲染时间涨了多少」用的预估口径）。
 */
export function planMotionAsserts(timeline, motion = null) {
  const list = Array.isArray(timeline) ? timeline : [];
  const raw = Array.isArray(motion?.assert) ? motion.assert : [];
  const thresholds = { ...MOTION_ASSERT_DEFAULTS };
  const thr = motion?.thresholds;
  if (thr && typeof thr === 'object') {
    for (const k of Object.keys(MOTION_ASSERT_DEFAULTS)) {
      const v = Number(thr[k]);
      if (Number.isFinite(v) && v >= 0) thresholds[k] = v;
    }
  }
  const segIndex = new Map();
  list.forEach((it, i) => {
    const id = String(it?.id ?? '').trim();
    if (id && !segIndex.has(id)) segIndex.set(id, i);   // 同名段取第一个（build() 本身会去重段名）
  });
  const segAt = (name) => {
    const i = segIndex.get(name);
    return i === undefined ? null : {
      id: name, index: i,
      start: Number(list[i]?.start ?? 0), end: Number(list[i]?.end ?? 0),
    };
  };
  /** @type {any[]} */ const staticRows = [];
  /** @type {any[]} */ const renderRows = [];
  /** @type {any[]} */ const missingRows = [];
  /** @type {any[]} */ const ignoredRows = [];
  const covered = new Set();

  raw.forEach((a, index) => {
    const kind = (a && typeof a === 'object' && !Array.isArray(a)) ? Object.keys(a)[0] : null;
    const params = kind ? a[kind] : null;
    if (!kind || !MOTION_ASSERT_KINDS.includes(kind) || !Array.isArray(params)) {
      ignoredRows.push({
        kind: String(kind ?? '(空)'),
        reason: `第 ${index + 1} 条断言不认识（形状该是 { "断言": [...] }，断言取 ${MOTION_ASSERT_KINDS.join(' / ')}）`,
      });
      return;
    }
    // 段名解析：渲染类第一个名字才是段名（第二个是参数）；before 两个都是段名
    const segNames = kind === 'before'
      ? [String(params[0] ?? '').trim(), String(params[1] ?? '').trim()]
      : [String(params[0] ?? '').trim()];
    const unknown = segNames.filter((n) => !segIndex.has(n));
    if (unknown.length) {
      // 「绝不当通过」：段名找不到的断言**不进计划**，单列 missing，由 motionVerdict() 报成 error
      missingRows.push({ key: `#${index}:${kind}`, kind, names: params.slice(), unknown });
      return;
    }
    if (kind === 'before') {
      if (params.length !== 2) {
        ignoredRows.push({ kind, reason: `第 ${index + 1} 条 before 需要正好两个段名，收到 ${params.length} 个` });
        return;
      }
      const A = segAt(segNames[0]), B = segAt(segNames[1]);
      const gap = B.start - A.end;
      staticRows.push({
        key: `#${index}:before`, kind: 'before', names: segNames, index, a: A, b: B, gap,
        // 1e-9 容差：build() 的硬切把 prev.end 原样赋给下一段 start，应当逐位相等
        ok: gap >= -1e-9,
      });
      covered.add(segNames[0]); covered.add(segNames[1]);
      return;
    }
    // ── 渲染类：三种各算各的采样时刻（页面侧照这份时刻渲帧）──
    if (kind === 'appearsBy' && !(params.length === 2 && Number.isFinite(Number(params[1])) && Number(params[1]) >= 0)) {
      ignoredRows.push({ kind, reason: `第 ${index + 1} 条 appearsBy 需要 [段名, 秒数]，秒数得是非负有限数` });
      return;
    }
    if (kind === 'keepsMoving' && !(params.length === 2 && Number.isFinite(Number(params[1])) && Number(params[1]) > 0)) {
      ignoredRows.push({ kind, reason: `第 ${index + 1} 条 keepsMoving 需要 [段名, maxStaticSec]，秒数得是正的有限数` });
      return;
    }
    if (kind === 'noEdgeContent' && params.length !== 1) {
      ignoredRows.push({ kind, reason: `第 ${index + 1} 条 noEdgeContent 只要一个段名` });
      return;
    }
    const seg = segAt(segNames[0]);
    covered.add(segNames[0]);
    const start = seg.start, end = seg.end;
    /** @type {number[]} */
    const times = [];
    let param = null;
    if (kind === 'appearsBy') {
      param = Number(params[1]);
      times.push(start + 0.05, start + Math.max(0, param));   // 基线点 + 判据点
    } else if (kind === 'keepsMoving') {
      param = Number(params[1]);
      for (let t = start + 0.05; t < end; t += MOTION_STEP) times.push(t);
      // 段太短（< 0.05s）时一对帧对都排不出来 —— 判读那边会说「没判」，绝不说「通过」
    } else {
      // noEdgeContent：三点（15% / 50% / 85%）—— 入场头最易出问题，只看中点会漏；
      // 持久性感知也需要 ≥ 2 个采样点才分得出"瞬态"与"保持"。
      const dur = Math.max(0, end - start);
      for (const k of [0.15, 0.5, 0.85]) {
        const t = Math.round((start + dur * k) * 1000) / 1000;
        if (!times.includes(t)) times.push(t);   // 段太短时三点会重合
      }
    }
    renderRows.push({
      key: `${kind}:${segNames[0]}`, kind, names: params.slice(),
      id: segNames[0], segIndex: seg.index, start, end, times, param,
    });
  });

  // 渲染成本预估（CLI 报告「试渲染时间涨了多少」的口径；noEdgeContent 的记账是白拿的，只算渲的 1 帧）
  const frames = renderRows.reduce((n, r) =>
    n + (r.kind === 'appearsBy' ? 2 : r.kind === 'keepsMoving' ? r.times.length * 2 : r.times.length), 0);
  const uncovered = [...segIndex.keys()].filter((id) => !covered.has(id));
  return {
    thresholds, static: staticRows, render: renderRows, missing: missingRows, ignored: ignoredRows,
    covered: [...covered], uncovered,
    totals: {
      asserts: raw.length, static: staticRows.length, render: renderRows.length,
      missing: missingRows.length, ignored: ignoredRows.length, frames,
    },
  };
}

/**
 * **noEdgeContent 的单帧判据**（纯函数）：四边 `edgeSafe` 比例带内，文字块 bbox 压边。
 *
 * 为什么是 bbox 而不是像素：数据源是 `gl.paint.blocks` 的绘制记账（版面守门同一套，
 * src/app.js 的 `layoutRows()` 把它合成带 `x0/x1/y0/y1` 的"块"），量 bbox 一分钱渲染都不多花。
 * 一块字同时压两个边（角落上）会出**两条**记录 —— 报告里看得见"压的是哪两个边"。
 * 贴线不算（`x1 === 带内沿` 不算压边 —— 严格不等号），坏数据（缺坐标 / W/H 非正）返回空、不抛。
 *
 * @param {{ x0?: number, x1?: number, y0?: number, y1?: number, sample?: string }|any} groups
 *     文字块列表（`layoutVerdict().groups` 的形状）
 * @param {number} W 逻辑宽 @param {number} H 逻辑高 @param {number} [edgeSafe] 带宽比例（默认 3%）
 * @returns {{ edge: 'left'|'right'|'top'|'bottom', sample: string,
 *             block: { x0: number, x1: number, y0: number, y1: number } }[]}
 */
export function edgeSafeHits(groups, W, H, edgeSafe = MOTION_ASSERT_DEFAULTS.edgeSafe) {
  const out = [];
  const list = Array.isArray(groups) ? groups : [];
  if (!(Number(W) > 0) || !(Number(H) > 0)) return out;
  const bw = Math.max(0, Number(edgeSafe) || 0) * W;   // 左右带宽（逻辑像素）
  const bh = Math.max(0, Number(edgeSafe) || 0) * H;   // 上下带宽
  for (const g of list) {
    if (!g) continue;
    const x0 = Number(g.x0), x1 = Number(g.x1), y0 = Number(g.y0), y1 = Number(g.y1);
    if (![x0, x1, y0, y1].every(Number.isFinite)) continue;
    const sample = String(g.sample ?? '');
    const box = { x0, x1, y0, y1 };
    if (x0 < bw) out.push({ edge: 'left', sample, block: box });
    if (x1 > W - bw) out.push({ edge: 'right', sample, block: box });
    if (y0 < bh) out.push({ edge: 'top', sample, block: box });
    if (y1 > H - bh) out.push({ edge: 'bottom', sample, block: box });
  }
  return out;
}

/**
 * **画面语义断言的判定**（纯函数）：把 `planMotionAsserts()` 的计划 + 页面侧
 * `__anim.motionAudit()` 回传的每行读数，判读成 `{ errors, infos, skipped, passed }`。
 *
 * 三种结局的分工（「空 ≠ 干净」，docs/BACKLOG.md 1-19 同一条哲学）：
 *   · `errors` —— 真命中（before 顺序反 / appearsBy 没出现 / keepsMoving 连续静止超限 /
 *     noEdgeContent 全程压边 / **段名找不到**）。CLI 默认 warn、`--strict` 才 gate；
 *   · `infos` —— **持久性感知降级**（REFERENCE-hyperframes §4.2 ①）：单点超限、下一采样点
 *     恢复的瞬态。永不 gate —— 入场/出场本来就是瞬态的，靠"跨采样点是否保持"自动分，
 *     不靠作者写豁免；
 *   · `skipped` —— **没判**（页面侧没回结果 / 采样点报错 / 段太短排不出帧对 / 断言形状
 *     不认识 / 没有任何断言 / 有段没被覆盖）。不是通过，也不冒充失败。
 *
 * @param {ReturnType<typeof planMotionAsserts>|null} plan `planMotionAsserts()` 的产物
 *     （阈值跟着 plan 走 —— 阈值是 motion.json 声明的，判读与计划必须用同一份，不许两处传参打架）
 * @param {{ key?: string, error?: string, samples?: any[] }[]|null} [results] 页面侧回传的 rows
 * @returns {{ errors: { kind: string, id: string, message: string }[],
 *             infos: { kind: string, id: string, message: string }[],
 *             skipped: { kind: string, id: string, why: string }[],
 *             passed: number, uncovered: string[] }}
 */
export function motionVerdict(plan, results = null) {
  const p = plan ?? {};
  const thr = { ...MOTION_ASSERT_DEFAULTS, ...(p.thresholds ?? {}) };
  const errors = [], infos = [], skipped = [];
  let passed = 0;
  const rows = Array.isArray(results) ? results : [];
  const byKey = new Map();
  for (const r of rows) if (r && typeof r.key === 'string') byKey.set(r.key, r);

  // ① 静态 before：时间线上就有的事实，直接判（一帧都不渲染）
  for (const st of p.static ?? []) {
    if (st.ok) { passed++; continue; }
    errors.push({
      kind: 'before', id: st.names.join(' → '),
      message: `before：「${st.names[1]}」(start ${st.b.start.toFixed(2)}s) 应排在「${st.names[0]}」(end ${st.a.end.toFixed(2)}s) 之后 —— 顺序反了或交叠了 ${Math.abs(st.gap).toFixed(2)}s`,
    });
  }

  // ② 渲染类：每行按采样判读（页面侧没回的行 = 没判，进 skipped）
  for (const rp of p.render ?? []) {
    const row = byKey.get(rp.key);
    if (!row) {
      skipped.push({ kind: rp.kind, id: rp.id, why: `「${rp.id}」的 ${rp.kind} 没有采样结果 —— 没判（不是通过）` });
      continue;
    }
    if (row.error) {
      skipped.push({ kind: rp.kind, id: rp.id, why: `「${rp.id}」的 ${rp.kind} 页面侧报错：${row.error} —— 没判` });
      continue;
    }
    const samples = Array.isArray(row.samples) ? row.samples : [];
    if (rp.kind === 'appearsBy') {
      const pair = samples.find((s) => s && Number.isFinite(s.changedRatio));
      if (!pair) {
        skipped.push({ kind: rp.kind, id: rp.id, why: '帧对的 changedRatio 没读到 —— 没判' });
        continue;
      }
      if (pair.changedRatio >= thr.changed) { passed++; continue; }
      errors.push({
        kind: 'appearsBy', id: rp.id,
        message: `appearsBy：「${rp.id}」到 ${Number(rp.param).toFixed(2)}s 仍没有可见变化（changedRatio ${pair.changedRatio.toFixed(5)} < ${thr.changed}）—— 该出现的没出现`,
      });
      continue;
    }
    if (rp.kind === 'keepsMoving') {
      const maxStatic = Number(rp.param);
      let run = 0, maxRun = 0, nJudge = 0, nErr = 0;
      for (const s of samples) {
        if (!s || !Number.isFinite(s.changedRatio)) { nErr++; continue; }
        nJudge++;
        if (s.changedRatio < thr.changed) { run++; if (run > maxRun) maxRun = run; }
        else run = 0;
      }
      if (nErr) skipped.push({ kind: rp.kind, id: rp.id, why: `${nErr} 个采样点没跑成 —— 那些点没判（其余 ${nJudge} 点照判）` });
      if (!nJudge) {
        skipped.push({ kind: rp.kind, id: rp.id, why: '一个帧对都没读到（段太短或渲染失败）—— 没判' });
        continue;
      }
      const longest = maxRun * MOTION_STEP;   // 步长近似：连续 n 对全静 ≈ n × 0.5s（帧距 1/fps 不计）
      if (longest > maxStatic) {
        if (maxRun === 1) {
          // ① 持久性感知：单对帧静止（≈0.5s）、下一对就恢复 —— 瞬态，降级 info，永不 gate。
          //    （代价：maxStaticSec < 0.5s 时真问题也会被降级 —— 这条断言本就该配 ≥1s 的阈值）
          infos.push({
            kind: rp.kind, id: rp.id,
            message: `keepsMoving：「${rp.id}」只有 1 对相邻帧静止（≈${longest.toFixed(2)}s > maxStaticSec ${maxStatic}s），下一采样点恢复 —— 瞬态，不 gate`,
          });
        } else {
          errors.push({
            kind: rp.kind, id: rp.id,
            message: `keepsMoving：「${rp.id}」连续静止 ${longest.toFixed(2)}s（${maxRun} 对相邻帧全静，> maxStaticSec ${maxStatic}s）—— 整段没动`,
          });
        }
      } else passed++;
      continue;
    }
    // noEdgeContent：每点用 edgeSafeHits() 判，再按"跨采样点是否保持"分 error / info
    {
      let nHit = 0, nJudge = 0, nErr = 0;
      /** @type {string[]} */
      const where = [];
      for (const s of samples) {
        if (!s || s.error) { nErr++; continue; }
        nJudge++;
        const hits = edgeSafeHits(s.groups, s.W, s.H, thr.edgeSafe);
        if (hits.length) {
          nHit++;
          if (where.length < 3) where.push(...hits.slice(0, 2).map((h) => `${h.edge}边「${(h.sample || '…').slice(0, 8)}」`));
        }
      }
      if (nErr) skipped.push({ kind: rp.kind, id: rp.id, why: `${nErr} 个采样点没跑成 —— 那些点没判` });
      if (!nJudge) {
        skipped.push({ kind: rp.kind, id: rp.id, why: '一个采样点都没读到（段太短或渲染失败）—— 没判' });
        continue;
      }
      if (nHit === 0) { passed++; continue; }
      if (nHit >= nJudge) {
        errors.push({
          kind: rp.kind, id: rp.id,
          message: `noEdgeContent：「${rp.id}」${nHit}/${nJudge} 个采样点的文字块压进 ${(thr.edgeSafe * 100).toFixed(0)}% 边缘带（${where.join('、')}）—— 元素出画/压边`,
        });
      } else {
        // ① 持久性感知：只有一个采样点压边（入场/出场瞬时）—— 降级 info
        infos.push({
          kind: rp.kind, id: rp.id,
          message: `noEdgeContent：「${rp.id}」只在 ${nHit}/${nJudge} 个采样点压边（${where.join('、')}）—— 瞬态，不 gate`,
        });
      }
    }
  }

  // ③ 段名找不到的断言：单列 missing → error。「绝不当通过」——
  //    --only 之后段表会变，这时必然批量出现，正好提醒"这次体检对这些段是盲的"
  for (const m of p.missing ?? []) {
    errors.push({
      kind: String(m.kind), id: String(m.names ?? []),
      message: `${m.kind}(${(m.names ?? []).map((n) => JSON.stringify(n)).join(', ')}) 里的段名 ${(m.unknown ?? []).map((n) => JSON.stringify(n)).join('、')} 在时间线里找不到（段名拼错，或 --only 之后段表变了）—— 这条断言没判，绝不当通过`,
    });
  }

  // ④ 不认识的断言形状：写了但没生效 ≠ 通过
  for (const ig of p.ignored ?? []) {
    skipped.push({ kind: String(ig.kind ?? ''), id: '', why: `${ig.reason} —— 这条没生效` });
  }

  // ⑤ 空 ≠ 干净：一条断言都没有 / 有段没被任何断言覆盖，都要说出来（没判 ≠ 通过）
  if (p.totals && p.totals.asserts === 0) {
    skipped.push({ kind: '(全部)', id: '', why: 'motion.json 里没有任何断言 —— 没判 ≠ 通过' });
  }
  const uncovered = Array.isArray(p.uncovered) ? p.uncovered : [];
  if (uncovered.length) {
    skipped.push({
      kind: '(覆盖)', id: '',
      why: `时间线里 ${uncovered.length} 段没被任何断言覆盖：${uncovered.join(', ')} —— 没判 ≠ 通过`,
    });
  }

  return { errors, infos, skipped, passed, uncovered };
}

/** 打印时间线（CLI 的 tasks/check 用）。 */
export function describe(timeline) {
  return timeline.map((i) =>
    `  ${String(i.id).padEnd(14)} ${i.start.toFixed(2).padStart(8)} → ${i.end.toFixed(2).padStart(8)}  (${(i.end - i.start).toFixed(2)}s)${i.note ? '  ' + i.note : ''}`
  ).join('\n');
}
