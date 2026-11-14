// @ts-check
/** 输出层（从 scripts/anim.mjs 抽出，逐字未改）：log / warn / die。 */
export const log = (...a) => console.log(...a);
export const warn = (...a) => console.error(...a);
export function die(msg, code = 1) { warn(`✗ ${msg}`); process.exit(code); }

