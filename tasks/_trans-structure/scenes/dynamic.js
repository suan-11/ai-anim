import { cut } from '../../../src/timeline.js';
import { lockupShot } from '../../../src/shots/lockup.js';
import { deconstructShot } from '../../../src/shots/deconstruct.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (x) => {
  const p = clamp(x);
  return p * p * (3 - 2 * p);
};

function dynamicScene(base, { id, enter = -1, exit = 1 } = {}) {
  const scene = Object.create(base);
  scene.id = id ?? base.id;
  scene.render = function render(ctx) {
    const result = base.render.call(this, ctx);
    const { f } = ctx;
    let x = 0;
    let y = 0;
    let scale = 1;
    if (f.tin < 1) {
      const settle = 1 - smooth(f.tin / 0.92);
      x += enter * 46 * settle;
      scale = Math.max(scale, 1 + 0.026 * settle);
    }
    if (f.tout > 0) {
      const p = smooth(f.tout / 0.82);
      x += exit * 18 * p;
      scale = Math.max(scale, 1 + 0.014 * p);
    }
    if (x !== 0 || y !== 0 || scale !== 1) {
      ctx.setXform({ x, y, scale, anchor: [ctx.W / 2, ctx.H / 2] });
    }
    return result;
  };
  return scene;
}

export function dynamicLockup(opts) {
  return dynamicScene(lockupShot(opts), { id: opts.id, enter: opts.id === 'close' ? 1 : -1, exit: -1 });
}

export function dynamicDeconstruct(opts) {
  return dynamicScene(deconstructShot(opts), { id: opts.id, enter: 1, exit: 1 });
}

export function dynamicTimeline() {
  return [
    cut(dynamicLockup({ id: 'open', mark: 'square', name: '打开结构', tagline: '对开', kicker: '01 / SPLIT', meta: '' }), {
      dur: 2.4, world: false, focus: 'center', handlesTransition: false,
    }),
    cut(dynamicDeconstruct({ id: 'structure', title: '拆开，才看见结构', label: '分离 · 观察 · 重组' }), {
      dur: 10.8, overlap: .85, transition: 'seam', handlesTransition: false, world: false,
    }),
    cut(dynamicLockup({ id: 'close', mark: 'square', name: '重新归位', tagline: '四角退场', kicker: '02 / CORNERS', meta: '' }), {
      dur: 2.7, overlap: .9, transition: 'corners', handlesTransition: false, world: false, focus: 'center',
    }),
  ];
}
