/* Workspace hierarchy and history acceptance, only against an isolated replay service. */
const {chromium}=require('./playwright_runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

async function main(){
 const base=process.env.DEMO_TEST_BASE;
 assert.ok(base&&new URL(base).hostname==='127.0.0.1'&&new URL(base).port!=='8001');
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 page.setDefaultTimeout(12000);
 const out=path.resolve('tmp/workspace-v4-acceptance');fs.mkdirSync(out,{recursive:true});
 const checks=[],errors=[],mutations=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/'))mutations.push(request.url())});
 const check=(name,ok=true)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name)};
 const nav=()=>page.getByRole('navigation',{name:'主导航',exact:true});
 const enter=async name=>{
  if(!await nav().isVisible())await page.getByRole('button',{name:'打开主导航',exact:true}).click();
  await nav().getByRole('button',{name,exact:true}).click();
  await page.getByRole('heading',{name,level:1,exact:true}).waitFor();
 };
 const goto=async route=>{await page.goto(base+'/#/'+route);await page.getByRole('heading',{level:1}).waitFor()};
 try{
  const state=await (await page.request.get(base+'/api/state')).json();
  assert.equal(state.model.mode,'replay');
  await goto('overview');
  check('九个一级业务入口',JSON.stringify(await nav().getByRole('button').allTextContents())===JSON.stringify(['工作总览','Agent 任务','GEO 工作台','商品与知识','营销与创意','直播工作台','广告投放','效果与复盘','待办与审核']));
  check('首页不挂载任务编辑器',await page.getByLabel('希望 Agent 完成的任务').count()===0&&await page.getByLabel('当前活动路径').count()===0);
  check('首页长度受控',await page.evaluate(()=>document.documentElement.scrollHeight<1800));
  check('桌面侧栏固定',await nav().evaluate(element=>getComputedStyle(element.parentElement).position)==='fixed');
  await page.screenshot({path:path.join(out,'overview-desktop.png')});
  const top=await nav().evaluate(element=>element.getBoundingClientRect().top);
  for(const name of ['Agent 任务','商品与知识','营销与创意','直播工作台','广告投放','效果与复盘','待办与审核']){
   await enter(name);
   check(name+'保持导航位置',Math.abs(await nav().evaluate(element=>element.getBoundingClientRect().top)-top)<1);
  }
  check('普通导航未启动业务任务',mutations.length===0);
  await goto('overview');
  await page.getByRole('button',{name:'医美咨询助手',exact:true}).click();
  await page.getByRole('tab',{name:'公司看板',exact:true}).waitFor();
  check('医美助手入口保留',page.url().includes('tab=assistant'));
  await page.reload();
  await page.getByRole('tab',{name:'测试助手',exact:true}).click();
  await page.getByLabel('顾客搜索词',{exact:true}).waitFor();
  check('医美助手旧链接刷新后可使用',await page.getByLabel('顾客搜索词',{exact:true}).isVisible());
  await page.getByRole('button',{name:'经营总览',exact:true}).click();
  check('医美助手可返回经营总览',await page.getByLabel('顾客搜索词',{exact:true}).count()===0);
  await goto('overview?agent=new&scene=live&campaign='+state.campaigns[0].id);
  await page.waitForURL('**/#/agent?**');
  await page.getByLabel('希望 Agent 完成的任务',{exact:true}).waitFor();
  check('旧Agent链接进入独立创建页',await nav().getByRole('button',{name:'Agent 任务',exact:true}).getAttribute('aria-current')==='page');
  await goto('agent?status=attention');await page.getByLabel('任务状态',{exact:true}).waitFor();
  check('待处理入口应用聚合状态筛选',await page.getByLabel('任务状态',{exact:true}).inputValue()==='attention');
  await page.getByRole('searchbox',{name:'搜索任务',exact:true}).fill('筛选恢复验收');
  await enter('工作总览');await goto('agent?status=attention');await page.getByRole('searchbox',{name:'搜索任务',exact:true}).waitFor();
  check('返回任务列表恢复搜索条件',await page.getByRole('searchbox',{name:'搜索任务',exact:true}).inputValue()==='筛选恢复验收');
  await goto('overview?tab=demand');
  await page.getByRole('button',{name:'新建需求任务',exact:true}).waitFor();
  check('需求默认列表与创建表单分离',await page.getByLabel('任务名称',{exact:true}).count()===0);
  for(const name of ['02 素材与词库','03 筛选与确认','04 选题与内容','01 配置与任务']){
   await page.getByRole('button',{name,exact:true}).click();
   check(name+'保持Agent归属',await nav().getByRole('button',{name:'Agent 任务',exact:true}).getAttribute('aria-current')==='page');
  }
  await page.getByRole('button',{name:'新建需求任务',exact:true}).click();
  await page.getByLabel('任务名称',{exact:true}).waitFor();
  check('需求创建为可刷新详情',page.url().includes('task=new'));
  await page.reload();await page.getByLabel('任务名称',{exact:true}).waitFor();
  check('刷新恢复需求创建入口');
  await goto('reports');await page.waitForURL('**/#/analytics?view=reports');
  check('旧报告链接归入效果与复盘',await page.getByRole('heading',{name:'效果与复盘',level:1}).isVisible());
  check('报告列表不直接展开创建表单',await page.getByLabel('报告标题',{exact:true}).count()===0);
  await goto('optimize');await page.waitForURL('**/#/analytics?view=optimize');
  check('旧复盘链接可用');
  await goto('creative?tab=live');await page.waitForURL('**/#/live?pane=session');
  await page.getByRole('button',{name:'新建直播场次',exact:true}).waitFor();
  check('旧场次链接归入直播');

  await goto('overview');
  await enter('商品与知识');
  await page.getByRole('button',{name:'品牌与商品资料',exact:true}).click();
  const productName=page.getByLabel('商品名称',{exact:true});await productName.waitFor();
  const original=await productName.inputValue();
  await enter('营销与创意');
  await page.goBack();await productName.waitFor();
  await productName.fill(original+' 未保存');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.goBack();
  await page.waitForFunction(()=>location.hash==='#/product');
  check('取消后退保留草稿',await productName.inputValue()===original+' 未保存');
  page.once('dialog',dialog=>dialog.accept());
  await page.goForward();
  await page.getByRole('heading',{name:'营销与创意',level:1,exact:true}).waitFor();
  check('取消后退没有破坏前进分支');
  await goto('product');await productName.waitFor();await productName.fill(original+' 参数草稿');
  page.once('dialog',dialog=>dialog.accept());
  await page.evaluate(()=>{location.hash='/product?source=history-test'});
  await page.waitForFunction(()=>location.hash.includes('source=history-test'));
  await page.waitForFunction(expected=>Array.from(document.querySelectorAll('input')).some(input=>input.value===expected),original);
  check('同组件参数跳转确认后实际丢弃草稿',await productName.inputValue()===original);
  await productName.fill(original+' 再次编辑');
  page.once('dialog',dialog=>dialog.dismiss());await nav().getByRole('button',{name:'工作总览',exact:true}).click();
  check('再次编辑仍有离开保护',await productName.isVisible()&&await productName.inputValue()===original+' 再次编辑');
  page.once('dialog',dialog=>dialog.accept());await enter('工作总览');

  await enter('效果与复盘');
  await page.locator('.workspace-scope summary').click();
  await page.getByLabel('数据来源',{exact:true}).selectOption('history');
  await page.getByRole('heading',{name:'计划排名',exact:true}).waitFor();
  check('历史来源绘制计划排名');
  await page.screenshot({path:path.join(out,'analytics-desktop.png')});
  await page.getByRole('tab',{name:'订单',exact:true}).click();
  check('图表明细写入地址',page.url().includes('section=orders'));
  await page.reload();await page.getByRole('tab',{name:'订单',exact:true}).waitFor();
  check('刷新保持明细标签',await page.getByRole('tab',{name:'订单',exact:true}).getAttribute('aria-selected')==='true');
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  for(const name of ['工作总览','Agent 任务','商品与知识','营销与创意','直播工作台','广告投放','效果与复盘','待办与审核']){
   await enter(name);
   check(name+'窄屏无页面横向溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:path.join(out,{'工作总览':'overview','Agent 任务':'agent','商品与知识':'product','营销与创意':'creative','直播工作台':'live','广告投放':'ads','效果与复盘':'analytics','待办与审核':'tasks'}[name]+'-mobile.png')});
  }
  check('减少动画设置生效',await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
  check('浏览器没有未捕获异常',errors.length===0);
 }catch(error){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error}
 finally{fs.writeFileSync(path.join(out,'navigation-result.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
