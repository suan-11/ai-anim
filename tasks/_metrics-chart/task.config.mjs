// @ts-check
import { seq, cut } from '../../src/timeline.js'; import { worldPass } from '../../src/kit/index.js';
import chart from './scenes/chart.js';
export const world=(ctx)=>worldPass(ctx,{motif:'auto',vignette:0.25});
export default { title:'指标对比', width:1920,height:1080,fps:24,scale:1, style:{name:'flat'},
  timeline:seq([cut(chart,{id:'chart',dur:2,world:'auto'})]) };
