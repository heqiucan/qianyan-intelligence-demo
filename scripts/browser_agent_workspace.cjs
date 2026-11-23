/* Isolated replay acceptance only. Example (PowerShell):
 * $env:DEMO_TEST_BASE='http://127.0.0.1:8051'; node scripts/browser_agent_workspace.cjs
 * Source writes are confined to this file; runtime artifacts go under tmp/workspace-v4-acceptance.
 */
const { chromium, request } = require('./playwright_runtime.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const rawBase = process.env.DEMO_TEST_BASE;
assert.ok(rawBase && /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(rawBase), 'DEMO_TEST_BASE must be an explicit http://127.0.0.1:PORT origin');
const target = new URL(rawBase);
assert.ok(target.port && Number(target.port) !== 8001, 'Port 8001 and implicit ports are forbidden');
const base = target.origin;
const BUDGET_MS = 180000;
const ACTION_MS = 12000;
const runId = 'agent-workspace-' + Date.now() + '-' + randomUUID().slice(0, 8);
const marker = `[${runId}]`;
const artifactRoot = path.resolve(__dirname, '../tmp/workspace-v4-acceptance');
const out = path.join(artifactRoot, runId);
const checks = [], errors = [], blocked = [], dialogs = [], mutations = [], screenshots = [];
const ownedTasks = new Set(), ownedDrafts = new Set();
let browser, context, page, api, expectedDialog, deadlineTimer;
let stage = 'preflight', lastAssertion = '', startedAt = Date.now(), creationRequests = 0;

function check(label, condition, detail) {
  lastAssertion = label;
  assert.ok(condition, label + (detail ? ': ' + detail : ''));
  checks.push(label);
  console.log(`PASS ${checks.length}: ${label}`);
}
function step(label) { stage = label; console.log('STEP ' + stage); }
function report(error) {
  const result = { runId, base, status: error ? 'failed' : 'passed', assertions: checks.length,
    elapsedMs: Date.now() - startedAt, budgetMs: BUDGET_MS, stage, lastAssertion, taskIds: [...ownedTasks],
    draftIds: [...ownedDrafts], checks, errors, blocked, dialogs, mutations, screenshots,
    ...(error ? { error: error.stack || String(error) } : {}) };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(artifactRoot, 'agent-workspace-result.json'), JSON.stringify(result, null, 2));
  return result;
}
async function json(endpoint) {
  assert.ok(endpoint.startsWith('/api/') && !endpoint.includes('://'));
  const response = await api.get(endpoint, { maxRedirects: 0, timeout: 8000 });
  assert.equal(response.status(), 200, `GET ${endpoint}: ${response.status()}`);
  return response.json();
}
async function replay() {
  const model = await json('/api/model/status');
  assert.equal(model.mode, 'replay', 'Refusing mutations: backend model must remain replay');
  return model;
}
async function task(id) {
  assert.ok(ownedTasks.has(id), 'Only this run\'s task may be inspected or mutated');
  const value = await json('/api/agent/tasks/' + encodeURIComponent(id));
  assert.equal(value.source, 'replay');
  assert.equal(value.total_model_calls, 0);
  assert.ok(value.goal.startsWith(marker));
  if (value.draft) ownedDrafts.add(value.draft.id);
  return value;
}
const workspace = () => page.locator('#agent-workspace');
const button = name => workspace().getByRole('button', { name, exact: true });
const editor = () => workspace().getByRole('region', { name: '知识草稿编辑器', exact: true });
const field = name => workspace().getByLabel(name, { exact: true });
const search = () => workspace().getByRole('searchbox', { name: '搜索任务', exact: true });
const tab = name => workspace().getByRole('tab', { name: new RegExp('^' + name) });
async function routeIs(owner, id) {
  await page.waitForFunction(({ owner, id }) => {
    const [route, query = ''] = location.hash.slice(2).split('?');
    return route === owner && (new URLSearchParams(query).get('agent') || '') === id;
  }, { owner, id }, { timeout: ACTION_MS });
}
async function listReady() { await workspace().getByLabel('任务状态', { exact: true }).waitFor(); }
async function status(label) { await workspace().locator('.agent-tags .badge').filter({ hasText: label }).waitFor({ timeout: 35000 }); }
async function snap(name) {
  const filename = path.join(out, name + '.png');
  await page.screenshot({ path: filename, fullPage: false, timeout: 8000 });
  screenshots.push(filename);
}
async function mutation(endpoint, method, click, expectedStatus = 200) {
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === method);
  const [response] = await Promise.all([responsePromise, click()]);
  const body = await response.json();
  check(`${method} ${endpoint} accepted`, response.status() === expectedStatus, JSON.stringify(body));
  return body;
}
async function leave(decision, click, label) {
  assert.ok(!expectedDialog);
  let timer;
  const handled = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Missing unsaved-input confirmation: ' + label)), ACTION_MS);
    expectedDialog = { decision, resolve, reject };
  });
  try {
    const [dialog] = await Promise.all([handled, click()]);
    check(label, dialog.type === 'confirm' && /未保存|放弃/.test(dialog.message));
  } finally { clearTimeout(timer); expectedDialog = null; }
}
async function overflow(label) {
  check(label, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}
async function guard(route) {
  const req = route.request(), url = new URL(req.url()), method = req.method();
  try {
    assert.equal(url.origin, base, 'Only the isolated test origin is permitted');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const body = req.postDataJSON() || {};
      const taskAction = url.pathname.match(/^\/api\/agent\/tasks\/([^/]+)\/(continue|cancel|complete|reopen)$/);
      const draftAction = url.pathname.match(/^\/api\/knowledge\/drafts\/([^/]+)(\/confirm)?$/);
      if (url.pathname === '/api/agent/tasks' && method === 'POST') {
        assert.equal(creationRequests++, 0, 'At most one task per run');
        assert.ok(body.goal?.startsWith(marker));
        assert.equal(body.scene, 'medical');
        assert.equal(body.source_mode, 'demo');
        assert.equal(body.channel, 'internal');
        assert.ok(!body.campaign_id && !body.live_session_id && !body.space_id);
      } else if (taskAction && method === 'POST') {
        assert.ok(ownedTasks.has(decodeURIComponent(taskAction[1])), 'Foreign task mutation blocked');
      } else if (draftAction && method === (draftAction[2] ? 'POST' : 'PUT')) {
        assert.ok(ownedDrafts.has(decodeURIComponent(draftAction[1])), 'Foreign draft mutation blocked');
      } else throw new Error('Mutation outside Agent acceptance scope');
      await replay();
      mutations.push({ method, path: url.pathname });
    }
    await route.continue();
  } catch (error) {
    blocked.push({ method, path: url.pathname, origin: url.origin, reason: error.message });
    await route.abort('blockedbyclient').catch(() => {});
  }
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  deadlineTimer = setTimeout(() => {
    const error = new Error(`Acceptance exceeded ${BUDGET_MS}ms at ${stage}`);
    report(error); console.error(error.message);
    const exitTimer = setTimeout(() => process.exit(124), 4000);
    Promise.resolve(browser?.close()).finally(() => { clearTimeout(exitTimer); process.exit(124); });
  }, BUDGET_MS);
  try {
    api = await request.newContext({ baseURL: base, timeout: 8000 });
    const health = await json('/api/health');
    check('Isolated API identifies itself as a simulation', health.service === 'zheyan-demo' && health.simulation === true);
    check('API model status is replay', (await replay()).mode === 'replay');
    check('App API state agrees on replay mode', (await json('/api/state')).model.mode === 'replay');
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true, timeout: 15000 });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/*', guard);
    page = await context.newPage();
    page.setDefaultTimeout(ACTION_MS); page.setDefaultNavigationTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => {
      const pending = expectedDialog;
      expectedDialog = null;
      const entry = { type: dialog.type(), message: dialog.message(), decision: pending?.decision || 'unexpected-dismiss' };
      dialogs.push(entry);
      try {
        if (pending?.decision === 'accept') await dialog.accept(); else await dialog.dismiss();
        if (pending) pending.resolve(entry); else errors.push('Unexpected dialog: ' + entry.message);
      } catch (error) { if (pending) pending.reject(error); else errors.push(error.message); }
    });
    await context.addInitScript(() => localStorage.setItem('marketing-agent-task', 'stale-acceptance-selection'));

    step('list and create');
    await page.goto(base + '/#/agent?returnTo=overview');
    await listReady();
    check('No intent opens the list despite stale localStorage selection', await workspace().locator('.agent-list').isVisible());
    check('List does not render create or detail content', await workspace().locator('.agent-composer,.agent-detail').count() === 0);
    await snap('01-list');
    await button('新建任务').click(); await routeIs('agent', 'new');
    check('Create entry is routed to agent=new', await workspace().locator('.agent-composer').isVisible());
    await workspace().getByRole('radio', { name: '医美获客', exact: true }).check();
    const goal = marker + ' 根据机构资料，整理咨询预约的内部 FAQ，说明预约流程、接待时间以及预约和专业评估的区别，缺少的信息列为待核实。';
    await field('希望 Agent 完成的任务').fill(goal);
    check('Creation uses explicitly labelled fictional replay data', await field('使用哪些资料').inputValue() === 'demo' && (await workspace().innerText()).includes('未调用模型'));
    await snap('02-create');
    const created = await mutation('/api/agent/tasks', 'POST', () => button('开始任务').click(), 202);
    ownedTasks.add(created.id);
    await routeIs('agent', created.id); await status('待你审阅');
    let current = await task(created.id);
    check('Task reached review with a real saved replay draft', current.status === 'waiting_review' && current.draft?.source === 'replay');
    check('Task and citations are isolated fictional fixtures', current.source_mode === 'demo' && current.evidence.length > 0 && current.evidence.every(item => item.is_demo));
    check('Task performed no model calls', current.model_calls === 0 && current.total_model_calls === 0);
    check('Detail preserves requested goal and canonical task route', (await workspace().locator('.agent-task-heading h3').innerText()) === goal);
    check('Detail has exactly three tabs and one visible panel', await workspace().getByRole('tab').count() === 3 && await workspace().locator('[role=tabpanel]:visible').count() === 1);
    check('Unconfirmed draft cannot complete the task', await button('标记任务完成').isDisabled());

    step('unsaved editor, follow-up and acknowledgement survive tabs');
    const original = await field('第 1 段内容').inputValue();
    const edited = original + '\n（未保存验收修订）';
    const note = '未提交的补充要求：只整理有依据的预约流程。';
    await field('第 1 段内容').fill(edited); await field('补充要求').fill(note);
    await editor().getByRole('checkbox').check();
    await tab('执行记录').click();
    check('Execution tab displays only the execution panel', await workspace().locator('.agent-trace').isVisible() && !(await editor().isVisible()));
    check('Unsaved editor remains mounted while hidden', await workspace().locator('.kb-draft-editor').count() === 1);
    const timestamps = await workspace().locator('.agent-events li').evaluateAll(items => items.map(item => item.querySelector('time')?.getAttribute('datetime')));
    check('Timeline timestamps match actual backend events in order', JSON.stringify(timestamps) === JSON.stringify(current.events.map(event => event.at)));
    check('Timeline includes retrieval, generation, checks and persistence', ['search_knowledge', 'read_evidence', 'generate_draft', 'check_draft', 'save_draft'].every(action => current.events.some(event => event.action === action)));
    await snap('03-events');
    await tab('引用').click();
    check('Citation tab lists the actual evidence count', await workspace().locator('.agent-source').count() === current.evidence.length);
    await workspace().locator('.agent-source').first().click();
    // The shared native dialog has a visible heading but no aria-labelledby.
    const openDialog = page.locator('dialog[open]');
    await openDialog.waitFor();
    check('Citation opens the saved source text and version', (await openDialog.innerText()).includes(current.evidence[0].text) && (await openDialog.innerText()).includes('版本 ' + current.evidence[0].version));
    await openDialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await tab('结果审阅').click();
    check('Unsaved draft text survives both tab switches and citation modal', await field('第 1 段内容').inputValue() === edited);
    check('Follow-up input survives tab switches', await field('补充要求').inputValue() === note);
    check('Review acknowledgement survives tab switches', await editor().getByRole('checkbox').isChecked());
    check('Unsaved changes still block confirm and completion', await editor().getByRole('button', { name: '人工确认并保存', exact: true }).isDisabled() && await button('标记任务完成').isDisabled());

    step('cancel and accept leaving the task');
    await leave('dismiss', () => button('任务列表').click(), 'Task list navigation requests confirmation');
    await routeIs('agent', created.id);
    check('Cancelling leave preserves editor and follow-up', await field('第 1 段内容').inputValue() === edited && await field('补充要求').inputValue() === note);
    await leave('accept', () => button('任务列表').click(), 'Accepting leave confirms discarded unsaved content');
    await routeIs('agent', ''); await listReady();
    check('Confirmed leave returns to list without a selected task', await workspace().locator('.agent-detail').count() === 0);
    await workspace().locator('.agent-task-row').filter({ hasText: marker }).click(); await routeIs('agent', created.id); await status('待你审阅');
    check('Reopening reads saved content rather than discarded edits', await field('第 1 段内容').inputValue() === original && await field('补充要求').inputValue() === '' && !(await editor().getByRole('checkbox').isChecked()));

    step('App source return also guards unsaved input');
    await field('补充要求').fill(note);
    const sourceReturn = () => page.getByRole('button', { name: '返回来源业务', exact: true }).click();
    await leave('dismiss', sourceReturn, 'App source return requests confirmation');
    await routeIs('agent', created.id);
    check('Cancelling App source return retains follow-up', await field('补充要求').inputValue() === note);
    await leave('accept', sourceReturn, 'App source return accepts explicit discard');
    await routeIs('overview', '');
    check('App returns to the requested source business', await page.locator('#agent-workspace').count() === 0);
    await page.goto(base + '/#/agent?agent=' + encodeURIComponent(created.id) + '&returnTo=overview');
    await status('待你审阅');
    check('Discarded follow-up does not reappear after reopening', await field('补充要求').inputValue() === '');

    step('save revision, confirm and complete');
    const savedText = original + '\n（验收已核对修订）';
    await field('第 1 段内容').fill(savedText);
    const revision = await mutation('/api/knowledge/drafts/' + current.draft.id, 'PUT', () => editor().getByRole('button', { name: '保存修订版本', exact: true }).click());
    await editor().locator('.panel-header .muted').filter({ hasText: '版本 ' + revision.revision }).waitFor();
    await editor().getByRole('checkbox').check();
    const confirmed = await mutation('/api/knowledge/drafts/' + current.draft.id + '/confirm', 'POST', () => editor().getByRole('button', { name: '人工确认并保存', exact: true }).click());
    check('Revision increments and confirmation references the saved revision', revision.revision > current.draft.revision && confirmed.revision === revision.revision && confirmed.status === 'confirmed');
    await mutation('/api/agent/tasks/' + created.id + '/complete', 'POST', () => button('标记任务完成').click());
    await status('已确认完成'); current = await task(created.id);
    check('Completion records the confirmed draft revision', current.status === 'completed' && current.completed_revision === confirmed.revision && !current.completion_stale);
    await page.reload(); await status('已确认完成');
    check('Reload restores the URL-selected completed task and saved text', await field('第 1 段内容').inputValue() === savedText);
    await snap('04-completed');

    step('reopen, continue and cancel preserve backend history');
    await mutation('/api/agent/tasks/' + created.id + '/reopen', 'POST', () => button('重新打开审核').click());
    await status('待你审阅');
    await field('补充要求').fill('仅整理预约流程，使用已有资料，不增加价格或疗效承诺。');
    await mutation('/api/agent/tasks/' + created.id + '/continue', 'POST', () => button('提交要求并继续').click(), 202);
    await workspace().locator('.agent-tags').getByText(/第 2 轮/).waitFor();
    await status('待你审阅'); current = await task(created.id);
    check('Continuation creates a second round and retains earlier results', current.attempt === 2 && current.result_ids.length >= 2 && current.notes.length === 1);
    check('Accepted follow-up clears the input', await field('补充要求').inputValue() === '');
    await mutation('/api/agent/tasks/' + created.id + '/cancel', 'POST', () => button('结束本次任务').click());
    await status('已取消'); current = await task(created.id);
    check('Cancellation keeps saved draft and completion history', current.status === 'cancelled' && Boolean(current.draft) && ['complete', 'reopen', 'resume', 'cancel'].every(action => current.events.some(event => event.action === action)));

    step('narrow viewport, return to list, counts and refresh');
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const label of ['结果审阅', '执行记录', '引用']) { await tab(label).click(); await overflow('390px detail ' + label + ' has no horizontal overflow'); }
    check('Reduced-motion removes tab transitions', await tab('引用').evaluate(element => getComputedStyle(element).transitionDuration.split(',').every(value => parseFloat(value) === 0)));
    await snap('05-mobile-detail');
    await button('任务列表').click(); await routeIs('agent', ''); await listReady();
    await overflow('390px list has no horizontal overflow');
    const listResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/agent/tasks' && response.request().method() === 'GET');
    await button('刷新').click();
    const rows = await (await listResponse).json();
    await page.waitForFunction(length => document.querySelector('.agent-status-counts dd')?.textContent === String(length), rows.length);
    check('List total equals the refreshed API snapshot', Number(await workspace().locator('.agent-status-counts dd').first().innerText()) === rows.length);
    const labels = { queued: '等待执行', running: '正在处理', waiting_input: '需要补充', waiting_review: '待你审阅', completed: '已确认完成', failed: '执行未完成', cancelled: '已取消', interrupted: '服务中断 · 可继续' };
    for (const [value, label] of Object.entries(labels)) {
      const actual = await field('任务状态').locator(`option[value="${value}"]`).textContent();
      check('Actual status count: ' + value, actual === `${label}（${rows.filter(row => row.status === value).length}）`);
    }
    await search().fill(marker); await field('任务状态').selectOption('cancelled');
    check('Search and status filter isolate the created task', await workspace().locator('.agent-task-row').count() === 1 && (await workspace().locator('.agent-task-row').innerText()).includes(marker));
    await field('任务状态').selectOption('completed');
    check('Status filter excludes the cancelled task', await workspace().locator('.agent-task-row').count() === 0);
    await button('清除筛选').click();
    await page.reload(); await listReady(); await routeIs('agent', '');
    check('Refreshing list never restores localStorage-selected details', await workspace().locator('.agent-detail,.agent-composer').count() === 0);
    check('Browser storage belongs only to the fresh test context', await page.evaluate(() => localStorage.getItem('marketing-agent-task')) === 'stale-acceptance-selection');
    await search().fill(marker); await snap('06-mobile-list');
    await button('新建任务').click(); await routeIs('agent', 'new');
    await overflow('390px create page has no horizontal overflow'); await snap('07-mobile-create');
    await button('任务列表').click(); await listReady();
    await page.setViewportSize({ width: 1440, height: 1000 }); await search().fill(marker); await snap('08-final-list');
    check('All requested task writes belong to this run', creationRequests === 1 && ownedTasks.size === 1 && mutations.length === 7);
    check('Model remains replay with zero task model calls', (await replay()).mode === 'replay' && (await task(created.id)).total_model_calls === 0);
    check('No disallowed network or foreign-data mutations occurred', blocked.length === 0, JSON.stringify(blocked));
    check('No browser errors or unexpected confirmations occurred', errors.length === 0, JSON.stringify(errors));
    console.log(JSON.stringify({ status: 'passed', assertions: checks.length, report: path.join(out, 'result.json') }));
    report();
  } catch (error) {
    if (page && !page.isClosed()) {
      await snap('failure').catch(() => {});
      fs.writeFileSync(path.join(out, 'failure.txt'), (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')).slice(-24000));
    }
    report(error);
    console.error(JSON.stringify({ status: 'failed', assertions: checks.length, stage, report: path.join(out, 'result.json'), error: error.message }));
    process.exitCode = 1;
  } finally {
    await browser?.close(); await api?.dispose(); clearTimeout(deadlineTimer);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
