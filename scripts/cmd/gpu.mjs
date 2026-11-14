// @ts-check
import { log, warn } from "../lib/cli/log.mjs";
import { pickTask } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/* ------------------------------------------------------------------ 命令：gpu */

async function cmdGpu() {
  // ⚠ 必须和 `check` 走**同一条采集路径**（P2-4）：以前这里自己新建 canvas 去问，
  //   于是同一个 GPU 在 `check` 里显示 `WebKit WebGL`、在这里显示 ANGLE 全串。
  //   现在两边都读引擎在 gl.js 里采集好的那一份。
  await openSession({ task: pickTask(), offline: false });
  try {
    const r = await getSession().page.evaluate(() => /** @type {any} */ (window).__anim.info());
    const g = r.gpu ?? {};
    log(JSON.stringify({
      ok: !!g.renderer,
      renderer: g.unmaskedRenderer ?? g.renderer,
      vendor: g.unmaskedVendor ?? g.vendor,
      version: g.version,
      /** unmasked 串可用吗 */
      unmasked: !!g.unmasked,
      floatRT: !!g.floatRT,
    }, null, 2));
    if (!g.unmasked) {
      warn('⚠ unmasked renderer 不可用（WEBGL_debug_renderer_info 拿不到）—— 上面是笼统的渲染器串。');
    }
    if (!g.floatRT) warn('⚠ 无法渲染到浮点纹理：本引擎需要 EXT_color_buffer_float（HDR 渲染）。');
  } finally { await closeSession(); }
}
export { cmdGpu as run };
