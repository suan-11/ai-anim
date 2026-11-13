// One fixed image is attached to the sensor throughout the camera move.
export function sensorArt() {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1000;
  const c = canvas.getContext('2d');
  const sky = c.createLinearGradient(0, 0, 0, 820);
  sky.addColorStop(0, '#203544');
  sky.addColorStop(.42, '#9b797a');
  sky.addColorStop(.78, '#ecc39f');
  sky.addColorStop(1, '#cda888');
  c.fillStyle = sky;
  c.fillRect(0, 0, 1600, 1000);
  const halo = c.createRadialGradient(1120, 430, 0, 1120, 430, 340);
  halo.addColorStop(0, '#f9d7ae80');
  halo.addColorStop(1, '#f9d7ae00');
  c.fillStyle = halo;
  c.fillRect(0, 0, 1600, 1000);
  c.fillStyle = '#ffe3b9';
  c.beginPath();
  c.arc(1120, 425, 58, 0, Math.PI * 2);
  c.fill();

  const layers = [
    { level: 520, height: 145, seed: 2.1, color: '#7b7b84' },
    { level: 600, height: 175, seed: 5.8, color: '#626c79' },
    { level: 690, height: 190, seed: 3.2, color: '#465766' },
    { level: 790, height: 178, seed: 7.9, color: '#2c4250' },
    { level: 944, height: 174, seed: 4.1, color: '#1b303d' },
  ];
  for (const { level, height, seed, color } of layers) {
    c.beginPath();
    c.moveTo(0, 1000);
    for (let x = 0; x <= 1600; x += 2) {
      const u = x / 1600;
      const ridge = Math.sin(u * 6.8 + seed) * .48
        + Math.sin(u * 17 + seed * .4) * .25
        + Math.sin(u * 37 + seed * 1.7) * .12
        + Math.sin(u * 113 + seed) * .035;
      c.lineTo(x, level + height * ridge);
    }
    c.lineTo(1600, 1000);
    c.fillStyle = color;
    c.fill();
  }
  // Fixed, low-contrast photosites become visible only near the landing.
  c.strokeStyle = '#081f2615';
  c.lineWidth = .65;
  c.beginPath();
  for (let x = 0; x < 1600; x += 5) { c.moveTo(x, 0); c.lineTo(x, 1000); }
  for (let y = 0; y < 1000; y += 5) { c.moveTo(0, y); c.lineTo(1600, y); }
  c.stroke();
  return canvas;
}

