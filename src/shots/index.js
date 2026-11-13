// @ts-check
/**
 * `src/shots/` —— A 档**镜头库**：把反复出现的镜头沉淀成「模板 + 参数」。
 *
 * 以前每做一支片子都要把同一批镜头重写一遍（`tasks/demo/scenes/chart.js` 126 行、
 * `tasks/beat/scenes/grid.js` 83 行…），而且要记住一堆不成文的约定。现在常见镜头只剩一行：
 *
 * ```js
 * // tasks/<任务>/scenes/chart.js
 * import { shot } from '../../../src/shots/index.js';
 * export default shot('chart', {
 *   values: [0.3, 0.7, 0.95],
 *   title: '这一轮的成绩',
 * });
 * ```
 *
 * ## 三个要点
 *
 * 1. **模板返回的就是普通场景对象**（`{ id, setup, render }`），所以「模板镜头」与
 *    「手写场景」能混在同一条时间线里 —— 没想法的那几段用模板，需要创意的照旧写代码。
 * 2. **参数写错会抛错**，不静默忽略：`shot('chart', { value: [...] })`（少个 s）会点名
 *    「没有参数 "value"」并列出可用参数。这一条是刻意的 —— 这个引擎最贵的 bug 全是
 *    「写错了但画面照样出」（见 `docs/history/IMPROVEMENTS-1-3.md`）。
 * 3. **模板里的绘制代码是从已经出过片的场景逐字搬过来的**，画面逐像素一致
 *    （`tasks/demo` / `tasks/beat` 的验收：`node scripts/anim.mjs hashes <任务> --baseline`）。
 *    想改模板的数值/顺序之前，先跑一次那个命令，改完再跑一次。
 *
 * ## 看看有哪些模板
 *
 * ```sh
 * node scripts/anim.mjs shots           # 列出全部模板
 * node scripts/anim.mjs shots chart     # 某个模板的全部参数与默认值
 * node scripts/anim.mjs shots wave --json   # 机器可读的那份（含 spec：requires / outputs）
 * ```
 *
 * ## 声明式 spec（BACKLOG 1-21，契约在 `docs/ENGINE.md` §14.9）
 *
 * 每个工厂函数上挂着一份 **`spec`**：参数类型（`params`）、**依赖**（`requires`）、产出（`outputs`）。
 * 它与 `.defaults` / `.meta` **并存、不互相替代**：
 *
 *   · `.defaults` 仍然是"什么都不传时的画面"的唯一来源（§14.1）；
 *   · `.meta` 仍然是给人看的参数说明（`desc`）与顺序；
 *   · `.spec` 是**声明**：`params` 是参数类型的声明（`meta.params[].type` 是它的副本，
 *     `tools/test-shots.mjs` 断言两者逐项相等），`requires` 是**依赖前置校验**读的那份事实
 *     （`scripts/anim.mjs` 的 `cmdCheck`：用了 `requires: ['music']` 的模板却没配 `audio`，
 *     会在**开浏览器之前**就报出来，而不是等出图发现全黑）。
 *
 * ⚠ 加 spec **不改任何调用签名、不改 defaults、不改绘制代码** —— 它只是把"以前写在散文里的事实"
 *   变成可以被机器读的字段。没有 `spec` 的模板，`listShots()` 里**根本不会出现** `requires` / `outputs`
 *   这两个键：读到"没有这个键"要理解成"还没声明过"，绝不能当成"不需要"。
 *
 * ## 选型（BACKLOG 1-62，学 JIZURA 的"部件表"）—— 见 `./pick.js`

 * 每个模板除了 defaults / meta / spec，还自报四件**选型元数据**（挂在工厂函数上）：
 * `tags`（气质/职能，封闭词表 `SHOT_TAGS`）、`w`（抽取权重 0.4–1.5）、
 * `fits(q)`（适用条件，见 pick.js 头注释的 brief 表）、`fitsNote`（人话版）。
 * `pickShot(list, q)` = 先按条件筛、再按权重抽、seed 决定抽到谁 —— 选型交给引擎，
 * 内容的作者只写内容。`SHOT_ENERGY` 也迁到了 pick.js（它本来就是这个家族的词），这里只转发。
 *
 * ## 登记就是一张表
 *
 * 本文件里唯一的清单是下面的 `REGISTRY` 数组 —— 加一个模板 = 加一行 import + 往数组里塞一行。
 * `SHOTS` 的键来自各工厂自己的 `meta.name`（缺了当场抛错，不会静默变成 "titleShot"）。
 * **没有用 `import.meta.glob` 自动扫目录**：CLI（`node scripts/anim.mjs`，裸 Node）与浏览器
 * （Vite）要共用这份登记，glob 是 Vite 专属 API，裸 Node 里是 undefined —— 为省一行 import
 * 引入双环境分叉不值（JIZURA 可以只活在一个环境里，我们不能）。
 * `tools/test-shots.mjs` 的 `TEMPLATES` 手写表保留：它要的就是"多一个少一个都红"。
 *
 * ## 边界（什么不该进这里）
 *
 * 只放**反复出现、与具体片子无关**的整镜头。某一支片子特有的视觉母题
 * （fidus 的准星、nekohome 的窗口边框）留在那个任务的 `scenes/_kit.js` 里；
 * 「一个镜头该有的骨架」（共享背景 / 甩镜转场 / 一台摄影机）在 `src/kit/shot.js` 的
 * `makeShot()` 里，两者可以叠起来用：模板负责画面，`makeShot` 负责骨架。
 * 全新的视觉想法（raymarch 晶格、燃烧的引线）**仍然要手写场景** —— 这是 A 档，不是 DSL。
 */

