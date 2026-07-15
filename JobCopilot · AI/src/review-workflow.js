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
    if (source.scoreOverride === true && source.filterStatus === 'pass' && source.match === true) {
      return 'pending_review';
    }
    if (source.filterStatus === 'pending' || source.matchDecision === 'needs_info') return 'needs_info';
    if (source.filterStatus === 'fail' || source.matchDecision === 'excluded' || source.match === false) return 'filtered_out';
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

  function overrideScore(job, at) {
    const source = normalizeJob(job);
    if (source.filterStatus !== 'pass') throw new Error('硬筛选未通过，不能人工覆盖 AI 评分');
    if (source.matchDecision !== 'needs_info' && source.matchDecision !== 'excluded') {
      throw new Error('该岗位不需要覆盖 AI 评分');
    }
    source.scoreOverride = true;
    source.scoreOverrideAt = Number.isFinite(at) ? at : Date.now();
    source.match = true;
    source.aiScreeningStatus = 'idle';
    source.aiScreeningError = '';
    source.reviewStatus = 'pending_review';
    source.reviewUpdatedAt = source.scoreOverrideAt;
    return source;
  }

  function isManualConfirmable(job) {
    const source = normalizeJob(job);
    return source.reviewStatus === 'needs_info'
      && (source.filterStatus === 'pending' || source.filterStatus === 'pass')
      && source.deliveryStatus !== 'succeeded';
  }

  function confirmManualCandidate(job, at) {
    const source = normalizeJob(job);
    if (!isManualConfirmable(source)) throw new Error('该岗位当前不能人工确认');
    if (source.filterStatus !== 'pass') throw new Error('岗位缺失信息尚未完成人工确认');
    source.scoreOverride = true;
    source.scoreOverrideAt = Number.isFinite(at) ? at : Date.now();
    source.match = true;
    source.aiScreeningStatus = 'idle';
    source.aiScreeningError = '';
    source.reviewStatus = 'pending_review';
    source.reviewUpdatedAt = source.scoreOverrideAt;
    return source;
  }

  function confirmManyCandidates(jobs, jobIds, at) {
    const requested = new Set(Array.isArray(jobIds) ? jobIds.map(String) : []);
    const confirmedIds = [];
    const seen = new Set();
    const updatedAt = Number.isFinite(at) ? at : Date.now();
    const updated = normalizeJobs(jobs).map(job => {
      const id = String(job.id);
      if (!requested.has(id)) return job;
      seen.add(id);
      if (!isManualConfirmable(job) || job.filterStatus !== 'pass') return job;
      confirmedIds.push(job.id);
      return confirmManualCandidate(job, updatedAt);
    });
    const confirmed = new Set(confirmedIds.map(String));
    const skippedIds = [];
    requested.forEach(id => {
      if (!seen.has(id) || !confirmed.has(id)) skippedIds.push(id);
    });
    return { jobs: updated, confirmedIds: confirmedIds, skippedIds: skippedIds };
  }

  function isBulkApprovable(job) {
    const source = normalizeJob(job);
    const recommended = source.quickDecision === 'recommended'
      || source.matchDecision === 'recommended';
    const manuallySelected = source.scoreOverride === true;
    return source.reviewStatus === 'pending_review'
      && source.filterStatus === 'pass'
      && source.match === true
      && (recommended || manuallySelected)
      && source.deliveryStatus !== 'succeeded'
      && (source.aiScreeningStatus !== 'running' || manuallySelected);
  }

  function approveMany(jobs, jobIds, at) {
    const requested = new Set(Array.isArray(jobIds) ? jobIds.map(String) : []);
    const approvedIds = [];
    const updatedAt = Number.isFinite(at) ? at : Date.now();
    const updated = normalizeJobs(jobs).map(job => {
      if (!requested.has(String(job.id)) || !isBulkApprovable(job)) return job;
      approvedIds.push(job.id);
      return setDecision(job, 'approved', updatedAt);
    });
    return { jobs: updated, approvedIds: approvedIds };
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

  function normalizeIdentity(value) {
    return String(value || '').replace(/[\s·•|｜【】()[\]（）,，.。-]/g, '').toLowerCase();
  }

  function hashStable(value) {
    return GreetingPlans.hashText(JSON.stringify(stableValue(value)));
  }

  function inputFingerprintParts(inputs) {
    const source = inputs || {};
    const job = source.job || {};
    return {
      jobIdentity: hashStable({
        id: String(job.id || '').trim(),
        name: normalizeIdentity(job.name),
        company: normalizeIdentity(job.company)
      }),
      resume: GreetingPlans.hashText(String(source.resumeText || '')),
      filters: hashStable(source.jobFilterConfig || {}),
      plan: GreetingPlans.fingerprint(source.plan || {})
    };
  }

  function inputFingerprint(inputs) {
    return hashStable(inputFingerprintParts(inputs));
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
      resumeImageFingerprint: GreetingPlans.hashText(plan.resumeImageEnabled ? String(plan.resumeImage || '') : ''),
      jd: String(source.jd || job.jd || ''),
      inputFingerprint: inputFingerprint(source),
      inputFingerprintVersion: 2,
      inputFingerprintParts: inputFingerprintParts(source),
      status: 'draft',
      createdAt: Number.isFinite(at) ? at : Date.now(),
      confirmedAt: 0,
      error: ''
    };
  }

  function confirmPreview(preview, aiOpening, at) {
    const next = Object.assign({}, preview || {});
    if (!next.jobId || !next.inputFingerprint) throw new Error('预演数据不完整');
    if (next.inputFingerprintVersion !== 2) throw new Error('旧版预演需要重新生成并确认');
    next.aiOpening = String(aiOpening === undefined ? next.aiOpening : aiOpening).trim();
    if ((next.enabledSteps || []).indexOf('aiOpening') >= 0 && !next.aiOpening) {
      throw new Error('AI 个性化开场不能为空');
    }
    next.status = 'confirmed';
    next.confirmedAt = Number.isFinite(at) ? at : Date.now();
    next.error = '';
    return next;
  }

  function previewBulkConfirmability(job, preview, aiOpening, blocked) {
    if (!job) return { ok: false, reason: '找不到对应岗位' };
    const normalized = normalizeJob(job);
    if (normalized.reviewStatus !== 'approved') return { ok: false, reason: '岗位尚未批准' };
    if (normalized.deliveryStatus === 'succeeded') return { ok: false, reason: '岗位已经投递' };
    if (blocked) return { ok: false, reason: '预演正在重新生成' };
    const source = preview || {};
    if (!source.jobId) return { ok: false, reason: '找不到岗位预演' };
    if (String(source.jobId) !== String(normalized.id)) return { ok: false, reason: '岗位预演身份不一致' };
    if (source.status === 'confirmed') return { ok: false, reason: '岗位预演已经确认' };
    if (source.status === 'expired') {
      return { ok: false, reason: '岗位预演已经过期' + (source.error ? '：' + source.error : '') };
    }
    if (source.status === 'failed') return { ok: false, reason: source.error || '岗位预演生成失败' };
    if (source.status !== 'draft') return { ok: false, reason: '岗位预演当前不能确认' };
    if (!source.inputFingerprint || source.inputFingerprintVersion !== 2 || !source.inputFingerprintParts) {
      return { ok: false, reason: '预演数据不完整，需要重新生成' };
    }
    if (!(source.enabledSteps || []).length) return { ok: false, reason: '预演没有可发送内容' };
    const opening = String(aiOpening === undefined ? source.aiOpening : aiOpening).trim();
    if ((source.enabledSteps || []).indexOf('aiOpening') >= 0 && !opening) {
      return { ok: false, reason: 'AI 个性化开场不能为空' };
    }
    return { ok: true, reason: '' };
  }

  function confirmManyPreviews(previews, jobs, jobIds, openingsByJobId, at, blockedJobIds) {
    const sourcePreviews = previews || {};
    const updated = Object.assign({}, sourcePreviews);
    const jobMap = new Map(normalizeJobs(jobs).map(job => [String(job.id), job]));
    const requested = Array.from(new Set(Array.isArray(jobIds) ? jobIds.map(String) : []));
    const openings = openingsByJobId || {};
    const blocked = new Set(Array.isArray(blockedJobIds) ? blockedJobIds.map(String) : []);
    const confirmedIds = [];
    const skipped = [];
    const confirmedAt = Number.isFinite(at) ? at : Date.now();

    requested.forEach(id => {
      const preview = sourcePreviews[id];
      const opening = Object.prototype.hasOwnProperty.call(openings, id)
        ? openings[id]
        : (preview && preview.aiOpening);
      const eligibility = previewBulkConfirmability(jobMap.get(id), preview, opening, blocked.has(id));
      if (!eligibility.ok) {
        skipped.push({ id: id, reason: eligibility.reason });
        return;
      }
      try {
        updated[id] = confirmPreview(preview, opening, confirmedAt);
        confirmedIds.push(id);
      } catch (error) {
        skipped.push({ id: id, reason: error.message || '预演确认失败' });
      }
    });

    return { previews: updated, confirmedIds: confirmedIds, skipped: skipped };
  }

  function regeneratePreview(preview, inputs, aiOpening, at) {
    const source = preview || {};
    const context = inputs || {};
    const job = context.job || {};
    if (!source.jobId || source.jobId !== job.id) throw new Error('岗位预演身份不一致');
    if ((source.enabledSteps || []).indexOf('aiOpening') < 0) throw new Error('当前招呼方案未启用 AI 开场');
    const opening = String(aiOpening || '').trim();
    if (!opening) throw new Error('AI 个性化开场生成失败');
    return createPreview(context, {
      aiOpening: opening,
      fixedMessage: source.fixedMessage
    }, at);
  }

  function isPreviewReady(preview, inputs) {
    const source = preview || {};
    if (source.status !== 'confirmed') return { ok: false, reason: '该岗位尚未确认预演' };
    if ((source.enabledSteps || []).indexOf('aiOpening') >= 0 && !String(source.aiOpening || '').trim()) {
      return { ok: false, reason: '预演缺少 AI 个性化开场' };
    }
    if (!(source.enabledSteps || []).length) return { ok: false, reason: '预演没有可发送内容' };
    if (source.inputFingerprintVersion !== 2 || !source.inputFingerprintParts) {
      return { ok: false, reason: '旧版预演需要重新生成并确认' };
    }
    const current = inputFingerprintParts(inputs);
    const expected = source.inputFingerprintParts;
    if (expected.jobIdentity !== current.jobIdentity) return { ok: false, reason: '岗位身份已变化' };
    if (expected.resume !== current.resume) return { ok: false, reason: '简历内容已变化' };
    if (expected.filters !== current.filters) return { ok: false, reason: '岗位筛选配置已变化' };
    const plan = GreetingPlans.normalizePlan((inputs || {}).plan || {});
    if ((source.enabledSteps || []).indexOf('resumeImage') >= 0) {
      const currentImageFingerprint = GreetingPlans.hashText(String(plan.resumeImage || ''));
      if (!source.resumeImageFingerprint || source.resumeImageFingerprint !== currentImageFingerprint) {
        return { ok: false, reason: '简历图片已变化' };
      }
    }
    if (expected.plan !== current.plan) return { ok: false, reason: '招呼方案已变化' };
    if (source.inputFingerprint !== inputFingerprint(inputs)) return { ok: false, reason: '预演稳定配置已变化' };
    return { ok: true, reason: '' };
  }

  function stripEmbeddedImage(preview) {
    const next = Object.assign({}, preview || {});
    const embedded = String(next.resumeImage || '');
    if (!next.resumeImageFingerprint && embedded) {
      next.resumeImageFingerprint = GreetingPlans.hashText(embedded);
    }
    delete next.resumeImage;
    return next;
  }

  function stripEmbeddedImages(previews) {
    const result = {};
    Object.keys(previews || {}).forEach(jobId => {
      result[jobId] = stripEmbeddedImage(previews[jobId]);
    });
    return result;
  }

  function migratePreviews(previews) {
    const result = {};
    Object.keys(previews || {}).forEach(jobId => {
      const preview = stripEmbeddedImage(previews[jobId]);
      const imageEnabled = (preview.enabledSteps || []).indexOf('resumeImage') >= 0;
      if (imageEnabled && !preview.resumeImageFingerprint) {
        result[jobId] = Object.assign({}, preview, {
          status: 'expired',
          error: '旧预演缺少简历图片指纹，需要重新生成并确认'
        });
        return;
      }
      const currentVersion = preview.inputFingerprintVersion === 2 && preview.inputFingerprintParts;
      if (preview.status === 'confirmed' && preview.inputFingerprint && currentVersion) result[jobId] = preview;
      else if ((preview.status === 'draft' || preview.status === 'failed' || preview.status === 'expired')
          && preview.inputFingerprint && currentVersion) {
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
    overrideScore: overrideScore,
    isManualConfirmable: isManualConfirmable,
    confirmManualCandidate: confirmManualCandidate,
    confirmManyCandidates: confirmManyCandidates,
    isBulkApprovable: isBulkApprovable,
    approveMany: approveMany,
    inputFingerprintParts: inputFingerprintParts,
    inputFingerprint: inputFingerprint,
    createPreview: createPreview,
    confirmPreview: confirmPreview,
    previewBulkConfirmability: previewBulkConfirmability,
    confirmManyPreviews: confirmManyPreviews,
    regeneratePreview: regeneratePreview,
    isPreviewReady: isPreviewReady,
    stripEmbeddedImages: stripEmbeddedImages,
    migratePreviews: migratePreviews
  };
});
