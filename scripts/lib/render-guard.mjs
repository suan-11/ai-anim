// @ts-check
/**
 * `render-guard.mjs` —— CLI 渲染硬化的纯逻辑与锁 IO。
 *
 * 覆盖三件事（`docs/BACKLOG.md` 1-24① / 渲染复盘 §2 / E-1）：
 *   ① `--parallel` 的冲突开关清单与并发度计算 —— 以前一个被静默忽略、一个拍脑袋硬编码；
 *   ② 渲染心跳：帧停在半路时每 120s 打一行警告（复盘实测：1260/4550 帧处卡了 12 分钟没人知）；
 *   ③ per-任务渲染锁（out/<任务>/.render-lock）的探活判定与文件读写。
 *
 * 这里只放"给输入返输出"的部分：argv 扫描、并发度夹取、心跳计时、pid 探活、锁文件 IO。
 * 进程级的接线（die / setInterval / process 退出钩子）在 scripts/anim.mjs；
 * 时钟、kill、log 都由调用方注入 —— `tools/test-cli-hardening.mjs` 因此能离线测全。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/* --------------------------------------------------------------------------
 * ① BACKLOG 1-24①：--parallel 的冲突开关
 * ----------------------------------------------------------------------- */

/**
 * 在 `--parallel` 模式下**不生效**的开关。
 *
 * `--parallel` 把片子切片交给独立子进程（各自起 Vite + Chrome、各带各的参数），
 * 下面这些开关只属于单进程推流（--idle 看门狗 / --keep-raw 原始帧）或分块复用
 * （--segments / --force）那两条路 —— 以前同时给出会被**静默丢掉**，用户以为生效了；
 * 更糟的是 `--only`：它会平移父进程的时间轴，而子进程按整片时间 `--from/--to` 切块，
 * 切出来的段与子进程加载的整片时间线**对不上**。现在进 `--parallel` 分支时逐个
 * 检查原始 argv，给出即报错。
 *
 * @type {readonly string[]}
 */
export const PARALLEL_CONFLICT_FLAGS = ['segments', 'only', 'idle', 'force', 'keep-raw'];

/**
 * 从原始 argv 里挑出与 `--parallel` 冲突的开关名（不带 `--` 前缀，按声明顺序）。
 * 纯字符串匹配：`--force-gpu` / `--keep-raw-frames` / `--segments-x` 这类**前缀相近**
 * 的开关不能误伤（`--segments=10` 这种 `=` 赋值形式也认）。
 * @param {string[]} rest  已去掉命令名的 argv（scripts/anim.mjs 的 `rest`）
 * @returns {string[]}
 */
export function conflictingParallelFlags(rest) {
  return PARALLEL_CONFLICT_FLAGS.filter((name) =>
    rest.some((a) => a === `--${name}` || a.startsWith(`--${name}=`)));
}

/* --------------------------------------------------------------------------
 * ① BACKLOG 1-24① 后半：并发度按机器资源收窄
 * ----------------------------------------------------------------------- */

/**
 * 并行渲染的并发度：`min(cpu核数-2, floor(内存GiB/3), 分块数)`，夹在 [2..8]。
 *
 * 为什么不是"用户给几就跑几"：每个子进程一个无头 Chrome，超卖只会把内存/显存挤爆
 * （资源性失败）。requested 的作用是**切块粒度**（切多少段），真正同时跑的进程数由
 * 机器收窄；块数本身也是上限之一（块比并发少时，多开的进程没活干）。
 * 机器太小（cpu≤2 或内存 <3GiB）时夹到下限 2 —— 再小也是"至少试两条流水"。
 * @param {{ cpus: number, memoryGiB: number, chunks: number }} o
 * @returns {{ n: number, capCpu: number, capMem: number, capChunks: number, raw: number }}
 */
export function planParallelConcurrency({ cpus, memoryGiB, chunks }) {
  const capCpu = Math.max(1, Math.floor(Number(cpus) || 0) - 2);
  const capMem = Math.max(0, Math.floor(Number(memoryGiB) / 3));
  const capChunks = Math.max(1, Math.floor(Number(chunks) || 1));
  const raw = Math.min(capCpu, capMem, capChunks);
  const n = Math.min(8, Math.max(2, raw));
  return { n, capCpu, capMem, capChunks, raw };
}

