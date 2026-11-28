// @ts-check
/**
 * 渲染器选路（优先级：显式 --renderer > 环境变量 ANIM_RENDERER > 自动按登记表选路）。
 */

export const REMOTION_SUPPORTED_CMDS = new Set([
  'still', 'shot', 'video', 'check', 'review', 'verify', 'qa',
]);

// 会消耗下一个参数作为值的选项（不含 --flag=val 写法）
const VALUE_FLAGS = new Set([
  '-t', '-o', '-n',
  '--t', '--out', '--file', '--from', '--to', '--scale', '--crf', '--samples', '--fps', '--vcodec',
  '--only', '--variant', '--style', '--tol', '--times', '--round', '--attention-step', '--video',
  '--head', '--tail', '--freeze', '--expect-size', '--expect-fps', '--expect-duration', '--audio', '--dur-tol',
  '--gpu', '--url', '--shutter', '--parallel', '--preset', '--cq', '--bitrate', '--x264', '--quality',
  '--keep-raw', '--keep-raw-frames', '--err-stop', '--idle', '--inflight', '--finalize', '--encode',
  '--at', '--window', '--cols', '--cell', '--title', '--sub', '--scrim',
]);

// 可选带值的选项（不带值时后面紧跟的是另一个开关或任务名）
const OPTIONAL_VALUE_FLAGS = new Set(['--segments', '--scan-nf', '--sheet']);

const CMD_ALLOWED_FLAGS = {
  still: new Set(['t', 'out', 'scale', 'samples']),
  shot: new Set(['from', 'to', 'out', 'scale', 'crf', 'samples', 'fps', 'vcodec', 'draft', 'noaudio']),
  video: new Set(['from', 'to', 'out', 'scale', 'crf', 'samples', 'fps', 'vcodec', 'draft', 'noaudio', 'segments', 'force', 'dry-run']),
  review: new Set(['round', 'samples', 'scale', 'attention', 'attention-step', 'video', 'shutter']),
  verify: new Set(['file', 'out', 'from', 'times', 'samples', 'tol', 'scale', 'fps']),
};

const CMD_DISALLOWED_FLAGS = {
  check: new Set(['only', 'variant', 'style']),
};

function consumesNext(flagToken, nextToken) {
  if (!nextToken || nextToken.startsWith('-')) return false;
  if (VALUE_FLAGS.has(flagToken)) return true;
  if (flagToken === '--segments' || flagToken === '--scan-nf') {
    return /^\d+(\.\d+)?$/.test(nextToken);
  }
  if (flagToken === '--sheet') {
    return /[./\\]/.test(nextToken);
  }
  return false;
}

function normalizeFlagName(flagToken) {
  if (flagToken === '-o') return 'out';
  if (flagToken === '-t') return 't';
  if (flagToken.startsWith('--')) return flagToken.slice(2);
  return flagToken.slice(1);
}

/**
 * 从命令行提取 `--renderer remotion|legacy`，返回剩余参数。
 * @param {string[]} argv
 * @returns {{ renderer: 'remotion'|'legacy'|null, explicit: boolean, args: string[] }}
 */
export function extractRenderer(argv) {
  let renderer = null;
  let explicit = false;
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== '--renderer' && !arg.startsWith('--renderer=')) {
      args.push(arg);
      continue;
    }
    if (explicit) throw new Error('--renderer 只能指定一次');
    const val = arg === '--renderer' ? argv[++i] : arg.slice('--renderer='.length);
    if (val !== 'remotion' && val !== 'legacy') {
      throw new Error('--renderer 要填 remotion 或 legacy');
    }
    renderer = val;
    explicit = true;
  }
  return { renderer, explicit, args };
}

/**
 * 从命令参数里窥视第一个位置参数（任务名），跳过已知选项及其值。
 * @param {string[]} args
 * @returns {string|null}
 */
export function peekTaskName(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) return arg;
    if (arg.includes('=')) continue;
    if (consumesNext(arg, args[i + 1])) i++;
  }
  return null;
}

/**
 * 找出第一个 Remotion 在该命令下不支持的旗标（用于自动回退 legacy）。
 * @param {string} cmd
 * @param {string[]} args
 * @returns {string|null}
 */
export function findUnsupportedFlag(cmd, args) {
  if (cmd === 'qa') return null;
  const allowed = CMD_ALLOWED_FLAGS[cmd];
  const disallowed = CMD_DISALLOWED_FLAGS[cmd];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) continue;
    const eq = arg.indexOf('=');
    const flagToken = eq >= 0 ? arg.slice(0, eq) : arg;
    const name = normalizeFlagName(flagToken);
    if (disallowed && disallowed.has(name)) return flagToken;
    if (allowed && !allowed.has(name)) return flagToken;
    if (eq < 0 && consumesNext(flagToken, args[i + 1])) i++;
  }
  return null;
}

/**
 * 解析当前命令应使用的渲染器与回退说明。
 * 优先级：显式 --renderer > 环境变量 ANIM_RENDERER > 已登记任务自动选 Remotion。
 * @param {string} cmd
 * @param {string[]} argv
 * @param {{ registry?: { tasks?: Record<string, any> }|null, env?: Record<string, string|undefined> }} [opts]
 * @returns {{ renderer: 'remotion'|'legacy', source: 'flag'|'env'|'auto'|'auto-fallback'|'default', args: string[], task: string|null, fallbackFlag: string|null }}
 */
export function resolveRenderer(cmd, argv, { registry = null, env = process.env } = {}) {
  if (cmd === 'help') {
    return { renderer: 'legacy', source: 'default', args: argv, task: null, fallbackFlag: null };
  }
  const { renderer: flagRenderer, explicit, args } = extractRenderer(argv);
  if (cmd === 'queue') {
    // queue 本身由 legacy 编排；renderer 参数原样转给子进程 video，由各任务自己选路。
    return {
      renderer: 'legacy',
      source: explicit ? 'flag' : 'default',
      args: argv,
      task: null,
      fallbackFlag: null,
    };
  }

  const task = peekTaskName(args);

  if (explicit && flagRenderer) {
    return { renderer: flagRenderer, source: 'flag', args, task, fallbackFlag: null };
  }

  const rawEnv = env?.ANIM_RENDERER ? String(env.ANIM_RENDERER).trim() : '';
  if (rawEnv) {
    if (rawEnv !== 'remotion' && rawEnv !== 'legacy') {
      throw new Error('环境变量 ANIM_RENDERER 要填 remotion 或 legacy');
    }
    return { renderer: rawEnv, source: 'env', args, task, fallbackFlag: null };
  }

  const isRegistered = !!(task && registry?.tasks && Object.prototype.hasOwnProperty.call(registry.tasks, task));
  if (!isRegistered || !REMOTION_SUPPORTED_CMDS.has(cmd)) {
    return { renderer: 'legacy', source: 'auto', args, task, fallbackFlag: null };
  }

  const fallbackFlag = findUnsupportedFlag(cmd, args);
  if (fallbackFlag) {
    return { renderer: 'legacy', source: 'auto-fallback', args, task, fallbackFlag };
  }
  return { renderer: 'remotion', source: 'auto', args, task, fallbackFlag: null };
}
