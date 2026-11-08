export { makeParticles, PARTICLE_PRESETS, MAX_PARTICLES } from './particles.js';
// 镜头级镜碎的**计划层**（纯函数：h2 与 shader 同表达式、k 方向与转场版相反）；绘制层见 docs/MOTION-SPIN-SHATTER.md §3.3
export { h2 as shatterH2, fract as shatterFract, shatterPlan, shatterIn } from './shatter.js';
// @ts-check
/**
 * `src/kit/` —— 引擎自带的镜头工具。
 *
 * ## 为什么它在引擎里，而不在某个任务的 `scenes/_kit.js` 里
 *
 * 这些东西在 `tasks/nekohome/scenes/_kit.js`（431 行）和 `tasks/fidus/scenes/_kit.js`（约 450 行）
 * 里**各写了一遍**：`put`、`fade`、`typed`、`panel`/`cardFrame`、`kicker`、`footer`、
 * `enterOffset`、`cutOut`、`transPass`、`worldPass` 的结构都重复。
 * 更糟的是照抄第二次时**漏了 `openFrame` 的调用**，导致 9 段里 8 段的底是纯黑
 * —— 这正是"复制粘贴当抽象"的典型失败模式（`docs/history/IMPROVEMENTS-1-3.md` P1-1 / P0-2）。
 *
 * ## 用法
 *
 * ```js
 * import { makeShot, put, fade, typed, panel, kicker, footer, marker, reticle, makeWorldKit }
 *   from '../../../src/kit/index.js';
 * ```
 *
 * 也可以只拿一部分：
 *   · `src/kit/layout.js`   —— 纯排版工具（不碰 GPU）
 *   · `src/kit/elements.js` —— 画在 lines 上的版面元件（面板/眉标/页脚/准星/标记）
 *   · `src/kit/world.js`    —— 全片共享背景 + 一台摄影机（转场那套配方）
 *   · `src/kit/shot.js`     —— `makeShot()`：把镜头骨架包成一个函数
 *   · `src/kit/three.js`    —— `makeThreeShot()`：Three.js 镜头（第 3 种 3D：真网格）
 *
 * ## 边界（什么不该进这里）
 *
 * 这里只放**反复出现、与具体片子无关**的东西。某一支片子特有的视觉母题
 * （例如 fidus 的准星路线、nekohome 的窗口边框）属于那支片子：放在任务自己的
 * `scenes/_kit.js` 里，从 `src/kit/` import 通用件再叠加自己的东西。
 */

export { mul, withAlpha, sat01, put, writeLine, fade, typed, codeRow, labelRow, seqRnd, contrast, css } from './layout.js';

/**
 * `src/kit/motion.js` —— **运动规则**的纯函数（规则表：`docs/MOTION.md`；BACKLOG 1-27）。
 *
 * `nudgeCurve` 三段式整组位移（10/65/25，出处 REFERENCE-hyperframes.md 516 行）/
 * `waterfallStagger` 错峰到达的归一化（`items × stagger ≤ ~0.5s`，535 行）+
 * 纯判据 `waterfallOver` / `glowPeakCap` 辉光峰值上限（≤ ~0.45，522 行）。
 * 三个都只吃 t 与参数、**不碰 GPU / 浏览器**（连 import 都没有），可以离线单测：
 * `node tools/test-motion.mjs`。⚠ 那些数值是**外部经验值，我方未实测**（MOTION.md §0）。
 */
export {
  nudgeCurve, waterfallStagger, waterfallOver, glowPeakCap,
  NUDGE_SPLIT, NUDGE_PHASE, MAX_STAGGER_SPAN, GLOW_PEAK_CAP,
} from './motion.js';

/**
 * `src/kit/carry.js` —— **衔接（carry）**的纯函数词表（BACKLOG 1-36，2026-10-17；
 * 判据与出处：`docs/REFERENCE-onetake.md` §2.4 / §4 —— 外部项目 PolyForm Noncommercial，
 * **只抄思路与数值口径，不抄代码**）。
 *
 * 解决的是「切点上有东西活下来并变成下一个画面」：`morphRect`（按下的东西变成结果）、
 * `iris`（主体打开自己的世界）、`zoomThrough`（推近穿透成下一场景）、`hop`（主体跳到
 * 下一个槽）、`gather`（一群元素收拢成标志）、`operatorCam`（键控摄影机之上的
 * "操作员手感"：跟主体提前 0.1s、落点先 key、hold 浮动归零、落地 shake）。
 *
 * 全部只吃 t 与参数、不碰 GPU / 浏览器（只 import `../core/util.js`），可离线单测：
 * `node tools/test-carry.mjs`。⚠ 提前量 / 弧高 / 阈值是**外部经验值，我方未实测**
 * （MOTION.md §0 的分级照用）。
 */
