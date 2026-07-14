(function initWorkflowSafety(root, factory) {
  let filters = root.JobFilters;
  if (!filters && typeof module !== 'undefined' && module.exports) filters = require('./job-filters.js');
  const api = factory(filters);
  root.WorkflowSafety = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createWorkflowSafety(JobFilters) {
  'use strict';

  if (!JobFilters) throw new Error('WorkflowSafety 需要 JobFilters');

  function normalizeIdentity(value) {
    return String(value || '')
      .replace(/\s+/g, '')
      .replace(/[（）()·•]/g, '')
      .toLowerCase();
  }

  function verifyIdentity(expected, actual) {
    const source = expected || {};
    const current = actual || {};
    const reasons = [];

    if (!source.id || !current.id) reasons.push('岗位 ID 缺失');
    else if (String(source.id) !== String(current.id)) reasons.push('岗位 ID 已变化');

    if (!source.name || !current.name) reasons.push('岗位名称缺失');
    else if (normalizeIdentity(source.name) !== normalizeIdentity(current.name)) reasons.push('岗位名称已变化');

    if (!source.company || !current.company) reasons.push('公司名称缺失');
    else if (normalizeIdentity(source.company) !== normalizeIdentity(current.company)) reasons.push('公司名称已变化');

    return { ok: reasons.length === 0, reasons: reasons };
  }

  function verifyEligibility(job, currentJob, filterConfig, processed) {
    const expected = job || {};
    const current = currentJob || {};
    const identity = verifyIdentity(expected, current);
    const merged = Object.assign({}, expected, current, {
      id: expected.id || current.id,
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

  function canDeliver(jobId, previews, processed) {
    if (processed && processed[jobId]) return { ok: false, reason: '该岗位已经成功投递' };
    const preview = previews && previews[jobId];
    if (!preview) return { ok: false, reason: '该岗位尚未完成模拟运行' };
    if (preview.status !== 'ready') return { ok: false, reason: '该岗位模拟运行未通过' };
    if (!String(preview.greeting || '').trim()) return { ok: false, reason: '模拟运行缺少招呼语' };
    return { ok: true, reason: '' };
  }

  return {
    normalizeIdentity: normalizeIdentity,
    verifyIdentity: verifyIdentity,
    verifyEligibility: verifyEligibility,
    canDeliver: canDeliver
  };
});
