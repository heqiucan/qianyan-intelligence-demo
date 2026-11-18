/* Product/version workflow acceptance. Requires the isolated replay runner. */
const {chromium}=require('./playwright_runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=process.env.DEMO_TEST_BASE;
const out=path.resolve('tmp/demand-acceptance/browser');

async function main(){
 assert.ok(base&&new URL(base).hostname==='127.0.0.1'&&new URL(base).port!=='8001','只允许隔离临时 replay 服务，不能使用日常8001');
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);
 const checks=[],errors=[],generations=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 page.on('request',request=>{if(request.method()==='POST'&&/\/api\/campaigns\/[^/]+\/generate$/.test(request.url()))generations.push(request.url())});
 const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)};
 const get=async url=>{const response=await page.request.get(base+'/api'+url);assert.ok(response.ok(),await response.text());return response.json()};
 const put=async data=>{const response=await page.request.put(base+'/api/product',{data});assert.ok(response.ok(),await response.text());return response.json()};
 const waitResponse=(path,method='POST')=>page.waitForResponse(response=>response.url().endsWith('/api'+path)&&response.request().method()===method);
 const unchanged=(before,after,collection)=>before[collection].every(record=>JSON.stringify(after[collection].find(item=>item.id===record.id))===JSON.stringify(record));
 try{
  const before=await get('/state');assert.equal(before.model.mode,'replay');
  const original=before.campaigns.find(c=>c.id==='campaign-demo')||before.campaigns[0];assert.ok(original);
  const latest=await put({...before.product,name:'验收羽绒服',brand:'验收品牌',price:500,capacity:'M',color:'香芋紫',description:'虚构测试服装，仅用于浏览器验收。',image_url:'/assets/catalog-placeholder.svg',claim_evidence:[]});
  await page.goto(base+'/#/creative');await page.getByRole('combobox',{name:'选择营销活动',exact:true}).selectOption(original.id);
  const warning=page.locator('[aria-label="生成商品与最新资料不同"]');await warning.waitFor();
  check('旧活动与最新商品的名称版本价格在生成入口明确对照',(await warning.innerText()).includes(original.product_snapshot.name)&&(await warning.innerText()).includes(latest.name)&&(await warning.innerText()).includes('V'+latest.version)&&(await warning.innerText()).includes('500.00'));
  await page.getByRole('button',{name:'生成两组创意',exact:true}).click();
  let dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'选择本次生成的商品',exact:true}).waitFor();
  check('点击生成先选择商品且未发送旧商品生成请求',generations.length===0&&(await dialog.innerText()).includes(latest.name));
  await dialog.getByRole('button',{name:'使用最新商品创建活动',exact:true}).click();
  dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'使用最新商品创建活动',exact:true}).waitFor();
  check('新活动表单预填最新商品名称并展示审核版本和价格',await dialog.getByLabel('活动名称',{exact:true}).inputValue()===latest.name+' · 推广活动'&&(await dialog.locator('[aria-label="本活动使用的商品"]').innerText()).includes('V'+latest.version)&&(await dialog.innerText()).includes('500.00'));
  await dialog.getByLabel('受众假设',{exact:true}).fill('虚构服装受众');await dialog.getByLabel('主推卖点',{exact:true}).fill('规格与颜色');
  const creating=waitResponse('/campaigns');await dialog.getByRole('button',{name:'创建活动并使用此商品',exact:true}).click();
  const createdResponse=await creating;assert.ok(createdResponse.ok(),await createdResponse.text());const created=await createdResponse.json();
  const submitted=createdResponse.request().postDataJSON();
  await dialog.waitFor({state:'detached'});
  await page.waitForFunction(id=>document.querySelector('select[aria-label="选择营销活动"]')?.value===id,created.id);
  check('创建携带已核对商品版本并自动切换新活动',submitted.expected_product_version===latest.version&&JSON.stringify(created.product_snapshot)===JSON.stringify(latest)&&!await warning.count());
  const generating=waitResponse('/campaigns/'+created.id+'/generate');await page.getByRole('button',{name:'生成两组创意',exact:true}).click();
  const generatedResponse=await generating;assert.ok(generatedResponse.ok(),await generatedResponse.text());const generated=await generatedResponse.json();
  await page.locator('[data-testid="creative-workspace"]').waitFor();
  check('两组新创意使用最新商品的名称价格规格颜色和图片',generated.length===2&&generated.every(item=>JSON.stringify(item.product_snapshot)===JSON.stringify(latest)&&item.body.includes(latest.name)&&item.body.includes('500')&&item.body.includes('M')&&item.body.includes('香芋紫'))&&await page.locator('.studio-product-image').getAttribute('src')===latest.image_url);
  let after=await get('/state');
  check('创建新活动与生成新素材没有改写已有活动素材或计划',['campaigns','creatives','plans'].every(collection=>unchanged(before,after,collection)));
  await page.screenshot({path:path.join(out,'07-latest-product-generated.png'),fullPage:true});

  await page.getByRole('combobox',{name:'选择营销活动',exact:true}).selectOption(original.id);await warning.waitFor();
  await page.getByRole('button',{name:'生成两组创意',exact:true}).click();dialog=page.getByRole('dialog');
  const oldGeneration=waitResponse('/campaigns/'+original.id+'/generate');await dialog.getByRole('button',{name:'继续使用活动原商品生成',exact:true}).click();
  const oldResponse=await oldGeneration;assert.ok(oldResponse.ok(),await oldResponse.text());const oldResults=await oldResponse.json();
  check('明确选择旧商品后仍按原活动快照生成',oldResults.length===2&&oldResults.every(item=>JSON.stringify(item.product_snapshot)===JSON.stringify(original.product_snapshot)));
  await page.getByRole('button',{name:'使用最新商品创建活动',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'使用最新商品创建活动',exact:true}).waitFor();
  await dialog.getByLabel('活动名称',{exact:true}).fill('版本冲突时保留此输入');
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  const bounds=await dialog.boundingBox();
  check('390px最新商品表单可阅读并支持减少动画偏好',!!bounds&&bounds.x>=0&&bounds.x+bounds.width<=391&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&matchMedia('(prefers-reduced-motion: reduce)').matches));
  await page.screenshot({path:path.join(out,'08-mobile-latest-product.png'),fullPage:true});
  const count=after.campaigns.length;const newer=await put({...latest,name:'验收羽绒服再次修改',price:520});
  const rejected=waitResponse('/campaigns');await dialog.getByRole('button',{name:'创建活动并使用此商品',exact:true}).click();
  const rejection=await rejected;assert.equal(rejection.status(),409);await dialog.getByRole('alert').waitFor();
  after=await get('/state');
  check('表单打开后商品变化拒绝创建并保留已填内容',after.campaigns.length===count&&await dialog.getByLabel('活动名称',{exact:true}).inputValue()==='版本冲突时保留此输入'&&(await dialog.getByRole('alert').innerText()).includes('V'+newer.version));
  await dialog.getByRole('button',{name:'重新读取最新商品，保留表单输入',exact:true}).click();
  await dialog.getByText(`已读取商品资料 V${newer.version}。活动名称、受众与卖点输入已保留，请按上方商品核对后重新提交。`,{exact:true}).waitFor();
  assert.equal(await dialog.getByLabel('活动名称',{exact:true}).inputValue(),'版本冲突时保留此输入');
  const retry=waitResponse('/campaigns');await dialog.getByRole('button',{name:'创建活动并使用此商品',exact:true}).click();
  const retried=await retry;assert.ok(retried.ok(),await retried.text());const recovered=await retried.json();
  check('重新读取最新版本保留表单并可再次成功创建',retried.request().postDataJSON().expected_product_version===newer.version&&recovered.name==='版本冲突时保留此输入'&&JSON.stringify(recovered.product_snapshot)===JSON.stringify(newer));
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'campaign-product-report.json'),JSON.stringify({checks,errors,mode:'isolated replay, no real model requests',old_product:original.product_snapshot.name,new_product:latest.name,product_version:latest.version},null,2));
 }catch(error){await page.screenshot({path:path.join(out,'campaign-product-failure.png'),fullPage:true});fs.writeFileSync(path.join(out,'campaign-product-failure.txt'),String(error)+'\n'+await page.locator('body').innerText());throw error}
 finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
