// @ts-check
/** 04 · data —— 【答案峰②】长度 vs 尺子 log-log 直线 = 分形维 D。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { coastline, pathLen } from './_geo.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
export default makeShot('data',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    // 测各级长度
    const data=[]; for(let d=0;d<=4;d++){ const L=pathLen(coastline(W,H,d)); const eps=Math.pow(1/3,d); data.push([Math.log10(eps),Math.log10(L)]); }
    const zt=sat((lt-3.5)/0.6); const zoom=1+0.6*smoothstep(0,1,zt);
    ctx.setXform({scale:zoom,anchor:[W*0.5,H*0.5]});
    lines.begin();
    // log-log 坐标轴
    const ox=W*0.3, oy=H*0.7, aw=W*0.4, ah=H*0.4;
    lines.seg(ox,oy,ox+aw,oy,2,withAlpha(P.bone,0.8));
    lines.seg(ox,oy,ox,oy-ah,2,withAlpha(P.bone,0.8));
    // 数据点 + 连线（直线）
    const xs=data.map(d=>d[0]), ys=data.map(d=>d[1]);
    const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
    const px=v=>ox+(v-xmin)/(xmax-xmin)*aw, py=v=>oy-(v-ymin)/(ymax-ymin)*ah;
    const prog=smoothstep(0.3,3.0,lt);
    const n=Math.floor(prog*(data.length-1))+1;
    for(let i=0;i<data.length;i++){ const x=px(data[i][0]),y=py(data[i][1]); lines.circle(x,y,5,2,withAlpha(i<n?P.signal:P.graphite,i<n?0.95:0.4)); }
    for(let i=1;i<n;i++) lines.seg(px(data[i-1][0]),py(data[i-1][1]),px(data[i][0]),py(data[i][1]),2.5,withAlpha(P.signal,0.9));
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('log(尺子)', ox+aw/2, oy+50, {anchor:'center',size:26,color:css(P.ash,0.8)});
    type.writeLine('log(长度)', ox-60, oy-ah/2, {anchor:'center',size:26,color:css(P.ash,0.8)});
    if(lt>3) type.writeLine('分形维 D', W*0.5, 130, {anchor:'center',size:42,color:css(P.signal,smoothstep(3,4,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.014,vignette:0.4};
  },
});