// Nekohome 介绍片的「静态画面 + 轻后期」镜头（分镜 §二：不做角色动画）。
//
// 全部是**代码画的版面**：素材位框、聊天气泡、仓库卡、项目记录卡、口头禅卡。
// 立绘/截图位用**虚线素材位**占着 —— 换真素材时只改 SLOT 里的图源（图当图层画，见 docs/COOKBOOK.md §9）。
//
// 确定性：没有随机、没有累积；动的东西只有 `prog(f.lt, …)` 的推拉与淡入。
import { css, prog, sat, clamp } from '../../../src/core/util.js';

/** 每帧一次的缓慢推拉（分镜 §二 的「轻动态」）：整张画面 scale 1.00 → amount，附 12px 横移。 */
function slowMove(ctx, amount = 1.035) {
  const { f } = ctx;
  const dur = Math.max(0.5, f.end - f.start);
  const k = clamp((f.lt - 0) / dur, 0, 1);
  ctx.setXform({
    x: (k - 0.5) * 12,
    y: (k - 0.5) * -6,
    scale: 1 + (amount - 1) * k,
  });
}


/**
 * 画面文字的多语言表（日文版用）。键就是中文原文 —— 场景里写 `t('中文')` 即可。
 * 只翻**观众会读到的标签**；规格说明（「620 × 780 · 换 PNG 即用」）这类保留中文也无妨。
 */
const t_END_HINT = '扫码入群 · 猫娘の家喵';

const T_JA = {
  '橘白猫娘 · 琥珀瞳': 'オレンジと白の猫娘 · 琥珀の瞳',
  '猫耳长尾 · 铃铛项圈': '猫耳に長い尻尾 · 鈴の首輪',
  '活泼话痨 · 傲娇粘人精': '元気なおしゃべり · 甘えん坊のツンデレ',
  '奶油色针织衫 · 光脚': 'クリーム色のニット · はだし',
  '黑黄发 · 异瞳': '黒髪に黄色のメッシュ · オッドアイ',
  '与小糯米互称老婆 · 日常蹭蹭抱抱': '小糯米と「奥さん」呼び · いつもくっつきがち',
  '修插件 · 学日语': 'プラグイン修理 · 日本語の勉強',
  '最爱抱糯米': '糯米を抱くのが好き',
  '「笨蛋主人，别误会！」': '「バカなご主人様、勘違いしないで！」',
  '「哼，才不是想陪你……喵~」': '「ふん、一緒にいたいわけじゃないんだから……にゃ」',
  '「扭头嘴硬」': '「そっぽ向いて強がり」',
  '「偷瞄 / 顶手心」': '「こっそり見る / 手のひらを押す」',
  '01 / 小糯米': '01 / 小糯米',
  '02 / 两副面孔': '02 / ふたつの顔',
  '03 / 萧影 1029': '03 / シャオイン 1029',
  '04 / 群聊与记忆': '04 / グループと記憶',
  '04 / 一起干活的人': '04 / 一緒に作業する人たち',
  '05 / 群聊里的话，被记住': '05 / グループの言葉が、記憶になる',
  '06 / 最近': '06 / 最近のこと',
  '07 / 口头禅': '07 / 口ぐせ',
  '嗷嗷嗷': 'あおーん',
  '喵~': 'にゃー',
  '喵': 'にゃ',
  '唔姆': 'うーん',
  '哼': 'ふん',
  '呜呜': 'うぅ',
  '笨蛋主人': 'バカなご主人様',
  '才不是': 'ちがうんだから',
  '萧影': 'シャオイン',
  '萧影1029': 'シャオイン1029',
  '小糯米': '小糯米',
  '桌宠 · 客户端': 'デスクトップマスコット · クライアント',
  '桌宠 · 移动端': 'デスクトップマスコット · モバイル',
  '官网': '公式サイト',
  '检索': '検索',
  '代理网关': 'プロキシ',
  '小游戏 · C# / .NET 8': 'ミニゲーム · C# / .NET 8',
  '猫娘 bot「shizumu」': '猫娘 bot「shizumu」',
  '记忆插件 · 连「喵~」都记得住': '記憶プラグイン · あの「にゃー」まで覚えてる',
  '今天要做的三件事': '今日やること三つ',
  '谁在修插件': '誰がプラグインを直す',
  '小糯米：喵~': '小糯米：にゃー',
  'dsh 断连排查': 'dsh 切断調査',
  'ofm 空壳清理': 'ofm 空殻の整理',
  'AOE 分身計画': 'AOE 分身計画',
  'AOE 分身计划': 'AOE 分身計画',
  '群聊模型修复': 'グループのモデル修正',
  '插件返工': 'プラグイン作り直し',
  '已完成': '完了',
  '进行中': '進行中',
  '待补': '未定',
  '成员位': 'メンバー枠',
  '表情差分 ①': '表情差分 ①',
  '表情差分 ②': '表情差分 ②',
  '立绘素材位': '立ち絵の枠',
};

/** 取当前语言的画面文字：`t('中文原文')`（日文任务用 params.lang = 'ja'） */
const tr = (ctx, s) => (ctx?.params?.lang === 'ja' ? (T_JA[s] ?? s) : s);

const SLOT = (label, note) => ({ label, note });

