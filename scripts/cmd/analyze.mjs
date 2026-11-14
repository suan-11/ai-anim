// @ts-check
import { analyzeTaskAudio } from "../lib/cli/audio.mjs";
import { pickTask } from "../lib/cli/paths.mjs";
async function cmdAnalyze() { const t = pickTask(); await analyzeTaskAudio(t); }
export { cmdAnalyze as run };
