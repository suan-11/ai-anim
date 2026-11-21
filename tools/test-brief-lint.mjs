#!/usr/bin/env node
// @ts-check
import assert from 'node:assert/strict';
import { BANNED_ADJECTIVES, lintBrief } from '../scripts/lib/brief-lint.mjs';

let passed = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  passed++;
  console.log('  ✓ ' + msg);
};

function makeValidBrief() {
  return {
    logline: '颜色存成什么数，和眼睛怎么看，是两件事',
    audience: '对图形渲染与前端配色有兴趣的开发者',
    duration: 90,
    style: {
      name: 'paper',
      signals: ['米白纸面底配高对比墨黑标注', '朱红仅点亮色差异常区域'],
      flipped: ['翻掉居中大字+三要点八股', '不用高 bloom 糊掉浅底'],
    },
    world: {
      background: 'paper 母题底纹 + 贯穿全片的水平色域参考尺',
      camera: 'cameraPost 缓慢呼吸推进，高光时刻做一次平滑 zoom-in',
      motif: '一根从纯蓝到纯白的水平渐变取样带',
    },
    segments: [
      {
        id: 'hook',
        role: 'hook',
        hero: '两条并置的渐变对比色带',
        metaphor: '上半条在编码空间直接平均中间发灰发暗，下半条在感知空间保持明亮平滑',
        motion: {
          primary: '色带中点扫描游标在 1.8s 拉出明度折线对比',
          secondary: '两条色带之间的误差差值柱随游标错峰伸出',
          ambient: 'paper 底纹与取样带微幅呼吸移动',
        },
        peak: { at: 'hook_gap', what: '中点误差阴影区亮起并标出 128 vs 188 读数' },
        stateDiff: '渐变带从单一色块分裂成上下两条对比带并显影差值曲线',
        relayTo: 'horizontal-gradient-strip',
        onscreen: ['sRGB (128,128,0)', 'Linear (188,188,0)'],
        build: 'custom',
      },
      {
        id: 'bridge_css',
        role: 'bridge',
        hero: 'CSS Color 4 语法卡片',
        metaphor: '旧 rgb() 函数被推走，oklab() 坐标轴接管同一条色带',
        motion: {
          primary: '水平色带整体上推 180px 让出语法解析区',
          secondary: '三条分量刻度逐个卡位到达',
          ambient: '背景纸面坐标网格保持微动',
        },
        peak: { at: 2.0, what: 'oklab(0.70 0.10 0.15) 标签卡进色带坐标' },
        stateDiff: '语法声明与色带坐标绑定',
        relayTo: 'oklab-axis',
        onscreen: ['CSS Color 4', 'oklab()'],
        build: { shot: 'kinetic', why: '辅助过渡句用动态排字把坐标接进机制段' },
      },
      {
        id: 'mech',
        role: 'mechanism',
        hero: '二维 L-a-b 色相圆盘与亮度切片',
        metaphor: 'Oklab 先把线性 RGB 经 M1/M2 立方根压缩进感知均匀坐标系再做直线插值',
        motion: {
          primary: '两条采样路径分别在非线性空间与 Oklab 空间穿过色域切片',
          secondary: '路径末端的色相角指针随采样点实时偏转并标出偏色角',
          ambient: '坐标系网格随 cameraPost 连续慢移',
        },
        peak: { at: 'mech_turn', what: 'CIELAB 蓝白路径拐进紫色区，而 Oklab 路径沿直线穿过' },
        stateDiff: '空间网格发生感知立方根非线性映射，两条插值轨迹分离',
        relayTo: 'oklab-axis',
        onscreen: ['Oklab (L, a, b)', '立方根压缩'],
        build: 'custom',
      },
      {
        id: 'data_bench',
        role: 'data',
        hero: '三色系误差对比柱',
        metaphor: '同一根基准轴上长出 sRGB / CIELAB / Oklab 三组色相偏移读数',
        motion: {
          primary: '柱体按 spring 从基准轴依次弹起',
          secondary: '数值标注随柱顶到位后对齐显示',
          ambient: '基准轴刻度保持呼吸微动',
        },
        peak: { at: 3.1, what: '最高误差柱标红并给出对比倍数' },
        stateDiff: '单一误差值展开为三组定量柱状分布',
        relayTo: 'horizontal-gradient-strip',
        onscreen: ['色相保持'],
        build: { shot: 'chart', why: '纯定量三柱对比用 chart 模板即可表达清楚' },
      },
      {
        id: 'close',
        role: 'close',
        hero: '回到开场并置色带并在 Oklab 空间一次性对齐',
        metaphor: '开场的灰暗过渡带在 Oklab 重算后瞬间抹平亮度凹陷并定格',
        motion: {
          primary: '亮度折线从凹陷曲线弹直为水平稳态线',
          secondary: '三组坐标轴标签向中心收拢定帧',
          ambient: '定帧后环境进入静置余韵',
        },
        peak: { at: 'close_settle', what: '色带亮度凹陷被完全拉平并弹出最终总结数字' },
        stateDiff: '两条撕裂色带合并为唯一稳态感知渐变',
        relayTo: '',
        onscreen: ['Oklab · 2020'],
        build: 'custom',
      },
    ],
    antiList: [
      '不要在屏幕上方堆两套完整旁白句子',
      '不要在暗底或浅底上开高 bloom 糊掉文字边缘',
      '不要写"蓝黄只在 Oklab 不发灰"的错误物理说法',
    ],
  };
}

