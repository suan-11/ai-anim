import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const folder = fileURLToPath(new URL('.', import.meta.url));
const wav = fileURLToPath(new URL('moves.wav', import.meta.url));
const mp3 = fileURLToPath(new URL('moves.mp3', import.meta.url));
const rate = 44100;
const duration = 26.9;
const samples = Math.round(rate * duration);
const left = new Float32Array(samples);
const right = new Float32Array(samples);
let seed = 1937;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2147483648 - 1;
};

const events = [0.12, 2.1, 4.8, 6.0, 9.5, 13.7, 17.6, 20.0, 23.2, 25.8];
for (let i = 0; i < samples; i++) {
  const t = i / rate;
  const bed = Math.min(1, t / .4) * Math.min(1, Math.max(0, (duration - t) / .8));
  const drift = Math.sin(2 * Math.PI * 52 * t) * .012 + Math.sin(2 * Math.PI * 79 * t) * .007;
  const air = random() * .006;
  left[i] = right[i] = (drift + air) * bed;
  for (let e = 0; e < events.length; e++) {
    const age = t - events[e];
    const hit = Math.exp(-(((age + .02) / (e % 3 === 0 ? .18 : .105)) ** 2));
    const tone = Math.sin(2 * Math.PI * (88 + e * 9) * age) * .018;
    const pan = e % 2 ? .24 : -.24;
    left[i] += hit * (tone + .04) * (1 - pan);
    right[i] += hit * (tone + .04) * (1 + pan);
  }
}
const data = Buffer.alloc(44 + samples * 4);
data.write('RIFF', 0); data.writeUInt32LE(36 + samples * 4, 4);
data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 4, 28);
data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
data.write('data', 36); data.writeUInt32LE(samples * 4, 40);
for (let i = 0; i < samples; i++) {
  data.writeInt16LE(Math.round(Math.tanh(left[i] * 2.2) * 32767), 44 + i * 4);
  data.writeInt16LE(Math.round(Math.tanh(right[i] * 2.2) * 32767), 46 + i * 4);
}
mkdirSync(folder, { recursive: true });
writeFileSync(wav, data);
const result = spawnSync(process.env.ANIM_FFMPEG || 'ffmpeg', [
  '-y', '-v', 'error', '-i', wav, '-af', 'loudnorm=I=-18:TP=-1.5:LRA=9',
  '-ar', String(rate), '-c:a', 'libmp3lame', '-b:a', '160k', mp3,
], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Audio encoding failed');
unlinkSync(wav);
console.log('Generated moves.mp3 at ' + duration + ' seconds.');
