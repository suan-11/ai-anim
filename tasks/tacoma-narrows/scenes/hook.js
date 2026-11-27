// @ts-check
/**
 * 01 · hook —— 贴地机位看桥面两边翻（风格帧 #1）。
 * 第 0 帧已失衡；0.75s 左缘最高，1.75s 右缘抬起，2.75s 回穿中线。机位锁滚转。
 * 3D 解析投影①：桥塔/主缆/吊索/护栏世界坐标线段，桥面沿跨距局部横滚。
 * ⚠ lines 颜色用线性数组 withAlpha(P.x,a)，不是 css 字符串（css 只给 type.write）。
 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { camera3, project3, clipSegment, widthAt } from '../../../src/core/cam.js';
import { TAU } from '../../../src/core/util.js';

const HW = 9, SPAN = 200, TOWER_Z = 150, TOWER_H = 55, DECK_Y = 0, NSEG = 48;
function twist(z, lt) {
  // 近处扭转更剧烈（脚下翻起），跨中也有幅度；along 在 z 小处仍给足
  const along = 0.45 + 0.55 * Math.sin((z / SPAN) * Math.PI);
  const phase = Math.cos((lt / 3) * TAU);
  return 0.72 * along * phase;   // ~41° 峰值
}
function edge(z, side, lt) {
  const th = twist(z, lt);
  return [side * HW * Math.cos(th), DECK_Y + side * HW * Math.sin(th), z];
}
export default makeShot('hook', {
  draw(ctx) {
    const { f, lines, text, comp, gl, W, H, P } = ctx;
    const lt = f.lt;
    const cam = camera3({ pos: [0, 1.6, -3], target: [0, 4.5, TOWER_Z], fov: 62, roll: 0, H });
    const bone = P.bone, ash = P.ash, sig = P.signal, graphite = P.graphite;
    const seg = (a, b, col, w0) => {
      const pa = project3(cam, W, H, a[0], a[1], a[2]);
      const pb = project3(cam, W, H, b[0], b[1], b[2]);
      if (clipSegment(pa, pb, 0.3)) lines.seg(pa.x, pa.y, pb.x, pb.y, widthAt(cam, pa.w, w0), col);
    };
    lines.begin();
    seg([-400, -2, TOWER_Z + 60], [400, -2, TOWER_Z + 60], withAlpha(graphite, 0.5), 1.2);
    for (const tz of [TOWER_Z, TOWER_Z + 90]) {
      for (const sx of [-HW - 1, HW + 1]) seg([sx, DECK_Y - 4, tz], [sx, TOWER_H, tz], withAlpha(bone, 0.85), 2.2);
      seg([-HW - 1, TOWER_H, tz], [HW + 1, TOWER_H, tz], withAlpha(bone, 0.85), 2.2);
      seg([-HW - 1, TOWER_H * 0.6, tz], [HW + 1, TOWER_H * 0.6, tz], withAlpha(bone, 0.6), 1.4);
    }
    for (const sx of [-HW - 1, HW + 1]) {
      let prev = null;
      for (let i = 0; i <= NSEG; i++) {
        const z = (i / NSEG) * (SPAN + 40);
        const sag = TOWER_H - (TOWER_H - 8) * Math.sin((z / (SPAN + 40)) * Math.PI);
        const pt = [sx, sag, z];
        if (prev) seg(prev, pt, withAlpha(ash, 0.7), 1.6);
        prev = pt;
      }
    }
    let prevL = null, prevR = null;
    for (let i = 0; i <= NSEG; i++) {
      const z = (i / NSEG) * SPAN;
      const L = edge(z, -1, lt), R = edge(z, 1, lt);
      if (prevL) { seg(prevL, L, withAlpha(bone, 0.95), 2.6); seg(prevR, R, withAlpha(bone, 0.95), 2.6); }
      if (i % 2 === 0) seg(L, R, withAlpha(ash, 0.45), 1.2);
      seg(L, [L[0], L[1] + 2.2, L[2]], withAlpha(ash, 0.7), 1.3);
      seg(R, [R[0], R[1] + 2.2, R[2]], withAlpha(ash, 0.7), 1.3);
      if (i % 3 === 0) {
        const sag = TOWER_H - (TOWER_H - 8) * Math.sin((z / (SPAN + 40)) * Math.PI);
        seg([-HW - 1, sag, z], L, withAlpha(graphite, 0.5), 0.9);
        seg([HW + 1, sag, z], R, withAlpha(graphite, 0.5), 0.9);
      }
      prevL = L; prevR = R;
    }
    let prevC = null;
    for (let i = 0; i <= NSEG; i++) {
      const z = (i / NSEG) * SPAN;
      const C = [0, DECK_Y + 0.05, z];
      if (prevC) seg(prevC, C, withAlpha(sig, 0.5), 1.4);
      prevC = C;
    }
    lines.flush(ctx.out);
    text.clear(); text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    return { grain: 0.014, vignette: 0.4, bloom: 0.18 };
  },
});
