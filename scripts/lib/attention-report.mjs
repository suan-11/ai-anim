import { ATTENTION_ISSUE_LABELS } from './attention-rhythm.mjs';

/** Self-contained attention report. The frame, hotspot and series share a single cursor. */
export function renderAttentionReport(report) {
  const payload = JSON.stringify(report).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>注意力曲线</title><link rel="icon" href="data:,">
<style>
*{box-sizing:border-box}body{margin:0;background:#10141c;color:#eee;font:16px/1.6 system-ui,sans-serif}
main{max-width:1056px;margin:auto;padding:24px clamp(16px,4vw,42px) 40px}h1,h2,p{margin:0 0 8px}h1{font-size:clamp(25px,4vw,36px)}h2{font-size:18px}p{color:#aebdce}
.panel{background:#171f2b;border:1px solid #354050;border-radius:12px;padding:16px;margin:16px 0}
.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:14px}
.chart-header{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:4px}
button,select{font:inherit;color:inherit;background:#212c3b;border:1px solid #4c5e72;border-radius:6px;padding:3px 8px}button{cursor:pointer}
#curve{width:100%;height:230px;display:block;cursor:crosshair}#slider{flex:1;min-width:60px;accent-color:#ffb875}
.plot{position:relative}#playhead{position:absolute;top:25px;bottom:26px;width:1px;background:#f5f7fa;pointer-events:none}
.playback{display:flex;align-items:center;gap:12px;margin:12px 0 4px}.playback button{color:#141923;background:#ffb875;border-color:#ffb875;font-weight:700;min-width:74px}
.playback output{font-size:14px;color:#b9c5d3;white-space:nowrap;font-variant-numeric:tabular-nums}
.details{display:grid;gap:20px;grid-template-columns:minmax(0,2fr) minmax(180px,1fr)}
.preview{position:relative;background:#10141c;align-self:start}.preview :is(img,video):not([hidden]){display:block;width:100%;height:auto}
.preview canvas{position:absolute;inset:0;width:100%;height:100%}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:12px 0}dt{color:#aebdce}dd{margin:0;font-variant-numeric:tabular-nums}
a{color:#77e5db}input:focus-visible,a:focus-visible,button:focus-visible,select:focus-visible{outline:2px solid #ffb875;outline-offset:3px}
.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:14px;font-variant-numeric:tabular-nums}
td,th{padding:8px 10px;border-bottom:1px solid #354050;white-space:nowrap}th{color:#aebdce}tr:last-child td{border-bottom:0}
@media(max-width:630px){.details{grid-template-columns:1fr}#curve{height:185px}}
</style>
<main>
<header><h1>注意力曲线</h1><p id="meta"></p><p>播放时，曲线游标和热图跟随画面。点击曲线或拖动时间轴可查看指定帧。</p></header>
<section class="panel" aria-label="注意力随时间变化">
<div class="chart-header"><div class="legend" id="legend"></div>
<label>曲线 <select id="metric"><option value="saliency">显著性占比</option><option value="position">热点位置</option></select></label></div>
<div class="plot"><canvas id="curve" aria-label="随时间变化的曲线"></canvas><div id="playhead" aria-hidden="true"></div></div>
<div class="playback"><button id="play" type="button">播放</button><input id="slider" type="range" min="0" value="0" aria-label="选择采样点"><output id="clock" aria-live="off"></output></div>
</section>
<section class="panel details" aria-label="选中帧">
<div class="preview"><img id="frame" alt="选中时刻的渲染帧"><video id="video" aria-label="样片预览" playsinline preload="metadata" hidden></video><canvas id="overlay" aria-hidden="true"></canvas></div>
<div><h2 id="at"></h2><p id="shot"></p><dl id="values"></dl>
<label><input id="show" type="checkbox" checked> 显示热图</label><p id="source"></p><p>白点是显著中心，青框是声明的主体区。</p></div>
</section>
<section class="panel" id="rhythmScore" hidden>
<h2>注意力节奏评分</h2><p id="rhythmSummary"></p><p id="hookSummary"></p>
<div class="table-wrap" id="rhythmWaves" hidden><table><thead><tr><th scope="col">释放区间</th><th scope="col">峰值时刻</th><th scope="col">前升幅</th><th scope="col">后回落</th><th scope="col">评审状态</th></tr></thead><tbody id="waveRows"></tbody></table></div>
</section>
<section class="panel" id="blocks" hidden>
<h2>节奏块读数</h2>
<div class="table-wrap"><table><thead><tr><th scope="col">区间</th><th scope="col">事件</th><th scope="col">平均集中度</th><th scope="col">主体内平均</th><th scope="col">热点落框 / 可判帧</th><th scope="col">主体内最低点</th></tr></thead><tbody id="blockRows"></tbody></table></div>
</section>
<a href="attention.json">机器读数 JSON</a>
</main>
<script id="data" type="application/json">${payload}</script>
<script>
const report = JSON.parse(document.querySelector('#data').textContent);
const { samples, duration, events, sourceOffset, blocks = [], rhythmScore } = report;
const get = (id) => document.getElementById(id);
const curve = get('curve'), slider = get('slider'), show = get('show'), overlay = get('overlay');
const frame = get('frame'), video = get('video'), button = get('play');
const chart = curve.getContext('2d'), map = overlay.getContext('2d');
const metric = get('metric');
const plots = {
  saliency: [['显著性集中度', (row) => row.concentration], ['主体内显著性', (row) => row.focusShare]],
  position: [['横坐标（左 → 右）', (row) => row.hotspot?.x ?? null], ['纵坐标（上 → 下）', (row) => row.hotspot?.y ?? null]],
};
if (rhythmScore?.series) {
  plots.rhythm = [['实测显著性代理值', (_, i) => rhythmScore.series[i]?.observed ?? null],
    ['目标节奏', (_, i) => rhythmScore.series[i]?.target ?? null]];
  metric.add(new Option('注意力节奏', 'rhythm'));
}
const lineColors = ['#ffb875', '#77e5db'];
const colors = { pressure:'#815324', hold:'#61416e', release:'#8e4142', residue:'#235759' };
const margin = { left:48, right:16, top:25, bottom:26 };
let selected = 0;
let playhead = 0, playing = false, request = 0, startedAt = 0;
let useVideo = false;
slider.max = String(samples.length - 1);
get('meta').textContent = report.task + ' · ' + duration.toFixed(2) + ' 秒 · ' + samples.length + ' 个采样点';

function drawCurve() {
  const width = curve.clientWidth, height = curve.clientHeight, ratio = window.devicePixelRatio || 1;
  curve.width = Math.round(width * ratio); curve.height = Math.round(height * ratio);
  chart.setTransform(ratio, 0, 0, ratio, 0, 0);
  const w = width - margin.left - margin.right, h = height - margin.top - margin.bottom;
  const xt = (t) => margin.left + t / duration * w;
  const yv = (v) => margin.top + (1 - v) * h;
  chart.font = '11px system-ui';
  for (const event of events) {
    const x = xt(event.start), span = xt(event.end) - x;
    chart.fillStyle = colors[event.role] ?? '#394654'; chart.fillRect(x, margin.top, span, h);
    if (span > 52) {
      chart.fillStyle = '#dedfe2'; chart.textAlign = 'center'; chart.fillText(event.role, x + span / 2, 15);
    }
  }
  chart.strokeStyle = '#8293a666'; chart.fillStyle = '#b9c5d3'; chart.textAlign = 'right';
  for (const value of [0, 0.25, 0.5, 0.75, 1]) {
    const y = yv(value);
    chart.beginPath(); chart.moveTo(xt(0), y); chart.lineTo(xt(duration), y); chart.stroke();
    chart.fillText(Math.round(value * 100) + '%', margin.left - 7, y + 3);
  }
  chart.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const t = duration * i / 4;
    chart.fillText(Number(t.toFixed(1)) + 's', xt(t), height - 5);
  }
  for (const [i, [, read]] of plots[metric.value].entries()) {
    const color = lineColors[i];
    chart.strokeStyle = color; chart.fillStyle = color; chart.lineWidth = 2;
    chart.beginPath(); let started = false, lastShots = null;
    for (const [j, row] of samples.entries()) {
      const value = read(row, j);
      if (metric.value === 'position') {
        const shots = row.shots.join(' / ');
        if (shots !== lastShots) started = false;
        lastShots = shots;
      }
      if (value === null) { started = false; continue; }
      if (started) chart.lineTo(xt(row.t), yv(value)); else chart.moveTo(xt(row.t), yv(value));
      started = true;
    }
    chart.stroke();
    const value = read(samples[selected], selected);
    if (value !== null) {
      chart.beginPath(); chart.arc(xt(samples[selected].t), yv(value), 4, 0, Math.PI * 2); chart.fill();
    }
  }
  updateClock();
}

function drawOverlay(row) {
  const w0 = useVideo ? video.videoWidth : frame.naturalWidth;
  const h0 = useVideo ? video.videoHeight : frame.naturalHeight;
  const width = 576, height = Math.round(width * h0 / (w0 || 1));
  if (!height) return;
  overlay.width = width; overlay.height = height;
  const w = width / row.heatWidth, h = height / row.heatHeight;
  if (show.checked) {
    const heat = atob(row.heat);
    for (let i = 0; i < heat.length; i++) {
      const strength = heat.charCodeAt(i) / 255;
      if (strength < 0.08) continue;
      map.fillStyle = 'rgba(255,' + Math.round(98 + 119 * strength) + ',52,' + (0.57 * strength) + ')';
      map.fillRect((i % row.heatWidth) * w, Math.floor(i / row.heatWidth) * h, w, h);
    }
  }
  if (row.focus) {
    const { x, y, w, h } = row.focus;
    map.strokeStyle = '#77e5db'; map.lineWidth = 2; map.setLineDash([7, 5]);
    map.strokeRect(x * width, y * height, w * width, h * height); map.setLineDash([]);
  }
  if (row.hotspot) {
    map.fillStyle = '#fff'; map.strokeStyle = '#12151c'; map.lineWidth = 2;
    map.beginPath(); map.arc(row.hotspot.x * width, row.hotspot.y * height, 5, 0, Math.PI * 2); map.fill(); map.stroke();
  }
}

const pct = (v) => v === null ? '—' : Math.round(v * 100) + '%';
const sampleAtOrAfter = (t) => {
  let low = 0, high = samples.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (samples[mid].t < t) low = mid + 1; else high = mid;
  }
  return low;
};
function nearestSample(t) {
  const i = sampleAtOrAfter(t);
  return i > 0 && t - samples[i - 1].t < samples[i].t - t ? i - 1 : i;
}

function updateLegend() {
  const labels = plots[metric.value].map(([label], i) => {
    const item = document.createElement('span');
    item.style.color = lineColors[i]; item.textContent = '● ' + label;
    return item;
  });
  get('legend').replaceChildren(...labels);
  curve.setAttribute('aria-label', labels.map((item) => item.textContent).join(' / ') + ' 随时间变化');
}

function showBlocks() {
  get('blocks').hidden = !blocks.length;
  for (const block of blocks) {
    const row = get('blockRows').insertRow();
    const range = block.start.toFixed(2) + '–' + block.end.toFixed(2) + 's';
    const values = [range, block.role, pct(block.meanConcentration), pct(block.meanFocusShare),
      block.focused ? block.inside + ' / ' + block.focused : '—'];
    for (const value of values) row.insertCell().textContent = value;
    const cell = row.insertCell();
    if (block.lowestFocusTime === null) { cell.textContent = '—'; continue; }
    const jump = document.createElement('button');
    jump.type = 'button'; jump.textContent = block.lowestFocusTime.toFixed(2) + 's';
    jump.setAttribute('aria-label', '查看 ' + range + ' 的主体内最低点');
    jump.addEventListener('click', () => { seek(nearestSample(block.lowestFocusTime)); get('at').scrollIntoView({ block: 'nearest' }); });
    cell.append(jump);
  }
}

function showRhythmScore() {
  if (!rhythmScore) return;
  get('rhythmScore').hidden = false;
  const labels = ${JSON.stringify(ATTENTION_ISSUE_LABELS)};
  if (rhythmScore.status === 'unmeasured') {
    get('rhythmSummary').textContent = '未评 · ' + (labels[rhythmScore.reason] ?? '数据不足');
    return;
  }
  const { score, variance, bias, hook, body, waves } = rhythmScore;
  get('rhythmSummary').textContent = score + '/100 · 加权方差 ' + variance.toFixed(4)
    + ' · 水平偏差 ' + pct(bias) + ' · ' + (rhythmScore.status === 'observed' ? '波形通过' : '待复看');
  get('hookSummary').textContent = '前 3 秒 · ' + (hook.status === 'unmeasured' ? '未评'
    : (hook.status === 'observed' ? '出现视觉钩子候选' : '视觉钩子待复看')
      + ' · 峰 ' + hook.peakTime.toFixed(2) + 's · 窗间起伏 ' + pct(hook.change))
    + ' · 后续起伏 ' + (body === 'observed' ? '达线' : '待复看');
  get('rhythmWaves').hidden = !waves.length;
  for (const wave of waves) {
    const row = get('waveRows').insertRow();
    row.insertCell().textContent = wave.start.toFixed(2) + '–' + wave.end.toFixed(2) + 's';
    const peak = row.insertCell();
    if (wave.peakTime === null) peak.textContent = '—';
    else {
      const jump = document.createElement('button');
      jump.type = 'button'; jump.textContent = wave.peakTime.toFixed(2) + 's';
      jump.addEventListener('click', () => { seek(nearestSample(wave.peakTime)); get('at').scrollIntoView({ block: 'nearest' }); });
      peak.append(jump);
    }
    for (const value of [pct(wave.rise), pct(wave.fall), wave.issues.length ? wave.issues.map((issue) => labels[issue]).join('、') : '达线']) {
      row.insertCell().textContent = value;
    }
  }
}

function select(index) {
  selected = index; slider.value = String(index);
  const row = samples[index];
  slider.setAttribute('aria-valuetext', row.t.toFixed(2) + ' 秒');
  get('at').textContent = row.t.toFixed(2) + ' 秒' + (sourceOffset ? ' · 原片 ' + row.sourceTime.toFixed(2) + ' 秒' : '');
  get('shot').textContent = [row.shots.join(' / '), row.role].filter(Boolean).join(' · ') || '无活动镜头';
  if (!useVideo) {
    frame.onload = () => drawOverlay(samples[selected]);
    frame.src = 'data:image/jpeg;base64,' + row.preview;
  }
  drawOverlay(row);
  const data = [
    ['显著性集中度', pct(row.concentration)], ['主体内显著性', pct(row.focusShare)],
    ['主体区面积', pct(row.focus ? row.focus.w * row.focus.h : null)],
    ['显著中心', row.hotspot ? pct(row.hotspot.x) + ' 横 / ' + pct(row.hotspot.y) + ' 纵' : '无可测信号'],
  ];
  get('values').replaceChildren(...data.flatMap(([key, value]) => {
    const term = document.createElement('dt'), detail = document.createElement('dd');
    term.textContent = key; detail.textContent = value;
    return [term, detail];
  }));
}

function updateClock() {
  const clock = get('clock');
  const value = playhead.toFixed(1) + ' / ' + duration.toFixed(1) + 's';
  if (clock.textContent !== value) clock.textContent = value;
  const width = curve.clientWidth - margin.left - margin.right;
  get('playhead').style.left = (margin.left + playhead / duration * width) + 'px';
}

function pause() {
  playing = false;
  cancelAnimationFrame(request);
  video.pause();
  button.textContent = playhead >= duration ? '重播' : '播放';
}

function seek(index) {
  pause();
  playhead = samples[index].t;
  if (useVideo) video.currentTime = playhead;
  select(index);
  drawCurve();
  button.textContent = '播放';
}

function tick(now) {
  if (!playing) return;
  const time = useVideo ? video.currentTime : (now - startedAt) / 1000;
  playhead = video.ended && useVideo ? duration : Math.min(duration, Math.max(0, time));
  const next = sampleAtOrAfter(playhead);
  const index = next > 0 && samples[next].t > playhead ? next - 1 : next;
  if (index !== selected) { select(index); drawCurve(); }
  else updateClock();
  if (playhead >= duration) pause(); else request = requestAnimationFrame(tick);
}

function useSampleFrames() {
  useVideo = false;
  video.pause();
  video.hidden = true;
  frame.hidden = false;
  startedAt = performance.now() - playhead * 1000;
  get('source').textContent = '采样帧预览';
  select(selected);
}

function mediaPlay() {
  video.currentTime = playhead;
  video.play().catch((error) => { if (playing && useVideo && error.name !== 'AbortError') useSampleFrames(); });
}

button.addEventListener('click', () => {
  if (playing) { pause(); return; }
  if (playhead >= duration) seek(0);
  playing = true;
  button.textContent = '暂停';
  startedAt = performance.now() - playhead * 1000;
  if (useVideo) mediaPlay();
  request = requestAnimationFrame(tick);
});
if (report.video) {
  video.addEventListener('loadedmetadata', () => {
    if (Math.abs(video.duration - duration) > 0.15) { useSampleFrames(); return; }
    useVideo = true;
    video.hidden = false;
    frame.hidden = true;
    get('source').textContent = '视频预览 · 热图按采样点更新';
    if (playing) mediaPlay(); else video.currentTime = playhead;
    drawOverlay(samples[selected]);
  });
  video.addEventListener('error', useSampleFrames);
  video.src = report.video;
}
slider.addEventListener('input', () => seek(Number(slider.value)));
show.addEventListener('change', () => drawOverlay(samples[selected]));
metric.addEventListener('change', () => { updateLegend(); drawCurve(); });
curve.addEventListener('click', (e) => {
  const rect = curve.getBoundingClientRect();
  const t = (e.clientX - rect.left - margin.left) / (rect.width - margin.left - margin.right) * duration;
  seek(nearestSample(t));
});
new ResizeObserver(drawCurve).observe(curve);
updateLegend();
showBlocks();
showRhythmScore();
get('source').textContent = '采样帧预览';
seek(0);
</script></html>`;
}
