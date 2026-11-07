/**
 * scripts/lib/sfx-rules.mjs —— **按语义选音效**：切点不再一律 whoosh。
 *
 * 纯函数（不碰磁盘、不跑 ffmpeg），所以能离线断言：给一段 `build()` 出来的段表，
 * 返回要摆的音效清单。`anim mix --sfx auto` 就是它。
 *
 * ## 为什么要按语义分
 *
 * 全片 45 个切点全砸同一声 whoosh，前 10 秒就腻了 —— 而且**用错了地方**：
 * 标题砸下来要的是「撞」，图表出数据要的是「哒」，收尾要的是「断电」，
 * 这三种声音在观众耳朵里是三个意思，混用等于什么都没说。
 *
 * ## 规则（按优先级，命中即止；一个切点最多一个主声）
 *
 * | 段是什么 | 声音 | 为什么 |
 * |---|---|---|
 * | `title` / `bigtype` / `kinetic` 段首 | `destruction`（裁到 0.55s）+ `camera-flash` | 大字砸下来 = 撞 + 闪 |
 * | `outro` 段首 | `power-outage` | 收尾是「世界关灯」，不是「切镜头」 |
 * | `chart` / `counter` / `compare` / `timeline` 段首 | `digital-click` | 数据出现那一下是 UI 声，不是风声 |
 * | 其它切点 | `whoosh` | 画面被甩走，耳朵里就该有一声风 |
 * | **大字段之前** | 追加 `riser`（长 whoosh 的尾巴 1.2s，**结束在切点上**） | 冲上去需要先吸气 |
 *
 * 另外：**第一条段不放切点声**（片子开头不需要推门声），但 `title` 段的撞击照放。
 */

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { findSfx, SFX_LIB } from './mix.mjs';

/** 段类型 → 声音角色的映射（改这里就是改「语义」） */
export const BIG_TYPES = new Set(['title', 'bigtype', 'kinetic', 'punch']);
export const DATA_TYPES = new Set(['chart', 'counter', 'compare', 'timeline', 'scan']);

/** 取段类型：配置档节点是 `type`，手写场景是 `id`（`build()` 两者都保留） */
export const typeOf = (seg) => String(seg?.type ?? seg?.id ?? '').toLowerCase();

/** 歌词镜头的表演方式（params.mode）：mask / vertical / glitch / karaoke / ticker … */
export const modeOf = (seg) => String(seg?.params?.mode ?? '').toLowerCase();

/**
 * 表演方式的**族**：只在「换族」时才给切点声。
 * 逐句切换具体花样（karaoke→mask→vertical）是**同一个唱段内部**的变化，每句一声风就太吵了；
 * 真正该有声音的是「唱 → 停字 → 唱」这种结构转换。
 */
export const MODE_FAMILY = {
  karaoke: 'sing', ticker: 'sing',
  mask: 'display', vertical: 'display', big: 'display', stack: 'display',
  glitch: 'fx', shatter: 'fx',
};
export const familyOf = (mode) => MODE_FAMILY[mode] ?? (mode ? 'display' : '');

const startOf = (seg) => Number(seg?.start ?? seg?.at ?? 0);

/**
 * 选音效。
 * @param {Array<any>} segments `build()` 出来的段表（只用 type/id/start/end）
 * @param {{ libDir?: string, gainScale?: number }} [opts]
 * @returns {{ items: Array<{file:string, at:number, gain:number, offset?:number, len?:number, role:string}>, missing: string[] }}
 */
