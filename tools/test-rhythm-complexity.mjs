// @ts-check
/** rhythm-complexity 纯函数单测（复杂度/重复度 v0.2）。 */
import { frameComplexity, hotspotDiversity, complexityScore, frameRepetition, sequenceRepetition, repetitionScore, evaluateComplexityRepetition } from '../scripts/lib/rhythm-complexity.mjs';
let pass=0, fail=0;
const ok=(name,cond)=>{ if(cond){pass++;} else {fail++;console.log('FAIL:',name);} };
// frameComplexity：concentration 高→简单（低分），低→复杂（高分）
ok('fc-high-conc-low', frameComplexity({strength:20,concentration:0.9}) < frameComplexity({strength:20,concentration:0.2}));
ok('fc-null', frameComplexity({strength:20,concentration:null}) === null);
ok('fc-range', (()=>{const v=frameComplexity({strength:30,concentration:0.5});return v>=0&&v<=1;})());
// hotspotDiversity：位移大→高
const still=[{hotspot:{x:0.5,y:0.5}},{hotspot:{x:0.5,y:0.5}}];
const move=[{hotspot:{x:0.1,y:0.1}},{hotspot:{x:0.9,y:0.9}}];
ok('hd-still-low', hotspotDiversity(still) < 0.05);
ok('hd-move-high', hotspotDiversity(move) > 0.5);
// complexityScore 范围 + 字段
const cs=complexityScore([{strength:20,concentration:0.5,hotspot:{x:0.5,y:0.5}}],[{info_density:3}]);
ok('cs-range', cs.score>=0&&cs.score<=100);
ok('cs-fields', typeof cs.meanDispersion==='number'&&typeof cs.hotspotDiversity==='number');
// frameRepetition：相同帧→高重复，变化帧→低
const same=[{strength:20,concentration:0.5,hotspot:{x:0.5,y:0.5}},{strength:20,concentration:0.5,hotspot:{x:0.5,y:0.5}}];
const diff=[{strength:5,concentration:0.9,hotspot:{x:0.1,y:0.1}},{strength:35,concentration:0.1,hotspot:{x:0.9,y:0.9}}];
ok('fr-same-high', frameRepetition(same) > 0.9);
ok('fr-diff-low', frameRepetition(diff) < 0.3);
// sequenceRepetition：循环序列→高，单调→低
const loop=[{intensity:2,info_density:1},{intensity:4,info_density:3},{intensity:2,info_density:1},{intensity:4,info_density:3}];
const mono=[{intensity:1,info_density:1},{intensity:2,info_density:2},{intensity:3,info_density:3},{intensity:4,info_density:4}];
ok('sr-loop-high', sequenceRepetition(loop) > 0.5);
ok('sr-mono-low', sequenceRepetition(mono) < 0.3);
ok('sr-short', sequenceRepetition([{intensity:1}]) === 0);
// repetitionScore 范围
const rs=repetitionScore(same,loop);
ok('rs-range', rs.score>=0&&rs.score<=100);
ok('rs-fields', typeof rs.frameRepetition==='number'&&typeof rs.sequenceRepetition==='number');
// evaluateComplexityRepetition 综合
const ev=evaluateComplexityRepetition({samples:same,events:loop});
ok('ev-both', ev.complexity&&ev.repetition&&typeof ev.complexity.score==='number');
console.log(`rhythm-complexity: ${pass} pass / ${fail} fail`);
process.exit(fail?1:0);
