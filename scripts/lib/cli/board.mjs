// @ts-check
/**
 * scripts/lib/cli/board.mjs —— 分镜板（C2）的**纯函数**排版：段表 → 每格采样时刻 + 标注。
 * 抽出来是为了离线测（tools/test-board.mjs），不起浏览器。
 */

/**
 * @param {Array<{id?:string,start?:number,end?:number,note?:string}>} segs 段表（build() 之后）
 * @param {{ at?: number }} [opts] at = 段内采样位置（0..1，默认 0.5 = 段中点）
 * @returns {{ times: number[], labels: string[] }}
 */
export function planBoard(segs, { at = 0.5 } = {}) {
  const frac = Math.max(0, Math.min(1, Number(at)));
  const times = [], labels = [];
  for (const s of segs ?? []) {
    const start = Number(s.start ?? 0);
    const end = Number(s.end ?? start);
    const dur = Math.max(0, end - start);
    times.push(start + dur * frac);
    const note = String(s.note ?? '').trim();
    let lab = `${s.id ?? '?'} · ${dur.toFixed(1)}s`;
    if (note) lab += ` · ${note}`;
    labels.push(lab.length > 44 ? lab.slice(0, 43) + '…' : lab);
  }
  return { times, labels };
}