export function designSfx(segments, opts = {}) {
  const libDir = opts.libDir ?? SFX_LIB;
  const k = opts.gainScale ?? 1;
  const segs = Array.isArray(segments) ? segments : [];
  const items = [];
  const missing = [];
  // 角色 → 库里的**挑选规则**（不是一个死路径）：
  //   whoosh      = 最短的那个 whoosh（切点要"短促"）
  //   whoosh-long = 最长的那个 whoosh（riser / 吸气用它，靠 offset+len 裁）
  //   其它        = 按类别前缀找第一条
  const pickFile = (role) => {
    try {
      if (role === 'whoosh' || role === 'whoosh-long') {
        const files = readdirSync(libDir).filter((f) => /^whoosh.*\.mp3$/i.test(f));
        if (!files.length) throw new Error('库里没有 whoosh');
        const bySize = files.map((f) => ({ f, n: statSync(path.join(libDir, f)).size }));
        bySize.sort((a, b) => a.n - b.n);
        const hit = role === 'whoosh' ? bySize[0] : bySize[bySize.length - 1];
        return path.join(libDir, hit.f);
      }
      return findSfx(role, libDir);
    } catch (e) {
      if (!missing.includes(role)) missing.push(role);
      return null;
    }
  };
  const lib = pickFile;
  const add = (kind, at, gain, extra = {}) => {
    const file = lib(kind);
    if (!file || !(at >= 0)) return false;
    items.push({ file, at: Number(Number(at).toFixed(3)), gain: gain * k, role: extra.role ?? kind, ...extra });
    return true;
  };

  segs.forEach((seg, i) => {
    const t = typeOf(seg);
    const mode = modeOf(seg);
    const at = startOf(seg);
    const isFirst = i === 0;
    const isLast = i === segs.length - 1;

    // ⓪ **歌词镜头**（有 params.mode）：句句相连，不能每句一声风 ——
    //    只在「表演方式变了」的时候给一声，这才是观众听到的段落感。
    if (mode) {
      const prevMode = i > 0 ? modeOf(segs[i - 1]) : '';
      const fam = familyOf(mode);
      const prevFam = familyOf(prevMode);
      if (isFirst) {
        add('destruction', at, 0.95, { offset: 0.02, len: 0.5 });
        add('camera-flash', at, 0.65, { len: 0.45 });
        return;
      }
      if (isLast) { add('power-outage', at, 0.85, { len: 1.5 }); return; }
      if (mode === 'glitch') { add('glitch', at, 1.0, { len: 0.55 }); return; }
      if (fam !== prevFam) { add('whoosh', at, 1.0); return; }
      // 同一种表演方式延续：不放切点声（唱段里连着的句子不该被风打断）
      return;
    }

    if (BIG_TYPES.has(t)) {
      // 撞击别给太满：它是峰归一后的倍数，给到 1.15 会把整条轨的线性归一压下去 3 dB（实测 -16.4 LUFS）
      add('destruction', at, 0.95, { offset: 0.02, len: 0.55 });
      add('camera-flash', at, 0.7, { len: 0.5 });
      if (!isFirst) add('whoosh-long', at, 0.85, { offset: 9.6, len: 1.2, role: 'riser-in' });
      return;
    }
    if (t === 'outro') {
      add('power-outage', at, 0.9, { len: 1.6 });
      return;
    }
    if (DATA_TYPES.has(t)) {
      add('digital-click', at, 0.85, { len: 0.4 });
      if (!isFirst) add('whoosh', at, 0.9);
      return;
    }
    if (!isFirst) add('whoosh', at, 1.0);
  });

  // 大字段之前补 riser：谁的下一个段是 BIG，就在这个切点提前吸气
  segs.forEach((seg, i) => {
    const next = segs[i + 1];
    if (!next || !BIG_TYPES.has(typeOf(next))) return;
    const cut = startOf(next);
    if (!(cut > 0.01)) return;
    if (items.some((x) => x.role === 'riser' && Math.abs(x.at + (x.len ?? 0) - cut) < 0.06)) return;
    add('whoosh-long', Math.max(0, cut - 1.2), 0.7, { offset: 8.4, len: 1.2, role: 'riser' });
  });

  items.sort((a, b) => a.at - b.at);
  return { items, missing };
}

/** 日志摘要：每种角色用了几个 */
export function summarize(items) {
  const m = new Map();
  for (const it of items) m.set(it.role, (m.get(it.role) ?? 0) + 1);
  return [...m.entries()].map(([r, n]) => r + '×' + n).join(' ');
}
