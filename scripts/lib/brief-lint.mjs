// @ts-check
/**
 * scripts/lib/brief-lint.mjs —— 结构化分镜 `brief.mjs` 的纯函数校验。
 *
 * 为什么要有它：把"写一段好看的形容词交差"改成必须在动笔写代码前想清楚的几何事实
 * （主体、隐喻、三层运动、高光时刻、状态差、接力物、标注级文字、主角段手写）。
 */

export const BANNED_ADJECTIVES = [
  '高级', '大气', '简洁', '科技感', '酷炫', '精致', '现代', '炫酷', '震撼', '专业', '美观', '动感',
];

export const VALID_ROLES = new Set(['hook', 'mechanism', 'data', 'compare', 'close', 'bridge']);
export const CUSTOM_REQUIRED_ROLES = new Set(['hook', 'mechanism', 'close']);
export const MAX_TEMPLATE_RATIO = 0.4;
export const MAX_SAME_SHOT = 2;
export const MAX_ONSCREEN_CHARS = 18;

const isPlaceholder = (v) => typeof v === 'string' && v.includes('<填>');
const isBlankStr = (v) => typeof v !== 'string' || !v.trim() || isPlaceholder(v);
const isBlankPeakAt = (v) => {
  if (typeof v === 'number') return !Number.isFinite(v) || v < 0;
  return isBlankStr(v);
};

/** 找出文本命中的所有黑名单形容词（去重）。 */
export function findBannedAdjectives(text) {
  const s = String(text ?? '');
  return BANNED_ADJECTIVES.filter((w) => s.includes(w));
}

/**
 * 校验一份 `brief` 对象（纯函数）。
 * @param {any} brief
 * @returns {{
 *   errors: { code: string, seg: string|null, msg: string }[],
 *   warnings: { code: string, seg: string|null, msg: string }[],
 *   stats: { totalSegs: number, customSegs: number, templateSegs: number, templateRatio: number, roles: Record<string, number> },
 * }}
 */