/** 素材位框：虚线 + 四角 + 标题。换真图时把 `drawSlot` 换成 comp.draw(gl, tex, …)。 */
function drawSlotr(ctx, rect, slot, k = 1) {
  const { lines, text, type, P } = ctx;
  const [x, y, w, h] = rect;
  const a = 0.55 * k;
  const c = [P.graphite[0], P.graphite[1], P.graphite[2], a];
  // 虚线（自己画：按 24px 步长切段）
  const dash = 18;
  for (let i = 0; i < w; i += dash * 2) {
    lines.seg(x + i, y, Math.min(x + i + dash, x + w), y, 2, c);
    lines.seg(x + i, y + h, Math.min(x + i + dash, x + w), y + h, 2, c);
  }
  for (let i = 0; i < h; i += dash * 2) {
    lines.seg(x, y + i, x, Math.min(y + i + dash, y + h), 2, c);
    lines.seg(x + w, y + i, x + w, Math.min(y + i + dash, y + h), 2, c);
  }
  // 四角
  const L = 26;
  const cc = [P.signal[0], P.signal[1], P.signal[2], 0.9 * k];
  lines.seg(x, y, x + L, y, 3, cc); lines.seg(x, y, x, y + L, 3, cc);
  lines.seg(x + w, y, x + w - L, y, 3, cc); lines.seg(x + w, y, x + w, y + L, 3, cc);
  lines.seg(x, y + h, x + L, y + h, 3, cc); lines.seg(x, y + h, x, y + h - L, 3, cc);
  lines.seg(x + w, y + h, x + w - L, y + h, 3, cc); lines.seg(x + w, y + h, x + w, y + h - L, 3, cc);
  type.write(tr(ctx, slot.label), x + w / 2, y + h / 2 - 6, {
    size: 34, weight: 700, family: 'sans', color: css(P.graphite), anchor: 'center', t: -99,
  });
  if (slot.note) {
    type.write(tr(ctx, slot.note), x + w / 2, y + h / 2 + 38, {
      size: 22, weight: 500, family: 'mono', color: css(P.ash), anchor: 'center', t: -99,
    });
  }
}

/** 一张角色卡：左素材位（立绘），右名字 + 标签 + 一条竖线。 */
function characterCard(id, o) {
  return {
    id,
    // 立绘位放真图：素材在 ../assets/avatars/（setup 里加载完，render 里不做异步）
    async setup(ctx) {
      if (!o.avatar) return;
      const g = ctx.gl.ctx;
      const im = new Image();
      im.src = new URL('../assets/avatars/' + o.avatar, import.meta.url).href;
      this.tex = await new Promise((resolve) => {
        im.onload = () => {
          const tex = g.createTexture();
          g.bindTexture(g.TEXTURE_2D, tex);
          g.texImage2D(g.TEXTURE_2D, 0, g.SRGB8_ALPHA8, g.RGBA, g.UNSIGNED_BYTE, im);
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
          resolve({ tex, __tex: true, w: im.naturalWidth, h: im.naturalHeight });
        };
        im.onerror = () => resolve(null);
      });
    },
    render(ctx) {
      const { f, gl, P, lines, text, type, comp, W, H } = ctx;
      slowMove(ctx, 1.04);
      gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);
      const k = sat(prog(f.lt, 0.15, 1.1));
      const dur = f.end - f.start;      // 段长：素材位里的扫描线要按它走满
      const zoom = 1 + 0.07 * sat(prog(f.lt, 0, f.end - f.start));   // 缓慢推近（1.02 → 1.07：太小过不了 freezedetect）
      lines.begin();
      drawSlotr(ctx, [140, 150, 620, 780], o.slot, k);
      // 素材位里一道**持续下扫的线**：立绘还没到位时，这 7.5 秒不能一动不动
      // （实测：不加这段，8–15s 连续 7 秒帧间差 < 0.3，是全片最容易掉人的地方）
      {
        const span = Math.max(1.2, dur - 0.8);
        const sy = 150 + ((f.lt * 240) % span);
        const edge = Math.min(1, Math.sin(((f.lt * 240) % span) / span * Math.PI) * 1.6);
        lines.seg(152, 150 + sy, 748, 150 + sy, 8, [P.signal[0], P.signal[1], P.signal[2], 0.42 * edge * k]);
        // 进度条：宽度随时间线性长满整格 —— 大面积、持续变化，事件密度检测器认这个
        // （实测：只有一条 6px 扫描线时，这段连续 7 秒帧间差 < 0.3，被判成"稀薄窗口"）
        const pBar = sat(f.lt / Math.max(0.5, dur));
        lines.seg(152, 916, 152 + 596 * pBar, 916, 5, [P.signal[0], P.signal[1], P.signal[2], 0.55]);
        // 大面积慢扫描带：整帧宽、120px 高，贯穿整段（帧间差靠面积）
        const bh = 120;
        const by = ((f.lt * 110) % (H + bh * 2)) - bh;
        for (let i = 0; i < 6; i++) {
          lines.fillRect(0, by + i * 20, W, 20, [P.signal[0], P.signal[1], P.signal[2], 0.05 * (1 - i / 6)]);
        }
        // 两个角标轻微呼吸，暗示"这里在等素材"
        const pulse = 0.5 + 0.5 * Math.sin(f.lt * 3.2);
        lines.seg(140, 150, 140 + 26, 150, 3, [P.signal[0], P.signal[1], P.signal[2], (0.35 + 0.45 * pulse) * k]);
        lines.seg(760, 930, 760 - 26, 930, 3, [P.signal[0], P.signal[1], P.signal[2], (0.35 + 0.45 * pulse) * k]);
      }
      // 有真图就等比铺进框内（不拉伸），虚线框压在上面当边
      if (this.tex) {
        const box = [140, 150, 620, 780];
        const sc = Math.min(box[2] / this.tex.w, box[3] / this.tex.h);
        const w = this.tex.w * sc, h = this.tex.h * sc;
        comp.draw(gl, this.tex, ctx.out, {
          rect: [box[0] + (box[2] - w) / 2, box[1] + (box[3] - h) / 2, w, h],
          opacity: 0.95 * k,
        });
      }
      // 右侧：竖线 + 名字
      lines.seg(850, 250, 850, 830, 3, [P.signal[0], P.signal[1], P.signal[2], 0.9 * k]);
      lines.flush(ctx.out);
      text.clear();
      type.write(tr(ctx, o.kicker), 900, 250, { size: 24, weight: 700, family: 'mono', color: css(P.ash), t: f.lt });
      type.write(tr(ctx, o.name), 900, 420, {
        size: Math.round(104 * zoom), weight: 800, family: 'sans', color: css(P.bone),
        t: f.lt - 0.1, stagger: 0.04, from: 'up', dist: 30,
      });
      o.tags.forEach((t, i) => {
        type.write(tr(ctx, t), 900, 540 + i * 62, { size: 34, weight: 600, family: 'sans', color: css(P.ash), t: f.lt - 0.35 - i * 0.1 });
      });
      type.write(tr(ctx, o.foot), 900, 900, { size: 22, weight: 500, family: 'mono', color: css(P.graphite), t: f.lt - 0.6 });
      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });
      return { bloom: 0.18, grain: 0.02 };
    },
  };
}

