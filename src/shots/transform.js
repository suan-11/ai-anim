// @ts-check
import { mixColor } from '../core/util.js';
import { phase, contourPoint } from '../kit/action-motion.js';
import { setupStage, stageFrame, core, label, finishStage, describe } from './action-stage.js';

const DEFAULTS = { id: 'transform', kicker: 'TRANSFORM / 变形', title: '同一个物体，换一种状态', label: '圆环 · 波带 · 方形', turns: 2 };
export function transformShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!Number.isFinite(o.turns) || o.turns<1 || o.turns>4) throw new Error('transform: turns 必须在 1..4 内');
  return {
    id:o.id, focus:'center',
    setup(ctx) { this.bg=setupStage(ctx); },
    render(ctx) {
      const F=stageFrame(ctx,this.bg),{cx,cy,r,H,W}=F;
      const {lines,P,text,f}=ctx, p=f.p;
      const expand=phase(p,.015,.13), restore=phase(p,.86,1);
      const opened = expand * (1-restore);
      const radius=r*(.5+1.22*opened);
      text.clear(); lines.begin();
      // A thick closed stroke opens into a ribbon. Constant normal width avoids radial-hole
      // intersections when the contour bends into a wave (which used to leave gaps in the ink).
      const contour=Array.from({length:128},(_,i)=>{
        const [x,y]=contourPoint(i/128,p,o.turns);
        return [cx+x*radius,cy+y*radius];
      });
      lines.polyline(contour,r*(1-opened)+H*.014*opened,P.signal,true);
      lines.circle(cx,cy,r*1.35,1.5,[...mixColor(P.ink,P.bone,.24),1-opened],96);
      // Material ribs make point correspondence visible during the transformation.
      for(let i=0;i<24;i++) {
        const u=i/24, [x,y]=contourPoint(u,p,o.turns);
        const a=.55+ .40*phase(p,.08,.30)*(1-phase(p,.80,1));
        const dx=x*radius,dy=y*radius;
        const near=contourPoint(u+1/1024,p,o.turns);
        const tx=near[0]-x,ty=near[1]-y,len=Math.hypot(tx,ty)||1;
        const nx=ty/len,ny=-tx/len;
        lines.seg(cx+dx-nx*H*.020,cy+dy-ny*H*.020,cx+dx+nx*H*.012,cy+dy+ny*H*.012,Math.max(1,H*.0015),[...mixColor(P.signal,P.bone,.65),a*opened]);
      }
      // After closing, exactly the same central core is ready for the next shot.
      if(p>=1) core(lines,cx,cy,r,P);
      lines.flush(ctx.out);
      label(ctx,o.label,cx,F.bottom-H*.01,phase(p,.36,.59),Math.min(H*.030,W*.034));
      return finishStage(ctx,o,F,phase(p,.11,.32));
    },
  };
}
describe(transformShot,DEFAULTS,{name:'transform',summary:'同一条闭合轮廓从圆环拉成波带，再撑成方形，最后收回核心；点与材质刻线保持对应。',use:'结构变化、状态转换、同一对象的不同形态',energy:'中',avoid:'不同对象之间的淡入淡出；图表数据请用 morph'},{turns:'波带弯折次数，1..4'});
