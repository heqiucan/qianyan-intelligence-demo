/* Run only against an isolated replay service: DEMO_TEST_BASE=http://127.0.0.1:8051. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('./playwright_runtime.cjs');

async function main() {
  const configuredBase = process.env.DEMO_TEST_BASE;
  assert.ok(configuredBase, 'DEMO_TEST_BASE must explicitly identify the isolated replay service');
  const url = new URL(configuredBase);
  assert.ok(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && url.port !== '8001',
    'Only an explicit 127.0.0.1 HTTP test port other than 8001 is allowed');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Use a server origin');
  const base = url.origin;
  const out = path.resolve(__dirname, '../tmp/feedback-workspace-acceptance');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const checks = [], skipped = [], errors = [], networkErrors = [], dialogs = [], blockedMutations = [];
  let reportId, insightId, taskId, printLayout, printArtifact;
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(base + '/api/') && response.status() >= 400) {
      networkErrors.push({ url: response.url(), status: response.status() });
    }
  });
  page.on('dialog', async dialog => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    await dialog.dismiss();
  });
  const check = (label, value = true) => {
    assert.ok(value, label);
    checks.push(label);
    console.log('PASS ' + label);
  };
  const button = (name, root = page) => root.getByRole('button', { name, exact: true });
  const field = (name, root = page) => root.getByLabel(name, { exact: true });
  const readState = async () => {
    const response = await page.request.get(base + '/api/state', { timeout: 20000, maxRedirects: 0 });
    assert.equal(response.status(), 200, await response.text());
    const state = await response.json();
    assert.equal(state.model.mode, 'replay', 'All business actions must use replay mode');
    return state;
  };
  const settle = async () => {
    await page.locator('.busy-indicator').waitFor({ state: 'hidden' });
  };
  const postFromUi = async (control, endpoint) => {
    const [response] = await Promise.all([
      page.waitForResponse(item => new URL(item.url()).pathname === '/api' + endpoint && item.request().method() === 'POST'),
      control.click(),
    ]);
    assert.equal(response.status(), 200, await response.text());
    const result = await response.json();
    await settle();
    return result;
  };
  const reportList = async () => {
    await button('创建报告').waitFor();
    assert.equal(await page.locator('.feedback-report-form').count(), 0, 'List must not contain a report form');
    assert.equal(await page.locator('.feedback-report-paper').count(), 0, 'List must not contain report details');
  };
  const reportParams = () => new URLSearchParams(new URL(page.url()).hash.split('?')[1] || '');
  const snapshot = async name => page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });

  try {
    const initial = await readState();
    const campaign = initial.campaigns.find(item => item.id === 'campaign-demo') || initial.campaigns[0];
    assert.ok(campaign, 'A seeded campaign is required');
    check('isolated service is replay before any business mutation');
    await page.route('**/api/**', async route => {
      const request = route.request();
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
      const endpoint = new URL(request.url()).pathname;
      if (request.method() === 'POST' && (/^\/api\/(reports|insights|tasks\/scan)$/.test(endpoint)
        || /^\/api\/tasks\/[^/]+\/status$/.test(endpoint))) return route.continue();
      blockedMutations.push({ method: request.method(), endpoint });
      return route.abort('blockedbyclient');
    });
    await page.addInitScript(({ campaignId, savedReport }) => {
      if (sessionStorage.getItem('feedback-workspace-initialized')) return;
      sessionStorage.setItem('feedback-workspace-initialized', '1');
      localStorage.setItem('campaign', campaignId);
      localStorage.setItem('v2-dataset', 'history');
      for (const key of ['v2-batch', 'v2-plan', 'v2-from', 'v2-to']) localStorage.setItem(key, '');
      localStorage.setItem('report-' + campaignId, savedReport);
    }, { campaignId: campaign.id, savedReport: initial.reports?.find(item => item.campaign_id === campaign.id)?.id || 'legacy-selected-report' });

    await page.goto(base + '/#/analytics?view=reports');
    await reportList();
    check('reports default to a list even with a legacy selected report');
    await snapshot('01-report-list');
    await button('创建报告').click();
    await field('报告标题').waitFor();
    assert.equal(reportParams().get('report'), 'new');
    assert.equal(await page.locator('.feedback-report-paper').count(), 0);
    const title = '反馈工作区验收 ' + Date.now();
    const conclusion = '仅核验模拟数据流程，不能据此判断真实经营效果。';
    const nextAction = '补充同口径数据后复查。';
    await field('报告标题').fill(title);
    await field('运营结论（人工判断）').fill(conclusion);
    await field('下一步行动').fill(nextAction);
    check('report creation is an independent form');

    let dialogCount = dialogs.length;
    await button('返回报告列表').click();
    assert.equal(dialogs.length, dialogCount + 1, 'Returning from a dirty form must confirm');
    assert.equal(dialogs.at(-1).type, 'confirm');
    assert.match(dialogs.at(-1).message, /未保存/);
    assert.equal(reportParams().get('report'), 'new');
    assert.equal(await field('报告标题').inputValue(), title);
    assert.equal(await field('运营结论（人工判断）').inputValue(), conclusion);
    check('canceling report leave confirmation preserves route and text');
    dialogCount = dialogs.length;
    const analyticsTabs = page.getByRole('navigation', { name: '效果与复盘视图', exact: true });
    await button('优化复盘', analyticsTabs).click();
    assert.equal(dialogs.length, dialogCount + 1, 'Parent navigation must protect the dirty report');
    assert.equal(reportParams().get('report'), 'new');
    assert.equal(await field('下一步行动').inputValue(), nextAction);
    check('parent view navigation also respects report leave protection');
    await snapshot('02-report-form');

    await readState();
    dialogCount = dialogs.length;
    const report = await postFromUi(button('保存报告'), '/reports');
    reportId = report.id;
    const paper = page.getByRole('article', { name: '活动报告预览', exact: true });
    await paper.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.equal(reportParams().get('report'), reportId);
    assert.equal(dialogs.length, dialogCount, 'Successful saving must clear dirty protection before navigation');
    assert.equal(report.campaign_id, campaign.id);
    assert.equal(report.snapshot.analytics.dataset, 'history');
    assert.equal(report.conclusion, conclusion);
    assert.equal(report.next_action, nextAction);
    assert.equal(report.simulation, true);
    assert.equal(await page.locator('.feedback-report-form').count(), 0);
    assert.ok((await paper.innerText()).includes('模拟投放与支付'));
    check('saving creates a report snapshot and opens its independent details');
    const persisted = (await readState()).reports.find(item => item.id === reportId);
    assert.deepEqual(persisted, report);
    check('saved report and manual conclusions persist on the server');
    await page.reload();
    await paper.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.equal(reportParams().get('report'), reportId);
    check('report details survive refresh using the report query parameter');
    assert.equal(await paper.locator('.feedback-report-detail').getAttribute('open'), null);
    await snapshot('03-report-detail');

    await page.evaluate(() => {
      window.__feedbackPrintCalled = false;
      window.print = () => {
        window.__feedbackPrintCalled = document.body.dataset.printReport === 'true';
        window.dispatchEvent(new Event('beforeprint'));
        window.dispatchEvent(new Event('afterprint'));
      };
    });
    await button('打印 / 另存 PDF').click();
    assert.ok(await page.evaluate(() => window.__feedbackPrintCalled));
    assert.equal(await page.evaluate(() => document.body.dataset.printReport), undefined);
    check('print command uses report print mode and clears it after printing');

    await page.emulateMedia({ media: 'print' });
    try {
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo(0, 0);
        window.dispatchEvent(new Event('beforeprint'));
      });
      printLayout = await page.evaluate(() => {
        const selectors = ['.workspace-sidebar', '.topbar', '.workspace-tabs', '.workspace-scope', '.page-heading', '.feedback-no-print'];
        const hidden = selectors.map(selector => {
          const elements = Array.from(document.querySelectorAll(selector));
          return {
            selector,
            count: elements.length,
            removedFromLayout: elements.every(element => getComputedStyle(element).display === 'none' && element.getClientRects().length === 0),
          };
        });
        const shell = document.querySelector('.main-shell');
        const page = document.querySelector('main.page');
        const paper = document.querySelector('.feedback-report-paper');
        const heading = paper.querySelector('h2');
        const rect = paper.getBoundingClientRect();
        const pageStyle = getComputedStyle(page);
        return {
          hidden,
          printMode: document.body.dataset.printReport,
          shellMarginLeft: parseFloat(getComputedStyle(shell).marginLeft),
          pagePadding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(key => parseFloat(pageStyle[key])),
          paper: { left: rect.left + scrollX, top: rect.top + scrollY, width: rect.width, height: rect.height },
          viewportWidth: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          headingVisibility: getComputedStyle(heading).visibility,
          headingColor: getComputedStyle(heading).color,
          sectionCount: paper.querySelectorAll(':scope > section').length,
        };
      });
      assert.equal(printLayout.printMode, 'true');
      for (const item of printLayout.hidden) {
        assert.ok(item.count > 0, 'Expected print selector to exist: ' + item.selector);
        assert.ok(item.removedFromLayout, 'Print chrome must not consume layout space: ' + item.selector);
      }
      assert.equal(printLayout.shellMarginLeft, 0, 'Print shell must not retain the sidebar margin');
      assert.deepEqual(printLayout.pagePadding, [0, 0, 0, 0], 'Parent page padding must be removed');
      assert.ok(Math.abs(printLayout.paper.left) < 2 && Math.abs(printLayout.paper.top) < 2, 'Report must start at the document origin');
      assert.ok(Math.abs(printLayout.paper.width - printLayout.viewportWidth) < 2, 'Print report must use the available width');
      assert.ok(printLayout.paper.height > 300 && printLayout.documentWidth <= printLayout.viewportWidth + 1);
      assert.equal(printLayout.headingVisibility, 'visible');
      assert.equal(printLayout.headingColor, 'rgb(24, 24, 24)');
      assert.equal(printLayout.sectionCount, 4);
      check('real print-media layout removes navigation, filters, page padding and sidebar offset');
      await snapshot('06-report-print-media');

      const pdfPath = path.join(out, 'report-print.pdf');
      const pdf = await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
      assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
      assert.ok(pdf.length > 10000, 'Printed report must contain a nontrivial PDF document');
      printArtifact = { pdf: pdfPath, bytes: pdf.length };
      check('page.pdf writes the report locally using its actual print styles');
      try {
        const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
        const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
        assert.ok(pageCount >= 1, 'PDF must have at least one page');
        const imagePrefix = path.join(out, 'report-print-page-1');
        execFileSync('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-scale-to', '1600', '-png', pdfPath, imagePrefix], {
          windowsHide: true, timeout: 30000, stdio: ['ignore', 'ignore', 'pipe'],
        });
        const firstPage = imagePrefix + '.png';
        assert.ok(fs.statSync(firstPage).size > 10000, 'First PDF page must render to a nonempty image');
        Object.assign(printArtifact, { pages: pageCount, firstPage });
        check('existing Poppler tools read the generated PDF and render its first page');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        skipped.push('PDF page rendering: pdfinfo or pdftoppm is not installed; PDF output retained');
      }
    } finally {
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await page.emulateMedia({ media: 'screen' });
    }
    assert.equal(await page.evaluate(() => document.body.dataset.printReport), undefined);

    await button('返回报告列表').click();
    await reportList();
    assert.equal(reportParams().get('report'), null);
    await page.reload();
    await reportList();
    const row = page.locator('.feedback-report-list tbody tr').filter({ hasText: title });
    await row.waitFor();
    await button('查看详情', row).click();
    await paper.getByRole('heading', { name: title, exact: true }).waitFor();
    check('returning to the list, refreshing and reopening select the same report');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Report must not overflow the mobile page');
    assert.ok(await page.locator('.feedback-report-toolbar .button').first().evaluate(element =>
      getComputedStyle(element).transitionDuration.split(',').every(value => parseFloat(value) === 0)));
    await snapshot('04-report-mobile');
    check('report details fit mobile width and honor reduced motion');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await button('优化复盘', analyticsTabs).click();
    const optimizeTabs = page.getByRole('navigation', { name: '优化复盘视图', exact: true });
    await optimizeTabs.waitFor();
    await button('新建复盘', optimizeTabs).click();
    await button('生成本轮复盘').waitFor();
    assert.equal(await field('历史复盘记录').count(), 0);
    await readState();
    const insight = await postFromUi(button('生成本轮复盘'), '/insights');
    insightId = insight.id;
    assert.equal(insight.source, 'replay');
    assert.equal(insight.campaign_id, campaign.id);
    assert.ok(insight.recommendation);
    assert.ok(insight.facts.length);
    await page.waitForFunction(id => Array.from(document.querySelectorAll('select')).some(element => element.value === id), insightId);
    assert.equal(await field('历史复盘记录').inputValue(), insightId);
    assert.equal(await optimizeTabs.getByRole('button', { name: /^历史结果/ }).getAttribute('aria-pressed'), 'true');
    const evidence = page.locator('.feedback-insight > .feedback-history');
    assert.equal(await evidence.getAttribute('open'), null);
    await evidence.locator('summary').click();
    await evidence.getByRole('heading', { name: '已知事实', exact: true }).waitFor();
    assert.ok((await page.locator('.feedback-insight').innerText()).includes('演示回放'));
    check('replay analysis succeeds and selects history with evidence initially collapsed');
    await snapshot('05-optimize-history');
    await optimizeTabs.getByRole('button', { name: /^观察任务/ }).click();
    await page.getByRole('region', { name: '观察任务', exact: true }).waitFor();
    assert.equal(await field('历史复盘记录').count(), 0);
    await optimizeTabs.getByRole('button', { name: /^历史结果/ }).click();
    assert.equal(await field('历史复盘记录').inputValue(), insightId);
    check('new review, historical results and observations remain separate views');

    const taskFixtureState = await readState();
    if (!taskFixtureState.creatives.some(item => item.campaign_id === campaign.id && item.status === 'draft')) {
      const fixtureResponse = await page.request.post(base + '/api/campaigns/' + campaign.id + '/generate', { data: { tone: '简洁', angle: '规格', recipe: 'spec' } });
      assert.equal(fixtureResponse.status(), 200, await fixtureResponse.text());
    }
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '待办与审核', exact: true }).click();
    await button('检查当前活动').waitFor();
    await readState();
    const scanned = await postFromUi(button('检查当前活动'), '/tasks/scan');
    const task = scanned.find(item => item.campaign_id === campaign.id && !['resolved', 'ignored'].includes(item.status));
    assert.ok(task, 'Replay draft fixture must create an actionable task');
    if (task) {
      taskId = task.id;
      const card = page.locator('.feedback-task').filter({ has: page.getByRole('heading', { name: task.title, exact: true }) }).first();
      await button('查看与处理', card).click();
      const dialog = page.getByRole('dialog', { name: '异常与待办详情', exact: true });
      await dialog.waitFor();
      await field('处理状态', dialog).selectOption('resolved');
      await field('处理备注 / 复查理由', dialog).fill('');
      await button('保存处理记录', dialog).click();
      await dialog.getByRole('alert').filter({ hasText: '请填写处理理由' }).waitFor();
      const note = '浏览器验收：核对模拟待办，保留人工处理依据。';
      await field('处理备注 / 复查理由', dialog).fill(note);
      // A generated task title can be shared by several records; use the opened dialog's actual record ID.
      const detailText = await dialog.locator('.feedback-history').first().textContent();
      const openedTask = scanned.find(item => detailText.includes(item.id));
      assert.ok(openedTask, 'Task detail must expose its record ID');
      taskId = openedTask.id;
      await postFromUi(button('保存处理记录', dialog), '/tasks/' + taskId + '/status');
      await dialog.waitFor({ state: 'detached' });
      const updated = (await readState()).tasks.find(item => item.id === taskId);
      assert.equal(updated.status, 'resolved');
      assert.equal(updated.note, note);
      assert.equal(updated.history.at(-1).to, 'resolved');
      await button('已处理', page.getByRole('group', { name: '待办状态筛选', exact: true })).click();
      await page.locator('.feedback-task').filter({ hasText: note }).waitFor();
      check('sample task requires a reason, saves status and preserves processing history');
    } else {
      skipped.push('task status mutation: no active task samples after scan');
      console.log('SKIP ' + skipped.at(-1));
    }

    await readState();
    assert.deepEqual(errors, []);
    assert.deepEqual(networkErrors, []);
    assert.deepEqual(blockedMutations, []);
    check('no browser errors, failed API responses or unexpected mutations');
    const result = { base, mode: 'replay', checks, skipped, errors, networkErrors, reportId, insightId, taskId, printLayout, printArtifact };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await snapshot('failure').catch(() => {});
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
      base, checks, skipped, errors, networkErrors, blockedMutations, dialogs, reportId, insightId, taskId, printLayout, printArtifact, error: String(error.stack || error),
    }, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