export {
  morphRect, iris, zoomThrough, hop, gather, operatorCam,
  CARRY_MOVE_FRAC, CARRY_SCALE_FRAC, CARRY_ANCHOR_FRAC,
} from './carry.js';

export { panel, fillRect, kicker, footer, reticle, marker } from './elements.js';

/**
 * 版面分区与字幕/标注元件（`docs/CAPTIONS.md`）：
 * `bands()` / `bandsOf()` 给出版面五条带（含**字幕保留带**），
 * `captionNote()` 是"只放短标注"的说明条（写成长句会警告），
 * `subLine()` 给"想在段内自己画字幕"的少数场合（大多数片子用 `task.captions: true` 就够）。
 */
export { bands, bandsOf, assertInBand, captionNote, subLine } from './bands.js';

export {
  worldPass, cameraAt, cameraDir, cameraPost, enterOffset, makeWorldKit, transitionPass,
  // 碰撞式转场的判据（BACKLOG 1-33 ③，docs/MOTION.md §3.5）：0.40–0.50 那条区间只在 trans.js 里定义一次
  planCollision, victimSpan, VICTIM_RATIO_RANGE, VICTIM_RATIO_DEFAULT,
  // 转场模式（BACKLOG 1-13）：'push' / 'wipe' / 'iris' / 'glitch' / 'pixel' / 'dissolve'（+ 'mix' / 'none'）
  TRANSITION_MODES, resolveTransitionMode,
} from './world.js';

/**
 * `src/core/relay.js` —— **相机接力**（BACKLOG 1-12）的纯函数层：位姿换算、混合、
 * 换手窗、运动曲线。零 GPU、零 ctx 依赖（离线单测 `node tools/test-relay.mjs`）。
 *
 *   · `poseFromCamera3` / `poseToCamera3`：camera3 形状 ⇄ Pose（互逆）；
 *   · `blendPose(a, b, e)`：位姿混合（look 直线、dist/tan(fov/2) 几何、yaw 最短路径）；
 *   · `relayHandover(k, window?)`：换手进度（默认窗 [.35, .65]，smoothstep）；
 *   · `MOVES` / `resolveRelayMove(name)`：运动曲线（glide / whip，未知名抛错）。
 *
 * `HANDOVER_GLIDE` 是默认换手窗常量。
 */
export {
  poseFromCamera3, poseToCamera3, blendPose, relayHandover,
  HANDOVER_GLIDE, MOVES, resolveRelayMove,
} from '../core/relay.js';

/**
 * **camera3 场景的一行接力接入**（BACKLOG 1-12）：
 *
 * ```js
 * render(ctx) {
 *   const cam = camera3({ ...relayPose3(ctx, myHome), H });   // myHome = 这段自己的 home 机位
 *   …
 * }
 * ```
 *
 * 引擎在交叠期给了 `ctx.relay.pose`（混合位姿）就替换自己的 home 机位，否则原样返回 home。
 * ⚠ `Pose` 与 `camera3` 的入参**恰好同形不同义**（`look` = 看向哪、`pos` = 站在哪）：
 * `ctx.relay.pose` 是引擎用 `poseToCamera3()` 换算过的 camera3 形状（`pos/target/fov/roll`），
 * 所以两个形状可以直接 `{ ... }` 混搭 —— 这是刻意的字段对齐，写在这里防止后人"顺手改名"。
 *
 * @param {{ relay?: { pose?: any } | null }} [ctx] 场景 ctx（非 relay 段的 ctx.relay 恒空）
 * @param {{ pos: number[], target: number[], fov?: number, roll?: number }} home
 *        这一段自己的 home 机位（camera3 入参形状）
 * @returns {{ pos: number[], target: number[], fov?: number, roll?: number }}
 */
export function relayPose3(ctx, home) {
  const p = ctx?.relay?.pose;
  return p ?? home;
}

