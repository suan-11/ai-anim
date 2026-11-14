// @ts-check
/**
 * `src/shots/pick.js` —— 镜头模板的**确定性选型**（BACKLOG 1-62）。
 *
 * 来源：[`docs/REFERENCE-jizura.md`](../../docs/REFERENCE-jizura.md) §2 —— JIZURA 真正的设计
 * 不是"部件多"，而是**每个部件带元数据**：`tags`（适合什么气质）、`w`（抽取权重，冷门 0.4–0.7 /
 * 主力 1.2–1.5）、`fits(n)`（适用条件，字数超了就抽不到它）。选镜头 = **先按条件筛、再按权重抽，
 * seed 决定抽到谁** —— 内容的作者只写内容，不负责选型。
 *
 * 这一层落到我们这里就是三件事：
 *
 *   1. **词表**：`SHOT_TAGS`（气质/职能，封闭词表）、`SHOT_SLOTS`（角色槽）、
 *      `SHOT_ENERGY`（能量五档，从 `index.js` 迁来 —— 它本来就是这个家族的词）。
 *      词表**只许加不许改**：查询串（`anim shots --tags …`）按这些串做判断。
 *   2. **每个模板自报** `tags` / `w` / `fits(q)` / `fitsNote`（挂在工厂函数上，`src/shots/*.js` 文件尾）。
 *   3. **抽签**：`pickShot(list, q)` / `pickSequence(list, q, n)` —— 同一个查询 + 同一个 seed
 *      **永远抽到同一个**（`rng(seed)`，与画面的随机数同源同纪律）；换 seed = 重抽一版
 *      （JIZURA 的"随机生成一版"）；`exclude` = 只换这一项。
 *
 * ## `fits(q)` 的查询对象（选型 brief）——字段缺省 = 不设限
 *
 * | 字段 | 类型 | 含义 | 谁读它 |
 * |---|---|---|---|
 * | `slot` | string | 这一段的角色槽：`'opening'`（片头）/ `'content'`（正文）/ `'ending'`（收尾）/ `'transition'`（转场位） | 角色锁定模板（outro / lockup / whip）**只**在对应槽里可抽；`slot` 缺省时它们**不可抽**——不指明角色，收尾片就不会自己浮上来 |
 * | `chars` | number | 这一屏的主文本字数 | title / kinetic / bigtype |
 * | `rows` | number | 行数（引文行数、指标行数） | quote / compare |
 * | `points` | number | 数据点 / 事件 / 节点 / 层数 | chart / morph / timeline / lineart / radial / layers |
 * | `hasMusic` | boolean | 任务配了 audio 吗 | wave / pulse / grid（`false` 时不可抽） |
 * | `hasScreenshot` | boolean | 有真截图可用吗 | device（`true` 时不可抽——真图比画的更像） |
 * | `energy` | string | 能量五档之一（硬筛） | 全部 |
 * | `tags` | string[] | 气质/职能词，**任一命中即可**（更宽；要"同时"就用两个词各跑一次再人工合） | 全部 |
 * | `exclude` | string[] | 排除的模板名（"只换这一项"就是换个 seed + 排除上一个） | 全部 |
 * | `seed` | number | 抽签种子（缺省 1） | 全部 |
 *
 * ## 硬规则
 *
 *   · **拼错点名**：`slot` / `tags` 不在词表里直接抛错（不静默当成"筛空"）——
 *     这个引擎最贵的 bug 全是"写错了但画面照样出"。
 *   · **落空给诊断**：候选筛成 0 时不给 undefined，抛错并说清是**哪一步筛没的**、
 *     筛没前还剩谁 —— 放宽哪个条件一看便知。
 *   · **纯函数**：不读全局、不记状态；同一个 `list` + 同一个 `q` 结果逐字节相同。
 */

import { rng } from '../core/util.js';

/**
 * 气质/职能词表（封闭，只许加）。气质答"这一段什么味道"，职能答"它在线索里干什么"。
 * `anim shots --tags 数据` 按这些串匹配（中英同收：词表是英文短词，`--tags` 的匹配面
 * 另含 summary / use / energy / avoid 的中文，见 `filterShots`）。
 */
