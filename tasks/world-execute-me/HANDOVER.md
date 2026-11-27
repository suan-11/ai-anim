# world.execute(me); MV 交接

更新：2026-11-24 晚。**草稿 v7 已出片**（`out/world-execute-me/world-execute-me.remotion.draft.mp4`，20:36，qa 通过 0 错 0 警），等用户审片反馈。

## 本轮 v7（2026-11-24 晚）做了什么

- **猫改终端 ASCII**（verse2 phase2，81.37–85.13）：mono 绿字坐姿虎斑猫（耳/脸/须/`===`条纹/爪），逐行打印入场 + 眨眼 + 猫身下方连接的呼噜波形 + `~ purr ~`。旧的"圆叠圆色块猫"读不出是猫，已弃。
- **★根因修复：Remotion 帧首缺 `text.clear()`**。`Layer2D.upload()` 每帧只上传一次（`_uploaded` 守卫，仅 clear/fill 重置）；这 9 个场景只在两次合成之间 clear、**帧首不 clear**，Remotion 复用引擎时第一次合成画到陈旧纹理 → 代码行/示波器标签/AD-BC/公式/猫**变淡或消失**（legacy 单帧渲染不受影响，所以一直没暴露）。**这才是用户说"后面非常空"的真正原因**。修法：9 个场景 draw 帧首加 `text.clear()`。已验证全部恢复。
- **后半段全面加密加重**（用户："后面半段太水了"→ 选"全面重做"）：
  - bridge：try/catch 框加大 + 密集滚动栈迹填满；ILLEGAL ARGUMENTS 改满宽故障横幅；尾段(134→145.6) 改 crash-dump 双列滚动红错误行 + `RETRY n/12` 计数爬升 + 进度条，预示 breakdown。
  - breakdown：EXECUTION×12 改满屏 4×3 墙（随计数点亮，每记满屏红闪 + 双层冲击波）；六语/白闪保留。
  - chorus3：递归矩形更大更快铺满；StackOverflow 栈迹双列级联填满画面 + 满宽故障横幅；trapped 螺旋放大。
  - close：被困 me 向中心汇聚(`conv`)，love 碎片向 me 收拢 + 心跳加速；终局 `world.execute(me);` 大字居中 + 闪光/冲击波，随后 `> love` / `process exited (0)` 收尾按钮，再淡出（淡出延后到 execT>1.2 给按钮留时间）。
- **验证**：各段单帧 remotion stills 已 Read 确认；全片草稿 4980/4980 帧 + 音轨，qa 通过。

## 已完成

- **真实时间轴**：旧 lyrics.json 是伪造的均匀 1.845s 网格。已用用户提供的 LRC（到 122.97）+ faster-whisper small ASR 词级校准重建 `lyrics.json`（schema/2，96 行）。关键结构：hook 0–14.8、器奏 14.8–29.74、verse1 29.74–58.8、chorus1 58.8–74、verse2 74–103.5、chorus2 103.5–125、bridge 125–145.6、breakdown 145.6–162、chorus3 161.4–177.2、close 177.2–207.5。总长 207.5s / 4980 帧。
- **大字白色**：keywordBurst 与所有大字号 type.write 统一 TERM.white；冲击环/撕裂线保留点缀色；红蓝 glitch 以白为底混合。
- **DIMENSION 退场**：唱词 32.74 后右拉成线，线留下变成 AC/DC 示波器中轴。
- **AC/DC 示波图**：44.48 起，面板+刻度网格+荧光绿扫描线，AC 正弦↔DC 方波每拍翻转。
- **AD/BC 时间轴**：51.38–55.17，年份刻度+游标 AD 向右/BC 向左+方向箭头色块。
- **dizzy**：49.78–51.38 旋转色块漩涡+画面倾斜。
- **六语数字用对应语言文字**：Eins(DE) / Dos(ES) / Trois(FR) / 넷(KR) / Fem(SE) / 六(CN)。时刻 158.76/159.36/159.76/160.20/160.64/161.20（ASR 实测，被误听为 "I'm just one of them"）。白闪移到 161.7 给「六」留展示时间。
- **字体已验证**：playwright 逐字截图 `out/_tmp/glyph_*.png`，넷/六/Eins/Dos/Trois/Fem 全部真实渲染（非方框）。字体栈 `'Malgun Gothic','Noto Sans KR','Noto Sans SC','Microsoft YaHei','Archivo',sans-serif`。
- **猫/番茄/茄子改色块**：verse2 四段全部加填充色块（猫=头+耳+身剪影+绿眼+呼噜色块条；番茄=红果+绿蒂+电子轨道；茄子=紫果+分子环），峰值后 exit 退场。only god 树加色块叶节点+退场。