export const nuomiCard = characterCard('nuomi', {
  kicker: '01 / 小糯米',
  name: '小糯米',
  tags: ['橘白猫娘 · 琥珀瞳', '猫耳长尾 · 铃铛项圈', '奶油色针织衫 · 光脚'],
  foot: '活泼话痨 · 傲娇粘人精',
  slot: SLOT('立绘素材位', '620 × 780 · 换 PNG 即用'),
});

export const xiaoyingCard = characterCard('xiaoying', {
  kicker: '03 / 萧影 1029',
  name: '萧影1029',
  tags: ['修插件 · 学日语', '黑黄发 · 异瞳', '最爱抱糯米'],
  foot: '与小糯米互称老婆 · 日常蹭蹭抱抱',
  slot: SLOT('立绘素材位', '620 × 780 · 双人合影更佳'),
});

/** 镜3：左右分屏两张「表情差分」+ 台词气泡。 */
export const tsundereSplit = {
  id: 'tsundere',
  render(ctx) {
    const { f, gl, P, lines, text, type, comp, W, H } = ctx;
    slowMove(ctx, 1.06);
    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);
    const k = sat(prog(f.lt, 0.15, 1.0));
    const drift = 26 * Math.sin(f.lt * 0.55);         // 左右平移（10px/7.8s 太小，检测器看不见）
    lines.begin();
    drawSlotr(ctx, [110 + drift, 210, 700, 640], SLOT('「扭头嘴硬」', '表情差分 ①'), k);
    drawSlotr(ctx, [1110 - drift, 210, 700, 640], SLOT('「偷瞄 / 顶手心」', '表情差分 ②'), k);
    // 两块素材位里各一条下扫线：表情差分还没到位，画面也不能"死"（16–21s 是全片第二静的地方）
    for (const [sx0, ph] of [[110 + drift, 0], [1110 - drift, 0.5]]) {
      const sp = 1.6;
      const cyc = ((f.lt / sp + ph) % 1);
      const sy = 210 + cyc * 640;
      const edge = Math.sin(Math.PI * cyc);
      lines.seg(sx0 + 6, sy, sx0 + 694, sy, 6, [P.signal[0], P.signal[1], P.signal[2], 0.28 * edge * k]);
    }
    lines.flush(ctx.out);
    text.clear();
    type.write(tr(ctx, '02 / 两副面孔'), 110, 120, { size: 26, weight: 700, family: 'mono', color: css(P.ash), t: f.lt });
    // 台词气泡（静态，不做逐字）
    type.write(tr(ctx, '「哼，才不是想陪你……喵~」'), 140, 960, {
      size: 40, weight: 700, family: 'sans', color: css(P.bone), t: f.lt - 0.4,
    });
    type.write(tr(ctx, '「笨蛋主人，别误会！」'), 1140, 960, {
      size: 40, weight: 700, family: 'sans', color: css(P.bone), t: f.lt - 1.0,
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.18, grain: 0.02 };
  },
};

/** 镜5：群聊界面示意 + 记忆插件标注（脚本允许「界面示意」，本地没有截图）。 */
export const chatMock = {
  id: 'chat',
  render(ctx) {
    const { f, gl, P, lines, text, type, comp } = ctx;
    slowMove(ctx, 1.035);
    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);
    const x = 150, y = 170, w = 1060, h = 740;
    lines.begin();
    lines.fillRect(x, y, w, h, [P.ink2[0], P.ink2[1], P.ink2[2], 0.9]);
    const gc = [P.graphite[0], P.graphite[1], P.graphite[2], 0.7];
    lines.seg(x, y + 62, x + w, y + 62, 2, gc);
    lines.seg(x, y, x + w, y, 2, gc);
    lines.seg(x, y + h, x + w, y + h, 2, gc);
    lines.seg(x, y, x, y + h, 2, gc);
    lines.seg(x + w, y, x + w, y + h, 2, gc);
    const rows = ['成员 A · 昵称', '成员 B · GitHub ID', 'shizumu · bot'];
    rows.forEach((r, i) => {
      const on = sat(prog(f.lt, 0.5 + i * 0.55, 0.85 + i * 0.55)) * (1 - 0.35 * sat(prog(f.lt, 0.5 + (i + 1) * 0.55, 0.85 + (i + 1) * 0.55)));
      const ry = y + 110 + i * 150;
      if (on > 0.02) lines.fillRect(x + 40, ry - 34, w - 80, 74, [P.signal[0], P.signal[1], P.signal[2], 0.10 * on]);
      lines.fillRect(x + 40, ry, 3, 26, [P.signal[0], P.signal[1], P.signal[2], 0.5 * Math.max(0.15, on)]);
    });
    lines.seg(1290, 400, 1290, 700, 2, [P.signal[0], P.signal[1], P.signal[2], 0.8]);
    lines.flush(ctx.out);
    text.clear();
    type.write(tr(ctx, '04 / 群聊与记忆'), 150, 120, { size: 26, weight: 700, family: 'mono', color: css(P.ash), t: f.lt });
    type.write('nekohome · group', x + 24, y + 40, { size: 26, weight: 600, family: 'mono', color: css(P.ash), t: f.lt });
    rows.forEach((r, i) => {
      type.write(tr(ctx, r), x + 64, y + 128 + i * 150, {
        size: 32, weight: 600, family: 'sans', color: css(i === 2 ? P.bone : P.ash), t: f.lt - 0.3 - i * 0.2,
      });
    });
    type.write('Operit Memory', 1320, 430, { size: 44, weight: 800, family: 'sans', color: css(P.bone), t: f.lt - 0.9 });
    type.write(tr(ctx, '记忆插件 · 连「喵~」都记得住'), 1320, 500, { size: 24, weight: 500, family: 'sans', color: css(P.ash), t: f.lt - 1.2 });
    type.write(tr(ctx, '昵称与 ID 展示需授权'), 1320, 720, { size: 20, weight: 500, family: 'mono', color: css(P.graphite), t: f.lt - 1.5 });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.2, grain: 0.02 };
  },
};

