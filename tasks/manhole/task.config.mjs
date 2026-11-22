// @ts-check
import { seq, cut } from '../../src/timeline.js'; import { worldPass } from '../../src/kit/index.js';
import hook from './scenes/hook.js'; import bridge from './scenes/bridge.js'; import mechanism from './scenes/mechanism.js'; import data from './scenes/data.js'; import close from './scenes/close.js';
export const world=(ctx)=>worldPass(ctx,{motif:'auto',vignette:0.4});
const F={x:300,y:200,w:1320,h:680};
export default { title:'井盖为什么非得是圆的', width:1920,height:1080,fps:24,scale:1, style:{name:'paper',grid:{pad:120}}, captions:true,
  timeline:seq([
    cut(hook,{id:'hook',at:0,dur:4,handlesTransition:true,world:'auto',focus:F,state:{diff:['position','shape']},relayTo:'hole'}),
    cut(bridge,{id:'bridge',at:4,dur:5,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape']},relayTo:'hole'}),
    cut(mechanism,{id:'mechanism',at:9,dur:8,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','light']},relayTo:'width'}),
    cut(data,{id:'data',at:17,dur:6,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape']},relayTo:'reuleaux'}),
    cut(close,{id:'close',at:23,dur:7,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape']},relayTo:''}),
  ]) };
