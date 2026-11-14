import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'scripts', 'anim.mjs');
const source = readFileSync(entry, 'utf8');
const directory = path.join(root, 'scripts', 'cmd');
const files = readdirSync(directory).filter(name => name.endsWith('.mjs')).sort();
assert.ok(source.split('\n').length < 400, 'CLI entry must stay below 400 lines');
const table = source.match(/const commands = \{([\s\S]*?)\n\};/);
assert.ok(table, 'CLI command table must exist');
const imports = new Map([...source.matchAll(/import \{ run as (\w+) \} from ['"]([^'"]+)['"]/g)]
  .map(([, name, target]) => [name, target]));
const targets = [];
let commands = 0;
for (const line of table[1].split('\n').map(line => line.trim()).filter(Boolean)) {
  const property = line.match(/^(?:'([^']+)'|(\w+)):\s*(.*),$/);
  const name = property ? property[1] ?? property[2] : line.replace(/,$/, '');
  const expression = property ? property[3] : name;
  const identifier = expression.replace(/^\(\) =>\s*/, '').match(/^(\w+)/)?.[1];
  const target = imports.get(identifier);
  assert.ok(target, name + ' must dispatch to an imported command');
  assert.equal(target.replace(/^\.\/cmd\//, ''), name + '.mjs', name + ' must use its matching module');
  const module = await import(pathToFileURL(path.resolve(path.dirname(entry), target)).href);
  assert.equal(typeof module.run, 'function', name + ' must export run()');
  targets.push(path.basename(target));
  commands++;
}
assert.ok(commands >= 40, 'Command table must retain the existing CLI command set');
assert.equal(new Set(targets).size, targets.length, 'Each command must have its own module');
assert.deepEqual(targets.sort(), files, 'Command files and dispatch table must cover each other');
const session = await import('../scripts/lib/cli/session.mjs');
assert.equal(typeof session.getSession, 'function', 'Session must expose a getter');
assert.equal(session.getSession(), null, 'Importing commands must not open a browser session');
assert.ok(!('session' in session) && !('sessionWatch' in session), 'Mutable session bindings must stay private');
const cli = await import('../scripts/anim.mjs');
assert.equal(cli.IS_MAIN, false, 'Importing the CLI must not dispatch a command');
for (const name of ['assText', 'assTime', 'parseNotesJson', 'shotsCatalog', 'parseTaskMeta', 'decideGateFailure']) {
  assert.equal(typeof cli[name], 'function', 'Legacy import must remain available: ' + name);
}
console.log('PASS CLI layout: ' + commands + ' commands, ' + files.length
  + ' matching modules, entry below 400 lines, private session state and legacy imports');
