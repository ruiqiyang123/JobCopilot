(function initGreetingPlans(root, factory) {
  const api = factory();
  root.GreetingPlans = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createGreetingPlans() {
  'use strict';

  const DEFAULT_AI_INSTRUCTION = '结合完整 JD 和我的真实经历，选择最重要的 3 至 5 个匹配点，使用自然、真诚、适合 BOSS 聊天的中文，不虚构经历，结尾表达交流意愿。';

  function clean(value) { return String(value || '').trim(); }
  function createId() { return 'plan-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

  function normalizePlan(plan, legacy) {
    const source = plan || {};
    const old = legacy || {};
    return {
      id: clean(source.id) || createId(),
      name: clean(source.name) || '默认三段式招呼方案',
      aiOpeningEnabled: source.aiOpeningEnabled !== false,
      aiInstruction: clean(source.aiInstruction) || DEFAULT_AI_INSTRUCTION,
      fixedMessageEnabled: source.fixedMessageEnabled !== false,
      fixedMessage: source.fixedMessage === undefined ? clean(old.fixedMessage) : clean(source.fixedMessage),
      resumeImageEnabled: source.resumeImageEnabled !== false,
      resumeImage: source.resumeImage === undefined ? clean(old.resumeImage) : clean(source.resumeImage),
      createdAt: Number(source.createdAt) || Date.now(),
      updatedAt: Number(source.updatedAt) || Date.now()
    };
  }

  function defaultPlan(legacy) {
    return normalizePlan({ id: 'plan-default', name: '默认三段式招呼方案' }, legacy);
  }

  function normalizeState(value, legacy) {
    const source = value || {};
    const plans = Array.isArray(source.plans) && source.plans.length
      ? source.plans.map(plan => normalizePlan(plan, legacy))
      : [defaultPlan(legacy)];
    let selectedPlanId = clean(source.selectedPlanId);
    if (!plans.some(plan => plan.id === selectedPlanId)) selectedPlanId = plans[0].id;
    return { plans: plans, selectedPlanId: selectedPlanId };
  }

  function selectedPlan(state) {
    const normalized = normalizeState(state);
    return normalized.plans.find(plan => plan.id === normalized.selectedPlanId) || normalized.plans[0];
  }

  function upsertPlan(state, plan) {
    const normalizedState = normalizeState(state);
    const normalizedPlan = normalizePlan(plan);
    const plans = normalizedState.plans.slice();
    const index = plans.findIndex(item => item.id === normalizedPlan.id);
    if (index >= 0) {
      normalizedPlan.createdAt = plans[index].createdAt;
      normalizedPlan.updatedAt = Date.now();
      plans[index] = normalizedPlan;
    } else plans.push(normalizedPlan);
    return { plans: plans, selectedPlanId: normalizedState.selectedPlanId || normalizedPlan.id };
  }

  function selectPlan(state, planId) {
    const normalized = normalizeState(state);
    if (!normalized.plans.some(plan => plan.id === planId)) throw new Error('找不到招呼方案');
    normalized.selectedPlanId = planId;
    return normalized;
  }

  function removePlan(state, planId) {
    const normalized = normalizeState(state);
    if (normalized.plans.length <= 1) throw new Error('至少保留一套招呼方案');
    const plans = normalized.plans.filter(plan => plan.id !== planId);
    if (plans.length === normalized.plans.length) throw new Error('找不到招呼方案');
    return {
      plans: plans,
      selectedPlanId: normalized.selectedPlanId === planId ? plans[0].id : normalized.selectedPlanId
    };
  }

  function enabledSteps(plan) {
    const normalized = normalizePlan(plan);
    const steps = [];
    if (normalized.aiOpeningEnabled) steps.push('aiOpening');
    if (normalized.fixedMessageEnabled) steps.push('fixedMessage');
    if (normalized.resumeImageEnabled) steps.push('resumeImage');
    return steps;
  }

  function validateForSend(plan) {
    const normalized = normalizePlan(plan);
    if (!clean(normalized.name)) throw new Error('招呼方案名称不能为空');
    if (!enabledSteps(normalized).length) throw new Error('招呼方案至少启用一段内容');
    if (normalized.aiOpeningEnabled && !clean(normalized.aiInstruction)) throw new Error('AI 开场生成规则不能为空');
    if (normalized.fixedMessageEnabled && !clean(normalized.fixedMessage)) throw new Error('请填写固定补充消息');
    if (normalized.resumeImageEnabled && !/^data:image\//.test(normalized.resumeImage)) throw new Error('请上传招呼方案使用的简历图片');
    return normalized;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const result = {};
      Object.keys(value).sort().forEach(key => { result[key] = stableValue(value[key]); });
      return result;
    }
    return value;
  }

  function hashText(text) {
    let hash = 2166136261;
    const value = String(text || '');
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function fingerprint(plan) {
    const normalized = normalizePlan(plan);
    const relevant = {
      id: normalized.id,
      name: normalized.name,
      aiOpeningEnabled: normalized.aiOpeningEnabled,
      aiInstruction: normalized.aiInstruction,
      fixedMessageEnabled: normalized.fixedMessageEnabled,
      fixedMessage: normalized.fixedMessage,
      resumeImageEnabled: normalized.resumeImageEnabled,
      resumeImage: normalized.resumeImage
    };
    return hashText(JSON.stringify(stableValue(relevant)));
  }

  return {
    DEFAULT_AI_INSTRUCTION: DEFAULT_AI_INSTRUCTION,
    normalizePlan: normalizePlan,
    normalizeState: normalizeState,
    selectedPlan: selectedPlan,
    upsertPlan: upsertPlan,
    selectPlan: selectPlan,
    removePlan: removePlan,
    enabledSteps: enabledSteps,
    validateForSend: validateForSend,
    fingerprint: fingerprint,
    hashText: hashText
  };
});
