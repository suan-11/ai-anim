// @ts-check
import { seq, cut } from '../../src/timeline.js';
import { worldPass } from '../../src/kit/index.js';
import hook from './scenes/hook.js'; import bridge from './scenes/bridge.js'; import mechanism from './scenes/mechanism.js'; import data from './scenes/data.js'; import close from './scenes/close.js';
export const world=(ctx)=>worldPass(ctx,{motif:'auto',vignette:0.4});
const F={x:200,y:150,w:1520,h:780};
export default { title:'这个三角形，造不出来', width:1920,height:1080,fps:24,scale:1, style:{name:'blueprint',grid:{pad:120}}, captions:true,
  timeline:seq([
    cut(hook,{id:'hook',at:0,dur:4,handlesTransition:true,world:'auto',focus:F,state:{diff:['position']},relayTo:'joint'}),
    cut(bridge,{id:'bridge',at:4,dur:5,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape']},relayTo:'joint'}),
    cut(mechanism,{id:'mechanism',at:9,dur:8,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','visibility']},relayTo:'gap'}),
    cut(data,{id:'data',at:17,dur:7,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','light']},relayTo:'stairs'}),
    cut(close,{id:'close',at:24,dur:8,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape']},relayTo:''}),
  ]) };
