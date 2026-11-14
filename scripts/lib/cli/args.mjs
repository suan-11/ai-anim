// @ts-check
/** CLI 参数层（从 scripts/anim.mjs 抽出，函数体逐字未改）。rest 改成一次性注入，避免两份 argv。 */
export let rest = [];

export function setRest(argv) { rest = argv; }

export function opt(name, def) {
  const i = rest.indexOf(`--${name}`);
  if (i >= 0) return rest[i + 1];
  // 单字母短选项：-t 2.5 / -o dir / -n 12
  if (name.length === 1) {
    const j = rest.indexOf(`-${name}`);
    if (j >= 0) return rest[j + 1];
  }
  return def;
}

export function flag(name) { return rest.includes(`--${name}`); }

export function positional(i = 0) { return rest.filter((a) => !a.startsWith('-'))[i]; }