import { titleShot } from './title.js';
import { chartShot } from './chart.js';
import { kineticShot } from './kinetic.js';
import { whipShot } from './whip.js';
import { outroShot } from './outro.js';
import { waveShot } from './wave.js';
import { pulseShot } from './pulse.js';
import { gridShot } from './grid.js';
import { quoteShot } from './quote.js';
import { counterShot } from './counter.js';
import { compareShot } from './compare.js';
// BACKLOG 1-48 第一批（11 → 15）：一屏一句 / 扫描格阵 / 界面窗口 / 一笔线稿
import { bigtypeShot } from './bigtype.js';
import { scanShot } from './scan.js';
import { deviceShot } from './device.js';
import { lineartShot } from './lineart.js';
// BACKLOG 1-48 第二批（15 → 18）：图表形变 / 分层纸片 / 署名定版
import { morphShot } from './morph.js';
import { layersShot } from './layers.js';
import { isometricShot } from './isometric.js';
import { celShot } from './cel.js';
import { liquidShot } from './liquid.js';
import { lockupShot } from './lockup.js';
// 1-48 收尾批（18 → 20）：横向事件轴 / 径向分布
import { timelineShot } from './timeline.js';
import { radialShot } from './radial.js';
// BACKLOG 1-67：像素风 —— 调色板 / 块 / 抖动 / 12fps 台阶
import { pixelShot } from './pixel.js';
// BACKLOG 1-69（素材包缺口表第 6 行）：手写笔迹 —— 白板 / 纸感手写讲解
import { handwriteShot } from './handwrite.js';
import { revealShot } from './reveal.js';
import { cascadeShot } from './cascade.js';
import { transformShot } from './transform.js';
import { deconstructShot } from './deconstruct.js';
// C2 分镜三件套：占位卡（不是成片画面，选型抽不到）
import { placeholderShot } from './placeholder.js';

// 选型词表从 `./pick.js` 转发（1-62 迁移）：老读者（anim.mjs / test-shots）从这里拿，不受影响。
export {
  pickShot, pickSequence, eligibleShots,
  SHOT_TAGS, SHOT_SLOTS, SHOT_ENERGY,
} from './pick.js';

