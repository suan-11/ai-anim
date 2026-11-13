// @ts-check
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flag, opt } from "../lib/cli/args.mjs";
import { reportErrors } from "../lib/cli/gates.mjs";
import { die, log, warn } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/**
 * 确定性指纹：同一 t 渲染出来的像素指纹 / 与基线的逐像素比对。
 *
 * 这是**重构的验收工具**：改了引擎、或把场景抽成模板之后，跑一遍前后对比，
 * 就能机械地证明「画面没变」——比人眼看图可靠，也比存一堆 PNG 便宜。
 *
 *   node scripts/anim.mjs hashes demo --every 2 --save       # 打指纹并存成基线
 *   node scripts/anim.mjs hashes demo --baseline             # 与基线逐像素比对
 *   node scripts/anim.mjs hashes demo --times 1,2.5,6        # 只看某几个时刻
 *
 * ⚠ 判定方式不是"哈希相等"，而是**差了多少**：同一时刻是 t 的纯函数，
 *   但 GPU 在少数 tile 上有最后一位（1/255）的噪声（交叠到 95% 的转场帧尤其敏感），
 *   跨进程重渲可能差 1 个 LSB。所以基线连原始像素一起存，比对时报 max / mean。
 *   判据**只有一处**：`negligible()` —— **差过 16/255 的像素一个都不许有**（`over16 === 0`）
 *   且 `mean < 0.002` ⇒ 逐像素没变。16 在 8bit 显示空间里已经能看出台阶，而实测噪声天花板是 10
 *   （反复重渲同一份基线稳定得到 max 8–10），中间留了一档余量。
 *   ⚠ 别照抄别处的说法（日志里打的是 `>16` / `>32` 两列，`max` 只是给人看的读数，**不参与判定**）。
 */
