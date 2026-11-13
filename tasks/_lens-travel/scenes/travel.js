import { makeThreeShot } from '../../../src/kit/three.js';
import { phase } from '../../../src/kit/action-motion.js';

export default function lensTravel() {
  return makeThreeShot('lens-travel', {
    handlesTransition: false,
    camera: { fov: 48, near: .045, far: 130, pos: [7.8, 3.4, 10], target: [0, 0, -3.5] },
    background: 'cover',
    bridge: { antialias: true },
    async setup(ctx, { THREE, scene, palette, color }) {
      this.resources = [];
      const keep = resource => { this.resources.push(resource); return resource; };
      const metal = keep(new THREE.MeshStandardMaterial({
        color: palette('bone', .58), metalness: .72, roughness: .27,
      }));
      const dark = keep(new THREE.MeshStandardMaterial({
        color: palette('ink2', .7), metalness: .62, roughness: .3,
      }));
      const copper = keep(new THREE.MeshStandardMaterial({
        color: palette('signal', .7), metalness: .64, roughness: .27,
      }));
      const rim = keep(new THREE.MeshStandardMaterial({
        color: color([.12, .65, .61]), emissive: color([.04, .24, .21]),
        emissiveIntensity: .36, metalness: .4, roughness: .21,
      }));
      const shell = new THREE.Shape();
      shell.absarc(0, 0, 2.05, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(0, 0, 1.28, 0, Math.PI * 2, true);
      shell.holes.push(hole);
      const housing = keep(new THREE.ExtrudeGeometry(shell, {
        depth: .28, bevelEnabled: true, bevelSegments: 2,
        steps: 1, bevelSize: .045, bevelThickness: .045, curveSegments: 72,
      }));
      const lip = keep(new THREE.TorusGeometry(1.33, .055, 10, 96));
      const outer = keep(new THREE.TorusGeometry(2.0, .045, 8, 96));
      const screw = keep(new THREE.CylinderGeometry(.055, .055, .045, 10));
      screw.rotateX(Math.PI / 2);
      const tooth = keep(new THREE.BoxGeometry(.11, .28, .34));
      this.stages = Array.from({ length: 7 }, (_, i) => {
        const group = new THREE.Group();
        group.add(new THREE.Mesh(housing, i % 3 === 0 ? copper : dark));
        const inner = new THREE.Mesh(lip, rim);
        inner.position.z = .35;
        group.add(inner);
        const edge = new THREE.Mesh(outer, metal);
        edge.position.z = .32;
        group.add(edge);
        for (let j = 0; j < 12; j++) {
          const a = j / 12 * Math.PI * 2;
          const bolt = new THREE.Mesh(screw, metal);
          bolt.position.set(Math.cos(a) * 1.79, Math.sin(a) * 1.79, .34);
          group.add(bolt);
          const rib = new THREE.Mesh(tooth, j % 3 === 0 ? copper : dark);
          rib.position.set(Math.cos(a) * 2.10, Math.sin(a) * 2.10, .12);
          rib.rotation.z = a - Math.PI / 2;
          group.add(rib);
        }
        scene.add(group);
        return group;
      });
      // A physical sensor at the end supplies a stable destination for the move.
      const chipGeometry = keep(new THREE.BoxGeometry(4.7, 3.4, .22));
      const chip = new THREE.Mesh(chipGeometry, dark);
      chip.position.z = -24.15;
      scene.add(chip);
      const screen = document.createElement('canvas');
      screen.width = 1024; screen.height = 640;
      const c = screen.getContext('2d');
      c.fillStyle = '#263d47'; c.fillRect(0, 0, 1024, 640);
      c.fillStyle = '#e6a075';
      c.beginPath(); c.arc(704, 228, 90, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#80aea0';
      c.beginPath(); c.moveTo(0, 480); c.lineTo(302, 199); c.lineTo(580, 507);
      c.lineTo(833, 333); c.lineTo(1024, 510); c.lineTo(1024, 640); c.lineTo(0, 640); c.fill();
      c.fillStyle = '#3e6c73';
      c.beginPath(); c.moveTo(0, 540); c.lineTo(283, 417); c.lineTo(599, 580);
      c.lineTo(830, 481); c.lineTo(1024, 562); c.lineTo(1024, 640); c.lineTo(0, 640); c.fill();
      c.strokeStyle = '#0c252549'; c.lineWidth = 1;
      for (let i = 0; i < 1024; i += 8) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 640); c.stroke(); }
      for (let i = 0; i < 640; i += 8) { c.beginPath(); c.moveTo(0, i); c.lineTo(1024, i); c.stroke(); }
      const texture = keep(new THREE.CanvasTexture(screen));
      texture.colorSpace = THREE.SRGBColorSpace;
      const face = new THREE.Mesh(keep(new THREE.PlaneGeometry(4.1, 2.5625)),
        keep(new THREE.MeshBasicMaterial({ map: texture })));
      face.position.z = -24;
      scene.add(face);
      const pinGeometry = keep(new THREE.BoxGeometry(.12, .25, .05));
      for (let i = 0; i < 24; i++) {
        for (const sign of [-1, 1]) {
          const pin = new THREE.Mesh(pinGeometry, copper);
          pin.position.set((i - 11.5) * .175, sign * 1.79, -24);
          scene.add(pin);
        }
      }
      const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(160, 160)),
        keep(new THREE.MeshStandardMaterial({ color: palette('ink2'), roughness: .52, metalness: .12 })));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -2.65;
      scene.add(floor);
      scene.background = palette('ink');
      scene.fog = new THREE.Fog(palette('ink'), 24, 75);
      scene.add(new THREE.HemisphereLight(color([.65, .83, 1]), palette('ink'), 2));
      const key = new THREE.DirectionalLight(color([1, .82, .64]), 4.5);
      key.position.set(4, 8, 6); scene.add(key);
      const fill = new THREE.DirectionalLight(color([.25, .75, 1]), 3);
      fill.position.set(-4, 3, -14); scene.add(fill);
      const light = new THREE.PointLight(color([.15, .7, .63]), 8, 24, 1.4);
      light.position.set(0, .8, -11); scene.add(light);
      this.route = new THREE.CatmullRomCurve3([
        new THREE.Vector3(7.8, 3.4, 10),
        new THREE.Vector3(3.9, 1.45, 7),
        new THREE.Vector3(.30, .1, 3),
        new THREE.Vector3(.02, .08, -3),
        new THREE.Vector3(.1, -.06, -10),
        new THREE.Vector3(-.1, .05, -16),
        new THREE.Vector3(.05, 0, -20.9),
      ], false, 'centripetal');
      this.eye = new THREE.Vector3();
    },
    update(ctx, api) {
      const t = ctx.f.t;
      for (let i = 0; i < this.stages.length; i++) {
        const open = phase(t, .65 + i * .075, 2.35 + i * .075);
        const group = this.stages[i];
        group.position.z = -i * (.43 + 2.67 * open);
        group.rotation.z = (i % 2 ? -1 : 1) * .13 * open;
      }
      const u = phase(t, 0, 9);
      this.route.getPoint(u, this.eye);
      const roll = .025 * Math.sin(t * .62);
      this.camera.up.set(Math.sin(roll), Math.cos(roll), 0);
      api.setCamera({
        pos: this.eye.toArray(),
        target: [0, 0, -3.5 - 20.5 * phase(t, .5, 3.1)],
      });
    },
    overlay(ctx) {
      const { text, type, gl, comp, P } = ctx;
      text.clear();
      if (ctx.f.t < 1.9) {
        type.write('镜组', 145, 865, { size: 48, weight: 650, color: P.css('bone'), alpha: 1 - phase(ctx.f.t, 1.2, 1.9) });
      }
      if (ctx.f.t > 7.4) {
        type.write('成像面', 145, 865, { size: 48, weight: 650, color: P.css('bone'), alpha: phase(ctx.f.t, 7.4, 7.9) });
      }
      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });
      return { zoom: 1, shake: [0, 0], rot: 0, bloom: .08, grain: 0, vignette: .12, ca: 0 };
    },
    dispose() {
      for (const resource of this.resources ?? []) resource.dispose();
    },
  });
}