// 各工厂的具名导出（1-62 之后 SHOTS 的键来自 meta.name，但具名导出对任务与工具仍然有用）
export { titleShot, chartShot, kineticShot, whipShot, outroShot, waveShot, pulseShot, gridShot,
  quoteShot, counterShot, compareShot, bigtypeShot, scanShot, deviceShot, lineartShot,
  morphShot, layersShot, isometricShot, celShot, liquidShot, lockupShot, timelineShot, radialShot,
  pixelShot, handwriteShot, revealShot, cascadeShot, transformShot, deconstructShot };

/**
 * `spec.requires` 认得的**依赖令牌**（词表 = 契约的一部分）。
 *
 * `anim shots --json` 会把它作为顶层 `requireTokens` 原样带出去 —— 读的人（或读的机器）
 * 不必去翻 `scripts/anim.mjs` 才知道 `'music'` 是什么意思。词表只许**加**新令牌，
 * 不许改已有令牌的含义（老的读者会按这些串做判断）。
 */
export const SHOT_REQUIRES = {
  music: '画面读 `ctx.music`（音频包络 / 真实打击事件 / 拍号）—— 任务要在 task.config.mjs 里配 `audio`',
  analyze: '要有预计算好的音频分析 `tasks/<任务>/audio/<文件>.analysis.json`（`node scripts/anim.mjs analyze <任务>`）',
  under: '画面读上一段的成帧 `ctx.under` —— 时间线上必须与上一段交叠（`overlap`），并让它自己处理转场',
};

/**
 * `spec.outputs.visual` 的取值范围：
 *   · `'full-frame'`  自己铺满整帧（§14.4），一个模板镜头就是一段完整画面；
 *   · `'transition'`  转场镜头：它把上一段甩走，不能单独作为一段完整画面来看。
 */
export const SHOT_VISUALS = ['full-frame', 'transition'];

/**
 * 镜头模板 → 工厂函数。键 = `shot('名字', {…})` 里的名字（B 档 `{ type: '名字' }` 分发也读它）。
 *
 * **登记的唯一清单是 `REGISTRY`**（学 JIZURA 的"加表达只加一个 pack 文件"——
 * `docs/REFERENCE-jizura.md` §3）：加模板 = 加一行 import + 往数组塞一行。
 * 键取自各工厂自报的 `meta.name`；缺了当场抛错，不会静默登记成 "titleShot"。
 */
const REGISTRY = [
  titleShot, chartShot, kineticShot, whipShot, outroShot, waveShot, pulseShot, gridShot,
  quoteShot, counterShot, compareShot, bigtypeShot, scanShot, deviceShot, lineartShot,
  morphShot, layersShot, isometricShot, celShot, liquidShot, lockupShot, timelineShot, radialShot,
  // BACKLOG 1-67 / 1-69：像素风 / 手绘笔迹（夹具 tasks/_pixel-lab、_handwrite-lab）
  pixelShot, handwriteShot,
  revealShot, cascadeShot, transformShot,
  deconstructShot,
  placeholderShot,
];

/** 模板名 -> 工厂函数（键来自各工厂自报的 meta.name —— 缺了当场抛错，不会静默变成 titleShot）。 */
const keyOf = (factory) => {
  const k = /** @type {any} */ (factory).meta?.name;
  if (typeof k !== 'string' || !k) {
    throw new Error(`镜头模板工厂 ${factory.name} 没有自报 meta.name（SHOTS 的键来自它，登记前先补上）`);
  }
  return k;
};

/** 模板名 → 工厂函数（顺序 = REGISTRY 顺序 = `anim shots` 列表顺序，别打乱）。 */
export const SHOTS = Object.fromEntries(REGISTRY.map((f) => [keyOf(f), f]));

/**
 * 取一个镜头模板，返回可以直接放进时间线的场景对象。
 *
 * ```js
 * export default shot('title', { title: '写代码，就是做动画' });
 * export default shot('wave', { id: 'intro' });      // id 覆盖段名（--only / HUD / 报错里用它）
 * ```
 *
 * @param {string} name 模板名（`listShots()` 里那些）
 * @param {Record<string, any>} [opts] 模板参数；**键写错会抛错**，不静默忽略
 * @returns {any} 场景对象（`{ id, setup?, render }`）
 */
