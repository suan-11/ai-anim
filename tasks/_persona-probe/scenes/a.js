import { css } from '../../../src/core/util.js';

export default {
  id: 'a',
  render(ctx) {
    const { f, lines, P } = ctx;
    const p1 = prog(f.lt, 0.1, 0.2);          // 太快（< quick 下限 0.3）
    const p2 = prog(f.lt, 0.0, 1.6);          // 太慢（> slow 上限 1.4）
    const p3 = prog(f.lt, 0.0, Math.min(0.9, f.lt), 'outCubic');   // 嵌套括号 + 正确缓动名
    const d = spring(f.lt, 1, 140, 12);       // 回弹 15.7% > premium 4%
    lines.begin();
    lines.seg(100 + p1 * 10, 100, 300 + p2 * 100, 100 + d * 20, 3, P.signal);
    lines.seg(0, 500, p3 * 400, 500, 2, css(P.bone));
    lines.flush(ctx.out);
    return {};
  },
};
