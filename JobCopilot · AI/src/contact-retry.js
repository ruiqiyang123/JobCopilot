(function initContactRetry(root, factory) {
  const api = factory();
  root.ContactRetry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createContactRetry() {
  'use strict';

  const MAX_ATTEMPTS = 2;

  function shouldRetry(error, context) {
    const state = context || {};
    return !!error
      && error.code === 'missing_job_id'
      && Number(state.attempt) === 0
      && state.sendStarted !== true
      && state.aborted !== true
      && state.paused !== true;
  }

  return {
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    shouldRetry: shouldRetry
  };
});
