/**
 * src/kit/motion-persona.js —— **运动人格**：可选的「这一支片子怎么动」声明。
 *
 * 为什么要有它：风格包换的是**视觉**（配色/字体/母题），不换**运动**。于是同一支片子里
 * 每个镜头各弹各的：一个镜头 overshoot 20%、下一个 2%，观众说不出哪里不对，只觉得「不像一个人做的」。
 * 这层声明只回答一件事：**这一支片子属于哪种运动气质**，其余（时长档 / 缓动族 / overshoot）由它给**区间**。
 *
 * ⚠ 三条设计原则（照 user 的要求：**不要僵化模板**）：
 *   ① **可选**：不写 `motion` 就完全不判（判据进 skipped，不假装通过，也不扣分）；
 *   ② **区间，不是定值**：给的是 [下限, 上限]，镜头可以落在区间任何位置；
 *   ③ **可豁免**：`motion.exempt` 列出的项、或场景里写 `// motion:allow <项>` 的行，判据直接跳过。
 *
 * 数值来源：LottieFiles motion-design-skill（MIT，见 skills/motion-design/）的 UI 毫秒表，
 * **换算成秒并向外放宽**（UI 里 120–180ms 的按钮，在片子里对应 0.2–0.5s 的镜头动作）。
 * 所以这张表是**参考区间**，不是规格；写片子的自由度在上限之外。
 */

/** 四种人格。时长单位是**秒**（已从 UI 的 ms 换算并放宽）。 */
export const PERSONAS = {
  playful: {
    label: '俏皮',
    durations: { quick: [0.12, 0.3], standard: [0.24, 0.5], slow: [0.4, 0.8] },
    easing: {
      entry: ['outBack', 'outBounce', 'outElastic', 'outCubic', 'outQuad'],
      exit: ['inCubic', 'inQuad', 'inBack'],
      onScreen: ['inOutCubic', 'inOutQuad', 'inOutQuart'],
      loop: ['linear'],
    },
    overshoot: [0.08, 0.2],
    note: '回弹明显、收得快；适合鬼畜/表情包/轻内容',
  },
  premium: {
    label: '高级',
    durations: { quick: [0.3, 0.55], standard: [0.45, 0.8], slow: [0.7, 1.4] },
    easing: {
      entry: ['outCubic', 'outQuart', 'outExpo'],
      exit: ['inCubic', 'inQuart'],
      onScreen: ['inOutCubic', 'inOutQuart'],
      loop: ['linear'],
    },
    overshoot: [0, 0.04],
    note: '不弹、慢起慢收；适合品牌/时装/预告',
  },
  corporate: {
    label: '商务',
    durations: { quick: [0.18, 0.35], standard: [0.3, 0.55], slow: [0.45, 0.9] },
    easing: {
      entry: ['outCubic', 'outQuad'],
      exit: ['inCubic', 'inQuad'],
      onScreen: ['inOutCubic', 'inOutQuad'],
      loop: ['linear'],
    },
    overshoot: [0, 0.03],
    note: '干净、可预测；适合产品/数据/说明',
  },
  energetic: {
    label: '躁动',
    durations: { quick: [0.08, 0.2], standard: [0.16, 0.36], slow: [0.3, 0.6] },
    easing: {
      entry: ['outExpo', 'outBack', 'outElastic', 'outCubic'],
      exit: ['inExpo', 'inCubic'],
      onScreen: ['inOutExpo', 'inOutCubic'],
      loop: ['linear'],
    },
    overshoot: [0.1, 0.3],
    note: '快切、砸字；适合踩点/燃向',
  },
};

export const PERSONA_NAMES = Object.keys(PERSONAS);

/**
 * 解析任务里的 `motion` 声明。
 *
 * ```js
 * motion: { personality: 'premium', emotion: 'calm', exempt: ['overshoot'] }
 * ```
 *
 * @param {any} cfg task.config 的默认导出
 * @returns {{ persona: string, label: string, budgets: any, emotion: string, exempt: string[], intensity: number } | null}
 *          `null` = 没声明（判据该进 skipped，而不是判通过）
 */
