# 音效（SFX）：从 SoundDino 取，按出处记账

> 这一层之前完全没有 —— 我们只有**人声 + BGM** 两条轨。音效是「画面动作的听觉标点」，
> 缺了它，再好的转场也只是「幻灯片翻页」。

## 一、站点事实（2026-10 实测，别凭印象改）

| 项 | 实测结果 |
|---|---|
| 分类页 | `https://sounddino.com/en/effects/<slug>/`（`<slug>` 如 `whoosh-transition`） |
| 曲目数据 | 每个 `<li class="playtrack">` 带 `data-id` / `data-duration` / `data-track="/mp3/xx/soundNN.mp3"` |
| 音频地址 | 同域静态文件，**直链可下**（实测 18–52 KB / 0.2–3.2s） |
| 单页容量 | 一个分类页一次能解析出 **200+ 条**（whoosh-transition 实测 243 条） |
| 授权 | 首页 FAQ：免费、**可商用**、**无需署名**、可直接下 MP3 |
| 配额 | 页脚匿名配额「Downloads left today **Sounds 5/5** · Music 5/5」 |
| 反爬 | 没有验证码，但**别并发轰炸**；直链也可能被限速 |

**两条纪律**（写进 `docs/RULES.md` 的 S3）：

1. **每次最多 5 条**（工具默认 `--max 5`），间隔 800ms —— 不顶站点配额、不做并发下载；
2. **每条都要记出处与许可**（manifest 里 id / source / license）—— 以后要换站、要商用、要发平台，
   没有这张账就得一条条回查。

## 二、用法

```sh
node tools/sfx-fetch.mjs --list --category whoosh-transition      # 先看目录（不下载）
node tools/sfx-fetch.mjs --pick 1,3,6 --category whoosh-transition --out tasks/<任务>/audio/sfx
node tools/sfx-fetch.mjs --get 3525,3515 --out tasks/<任务>/audio/sfx   # 按 id 精确取
```

产出：

```
tasks/<任务>/audio/sfx/
  whoosh-transition__3515__The-sound-of-the-wind-for-the-transition.mp3
  sfx.manifest.json        # 唯一索引：id / title / group / durationSec / bytes / sha1 / source / license
```

## 三、两个坑（实测）

- **页面上的 `data-duration` 是取整的**（0.21s 的素材标成 1s）→ 工具用**纯 JS 数 mp3 帧**算真实时长；
  沙箱里 node 不能 spawn `ffprobe`，这条是必须的（误差约 ±0.05s）。
- **时长以 mix 时的 ffprobe 为准**：manifest 里的值只用于「挑素材」，不用于对齐；
  对齐时按秒数落点 + 用 `afade`/`adelay` 精确摆位。

## 四、还没做的（下一步）

1. **`anim mix` 支持第三条轨**：现在只有 music + vo。要加 `audio.sfx: [{ file, at, gain }]`，
   走 `amix` + 每个音效 `adelay`；同一时刻多音效要按 gain 相加而不是整体压限；
2. **候选清单**：`anim sfx <任务> --list` 读 manifest 打印「已有哪些类别 / 时长分布」，避免重复下载；
3. **与卡点对齐**：音效落点应当吸附到 `music.nearestBeat(t)` 或动作的 `prog` 结束点。

## 五、为什么不用别的站

- Freesound：质量高但要 OAuth + 下载计数严格，脚本化成本高；
- 各类「免费音效包」：许可条款参差，**没有 manifest 就没法商用记账**；
- SoundDino 的取舍：授权清晰（可商用 / 无需署名）、直链稳定、单页可枚举 —— 适合脚本化。
  代价是**配额小**（5/天），所以我们走「少量多次 + 记 id」，而不是一次抓一仓库。

## 音效库与自动摆位（2026-11-03）

### 索引：先建目录，再挑着下

```sh
node tools/sfx-fetch.mjs --index                     # 默认 36 个动效常用分类
node tools/sfx-fetch.mjs --index --categories glitch,whoosh-transition
node tools/sfx-fetch.mjs --search whoosh --limit 30   # 在索引里搜
node tools/sfx-fetch.mjs --list --category glitch     # 列某分类（带序号）
node tools/sfx-fetch.mjs --pick 1,3,6 --category glitch --dir assets/sfx
```

索引存在 `assets/sfx/catalog.json`（**只有元数据**：id / 标题 / 分类 / 时长 / 路径，不进音频，可以放心进仓库）。
当前：**2081 条 / 36 个分类**（whoosh 243、glitch 119、click 121、sci-fi 111、countdown 74、siren 70…）。

### 下载：诚实地用配额

站点页脚写着「Downloads left today Sounds 5/5」—— 所以 `--max` 默认 5、`--gap` 默认 800ms。
**一天拉 5 条，别去顶限额**（`docs/RULES.md` S3）。下下来的东西连同 `sfx.manifest.json` 落盘，
每条记 id / 标题 / 分类 / 字节 / sha1 / 时长 / 出处 / 许可 / 日期。

现有库存（`assets/sfx/`，5 条）：

| 类别 | 文件 | 时长 |
|---|---|---|
| whoosh | `whoosh-transition__73722__Sound16.mp3` | 0.29s |
| click | `click__84724__Short-click-of-a-computer-mouse.mp3` | 0.16s |
| click（错误提示） | `click__35602__Click-on-the-error-warning-sound-clip.mp3` | 0.60s |
| glitch | `glitch__2734__Very-short-glitch-sound.mp3` | 0.55s |
| energy | `energy__28978__Sound-for-an-arcade-game-energy-power-2-.mp3` | 0.97s |

### 用起来：`anim mix --sfx`

```sh
node scripts/anim.mjs mix <任务> --sfx auto            # 每个切点砸一记 whoosh（首段除外）
node scripts/anim.mjs mix <任务> --sfx whoosh,click     # 按均匀间隔摆（试听用）
node scripts/anim.mjs mix <任务> --sfx audio/sfx.json   # 正式片子写表
```

`audio/sfx.json` 的形状（`file` 可以是类别名，也可以是路径）：

```json
{ "items": [
  { "file": "whoosh", "at": 12.4 },
  { "file": "glitch", "at": 28.0, "gain": 1.2 },
  { "file": "assets/sfx/click__84724__Short-click-of-a-computer-mouse.mp3", "at": 3.2, "gain": 0.9 }
] }
```

三条实现细节（都是实测调出来的，别随手改）：

1. **峰归一**：每个素材先归一到峰值 0.7 再乘 `gain`。不同来源音量能差两三个数量级，不归一就一定「有的听不见」。
2. **侧链让路**：音效出现的前 220ms，把已混好的音乐压下约 6 dB（余弦形），出来再恢复。
   不做这一步时，切点 whoosh 只比音乐高 17% RMS —— **数字上在，耳朵里不在**。
3. **纯音乐片子也能混**：没有 `audio/timing.json`（没旁白）时，`--sfx` 在场就按「音乐 + 音效」出轨；
   以前这条路径直接抛错，而音效恰恰最缺在这种片子上。

### 判据

```sh
node tools/test-sfx.mjs    # 17 项：库查找 / 自动摆位 / 混音位置与越界记账 / 侧链 / 索引完整
```

进 CI（`regress-all --ci` 的 `unit:sfx`）。库里**找不到类别必须抛**，不是静默返回 null ——
否则「我加的音效没响」会变成永远查不出来的那种 bug。

