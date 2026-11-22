// @ts-check
import { seq, cut } from '../../src/timeline.js';
import { worldPass } from '../../src/kit/index.js';
import hook from './scenes/hook.js';
import bridge from './scenes/bridge.js';
import mechanism from './scenes/mechanism.js';
import compare from './scenes/compare.js';
import data from './scenes/data.js';
import close from './scenes/close.js';
export const world = (ctx) => worldPass(ctx, { motif:'auto', vignette:0.3 });
const F = { x:160, y:200, w:1600, h:680 };
export default {
  title:'地铁图是「错」的，但这样才对', width:1920, height:1080, fps:24, scale:1,
  style:{ name:'paper', grid:{ pad:120 } }, captions:true,
  timeline: seq([
    cut(hook,{id:'hook',at:0,dur:4,handlesTransition:true,world:'auto',focus:F,state:{diff:['position','shape','light']},relayTo:'station-set'}),
    cut(bridge,{id:'bridge',at:4,dur:6,handlesTransition:true,world:'auto',focus:F,state:{diff:['position','light']},relayTo:'station-set'}),
    cut(mechanism,{id:'mechanism',at:10,dur:8,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','position']},relayTo:'station-set'}),
    cut(compare,{id:'compare',at:18,dur:10,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','position','light']},relayTo:'topo-grid'}),
    cut(data,{id:'data',at:28,dur:6,handlesTransition:true,world:'auto',focus:F,state:{diff:['light','visibility','material']},relayTo:'topo-grid'}),
    cut(close,{id:'close',at:34,dur:6,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape']},relayTo:''}),
  ]),
};