/**
 * `--parallel` 的切块数： requested 的 N 只是**期望**，至少切成
 * `min(并发上限, 片子全长)` 块才有并行的意义（N=3 但片长只有 1.2s 时切成 3 块，
 * 每块 0.4s，除了一堆 Vite 启动开销什么也并行不到；反过来说，块数是并发度的上限之一）。
 * planParallelConcurrency() 拿它当 `chunks` 输入，与切点规划（planSegmentCuts）解耦 ——
 * 这里只回答"该往多细切"，段边界/转场避让是 anim.mjs 那边的事。
 * @param {{ from: number, to: number, requested?: number }} o
 * @returns {number} ≥1
 */
export function planParallelChunks(o) {
  const seconds = Math.max(0, Number(o.to) - Number(o.from));
  const nReq = Math.max(1, Math.floor(Number(o.requested ?? 2)));
  return Math.max(1, Math.min(nReq, Math.floor(seconds) || 1));
}

/* --------------------------------------------------------------------------
 * ② 复盘 §2：渲染心跳（帧停滞告警）
 * ----------------------------------------------------------------------- */

/** 心跳间隔（ms）：距上一条**新帧**超过这个时长就告警，之后每同样时长重复。 */
export const FRAME_STALL_INTERVAL_MS = 120_000;

/**
 * 心跳告警文案（只走 stderr 日志；绝不进 ffmpeg stdin / 帧数据通道）。
 * @param {{ stallSec: number, done: number, total: number, chunk?: string }} o
 */
export function frameStallMessage({ stallSec, done, total, chunk = '' }) {
  const head = chunk ? `[${chunk}] ` : '';
  return `${head}⚠ ${stallSec}s 没有新帧（已渲 ${done}/${total}）—— 渲染可能卡死；长片子建议 --segments 分块（每块重启浏览器）`;
}

/**
 * 造一个"帧停滞"看门表：`onFrame()` 喂新帧，`check()` 定期查，
 * 距上一帧 ≥ intervalMs 就打一行警告、之后每 intervalMs 重复（计数递增：120s → 240s → …）。
 *
 * 为什么不看"进度行"（每 30 帧一次的 \r 行）：帧**到达**才是事实，进度行只是它的显示；
 * 基线一律取最后一帧到达的时刻（还没帧到达时退到 startAt）。
 * 已渲满（done ≥ total）之后一律静默 —— 那段安静是 ffmpeg 在写 moov，不是卡死。
 *
 * @param {{ intervalMs?: number, warn?: (s: string) => void, chunk?: string,
 *           total?: number, startAt?: number }} [o]
 * @returns {{ onFrame: (done: number, total: number, nowMs: number) => void,
 *             check: (nowMs: number) => string | null, stop: () => void }}
 */
export function createFrameStallWatch({ intervalMs = FRAME_STALL_INTERVAL_MS, warn = () => {}, chunk = '', total = 0, startAt = 0 } = {}) {
  /** @type {number | null} 最后一帧到达的时刻（null = 一帧都没来过） */
  let lastFrameAt = null;
  let lastDone = 0;
  /** 已经警告到第几档（k × intervalMs），防止同档重复打 */
  let warnedK = 0;
  let stopped = false;
  return {
    onFrame(done, totalNow, nowMs) {
      lastDone = done;
      if (Number(totalNow) > 0) total = totalNow;
      lastFrameAt = nowMs;
      warnedK = 0;   // 新帧 = 新基线：警告档位随之清零，下一次卡死从第一档重新数（渲染恢复过就不该延续旧档）
    },
    check(nowMs) {
      if (stopped) return null;
      if (total && lastDone >= total) return null;      // 渲满了，安静是收尾不是卡死
      const base = lastFrameAt ?? startAt;
      // ⚠ 只判 null/undefined，不判 falsy —— startAt=0（与测试里的 0 基线）是合法时刻
      if (base === null || base === undefined) return null;
      const k = Math.floor((nowMs - base) / intervalMs);
      if (k < 1 || k <= warnedK) return null;
      warnedK = k;
      const msg = frameStallMessage({ stallSec: (k * intervalMs) / 1000, done: lastDone, total, chunk });
      warn(msg);
      return msg;
    },
    stop() { stopped = true; },
  };
}