/**
 * `src/kit/paper.js` —— **剪纸 / 纸艺层叠**（BACKLOG 1-49 能力缺口表第 5 行，覆盖素材包 20 条）。
 *
 * 一张纸要像纸只有三件事：**硬投影**（不是模糊阴影）、**分形撕边 + 白芯**（不是锯齿线）、
 * **纸色有纤维**（不是纯色填充）。这里给四块可以组合的件，形状永远由调用方给：
 *
 * ```js
 * import { paperShape, paperStack, paperGrain, shadowColor, tornEdge } from '../../../src/kit/index.js';
 *
 * setup(ctx) {
 *   // ⚠ 撕边在 setup 里算一次：纸不会每帧重新撕一遍（也省 800 次噪声）
 *   this.layers = [0, 1, 2].map((i) => ({
 *     shape: paperShape({ x: 200 + i * 120, y: 300 - i * 60, w: 900, h: 420, seed: i }),
 *     color: paperGrain([0.86, 0.83, 0.76], i * 100, i * 40),
 *     depth: i / 2,
 *   }));
 * }
 * draw(ctx, { dx, dy }) {
 *   // pan 必须是 t 的函数（引擎铁律）；视差由 paperStack 按 depth 铺开
 *   paperStack(ctx.lines, this.layers, { pan: [ctx.f.t * 6 + dx, dy], parallax: 40 });
 * }
 * ```
 *
 * ⚠ **投影色用 `shadowColor()` 算**（不透明、由纸色乘暗），不要用半透明黑：
 *   `lines` 的柔边在相邻扫描行之间会叠加，半透明填充会出现横向条纹。
 */
export {
  tornEdge, paperShape, paperFace, paperStack, paperGrain,
  shadowColor, coreColorOf, translateShape,
} from './paper.js';

/**
 * `src/kit/pixel.js` —— **像素精灵 / 调色板量化 / 5x7 像素字**（BACKLOG 1-67；
 * 素材包缺口表第 9 行，覆盖 7 条：K28 L49 L51 O77 R5 V13 X13）。
 *
 * 真像素艺术是四条硬约束，缺一条就只是「糊了」：
 * **调色板**（4/8/16 色）/ **块**（一切落在同一栅格上）/ **有序抖动**（Bayer，不是渐变）
 * / **帧率**（8–12fps 的台阶，不是 60fps 平滑）。
 *
 * ```js
 * import { paletteOf, pixelText, drawSprite, spriteOf, snapTime, pixelGradient } from '../../../src/kit/index.js';
 *
 * setup(ctx) { this.pal = paletteOf('gameboy'); }
 * render(ctx) {
 *   const step = snapTime(ctx.f.t, 12);          // ⚠ 用整片时间，不是 f.lt（切段会把台阶重置）
 *   pixelGradient(lines, { x: 0, y: 0, w: 1920, h: 700 }, this.pal, { cell: 8, dither: 4 });
 *   pixelText(lines, 'INSERT COIN', 960, 720, { scale: 12, align: 'center', color: this.pal.linear[3] });
 *   drawSprite(lines, spriteOf('bot'), 200 + Math.round(step * 120), 640, { scale: 8, color: this.pal.linear[2] });
 * }
 * ```
 *
 * ⚠ 三条写错不报错：抖动阈值要按**块**坐标取（按像素取 = 块被撕成噪点）；
 *   精灵/像素字要落在整块上（差半块 = 抗锯齿把边缘抹成灰）；中文**不要**用 5x7 像素字
 *   （一个汉字要 12x12 以上，表里没有 —— 用 `type.write` + `post.pixel`）。
 */
export {
  PIXEL_PALETTES, DEFAULT_PALETTE, paletteOf, lumaOf,
  DITHER_MODES, bayerAt, nearestIndex, quantize, ditherQuantize,
  snapTo, snapTime, snapIndex,
  SPRITES, spriteOf, spriteRect, rowRuns, drawSprite,
  FONT5x7, glyphOf, GLYPH_W, GLYPH_H, GLYPH_TRACKING, pixelTextWidth, pixelText,
  pixelGradient,
} from './pixel.js';

