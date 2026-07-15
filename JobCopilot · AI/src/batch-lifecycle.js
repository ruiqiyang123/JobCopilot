(function initBatchLifecycle(root, factory) {
  const api = factory();
  root.BatchLifecycle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createBatchLifecycle() {
  'use strict';

  const DELIVERY_STATUSES = Object.freeze([
    'not_started', 'succeeded', 'failed', 'not_run'
  ]);

  function normalizeJob(job) {
    const source = Object.assign({}, job || {});
    source.deliveryStatus = DELIVERY_STATUSES.indexOf(source.deliveryStatus) >= 0
      ? source.deliveryStatus
      : 'not_started';
    source.deliveredAt = Number(source.deliveredAt) || 0;
    source.deliveryError = String(source.deliveryError || '');
    source.deliveryFailedStep = String(source.deliveryFailedStep || '');
    return source;
  }

  function normalizeJobs(jobs) {
    return (Array.isArray(jobs) ? jobs : []).map(normalizeJob);
  }

  function updateJob(jobs, jobId, update) {
    const id = String(jobId || '');
    return normalizeJobs(jobs).map(job => {
      if (String(job.id || '') !== id) return job;
      return update(job);
    });
  }

  function markSucceeded(jobs, jobId, at) {
    return updateJob(jobs, jobId, job => Object.assign({}, job, {
      deliveryStatus: 'succeeded',
      deliveredAt: Number.isFinite(at) ? at : Date.now(),
      deliveryError: '',
      deliveryFailedStep: ''
    }));
  }

  function markFailed(jobs, jobId, error, step) {
    return updateJob(jobs, jobId, job => {
      if (job.deliveryStatus === 'succeeded') return job;
      return Object.assign({}, job, {
        deliveryStatus: 'failed',
        deliveryError: String(error || '投递失败'),
        deliveryFailedStep: String(step || '')
      });
    });
  }

  function markNotRun(jobs, jobIds) {
    const ids = new Set((Array.isArray(jobIds) ? jobIds : []).map(id => String(id || '')));
    return normalizeJobs(jobs).map(job => {
      if (!ids.has(String(job.id || ''))) return job;
      if (job.deliveryStatus === 'succeeded' || job.deliveryStatus === 'failed') return job;
      return Object.assign({}, job, {
        deliveryStatus: 'not_run',
        deliveryError: '',
        deliveryFailedStep: ''
      });
    });
  }

  function failedIdentity(item) {
    return typeof item === 'string' ? item : String((item && item.id) || '');
  }

  function migrate(jobs, processed, lastBatch) {
    const sent = processed || {};
    const sourceBatch = lastBatch || {};
    const batch = sourceBatch.mode && sourceBatch.mode !== 'live' ? {} : sourceBatch;
    const succeeded = new Set((batch.succeeded || []).map(id => String(id || '')));
    let result = normalizeJobs(jobs).map(job => {
      const id = String(job.id || '');
      if (!sent[id] && !succeeded.has(id)) return job;
      return Object.assign({}, job, {
        deliveryStatus: 'succeeded',
        deliveredAt: job.deliveredAt || Number(batch.finishedAt) || 0,
        deliveryError: '',
        deliveryFailedStep: ''
      });
    });
    (batch.failed || []).forEach(item => {
      const id = failedIdentity(item);
      result = markFailed(result, id, item && item.error, item && item.step);
    });
    return markNotRun(result, batch.notRun || []);
  }

  function activeJobs(jobs) {
    return normalizeJobs(jobs).filter(job => job.deliveryStatus !== 'succeeded');
  }

  function uniqueIds(values, mapper) {
    const ids = new Set();
    (Array.isArray(values) ? values : []).forEach(value => {
      const id = String(mapper ? mapper(value) : value || '');
      if (id) ids.add(id);
    });
    return ids;
  }

  function summarize(lastBatch) {
    const batch = lastBatch || {};
    const succeeded = uniqueIds(batch.succeeded);
    const failed = uniqueIds(batch.failed, failedIdentity);
    const notRun = uniqueIds(batch.notRun);
    const all = uniqueIds(batch.requestedIds);
    succeeded.forEach(id => all.add(id));
    failed.forEach(id => all.add(id));
    notRun.forEach(id => all.add(id));
    return {
      succeeded: succeeded.size,
      failed: failed.size,
      notRun: notRun.size,
      total: all.size
    };
  }

  function hasUnresolved(jobs) {
    return activeJobs(jobs).some(job => {
      if (job.deliveryStatus === 'failed' || job.deliveryStatus === 'not_run') return true;
      return ['pending_review', 'needs_info', 'approved'].indexOf(job.reviewStatus) >= 0;
    });
  }

  return {
    DELIVERY_STATUSES: DELIVERY_STATUSES,
    normalizeJob: normalizeJob,
    normalizeJobs: normalizeJobs,
    migrate: migrate,
    markSucceeded: markSucceeded,
    markFailed: markFailed,
    markNotRun: markNotRun,
    activeJobs: activeJobs,
    summarize: summarize,
    hasUnresolved: hasUnresolved
  };
});
