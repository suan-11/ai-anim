// @ts-check
import { flag, opt, positional } from "../lib/cli/args.mjs";
import { die, log } from "../lib/cli/log.mjs";
/* ------------------------------------------------------------------ 命令：shots */

/** `anim shots --json` 的 schema 版本（字段契约见 `docs/ENGINE.md` §14.9；改字段名就要改它）。 */
const SHOTS_SCHEMA = 'anim.shots/1';

/**
 * `anim shots --json` 的载荷（**纯函数**：不碰磁盘、不看时钟 —— 同一份 `src/shots/`
 * 永远得到同一个字符串，可以直接 diff / 存成基线。可离线断言）。
 *
 * 这是 BACKLOG **1-21**（给每个模板补声明式 `spec` + 依赖前置校验）的**输入契约**，
 * 所以字段名在这里一次定死，并按"将来能长出东西"的形状排：
 *
 *   { schema: 'anim.shots/1', count, requireTokens?, shots: [
 *       { name, summary, notes,
 *         params: [ { name, type, desc, default, required } ],
 *         requires?: ['music', …], outputs?: { visual: 'full-frame'|'transition', … } } ] }
 *
 * 三条**读法**（它们和字段名一样是契约，写在文档里）：
 *   · `required: true` ⟺ 这个参数**没有默认值**（不传时模板拿到 `undefined`）。
 *     JSON 里没有 `undefined`，所以这时 `default` 恒为 `null`、由 `required` 区分。
 *     当前 11 个模板的每个参数都有默认值 ⇒ 全是 `false`（这只说明"省掉它不会出错"，
 *     **不**说明"这个参数没用"——画面照样是模板自带的那一段）。
 *   · **缺字段 ≠ false / 空**：`requires` / `outputs` 是 1-21 补上的**声明式 spec**
 *     （`src/shots/*.js` 的 `xxxShot.spec`）。没有 spec 的模板，这两个键**根本不出现** ——
 *     读到"没有这个键"要理解成"还没声明过"，绝不能当成"不需要"。
 *     （1-21 只**加**字段、没改任何已有字段名 ⇒ `schema` 仍是 `anim.shots/1`，
 *       老的读者不会坏。见 `docs/ENGINE.md` §14.9。）
 *   · `requireTokens` 是**依赖令牌的词表**（`src/shots/index.js` 的 `SHOT_REQUIRES`）：
 *     `requires` 里出现的是令牌，不是自由文本 —— 词表随载荷一起发出去，机器读者不必翻源码。
 *     调用方不传词表时这个键不出现（纯函数不许自己去 import 模块）。
 *
 * 退出码 / 出错：模板名给错时 stdout 上什么都没有、stderr 一行 `✗ …`、退出码 1
 * （机器读者要按这个判，别去解析人读的那张表）。
 *
 * @param {{ name: string, summary?: string, notes?: string,
 *           params?: { name: string, type: string, desc?: string, default?: any }[],
 *           requires?: string[], outputs?: any }[]} list
 *        `listShots()` 的返回值（给了模板名时是只含一个元素的数组）；顺序原样保留
 * @param {Record<string, string>|null} [requireTokens] 依赖令牌词表（`SHOT_REQUIRES`），可省
 * @returns {{ schema: string, count: number, requireTokens?: any, shots: any[] }}
 */
function shotsCatalog(list, requireTokens = null) {
  const shots = (list ?? []).map((s) => ({
    name: String(s.name),
    summary: s.summary ?? '',
    notes: s.notes ?? '',
    params: (s.params ?? []).map((p) => {
      const hasDefault = p.default !== undefined;
      return {
        name: p.name,
        type: p.type,
        desc: p.desc ?? '',
        default: hasDefault ? p.default : null,
        required: !hasDefault,
      };
    }),
    // ⚠ 用"源对象里有这个键才加"而不是"没有就给个空数组/ null"：后者会把
    //   "还没声明过"伪装成"声明了、不需要任何东西"—— 那正是 §14.9 第 2 条读法要防的静默失真。
    ...(s && 'requires' in s ? { requires: s.requires ?? [] } : {}),
    ...(s && 'outputs' in s ? { outputs: s.outputs ?? null } : {}),
    // 用途元数据（1-42）：同样是"有才加键"。`use` / `avoid` 是给人和 agent 读的，
    // `energy` 只许取 SHOT_ENERGY 里的五档（`tools/test-shots.mjs` 断言）。
    ...(s && 'use' in s ? { use: s.use } : {}),
    ...(s && 'energy' in s ? { energy: s.energy } : {}),
    ...(s && 'avoid' in s ? { avoid: s.avoid } : {}),
    // 选型元数据（1-62，学 JIZURA 的部件表）：tags / w / fitsNote 有才加。
    // ⚠ `fits`（函数本体）不进 JSON——序列化会整个丢掉，读的人该看的是 `fitsNote` 人话版；
    //   真条件在 `src/shots/pick.js` 的 brief 契约里。
    ...(s && 'tags' in s ? { tags: s.tags } : {}),
    ...(s && 'w' in s ? { w: s.w } : {}),
    ...(s && 'fitsNote' in s ? { fitsNote: s.fitsNote } : {}),
  }));
  return {
    schema: SHOTS_SCHEMA,
    count: shots.length,
    ...(requireTokens ? { requireTokens: { ...requireTokens } } : {}),
    shots,
  };
}

