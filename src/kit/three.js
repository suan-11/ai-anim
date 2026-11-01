// @ts-check
/**
 * `makeThreeShot()` —— 一个 **Three.js 镜头**（引擎的第 3 种 3D：真网格）。
 *
 * 与 `src/kit/shot.js` 的 `makeShot()` 是同一个形状，只是中间多了一层 3D：
 * 它替你把 `makeShot` 的那四件事（声明转场、铺背景、甩走上一帧、一台摄影机）
 * 加上 Three.js 的五件事（建渲染器、按子帧重渲、上传成纹理、合成进 `ctx.out`、投影回屏幕坐标）
 * 一起做掉。机制在 `src/core/three-bridge.js`，这里只负责"一个镜头该怎么写"。
 *
 * ```js
 * import { makeThreeShot } from '../../../src/kit/index.js';
 *
 * export default makeThreeShot('lab_stack', {
 *   // 相机与世界坐标**与 src/core/cam.js 同一套**：+x 右、+y 上、-z 朝屏幕里
 *   camera: { fov: 38, pos: [4.6, 3.0, 6.2], target: [0, 0.9, 0] },
 *   async setup(ctx, api) {
 *     const { THREE, scene } = api;
 *     // 需要随机就在 setup 里用 rng(seed) 预计算（AGENTS.md §4 铁律）
 *     …
 *   },
 *   update(ctx, api) {
 *     // ⚠ 只许写 t 的纯函数：api.scene.rotation.y = ctx.f.t * 0.4
 *     //    绝不要 api.scene.rotation.y += 0.01（子帧乱序，累积值没有意义）
 *   },
 *   overlay(ctx, api) {
 *     // 3D 之上叠引擎的矢量与文字；api.project(x,y,z) 把 3D 点换成屏幕坐标，
 *     // 标签/引线就贴得住物体（visible=false 的点别画）
 *   },
 *   post: { bloom: 0.34, grain: 0.02 },
 * });
 * ```
 *
 * ## 背景：`'cover'` 还是 `'over'`
 *
 * | `background` | 做法 | 背景连续性 |
 * |---|---|---|
 * | `'cover'`（默认） | 3D 自己铺满整帧（清屏色 + 三维网格） | 3D 的网格要**照着共享背景抄**（同 ink、同间距、同 accent） |
 * | `'over'` | 3D 用透明画布**浮在引擎画的背景上** | 背景是**同一批像素**，切点两侧逐像素一致（推荐） |
 *
 * `'over'` 要配套在时间线上写 `world: 'auto'`（否则这一段没有背景来源，
 * `check` 的背景守门会点名），并在 `setup` 里 `getThreeBridge(ctx, THREE, { alpha: true })`——
 * 用 `bridge: { alpha: true }` 这个选项即可。
 */

import { loadThree, getThreeBridge, linearColor, paletteColor } from '../core/three-bridge.js';
import { makeWorldKit, cameraPost, enterOffset } from './world.js';
import { fade } from './layout.js';

/**
 * @param {string} id 段名（出现在 HUD 与报错里）
 * @param {{
 *   camera?: { fov?: number, near?: number, far?: number, pos?: number[], target?: number[] },
 *   bridge?: { antialias?: boolean, alpha?: boolean, shadows?: boolean },
 *   background?: 'cover' | 'over' | 'add',
 *   setup?: (ctx: any, api: any) => any,
 *   update?: (ctx: any, api: any) => any,
 *   overlay?: (ctx: any, helpers: any) => any,
 *   post?: Record<string, any>,
 *   handlesTransition?: boolean,
 *   dispose?: () => any,
 * }} [spec]
 */
