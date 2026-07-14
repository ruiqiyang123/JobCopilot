(function initReviewWorkflow(root, factory) {
  const plans = root.GreetingPlans || (typeof require === 'function' ? require('./greeting-plans.js') : null);
  const api = factory(plans);
  root.ReviewWorkflow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createReviewWorkflow(GreetingPlans) {
  'use strict';

  if (!GreetingPlans) throw new Error('ReviewWorkflow 需要 GreetingPlans');

  const REVIEW_STATUSES = Object.freeze([
    'pending_review', 'needs_info', 'approved', 'rejected', 'filtered_out'
  ]);

  function defaultStatus(job) {
    const source = job || {};
    if (source.filterStatus === 'pending') return 'needs_info';
    if (source.filterStatus === 'fail' || source.match === false) return 'filtered_out';
    return 'pending_review';
  }

  function normalizeJob(job) {
    const source = Object.assign({}, job || {});
    source.reviewStatus = REVIEW_STATUSES.indexOf(source.reviewStatus) >= 0
      ? source.reviewStatus
      : defaultStatus(source);
    source.reviewUpdatedAt = Number(source.reviewUpdatedAt) || 0;
    return source;
  }

  function normalizeJobs(jobs) {
    return (Array.isArray(jobs) ? jobs : []).map(normalizeJob);
  }

  function setDecision(job, decision, at) {
    const source = normalizeJob(job);
    if (decision !== 'approved' && decision !== 'rejected') throw new Error('不支持的审核决定');
    if (decision === 'approved' && (source.filterStatus !== 'pass' || source.match !== true)) {
      throw new Error('该岗位尚未通过筛选，不能批准投递');
    }
    source.reviewStatus = decision;
    source.reviewUpdatedAt = Number.isFinite(at) ? at : Date.now();
    return source;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const result = {};
      Object.keys(value).sort().forEach(key => { result[key] = stableValue(value[key]); });
      return result;
    }
    return value;
  }

  function inputFingerprint(inputs) {
    const source = inputs || {};
    const job = source.job || {};
    return GreetingPlans.hashText(JSON.stringify(stableValue({
      job: { id: job.id || '', name: job.name || '', company: job.company || '' },
      jd: String(source.jd || job.jd || ''),
      resumeText: String(source.resumeText || ''),
      jobFilterConfig: source.jobFilterConfig || {},
      planFingerprint: GreetingPlans.fingerprint(source.plan || {})
    })));
  }

  function createPreview(inputs, content, at) {
    const source = inputs || {};
    const body = content || {};
    const job = source.job || {};
    const plan = GreetingPlans.normalizePlan(source.plan || {});
    return {
      jobId: job.id || '',
      greetingPlanId: plan.id,
      enabledSteps: GreetingPlans.enabledSteps(plan),
      aiOpening: String(body.aiOpening || '').trim(),
      fixedMessage: plan.fixedMessageEnabled ? String(body.fixedMessage || plan.fixedMessage || '').trim() : '',
      resumeImage: plan.resumeImageEnabled ? String(body.resumeImage || plan.resumeImage || '') : '',
      resumeImageFingerprint: GreetingPlans.hashText(plan.resumeImageEnabled ? String(body.resumeImage || plan.resumeImage || '') : ''),
      jd: String(source.jd || job.jd || ''),
      inputFingerprint: inputFingerprint(source),
      status: 'draft',
      createdAt: Number.isFinite(at) ? at : Date.now(),
      confirmedAt: 0,
      error: ''
    };
  }

  function confirmPreview(preview, aiOpening, at) {
    const next = Object.assign({}, preview || {});
    if (!next.jobId || !next.inputFingerprint) throw new Error('预演数据不完整');
    next.aiOpening = String(aiOpening === undefined ? next.aiOpening : aiOpening).trim();
    if ((next.enabledSteps || []).indexOf('aiOpening') >= 0 && !next.aiOpening) {
      throw new Error('AI 个性化开场不能为空');
    }
    next.status = 'confirmed';
    next.confirmedAt = Number.isFinite(at) ? at : Date.now();
    next.error = '';
    return next;
  }

  function isPreviewReady(preview, inputs) {
    const source = preview || {};
    if (source.status !== 'confirmed') return { ok: false, reason: '该岗位尚未确认预演' };
    if ((source.enabledSteps || []).indexOf('aiOpening') >= 0 && !String(source.aiOpening || '').trim()) {
      return { ok: false, reason: '预演缺少 AI 个性化开场' };
    }
    if (!(source.enabledSteps || []).length) return { ok: false, reason: '预演没有可发送内容' };
    if (source.inputFingerprint !== inputFingerprint(inputs)) return { ok: false, reason: '预演内容已过期' };
    return { ok: true, reason: '' };
  }

  function migratePreviews(previews) {
    const result = {};
    Object.keys(previews || {}).forEach(jobId => {
      const preview = Object.assign({}, previews[jobId]);
      if (preview.status === 'confirmed' && preview.inputFingerprint) result[jobId] = preview;
      else if ((preview.status === 'draft' || preview.status === 'failed' || preview.status === 'expired') && preview.inputFingerprint) {
        result[jobId] = preview;
      } else {
        result[jobId] = Object.assign({}, preview, {
          status: 'expired',
          error: '旧版预演需要重新生成并确认'
        });
      }
    });
    return result;
  }

  return {
    REVIEW_STATUSES: REVIEW_STATUSES,
    normalizeJob: normalizeJob,
    normalizeJobs: normalizeJobs,
    setDecision: setDecision,
    inputFingerprint: inputFingerprint,
    createPreview: createPreview,
    confirmPreview: confirmPreview,
    isPreviewReady: isPreviewReady,
    migratePreviews: migratePreviews
  };
});
