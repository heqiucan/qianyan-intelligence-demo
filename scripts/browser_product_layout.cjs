const { chromium } = require('./playwright_runtime.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const base = process.env.DEMO_TEST_BASE;
  assert.ok(base && new URL(base).hostname === '127.0.0.1' && !['8001','8010','8011'].includes(new URL(base).port));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const out = path.resolve('tmp/product-layout'); fs.mkdirSync(out, { recursive: true });
  const checks = [], errors = [];
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log('PASS ' + name); };
  page.on('pageerror', e => errors.push(e.message));
  try {
    const initial = await (await page.request.get(base + '/api/state')).json();
    assert.equal(initial.model.mode, 'replay');
    await page.goto(base + '/#/product');
    await page.getByLabel('商品名称', { exact: true }).waitFor();
    await page.getByLabel('商品名称', { exact: true }).fill(initial.product.name + ' 修订');
    await page.getByRole('navigation', { name: '商品资料视图' }).getByRole('button', { name: '事实依据' }).click();
    await page.getByLabel('卖点依据 / 资料来源').fill('来自隔离验收资料，不是正式业务数据');
    await page.getByRole('button', { name: '添加依据', exact: true }).click();
    await page.getByLabel('依据 1 完整主张原文', { exact: true }).fill('工作日下单后48小时发货');
    await page.getByLabel('依据 1 来源', { exact: true }).fill('隔离测试物流说明');
    await page.getByLabel('我已核对原文、来源和适用条件', { exact: true }).check();
    await page.getByRole('navigation', { name: '商品资料视图' }).getByRole('button', { name: '基本资料' }).click();
    check('tab switch retains edited fields', await page.getByLabel('商品名称', { exact: true }).inputValue() === initial.product.name + ' 修订');
    page.once('dialog', d => d.dismiss());
    await page.getByRole('button', { name: '返回商品目录', exact: true }).click();
    check('dirty exit cancellation keeps editor', await page.getByLabel('商品名称', { exact: true }).isVisible());
    await page.getByRole('button', { name: '核对并保存商品资料', exact: true }).click();
    await page.getByRole('button', { name: '确认保存商品资料', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.reload(); await page.getByLabel('商品名称', { exact: true }).waitFor();
    const after = await (await page.request.get(base + '/api/state')).json();
    check('versioned save preserves original image', after.product.version === initial.product.version + 1 && after.product.image_url === initial.product.image_url);
    check('hidden evidence saves correctly', after.product.claim_evidence[0].confirmed && after.product.evidence.includes('隔离验收'));
    await page.goto(base + '/#/creative');
    await page.locator('.studio-library-list .creative-card').first().waitFor();
    check('compact materials use side-by-side image and content', await page.locator('.studio-library-list .creative-card').first().evaluate(card => {
      const image = card.querySelector('.creative-preview').getBoundingClientRect();
      const text = card.querySelector('.creative-content').getBoundingClientRect();
      return text.left >= image.right && Math.abs(text.top - image.top) < 2;
    }));
    await page.getByRole('button', { name: '卡片视图', exact: true }).click();
    check('card display remains available', await page.locator('.studio-library-grid').isVisible());
    await page.goto(base + '/#/product');
    await page.getByLabel('商品名称', { exact: true }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        for (const [name, slug] of [['基本资料','basic'],['图片与视频','media'],['事实依据','evidence']]) {
          await page.getByRole('navigation', { name: '商品资料视图' }).getByRole('button', { name }).click();
          check(`${width}-${theme}-${slug} no overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          await page.screenshot({ path: path.join(out, `${width}-${theme}-${slug}.png`) });
        }
      }
    }
    check('no browser errors', errors.length === 0);
  } finally { fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: checks.length, checks, errors }, null, 2)); await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
