const test = require('node:test');
const assert = require('node:assert/strict');

const PreviewRunState = require('../src/preview-run-state.js');

test('开始预演后所有岗位立即进入排队状态', () => {
  const state = PreviewRunState.start(['job-1', 'job-2'], 'run-1');

  assert.equal(state.status, 'running');
  assert.equal(state.total, 2);
  assert.equal(state.completed, 0);
  assert.equal(state.jobs['job-1'].stage, 'queued');
  assert.equal(state.jobs['job-2'].stage, 'queued');
});

test('按后台消息更新读取详情、校验、生成开场和草稿状态', () => {
  let state = PreviewRunState.start(['job-1'], 'run-1');
  state = PreviewRunState.applyProgress(state, {
    runId: 'run-1', jobId: 'job-1', stage: 'reading_detail', completed: 0, total: 1
  });
  assert.equal(state.jobs['job-1'].stage, 'reading_detail');

  state = PreviewRunState.applyProgress(state, {
    runId: 'run-1', jobId: 'job-1', stage: 'verifying', completed: 0, total: 1
  });
  assert.equal(state.jobs['job-1'].stage, 'verifying');

  state = PreviewRunState.applyProgress(state, {
    runId: 'run-1', jobId: 'job-1', stage: 'generating_opening', completed: 0, total: 1
  });
  assert.equal(state.jobs['job-1'].stage, 'generating_opening');

  state = PreviewRunState.applyProgress(state, {
    runId: 'run-1', jobId: 'job-1', stage: 'draft', completed: 1, total: 1
  });
  assert.equal(state.jobs['job-1'].stage, 'draft');
  assert.equal(state.completed, 1);
});

test('岗位失败后保留错误并将剩余岗位标记为未执行', () => {
  let state = PreviewRunState.start(['job-1', 'job-2', 'job-3'], 'run-1');
  state = PreviewRunState.applyProgress(state, {
    runId: 'run-1', jobId: 'job-1', stage: 'draft', completed: 1, total: 3
  });
  state = PreviewRunState.applyProgress(state, {
    runId: 'run-1', jobId: 'job-2', stage: 'failed', completed: 1, total: 3, error: '岗位详情读取失败'
  });
  state = PreviewRunState.applyProgress(state, {
    runId: 'run-1', jobId: 'job-3', stage: 'not_run', completed: 1, total: 3
  });
  state = PreviewRunState.finish(state, 'failed');

  assert.equal(state.status, 'failed');
  assert.equal(state.jobs['job-2'].stage, 'failed');
  assert.equal(state.jobs['job-2'].error, '岗位详情读取失败');
  assert.equal(state.jobs['job-3'].stage, 'not_run');
});

test('启动失败恢复批次并且岗位不再停留在等待预演', () => {
  const running = PreviewRunState.start(['job-1', 'job-2'], '');
  const failed = PreviewRunState.failStart(running, '扩展后台未响应');

  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, '扩展后台未响应');
  assert.equal(failed.jobs['job-1'].stage, 'not_run');
  assert.equal(failed.jobs['job-2'].stage, 'not_run');
});

test('忽略旧批次和未知岗位的进度消息', () => {
  const state = PreviewRunState.start(['job-1'], 'run-current');
  const stale = PreviewRunState.applyProgress(state, {
    runId: 'run-old', jobId: 'job-1', stage: 'failed', error: '旧错误'
  });
  const unknown = PreviewRunState.applyProgress(stale, {
    runId: 'run-current', jobId: 'job-2', stage: 'draft'
  });

  assert.deepEqual(unknown, state);
});