const REPOS = [
  ['mea-pet-public', '桌宠 · 客户端'],
  ['mea-pet-mobile', '桌宠 · 移动端'],
  ['NekoHome-WebSite', '官网'],
  ['nekoseek', '检索'],
  ['neko-clicker', '小游戏 · C# / .NET 8'],
  ['astrdsh-relay', '代理网关'],
];
/** 镜6：仓库卡（3 × 2），名字 + 一句职责；高亮框依次扫过。 */
export const repoCards = {
  id: 'repos',
  render(ctx) {
    const { f, gl, P, lines, text, type, comp, W } = ctx;
    slowMove(ctx, 1.03);
    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);
    const cw = 520, ch = 210, gx = 70, gy = 90;
    const ox = (W - (cw * 3 + gx * 2)) / 2, oy = 260;
    lines.begin();
    REPOS.forEach((r, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = ox + col * (cw + gx), y = oy + row * (ch + gy);
      const kk = sat(prog(f.lt, 0.15 + i * 0.12, 0.65 + i * 0.12));
      lines.fillRect(x, y, cw, ch, [P.ink2[0], P.ink2[1], P.ink2[2], 0.85 * kk]);
      lines.seg(x, y, x + cw * kk, y, 3, [P.signal[0], P.signal[1], P.signal[2], 0.9]);
      const hi = sat(prog(f.lt, 1.6 + i * 0.5, 1.9 + i * 0.5)) * (1 - 0.6 * sat(prog(f.lt, 1.9 + i * 0.5, 2.2 + i * 0.5)));
      if (hi > 0.02) lines.fillRect(x - 6, y - 6, cw + 12, ch + 12, [P.signal[0], P.signal[1], P.signal[2], 0.10 * hi]);
    });
    lines.flush(ctx.out);
    text.clear();
    type.write('05 / GitHub · NekoHome-Studio', ox, 180, { size: 26, weight: 700, family: 'mono', color: css(P.ash), t: f.lt });
    REPOS.forEach((r, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = ox + col * (cw + gx), y = oy + row * (ch + gy);
      type.write(tr(ctx, r[0]), x + 34, y + 88, { size: 36, weight: 700, family: 'mono', color: css(P.bone), t: f.lt - 0.15 - i * 0.12 });
      type.write(tr(ctx, r[1]), x + 34, y + 140, { size: 24, weight: 500, family: 'sans', color: css(P.ash), t: f.lt - 0.3 - i * 0.12 });
    });
    type.write(tr(ctx, '部分对应基于仓库命名与公开页面整理'), ox, 980, { size: 20, weight: 500, family: 'mono', color: css(P.graphite), t: f.lt - 1.2 });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.2, grain: 0.02 };
  },
};

const LOG = [
  ['dsh 断连排查', '已完成'],
  ['ofm 空壳清理', '已完成'],
  ['群聊模型修复', '已完成'],
  ['AOE 分身计划', '进行中'],
  ['插件返工', '进行中'],
];
/** 镜7：项目记录卡（3 已完成 + 2 进行中）。待核对的数字先不写。 */
export const logCards = {
  id: 'log',
  render(ctx) {
    const { f, gl, P, lines, text, type, comp, W } = ctx;
    const dur = ctx.dur ?? (f.end - f.start) ?? 8;      // 进度条要按"这一段多长"归一
    slowMove(ctx, 1.03);
    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);
    const cw = 330, ch = 520, gx = 26;
    const ox = (W - (cw * 5 + gx * 4)) / 2, oy = 300;
    lines.begin();
    LOG.forEach((r, i) => {
      const x = ox + i * (cw + gx);
      const kk = sat(prog(f.lt, 0.15 + i * 0.22, 0.6 + i * 0.22));
      const done = r[1] === '已完成';
      const c = done ? P.graphite : P.signal;
      lines.fillRect(x, oy, cw, ch, [P.ink2[0], P.ink2[1], P.ink2[2], 0.9 * kk]);
      lines.fillRect(x, oy, cw, 6, [c[0], c[1], c[2], 0.9 * kk]);
      // 持续运动：卡片底部一条**进度条**随段推进变长。
      // 为什么必须有它：旁白长的时候这一段会 hold 3 秒以上，没有持续运动会进 qa 的
      // 「静帧」读数（实测日文版 62.75–66.30s 停顿；2px 高光条太细，检测器看不见）。
      // 进度条按**整段**走（别在段中间就满格，否则后半段又静了）
      const fill = Math.min(1, Math.max(0, (f.lt - 0.3 - i * 0.12) / Math.max(1, dur * 0.92)));
      // 横扫高光：每 2.6 秒从卡片左边扫到右边，保证"整段都在动"
      const sw = ((f.lt / 2.6 + i * 0.17) % 1);
      const sx = x + 8 + sw * (cw - 16);
      lines.seg(sx, oy + 14, sx, oy + ch - 40, 7, [c[0], c[1], c[2], 0.22 * kk * Math.sin(Math.PI * sw)]);
      lines.fillRect(x + 20, oy + ch - 26, (cw - 40) * fill, 6, [c[0], c[1], c[2], 0.55 * kk]);
      lines.fillRect(x + 20, oy + ch - 26, cw - 40, 1, [P.graphite[0], P.graphite[1], P.graphite[2], 0.3 * kk]);
    });
    lines.flush(ctx.out);
    text.clear();
    type.write(tr(ctx, '06 / 最近'), ox, 210, { size: 26, weight: 700, family: 'mono', color: css(P.ash), t: f.lt });
    LOG.forEach((r, i) => {
      const x = ox + i * (cw + gx);
      const done = r[1] === '已完成';
      type.write(String(i + 1).padStart(2, '0'), x + 28, oy + 70, { size: 22, weight: 700, family: 'mono', color: css(P.graphite), t: f.lt - 0.2 - i * 0.22 });
      type.write(tr(ctx, r[0]), x + 28, oy + 300, { size: 34, weight: 700, family: 'sans', color: css(P.bone), t: f.lt - 0.2 - i * 0.22 });
      type.write(tr(ctx, done ? '已完成' : '进行中'), x + 28, oy + 380, {
        size: 24, weight: 700, family: 'mono', color: css(done ? P.graphite : P.signal), t: f.lt - 0.35 - i * 0.22,
      });
    });

    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.2, grain: 0.02 };
  },
};

