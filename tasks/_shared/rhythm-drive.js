// @ts-check
/** 方案2 · 节奏统一指挥：画面动画时钟直接由 f.rhythm.progress 驱动。
 *
 * 为什么存在：场景各自用 f.lt 排动画时刻，峰谷与 rhythm.json 块边界天然错位
 * （交接文档 §二 根因）。这里把「角色 → 动画强度包络」收敛成一个纯函数，
 * 场景把原来的 smoothstep(lt, a, b) 换成 rd.k / rd.slam / rd.grow，
 * 峰谷就落在节奏块边界上——节奏表是唯一时间源。
 *
 * 显著性算法 A = 0.75·strength/(strength+8) + 0.25·concentration 奖励
 * 「集中 + 剧变」：所以 release 给主体猛动作（slam/grow），pressure 收束
 * 压暗（k 下降），hold 微起伏，residue 缓降。全屏放射/全局曝光无效，别用。
 *
 * 用法（场景 draw 内）：
 *   const rd = rhythmDrive(ctx.f);          // 无节奏表时回退 lt 包络
 *   const h = base + amp * rd.grow;         // 主体形变
 *   const zoom = 1 + 0.3 * rd.slam;         // 冲击推近
 *   return cam.post(ctx, { impact: rd.impact });
 */
import { sat, smoothstep } from '../../src/core/util.js';

/** 角色包络：全部是 progress∈[0,1) 的纯函数，块边界处不连续=有意的卡点突变。 */
const ENVELOPES = {
  // pressure 主动下蹲：从中位缓降到中低（收束蓄力），末段最紧
  pressure(u) {
    const k = 0.55 - 0.35 * u;                    // 主强度 0.55→0.20
    return { k, slam: 0, grow: 0.25 * (1 - u), impact: 0, dim: 0.3 + 0.4 * u };
  },
  // hold 期待：低位微起伏（呼吸），末尾轻微上扬预示
  hold(u) {
    const breathe = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 - Math.PI / 2);
    const k = 0.28 + 0.10 * breathe + 0.08 * smoothstep(0.8, 1, u);
    return { k, slam: 0, grow: 0.15 + 0.1 * breathe, impact: 0, dim: 0.25 };
  },
  // release 冲峰：前 25% 猛升（slam 冲击），随后高位保持带脉冲
  release(u) {
    const slam = smoothstep(0, 0.22, u);          // 块首冲击（对齐块边界！）
    const settle = 1 - 0.15 * smoothstep(0.6, 1, u);
    const pulse = 0.5 + 0.5 * Math.sin(u * Math.PI * 6);
    const k = (0.55 + 0.45 * slam) * settle + 0.06 * pulse * slam;
    return { k: Math.min(1, k), slam, grow: slam, impact: slam * (1 - 0.5 * smoothstep(0.5, 1, u)), dim: 0 };
  },
  // residue 回落：从峰余晖缓降回中位，不归零
  residue(u) {
    const k = 0.62 - 0.24 * u;
    return { k, slam: 0, grow: 0.4 * (1 - u), impact: 0.2 * (1 - smoothstep(0, 0.4, u)), dim: 0.1 * u };
  },
};

/**
 * @param {{rhythm?: {beat_role: string, progress: number}|null, lt: number}} f
 * @returns {{role: string|null, u: number, k: number, slam: number, grow: number, impact: number, dim: number}}
 */
export function rhythmDrive(f) {
  const r = f.rhythm;
  if (!r || !ENVELOPES[r.beat_role]) {
    // 无节奏表回退：段内前 1/3 当作 release，其余缓落（老行为近似）
    const u = sat(f.lt / 6);
    const e = ENVELOPES.release(Math.min(1, u * 1.5));
    return { role: null, u, ...e };
  }
  const u = sat(r.progress ?? 0);
  return { role: r.beat_role, u, ...ENVELOPES[r.beat_role](u) };
}

/** 主体运动幅度调制：把 rd 包络乘进已有的动画量（柱高/位移/缩放）。
 * quiet=静息底值，peak=峰值幅度。返回 quiet + (peak-quiet)*k。 */
export function driveAmount(rd, quiet, peak) {
  return quiet + (peak - quiet) * rd.k;
}