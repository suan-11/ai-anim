// @ts-check
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../scripts/lib/cli/paths.mjs';
import {
  BRIDGES_REL, REGISTRY_REL, compositionIdForTask, detectTaskFiles, parseConfigTextFallback,
  readRegistry, registerTask, renderBridgesSource, syncBridges, unregisterTask, writeRegistry,
} from '../scripts/lib/remotion-registry.mjs';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };

// 1) Composition ID 清洗与碰撞处理
ok(compositionIdForTask('demo') === 'Task-demo', '普通任务名生成 Task-demo');
ok(compositionIdForTask('_remotion_probe.v2') === 'Task-remotion-probe-v2', '下划线与点清洗为合法字符集 [a-zA-Z0-9-]');
{
  const id = compositionIdForTask('a_b', new Set(['Task-a-b']));
  ok(id !== 'Task-a-b' && id.startsWith('Task-a-b-') && /^[a-zA-Z0-9-]+$/.test(id), 'ID 碰撞时附带短哈希且字符集合法');
}

// 2) 仓库真实登记表与生成文件同步检查
{
  const reg = readRegistry(ROOT);
  ok(reg.tasks['example-config-only']?.kind === 'native', '仓库 registry 含 example-config-only (native)');
  ok(reg.tasks['nekohome-intro-ja']?.kind === 'bridge' && reg.tasks['nekohome-intro-ja']?.composition === 'Task-nekohome-intro-ja', 'nekohome-intro-ja 使用真实镜头生成桥');
  ok(reg.tasks['paperfold']?.kind === 'custom-bridge', '仓库 registry 含 paperfold (custom-bridge)');
  ok(reg.tasks['world-execute-me']?.kind === 'custom-bridge', '仓库 registry 含 world-execute-me (custom-bridge)');
  const sync = await syncBridges(ROOT, { checkOnly: true });
  ok(sync.ok === true, `${BRIDGES_REL} 与 ${REGISTRY_REL} 保持同步`);
}

// 3) 临时目录读写、探测、确定性生成与移除
const tmp = mkdtempSync(path.join(os.tmpdir(), 'ai-anim-reg-'));
try {
  mkdirSync(path.join(tmp, 'packages', 'remotion'), { recursive: true });
  writeRegistry({ schema: 'remotion.registry/1', tasks: {} }, tmp);

  const taskDir = path.join(tmp, 'tasks', 'alpha_1');
  mkdirSync(path.join(taskDir, 'audio'), { recursive: true });
  writeFileSync(path.join(taskDir, 'task.config.mjs'), [
    "export default {",
    "  title: 'alpha',",
    "  duration: 5,",
    "  narration: './audio/narration.json',",
    "  audio: { music: './audio/bed.mp3', mix: './audio/mix.mp3' },",
    "  timeline: [],",
    "};",
  ].join('\n'));
  writeFileSync(path.join(taskDir, 'rhythm.json'), '{"blocks":[]}');
  writeFileSync(path.join(taskDir, 'audio', 'narration.json'), '{"lines":[]}');
  writeFileSync(path.join(taskDir, 'audio', 'bed.analysis.json'), '{"beats":[]}');

  const files = await detectTaskFiles('alpha_1', tmp);
  ok(files.narrationRel === './audio/narration.json', '探测 narrationRel');
  ok(files.rhythmRel === './rhythm.json', '探测 rhythmRel');
  ok(files.analysisRel === './audio/bed.analysis.json', '探测 analysisRel');
  ok(files.hasAudio === true, '探测 hasAudio');

  const regRes = await registerTask('alpha_1', {}, tmp);
  ok(regRes.entry.composition === 'Task-alpha-1' && regRes.entry.kind === 'bridge', 'registerTask 自动登记并同步生成文件');
  ok(existsSync(path.join(tmp, BRIDGES_REL)), '生成 bridges.generated.tsx');

  const genA = await renderBridgesSource(readRegistry(tmp), tmp);
  const genB = await renderBridgesSource(readRegistry(tmp), tmp);
  ok(genA === genB && genA.includes('Task-alpha-1') && genA.includes('narr_0') && genA.includes('rhythm_0') && genA.includes('analysis_0'), 'bridges 生成源码确定性且包含所有素材导入');

  const checkOk = await syncBridges(tmp, { checkOnly: true });
  ok(checkOk.ok === true, 'syncBridges --check 绿灯');

  writeFileSync(path.join(tmp, BRIDGES_REL), '// stale\n');
  const checkStale = await syncBridges(tmp, { checkOnly: true });
  ok(checkStale.ok === false && checkStale.stale === true, '过期文件能被 checkOnly 捕获');

  const unreg = await unregisterTask('alpha_1', tmp);
  ok(unreg.existed === true && !readRegistry(tmp).tasks.alpha_1, 'unregisterTask 移除登记');
  const after = readFileSync(path.join(tmp, BRIDGES_REL), 'utf8');
  ok(!after.includes('alpha_1'), 'unregisterTask 同步清理生成桥');

  // 4) parseConfigTextFallback + detectTaskFiles 单行属性与注释剥离兜底
  const parsedFallback = parseConfigTextFallback([
    "export default {",
    "  // narration: './audio/wrong.json',",
    "  /* analysis: './audio/wrong.analysis.json', audio: './audio/wrong.mp3', */",
    "  narration:'./audio/narration.json', analysis:'./audio/bed.analysis.json', audio:{music:'./audio/bed.mp3',vo:'./audio/beta-vo.mp3',mix:'./audio/beta-mix.mp3'},",
    "};",
  ].join('\n'));
  ok(parsedFallback.narration === './audio/narration.json', 'parseConfigTextFallback 提取单行 narration');
  ok(parsedFallback.analysis === './audio/bed.analysis.json', 'parseConfigTextFallback 提取单行 analysis');
  ok(
    parsedFallback.audio && typeof parsedFallback.audio === 'object'
      && parsedFallback.audio.music === './audio/bed.mp3'
      && parsedFallback.audio.vo === './audio/beta-vo.mp3'
      && parsedFallback.audio.mix === './audio/beta-mix.mp3',
    'parseConfigTextFallback 提取单行 audio:{...} 且忽略注释',
  );

  const betaDir = path.join(tmp, 'tasks', 'beta_inline');
  mkdirSync(path.join(betaDir, 'audio'), { recursive: true });
  writeFileSync(path.join(betaDir, 'task.config.mjs'), [
    "import '../../src/timeline.js';",
    "export default {",
    "  narration:'./audio/narration.json', audio:{music:'./audio/bed.mp3',vo:'./audio/beta-vo.mp3',mix:'./audio/beta-mix.mp3'},",
    "  timeline: [],",
    "};",
  ].join('\n'));
  writeFileSync(path.join(betaDir, 'audio', 'narration.json'), '{"lines":[]}');
  writeFileSync(path.join(betaDir, 'audio', 'bed.analysis.json'), '{"beats":[]}');
  const betaFiles = await detectTaskFiles('beta_inline', tmp);
  ok(betaFiles.mod === null, 'beta_inline 因不可解析导入进入文本兜底分支');
  ok(betaFiles.narrationRel === './audio/narration.json', 'detectTaskFiles 兜底识别单行 narrationRel');
  ok(betaFiles.analysisRel === './audio/bed.analysis.json', 'detectTaskFiles 兜底通过单行 audio.music 识别 analysisRel');
  ok(betaFiles.hasAudio === true, 'detectTaskFiles 兜底识别 hasAudio');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\ntest-remotion-registry: PASS（${passed} 项）`);
