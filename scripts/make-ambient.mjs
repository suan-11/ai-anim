#!/usr/bin/env node
// @ts-check
/** 生成氛围铺底音乐（柔和 pad，无鼓点，适合科普讲解）。node scripts/make-ambient.mjs [out] [seconds] */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const out = process.argv[2] ?? 'ambient.wav';
const seconds = Number(process.argv[3] ?? 50);
const sr = 44100; const n = Math.round(seconds*sr);
const L = new Float32Array(n), R = new Float32Array(n);
let seed = 0xabcdef; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
// 和弦进行（频率 Hz，柔和小调）：Am - F - C - G 循环，每和弦 8s
const chords = [
  [220.0, 261.6, 329.6], // Am
  [174.6, 220.0, 261.6], // F
  [196.0, 261.6, 329.6], // C (G bass)
  [196.0, 246.9, 293.7], // G
];
const chordDur = 8;
for(let i=0;i<n;i++){
  const t=i/sr;
  const ci=Math.floor(t/chordDur)%chords.length;
  const cf=(t%chordDur)/chordDur;
  // 和弦交叉淡化（前后和弦 smoothstep 过渡）
  const chord=chords[ci], next=chords[(ci+1)%chords.length];
  const mix=cf>0.8?(cf-0.8)/0.2:0;
  let s=0;
  for(let v=0;v<3;v++){
    const f0=chord[v], f1=next[v];
    const f=f0+(f1-f0)*mix;
    // 柔和正弦 + 轻微颤音 + 泛音
    const vib=1+0.003*Math.sin(t*0.5+v);
    s+=Math.sin(2*Math.PI*f*vib*t)*0.12;
    s+=Math.sin(2*Math.PI*f*2*t)*0.03; // 八度泛音
    s+=Math.sin(2*Math.PI*f*0.5*t)*0.06; // 低八度
  }
  // 缓慢音量呼吸
  const env=0.7+0.3*Math.sin(t*0.1);
  s*=env*0.5;
  // 立体声微差
  L[i]=s*(0.9+0.1*Math.sin(t*0.3));
  R[i]=s*(0.9+0.1*Math.cos(t*0.3));
}
// 淡入淡出
const fade=Math.round(sr*2);
for(let i=0;i<fade;i++){ const g=i/fade; L[i]*=g;R[i]*=g; L[n-1-i]*=g;R[n-1-i]*=g; }
// 写 WAV 16bit
const buf=Buffer.alloc(44+n*4);
buf.write('RIFF',0); buf.writeUInt32LE(36+n*4,4); buf.write('WAVE',8);
buf.write('fmt ',12); buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20); buf.writeUInt16LE(2,22);
buf.writeUInt32LE(sr,24); buf.writeUInt32LE(sr*4,28); buf.writeUInt16LE(4,32); buf.writeUInt16LE(16,34);
buf.write('data',36); buf.writeUInt32LE(n*4,40);
for(let i=0;i<n;i++){ buf.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(L[i]*32767))),44+i*4); buf.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(R[i]*32767))),46+i*4); }
mkdirSync(path.dirname(out),{recursive:true});
writeFileSync(out,buf);
console.log('OK '+out+' '+seconds+'s ambient pad');