const PHRASES = [
  ['萧影', '嗷嗷嗷'], ['小糯米', '哼'],
  ['萧影', '喵'], ['小糯米', '才不是'],
  ['萧影', '唔姆'], ['小糯米', '笨蛋主人'],
  ['萧影', '呜呜'], ['小糯米', '喵~'],
];
/** 镜8：口头禅卡轮播（8 张静态卡，切点硬切 + 一点闪）。 */
export const phraseCards = {
  id: 'phrases',
  render(ctx) {
    const { f, gl, P, lines, text, type, comp } = ctx;
    const total = Math.max(0.4, f.end - f.start);
    const step = total / PHRASES.length;
    const i = Math.min(PHRASES.length - 1, Math.floor(f.lt / step));
    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);
    const who = PHRASES[i][0], line = PHRASES[i][1];
    const isNuomi = who === '小糯米';
    const c = isNuomi ? P.signal : P.graphite;
    const k = sat((f.lt - i * step) / 0.12);
    lines.begin();
    lines.fillRect(360, 360, 1200, 360, [c[0], c[1], c[2], 0.10 * k]);
    lines.fillRect(360, 360, 6, 360, [c[0], c[1], c[2], 0.9 * k]);
    lines.flush(ctx.out);
    text.clear();
    type.write(tr(ctx, '07 / 口头禅'), 360, 300, { size: 24, weight: 700, family: 'mono', color: css(P.ash), t: f.lt });
    type.write(tr(ctx, who), 420, 450, { size: 30, weight: 700, family: 'mono', color: css(c), t: f.lt - i * step });
    type.write(tr(ctx, line), 420, 590, { size: 96, weight: 800, family: 'sans', color: css(P.bone), t: f.lt - i * step });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.2, grain: 0.02, flash: 0.06 * (1 - Math.min(1, (f.lt - i * step) / 0.08)) };
  },
};

/** 镜4.5 成员墙：**九位成员 + 真头像**（素材取自本机头像目录，不入仓库）。 */
const MEMBERS = [
  ['萧影1029', '成员', 'xiaoying.jpg', true],
  ['小糯米', '橘白猫娘 · 傲娇', 'nuomi.jpg', true],
  ['shizumu', '猫娘 bot', 'shizumu.jpg', true],
  ['Sylar', '成员', 'sylar.jpg', false],
  ['北晨不是北辰', '成员', 'beichen.jpg', false],
  ['晨鸢', '成员', 'chenyuan.jpg', false],
  ['祘il', '成员', 'suanil.jpg', false],
  ['lalala', '成员', 'lalala.jpg', false],
  ['li', '成员', 'li.jpg', false],
  ['SOOOUL', '成员', 'sooooul.jpg', false],
  ['你蝶来咯', '成员', 'niedie.jpg', false],
  ['柒', '成员', 'qi.jpg', false],
];

