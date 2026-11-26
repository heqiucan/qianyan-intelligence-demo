const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const navigation = import(pathToFileURL(path.resolve(__dirname, '../frontend/src/app/workspaceNavigation.ts')).href);

test('six primary modules have distinct routes and a stable user-facing order', async () => {
  const { workspaceModules } = await navigation;
  assert.deepEqual(workspaceModules.map(m => m.label), ['工作总览','GEO 工作台','直播工作台','营销工作台','商品与知识','Agent 中心']);
  assert.equal(new Set(workspaceModules.map(m => m.route)).size, 6);
});

for (const [route, owner, section] of [
  ['overview','overview','today'], ['tasks','overview','issues'], ['tasks?view=creative','overview','review'],
  ['creative?view=campaigns','marketing','campaigns'], ['creative?item=c1','marketing','content'],
  ['ads?scenarios=1','marketing','ads'], ['analytics?view=reports','marketing','results'],
  ['overview?tab=assistant','marketing','assistant'], ['agent?tab=demand&task=t1','marketing','demand'],
  ['live','live','sessions'], ['live?pane=session&live=s1','live','sessions'],
  ['live?pane=control&live=s1','live','control'], ['live?module=scripts&feature=groups&live=s1','live','materials'],
  ['analytics?view=live&live=s1','live','results'], ['analytics?view=live-reports','live','results'],
  ['product','product','catalog'], ['product?tab=brand','product','brand'],
  ['creative?tab=knowledge&draft=d1','product','knowledge'], ['product?tab=knowledge','product','knowledge'],
  ['agent?agent=new','agent','new'], ['agent?agent=t1','agent','list'], ['geo','geo','overview'],
]) test(`${route} retains its workflow under ${owner}/${section}`, async () => {
  const { workspaceLocation } = await navigation;
  const result = workspaceLocation(route);
  assert.equal(result.module.id, owner); assert.equal(result.sectionId, section);
});

test('live secondary navigation keeps explicit session context', async () => {
  const { workspaceLocation } = await navigation;
  for (const item of workspaceLocation('live?live=s%2B1&pane=control').items) {
    assert.equal(new URLSearchParams(item.route.split('?')[1]).get('live'), 's+1');
  }
});
