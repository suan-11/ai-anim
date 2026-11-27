/**
 * Remotion 迁移 · 入口：显式导入注册样片（阶段 1 原生四镜头 + 阶段 2B 音画验证）。
 *
 * 任务发现不做扫描：每支样片在这里静态 import，解析走同一份求值器 ——
 *   · example-config-only → rm/timeline.mjs（阶段 1 帧级口径）
 *   · nekohome-intro-ja   → rm/task-eval.mjs（阶段 2A：build()/变体/旁白/风格全复用旧引擎）
 */
import React from 'react';
import { Composition, AbsoluteFill, Sequence, staticFile, useDelayRender, useCurrentFrame } from 'remotion';
// 类型走 paths 别名（stubs），运行时由 remotion.config.ts 的 webpack alias 指回真实模块。
import config from '@/tasks/example-config-only';
import * as jaMod from '@/tasks/nekohome-intro-ja';
import jaSubZh from '../../tasks/nekohome-intro-ja/audio/ja-sub-zh.narration.json';
import { buildFrameTimeline } from '@/rm/timeline';
import { evaluateTask } from '@/rm/task-eval';
import { makeNarration } from '@/engine/narration';
import { TitleShot } from './shots/TitleShot';
import { ChartShot } from './shots/ChartShot';
import { KineticShot } from './shots/KineticShot';
import { OutroShot } from './shots/OutroShot';
import { NekohomeJaVerify } from './shots/NekohomeJaVerify';
import { nekohomeSchema } from './schemas';
import { EngineBridge } from './shots/EngineBridge';
import { MusicLayer, CutSfx } from './audio/MusicLayer';
import { getPaperfoldBed, getWhoosh } from './media-assets';
import * as paperfoldMod from '@/tasks/paperfold';
import paperfoldNarration from '../../tasks/paperfold/audio/narration.json';
import paperfoldRhythm from '../../tasks/paperfold/rhythm.json';
import paperfoldAnalysis from '../../tasks/paperfold/audio/bed.analysis.json';
import * as wemMod from '@/tasks/world-execute-me';
import wemRhythm from '../../tasks/world-execute-me/rhythm.json';
import wemAnalysis from '../../tasks/world-execute-me/audio/track.analysis.json';

const TL = buildFrameTimeline(config);
const JA = evaluateTask('nekohome-intro-ja', jaMod, {
  narrationData: makeNarration(jaSubZh, { duration: 47.245 }),
});

/** 字体就绪门：Archivo / IBM Plex Mono 加载完才放行截帧（否则拍到回退字形）。 */
const FontGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { delayRender, continueRender } = useDelayRender();
  const [handle] = React.useState(() => delayRender('fonts'));
  React.useEffect(() => {
    let alive = true;
    Promise.all([
      document.fonts.load('800 128px Archivo'),
      document.fonts.load('400 26px "IBM Plex Mono"'),
      document.fonts.load('600 26px "IBM Plex Mono"'),
    ]).catch(() => undefined).finally(() => { if (alive) continueRender(handle); });
    return () => { alive = false; };
  }, [handle, continueRender]);
  return <>{children}</>;
};

const SHOTS: Record<string, React.FC<any>> = {
  title: TitleShot,
  chart: ChartShot,
  kinetic: KineticShot,
  outro: OutroShot,
};

const ExampleConfigOnly: React.FC = () => {
  return (
    <FontGate>
      <AbsoluteFill style={{ background: '#0a0a0b' }}>
        {TL.segments.map((seg) => {
          const Shot = SHOTS[seg.type];
          if (!Shot) throw new Error(`没有 ${seg.type} 的 React 实现（阶段 1 只做 title/chart/kinetic/outro）`);
          return (
            <Sequence key={seg.id} from={seg.startFrame} durationInFrames={seg.endFrame - seg.startFrame} name={seg.id}>
              <ShotLocal seg={seg} Shot={Shot} />
            </Sequence>
          );
        })}
      </AbsoluteFill>
    </FontGate>
  );
};

