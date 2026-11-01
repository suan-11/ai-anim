/**
 * 相机接力（relay）夹具（BACKLOG 1-12）。
 *
 * 三组、六段：每组是"同一个世界的两台机位"，段间 overlap 1.2 秒撑出交叠窗
 * （0.4s 的短交叠在 still 里抓不到中间态 —— _trans-lab 的同一经验）。
 *
 * | 组 | 段 | 验什么 |
 * |---|---|---|
 * | ① | relay2d → relay2d-b | 手写 camera3 场景的 relay 接入（relayPose3 一行）+ move: glide |
 * | ② | push2d → push2d-b | **对照组**：同样两台机位，不写 transition（默认 push 甩镜）|
 * | ③ | relay3d → relay3d-b | makeThreeShot 的 cameraPose 接入 + move: whip + overlay 贴 3D 点 |
 *
 * 交叠窗（前段 end 与本段 start 之间）：relay 缝 4.8–6.0 / 对照缝 14.6–16.0 / 3D 缝 24.4–25.6，
 * 出图抓交叠中点 ±0.2s（5.4 / 15.3 / 25.0），主会话收尾统一做：
 *   node scripts/anim.mjs still _relay-lab -t 2,5.4,9,12,15.3,18,21,25,28
 *   node scripts/anim.mjs cuts  _relay-lab
 *   node scripts/anim.mjs audit _relay-lab
 * 离线回归：node tools/test-relay.mjs（纯 JS）、node tools/test-timeline-guard.mjs
 *
 * 段长不卡音乐（本任务无音轨）；画面上的数字只有标注文字，没有编造的数值读数
 * —— 几何参数（塔的位置/高度/fov）不是"画面数字"，不需要 FACTS.md。
 */
import { seq, cut } from '../../src/timeline.js';
import { worldPass } from '../../src/kit/index.js';
import relay2d from './scenes/relay2d-a.js';
import relay2dB from './scenes/relay2d-b.js';
import push2d from './scenes/push2d-a.js';
import push2dB from './scenes/push2d-b.js';
import relay3d from './scenes/relay3d-a.js';
import relay3dB from './scenes/relay3d-b.js';

/** 全片一层背景（print 母题），三组共用 —— 切缝两侧的"世界不跳"靠它。 */
export const world = (ctx) => worldPass(ctx, { grid: 60, accent: ctx.P.signal });

export default {
  title: '相机接力 relay 夹具',
  width: 1920, height: 1080, fps: 60, scale: 1,
  style: 'print',
  timeline: seq([
    // ── ① relay + glide：手写 camera3 场景 ──────────────────────────────
    cut(relay2d, {
      id: 'relay2d', dur: 6, world: 'auto',
      note: 'A 侧：手写 camera3 场景，低机位近景看塔 A；relayPose 是 t 的纯函数（fov/dist 微动）',
    }),
    cut(relay2dB, {
      id: 'relay2d-b', dur: 6, overlap: 1.2, world: 'auto',
      transition: 'relay', transitionOpts: { move: 'glide' },
      note: 'B 侧：与上段接力（move glide）—— 验相机飞过去、内容在换手窗 [.35,.65] 交接',
    }),

    // ── ② 对照组：默认 push 甩镜 ─────────────────────────────────────────
    cut(push2d, {
      id: 'push2d', dur: 5, world: 'auto',
      note: '对照组 A 侧：与 relay2d 同世界同机位；本组不写 transition',
    }),
    cut(push2dB, {
      id: 'push2d-b', dur: 5, overlap: 1.2, world: 'auto',
      note: '对照组 B 侧：默认 push 甩镜 —— 与上方接力缝出图对比（同样的两台机位）',
    }),

    // ── ③ relay + whip：makeThreeShot 对 ────────────────────────────────
    cut(relay3d, {
      id: 'relay3d', dur: 6, world: 'auto',
      note: '3D A 侧：makeThreeShot + cameraPose(t)（fov 缓变）；background over + world auto；overlay 贴 3D 点',
    }),
    cut(relay3dB, {
      id: 'relay3d-b', dur: 5, overlap: 1.2, world: 'auto',
      transition: 'relay', transitionOpts: { move: 'whip' },
      note: '3D B 侧：接力（move whip）—— 验甩鞭曲线与 3D 相机 drive',
    }),
  ]),
};
