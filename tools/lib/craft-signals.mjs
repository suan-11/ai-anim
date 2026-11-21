// @ts-check
/**
 * tools/lib/craft-signals.mjs —— 「偷懒信号」纯函数检测（docs/CRAFT.md §6）。
 *
 * 管「做得好不好」的机器读数（不进 check，不阻塞老任务，--strict 才当门）：
 *   1. 静态源码信号：CRAFT-FONT / CRAFT-COLOR / CRAFT-RAWTEXT
 *   2. 任务结构信号：CRAFT-MONO / CRAFT-TEMPLATE / CRAFT-STATIC-CAM / CRAFT-NOWORLD
 *   3. 像素读数信号：CRAFT-EMPTY / CRAFT-FLAT
 * （注：CRAFT-TEXTONLY 暂未接线，文档已诚实标明。）
 */
import { scanSource as stripJsComments, lineAt } from '../../scripts/lib/js-source.mjs';

export const CRAFT_CODES = {
  'CRAFT-FONT': '手写裸 CSS 字体（sans-serif / monospace / .font = "...px"），未走风格包字体栈',
  'CRAFT-COLOR': '硬编码色值（rgba / #hex）数量多于调色板（P. / col(P)）引用',
  'CRAFT-RAWTEXT': '直接调用 Canvas2D fillText / strokeText，绕开了 type.write* 排版与动画层',
  'CRAFT-MONO': '片长 > 15s 却只有 1 个镜头段，缺乏叙事分段与呼吸节奏',
  'CRAFT-TEMPLATE': '纯模板段占比 > 40% 或同一模板出现 ≥ 3 次',
  'CRAFT-STATIC-CAM': '全片未调用任何摄影机运动接口（cameraPost / zoom / camera3 / makeShot / makeThreeShot / shakeSmooth）',
  'CRAFT-NOWORLD': '多段片子未声明共享背景 world（export const world 或 world: "auto"）',
  'CRAFT-EMPTY': '16×9 网格中空白格占比 > 55%，主体尺度过小或构图空洞',
  'CRAFT-FLAT': '画面亮度动态范围（p95 - p5）< 0.25，缺少明暗层次',
};

