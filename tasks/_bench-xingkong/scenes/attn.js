// @ts-check
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';
import curve from '../curve.json';
export default makeShot('attn',{
  draw(ctx){
    const{lines,text,type,comp,gl,W,H,P}=ctx;
    const padL=140,padR=100,padT=160,padB=140;
    const gw=W-padL-padR, gh=H-padT-padB;
    const X=t=>padL+t/curve.dur*gw, Y=v=>padT+(1-v)*gh;
    lines.begin();
    for(let v=0;v<=1;v+=0.25){ const y=Y(v); lines.seg(padL,y,W-padR,y,0.8,withAlpha(P.graphite,0.3)); }
    lines.seg(padL,padT,padL,H-padB,1.5,withAlpha(P.bone,0.6));
    lines.seg(padL,H-padB,W-padR,H-padB,1.5,withAlpha(P.bone,0.6));
    // 实测曲线（红）
    const pts=curve.samples.filter(s=>s.A!==null);
    for(let i=1;i<pts.length;i++){ const a=pts[i-1],b=pts[i]; if(b.t-a.t>1)continue; lines.seg(X(a.t),Y(a.A),X(b.t),Y(b.A),2.5,withAlpha(P.signal,0.95)); }
    lines.seg(X(3),padT,X(3),H-padB,1.5,withAlpha(P.signal,0.4));
    lines.flush(ctx.out);
    text.clear();
    type.writeLine(curve.name+' · 注意力曲线（B站标杆）', W*0.5, 80, {anchor:'center',size:40,color:css(P.bone,0.95)});
    type.writeLine('均值'+curve.mean.toFixed(2)+' 峰'+curve.max.toFixed(2)+' 谷'+curve.min.toFixed(2)+' 落差'+(curve.max-curve.min).toFixed(2), W*0.5, 120, {anchor:'center',size:26,color:css(P.ash,0.85)});
    for(let v=0;v<=1;v+=0.25) type.writeLine(v.toFixed(2), padL-20, Y(v), {anchor:'right',size:20,color:css(P.ash,0.7)});
    for(let t=0;t<=curve.dur;t+=(curve.dur>100?20:10)) type.writeLine(t+'s', X(t), H-padB+35, {anchor:'center',size:20,color:css(P.ash,0.7)});
    type.writeLine('钩子', X(1.5), padT-15, {anchor:'center',size:22,color:css(P.signal,0.8)});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.01,vignette:0.2};
  },
});
