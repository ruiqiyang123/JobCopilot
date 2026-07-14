(function initMessageBundle(root, factory) {
  const api = factory();
  root.MessageBundle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createMessageBundle() {
  'use strict';

  const STEPS = Object.freeze([
    Object.freeze({ key: 'aiOpening', valueKey: 'aiOpening', label: 'AI 个性化开场' }),
    Object.freeze({ key: 'fixedMessage', valueKey: 'fixedMessage', label: '固定补充消息' }),
    Object.freeze({ key: 'resumeImage', valueKey: 'image', label: '简历图片' })
  ]);

  async function run(bundle, handlers) {
    const source = bundle || {};
    const senders = handlers || {};
    const enabled = STEPS.filter(step => String(source[step.valueKey] || '').trim());
    if (!enabled.length) throw new Error('三段式消息没有可发送内容');
    const completed = [];
    for (const step of enabled) {
      if (typeof senders[step.key] !== 'function') {
        return { success: false, step: step.key, stage: step.label, error: '缺少发送处理器', completed: completed };
      }
      let result;
      try { result = await senders[step.key](source[step.valueKey]); }
      catch (error) { result = { ok: false, error: error.message || '发送异常' }; }
      if (!result || result.ok !== true) {
        return {
          success: false,
          step: step.key,
          stage: step.label,
          error: (result && (result.error || result.err)) || '发送未确认',
          completed: completed
        };
      }
      completed.push(step.key);
    }
    return { success: true, completed: completed };
  }

  return { STEPS: STEPS, run: run };
});