## 待做（接手先跑）

1. **✅ v7 草稿已渲**（20:36，qa 通过）。重渲命令（改稿后用）：
   ```sh
   TMPDIR="$PWD/out/_tmp" TEMP=同 TMP=同 \
   node scripts/anim.mjs video world-execute-me --renderer remotion --draft --segments 15 --samples 1
   ```
   ⚠ TMPDIR 必须用 Windows 反斜杠路径指向 out/_tmp，否则 ffmpeg 写系统 temp 被拒。
   ⚠ **渲染期间一个文件都别写**（HMR 会断流）；改稿/更新本文档都在渲染结束后做。
   ⚠ 场景改过 ⇒ remotion 哈希变 ⇒ 从头渲（旧分块作废），全片 ~30 分钟（14 块 ×~2.2min）。
2. **用户审片 v7**（当前停在这一步）：把草稿路径交用户看，等反馈再改；**用户明确说"定稿/出正式版"才去掉 --draft**。独立审片重点：
   - 后半段是否还"水"（v7 已全面加密：bridge crash-dump/RETRY、breakdown EXECUTION 墙、chorus3 满屏栈溢出、close 汇聚+大高潮+收尾按钮）
   - 猫 ASCII 是否读得出、六语是否对应语言文字且对齐唱词
   - DIMENSION→示波器衔接、AD/BC、dizzy 是否到位（text.clear 修复后这些代码行/标签应已显现）
   - 各段退场是否及时（不要残留上一段元素）
3. 用户偏好（见 memory）：**先给方案/选项再动手**、**拒绝 ambient 填充("水")**、要满屏密度+冲击+叙事实质。空画面补内容要贴歌词、多用色块、不硬凑。

## 环境备忘

- faster-whisper 装在 `C:/Program Files/Python312/python.exe`（--no-deps + 手动补依赖 httpx2/httpcore2/truststore/idna/typing_extensions 等）。模型 small 已缓存。下载用 `HF_ENDPOINT=https://hf-mirror.com`。av 版本坑：用 ffmpeg 解 f32le numpy 喂入绕开（`out/_tmp/asr_calibrate.py`）。
- ASR 词级结果：`out/_tmp/asr_words.json` / `asr_words.txt`。
- 音频实测：`out/_tmp/full.wav`（22050Hz mono）。音乐实际 207.3s 淡尽，后 5s 静音。
- Remotion 渲染 temp 目录 Permission denied → TMPDIR/TEMP/TMP 指 out/_tmp。
- 渲染期别挂 `<Audio>`（逐帧抽音频超时）；音轨走 CLI --muted + ffmpeg 封装。
- auto 子帧在 release 段极慢，草稿用 --samples 1（约 20 分钟全片）。

## 关键文件

- `tasks/world-execute-me/task.config.mjs` — 段边界（at 钉死）
- `tasks/world-execute-me/lyrics.json` — 真实唱点 schema/2
- `tasks/world-execute-me/scenes/*.js` — 9 段，全部绝对唱点驱动
- `tasks/world-execute-me/scenes/_kit.js` — keywordBurst（白字）、glitchColor
- `out/world-execute-me/world-execute-me.remotion.draft.mp4` — 当前草稿 **v7**（2026-11-24 20:36，含 ASCII 猫 + text.clear 修复 + 后半段重做）
