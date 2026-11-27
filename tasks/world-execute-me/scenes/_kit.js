// @ts-check
/** world.execute(me); 共享视觉元件：终端代码行 / 关键词冲出 / 故障撕裂 / 粒子 */
import { withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css, rng, spring, hit } from '../../../src/core/util.js';

// 暗底终端色板（task.config palette 已覆盖，这里取 ctx.P）
export const TERM = {
  bg: [0.04, 0.055, 0.08],       // #0a0e14
  green: [0, 1, 0.67],           // #00ffaa 终端绿
  amber: [1, 0.75, 0.2],         // 琥珀
  red: [1, 0.2, 0.27],           // #ff3344 signal
  white: [0.78, 0.84, 0.9],      // #c8d6e5 bone
  dim: [0.35, 0.42, 0.48],       // #5a6a7a ash
  grid: [0.16, 0.23, 0.29],      // #2a3a4a graphite
};

/** 画一行终端代码（mono字体，左对齐，带行号）。返回行高。 */
export function codeLine(ctx, text, x, y, { size = 22, color = null, alpha = 1, lineNo = null, highlight = false } = {}) {
  const { type, P } = ctx;
  const col = color ?? TERM.green;
  if (lineNo != null) {
    type.write(String(lineNo).padStart(3, ' '), x, y, { size: size * 0.8, family: 'mono', color: css(TERM.dim, alpha * 0.5), align: 'left' });
  }
  const tx = lineNo != null ? x + size * 2.4 : x;
  if (highlight) {
    // 高亮行背景条
    const { lines } = ctx;
    const w = type.measure(text, { size, family: 'mono' });
    lines.fillRect(tx - 4, y - size * 0.8, w + 8, size * 1.2, withAlpha(col, alpha * 0.12));
  }
  type.write(text, tx, y, { size, family: 'mono', color: css(col, alpha), align: 'left' });
  return size * 1.5;
}

/** 错误色闪烁：红蓝交替的故障色（用户要求的"错误色"）。
 *  el = 距事件时刻的秒数；强度随 hit() 衰减，频率 ~18Hz 红蓝互换。
 *  返回 [r,g,b] 线性色；el<0 或强度耗尽时返回 null（用本色）。 */
export function glitchColor(el, base = null) {
  if (el < 0 || el > 0.5) return null;
  const strength = Math.exp(-el / 0.18);
  if (strength < 0.08) return null;
  // 18Hz 方波：前半周期信号红，后半周期电蓝
  const red = Math.sin(el * Math.PI * 36) > 0;
  const c = red ? [1, 0.13, 0.2] : [0.15, 0.45, 1];
  // 与本色混合：强度越高越偏错误色
  if (!base) return c;
  return [
    base[0] + (c[0] - base[0]) * strength,
    base[1] + (c[1] - base[1]) * strength,
    base[2] + (c[2] - base[2]) * strength,
  ];
}

/** 关键词砸入（EXECUTION/DIMENSION等）：唱到那一拍**满力出现**，不是淡入。
 *  progress = (t - 歌词时刻) / dur。力学：
 *   · 第 0 帧就是全字号全不透明（观众在唱词的同一帧看到词）；
 *   · 欠阻尼弹簧从 1.45× 过冲砸回 1×（~0.12s 落定，带回弹）；
 *   · 落地冲击：白闪条 + 冲击环 + 震屏偏移按 hit() 指数衰减；
 *   · glitch 撕裂只在落地窗内发生，随后干净保持到窗口尾部再快速切出。
 *  ⚠ 所有量都是 progress 的纯函数（确定性契约）。 */
