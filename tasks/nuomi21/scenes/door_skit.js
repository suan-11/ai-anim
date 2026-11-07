// 小糯米 · 门铃摄像头：trick or treat
// AI 角色图 + 代码运镜 + 字幕 + 猫娘配音。图片只当图层，镜头/节奏/字幕全部由代码控制。
import { makeShot } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

export default makeShot('door_skit', {
  async setup() {
    this.img = await loadImage('/nuomi21/nuomi.jpg');
  },

  draw(ctx, { enter }) {
    const { f, gl, P, text, type, comp } = ctx;
    const { W, H } = gl;
    const c = text.ctx;
    const t = f.lt;

    text.clear();

    // 模糊背景 + 前景角色（不拉伸猫娘）
    c.fillStyle = '#05070c';
    c.fillRect(0, 0, W, H);
    c.save();
    c.filter = 'blur(30px) brightness(0.38)';
    c.drawImage(this.img, 0, 0, W, H);
    c.restore();

    const zoom = t < 3 ? 1.04 + t * 0.01 : t < 6 ? 1.18 + (t - 3) * 0.055 : t < 9 ? 1.55 : 1.2;
    const size = H * zoom;
    const x = W / 2 - size / 2 + Math.sin(t * 0.7) * 10;
    const y = H / 2 - size / 2 - (zoom - 1) * H * 0.18;
    c.save();
    c.beginPath();
    c.rect(0, 0, W, H * 0.82);
    c.clip();
    c.drawImage(this.img, x, y, size, size);
    c.restore();

    // 门铃摄像头 UI + 暗角
    const grad = c.createLinearGradient(0, H * 0.62, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.82)');
    c.fillStyle = grad;
    c.fillRect(0, H * 0.62, W, H * 0.38);
    const vg = c.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.62)');
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);

    type.writeLine('DOOR CAM 01', 64, 66, {
      anchor: 'left', size: 22, weight: 700, family: 'mono', color: css(P.signal),
    });
    type.writeLine('23:47 / FRONT DOOR', 64, 94, {
      anchor: 'left', size: 15, weight: 500, family: 'mono', color: 'rgba(255,255,255,0.55)',
    });

    const caption =
      t < 3.1 ? '有人在家嘛~'
        : t < 5.8 ? '不给糖，就捣蛋喵。'
          : t < 8.8 ? '……看什么看，笨蛋主人。'
            : '再不开门，我就把门挠花。';
    type.writeLine(caption, W / 2, H * 0.87, {
      anchor: 'center', size: 46, weight: 800, family: 'sans',
      color: '#fff', ...enter(0.16),
    });
    type.writeLine('小糯米 / NUOMI', W / 2, H * 0.94, {
      anchor: 'center', size: 15, weight: 500, family: 'mono',
      color: 'rgba(255,255,255,0.55)',
    });

    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return {
      vignette: 0.55,
      grain: 0.035,
      bloom: 0.22,
      ca: t > 8.8 ? 0.25 : 0.05,
      shake: t > 8.8 ? [2, -1] : [0, 0],
      zoom: 1.0,
    };
  },
});
