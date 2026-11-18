const {chromium}=require('./playwright_runtime.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.DEMO_TEST_BASE||'http://127.0.0.1:8035';
const filters={theme_terms:[],intent_terms:[],exclude_terms:[],match_mode:'any',semantic:false,date_from:null,date_to:null,missing_time:'include',dedupe:true,sort:'source',limit:200};
const config={space_id:'space-ui',name:'请求隔离任务',goal:'旧的任务目标',task_type:'analyze',batch_id:'batch-ui',channel:'internal',template_id:null,template_version:null,pack_id:null,pack_version:null,filters};
const task={id:'task-ui',space_id:'space-ui',name:'界面验证任务',goal:'测试任务选择',task_type:'analyze',status:'waiting_review',stage:'review',revision:1,config,counts:{input:1,matched:1,pending:1},events:[],warnings:[],results:[{id:'result-ui',task_id:'task-ui',space_id:'space-ui',revision:1,original:'预约流程',normalized:'预约流程',source:{filename:'UI.csv',row:2},category:'预约',group:'',status:'pending',reasons:[],flags:[],duplicate_sources:[]}],created_at:'2026-11-17T10:00:00Z',updated_at:'2026-11-17T10:00:00Z'};
async function main(){
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
 fs.mkdirSync('tmp/demand-acceptance/browser',{recursive:true});
 const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name)};
 let empty=false,taskCalls=0,planRelease,previewRelease,failPoll=false,transportMode='',retryIds=[];
 await page.addInitScript(()=>{const original=window.setTimeout;window.setTimeout=(fn,delay,...args)=>original(fn,window.__shortApiTimeout&&delay===120000?150:delay,...args)});
 await page.route('**/api/knowledge/spaces',r=>r.fulfill({json:empty?[]:[{id:'space-ui',name:'界面回归空间',scene:'medical',is_demo:true}]}));
 await page.route('**/api/knowledge/documents?*',r=>r.fulfill({json:[]}));
 await page.route('**/api/demand/**',async r=>{
  const pathname=new URL(r.request().url()).pathname;
  if(pathname.endsWith('/plan')){if(transportMode){retryIds.push(r.request().postDataJSON().request_id);if(transportMode==='html')return r.fulfill({status:502,contentType:'text/html',body:'<html>temporary upstream error</html>'});if(transportMode==='network')return r.abort('failed');if(transportMode==='timeout'){await new Promise(resolve=>setTimeout(resolve,1000));return r.fulfill({json:{}}).catch(()=>{})}return r.fulfill({json:{config:null,source:'replay',steps:[],note:'请求恢复成功',missing:[]}})}await new Promise(resolve=>{planRelease=resolve});return r.fulfill({json:{config,source:'replay',steps:['旧目标'],note:'旧结果',missing:[]}})}
  if(pathname.endsWith('/preview')){await new Promise(resolve=>{previewRelease=resolve});return r.fulfill({json:{signature:'stale',counts:{input:1,matched:1,excluded:0,duplicates:0,limited:0},sample:[],exclusions:[],warnings:[]}})}
  if(pathname.endsWith('/batches'))return r.fulfill({json:[{id:'batch-ui',space_id:'space-ui',title:'界面素材',version:1,row_count:1,duplicate_count:0,source_kind:'demo'}]});
  if(pathname.endsWith('/tasks')){taskCalls++;return r.fulfill(failPoll?{status:503,json:{detail:'模拟暂时断线'}}:{json:[task]})}
  if(pathname.endsWith('/tasks/task-ui'))return r.fulfill({json:task});
  return r.fulfill({json:[]});
 });
 try{
  await page.goto(base+'/#/overview?tab=demand');
  const goal=page.getByLabel('用一句话描述任务目标',{exact:true});await goal.waitFor();
  await page.getByLabel('素材批次',{exact:true}).selectOption('batch-ui');await goal.fill('旧目标：整理问题');
  await page.getByRole('button',{name:'根据目标生成可编辑配置',exact:true}).click();
  while(!planRelease)await page.waitForTimeout(10);await goal.fill('新目标：保留我刚刚写的输入');planRelease();
  await page.getByText('你已修改配置，较早的模型结果已丢弃，当前输入保持不变。请按新目标重新拆解。',{exact:true}).waitFor();
  check('旧plan响应不会覆盖用户的新输入',await goal.inputValue()==='新目标：保留我刚刚写的输入');
  await page.getByRole('button',{name:'预览筛选结果',exact:true}).click();while(!previewRelease)await page.waitForTimeout(10);
  await page.getByLabel('任务名称',{exact:true}).fill('预览期间修改的名称');previewRelease();
  await page.getByText('筛选条件已改变，较早的预览已丢弃，请重新预览。',{exact:true}).waitFor();
  check('旧筛选预览不可启动任务',await page.getByRole('button',{name:'确认并启动任务',exact:true}).count()===0);
  transportMode='html';await page.getByRole('button',{name:'根据目标生成可编辑配置',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'服务返回了无法读取的响应'}).waitFor();check('非JSON错误显示可理解提示',await page.getByRole('alert').filter({hasText:'HTTP 502'}).count()===1);
  transportMode='network';await page.getByRole('button',{name:'根据目标生成可编辑配置',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'无法连接服务'}).waitFor();
  transportMode='timeout';await page.evaluate(()=>window.__shortApiTimeout=true);await page.getByRole('button',{name:'根据目标生成可编辑配置',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'请求等待超时'}).waitFor();check('超时说明服务器可能仍在处理',await page.getByRole('alert').filter({hasText:'服务器可能仍在处理'}).count()===1);
  transportMode='success';await page.evaluate(()=>window.__shortApiTimeout=false);await page.getByRole('button',{name:'根据目标生成可编辑配置',exact:true}).click();
  await page.getByText(/请求恢复成功/).waitFor();check('非JSON、断网和超时后的同一操作重试沿用request_id',retryIds.length===4&&new Set(retryIds).size===1);
  await page.locator('.demand-task-card').click();
  await page.getByRole('region',{name:'需求任务结果'}).waitFor();
  check('任务选择写URL且保留正在编辑的表单',page.url().includes('task=task-ui')&&page.url().includes('space=space-ui')&&await goal.inputValue()==='新目标：保留我刚刚写的输入');
  const beforeStable=taskCalls;await page.waitForTimeout(5600);
  check('无活动任务不会每2.5秒刷新',taskCalls===beforeStable);
  await page.getByRole('button',{name:/03 筛选与确认/}).click();await page.getByRole('region',{name:'需求任务结果'}).waitFor();
  check('切换流程步骤保留任务和机构',page.url().includes('analytics?tab=demand&space=space-ui&task=task-ui'));
  await page.reload();await page.getByRole('region',{name:'需求任务结果'}).waitFor();check('刷新后恢复所选任务',await page.locator('.demand-task-card.selected').count()===1);
  await page.getByRole('button',{name:/02 素材与词库/}).click();await page.getByRole('heading',{name:'需求素材批次',exact:true}).waitFor();
  const beforeLibrary=taskCalls;await page.waitForTimeout(5600);check('素材页不持续轮询任务',taskCalls===beforeLibrary);
  task.status='running';await page.goto(base+'/#/analytics?tab=demand&space=space-ui&task=task-ui');await page.getByRole('region',{name:'需求任务结果'}).waitFor();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))});
  const hiddenCalls=taskCalls;await page.waitForTimeout(5600);check('页面隐藏时暂停任务轮询',taskCalls===hiddenCalls);
  failPoll=true;await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))});
  await page.getByRole('alert').filter({hasText:'模拟暂时断线'}).waitFor();
  failPoll=false;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.getByRole('alert').filter({hasText:'模拟暂时断线'}).waitFor({state:'detached'});check('恢复显示会立即重试并清除旧错误',taskCalls>hiddenCalls);
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  check('390px结果页无页面级横向溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  check('减少动画设置禁用需求按钮过渡',await page.locator('.demand-task-card').evaluate(el=>getComputedStyle(el).transitionDuration)==='0s');
  empty=true;await page.goto(base+'/#/overview?tab=demand&space=empty');
  await page.getByRole('button',{name:'去知识库创建空间',exact:true}).waitFor();check('空空间结束加载并显示创建入口',await page.getByText('正在读取当前空间…',{exact:true}).count()===0);
  await page.screenshot({path:'tmp/demand-acceptance/browser/04-empty-space.png',fullPage:true});check('浏览器无运行时错误',errors.length===0);
  fs.writeFileSync('tmp/demand-acceptance/browser/regression-report.json',JSON.stringify({checks,errors},null,2));
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
