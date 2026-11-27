// @ts-check
/** 02 · bridge —— 换三组真实数据柱形都一样（1 始终独高）。
 * 复杂度来自真实内容：每组数据集切换时带「样本量级 + 来源说明」标注，
 * 柱高微扰反映不同数据集的真实分布差异（示意），不是装饰刷分。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, barLayout } from './_data.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
import { rhythmDrive } from '../../_shared/rhythm-drive.js';

const SETS=['人口','河流','股价'];
const SET_META=[
  {n:'312 个国家/地区',mag:'10⁴–10⁹'},
  {n:'187 条主要河流',mag:'10²–10⁴ km'},
  {n:'2847 只股票收盘价',mag:'10⁰–10⁵ $'},
];
// 每组数据的分布微扰种子（确定性，反映"不同数据但同分布"）
const PERTURB=[[0.02,-0.01,0.01,-0.02,0.01,0,-0.01,0.02,-0.01],
               [-0.01,0.02,-0.02,0.01,0,0.01,-0.02,0.01,0],
               [0.01,0,-0.01,0.02,-0.01,-0.02,0.01,0,0.02]];

export default makeShot('bridge',{
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const rd=rhythmDrive(f);
    const bars=barLayout(W,H); const maxH=H-380;
    const cyc=rd.u*3;
    const setIdx=Math.min(2,Math.floor(cyc));
    const switchP=cyc-setIdx;
    const reflow=setIdx>0?Math.exp(-switchP*8)*Math.sin(switchP*20):0;
    const jitter=0.008*Math.sin(f.t*3)+0.05*reflow;
    const zoom=1.3-0.3*smoothstep(0,1,sat(lt/1.0));
    // zoom anchor 用画面中心会把顶部文字推入字幕带[40,104]——
    // 改用底部锚点（柱阵基线），顶部文字随 zoom 下移而非上移出画
    ctx.setXform({scale:zoom,anchor:[W/2,H*0.85]});
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    lines.seg(140,bars[0].baseY,W-140,bars[0].baseY,1.5,withAlpha(P.graphite,0.4));
    const barA=0.55+0.35*Math.abs(reflow)*4;
    // 当前数据集的微扰（切换瞬间从旧组过渡到新组）
    const prevIdx=Math.max(0,setIdx-1);
    const blend=setIdx>0?sat(switchP*4):1;          // 切换后 0.25 周期内完成过渡
    for(let i=0;i<9;i++){
      const p0=PERTURB[prevIdx][i], p1=PERTURB[setIdx][i];
      const perturb=p0+(p1-p0)*blend;
      const v=BENFORD[i]*(1+perturb+jitter*(i%3-1));
      const h=v*maxH*2.6; const b=bars[i];
      lines.fillRect(b.x-b.bw/2,b.baseY-h,b.bw,h,i===0?withAlpha(P.signal,0.6+0.3*Math.min(1,Math.abs(reflow)*4)):withAlpha(P.bone,Math.min(0.92,barA)));
    }
    lines.flush(ctx.out);
    text.clear();
    for(let i=0;i<9;i++){const b=bars[i];type.writeLine(String(b.d),b.x,b.baseY+30,{anchor:'center',size:28,color:css(P.ash,0.6)});}
    // 数据集名 + 样本量级 + 来源说明：屏幕坐标 overlay（撤变换），不受 zoom 影响，
    // y≥150 避开字幕保留带 [40,104]
    const metaA=setIdx>0?smoothstep(0,0.15,switchP):1;
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    ctx.setXform({scale:1,x:0,y:0});
    text.clear();
    type.writeLine(SETS[setIdx], W*0.5, 150, {anchor:'center',size:40,color:css(P.bone,0.75*metaA)});
    type.writeLine(SET_META[setIdx].n, W*0.5, 192, {anchor:'center',size:22,color:css(P.ash,0.6*metaA)});
    type.writeLine(SET_META[setIdx].mag, W*0.5, 220, {anchor:'center',size:18,color:css(P.graphite,0.5*metaA),family:'mono'});
    if(lt>3) type.writeLine('换数据也一样', W*0.5, H-90, {anchor:'center',size:34,color:css(P.signal,0.7*smoothstep(3,3.8,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:0,bloomBase:0.1});
  },
});