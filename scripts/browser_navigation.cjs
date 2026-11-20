/* Navigation acceptance against an isolated local replay service. */
const {chromium}=require('./playwright_runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
async function main(){
 const base=process.env.DEMO_TEST_BASE;
 assert.ok(base&&new URL(base).hostname==='127.0.0.1'&&new URL(base).port!=='8001');
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1600,height:1000}});
 page.setDefaultTimeout(15000);
 const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 const out=path.resolve('tmp/navigation-stage-one');fs.mkdirSync(out,{recursive:true});
 const check=(name,ok=true)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name)};
 const nav=()=>page.getByRole('navigation',{name:'主导航',exact:true});
 const enter=async(label)=>{await nav().getByRole('button',{name:label,exact:true}).click();await page.getByRole('heading',{name:label,level:1,exact:true}).waitFor()};
 const views=()=>page.getByRole('navigation',{name:'复盘与报告视图'});
 try{
  await page.goto(base+'/#/overview');await nav().waitFor();
  check('八个主导航顺序与名称正确',(await nav().getByRole('button').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')))).join('|')==='增长工作台|商品与品牌|营销与创意|直播工作台|广告的投放|效果与获客|异常与待办|复盘与报告');
  check('增长工作台只保留两个任务入口',(await page.getByRole('navigation',{name:'增长工作台模式'}).getByRole('button').allTextContents()).join('|')==='经营与营销任务|需求任务工作台');
  await enter('直播工作台');
  check('直播独立路由与选中状态',page.url().endsWith('/#/live')&&await nav().getByRole('button',{name:'直播工作台',exact:true}).getAttribute('aria-current')==='page');
  check('直播页没有活动路径和统计筛选',await page.getByRole('region',{name:'当前活动路径'}).count()===0&&await page.getByLabel('统一数据范围').count()===0);
  await page.screenshot({path:path.join(out,'live-desktop.png')});
  const state=await (await page.request.get(base+'/api/state')).json();
  const session=state.live_sessions.at(-1);
  if(session)await page.getByLabel('选择营销活动',{exact:true}).selectOption(session.campaign_id);
  const id=session?.id||'bookmark-session';
  await page.goto(base+'/#/overview?tab=live&module=ai&feature=console&pane=session&live='+encodeURIComponent(id));
  await page.waitForURL('**/#/live?**');
  const params=new URLSearchParams(page.url().split('?')[1]);
  check('旧直播链接保留场次与子功能',params.get('live')===id&&params.get('pane')==='session'&&params.get('feature')==='console'&&params.get('module')==='ai'&&!params.has('tab'));
  await page.reload();await page.getByRole('button',{name:'新建直播场次',exact:true}).waitFor();
  check('直播深链接刷新恢复场次管理',await nav().getByRole('button',{name:'直播工作台',exact:true}).getAttribute('aria-current')==='page');
  await enter('复盘与报告');
  await page.getByRole('button',{name:'生成本轮复盘',exact:true}).waitFor();
  check('合并入口默认展示优化复盘',await views().getByRole('button',{name:'优化复盘',exact:true}).getAttribute('aria-pressed')==='true');
  await page.getByLabel('数据来源',{exact:true}).selectOption('history');
  await views().getByRole('button',{name:'活动报告',exact:true}).click();await page.getByLabel('报告标题',{exact:true}).waitFor();
  check('报告视图包含活动报告和直播报告',await page.getByRole('heading',{name:'直播场次报告',exact:true}).isVisible()&&await page.getByRole('button',{name:'保存新的报告快照',exact:true}).isVisible());
  check('切换视图保留统计范围',await page.getByLabel('数据来源',{exact:true}).inputValue()==='history');
  await page.reload();await page.getByLabel('报告标题',{exact:true}).waitFor();
  check('刷新恢复报告视图与筛选',await views().getByRole('button',{name:'活动报告',exact:true}).getAttribute('aria-pressed')==='true'&&await page.getByLabel('数据来源',{exact:true}).inputValue()==='history');
  await page.screenshot({path:path.join(out,'review-desktop.png')});
  await page.goto(base+'/#/optimize?source=legacy');await page.waitForURL('**/#/review?**');await page.getByRole('button',{name:'生成本轮复盘',exact:true}).waitFor();
  check('旧复盘链接兼容并保留参数',page.url().includes('view=optimize')&&page.url().includes('source=legacy'));
  await page.goto(base+'/#/reports');await page.waitForURL('**/#/review?view=reports');await page.getByLabel('报告标题',{exact:true}).waitFor();
  check('旧报告链接进入正确视图',await views().getByRole('button',{name:'活动报告',exact:true}).getAttribute('aria-pressed')==='true');
  await page.goBack();await page.getByRole('button',{name:'生成本轮复盘',exact:true}).waitFor();
  check('浏览器返回恢复复盘视图',await views().getByRole('button',{name:'优化复盘',exact:true}).getAttribute('aria-pressed')==='true');
  await enter('广告的投放');check('广告入口与页面标题一致',page.url().endsWith('/#/ads'));
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  for(const label of ['直播工作台','复盘与报告']){await enter(label);check(label+'窄屏无横向溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,label==='直播工作台'?'live-mobile.png':'review-mobile.png')})}
  check('无浏览器脚本错误',errors.length===0);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