export function lintBrief(brief) {
  /** @type {{ code: string, seg: string|null, msg: string }[]} */
  const errors = [];
  /** @type {{ code: string, seg: string|null, msg: string }[]} */
  const warnings = [];
  const err = (code, seg, msg) => errors.push({ code, seg, msg });
  const warn = (code, seg, msg) => warnings.push({ code, seg, msg });

  if (!brief || typeof brief !== 'object') {
    err('BRIEF-EMPTY', null, 'brief.mjs 必须默认导出一个对象');
    return { errors, warnings, stats: { totalSegs: 0, customSegs: 0, templateSegs: 0, templateRatio: 0, roles: {} } };
  }

  // 1. 顶层必填字段
  if (isBlankStr(brief.logline)) err('BRIEF-EMPTY', null, '缺少 logline（一句话立意），或仍包含未填占位符');
  else if ([...brief.logline.trim()].length > 30) {
    warn('BRIEF-LOGLINE-LEN', null, `logline 有 ${[...brief.logline.trim()].length} 字（建议 ≤30 字，观众看完能复述）`);
  }

  if (isBlankStr(brief.audience)) err('BRIEF-EMPTY', null, '缺少 audience（目标观众），或仍包含未填占位符');
  if (typeof brief.duration !== 'number' || !Number.isFinite(brief.duration) || brief.duration <= 0) {
    err('BRIEF-EMPTY', null, 'duration 必须是 > 0 的有限秒数');
  }

  // style
  const st = brief.style;
  if (!st || typeof st !== 'object') {
    err('BRIEF-EMPTY', null, '缺少 style 对象（{ name, signals, flipped }）');
  } else {
    if (isBlankStr(st.name)) err('BRIEF-EMPTY', null, 'style.name 未填写');
    if (!Array.isArray(st.signals) || !st.signals.length || st.signals.some(isBlankStr)) {
      err('BRIEF-EMPTY', null, 'style.signals 必须是非空数组，且不能含空项或 <填>（STYLE.md §3.2 辨识信号）');
    }
    if (!Array.isArray(st.flipped) || !st.flipped.length || st.flipped.some(isBlankStr)) {
      err('BRIEF-EMPTY', null, 'style.flipped 必须是非空数组，且不能含空项或 <填>（写明翻掉哪几条俗套）');
    }
  }

  // world
  const wd = brief.world;
  if (!wd || typeof wd !== 'object') {
    err('BRIEF-EMPTY', null, '缺少 world 对象（{ background, camera, motif }）');
  } else {
    for (const k of ['background', 'camera', 'motif']) {
      if (isBlankStr(wd[k])) err('BRIEF-EMPTY', null, `world.${k} 未填写`);
    }
  }

  // antiList
  if (!Array.isArray(brief.antiList) || brief.antiList.filter((x) => !isBlankStr(x)).length < 3) {
    err('BRIEF-ANTILIST', null, 'antiList 至少需要 3 条有效项（明确这支片子不要什么）');
  }

  // segments
  const segs = Array.isArray(brief.segments) ? brief.segments : [];
  if (!segs.length) {
    err('BRIEF-EMPTY', null, 'segments 不能为空');
    return { errors, warnings, stats: { totalSegs: 0, customSegs: 0, templateSegs: 0, templateRatio: 0, roles: {} } };
  }

  let customSegs = 0;
  let templateSegs = 0;
  /** @type {Record<string, number>} */
  const roles = {};
  /** @type {Record<string, number>} */
  const shotCounts = {};

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const segLabel = !isBlankStr(s?.id) ? s.id.trim() : `#${i + 1}`;
    if (!s || typeof s !== 'object') {
      err('BRIEF-EMPTY', segLabel, '分段必须是对象');
      continue;
    }

    if (isBlankStr(s.id)) err('BRIEF-EMPTY', segLabel, '缺少段 id');

    if (!VALID_ROLES.has(s.role)) {
      err('BRIEF-ROLE', segLabel, `role "${s.role}" 不合法；可选：${[...VALID_ROLES].join(' | ')}`);
    } else {
      roles[s.role] = (roles[s.role] ?? 0) + 1;
    }

    if (isBlankStr(s.hero)) err('BRIEF-EMPTY', segLabel, '缺少 hero（具体视觉主角名词）');
    if (isBlankStr(s.metaphor)) err('BRIEF-EMPTY', segLabel, '缺少 metaphor（概念翻译成什么画面）');
    if (isBlankStr(s.stateDiff)) err('BRIEF-EMPTY', segLabel, '缺少 stateDiff（这一段的状态变化）');

    if (!s.motion || typeof s.motion !== 'object') {
      err('BRIEF-EMPTY', segLabel, '缺少 motion 对象（{ primary, secondary, ambient }）');
    } else {
      for (const mk of ['primary', 'secondary', 'ambient']) {
        if (isBlankStr(s.motion[mk])) err('BRIEF-EMPTY', segLabel, `motion.${mk} 未填写（三层运动缺一不可）`);
      }
    }

    if (!s.peak || typeof s.peak !== 'object') {
      err('BRIEF-EMPTY', segLabel, '缺少 peak 对象（{ at, what }）');
    } else {
      if (isBlankPeakAt(s.peak.at)) err('BRIEF-EMPTY', segLabel, 'peak.at 未填写（应给出对齐的 cue-id 或秒数）');
      if (isBlankStr(s.peak.what)) err('BRIEF-EMPTY', segLabel, 'peak.what 未填写（这一段唯一的高光揭晓是什么）');
    }

    // 除最后一段外，必须有接力物 relayTo
    if (i < segs.length - 1 && isBlankStr(s.relayTo)) {
      err('BRIEF-RELAY', segLabel, '除最后一段外，relayTo 不能为空（写明哪个对象活到下一镜）');
    }

    // onscreen 标注检查
    if (!Array.isArray(s.onscreen)) {
      err('BRIEF-EMPTY', segLabel, '缺少 onscreen 数组（无画面文字可写 []）');
    } else {
      for (const txt of s.onscreen) {
        if (isBlankStr(txt)) {
          err('BRIEF-EMPTY', segLabel, 'onscreen 里不能有空项或 <填>');
        } else {
          const len = [...txt.trim()].length;
          if (len > MAX_ONSCREEN_CHARS) {
            err('BRIEF-ONSCREEN-LEN', segLabel, `onscreen 标注「${txt.trim()}」有 ${len} 字（超过 ${MAX_ONSCREEN_CHARS} 字，句子请交给旁白与字幕）`);
          }
        }
      }
    }

    // 形容词黑名单
    const adjChecks = [
      ['hero', s.hero],
      ['metaphor', s.metaphor],
      ['motion.primary', s.motion?.primary],
      ['motion.secondary', s.motion?.secondary],
      ['motion.ambient', s.motion?.ambient],
    ];
    for (const [field, val] of adjChecks) {
      if (typeof val !== 'string') continue;
      const hits = findBannedAdjectives(val);
      if (hits.length) {
        err('BRIEF-ADJECTIVE', segLabel, `${field} 含禁用的空泛形容词「${hits.join('、')}」—— 请改写为具体几何或数值描述（CRAFT.md §1–§4）`);
      }
    }

    // build 检查
    if (s.build === 'custom') {
      customSegs++;
    } else if (s.build && typeof s.build === 'object' && !Array.isArray(s.build)) {
      templateSegs++;
      if (isBlankStr(s.build.shot) || isBlankStr(s.build.why)) {
        err('BRIEF-BUILD', segLabel, '使用模板时 build 必须写清 { shot, why }，且不能为空');
      } else {
        const sh = s.build.shot.trim();
        shotCounts[sh] = (shotCounts[sh] ?? 0) + 1;
      }
    } else {
      err('BRIEF-BUILD', segLabel, 'build 必须是 "custom" 或 { shot, why }');
    }

    if (CUSTOM_REQUIRED_ROLES.has(s.role) && s.build !== 'custom') {
      err('BRIEF-CUSTOM-REQUIRED', segLabel, `role="${s.role}" 属于主角段，build 必须为 "custom"（严禁套模板）`);
    }
  }

  // 跨段检查
  if (!roles.hook) err('BRIEF-NO-HOOK', null, 'segments 中至少要有一段 role="hook"');
  if (!roles.close) err('BRIEF-NO-CLOSE', null, 'segments 中至少要有一段 role="close"');

  const templateRatio = segs.length ? templateSegs / segs.length : 0;
  if (templateRatio > MAX_TEMPLATE_RATIO) {
    err('BRIEF-TEMPLATE-RATIO', null, `纯模板段占比 ${(templateRatio * 100).toFixed(0)}%（${templateSegs}/${segs.length}），超过上限 ${MAX_TEMPLATE_RATIO * 100}%`);
  }
  for (const [sh, cnt] of Object.entries(shotCounts)) {
    if (cnt > MAX_SAME_SHOT) {
      err('BRIEF-TEMPLATE-DUP', null, `模板 "${sh}" 出现了 ${cnt} 次（同一模板最多 ${MAX_SAME_SHOT} 次）`);
    }
  }

  return {
    errors,
    warnings,
    stats: {
      totalSegs: segs.length,
      customSegs,
      templateSegs,
      templateRatio,
      roles,
    },
  };
}
