import assert from 'node:assert/strict';
import { smooth, phase, recoil, cascadePose, contourPoint, deconstructPose } from '../src/kit/action-motion.js';
import { TextKit } from '../src/core/text.js';
import { shot } from '../src/shots/index.js';

let passed=0;
function test(name,fn) { fn(); passed++; console.log('✓ '+name); }
const close=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('蓄力/落定曲线端点速度与加速度趋零，倒序采样不改结果',()=>{
  for(const p of [0,.1,.35,.8,1]) close(smooth(p),1-smooth(1-p));
  close(smooth(-1),0);close(smooth(2),1);
  assert.ok(smooth(.0001)<1e-9);
  close(phase(.3,.3,.8),0); close(phase(.8,.3,.8),1);
});
test('接触时间来自物体真正的位置，未接触不许先响应（3/7/12 叶片）',()=>{
  for(const count of [3,7,12]) {
    const {contacts}=cascadePose(0,count);
    contacts.forEach((v,i)=>{
      const at=cascadePose(v.at,count);
      close(at.travel,i/(count-1));
      assert.equal(cascadePose(v.at-1e-7,count).contacts[i].response,0);
      assert.equal(cascadePose(v.at-1e-7,count).contacts[i].kick,0);
      assert.ok(cascadePose(v.at+.03,count).contacts[i].response>0);
    });
  }
});
test('接力结束回到中心、回弹有限且衰减；参数错当场抛',()=>{
  close(cascadePose(1).gather,1);close(cascadePose(1).anticipation,0);
  assert.equal(recoil(-.1),0);assert.ok(Math.abs(recoil(3))<1e-10);
  for(const count of [0,2,13,NaN,4.5]) assert.throws(()=>cascadePose(.5,count));
  assert.throws(()=>shot('reveal',{aperture:NaN}));
  assert.throws(()=>shot('transform',{turns:0}));
});
test('同一闭合轮廓换形，首尾回到圆；任意 seek、相邻采样连续',()=>{
  for(const turns of [1,2,4]) for(let i=0;i<96;i++) {
    const u=i/96;
    contourPoint(u,0,turns).forEach((v,j)=>close(v,contourPoint(u,1,turns)[j]));
    for(const p of [.1,.34,.4,.65,.76,.96]) {
      const a=contourPoint(u,p-1e-6,turns),b=contourPoint(u,p+1e-6,turns);
      assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<.0001);
      assert.deepEqual(contourPoint(u,p,turns),contourPoint(u,p,turns));
    }
  }
});

function fake() {
  const calls=[], c={
    save(){calls.push(['save']);},restore(){calls.push(['restore']);},beginPath(){},clip(){calls.push(['clip']);},
    rect(...a){calls.push(['rect',...a]);},measureText(s){return {width:[...s].length*40};},
    fillText(...a){calls.push(['text',...a]);},translate(){},scale(){},rotate(){},
  };
  return {type:new TextKit(c), calls};
}
test('触发文字不偷跑，空间裁切与对齐共用量出的整行宽度',()=>{
  const {type,calls}=fake();
  type.reveal('动画',400,300,{progress:0,size:40,align:'center'});assert.equal(calls.length,0);
  type.reveal('动画',400,300,{progress:.5,size:40,align:'center',bounds:{x:360,y:250,w:80,h:60}});
  assert.deepEqual(calls.find(c=>c[0]==='rect'),['rect',360,250,40,60]);
  assert.equal(calls.filter(c=>c[0]==='save').length,calls.filter(c=>c[0]==='restore').length);
  assert.deepEqual(calls.filter(c=>c[0]==='text').map(c=>c[2]),[360,400]);
});
test('动作留字按字素裁切、光束通过后消失、完整揭示与普通文字一致',()=>{
  const a=fake();a.type.reveal('A😀中',0,100,{progress:.5,size:40,mode:'trace'});
  assert.equal(a.calls.filter(c=>c[0]==='rect').length,2);
  const b=fake();b.type.reveal('动画',0,100,{progress:1,size:40,mode:'light'});
  assert.ok(b.calls.filter(c=>c[0]==='rect').every(c=>c[3]<1e-8));
  const c=fake(),d=fake();c.type.reveal('动画',0,100,{progress:1,size:40});d.type.write('动画',0,100,{size:40});
  assert.deepEqual(c.calls,d.calls);
});
test('触发参数错误不静默，异常也恢复 Canvas 裁切状态',()=>{
  const {type,calls}=fake();
  for(const opts of [{progress:NaN},{progress:.5,mode:'typo'},{progress:.5,direction:'typo'},{progress:.5,beam:0}]) assert.throws(()=>type.reveal('字',0,0,opts));
  type.write=()=>{throw new Error('draw failed');};
  assert.throws(()=>type.reveal('字',0,0,{progress:.5}));
  assert.equal(calls.filter(c=>c[0]==='save').length,calls.filter(c=>c[0]==='restore').length);
});
test('解构保留模块身份与核心锚点，错峰分离、首尾精确归位',()=>{
  const homes = new Set();
  for(let i=0;i<27;i++) {
    const start=deconstructPose(i,0),end=deconstructPose(i,1),opened=deconstructPose(i,.55);
    homes.add(start.home.join(','));
    assert.deepEqual(start.position,end.position);
    assert.deepEqual(start.rotation,end.rotation);
    assert.equal(opened.core,i===13);
    if(i===13) assert.deepEqual(opened.position,[0,0,0]);
    else assert.ok(Math.hypot(...opened.position)>Math.hypot(...start.position)*2);
    for(const p of [.12,.37,.42,.70,.93,.98]) {
      const a=deconstructPose(i,p-1e-6),b=deconstructPose(i,p+1e-6);
      assert.ok(Math.hypot(...a.position.map((v,j)=>v-b.position[j]))<.001);
    }
  }
  assert.equal(homes.size,27);
  assert.ok(deconstructPose(0,.2).open>deconstructPose(26,.2).open);
  for(const index of [-1,27,NaN,1.5]) assert.throws(()=>deconstructPose(index,.5));
  assert.throws(()=>shot('deconstruct',{spread:0}));
});
console.log(`通过 ${passed}/${passed}`);
