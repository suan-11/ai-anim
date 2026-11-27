// @ts-check
/** 分析外部视频的注意力曲线（ffmpeg抽帧 + measureAttention）。
 * node scripts/analyze-video-attention.mjs <video.mp4> <out.json> [step] */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { measureAttention, reduceAttentionFrame } from '../src/core/attention.js';
const video=process.argv[2], out=process.argv[3]??'attn.json', step=Number(process.argv[4]??0.5);
const dur=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',video]).toString().trim());
// ffmpeg 抽帧为 raw RGBA（降采样长边192，与引擎一致）
const W=192, H=108; // 16:9 近似
const tmp=path.join(os.tmpdir(),'vattn_'+Date.now()+'.raw');
execFileSync('ffmpeg',['-v','error','-i',video,'-vf',`fps=1/${step},scale=${W}:${H}`,'-f','rawvideo','-pix_fmt','rgba','-y',tmp]);
const buf=readFileSync(tmp); unlinkSync(tmp);
const frameBytes=W*H*4; const nFrames=Math.floor(buf.length/frameBytes);
const samples=[]; let prev=null;
for(let i=0;i<nFrames;i++){
  const rgba=new Uint8ClampedArray(buf.subarray(i*frameBytes,(i+1)*frameBytes));
  const frame={width:W,height:H,rgba};
  const m=measureAttention(frame,{previous:prev,focus:null});
  prev=frame;
  const t=i*step;
  const energy=m.strength/(m.strength+8);
  const A=m.concentration!==null?0.75*energy+0.25*m.concentration:null;
  samples.push({t,strength:m.strength,concentration:m.concentration,A});
}
const report={schema:'video.attention/1',video:path.basename(video),duration:dur,step,samples};
mkdirSync(path.dirname(out),{recursive:true});
writeFileSync(out,JSON.stringify(report,null,2));
// 统计
const valid=samples.filter(s=>s.A!==null);
const mean=valid.reduce((a,s)=>a+s.A,0)/valid.length;
const max=Math.max(...valid.map(s=>s.A)), min=Math.min(...valid.map(s=>s.A));
// 前3s钩子
const hook=samples.filter(s=>s.t<3&&s.A!==null);
const hookPeak=Math.max(...hook.map(s=>s.A));
console.log(`${path.basename(video)}: ${dur.toFixed(0)}s ${nFrames}帧 | A均值${mean.toFixed(2)} 峰${max.toFixed(2)} 谷${min.toFixed(2)} 落差${(max-min).toFixed(2)} | 前3s峰${hookPeak.toFixed(2)}`);
