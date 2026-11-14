// @ts-check
/**
 * `src/kit/shatter.js` —— 镜头级镜碎：**画面自己碎着出现，再逐片吸合**。
 *
 * 两半：
 *   · 计划层（纯函数，可离线测）：`fract` / `h2` / `shatterPlan`；
 *   · 绘制层（要 GL）：`shatterIn(ctx, opts)` —— 照 `src/kit/views.js` 的 `applyView` 那套，
 *     先把当前帧拷进离屏 RT，再用一支 Pass 把 RT 当源画回 `ctx.out`。
 *
 * ⚠ `h2` 的表达式与 `src/core/transition-frag.js` 里 `shatter` 那一支**逐字等价**：
 *   同一支片子里「碎出去」与「碎回来」才是同一块玻璃。改这里必须同步改那边。
 * ⚠ `k` 方向与转场版相反：这里是 1 → 0（飞回来吸合）。
 */
import { Pass, RT } from '../core/gl.js';

/** GLSL 的 fract：x - floor(x)（JS 的 % 对负数不去小数部分） */
export function fract(x) { return x - Math.floor(x); }

/** 与 shader 同一条表达式 */
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

/** 与转场版同形的 fragment（源叫 `src`，`k` 直接给，不乘缓动） */
const SHATTER_FRAG = /* glsl */ `    uniform sampler2D src;
    uniform float k, shards, seed, power;
    vec2 h2(vec2 c, float s) { return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3))) + s) * 43758.5453); }
    vec2 r02(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
    void main() {
      float kk = clamp(k, 0.0, 1.0);
      vec2 g = vUv * shards, ci = floor(g), cf = fract(g);
      float best = 8.0, second = 8.0; vec2 bc = ci;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 cell = ci + vec2(x, y);
        vec2 off = vec2(x, y) + h2(cell, seed) * 0.8 + 0.1;
        float dist = length(cf - off);
        if (dist < best) { second = best; best = dist; bc = cell; }
        else if (dist < second) second = dist;
      }
      vec2 rnd = h2(bc, seed + 11.0);
      vec2 fly = (rnd - 0.5) * 2.0 * power * kk * kk;
      float ang = (rnd.x - 0.5) * 6.0 * kk;
      vec2 c0 = (bc + 0.5) / shards;
      vec2 p = r02(vUv - c0, ang) + c0 + fly * 0.18;
      vec3 col = texture(src, clamp(p, 0.0, 1.0)).rgb;
      // 边缘光只在「片子还分开」时存在：kk → 0（吸合完成）必须归零，否则静止帧上会留一层永久裂缝。
      // ⚠ 转场版用的是 (1.0 - kk)，因为那边 kk → 1 表示旧帧走完；这里方向相反，别照抄。
      float rim = (1.0 - smoothstep(0.0, 0.06, second - best)) * smoothstep(0.0, 0.15, kk);
      fragColor = vec4(col + vec3(0.14, 0.13, 0.11) * rim, 1.0);
    }`;

/** 每个 ctx 一份（与 views.js 的 slot 同思路，互不干扰） */
function slot(ctx) {
  if (!ctx._shatter) ctx._shatter = { rt: null, pass: null };
  return ctx._shatter;
}

/**
 * 在**当前层画完之后**调用（`comp.draw` 之后、`return post` 之前）。
 * 同一帧里调多次是安全的（每帧只拷一次快照，Pass 复用）。
 *
 * @param {any} ctx 场景 ctx
 * @param {{ seed?: number, shards?: number, t?: number, dur?: number, power?: number, k?: number }} [opts]
 * @returns {any} ctx.out
 */
export function shatterIn(ctx, { seed = 7, shards = 7, t = 0, dur = 1.2, power = 0.8, k } = {}) {
  const gl = ctx.gl;
  const st = slot(ctx);
  const rw = gl.pw, rh = gl.ph;
  if (!st.rt || st.rt.w !== rw || st.rt.h !== rh) {
    if (st.rt) st.rt.dispose?.();
    st.rt = new RT(gl, rw, rh);
  }
  // 源与目标不能是同一张纹理（GL 未定义行为）⇒ 先拷一份
  ctx.comp.copyOver(gl, ctx.out, st.rt, 1);
  if (!st.pass) {
    st.pass = new Pass(gl, SHATTER_FRAG, { src: null, k: 0, shards: 7, seed: 7, power: 0.8 },
      { key: 'kit_shatter_in', blend: false, jitter: false });
  }
  const p = st.pass;
  p.u.src.value = st.rt;
  p.set({
    k: k ?? (1 - clamp01(t / Math.max(1e-9, dur))),
    shards: Math.max(1, Math.round(shards)),
    seed,
    power,
  });
  p.render(gl, ctx.out, ctx.f.t, ctx.f.dt);
  return ctx.out;
}