export function keywordBurst(ctx, word, cx, cy, progress, { size = 120, color = null, glitch = 0, dur = 1.5 } = {}) {
  const { type, lines } = ctx;
  // 大字统一白色（用户要求）；冲击环/撕裂线仍用传入色做点缀
  const accent = color ?? TERM.red;
  const col = TERM.white;
  const p = sat(progress);
  if (p <= 0 || p >= 1) return;
  const el = p * dur;                                  // 距唱词时刻的秒数
  // 砸入：1.45× 过冲 → 弹簧回落到 1×（stiffness 260 / damping 16 ≈ 0.12s 落定）
  const slam = 1 + 0.45 * (1 - spring(el, 1, 260, 16));
  const s = Math.round(size * slam);
  // 出场：窗口最后 12% 快速切出（不是慢淡出）
  const alpha = p < 0.88 ? 1 : 1 - (p - 0.88) / 0.12;
  // 落地冲击（0.1s 半衰期）：震屏 + glitch 都吃它
  const impact = hit(el, 0, 0.1);
  const gx = (glitch * 2.2 + 0.35) * impact * (Math.sin(el * 91) * 14 + Math.sin(el * 47) * 8);
  const gy = (glitch * 1.5 + 0.2) * impact * Math.sin(el * 63) * 6;
  // 落地白闪条：词底一道横向亮线，随冲击衰减
  if (impact > 0.02) {
    const lw = size * word.length * 0.62;
    lines.fillRect(cx - lw / 2, cy + size * 0.42, lw, 3, withAlpha([1, 1, 1], impact * 0.55));
    // 冲击环：从词心炸开的一圈（用点缀色）
    const ringR = size * 0.8 + (1 - impact) * size * 2.2;
    lines.circle(cx, cy, ringR, 2.5, withAlpha(accent, impact * 0.5));
  }
  // 错误色：glitch 参数 > 0.3 的词（EXECUTION 类）落地窗内红蓝闪烁（白底上闪错误色）
  const wordCol = glitch > 0.3 ? (glitchColor(el, col) ?? col) : col;
  type.write(word, cx + gx, cy + gy, { size: s, weight: 800, family: 'mono', color: css(wordCol, alpha), align: 'center' });
  // glitch 撕裂线：只在落地窗（impact 显著）时出现（点缀色）
  const tear = glitch * impact;
  if (tear > 0.05) {
    for (let i = 0; i < 3; i++) {
      const ly = cy + (i - 1) * s * 0.4 + gy;
      const lw = s * word.length * 0.3 * (0.5 + 0.5 * Math.sin(el * 30 + i * 7));
      lines.fillRect(cx - lw / 2 + gx * 2, ly, lw, 2, withAlpha(accent, tear * 0.8));
    }
  }
}

/** 两个对象合并后，各自的颜色沿屏幕展开为双通道信号。 */
export function drawUnionSignal(ctx) {
  const { lines, W, H, f } = ctx;
  const t = f.t;
  const join = smoothstep(55.17, 57.35, t);
  const unfold = smoothstep(57.6, 60.3, t);
  const level = smoothstep(55.17, 55.7, t) * (1 - smoothstep(62.4, 64.5, t));
  const cx = W / 2, cy = H * 0.48;
  for (const [i, col] of [TERM.green, TERM.amber].entries()) {
    const sign = i === 0 ? -1 : 1;
    const x0 = cx + sign * 190 * (1 - join);
    const radius = 68 + join * 16;
    const disk = level * (1 - unfold);
    lines.fillCircle(x0, cy, radius, withAlpha(col, 0.23 * disk));
    lines.circle(x0, cy, radius, 3, withAlpha(col, 0.75 * disk));
    const span = radius + (W * 0.44 - radius) * unfold;
    let prevX = x0 - span, prevY = cy;
    for (let j = 0; j <= 96; j++) {
      const u = j / 96;
      const x = x0 + (u * 2 - 1) * span;
      const y = cy + sign * unfold * (57 + Math.sin(u * 18 - t * 5 + i) * 50);
      if (j > 0) lines.seg(prevX, prevY, x, y, 3, withAlpha(col, unfold * level * 0.78));
      if (j % 4 === 0) lines.fillRect(x - 3, Math.min(y, cy), 6, Math.abs(y - cy), withAlpha(col, unfold * level * 0.13));
      prevX = x;
      prevY = y;
    }
  }
}

/** 恍惚的双环向外放大，成为下一句的振动波纹。 */
export function drawVibrations(ctx) {
  const { lines, W, H, f } = ctx;
  const t = f.t;
  const a = smoothstep(101.35, 102.15, t) * (1 - smoothstep(106.8, 108.55, t));
  const unfold = smoothstep(102.3, 105.7, t);
  const cx = W / 2, cy = H * 0.48;
  for (let i = 0; i < 8; i++) {
    const phase = t * 6 - i * 0.62;
    const radius = 170 + i * (19 + 35 * unfold) + Math.sin(phase) * (16 + 10 * unfold);
    const color = i % 2 ? TERM.amber : TERM.green;
    lines.circle(cx, cy, radius, 2 + 3 * unfold, withAlpha(color, a * (i < 2 ? 0.55 : unfold * (0.32 - i * 0.023))));
  }
  lines.fillCircle(cx, cy, 16 + Math.sin(t * 6) * 5, withAlpha(TERM.green, a * 0.5));
}

