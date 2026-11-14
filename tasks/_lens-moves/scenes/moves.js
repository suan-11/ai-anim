import { makeThreeShot } from '../../../src/kit/three.js';
import { phase } from '../../../src/kit/action-motion.js';
import { createFlightPath, flightProgress, stageDepth, stageOpening } from './flight.js';
import { sensorArt } from './sensor-art.js';

export default function lensMove(mode = 'offset') {
  return makeThreeShot('lens-travel', {
    handlesTransition: false,
    camera: { fov: 48, near: .045, far: 130, pos: [7.8, 3.4, 10], target: [0, 0, -3.5] },
    background: 'cover',
    bridge: { antialias: true },
    async setup(ctx, { THREE, bridge, scene, palette, color }) {
      this.resources = [];
      const keep = resource => { this.resources.push(resource); return resource; };
      const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
      const room = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(bridge.renderer);
      const studio = keep(pmrem.fromScene(room, .045));
      scene.environment = studio.texture;
      scene.environmentIntensity = .22;
      room.dispose();
      pmrem.dispose();
      const metal = keep(new THREE.MeshStandardMaterial({
        color: palette('bone', .58), metalness: .82, roughness: .32,
      }));
      const dark = keep(new THREE.MeshStandardMaterial({
        color: palette('ink2', .7), metalness: .72, roughness: .24,
      }));
      const copper = keep(new THREE.MeshStandardMaterial({
        color: palette('signal', .45), metalness: .64, roughness: .34,
      }));
      const rim = keep(new THREE.MeshStandardMaterial({
        color: color([.12, .42, .39]), emissive: color([.02, .12, .10]),
        emissiveIntensity: .08, metalness: .7, roughness: .24,
      }));
      const glass = keep(new THREE.MeshPhysicalMaterial({
        color: color([.65, .86, .83]), metalness: 0, roughness: .08,
        transparent: true, opacity: .055, depthWrite: false,
        clearcoat: 1, clearcoatRoughness: .07,
      }));
      const lensGeometry = keep(new THREE.SphereGeometry(1.24, 64, 24));
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
        const lens = new THREE.Mesh(lensGeometry, glass);
        lens.scale.z = .065;
        lens.position.z = .16;
        group.add(lens);
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
      const texture = keep(new THREE.CanvasTexture(sensorArt()));
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
        keep(new THREE.MeshStandardMaterial({ color: palette('ink2'), roughness: .86, metalness: .05 })));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -2.65;
      scene.add(floor);
      scene.background = palette('ink');
      scene.fog = new THREE.Fog(palette('ink'), 24, 75);
      scene.add(new THREE.HemisphereLight(color([.65, .83, 1]), palette('ink'), .85));
      const key = new THREE.DirectionalLight(color([1, .82, .64]), 1.8);
      key.position.set(4, 8, 6); scene.add(key);
      const fill = new THREE.DirectionalLight(color([.25, .75, 1]), 1.1);
      fill.position.set(-4, 3, -14); scene.add(fill);
      const light = new THREE.PointLight(color([.15, .7, .63]), 2, 24, 1.4);
      light.position.set(0, .8, -11); scene.add(light);
      this.route = createFlightPath(THREE);
      this.eye = new THREE.Vector3();
    },
    update(ctx, api) {
      const t = ctx.f.p * 9;
      for (let i = 0; i < this.stages.length; i++) {
        const open = mode === 'orbit'
          ? phase(t, .55, 2.65)
          : mode === 'reveal'
            ? phase(t, .15, 2.2)
            : stageOpening(i, t);
        const group = this.stages[i];
        group.position.z = mode === 'orbit'
          ? -i * (.72 + .92 * open)
          : mode === 'reveal'
            ? -i * (.58 + .34 * open)
            : stageDepth(i, t);
        group.rotation.z = (i % 2 ? -1 : 1) * (mode === 'orbit' ? .20 : .13) * open;
      }
      const u = flightProgress(t);
      if (mode === 'orbit') {
        const angle = -.72 + 1.92 * u;
        const radius = 9.2 - 2.0 * phase(t, 1.1, 6.6);
        this.eye.set(Math.sin(angle) * radius, 2.8 + .6 * Math.sin(u * Math.PI), Math.cos(angle) * radius - 2.6);
        api.setCamera({ pos: this.eye.toArray(), target: [0, 0, -2.2 - 5.2 * u] });
      } else if (mode === 'reveal') {
        this.route.getPointAt(1 - u, this.eye);
        api.setCamera({ pos: this.eye.toArray(), target: [0, 0, -3.5 - 10.5 * (1 - u)] });
      } else {
        this.route.getPointAt(u, this.eye);
        this.eye.x += .38 * Math.sin(u * Math.PI) + .48 * Math.sin(u * Math.PI * 3.2);
        this.eye.y += .24 * Math.cos(u * Math.PI * 2.4);
        api.setCamera({ pos: this.eye.toArray(), target: [.1 - .45 * u + .16 * Math.sin(u * Math.PI * 2.2), .08 * Math.cos(u * Math.PI * 2), -3.5 - 20.5 * phase(t, .5, 3.1)] });
      }
      const roll = mode === 'orbit' ? .045 * Math.sin(u * Math.PI * 1.4) : .025 * (1 - phase(t, 0, 4));
      this.camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    },
    overlay(ctx) {
      const { text, type, gl, comp, P } = ctx;
      text.clear();
      const label = mode === 'orbit' ? '环绕' : mode === 'reveal' ? '后撤揭示' : '偏轴穿行';
      type.write(label, 190, 865, { size: 48, weight: 650, color: P.css('bone'), alpha: 1 });
      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });
      return { zoom: 1, shake: [0, 0], rot: 0, bloom: .08, grain: 0, vignette: .12, ca: 0 };
    },
    dispose() {
      for (const resource of this.resources ?? []) resource.dispose();
    },
  });
}
