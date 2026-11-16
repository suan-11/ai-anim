import { cut, seq } from '../../src/timeline.js';
import loop from './scenes/loop.js';
// 无缝循环：grain/ca 这类逐帧噪声必须关掉（或做成周期），否则首末帧噪声不同 ⇒ 接缝假红。
export default { title: 'loop lab', width: 1280, height: 720, fps: 30, style: { name: 'mg-hud', post: { grain: 0, ca: 0 } }, timeline: seq([cut(loop, { id: 'loop', dur: 6, world: false })]) };
