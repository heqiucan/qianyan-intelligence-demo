/* Read-only model settings inspection. Never clicks a generation/check button. */
const {chromium}=require('./playwright_runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
async function main(){
 const base=process.env.DEMO_TEST_BASE;
 assert(base&&new URL(base).hostname==='127.0.0.1');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[],writes=[],checks=[];const out='tmp/deepseek-settings';fs.mkdirSync(out,{recursive:true});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{if(route.request().method()!=='GET'){writes.push(route.request().url());return route.abort()}return route.continue()});
 const check=(name,ok)=>{assert(ok,name);checks.push(name)};
 try{
  const before=await(await page.request.get(base+'/api/model/status')).json();
  check('configured DeepSeek official model',before.mode==='deepseek'&&before.model_name==='deepseek-flash'&&before.configured);
  check('not represented as free-only',before.free_only===false);
  await page.goto(base+'/#/overview');await page.getByRole('button',{name:'设置',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  const text=await dialog.innerText();
  check('correct provider and version',text.includes('DeepSeek')&&text.includes('V4.1-Flash-1017'));
  check('account billing and alias boundary visible',text.includes('按账户规则计费')&&text.includes('别名'));
  check('old provider wizard not offered in DeepSeek mode',!text.includes('configure-zhipu.cmd')&&!text.includes('免费模型'));
  await page.screenshot({path:out+'/desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  check('mobile settings do not overflow',await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:out+'/mobile.png'});
  const after=await(await page.request.get(base+'/api/model/status')).json();
  check('reading settings makes no model calls',after.call_count===before.call_count&&writes.length===0);
  check('no browser exceptions',errors.length===0);
  fs.writeFileSync(out+'/result.json',JSON.stringify({checks,errors,writes},null,2));
  console.log(JSON.stringify({passed:checks.length,errors:errors.length}));
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