/* --------------------------------------------------------------------------
 * ③ E-1：per-任务渲染锁（out/<任务>/.render-lock）
 * ----------------------------------------------------------------------- */

/** 锁文件名（落在 out/<任务>/ 下；out/ 不进 git，锁天然只属于本机工作区）。 */
export const RENDER_LOCK_FILE = '.render-lock';

/** 锁文件的人类可读相对路径（报错信息用，固定 / 分隔）。 */
export function renderLockRel(task) {
  return `out/${task}/${RENDER_LOCK_FILE}`;
}

/** 锁文件的内容（JSON，四字段固定）。 */
export function renderLockBody({ pid, task, startedAt, cmd }) {
  return { pid, task, startedAt, cmd };
}

/**
 * pid 探活判定：`process.kill(pid, 0)` 的三种结局 ——
 * 成功 = 活着；EPERM = 存在但无权探测（**视为活着**，宁枉勿纵：漏掉一个活着的渲染
 * 比错杀一个死锁文件代价大）；ESRCH = 进程不存在（死）；pid 非法（≤0 / 非整数）= 死。
 * kill 可注入（离线测试不起真进程）。
 * @param {number} pid
 * @param {(p: number) => void} [kill]
 * @returns {{ alive: boolean, why: string }}
 */
export function probePid(pid, kill) {
  const k = kill ?? ((p) => process.kill(p, 0));
  if (!Number.isInteger(pid) || pid <= 0) return { alive: false, why: 'invalid-pid' };
  try {
    k(pid);
    return { alive: true, why: 'ok' };
  } catch (err) {
    const code = /** @type {any} */ (err)?.code;
    if (code === 'EPERM') return { alive: true, why: 'eperm' };
    if (code === 'ESRCH') return { alive: false, why: 'esrch' };
    return { alive: false, why: code ? String(code) : 'error' };
  }
}

/** 读锁文件；读不到 / 不是 JSON 对象都按"坏锁"处理（corrupt: true）。 */
export function readRenderLock(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      const lock = /** @type {any} */ (parsed);
      return { lock, corrupt: false };
    }
  } catch { /* 走 corrupt */ }
  return { lock: null, corrupt: true };
}

/** 删锁（幂等：文件可能已被 clean 或人工删掉）。 */
export function clearRenderLock(file) {
  rmSync(file, { force: true });
}

/**
 * 拿渲染锁（E-1 的落点，openSession 在会话起好后调用）。
 *
 *   · 没有锁 → 直接写 { pid, task, startedAt, cmd }；
 *   · 有锁且 pid 活着 → 返回 { ok:false, holder }（调用方 die 点名）；
 *   · 有锁但 pid 已死 / 内容损坏 → 打一行"清掉残留锁"后覆写（死进程的锁不值钱）。
 *
 * @param {{ root: string, task: string, pid: number, startedAt: string, cmd: string,
 *           log?: (s: string) => void, probe?: typeof probePid }} o
 * @returns {{ ok: boolean, file: string, holder?: any }}
 */
export function acquireRenderLock(o) {
  const log = o.log ?? (() => {});
  const probe = o.probe ?? probePid;
  const file = path.join(o.root, o.task, RENDER_LOCK_FILE);
  if (existsSync(file)) {
    const { lock, corrupt } = readRenderLock(file);
    const pid = lock ? Number(lock.pid) : NaN;
    if (Number.isInteger(pid) && pid > 0) {
      const v = probe(pid);
      if (v.alive) return { ok: false, file, holder: lock };
      log(`· 清掉残留锁 ${renderLockRel(o.task)}（pid ${pid} 已不在，${v.why}）`);
    } else {
      log(`· 清掉残留锁 ${renderLockRel(o.task)}（内容${corrupt ? '损坏' : '缺 pid'}，不是一把有效的锁）`);
    }
    clearRenderLock(file);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(renderLockBody(o), null, 2) + '\n');
  return { ok: true, file };
}
