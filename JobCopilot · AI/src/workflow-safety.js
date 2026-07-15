(function initWorkflowSafety(root, factory) {
  let filters = root.JobFilters;
  let details = root.JobDetail;
  if (!filters && typeof module !== 'undefined' && module.exports) filters = require('./job-filters.js');
  if (!details && typeof module !== 'undefined' && module.exports) details = require('./job-detail.js');
  const api = factory(filters, details);
  root.WorkflowSafety = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createWorkflowSafety(JobFilters, JobDetail) {
  'use strict';

  if (!JobFilters) throw new Error('WorkflowSafety 需要 JobFilters');
  if (!JobDetail) throw new Error('WorkflowSafety 需要 JobDetail');

  function normalizeIdentity(value) {
    return String(value || '')
      .replace(/\s+/g, '')
      .replace(/[（）()·•]/g, '')
      .toLowerCase();
  }

  function verifyIdentity(expected, actual) {
    return JobDetail.verifyIdentity(expected, actual);
  }

  function verifyEligibility(job, currentJob, filterConfig, processed) {
    const expected = job || {};
    const current = currentJob || {};
    const identity = verifyIdentity(expected, current);
    const merged = Object.assign({}, JobDetail.mergeDetail(expected, current), {
      manualOverride: expected.manualOverride === true
    });
    const filterResult = JobFilters.evaluate(merged, filterConfig);
    merged.filterStatus = filterResult.filterStatus;
    merged.filterReasons = filterResult.filterReasons;

    const reasons = identity.reasons.slice();
    if (processed && expected.id && processed[expected.id]) reasons.push('该岗位已经成功投递');
    if (filterResult.filterStatus !== 'pass') {
      reasons.push.apply(reasons, filterResult.filterReasons);
    }
    return { ok: reasons.length === 0, reasons: reasons, job: merged };
  }

  function canDeliver(job, preview, processed) {
    const source = job || {};
    if (!source.id) return { ok: false, reason: '找不到岗位数据' };
    if (source.reviewStatus !== 'approved') return { ok: false, reason: '该岗位尚未人工批准' };
    if (processed && processed[source.id]) return { ok: false, reason: '该岗位已经成功投递' };
    if (!preview) return { ok: false, reason: '该岗位尚未完成预演' };
    if (preview.status !== 'confirmed') return { ok: false, reason: '该岗位预演尚未确认或已经过期' };
    if (!Array.isArray(preview.enabledSteps) || !preview.enabledSteps.length) {
      return { ok: false, reason: '预演没有可发送内容' };
    }
    return { ok: true, reason: '' };
  }

  return {
    normalizeIdentity: normalizeIdentity,
    verifyIdentity: verifyIdentity,
    verifyEligibility: verifyEligibility,
    canDeliver: canDeliver
  };
});
