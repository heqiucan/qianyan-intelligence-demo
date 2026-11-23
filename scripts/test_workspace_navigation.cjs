// Run with Node 24+: node --test scripts/test_workspace_navigation.cjs
// Import production TypeScript directly; no browser, build or network is used.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const navigation = import(pathToFileURL(path.resolve(__dirname, '../frontend/src/navigation.ts')).href);
const routeUrl = route => new URL(route, 'https://workspace.invalid/');
const queryEntries = params => [...params.entries()].map(entry => JSON.stringify(entry)).sort();
const assertRoute = (actual, page, values) => {
  const url = routeUrl(actual);
  assert.equal(url.pathname, '/' + page);
  assert.deepEqual(queryEntries(url.searchParams), queryEntries(new URLSearchParams(values)));
};

const demandOwners = [
  ['overview', 'tasks'], ['product', 'library'], ['creative', 'content'],
  ['analytics', 'results'], ['tasks', 'attention'],
];

for (const [page, view] of demandOwners) {
  test(`normalizeRoute: legacy ${page} demand links belong to Agent/${view}`, async () => {
    const { normalizeRoute } = await navigation;
    const query = new URLSearchParams({ tab: 'demand', view: 'obsolete', space: 'space/1', task: 'task&2', returnTask: 'parent=3', source: 'saved-link' });
    assertRoute(normalizeRoute(page + '?' + query), 'agent', {
      tab: 'demand', view, space: 'space/1', task: 'task&2', returnTask: 'parent=3', source: 'saved-link',
    });
  });
}

test('normalizeRoute: Agent launch keeps task, scene, campaign, session, item and return route', async () => {
  const { normalizeRoute } = await navigation;
  const values = {
    agent: 'new', scene: 'live', campaign: 'campaign-1', live: 'session-2', line: 'item-3',
    launch: 'launch-4', returnTo: 'live?live=session-2&tools=scripts',
  };
  assertRoute(normalizeRoute('overview?' + new URLSearchParams(values)), 'agent', values);
  assert.equal(normalizeRoute('overview?agent='), 'agent?agent=');
  assert.equal(normalizeRoute('overview?agent=task-1'), 'agent?agent=task-1');
});

test('normalizeRoute: demand ownership takes precedence over a stale Agent task parameter', async () => {
  const { normalizeRoute } = await navigation;
  assertRoute(normalizeRoute('overview?agent=old&tab=demand&task=d1'), 'agent', {
    agent: 'old', tab: 'demand', task: 'd1', view: 'tasks',
  });
});

test('normalizeRoute: legacy live entry removes only its old tab and preserves tools', async () => {
  const { normalizeRoute } = await navigation;
  assertRoute(normalizeRoute('overview?tab=live&live=s1&module=ai&feature=console&tools=voice'), 'live', {
    live: 's1', module: 'ai', feature: 'console', tools: 'voice',
  });
  assertRoute(normalizeRoute('creative?tab=live&live=s1'), 'live', { live: 's1', pane: 'session' });
  assertRoute(normalizeRoute('creative?tab=live&live=s1&pane=logs'), 'live', { live: 's1', pane: 'logs' });
});

for (const page of ['optimize', 'reports']) {
  test(`normalizeRoute: ${page} moves to analytics without losing its context`, async () => {
    const { normalizeRoute } = await navigation;
    assertRoute(normalizeRoute(`${page}?view=stale&campaign=c1&plan=p1&report=r1`), 'analytics', {
      view: page, campaign: 'c1', plan: 'p1', report: 'r1',
    });
  });
}

test('normalizeRoute: review defaults to optimization but preserves an explicit report view', async () => {
  const { normalizeRoute } = await navigation;
  assert.equal(normalizeRoute('review'), 'analytics?view=optimize');
  assertRoute(normalizeRoute('review?view=reports&report=report-1'), 'analytics', { view: 'reports', report: 'report-1' });
});

test('normalizeRoute: live results remain under analytics, not the live editor', async () => {
  const { normalizeRoute } = await navigation;
  assertRoute(normalizeRoute('analytics?tab=live&live=s1&view=stale&report=r1'), 'analytics', {
    live: 's1', view: 'live', report: 'r1',
  });
});

