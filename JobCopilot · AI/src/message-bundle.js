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
    const warnings = [];
    const hasText = enabled.some(step => step.key === 'aiOpening' || step.key === 'fixedMessage');
    for (const step of enabled) {
      if (typeof senders[step.key] !== 'function') {
        return { success: false, step: step.key, stage: step.label, error: '缺少发送处理器', completed: completed };
      }
      let result;
      try { result = await senders[step.key](source[step.valueKey]); }
      catch (error) { result = { ok: false, error: error.message || '发送异常' }; }
      if (!result || result.ok !== true) {
        const error = (result && (result.error || result.err)) || '发送未确认';
        if (step.key === 'resumeImage' && hasText) {
          warnings.push({ step: step.key, stage: step.label, error: error });
          continue;
        }
        return {
          success: false,
          step: step.key,
          stage: step.label,
          error: error,
          completed: completed,
          warnings: warnings,
          imageConfirmed: false
        };
      }
      completed.push(step.key);
    }
    const imageEnabled = enabled.some(step => step.key === 'resumeImage');
    return {
      success: true,
      completed: completed,
      warnings: warnings,
      imageConfirmed: imageEnabled ? completed.indexOf('resumeImage') >= 0 : null
    };
  }

  return { STEPS: STEPS, run: run };
});