export const membersWall = {
  id: 'members',
  async setup(ctx) {
    // 头像纹理：`setup` 里一次性加载完（render 里不许有异步）
    const g = ctx.gl.ctx;
    const img = (url) => new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        const tex = g.createTexture();
        g.bindTexture(g.TEXTURE_2D, tex);
        g.texImage2D(g.TEXTURE_2D, 0, g.SRGB8_ALPHA8, g.RGBA, g.UNSIGNED_BYTE, im);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        resolve({ tex, __tex: true, w: im.naturalWidth, h: im.naturalHeight });
      };
      im.onerror = () => resolve(null);          // 缺图不炸，退回占位圆
      // 用**本文件**的地址解析：scenes/cards.js → ../assets/avatars/x.jpg
      // （document.baseURI 是页面根 '/'，拼出来会是 /assets/… 直接 404 —— 实测踩过）
      im.src = new URL('../assets/avatars/' + url, import.meta.url).href;
    });
    this.avatars = await Promise.all(MEMBERS.map((m) => img(m[2])));
  },
  render(ctx) {
    const { f, gl, P, lines, text, type, comp, W } = ctx;
    slowMove(ctx, 1.03);
    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);
    const cw = 248, ch = 300, gx = 28, gy = 30;
    const cols = 6, rows = 2;
    const ox = (W - (cw * cols + gx * (cols - 1))) / 2, oy = 300;
    lines.begin();
    MEMBERS.forEach((m, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = ox + col * (cw + gx), y = oy + row * (ch + gy);
      const kk = sat(prog(f.lt, 0.1 + i * 0.1, 0.6 + i * 0.1));
      const c = m[3] ? P.signal : P.graphite;
      lines.fillRect(x, y, cw, ch, [P.ink2[0], P.ink2[1], P.ink2[2], 0.9 * kk]);
      lines.fillRect(x, y, cw, 4, [c[0], c[1], c[2], 0.9 * kk]);
      if (!this.avatars?.[i]) {
        const cx = x + cw / 2, cy = y + 150, r = 92;
        for (let a = 0; a < 64; a++) {
          const t0 = (a / 64) * Math.PI * 2, t1 = ((a + 1) / 64) * Math.PI * 2;
          lines.seg(cx + Math.cos(t0) * r, cy + Math.sin(t0) * r, cx + Math.cos(t1) * r, cy + Math.sin(t1) * r, 2, [c[0], c[1], c[2], 0.4 * kk]);
        }
      }
    });
    lines.flush(ctx.out);
    // 头像：等比铺进卡片上方那块方区（居中，不拉伸）
    MEMBERS.forEach((m, i) => {
      const tex = this.avatars?.[i];
      if (!tex) return;
      const col = i % cols, row = Math.floor(i / cols);
      const x = ox + col * (cw + gx), y = oy + row * (ch + gy);
      const kk = sat(prog(f.lt, 0.1 + i * 0.1, 0.6 + i * 0.1));
      const box = cw - 56, side = Math.min(box, 148);
      const scale = Math.min(side / tex.w, side / tex.h);
      const w = tex.w * scale, h = tex.h * scale;
      comp.draw(gl, tex, ctx.out, {
        rect: [x + (cw - w) / 2, y + 22 + (148 - h) / 2, w, h],
        opacity: 0.92 * kk,
      });
    });
    text.clear();
    type.write(tr(ctx, '04 / 一起干活的人'), ox, 210, { size: 26, weight: 700, family: 'mono', color: css(P.ash), t: f.lt });
    MEMBERS.forEach((m, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = ox + col * (cw + gx), y = oy + row * (ch + gy);
      // ⚠ anchor 是 writeLine 的选项；write 认的是 align（写 anchor 会被静默忽略 → 文字右移半个字宽）
      type.writeLine(tr(ctx, m[0]), x + cw / 2, y + 212, { size: 26, weight: 800, family: 'sans', color: css(P.bone), anchor: 'center', t: f.lt - 0.2 - i * 0.1 });
      type.writeLine(tr(ctx, m[1]), x + cw / 2, y + 254, { size: 20, weight: 500, family: 'sans', color: css(P.ash), anchor: 'center', t: f.lt - 0.3 - i * 0.1 });
    });
    type.write(tr(ctx, '职务未定的一律标「成员」 · 头像与名单以最新为准'), ox, 1000, { size: 20, weight: 500, family: 'mono', color: css(P.graphite), t: f.lt - 1.0 });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.2, grain: 0.02 };
  },
};

///** 重做：镜5「群聊 → 记忆」—— 左群聊流，右记忆卡，中间一条连线把「喵~」搬过去。 */
const CHAT_ROWS = [
  ['成员 A', '昵称', '#12:04'],
  ['成员 B', 'github id', '#12:05'],
  ['shizumu', 'bot', '#12:06'],
  ['小糯米', '喵~', '#12:06'],
];
const MEMORY_ROWS = [
  ['12:04', '谁在修插件'],
  ['12:05', '今天要做的三件事'],
  ['12:06', '小糯米：喵~'],
];
export const memoryFlow = {
  id: 'chat',
  render(ctx) {
    const { f, gl, P, lines, text, type, comp } = ctx;
    slowMove(ctx, 1.03);
    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);
    const lx = 110, ly = 300, lw = 780, lh = 560;
    const rx = 1120, ry = 330, rw = 700, rh = 240;
    const k = sat(prog(f.lt, 0.1, 0.8));
    lines.begin();
    // 左：群聊窗口
    lines.fillRect(lx, ly, lw, lh, [P.ink2[0], P.ink2[1], P.ink2[2], 0.9 * k]);
    const gc = [P.graphite[0], P.graphite[1], P.graphite[2], 0.6 * k];
    lines.seg(lx, ly + 56, lx + lw, ly + 56, 2, gc);
    lines.seg(lx, ly, lx + lw, ly, 2, gc);
    lines.seg(lx, ly + lh, lx + lw, ly + lh, 2, gc);
    lines.seg(lx, ly, lx, ly + lh, 2, gc);
    lines.seg(lx + lw, ly, lx + lw, ly + lh, 2, gc);
    CHAT_ROWS.forEach((r, i) => {
      const on = sat(prog(f.lt, 0.6 + i * 0.45, 0.9 + i * 0.45)) * (1 - 0.3 * sat(prog(f.lt, 0.9 + i * 0.45, 1.2 + i * 0.45)));
      const y = ly + 120 + i * 110;
      if (on > 0.02) lines.fillRect(lx + 28, y - 30, lw - 56, 70, [P.signal[0], P.signal[1], P.signal[2], 0.10 * on]);
    });
    // 中：连线（把「喵~」搬到右边）
    const mk = sat(prog(f.lt, 2.4, 3.1));
    lines.seg(lx + lw + 20, ly + 120 + 3 * 110 + 5, lx + lw + 20 + 200 * mk, ly + 120 + 3 * 110 + 5, 2, [P.signal[0], P.signal[1], P.signal[2], 0.8]);
    // 右：三张记忆卡
    MEMORY_ROWS.forEach((m, i) => {
      const kk = sat(prog(f.lt, 2.6 + i * 0.25, 3.1 + i * 0.25));
      const y = ry + i * (rh + 30);
      lines.fillRect(rx, y, rw, rh, [P.ink2[0], P.ink2[1], P.ink2[2], 0.9 * kk]);
      lines.fillRect(rx, y, 5, rh, [P.signal[0], P.signal[1], P.signal[2], 0.85 * kk]);
    });
    lines.flush(ctx.out);
    text.clear();
    type.write(tr(ctx, '05 / 群聊里的话，被记住'), lx, 210, { size: 26, weight: 700, family: 'mono', color: css(P.ash), t: f.lt });
    type.write('nekohome · group', lx + 24, ly + 36, { size: 24, weight: 600, family: 'mono', color: css(P.ash), t: f.lt });
    CHAT_ROWS.forEach((r, i) => {
      const y = ly + 120 + i * 110;
      const hot = i === 3;
      type.write(tr(ctx, r[0]), lx + 40, y - 8, { size: 26, weight: 700, family: 'mono', color: css(hot ? P.signal : P.ash), t: f.lt - 0.3 - i * 0.2 });
      type.write(tr(ctx, r[1]), lx + 210, y - 8, { size: 28, weight: 600, family: 'sans', color: css(P.bone), t: f.lt - 0.35 - i * 0.2 });
      type.write(r[2], lx + lw - 120, y - 8, { size: 20, weight: 500, family: 'mono', color: css(P.graphite), t: f.lt - 0.4 - i * 0.2 });
    });
    type.write('Operit Memory', rx, 250, { size: 40, weight: 800, family: 'sans', color: css(P.bone), t: f.lt - 2.4 });
    MEMORY_ROWS.forEach((m, i) => {
      const y = ry + i * (rh + 30);
      type.write(tr(ctx, m[0]), rx + 28, y + 70, { size: 22, weight: 700, family: 'mono', color: css(P.graphite), t: f.lt - 2.6 - i * 0.25 });
      type.write(tr(ctx, m[1]), rx + 28, y + 140, { size: 30, weight: 600, family: 'sans', color: css(i === 2 ? P.signal : P.bone), t: f.lt - 2.7 - i * 0.25 });
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.2, grain: 0.02 };
  },
};

