/* UI contract checks; live mode here is an explicit browser fixture, not Zhipu. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/16620/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = 'http://127.0.0.1:8022';
const out = path.resolve('tmp/zhipu-verification');
fs.mkdirSync(out, {recursive: true});

async function main() {
  const browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const checks = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const check = (name, value) => {assert.ok(value, name); checks.push(name); console.log('PASS ' + name);};
  const button = name => page.getByRole('button', {name, exact: true});
  try {
    await page.goto(base);
    await page.getByRole('navigation', {name: '主导航'}).waitFor();
    check('保留原有八个入口', await page.getByRole('navigation', {name: '主导航'}).getByRole('button').count() === 8);
    await button('演示设置').click();
    check('回放模式说明本机免费配置入口', (await page.locator('dialog').innerText()).includes('configure-zhipu.cmd'));
    await button('关闭弹窗').click();
    const saved = await (await page.request.get(base + '/api/state')).json();
    const fixture = structuredClone(saved);
    fixture.model = {mode: 'zhipu-free', label: '智谱 · GLM-4.7-Flash', model_name: 'glm-4.7-flash', configured: true, live_verified: false, status: '已配置，等待首次调用验证', free_only: true, pricing_checked_on: '2026-11-10'};
    fixture.creatives[0] = {...fixture.creatives[0], source: 'model', model_name: 'glm-4.7-flash', edited_by: '演示运营'};
    await page.route('**/api/state', route => route.fulfill({json: fixture}));
    await page.reload();
    await button('演示设置').click();
    check('已配置不冒充真实验证通过', (await page.locator('dialog').innerText()).includes('等待首次调用验证'));
    check('设置不显示密钥输入框', await page.locator('dialog input').count() === 0);
    await button('关闭弹窗').click();
    await button('营销与创意').click();
    await page.getByLabel('当前工作素材', {exact: true}).selectOption('creative-commute');
    check('模型素材与人工修订来源可见', await page.getByText('当前保存版本来源：智谱生成 · glm-4.7-flash · 人工修订', {exact: true}).count() === 1);
    await page.getByLabel('当前工作素材', {exact: true}).selectOption('creative-capacity');
    check('切换模型后旧回放仍保留回放来源', await page.getByText('当前保存版本来源：演示回放', {exact: true}).count() === 1);
    let release;
    const gate = new Promise(resolve => release = resolve);
    await page.route('**/api/campaigns/campaign-demo/generate', async route => {await gate; await route.fulfill({status: 503, json: {detail: '智谱免费接口当前限流，请稍后手动重试。已有内容已保留，未切换付费模型。'}});});
    await button('生成两组创意').click();
    await page.getByText(/正在等待智谱免费模型生成文案/).waitFor();
    check('真实请求等待时禁用重复生成', await button('生成两组创意').isDisabled());
    release();
    await page.getByRole('alert').filter({hasText: '限流'}).waitFor();
    check('限流可见且恢复重试按钮', await button('生成两组创意').isEnabled());
    check('限流不覆盖编辑区', (await page.getByLabel('广告正文', {exact: true}).inputValue()) === fixture.creatives.find(c => c.id === 'creative-capacity').body);
    await page.setViewportSize({width: 390, height: 844});
    await page.emulateMedia({reducedMotion: 'reduce'});
    check('模型来源标签在窄屏无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check('减少动画设置仍生效', await page.locator('.button').first().evaluate(el => getComputedStyle(el).transitionDuration.split(',').every(x => parseFloat(x) < .01)));
    await page.screenshot({path: path.join(out, 'model-fixture-mobile.png'), fullPage: true});
    await page.unroute('**/api/state');
    check('浏览器模拟未改业务数据', JSON.stringify(await (await page.request.get(base + '/api/state')).json()) === JSON.stringify(saved));
    check('无浏览器脚本错误', errors.length === 0);
    fs.writeFileSync(path.join(out, 'ui-result.json'), JSON.stringify({provider: 'browser fixture only; no real key', passed: checks.length, checks, errors}, null, 2));
  } finally {await browser.close();}
}
main().catch(e => {console.error(e); process.exitCode = 1;});
