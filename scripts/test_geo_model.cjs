const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const model = import(pathToFileURL(path.resolve(__dirname, '../frontend/src/features/geo/model.ts')).href);

test('failed samples do not enter metric denominators', async () => {
  const m = await model;
  const project = m.initialStore().projects[0];
  const summary = m.summarize(project.batches[0].observations);
  assert.equal(summary.total, 12);
  assert.equal(summary.failed, 1);
  assert.equal(summary.valid, 11);
  assert.equal(m.percent(0, 0), '—');
  assert.equal(m.percent(0, 3), '0%');
});

test('new projects have no fabricated performance', async () => {
  const m = await model;
  const project = m.createProject('Test', 'Brand');
  assert.equal(project.batches.length, 0);
  assert.equal(project.questions.length, 0);
  assert.equal(project.sources.length, 0);
  assert.equal(m.summarize(m.sampleBatch(project).observations).total, 0);
});

test('retesting does not automatically improve the fixture', async () => {
  const m = await model;
  const project = m.initialStore().projects[0];
  assert.deepEqual(m.summarize(m.sampleBatch(project).observations), m.summarize(project.batches[0].observations));
});

test('task pauses and generates only one review draft from approved sources', async () => {
  const m = await model;
  let project = m.initialStore().projects[0];
  project.tasks = [{ id: 't', questionId: 'q2', step: 0, status: 'paused', draftId: 'd' }];
  assert.equal(m.advanceTask(project, 't'), project);
  project.tasks[0].status = 'running';
  for (let index = 0; index < 8; index++) project = m.advanceTask(project, 't');
  assert.equal(project.tasks[0].status, 'review');
  assert.equal(project.drafts.length, 1);
  assert.equal(project.drafts[0].status, 'draft');
  assert.equal(project.drafts[0].sources.length, 2);
  assert.ok(!project.drafts[0].body.includes('售后政策'));
});

test('report includes provenance and attribution limits', async () => {
  const m = await model;
  const report = m.report(m.initialStore().projects[0]);
  for (const text of ['样例数据', '未连接外部平台', '采样失败', '回答证据', '咨询和成交未接入']) {
    assert.ok(report.includes(text));
  }
});

test('GEO defaults to a project list without selecting the first project', async () => {
  const m = await model;
  const store = m.initialStore();
  const root = m.resolveGeoRoute('geo', store);
  assert.equal(root.section, 'projects');
  assert.equal(root.project, undefined);
  for (const section of ['monitor', 'optimize', 'content', 'reports']) {
    const route = m.resolveGeoRoute(`geo?view=${section}`, store);
    assert.equal(route.section, section);
    assert.equal(route.project, undefined);
  }
});

test('five primary GEO sections retain legacy project detail deep links', async () => {
  const m = await model;
  assert.deepEqual(m.sections.map(([, label]) => label), ['项目管理', '问题监测', '诊断优化', '内容管理', '效果报告']);
  const store = m.initialStore();
  const project = store.projects[0];
  for (const section of ['overview', 'knowledge', 'monitor', 'optimize', 'content', 'reports']) {
    const route = m.resolveGeoRoute(`geo?project=${project.id}&view=${section}&item=legacy-draft`, store);
    assert.equal(route.project, project);
    assert.equal(route.section, section);
    assert.equal(route.item, 'legacy-draft');
  }
  assert.equal(m.resolveGeoRoute(`geo?project=${project.id}`, store).section, 'overview');
  assert.equal(m.resolveGeoRoute(`geo?project=${project.id}&view=invalid`, store).section, 'overview');
});

test('invalid project links never silently select another project', async () => {
  const m = await model;
  const route = m.resolveGeoRoute('geo?project=missing&view=content&item=draft', m.initialStore());
  assert.equal(route.project, undefined);
  assert.equal(route.projectId, 'missing');
  assert.equal(route.item, 'draft');
});

