const { chromium } = require('./playwright_runtime.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const base = process.env.DEMO_TEST_BASE;
  assert.ok(base && new URL(base).hostname === '127.0.0.1' && new URL(base).port !== '8001');
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const out = path.resolve('tmp/geo-acceptance'); fs.mkdirSync(out, { recursive: true });
  const errors = [], writes = [], checks = [];
  page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { if (req.url().includes('/api/') && !['GET', 'HEAD'].includes(req.method())) writes.push(req.url()); });
  const check = (name, ok = true) => { assert.ok(ok, name); checks.push(name); console.log('PASS ' + name); };
  const nav = name => page.getByRole('navigation', { name: 'GEO 功能', exact: true }).getByRole('button', { name, exact: true }).click();
  const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('zheyan-geo-prototype-v1')));
  try {
    await page.goto(base + '/#/geo');
    await page.getByRole('heading', { name: 'GEO 工作台', exact: true }).waitFor();
    check('independent primary navigation', await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: 'GEO 工作台', exact: true }).getAttribute('aria-current') === 'page');
    for (const width of [1440, 390, 360]) {
      await page.setViewportSize({ width, height: 980 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        for (const name of ['项目总览', '品牌知识', '问题监测', '诊断与 Agent', '内容发布', '效果报告']) {
          await nav(name);
          check(`${width}-${theme}-${name} no overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          if (name === '项目总览') await page.screenshot({ path: path.join(out, `overview-${width}-${theme}.png`) });
        }
      }
    }
    await nav('问题监测');
    await page.locator('.geo-sticky').evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + scrollY + 100));
    await page.waitForFunction(() => Math.abs(document.querySelector('.geo-sticky').getBoundingClientRect().top - document.querySelector('.topbar').getBoundingClientRect().bottom) < 2);
    check('GEO navigation stays below actual header');
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.getByRole('button', { name: '添加问题', exact: true }).click();
    await page.getByLabel('问题内容', { exact: true }).fill('直播工具怎样核验内容来源？');
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '模拟采样', exact: true }).click();
    check('question and batch saved', (await store()).projects[0].questions.length === 5 && (await store()).projects[0].batches.length === 3);
    await page.getByLabel('搜索目标问题', { exact: true }).fill('怎样核验');
    check('question search filters results', await page.locator('.geo-table tbody tr').count() === 3);
    await page.getByLabel('搜索目标问题', { exact: true }).fill('');
    await page.getByLabel('回答状态', { exact: true }).selectOption('疑似误述');
    await page.getByRole('button', { name: /查看回答证据/ }).first().click();
    check('evidence has explicit sample provenance', await page.getByRole('dialog').getByText('固定样例 · 非平台实际回答', { exact: true }).isVisible());
    const evidenceUrl = page.url(); await page.reload();
    await page.getByRole('dialog').waitFor(); check('evidence deep link survives refresh', page.url() === evidenceUrl);
    await page.getByRole('button', { name: '进入诊断队列', exact: true }).click();
    await page.getByRole('button', { name: '创建优化任务', exact: true }).first().click();
    await page.getByRole('button', { name: '暂停任务', exact: true }).click();
    check('task pauses', (await store()).projects[0].tasks[0].status === 'paused');
    await page.getByRole('button', { name: '继续任务', exact: true }).click();
    await page.getByRole('button', { name: '审核内容', exact: true }).waitFor();
    await page.getByRole('button', { name: '审核内容', exact: true }).click();
    const editor = page.getByLabel('内容草稿', { exact: true });
    await editor.fill((await editor.inputValue()) + '\n核验测试内容。');
    check('unsaved draft cannot be approved', await page.getByRole('button', { name: '审核通过', exact: true }).isDisabled());
    page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    check('cancel discard retains draft', await editor.isVisible());
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.getByRole('button', { name: '审核通过', exact: true }).click();
    await page.getByLabel('已发布内容地址', { exact: true }).fill('javascript:alert(1)');
    await page.getByRole('button', { name: '登记发布地址', exact: true }).click();
    check('invalid publication scheme rejected', await page.getByRole('alert').getByText('请输入完整的 http 或 https 发布地址。').isVisible());
    await page.getByLabel('已发布内容地址', { exact: true }).fill('https://example.com/geo-test');
    await page.getByRole('button', { name: '登记发布地址', exact: true }).click();
    check('publication is a local record only', (await store()).projects[0].drafts[0].status === 'recorded');
    await page.screenshot({ path: path.join(out, 'content-review.png') });
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await nav('效果报告');
    const before = (await store()).projects[0].batches.at(-1).observations.map(({ id, ...row }) => row);
    await page.getByRole('button', { name: '模拟复测', exact: true }).click();
    const after = (await store()).projects[0].batches.at(-1).observations.map(({ id, ...row }) => row);
    check('publication does not inflate results', JSON.stringify(before) === JSON.stringify(after));
    const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '导出报告', exact: true }).click();
    const download = await downloadEvent; check('report downloads', !(await download.failure()));
    const text = fs.readFileSync(await download.path(), 'utf8'); check('report discloses limits', text.includes('样例数据') && text.includes('咨询和成交未接入'));
    await page.reload(); await page.getByRole('heading', { name: '可见性与证据报告', exact: true }).waitFor();
    check('local changes survive refresh', (await store()).projects[0].drafts[0].status === 'recorded');
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByLabel('项目名称', { exact: true }).fill('空项目验收'); await page.getByLabel('品牌名称', { exact: true }).fill('测试品牌');
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('heading', { name: '测试品牌', exact: true }).waitFor();
    check('new project is empty', await page.getByRole('button', { name: '模拟采样', exact: true }).isDisabled());
    await nav('品牌知识'); await page.getByRole('button', { name: '添加资料', exact: true }).click();
    await page.getByLabel('资料标题', { exact: true }).fill('产品事实'); await page.getByLabel('事实内容与来源', { exact: true }).fill('仅提供已审核资料中的信息。');
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '确认事实', exact: true }).click();
    check('source review saved', (await store()).projects[1].sources[0].approved);
    await page.getByLabel('GEO 项目', { exact: true }).selectOption('sample-live');
    check('projects remain isolated', (await store()).projects[0].sources.length === 3);
    check('no backend writes', writes.length === 0); check('no browser exceptions', errors.length === 0);
  } catch (error) { await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); throw error; }
  finally { fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ checks, errors, writes, passed: checks.length }, null, 2)); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
