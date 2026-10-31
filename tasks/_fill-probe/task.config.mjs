import { seq, cut } from '../../src/timeline.js';
import probe from './scenes/probe.js';

export default {
  title: 'fill probe（填充面的 alpha 账）', width: 1920, height: 1080, fps: 60, scale: 1,
  timeline: seq([cut(probe, { dur: 2, focus: 'center' })]),
};