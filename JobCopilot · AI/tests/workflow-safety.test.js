const test = require('node:test');
const assert = require('node:assert/strict');

const WorkflowSafety = require('../src/workflow-safety.js');

const JOB = {
  id: 'job-1',
  name: 'AI 产品经理',
  company: '示例科技',
  experience: 'one_to_three',
  companySize: 'hundred_to_499',
  filterStatus: 'pass',
  match: true,
  reviewStatus: 'approved'
};

test('岗位 ID、名称和公司一致时身份校验通过', () => {
  const result = WorkflowSafety.verifyIdentity(JOB, Object.assign({}, JOB));
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
});

test('岗位 ID、名称、公司不一致或当前字段缺失时阻止', () => {
  assert.equal(WorkflowSafety.verifyIdentity(JOB, Object.assign({}, JOB, { id: 'job-2' })).ok, false);
  assert.equal(WorkflowSafety.verifyIdentity(JOB, Object.assign({}, JOB, { name: '高级产品经理' })).ok, false);
  assert.equal(WorkflowSafety.verifyIdentity(JOB, Object.assign({}, JOB, { company: '另一家公司' })).ok, false);
  assert.equal(WorkflowSafety.verifyIdentity(JOB, Object.assign({}, JOB, { company: '' })).ok, false);
});

test('发送前重新应用筛选条件，并阻止已投岗位', () => {
  const eligible = WorkflowSafety.verifyEligibility(JOB, Object.assign({}, JOB), undefined, {});
  assert.equal(eligible.ok, true);
  assert.equal(eligible.job.filterStatus, 'pass');

  const changed = WorkflowSafety.verifyEligibility(
    Object.assign({}, JOB, { manualOverride: true }),
    Object.assign({}, JOB, { companySize: 'twenty_to_99' }),
    undefined,
    {}
  );
  assert.equal(changed.ok, false);
  assert.match(changed.reasons.join('；'), /公司规模/);

  const processed = WorkflowSafety.verifyEligibility(JOB, Object.assign({}, JOB), undefined, { 'job-1': 1 });
  assert.equal(processed.ok, false);
  assert.match(processed.reasons.join('；'), /已经成功投递/);
});

test('人工确认只覆盖仍然缺失的信息', () => {
  const unknown = Object.assign({}, JOB, { experience: '', manualOverride: true });
  const result = WorkflowSafety.verifyEligibility(unknown, Object.assign({}, unknown), undefined, {});
  assert.equal(result.ok, true);
  assert.equal(result.job.manualOverride, true);
});

test('正式投递只接受已批准、已确认预演且未投过的岗位', () => {
  const confirmed = { status: 'confirmed', enabledSteps: ['aiOpening', 'fixedMessage', 'resumeImage'] };
  assert.equal(WorkflowSafety.canDeliver(JOB, confirmed, {}).ok, true);
  assert.equal(WorkflowSafety.canDeliver(Object.assign({}, JOB, { reviewStatus: 'pending_review' }), confirmed, {}).ok, false);
  assert.equal(WorkflowSafety.canDeliver(JOB, { status: 'draft', enabledSteps: ['aiOpening'] }, {}).ok, false);
  assert.equal(WorkflowSafety.canDeliver(JOB, confirmed, { 'job-1': 1 }).ok, false);
});