export const SHOT_TAGS = [
  // 气质
  'calm', 'pop', 'graphic', 'editorial', 'emotional', 'tech', 'handmade',
  // 职能
  'title', 'data', 'flow', 'structure', 'process', 'music', 'ending', 'transition',
];

/**
 * 角色槽词表（`q.slot` 的取值）。一段片子 = 开头 → 正文×n → 收尾，转场位是叠在两段之间的那一段。
 */
export const SHOT_SLOTS = ['opening', 'content', 'ending', 'transition'];

/**
 * 能量五档（BACKLOG 1-42 起是模板 meta 的字段；1-62 迁到这里 —— 它与 tags/w 一样是
 * **选型词表**。仍从 `src/shots/index.js` 转发导出，老读者不受影响）。
 * ⚠ 词表只许**加**不许改：`--energy` 查询与 `tools/test-shots.mjs` 都依赖这个顺序。
 */
export const SHOT_ENERGY = ['低', '中低', '中', '中高', '高', 'none'];   // 'none'：分镜占位（C2），不参与能量筛选

/* ------------------------------------------------------------------ fits 组合子 */

/**
 * 正文可用：不在收尾位/转场位（这两个位子被角色锁定模板占着）。
 * `slot` 缺省 = 不过问角色（所有正文模板都过）。
 */
export const contentOk = (q) => q?.slot !== 'ending' && q?.slot !== 'transition';

/** 只在收尾位可抽（outro / lockup）。 */
export const endingOnly = (q) => q?.slot === 'ending';

/** 只在转场位可抽（whip）。 */
export const transitionOnly = (q) => q?.slot === 'transition';

/** 要音频：正文位 + 任务没有明确说"没配 audio"（`hasMusic: false` 才否决，缺省放行）。 */
export const musicOk = (q) => contentOk(q) && q?.hasMusic !== false;

/** 数量上限：`v` 缺省 = 不设限。 */
export const atMost = (v, hi) => v == null || v <= hi;

/** 数量区间：`v` 缺省 = 不设限。 */
export const within = (v, lo, hi) => v == null || (v >= lo && v <= hi);

/** 有真截图就别用（device）：`hasScreenshot: true` 时否决，缺省放行。 */
export const noScreenshot = (q) => q?.hasScreenshot !== true;

/* ------------------------------------------------------------------ 角色槽（集中一处） */

/**
 * 一个模板属于哪个角色槽 —— **从 tags 派生，不另立一张表**。
 * 两张表（名字表 vs 模板里的 tags）迟早漂移，而 tags 已经是模板的自述元数据。
 */
export function slotOf(s) {
  const tags = Array.isArray(s?.tags) ? s.tags : [];
  if (tags.includes('ending')) return 'ending';
  if (tags.includes('transition')) return 'transition';
  return 'content';
}

/**
 * 角色槽放行判定。**选型与诊断共用这一个函数** —— 这段语义原先藏在各模板的 `fits()` 里，
 * 结果是「slot 卡住了」被报成「fits 筛空了」，用户按报错去放宽 fits 找不到着力点。
 *
 * · 不指明 `slot` → 只有正文位模板可抽（收尾片不会自己浮上来）；
 * · `slot: 'ending'` → 只有 outro / lockup；`'transition'` → 只有 whip。
 */
export function slotOk(s, q) {
  const role = slotOf(s);
  const want = q?.slot;
  // 不指明角色 → 只有正文位模板（收尾/转场片不会自己浮上来）
  if (want == null) return role === 'content';
  if (role === 'ending') return want === 'ending';
  if (role === 'transition') return want === 'transition';
  // 正文位模板在 content 与 opening 都可抽（片头位不是"另一种角色"，只是位置更靠前）
  return want === 'content' || want === 'opening';
}

/* ------------------------------------------------------------------ 校验与筛选 */