/**
 * 镜头库（`src/shots/`）—— 列出可用的镜头模板与它们的参数。
 *
 *   node scripts/anim.mjs shots            # 全部模板
 *   node scripts/anim.mjs shots chart      # 某个模板的全部参数与默认值
 *   node scripts/anim.mjs shots --json     # 机器可读的参数表 + 声明式 spec（requires / outputs / requireTokens）
 *   node scripts/anim.mjs shots chart --json
 *   node scripts/anim.mjs shots --pick --slot content --chars 8 --seed 7   # 按条件筛+按权重抽一个（1-62）
 *   node scripts/anim.mjs shots --pick --n 6 --slot content --seed 3       # 抽一串（同一版内不重复）
 *
 * 为什么要有这条命令：模板名与参数名是这个库的公开 API（写错 `shot()` 会**抛错**，
 * 不静默忽略），而"有哪些模板、参数叫什么"不该靠翻源码才知道。
 *
 * `--json` 只**换一种呈现**，不换数据源：两者都来自 `listShots()`，所以"文档里写的默认值"
 * 与"代码实际用的默认值"不可能对不上（字段契约见 `docs/ENGINE.md` §14.9）。
 * ⚠ 不加 `--json` 的那份人读输出**一个字都不许变**：它与 §14.2 的参数表、`AGENTS.md` §3.2
 *   的示例是同一份事实，要改就得三处一起说清。
 */
