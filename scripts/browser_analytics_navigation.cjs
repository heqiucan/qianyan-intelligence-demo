/* Sticky analytics navigation acceptance against an isolated replay service. */
const { chromium } = require('./playwright_runtime.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const base = process.env.DEMO_TEST_BASE;
  assert.ok(base && new URL(base).hostname === '127.0.0.1' && new URL(base).port !== '8001');
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  const out = path.resolve('tmp/analytics-navigation-acceptance');
  fs.mkdirSync(out, { recursive: true });
  const checks = [], errors = [], mutations = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(request.url());
  });
  const check = (name, condition) => { assert.ok(condition, name); checks.push(name); console.log('PASS ' + name); };
  const geometry = () => page.locator('.analytics-toolbar').evaluate(toolbar => {
    const rect = toolbar.getBoundingClientRect();
    const header = document.querySelector('.topbar').getBoundingClientRect();
    const style = getComputedStyle(toolbar);
    return { top: rect.top, bottom: rect.bottom, headerBottom: header.bottom,
      background: style.backgroundColor, position: style.position,
      overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  try {
    const state = await (await page.request.get(base + '/api/state')).json();
    assert.equal(state.model.mode, 'replay');
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        const label = `${width}-${theme}`;
        await page.goto(base + '/#/analytics');
        await page.getByRole('tab', { name: '概览图表', exact: true }).waitFor();
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        // A wheel event finishes the shell's initial scroll restoration before measuring sticky position.
        await page.mouse.move(width - 40, 700);
        await page.mouse.wheel(0, 40);
        // Scroll beyond the toolbar's normal flow position without hitting its parent's end.
        await page.locator('.analytics-toolbar').evaluate(element => {
          window.scrollTo(0, element.getBoundingClientRect().top + scrollY + 80);
        });
        await page.waitForFunction(() => {
          const toolbar = document.querySelector('.analytics-toolbar').getBoundingClientRect();
          return Math.abs(toolbar.top - document.querySelector('.topbar').getBoundingClientRect().bottom) <= 1;
        });
        const box = await geometry();
        check(label + ' toolbar below header', box.position === 'sticky' && Math.abs(box.top - box.headerBottom) <= 1);
        check(label + ' opaque themed background', box.background === (theme === 'light' ? 'rgb(247, 248, 252)' : 'rgb(17, 16, 21)'));
        check(label + ' no horizontal overflow', !box.overflow);
        check(label + ' controls unobstructed', await page.locator('.analytics-tabs button').evaluateAll(buttons => buttons.every(button => {
          const rect = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        })));
        await page.screenshot({ path: path.join(out, label + '.png') });
        for (const [name, section] of [['计划明细', 'plans'], ['订单', 'orders'], ['消耗', 'spend'], ['概览图表', 'overview']]) {
          const tab = page.getByRole('tab', { name, exact: true });
          await tab.click();
          await page.waitForFunction(id => document.querySelector('#analytics-' + id)?.hidden === false, section);
          check(label + ' selects ' + section, await tab.getAttribute('aria-selected') === 'true');
        }
        const first = page.getByRole('tab', { name: '概览图表', exact: true });
        await first.focus();
        await first.press('End');
        check(label + ' keyboard End', await page.getByRole('tab', { name: '消耗', exact: true }).getAttribute('aria-selected') === 'true');
        await page.getByRole('tab', { name: '消耗', exact: true }).press('Home');
        check(label + ' keyboard Home', await first.getAttribute('aria-selected') === 'true');
        const downloadEvent = page.waitForEvent('download');
        await page.getByRole('button', { name: '导出当前范围 CSV', exact: true }).click();
        const download = await downloadEvent;
        check(label + ' CSV download', download.suggestedFilename().endsWith('.csv') && !(await download.failure()));
      }
    }
    await page.emulateMedia({ media: 'print' });
    check('print disables sticky positioning', (await geometry()).position === 'static');
    check('no business mutations or model calls', mutations.length === 0);
    check('no uncaught browser errors', errors.length === 0);
  } catch (error) {
    await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true });
    throw error;
  } finally {
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: checks.length, checks, errors, mutations }, null, 2));
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