export function shot(name, opts = {}) {
  const factory = SHOTS[name];
  if (typeof factory !== 'function') {
    throw new Error(
      `未知的镜头模板 "${name}"。可用的：${Object.keys(SHOTS).join(' / ')}`
      + '（看参数：node scripts/anim.mjs shots <名字>）',
    );
  }
  // ⚠ 参数白名单就是 factory.defaults（不是 spec.params、也不是 meta.params）。
  //   加一个可选参数要三处都写：DEFAULTS（校验用）、meta.params（--help）、spec.params（契约）。
  //   只写后两处的话 check / still 会报「没有参数 xxx」，而 node --check 不会 —— 实测踩过。
  const valid = factory.defaults ?? {};
  if (opts && typeof opts === 'object') {
    for (const k of Object.keys(opts)) {
      if (!(k in valid)) {
        throw new Error(
          `镜头模板 "${name}" 没有参数 "${k}"（大概是拼错了）。`
          + `可用参数：${Object.keys(valid).join(' / ')}`,
        );
      }
    }
  }
  const scene = factory(opts);
  /**
   * 把模板的**声明式依赖**带到场景对象上（BACKLOG 头部 ② 的收口，2026-10-16）。
   *
   * 为什么必须搬运一次：`spec` 挂在**工厂函数**上（`SHOTS.chart.spec`），而时间线展开之后
   * 引擎手里只有**场景对象**（`item._scene`）—— 段对象上的 `requires` 于是永远是 undefined。
   * 后果是「依赖前置校验」只查得了任务源码文本里那几条（`music` / `analyze`），
   * `under` 这种**时间线层**的依赖谁也没查过。
   *
   * 现在段对象自己带着令牌，段级审计（`src/timeline.js` 的 `auditUnderRequires()`，
   * 由 `src/app.js` 的 `underAudit()` 暴露给 CLI）就能在**时间线展开之后**判它：
   * `under` 要求这一段与上一段真的交叠（`ctx.under` 只在交叠窗里有值）。
   *
   * ⚠ 只加一个数组属性，**不碰调用签名、不碰 defaults、不碰绘制代码** —— 画面零变化。
   * ⚠ 场景自己已经写了 `requires` 时不覆盖（作者显式写的优先）。
   */
  const req = /** @type {any} */ (factory).spec?.requires;
  if (Array.isArray(req) && req.length && scene && typeof scene === 'object'
      && /** @type {any} */ (scene).requires == null) {
    /** @type {any} */ (scene).requires = [...req];
  }
  return scene;
}

/**
 * 列出全部模板及其参数 —— CLI 的 `anim shots` 用的就是它。
 *
 * 参数表来自每个模板自己的 `meta`，默认值来自它的 `defaults`（唯一来源，
 * 所以"文档里写的默认值"与"代码实际用的默认值"不可能对不上；
 * `tools/test-shots.mjs` 会断言两者的键集合完全相等）。
 * **参数类型**以 `spec.params` 为准（没有 spec 时回落到 `meta.params[].type`）——
 * 两份声明由 `tools/test-shots.mjs` 断言逐项相等，所以不可能各说各话。
 *
 * `requires` / `outputs` 来自模板的 `spec`（BACKLOG 1-21）：**没有 spec 的模板，
 * 这两个键在返回的对象里根本不出现**（"缺字段 ≠ 不需要"，见 `docs/ENGINE.md` §14.9）。
 *
 * `use` / `energy` / `avoid` 来自 `meta`（BACKLOG 1-42）：同样"有才加键"。它们是
 * `anim shots --use <词>` 的检索面 —— 选镜头时先回答"这一拍多响、什么时候别用"。
 *
 * `tags` / `w` / `fits` / `fitsNote` 来自工厂自报的选型元数据（BACKLOG 1-62，`./pick.js`）：
 * 同样"有才加键"。`tags` 是气质/职能（封闭词表 `SHOT_TAGS`），`w` 是抽取权重（0.4 冷门 – 1.5 主力），
 * `fits` 是**函数本体**（`eligibleShots`/`pickShot` 读它；`JSON.stringify` 会自动略过函数，
 * 所以 `--json` 里天然只见 `fitsNote`），`fitsNote` 是它的人话版。
 *
 * @returns {{ name: string, summary: string, notes: string,
 *             use?: string, energy?: string, avoid?: string,
 *             tags?: string[], w?: number, fits?: (q: any) => boolean, fitsNote?: string,
 *             params: { name: string, type: string, desc: string, default: any }[],
 *             requires?: string[], outputs?: any }[]}
 */
