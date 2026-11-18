/* Run only against isolated replay data on localhost:8028. */
const { chromium } = require('./playwright_runtime.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = 'http://127.0.0.1:8028';
const out = path.resolve('tmp/agent-acceptance/browser');
fs.mkdirSync(out, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const check = (label, value) => { assert.ok(value, label); checks.push(label); };
  const status = text => page.locator('.agent-task-heading .badge').filter({ hasText: text }).waitFor();
  const create = async () => {
    const response = page.waitForResponse(r => r.url().endsWith('/api/agent/tasks') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '开始任务', exact: true }).click();
    const r = await response; assert.equal(r.status(), 202); return (await r.json()).id;
  };
  try {
    const emptySpace = await (await page.request.post(base + '/api/knowledge/spaces', { data: { scene: 'medical', name: 'Agent 浏览器验收 ' + Date.now() } })).json();
    await page.goto(base + '/');
    await page.getByRole('heading', { name: '增长工作台', exact: true }).waitFor();
    check('原首页、球体与八个导航保留', await page.locator('.hero').count() === 1 && await page.locator('.hero-art').count() === 1 && await page.getByRole('navigation', { name: '主导航' }).getByRole('button').count() === 8);
    check('独立官网仍可访问', (await page.request.get(base + '/website.html')).status() === 200);
    await page.screenshot({ path: path.join(out, '01-home.png') });
    await page.getByRole('button', { name: '交给 AI 处理' }).click();
    await page.locator('.agent-composer').waitFor();
    await page.locator('#agent-workspace').screenshot({ path: path.join(out, '02-composer.png') });
    const medicalId = await create();
    await status('待你审阅');
    const traceText = await page.locator('.agent-events').innerText();
    check('任务完成检索读取生成检查保存', ['关键词检索', '读取原文依据', '撰写内容', '核对引用与表达', '保存草稿'].every(t => traceText.includes(t)));
    check('规则回放和虚构依据明确标记', (await page.locator('.agent-provenance').innerText()).includes('未调用模型') && (await page.locator('.agent-provenance').innerText()).includes('虚构示例'));
    await page.locator('.agent-source').first().click();
    check('引用可打开原文版本定位', (await page.locator('dialog[open]').innerText()).includes('版本 1') && (await page.locator('dialog[open]').innerText()).includes('段落'));
    await page.getByRole('button', { name: '关闭弹窗' }).click();
    check('未确认时不能标记任务完成', await page.getByRole('button', { name: '标记任务完成', exact: true }).isDisabled());
    const editor = page.getByRole('region', { name: '知识草稿编辑器' });
    const content = editor.getByLabel('第 1 段内容');
    await content.fill((await content.inputValue()) + '\n（人工核对稿）');
    await editor.getByRole('button', { name: '保存修订版本' }).click();
    await editor.getByText(/版本 2/).waitFor();
    await editor.getByRole('checkbox').check();
    await editor.getByRole('button', { name: '人工确认并保存' }).click();
    await editor.getByText('人工已确认 · 未发布', { exact: true }).waitFor();
    await page.getByRole('button', { name: '标记任务完成', exact: true }).click();
    await status('已确认完成');
    check('修订、人工确认、完成闭环可交互', true);
    await page.reload(); await status('已确认完成');
    check('刷新恢复原任务与记录', await page.evaluate(() => localStorage.getItem('marketing-agent-task')) === medicalId);
    await page.locator('.agent-task-heading').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, '03-medical-task.png') });
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出草稿与引用' }).click();
    await (await downloadEvent).saveAs(path.join(out, 'draft.md'));
    check('草稿可导出含引用快照', fs.readFileSync(path.join(out, 'draft.md'), 'utf8').includes('## 引用快照'));

    await page.getByRole('button', { name: '新建 Agent 任务', exact: true }).click();
    await page.getByRole('button', { name: /直播电商.*有依据的直播讲解/ }).click();
    const originalGoal = await page.getByLabel('希望 Agent 完成的任务').inputValue();
    await page.route('**/api/agent/tasks', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '浏览器验收：模拟提交失败' }) }) : route.continue());
    await page.getByRole('button', { name: '开始任务', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '模拟提交失败' }).waitFor();
    check('提交失败保留完整输入', await page.getByLabel('希望 Agent 完成的任务').inputValue() === originalGoal);
    await page.unroute('**/api/agent/tasks');
    await create(); await status('待你审阅');
    check('直播任务只引用自己场景资料', !(await page.locator('.agent-evidence').innerText()).includes('澄光') && (await page.locator('.agent-evidence').innerText()).includes('青禾'));
    await page.getByLabel('补充要求').fill('只保留规格和杯盖的讲解，语气自然一些。');
    await page.getByRole('button', { name: '提交要求并继续', exact: true }).click();
    await page.locator('.agent-tags').getByText(/第 2 轮/).waitFor(); await status('待你审阅');
    const live = await (await page.request.get(base + '/api/agent/tasks/' + await page.evaluate(() => localStorage.getItem('marketing-agent-task')))).json();
    check('补充要求产生新一轮，原产物保留', live.attempt === 2 && live.result_ids.length === 2);
    await page.locator('.agent-task-heading').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, '04-live-task.png') });

    await page.getByRole('button', { name: '新建 Agent 任务', exact: true }).click();
    await page.getByRole('button', { name: /医美获客.*预约沟通与内部 FAQ/ }).click();
    await page.getByLabel('使用哪些资料').selectOption('knowledge');
    await page.getByLabel('资料空间', { exact: true }).selectOption(emptySpace.id);
    await create(); await status('需要补充');
    check('空知识库请求补充且不生成无依据草稿', await page.locator('.kb-draft-editor').count() === 0);
    const doc = await (await page.request.post(base + '/api/knowledge/documents', { data: { space_id: emptySpace.id, title: '验收虚构预约流程', pages: [{ text: '【验收用虚构资料】咨询预约先登记希望咨询的类别和到店时间，再由本人确认。接待时间需核对后告知。' }] } })).json();
    assert.equal((await page.request.post(base + '/api/knowledge/documents/' + doc.id + '/review', { data: { expected_version: 1, status: 'approved' } })).status(), 200);
    await page.getByLabel('补充要求').fill('已补充预约说明，请只整理预约流程。');
    await page.getByRole('button', { name: '提交要求并继续', exact: true }).click();
    await status('待你审阅');
    check('补充并审核资料后任务能继续', (await page.locator('.agent-evidence').innerText()).includes('验收虚构预约流程'));
    await page.getByRole('button', { name: '结束本次任务', exact: true }).click();
    await status('已取消');
    check('取消停止后续操作并保留既有草稿', await page.locator('.kb-draft-editor').count() === 1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.agent-task-heading').scrollIntoViewIfNeeded();
    check('390 宽任务页无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check('减少动画设置生效', await page.locator('.agent-source').first().evaluate(el => getComputedStyle(el).transitionDuration === '0s'));
    await page.screenshot({ path: path.join(out, '05-mobile-task.png') });
    await page.getByRole('button', { name: '新建 Agent 任务', exact: true }).click();
    check('390 宽表单无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('.agent-composer').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, '06-mobile-composer.png') });
    check('浏览器没有脚本异常', errors.length === 0);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
  } catch (e) {
    await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ error: e.stack, checks, errors, body: (await page.locator('body').innerText()).slice(-14000) }, null, 2));
    throw e;
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