/** Sequence 内部帧号已归零 —— 段内秒 = 本地帧 / fps（等价旧引擎 f.lt）。 */
const ShotLocal: React.FC<{ seg: any; Shot: React.FC<any> }> = ({ seg, Shot }) => {
  const frame = useCurrentFrame();
  const t = frame / TL.fps;
  const dur = (seg.endFrame - seg.startFrame) / TL.fps;
  return <Shot t={t} dur={dur} params={seg.params} />;
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <link rel="stylesheet" href={staticFile('fonts/fonts.css')} />
      <Composition
        id="ExampleConfigOnly"
        component={ExampleConfigOnly}
        durationInFrames={TL.durationInFrames}
        fps={TL.fps}
        width={TL.width}
        height={TL.height}
        defaultProps={{}}
      />
      <Composition
        id="NekohomeJaVerify"
        component={NekohomeJaVerify}
        durationInFrames={JA.durationInFrames}
        fps={JA.fps}
        width={JA.width}
        height={JA.height}
        schema={nekohomeSchema}
        defaultProps={{ parsed: JA as any, title: '小糯米 · 介绍片（日语配音）', transitionSec: 0.25, sfxVolume: 0.35, barsGain: 12 }}
      />
      {/* 阶段 3：paperfold 全片由旧引擎 WebGL 桥驱动（24fps / 48s / 1152 帧）。
          ⚠ taskMod 不能走 defaultProps —— Remotion 会 JSON 序列化 props，
          场景对象里的 setup/render 函数会被丢掉（症状：_scene 只剩 id/handlesTransition）。
          改为组件内部静态 import，props 只传可序列化的采样参数。 */}
      <Composition
        id="PaperfoldBridge"
        component={PaperfoldBridgeNoMB as any}
        durationInFrames={Math.round(48 * 24)}
        fps={24}
        width={1920}
        height={1080}
        defaultProps={{}}
      />
      <Composition
        id="PaperfoldBridgeMB"
        component={PaperfoldBridgeMB as any}
        durationInFrames={Math.round(48 * 24)}
        fps={24}
        width={1920}
        height={1080}
        defaultProps={{}}
      />
      {/* WP1：world.execute(me); 全片桥接（24fps / 5096 帧 ≈ 212.33s）。
          9 段旧引擎场景原样由 EngineBridge 驱动；音乐层 Remotion 原生
          （public/wem/track.mp3，无旁白不闪避），CLI 出片再封装 mix 轨。
          ⚠ taskMod/rhythm/analysis 不走 defaultProps（JSON 序列化丢函数）。 */}
      <Composition
        id="WemBridge"
        component={WemBridgeNoMB as any}
        durationInFrames={WEM.durationInFrames}
        fps={WEM.fps}
        width={WEM.width}
        height={WEM.height}
        defaultProps={{}}
      />
      <Composition
        id="WemBridgeMB"
        component={WemBridgeMB as any}
        durationInFrames={WEM.durationInFrames}
        fps={WEM.fps}
        width={WEM.width}
        height={WEM.height}
        defaultProps={{}}
      />
    </>
  );
};

/** WEM 时间线求值：与 CLI runRemotion 同一份 evaluateTask（build/交叠/风格全复用）。 */
const WEM = evaluateTask('world-execute-me', wemMod, {});

/** WEM 桥：samples 走 inputProps（CLI --props 注入）。
 *  ⚠ 不放 <Audio>/MusicLayer：CLI 出片走 --muted + ffmpeg 封装 mix 轨（与 paperfold 同口径），
 *  渲染期挂 <Audio> 会让 @remotion/media 逐帧抽音频，长 mp3 实测在 f230 超时炸渲染。
 *  Studio 预览要听声时用 npm run studio 的旧引擎预览（src/app.js 自带 Audio 播放器）。 */
const WemBridgeNoMB: React.FC<{ samples?: number }> = ({ samples = 1 }) => (
  <EngineBridge taskMod={wemMod} rhythm={wemRhythm} analysis={wemAnalysis} samples={samples} />
);
const WemBridgeMB: React.FC<{ samples?: number | 'auto' }> = ({ samples = 'auto' }) => (
  <EngineBridge taskMod={wemMod} rhythm={wemRhythm} analysis={wemAnalysis} samples={samples} shutter={0.5} />
);

/** paperfold 桥：samples 走 inputProps（CLI --props 注入），默认 auto。
 *  ⚠ taskMod/rhythm/analysis 绝不走 defaultProps（JSON 序列化丢函数）。
 *  音乐层：bed 循环 + 淡入淡出 + 旁白闪避 + 切点 whoosh（Remotion 原生，不依赖 CLI mux）。 */
const PaperfoldBridgeNoMB: React.FC<{ samples?: number }> = ({ samples = 1 }) => (
  <>
    <EngineBridge taskMod={paperfoldMod} narrationData={paperfoldNarration}
      rhythm={paperfoldRhythm} analysis={paperfoldAnalysis} samples={samples} />
    <PaperfoldMusic />
  </>
);
const PaperfoldBridgeMB: React.FC<{ samples?: number | 'auto' }> = ({ samples = 'auto' }) => (
  <>
    <EngineBridge taskMod={paperfoldMod} narrationData={paperfoldNarration}
      rhythm={paperfoldRhythm} analysis={paperfoldAnalysis} samples={samples} shutter={0.5} />
    <PaperfoldMusic />
  </>
);

const PaperfoldMusic: React.FC = () => {
  const windows = (paperfoldNarration as any).lines?.map((l: any) => ({ start: l.start, end: l.start + l.dur })) ?? [];
  // paperfold 段边界（24fps）：hook 0-216, bridge 202-389, mechanism 374-662, data 648-878, close 864-1152
  // 交叠窗内不放 whoosh（转场自带音效感），只在硬切处放 —— paperfold 全交叠，故 cuts 为空
  return (
    <>
      <MusicLayer
        musicSrc={getPaperfoldBed()}
        windows={windows}
        duckLevel={0.35}
        attack={0.2}
        release={0.5}
        fadeIn={1.0}
        fadeOut={1.5}
        loop
        volume={0.85}
      />
      <CutSfx cuts={[]} sfxSrc={getWhoosh()} volume={0.3} />
    </>
  );
};