export function listShots() {
  return Object.entries(SHOTS).map(([name, factory]) => {
    const meta = /** @type {any} */ (factory).meta ?? {};
    const defaults = /** @type {any} */ (factory).defaults ?? {};
    const spec = /** @type {any} */ (factory).spec ?? null;
    return {
      name,
      summary: meta.summary ?? '',
      notes: meta.notes ?? '',
      params: (meta.params ?? []).map((p) => ({
        ...p,
        type: spec?.params?.[p.name] ?? p.type,
        default: defaults[p.name],
      })),
      // ⚠ 用"有 spec 才加键"而不是"没有就给个空数组"：后者会把"还没声明过"伪装成
      //   "声明了、不需要任何东西" —— 那正是 §14.9 第 2 条读法要防的那种静默失真。
      ...(spec ? { requires: spec.requires ?? [], outputs: spec.outputs ?? null } : {}),
      ...(typeof meta.use === 'string' && meta.use.trim() ? { use: meta.use } : {}),
      ...(typeof meta.energy === 'string' && meta.energy.trim() ? { energy: meta.energy } : {}),
      ...(typeof meta.avoid === 'string' && meta.avoid.trim() ? { avoid: meta.avoid } : {}),
      // 选型元数据（1-62）：tags/w/fits/fitsNote 有才加。⚠ fits 必须是**函数本体**
      //   （eligibleShots 按 `typeof s.fits === 'function'` 判）—— 以前这里误放人话字符串，
      //   筛选器静默跳过 → 角色锁全失效（outro 混进正文池）。人话版单独走 fitsNote。
      ...(Array.isArray(/** @type {any} */ (factory).tags) ? { tags: /** @type {any} */ (factory).tags } : {}),
      ...(typeof /** @type {any} */ (factory).w === 'number' ? { w: /** @type {any} */ (factory).w } : {}),
      ...(typeof /** @type {any} */ (factory).fits === 'function' ? { fits: /** @type {any} */ (factory).fits } : {}),
      ...(typeof /** @type {any} */ (factory).fitsNote === 'string' ? { fitsNote: /** @type {any} */ (factory).fitsNote } : {}),
    };
  });
}

/**
 * 按用途筛镜头（`anim shots --use <词>` 的实现，纯函数、可单测）。
 *
 * 匹配面：模板名 / summary / `use` / `energy` / `avoid` / `tags`，大小写不敏感、子串匹配。
 * `tags`（1-62）进匹配面后，`--use 数据` 这种中文词命不中英文 tag —— 但 tag 检索有专门一条路：
 * `anim shots --pick --tags data`（或 `--use` 里写英文 tag 本身，它也在子串匹配面里）。
 * 为什么把 `avoid` 也放进来：搜"字幕"时，一个"**别**用它做字幕"的说明同样是有效答案
 * （查的人往往分不清"我要什么"和"我该躲什么"）。
 *
 * @param {ReturnType<typeof listShots>} list
 * @param {string} query
 * @returns {ReturnType<typeof listShots>}
 */
export function filterShots(list, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return list;
  return (list ?? []).filter((s) => [s.name, s.summary, s.use, s.energy, s.avoid,
    ...(Array.isArray(s.tags) ? s.tags : [])]
    .filter(Boolean).join(' ').toLowerCase().includes(q));
}
