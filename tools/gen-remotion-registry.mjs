#!/usr/bin/env node
// @ts-check
/**
 * 同步或校验 Remotion 任务登记表与生成桥：
 *   node tools/gen-remotion-registry.mjs              按 registry.json 重新生成 bridges.generated.tsx
 *   node tools/gen-remotion-registry.mjs --check      校验登记表合法、任务存在、生成文件未过期
 *   node tools/gen-remotion-registry.mjs --add <task> 把任务登记为 bridge 并重生成
 *   node tools/gen-remotion-registry.mjs --remove <task> 移除登记并重生成
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../scripts/lib/cli/paths.mjs';
import { BRIDGES_REL, REGISTRY_REL, readRegistry, registerTask, syncBridges, unregisterTask } from '../scripts/lib/remotion-registry.mjs';

const args = process.argv.slice(2);
const optVal = (flag) => {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const v = args[i + 1];
  if (!v || v.startsWith('-')) throw new Error(`${flag} 需要指定任务名`);
  return v;
};

try {
  const addTask = optVal('--add');
  const removeTask = optVal('--remove');
  const checkOnly = args.includes('--check');

  if (addTask && removeTask) throw new Error('--add 与 --remove 不能同时指定');

  if (addTask) {
    const cfg = path.join(ROOT, 'tasks', addTask, 'task.config.mjs');
    if (!existsSync(cfg)) throw new Error(`找不到 ${path.relative(ROOT, cfg)}`);
    const res = await registerTask(addTask, {}, ROOT);
    console.log(`✓ 已登记 ${addTask} → ${res.entry.composition}（同步 ${BRIDGES_REL}）`);
  } else if (removeTask) {
    const res = await unregisterTask(removeTask, ROOT);
    console.log(res.existed
      ? `✓ 已移除 ${removeTask}（同步 ${BRIDGES_REL}）`
      : `· ${removeTask} 本来就不在 ${REGISTRY_REL} 中（已校验 ${BRIDGES_REL}）`);
  } else if (checkOnly) {
    const reg = readRegistry(ROOT);
    const missing = Object.keys(reg.tasks).filter((t) => !existsSync(path.join(ROOT, 'tasks', t, 'task.config.mjs')));
    if (missing.length) {
      throw new Error(`${REGISTRY_REL} 登记了不存在的任务配置：${missing.join('、')}`);
    }
    const res = await syncBridges(ROOT, { checkOnly: true });
    if (!res.ok) {
      throw new Error(`${BRIDGES_REL} 已过期，请运行 node tools/gen-remotion-registry.mjs 重新生成`);
    }
    console.log(`✓ Remotion 登记表校验通过（${Object.keys(reg.tasks).length} 个任务，${BRIDGES_REL} 最新）`);
  } else {
    const res = await syncBridges(ROOT);
    console.log(res.changed ? `✓ 已更新 ${BRIDGES_REL}` : `✓ ${BRIDGES_REL} 已是最新`);
  }
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
