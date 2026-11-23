const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const frontendRequire = createRequire(path.join(frontend, 'package.json'));
const data = import(pathToFileURL(path.join(frontend, 'src/features/analytics/data.ts')).href);
const metrics = {
  impressions: 10000, clicks: 300, spend: 300, orders: 15, buyers: 15,
  new_customers: 9, unknown_buyers: 0, revenue: 1485, ctr: 0.03,
  roi: 4.95, cpa: 20, cac: 300 / 9,
};
const fixture = {
  dataset: 'history', label: '历史演示数据 D0', window: 'D0 固定窗口', note: '固定虚构样例',
  metrics, filters: {}, views: null, trend: { points: [], note: '未提供逐日明细' },
  rows: [
    { ...metrics, name: '历史 A', plan_id: 'history-A', impressions: 4000, clicks: 120, spend: 120, orders: 9, buyers: 9, new_customers: 5, revenue: 891, roi: 7.425 },
    { ...metrics, name: '历史 B', plan_id: 'history-B', impressions: 6000, clicks: 180, spend: 180, orders: 6, buyers: 6, new_customers: 4, revenue: 594, roi: 3.3 },
  ],
  orders: [{ id: 'order-full-identifier-for-trace', plan_id: 'history-A', creative_id: 'creative-A', campaign_id: 'campaign-A', buyer_id: 'buyer-A', buyer_type: 'new', amount: 99, quantity: 0, created_at: 'D0 固定窗口' }],
  spend_entries: [{ id: 'spend-A', plan_id: 'history-A', amount: 120, source: '固定虚构历史样例', created_at: 'D0 固定窗口' }],
};

test('missing, zero, non-finite and numeric text remain distinct', async () => {
  const { metricValue, formatMetric } = await data;
  for (const value of [null, undefined, NaN, Infinity, '', '0']) {
    assert.equal(metricValue(value), null);
    assert.equal(formatMetric(value), '未提供');
  }
  assert.equal(metricValue(0), 0);
  assert.equal(formatMetric(0), '0');
  assert.equal(formatMetric(0, 'money'), '¥0.00');
  assert.equal(formatMetric(0, 'percent'), '0%');
  assert.equal(formatMetric(null, 'percent'), '不可计算');
});

test('rank actual plan values without mutating API rows', async () => {
  const { planRanking } = await data;
  const rows = Object.freeze(fixture.rows.map(row => Object.freeze({ ...row })));
  const result = planRanking(rows, 'revenue');
  assert.deepEqual(result.map(entry => entry.value), [891, 594]);
  assert.equal(result[0].width, 100);
  assert.ok(Math.abs(result[1].width - 200 / 3) < 1e-10);
  assert.deepEqual(planRanking(rows, 'spend').map(entry => entry.row.plan_id), ['history-B', 'history-A']);
  assert.deepEqual(rows.map(row => row.plan_id), ['history-A', 'history-B']);
});

test('ties retain input order; missing values are unranked after real zeros', async () => {
  const { planRanking } = await data;
  const values = [null, 0, 5, 5, 1, NaN, -1];
  const result = planRanking(values.map((spend, i) => ({ ...fixture.rows[0], name: String(i), spend })), 'spend');
  assert.deepEqual(result.map(entry => entry.sourceIndex), [2, 3, 4, 1, 0, 5, 6]);
  assert.deepEqual(result.map(entry => entry.rank), [1, 1, 3, 4, null, null, null]);
  assert.deepEqual(result.map(entry => entry.width), [100, 100, 20, 0, null, null, null]);
});

test('empty and all-zero rankings do not produce phantom bars or NaN', async () => {
  const { planRanking } = await data;
  assert.deepEqual(planRanking([], 'orders'), []);
  const result = planRanking(fixture.rows.map(row => ({ ...row, orders: 0 })), 'orders');
  assert.ok(result.every(entry => entry.width === 0 && entry.rank === 1));
  assert.ok(planRanking(fixture.rows.map(row => ({ ...row, spend: null })), 'spend').every(entry => entry.width === null));
});