async function cmdHashes() {
  const task = pickTask();
  const every = Number(opt('every', '0'));
  const timesArg = opt('times', opt('t', ''));
  const scale = Number(opt('scale', '0')) || undefined;
  const only = opt('only', '');
  const baseFile = path.resolve(ROOT, opt('file', taskOut(task, `hashes${only ? '_' + only.replace(/,/g, '-') : ''}.json`)));
  const accept = flag('accept');
  const force = flag('force');
  const note = String(opt('note', '') || '').trim();
  const useBaseline = flag('baseline') || accept;
  const baseExists = existsSync(baseFile);

  /**
   * 基线是**变更探测器**，不是"画面永远不许变"（2026-10-24 拍板，见 `docs/BACKLOG.md` §4）。
   *
   * 以前这里只有一个隐含规矩：改完引擎必须让 22 帧逐像素不变 —— 于是任何**有意的**视觉改进
   * 都被挡在门外（1-41 的 blur 就是被这条逼成"默认 0"的）。现在拆成四种明确用法：
   *
   *   `--save`              第一次存基线；**已存在时拒绝覆盖**（防止"改完顺手重存"绕过比对）
   *   `--baseline`          比对；不一致 ⇒ 退出码 1。它回答"变了没有"，不回答"该不该变"
   *   `--accept --note "…"` 有意改画面：先比一遍、落一张前后对比图、再存新基线（原因进 `notes`）
   *   `--force`             只想重存（不推荐；比对会断掉，基线里留一条 force 记录）
   *
   * 判据仍然是 `negligible()`（over16 === 0 且 mean < 0.002），没有放松 —— 放松的是**流程**：
   * 有意的变化要**被看见、被说明**，而不是被"改回去"。
   */
  if (accept) {
    if (!baseExists) die(`没有基线可接受：${path.relative(ROOT, baseFile)} 不存在。第一次先跑 --save。`);
    if (!note) {
      die(`--accept 必须带 --note "这次画面为什么该变"。\n`
        + `  基线的作用是**抓住没注意到的变化**；接受一次视觉改动是决定，不是例行公事：\n`
        + `  node scripts/anim.mjs hashes ${task} --accept --note "title 默认开启 18px 虚焦入场（1-41 后续）"`);
    }
  } else if (!useBaseline && baseExists && !force) {
    die(`基线已经存在：${path.relative(ROOT, baseFile)}。\n`
      + `  · 有意改了画面：--accept --note "改了什么、为什么"（会先比一遍、落对比图，再存）\n`
      + `  · 只是重存一遍：--force（不推荐 —— 比对会断掉）`);
  }

  await openSession({ task, scale, only: only || undefined });
  try {
    const info = getSession().info;
    /** @type {{ t: number, buf: Buffer, stats: any }[]} */
    const changed = [];
    let baseCount = 0;
    /** @type {any} */
    let baseJson = null;
    if (baseExists) {
      baseJson = JSON.parse(readFileSync(baseFile, 'utf8'));
      baseCount = Array.isArray(baseJson.frames) ? baseJson.frames.length : 0;
    }

    if (useBaseline) {
      const j = baseJson;
      if (!j || !Array.isArray(j.frames)) die(`基线文件格式不对：${path.relative(ROOT, baseFile)}（没有 frames 数组）。`);
      const lastNote = Array.isArray(j.notes) && j.notes.length ? j.notes[j.notes.length - 1] : null;
      log(`与基线比对：${path.relative(ROOT, baseFile)}（${j.frames.length} 帧，${j.width}×${j.height}×${j.scale}）`);
      if (lastNote) log(`  上一次接受：${lastNote.at}  ${lastNote.note}`);
      let bad = 0;
      let prev = null;
      for (const f of j.frames) {
        // 相邻帧做 delta 再存 base64（原始 8.3MB/帧，帧间差异很小）
        const cur = f.delta ? deltaDecode(prev, Buffer.from(f.delta, 'base64'), j.bytes) : Buffer.from(f.pixels, 'base64');
        prev = cur;
        const r = await getSession().page.evaluate(
          ([tt, b64]) => /** @type {any} */ (window).__anim.diffToB64(b64, tt, { samples: 1 }),
          [f.t, cur.toString('base64')],
        );
        // 判据**以 negligible() 为准**（函数头那段）：over16 === 0 且 mean < 0.002。
        // 日志里的 max / >16 / >32 是给人看的读数，哪一个都不单独构成判据。
        const same = negligible(r);
        if (!same) { bad++; changed.push({ t: f.t, buf: cur, stats: r }); }
        log(`  t=${f.t.toFixed(3)}  ${same ? '✓ 画面一致' : '✗ 变了'}  max ${r.max}  mean ${r.mean.toFixed(4)}  >16 ${(r.over16 * 100).toFixed(4)}%  >32 ${(r.over32 * 100).toFixed(4)}%`);
      }
      if (bad) {
        const sheet = await writeHashesDiffSheet(task, changed, j.width * j.scale, j.height * j.scale);
        warn(`\n✗ ${bad}/${j.frames.length} 帧与基线不一致（逐像素差异超出噪声范围）`);
        if (sheet) log(`  前后对比图：${path.relative(ROOT, sheet)}（每行左 = 基线、右 = 现在）`);
        if (!accept) {
          warn(
            `  这是**变更探测器**，不是"画面永远不许变"。两种收场：\n`
            + `    · 有意改的 → node scripts/anim.mjs hashes ${task} --accept --note "改了什么、为什么"\n`
            + `    · 不该变的 → 把改动改回去，重跑这一条\n`
            + `  （已交付片子的 mp4 是既成产物，不会因为基线更新而被重渲。）`,
          );
          process.exitCode = 1;
          reportErrors(getSession().info);
          return;
        }
        log('  ✓ 已确认这次变化（note 会写进基线，下一次比对失败时会打出来）');
      } else {
        log(`\n✓ ${j.frames.length} 帧全部与基线一致（画面没有被改动）`);
        if (!accept) { reportErrors(getSession().info); return; }
        log('  没有变化，不需要接受 —— 只补一条 note 记录。');
      }
    }

    const dur = info.onlyDuration || info.duration;
    /**
     * ⚠ **`--accept` 必须沿用基线自己的采样时刻**（2026-10-24 修）。
     *
     * 在修之前这三条分支对 `--accept` 一视同仁：没写 `--every` 就回落到"默认 4 帧"
     * （`[0, 25%, 50%, 75%]`）。而基线通常是 `--every 2` 存的 11 帧 —— 于是一次
     * `hashes demo --accept --note …` 会把基线**从 11 帧悄悄缩成 4 帧**：
     * 检查密度掉了 64%，而日志只说"已确认这次变化"。
     *
     * 这是变更探测器上最不该有的那种损失：它不报错、不违反判据，只是**以后更查不出东西**了
     * （实测：0-3 与字体两次 accept 之后 demo 基线只剩 4 帧）。
     * 所以 `--accept` 时优先用基线里那批 `t`；只有第一次存基线（没有基线可继承）才用默认采样。
     */
    const baselineTimes = accept && Array.isArray(baseJson?.frames) && baseJson.frames.length
      ? baseJson.frames.map((f) => Number(f.t)).filter(Number.isFinite)
      : null;
    const times = timesArg
      ? timesArg.split(',').map(Number).filter(Number.isFinite)
      : every > 0
        ? Array.from({ length: Math.max(1, Math.ceil(dur / every)) }, (_, i) => i * every).filter((t) => t < dur)
        : baselineTimes && baselineTimes.length
          ? baselineTimes
          : [0, dur * 0.25, dur * 0.5, dur * 0.75].map((x) => Math.round(x * 1000) / 1000);
    if (!times.length) die('--times 需要给时间，例如 --times 0,2.5,6');
    if (baselineTimes && !timesArg && !(every > 0)) {
      log(`  （沿用基线原有的 ${times.length} 帧采样 —— --accept 不该改变检查密度）`);
    }

    /** @type {{ task: string, width: number, height: number, scale: number, bytes: number,
     *          format: number, savedAt: string, notes: any[], frames: any[] }} */
    const snap = {
      task, width: info.width, height: info.height, scale: info.scale, bytes: 0,
      format: 2, savedAt: new Date().toISOString(),
      // notes 是**审计轨迹**：基线为什么被接受过。没有它，`--accept` 就只是"把红的刷绿"。
      notes: Array.isArray(baseJson?.notes) ? baseJson.notes : [],
      frames: [],
    };
    if (accept) {
      snap.notes.push({
        at: snap.savedAt, note, changed: changed.length, total: baseCount || times.length,
        frames: changed.map((c) => Number(c.t.toFixed(3))),
      });
    } else if (force && baseExists) {
      snap.notes.push({ at: snap.savedAt, note: note || '（--force 重存，没有说明）', changed: null, total: times.length, force: true });
    }

    let prev = null;
    /**
     * ⚠ 基线是**一个 JSON 文件**，写和读都要经过 V8 的**单个字符串**（上限约 512MB）。
     * 每帧存的是"整帧像素 delta 之后的 base64"，delta 压不掉时就是 4/3 倍整帧。
     * 长片子很容易顶爆 —— 实测 sodium（246s、`--every 4`、62 帧）直接死在
     * `JSON.stringify` 上：`RangeError: Invalid string length`；而且**就算写出来也没用**，
     * `--baseline` 那侧的 `readFileSync` + `JSON.parse` 一样读不回来。
     * 所以攒到上限附近就当场停下，并给出这一轮真正能用的参数。
     */
    const B64_CAP = 380e6;
    let b64Total = 0;
    for (const t of times) {
      const r = await getSession().page.evaluate(
        (tt) => /** @type {any} */ (window).__anim.hash(tt, { samples: 1, pixels: true }),
        t,
      );
      const cur = Buffer.from(r.pixels, 'base64');
      snap.bytes = cur.length;
      const delta = deltaEncode(prev, cur).toString('base64');
      b64Total += delta.length;
      if (b64Total > B64_CAP) {
        die(`基线装不下：已经攒到 ${(b64Total / 1048576).toFixed(0)}MB（上限 ${(B64_CAP / 1048576).toFixed(0)}MB）。\n`
          + `  基线是单个 JSON 文件，超过 V8 的字符串上限（约 512MB）就写不出来、也读不回来。\n`
          + `  这一轮是 ${times.length} 帧 × ${(snap.bytes / 1048576).toFixed(1)}MB/帧（${dur.toFixed(0)}s 的片子）。\n`
          + `  → 采样放稀：--every ${Math.max(8, Math.ceil((every || dur / times.length) * 2))}，`
          + `或改用 --times 只挑每段的中间时刻。`);
      }
      snap.frames.push({ t, hash: r.hash, delta });
      prev = cur;
      log(`${t.toFixed(3)}\t${r.hash}\t${r.bytes}`);
    }
    mkdirSync(path.dirname(baseFile), { recursive: true });
    writeFileSync(baseFile, JSON.stringify(snap));
    log(`· 指纹已存 ${path.relative(ROOT, baseFile)}（${(statSync(baseFile).size / 1048576).toFixed(1)} MB）`);
    if (accept) log(`· 接受记录已写进基线的 notes（${snap.notes.length} 条）：${note}`);
    reportErrors(getSession().info);
  } finally { await closeSession(); }
}

