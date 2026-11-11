// @ts-check
// Action timing is normalized to the shot, so even a short shot reaches its final pose.
import { clamp, lerp, polylineLengths, pointAtLength } from '../core/util.js';

export const smooth = (p) => { const u = clamp(p); return u * u * u * (u * (u * 6 - 15) + 10); };
export const phase = (p, a, b) => smooth((p - a) / (b - a));

/** Material, leader and caption share one clock; the caption follows the leader. */
export function deconstructInspection(p) {
  const cue = (a, b, c, d, e) => {
    const leader = clamp(phase(p, a, b));
    const opacity = clamp(1 - phase(p, d, e));
    return { leader, label: clamp(phase(p, b, c)), opacity, focus: leader * opacity };
  };
  return { core: cue(.50,.52,.535,.585,.61), shell: cue(.61,.63,.645,.68,.70) };
}

/** Prefix of a leader at a fraction of its arc length, including its bend. */
export function traceLeader(points, progress) {
  const p = clamp(progress);
  if (p <= 0) return [];
  if (p >= 1) return points.map(point => [...point]);
  const acc = polylineLengths(points), distance = p * acc.at(-1);
  const prefix = points.filter((_, i) => acc[i] < distance);
  return [...prefix, pointAtLength(points, acc, distance).slice(0, 2)];
}

/** Analytic impulse: zero before contact, finite and continuous at contact, settles to zero. */
export function recoil(age, damping = 9, frequency = 18) {
  return age <= 0 ? 0 : Math.sin(age * frequency) * Math.exp(-age * damping);
}

/** One immutable contact schedule drives the moving head, each vane, and its text. */
export function cascadePose(p, count = 7) {
  if (!Number.isInteger(count) || count < 3 || count > 12) throw new Error('cascade: count 必须是 3..12 的整数');
  const travel = phase(p, 0.18, 0.70);
  const contacts = Array.from({ length: count }, (_, i) => {
    const location = i / (count - 1);
    // Invert smoothstep by bisection: contact is when the head actually reaches this vane.
    let lo = 0, hi = 1;
    for (let j = 0; j < 36; j++) {
      const mid = (lo + hi) / 2;
      if (smooth(mid) < location) lo = mid; else hi = mid;
    }
    const at = 0.18 + (lo + hi) * 0.26;
    return { at, hit: p >= at, response: phase(p, at, at + 0.075), kick: recoil((p - at) * 6) };
  });
  return { travel, contacts, gather: phase(p, 0.77, 0.96), anticipation: phase(p, 0.02, 0.15) * (1 - phase(p, 0.15, 0.19)) };
}

/** Closed contours use the same point correspondence throughout; never crossfade two shapes. */
export function contourPoint(u, p, turns = 3) {
  const a = u * Math.PI * 2 - Math.PI / 2;
  const c = [Math.cos(a), Math.sin(a)];
  const wave = [c[0] * 1.62, c[1] * 0.20 + Math.sin(c[0] * Math.PI * turns) * 0.35];
  const square = [Math.sign(c[0]) * Math.abs(c[0]) ** 0.38, Math.sign(c[1]) * Math.abs(c[1]) ** 0.38];
  const w = phase(p, 0.10, 0.34), s = phase(p, 0.40, 0.65), back = phase(p, 0.76, 0.96);
  return c.map((v, i) => lerp(lerp(lerp(v, wave[i], w), square[i], s), v, back));
}

/** Stable module identity and analytic explode/reassemble poses. Center remains the anchor. */
export function deconstructPose(index, p, spread = 2.15) {
  if (!Number.isInteger(index) || index < 0 || index >= 27) throw new Error('deconstruct: index 必须是 0..26 的整数');
  if (!Number.isFinite(spread) || spread < 1.4 || spread > 2.8) throw new Error('deconstruct: spread 必须在 1.4..2.8 内');
  const home = [index % 3 - 1, Math.floor(index / 3) % 3 - 1, Math.floor(index / 9) - 1];
  const rank = (home[1] + 1) * .022 + (home[0] + 1) * .012 + (home[2] + 1) * .008;
  // Read the topology in order: layers (Y), columns (X), then depth (Z).
  // Close in reverse order so each layer is aligned before it seats. Keep the
  // same delay within a row: neighbouring modules must never overtake each other.
  const delay = rank * .5;
  const axes = [[.21, .37, .74, .82], [.12, .28, .80, .88], [.30, .46, .68, .76]];
  const axisOpen = axes.map(([a, b, c, d]) =>
    clamp(phase(p, a + delay, b + delay) * (1 - phase(p, c + delay * .5, d + delay * .5))));
  const open = Math.max(...axisOpen);
  // Only tilt once ALL axes have clearance; unwind before the first axis closes.
  const tilt = phase(Math.min(...axisOpen), .15, .85);
  return {
    home, open, axisOpen, core: index === 13,
    position: home.map((v, i) => v * (1 + (spread - 1) * axisOpen[i])),
    rotation: home.map((v, i) => v * tilt * [ .055, .085, -.045 ][i]),
  };
}