test('buyer shares use deduplicated totals, not orders or summed plan buyers', async () => {
  const { buyerComposition } = await data;
  const result = buyerComposition({ ...metrics, orders: 70, buyers: 5, new_customers: 2, unknown_buyers: 1 });
  assert.equal(result.total, 5);
  assert.equal(result.coverage, 0.8);
  assert.deepEqual(result.segments.map(segment => segment.value), [2, 2, 1]);
  assert.deepEqual(result.segments.map(segment => segment.share), [0.4, 0.4, 0.2]);
});

test('zero buyers have zero counts but undefined shares and coverage', async () => {
  const result = (await data).buyerComposition({ buyers: 0, new_customers: 0, unknown_buyers: 0 });
  assert.equal(result.status, 'empty');
  assert.equal(result.coverage, null);
  assert.ok(result.segments.every(segment => segment.value === 0 && segment.share === null));
});

test('incomplete or contradictory buyer metrics cannot become a valid 100% chart', async () => {
  const { buyerComposition } = await data;
  for (const input of [
    { buyers: 5, new_customers: null, unknown_buyers: 1 },
    { buyers: 5, new_customers: 4, unknown_buyers: 2 },
    { buyers: 0, new_customers: 1, unknown_buyers: 0 },
    { buyers: 5, new_customers: 1.5, unknown_buyers: 0 },
    { buyers: 5, new_customers: 1, unknown_buyers: -1 },
  ]) {
    const result = buyerComposition(input);
    assert.ok(['missing', 'inconsistent'].includes(result.status));
    assert.equal(result.coverage, null);
    assert.equal(result.segments[1].value, null);
    assert.ok(result.segments.every(segment => segment.share === null));
  }
});

test('unknown-only buyers have 0% identification, not missing identification', async () => {
  const result = (await data).buyerComposition({ buyers: 3, new_customers: 0, unknown_buyers: 3 });
  assert.equal(result.coverage, 0);
  assert.deepEqual(result.segments.map(segment => segment.share), [0, 0, 1]);
});

test('average order value respects a zero numerator and missing denominator', async () => {
  const { averageOrderValue } = await data;
  assert.equal(averageOrderValue(metrics), 99);
  assert.equal(averageOrderValue({ orders: 3, revenue: 0 }), 0);
  for (const item of [{ orders: 0, revenue: 0 }, { orders: 0, revenue: 99 }, { orders: 3, revenue: null }, { orders: null, revenue: 99 }]) {
    assert.equal(averageOrderValue(item), null);
  }
});

test('all four focus values map to views; unknown values fall back to overview', async () => {
  const { resolveAnalyticsView } = await data;
  for (const view of ['overview', 'plans', 'orders', 'spend']) assert.equal(resolveAnalyticsView(view), view);
  assert.equal(resolveAnalyticsView(''), 'overview');
  assert.equal(resolveAnalyticsView('other'), 'overview');
});

test('CSV preserves BOM, source, window, scope, missing values, zeros and quoted text', async () => {
  const { analyticsCsv } = await data;
  const csv = analyticsCsv({ ...fixture, rows: [{ ...fixture.rows[0], name: '计划,"A"\n第二行', spend: null, clicks: 0 }] });
  assert.ok(csv.startsWith('\uFEFF"来源","历史演示数据 D0"\r\n'));
  assert.ok(csv.includes('"窗口","D0 固定窗口"'));
  assert.ok(csv.includes('"计划,""A""\n第二行","4000","0","未提供"'));
  assert.ok(!csv.includes('历史 B'));
  assert.equal(fixture.rows.length, 2);
});

