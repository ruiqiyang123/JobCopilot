(function initJobTracker(root, factory) {
  const api = factory();
  root.JobTracker = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createJobTracker() {
  'use strict';

  const STATUS_OPTIONS = Object.freeze([
    Object.freeze({ value: 'collected', label: '已收集' }),
    Object.freeze({ value: 'contacted', label: '已沟通' }),
    Object.freeze({ value: 'replied', label: '已回复' }),
    Object.freeze({ value: 'interview', label: '面试' }),
    Object.freeze({ value: 'rejected', label: '淘汰' }),
    Object.freeze({ value: 'offer', label: 'Offer' })
  ]);
  const STATUS_VALUES = STATUS_OPTIONS.map(option => option.value);

  function cloneRecord(record) {
    return Object.assign({}, record, {
      history: Array.isArray(record.history)
        ? record.history.map(item => Object.assign({}, item))
        : []
    });
  }

  function cloneRecords(records) {
    return (Array.isArray(records) ? records : []).map(cloneRecord);
  }

  function timeOrNow(at) {
    return Number.isFinite(at) ? at : Date.now();
  }

  function upsertCollected(records, job, at) {
    const source = job || {};
    if (!source.id) throw new Error('岗位记录缺少 ID');
    const next = cloneRecords(records);
    const index = next.findIndex(record => record.id === source.id);
    if (index < 0) {
      const timestamp = timeOrNow(at);
      next.push({
        id: source.id,
        name: source.name || '',
        company: source.company || '',
        salary: source.salary || '',
        link: source.link || '',
        status: 'collected',
        updatedAt: timestamp,
        history: [{ status: 'collected', at: timestamp }]
      });
      return next;
    }

    const current = next[index];
    ['name', 'company', 'salary', 'link'].forEach(field => {
      if (source[field]) current[field] = source[field];
    });
    return next;
  }

  function setStatus(records, jobId, status, at) {
    if (STATUS_VALUES.indexOf(status) < 0) throw new Error('不支持的岗位状态');
    const next = cloneRecords(records);
    const index = next.findIndex(record => record.id === jobId);
    if (index < 0) throw new Error('找不到岗位记录');
    if (next[index].status === status) return next;

    const timestamp = timeOrNow(at);
    next[index].status = status;
    next[index].updatedAt = timestamp;
    next[index].history.push({ status: status, at: timestamp });
    return next;
  }

  function summarize(records) {
    const summary = { total: 0 };
    STATUS_VALUES.forEach(status => { summary[status] = 0; });
    (Array.isArray(records) ? records : []).forEach(record => {
      summary.total++;
      if (STATUS_VALUES.indexOf(record.status) >= 0) summary[record.status]++;
    });
    return summary;
  }

  function labelFor(status) {
    const option = STATUS_OPTIONS.find(item => item.value === status);
    return option ? option.label : '未知状态';
  }

  return {
    STATUS_OPTIONS: STATUS_OPTIONS,
    upsertCollected: upsertCollected,
    setStatus: setStatus,
    summarize: summarize,
    labelFor: labelFor
  };
});
