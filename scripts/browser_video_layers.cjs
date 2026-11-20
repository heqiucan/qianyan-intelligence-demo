const {chromium}=require('./playwright_runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
async function main(){
 const base=process.env.DEMO_TEST_BASE;assert(base&&new URL(base).hostname==='127.0.0.1'&&new URL(base).port!=='8001');
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const p=await browser.newPage({viewport:{width:1600,height:1100}});p.setDefaultTimeout(15000);
 const checks=[],errors=[],uploads=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/'))uploads.push(r.url())});
 const check=(name,ok=true)=>{assert(ok,name);checks.push(name);console.log('PASS '+name)};
 const button=name=>p.getByRole('button',{name,exact:true});
 const out='tmp/video-layers-acceptance';fs.mkdirSync(out,{recursive:true});
 await p.addInitScript(()=>{window.__layerRevoked=[];const original=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.__layerRevoked.push(url);original(url)}});
 try{
  await p.goto(base+'/#/live');await p.getByLabel('直播画面预留区',{exact:true}).waitFor();await button('图层设置').click();
  const image=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=240;c.height=160;const x=c.getContext('2d');x.fillStyle='#835bd1';x.fillRect(0,0,240,160);x.fillStyle='white';x.font='24px sans-serif';x.fillText('LOCAL OVERLAY',18,85);return c.toDataURL('image/png').split(',')[1]});
  const fixture={name:'授权测试图片.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')};
  await p.getByLabel('图层 1 素材',{exact:true}).setInputFiles(fixture);await p.getByAltText('图层 1：授权测试图片.png',{exact:true}).waitFor();await p.waitForFunction(()=>document.querySelector('.live-overlay-layer img')?.complete);
  check('图层图片实际解码展示',await p.getByAltText('图层 1：授权测试图片.png',{exact:true}).evaluate(e=>e.naturalWidth===240));
  const firstUrl=await p.getByAltText('图层 1：授权测试图片.png',{exact:true}).getAttribute('src');
  await p.getByLabel(/^图层 1 不透明度/).fill('60');await p.getByLabel(/^图层 1 宽度/).fill('45');await p.getByLabel(/^图层 1 横向位置/).fill('80');await p.getByLabel(/^图层 1 纵向位置/).fill('70');await p.getByRole('checkbox',{name:'水平翻转图层 1',exact:true}).check();
  check('图层透明度大小位置与翻转实际生效',await p.locator('[data-layer="1"]').evaluate(e=>e.style.opacity==='0.6'&&e.style.width==='45%'&&e.style.left==='80%'&&e.style.transform.includes('scale(-1')));
  await p.getByRole('checkbox',{name:'显示图层 1',exact:true}).uncheck();check('隐藏图层保留素材',!(await p.getByAltText('图层 1：授权测试图片.png',{exact:true}).isVisible()));await p.getByRole('checkbox',{name:'显示图层 1',exact:true}).check();
  await p.getByLabel('图层 1 素材',{exact:true}).setInputFiles({name:'not-media.txt',mimeType:'text/plain',buffer:Buffer.from('reject')});await p.getByText(/图层请选择非空/).waitFor();check('不支持文件不替换原图层',await p.getByAltText('图层 1：授权测试图片.png',{exact:true}).getAttribute('src')===firstUrl);
  const video=await p.evaluate(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');let n=0;const draw=()=>{x.fillStyle='#222';x.fillRect(0,0,320,180);x.fillStyle='#8ce';x.fillRect((n++%20)*10,40,60,60)};draw();const stream=c.captureStream(12),chunks=[],r=new MediaRecorder(stream,{mimeType:'video/webm'});const done=new Promise(resolve=>r.onstop=resolve);r.ondataavailable=e=>chunks.push(e.data);r.start();const t=setInterval(draw,50);await new Promise(resolve=>setTimeout(resolve,800));r.stop();await done;clearInterval(t);stream.getTracks().forEach(track=>track.stop());return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()))});
  await p.getByLabel('图层 2 素材',{exact:true}).setInputFiles({name:'图层视频.webm',mimeType:'video/webm',buffer:Buffer.from(video)});await button('播放图层 2').waitFor();await p.waitForFunction(()=>document.querySelector('[aria-label="图层 2 视频"]')?.readyState>=1);
  check('两个图层同时存在且视频默认不自动播放',await p.locator('.live-overlay-layer').count()===2&&await p.getByLabel('图层 2 视频',{exact:true}).evaluate(v=>v.paused&&v.muted&&v.videoWidth===320));
  await p.getByRole('checkbox',{name:'循环图层 2 视频',exact:true}).check();await button('播放图层 2').click();await p.waitForFunction(()=>!document.querySelector('[aria-label="图层 2 视频"]').paused);check('视频图层可显式播放与循环',await p.getByLabel('图层 2 视频',{exact:true}).evaluate(v=>v.loop));
  await p.getByRole('checkbox',{name:'显示图层 2',exact:true}).uncheck();check('隐藏视频图层会暂停',await p.getByLabel('图层 2 视频',{exact:true}).evaluate(v=>v.paused));await p.getByRole('checkbox',{name:'显示图层 2',exact:true}).check();
  await button('滤镜设置').click();await p.getByLabel(/^灰度/).fill('100');await p.getByLabel(/^亮度/).fill('120');check('滤镜实际作用于图层',await p.locator('[data-layer="1"]').evaluate(e=>e.style.filter.includes('grayscale(100%)')&&e.style.filter.includes('brightness(120%)')));
  await button('画面设置').click();check('切换工作台面板仍保留图层',await p.locator('.live-overlay-layer').count()===2);
  await p.screenshot({path:out+'/desktop.png'});
  await p.reload();await button('图层设置').click();check('刷新恢复图层配置但不保留本地文件',await p.getByLabel(/^图层 1 不透明度/).inputValue()==='60'&&await p.locator('.live-overlay-layer').count()===0);await button('滤镜设置').click();check('刷新恢复滤镜配置',await p.getByLabel(/^灰度/).inputValue()==='100');await button('恢复原始画面效果').click();check('重置滤镜可恢复原值',await p.getByLabel(/^灰度/).inputValue()==='0'&&await p.getByLabel(/^亮度/).inputValue()==='100');
  await button('图层设置').click();await p.getByLabel('图层 1 素材',{exact:true}).setInputFiles(fixture);await p.getByAltText('图层 1：授权测试图片.png',{exact:true}).waitFor();const stoppedUrl=await p.getByAltText('图层 1：授权测试图片.png',{exact:true}).getAttribute('src');await button('停止预览').click();check('停止预览释放图层文件与画面',await p.locator('.live-overlay-layer').count()===0&&await p.evaluate(url=>window.__layerRevoked.includes(url),stoppedUrl));
  await p.getByLabel('图层 1 素材',{exact:true}).setInputFiles({name:'bad.png',mimeType:'image/png',buffer:Buffer.from('broken')});await p.getByText('图片无法读取，请重新选择有效图片。',{exact:true}).waitFor();check('损坏图片有明确错误且不挂住',await p.locator('.live-overlay-layer').count()===0);
  await p.getByLabel('图层 1 素材',{exact:true}).setInputFiles(fixture);await p.getByAltText('图层 1：授权测试图片.png',{exact:true}).waitFor();const leaveUrl=await p.getByAltText('图层 1：授权测试图片.png',{exact:true}).getAttribute('src');await p.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'增长工作台',exact:true}).click();await p.getByRole('heading',{name:'增长工作台',level:1,exact:true}).waitFor();check('离开工作台释放图层对象地址',await p.evaluate(url=>window.__layerRevoked.includes(url),leaveUrl));
  await p.goto(base+'/#/live');await button('图层设置').click();await p.getByRole('region',{name:'双图层预览设置',exact:true}).waitFor();await p.setViewportSize({width:390,height:844});await p.emulateMedia({reducedMotion:'reduce'});check('390px图层设置不横向溢出',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.screenshot({path:out+'/mobile.png',fullPage:true});check('素材不上传且无脚本异常',uploads.length===0&&errors.length===0);
  fs.writeFileSync(out+'/result.json',JSON.stringify({checks,errors},null,2));
 }catch(e){await p.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});fs.writeFileSync(out+'/failure.txt',await p.locator('body').innerText());throw e}finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
