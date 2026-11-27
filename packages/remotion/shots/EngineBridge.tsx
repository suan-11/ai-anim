/**
 * Remotion 迁移 · 阶段 3：旧引擎 WebGL 桥。
 *
 * 思路：**不重写场景** —— paperfold 的五个镜头（hook/bridge/mechanism/data/close）
 * 连同共享背景、转场、后处理、字幕，全部由旧引擎 `Engine.render(t)` 原样画出；
 * Remotion 只负责帧时钟与取帧。这正好验证阶段 3 的核心命题：
 *   「复杂 WebGL 镜头能否由 Remotion 帧号驱动、任意 seek、可重复渲染」。
 *
 * 生命周期（对照 src/core/engine.js）：
 *   · 初始化：组件挂载时建离屏 canvas → new Engine() → engine.load(spec)（async，
 *     含 shader 编译 / 场景 setup / 字体加载），用 delayRender 挡住截帧直到就绪；
 *   · 每帧：engine.render(t, { samples: 1 }) → readPixels()（线性→sRGB）→ 画进可见 canvas；
 *   · 卸载：engine.dispose() + loseContext，避免 WebGL 上下文泄漏（Chrome 16 个上限）。
 *
 * 确定性：render(t) 是 t 的纯函数（AGENTS §0），samples=1 无子帧平均，
 * 同一 t 无论之前渲过什么帧结果一致 —— 随机跳帧验收由此成立。
 */
