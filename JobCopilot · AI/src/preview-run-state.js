(function initPreviewRunState(root, factory) {
  const api = factory();
  root.PreviewRunState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createPreviewRunState() {
  'use strict';

  const STAGES = Object.freeze([
    'queued', 'reading_detail', 'verifying', 'generating_opening',
    'draft', 'failed', 'not_run'
  ]);

  const STAGE_LABELS = Object.freeze({
    queued: '排队等待',
    reading_detail: '正在读取完整 JD…',
    verifying: '正在二次校验岗位…',
    generating_opening: '正在生成 AI 个性化开场…',
    draft: '预演已生成，等待确认',
    failed: '预演失败',
    not_run: '本批次未执行'
  });

  function cleanIds(jobIds) {
    return Array.from(new Set((Array.isArray(jobIds) ? jobIds : [])
      .map(id => String(id || '').trim()).filter(Boolean)));
  }

  function clone(state) {
    const source = state || {};
    const jobs = {};
    Object.keys(source.jobs || {}).forEach(id => {
      jobs[id] = Object.assign({}, source.jobs[id]);
    });
    return Object.assign({}, source, { jobs: jobs });
  }

  function start(jobIds, runId) {
    const ids = cleanIds(jobIds);
    const jobs = {};
    ids.forEach(id => { jobs[id] = { stage: 'queued', error: '' }; });
    return {
      runId: String(runId || ''),
      status: 'running',
      completed: 0,
      total: ids.length,
      error: '',
      jobs: jobs
    };
  }

  function attach(state, runId, jobIds) {
    const next = clone(state);
    next.runId = String(runId || next.runId || '');
    cleanIds(jobIds).forEach(id => {
      if (!next.jobs[id]) next.jobs[id] = { stage: 'queued', error: '' };
    });
    next.total = cleanIds(jobIds).length || next.total || Object.keys(next.jobs).length;
    return next;
  }

  function applyProgress(state, event) {
    const next = clone(state);
    const message = event || {};
    const runId = String(message.runId || '');
    const jobId = String(message.jobId || '');
    if (!next || next.status !== 'running') return next;
    if (next.runId && runId && next.runId !== runId) return next;
    if (!next.runId && runId) next.runId = runId;
    if (!jobId || !next.jobs[jobId]) return next;
    if (STAGES.indexOf(message.stage) < 0) return next;
    next.jobs[jobId] = {
      stage: message.stage,
      error: String(message.error || '')
    };
    if (Number.isFinite(message.completed)) next.completed = Math.max(0, Number(message.completed));
    if (Number.isFinite(message.total) && Number(message.total) > 0) next.total = Number(message.total);
    if (message.stage === 'failed') next.error = String(message.error || '预演失败');
    return next;
  }

  function failStart(state, error) {
    const next = clone(state);
    next.status = 'failed';
    next.error = String(error || '预演启动失败');
    Object.keys(next.jobs).forEach(id => {
      next.jobs[id] = { stage: 'not_run', error: '' };
    });
    return next;
  }

  function finish(state, status, error) {
    const next = clone(state);
    next.status = ['completed', 'failed', 'stopped'].indexOf(status) >= 0 ? status : 'completed';
    if (error) next.error = String(error);
    return next;
  }

  function isRunning(state) {
    return Boolean(state && state.status === 'running');
  }

  function jobState(state, jobId) {
    return state && state.jobs ? state.jobs[jobId] || null : null;
  }

  return {
    STAGES: STAGES,
    STAGE_LABELS: STAGE_LABELS,
    start: start,
    attach: attach,
    applyProgress: applyProgress,
    failStart: failStart,
    finish: finish,
    isRunning: isRunning,
    jobState: jobState
  };
});
