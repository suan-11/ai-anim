import React from 'react';
import {Composition, Sequence, registerRoot} from 'remotion';
import {MusicData} from '../../../src/core/audio.js';
import {resolveStyle} from '../../../src/style/index.js';
import {build} from '../../../src/timeline.js';
import task, {world} from '../../../tasks/paperfold/task.config.mjs';
import narration from '../../../tasks/paperfold/audio/narration.json';
import musicAnalysis from '../../../tasks/paperfold/audio/bed.analysis.json';
import rhythm from '../../../tasks/paperfold/rhythm.json';
import {LegacyCanvas} from './LegacyCanvas.jsx';

const {width, height, fps} = task;
const timeline = build(task.timeline);
const bridge = timeline.find((item) => item.id === 'bridge');
const mechanism = timeline.find((item) => item.id === 'mechanism');
const startFrame = Math.ceil(mechanism.start * fps) - fps / 2;
const endFrame = Math.ceil(bridge.end * fps) + fps / 2;
const durationInFrames = endFrame - startFrame;

function createPaperfoldSpec() {
  return {
    // The two scenes overlap and share one engine. Each mount owns its scene state.
    timeline: [bridge, mechanism].map((item) => ({...item, scene: {...item.scene}})),
    duration: Math.max(...timeline.map((item) => item.end)),
    narration,
    music: new MusicData(musicAnalysis, {url: task.audio.music}),
    rhythm,
    title: task.title,
    styleResolved: resolveStyle(task),
    captions: task.captions,
    worldPass: world,
  };
}

function PaperfoldWebgl({samples}) {
  return (
    <Sequence name="paperfold · bridge → mechanism" durationInFrames={durationInFrames}>
      <LegacyCanvas createSpec={createPaperfoldSpec} startFrame={startFrame} samples={samples} />
    </Sequence>
  );
}

function Root() {
  return (
    <Composition
      id="PaperfoldWebgl"
      component={PaperfoldWebgl}
      width={width}
      height={height}
      fps={fps}
      durationInFrames={durationInFrames}
      defaultProps={{samples: 1}}
    />
  );
}

registerRoot(Root);