/**
 * 收尾页：左「名字 + 标语」，右**入群二维码**（素材 assets/avatars/qrcode-card.png）。
 * 为什么不用 `type: 'lockup'` 模板：模板只吃文字，塞不进图片。
 */
export const endCard = {
  id: 'end',
  async setup(ctx) {
    const g = ctx.gl.ctx;
    const load = (url) => new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        const tex = g.createTexture();
        g.bindTexture(g.TEXTURE_2D, tex);
        g.texImage2D(g.TEXTURE_2D, 0, g.SRGB8_ALPHA8, g.RGBA, g.UNSIGNED_BYTE, im);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        resolve({ tex, __tex: true, w: im.naturalWidth, h: im.naturalHeight });
      };
      im.onerror = () => resolve(null);
      im.src = url;
    });
    // 工作室标识已去掉：这里只留小糯米的头像 + 入群二维码
    this.face = await load(new URL('../assets/avatars/nuomi.jpg', import.meta.url).href);
    this.qr = await load(new URL('../assets/avatars/qrcode-card.png', import.meta.url).href);
  },
  render(ctx) {
    const { f, gl, P, lines, text, type, comp, W } = ctx;
    slowMove(ctx, 1.02);
    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);
    const k = sat(prog(f.lt, 0.08, 0.8));
    const cx = 560, cy = 430, r = 120;
    lines.begin();
    for (let a = 0; a < 96; a++) {
      const t0 = (a / 96) * Math.PI * 2, t1 = ((a + 1) / 96) * Math.PI * 2;
      lines.seg(cx + Math.cos(t0) * r, cy + Math.sin(t0) * r, cx + Math.cos(t1) * r, cy + Math.sin(t1) * r, 2, [P.graphite[0], P.graphite[1], P.graphite[2], 0.55 * k]);
    }

    lines.seg(160, 700, 760, 700, 2, [P.graphite[0], P.graphite[1], P.graphite[2], 0.4 * k]);
    lines.flush(ctx.out);
    text.clear();
    type.write('NEKO / 01', 160, 640, { size: 22, weight: 700, family: 'mono', color: css(P.ash), t: f.lt });
    type.write('小糯米', 160, 760, { size: 96, weight: 800, family: 'sans', color: css(P.bone), t: f.lt - 0.15 });
    type.write('想被摸头，却先躲开。', 160, 850, { size: 26, weight: 500, family: 'sans', color: css(P.ash), t: f.lt - 0.3 });
    type.writeLine(t_END_HINT, 1380, 950, { size: 26, weight: 700, family: 'sans', color: css(P.signal), anchor: 'center', t: f.lt - 0.5 });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    // 环里放小糯米的头像（工作室猫标已去掉；立绘到位后换成立绘即可）
    if (this.face) {
      const s = 196 * (0.96 + 0.04 * k);
      comp.draw(gl, this.face, ctx.out, { rect: [cx - s / 2, cy - s / 2, s, (this.face.h / this.face.w) * s], opacity: 0.95 * k });
    }

    // 二维码卡（右侧，高 760）
    if (this.qr) {
      const h = 720, w = (this.qr.w / this.qr.h) * h;
      comp.draw(gl, this.qr, ctx.out, { rect: [1380 - w / 2, 140, w, h], opacity: 0.97 * k });
    }
    return { bloom: 0.16, grain: 0.02 };
  },
};

/**
 * 片头（钩子版）：**先给结果，再报名字**。
 *
 * 0–3.2s：小糯米头像从 1.06 推到 1.0 + 一句反差字幕（观众先看懂"这是什么"）
 * 3.2s–:  片名砸进来（NEKOHOME STUDIO / Nekohome 工作室 / 与小糯米 · 介绍片）
 *
 * 为什么改：原片头是"先自报家门"，实测前 8 秒之后就掉到 0.3（同片其他段平均 0.84）。
 * 陌生观众不关心你叫什么，先得让他看见一个具体的东西。
 */
