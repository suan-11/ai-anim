#!/usr/bin/env node
// @ts-check
/** FL 采样循环铺底（ffmpeg 解码 raw PCM，稳）。node scripts/make-sample-bed.mjs <sample> <out.wav> <seconds> [mix2] */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const src=process.argv[2], out=process.argv[3]??'bed.wav', seconds=Number(process.argv[4]??50), src2=process.argv[5];
const sr=44100;
function decode(f){
  const tmp=path.join(os.tmpdir(),'bed_'+Math.round(performance.now())+'.raw');
  execFileSync('ffmpeg',['-v','error','-f','ogg','-i',f,'-ac','2','-ar',String(sr),'-f','f32le','-y',tmp]);
  const b=readFileSync(tmp); unlinkSync(tmp);
  const n=Math.floor(b.length/8);
  const L=new Float32Array(n),R=new Float32Array(n);
  for(let i=0;i<n;i++){L[i]=b.readFloatLE(i*8);R[i]=b.readFloatLE(i*8+4);}
  return {L,R,n};
}
const s1=decode(src), s2=src2?decode(src2):null;
const n=Math.round(seconds*sr);
const L=new Float32Array(n),R=new Float32Array(n);
const xf=Math.round(sr*1.5);
function layLoop(samp,gain){
  const sn=samp.n; if(sn<xf*2){ // 太短直接平铺
    for(let i=0;i<n;i++){const j=i%sn;L[i]+=samp.L[j]*gain;R[i]+=samp.R[j]*gain;} return;
  }
  let pos=0;
  while(pos<n){
    const segLen=Math.min(sn,n-pos);
    for(let i=0;i<segLen;i++){
      let g=gain;
      if(pos>0&&i<xf)g*=i/xf;
      L[pos+i]+=samp.L[i]*g; R[pos+i]+=samp.R[i]*g;
    }
    const step=sn-xf; if(step<=0)break; pos+=step;
  }
}
layLoop(s1,0.5); if(s2)layLoop(s2,0.3);
const fade=Math.round(sr*3);
for(let i=0;i<fade;i++){const g=i/fade;L[i]*=g;R[i]*=g;L[n-1-i]*=g;R[n-1-i]*=g;}
let pk=0;for(let i=0;i<n;i++)pk=Math.max(pk,Math.abs(L[i]),Math.abs(R[i]));
const norm=0.5/Math.max(1e-6,pk);
const buf=Buffer.alloc(44+n*4);
buf.write('RIFF',0);buf.writeUInt32LE(36+n*4,4);buf.write('WAVE',8);buf.write('fmt ',12);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(2,22);buf.writeUInt32LE(sr,24);buf.writeUInt32LE(sr*4,28);buf.writeUInt16LE(4,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(n*4,40);
for(let i=0;i<n;i++){buf.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(L[i]*norm*32767))),44+i*4);buf.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(R[i]*norm*32767))),46+i*4);}
mkdirSync(path.dirname(out),{recursive:true});writeFileSync(out,buf);
console.log('OK '+out+' '+seconds+'s from '+path.basename(src)+(src2?' + '+path.basename(src2):''));
