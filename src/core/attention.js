/** Box-filter display pixels into a small, top-down RGBA image. */
export function reduceAttentionFrame(pixels, width, height, { flipY = false, longEdge = 192 } = {}) {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const top = Math.floor(y * height / h);
    const bottom = Math.floor((y + 1) * height / h);
    for (let x = 0; x < w; x++) {
      const left = Math.floor(x * width / w);
      const right = Math.floor((x + 1) * width / w);
      let r = 0, g = 0, b = 0;
      for (let sy = top; sy < bottom; sy++) {
        const row = (flipY ? height - 1 - sy : sy) * width;
        for (let sx = left; sx < right; sx++) {
          const src = (row + sx) * 4;
          r += pixels[src]; g += pixels[src + 1]; b += pixels[src + 2];
        }
      }
      const n = (right - left) * (bottom - top);
      const dst = (y * w + x) * 4;
      rgba[dst] = r / n; rgba[dst + 1] = g / n; rgba[dst + 2] = b / n;
      rgba[dst + 3] = 255;
    }
  }
  return { width: w, height: h, rgba };
}

function channels(frame) {
  const n = frame.width * frame.height;
  const y = new Float32Array(n), rg = new Float32Array(n), by = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = frame.rgba[i * 4], g = frame.rgba[i * 4 + 1], b = frame.rgba[i * 4 + 2];
    y[i] = r * 0.2126 + g * 0.7152 + b * 0.0722;
    rg[i] = r - g;
    by[i] = b - (r + g) / 2;
  }
  return [y, rg, by];
}

function summedArea(values, w, h) {
  const stride = w + 1;
  const table = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += values[y * w + x];
      table[(y + 1) * stride + x + 1] = row + table[y * stride + x + 1];
    }
  }
  return (x0, y0, x1, y1) => table[y1 * stride + x1] - table[y0 * stride + x1]
    - table[y1 * stride + x0] + table[y0 * stride + x0];
}

function normalizeFocus(focus) {
  if (!focus) return null;
  const x = Math.max(0, focus.x), y = Math.max(0, focus.y);
  const w = Math.min(1, focus.x + focus.w) - x, h = Math.min(1, focus.y + focus.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/**
 * Estimate visual saliency from display pixels. Focus is optional and uses normalized
 * top-left coordinates. It only evaluates the result, so it cannot attract the hotspot.
 */
export function measureAttention(frame, { previous = null, focus = null } = {}) {
  const { width: w, height: h } = frame;
  const n = w * h;
  const current = channels(frame);
  const prior = previous?.width === w && previous.height === h ? channels(previous) : null;
  const sums = current.map((channel) => summedArea(channel, w, h));
  const weights = [1, 0.28, 0.24];
  const exposure = prior ? current.map((channel, k) => channel.reduce((sum, v, i) => sum + v - prior[k][i], 0) / n) : [];
  const radius = Math.max(2, Math.round(Math.min(w, h) * 0.12));
  const scores = new Float32Array(n);
  let mass = 0;
  for (let y = 0; y < h; y++) {
    const top = Math.max(0, y - radius), bottom = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const left = Math.max(0, x - radius), right = Math.min(w, x + radius + 1);
      const i = y * w + x;
      const area = (right - left) * (bottom - top);
      let contrast = 0, change = 0;
      for (let k = 0; k < weights.length; k++) {
        contrast += weights[k] * Math.abs(current[k][i] - sums[k](left, top, right, bottom) / area);
        if (prior) change += weights[k] * Math.abs(current[k][i] - prior[k][i] - exposure[k]);
      }
      scores[i] = Math.max(0, contrast - 4) + 0.45 * Math.max(0, change - 7);
      mass += scores[i];
    }
  }

  const strength = mass / n;
  const target = normalizeFocus(focus);
  const heatScale = Math.min(1, 32 / Math.max(w, h));
  const heatWidth = Math.max(1, Math.round(w * heatScale));
  const heatHeight = Math.max(1, Math.round(h * heatScale));
  const heat = new Uint8Array(heatWidth * heatHeight);
  if (strength < 0.05) return { strength, concentration: null, focusShare: null, focus: target, hotspot: null, heat, heatWidth, heatHeight };

  const sum = summedArea(scores, w, h);
  // A fixed-size window makes concentration comparable across sample times and target sizes.
  const ww = Math.max(1, Math.round(w * Math.sqrt(0.1)));
  const wh = Math.max(1, Math.round(h * Math.sqrt(0.1)));
  let peak = -1, peakX = 0, peakY = 0;
  for (let y = 0; y + wh <= h; y++) {
    for (let x = 0; x + ww <= w; x++) {
      const value = sum(x, y, x + ww, y + wh);
      if (value > peak) { peak = value; peakX = x; peakY = y; }
    }
  }
  // Use the weighted center inside the strongest neighborhood, including when its window can slide without changing the sum.
  let px = 0, py = 0;
  for (let y = peakY; y < peakY + wh; y++) {
    for (let x = peakX; x < peakX + ww; x++) {
      const score = scores[y * w + x];
      px += (x + 0.5) * score;
      py += (y + 0.5) * score;
    }
  }

  let focusShare = null;
  if (target) {
    const x0 = Math.ceil(target.x * w - 0.5), x1 = Math.ceil((target.x + target.w) * w - 0.5);
    const y0 = Math.ceil(target.y * h - 0.5), y1 = Math.ceil((target.y + target.h) * h - 0.5);
    focusShare = Math.max(0, Math.min(1, sum(x0, y0, x1, y1) / mass));
  }
  const energy = new Float32Array(heat.length);
  for (let y = 0; y < heatHeight; y++) {
    const top = Math.floor(y * h / heatHeight), bottom = Math.floor((y + 1) * h / heatHeight);
    for (let x = 0; x < heatWidth; x++) {
      const left = Math.floor(x * w / heatWidth), right = Math.floor((x + 1) * w / heatWidth);
      energy[y * heatWidth + x] = sum(left, top, right, bottom) / ((right - left) * (bottom - top));
    }
  }
  const max = Math.max(...energy);
  for (let i = 0; i < heat.length; i++) heat[i] = Math.round(255 * Math.sqrt(Math.max(0, energy[i]) / max));
  return { strength, concentration: Math.min(1, peak / mass), focusShare, focus: target,
    hotspot: { x: px / (peak * w), y: py / (peak * h) }, heat, heatWidth, heatHeight };
}
