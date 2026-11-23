// @ts-check
/** 01 · hook —— 方井盖旋转竖起对角线掉进井口 + zoom punch。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css, TAU } from '../../../src/core/util.js';
import { safeZoom } from '../../_shared/zoom.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
const CX=960, CY=520, HOLE=300, LID=290; // 井口边长300，盖边长290（平放卡住）
export default makeShot('hook',{
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    // 0-1.5s 平放；1.5s 起旋转45°（对角线竖直）+ 掉入
    const rot=smoothstep(1.5,2.3,lt)*Math.PI/4;
    const drop=smoothstep(2.0,2.8,lt)*180; // 掉入位移
    const zt=sat((lt-2.3)/0.6);
    const {zoom,anchor}=safeZoom(W,H,[CX-HOLE/2-40,CY-HOLE/2-40,HOLE+80,HOLE+220],1+1.6*smoothstep(0,1,zt));
    ctx.setXform({scale:zoom,anchor});
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    // 井口（暗框）
    lines.rect(CX-HOLE/2,CY-HOLE/2,HOLE,HOLE,3,withAlpha(P.ash,0.9));
    lines.fillRect(CX-HOLE/2,CY-HOLE/2,HOLE,HOLE,withAlpha(P.graphite,0.18));
    // 方盖（旋转 + 掉落）
    const cs=Math.cos(rot),sn=Math.sin(rot); const hw=LID/2;
    const corners=[[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]].map(([x,y])=>[CX+x*cs-y*sn, CY+x*sn+y*cs+drop]);
    for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4];lines.seg(a[0],a[1],b[0],b[1],3,withAlpha(P.bone,0.95));}
    // 对角线高亮（旋转后比井口宽）
    if(rot>0.2){ const da=smoothstep(1.8,2.3,lt); lines.seg(corners[0][0],corners[0][1],corners[2][0],corners[2][1],2,withAlpha(P.signal,da)); }
    lines.flush(ctx.out);
    text.clear();
    if(lt>2.0) type.writeLine('会掉', CX, CY-220, {anchor:'center',size:48,color:css(P.signal,smoothstep(2.0,2.6,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});