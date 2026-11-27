// @ts-check
/** 数学符号排版：真下标/真分式/函数名，不用 Unicode 凑合字符。
 *
 * 分段画：函数名正体、变量斜体、下标 0.62 倍下沉 0.30em、
 * 分式有真分数线（分子在上、分母在下、中间横线）。
 * 所有函数返回总宽度，调用方负责 anchor 居中。
 */

/** 通用 runs 排版。kind: 'fn'|'var'|'num'|'sub'|'sup'|'op'|'paren'|'frac'
 * frac 段需要 {num, den} 字段，画真分式。返回总宽。 */
export function mathRuns(ctx, runs, x, y, { size = 48, color, anchor = 'left', alpha = 1 } = {}) {
  const { type, lines, P } = ctx;
  const SUB = 0.62, SUB_DROP = 0.30, SUP_RISE = 0.42;
  const FRAC_S = 0.72;                              // 分式分子/分母字号比
  // 先量总宽
  let total = 0;
  const segs = runs.map(r => {
    const k = r.kind ?? 'num';
    if (k === 'frac') {
      const fs = Math.round(size * FRAC_S);
      const nw = type.measure(r.num, { size: fs, weight: 400, family: 'serif' });
      const dw = type.measure(r.den, { size: fs, italic: true, weight: 400, family: 'serif' });
      const w = Math.max(nw, dw) + size * 0.15;     // 分式宽 = max(分子,分母) + 左右余量
      const seg = { ...r, kind: 'frac', fs, nw, dw, w, dy: 0 };
      total += w;
      return seg;
    }
    const s = k === 'sub' || k === 'sup' ? Math.round(size * SUB) : size;
    const italic = k === 'var';
    const weight = k === 'fn' ? 500 : 400;
    const w = type.measure(r.t, { size: s, italic, weight, family: 'serif' });
    const dy = k === 'sub' ? size * SUB_DROP : k === 'sup' ? -size * SUP_RISE : 0;
    const seg = { ...r, s, italic, weight, w, dy };
    total += w;
    return seg;
  });
  let cx = anchor === 'center' ? x - total / 2 : anchor === 'right' ? x - total : x;
  for (const seg of segs) {
    if (seg.kind === 'frac') {
      // 真分式：分子基线在 y - size*0.38，分母基线在 y + size*0.52，分数线在 y + size*0.05
      const fw = seg.w, fcx = cx + fw / 2;
      const barY = y + size * 0.05;
      const numY = y - size * 0.32;
      const denY = y + size * 0.58;
      type.write(seg.num, fcx - seg.nw / 2, numY, { size: seg.fs, weight: 400, family: 'serif', color, alpha, align: 'left' });
      type.write(seg.den, fcx - seg.dw / 2, denY, { size: seg.fs, italic: true, weight: 400, family: 'serif', color, alpha, align: 'left' });
      // 分数线（矢量层——注意：调用方需保证 lines 已 begin 且未 flush，
      // 或者这里单独 begin/flush 一次小批）
      lines.begin();
      lines.seg(cx + size * 0.04, barY, cx + fw - size * 0.04, barY, Math.max(1.5, size * 0.04), withAlphaSafe(color, alpha));
      lines.flush(ctx.out);
      cx += fw;
      continue;
    }
    type.write(seg.t, cx, y + seg.dy, {
      size: seg.s, italic: seg.italic, weight: seg.weight, family: 'serif',
      color, alpha, align: 'left',
    });
    cx += seg.w;
  }
  return total;
}

/** color 可能是 css() 字符串或 [r,g,b] 数组——lines 需要数组。
 * 如果是字符串就解析回线性值（简化：直接用 P.signal 兜底）。 */
function withAlphaSafe(color, alpha) {
  if (Array.isArray(color)) return [...color.slice(0, 3), alpha];
  // css 字符串无法反解——用默认 signal 红（本福特公式专用色）
  return [0.85, 0.22, 0.12, alpha];
}

/** log₁₀(1 + 1/d) —— 本福特公式，1/d 是真分式。返回总宽。 */
export function mathBenford(ctx, x, y, opts = {}) {
  return mathRuns(ctx, [
    { t: 'log', kind: 'fn' },
    { t: '10', kind: 'sub' },
    { t: '(', kind: 'paren' },
    { t: '1', kind: 'num' },
    { t: ' + ', kind: 'op' },
    { kind: 'frac', num: '1', den: 'd' },
    { t: ')', kind: 'paren' },
  ], x, y, opts);
}

/** P(d) = log₁₀(1 + 1/d) 完整式，1/d 真分式。 */
export function mathBenfordFull(ctx, x, y, opts = {}) {
  return mathRuns(ctx, [
    { t: 'P', kind: 'var' },
    { t: '(', kind: 'paren' },
    { t: 'd', kind: 'var' },
    { t: ')', kind: 'paren' },
    { t: ' = ', kind: 'op' },
    { t: 'log', kind: 'fn' },
    { t: '10', kind: 'sub' },
    { t: '(', kind: 'paren' },
    { t: '1', kind: 'num' },
    { t: ' + ', kind: 'op' },
    { kind: 'frac', num: '1', den: 'd' },
    { t: ')', kind: 'paren' },
  ], x, y, opts);
}

/** 百分比数值：数字大、% 小一号贴右上。 */
export function mathPercent(ctx, value, x, y, { size = 44, color, anchor = 'center', alpha = 1 } = {}) {
  const { type } = ctx;
  const numW = type.measure(String(value), { size, weight: 600, family: 'serif' });
  const pctS = Math.round(size * 0.6);
  const pctW = type.measure('%', { size: pctS, weight: 500, family: 'serif' });
  const total = numW + pctW + size * 0.06;
  const left = anchor === 'center' ? x - total / 2 : anchor === 'right' ? x - total : x;
  type.write(String(value), left, y, { size, weight: 600, family: 'serif', color, alpha, align: 'left' });
  type.write('%', left + numW + size * 0.06, y - size * 0.30, { size: pctS, weight: 500, family: 'serif', color, alpha, align: 'left' });
  return total;
}