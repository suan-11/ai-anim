// @ts-check
/** hook 0:00-0:15 — 终端启动→代码逐行打出→startSimulation() 粒子创世
 *  时间全部来自真实 LRC + ASR 词级校准（lyrics.json schema/2）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { keywordBurst, makeParticles, drawParticles, glitchTear, TERM } from './_kit.js';

const CODE_LINES = [
  'public class GodDrinksJava {',
  '  public static void main(String[] args) {',
  '    Thing me = new Lovable("Me", 0, true, -1, false);',
  '    Thing you = new Lovable("You", 0, false, -1, false);',
  '    World world = new World(5);',
  '    world.addThing(me);',
  '    world.addThing(you);',
  '    world.startSimulation();',
];
// 每行代码起点 = 对应歌词句唱点（LRC）
const LINE_T = [0.27, 1.93, 3.95, 5.57, 7.60, 9.00, 11.24, 12.93];
const KEYWORDS = [
  { t: 3.16, word: 'PROTECTION', line: 1 },
  { t: 6.34, word: 'OBJECT CREATION', line: 3 },
  { t: 9.76, word: 'INITIALIZATION', line: 5 },
  { t: 14.02, word: 'SIMULATION', line: 7 },
];

export default makeShot('hook', {
  setup() {
    this.cam = makeCinematic();
    this.genesis = makeParticles(42, 200, 'burst');
  },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const t = f.t;
    text.clear();
    lines.begin();
    const editor = smoothstep(0, 0.6, t);
    const editorX = W * 0.12, editorY = H * 0.15;
    const editorW = W * 0.45, editorH = H * 0.38;
    lines.fillRect(editorX, editorY, editorW, editorH, withAlpha([0.01, 0.035, 0.03], editor * 0.58));
    lines.rect(editorX, editorY, editorW, editorH, 2, withAlpha(TERM.green, editor * 0.28));
    lines.fillRect(editorX, editorY, editorW, 32, withAlpha(TERM.green, editor * 0.08));
    const compiled = LINE_T.filter((at) => t >= at).length;
    for (let i = 0; i < CODE_LINES.length; i++) {
      lines.fillRect(editorX + 18 + i * 18, editorY + editorH - 26, 12, 8,
        withAlpha(i < compiled ? TERM.green : TERM.grid, editor * (i < compiled ? 0.72 : 0.45)));
    }

    // 右侧 HEAP 状态面板：与左侧代码执行同步（me/you/world 分配 + tick 计数）
    const hpA = smoothstep(3.6, 3.95, t);
    const px = W * 0.60, py = H * 0.20, pw = W * 0.32, ph = H * 0.36;
    if (hpA > 0) {
      lines.fillRect(px, py, pw, ph, withAlpha([0.02, 0.05, 0.04], hpA * 0.5));
      lines.rect(px, py, pw, ph, 1.5, withAlpha(TERM.grid, hpA * 0.9));
      lines.fillRect(px, py, pw, 30, withAlpha(TERM.grid, hpA * 0.35));
      const alloc = (t > 3.95 ? 4 : 0) + (t > 5.57 ? 4 : 0) + (t > 7.60 ? 4 : 0) + (t > 9.00 ? 1 : 0) + (t > 11.24 ? 1 : 0) + (t > 12.93 ? 2 : 0);
      for (let i = 0; i < 16; i++) {
        const on = i < alloc;
        lines.fillRect(px + 14 + i * ((pw - 28) / 16), py + ph - 26, (pw - 28) / 16 - 4, 12, withAlpha(on ? TERM.green : TERM.grid, hpA * (on ? 0.7 : 0.3)));
      }
    }

    // 0-0.27s: 光标闪烁
    const cursorOn = Math.sin(t * 6) > 0;
    if (t < 0.27 && cursorOn) {
      lines.fillRect(W * 0.5 - 6, H * 0.5 - 14, 12, 28, withAlpha(TERM.green, 0.9));
    }

    // 代码逐行打出：每行起点 = 歌词句唱点
    const codeX = W * 0.18, codeY0 = H * 0.22;
    for (let i = 0; i < CODE_LINES.length; i++) {
      const lt = t - LINE_T[i];
      if (lt < 0) break;
      const fullText = CODE_LINES[i];
      const chars = Math.min(fullText.length, Math.floor(lt * 40));
      const partial = fullText.slice(0, chars);
      const isHighlight = i === 7 && t > 14.02;
      const cy = codeY0 + i * 33;
      if (isHighlight) lines.fillRect(codeX + 43, cy - 18, 410, 26, withAlpha(TERM.amber, 0.13));
      if (chars < fullText.length && cursorOn) {
        const cw = type.measure(partial, { size: 22, family: 'mono' });
        lines.fillRect(codeX + 22 * 2.4 + cw + 2, cy - 16, 10, 20, withAlpha(TERM.green, 0.8));
      }
    }

    // 关键词冲出矢量线
    for (const kw of KEYWORDS) {
      const kp = (t - kw.t) / 1.2;
      if (kp > 0 && kp < 0.3) {
        const p = sat(kp);
        for (let i = 0; i < 3; i++) {
          const ly = H * 0.72 + (i - 1) * 30;
          const lw = 200 * (0.5 + 0.5 * Math.sin(p * 30 + i * 7));
          lines.fillRect(W * 0.5 - lw / 2, ly, lw, 2, withAlpha(TERM.amber, 0.3));
        }
      }
    }

    // 14.02s SIMULATION → 粒子创世爆发
    const genesisT = t - 14.02;
    if (genesisT > 0) {
      drawParticles(ctx, this.genesis, genesisT, { x: W * 0.5, y: H * 0.5 }, 600, 0.9);
      const flash = Math.max(0, 1 - genesisT * 3);
      if (flash > 0.01) lines.fillRect(0, 0, W, H, withAlpha([1, 1, 1], flash * 0.6));
      glitchTear(ctx, t, Math.max(0, 1 - genesisT * 2) * 0.8, 7);
    }

    lines.flush(ctx.out);
    text.clear();
    type.write('GodDrinksJava.java', editorX + 18, editorY + 22, { size: 16, family: 'mono', color: css(TERM.green, editor * 0.72), align: 'left' });
    let ty = codeY0;
    for (let i = 0; i < CODE_LINES.length; i++) {
      const lt2 = t - LINE_T[i];
      if (lt2 < 0) break;
      const fullText = CODE_LINES[i];
      const chars = Math.min(fullText.length, Math.floor(lt2 * 40));
      const partial = fullText.slice(0, chars);
      const col = i === 7 ? TERM.amber : TERM.green;
      type.write(String(i + 1).padStart(3, ' '), codeX, ty, { size: 17.6, family: 'mono', color: css(TERM.dim, 0.45), align: 'left' });
      type.write(partial, codeX + 22 * 2.4, ty, { size: 22, family: 'mono', color: css(col, 0.9), align: 'left' });
      ty += 22 * 1.5;
    }
    if (hpA > 0) {
      type.write('HEAP · world.state', px + 14, py + 21, { size: 16, family: 'mono', color: css(TERM.dim, hpA * 0.9), align: 'left' });
      const ROWS = [
        { t: 3.95, s: 'me    : Lovable @0x01', c: TERM.green },
        { t: 5.57, s: 'you   : Lovable @0x02', c: TERM.green },
        { t: 7.60, s: 'world : World(5) @0x00', c: TERM.amber },
        { t: 9.00, s: t > 11.24 ? 'things: [me, you]  2/5' : 'things: [me]  1/5', c: TERM.white },
        { t: 12.93, s: 'sim   : RUNNING', c: TERM.green },
        { t: 13.33, s: `tick  : ${String(Math.max(0, Math.floor((t - 12.93) * 24))).padStart(6, '0')}`, c: TERM.dim },
      ];
      let ry = py + 64;
      for (const r of ROWS) {
        const el = t - r.t;
        if (el < 0) break;
        const chars = Math.min(r.s.length, Math.floor(el * 45));
        type.write(r.s.slice(0, chars), px + 14, ry, { size: 20, family: 'mono', color: css(r.c, hpA * 0.92), align: 'left' });
        ry += 34;
      }
    }
    let kwImpact = 0;
    for (const kw of KEYWORDS) {
      const kp = (t - kw.t) / 1.2;
      if (kp > 0 && kp < 1) {
        keywordBurst(ctx, kw.word, W * 0.5, H * 0.72, kp, { size: 88, color: TERM.amber, glitch: 0.35, dur: 1.2 });
        kwImpact = Math.max(kwImpact, Math.exp(-(t - kw.t) / 0.12) * 0.6);
      }
    }
    type.write('> goddrinksjava — simulation', 100, 50, { size: 16, family: 'mono', color: css(TERM.dim, 0.6), align: 'left' });
    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });

    return this.cam.post(ctx, { impact: Math.max(kwImpact, genesisT > 0 ? Math.max(0, 1 - genesisT) : 0), bloomBase: 0.08 });
  },
});
