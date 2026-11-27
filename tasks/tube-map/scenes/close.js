// @ts-check
/** 06 · close —— zoom out 回全景，拓扑图叠电路图意象回溯 Beck 1933。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { STATIONS, LINES, LINE_COLORS, byId, pos } from './_net.js';
import { sat, smoothstep, css, hexToLinear } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
import { rhythmDrive } from '../../_shared/rhythm-drive.js';
const LC = LINE_COLORS.map(hexToLinear);
export default makeShot('close', {
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt=f.lt/(ctx.params?.stretch??1);
    // 方案2接线：段横跨 residue[52,57)+residue[57,61.2)。
    // zoom out 在首块缓落；电路意象在末块（f.t≥57）淡入收束——结尾不归零。
    const rd=rhythmDrive(f);
    const zoom = 1.8 - 0.8*smoothstep(0,0.7,sat(lt/5.4));
    ctx.setXform({ scale: zoom, anchor: [W/2,H/2] });
    // 电路图叠合度（末块 58-60s 淡入电路意象）
    const circuit = smoothstep(58,60,f.t);
    const dim=Math.max(0.5, 0.7+0.3*rd.k);           // residue 缓降亮度底
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    for (let li=0; li<LINES.length; li++) { const ids=LINES[li];
      for (let i=1;i<ids.length;i++){ const a=pos(byId(ids[i-1]),1,W,H), b=pos(byId(ids[i]),1,W,H);
        // 电路意象：线变细白 + 节点方框
        const col = circuit>0.5 ? withAlpha(P.bone,0.7*dim) : withAlpha(LC[li],0.85*dim);
        lines.seg(a[0],a[1],b[0],b[1],2.5,col); } }
    for (const st of STATIONS){ const p=pos(st,1,W,H);
      if(circuit>0.5){ lines.rect(p[0]-6,p[1]-6,12,12,2,withAlpha(P.bone,0.8*dim)); } // 电路节点方框
      else if(st.hub){lines.circle(p[0],p[1],10,3,withAlpha(P.bone,dim));lines.circle(p[0],p[1],4,2,withAlpha(P.ink,1));}
      else lines.circle(p[0],p[1],5,2,withAlpha(P.bone,0.9*dim)); }
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('1933 · Harry Beck', W*0.5, H-90, {anchor:'center',size:40,color:css(P.bone,smoothstep(58.5,60,f.t)*dim)});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:0,bloomBase:0.1});
  },
});