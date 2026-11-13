// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { opt } from "./args.mjs";
import { getSession } from "./session.mjs";
/** 把若干时刻渲染成一张接触表（每格标时刻），写到 out/。
 *
 * `check --sheet` 与 `anim cuts` 共用这一份实现。可选项都是**向后兼容**的加法：
 *   · `samples` / `shutter`：不传就与从前逐像素一样（`samples: 1`）；
 *   · `marks`：要高亮的时刻数组（±0.02s 内算命中），命中格描一圈信号色方框 ——
 *     `anim cuts` 用它指出「这一格就是切点」。
 */
async function writeContactSheet(times, out, opts = {}) {
  const cols = Math.max(1, Number(opts.cols ?? opt('cols', '4')));
  const cell = Number(opts.cell ?? opt('cell', '420'));
  const samples = opts.samples ?? 1;
  const shutter = opts.shutter ?? 0.5;
  const marks = Array.isArray(opts.marks) ? opts.marks : null;
  const dataUrl = await getSession().page.evaluate(async ({ times, cols, cell, samples, shutter, marks }) => {
    const api = /** @type {any} */ (window).__anim;
    const w = cell, h = Math.round((cell * 9) / 16);
    const pad = 6, lab = 20;
    const rows = Math.ceil(times.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * (w + pad) + pad;
    cv.height = rows * (h + lab + pad) + pad;
    const c = cv.getContext('2d');
    c.fillStyle = '#1a1a1c'; c.fillRect(0, 0, cv.width, cv.height);
    const img = new Image();
    for (let i = 0; i < times.length; i++) {
      await api.frame(times[i], { samples: Number(samples), shutter });
      img.src = api.png();
      await img.decode();
      const x = pad + (i % cols) * (w + pad);
      const y = pad + Math.floor(i / cols) * (h + lab + pad);
      c.drawImage(img, x, y + lab, w, h);
      c.fillStyle = '#ddd'; c.font = '14px monospace';
      c.fillText(`${times[i].toFixed(2)}s`, x + 2, y + 15);
      if (marks && marks.some((m) => Math.abs(m - times[i]) < 0.02)) {
        c.strokeStyle = '#ff4d12'; c.lineWidth = 3;
        c.strokeRect(x + 2, y + lab + 2, w - 4, h - 4);
      }
    }
    return cv.toDataURL('image/png');
  }, { times, cols, cell, samples, shutter, marks });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
}

export { writeContactSheet };