/** 从源码中剔除 `palette: { ... }` 块（只对 task.config.mjs 用，避免把调色板定义误当硬编码色值）。 */
function maskPaletteBlock(code) {
  const m = /\bpalette\s*:\s*\{/.exec(code);
  if (!m) return code;
  const open = code.indexOf('{', m.index);
  let depth = 0;
  let end = -1;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return code;
  const masked = code.slice(open, end + 1).replace(/[^\n]/g, ' ');
  return code.slice(0, open) + masked + code.slice(end + 1);
}

/**
 * 扫描单个 JS 文件的偷懒源码信号（纯函数）。
 * @param {string} text
 * @param {string} [file]
 * @returns {{ code: string, file: string, line: number, count: number, msg: string }[]}
 */
export function scanSource(text, file = 'scene.js') {
  const raw = String(text ?? '');
  const { code, strings } = stripJsComments(raw);
  /** @type {{ code: string, file: string, line: number, count: number, msg: string }[]} */
  const out = [];

  // 1) CRAFT-FONT：字符串字面量里的 sans-serif / monospace，或直接赋值给 .font = '...px ...' / '... serif'
  const fontLines = [];
  for (const sp of strings) {
    const lit = raw.slice(sp.start, sp.end);
    if (/\b(?:sans-serif|monospace)\b/.test(lit)) {
      fontLines.push(lineAt(raw, sp.start));
    }
  }
  const fontAssignRe = /\.font\s*=\s*[^\n;]*(?:\b(?:\d+|\$\{[^}]*\})\s*px\b|\bserif\b)/g;
  for (const m of code.matchAll(fontAssignRe)) {
    const ln = lineAt(raw, m.index ?? 0);
    if (!fontLines.includes(ln)) fontLines.push(ln);
  }
  if (fontLines.length) {
    fontLines.sort((a, b) => a - b);
    out.push({
      code: 'CRAFT-FONT',
      file,
      line: fontLines[0],
      count: fontLines.length,
      msg: `${file}:${fontLines[0]} 发现 ${fontLines.length} 处硬编码字体（sans-serif/monospace 或 .font = ...），请改用 type.write* + family: 'sans'|'mono'|'serif'`,
    });
  }

  // 2) CRAFT-RAWTEXT：.fillText( / .strokeText(
  const rawMatches = [...code.matchAll(/\.\s*(?:fillText|strokeText)\s*\(/g)];
  if (rawMatches.length) {
    const ln = lineAt(raw, rawMatches[0].index ?? 0);
    out.push({
      code: 'CRAFT-RAWTEXT',
      file,
      line: ln,
      count: rawMatches.length,
      msg: `${file}:${ln} 直接调用了 ${rawMatches.length} 次 fillText/strokeText，请改用 ctx.type.write / writeLine / reveal`,
    });
  }

  // 3) CRAFT-COLOR：硬编码 rgba( / #hex 多于 P. 调色板引用
  const isConfig = /(?:^|[\\/])task\.config\.mjs$/i.test(file);
  const colorCode = isConfig ? maskPaletteBlock(code) : code;
  const colorStrings = strings.filter((sp) => {
    if (!isConfig) return true;
    // 若在 palette 块内，mask 后对应区间是空白
    return colorCode.slice(sp.start, sp.end).trim().length > 0;
  });
  let litColors = 0;
  let firstColorLine = 1;
  for (const sp of colorStrings) {
    const lit = raw.slice(sp.start, sp.end);
    const matches = [...lit.matchAll(/\brgba?\s*\(|(?:^|[^A-Za-z0-9_])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![A-Za-z0-9_])/g)];
    if (matches.length) {
      if (!litColors) firstColorLine = lineAt(raw, sp.start);
      litColors += matches.length;
    }
  }
  const palRefs = (colorCode.match(/\bP\.[A-Za-z_]\w*\b|\bcol\s*\(\s*P\b|\bC_(?:INK|INK2|BONE|SIGNAL|CYAN|ASH|GRAPHITE)\b/g) ?? []).length;
  if (litColors > palRefs && litColors > 0) {
    out.push({
      code: 'CRAFT-COLOR',
      file,
      line: firstColorLine,
      count: litColors,
      msg: `${file}:${firstColorLine} 硬编码色值 ${litColors} 处 > 调色板引用 ${palRefs} 处，请改用 ctx.P + css(P.x, a)`,
    });
  }

  return out;
}

/**
 * 任务级偷懒信号（纯函数）。
 * @param {{
 *   segments: number | any[],
 *   durations?: number[],
 *   templateTypes?: string[],
 *   hasWorld?: boolean,
 *   sourceTexts?: (string | { file: string, text: string })[],
 * }} opts
 * @returns {{ code: string, file: string|null, line: number|null, count: number, msg: string }[]}
 */
export function taskSignals(opts) {
  const segList = Array.isArray(opts?.segments) ? opts.segments : null;
  const segCount = segList ? segList.length : Number(opts?.segments ?? 0);
  const durs = Array.isArray(opts?.durations)
    ? opts.durations.map(Number).filter(Number.isFinite)
    : (segList ?? []).map((s) => Number(s?.dur ?? (s?.end != null && s?.start != null ? s.end - s.start : 0)));
  const totalDur = durs.reduce((a, b) => a + b, 0);
  const tplList = (Array.isArray(opts?.templateTypes) ? opts.templateTypes : []).filter((t) => t && t !== 'placeholder');
  const hasWorld = !!opts?.hasWorld;
  const sources = (Array.isArray(opts?.sourceTexts) ? opts.sourceTexts : []).map((x) => {
    const raw = typeof x === 'string' ? x : String(x?.text ?? '');
    return stripJsComments(raw).code;
  });

  /** @type {{ code: string, file: string|null, line: number|null, count: number, msg: string }[]} */
  const out = [];

  if (segCount === 1 && totalDur > 15) {
    out.push({
      code: 'CRAFT-MONO',
      file: null,
      line: null,
      count: 1,
      msg: `全片 ${totalDur.toFixed(1)}s 只有 1 个镜头段 —— 超过 15s 的片子应拆出叙事分段与起伏节奏`,
    });
  }

  if (segCount > 0 && tplList.length > 0) {
    const ratio = tplList.length / segCount;
    /** @type {Record<string, number>} */
    const counts = {};
    for (const t of tplList) counts[t] = (counts[t] ?? 0) + 1;
    const repeated = Object.entries(counts).filter(([, c]) => c >= 3);
    if (ratio > 0.4 || repeated.length > 0) {
      const parts = [];
      if (ratio > 0.4) parts.push(`模板段占比 ${(ratio * 100).toFixed(0)}%（${tplList.length}/${segCount}，上限 40%）`);
      if (repeated.length) parts.push(`同模板重复过多：${repeated.map(([k, v]) => `${k}×${v}`).join('、')}（上限 2 次）`);
      out.push({
        code: 'CRAFT-TEMPLATE',
        file: null,
        line: null,
        count: tplList.length,
        msg: parts.join('；'),
      });
    }
  }

  if (sources.length) {
    const joined = sources.join('\n');
    if (!/\b(?:cameraPost|zoom|camera3|makeShot|makeThreeShot|shakeSmooth)\b/.test(joined)) {
      out.push({
        code: 'CRAFT-STATIC-CAM',
        file: null,
        line: null,
        count: 1,
        msg: '源码中未检测到任何摄影机运动（cameraPost / zoom / camera3 / makeShot / makeThreeShot / shakeSmooth）',
      });
    }
  }

  if (segCount > 1 && !hasWorld) {
    out.push({
      code: 'CRAFT-NOWORLD',
      file: null,
      line: null,
      count: 1,
      msg: `多段片子（${segCount} 段）未声明共享背景 world（export const world 或 world: 'auto'）`,
    });
  }

  return out;
}

/**
 * 单帧像素级偷懒信号（纯函数）。
 * @param {Uint8Array | Uint8ClampedArray | Buffer} rgba
 * @param {number} w
 * @param {number} h
 * @returns {{
 *   signals: { code: string, msg: string }[],
 *   stats: { emptyCells: number, totalCells: number, emptyRatio: number, modeLum: number, p5: number, p95: number, lumRange: number },
 * }}
 */
export function pixelSignals(rgba, w, h) {
  const n = w * h;
  if (!rgba || n <= 0 || rgba.length < n * 4) {
    return {
      signals: [],
      stats: { emptyCells: 0, totalCells: 144, emptyRatio: 0, modeLum: 0, p5: 0, p95: 0, lumRange: 0 },
    };
  }

  const lums = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const off = i * 4;
    const lum = (0.2126 * rgba[off] + 0.7152 * rgba[off + 1] + 0.0722 * rgba[off + 2]) / 255;
    lums[i] = lum;
    const bin = Math.max(0, Math.min(255, Math.round(lum * 255)));
    hist[bin]++;
  }

  let modeBin = 0;
  let modeCount = -1;
  for (let b = 0; b < 256; b++) {
    if (hist[b] > modeCount) { modeCount = hist[b]; modeBin = b; }
  }
  const modeLum = modeBin / 255;

  const t5 = n * 0.05;
  const t95 = n * 0.95;
  let acc = 0;
  let p5Bin = 0;
  let p95Bin = 255;
  let got5 = false;
  for (let b = 0; b < 256; b++) {
    acc += hist[b];
    if (!got5 && acc >= t5) { p5Bin = b; got5 = true; }
    if (acc >= t95) { p95Bin = b; break; }
  }
  const p5 = p5Bin / 255;
  const p95 = p95Bin / 255;
  const lumRange = p95 - p5;

  const COLS = 16;
  const ROWS = 9;
  let emptyCells = 0;
  const totalCells = COLS * ROWS;

  for (let cy = 0; cy < ROWS; cy++) {
    const y0 = Math.floor((cy * h) / ROWS);
    const y1 = Math.floor(((cy + 1) * h) / ROWS);
    for (let cx = 0; cx < COLS; cx++) {
      const x0 = Math.floor((cx * w) / COLS);
      const x1 = Math.floor(((cx + 1) * w) / COLS);
      let cnt = 0;
      let sum = 0;
      let sumSq = 0;
      for (let y = y0; y < y1; y++) {
        const rowOff = y * w;
        for (let x = x0; x < x1; x++) {
          const v = lums[rowOff + x];
          sum += v;
          sumSq += v * v;
          cnt++;
        }
      }
      if (cnt === 0) { emptyCells++; continue; }
      const mean = sum / cnt;
      const variance = Math.max(0, sumSq / cnt - mean * mean);
      const std = Math.sqrt(variance);
      if (std < 0.02 && Math.abs(mean - modeLum) < 0.04) emptyCells++;
    }
  }

  const emptyRatio = emptyCells / totalCells;
  /** @type {{ code: string, msg: string }[]} */
  const signals = [];
  if (emptyRatio > 0.55) {
    signals.push({
      code: 'CRAFT-EMPTY',
      msg: `16×9 网格空格占比 ${(emptyRatio * 100).toFixed(0)}%（${emptyCells}/${totalCells} 格，上限 55%），画面主体太小或大片空洞`,
    });
  }
  if (lumRange < 0.25) {
    signals.push({
      code: 'CRAFT-FLAT',
      msg: `亮度动态范围 p95-p5 = ${lumRange.toFixed(2)}（要求 ≥ 0.25），明暗层级过平`,
    });
  }

  return {
    signals,
    stats: { emptyCells, totalCells, emptyRatio, modeLum, p5, p95, lumRange },
  };
}

/** 汇总手艺扣分（满分 100，每个唯一信号扣 15 分，仅作定量参考）。 */
export function computeCraftScore(findings) {
  const uniqueCodes = new Set((findings ?? []).map((f) => f.code));
  return Math.max(0, 100 - uniqueCodes.size * 15);
}
