// @ts-check
import { mixColor } from '../core/util.js';
import { phase, cascadePose } from '../kit/action-motion.js';
import { setupStage, stageFrame, core, label, finishStage, describe } from './action-stage.js';

const DEFAULTS = { id: 'cascade', kicker: 'CAUSE / 因果', title: '一次触碰，层层传递', label: '传递完成', count: 7 };
export function cascadeShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  cascadePose(0, o.count); // Validate at construction, before launching the browser.
  return {
    id: o.id, focus: 'center',
    setup(ctx) { this.bg = setupStage(ctx); },
    render(ctx) {
      const F = stageFrame(ctx, this.bg), { W, H, cx, cy, r } = F;
      const { lines, P, text, f } = ctx;
      const p = f.p, pose = cascadePose(p, o.count), { travel, gather, anticipation } = pose;
      const spread = phase(p, .01, .17) * (1-gather);
      const L = F.pad + W * .045, R = W-F.pad-W*.045;
      const headX = cx + (L - cx) * phase(p, .015, .16) + (R-L) * travel;
      const orbX = headX + (cx-headX) * gather;
      const orbR = r * (1 - .70 * phase(p,.025,.16)) * (1-gather) + r*gather;
      const h = Math.min(H*.19, W*.14), bw = Math.min(W*.023, H*.041);
      text.clear(); lines.begin();
      lines.seg(L, cy+h*.67, R, cy+h*.67, 1.5, mixColor(P.ink,P.bone,.14));
      pose.contacts.forEach((v,i) => {
        const x = cx + (L+(R-L)*i/(o.count-1)-cx)*spread;
        const angle = v.response * 1.05 + v.kick * .18;
        const height = h * spread;
        const pivot = [x, cy+h*.55];
        const rotate = (dx,dy) => [pivot[0]+dx*Math.cos(angle)-dy*Math.sin(angle), pivot[1]+dx*Math.sin(angle)+dy*Math.cos(angle)];
        const pts = [[-bw/2,0],[bw/2,0],[bw/2,-height],[-bw/2,-height]].map(([a,b])=>rotate(a,b));
        if (spread>.001) lines.fillPoly(pts, mixColor(P.ink, v.hit?P.signal:P.bone, v.hit?.72:.20), 2);
        // Contact rings are born at the scheduled contact, not from a repeating sine.
        const age = (p-v.at)*6;
        if (age>0 && age<.45 && gather<1) lines.circle(x,cy, r*(.16+age*.95), 2, [...P.signal,(1-age/.45)*(1-gather)],48);
      });
      // Stretched head and short spatial trail during transfer, compression before departure.
      const speed = Math.max(0, Math.sin(travel*Math.PI));
      if (p>.18 && p<.70) {
        for(let i=4;i>0;i--) core(lines, orbX-i*r*.18, cy, orbR*(1-i*.12), { ...P, signal: mixColor(P.ink,P.signal,.13+(4-i)*.08) });
      }
      core(lines,orbX-anticipation*r*.12,cy,Math.max(1,orbR),P,1-anticipation*.20+speed*.20,1+anticipation*.20-speed*.12);
      lines.circle(cx,cy,r*1.35,1.5,[...mixColor(P.ink,P.bone,.24),gather],96);
      lines.flush(ctx.out);
      label(ctx,o.label,cx,cy+r*2.02,phase(p,.79,.96),Math.min(H*.030,W*.034),{mode:'trace'});
      return finishStage(ctx,o,F,phase(p,.18,.39));
    },
  };
}
describe(cascadeShot,DEFAULTS,{name:'cascade',summary:'核心蓄力出发，接触逐根触发翻倒与冲击环，末端重新聚拢为核心。',use:'连锁反应、信号传递、前因后果',energy:'中高',avoid:'节点名称很长的流程图；精确数据展示'},{count:'参与碰撞的叶片数，整数 3..12'});
