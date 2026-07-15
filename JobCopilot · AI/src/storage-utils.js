(function initStorageUtils(root, factory) {
  const api = factory();
  root.StorageUtils = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createStorageUtils() {
  'use strict';

  const QUOTA_MESSAGE = '扩展本地存储空间不足，请重置旧批次或更换较小的简历图片';

  function messageOf(error) {
    if (error && error.message) return String(error.message);
    return String(error || '');
  }

  function isQuotaError(error) {
    const message = messageOf(error);
    return /kQuotaBytes|QUOTA_BYTES|quota[^\n]*exceed|exceed[^\n]*quota/i.test(message);
  }

  function toUserError(error) {
    if (isQuotaError(error)) {
      const converted = new Error(QUOTA_MESSAGE);
      converted.code = 'storage_quota_exceeded';
      return converted;
    }
    return error instanceof Error ? error : new Error(messageOf(error) || '本地存储失败');
  }

  return {
    QUOTA_MESSAGE: QUOTA_MESSAGE,
    isQuotaError: isQuotaError,
    toUserError: toUserError
  };
});
