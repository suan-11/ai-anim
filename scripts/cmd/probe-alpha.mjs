// @ts-check
import { log, warn } from "../lib/cli/log.mjs";
import { pickTask } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/* ------------------------------------------------------------------ 命令：probe-alpha */

/**
 * P1-3 验收：`type.write` 的 `alpha` 在 `stagger: 0` 时也要参与动画。
 *
 * 判据是机械的：一行字 `alpha: [0, 1]`、`t = f.lt`，在 t=0 / 0.5 / 1 量整帧平均亮度，
 * 必须 0 < 0.5 < 1 地递增（而不是 t=0 就已经是终值）。
 * 修复前 t=0 与 t=1 一样亮 —— 也就是"整行淡入"从来没生效过。
 */
async function cmdProbeAlpha() {
  const task = pickTask();
  await openSession({ task, offline: false });
  try {
    const r = await getSession().page.evaluate(async () => {
      const { Engine } = await import('/src/core/engine.js');
      const { makePalette } = await import('/src/core/palette.js');
      const { css } = await import('/src/core/util.js');

      const cv = document.createElement('canvas');
      cv.style.cssText = 'position:fixed;left:-10000px;top:0';
      document.body.appendChild(cv);
      const eng = new Engine(cv, { width: 960, height: 540, scale: 1, fps: 60, palette: makePalette({}) });
      eng.hud = false;

      const scene = {
        id: 'alpha_probe',
        render(ctx) {
          const { gl, text, type, P, f } = ctx;
          gl.clear(ctx.out, [0.01, 0.01, 0.012]);
          text.clear();
          // stagger 刻意不写（= 0）：这正是出问题的那条路径
          type.write('ALPHA', 480, 300, {
            size: 220, weight: 900, family: 'sans', align: 'left',
            color: css(P.bone), alpha: [0, 1], t: f.lt, staggerDur: 1,
          });
          text.upload();
          ctx.comp.draw(gl, text, ctx.out, { premult: false });
          // 关掉会污染"平均亮度"的后处理（泛光/颗粒），让读数只反映字
          return { bloom: 0, bloomThreshold: 9, halation: 0, grain: 0, vignette: 0, ca: 0, flash: 0, fade: 0, exposure: 1 };
        },
      };
      await eng.load({ timeline: [{ id: 'a', scene, start: 0, end: 4, params: {} }], duration: 4 });
      const out = [];
      for (const t of [0, 0.5, 1, 2]) {
        eng.render(t, { samples: 1, toScreen: false });
        const px = eng.readPixels();
        let sum = 0;
        for (let i = 0; i < px.length; i += 4) {
          sum += (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
        }
        out.push({ t, mean: sum / (px.length / 4) });
      }
      // 参考帧：同样一条时间线、**同样的 post**，但场景一笔不画。
      // ⚠ post 必须与下面各用例逐项一致：`meanOf` 是"减去参考"，而暗角/泛光/颗粒
      //   会把同一个线性值映射成不同的显示亮度。第一版这里用了默认 post，
      //   于是参考值偏大，`alpha:0.5` 与"静默帧"都被算成了负数（假的 FAIL）。
      //
      // ⚠⚠ 还有一条**必须踩对**的：canvas 不能是 `display:none` 那种被隐藏的尺寸，
      //   而且每一段用例必须**重新 load**（换 timeline）—— 见下面 narrScene 那段注释。
      const SENTINEL = [0.01, 0.01, 0.012];
      /** 关掉所有会污染"平均亮度"读数的后处理，让读数只反映场景画了什么。 */
      const POST_OFF = {
        bloom: 0, bloomThreshold: 9, halation: 0, grain: 0, vignette: 0,
        ca: 0, flash: 0, fade: 0, exposure: 1, contrast: 1, saturation: 1, lift: 0, shoulder: 1000,
      };
      const sceneEmpty = { id: 'empty', render(c) { c.gl.clear(c.out, SENTINEL); return { ...POST_OFF }; } };
      await eng.load({ timeline: [{ id: 'e', scene: sceneEmpty, start: 0, end: 4, params: {} }], duration: 4 });
      eng.render(0, { samples: 1, toScreen: false });
      const px0 = eng.readPixels();
      let s0 = 0, mx0 = 0;
      for (let i = 0; i < px0.length; i += 4) {
        const lum = (px0[i] * 0.2126 + px0[i + 1] * 0.7152 + px0[i + 2] * 0.0722) / 255;
        s0 += lum; if (lum > mx0) mx0 = lum;
      }
      const blank = s0 / (px0.length / 4);
      // ⚠ 光看 mean 分不清"空参考帧"和"错帧卡片"（错帧卡片也会有一个中等偏亮的 mean）。
      //   把 max 也量出来：只 clear 一个暗色时 max ≈ 0.10，而错帧卡片有亮红边框 → max ≈ 0.9。
      //
      // ⚠⚠ 这个数是 **0.10 不是 0.06**（BACKLOG 1-5 核正过，2026-10-16）：`readPixels()` 读的是
      //   **sRGB 编码之后**的显示空间值，而 SENTINEL 那个 0.01 是**线性**值 ——
      //   `lin2srgb(0.01) ≈ 0.1005`。0.06 是拿线性值当显示值算出来的（旧注释写错了口径）。
      //   **别照着它去"修" blank**：把 0.10 掰成 0.06 会让 ⑤⑥ 两条判据集体失真。
      //   相对判据（下面的 `meanOf()` 减参考）本来就不受这个口径影响。
      const blankMax = mx0;
      void SENTINEL;
      // 参考帧的 post 到底是什么？判据依赖"用例与参考用同一套 post"，
      // 而 post 是**逐帧**由场景返回值和 `item.post` 合并出来的 —— 直接把它读出来核对。
      const blankPost = { ...eng.lastPost, tint: '(略)', center: '(略)' };

      /**
       * P0-1 用例：**数值型 alpha**（常量不透明度）。
       * 以前 `opts.alpha !== undefined` 被当成"要按 t 动画" → `t` 缺省 0 ⇒ `k = 0`
       * ⇒ 字形直接 `continue`（整个不画），而不是画成透明。
       * 判据：alpha 是多少就该有多亮，而且**与 t 无关**。
       */
      const meanOf = (px) => {
        let s = 0;
        for (let i = 0; i < px.length; i += 4) s += (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
        return s / (px.length / 4) - blank;
      };
      const constScene = (alpha) => ({
        id: 'const_alpha',
        render(c) {
          const { gl, text, type, P } = c;
          gl.clear(c.out, [0.01, 0.01, 0.012]);
          text.clear();
          // ⚠ 刻意不传 t、不传 stagger：这正是踩坑的那条路径
          type.write('ALPHA', 480, 300, {
            size: 220, weight: 900, family: 'sans', align: 'left',
            color: css(P.bone), alpha,
          });
          text.upload();
          c.comp.draw(gl, text, c.out, { premult: false });
          return { ...POST_OFF };
        },
      });
      const constAlpha = {};
      const constPost = {};
      for (const a of [1, 0.5]) {
        await eng.load({ timeline: [{ id: 'c', scene: constScene(a), start: 0, end: 4, params: {} }], duration: 4 });
        const vals = [];
        for (const t of [0, 2]) {
          eng.render(t, { samples: 1, toScreen: false });
          vals.push(meanOf(eng.readPixels()));
        }
        constAlpha[a] = vals;
        constPost[a] = { ...eng.lastPost, tint: '(略)', center: '(略)' };
      }

      /**
       * P1-5 用例：**旁白表真的进了引擎**吗？
       *
       * 单测（`tools/test-narration.mjs`）只验了 `makeNarration` 这些纯函数；
       * 这里验的是"接线"：`load({ narration })` → `ctx.narration` / `f.narration` → 场景里能查到。
       *
       * 判据刻意**用逻辑而不是像素**：像素受后处理/误差影响太大，
       * 而这一条要回答的只是"场景能不能拿到旁白表"。所以场景自己把查到的句子 id
       * **画成一个白点**（画在固定位置），再用"有没有白点"当布尔量 ——
       * 同时顺手证明"旁白表能驱动画面"这件事本身是通的。
       */
      const narrScene = {
        id: 'narr',
        render(c) {
          c.gl.clear(c.out, [0.01, 0.01, 0.012]);
          const q = c.narration?.at(c.f.t) ?? c.f.narration?.at(c.f.t);
          if (q) {
            // 一个 40×40 的纯白方块：在只有 0.01 灰底的画面上，它是"有没有"的布尔量
            c.lines.begin();
            c.lines.fillRect(400, 240, 40, 40, [1, 1, 1, 1]);
            c.lines.flush(c.out);
          }
          return { ...POST_OFF };
        },
      };
      const narrSpec = {
        lines: [
          { id: 'n1', text: '第一句旁白', start: 0.5, dur: 1.5 },
          { id: 'n2', text: '第二句旁白', start: 2.5, dur: 1.0 },
        ],
      };
      await eng.load({ timeline: [{ id: 'n', scene: narrScene, start: 0, end: 4, params: {} }], duration: 4, narration: narrSpec });
      const narr = {};
      for (const [key, t] of [['a', 0.2], ['b', 1.25], ['c', 3.5]]) {
        eng.render(t, { samples: 1, toScreen: false });
        const q = eng.narration?.at(t);
        // 峰值亮度：白方块在 → 明显高；不在 → 只有底色
        let mx = 0;
        const px = eng.readPixels();
        for (let i = 0; i < px.length; i += 4) {
          const lum = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
          if (lum > mx) mx = lum;
        }
        narr[key] = {
          peak: mx,
          id: q?.id ?? null,
          p: q?.p ?? null,
          typed: q?.typedText ?? null,
          lineCount: eng.narration?.lines?.length ?? 0,
          warnings: eng.narration?.warnings?.length ?? -1,
          durOf: eng.narration?.durOf?.('n1') ?? null,
        };
      }
      eng.dispose();
      cv.remove();
      // 把**没减过参考**的原始读数一起带回来：判据出问题时能一眼看出是"参考帧"还是"用例"的问题
      return {
        frames: out, blank, blankMax, constAlpha, narr,
        raw: { blank, c1: constAlpha[1][0] + blank, ch: constAlpha[0.5][0] + blank },
        posts: { blank: blankPost, c1: constPost[1], ch: constPost[0.5] },
      };
    });

    log(`参考（只有背景、没有字）：mean ${r.blank.toFixed(5)}  max ${r.blankMax?.toFixed(4)}`
      // ⚠ 0.10 而不是 0.06：readPixels 是 sRGB 编码后的显示空间，lin2srgb(0.01) ≈ 0.1005（BACKLOG 1-5）
      + `（只 clear 一个暗色时 max 应 ≈0.10；≈0.9 说明画的是**错帧卡片**而不是空参考）`);
    log('一行字 alpha:[0,1]、stagger:0（不写）—— 减去参考后的平均亮度：');
    const r2 = r.frames.map((x) => ({ t: x.t, mean: x.mean - r.blank }));
    for (const x of r2) log(`  t=${x.t.toFixed(2)}  mean ${x.mean.toFixed(5)}`);
    const [a, b, c, d] = r2.map((x) => x.mean);
    const c1 = a < 0.004;                 // ① t=0 几乎看不见
    const c2 = b > a + 0.003;             // ② 0.5 明显亮于 0
    const c3 = c > b + 0.001;             // ③ 1 明显亮于 0.5
    const c4 = Math.abs(d - c) < 0.001;   // 到 1 之后就不再变（到位了）
    log(`\n① t=0 不可见（mean ${a.toFixed(5)} < 0.004）  → ${c1 ? 'PASS' : 'FAIL'}`);
    log(`② t=0.5 在淡入（${b.toFixed(5)} > ${a.toFixed(5)} + 0.003）  → ${c2 ? 'PASS' : 'FAIL'}`);
    log(`③ t=1 更亮（${c.toFixed(5)} > ${b.toFixed(5)} + 0.001）  → ${c3 ? 'PASS' : 'FAIL'}`);
    log(`④ t≥1 不再变（|${d.toFixed(5)} − ${c.toFixed(5)}| < 0.001）  → ${c4 ? 'PASS' : 'FAIL'}`);

    // ⑤⑥ P0-1：数值型 alpha 是**常量**不透明度 —— 必须画得出来，且与 t 无关
    const full = r.constAlpha?.[1] ?? null;
    const half = r.constAlpha?.[0.5] ?? null;
    let c5 = false, c6 = false;
    if (full && half) {
      const [f0, f2] = full, [h0, h2] = half;
      c5 = f0 > 0.004 && f2 > 0.004;                       // alpha:1 在 t=0 与 t=2 都画出来了
      c6 = Math.abs(f0 - f2) < 0.0008                      // 常量：两帧一样亮
        && h0 > 0.001 && h0 < f0 * 0.95;                   // alpha:0.5 明显比 1 淡（但没有消失）
      log(`⑤ alpha:1（数值）画得出来（t=0 ${f0.toFixed(5)}、t=2 ${f2.toFixed(5)} > 0.004）  → ${c5 ? 'PASS' : 'FAIL'}`);
      log(`⑥ alpha:0.5 是半透明常量（${h0.toFixed(5)} 在 (0.001, ${(f0 * 0.95).toFixed(5)}) 且 t=2 同值 ${h2.toFixed(5)}）  → ${c6 ? 'PASS' : 'FAIL'}`);
    } else {
      log('⑤⑥ 数值型 alpha 用例没有拿到读数  → FAIL');
    }
    // ⑦⑧⑨ P1-5：旁白表有没有真的接进引擎
    //
    // 判据分两层，**不依赖"参考帧减去"那套**（那是给 alpha 用的，跨场景比较会带上后处理差异）：
    //   · 逻辑层：`ctx.narration` 能查到正确的句子 / 进度 / 时长（这是接线本身）；
    //   · 像素层：场景按旁白表画了白方块 —— **在说话的那一帧一定能看到纯白**（peak ≈ 1.0）。
    //     ⚠ 只断言"看得到"这一侧就够了：`at()` 已经证明"静默帧查不到"（n35.id === null），
    //       而"没在说话就不画"是同一行代码的同一条分支，不需要再用像素验第二遍。
    const nr = r.narr ?? {};
    const n02 = nr.a, n125 = nr.b, n35 = nr.c;
    let c7 = false, c8 = false, c9 = false;
    if (n02 && n125 && n35) {
      c7 = n02.lineCount === 2 && n125.lineCount === 2
        // ⚠ t=0.2 在第一句（start=0.5）**之前** → 必须是 null。
        //   这一条正好覆盖"句子之间/之前不算在说"这个边界。
        && n02.id === null && n125.id === 'n1' && n35.id === null
        && n02.durOf === 1.5 && n125.durOf === 1.5;
      c8 = n125.p !== null && Math.abs(n125.p - 0.5) < 0.02 && n125.typed === '第一';
      // 在说 → 画面里有纯白方块；静默 → 只有底色（peak 就是底色的亮度）
      c9 = n125.peak > 0.9 && n35.peak < 0.5;
      log(`⑦ 旁白表进了引擎：lines=${n02.lineCount}  durOf('n1')=${n02.durOf}s  `
        + `t=0.2 → ${n02.id ?? 'null'}（第一句之前）、t=1.25 → ${n125.id}、t=3.5 → ${n35.id ?? 'null'}（静默）  → ${c7 ? 'PASS' : 'FAIL'}`);
      log(`⑧ 进度正确：t=1.25 的 p=${n125.p?.toFixed(3)}（期望 ≈0.5），typedText="${n125.typed}"  → ${c8 ? 'PASS' : 'FAIL'}`);
      log(`⑨ 旁白能驱动画面：在说那一帧峰值 ${n125.peak.toFixed(4)}（纯白方块），静默帧 ${n35.peak.toFixed(4)}  → ${c9 ? 'PASS' : 'FAIL'}`);
    } else {
      log(`⑦⑧⑨ 旁白用例没有拿到读数（${JSON.stringify(nr)}）  → FAIL`);
    }

    if (!(c1 && c2 && c3 && c4)) {
      warn('\n✗ alpha 没有随 t 动画 —— 检查 src/core/text.js 里 `k` 的计算条件');
      process.exitCode = 1;
    }
    if (!(c5 && c6)) {
      warn('\n✗ 数值型 alpha 语义不对（docs/history/IMPROVEMENTS-1-3.md P0-1）—— 它必须是常量不透明度，');
      warn('  且 alpha:1 必须画得出来。检查 text.js 里 `alphaIsRamp` / `constAlpha` 两行。');
      process.exitCode = 1;
    }
    if (!(c7 && c8 && c9)) {
      warn('\n✗ 旁白层接线有问题（docs/history/IMPROVEMENTS-1-3.md P1-5）—— 检查 engine.load 有没有收到 narration、');
      warn('  _ctxFor 有没有把 this.narration 挂到 ctx 与 f 上。');
      process.exitCode = 1;
    }
    if (c1 && c2 && c3 && c4 && c5 && c6 && c7 && c8 && c9) {
      log('\n✓ alpha 语义全对（数组型随 t 动画 P1-3、数值型是常量 P0-1）+ 旁白层已接通（P1-5）');
    }
  } finally { await closeSession(); }
}
export { cmdProbeAlpha as run };
