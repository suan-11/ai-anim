// @ts-check
/**
 * `src/player.js` —— **单文件播放器**（`anim film-html` 用它）。
 *
 * 来源：OpenFilm 的「一个 HTML 文件就是一支片子」—— 把引擎 + 场景 + 音轨打进一个
 * `film.html`，发给任何人双击就能在浏览器里播（不需要 Node、不需要 Vite、不需要联网）。
 *
 * 契约和成片是同一条：`engine.render(t, { preview: true, toScreen: true, samples: 1 })`
 * 只吃时间 t —— 所以拖进度条、暂停、逐帧都不会和预览不一致。
 */

import { Engine } from './core/engine.js';
import { build } from './timeline.js';
import { makePalette } from './core/palette.js';

function fmt(x) {
  const m = Math.floor(x / 60);
  const s = x - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}

export async function mountFilm(o) {
  const { cfg, styleResolved, music = null, audioUrl = '', title = '', duration } = o;
  const W = cfg.width ?? 1920, H = cfg.height ?? 1080, fps = cfg.fps ?? 60;
  const root = document.getElementById('film');
  root.innerHTML = [
    '<div class="stage"><canvas id="c"></canvas></div>',
    '<div class="bar">',
    '  <button id="play">▶</button>',
    '  <input id="seek" type="range" min="0" max="1000" value="0" step="1" />',
    '  <span id="time">0:00.00</span>',
    '  <span class="title">' + String(title) + '</span>',
    '</div>',
  ].join('');
  const style = document.createElement('style');
  style.textContent = [
    'html,body{margin:0;background:#0b0b0c;color:#e9e7e2;font:13px/1.4 ui-monospace,monospace}',
    '#film{display:flex;flex-direction:column;height:100vh}',
    '.stage{flex:1;display:grid;place-items:center;min-height:0}',
    'canvas{max-width:100%;max-height:100%;display:block}',
    '.bar{display:flex;gap:10px;align-items:center;padding:10px 14px;border-top:1px solid #232326}',
    '#play{width:34px;height:28px;border:1px solid #333;background:#17181a;color:#e9e7e2;border-radius:6px;cursor:pointer}',
    '#seek{flex:1;accent-color:#ff5a2c}',
    '#time{width:86px;text-align:right;opacity:.8}',
    '.title{opacity:.55;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  ].join('');
  document.head.appendChild(style);

  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('c'));
  canvas.width = W;
  canvas.height = H;

  const palette = makePalette({ ...(styleResolved?.palette ?? {}), ...(cfg.palette ?? {}) });
  const engine = new Engine(canvas, { width: W, height: H, scale: 1, fps, palette });
  // ⚠ engine.load 要的是**排好时间的段表**（tasks.js 里 build() 的产物），不是 seq() 的原样
  const segs = build(cfg.timeline, { bpm: music?.bpm ?? 120, duration });
  await engine.load({
    timeline: segs,
    music,
    title: cfg.title ?? title,
    duration,
    worldPass: cfg.world ?? null,
    styleResolved: styleResolved ?? null,
    captions: cfg.captions ?? null,
  });

  const audio = audioUrl ? new Audio(audioUrl) : null;
  if (audio) { audio.preload = 'auto'; audio.volume = 1; }

  const total = Number(duration ?? engine.duration ?? 0);
  const seekEl = /** @type {HTMLInputElement} */ (document.getElementById('seek'));
  const btn = /** @type {HTMLButtonElement} */ (document.getElementById('play'));
  const lab = /** @type {HTMLElement} */ (document.getElementById('time'));
  let t = 0, playing = false, last = 0;

  const draw = () => {
    engine.render(t, { preview: true, toScreen: true, samples: 1 });
    lab.textContent = fmt(t);
    seekEl.value = String(Math.round((total ? t / total : 0) * 1000));
  };
  // 截图：评审时想指出"这一秒有问题"不用录屏。**必须在 render 之后同一个 tick 里读**，
  // 否则 WebGL 的 drawing buffer 已经被清掉（拿到的是一张透明图）。
  const capture = (name) => {
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = (name ?? ('frame_' + t.toFixed(2) + 's')) + '.png';
    a.click();
    return url;
  };
  const tick = (now) => {
    if (!playing) return;
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    t += dt;
    if (total && t >= total) { t = total; setPlaying(false); }
    draw();
    requestAnimationFrame(tick);
  };
  const setPlaying = (on) => {
    playing = on;
    btn.textContent = on ? '❚❚' : '▶';
    if (audio) {
      audio.currentTime = t;
      if (on) audio.play().catch(() => {}); else audio.pause();
    }
    if (on) { last = performance.now(); requestAnimationFrame(tick); }
  };

  btn.onclick = () => setPlaying(!playing);
  seekEl.oninput = () => {
    t = (Number(seekEl.value) / 1000) * total;
    if (audio) audio.currentTime = t;
    draw();
  };
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyP') { e.preventDefault(); capture(); }
    else if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
    else if (e.code === 'ArrowRight') { t = Math.min(total, t + 1 / fps); draw(); }
    else if (e.code === 'ArrowLeft') { t = Math.max(0, t - 1 / fps); draw(); }
  });

  draw();
  const api = { engine, get t() { return t; }, set t(v) { t = v; draw(); }, total, draw, capture };
  // 量具出口：tools/probe-film-html.mjs 靠它拖到指定时刻再截图
  /** @type {any} */ (globalThis).__film = api;
  return api;
}
