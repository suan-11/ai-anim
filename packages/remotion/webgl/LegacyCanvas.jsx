import React, {useLayoutEffect, useRef} from 'react';
import {staticFile, useCurrentFrame, useDelayRender, useVideoConfig} from 'remotion';
import {Engine} from '../../../src/core/engine.js';
import {makePalette} from '../../../src/core/palette.js';

let fontsReady;

async function prepare(engine, spec) {
  await engine.load(spec);
  if (engine.errors.length) throw new Error(engine.errors.join('\n'));
  // The stylesheet belongs to the browser document, not to a canvas instance.
  fontsReady ??= engine.hud2d.type.load([staticFile('fonts/fonts.css')]);
  await fontsReady;
  for (const item of engine.timeline) item._layer.type.clearCache();
  engine.hud = false;
}

function draw(engine, canvas, {sourceFrame, samples}) {
  const result = engine.render(sourceFrame / engine.fps, {
    samples,
    seeked: true,
    toScreen: true,
  });
  if (engine.errors.length) throw new Error(engine.errors.join('\n'));
  canvas.dataset.sourceFrame = String(sourceFrame);
  canvas.dataset.samples = String(result.samples);
}

export function LegacyCanvas({createSpec, startFrame, samples}) {
  const frame = useCurrentFrame();
  const {width, height, fps} = useVideoConfig();
  const {delayRender, continueRender, cancelRender} = useDelayRender();
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const latestFrame = useRef({sourceFrame: startFrame + frame, samples});

  useLayoutEffect(() => {
    latestFrame.current = {sourceFrame: startFrame + frame, samples};
    if (engineRef.current) {
      try {
        draw(engineRef.current, canvasRef.current, latestFrame.current);
      } catch (error) {
        cancelRender(error);
      }
    }
  }, [frame, samples, startFrame, cancelRender]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const spec = createSpec();
    const palette = makePalette({...spec.styleResolved?.palette, ...spec.palette});
    let engine;
    try {
      engine = new Engine(canvas, {width, height, fps, palette});
    } catch (error) {
      cancelRender(error);
    }

    let unmounted = false;
    const handle = delayRender('Preparing legacy WebGL canvas');
    let ready = false;
    const release = () => {
      if (ready) return;
      ready = true;
      continueRender(handle);
    };

    const preparation = prepare(engine, spec);
    void preparation.then(() => {
      if (unmounted) return;
      engineRef.current = engine;
      draw(engine, canvas, latestFrame.current);
      release();
    }).catch((error) => {
      if (!unmounted) cancelRender(error);
    });

    return () => {
      unmounted = true;
      engineRef.current = null;
      release();
      // Engine.load() may still be constructing layers. Dispose after it settles.
      const dispose = () => engine.dispose();
      void preparation.then(dispose, dispose);
    };
  }, [width, height, fps, createSpec, delayRender, continueRender, cancelRender]);

  return <canvas key={`${width}x${height}:${fps}`} ref={canvasRef} style={{display: 'block'}} />;
}
