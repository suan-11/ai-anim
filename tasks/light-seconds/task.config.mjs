import { cut, seq } from '../../src/timeline.js';
import travel from './scenes/travel.js';
export default {
  title: '光行', width: 1920, height: 1080, fps: 30, scale: 1,
  style: 'mg-lineart',
  timeline: seq([ cut(travel, { id: 'travel', dur: 20, world: false }) ]),
};
