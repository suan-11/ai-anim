// GPU regression: reveal endpoints, monotonic coverage, undistorted UVs and random seek.
import assert from 'node:assert/strict';
import { openProbePage, gotoProbe } from './lib/probe-page.mjs';

const probe = await openProbePage({ task: '_calib', port: 5468 });
try {
  const rows = await probe.page.evaluate(async () => {
    const { engine } = await window.__anim.boot;
    const gl = engine.gl;
    const { RT, Pass } = await import('/src/core/gl.js');
    const { transitionPass } = await import('/src/core/trans.js');
    const rows = [];
    for (const [W,H] of [[320,180],[180,320]]) {
      const under = new RT(gl,W,H,{float:false}), out = new RT(gl,W,H,{float:false});
      const pattern = new Pass(gl,'void main(){fragColor=vec4(vUv.x,0.1,vUv.y,1.0);}',{}, {blend:false,jitter:false});
      pattern.render(gl,under);
      const reference = gl.readPixels(under).slice();
      for(const mode of ['split','slats','diamond','frame','corners']) for(const dir of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const pass = transitionPass(gl,{mode});
        pass.u.under.value = {tex:under.tex,__tex:true};
        pass.u.dir.value = dir;
        const render = k => {
          gl.clear(out,[0,0,1]);
          pass.u.k.value = k; pass.render(gl,out,0,1/60);
          return gl.readPixels(out).slice();
        };
        const first = render(0), last = render(1), mid = render(.4);
        let previous = W*H, monotonic = true, maxError = 0;
        for(const k of [0,.15,.4,.65,.85,1]) {
          const pixels = render(k);
          let count = 0;
          for(let i=1;i<pixels.length;i+=4) if(pixels[i]>10) count++;
          monotonic &&= count<=previous; previous=count;
        }
        // A coordinate ramp exposes stretch, mirror and wrong-band sampling.
        for(const k of [.4,.65]) {
          const pixels=render(k), horizontal=dir[0]!==0;
          for(let y=7;y<H;y+=17) for(let x=7;x<W;x+=17) {
            const u=(x+.5)/W, v=(y+.5)/H, s=horizontal?u:v;
            let src=s;
            let offset;
            const smooth=p=>p*p*p*(p*(p*6-15)+10);
            if(mode==='split') offset=(s<.5?-1:1)*smooth(k)*.5;
            else if (mode==='diamond' || mode==='frame' || mode==='corners') {
              // shader 读的是 RES_LOGICAL = 引擎画布（1920×1080），不是探针自建的 RT 尺寸：
              // aspect 恒为画布的 W/H，与 RT 是横是竖无关。
              const aspect = 1920 / 1080;
              const dx = (horizontal ? src : u) - .5;
              const dy = (horizontal ? v : src) - .5;
              const r = mode === 'diamond'
                ? Math.abs(dx * aspect) + Math.abs(dy)
                : mode === 'frame'
                  ? Math.max(Math.abs(dx * aspect), Math.abs(dy))
                  : Math.min(...[[-.889,-.5],[.889,-.5],[-.889,.5],[.889,.5]].map(([cx,cy]) => Math.hypot(dx * aspect - cx, dy - cy)));
              if (r < .01 || r > 1.0) continue;
              const rad = k * (mode === 'diamond' ? .98 : mode === 'frame' ? .96 : .88);
              const i=(y*W+x)*4;
              // shader 在边界带给一圈 rim 高光（|r-rad| < aa*7，aa≈fwidth*1.5）——
              // 探针在 CPU 上没有 fwidth，取一个保守带宽（W/180）把 rim 豁免：
              // 带内不比对（那是画面，不是误差），带外仍逐像素严格。
              const rimBand = Math.max(8, Math.min(W, H) / 180 * 30);
              if (Math.abs(r - rad) < rimBand / Math.max(W, H)) { continue; }
              // transitionPass 是 blend:true：fragment 输出 alpha=m（m=0 旧帧还在 / m=1 新帧接管），
              // 与清屏色 (0,0,255) 做 alpha 混合。r<rad ⇒ m→0 ⇒ 混出来是**清屏蓝 (0,0,255)**，
              // 不是 under 的 G=25.5 —— 期望值必须按混合后的颜色算。
              const expected = r > rad
                ? [u * 255, 25.5, v * 255]
                : [0, 0, 255];
              expected.forEach((n,c)=>{maxError=Math.max(maxError,Math.abs(pixels[i+c]-n));});
              continue;
            } else {
              const lane=Math.min(7,Math.floor((horizontal?v:u)*8));
              const p=Math.max(0,Math.min(1,k*1.24-lane/7*.24));
              offset=(lane%2===0?1:-1)*(horizontal?dir[0]:dir[1])*smooth(p);
            }
            src=s-offset; const i=(y*W+x)*4;
            if(src<.01 || src>.99 || mode==='split' && (s-.5)*(src-.5)<0) continue;
            const expected=[(horizontal?src:u)*255,25.5,(horizontal?v:src)*255];
            expected.forEach((n,c)=>{maxError=Math.max(maxError,Math.abs(pixels[i+c]-n));});
          }
        }
        rows.push({mode,W,H,dir, start:first.every((v,i)=>v===reference[i]),
          end:last.every((v,i)=>v===[0,0,255,255][i%4]), monotonic,maxError,
          seek:render(.4).every((v,i)=>v===mid[i]), glError:gl.ctx.getError()});
      }
      under.dispose(); out.dispose(); // Pass programs belong to this page's GL context.
    }
    return rows;
  });
  for(const row of rows) {
    assert.ok(row.start && row.end && row.monotonic && row.seek && row.glError===0 && row.maxError<2,JSON.stringify(row));
    console.log(`PASS ${row.mode} ${row.W}×${row.H} dir=${row.dir} UV误差=${row.maxError.toFixed(2)}`);
  }
  console.log(`通过 ${rows.length}/${rows.length} GPU 场景`);
  await gotoProbe(probe.page,{url:probe.url,task:'_trans-structure',scale:.25});
  const routing = await probe.page.evaluate(async () => {
    const api=window.__anim, {engine}=await api.boot;
    const item=engine.timeline.find(it=>it.id==='structure');
    let kitDraws=0;
    const pass=item._scene.wk.pass, original=pass.render;
    pass.render=function(...args){kitDraws++;return original.apply(this,args);};
    await api.frame(1.98,{samples:1});
    const diamond=[...engine._transPasses.values()].some(p=>p.mode==='diamond');
    await api.frame(11.9,{samples:1});
    const corners=[...engine._transPasses.values()].some(p=>p.mode==='corners');
    return {diamond,corners,kitDraws};
  });
  assert.deepEqual(routing,{diamond:true,corners:true,kitDraws:0});
  console.log('PASS 真实时间线：diamond / corners 路由正确，模板不叠第二次甩镜');
} finally { await probe.close(); }
