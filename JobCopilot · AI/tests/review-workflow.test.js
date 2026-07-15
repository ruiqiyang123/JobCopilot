const test = require('node:test');
const assert = require('node:assert/strict');

const GreetingPlans = require('../src/greeting-plans.js');
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

test('AI 待确认与建议排除进入对应审核状态，并可在硬筛选通过后人工覆盖', () => {
  const needsInfo = ReviewWorkflow.normalizeJob(Object.assign({}, JOB, {
    match: false, matchDecision: 'needs_info', reviewStatus: ''
  }));
  assert.equal(needsInfo.reviewStatus, 'needs_info');

  const excluded = ReviewWorkflow.normalizeJob(Object.assign({}, JOB, {
    match: false, matchDecision: 'excluded', reviewStatus: ''
  }));
  assert.equal(excluded.reviewStatus, 'filtered_out');

  const overridden = ReviewWorkflow.overrideScore(excluded, 1234);
  assert.equal(overridden.scoreOverride, true);
  assert.equal(overridden.match, true);
  assert.equal(overridden.reviewStatus, 'pending_review');
  assert.equal(overridden.scoreOverrideAt, 1234);

  assert.throws(() => ReviewWorkflow.overrideScore(Object.assign({}, excluded, {
    filterStatus: 'fail'
  })), /硬筛选/);
});

test('批量人工确认只把稳定的待补充岗位转为人工覆盖候选', () => {
  const jobs = [
    Object.assign({}, JOB, {
      id: 'pending-filter', filterStatus: 'pending', match: false,
      matchDecision: 'needs_info', reviewStatus: 'needs_info'
    }),
    Object.assign({}, JOB, {
      id: 'ai-needs-info', match: false,
      matchDecision: 'needs_info', reviewStatus: 'needs_info',
      aiScreeningStatus: 'running', aiScreeningError: '旧错误'
    }),
    Object.assign({}, JOB, {
      id: 'failed-filter', filterStatus: 'fail', match: false,
      matchDecision: 'needs_info', reviewStatus: 'needs_info'
    })
  ];

  assert.equal(ReviewWorkflow.isManualConfirmable(jobs[0]), true);
  assert.equal(ReviewWorkflow.isManualConfirmable(jobs[1]), true);
  assert.equal(ReviewWorkflow.isManualConfirmable(jobs[2]), false);

  const prepared = jobs.map(job => job.id === 'pending-filter'
    ? Object.assign({}, job, { filterStatus: 'pass', manualOverride: true })
    : job);
  const result = ReviewWorkflow.confirmManyCandidates(
    prepared, prepared.map(job => job.id), 2468
  );

  assert.deepEqual(result.confirmedIds, ['pending-filter', 'ai-needs-info']);
  assert.deepEqual(result.skippedIds, ['failed-filter']);
  result.confirmedIds.forEach(id => {
    const confirmed = result.jobs.find(job => job.id === id);
    assert.equal(confirmed.reviewStatus, 'pending_review');
    assert.equal(confirmed.match, true);
    assert.equal(confirmed.scoreOverride, true);
    assert.equal(confirmed.scoreOverrideAt, 2468);
    assert.equal(confirmed.aiScreeningStatus, 'idle');
    assert.equal(confirmed.aiScreeningError, '');
  });
});

test('批量批准统一接受 AI 推荐和人工覆盖候选', () => {
  const jobs = [
    Object.assign({}, JOB, { id: 'recommended', matchDecision: 'recommended', quickDecision: 'recommended' }),
    Object.assign({}, JOB, {
      id: 'manual', matchDecision: 'needs_info', quickDecision: 'needs_info', scoreOverride: true
    }),
    Object.assign({}, JOB, { id: 'needs-info', match: false, matchDecision: 'needs_info', reviewStatus: 'needs_info' }),
    Object.assign({}, JOB, { id: 'already', matchDecision: 'recommended', reviewStatus: 'approved' }),
    Object.assign({}, JOB, { id: 'failed-filter', filterStatus: 'fail', matchDecision: 'recommended' })
  ];
  assert.equal(ReviewWorkflow.isBulkApprovable(jobs[0]), true);
  assert.equal(ReviewWorkflow.isBulkApprovable(jobs[1]), true);
  assert.equal(ReviewWorkflow.isBulkApprovable(jobs[2]), false);
  assert.equal(ReviewWorkflow.isBulkApprovable(jobs[3]), false);
  assert.equal(ReviewWorkflow.isBulkApprovable(jobs[4]), false);

  const result = ReviewWorkflow.approveMany(jobs, jobs.map(job => job.id), 4321);
  assert.deepEqual(result.approvedIds, ['recommended', 'manual']);
  assert.equal(result.jobs.find(job => job.id === 'recommended').reviewStatus, 'approved');
  assert.equal(result.jobs.find(job => job.id === 'manual').reviewStatus, 'approved');
  assert.equal(result.jobs.find(job => job.id === 'needs-info').reviewStatus, 'needs_info');
});

test('七个 AI 推荐加八个人工覆盖可一次批准十五个', () => {
  const jobs = Array.from({ length: 15 }, (_, index) => Object.assign({}, JOB, {
    id: 'job-' + index,
    matchDecision: index < 7 ? 'recommended' : 'needs_info',
    quickDecision: index < 7 ? 'recommended' : 'needs_info',
    scoreOverride: index >= 7
  }));
  const result = ReviewWorkflow.approveMany(jobs, jobs.map(job => job.id), 5000);
  assert.equal(result.approvedIds.length, 15);
  assert.equal(result.jobs.filter(job => job.reviewStatus === 'approved').length, 15);
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
  assert.equal(Object.hasOwn(preview, 'resumeImage'), false);
  assert.equal(preview.resumeImageFingerprint, GreetingPlans.hashText(inputs.plan.resumeImage));
  assert.equal(ReviewWorkflow.isPreviewReady(preview, inputs).ok, true);

  const changed = Object.assign({}, inputs, { jd: 'JD 已经发生变化' });
  assert.equal(ReviewWorkflow.isPreviewReady(preview, changed).ok, true);
});

