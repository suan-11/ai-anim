// @ts-check
import { seq, cut } from '../../src/timeline.js'; import { worldPass } from '../../src/kit/index.js';
import hook from './scenes/hook.js'; import bridge from './scenes/bridge.js'; import mechanism from './scenes/mechanism.js'; import data from './scenes/data.js'; import close from './scenes/close.js';
export const world=(ctx)=>worldPass(ctx,{motif:'auto',vignette:0.4});
const F={x:160,y:250,w:1600,h:560};
export default { title:'这条海岸线，量不准', width:1920,height:1080,fps:24,scale:1, style:{name:'paper',grid:{pad:120}}, captions:true,
  timeline:seq([
    cut(hook,{id:'hook',at:0,dur:4,handlesTransition:true,world:'auto',focus:F,state:{diff:['position','light']},relayTo:'coast'}),
    cut(bridge,{id:'bridge',at:4,dur:5,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','light']},relayTo:'coast'}),
    cut(mechanism,{id:'mechanism',at:9,dur:8,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','light','material']},relayTo:'subdiv'}),
    cut(data,{id:'data',at:17,dur:7,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','light']},relayTo:'loglog'}),
    cut(close,{id:'close',at:24,dur:8,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','light']},relayTo:''}),
  ]) };