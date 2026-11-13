import { makeBlockArt } from './block.js';

function ease(t, start, end) {
  const u = Math.max(0, Math.min(1, (t - start) / (end - start)));
  return u * u * (3 - 2 * u);
}

const SIDE = 426;
const TILE = SIDE / 3;
const HINGE = 1275;
const PAPER_X = HINGE + SIDE / 2;
const Y = 558;

function drawStock(c, art, t) {
  c.save();
  c.translate(PAPER_X - 285 * ease(t, 11.09, 12.20), Y);
  c.fillStyle = '#0d2526';
  c.fillRect(-246 + 8, -261 + 12, 492, 522);
  c.fillStyle = '#f8efd9';
  c.fillRect(-246, -261, 492, 522);
  if (t >= 10.38) c.drawImage(art, -SIDE / 2, -SIDE / 2, SIDE, SIDE);
  c.restore();
}

function drawMatrix(c, art, t) {
  const turn = ease(t, 4.4, 6.9);
  const settle = ease(t, 8.45, 9.56);
  const flip = ease(t, 9.58, 10.38) * Math.PI;
  const lift = ease(t, 10.56, 11.25);
  if (lift >= 1) return;
  c.save();
  c.translate(HINGE + SIDE * lift, Y - lift * 100);
  const projection = Math.cos(flip) * (1 - lift);
  c.transform(projection, -0.12 * Math.sin(flip), 0, 1, 0, 0);
  c.translate(-SIDE / 2 - 66 * (1 - ease(t, 0, 3.8)), 0);
  c.rotate(-0.23 * turn * (1 - settle));
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const delay = (row + col) * .085;
      const open = ease(t, 1.6 + delay, 4.15 + delay);
      const gap = open * (1 - ease(t, 8.45 + delay, 9.25 + delay));
      const x = (col - 1.5) * TILE + ((col - 1) * 78 + (row - 1) * 19) * gap;
      const y = (row - 1.5) * TILE + (row - 1) * 49 * gap;
      c.fillStyle = '#865637';
      c.fillRect(x, y + 6, TILE + .4, TILE);
      if (projection >= 0) {
        c.drawImage(art, col * 300, row * 300, 300, 300, x, y, TILE + .48, TILE + .48);
      } else {
        c.fillStyle = '#a97c50';
        c.fillRect(x, y, TILE + .48, TILE + .48);
        c.strokeStyle = '#745439';
        c.lineWidth = 1.1;
        c.strokeRect(x, y, TILE, TILE);
      }
    }
  }
  c.restore();
}

function labels(ctx, t) {
  const { type } = ctx;
  const x = 140;
  const cream = '#f7ecd4';
  const accent = '#e8ab7c';
  type.write('鱼印', x - 5, 482, { size: 154, weight: 650, family: 'serif', color: cream });
  const captions = [
    [0, 1.65, '木刻版', '鱼头朝左'],
    [1.65, 8.45, '分版', '九块木版，一尾鱼'],
    [8.45, 10.56, '合版压印', '刻面朝纸'],
    [10.56, 13, '纸上印迹', '鱼头朝右'],
  ];
  const [start, end, term, note] = captions.find(([, end]) => t < end) ?? captions.at(-1);
  const enter = start === 0 ? 1 : ease(t, start, start + .24);
  const alpha = enter * (1 - ease(t, end - .16, end));
  type.write(term, x, 590, { size: 55, weight: 650, color: accent, alpha });
  type.write(note, x, 662, { size: 37, color: cream, alpha });
}

export function fishPrintScene() {
  return {
    setup() {
      this.block = makeBlockArt(false);
      this.impression = makeBlockArt(true);
    },
    render(ctx) {
      const t = ctx.f.t;
      const { text } = ctx;
      text.clear();
      text.fill('#243d3d');
      const c = text.ctx;
      c.save();
      const zoom = 1 + .038 * ease(t, 0, 12.4);
      c.translate(1140, Y);
      c.scale(zoom, zoom);
      c.translate(-1140, -Y);
      drawStock(c, this.impression, t);
      drawMatrix(c, this.block, t);
      c.restore();
      labels(ctx, t);
      text.upload();
      ctx.comp.draw(ctx.gl, text, ctx.out, { premult: false });
      return { grain: 0, bloom: 0, vignette: 0 };
    },
  };
}