const FRAGMENT_LABELS = ['fragment_0x3f', 'pointless[0]', 'null', 'undefined', '// TODO: love', 'me.hope', 'NaN', 'void*', 'fragment_0x7a', '/* us */'];

export function makeFragments() {
  const next = rng(77);
  return FRAGMENT_LABELS.map((label, i) => ({
    label, x: 0.15 + next() * 0.68, y: 0.22 + next() * 0.5, removedAt: 119.22 + i * 0.36,
  }));
}

export function drawFragmentDebris(ctx, fragments) {
  const { lines, type, W, H, f } = ctx;
  for (const fr of fragments) {
    const age = f.t - fr.removedAt;
    const debris = smoothstep(0.25, 0.85, age) * (1 - smoothstep(124.65, 126.2, f.t));
    if (debris <= 0) continue;
    const origin = fr.x * W + type.measure(fr.label, { size: 18, family: 'mono' }) / 2;
    for (let i = 0; i < 5; i++) {
      const x = origin + (i - 2) * (10 + age * 9);
      const y = fr.y * H + age * (14 + i * 8);
      lines.fillRect(x, y, 12 + i * 3, 4 + i, withAlpha(TERM.red, debris * 0.33));
    }
  }
}

export function flashIntoRecursion(ctx) {
  const { lines, W, H, f } = ctx;
  const age = f.t - 161.7;
  if (age < 0 || age >= 0.7) return;
  const strength = Math.exp(-age / 0.12) * (1 - smoothstep(0.38, 0.7, age));
  lines.begin();
  lines.fillRect(0, 0, W, H, withAlpha([1, 1, 1], 0.82 * strength));
  lines.flush(ctx.out);
}

/** 预计算粒子（确定性）。用于创世爆发 / stimulation 雨 / fragments 飘落。 */
export function makeParticles(seed, count, mode = 'burst') {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < count; i++) {
    const ang = r() * Math.PI * 2;
    const speed = 0.3 + r() * 0.7;
    pts.push({
      ang, speed,
      sz: 1 + r() * 3,
      life: 0.5 + r() * 0.5,
      delay: r() * 0.3,
      x0: r(), y0: r(),                          // rain/fall 模式的初始位置
      vx: (r() - 0.5) * 0.1, vy: 0.2 + r() * 0.4,
    });
  }
  return { pts, mode };
}

/** 画粒子。t=局部时间，origin={x,y}，spread=扩散半径。 */
export function drawParticles(ctx, particles, t, origin, spread = 400, alpha = 0.8) {
  const { lines, P } = ctx;
  const { pts, mode } = particles;
  for (const p of pts) {
    const lt = t - p.delay;
    if (lt < 0 || lt > p.life * 3) continue;
    const u = lt / (p.life * 3);
    const fade = u < 0.1 ? u / 0.1 : 1 - smoothstep(0.6, 1, u);
    let x, y;
    if (mode === 'burst') {
      const dist = p.speed * spread * smoothstep(0, 0.4, u);
      x = origin.x + Math.cos(p.ang) * dist;
      y = origin.y + Math.sin(p.ang) * dist;
    } else if (mode === 'rain') {
      x = p.x0 * ctx.W;
      y = (p.y0 + p.vy * lt * 0.3) % 1 * ctx.H;
    } else { // fall
      x = (p.x0 + p.vx * lt) * ctx.W;
      y = (p.y0 + p.vy * lt * 0.15) % 1 * ctx.H;
    }
    const col = mode === 'burst' ? TERM.green : mode === 'rain' ? TERM.white : TERM.dim;
    lines.circle(x, y, p.sz * fade, 1, withAlpha(col, alpha * fade));
  }
}

/** 故障撕裂效果：水平条带随机偏移。progress 0→1 控制强度。 */
export function glitchTear(ctx, t, intensity, seed = 1) {
  const { lines, W, H } = ctx;
  if (intensity < 0.05) return;
  const r = rng(seed + Math.floor(t * 10));
  const n = Math.floor(intensity * 8) + 1;
  for (let i = 0; i < n; i++) {
    const y = r() * H;
    const h = 2 + r() * 12 * intensity;
    const dx = (r() - 0.5) * 60 * intensity;
    lines.fillRect(dx, y, W, h, withAlpha(TERM.red, intensity * 0.15));
    lines.fillRect(-dx * 0.5, y + h, W, 1, withAlpha(TERM.green, intensity * 0.3));
  }
}
