(function initChatPageIdentity(root, factory) {
  const api = factory();
  root.ChatPageIdentity = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createChatPageIdentity() {
  'use strict';

  const CURRENT_SCOPES = [
    '[data-current-conversation]', '.chat-conversation', '.conversation-content',
    '.chat-content', '.chat-main', '.chat-panel', '[class*="conversation-content"]'
  ];

  function clean(value) { return String(value || '').trim(); }

  function idFromUrl(value) {
    let url;
    try { url = new URL(clean(value), 'https://www.zhipin.com'); }
    catch (error) { return ''; }
    const queryId = clean(url.searchParams.get('jobId'));
    if (queryId) return queryId;
    const match = String(url.pathname || '').match(/\/job_detail\/([^/.?#]+)(?:\.html)?/i);
    return match ? clean(match[1]) : '';
  }

  function idsWithin(scope) {
    const ids = new Set();
    if (!scope || typeof scope.querySelectorAll !== 'function') return ids;
    scope.querySelectorAll('[data-job-id], [data-jobid]').forEach(element => {
      const value = clean(element.getAttribute('data-job-id') || element.getAttribute('data-jobid'));
      if (value) ids.add(value);
    });
    scope.querySelectorAll('a[href*="/job_detail/"], a[href*="jobId="]').forEach(element => {
      const value = idFromUrl(element.getAttribute('href') || element.href || '');
      if (value) ids.add(value);
    });
    return ids;
  }

  function extract(root) {
    const documentRoot = root && root.documentElement ? root : null;
    if (!documentRoot) return { status: 'unknown', jobId: '', ids: [] };
    let scopes = [];
    for (const selector of CURRENT_SCOPES) {
      scopes = Array.from(documentRoot.querySelectorAll(selector));
      if (scopes.length) break;
    }
    if (!scopes.length) scopes = [documentRoot];
    const ids = new Set();
    scopes.forEach(scope => idsWithin(scope).forEach(id => ids.add(id)));
    const values = Array.from(ids);
    if (values.length === 1) return { status: 'confirmed', jobId: values[0], ids: values };
    if (values.length > 1) return { status: 'ambiguous', jobId: '', ids: values };
    return { status: 'unknown', jobId: '', ids: [] };
  }

  function match(expectedJobId, pageIdentity) {
    const expected = clean(expectedJobId);
    const identity = pageIdentity || {};
    if (identity.status === 'ambiguous') {
      return { ok: false, code: 'ambiguous_job_id', reason: '聊天页出现多个岗位 ID，已停止发送' };
    }
    const actual = clean(identity.jobId);
    if (!actual) return { ok: false, code: 'missing_job_id', reason: '聊天页缺少岗位 ID，已停止发送' };
    if (!expected || actual !== expected) {
      return { ok: false, code: 'job_mismatch', reason: '聊天页岗位身份不一致，已停止发送' };
    }
    return { ok: true, code: '', reason: '', jobId: actual };
  }

  return {
    CURRENT_SCOPES: CURRENT_SCOPES,
    idFromUrl: idFromUrl,
    extract: extract,
    match: match
  };
});