console.log('test-brief-lint:');

// 1. 合格分镜
{
  const res = lintBrief(makeValidBrief());
  ok(res.errors.length === 0, '完整合规 brief 零报错（模板占比 2/5=40% 正好达标）');
  ok(res.warnings.length === 0, '≤30 字 logline 无长度警告');
  ok(res.stats.customSegs === 3 && res.stats.templateSegs === 2, '统计手写段与模板段数量准确');
}

// 2. 占位符 / 空字段
{
  const b = makeValidBrief();
  b.logline = '<填>';
  b.world.motif = '';
  b.segments[0].hero = '<填>';
  const res = lintBrief(b);
  ok(res.errors.some((e) => e.code === 'BRIEF-EMPTY' && e.msg.includes('logline')), 'logline 为 <填> 时报 BRIEF-EMPTY');
  ok(res.errors.some((e) => e.code === 'BRIEF-EMPTY' && e.msg.includes('world.motif')), 'world.motif 为空时报 BRIEF-EMPTY');
  ok(res.errors.some((e) => e.code === 'BRIEF-EMPTY' && e.seg === 'hook'), '段字段为 <填> 时报 BRIEF-EMPTY');
}

// 3. 形容词黑名单（全词表都必须触发）
for (const adj of BANNED_ADJECTIVES) {
  const b = makeValidBrief();
  b.segments[0].metaphor = `画面非常${adj}地呈现出来`;
  const res = lintBrief(b);
  ok(res.errors.some((e) => e.code === 'BRIEF-ADJECTIVE' && e.msg.includes(adj)), `形容词黑名单命中「${adj}」`);
}

// 4. 主角段不可套模板
for (const role of ['hook', 'mechanism', 'close']) {
  const b = makeValidBrief();
  const idx = b.segments.findIndex((s) => s.role === role);
  b.segments[idx].build = { shot: 'title', why: '想省事' };
  const res = lintBrief(b);
  ok(res.errors.some((e) => e.code === 'BRIEF-CUSTOM-REQUIRED' && e.seg === b.segments[idx].id), `role=${role} 套模板必报 BRIEF-CUSTOM-REQUIRED`);
}

// 5. 模板占比 > 40% 与同模板重复 >= 3 次
{
  const b = makeValidBrief();
  // 把 hook/mech/close 保持 custom，再加 3 个 bridge 模板段 → 5/8 = 62.5% 且 chart×3
  b.segments.splice(3, 0,
    { ...b.segments[3], id: 'd2', build: { shot: 'chart', why: '辅助 2' } },
    { ...b.segments[3], id: 'd3', build: { shot: 'chart', why: '辅助 3' } },
    { ...b.segments[1], id: 'b2', build: { shot: 'scan', why: '辅助 4' } },
  );
  const res = lintBrief(b);
  ok(res.errors.some((e) => e.code === 'BRIEF-TEMPLATE-RATIO'), '模板占比 >40% 报 BRIEF-TEMPLATE-RATIO');
  ok(res.errors.some((e) => e.code === 'BRIEF-TEMPLATE-DUP' && e.msg.includes('chart')), '同模板出现 3 次报 BRIEF-TEMPLATE-DUP');
}

// 6. 接力物断点
{
  const b = makeValidBrief();
  b.segments[1].relayTo = '';
  const res = lintBrief(b);
  ok(res.errors.some((e) => e.code === 'BRIEF-RELAY' && e.seg === 'bridge_css'), '中间段缺少 relayTo 报 BRIEF-RELAY');
}

// 7. onscreen 超 18 字
{
  const b = makeValidBrief();
  b.segments[0].onscreen = ['这是一句超过了十八个字的完整说明旁白句子'];
  const res = lintBrief(b);
  ok(res.errors.some((e) => e.code === 'BRIEF-ONSCREEN-LEN' && e.seg === 'hook'), 'onscreen 超过 18 字报 BRIEF-ONSCREEN-LEN');
}

// 8. antiList 不足 3 条 & 缺 hook / close
{
  const b = makeValidBrief();
  b.antiList = ['只有一条', '只有两条'];
  b.segments[0].role = 'data';
  b.segments[4].role = 'data';
  const res = lintBrief(b);
  ok(res.errors.some((e) => e.code === 'BRIEF-ANTILIST'), 'antiList <3 条报 BRIEF-ANTILIST');
  ok(res.errors.some((e) => e.code === 'BRIEF-NO-HOOK'), '缺少 hook 段报 BRIEF-NO-HOOK');
  ok(res.errors.some((e) => e.code === 'BRIEF-NO-CLOSE'), '缺少 close 段报 BRIEF-NO-CLOSE');
}

// 9. logline 超 30 字只报 warning
{
  const b = makeValidBrief();
  b.logline = '这是一句刻意超过三十个字符用来触发长度提示的完整一句话立意总结';
  const res = lintBrief(b);
  ok(res.errors.length === 0 && res.warnings.some((w) => w.code === 'BRIEF-LOGLINE-LEN'), 'logline >30 字进 warnings 不阻塞');
}

console.log(`\n✓ test-brief-lint：${passed} 项通过`);