test('normalizeRoute: unrelated pages, knowledge tabs and consumer paths keep ownership', async () => {
  const { normalizeRoute } = await navigation;
  for (const route of [
    'overview', 'agent?tab=demand&view=content', 'product?tab=knowledge&space=s1&returnTask=t1',
    'creative?tab=knowledge&draft=d1', 'product?tab=catalog', 'ads?scenarios=1',
    'tasks?view=creative', 'analytics?section=orders', 'codex', 'shop/plan-1',
    'future-module?tab=demand&view=custom',
  ]) assert.equal(normalizeRoute(route), route, route);
  assert.equal(normalizeRoute('analytics?'), 'analytics');
});

test('normalizeRoute: unknown, repeated and empty query parameters survive migration', async () => {
  const { normalizeRoute } = await navigation;
  const url = routeUrl(normalizeRoute('review?tag=one&tag=two&flag=&report=r1&returnTask=t1'));
  assert.equal(url.pathname, '/analytics');
  assert.deepEqual(url.searchParams.getAll('tag'), ['one', 'two']);
  assert.equal(url.searchParams.get('flag'), '');
  assert.equal(url.searchParams.get('report'), 'r1');
  assert.equal(url.searchParams.get('returnTask'), 't1');
});

test('normalizeRoute: encoded identifiers and nested URLs round-trip without double decoding', async () => {
  const { normalizeRoute } = await navigation;
  const values = {
    agent: '任务 A+B&x=y?#/%', scene: 'medical', campaign: '活动/一',
    returnTo: 'live?live=场次+1&pane=session#位置', opaque: '%2F%25',
  };
  const result = normalizeRoute('overview?' + new URLSearchParams(values));
  assertRoute(result, 'agent', values);
  assert.equal(normalizeRoute(result), result);
  assertRoute(normalizeRoute('agent?agent=A%2BB+%E4%B8%AD&returnTo=live%3Flive%3DA%26pane%3Dlogs'), 'agent', {
    agent: 'A+B 中', returnTo: 'live?live=A&pane=logs',
  });
});

test('normalizeRoute: ordinary legacy and canonical links are idempotent', async () => {
  const { normalizeRoute } = await navigation;
  const routes = [
    ...demandOwners.map(([page]) => `${page}?tab=demand&space=s1&task=t1`),
    'overview?agent=new&scene=medical', 'overview?tab=live&live=s1', 'creative?tab=live&live=s1',
    'optimize?plan=p1', 'reports?report=r1', 'review?view=reports', 'analytics?tab=live&live=s1',
    'agent?returnTo=live%3Flive%3Ds1%26tools%3Dscripts', 'product?tag=a&tag=b&flag=',
  ];
  for (const route of routes) {
    const first = normalizeRoute(route);
    assert.equal(normalizeRoute(first), first, route);
    assert.equal(normalizeRoute(normalizeRoute(first)), first, route);
  }
});

test('normalizeRoute: overlapping legacy aliases must reach a stable owner in one call', async () => {
  const { normalizeRoute } = await navigation;
  const unstable = [];
  for (const page of ['review', 'optimize', 'reports']) {
    for (const tab of ['live', 'demand']) {
      const input = `${page}?tab=${tab}&live=s1&task=t1&space=space1`;
      const once = normalizeRoute(input);
      const twice = normalizeRoute(once);
      if (once !== twice) unstable.push({ input, once, twice });
    }
  }
  // Do not encode the current multi-pass redirect as the expected behavior.
  assert.deepEqual(unstable, [], 'normalization must not change owner or view on a second invocation');
});

test('routeWith: patching a legacy demand route keeps its canonical owner and scope', async () => {
  const { routeWith } = await navigation;
  assertRoute(routeWith('analytics?tab=demand&view=stale&space=s1&task=old&returnTask=upstream', {
    view: 'content', task: 'new-task',
  }), 'agent', { tab: 'demand', view: 'content', space: 's1', task: 'new-task', returnTask: 'upstream' });
});

