/* Run only against an isolated replay service:
 * DEMO_TEST_BASE=http://127.0.0.1:<port> node scripts/browser_creative_workspace.cjs
 */
const { chromium } = require('./playwright_runtime.cjs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

async function main() {
  const configuredBase = process.env.DEMO_TEST_BASE;
  assert.ok(configuredBase, 'DEMO_TEST_BASE must point to an isolated replay service');
  const address = new URL(configuredBase);
  assert.ok(address.protocol === 'http:' && address.hostname === '127.0.0.1' && address.port && address.port !== '8001', 'Only http://127.0.0.1 on an explicit non-8001 port is allowed');
  assert.ok(!address.username && !address.password && address.pathname === '/' && !address.search && !address.hash, 'DEMO_TEST_BASE must contain only the local origin');
  const base = address.origin;
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const checks = [], errors = [], confirmations = [], mutations = [];
  let acceptConfirmation = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => {
    confirmations.push(dialog.message());
    void (acceptConfirmation ? dialog.accept() : dialog.dismiss());
  });
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) {
      mutations.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
    }
  });
  const check = (name, value = true) => { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`); };
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const field = (name, scope = page) => scope.getByLabel(name, { exact: true });
  const workspace = () => page.getByTestId('creative-workspace');
  const library = () => page.getByRole('region', { name: '活动素材列表', exact: true });
  const dialog = () => page.getByRole('dialog');
  const route = () => new URL(page.url()).hash.slice(2);
  const routeParams = () => new URLSearchParams(route().split('?')[1]);
  const responseFor = (path, method = 'POST') => page.waitForResponse(response => new URL(response.url()).pathname === '/api' + path && response.request().method() === method);
  const get = async path => {
    const response = await page.request.get(base + '/api' + path);
    assert.ok(response.ok(), await response.text());
    return response.json();
  };
  const post = async (path, data) => {
    const response = await page.request.post(base + '/api' + path, { data });
    assert.ok(response.ok(), await response.text());
    return response.json();
  };
  const saved = async (action, path) => {
    const pending = responseFor(path);
    await action();
    const response = await pending;
    assert.ok(response.ok(), await response.text());
    return response.json();
  };
  const waitCreative = async id => {
    await page.waitForURL(url => new URLSearchParams(url.hash.split('?')[1]).get('item') === id);
    await workspace().waitFor();
    await button('返回素材列表').waitFor({ state: 'visible' });
  };
  const returnToLibrary = async () => {
    await button('返回素材列表').click();
    await library().waitFor();
    assert.equal(route(), 'creative');
    assert.equal(await workspace().count(), 0);
  };
  const mobileCheck = async (name, selector) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    check(`${name}: 390px without page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check(`${name}: reduced motion`, await page.locator(selector).first().evaluate(element => getComputedStyle(element).transitionDuration.split(',').every(value => parseFloat(value) === 0)));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  };

  try {
    const before = await get('/state');
    assert.equal(before.model.mode, 'replay', 'Real model services are not allowed');
    check('isolated localhost service uses replay');
    const suffix = randomUUID().slice(0, 8);
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const campaign = await post('/campaigns', {
      name: `Creative workspace acceptance ${suffix}`, expected_product_version: before.product.version,
      audience: '演示受众', selling_point: '商品规格与价格', goal: '验证创意和投放工作流',
      budget_limit: 600, start_date: today, end_date: end, request_id: randomUUID(),
    });
    await page.addInitScript(id => {
      localStorage.setItem('campaign', id);
      localStorage.setItem('presentation-mode', '0');
      localStorage.setItem('v2-dataset', 'session');
      localStorage.removeItem('v2-plan');
      localStorage.removeItem('v2-batch');
      sessionStorage.removeItem('focus-creative');
      sessionStorage.removeItem('focus-plan');
      sessionStorage.removeItem('focus-adjustment');
    }, campaign.id);

    await page.goto(base + '/#/creative');
    await library().waitFor();
    check('creative starts with library, no editor or generation settings', await workspace().count() === 0 && await page.locator('#creative-generation').count() === 0);
    await button('Agent 创作').click();
    await page.waitForURL(url => url.hash.startsWith('#/agent?'));
    check('legacy Agent launch maps to agent with campaign and scene', routeParams().get('agent') === 'new' && routeParams().get('campaign') === campaign.id && routeParams().get('scene') === 'live');
    await page.goto(base + '/#/creative');
    await library().waitFor();
    await button('生成创意').click();
    await page.getByRole('region', { name: '创意生成设置', exact: true }).waitFor();
    check('generation settings expand without opening an editor', await workspace().count() === 0 && await button('收起生成设置').getAttribute('aria-expanded') === 'true');
    await field('文案结构').selectOption('spec');
    const generated = await saved(() => button('生成两组创意').click(), `/campaigns/${campaign.id}/generate`);
    assert.equal(generated.length, 2);
    const original = generated[0];
    await waitCreative(original.id);
    check('generation opens explicit URL detail with original product snapshot', JSON.stringify(original.product_snapshot) === JSON.stringify(campaign.product_snapshot) && await library().count() === 0 && await page.locator('#creative-generation').count() === 0);
    await page.reload();
    await workspace().waitFor();
    check('refresh restores requested material', await field('标题').inputValue() === original.title && routeParams().get('item') === original.id);
    await mobileCheck('creative detail', '.studio-page .button');

    await field('标题').fill('未保存的临时标题');
    const cancelledAt = confirmations.length;
    await button('返回素材列表').click();
    check('cancelled navigation asks once and keeps draft', confirmations.length === cancelledAt + 1 && await field('标题').inputValue() === '未保存的临时标题' && routeParams().get('item') === original.id);
    acceptConfirmation = true;
    const acceptedAt = confirmations.length;
    await returnToLibrary();
    check('accepted navigation asks once and returns to library', confirmations.length === acceptedAt + 1);
    acceptConfirmation = false;
    await page.reload();
    await library().waitFor();
    check('library refresh does not auto-select last material', await workspace().count() === 0 && await library().locator('.creative-card').count() === 2);
    await mobileCheck('creative library', '.studio-page .button');
    await button('编辑', page.locator(`[id="creative-${original.id}"]`)).click();
    await waitCreative(original.id);
    check('reopening discarded draft restores saved content', await field('标题').inputValue() === original.title);

    const revisedTitle = `${original.product_snapshot.name}，商品资料`;
    await field('标题').fill(revisedTitle);
    let failRevision = true;
    const revisionIds = [];
    const revisionPath = `/creatives/${original.id}/revise`;
    await page.route(base + '/api' + revisionPath, async intercepted => {
      revisionIds.push(intercepted.request().postDataJSON().request_id);
      if (failRevision) { failRevision = false; return intercepted.fulfill({ status: 503, json: { detail: '专项测试：保存暂时不可用' } }); }
      return intercepted.continue();
    });
    let pending = responseFor(revisionPath);
    await button('保存为新版本').click();
    assert.equal((await pending).status(), 503);
    await workspace().getByRole('alert').waitFor();
    check('failed save keeps draft and original version', await field('标题').inputValue() === revisedTitle && (await get('/state')).creatives.filter(item => item.campaign_id === campaign.id).length === 2);
    const revised = await saved(() => button('保存为新版本').click(), revisionPath);
    await waitCreative(revised.id);
    await page.unroute(base + '/api' + revisionPath);
    const afterRevision = await get('/state');
    check('save retry retains idempotency key and creates one version', revisionIds.length === 2 && revisionIds[0] === revisionIds[1] && revised.id !== original.id && revised.version === original.version + 1 && afterRevision.creatives.filter(item => item.campaign_id === campaign.id).length === 3);
    check('saving preserves parent, other material and product snapshot', generated.every(item => JSON.stringify(afterRevision.creatives.find(current => current.id === item.id)) === JSON.stringify(item)) && JSON.stringify(revised.product_snapshot) === JSON.stringify(original.product_snapshot));
    await page.reload();
    await workspace().waitFor();
    check('new version survives URL refresh', await field('标题').inputValue() === revisedTitle && routeParams().get('item') === revised.id);

    await button('版本对比').click();
    await dialog().waitFor();
    check('version comparison includes parent and new version', await field('对照版本', dialog()).locator('option').count() === 2);
    await button('关闭弹窗', dialog()).click();
    await button('预览 / 导出').click();
    await dialog().waitFor();
    await page.waitForFunction(() => {
      const canvas = document.querySelector('dialog .poster-canvas');
      if (!canvas) return false;
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return data.some((value, index) => index % 4 === 3 && value > 0);
    });
    await page.waitForFunction(() => [...document.querySelectorAll('dialog button')].some(element => element.textContent.includes('导出 PNG 海报') && !element.disabled));
    check('saved poster renders and PNG export is available', await button('导出 PNG 海报', dialog()).isEnabled());
    await button('关闭弹窗', dialog()).click();

    const checked = await saved(() => button('核对当前文案').click(), `/creatives/${revised.id}/check`);
    assert.equal(checked.can_approve, true, JSON.stringify(checked.findings));
    await page.getByTestId('claim-results').locator('.studio-check-summary').waitFor();
    check('claim check does not automatically approve', (await get('/state')).creatives.find(item => item.id === revised.id).status === 'draft');
    await button('确认当前素材').click();
    await dialog().waitFor();
    const approved = await saved(() => button('确认通过素材', dialog()).click(), `/creatives/${revised.id}/approve`);
    await dialog().waitFor({ state: 'detached' });
    await button('用当前素材创建投放').waitFor();
    check('explicit approval enables plan creation', approved.status === 'approved' && await button('用当前素材创建投放').isEnabled());
    await returnToLibrary();
    await field('素材筛选').selectOption('all');
    check('all versions remain accessible from library', await library().locator('.creative-card').count() === 3);
    await button('编辑', page.locator(`[id="creative-${approved.id}"]`)).click();
    await waitCreative(approved.id);
    await button('用当前素材创建投放').click();
    await dialog().waitFor();
    check('approved creative handoff selects the exact version', route().startsWith('ads') && await field('已确认素材', dialog()).inputValue() === approved.id);

    const planName = `Creative acceptance plan ${suffix}`;
    await field('计划名称', dialog()).fill(planName);
    await field('计划总预算', dialog()).fill('300');
    await field('开始日期', dialog()).fill(today);
    await field('结束日期', dialog()).fill(end);
    let failPlan = true;
    const planRequestIds = [];
    await page.route(base + '/api/plans', async intercepted => {
      if (intercepted.request().method() !== 'POST') return intercepted.continue();
      planRequestIds.push(intercepted.request().postDataJSON().request_id);
      if (failPlan) { failPlan = false; return intercepted.fulfill({ status: 503, json: { detail: '专项测试：创建计划暂时不可用' } }); }
      return intercepted.continue();
    });
    pending = responseFor('/plans');
    await button('保存计划草稿', dialog()).click();
    assert.equal((await pending).status(), 503);
    await dialog().getByRole('alert').waitFor();
    check('failed plan create preserves form', await field('计划名称', dialog()).inputValue() === planName && await field('已确认素材', dialog()).inputValue() === approved.id);
    const plan = await saved(() => button('保存计划草稿', dialog()).click(), '/plans');
    await dialog().waitFor({ state: 'detached' });
    await page.unroute(base + '/api/plans');
    check('plan retry keeps request ID and creates one draft', planRequestIds.length === 2 && planRequestIds[0] === planRequestIds[1] && plan.status === 'draft' && (await get('/state')).plans.filter(item => item.campaign_id === campaign.id).length === 1);
    check('plan holds approved material snapshot', plan.creative_id === approved.id && plan.creative_snapshot.version === approved.version && JSON.stringify(plan.creative_snapshot.product_snapshot) === JSON.stringify(approved.product_snapshot));
    const planRow = page.getByRole('row').filter({ has: button(planName) });
    await planRow.waitFor();
    check('plan list excludes scenario form and adjustment history', await field('场景关联计划').count() === 0 && await page.getByRole('region', { name: '当前计划调整记录' }).count() === 0);
    await button('详情', planRow).click();
    await dialog().getByRole('region', { name: '当前计划调整记录' }).waitFor();
    check('adjustments belong to plan detail', (await dialog().innerText()).includes(planName));
    await button('关闭弹窗', dialog()).click();
    await button('确认启动', planRow).click();
    await dialog().waitFor();
    await saved(() => button('确认模拟启动', dialog()).click(), `/plans/${plan.id}/status`);
    await dialog().waitFor({ state: 'detached' });
    await button('暂停', planRow).waitFor();
    await button('详情', planRow).click();
    await button('模拟场景', dialog()).click();
    await field('场景关联计划').waitFor();
    check('plan detail opens separate scenario view with selected plan', routeParams().get('scenarios') === '1' && await field('场景关联计划').inputValue() === plan.id && await page.getByRole('region', { name: '投放计划列表' }).count() === 0);
    await page.reload();
    await field('场景关联计划').waitFor();
    check('scenario view survives refresh', routeParams().get('scenarios') === '1' && await page.getByRole('navigation', { name: '投放视图' }).getByRole('button', { name: '模拟场景', exact: true }).getAttribute('aria-current') === 'page');
    await saved(() => button('预览场景数据').click(), '/batches/preview');
    await page.getByRole('region', { name: '场景预览结果' }).waitFor();
    check('preview does not create a batch', (await get('/state')).batches.filter(item => item.campaign_id === campaign.id).length === 0);
    const scenarioOptions = await field('预设投放场景').locator('option').evaluateAll(elements => elements.map(element => element.value));
    assert.ok(scenarioOptions.length > 1, 'Expected multiple predefined scenarios');
    const previousScenario = await field('预设投放场景').inputValue();
    await field('预设投放场景').selectOption(scenarioOptions.find(value => value !== previousScenario));
    check('changing scenario invalidates previous preview', await page.getByRole('region', { name: '场景预览结果' }).count() === 0 && await button('确认载入独立批次').count() === 0);
    await saved(() => button('预览场景数据').click(), '/batches/preview');
    await page.getByRole('region', { name: '场景预览结果' }).waitFor();
    await mobileCheck('ads scenarios', '.ads-page .button');
    const batch = await saved(() => button('确认载入独立批次').click(), '/batches');
    await page.waitForURL(url => url.hash.startsWith('#/analytics'));
    const finalState = await get('/state');
    check('explicit scene confirmation saves one separate batch', batch.plan_id === plan.id && finalState.batches.filter(item => item.campaign_id === campaign.id).length === 1);
    check('no remote model calls were used', finalState.model.mode === 'replay' && finalState.creatives.filter(item => item.campaign_id === campaign.id).every(item => item.source === 'replay'));

    await page.goto(base + '/#/ads');
    await page.getByRole('region', { name: '投放计划列表' }).waitFor();
    await mobileCheck('ads plans', '.ads-page .button');
    await page.goto(base + '/#/creative?item=missing-' + suffix);
    await page.getByText('当前活动中没有这份素材，请返回列表选择。', { exact: true }).waitFor();
    check('unknown material ID never opens last item', await workspace().count() === 0);
    await returnToLibrary();
    check('no browser runtime errors', errors.length === 0);
    console.log(JSON.stringify({ passed: checks.length, base, campaign: campaign.id, creative: approved.id, plan: plan.id, batch: batch.id, mutations: mutations.length, errors }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ passed: checks.length, base, route: page.url(), errors }, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
