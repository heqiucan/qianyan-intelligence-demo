/* UI acceptance against run_e2e's temporary replay database. Model status is
 * explicitly mocked to exercise state rendering without making a model call. */
const {chromium}=require('./playwright_runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=process.env.DEMO_TEST_BASE;
const out=path.resolve('tmp/demand-acceptance/browser');

async function main(){
 assert.ok(base&&new URL(base).hostname==='127.0.0.1'&&new URL(base).port!=='8001','必须由隔离runner提供本机临时实例，不能使用日常8001');
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);
 const checks=[],errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name)};
 const get=async url=>{const response=await page.request.get(base+'/api'+url);assert.ok(response.ok());return response.json()};
 try{
  const initial=await get('/state');assert.equal(initial.model.mode,'replay');
  const index=(initial.product.claim_evidence||[]).length+1;
  await page.goto(base+'/#/product');
  await page.getByRole('button',{name:'添加依据',exact:true}).click();
  const claim=page.getByLabel(`依据 ${index} 完整主张原文`,{exact:true});
  const source=page.getByLabel(`依据 ${index} 来源`,{exact:true});
  const conditions=page.getByLabel(`依据 ${index} 适用条件（可留空）`,{exact:true});
  const confirm=page.getByLabel('我已人工核对这条原文、来源和适用条件；我理解系统不会据此认证真实效果。',{exact:true}).last();
  const save=page.getByRole('button',{name:'核对并保存商品资料',exact:true});
  const complete='24小时内发货（仅限工作日下单）';
  await claim.fill(complete);await source.fill('浏览器验收虚构物流说明 V1，第1页；不是真实商家承诺');await conditions.fill('仅限工作日下单');
  check('逐条依据未人工确认时不能保存商品',await save.isDisabled()&&!await confirm.isChecked());
  await claim.fill('24小时内发货');await confirm.check();
  check('完整主张遗漏适用条件时即使勾选仍不能保存',await save.isDisabled()&&await page.getByText('完整主张原文必须保留填写的适用条件。',{exact:true}).isVisible());
  await claim.fill(complete);await confirm.check();await source.fill('浏览器验收虚构物流说明 V2，第1页；不是真实商家承诺');
  check('修改已确认的来源会撤销确认并重新阻止保存',!await confirm.isChecked()&&await save.isDisabled());
  await confirm.check();await save.click();
  const diff=page.getByRole('dialog');await diff.getByText('逐条主张依据',{exact:true}).waitFor();
  check('保存前的差异确认显示完整主张来源和条件',(await diff.innerText()).includes(complete)&&(await diff.innerText()).includes('虚构物流说明 V2')&&(await diff.innerText()).includes('仅限工作日下单'));
  const saved=page.waitForResponse(response=>response.url().endsWith('/api/product')&&response.request().method()==='PUT');
  await page.getByRole('button',{name:'确认保存商品资料',exact:true}).click();assert.ok((await saved).ok());
  await diff.waitFor({state:'detached'});const after=await get('/state');const item=after.product.claim_evidence.find(row=>row.claim===complete);
  await page.reload();await page.getByLabel(`依据 ${index} 完整主张原文`,{exact:true}).waitFor();
  check('人工确认的逐条依据保存到商品新版本并可刷新恢复',after.product.version===initial.product.version+1&&item?.confirmed&&item.conditions==='仅限工作日下单'&&item.source.includes('V2')&&await page.getByLabel(`依据 ${index} 完整主张原文`,{exact:true}).inputValue()===complete);

  const status={...initial.model,mode:'zhipu',label:'模型状态界面验收（模拟状态）',busy:true,operation_label:'需求配置拆解',operation_started_at:'2026-11-17T09:20:00Z',last_success_at:'2026-11-17T09:10:00Z',last_failure_at:'2026-11-17T09:15:00Z',last_error:'模拟限流：稍后手动重试',status:'模型占用中',call_count:2,cost:null,cost_note:'接口未返回计费金额，不估算费用。',recent_calls:[
   {id:'ui-success',provider:'zhipu',model:'ui-test-model',operation_label:'历史成功演示',started_at:'2026-11-17T09:09:00Z',finished_at:'2026-11-17T09:10:00Z',outcome:'success',remote_calls:1,provider_succeeded:true,error_message:'',usage:{prompt_tokens:15,completion_tokens:5,total_tokens:20}},
   {id:'ui-failure',provider:'zhipu',model:'ui-test-model',operation_label:'历史失败演示',started_at:'2026-11-17T09:14:00Z',finished_at:'2026-11-17T09:15:00Z',outcome:'failed',remote_calls:1,provider_succeeded:false,error_message:'模拟限流：稍后手动重试',usage:null},
   {id:'ui-replay',provider:'replay',model:null,operation_label:'本地回放演示',started_at:'2026-11-17T09:00:00Z',finished_at:'2026-11-17T09:00:01Z',outcome:'replay',remote_calls:0,provider_succeeded:false,error_message:'',usage:null},
  ]};
  await page.route('**/api/model/status',route=>route.fulfill({json:status}));
  await page.getByRole('button',{name:'演示设置',exact:true}).click();
  const model=page.getByRole('region',{name:'模型状态与调用记录'});
  await model.getByText('模型占用中 · 需求配置拆解',{exact:true}).waitFor();
  check('模型状态面板同时呈现当前占用和历史成功时间',(await model.innerText()).includes('最近接口成功')&&!(await model.innerText()).includes('暂无真实接口成功记录')&&(await model.innerText()).includes('模拟限流'));
  await model.getByText('最近 3 条记录',{exact:true}).click();
  check('历史成功失败用量与本地回放明确区分',await model.getByText('历史成功演示',{exact:true}).isVisible()&&await model.getByText('历史失败演示',{exact:true}).isVisible()&&(await model.innerText()).includes('输入 15 / 输出 5 / 合计 20 tokens')&&(await model.innerText()).includes('本地回放，未调用接口')&&(await model.innerText()).includes('没有接口 token 用量'));
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  const bounds=await page.getByRole('dialog').boundingBox();
  check('390px设置弹窗可阅读且没有页面级横向溢出',!!bounds&&bounds.x>=0&&bounds.x+bounds.width<=391&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(out,'05-mobile-model-status.png'),fullPage:true});
  assert.deepEqual(errors,[],'浏览器不应有运行时错误');
  fs.writeFileSync(path.join(out,'product-evidence-report.json'),JSON.stringify({checks,errors,model_status:'mocked UI fixture; no live model call',product_version:after.product.version},null,2));
 }catch(error){await page.screenshot({path:path.join(out,'product-failure.png'),fullPage:true});fs.writeFileSync(path.join(out,'product-failure.txt'),String(error)+'\n'+await page.locator('body').innerText());throw error}
 finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
