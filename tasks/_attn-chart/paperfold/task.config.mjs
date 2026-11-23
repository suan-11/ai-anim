// @ts-check
import { seq, cut } from '../../../../src/timeline.js'; import { worldPass } from '../../../../src/kit/index.js';
import attn from './scenes/attn.js';
export const world=(ctx)=>worldPass(ctx,{motif:'auto',vignette:0.2});
export default { title:'注意力曲线', width:1920,height:1080,fps:24,scale:1, style:{name:'flat'}, timeline:seq([cut(attn,{id:'attn',dur:2,world:'auto'})]) };