test('routeWith: update and remove task identifiers without losing Agent launch context', async () => {
  const { routeWith } = await navigation;
  const values = { agent: 'new', scene: 'live', campaign: 'c1', live: 's1', line: 'item1', returnTo: 'live?live=s1&pane=session' };
  const route = 'overview?' + new URLSearchParams(values);
  const selected = routeWith(route, { agent: 'task/一+二' });
  assertRoute(selected, 'agent', { ...values, agent: 'task/一+二' });
  const { agent: _agent, ...remaining } = values;
  assertRoute(routeWith(selected, { agent: undefined }), 'agent', remaining);
});

test('routeWith: explicit empty and undefined delete keys; zero and false strings stay', async () => {
  const { routeWith } = await navigation;
  const patch = Object.freeze({ task: undefined, view: '', page: '0', preview: 'false' });
  assertRoute(routeWith('agent?task=t1&view=content&space=s1', patch), 'agent', { space: 's1', page: '0', preview: 'false' });
  assert.equal(routeWith('agent?agent=t1', { agent: '' }), 'agent');
  assert.equal(routeWith('analytics', { missing: undefined }), 'analytics');
  assert.equal(patch.page, '0');
});

test('routeWith: replacing one repeated key collapses it but preserves other repeated keys', async () => {
  const { routeWith } = await navigation;
  const params = routeUrl(routeWith('agent?task=t1&task=t2&tag=a&tag=b', { task: 't3' })).searchParams;
  assert.deepEqual(params.getAll('task'), ['t3']);
  assert.deepEqual(params.getAll('tag'), ['a', 'b']);
  assert.ok(!routeUrl(routeWith('agent?task=t1&task=t2', { task: undefined })).searchParams.has('task'));
});

test('routeWith: new special characters are encoded once and nested question marks survive', async () => {
  const { routeWith } = await navigation;
  const patch = { task: '任务 +/=&?#%', returnTo: 'agent?tab=demand&space=空间 A&task=t%2F1#结果' };
  const route = routeWith('agent?tab=demand&view=results&space=s1', patch);
  assertRoute(route, 'agent', { tab: 'demand', view: 'results', space: 's1', ...patch });
  assert.equal(routeWith(route, {}), route);
  assert.equal(routeWith(route, patch), route);
});

test('routeWith: query changes may trigger migration without losing new fields', async () => {
  const { routeWith } = await navigation;
  assertRoute(routeWith('overview?scene=medical', { agent: 'new' }), 'agent', { scene: 'medical', agent: 'new' });
  assertRoute(routeWith('creative?live=s1', { tab: 'live' }), 'live', { live: 's1', pane: 'session' });
  assertRoute(routeWith('analytics?space=s1', { tab: 'demand', task: 't1' }), 'agent', { space: 's1', tab: 'demand', task: 't1', view: 'results' });
});

test('routeWith: Agent and demand page changes preserve return context and explicitly clear selection', async () => {
  const { routeWith } = await navigation;
  const returnTo = 'creative?item=creative-1';
  const agent = 'agent?' + new URLSearchParams({ agent: 'agent-1', scene: 'medical', returnTo });
  const demand = routeWith(agent, { agent: undefined, tab: 'demand', view: 'tasks', space: 'space-1', task: 'demand-1' });
  for (const view of ['library', 'results', 'content', 'attention', 'tasks']) {
    assertRoute(routeWith(demand, { view }), 'agent', { scene: 'medical', returnTo, tab: 'demand', view, space: 'space-1', task: 'demand-1' });
  }
  const content = routeWith(demand, { tab: undefined, view: undefined, task: undefined, space: undefined, agent: 'agent-2' });
  assertRoute(content, 'agent', { scene: 'medical', returnTo, agent: 'agent-2' });
});

test('routeWith: analytics section changes preserve report filters and unrelated parameters', async () => {
  const { routeWith } = await navigation;
  for (const section of ['overview', 'plans', 'orders', 'spend']) {
    assertRoute(routeWith('analytics?section=orders&plan=p1&dataset=session', { section }), 'analytics', { section, plan: 'p1', dataset: 'session' });
  }
  assertRoute(routeWith('review?view=reports&report=r1', { report: 'r2' }), 'analytics', { view: 'reports', report: 'r2' });
});

