// @ts-check
/**
 * relay3d-b（B 侧）：**makeThreeShot**，高机位俯瞰同一个台架。
 *
 * 验的是 3D 接力对的后半段：
 *   · cameraPose 换成 pos 随 t 缓移（两侧位姿都在动 —— 飞行不是"两台静态相机的插值"）；
 *   · 与上段 overlap 1.2 + transition: 'relay' + transitionOpts { move: 'whip' } ——
 *     验 whip 运动曲线（前慢后快、甩鞭手感）。
 */
import { makeThreeShot } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';
import { ORIGIN, HOME_3B, drift3B, buildPillars, LABEL_ANCHOR } from './_homes2.js';

export default makeThreeShot('relay3d-b', {
  background: 'over',
  bridge: { alpha: true },
  camera: { fov: HOME_3B.fov, pos: HOME_3B.pos, target: HOME_3B.target },

  async setup(ctx, api) {
    const { THREE, scene, palette } = api;
    scene.fog = new THREE.Fog(palette('ink'), 14, 40);

    scene.add(new THREE.HemisphereLight(palette('bone', 0.4), palette('ink'), 1.4));
    const key = new THREE.DirectionalLight(palette('bone', 2.0), 2.4);
    key.position.set(-3.5, 9, 6);
    scene.add(key);

    const grid = new THREE.GridHelper(24, 24, palette('ash', 0.8), palette('ash', 0.35));
    grid.position.set(ORIGIN[0], 0, ORIGIN[2]);
    scene.add(grid);

    // 同一圈柱子（同一个 seed —— 台架是同一个，只是机位换了）
    this.pillars = buildPillars({ count: 9, ring: 3.1, seed: 5 });
    const geo = new THREE.CylinderGeometry(1, 1, 1, 8);
    for (const p of this.pillars) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: palette('graphite', 0.9), roughness: 0.7, metalness: 0.05,
      }));
      m.position.set(p.x, p.h / 2, p.z);
      m.scale.set(p.w, p.h, p.w);
      scene.add(m);
    }

    const mk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.3, 6), new THREE.MeshBasicMaterial({ color: palette('signal') }));
    mk.position.set(LABEL_ANCHOR[0], LABEL_ANCHOR[1] - 3.3 / 2, LABEL_ANCHOR[2]);
    scene.add(mk);
  },

  update(ctx, api) {
    api.scene.rotation.y = ctx.f.t * 0.06;
  },

  cameraPose(ctx) {
    return drift3B(ctx.f.t);
  },

  overlay(ctx, h) {
    const { lines, text, type, comp, gl, P } = ctx;
    const p = h.project(LABEL_ANCHOR[0], LABEL_ANCHOR[1], LABEL_ANCHOR[2]);
    lines.begin();
    if (p.visible) {
      lines.seg(p.x, p.y, p.x - 110, p.y - 52, 1.6, h.P.signal);
      lines.circle(p.x, p.y, 5, 2.4, h.P.signal);
    }
    lines.flush(ctx.out);
    text.clear();
    if (p.visible) {
      type.writeLine('中央标记柱', p.x - 118, p.y - 56, {
        anchor: 'right', size: 26, family: 'sans', color: css(P.bone),
      });
    }
    type.writeLine('relay3d-b · 高机位俯瞰 — move: whip', 96, 118, {
      anchor: 'left', size: 52, weight: 800, family: 'sans', color: css(P.bone), ...h.enter(0.2),
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.26, grain: 0.02 };
  },
});
