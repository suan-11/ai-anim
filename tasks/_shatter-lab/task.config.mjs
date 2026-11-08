import { seq, cut } from '../../src/timeline.js';
import shatter from './scenes/shatter.js';

export default {
  title: '镜头级镜碎',
  width: 1920, height: 1080, fps: 60,
  style: 'print',
  timeline: seq([cut(shatter, { dur: 4 })]),
};
