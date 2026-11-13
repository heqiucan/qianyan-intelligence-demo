/* V3 business acceptance. Only the isolated localhost:8022 service is permitted. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/16620/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.DEMO_TEST_URL || 'http://127.0.0.1:8022';
assert.equal(new URL(base).hostname, '127.0.0.1');
assert.equal(new URL(base).port, '8022', 'Do not run acceptance mutations against user data');
const out = path.resolve('tmp/v3-acceptance/browser');
fs.mkdirSync(out, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(15000);
  const checks = [], errors = [], apiFailures = [];
  let injectedFailures = 0;
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => {
    if (!r.url().startsWith(base + '/api/') || r.status() < 400) return;
    if (r.status() === 503 && r.url().endsWith('/check')) injectedFailures++;
    else apiFailures.push({ url: r.url(), status: r.status() });
  });
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log('PASS ' + name); };
  const btn = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const field = name => page.getByLabel(name, { exact: true });
  const state = async () => (await page.request.get(base + '/api/state')).json();
  const settled = async () => { await page.locator('.busy-indicator').waitFor({ state: 'hidden' }); };
  async function action(locator, endpoint, method = 'POST') {
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api' + endpoint && r.request().method() === method),
      locator.click(),
    ]);
    const data = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(data));
    await settled();
    return data;
  }
  const nav = async name => {
    await btn(name, page.getByRole('navigation', { name: '主导航' })).click();
    await settled();
  };
  let campaign, generated, revision, plan, order;
  try {
    await page.goto(base);
    await page.getByRole('heading', { name: '增长工作台', exact: true, level: 1 }).waitFor();
    const mainNav = page.getByRole('navigation', { name: '主导航' });
    check('八个一级功能入口', (await mainNav.getByRole('button').allTextContents()).map(t => t.trim()).join('|') === '增长工作台|商品与品牌|营销与创意|广告投放|效果与获客|异常与待办|AI 优化复盘|活动报告');
    check('原首页紫色球体与四张指标卡保留', await page.getByRole('img',{name:'紫色点阵星球品牌插画'}).isVisible() && await page.locator('.stat-card').count()===4);
    await page.screenshot({ path: path.join(out, '01-workbench.png'), fullPage: true });
    await btn('新建营销活动').click();
    await field('活动名称').fill('V3 创意事实核对 ' + Date.now());
    await field('内部观察目标').fill('验证有依据的创意到模拟投放成交');
    await field('受众假设').fill('需要核对商品规格的通勤用户');
    await field('主推卖点').fill('500ml 奶油白，演示售价99元');
    campaign = await action(btn('创建并开始策划'), '/campaigns');
    await page.getByRole('heading', { name: '营销与创意', exact: true, level: 1 }).waitFor();
    generated = await action(btn('生成两组创意'), `/campaigns/${campaign.id}/generate`);
    const workspace = page.locator('[data-testid="creative-workspace"]');
    await workspace.waitFor();
    check('同一活动进入营销与创意', await field('选择营销活动').inputValue() === campaign.id);
    check('明确标注回放与规则能力', /回放/.test(await page.locator('body').innerText()));
    await btn('载入核对示例').click();
    const demoText = await field('广告正文').inputValue();
    check('核对示例仅填入可编辑草稿', /79/.test(demoText) && /1\s*[Ll]/.test(demoText) && /24/.test(demoText) && !(await state()).creatives.some(c => c.campaign_id === campaign.id && /79/.test(c.body)));
    const result = await action(btn('核对当前文案'), `/creatives/${generated[0].id}/check`);
    check('区分规格价格冲突与时长缺少依据', result.findings.filter(f => f.kind === 'conflict').length >= 2 && result.findings.some(f => f.kind === 'missing_evidence' && /24/.test(f.text)) && result.can_approve === false);
    await page.locator('[data-testid="claim-results"]').waitFor();
    const evidenceButton = page.getByRole('button', { name: /^查看依据：/ }).first();
    await evidenceButton.click();
    check('依据说明提供来源与资料版本', /资料|版本|V1/.test(await page.locator('dialog').innerText()) && /99|500/.test(await page.locator('dialog').innerText()));
    await btn('关闭弹窗').click();
    await page.screenshot({ path: path.join(out, '02-claims.png'), fullPage: true });
    await btn('查看修订建议').click();
    check('采纳之前可以核对修改前后', /79|1L/.test(await page.locator('dialog').innerText()) && /99|500/.test(await page.locator('dialog').innerText()));
    await btn('采用建议到编辑区').click();
    const amendedText = await field('广告正文').inputValue();
    check('建议只更新编辑区未创建素材版本', amendedText !== demoText && (await state()).creatives.filter(c => c.campaign_id === campaign.id).length === 2);
    let verified = await action(btn('核对当前文案'), `/creatives/${generated[0].id}/check`);
    check('修订后检查可通过支持范围内的规则', verified.can_approve === true);

    // Equivalent units must not become a contradiction.
    await field('广告正文').fill('演示售价99元，0.5L容量，奶油白。');
    verified = await action(btn('核对当前文案'), `/creatives/${generated[0].id}/check`);
    check('0.5L 与500ml 等价', verified.can_approve && verified.findings.some(f => f.kind === 'consistent' && /0\.5L/i.test(f.text)));

    // A real failed request should preserve text, then the same action should recover.
    const retainedBody = await field('广告正文').inputValue();
    let failOnce = true;
    await page.route('**/api/creatives/*/check', async route => {
      if (failOnce) { failOnce = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '验收注入：核对服务暂时不可用，请重试。' }) }); }
      else await route.continue();
    });
    const failedResponse = page.waitForResponse(r => r.url().endsWith('/check') && r.status() === 503);
    await btn('核对当前文案').click(); await failedResponse;
    await page.getByText('验收注入：核对服务暂时不可用，请重试。', { exact: true }).waitFor();
    check('核对失败保留输入并显示可重试错误', await field('广告正文').inputValue() === retainedBody);
    verified = await action(btn('核对当前文案'), `/creatives/${generated[0].id}/check`);
    check('核对重试实际恢复', verified.can_approve === true && injectedFailures === 1);
    await page.unroute('**/api/creatives/*/check');

    // Slow response from an older draft must not authorize the newer draft.
    let release, notify;
    const releasePromise = new Promise(resolve => { release = resolve; });
    const captured = new Promise(resolve => { notify = resolve; });
    await page.route('**/api/creatives/*/check', async route => {
      const response = await route.fetch();
      const stale = await response.json(); stale.scope_note = '验收标记：过期核对结果不能用于当前输入';
      notify(); await releasePromise;
      await route.fulfill({ response, json: stale });
    });
    await btn('核对当前文案').click(); await captured;
    await field('广告正文').fill('演示售价99元，500ml容量，更新后的手工文案。');
    release();
    await btn('核对当前文案').waitFor();
    await page.waitForTimeout(150);
    check('输入变化后旧请求结果不覆盖当前草稿', !(await page.locator('body').innerText()).includes('验收标记：过期核对结果不能用于当前输入'));
    await page.unroute('**/api/creatives/*/check');
    await action(btn('核对当前文案'), `/creatives/${generated[0].id}/check`);

    const confirmDialog = page.waitForEvent('dialog');
    const leave = btn('广告投放', mainNav).click();
    const dialog = await confirmDialog; await dialog.dismiss(); await leave;
    check('未保存草稿离开可以取消且输入保留', await field('广告正文').inputValue() === '演示售价99元，500ml容量，更新后的手工文案。');
    await field('标题').fill('已核对的500ml随行杯');
    revision = await action(btn('保存为新版本'), `/creatives/${generated[0].id}/revise`);
    check('保存建立新版本并保留原稿', revision.version === 2 && revision.id !== generated[0].id && (await state()).creatives.find(c => c.id === generated[0].id).body === generated[0].body);
    await btn('确认当前素材').click();
    await action(btn('确认通过素材'), `/creatives/${revision.id}/approve`);
    const approved = (await state()).creatives.find(c => c.id === revision.id);
    check('确认经过后端检查并保存状态', approved.status === 'approved');
    await page.screenshot({ path: path.join(out, '03-confirmed-creative.png'), fullPage: true });
    await btn('用当前素材创建投放', workspace).click();
    check('投放草稿绑定刚确认的版本', await field('已确认素材').inputValue() === revision.id);
    await field('计划名称').fill('V3 已核对素材模拟计划');
    plan = await action(btn('保存计划草稿'), '/plans');
    const row = page.getByRole('row').filter({ hasText: plan.name });
    await btn('确认启动', row).click();
    await action(btn('确认模拟启动'), `/plans/${plan.id}/status`);
    await btn('体验购买', row).click();
    await btn(revision.cta).click();
    await page.getByRole('button', { name: /核对订单/ }).click();
    order = await action(btn('模拟付款并下单'), '/orders');
    check('模拟成交保留素材与计划关联', order.amount === 99 && order.creative_id === revision.id && order.plan_id === plan.id);
    await btn('查看订单来源').click();
    await btn('查看链路').click();
    check('订单可以反查核对后的素材版本', (await page.locator('dialog').innerText()).includes(revision.title));
    await btn('关闭弹窗').click();
    await page.screenshot({ path: path.join(out, '04-results.png'), fullPage: true });
    check('缺少消耗时有明确解释', /未提供|暂不可计算/.test(await page.locator('body').innerText()));
    await page.reload(); await field('选择营销活动').waitFor();
    check('刷新保留活动及成交记录', await field('选择营销活动').inputValue() === campaign.id && (await state()).orders.some(o => o.id === order.id));
    await nav('营销与创意');
    await field('广告正文').fill('未保存的测试修改，99元，500ml。');
    let acceptedPrompts = 0;
    const acceptLeave = async dialog => { acceptedPrompts++; await dialog.accept(); };
    page.on('dialog', acceptLeave);
    const approvedCard = page.locator('.creative-card').filter({ has: page.getByRole('heading', { name: revision.title, exact: true }) });
    await btn('用于投放', approvedCard).click();
    await field('已确认素材').waitFor();
    page.off('dialog', acceptLeave);
    check('卡片用于投放只确认离开一次且保留素材选择', acceptedPrompts === 1 && await field('已确认素材').inputValue() === revision.id);
    await btn('关闭弹窗').click();
    await nav('营销与创意');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    check('390宽创意页面无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check('减少动画设置避免长过渡', await page.locator('.button').first().evaluate(el => getComputedStyle(el).transitionDuration.split(',').every(v => parseFloat(v) < .01)));
    await page.screenshot({ path: path.join(out, '05-mobile-creative.png'), fullPage: true });
    check('浏览器无脚本异常', errors.length === 0);
    check('无意外接口失败', apiFailures.length === 0);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: checks.length, checks, errors, apiFailures, injectedFailures, campaignId: campaign.id, creativeId: revision.id, planId: plan.id }, null, 2));
  } catch (e) {
    await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ error: e.stack, checks, errors, apiFailures, body: (await page.locator('body').innerText()).slice(-12000) }, null, 2));
    throw e;
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

