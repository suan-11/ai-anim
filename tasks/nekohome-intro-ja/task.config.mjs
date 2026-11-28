/**
 * Nekohome 工作室 & 小糯米 —— **日文配音版**（同一批镜头，只换旁白与时长）。
 *
 * 场景代码一行都没复制：直接 import 中文版那套 ../nekohome-intro/scenes/cards.js。
 * 时长来自 audio/ja.timing.mjs（`say --table ja` 的产物），中文版的 timing/mix 不动。
 *
 * 重做日文旁白后依次跑（GPT-SoVITS 服务与 ANIM_GSV_* 参考音频见 tools/tts-gptsovits.py）：
 *   node scripts/anim.mjs say nekohome-intro-ja --table ja --rate +8% --tts "python tools/tts-gptsovits.py" --pin-timing --pin-table ja
 *   node scripts/make-ja-zhsub.mjs            （中文字幕表：时间轴=日语，文本=narration.mjs 的 zh）
 *   node scripts/anim.mjs mix nekohome-intro-ja --table ja --target streaming
 *   node scripts/anim.mjs video nekohome-intro-ja
 * 想改段长就去掉 --pin-timing / --pin-table；作业单见 docs/HANDOVER-2026-11-28.md §3.1。
 */
import jaTiming from './audio/ja.timing.mjs';
import { seq, cut } from '../../src/timeline.js';
import { openHook, nuomiCard, xiaoyingCard, tsundereSplit, phraseCards, endCard } from './scenes/cards.js';

const dur = (id) => {
  const s = jaTiming.scenes.find((x) => x.id === id);
  if (!s) throw new Error('ja.timing 里没有段 ' + id + ' —— 先跑 say --table ja');
  return s.slot;
};

export default {
  title: '小糯米 · 介绍片（日语配音）',
  width: 1920, height: 1080, fps: 60, scale: 1,
  style: 'paper',
  captions: true,
  // 字幕用**中文**（观众读的），配音是日语 —— 时间轴取 ja、文本取 zh，见 scripts/make-ja-zhsub.mjs
  narration: './audio/ja-sub-zh.narration.json',
  audio: {
    music: './audio/bed.mp3',
    vo: './audio/ja-vo.mp3',
    mix: './audio/ja-mix.mp3',
  },
  timeline: seq([
    // 片头（钩子版）：先给结果再报名字，见 scenes/cards.js 的 openHook
    cut(openHook, { dur: dur('open'), focus: 'center', maxSamples: 16 }),
    cut(nuomiCard, { dur: dur('nuomi'), focus: 'center', maxSamples: 16 }),
    cut(tsundereSplit, { dur: dur('tsundere'), focus: 'center', maxSamples: 16 }),
    cut(xiaoyingCard, { dur: dur('xiaoying'), focus: 'center', maxSamples: 16 }),
    // 工作室相关的四段（成员墙 / 群聊记忆 / 仓库 / 项目记录）已按需求删掉
    cut(phraseCards, { dur: dur('phrases'), focus: 'center', maxSamples: 16 }),
    // 收尾：自绘（模板 lockup 塞不进二维码）
    cut(endCard, { dur: dur('end'), focus: 'center', maxSamples: 16 }),
  ]),
};
