const test = require('node:test');
const assert = require('node:assert/strict');

const ReviewWorkflow = require('../src/review-workflow.js');

const JOB = {
  id: 'job-1',
  name: 'AI 产品经理',
  company: '示例科技',
  detailUrl: 'https://www.zhipin.com/job_detail/job-1.html',
  filterStatus: 'pass',
  match: true,
  jd: '负责 AI Agent 产品规划。'
};

test('AI 推荐、待补充和排除岗位迁移到独立审核状态', () => {
  assert.equal(ReviewWorkflow.normalizeJob(JOB).reviewStatus, 'pending_review');
  assert.equal(ReviewWorkflow.normalizeJob(Object.assign({}, JOB, { filterStatus: 'pending' })).reviewStatus, 'needs_info');
  assert.equal(ReviewWorkflow.normalizeJob(Object.assign({}, JOB, { match: false })).reviewStatus, 'filtered_out');
});

test('只有筛选通过且 AI 推荐的岗位可以批准', () => {
  const approved = ReviewWorkflow.setDecision(JOB, 'approved', 1000);
  assert.equal(approved.reviewStatus, 'approved');
  assert.equal(approved.reviewUpdatedAt, 1000);
  assert.equal(ReviewWorkflow.setDecision(JOB, 'rejected', 1001).reviewStatus, 'rejected');
  assert.throws(() => ReviewWorkflow.setDecision(Object.assign({}, JOB, { match: false }), 'approved'), /不能批准/);
});

function previewInputs(overrides) {
  return Object.assign({
    job: JOB,
    jd: JOB.jd,
    resumeText: '产品经理简历',
    jobFilterConfig: { experienceValues: ['one_to_three'] },
    plan: { id: 'plan-1', name: '方案', fixedMessage: '固定消息', resumeImage: 'data:image/png;base64,AAAA' }
  }, overrides || {});
}

test('预演快照可编辑后确认，只有 JD 动态文本变化时仍然有效', () => {
  const inputs = previewInputs();
  let preview = ReviewWorkflow.createPreview(inputs, {
    aiOpening: '初始开场',
    fixedMessage: '固定消息',
    resumeImage: 'data:image/png;base64,AAAA'
  }, 1000);
  preview = ReviewWorkflow.confirmPreview(preview, '人工编辑后的开场', 2000);
  assert.equal(preview.status, 'confirmed');
  assert.equal(preview.aiOpening, '人工编辑后的开场');
  assert.equal(ReviewWorkflow.isPreviewReady(preview, inputs).ok, true);

  const changed = Object.assign({}, inputs, { jd: 'JD 已经发生变化' });
  assert.equal(ReviewWorkflow.isPreviewReady(preview, changed).ok, true);
});

test('稳定输入变化时返回具体的预演失效原因', () => {
  const inputs = previewInputs();
  const preview = ReviewWorkflow.confirmPreview(
    ReviewWorkflow.createPreview(inputs, { aiOpening: '初始开场' }, 1000),
    '初始开场',
    2000
  );

  const changedJob = previewInputs({ job: Object.assign({}, JOB, { company: '另一家公司' }) });
  assert.match(ReviewWorkflow.isPreviewReady(preview, changedJob).reason, /岗位身份/);
  assert.match(ReviewWorkflow.isPreviewReady(preview, previewInputs({ resumeText: '另一份简历' })).reason, /简历/);
  assert.match(ReviewWorkflow.isPreviewReady(preview, previewInputs({
    jobFilterConfig: { experienceValues: ['three_to_five'] }
  })).reason, /筛选配置/);
  assert.match(ReviewWorkflow.isPreviewReady(preview, previewInputs({
    plan: Object.assign({}, inputs.plan, { fixedMessage: '新的固定消息' })
  })).reason, /招呼方案/);
});

test('重新生成只替换 AI 开场并撤销已确认状态', () => {
  const inputs = previewInputs();
  const confirmed = ReviewWorkflow.confirmPreview(
    ReviewWorkflow.createPreview(inputs, { aiOpening: '旧开场' }, 1000),
    '旧开场',
    2000
  );
  const regenerated = ReviewWorkflow.regeneratePreview(confirmed, inputs, '新开场', 3000);

  assert.equal(regenerated.aiOpening, '新开场');
  assert.equal(regenerated.fixedMessage, confirmed.fixedMessage);
  assert.equal(regenerated.resumeImage, confirmed.resumeImage);
  assert.equal(regenerated.status, 'draft');
  assert.equal(regenerated.confirmedAt, 0);
});

test('旧版 ready 预演迁移为过期，不能直接正式发送', () => {
  const migrated = ReviewWorkflow.migratePreviews({
    'job-1': { status: 'confirmed', inputFingerprint: 'legacy', greeting: '旧招呼语' }
  });
  assert.equal(migrated['job-1'].status, 'expired');
  assert.match(migrated['job-1'].error, /旧版预演/);
});
