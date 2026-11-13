import { phase } from '../../../src/kit/action-motion.js';

export const DURATION = 9;

export function createFlightPath(THREE) {
  return new THREE.CatmullRomCurve3([
    [7.8, 3.4, 10], [3.9, 1.45, 7], [.30, .1, 3],
    [.32, .18, -3], [-.28, .08, -10], [.23, -.1, -16], [.05, 0, -20.9],
  ].map(point => new THREE.Vector3(...point)), false, 'centripetal');
}

export const flightProgress = time => phase(time, 0, DURATION);
export const stageOpening = (index, time) => phase(time, .65 + index * .075, 2.35 + index * .075);
export function stageDepth(index, time) {
  // Accumulate each opened gap so a delayed rear ring cannot catch its neighbour.
  let depth = -index * .52;
  for (let gap = 1; gap <= index; gap++) {
    depth -= 2.58 * stageOpening(gap, time);
  }
  return depth;
}

