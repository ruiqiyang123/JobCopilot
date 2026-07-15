(function initModelRetry(root, factory) {
  const api = factory();
  root.ModelRetry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createModelRetry() {
  'use strict';

  const MAX_ATTEMPTS = 2;

  function shouldRetry(error, attempt) {
    if (Number(attempt) !== 0) return false;
    const text = String((error && error.message) || error || '');
    if (/API Key|权限|额度|受限|HTTP 4\d\d|无法解析|缺少文本|配置|用户取消/.test(text)) return false;
    return /模型请求超时|模型服务暂时不可用|网络|network|fetch|连接失败/i.test(text);
  }

  return {
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    shouldRetry: shouldRetry
  };
});
