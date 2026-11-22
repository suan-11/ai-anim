// @ts-check
import { makeShot } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';
export default makeShot('data', { draw(ctx,{enter}){ const{text,type,P,comp,gl,W,H}=ctx; text.clear(); type.writeLine('data',W*0.5,H*0.5,{anchor:'center',size:72,color:css(P.bone),...enter(0.2)}); text.upload(); comp.draw(gl,text,ctx.out,{premult:false}); return{grain:0.014}; } });