export function resolveMotion(cfg) {
  const m = cfg && cfg.motion;
  if (m == null) return null;
  if (typeof m !== 'object') {
    throw new Error('task.config 的 motion 要写成对象：motion: { personality: \'premium\' }。收到 ' + typeof m);
  }
  const name = String(m.personality ?? '').trim();
  if (!PERSONAS[name]) {
    throw new Error(
      'motion.personality 取值不认识：' + JSON.stringify(m.personality) + '。可选：' + PERSONA_NAMES.join(' / ')
      + '（不写这一层也能出片 —— 它只影响判据的参考区间）',
    );
  }
  const p = PERSONAS[name];
  const intensity = Number(m.intensity ?? 1);
  if (!(intensity > 0)) throw new Error('motion.intensity 要是正数（1 = 按这一档的默认区间；0.7 = 整体收一点）。');
  const scaled = (range) => [Number((range[0] * intensity).toFixed(3)), Number((range[1] * intensity).toFixed(3))];
  const budgets = {
    durations: {
      quick: scaled(p.durations.quick),
      standard: scaled(p.durations.standard),
      slow: scaled(p.durations.slow),
    },
    easing: p.easing,
    overshoot: scaled(p.overshoot),
  };
  return {
    persona: name,
    label: p.label,
    note: p.note,
    budgets,
    emotion: String(m.emotion ?? ''),
    exempt: Array.isArray(m.exempt) ? m.exempt.map((x) => String(x)) : [],
    intensity,
  };
}

/**
 * 欠阻尼弹簧的**预估 overshoot**（对 `spring(elapsed, target, stiffness, damping)` 的一阶近似）。
 * 用来判「这一记弹跳是不是超出了人格允许的上限」。
 *
 * damping ≥ 临界阻尼 ⇒ 不超调（返回 0）；否则 overshoot = exp(-ζπ / √(1-ζ²))。
 *
 * ⚠ **参数顺序与引擎一致**：`spring(elapsed, target = 1, stiffness = 90, damping = 18)`
 * （src/core/util.js:61）—— stiffness 在**第 3 位**、damping 在**第 4 位**。
 * 这个函数的签名一直是 (stiffness, damping, target)，但判据那边曾经按「第 2、3 个数字」取参，
 * 抓到的是 target 和 stiffness，于是恒判 0 回弹（P3 从未生效）。
 *
 * @param {number} [stiffness] 第 3 位
 * @param {number} [damping] 第 4 位
 * @param {number} [target] 第 2 位 —— target > 1 时绝对超调量按 target 等比放大（百分比不变）
 */
export function overshootOf(stiffness = 90, damping = 18, target = 1) {
  const k = Math.max(1e-6, stiffness), c = Math.max(0, damping);
  const zeta = c / (2 * Math.sqrt(k));
  if (!(target > 0) || zeta >= 1) return 0;
  // ζ 无量纲，exp() 给出的就是「超调占 target 的百分比」—— target 只影响绝对值，不影响这个比例。
  return Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta));
}

/**
 * 缓动名属于哪一类（entry / exit / onScreen / loop / unknown）。
 *
 * ⚠ 这里只认 `src/core/util.js` 的 `ease` 表里**真实存在**的名字。
 * 原版把 `sine` 也当 loop —— 但引擎根本没有这条曲线，`ease.sine` 是 undefined，
 * 写 `'sine'` 会静默退化成 linear（`warnEase` 只喊一声）。把它放进白名单等于
 * 放行一个实际不生效的名字。
 */
export function easingRole(name) {
  const n = String(name ?? '').toLowerCase();
  if (!n || n === 'linear') return 'loop';
  if (n.startsWith('inout')) return 'onScreen';
  if (n.startsWith('in')) return 'exit';
  if (n.startsWith('out')) return 'entry';
  return 'unknown';
}

/** 某个缓动名是否被这一人格允许（族内任意，不锁具体曲线） */
export function easingAllowed(budgets, name) {
  const role = easingRole(name);
  if (role === 'unknown') return false;
  const list = budgets.easing[role] ?? [];
  return list.includes(String(name));
}