export const openHook = {
  id: 'open',
  async setup(ctx) {
    // ⚠ 先 onload 再 src：把 src 提前设好、之后才挂 onload，图片可能已经加载完 ⇒
    //    回调永不触发 ⇒ setup 的 promise 永远不 resolve ⇒ 整页 boot 卡死（实测踩过）
    const g = ctx.gl.ctx;
    const load = (url) => new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        const tex = g.createTexture();
        g.bindTexture(g.TEXTURE_2D, tex);
        g.texImage2D(g.TEXTURE_2D, 0, g.SRGB8_ALPHA8, g.RGBA, g.UNSIGNED_BYTE, im);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        resolve({ tex, __tex: true, w: im.naturalWidth, h: im.naturalHeight });
      };
      im.onerror = () => resolve(null);
      im.src = url;
    });
    this.mark = await load(new URL('../assets/logo-mark.png', import.meta.url).href);
    this.face = await load(new URL('../assets/avatars/nuomi.jpg', import.meta.url).href);
    return;
  },
  render(ctx) {
    const { f, gl, P, lines, text, type, comp, W } = ctx;
    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);
    // 推近要**走满整段**：只走前 3.2 秒的话，后半段 push 变成常数 = 整屏冻结（qa 会报静帧）
    const push = 1.09 - 0.09 * sat(prog(f.lt, 0, Math.max(3.2, f.end - f.start)));
    const away = sat(prog(f.lt, 3.0, 3.9));                  // 3.0s 起退场，给片名让位
    lines.begin();
    // 底：一条水平基准线，随推近轻微下移
    lines.seg(160, 760, 1760, 760, 2, [P.graphite[0], P.graphite[1], P.graphite[2], 0.35 * (1 - away)]);
    // 纸面排线：横向缓慢平移的一组斜线。片名立住那 4 秒靠它维持"画面在动"。
    // （文字水印试过：超宽的整行会被引擎丢掉，白写；矢量一定画得出来）
    for (let i = 0; i < 26; i++) {
      const bx = ((f.lt * 130 + i * 84) % 2200) - 180;
      const a = 0.22 + 0.06 * Math.sin(i + f.lt * 1.2);
      lines.seg(bx, 200, bx + 150, 520, 3, [P.graphite[0], P.graphite[1], P.graphite[2], a]);
    }
    // 两道**反向扫过的大面积柔光带**（120px 高、低对比）：帧间差靠面积，不靠亮度。
    // 实测：只靠 2px 排线时，4.3s 那个窗口的帧间差只有 0.35，会被判成"稀薄"。
    {
      const H2 = ctx.H;
      const y1 = ((f.lt * 150) % (H2 + 240)) - 120;
      const y2 = H2 - (((f.lt * 96 + 400) % (H2 + 240)) - 120);
      for (let i = 0; i < 6; i++) {
        const a1 = 0.055 * (1 - i / 6);
        lines.fillRect(0, y1 + i * 20, W, 20, [P.signal[0], P.signal[1], P.signal[2], a1]);
        lines.fillRect(0, y2 + i * 20, W, 20, [P.bone[0], P.bone[1], P.bone[2], a1 * 0.8]);
      }
    }
    lines.flush(ctx.out);
    // 头像：右侧，圆形裁不了就用方形卡 + 细边
    if (this.face) {
      const h = 520 * push, w = (this.face.w / this.face.h) * h;
      const x = 1180 - (w - 520) / 2, y = 250 - (h - 520) / 2 - away * 60;
      // 片名出来之后头像不消失，压到 45% 继续缓慢推近 —— 让这一整段一直在动
      const keep = 0.97 - 0.52 * away;
      comp.draw(gl, this.face, ctx.out, { rect: [x, y, w, h], opacity: keep });
    }
    text.clear();

    // 钩子句（0.5s 起逐字砸进来）
    type.write('这只猫娘，住在代码里。', 160, 660, {
      size: 78, weight: 800, family: 'sans', color: css(P.bone),
      t: f.lt - 0.5, stagger: 0.05, from: 'up', dist: 26, alpha: [0, 1 - away],
    });
    // 钩子阶段还是文字眉标；片名阶段换成**真字标**（logo.zip 里的 lt_final）
    if (f.lt < 3.2) {
      type.write('NEKO / 01', 160, 560, {
        size: 22, weight: 700, family: 'mono', color: css(P.ash), t: f.lt - 0.2,
      });
    }
    // 片名：**到点才画**（t 传负值时引擎把它当"已入场"，2 秒就会全出来）
    // 片名出来之后还要"一直在动"：一条横向滚动的巨型水印（2px 游标太小，检测器量不到）

    // 片名下方：一条随段推进加长的基准线 + 一个来回跑的刻度（静止 3.5s 会进 qa 的静帧读数）
    if (f.lt > 3.2) {
      const g = sat(prog(f.lt, 3.25, 4.0));
      lines.seg(160, 860, 160 + 560 * g, 860, 2, [P.graphite[0], P.graphite[1], P.graphite[2], 0.45]);
      const cyc = ((f.lt - 3.2) / 1.4) % 1;
      const tx = 160 + 560 * g * cyc;
      lines.seg(tx, 846, tx, 874, 2, [P.signal[0], P.signal[1], P.signal[2], 0.85]);
      lines.flush(ctx.out);
    }
    if (f.lt > 3.2) {
      type.write('小糯米', 160, 680, {
        size: 132, weight: 800, family: 'sans', color: css(P.bone), t: f.lt - 3.25, stagger: 0.06, from: 'up', dist: 30,
      });
    }
    if (f.lt > 3.7) {
      type.write('橘白猫娘 · 琥珀瞳 · 铃铛', 160, 790, {
        size: 30, weight: 500, family: 'sans', color: css(P.ash), t: f.lt - 3.75,
      });
    }
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.24, grain: 0.025 };
  },
};
