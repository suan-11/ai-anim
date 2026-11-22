// @ts-check
/** paperfold —— 纸对折指数（有声版）。 */
import { seq, cut } from '../../src/timeline.js'; import { worldPass } from '../../src/kit/index.js';
import timing from './audio/timing.mjs';
import hook from './scenes/hook.js'; import bridge from './scenes/bridge.js'; import mechanism from './scenes/mechanism.js'; import data from './scenes/data.js'; import close from './scenes/close.js';
export const world=(ctx)=>worldPass(ctx,{motif:'auto',vignette:0.3});
const F={x:160,y:200,w:1600,h:680}; const S=(i)=>timing.scenes[i];
export default { title:'对折 42 次，这张纸够到月球', width:1920,height:1080,fps:24,scale:1, style:{name:'paper',grid:{pad:120}}, captions:true,
  narration:'./audio/narration.json', audio:{music:'./audio/bed.mp3',vo:'./audio/paperfold-vo.mp3',mix:'./audio/paperfold-mix.mp3'},
  timeline:seq([
    cut(hook,{id:'hook',dur:S(0).slot,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','light']},relayTo:'thickness',params:{stretch:S(0).stretch}}),
    cut(bridge,{id:'bridge',dur:S(1).slot,overlap:0.6,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','light']},relayTo:'thickness',params:{stretch:S(1).stretch}}),
    cut(mechanism,{id:'mechanism',dur:S(2).slot,overlap:0.6,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','light','material']},relayTo:'thickness',params:{stretch:S(2).stretch}}),
    cut(data,{id:'data',dur:S(3).slot,overlap:0.6,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','light']},relayTo:'moon',params:{stretch:S(3).stretch}}),
    cut(close,{id:'close',dur:S(4).slot,overlap:0.6,handlesTransition:true,world:'auto',focus:F,state:{diff:['shape','light']},relayTo:'',params:{stretch:S(4).stretch}}),
  ]) };
