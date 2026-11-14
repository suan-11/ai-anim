// @ts-check
import { cmdVideo } from "./video.mjs";
function cmdShot() { return cmdVideo(true); }
export { cmdShot as run };
