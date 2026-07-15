(function initDetailReadiness(root, factory) {
  const api = factory();
  root.DetailReadiness = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createDetailReadiness() {
  'use strict';

  const GLOBAL_CODES = Object.freeze(['login_required', 'risk_control']);
  const RETRYABLE_CODES = Object.freeze(['detail_loading', 'detail_timeout', 'tab_network_error', 'script_unavailable']);

  function textOf(response) {
    return String((response && (response.error || response.message)) || '');
  }

  function classify(response) {
    const source = response || {};
    const explicit = String(source.status || source.code || '');
    if (explicit) return explicit;
    if (source.success && String(source.jd || (source.currentJob && source.currentJob.jd) || '').trim()) {
      return 'ready';
    }
    if (source.unavailable) return 'job_unavailable';
    const text = textOf(source);
    if (/登录|请先登录|重新登录/.test(text)) return 'login_required';
    if (/安全验证|人机验证|访问异常|滑块|验证码/.test(text)) return 'risk_control';
    if (/下线|停止招聘|职位不存在|岗位不存在/.test(text)) return 'job_unavailable';
    if (/不是有效的岗位详情页|非预期页面/.test(text)) return 'invalid_page';
    return 'detail_loading';
  }

  function isGlobal(codeOrError) {
    const code = typeof codeOrError === 'string'
      ? codeOrError
      : String((codeOrError && codeOrError.code) || '');
    return GLOBAL_CODES.indexOf(code) >= 0;
  }

  function shouldRetry(codeOrError) {
    const code = typeof codeOrError === 'string'
      ? codeOrError
      : String((codeOrError && codeOrError.code) || '');
    return RETRYABLE_CODES.indexOf(code) >= 0;
  }

  function messageFor(code) {
    const messages = {
      login_required: 'BOSS 登录已失效，请重新登录后重试',
      risk_control: 'BOSS 出现安全验证，已停止整个批次',
      job_unavailable: '岗位已下架或停止招聘',
      invalid_page: '岗位详情跳转到了非预期页面',
      detail_timeout: '岗位详情在两次尝试后仍未就绪',
      tab_network_error: '岗位详情页网络加载失败',
      script_unavailable: '岗位详情页脚本暂时无法读取'
    };
    return messages[code] || '岗位详情尚未就绪';
  }

  function error(code, message) {
    const value = new Error(message || messageFor(code));
    value.code = String(code || 'detail_error');
    value.globalBlock = isGlobal(value.code);
    value.retryable = shouldRetry(value.code);
    return value;
  }

  return {
    GLOBAL_CODES: GLOBAL_CODES,
    RETRYABLE_CODES: RETRYABLE_CODES,
    classify: classify,
    isGlobal: isGlobal,
    shouldRetry: shouldRetry,
    messageFor: messageFor,
    error: error
  };
});