/** 抛"拼错点名"错误。 */
function badQuery(msg) {
  throw new Error(`选型查询不合法：${msg}`);
}

/** 校验查询对象：词表拼错直接抛（不静默当成"筛空"）。数值字段强转并查 NaN。 */
function validateQuery(q) {
  if (q == null || typeof q !== 'object') badQuery('q 必须是对象（例如 { slot: "content", seed: 7 }）');
  if (q.slot != null && !SHOT_SLOTS.includes(q.slot)) {
    badQuery(`slot "${q.slot}" 不在词表里。可用的：${SHOT_SLOTS.join(' / ')}`);
  }
  if (q.tags != null) {
    if (!Array.isArray(q.tags)) badQuery('tags 必须是字符串数组');
    for (const t of q.tags) {
      if (!SHOT_TAGS.includes(t)) {
        badQuery(`tag "${t}" 不在词表里。可用的：${SHOT_TAGS.join(' / ')}（气质 ${SHOT_TAGS.slice(0, 7).join('/')}；职能 ${SHOT_TAGS.slice(7).join('/')}）`);
      }
    }
  }
  for (const k of ['chars', 'rows', 'points', 'seed']) {
    if (q[k] != null && (!Number.isFinite(Number(q[k])))) {
      badQuery(`${k}="${q[k]}" 不是数`);
    }
  }
  if (q.energy != null && typeof q.energy !== 'string') badQuery('energy 必须是字符串（五档之一）');
  if (q.exclude != null && !Array.isArray(q.exclude)) badQuery('exclude 必须是字符串数组（模板名）');
}

/**
 * 一个模板在该查询下是否可用。`fits` 缺失 = 永远可用（但 `tools/test-shots.mjs` 会要求
 * 全员自报元数据，所以这只对"还没补齐的模板"临时成立）。
 */
function eligible(s, q) {
  if (q.energy != null && q.energy !== '' && s.energy !== q.energy) return false;
  if (Array.isArray(q.tags) && q.tags.length
    && !q.tags.some((t) => Array.isArray(s.tags) && s.tags.includes(t))) return false;
  if (Array.isArray(q.exclude) && q.exclude.includes(s.name)) return false;
  if (!slotOk(s, q)) return false;                                   // 角色槽：先于 fits（诊断要能分开报）
  if (typeof s.fits === 'function' && !s.fits(q)) return false;
  return true;
}

/**
 * 按查询筛出候选池（纯函数，不抽样 —— 抽样在 `pickShot`）。
 *
 * @param {ReturnType<import('./index.js').listShots>} list
 * @param {Record<string, any>} [q] 查询对象（见本文件头注释的表）
 * @returns {ReturnType<import('./index.js').listShots>} 候选池（新数组）
 */
export function eligibleShots(list, q = {}) {
  validateQuery(q);
  return (list ?? []).filter((s) => eligible(s, q));
}

/**
 * 诊断"为什么筛空了"：按 energy → tags → exclude → fits 的顺序重放每一步，
 * 报出**第一步筛到 0 的那一步**与筛前剩下的名字 —— 放宽哪个条件一目了然。
 */
