# STATUS.md —— 各轮改进记录索引

> 这份文件原本逐轮记录「读文档 → 核实不足 → 修复 → 验证」的每一步（问题 / 证据 / 改了什么 /
> 怎么验的 / 当前状态）。**正文已全部归档**，本页只留索引。
>
> **本文与代码不一致时以代码为准。**「还没做的事」只看 [`BACKLOG.md`](BACKLOG.md)；
> 当前状态看 [`HANDOVER.md`](HANDOVER.md)。

---

## 各轮在哪

| 轮次 | 内容 | 归档文件 |
|---|---|---|
| 第一～六轮 | 导出色彩空间 / `src/kit/` / 静默失败 / pdoom「3D + 一镜到底」与 raymarch | [`history/STATUS-rounds-1-6.md`](history/STATUS-rounds-1-6.md) §1–§13 |
| 第七轮 | A 档镜头库 `src/shots/`：常见镜头从一百多行降到一行，画面逐像素不变 | [`history/STATUS-rounds-7-10.md`](history/STATUS-rounds-7-10.md) §14 |
| 第八轮 | B 档「配置档」：时间线里直接写 `{ type: 'chart', … }` | 同上 §15 |
| 第九轮 | `IMPROVEMENTS-3` A–F 全部落地 + 渲染提速（`readPixels` 30×、端到端 1.97×） | 同上 §16 |
| 第十轮 | 出片推流换 NV12：每帧 8.29 → 3.11MB（−62%）；新量具 `probe-nv12` | 同上 §17 |
| 第十一轮 | sodium 的画面可读性：半实心积木 + 深度排序（"排序用的深度不能拿去算线宽"）；246s 成片重出 | [`history/STATUS-rounds-11-12.md`](history/STATUS-rounds-11-12.md) §18 |
| 第十二轮 | Three.js 接进引擎：第 3 种 3D「真网格」；沙盒 = Three.js → 引擎自绘过渡 → Three.js | 同上 §19 |
| 第十三 / 十四轮 | `tasks/optifine` 反馈 / 风格系统 + 字幕层 | [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) |

## 之后的改进轮次

第十三轮之后不再按「轮」记账，改成两条线 —— **别在这里找**：

- **已经做完的** → [`HANDOVER.md`](HANDOVER.md) 的续接记录 + `git log`。
- **计划与销账**（A1–A6 / B0 / C1–C4 三线 11 项，2026-11-14 全部收口）→ [`history/PLAN-2026-11-08.md`](history/PLAN-2026-11-08.md)。
  原路径 `docs/PLAN-2026-11-08.md` **已删除**（与归档副本逐字节相同，2026-11-15 去重）；
  外部文档里写的「`docs/PLAN-2026-11-08.md`」一律按归档副本找。
- **还没做的** → [`BACKLOG.md`](BACKLOG.md)。
