// @ts-check
/**
 * src/core/post-presets.js —— 「被拍摄感」后处理预设（C3）。
 *
 * 把现有 post 参数（grain / halation / vignette / ca / weave / flicker / scratch）组合成可命名预设，
 * 让「像拍出来的」不用每支片子手调一遍。预设**只组合现有参数**，不新增 shader 能力。
 *
 * 覆盖优先级（写了 preset 时）：引擎默认 < 风格包 post < preset < 场景 return 显式字段。
 * 不写 preset 时输出逐像素不变（零回归）。入口三处：场景 return { preset }、时间线 post: { preset }、风格包 post.preset。
 *
 * ⚠ 数值是**标定起点**，在 tasks/_filmed-lab（off / filmed / filmed-doc / filmed-super8 四档）出接触表人工审片后定稿。
 * ⚠ flicker 会逐帧改亮度 —— 别开太大，否则 lint-event-density 把「闪烁」误当成「事件」（见该工具）。
 */

/** 预设表：每个 preset = 一组 post 参数覆盖。键必须是 PostParams 里已有的字段。 */
export const POST_PRESETS = {
  // 标准胶片感：轻颗粒 + 光晕 + 暗角 + 一点点片门抖动
  filmed: {
    grain: 0.06, halation: 0.35, vignette: 0.42, ca: 0.0015,
    weave: 0.15, flicker: 0.04, scratch: 0.02,
  },
  // 纪录片：更干净、更克制（颗粒/抖动都低）
  'filmed-doc': {
    grain: 0.04, halation: 0.2, vignette: 0.3, ca: 0.001,
    weave: 0.08, flicker: 0.02, scratch: 0.01,
  },
  // Super-8：重颗粒、重抖动、重暗角（家用胶片机的糙感）
  'filmed-super8': {
    grain: 0.12, halation: 0.5, vignette: 0.55, ca: 0.003,
    weave: 0.4, flicker: 0.12, scratch: 0.08,
  },
};

/** 可用预设名清单（报错时列出来，与 transition 同口径）。 */
export const POST_PRESET_NAMES = Object.keys(POST_PRESETS);

/**
 * 解析预设名 → 参数覆盖。**写错当场抛**并列出可用清单（不静默回落）。
 * @param {string} name
 * @returns {Record<string, number>} 该预设的 post 参数覆盖
 */
export function resolvePostPreset(name) {
  const p = POST_PRESETS[name];
  if (!p) {
    throw new Error(`没有 post 预设 "${name}"。可用：${POST_PRESET_NAMES.join(' / ')}`);
  }
  return { ...p };
}

/**
 * 在**已合并好的 base post** 上叠加 preset 层（C3 的可测核心）。
 * base 仍是引擎原来的合并结果（DEFAULT → item.post → 场景 return → style.post），不写 preset 时原样返回（去掉 preset 键）。
 * 写了 preset：preset 盖过 base，但**场景 return 的显式字段**（除 preset 外）再盖回最上。
 * @param {Record<string, any>} basePost 引擎原合并结果
 * @param {{ ov?: any, itemPost?: any, stylePost?: any }} [src] 三个 preset 声明来源
 * @returns {Record<string, any>} 最终 post（不含 preset 键）
 */
export function applyPostPreset(basePost, { ov = null, itemPost = null, stylePost = null } = {}) {
  const presetName = (ov && typeof ov === 'object' && ov.preset) ?? itemPost?.preset ?? stylePost?.preset ?? null;
  let post = basePost;
  if (presetName != null) {
    const presetParams = resolvePostPreset(presetName);
    const ovExplicit = (ov && typeof ov === 'object') ? (({ preset, ...rest }) => rest)(ov) : {};
    post = { ...post, ...presetParams, ...ovExplicit };
  }
  const { preset, ...clean } = post;
  return clean;
}
