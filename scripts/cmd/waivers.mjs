// @ts-check
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flag, opt } from "../lib/cli/args.mjs";
import { log, warn, die } from "../lib/cli/log.mjs";
import { ROOT, pickTask } from "../lib/cli/paths.mjs";
import { validateWaiver, reusedReasons, houseStyle, WAIVER_JUDGES } from "../lib/waivers.mjs";
/* 命令：waivers —— 豁免纪律（BACKLOG 1-80）。豁免要留痕：judge + guard + reason；同判据反复豁 ⇒ house style。 */

async function cmdWaivers() {
  const task = pickTask();
  const file = path.join(ROOT, "tasks", task, "waivers.json");
  let waivers = [];
  if (existsSync(file)) { try { waivers = JSON.parse(readFileSync(file, "utf8")); } catch { die(`waivers.json 读不动：${file}`); } }
  if (!Array.isArray(waivers)) die("waivers.json 应是一个数组");

  if (flag("add")) {
    const segRaw = String(opt("segments", "") ?? "").trim();
    const segments = segRaw ? segRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;
    const w = { judge: opt("judge", ""), guard: opt("guard", ""), reason: opt("reason", ""), at: new Date().toISOString() };
    // --segments 只对「按段豁免」的判据有意义（当前是 background.coverage）；
    // 不写 = 覆盖该判据的全部对象。空串/空数组会静默变成「什么都没覆盖」，所以非空才写进去。
    if (segments && segments.length) w.segments = segments;
    const v = validateWaiver(w);
    if (!v.ok) die("豁免不成立：\n  " + v.errors.join("\n  ") + "\n（豁免不是骗过 check 的后门 —— 要有证据和关于这支片子的理由）");
    waivers.push(w);
    writeFileSync(file, JSON.stringify(waivers, null, 2));
    log(`已记录豁免：${w.judge}${w.segments ? `（${w.segments.length} 段：${w.segments.join(", ")}）` : ""}（共 ${waivers.length} 条）`);
  }

  if (!waivers.length) {
    log(`${task}：没有豁免记录。要豁免某条判据：anim waivers ${task} --add --judge <id> --guard <证据> --reason <理由> [--segments 段1,段2]`);
    log("已知豁免点：" + Object.entries(WAIVER_JUDGES).map(([k, v]) => `${k}（${v}）`).join("；"));
    log("check 已接线的判定点：layout.overlap（layout.allowOverlap）/ background.coverage（world: false）；其余登记项尚未接线，见 docs/WAIVERS.md");
    return;
  }
  log(`${task} 的豁免（${waivers.length} 条）：`);
  for (const w of waivers) {
    const v = validateWaiver(w);
    log(`  ${v.ok ? "✓" : "✗"} ${w.judge}${w.segments ? `（${w.segments.join(", ")}）` : ""} · guard: ${w.guard} · reason: ${w.reason}`);
    if (!v.ok) warn("    不成立：" + v.errors.join("；"));
  }
  const dup = reusedReasons(waivers);
  if (dup.length) warn(`  ⚠ 有 ${dup.length} 条 reason 逐字复用（样板豁免）：${dup.join(" / ")}`);
  const hs = houseStyle(waivers);
  for (const h of hs) warn(`  ⚠ house style：判据 ${h.judge} 已被豁免 ${h.count} 次 —— 这不是例外，是这支片子的风格，写进 design.md 正视它`);
  if (flag("json")) console.log(JSON.stringify({ task, waivers, houseStyle: hs, reusedReasons: dup }, null, 2));
  if (hs.length && flag("strict")) process.exitCode = 1;
}
export { cmdWaivers as run };