test('project and content identifiers survive encoded route round trips', async () => {
  const m = await model;
  const project = m.createProject('Project', 'Brand');
  project.id = '青禾 & ?/#';
  const item = '正文 & ?/#';
  const route = m.resolveGeoRoute(m.projectRoute(project.id, 'content', item), { version: 1, projects: [project] });
  assert.equal(route.project, project);
  assert.equal(route.item, item);
  assert.equal(route.section, 'content');
});

test('restoring v1 preserves old sample branding, records and title-only drafts', async () => {
  const m = await model;
  const legacy = m.createProject('直播运营工具 · 品牌可见性', '浙衍 AI');
  legacy.id = 'sample-live';
  legacy.questions = [{ id: 'q-old', text: '原有问题', intent: '能力核实', priority: '高' }];
  legacy.sources = [{ id: 's-old', title: '原有资料', kind: '产品文档', text: '原有正文', approved: true }];
  legacy.batches = [{ id: 'b-old', date: '2026-11-24T14:00:00Z', observations: [] }];
  legacy.drafts = [{
    id: 'd-old', questionId: 'q-old', title: '原有草稿', body: '历史正文',
    status: 'recorded', url: 'https://example.com/old', sources: ['原有资料'],
  }];
  const other = m.createProject('用户项目', '用户品牌');
  const store = { version: 1, projects: [legacy, other] };
  const restored = m.restoreStore(JSON.stringify(store));
  assert.deepEqual(restored, store);
  assert.equal(restored.projects[0].drafts[0].sourceSnapshots, undefined);
  assert.equal(m.storageKey, 'zheyan-geo-prototype-v1');
});

test('restoring keeps intentionally empty stores and pauses simulated jobs', async () => {
  const m = await model;
  assert.deepEqual(m.restoreStore('{"version":1,"projects":[]}'), { version: 1, projects: [] });
  const store = m.initialStore();
  store.projects[0].tasks = [{ id: 't', questionId: 'q2', step: 2, status: 'running', draftId: 'd' }];
  const restored = m.restoreStore(JSON.stringify(store));
  assert.equal(restored.projects[0].tasks[0].status, 'paused');
  assert.equal(restored.projects[0].tasks[0].step, 2);
  assert.equal(store.projects[0].tasks[0].status, 'running');
});

test('invalid stores fail instead of silently replacing user records', async () => {
  const m = await model;
  for (const raw of ['', 'broken', 'null', '{"version":2,"projects":[]}', '{"version":1,"projects":[null]}']) {
    assert.throws(() => m.restoreStore(raw));
  }
});

test('new fixture uses Qinghe down jacket questions without external observation claims', async () => {
  const m = await model;
  const project = m.restoreStore(null).projects[0];
  assert.equal(project.brand, '青禾');
  assert.ok(project.name.includes('紫色羽绒服'));
  assert.ok(project.questions.every(question => question.text.includes('紫色羽绒服')));
  assert.ok(project.sources.some(source => source.text.includes('虚构营销示例')));
  for (const batch of project.batches) {
    for (const observation of batch.observations) assert.ok(observation.answer.includes('样例'));
  }
});

test('draft source snapshots are independent of later source text or approval changes', async () => {
  const m = await model;
  const project = m.initialStore().projects[0];
  const draft = m.makeDraft(project, project.questions[0], 'snapshot-test');
  const originalText = project.sources[0].text;
  project.sources[0].text = 'New content';
  project.sources[0].approved = false;
  assert.equal(draft.sourceSnapshots.length, 2);
  assert.equal(draft.sourceSnapshots[0].text, originalText);
  assert.equal(draft.sourceSnapshots[0].approved, true);
  assert.ok(!draft.sourceSnapshots.some(source => source.id === 's3'));
  const restored = m.restoreStore(JSON.stringify({ version: 1, projects: [{ ...project, drafts: [draft] }] }));
  assert.deepEqual(restored.projects[0].drafts[0], draft);
});