/**
 * src/kit/views.js —— 仪器视图：把一帧已经画好的画面换一种成像方式
 * （半调印刷 / 字符画 / 1-bit 抖动 / 分级平涂 / 热成像 / 像素 / CRT / 雕版排线）。
 * 落地 BACKLOG 1-11，并覆盖风格素材包里反复出现的那几种介质（索引见
 * docs/REFERENCE-style-pack.md；代码与素材包无关，一行没抄）。
 *
 *   instrumented(ctx, { mode: 'halftone', cell: 6 }, (target) => {
     lines.flush(target);
     comp.draw(gl, text, target, { premult: false });
   });
 *
 * ⚠ 成像是「事后」的：先画进离屏目标（含文字），再换成像；而且它是整帧替换，
 * 必须画在最后一步。
 */
export {
  VIEWS, VIEW_NAMES, applyView, renderCapture, instrumented, listViews,
  glyphInk, sortGlyphsByInk,
} from './views.js';

/**
 * `src/kit/stroke.js` —— **手绘笔迹**：中心线 + 压力 -> 轮廓多边形（BACKLOG 1-69；
 * 素材包缺口表第 6 行，覆盖 17 条：K3 K8 K9 K10 K11 L17 L22 M1 M2 X1 X3 X7 X18 X23 X29 Z12 Z14）。
 *
 * 这一层解决的是「一笔一笔真的写出来」，不是「给折线加个抖动」：
 * **全部信息量在宽度沿弧长的分布**（落笔细 -> 行笔粗 -> 收笔细）。`lines.polyline` 是等宽描边、
 * `boil.js` 是手不稳，两者都拿不出笔压。
 *
 * ```js
 * import { strokePath, strokeArc, inkOn } from '../../../src/kit/index.js';
 *
 * lines.begin();
 * strokePath(lines, [[x0, y], [x1, y - 4], [x2, y + 2]], {
 *   width: 7, color: inkOn(P.bone, 0.9, paper),   // ⚠ 笔迹不许半透明（会出横纹）
 *   reveal: k,                                    // 按弧长生长（0..1）
 *   boil: { t: f.t, seed: 7, amp: 1.4 },           // 可选：12fps 的重描抖动
 * });
 * lines.flush(ctx.out);
 * ```
 *
 * ⚠ 三条写错不报错：宽度变化率超过 `MAX_WIDTH_SLOPE` 会让轮廓**自交**、被偶奇规则填成洞
 * （笔画中间长出蝴蝶结空白）；笔迹用半透明色会在笔画内部长出横向细纹；两端圆头必须用
 * 这一端自己的半宽（用平均值会在收笔处鼓起一个「墨滴」）。见 `docs/COOKBOOK.md` §20。
 */
export {
  MAX_WIDTH_SLOPE, catmullRom, resampleByLength, pressureEnvelope, clampWidthSlope,
  pressureProfile, strokeRing, revealSamples, boilSamples, inkOn, drawStroke, strokePath, strokeArc,
} from './stroke.js';

/**
 * 填充面：直接转发 `src/core/fill.js` 的扫描线（场景里也可以直接 `lines.fillPoly(...)`）。
 * 三个函数给**要算形状**而不是要画的人用（例如先算出一块面的包围盒、或把它转成路径）。
 * 角度约定：0 = 右，π/2 = **下**（y 向下为正）。见 `docs/COOKBOOK.md` §17。
 */
export { polySpans, circleSpans, sectorSpans, ringEdges, crossingsAt } from '../core/fill.js';

export { makeShot, shot } from './shot.js';
export { stickerShot } from './sticker.js';

/**
 * `src/kit/info.js` —— **infoShot 段落骨架**（BACKLOG 1-50）：眉标 + 标题 + 面板底
 * （图形区）+ 侧标注 + 出处行 + 页脚 + 四段错峰一次包掉，用户只写 `draw(ctx, rect)`。
 * 版面纪律（字幕带避让 / focus 声明 / 出处行）由骨架承担 —— 判据"新片子手写行数
 * 占比 < 30%"靠它收敛。
 */
export { infoShot } from './info.js';

/**
 * `makeThreeShot()` —— 一个 **Three.js 镜头**（引擎的第 3 种 3D：真网格）。
 * 机制在 `src/core/three-bridge.js`（桥 / 颜色 / 投影），这里只是"一个镜头该怎么写"。
 * 标定夹具与沙盒：`tasks/_three-calib`、`tasks/_three-lab`；排错见 `docs/ENGINE.md` §3.8。
 */
export { makeThreeShot } from './three.js';

