#!/usr/bin/env node
// @ts-check
/** 温暖氛围铺底（失谐pad+低通+慢包络+混响，去示波器感）。node scripts/make-ambient.mjs [out] [seconds] */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const out = process.argv[2] ?? 'ambient.wav';
const seconds = Number(process.argv[3] ?? 50);
const sr = 44100; const n = Math.round(seconds*sr);
const L = new Float32Array(n), R = new Float32Array(n);
let seed = 0xabcdef; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
// 温暖和弦（大七/挂留，柔和）：Cmaj7 - Am7 - Fmaj7 - Gsus，每和弦 10s
const chords = [
  [130.8, 164.8, 196.0, 246.9], // Cmaj7 (C E G B)
  [110.0, 130.8, 164.8, 196.0], // Am7
  [87.31, 130.8, 164.8, 220.0], // Fmaj7
  [98.0, 146.8, 196.0, 261.6],  // Gsus-ish
];
const chordDur = 10;
// 一阶低通滤波系数（截止~800Hz，去高频刺耳）
const lpA = 1 - Math.exp(-2*Math.PI*800/sr);
let lpL=0, lpR=0;
// 简单混响延迟线（~120ms + 反馈）
const dlyN = Math.round(sr*0.12); const dlyL=new Float32Array(dlyN), dlyR=new Float32Array(dlyN); let dlyI=0;
for(let i=0;i<n;i++){
  const t=i/sr;
  const ci=Math.floor(t/chordDur)%chords.length;
  const cf=(t%chordDur)/chordDur;
  const chord=chords[ci], next=chords[(ci+1)%chords.length];
  const mix=cf>0.85?(cf-0.85)/0.15:0;
  const smix=mix*mix*(3-2*mix);
  let sL=0, sR=0;
  for(let v=0;v<chord.length;v++){
    const f0=chord[v], f1=next[v];
    const f=f0+(f1-f0)*smix;
    // 失谐合唱：3个微失谐振荡器（±0.3%），制造温暖厚度
    for(let d=-1;d<=1;d++){
      const detune=1+d*0.003;
      const ph=2*Math.PI*f*detune*t + v*0.7 + d*1.3;
      // 三角波（比正弦柔和丰富）+ 少量二次谐波
      const tri=Math.asin(Math.sin(ph))*(2/Math.PI);
      const osc=tri*0.7 + Math.sin(ph*2)*0.1;
      const pan=0.5+d*0.2+v*0.05;
      sL+=osc*(1-pan)*0.08;
      sR+=osc*pan*0.08;
    }
  }
  // 慢 attack/release 包络（每和弦淡入淡出，不像持续beep）
  const env=Math.sin(Math.PI*Math.min(1,cf*1.1))**0.5 * (0.75+0.25*Math.sin(t*0.07));
  sL*=env; sR*=env;
  // 低通滤波（去高频）
  lpL+=lpA*(sL-lpL); lpR+=lpA*(sR-lpR);
  // 混响（延迟反馈0.3）
  const dl=lpL+dlyL[dlyI]*0.3, dr=lpR+dlyR[dlyI]*0.3;
  dlyL[dlyI]=dl*0.5; dlyR[dlyI]=dr*0.5; dlyI=(dlyI+1)%dlyN;
  L[i]=dl; R[i]=dr;
}
// 淡入淡出 3s
const fade=Math.round(sr*3);
for(let i=0;i<fade;i++){ const g=i/fade; L[i]*=g;R[i]*=g; L[n-1-i]*=g;R[n-1-i]*=g; }
// 归一化到 0.5 峰值
let pk=0; for(let i=0;i<n;i++) pk=Math.max(pk,Math.abs(L[i]),Math.abs(R[i]));
const norm=0.5/Math.max(1e-6,pk);
const buf=Buffer.alloc(44+n*4);
buf.write('RIFF',0); buf.writeUInt32LE(36+n*4,4); buf.write('WAVE',8);
buf.write('fmt ',12); buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20); buf.writeUInt16LE(2,22);
buf.writeUInt32LE(sr,24); buf.writeUInt32LE(sr*4,28); buf.writeUInt16LE(4,32); buf.writeUInt16LE(16,34);
buf.write('data',36); buf.writeUInt32LE(n*4,40);
for(let i=0;i<n;i++){ buf.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(L[i]*norm*32767))),44+i*4); buf.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(R[i]*norm*32767))),46+i*4); }
mkdirSync(path.dirname(out),{recursive:true});
writeFileSync(out,buf);
console.log('OK '+out+' '+seconds+'s warm ambient');