test('批量预演确认使用最新开场并返回逐岗跳过原因', () => {
  const jobs = [
    Object.assign({}, JOB, { id: 'job-1', reviewStatus: 'approved' }),
    Object.assign({}, JOB, { id: 'job-2', reviewStatus: 'approved' }),
    Object.assign({}, JOB, { id: 'job-3', reviewStatus: 'approved' }),
    Object.assign({}, JOB, { id: 'job-4', reviewStatus: 'rejected' })
  ];
  const previews = {};
  jobs.forEach((job, index) => {
    previews[job.id] = ReviewWorkflow.createPreview(previewInputs({ job: job }), {
      aiOpening: '旧开场 ' + index
    }, 1000 + index);
  });
  previews['job-3'] = Object.assign({}, previews['job-3'], {
    status: 'expired', error: '配置已变化'
  });

  const result = ReviewWorkflow.confirmManyPreviews(
    previews,
    jobs,
    jobs.map(job => job.id),
    { 'job-1': '用户最后看到的开场', 'job-2': '第二个开场' },
    3000,
    ['job-2']
  );

  assert.deepEqual(result.confirmedIds, ['job-1']);
  assert.equal(result.previews['job-1'].status, 'confirmed');
  assert.equal(result.previews['job-1'].aiOpening, '用户最后看到的开场');
  assert.equal(result.previews['job-1'].confirmedAt, 3000);
  assert.deepEqual(result.skipped.map(item => item.id), ['job-2', 'job-3', 'job-4']);
  assert.match(result.skipped[0].reason, /重新生成/);
  assert.match(result.skipped[1].reason, /过期/);
  assert.match(result.skipped[2].reason, /尚未批准/);
});

test('批量预演确认跳过空内容和已经确认的预演', () => {
  const job = Object.assign({}, JOB, { reviewStatus: 'approved' });
  const draft = ReviewWorkflow.createPreview(previewInputs({ job: job }), { aiOpening: '原始开场' }, 1000);
  const empty = ReviewWorkflow.confirmManyPreviews(
    { [job.id]: draft }, [job], [job.id], { [job.id]: '   ' }, 2000
  );
  assert.equal(empty.confirmedIds.length, 0);
  assert.match(empty.skipped[0].reason, /不能为空/);

  const confirmed = ReviewWorkflow.confirmPreview(draft, '已确认开场', 1500);
  const repeated = ReviewWorkflow.confirmManyPreviews(
    { [job.id]: confirmed }, [job], [job.id], {}, 2000
  );
  assert.equal(repeated.confirmedIds.length, 0);
  assert.match(repeated.skipped[0].reason, /已经确认/);
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
  assert.match(ReviewWorkflow.isPreviewReady(preview, previewInputs({
    plan: Object.assign({}, inputs.plan, { resumeImage: 'data:image/png;base64,BBBB' })
  })).reason, /简历图片/);
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
  assert.equal(Object.hasOwn(regenerated, 'resumeImage'), false);
  assert.equal(regenerated.resumeImageFingerprint, confirmed.resumeImageFingerprint);
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

test('旧预演迁移时保留确认内容并移除重复图片正文', () => {
  const inputs = previewInputs();
  const current = ReviewWorkflow.confirmPreview(
    ReviewWorkflow.createPreview(inputs, { aiOpening: '保留的开场' }, 1000),
    '人工确认的开场',
    2000
  );
  const legacy = Object.assign({}, current, {
    resumeImage: inputs.plan.resumeImage,
    resumeImageFingerprint: ''
  });
  const migrated = ReviewWorkflow.migratePreviews({ [JOB.id]: legacy });
  assert.equal(migrated[JOB.id].status, 'confirmed');
  assert.equal(migrated[JOB.id].aiOpening, '人工确认的开场');
  assert.equal(migrated[JOB.id].confirmedAt, 2000);
  assert.equal(Object.hasOwn(migrated[JOB.id], 'resumeImage'), false);
  assert.equal(migrated[JOB.id].resumeImageFingerprint, GreetingPlans.hashText(inputs.plan.resumeImage));
  assert.deepEqual(ReviewWorkflow.migratePreviews(migrated), migrated);
});

test('启用图片但旧预演无法生成图片指纹时标记为过期', () => {
  const inputs = previewInputs();
  const preview = ReviewWorkflow.createPreview(inputs, { aiOpening: '开场' }, 1000);
  delete preview.resumeImageFingerprint;
  const migrated = ReviewWorkflow.migratePreviews({ [JOB.id]: preview });
  assert.equal(migrated[JOB.id].status, 'expired');
  assert.match(migrated[JOB.id].error, /图片指纹/);
});

test('多个岗位预演不会随简历图片体积线性增长', () => {
  const largeImage = 'data:image/png;base64,' + 'A'.repeat(1024 * 1024);
  const previews = {};
  for (let index = 0; index < 12; index++) {
    const job = Object.assign({}, JOB, { id: 'job-' + index });
    previews[job.id] = ReviewWorkflow.createPreview(previewInputs({
      job: job,
      plan: Object.assign({}, previewInputs().plan, { resumeImage: largeImage })
    }), { aiOpening: '开场 ' + index }, 1000 + index);
  }
  const serialized = JSON.stringify(previews);
  assert.equal(serialized.includes(largeImage), false);
  assert.ok(serialized.length < 50000, '预演数据不应复制大图正文');
});
