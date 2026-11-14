// @ts-check
// Real meshes, depth and shadows: the same 27 modules separate and return; nothing respawns.
import { makeThreeShot } from '../kit/three.js';
import { deconstructPose, deconstructInspection, traceLeader, phase } from '../kit/action-motion.js';
import { css, mixColor } from '../core/util.js';
import { describe } from './action-stage.js';

const DEFAULTS = {
  id: 'deconstruct', kicker: 'DECONSTRUCT / 解构',
  title: '拆开，才看见结构', label: '分离 · 观察 · 重组', spread: 2.15,
};

export function deconstructShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  deconstructPose(0, 0, o.spread);
  const scene = makeThreeShot(o.id, {
    camera: { fov: 36, pos: [7.8, 5.8, 11.2], target: [0, -.3, 0] },
    background: 'cover',
    bridge: { shadows: true, antialias: true },
    async setup(ctx, api) {
      const { THREE, scene, palette, color } = api;
      const { RoundedBoxGeometry } = await import('three/addons/geometries/RoundedBoxGeometry.js');
      this.geometry = new RoundedBoxGeometry(.94, .94, .94, 3, .065);
      this.bodyMaterial = new THREE.MeshStandardMaterial({
        color: palette('bone', .76), roughness: .34, metalness: .12,
      });
      this.coreMaterial = new THREE.MeshStandardMaterial({
        color: palette('signal'), emissive: palette('signal'), emissiveIntensity: .16,
        roughness: .25, metalness: .24,
      });
      // Isolate the selected shell module from its 25 peers sharing bodyMaterial.
      this.inspectMaterial = this.bodyMaterial.clone();
      this.bodyColor = this.bodyMaterial.color.clone();
      this.inspectColor = palette('signal');
      this.model = new THREE.Group();
      this.modules = Array.from({ length: 27 }, (_, i) => {
        const mesh = new THREE.Mesh(this.geometry, i === 13 ? this.coreMaterial : i === 24 ? this.inspectMaterial : this.bodyMaterial);
        mesh.castShadow = mesh.receiveShadow = true;
        this.model.add(mesh);
        return mesh;
      });
      scene.add(this.model);
      scene.background = palette('ink');
      scene.fog = new THREE.Fog(palette('ink'), 18, 35);

      // Fine construction lines preserve the original topology when modules move apart.
      this.guideGeometry = new THREE.BufferGeometry();
      this.guideGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(27 * 6), 3));
      this.guideMaterial = new THREE.LineBasicMaterial({ color: palette('bone'), transparent: true, opacity: 0, depthWrite: false });
      this.guides = new THREE.LineSegments(this.guideGeometry, this.guideMaterial);
      this.guides.frustumCulled = false;
      this.model.add(this.guides);

      this.floorGeometry = new THREE.PlaneGeometry(200, 200);
      this.floorMaterial = new THREE.MeshStandardMaterial({ color: palette('ink2'), roughness: .9, metalness: .05 });
      const floor = new THREE.Mesh(this.floorGeometry, this.floorMaterial);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -3.35;
      floor.receiveShadow = true;
      scene.add(floor);
      scene.add(new THREE.HemisphereLight(color([.72, .82, 1]), color([.035, .025, .02]), 2.2));
      const key = new THREE.DirectionalLight(color([1, .91, .80]), 4.4);
      key.position.set(3.5, 9, 7);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      Object.assign(key.shadow.camera, { left:-6, right:6, top:6, bottom:-6, near:.1, far:28 });
      key.shadow.bias = -.0003;
      key.shadow.normalBias = .025;
      key.shadow.radius = 3;
      scene.add(key);
      const rim = new THREE.DirectionalLight(palette('signal'), 2.5);
      rim.position.set(-6, 2, -4);
      scene.add(rim);
      const fill = new THREE.DirectionalLight(color([.55, .70, 1]), 1.2);
      fill.position.set(-4, 3, 5);
      scene.add(fill);
      this.point = new THREE.Vector3();
    },
    update(ctx, api) {
      const p = ctx.f.p;
      const focus = deconstructInspection(p);
      const inspect = phase(p, .48, .68);
      const returnView = phase(p, .76, .94);
      const yaw = .61 + .44 * inspect - .44 * returnView;
      // Camera changes only for inspection; no perpetual orbit during the final hold.
      const pullback = 1.6 + (o.spread - 1) * 2.5;
      const distance = 13.5 + pullback * phase(p, .10, .42) - pullback * phase(p, .74, .94);
      api.setCamera({ pos: [Math.sin(yaw)*distance, 5.5 - .8*inspect + .8*returnView, Math.cos(yaw)*distance], target:[0,-.35,0] });
      this.model.rotation.set(0, -.10, 0);
      const positions = this.guideGeometry.attributes.position;
      for(let i=0; i<27; i++) {
        const pose = deconstructPose(i,p,o.spread);
        this.modules[i].position.set(...pose.position);
        this.modules[i].rotation.set(...pose.rotation);
        positions.setXYZ(i*2,...pose.home);
        positions.setXYZ(i*2+1,...pose.position);
      }
      positions.needsUpdate = true;
      this.guideMaterial.opacity = .14 * phase(p,.24,.42) * (1-phase(p,.69,.82)) * (1 - .65*Math.max(focus.core.focus,focus.shell.focus));
      this.coreMaterial.emissiveIntensity = .12 + .35*phase(p,.25,.44)*(1-phase(p,.70,.88)) + .18*focus.core.focus;
      this.inspectMaterial.color.copy(this.bodyColor).lerp(this.inspectColor,.55*focus.shell.focus);
      this.inspectMaterial.emissive.copy(this.inspectColor);
      this.inspectMaterial.emissiveIntensity = .12*focus.shell.focus;
      this.model.updateMatrixWorld(true);
    },
    overlay(ctx, api) {
      const { W,H,lines,P,type,text,comp,gl,f } = ctx;
      const pad = ctx.grid?.pad ?? W*.065;
      text.clear();
      type.write(o.kicker,pad,H*.075,{size:22,family:'mono',tracking:4,color:css(P.signal)});
      const titleSize = Math.min(76,(W-pad*2)/Math.max(1,String(o.title).length)*.9);
      type.reveal(o.title,W*.5,H*.18,{size:titleSize,weight:800,align:'center',color:css(P.bone),progress:phase(f.p,.015,.10)});
      const focus = deconstructInspection(f.p);
      lines.begin();
      if(focus.core.focus>0 || focus.shell.focus>0) {
        const core = api.project(0,0,0);
        const side = this.modules[24].getWorldPosition(this.point);
        const shell = api.project(side.x,side.y,side.z);
        for(const [point,x,y,caption,col,cue] of [
          [core,W*.80,H*.50,'核心',P.signal,focus.core],
          [shell,W*.18,H*.59,'外层模块',mixColor(P.bone,P.signal,.45),focus.shell],
        ]) {
          if (!(cue.focus > 0)) continue;
          if(!point.visible) continue;
          const elbowX = x + (x < W/2 ? W*.065 : -W*.065);
          const path = traceLeader([[point.x,point.y],[elbowX,y],[x,y]],cue.leader);
          lines.polyline(path,1.5,[...col,.65*cue.opacity]);
          lines.circle(point.x,point.y,4,2,[...col,cue.focus],24);
          type.reveal(caption,x,y-14,{size:28,weight:600,align:x<W/2?'left':'right',color:css(col),progress:cue.label,alpha:cue.opacity});
        }
      }
      lines.flush(ctx.out);
      // The footer is a post-observation handoff, so it never competes with the two callouts.
      type.reveal(o.label,W*.5,H*.88,{size:28,align:'center',color:css(mixColor(P.bone,P.ash,.25)),progress:phase(f.p,.905,.94)});
      text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
      // Remove the skeleton's generic global drift: camera motion already lives in real 3D.
      return { zoom:1, shake:[0,0], rot:0, bloom:.12, grain:0, vignette:.12, ca:0 };
    },
    dispose() {
      for(const name of ['geometry','bodyMaterial','coreMaterial','inspectMaterial','guideGeometry','guideMaterial','floorGeometry','floorMaterial']) this[name]?.dispose();
    },
  });
  scene.focus = 'center';
  return scene;
}

describe(deconstructShot, DEFAULTS, {
  name:'deconstruct', summary:'真实三维爆炸视图：模块错峰拆开、露出核心、侧向观察，最后按原拓扑重新组装。',
  use:'结构拆解、产品爆炸图、模块组成与重新组装', energy:'中高', avoid:'纯文字讲解；不需要三维遮挡时',
}, { spread:'展开间距倍数，1.4..2.8' });
deconstructShot.spec.outputs.handlesTransition = true;
deconstructShot.meta.notes = '27 个真实网格、圆角材质与深度遮挡、阴影、投影标签。位置与旋转是时间的纯函数；首尾回到同一结构。需要 Chrome WebGL2。';