function diagnoseEmpty(list, q) {
  /** @type {any[]} */
  let pool = (list ?? []).slice();
  const total = pool.length;
  const step = (label, keep, hint) => {
    const next = pool.filter(keep);
    if (!next.length && pool.length) {
      const left = pool.map((s) => s.name).join(' / ');
      return `${label} 筛空了（之前剩 ${pool.length}/${total}：${left.slice(0, 120)}${left.length > 120 ? '…' : ''}）`
        + (hint ? `【${hint}】` : '');
    }
    pool = next;
    return null;
  };
  const parts = [];
  if (q.energy) parts.push(step(`energy="${q.energy}"`, (s) => s.energy === q.energy));
  if (Array.isArray(q.tags) && q.tags.length) parts.push(step(`tags=[${q.tags.join(',')}]`, (s) => q.tags.some((t) => s.tags?.includes(t))));
  if (Array.isArray(q.exclude) && q.exclude.length) parts.push(step(`exclude=[${q.exclude.join(',')}]`, (s) => !q.exclude.includes(s.name)));
  // 角色槽**单独一步**：它的语义是"这一段在片子里的角色"，不是"模板的适用条件"，
  // 混在 fits 里报出来会把人指错方向（实测：slot=ending 被报成 fits 筛空）。
  parts.push(step(
    q.slot == null ? 'slot（未指明 → 只许正文位）' : `slot="${q.slot}"`,
    (s) => slotOk(s, q),
    q.slot == null ? '收尾/转场位的模板要在 brief 里写 slot'
      : q.slot === 'ending' ? '角色锁：只有 outro / lockup 进 ending'
        : q.slot === 'transition' ? '角色锁：只有 whip 进 transition'
          : null,
  ));
  parts.push(step('fits', (s) => (typeof s.fits === 'function' ? s.fits(q) : true)));
  const killer = parts.find(Boolean);
  return `选型落空：${total} 个模板里没有满足查询的候选 —— ${killer ?? '全部条件叠加后为 0'}。`
    + ' 放宽办法：去掉最严的那个条件 / 换个 slot / 补全 brief（字段缺省 = 不设限）。';
}

/**
 * 从候选池里**按权重抽一个**（确定性：同一个 list + 同一个 q 永远同一个结果）。
 *
 * @param {ReturnType<import('./index.js').listShots>} list 全部模板（内部先筛）
 * @param {Record<string, any>} [q] 查询对象
 * @returns {{ name: string, w: number, tags: string[], fitsNote: string,
 *             pool: { name: string, w: number }[], seed: number }}
 */
export function pickShot(list, q = {}) {
  validateQuery(q);
  const pool = eligibleShots(list, q);
  if (!pool.length) throw new Error(diagnoseEmpty(list, q));
  const seed = q.seed != null ? Number(q.seed) : 1;
  const total = pool.reduce((a, s) => a + (typeof s.w === 'number' && s.w > 0 ? s.w : 1), 0);
  let x = rng(seed)() * total;
  let hit = pool[pool.length - 1];
  for (const s of pool) {
    x -= typeof s.w === 'number' && s.w > 0 ? s.w : 1;
    if (x <= 0) { hit = s; break; }
  }
  return {
    name: hit.name,
    w: typeof hit.w === 'number' ? hit.w : 1,
    tags: Array.isArray(hit.tags) ? hit.tags : [],
    fitsNote: typeof hit.fitsNote === 'string' ? hit.fitsNote : '',
    pool: pool.map((s) => ({ name: s.name, w: typeof s.w === 'number' ? s.w : 1 })),
    seed,
  };
}

/**
 * 抽一串（做一支片子的骨架）：每抽一个就把 `exclude` 加长一点再抽下一个 ——
 * **同一版里不重复**；候选不够 n 个时点名还剩谁。
 * 同一个 seed + 同一个 n 永远同一串（每轮都是新 `rng(seed)`，靠池子收缩保证确定性）。
 *
 * @param {ReturnType<import('./index.js').listShots>} list
 * @param {Record<string, any>} [q]
 * @param {number} n 要几个
 * @returns {ReturnType<typeof pickShot>[]}
 */
export function pickSequence(list, q = {}, n = 1) {
  const count = Number(n);
  if (!Number.isFinite(count) || count < 1) badQuery(`n="${n}" 不是 ≥1 的数`);
  validateQuery(q);
  /** @type {ReturnType<typeof pickShot>[]} */
  const out = [];
  const seen = Array.isArray(q.exclude) ? [...q.exclude] : [];
  for (let i = 0; i < count; i++) {
    let r;
    try {
      r = pickShot(list, { ...q, exclude: seen });
    } catch (e) {
      throw new Error(`抽到第 ${i + 1}/${count} 个时${e instanceof Error ? e.message : e}`);
    }
    out.push(r);
    seen.push(r.name);
  }
  return out;
}
