// @ts-check
/**
 * test-narration-error —— A-2 判定的离线单测（纯函数，不碰磁盘）。
 * 覆盖：没配 ⇒ null / 内联表 ⇒ null / URL ⇒ null / 文件不存在 ⇒ 报 /
 *       JSON 坏 ⇒ 报 / 正常文件 ⇒ null / 文案格式钉住。
 */
import { narrationConfigProblem, describeNarrationError } from '../scripts/lib/narration-error.mjs';
import assert from 'node:assert/strict';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  PASS ' + name); };

const FS_EXIST = { existsSync: () => true, readFileSync: () => '{"lines":[]}' };
const FS_MISSING = { existsSync: () => false };
const FS_BAD = { existsSync: () => true, readFileSync: () => '{not json' };

ok('没配 narration ⇒ null', () => {
  assert.equal(narrationConfigProblem({}, { taskDir: '/t/x' }, FS_EXIST), null);
});
ok('narration: null ⇒ null', () => {
  assert.equal(narrationConfigProblem({ narration: null }, { taskDir: '/t/x' }, FS_EXIST), null);
});
ok('内联表（对象）⇒ null（合法用法，不是文件加载）', () => {
  assert.equal(narrationConfigProblem({ narration: { lines: [] } }, { taskDir: '/t/x' }, FS_EXIST), null);
});
ok('http(s) URL ⇒ null（Node 侧不验证，页面侧 fetch）', () => {
  assert.equal(narrationConfigProblem({ narration: 'https://x/y.json' }, { taskDir: '/t/x' }, FS_EXIST), null);
});
ok('文件不存在 ⇒ 报', () => {
  const p = narrationConfigProblem({ narration: './audio/va.narration.json' }, { taskDir: '/t/x' }, FS_MISSING);
  assert.ok(p && p.file === './audio/va.narration.json' && p.reason.includes('不存在'), JSON.stringify(p));
});
ok('JSON 坏 ⇒ 报（reason 带解析错误）', () => {
  const p = narrationConfigProblem({ narration: './audio/va.narration.json' }, { taskDir: '/t/x' }, FS_BAD);
  assert.ok(p && /不是合法 JSON/.test(p.reason), JSON.stringify(p));
});
ok('正常文件 ⇒ null', () => {
  assert.equal(narrationConfigProblem({ narration: './audio/va.narration.json' }, { taskDir: '/t/x' }, FS_EXIST), null);
});
ok('Windows 绝对路径任务目录不产生双斜杠', () => {
  const seen = [];
  const p = narrationConfigProblem({ narration: './a.json' }, { taskDir: 'D:\\t\\x' },
    { existsSync: (f) => { seen.push(f); return true; }, readFileSync: () => '{}' });
  assert.equal(p, null);
  assert.ok(!seen[0].includes('//') && !seen[0].includes('\\\\'), seen[0]);
});
ok('文案格式钉住（DIAGNOSIS 按原句登记）', () => {
  const s = describeNarrationError({ file: './a.json', reason: '文件不存在' });
  assert.equal(s, '旁白表 ./a.json 加载失败（文件不存在）—— ctx.narration 会是空的：字幕 / dur:{vo} / 卡点全部不工作');
});

console.log(`✓ ${pass} 项通过`);
