// @ts-check
/** 渲各片注意力折线图（实测A vs 目标T + 节奏块色带）。node scripts/render-attention-charts.mjs */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const ROOT=process.cwd();
const films=['benford','manhole','coastline','tube-map','paperfold'];
function visualAttention(row){ if(!Number.isFinite(row.strength)||row.strength<0)return null; const e=row.strength/(row.strength+8); const c=row.concentration??0; if(!Number.isFinite(c)||c<0||c>1)return null; return 0.75*e+0.25*c; }
function expected(t,ev){ if(t<3)return t<1?0.44+t*0.38:0.82-(t-1)*0.12; const u=(t-ev.start)/(ev.end-ev.start); switch(ev.role){case 'pressure':return 0.34+0.27*u;case 'hold':return 0.60;case 'release':return 0.80;case 'residue':return 0.56-0.26*u;} return 0.5; }
for(const film of films){
  const a=JSON.parse(readFileSync(path.join(ROOT,'out',film,'attention','attention.json'),'utf8'));
  const events=a.events??[]; const dur=a.duration;
  const evAt=t=>events.find(e=>t>=e.start&&t<e.end)??events[events.length-1];
  // 采样曲线点
  const pts=a.samples.map(s=>({t:s.t,A:visualAttention(s),T:expected(s.t,evAt(s.t)),role:s.role})).filter(p=>p.A!==null);
  // 写曲线数据 json 供场景读
  const dir=path.join(ROOT,'tasks','_attn-chart',film);
  mkdirSync(dir,{recursive:true});
  writeFileSync(path.join(dir,'curve.json'),JSON.stringify({film,dur,events,pts}));
}
console.log('curve data written for',films.length,'films');
