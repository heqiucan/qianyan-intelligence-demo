/* Browser acceptance against an isolated demo server; never point at production. */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
async function main() {
 const out=path.resolve('tmp/browser-check'); fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=process.env.DEMO_TEST_URL||'http://127.0.0.1:8011';
 const checks=[];
 const check=(name,condition)=>{assert.ok(condition,name);checks.push(name)};
 try {
  await page.goto(base); await page.getByRole('heading',{name:'增长工作台',exact:true}).waitFor();
  await page.getByText('1,485.00',{exact:false}).waitFor();
  await page.screenshot({path:path.join(out,'01-overview.png'),fullPage:true});
  check('历史D0首页渲染',await page.getByText('4.95',{exact:true}).isVisible());
  await page.getByRole('button',{name:'新建营销活动'}).click();await page.getByLabel('活动名称').fill('浏览器验收 · '+Date.now());await page.getByRole('button',{name:'创建并开始策划'}).click();
  await page.getByRole('button',{name:'生成两组创意'}).click();await page.locator('.creative-card').first().waitFor();
  check('生成两份草稿',await page.locator('.creative-card').count()===2);
  await page.locator('.creative-card').first().getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByLabel('标题',{exact:true}).fill('带上日常，开启新旅程');await page.getByRole('button',{name:'保存为新版本'}).click();
  await page.locator('.creative-card').nth(2).waitFor();
  const edited=page.locator('.creative-card').filter({hasText:'带上日常，开启新旅程'});
  await edited.getByRole('button',{name:'确认素材'}).click();await edited.getByText('已确认',{exact:true}).waitFor();
  check('编辑新增版本并确认',await page.locator('.creative-card').count()===3);
  await edited.getByRole('button',{name:'预览 / 导出'}).click();
  const dl=page.waitForEvent('download');await page.getByRole('button',{name:'导出 PNG 海报'}).click();const download=await dl;await download.saveAs(path.join(out,'poster.png'));check('PNG真实导出',fs.statSync(path.join(out,'poster.png')).size>1000);
  await page.getByRole('button',{name:'关闭弹窗'}).click();
  await page.screenshot({path:path.join(out,'02-creatives.png'),fullPage:true});
  await page.getByRole('button',{name:'广告投放',exact:true}).click();await page.getByRole('button',{name:'创建投放计划'}).click();
  await page.getByLabel('计划名称',{exact:true}).fill('验收 · 素材测试');await page.getByRole('button',{name:'保存计划草稿'}).click();
  await page.getByRole('button',{name:'确认启动'}).click();await page.getByRole('button',{name:'体验购买'}).click();
  await page.getByRole('heading',{name:'带上日常，开启新旅程'}).waitFor();
  await page.locator('.consumer-ad .button.primary').click();await page.getByLabel('选择虚构测试买家').waitFor();
  await page.screenshot({path:path.join(out,'03-consumer.png'),fullPage:true});
  await page.getByLabel('选择虚构测试买家').selectOption('unknown-001');
  await page.getByRole('button',{name:'模拟付款并下单'}).click();await page.getByRole('heading',{name:'这次转化，有迹可循。'}).waitFor();check('模拟订单保存',await page.getByText('模拟订单已保存').isVisible());
  await page.getByRole('button',{name:'查看订单来源'}).click();await page.getByRole('button',{name:'本次互动',exact:true}).click();
  await page.getByRole('button',{name:'查看链路'}).click();await page.getByRole('heading',{name:'订单来源链路'}).waitFor();check('来源链路可见',await page.locator('.trace-list').textContent().then(t=>t.includes('V2')&&t.includes('历史未知')));await page.getByRole('button',{name:'关闭弹窗'}).click();
  await page.getByRole('button',{name:'AI 优化复盘'}).click();await page.getByRole('button',{name:'生成本轮复盘'}).click();await page.getByText('已知事实',{exact:true}).waitFor();await page.screenshot({path:path.join(out,'04-insights.png'),fullPage:true});await page.getByRole('button',{name:'采纳并生成 V2 草稿'}).click();
  await page.locator('.creative-card').nth(3).waitFor();check('复盘建议生成下一版草稿',await page.locator('.creative-card').count()===4);
  await page.reload();await page.locator('.creative-card').nth(3).waitFor();check('刷新后数据保留',await page.locator('.creative-card').count()===4);
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'增长工作台',exact:true}).click();await page.screenshot({path:path.join(out,'05-mobile.png'),fullPage:true});
  check('390px页面无横向溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.emulateMedia({reducedMotion:'reduce'});check('减少动画偏好生效',await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches&&getComputedStyle(document.querySelector('.hero')).animationName==='none'));
  check('浏览器无JS异常',errors.length===0);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
 }catch(e){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});console.error(e);process.exitCode=1}finally{await browser.close()}
}
main();