/**
 * 把「基线 vs 现在」画成一张对比图 —— `--baseline` 失败 / `--accept` 时的**审查入口**。
 *
 * 左列是基线里存的那一帧（从 delta 还原出的原始 RGBA），右列是现在重渲的一帧。
 * 最多 8 行：够看清改了什么，再多也没人看。基线里存的是**像素**不是图片，
 * 所以这里要自己做一次行翻转（`readPixels` 自下而上，canvas 自上而下）。
 *
 * @param {string} task
 * @param {{ t: number, buf: Buffer, stats: any }[]} changed
 * @param {number} W 物理像素宽 @param {number} H 物理像素高
 * @returns {Promise<string|null>} 图片路径（没有变化时 null）
 */
async function writeHashesDiffSheet(task, changed, W, H) {
  if (!changed.length) return null;
  const rows = changed.slice(0, 8);
  const out = path.join(ROOT, 'out', task, 'hashes-diff.png');
  const dataUrl = await getSession().page.evaluate(async ({ items, W, H, rows }) => {
    const api = /** @type {any} */ (window).__anim;
    const cellW = 640;
    const cellH = Math.max(1, Math.round(cellW * H / W));
    const pad = 8;
    const label = 20;
    const cv = document.createElement('canvas');
    cv.width = pad * 3 + cellW * 2;
    // 最后一行下面还有 label 那行字，所以底部要多留一个 pad（第一版按 rows*(…) 算，标签被裁掉了一半）。
    cv.height = pad * 2 + rows * (cellH + label + pad);
    const c = cv.getContext('2d');
    c.fillStyle = '#1a1a1c'; c.fillRect(0, 0, cv.width, cv.height);
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const offc = off.getContext('2d', { willReadFrequently: true });
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const bytes = Uint8Array.from(atob(it.b64), (ch) => ch.charCodeAt(0));
      // readPixels 是自下而上；canvas 是自上而下 → 按行翻
      const flipped = new Uint8ClampedArray(bytes.length);
      const row = W * 4;
      for (let y = 0; y < H; y++) flipped.set(bytes.subarray((H - 1 - y) * row, (H - y) * row), y * row);
      offc.putImageData(new ImageData(flipped, W, H), 0, 0);
      const y = pad + i * (cellH + label + pad);
      c.drawImage(off, pad, y + label, cellW, cellH);
      await api.frame(it.t, { samples: 1 });
      const img = new Image();
      img.src = api.png();
      await img.decode();
      c.drawImage(img, pad * 2 + cellW, y + label, cellW, cellH);
      c.fillStyle = '#ddd'; c.font = '13px monospace';
      c.fillText(`t=${it.t.toFixed(3)}s   max ${it.max}  mean ${it.mean.toFixed(3)}  >16 ${(it.over16 * 100).toFixed(3)}%`, pad, y + 14);
      c.fillStyle = '#888';
      c.fillText('基线（改动前）', pad + 2, y + label + cellH + 13);
      c.fillText('现在（改动后）', pad * 2 + cellW + 2, y + label + cellH + 13);
    }
    return cv.toDataURL('image/png');
  }, {
    items: rows.map((c) => ({
      t: c.t, b64: c.buf.toString('base64'),
      max: c.stats.max, mean: c.stats.mean, over16: c.stats.over16,
    })),
    W, H, rows: rows.length,
  });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
  return out;
}