async function cmdShots() {
  const { listShots, filterShots, SHOTS, SHOT_REQUIRES, SHOT_ENERGY, pickShot, pickSequence, SHOT_SLOTS } = await import("../../src/shots/index.js");
  const all = listShots();
  const use = opt('use', '');
  // ⚠ `positional()` 只按"以 - 开头"过滤，**不认识"某个 flag 的值"**：`shots --use 转场` 会把
  //   `转场` 当成 positional(0)。这条命令没有任务名参数，所以在这里把 flag 的值让开。
  const want = positional(0) === use && use !== '' ? positional(1) : positional(0);

  /* ── 选型模式（BACKLOG 1-62，学 JIZURA 的部件表）────────────────────────────
   *
   *   node scripts/anim.mjs shots --pick --slot content --tags data,graphic --points 5 --seed 7
   *   node scripts/anim.mjs shots --pick --n 6 --slot content --seed 3     # 抽一串（一支片子的骨架）
   *
   * 先筛后抽：energy / tags（任一命中） / fits（chars·rows·points·slot·hasMusic·hasScreenshot）
   * 是硬条件，w 是权重，seed 决定抽到谁 —— 同一个查询 + 同一个 seed 永远同一个结果；
   * 换 seed = 重抽一版；`--exclude chart` = 只换这一项。角色锁定：outro/lockup 只进 `--slot ending`，
   * whip 只进 `--slot transition`（不指明角色槽，它们不会被抽到）。
   */
  const numOpt = (k) => (opt(k, '') === '' ? undefined : Number(opt(k, '')));
  const pickQ = {
    slot: opt('slot', '') || undefined,
    tags: opt('tags', '').split(',').map((t) => t.trim()).filter(Boolean),
    energy: opt('energy', '') || undefined,
    chars: numOpt('chars'),
    rows: numOpt('rows'),
    points: numOpt('points'),
    hasMusic: flag('music') ? true : flag('no-music') ? false : undefined,
    hasScreenshot: flag('shot') ? true : flag('no-shot') ? false : undefined,
    exclude: opt('exclude', '').split(',').map((t) => t.trim()).filter(Boolean),
    seed: numOpt('seed'),
  };
  if (flag('pick') || Object.values(pickQ).some((v) => v != null && !(Array.isArray(v) && !v.length))) {
    const n = numOpt('n') ?? 1;
    const pool = use ? filterShots(all, use) : all;
    const queryDesc = [
      `pool ${pool.length}/${all.length}`,
      pickQ.slot ? `slot=${pickQ.slot}` : '',
      pickQ.tags.length ? `tags=[${pickQ.tags.join(',')}]` : '',
      pickQ.energy ? `energy=${pickQ.energy}` : '',
      pickQ.chars != null ? `chars=${pickQ.chars}` : '',
      pickQ.rows != null ? `rows=${pickQ.rows}` : '',
      pickQ.points != null ? `points=${pickQ.points}` : '',
      pickQ.hasMusic !== undefined ? `hasMusic=${pickQ.hasMusic}` : '',
      pickQ.hasScreenshot !== undefined ? `hasScreenshot=${pickQ.hasScreenshot}` : '',
      pickQ.exclude.length ? `exclude=[${pickQ.exclude.join(',')}]` : '',
      `seed=${pickQ.seed ?? 1}`,
    ].filter(Boolean).join(' · ');
    let seq;
    try {
      seq = n > 1 ? pickSequence(pool, pickQ, n) : [pickShot(pool, pickQ)];
    } catch (e) {
      die(e instanceof Error ? e.message : String(e));
    }
    if (flag('json')) {
      log(JSON.stringify({ schema: 'anim.shots.pick/1', query: { ...pickQ, n }, pick: seq }, null, 2));
      return;
    }
    log(`选型（${queryDesc}）${n > 1 ? `—— 抽 ${n} 个` : ''}：\n`);
    for (const r of seq) {
      log(`  ✓ ${r.name.padEnd(9)} w ${r.w}  [${r.tags.join(' ')}]  ${r.fitsNote}`);
    }
    const r0 = seq[0];
    log(`\n  候选 ${r0.pool.length}：${r0.pool.map((c) => `${c.name}(${c.w})`).join(' ')}`);
    log('\n只换这一项：--seed 换个数，或 --exclude <名字>；看全部模板：node scripts/anim.mjs shots');
    log(`角色槽只有这几种：${SHOT_SLOTS.join(' / ')}（outro/lockup 只进 ending，whip 只进 transition）`);
    return;
  }

  if (!want) {
    if (flag('json')) { log(JSON.stringify(shotsCatalog(use ? filterShots(all, use) : all, SHOT_REQUIRES), null, 2)); return; }
    const list = filterShots(all, use);
    if (use && !list.length) {
      die(
        `没有模板匹配 --use ${JSON.stringify(use)}（匹配面：模板名 / summary / use / energy / avoid）。\n`
        + `  能量档位只有这五档：${SHOT_ENERGY.join(' / ')}。全部模板：\n`
        + all.map((s) => `  · ${s.name.padEnd(8)} ${s.energy ?? '?'}  ${s.use ?? s.summary}`).join('\n'),
      );
    }
    log(`镜头模板（src/shots/，共 ${list.length} 个${use ? `，--use ${JSON.stringify(use)} 从全部 ${all.length} 个里筛` : ''}）：\n`);
    const w = Math.max(...list.map((s) => s.name.length));
    for (const s of list) {
      log(`  ${s.name.padEnd(w)}   ${String(s.params.length).padStart(2)} 个参数   ${s.summary}`);
      // 第二行只放"选镜头时最先要回答的两件事"：多响、什么时候用。
      // `avoid` 留在详情页 —— 列表里塞三段话会让人扫不动（11 个模板 × 3 行）。
      if (s.energy || s.use) log(`  ${' '.repeat(w)}   能量 ${(s.energy ?? '?').padEnd(2)}  ·  ${s.use ?? ''}`);
    }
    log('\n用法：scenes/xxx.js 里 export default shot(\'名字\', { 参数 })');
    log('看某个模板的参数与默认值：node scripts/anim.mjs shots chart');
    log('按用途筛（匹配名 / summary / use / energy / avoid）：node scripts/anim.mjs shots --use 转场');
    return;
  }

  if (typeof SHOTS[want] !== 'function') {
    die(`没有镜头模板 "${want}"。可用的：${Object.keys(SHOTS).join(' / ')}`);
  }
  const s = all.find((x) => x.name === want);
  if (flag('json')) { log(JSON.stringify(shotsCatalog([s], SHOT_REQUIRES), null, 2)); return; }
  log(`镜头模板 ${s.name} —— ${s.summary}\n`);
  if (s.use || s.energy || s.avoid) {
    log(`  能量  ${s.energy ?? '未标注'}`);
    log(`  用于  ${s.use ?? '未标注'}`);
    log(`  别用  ${s.avoid ?? '未标注'}\n`);
  }
  if (s.notes) log(`${s.notes}\n`);
  const shown = (v) => {
    const str = JSON.stringify(v);
    return str.length > 72 ? `${str.slice(0, 69)}…` : str;
  };
  const w = Math.max(...s.params.map((p) => p.name.length));
  log('参数（默认值 = 什么都不传时的画面）：');
  for (const p of s.params) {
    log(`  ${p.name.padEnd(w)}  ${String(p.type).padEnd(7)}  ${shown(p.default)}`);
    log(`  ${' '.repeat(w)}  ${' '.repeat(7)}  ${p.desc}`);
  }
}

export { SHOTS_SCHEMA, shotsCatalog };
export { cmdShots as run };
