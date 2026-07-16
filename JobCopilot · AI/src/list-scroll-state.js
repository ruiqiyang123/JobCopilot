(function initListScrollState(root, factory) {
  const api = factory();
  root.ListScrollState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createListScrollState() {
  'use strict';

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function clamp(scrollTop, scrollHeight, clientHeight) {
    const maximum = Math.max(0, finite(scrollHeight) - finite(clientHeight));
    return Math.min(maximum, Math.max(0, finite(scrollTop)));
  }

  function capture(element) {
    return element ? Math.max(0, finite(element.scrollTop)) : 0;
  }

  function target(element, reset) {
    return reset ? 0 : capture(element);
  }

  function apply(element, scrollTop) {
    if (!element) return 0;
    const next = clamp(scrollTop, element.scrollHeight, element.clientHeight);
    element.scrollTop = next;
    return next;
  }

  return {
    clamp: clamp,
    capture: capture,
    target: target,
    apply: apply
  };
});