async function loadRenderers() {
  const { rolldown } = await import(pathToFileURL(frontendRequire.resolve('rolldown')).href);
  const entry = '\0analytics-render-test';
  const modulePaths = ['AnalyticsPage.tsx', 'MetricsSummary.tsx'].map(file => JSON.stringify(path.join(frontend, 'src/features', file).replaceAll('\\', '/')));
  const bundle = await rolldown({
    input: entry, cwd: frontend, platform: 'node',
    external: ['react', 'react/jsx-runtime', 'react-dom/server', 'lucide-react'],
    transform: { jsx: 'react-jsx' },
    plugins: [{
      name: 'analytics-static-render-test',
      resolveId(id) {
        if (id === entry) return entry;
        if (id.endsWith('.css')) return '\0analytics-empty-style';
      },
      load(id) {
        if (id === '\0analytics-empty-style') return '';
        if (id === entry) return `
          import { createElement } from 'react';
          import { renderToStaticMarkup } from 'react-dom/server';
          import AnalyticsPage from ${modulePaths[0]};
          import MetricsSummary from ${modulePaths[1]};
          export const renderPage = (analytics, focus) => renderToStaticMarkup(createElement(AnalyticsPage, {analytics, focus, trace() {}, selectPlan() {}}));
          export const renderSummary = analytics => renderToStaticMarkup(createElement(MetricsSummary, {analytics, onSelect() {}}));
        `;
      },
    }],
  });
  try {
    const { output } = await bundle.generate({ format: 'cjs' });
    const module = { exports: {} };
    const context = { module, exports: module.exports, require: frontendRequire };
    vm.runInNewContext(output.find(item => item.type === 'chunk').code, context);
    return context.module.exports;
  } finally { await bundle.close(); }
}

test('rendered views retain accessible charts, detail tables, trace and compact no-trend state', async () => {
  const { renderPage, renderSummary } = await loadRenderers();
  for (const view of ['overview', 'plans', 'orders', 'spend']) {
    const html = renderPage(fixture, view);
    assert.ok(html.includes(`aria-controls="analytics-${view}" aria-selected="true"`));
    assert.equal((html.match(/role="tabpanel"/g) || []).length, 4);
    assert.equal((html.match(/tabindex="0" hidden=""/g) || []).length, 3);
    assert.ok(html.includes('导出当前范围 CSV'));
  }
  const overview = renderPage(fixture, 'overview');
  assert.ok(overview.includes('排名数据表') && overview.includes('买家构成'));
  assert.ok(overview.includes('筛选此计划') && overview.includes('时间趋势暂无数据'));
  assert.ok(!overview.includes('class="panel live-trend"'));
  assert.ok(!overview.includes('订单编号'));
  const orders = renderPage(fixture, 'orders');
  assert.ok(orders.includes(fixture.orders[0].id));
  assert.ok(orders.includes('查看链路') && orders.includes('<td>0</td>'));
  assert.ok(!orders.includes('计划排名'));
  assert.ok(renderPage(fixture, 'spend').includes('固定虚构历史样例'));
  assert.ok(renderPage(fixture, 'plans').includes('筛选计划：历史 A'));
  assert.ok(renderSummary(fixture).includes('数据来源与指标口径'));
  assert.equal(renderPage(null, 'overview'), '');
  assert.equal(renderSummary(null), '');
  const trend = renderPage({ ...fixture, dataset: 'session', trend: { points: [{ date: '2026-11-01', revenue: 99, orders: 1, spend: null }], note: '记录日期' } }, 'overview');
  assert.ok(trend.includes('class="panel live-trend"') && trend.includes('查看趋势数据表'));
  assert.ok(trend.includes('单点不代表增长趋势'));
  const missing = renderPage({ ...fixture, metrics: { ...metrics, spend: null }, spend_entries: [] }, 'spend');
  const zero = renderPage({ ...fixture, metrics: { ...metrics, spend: 0 }, spend_entries: [] }, 'spend');
  assert.ok(missing.includes('未提供广告消耗'));
  assert.ok(zero.includes('广告消耗为 0'));
});
