import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createFlightPath, DURATION, flightProgress, stageDepth,
} from '../tasks/_lens-travel/scenes/flight.js';

const route = createFlightPath(THREE);
const eye = new THREE.Vector3();
let previousZ = Infinity;
let smallestGap = Infinity;
let smallestClearance = Infinity;
const passed = new Set();
const steps = DURATION * 1000;
for (let sample = 0; sample <= steps; sample++) {
  const time = sample / 1000;
  route.getPointAt(flightProgress(time), eye);
  assert.ok(Number.isFinite(eye.length()), 'Camera position must stay finite');
  assert.ok(eye.z <= previousZ + 1e-7, 'Camera must keep travelling toward the sensor');
  previousZ = eye.z;
  for (let ring = 0; ring < 7; ring++) {
    const depth = stageDepth(ring, time);
    if (ring < 6) {
      const gap = depth - stageDepth(ring + 1, time);
      smallestGap = Math.min(smallestGap, gap);
      // Housing, bevel and front lip occupy .45 units along the optical axis.
      assert.ok(gap >= .50, 'Neighbouring housings must stay separated during stagger');
    }
    if (Math.abs(eye.z - depth) < .45) {
      const clearance = 1.28 - Math.hypot(eye.x, eye.y);
      smallestClearance = Math.min(smallestClearance, clearance);
      assert.ok(clearance > .5, 'Camera must travel through the bore with clearance');
      passed.add(ring);
    }
  }
}
assert.equal(passed.size, 7, 'Camera must traverse all seven rings');
assert.equal(flightProgress(0), 0);
assert.equal(flightProgress(DURATION), 1);
assert.ok(eye.z > -24, 'Camera must stop in front of the sensor');
console.log('PASS lens flight: ' + (steps + 1) + ' poses, seven bores, min gap '
  + smallestGap.toFixed(3) + ', min clearance ' + smallestClearance.toFixed(3));