import React from 'react';
import { useDelayRender, useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';

export type EngineBridgeProps = {
  /** 任务模块（task.config.mjs 的命名空间），由入口显式 import */
  taskMod: any;
  /** 已解析的旁白表（字符串路径的 narration 由调用方读文件注入） */
  narrationData?: any;
  /** 音频分析结果（可选；paperfold 场景不读 f.a，缺省 SILENT 即可） */
  music?: any;
  /** 预计算音频特征 json（bed.analysis.json）—— 有它就不需要浏览器解码音频 */
  analysis?: any;
  /** 节奏表（tasks/<任务>/rhythm.json）—— cinematic/datafield 读 f.rhythm 做显著性塑形 */
  rhythm?: any;
  /** 每帧采样数：1 = 无运动模糊（确定性验收）；'auto' = 旧引擎自适应子帧 */
  samples?: number | 'auto';
  /** 快门（samples>1 时有效），对照旧引擎默认 0.5 */
  shutter?: number;
};

type BridgeState = {
  engine: any | null;
  error: string | null;
  ready: boolean;
};

/** 全局单例缓存：同一任务在同一页面只建一次引擎（Studio 拖帧不重建）。 */
const engineCache = new Map<string, { engine: any; refs: number }>();

export const EngineBridge: React.FC<EngineBridgeProps> = ({ taskMod, narrationData, music, analysis, rhythm, samples = 1, shutter }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { delayRender, continueRender } = useDelayRender();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const stateRef = React.useRef<BridgeState>({ engine: null, error: null, ready: false });
  const [handle] = React.useState(() => delayRender('engine-init'));

  // ⚠ 键里必须带尺寸/帧率：engine 是按 canvas 尺寸建的，同任务不同尺寸复用会画错分辨率。
  const cacheKey = React.useMemo(
    () => `${taskMod?.default?.title ?? 'task'}@${width}x${height}@${fps}@${samples === 'auto' ? 'auto' : 'fixed'}`,
    [taskMod, width, height, fps, samples],
  );
  // 引擎就绪状态必须进 React state：ref 变化不触发重渲染，canvas 会一直不挂载（首帧全黑）。
  const [ready, setReady] = React.useState(false);
  const [initError, setInitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    // delayRender 必须成对释放：init 没跑完就卸载（切 Composition / Studio 改 props）时
    // 原来会漏掉 continueRender，Remotion 一路等到 120s 超时。
    let settled = false;
    const settle = () => { if (!settled) { settled = true; continueRender(handle); } };
    const init = async () => {
      try {
        // 命中缓存则复用（Studio 里拖帧 / 重挂载不重建上下文）
        const cached = engineCache.get(cacheKey);
        if (cached) {
          cached.refs++;
          stateRef.current = { engine: cached.engine, error: null, ready: true };
          settle();
          setReady(true);
          return;
        }

        const { Engine } = await import('@/engine/engine');
        const { makePalette } = await import('@/engine/palette');
        const { resolveStyle } = await import('@/engine/style');
        const { build, isConfigNode } = await import('@/engine/timeline');
        const { makeNarration } = await import('@/engine/narration');
        const { MusicData } = await import('@/engine/audio');

        const spec = taskMod.default ?? taskMod;
        const styleResolved = resolveStyle(spec);
        const palette = makePalette({ ...(styleResolved?.palette ?? {}), ...(spec.palette ?? {}) });

        // 音乐：优先预计算 analysis（与 CLI still 同口径），否则调用方给的 music，再否则 SILENT
        const musicObj = analysis?.beats ? new MusicData(analysis, {}) : (music ?? null);

        // 时间线：与 src/tasks.js 同一条选路（配置档/seq 走 build，已展开数组原样）
        let timeline = spec.timeline;
        const laidOut = Array.isArray(timeline) && !timeline.some(isConfigNode);
        if (!laidOut) {
          const nd = narrationData ?? (spec.narration && typeof spec.narration !== 'string'
            ? makeNarration(spec.narration, { duration: spec.duration }) : null);
          timeline = build(timeline, {
            ...(musicObj ? { beats: musicObj.beats, downbeats: musicObj.downbeats, bpm: musicObj.bpm } : {}),
            narration: nd,
          });
        }

        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const engine = new Engine(canvas, { width, height, scale: 1, fps, palette });
        // HUD 默认开（engine.js:133 this.hud=true）——离屏导出必须关，否则画面带调试读数。
        engine.hud = false;

        await engine.load({
          timeline,
          title: spec.title,
          duration: spec.duration,
          music: musicObj,
          rhythm: rhythm ?? null,
          narration: narrationData ?? null,
          worldPass: taskMod.world ?? spec.world ?? null,
          styleResolved,
          captions: spec.captions ?? null,
        });
        // 字体就绪（与 app.js 同一步：第一帧之前加载，否则拍到方框）
        await engine.hud2d.type.load().catch(() => {});
        for (const it of engine.timeline) it._layer?.type?.clearCache?.();

        if (engine.errors.length) {
          throw new Error('引擎装载错误：' + engine.errors.join('；'));
        }
        if (cancelled) { engine.dispose(); return; }

        engineCache.set(cacheKey, { engine, refs: 1 });
        stateRef.current = { engine, error: null, ready: true };
        settle();
        setReady(true);
      } catch (err: any) {
        if (!cancelled) {
          stateRef.current = { engine: null, error: String(err?.message ?? err), ready: false };
          settle();
          setInitError(String(err?.message ?? err));
        }
      }
    };
    init();
    return () => {
      cancelled = true;
      // 初始化还没落地就被卸载：这里补释放，并把半成品引擎收掉。
      settle();
      const cached = engineCache.get(cacheKey);
      if (cached) {
        cached.refs--;
        if (cached.refs <= 0) {
          cached.engine.dispose();
          const gl = cached.engine.gl?.ctx;
          gl?.getExtension('WEBGL_lose_context')?.loseContext();
          engineCache.delete(cacheKey);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  // 每帧绘制：t = frame / fps，纯函数求值。
  // ⚠ 依赖里必须有 ready：canvas 在就绪后才挂载，首帧绘制要等它出现。
  React.useEffect(() => {
    const st = stateRef.current;
    const cv = canvasRef.current;
    if (!ready || !st.engine || !cv) return;
    const t = frame / fps;
    const engine = st.engine;
    const prevErrors = engine.renderErrors?.length ?? 0;
    engine.render(t, { samples, shutter, seeked: true, preview: false });
    if ((engine.renderErrors?.length ?? 0) > prevErrors) {
      const e = engine.renderErrors[engine.renderErrors.length - 1];
      throw new Error(`[EngineBridge] render error @t=${t.toFixed(3)}s (${e.id ?? 'scene'}): ${e.message}`);
    }
    const buf = engine.readPixels(); // Uint8Array RGBA，行序自下而上，已 sRGB 编码
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(width, height);
    const row = width * 4;
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * row;
      img.data.set(buf.subarray(src, src + row), y * row);
    }
    ctx.putImageData(img, 0, 0);
  }, [frame, fps, width, height, samples, shutter, ready]);

  if (initError) {
    return (
      <AbsoluteFill style={{ background: '#200', color: '#f88', justifyContent: 'center', alignItems: 'center', fontFamily: 'monospace', fontSize: 24, padding: 40 }}>
        EngineBridge 初始化失败：{initError}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <canvas ref={canvasRef} width={width} height={height} style={{ width: '100%', height: '100%' }} />
    </AbsoluteFill>
  );
};