// Draw the matrix and the impression from the same carving.
const reliefOutline = [
  'M 41 166 C 58 149 79 121 117 111',
  'Q 143 82 173 66 Q 168 87 171 100 Q 190 82 209 81 Q 198 94 199 106',
  'C 246 105 279 130 309 141 Q 335 135 366 106',
  'Q 361 141 343 158 Q 364 177 375 201 Q 337 196 304 175',
  'C 271 179 251 200 204 209 Q 187 229 162 237 Q 166 223 164 213',
  'Q 109 218 75 197 Q 52 192 42 179 L 57 174 Z',
].join(' ');

const incisions = [
  'M 98 132 Q 117 164 96 194 M 110 128 Q 133 160 112 193',
  'M 132 164 Q 152 170 163 191 Q 144 185 132 170',
  'M 321 151 L 350 127 M 326 157 L 355 142 M 324 166 L 358 184',
  'M 144 107 L 165 83 M 171 103 L 191 91 M 174 222 L 189 212',
  'M 54 177 L 71 175 M 61 185 L 77 181',
].join(' ');

function fish(c, ink, cutColor) {
  const relief = new Path2D(reliefOutline);
  c.save();
  c.translate(-3, 1);
  c.rotate(-0.41);
  c.translate(-205, -160);
  c.fillStyle = ink;
  c.fill(relief);
  c.clip(relief);
  c.strokeStyle = cutColor;
  c.lineCap = 'round';
  c.lineWidth = 2.7;
  c.stroke(new Path2D(incisions));
  // The short cuts follow the flank. Stagger adjacent rows like real scales.
  for (let row = 0; row < 6; row++) {
    const y = 121 + row * 14;
    for (let x = 140 + (row % 2) * 10; x < 305; x += 22) {
      if (row >= 3 && x < 174) continue;
      const ridge = y + 0.00065 * (x - 197) ** 2;
      c.beginPath();
      c.moveTo(x - 5, ridge - 4);
      c.quadraticCurveTo(x + 3, ridge + 3, x - 5, ridge + 8);
      c.stroke();
    }
  }
  c.fillStyle = cutColor;
  c.beginPath(); c.arc(77, 155, 9, 0, Math.PI * 2); c.fill();
  c.fillStyle = ink;
  c.beginPath(); c.arc(75, 155, 4, 0, Math.PI * 2); c.fill();
  c.restore();
}

export function makeBlockArt(printed) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 900;
  const c = canvas.getContext('2d');
  c.scale(3, 3);
  const stock = printed ? '#f8efd9' : '#dab483';
  c.fillStyle = stock;
  c.fillRect(0, 0, 300, 300);
  if (!printed) {
    for (let i = 0; i < 76; i++) {
      const y = i * 4.1;
      c.strokeStyle = i % 4 === 0 ? '#a978454a' : '#fff0ca57';
      c.lineWidth = i % 5 === 0 ? 0.6 : 0.32;
      c.beginPath();
      c.moveTo(0, y);
      c.bezierCurveTo(98, y - 5 * Math.cos(i * .19), 163, y + 8 * Math.sin(i * .17), 301, y - 2);
      c.stroke();
    }
  }
  c.save();
  c.translate(150, 154);
  c.scale(printed ? -0.86 : 0.86, 0.86);
  fish(c, printed ? '#973523' : '#76301e', stock);
  c.restore();
  // Small fixed voids break up the ink. They stay attached to the printed surface.
  let seed = 397;
  const noise = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 2800; i++) {
    c.fillStyle = i % 3 === 0 ? '#fff3d94a' : '#512e1c15';
    c.fillRect(noise() * 300, noise() * 300, .14 + noise() * .6, .2 + noise() * .36);
  }
  return canvas;
}
