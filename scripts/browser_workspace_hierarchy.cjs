const { chromium } = require('./playwright_runtime.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const base = process.env.DEMO_TEST_BASE;
  assert.ok(base && new URL(base).hostname === '127.0.0.1' && new URL(base).port !== '8001');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const out = path.resolve('tmp/hierarchy-acceptance');
  fs.mkdirSync(out, { recursive: true });
  const errors = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (name, value = true) => { assert.ok(value, name); checks.push(name); console.log('PASS ' + name); };
  const goto = async route => { await page.goto(base + '/#/' + route); await page.getByRole('heading', { level: 1 }).waitFor(); };
  const secondary = name => page.locator('.module-navigation').getByRole('button', { name, exact: true });
  try {
    let state = await (await page.request.get(base + '/api/state')).json();
    assert.equal(state.model.mode, 'replay');
    check('new product is the purple jacket', state.product.name === '青禾紫色羽绒服' && state.product.color === '紫色');
    const catalog = await (await page.request.get(base + '/api/live/catalog')).json();
    const created = await page.request.post(base + '/api/live/sessions', { data: {
      campaign_id: state.campaigns[0].id, title: '紫色羽绒服场次验收', host: '测试运营', goal: '验证分级导航',
      scheduled_start: new Date().toISOString(), scheduled_end: new Date(Date.now() + 3600000).toISOString(),
      items: [{ product_id: catalog[0].id, sku_id: catalog[0].skus[0].id }],
    } });
    assert.ok(created.ok(), await created.text());
    state = await (await page.request.get(base + '/api/state')).json();
    await goto('product?tab=catalog');
    await page.getByRole('heading', { name: state.product.name, exact: true }).waitFor();
    const image = page.getByAltText(state.product.name, { exact: true });
    check('jacket bitmap is loaded', await image.evaluate(img => img.complete && img.naturalWidth >= 600));
    await page.screenshot({ path: path.join(out, 'product-desktop.png') });
    await page.getByRole('button', { name: '查看与编辑商品', exact: true }).click();
    await page.getByLabel('商品名称', { exact: true }).waitFor();
    check('product detail has return path', await page.getByRole('button', { name: '返回商品目录', exact: true }).isVisible());
    await secondary('品牌资料').click();
    check('brand profile uses shared product facts', await page.locator('.workspace-facts').innerText().then(text => text.includes(state.product.name)));

    await goto('creative?view=campaigns');
    await page.locator('.workspace-campaign-list button').first().click();
    await page.getByRole('button', { name: '返回活动列表', exact: true }).waitFor();
    check('campaign detail address is persistent', page.url().includes('campaign='));
    await page.reload(); await page.getByRole('button', { name: '进入内容创意', exact: true }).waitFor();
    check('campaign details survive refresh');
    await page.getByRole('button', { name: '进入内容创意', exact: true }).click();
    check('campaign context retained', await secondary('内容创意').getAttribute('aria-current') === 'page');

    await goto('live?pane=session');
    check('sessions page does not mount live control', await page.locator('.live-console').count() === 0);
    const session = state.live_sessions.find(s => s.campaign_id === state.campaigns[0].id);
    assert.ok(session);
    await page.getByRole('button', { name: '查看场次', exact: true }).first().click();
    await page.getByRole('button', { name: '进入现场控制', exact: true }).waitFor();
    check('session detail retains explicit selection', page.url().includes('live='));
    await page.getByRole('button', { name: '进入现场控制', exact: true }).click();
    await page.locator('.live-console').waitFor();
    check('live control stays under live module', await secondary('现场控制').getAttribute('aria-current') === 'page');
    await secondary('直播素材').click();
    check('materials retain session', page.url().includes('live='));
    check('materials hide unrelated preview', !await page.locator('.live-stage-column').isVisible());
    await secondary('场次复盘').click();
    check('live results belong to live', await page.getByRole('heading', { level: 1 }).innerText() === '直播工作台');
    await goto('live?pane=control');
    await page.getByRole('heading', { name: '选择直播场次', exact: true }).waitFor();
    check('no implicit last-session control', await page.locator('.live-console').count() === 0);

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 });
      for (const theme of ['light', 'dark']) {
        for (const [route, name] of [['overview','home'],['tasks?view=creative','review'],['creative?view=campaigns','campaigns'],['agent?tab=demand','demand'],['overview?tab=assistant','assistant'],['analytics?view=live','live-results'],['live?pane=session','sessions'],['product?tab=catalog','catalog'],['agent','agent'],['geo','geo']]) {
          await goto(route);
          await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
          check(`${width}-${theme}-${name} no overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          if (['campaigns','catalog','sessions','geo'].includes(name)) await page.screenshot({ path: path.join(out, `${name}-${width}-${theme}.png`) });
        }
      }
    }
    check('no uncaught errors', errors.length === 0);
  } catch (error) { await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); throw error; }
  finally { fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: checks.length, checks, errors }, null, 2)); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