const sessions = Object.freeze(['s-old', 's-latest']);

test('sameLiveSession: same session retains across tools, panels and legacy live aliases', async () => {
  const { sameLiveSession } = await navigation;
  const routes = ['live?live=s-old&pane=session', 'live?module=ai&live=s-old&feature=console', 'live?live=s-old&tools=voice', 'creative?tab=live&live=s-old', 'overview?tab=live&live=s-old'];
  for (const from of routes) for (const to of routes) assert.equal(sameLiveSession(from, to, sessions), true, `${from} -> ${to}`);
});

test('sameLiveSession: different known sessions cannot retain each other', async () => {
  const { sameLiveSession } = await navigation;
  assert.equal(sameLiveSession('live?live=s-old', 'live?live=s-latest', sessions), false);
  assert.equal(sameLiveSession('live?live=s-latest', 'creative?tab=live&live=s-old', sessions), false);
});

test('sameLiveSession: omitted, empty and stale IDs resolve to the actual last available session', async () => {
  const { sameLiveSession } = await navigation;
  for (const route of ['live', 'live?live=', 'live?live=deleted', 'creative?tab=live']) {
    assert.equal(sameLiveSession(route, 'live?live=s-latest', sessions), true, route);
    assert.equal(sameLiveSession(route, 'live?live=s-old', sessions), false, route);
  }
  assert.equal(sameLiveSession('live', 'live?live=s-old', ['s-latest', 's-old']), true);
  assert.deepEqual(sessions, ['s-old', 's-latest']);
});

test('sameLiveSession: encoded session IDs compare decoded identities, not raw URL strings', async () => {
  const { sameLiveSession } = await navigation;
  const ids = ['场次 A+B&x=y?#/%', 'fallback'];
  const encoded = 'live?' + new URLSearchParams({ live: ids[0], tools: 'scripts' });
  const legacy = 'creative?tab=live&live=' + encodeURIComponent(ids[0]);
  assert.equal(sameLiveSession(encoded, legacy, ids), true);
  assert.equal(sameLiveSession(encoded, 'live?live=fallback', ids), false);
  assert.equal(sameLiveSession('live?live=A+B', 'live?live=A%2BB', ['A B', 'A+B']), false);
});

test('sameLiveSession: analytics, Agent and demand links never count as live editor panels', async () => {
  const { sameLiveSession } = await navigation;
  const nonLive = ['analytics?tab=live&live=s-old', 'analytics?view=live&live=s-old', 'agent?agent=t1&live=s-old', 'agent?tab=demand&task=t1&live=s-old', 'overview?agent=new&live=s-old', 'creative?tab=demand&live=s-old', 'product?tab=catalog'];
  for (const route of nonLive) {
    assert.equal(sameLiveSession('live?live=s-old', route, sessions), false, route);
    assert.equal(sameLiveSession(route, 'live?live=s-old', sessions), false, route);
    assert.equal(sameLiveSession(route, route, sessions), false, route);
  }
});

test('sameLiveSession: no available session cannot prove that drafts belong to the same session', async () => {
  const { sameLiveSession } = await navigation;
  const pairs = [['live?live=s-old', 'live?live=s-latest'], ['live', 'live?pane=session'], ['creative?tab=live&live=s-old', 'live?live=s-old']];
  const incorrectlyRetained = pairs.filter(([from, to]) => sameLiveSession(from, to, []));
  assert.deepEqual(incorrectlyRetained, [], 'missing scope must not grant same-session draft retention');
});

test('sameLiveSession: retention is symmetric for supported routes within a fixed session scope', async () => {
  const { sameLiveSession } = await navigation;
  const routes = ['live', 'live?live=s-old', 'live?live=s-latest', 'live?live=deleted', 'creative?tab=live&live=s-old', 'agent?agent=t1', 'analytics?view=live&live=s-old'];
  for (const from of routes) for (const to of routes) {
    assert.equal(sameLiveSession(from, to, sessions), sameLiveSession(to, from, sessions), `${from} <-> ${to}`);
  }
});
