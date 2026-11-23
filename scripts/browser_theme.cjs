const {chromium}=require('./playwright_runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
async function main(){
 const base=process.env.DEMO_TEST_BASE;
 assert(base&&new URL(base).hostname==='127.0.0.1'&&new URL(base).port!=='8001');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light'});
 const page=await context.newPage();page.setDefaultTimeout(12000);
 const checks=[],errors=[],writes=[];const out='tmp/theme-acceptance';fs.mkdirSync(out,{recursive:true});
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))writes.push(r.url())});
 const check=(name,ok=true)=>{assert(ok,name);checks.push(name);console.log('PASS '+name)};
 const theme=()=>page.locator('html').getAttribute('data-theme');
 const toggle=mode=>page.getByRole('banner').getByRole('button',{name:mode+'主题',exact:true}).click();
 try{
  await page.goto(base+'/#/overview');await page.getByRole('heading',{name:'工作总览',level:1}).waitFor();
  check('初次打开浅色主题',await theme()==='light');
  const website=page.getByRole('link',{name:'产品官网',exact:true});
  check('官网入口保留独立标签页',await website.getAttribute('href')==='/website.html'&&await website.getAttribute('target')==='_blank');
  const popupEvent=page.waitForEvent('popup');await website.click();const popup=await popupEvent;await popup.waitForLoadState('domcontentloaded');check('官网实际可打开',popup.url().endsWith('/website.html')&&(await popup.locator('body').innerText()).length>100);await popup.close();
  check('浅色背景实际渲染',await page.locator('.workspace-frame').evaluate(e=>getComputedStyle(e).backgroundColor)==='rgb(247, 248, 252)');
  await page.screenshot({path:out+'/overview-light.png',fullPage:true});
  await page.goto(base+'/#/agent?agent=new');const goal=page.getByLabel('希望 Agent 完成的任务',{exact:true});await goal.fill('保留这个未保存的输入');
  await goal.evaluate(e=>window.__themeEditor=e);await page.evaluate(()=>window.__themeSentinel=42);
  await toggle('深色');check('切换深色',await theme()==='dark');
  check('切换不重新挂载编辑器',await goal.evaluate(e=>window.__themeEditor===e)&&await goal.inputValue()==='保留这个未保存的输入');
  check('切换不刷新页面',await page.evaluate(()=>window.__themeSentinel===42));
  await toggle('浅色');check('切回浅色保留草稿',await goal.inputValue()==='保留这个未保存的输入');
  page.once('dialog',d=>d.accept());await page.goto(base+'/#/overview');await toggle('深色');await page.reload();await page.getByRole('heading',{level:1}).waitFor();check('刷新记住深色',await theme()==='dark');
  await page.screenshot({path:out+'/overview-dark.png',fullPage:true});
  await page.getByRole('button',{name:'设置',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'跟随系统主题'}).click();check('跟随系统浅色',await theme()==='light');
  await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');check('系统变化自动更新主题');
  await dialog.getByRole('button',{name:'浅色主题',exact:true}).click();await page.emulateMedia({colorScheme:'dark'});check('显式浅色不受系统影响',await theme()==='light');
  await page.screenshot({path:out+'/settings-light.png'});await dialog.getByRole('button',{name:'关闭弹窗'}).click();
  const other=await context.newPage();await other.goto(base+'/#/overview');await other.getByRole('heading',{level:1}).waitFor();await toggle('深色');await other.waitForFunction(()=>document.documentElement.dataset.theme==='dark');check('同浏览器标签同步主题');await other.close();await toggle('浅色');
  for(const [route,name] of [['agent','agent'],['product?tab=catalog','catalog'],['product','product'],['product?tab=knowledge','knowledge'],['creative','creative'],['live','live'],['ads','ads'],['analytics','analytics'],['analytics?view=reports','reports'],['tasks','tasks']]){
   await page.goto(base+'/#/'+route);await page.getByRole('heading',{level:1}).waitFor();
   if(route==='analytics'){await page.locator('.workspace-scope summary').click();await page.getByLabel('数据来源',{exact:true}).selectOption('history');await page.getByRole('heading',{name:'计划排名'}).waitFor();await page.locator('.workspace-scope summary').click()}
   check(name+'浅色页面无横向溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/'+name+'-light.png',fullPage:true});
  }
  await page.goto(base+'/#/live?module=video&feature=source');await page.getByLabel('本地视频文件',{exact:true}).waitFor();
  const videoPath=out+'/theme-video.webm';const encoded=spawnSync('ffmpeg',['-y','-f','lavfi','-i','testsrc2=size=320x180:rate=10','-t','8','-an','-c:v','libvpx','-b:v','150k',videoPath],{encoding:'utf8',windowsHide:true});assert.equal(encoded.status,0,encoded.stderr);
  await page.getByLabel('本地视频文件',{exact:true}).setInputFiles(videoPath);await page.getByRole('button',{name:'播放预览',exact:true}).click();
  const video=page.getByLabel('本地画面预览',{exact:true});await video.evaluate(e=>window.__themeVideo=e);await page.waitForFunction(()=>window.__themeVideo.currentTime>0.1);
  const before=await video.evaluate(e=>e.currentTime);await toggle('深色');await toggle('浅色');
  check('切换主题保留视频实例和播放进度',await video.evaluate((e,t)=>e===window.__themeVideo&&!e.paused&&e.currentTime>=t,before));
  await page.getByRole('button',{name:'停止预览',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/#/overview');await page.getByRole('heading',{level:1}).waitFor();await toggle('深色');await toggle('浅色');
  check('窄屏切换按钮可操作且不溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/overview-mobile.png',fullPage:true});
  check('窄屏官网入口仍可访问',await website.isVisible());
  await page.getByRole('button',{name:'打开主导航'}).click();await page.screenshot({path:out+'/navigation-mobile.png'});
  check('无业务写入',writes.length===0);check('无浏览器异常',errors.length===0);
  const boot=fs.readFileSync('frontend/public/theme-init.js','utf8');
  for(const saved of ['dark','light','system','invalid','blocked']){
   const root={dataset:{},style:{}};const meta={};vm.runInNewContext(boot,{localStorage:{getItem(){if(saved==='blocked')throw new Error('blocked');return saved}},window:{matchMedia:()=>({matches:true})},document:{documentElement:root,querySelector:()=>meta}});
   check('首屏初始化 '+saved,root.dataset.theme===(['dark','system'].includes(saved)?'dark':'light'));
  }
  fs.writeFileSync(out+'/results.json',JSON.stringify({checks,errors,writes},null,2));
 }catch(e){await page.screenshot({path:out+'/failure.png',fullPage:true});throw e}finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