/**
 * `src/kit/panel.js` —— **2D 面板层**（讲一张表 / 一条管线 / 一组格子时用）。
 * 与 `./elements.js` 那一组是**同一类东西的两个层次**，别混：
 *   · `elements.js` 的 `panel(lines, x, y, w, h, col, …)` —— 底层图元，自己传 `lines` 与颜色；
 *   · 这里的 `panelBox(ctx, { x, y, w, h, … })` —— 整块面板（底 + 边 + 四角 + 标题 + 副标题
 *     + `tone` 压暗），只吃 `ctx`。
 * 所以本层那个**改名成 `panelBox` 再出**，`elements.js` 的 `panel` **一个字都不动**
 * （老场景照旧；`docs/history/IMPROVEMENTS-4-5.md` §4.4 B）。
 *
 * 另外：这里的 `col` 与 `./layout.js` 的 `mul/withAlpha` 是同一族，为避免两个 `col` 打架，
 * 本层那个出成 `panelCol`；`jitter/win/step` 与 `./blocks.js` 的同名函数**实现相同**（共用 `./micro.js`），不重复出。
 */
export {
  panelBox, tile, tileRow, chips, arrowH, bufBox, hatchBox, meter, tag2,
  chipLayout, shadeOf, mixToInk, toneColor, col as panelCol,
} from './panel.js';

/**
 * `src/kit/blocks.js` —— **方块世界 kit**（3D 线段批 + 画家算法 + 面朝向判据 + 世界切片 +
 * 按段名定位的摄影机）。`docs/history/IMPROVEMENTS-4-5.md` §4.2 / §4.3 / §4.4 A/C。
 *
 * ```js
 * import { makeBlocksKit } from '../../../src/kit/index.js';
 *
 * // setup(ctx) 里建一次；clock 是 anim say 生成的段时刻表
 * this.B = makeBlocksKit({
 *   P: ctx.P,                                    // 缺 slab / slabHi 会当场抛错并点名
 *   clock: { ctm: { start: 60.0, stretch: 1.05 } },
 *   keys: [                                      // "段名 + 段内秒"：段长变了机位自动跟着走
 *     { id: 'ctm', at: 0.0,  pos: [-8, 32, -84], tgt: [0, 15, 4], fov: 48 },
 *     { id: 'ctm', at: 19.0, pos: [-6, 31, -82], tgt: [0, 15, 4], fov: 48 },
 *   ],
 * });
 *
 * // render(ctx) 里
 * const cam = this.B.camAt(f.t);                  // 全片一台连续摄影机（纯函数）
 * lines.begin();
 * for (const s of this.B.sections) this.B.section(ctx, cam, s, { alpha: s.surf ? 1 : 0.4 });
 * this.B.flush(ctx);                              // 显式排水（也可以直接 lines.flush(ctx.out)）
 * ```
 *
 * ## 两条数字上的纪律（写错了画面"看起来不对"但不报错）
 *
 * · **alpha 管在不在，tone 管亮不亮**（§4.3）：`section({ alpha: 0.4 })` 是**把它画暗**，
 *   不是把它画透 —— `alpha ≥ 0.17` 时填充**完全不透明**；深度淡出（`depthTint`）也只乘颜色。
 * · **`facesToward` 的判据是 `dot(相机 − 面心, 法线) > 0`**（§4.2）。老代码写成
 *   `dot(面心 − 相机, 法线) > 0`（= 背面的条件），于是顶面从来没被铺过、世界读成水晶。
 *   `tools/test-blocks.mjs` 拿正反用例钉着它，**别"顺手"改回去**。
 */
export {
  makeBlocksKit, seg3, box3, solidBox, hatchQuad, ground, playerMarker, frustumCone,
  beam, orb, flush, sortByDepth, byDepth, facesToward, faceTone, visibleEdges, faceGeometry,
  halfOf, solidityAt, depthAlpha, depthTint, toAbsTime, localT, expandKeys, keySpan,
  pickColor, requireColor, FACE_NORMALS, FACE_GEO, BOX_EDGES, SUN,
  FILL_ZERO, FILL_FULL, TONE_FLOOR, SOLID_K, QUEUE_KEY, PENDING, clearPending,
} from './blocks.js';

// 母题库（BACKLOG 1-49）：跨片子复用的视觉母题 —— 见 src/kit/motifs/index.js 的头注释
export * from './motifs/index.js';
export { smooth, phase, recoil, cascadePose, contourPoint, deconstructPose } from './action-motion.js';
