/* Local decoded video and Chromium fake-camera acceptance; no physical camera is opened. */
const {chromium}=require('./playwright_runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
async function main(){
 const base=process.env.DEMO_TEST_BASE;
 assert.ok(base&&new URL(base).hostname==='127.0.0.1'&&new URL(base).port!=='8001');
 const out='tmp/live-preview-acceptance';fs.mkdirSync(out,{recursive:true});
 const cameraFile=path.resolve(out,'test-camera.y4m');
 const frames=[Buffer.from('YUV4MPEG2 W640 H360 F30:1 Ip A1:1 C420\n')];
 for(let i=0;i<30;i++)frames.push(Buffer.from('FRAME\n'),Buffer.alloc(640*360,60+i*3),Buffer.alloc(640*360/4,90),Buffer.alloc(640*360/4,160));
 fs.writeFileSync(cameraFile,Buffer.concat(frames));
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-video-capture='+cameraFile]});
 const page=await browser.newPage({viewport:{width:1600,height:1100}});page.setDefaultTimeout(12000);
 const checks=[],errors=[],mutations=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/'))mutations.push(r.url())});
 const check=(name,ok=true)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name)};
 const button=name=>page.getByRole('button',{name,exact:true});
 const media=()=>page.getByLabel('本地画面预览',{exact:true});
 await page.addInitScript(()=>{
  window.__streams=[];window.__cameraTrace=[];window.__revoked=[];window.__gumCalls=0;window.__constraints=[];
  const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async constraints=>{window.__gumCalls++;window.__constraints.push(constraints);const stream=await get(constraints);window.__streams.push(stream);stream.getTracks().forEach(t=>{const stop=t.stop.bind(t);t.stop=()=>{window.__cameraTrace.push({event:'stop',stack:new Error().stack});stop()};t.addEventListener('ended',()=>window.__cameraTrace.push({event:'ended',state:t.readyState}));});return stream};
  const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.__revoked.push(url);revoke(url)};
 });
 try{
  await page.goto(base+'/#/live?module=video&feature=source');await page.getByLabel('本地视频文件',{exact:true}).waitFor();
  check('打开来源设置不自动请求摄像头',await page.evaluate(()=>window.__gumCalls===0));
  const fixture=await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');let frame=0;
   const draw=()=>{ctx.fillStyle='#171326';ctx.fillRect(0,0,640,360);ctx.fillStyle='#c9a5ff';ctx.fillRect(40+(frame++%30)*8,110,100,100);ctx.fillStyle='white';ctx.font='28px sans-serif';ctx.fillText('LOCAL PREVIEW TEST',130,65)};draw();
   const stream=canvas.captureStream(10);const chunks=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});
   const done=new Promise(resolve=>recorder.onstop=resolve);recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();const interval=setInterval(draw,80);await new Promise(r=>setTimeout(r,1000));recorder.stop();await done;clearInterval(interval);stream.getTracks().forEach(t=>t.stop());
   return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()));
  });
  const file={name:'本地预览测试.webm',mimeType:'video/webm',buffer:Buffer.from(fixture)};
  await page.getByLabel('本地视频文件',{exact:true}).setInputFiles(file);await page.getByText('本地预览 · 视频已就绪',{exact:true}).waitFor();
  check('本地视频真实解码且默认静音',await media().evaluate(v=>v.videoWidth===640&&v.videoHeight===360&&v.muted&&v.paused));
  const originalUrl=await media().getAttribute('src');await button('播放预览').click();await page.getByText('本地预览 · 预览中',{exact:true}).waitFor();await button('暂停预览').click();
  check('视频预览可独立播放暂停',await media().evaluate(v=>v.paused&&v.currentTime>=0));
  await button('话术设置').click();await page.getByRole('region',{name:'话术设置',exact:true}).waitFor();
  check('切换工具面板保留视频与暂停状态',await media().getAttribute('src')===originalUrl&&await media().evaluate(v=>v.paused));
  await button('来源设置').click();await button('横屏 16:9').click();check('竖屏容器保留原视频尺寸',await media().evaluate(v=>v.videoWidth===640)&&await page.getByLabel('直播画面预留区').evaluate(e=>e.classList.contains('portrait')));await button('竖屏 9:16').click();
  await page.getByLabel('本地视频文件',{exact:true}).setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('not video')});await page.getByText(/请选择视频文件/).waitFor();check('拒绝非视频文件并保留原画面',await media().getAttribute('src')===originalUrl);
  await page.getByLabel('本地视频文件',{exact:true}).setInputFiles({name:'broken.webm',mimeType:'video/webm',buffer:Buffer.from('broken media')});await page.getByText(/视频无法读取或编码/).waitFor();check('损坏视频显示错误并释放旧文件',await media().count()===0&&await page.evaluate(url=>window.__revoked.includes(url),originalUrl));
  await page.getByLabel('本地视频文件',{exact:true}).setInputFiles(file);await page.getByText('本地预览 · 视频已就绪',{exact:true}).waitFor();const secondUrl=await media().getAttribute('src');await button('停止预览').click();
  check('停止视频清除画面并释放文件地址',await media().count()===0&&await page.evaluate(url=>window.__revoked.includes(url),secondUrl));
  await button('启动摄像头预览').click();await page.getByText('本地预览 · 预览中',{exact:true}).waitFor();
  check('摄像头真实媒体轨道显示且不采集麦克风',await media().evaluate(v=>v.srcObject.getVideoTracks().length===1&&v.srcObject.getAudioTracks().length===0&&v.videoWidth>0)&&await page.evaluate(()=>window.__constraints.at(-1).audio===false));
  await page.getByLabel('本地视频文件',{exact:true}).setInputFiles(file);await page.getByText('本地预览 · 视频已就绪',{exact:true}).waitFor();check('本地文件替换摄像头立即释放设备',await page.evaluate(()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));await button('启动摄像头预览').click();await page.getByText('本地预览 · 预览中',{exact:true}).waitFor();
  const calls=await page.evaluate(()=>window.__gumCalls);await button('商品设置').click();check('切换面板不重开摄像头',await page.evaluate(n=>window.__gumCalls===n&&window.__streams.at(-1).getVideoTracks()[0].readyState==='live',calls));
  await page.screenshot({path:out+'/camera-desktop.png'});await button('停止预览').click();check('停止预览释放摄像头',await page.evaluate(()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
  check('预览流程没有上传或模拟控制请求',mutations.length===0);
  await button('来源设置').click();
  await page.evaluate(()=>{window.__originalGum=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('denied','NotAllowedError'))});await button('启动摄像头预览').click();await page.getByText(/摄像头权限未获允许/).waitFor();check('拒绝权限给出可操作说明',await button('启动摄像头预览').isEnabled());
  for(const [name,message] of [['NotFoundError','没有找到摄像头'],['NotReadableError','摄像头无法打开'],['OverconstrainedError','所选设备或分辨率不可用']]){await page.evaluate(n=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('test',n))},name);await button('启动摄像头预览').click();await page.getByText(new RegExp(message)).waitFor();check(name+'错误可重试',await button('启动摄像头预览').isEnabled())}
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{window.__resolveCamera=resolve})});await button('启动摄像头预览').click();await button('取消摄像头请求').click();await page.evaluate(async()=>{const stream=await window.__originalGum({audio:false,video:true});window.__resolveCamera(stream)});await page.waitForFunction(()=>window.__streams.at(-1).getTracks().every(t=>t.readyState==='ended'));
  check('取消授权等待后迟到的设备也会释放',await media().count()===0);
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=window.__originalGum});await button('启动摄像头预览').click();await page.getByText('本地预览 · 预览中',{exact:true}).waitFor();await page.evaluate(()=>window.__streams.at(-1).getVideoTracks()[0].dispatchEvent(new Event('ended')));await page.getByText(/摄像头已断开/).waitFor();check('设备断开清理画面且提示重新连接',await media().count()===0);
  await button('启动摄像头预览').click();await page.getByText('本地预览 · 预览中',{exact:true}).waitFor();await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'增长工作台',exact:true}).click();await page.getByRole('heading',{level:1,name:'增长工作台',exact:true}).waitFor();check('离开工作台释放摄像头',await page.evaluate(()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
  const state=await (await page.request.get(base+'/api/state')).json();const ready=state.live_sessions.filter(s=>s.status==='ready').at(-1);const other=state.live_sessions.find(s=>s.id!==ready?.id&&s.campaign_id===ready?.campaign_id);
  assert(ready&&other,'run after workspace acceptance supplies two sessions');
  await page.goto(base+'/#/live?module=video&feature=source&live='+ready.id);await page.getByLabel('选择营销活动',{exact:true}).selectOption(ready.campaign_id);await button('启动摄像头预览').click();await page.getByText('本地预览 · 预览中',{exact:true}).waitFor();
  await page.getByText('模拟运行中',{exact:true}).waitFor();await button('暂停模拟').click();await page.getByText('已暂停模拟',{exact:true}).waitFor();check('暂停模拟不停止摄像头预览',await media().evaluate(v=>!v.paused&&v.srcObject.getVideoTracks()[0].readyState==='live'));await button('恢复模拟').click();await page.getByText('模拟运行中',{exact:true}).waitFor();
  await button('停止预览').click();check('停止预览不停止本场模拟',await page.getByText('模拟运行中',{exact:true}).isVisible());await button('启动摄像头预览').click();await page.getByText('本地预览 · 预览中',{exact:true}).waitFor();
  await page.getByLabel('当前直播场次',{exact:true}).selectOption(other.id);await page.getByText('尚未选择画面来源',{exact:true}).waitFor();check('切换场次释放摄像头避免串用画面',await page.evaluate(()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
  await button('启动摄像头预览').click();await page.getByText('本地预览 · 预览中',{exact:true}).waitFor();await page.reload();await page.getByText('尚未选择画面来源',{exact:true}).waitFor();check('刷新不自动申请设备权限',await page.evaluate(()=>window.__gumCalls===0));
  await page.getByLabel('本地视频文件',{exact:true}).setInputFiles(file);await page.getByText('本地预览 · 视频已就绪',{exact:true}).waitFor();await page.emulateMedia({reducedMotion:'reduce'});
  for(const width of [1280,390,360]){await page.setViewportSize({width,height:1000});check(width+'px来源面板无横向溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/'+width+'.png'})}
  check('浏览器无脚本异常',errors.length===0);fs.writeFileSync(out+'/result.json',JSON.stringify({checks,errors},null,2));
 }catch(e){console.log('Camera diagnostics',await page.evaluate(()=>({trace:window.__cameraTrace,tracks:window.__streams.map(s=>s.getTracks().map(t=>({ready:t.readyState,label:t.label}))),text:document.querySelector('.live-preview-panel')?.textContent})));await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});throw e}finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
