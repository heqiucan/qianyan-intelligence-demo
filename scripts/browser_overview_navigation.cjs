const { chromium } = require('./playwright_runtime.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const base = process.env.DEMO_TEST_BASE;
  assert.ok(base && new URL(base).hostname === '127.0.0.1');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const out = path.resolve('tmp/overview-navigation');
  fs.mkdirSync(out, { recursive: true });
  const checks = [], errors = [], writes = [];
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log('PASS ' + name); };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const subnav = () => page.getByRole('group', { name: '工作总览子菜单', exact: true });
  try {
    await page.goto(base + '/#/overview');
    await subnav().waitFor();
    check('three original navigation groups remain', JSON.stringify(await page.locator('.workspace-nav-caption').allTextContents()) === JSON.stringify(['工作', '业务运营', '资产与执行']));
    check('only overview has a submenu', await page.locator('.workspace-overview-subnav').count() === 1);
    check('submenu labels match existing sections', JSON.stringify(await subnav().getByRole('button').allTextContents()) === JSON.stringify(['今日工作', '待办与审核', '异常提醒']));
    check('overview no duplicate right tabs', await page.locator('.module-navigation').count() === 0);
    for (const [label, route] of [['待办与审核', 'tasks?view=creative'], ['异常提醒', 'tasks'], ['今日工作', 'overview']]) {
      await subnav().getByRole('button', { name: label, exact: true }).click();
      check(label + ' routes correctly', page.url().endsWith('/#/' + route));
      check(label + ' selected accurately', await subnav().getByRole('button', { name: label, exact: true }).getAttribute('aria-current') === 'page');
      check(label + ' no duplicate right tabs', await page.locator('.module-navigation').count() === 0);
    }
    await subnav().getByRole('button', { name: '异常提醒', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.reload();
    await subnav().waitFor();
    check('keyboard and refresh retain selected page', await subnav().getByRole('button', { name: '异常提醒', exact: true }).getAttribute('aria-current') === 'page');
    await page.goBack();
    await page.waitForURL('**/#/overview');
    check('back restores today selection', await subnav().getByRole('button', { name: '今日工作', exact: true }).getAttribute('aria-current') === 'page');
    for (const [label, count] of [['营销工作台', 6], ['商品与知识', 3], ['直播工作台', 4], ['Agent 中心', 2]]) {
      await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: label, exact: true }).click();
      check(label + ' keeps right-side secondary navigation', await page.locator('.module-navigation button').count() === count);
      check(label + ' no selected overview child', await subnav().locator('[aria-current=page]').count() === 0);
    }
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '工作总览', exact: true }).click();
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: theme === 'light' ? '浅色主题' : '深色主题', exact: true }).click();
      await page.screenshot({ path: path.join(out, `desktop-${theme}.png`), animations: 'disabled' });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '打开主导航', exact: true }).click();
    await subnav().waitFor();
    await page.screenshot({ path: path.join(out, 'mobile-menu.png'), animations: 'disabled' });
    await subnav().getByRole('button', { name: '待办与审核', exact: true }).click();
    check('mobile submenu navigates and closes drawer', page.url().endsWith('/#/tasks?view=creative') && await page.locator('.workspace-sidebar.is-open').count() === 0);
    check('mobile page no overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check('no browser exceptions or writes', errors.length === 0 && writes.length === 0);
  } finally {
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: checks.length, checks, errors, writes }, null, 2));
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
