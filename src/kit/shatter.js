// @ts-check
/**
 * 镜头级镜碎（docs/MOTION-SPIN-SHATTER.md §3.3）—— **纯函数层**。
 *
 * 这里只算「每片在哪、飞多远、转多少」，不碰 GL；真正的绘制要 RenderTarget 离屏管线
 * （照 src/kit/views.js 的 instrumented 那套），那一层留给 kit 的调用方。
 *
 * ⚠ 三个公式必须与 src/core/transition-frag.js 里 `shatter` 那一支**逐字等价**，
 *   否则「同一支片子里碎出去和碎回来是同一块玻璃」这个卖点不成立：
 *     h2      = fract(sin(vec2(dot(c,(127.1,311.7)), dot(c,(269.5,183.3))) + s) * 43758.5453)
 *     fly     = (rnd - 0.5) * 2 * power * kk * kk
 *     angle   = (rnd.x - 0.5) * 6 * kk
 */

/** GLSL 的 fract：x - floor(x)（JS 的 % 对负数不去小数部分，所以不能直接用） */
export function fract(x) { return x - Math.floor(x); }

/** 与 shader 同一条表达式：两个分量各一次 sin*fract */
export function h2(cx, cy, s) {
  return [
    fract(Math.sin(cx * 127.1 + cy * 311.7 + s) * 43758.5453),
    fract(Math.sin(cx * 269.5 + cy * 183.3 + s) * 43758.5453),
  ];
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * 镜头级：`k` 从 1 降到 0（碎片飞回来吸合，方向与转场版相反）。
 * 返回 { k, cells: [{ cell, center, fly, angle }] }，cells 按 (y,x) 顺序，与 shader 的格点一一对应。
 */
export function shatterPlan({ seed = 7, shards = 7, t = 0, dur = 1.2, power = 0.8 } = {}) {
  const k = 1 - clamp01(t / Math.max(1e-9, dur));
  const cells = [];
  for (let y = 0; y < shards; y++) {
    for (let x = 0; x < shards; x++) {
      const rnd = h2(x, y, seed + 11);   // shader 里是 h2(bc, seed + 11.0)
      cells.push({
        cell: [x, y],
        center: [(x + 0.5) / shards, (y + 0.5) / shards],
        fly: [(rnd[0] - 0.5) * 2 * power * k * k, (rnd[1] - 0.5) * 2 * power * k * k],
        angle: (rnd[0] - 0.5) * 6 * k,
      });
    }
  }
  return { k, cells };
}
