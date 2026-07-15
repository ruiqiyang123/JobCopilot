const test = require('node:test');
const assert = require('node:assert/strict');

const BatchLifecycle = require('../src/batch-lifecycle.js');

const JOBS = [
  { id: 'a', name: 'AI 产品经理 A', reviewStatus: 'approved' },
  { id: 'b', name: 'AI 产品经理 B', reviewStatus: 'approved' },
  { id: 'c', name: 'AI 产品经理 C', reviewStatus: 'rejected' }
];

test('岗位默认进入未开始投递状态且不修改原对象', () => {
  const source = { id: 'a', reviewStatus: 'approved' };
  const normalized = BatchLifecycle.normalizeJob(source);

  assert.notEqual(normalized, source);
  assert.equal(normalized.deliveryStatus, 'not_started');
  assert.equal(normalized.deliveredAt, 0);
  assert.equal(normalized.deliveryError, '');
  assert.equal(normalized.deliveryFailedStep, '');
});

test('成功岗位离开活动队列并清除旧失败信息', () => {
  const failed = BatchLifecycle.markFailed(JOBS, 'a', '聊天页缺少岗位 ID', 'contact');
  const succeeded = BatchLifecycle.markSucceeded(failed, 'a', 1000);

  assert.equal(succeeded[0].deliveryStatus, 'succeeded');
  assert.equal(succeeded[0].deliveredAt, 1000);
  assert.equal(succeeded[0].deliveryError, '');
  assert.equal(succeeded[0].deliveryFailedStep, '');
  assert.deepEqual(BatchLifecycle.activeJobs(succeeded).map(job => job.id), ['b', 'c']);
  assert.equal(JOBS[0].deliveryStatus, undefined);
});

test('失败和未执行岗位保留原因，成功状态不会被未执行覆盖', () => {
  let jobs = BatchLifecycle.markSucceeded(JOBS, 'a', 1000);
  jobs = BatchLifecycle.markFailed(jobs, 'b', '建立沟通失败', 'contact');
  jobs = BatchLifecycle.markNotRun(jobs, ['a', 'c']);

  assert.equal(jobs[0].deliveryStatus, 'succeeded');
  assert.equal(jobs[1].deliveryStatus, 'failed');
  assert.equal(jobs[1].deliveryError, '建立沟通失败');
  assert.equal(jobs[1].deliveryFailedStep, 'contact');
  assert.equal(jobs[2].deliveryStatus, 'not_run');
  assert.equal(BatchLifecycle.hasUnresolved(jobs), true);
});

test('旧 processed 和最近批次结果迁移为明确投递状态且成功优先', () => {
  const migrated = BatchLifecycle.migrate(JOBS, { a: 1 }, {
    succeeded: ['b'],
    failed: [{ id: 'a', error: '旧失败', step: 'contact' }],
    notRun: ['b', 'c'],
    finishedAt: 2000
  });

  assert.equal(migrated[0].deliveryStatus, 'succeeded');
  assert.equal(migrated[1].deliveryStatus, 'succeeded');
  assert.equal(migrated[1].deliveredAt, 2000);
  assert.equal(migrated[2].deliveryStatus, 'not_run');
  assert.deepEqual(BatchLifecycle.activeJobs(migrated).map(job => job.id), ['c']);
});

test('预演批次结果不能被误当成正式投递状态', () => {
  const migrated = BatchLifecycle.migrate(JOBS, {}, {
    mode: 'preview',
    succeeded: ['a'],
    failed: [{ id: 'b', error: '预演失败' }],
    notRun: ['c']
  });

  assert.deepEqual(migrated.map(job => job.deliveryStatus), [
    'not_started', 'not_started', 'not_started'
  ]);
});

test('最近批次摘要按唯一岗位计数', () => {
  const summary = BatchLifecycle.summarize({
    requestedIds: ['a', 'b', 'c', 'c'],
    succeeded: ['a', 'a'],
    failed: [{ id: 'b', error: '失败' }, { id: 'b', error: '重复失败' }],
    notRun: ['c', 'c']
  });

  assert.deepEqual(summary, { succeeded: 1, failed: 1, notRun: 1, total: 3 });
});

test('只有已批准且尚未处理的岗位也视为未解决', () => {
  const rejectedOnly = BatchLifecycle.normalizeJobs([
    { id: 'a', reviewStatus: 'rejected' },
    { id: 'b', reviewStatus: 'filtered_out' }
  ]);
  const approved = BatchLifecycle.normalizeJobs([
    { id: 'c', reviewStatus: 'approved' }
  ]);

  assert.equal(BatchLifecycle.hasUnresolved(rejectedOnly), false);
  assert.equal(BatchLifecycle.hasUnresolved(approved), true);
});