export function makeThreeShot(id, spec = {}) {
  const camCfg = spec.camera ?? {};
  const mode = spec.background ?? 'cover';
  return {
    id,
    /** 与 makeShot 一致：转场自己接管（`makeWorldKit.openFrame` 会把上一帧甩走） */
    handlesTransition: spec.handlesTransition ?? true,

    async setup(ctx) {
      const THREE = await loadThree();
      const bridge = getThreeBridge(ctx, THREE, spec.bridge ?? {});
      this.wk = makeWorldKit(ctx);
      this.THREE = THREE;
      this.bridge = bridge;
      this.scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        camCfg.fov ?? 38, ctx.W / ctx.H, camCfg.near ?? 0.1, camCfg.far ?? 400,
      );
      camera.position.set(...(camCfg.pos ?? [0, 2.2, 6]));
      // 挂到 this：relayPose() 回读 home 位姿时要用（接力探针，BACKLOG 1-12）
      const lookTarget = this.lookTarget = new THREE.Vector3(...(camCfg.target ?? [0, 0, 0]));
      camera.lookAt(lookTarget);
      this.camera = camera;
      bridge.setProjectCamera(camera);

      const api = {
        THREE, bridge, scene: this.scene, camera, P: ctx.P, mode,
        /** 线性 [r,g,b] → THREE.Color（**不要**用 new THREE.Color('#…')，那是按 sRGB 解释的） */
        color: (rgb, mul) => linearColor(THREE, rgb, mul),
        /** 取调色板里的线性色：`api.palette('signal', 0.6)` */
        palette: (name, mul) => paletteColor(THREE, ctx.P, name, mul),
        /** 世界坐标 → 逻辑像素（原点左上、y 向下），给标签/引线用 */
        project: (x, y, z) => bridge.project(x, y, z),
        /** 摆相机（每子帧调用；与 `src/core/cam.js` 的 camera3 同一套世界坐标） */
        setCamera: (o = {}) => {
          if (o.pos) camera.position.set(o.pos[0], o.pos[1], o.pos[2]);
          if (o.target) lookTarget.set(o.target[0], o.target[1], o.target[2]);
          if (o.roll) camera.up.set(Math.sin(o.roll), Math.cos(o.roll), 0);
          camera.lookAt(lookTarget);
          if (o.fov != null && o.fov !== camera.fov) { camera.fov = o.fov; camera.updateProjectionMatrix(); }
        },
      };
      this.api = api;
      if (spec.setup) await spec.setup.call(this, ctx, api);
    },

    /**
     * **相机接力（BACKLOG 1-12）**：把这一段的 home 位姿交给引擎探（`_probeRelayPose`）。
     *
     *   · `spec.cameraPose(ctx)` 存在 ⇒ 调它 —— **必须是 t 的纯函数**（确定性铁律），
     *     返回 `{ pos, target, fov?, roll? }`（camera3 的入参形状，字段名恰好与
     *     Pose 同形不同义，引擎内部用 `poseFromCamera3` 换算）；
     *   · 否则 ⇒ 回读当前相机状态（position / lookTarget / fov，roll = 0 ——
     *     Three 的相机没有独立 roll 通道，接力对里想要 roll 就写 cameraPose）。
     *
     * 引擎每子帧现探现算（不缓存），位姿随 t 漂移的动态飞行因此成立。
     */
    relayPose(ctx) {
      if (typeof spec.cameraPose === 'function') {
        return spec.cameraPose.call(this, ctx);
      }
      return {
        pos: this.camera.position.toArray(),
        target: this.lookTarget.toArray(),
        fov: this.camera.fov,
        roll: 0,
      };
    },

    render(ctx) {
      const api = this.api;
      this.bridge.setProjectCamera(this.camera);
      // ① 这一段自己的状态：只吃 t（子帧会带着略不同的 t 反复进来）
      if (spec.update) spec.update.call(this, ctx, api);
      // ①′ 相机接力（BACKLOG 1-12）：引擎在交叠期给了混合位姿 ⇒ **drive**：
      //    外来位姿替换自己的相机，画面照画（参考机制的 rig.drive；自己的 spec.update
      //    刚在上面跑完，位姿最后说了算的是 relay）。
      if (ctx.relay?.pose) api.setCamera(ctx.relay.pose);
      // ② 'over' / 'add' 要一个底：在**这一段自己的 render 里**再铺一次共享背景。
      //    为什么不能只靠 cut 上的 `world: 'auto'`：引擎铺底发生在 `gl.paint` 记账重置**之前**
      //    （`engine.js` 的 composite），于是 `check` 的背景守门看不到那一笔，会点名
      //    "这一段没铺整帧背景"。这里重复铺的是同一个 Pass、同一批像素（worldPass 只吃 f.t），
      //    代价是一次全屏绘制；换来的是"这一段真的有底"这件事**可测**。
      if (mode !== 'cover' && ctx.world) ctx.world.render(ctx.gl, ctx.out, ctx.f.t, ctx.f.dt);
      // ③ 渲一帧 Three.js（每个子帧都渲）→ 上传 → 按 mode 合成进 ctx.out
      this.bridge.render(this.scene, this.camera);
      this.bridge.composite(ctx.gl, ctx.out, { mode, t: ctx.f.t, dt: ctx.f.dt });
      // ④ 交叠期把上一帧甩走（与别的镜头同一套实现，方向/幅度才接得上）
      const k = this.wk.openFrame(ctx, null);
      const [dx, dy] = enterOffset(ctx.f.t, k);
      const enter = (delay = 0, to = 1, dur = 0.45) => fade(ctx.f.lt, delay, to, dur);
      // ⑤ 前景：引擎的矢量与文字（可以贴在 3D 物体上 —— api.project）
      const ov = spec.overlay ? spec.overlay.call(this, ctx, { k, dx, dy, enter, ...api }) : null;
      const post = { ...(spec.post ?? {}), ...(ov && typeof ov === 'object' ? ov : {}) };
      return cameraPost(ctx.f.t, post);
    },

    dispose() {
      if (spec.dispose) spec.dispose.call(this);
      this.scene?.clear?.();
      // 桥是共享的（每个 GL 一个），**不要**在这里 dispose 它
    },
  };
}