/**
 * 「画面算不算变了」的判据。
 *
 * 为什么不能要求完全相等：GPU 在少数 tile 上的导数/滤波有最后一位噪声，
 * 交叠到 90% 的转场帧会把它放大。实测 demo 的 t=10/t=12 拿**同一份基线**反复重渲，
 * 稳定得到 max 8–10、mean ≤ 0.0001、差过 8 的像素占比 0%。这属于同一张画面。
 *
 * 判据（>16 一个都不许有 + mean 可忽略）：16/255 在 8bit 显示空间里已经是能看出来的
 * 台阶了，而实测噪声天花板是 10 —— 中间留了一档余量。真正的可见变化（元素错位、
 * 颜色整体偏、少画东西、拼错块）会以远大于 16 的幅度、成千上万个像素同时打破它。
 */
function negligible(r) {
  return r.over16 === 0 && r.mean < 0.002;
}

/** 相邻帧像素 delta（回绕到 255 以内）。 */
function deltaEncode(prev, cur) {
  if (!prev || prev.length !== cur.length) return cur;
  const out = Buffer.allocUnsafe(cur.length);
  for (let i = 0; i < cur.length; i++) out[i] = (cur[i] - prev[i]) & 0xff;
  return out;
}

function deltaDecode(prev, delta, bytes) {
  if (!prev) return Buffer.from(delta);
  const out = Buffer.allocUnsafe(bytes || prev.length);
  for (let i = 0; i < out.length; i++) out[i] = (prev[i] + delta[i]) & 0xff;
  return out;
}
export { cmdHashes as run };
