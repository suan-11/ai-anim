// @ts-check
import { flag } from "../lib/cli/args.mjs";
/** `anim shot-cards`：重新生成 docs/shots/ 的镜头卡；`--check` 只校验分类是否齐全 */
async function cmdShotCards() {
  // 同进程调用（沙箱里 spawn 子进程会 EPERM）
  const { generateShotCards, checkShotCards } = await import("../../tools/gen-shot-cards.mjs");
  if (flag('check')) checkShotCards();
  else generateShotCards();
}
export { cmdShotCards as run };
