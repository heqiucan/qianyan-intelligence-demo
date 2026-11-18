const {chromium}=require('./playwright_runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
async function main(){
 const base=process.env.DEMO_TEST_BASE;
 assert.ok(base&&new URL(base).hostname==='127.0.0.1'&&new URL(base).port!=='8001');
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base+'/#/overview');
  await page.getByRole('button',{name:'直播工作台',exact:true}).click();
  await page.getByRole('heading',{name:'直播工作台',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'直播工作台',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'新建直播场次',exact:true}).click();
  await page.getByLabel('直播场次名称',{exact:true}).fill('第一阶段浏览器模拟场');
  await page.getByLabel('主播或负责人',{exact:true}).fill('测试主播');
  const products=await (await page.request.get(base+'/api/live/catalog')).json();
  await page.getByLabel('选择货盘商品与 SKU',{exact:true}).selectOption(products[0].id+'/'+products[0].skus[0].id);
  await page.getByRole('button',{name:'加入货盘',exact:true}).click();
  await page.getByRole('button',{name:'保存场次与货盘',exact:true}).click();
  await page.getByRole('button',{name:'核对并确认货盘',exact:true}).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'确认货盘',exact:true}).click();
  await page.getByLabel('模拟账号名称',{exact:true}).fill('测试账号一');
  await page.getByLabel('模拟直播间名称',{exact:true}).fill('测试直播间一');
  await page.getByRole('button',{name:'保存模拟账号与直播间',exact:true}).click();
  await page.getByRole('button',{name:'启动模拟',exact:true}).click();
  await page.getByText('模拟运行中',{exact:true}).waitFor();
  await page.getByLabel('模拟弹幕内容',{exact:true}).fill('这款商品多少钱？');
  for(const name of ['模拟弹幕','模拟进场','模拟关注']){
   await page.getByRole('button',{name,exact:true}).click();
   await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='暂停模拟')?.disabled);
  }
  await page.reload();
  await page.getByText('模拟运行中',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('模拟账号名称',{exact:true}).inputValue(),'测试账号一');
  assert.equal(await page.getByRole('list',{name:'模拟互动记录'}).locator('li').count(),3);
  await page.getByRole('button',{name:'暂停模拟',exact:true}).click();
  await page.getByText('已暂停模拟',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'模拟进场',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'恢复模拟',exact:true}).click();
  await page.getByText('模拟运行中',{exact:true}).waitFor();
  await page.getByRole('button',{name:'停止模拟',exact:true}).click();
  await page.getByText('已停止模拟',{exact:true}).waitFor();
  fs.mkdirSync('tmp/live-workspace-acceptance',{recursive:true});
  await page.screenshot({path:'tmp/live-workspace-acceptance/desktop.png',fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no mobile overflow');
  await page.screenshot({path:'tmp/live-workspace-acceptance/mobile.png',fullPage:true});
  await page.getByRole('button',{name:'需求任务工作台',exact:true}).click();
  await page.getByRole('heading',{name:'需求工作空间',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS live workspace: tab, create/confirm SKU session, account, three events, reload persistence, pause/resume/stop, mobile, reduced motion, demand navigation; no JS errors');
 }catch(e){fs.mkdirSync('tmp/live-workspace-acceptance',{recursive:true});fs.writeFileSync('tmp/live-workspace-acceptance/failure.txt',await page.locator('body').innerText());await page.screenshot({path:'tmp/live-workspace-acceptance/failure.png',fullPage:true});throw e}finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
