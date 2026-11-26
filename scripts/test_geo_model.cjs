const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const model = import(pathToFileURL(path.resolve(__dirname, '../frontend/src/features/geo/model.ts')).href);
test('failed samples do not enter metric denominators', async () => {
  const m = await model, p = m.initialStore().projects[0], summary = m.summarize(p.batches[0].observations);
  assert.equal(summary.total, 12); assert.equal(summary.failed, 1); assert.equal(summary.valid, 11);
  assert.equal(m.percent(0, 0), '—'); assert.equal(m.percent(0, 3), '0%');
});
test('new projects have no fabricated performance', async () => {
  const m = await model, p = m.createProject('Test', 'Brand');
  assert.equal(p.batches.length, 0); assert.equal(p.questions.length, 0); assert.equal(p.sources.length, 0);
  assert.equal(m.summarize(m.sampleBatch(p).observations).total, 0);
});
test('retesting does not automatically improve the fixture', async () => {
  const m = await model, p = m.initialStore().projects[0];
  assert.deepEqual(m.summarize(m.sampleBatch(p).observations), m.summarize(p.batches[0].observations));
});
test('task pauses and generates only one review draft from approved sources', async () => {
  const m = await model; let p = m.initialStore().projects[0];
  p.tasks = [{ id: 't', questionId: 'q2', step: 0, status: 'paused', draftId: 'd' }];
  assert.equal(m.advanceTask(p, 't'), p);
  p.tasks[0].status = 'running';
  for (let i = 0; i < 8; i++) p = m.advanceTask(p, 't');
  assert.equal(p.tasks[0].status, 'review'); assert.equal(p.drafts.length, 1);
  assert.equal(p.drafts[0].status, 'draft'); assert.equal(p.drafts[0].sources.length, 2);
  assert.ok(!p.drafts[0].body.includes('服务价格'));
});
test('report includes provenance and attribution limits', async () => {
  const m = await model, report = m.report(m.initialStore().projects[0]);
  for (const text of ['样例数据', '未连接外部平台', '采样失败', '回答证据', '咨询和成交未接入']) assert.ok(report.includes(text));
});
