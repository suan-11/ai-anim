import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { phase } from '../../../src/kit/action-motion.js';
import { DURATION, createFlightPath, flightProgress, stageDepth } from '../scenes/flight.js';

const directory = fileURLToPath(new URL('.', import.meta.url));
const wav = fileURLToPath(new URL('travel.wav', import.meta.url));
const mp3 = fileURLToPath(new URL('travel.mp3', import.meta.url));
const rate = 44100;
const count = Math.round(DURATION * rate);
const left = new Float32Array(count);
const right = new Float32Array(count);
const route = createFlightPath(THREE);
const crossings = Array.from({ length: 7 }, (_, index) => {
  let lo = 0, hi = DURATION;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const eye = route.getPointAt(flightProgress(mid));
    if (eye.z > stageDepth(index, mid)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
});
let seed = 7439;
let lowNoise = 0, air = 0;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2147483648 - 1;
};
for (let i = 0; i < count; i++) {
  const t = i / rate;
  const bed = phase(t, 0, .35) * (1 - phase(t, 7.9, DURATION));
  lowNoise += .025 * (random() - lowNoise);
  air += .16 * (random() - air);
  const travel = phase(t, 2.3, 4.5) * (1 - phase(t, 6.8, 8.3));
  const tone = .026 * Math.sin(2 * Math.PI * 68 * t)
    + .011 * Math.sin(2 * Math.PI * 102 * t);
  const ambient = (tone + lowNoise * (.08 + travel * .22)) * bed;
  left[i] = right[i] = ambient;
  for (let index = 0; index < crossings.length; index++) {
    const age = t - crossings[index];
    const whoosh = Math.exp(-(((age + .025) / .15) ** 2));
    const bass = Math.sin(2 * Math.PI * (92 + index * 7) * age);
    const pan = index % 2 ? .26 : -.26;
    const pass = whoosh * (.13 * air + .016 * bass) * bed;
    left[i] += pass * (1 - pan);
    right[i] += pass * (1 + pan);
  }
  const release = Math.exp(-(((t - 1.25) / .45) ** 2));
  left[i] += release * lowNoise * .14;
  right[i] += release * lowNoise * .14;
  const arrival = Math.max(0, t - 7.65);
  const settle = t > 7.65 ? Math.exp(-arrival * 4) * Math.sin(2 * Math.PI * 204 * arrival) * .014 : 0;
  left[i] += settle;
  right[i] += settle;
}
const data = Buffer.alloc(44 + count * 4);
data.write('RIFF', 0); data.writeUInt32LE(36 + count * 4, 4);
data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 4, 28);
data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
data.write('data', 36); data.writeUInt32LE(count * 4, 40);
for (let i = 0; i < count; i++) {
  data.writeInt16LE(Math.round(Math.tanh(left[i] * 2) * 32767), 44 + i * 4);
  data.writeInt16LE(Math.round(Math.tanh(right[i] * 2) * 32767), 46 + i * 4);
}
mkdirSync(directory, { recursive: true });
writeFileSync(wav, data);
const result = spawnSync(process.env.ANIM_FFMPEG || 'ffmpeg', [
  '-y', '-v', 'error', '-i', wav, '-af', 'loudnorm=I=-18:TP=-1.5:LRA=9',
  '-ar', String(rate), '-c:a', 'libmp3lame', '-b:a', '192k', mp3,
], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Audio encoding failed');
unlinkSync(wav);
console.log('Generated travel.mp3. Ring crossings at ' + crossings.map(t => t.toFixed(3)).join(', ') + ' seconds.');

