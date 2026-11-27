// @ts-check
/** breakdown 2:25-2:43 — EXECUTION×12 + 六语计数 → 白闪
 *  ASR: executions 148.02 起 ~0.92s 间隔；六语 ~159.7-163.2。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { scanlines, glitchTear, glitchColor, TERM } from './_kit.js';

// 六语计数：每个数字用**对应语言的文字**写（Genius 官方歌词 "Ein, dos, trois, 네, fem, 六"）。
// 1=德语 Eins(ein) 2=西语 Dos 3=法语 Trois 4=韩语 넷(ne) 5=瑞典语 Fem 6=中文 六(liu)
// 大字 = 该国文字的数字词；小字 = 拉丁转写 + 语言标注。
const LANGS = [
  { num: 'Eins', word: 'EIN', lang: 'DE', col: [1, 0.8, 0] },        // 德 黑红金→金
  { num: 'Dos', word: 'DOS', lang: 'ES', col: [1, 0.2, 0.1] },       // 西 红黄→红
  { num: 'Trois', word: 'TROIS', lang: 'FR', col: [0.2, 0.4, 1] },   // 法 蓝白红→蓝
  { num: '넷', word: 'NE', lang: 'KR', col: [1, 1, 1] },              // 韩 太极→白
  { num: 'Fem', word: 'FEM', lang: 'SE', col: [0, 0.5, 1] },         // 瑞 蓝黄→蓝
  { num: '六', word: 'LIU', lang: 'CN', col: [1, 0.15, 0.15] },       // 中 红
];
const NUM_FAMILY = "'Malgun Gothic', 'Noto Sans KR', 'Noto Sans SC', 'Microsoft YaHei', 'Archivo', sans-serif";

export default makeShot('breakdown', {
  setup() { this.cam = makeCinematic(); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const t = f.t;
    gl.clear(ctx.out, TERM.bg);
    text.clear();
    lines.begin();
    scanlines(ctx, t, 0.06);

    // EXECUTION ×12：148.02 起每 0.92s
    const EXEC_T = Array.from({ length: 12 }, (_, i) => 148.02 + i * 0.92);
    const execCount = EXEC_T.filter((et) => t >= et).length;
    const lastExec = execCount > 0 ? EXEC_T[execCount - 1] : null;
    const execEl = lastExec != null ? t - lastExec : Infinity;

    if (t >= 145 && t < 158.6) {
      const wallA = smoothstep(145, 147.5, t);
      const intensity = Math.exp(-execEl / 0.15);
      if (intensity > 0.02) lines.fillRect(0, 0, W, H, withAlpha(TERM.red, intensity * 0.28));   // 每记满屏红闪
      const cols = 4, rows = 3, cw = W / cols, ch = H / rows;
      for (let i = 0; i < 12; i++) {
        const cx2 = (i % cols) * cw + cw / 2;
        const cy2 = Math.floor(i / cols) * ch + ch / 2;
        const lit = i < execCount;
        const cellA = wallA * (lit ? 0.9 : 0.18);
        lines.rect(cx2 - cw * 0.42, cy2 - ch * 0.36, cw * 0.84, ch * 0.72, lit ? 2 : 1, withAlpha(lit ? TERM.red : TERM.grid, cellA * 0.6));
      }
      if (intensity > 0.02) {
        lines.circle(W * 0.5, H * 0.5, 120 + (1 - intensity) * 500, 4, withAlpha(TERM.red, intensity * 0.7));
        lines.circle(W * 0.5, H * 0.5, 60 + (1 - intensity) * 300, 2, withAlpha(TERM.amber, intensity * 0.5));
      }
      glitchTear(ctx, t, intensity * 0.9, 50 + execCount);
    }

    // 六语计数：ASR 词级实测（被误听为 'I'm just one of them'，实为 EIN DOS TROIS NE FEM LIU）
    const LANG_T = [158.76, 159.36, 159.76, 160.20, 160.64, 161.20];
    const langIdx = LANG_T.filter((lt2) => t >= lt2).length - 1;
    if (langIdx >= 0 && t < 162.4) {
      const langEl = t - LANG_T[langIdx];
      const lang = LANGS[langIdx];
      const la = Math.exp(-langEl / 0.18);
      lines.fillRect(0, 0, W, H, withAlpha(lang.col, la * 0.22));
    }

    // 白闪：LIU 之后 161.7 才炸（给 六 留 0.5s 展示），→ chorus3
    if (t >= 161.7 && t < 162.4) {
      const wf = Math.exp(-(t - 161.7) / 0.25);
      lines.fillRect(0, 0, W, H, withAlpha([1, 1, 1], Math.max(wf, 0.55) * 0.85));
    }

    lines.flush(ctx.out);
    text.clear();
    // EXECUTION 墙文字（4×3 网格，随计数点亮，填满画面）
    if (t >= 145 && t < 158.6) {
      const wallA = smoothstep(145, 147.5, t);
      const cols = 4, rows = 3, cw = W / cols, ch = H / rows;
      for (let i = 0; i < 12; i++) {
        const cx2 = (i % cols) * cw + cw / 2;
        const cy2 = Math.floor(i / cols) * ch + ch / 2;
        const lit = i < execCount;
        const cellA = wallA * (lit ? 0.9 : 0.18);
        type.write('EXECUTION', cx2, cy2 - 8, { size: 26, weight: 800, family: 'mono', color: css(lit ? TERM.red : TERM.grid, cellA), align: 'center' });
        type.write(String(i + 1).padStart(2, '0'), cx2, cy2 + 26, { size: 18, family: 'mono', color: css(lit ? TERM.amber : TERM.dim, cellA * 0.8), align: 'center' });
      }
    }
    if (lastExec != null && execEl < 0.55) {
      const slam = 1 + 0.35 * Math.exp(-execEl / 0.08);
      const ea = execEl < 0.42 ? 1 : 1 - (execEl - 0.42) / 0.13;
      const gx = Math.sin(t * 91) * 10 * Math.exp(-execEl / 0.1);
      const col = glitchColor(execEl, TERM.white) ?? TERM.white;
      type.write('EXECUTION', W * 0.5 + gx, H * 0.5, { size: Math.round(96 * slam), weight: 800, family: 'mono', color: css(col, ea), align: 'center' });
    }
    if (langIdx >= 0 && t < 162.4) {
      const langEl = t - LANG_T[langIdx];
      const lang = LANGS[langIdx];
      const la = Math.max(Math.exp(-langEl / 0.22), 0.25);
      const slam = 1 + 0.3 * Math.exp(-langEl / 0.07);
      // 大字：该国文字的数字词（Eins/Dos/Trois/넷/Fem/六）
      const numSize = lang.num.length > 2 ? 110 : 150;   // 长词缩小防出画
      type.write(lang.num, W * 0.5, H * 0.4, { size: Math.round(numSize * slam), weight: 800, family: NUM_FAMILY, color: css(TERM.white, la), align: 'center' });
      // 小字：拉丁转写 + 语言代码
      type.write(lang.word + ' · ' + lang.lang, W * 0.5, H * 0.6, { size: 40, weight: 600, family: 'mono', color: css(TERM.white, la * 0.85), align: 'center' });
    }
    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    let impact = lastExec != null ? Math.exp(-execEl / 0.12) * 0.7 : 0;
    if (langIdx >= 0) impact = Math.max(impact, Math.exp(-(t - LANG_T[langIdx]) / 0.1) * 0.8);
    return this.cam.post(ctx, { impact, bloomBase: 0.15 });
  },
});
