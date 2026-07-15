const test = require('node:test');
const assert = require('node:assert/strict');

const GreetingPlans = require('../src/greeting-plans.js');

test('首次使用创建一套三段式默认招呼方案', () => {
  const state = GreetingPlans.normalizeState();
  assert.equal(state.plans.length, 1);
  assert.equal(state.selectedPlanId, state.plans[0].id);
  assert.equal(state.plans[0].aiOpeningEnabled, true);
  assert.equal(state.plans[0].fixedMessageEnabled, true);
  assert.equal(state.plans[0].resumeImageEnabled, true);
});

test('招呼方案可新增、更新、选择和删除但至少保留一套', () => {
  let state = GreetingPlans.normalizeState();
  state = GreetingPlans.upsertPlan(state, {
    id: 'plan-2',
    name: '只发 AI 开场',
    aiOpeningEnabled: true,
    aiInstruction: '突出产品能力',
    fixedMessageEnabled: false,
    resumeImageEnabled: false
  });
  state = GreetingPlans.selectPlan(state, 'plan-2');
  assert.equal(GreetingPlans.selectedPlan(state).name, '只发 AI 开场');
  state = GreetingPlans.removePlan(state, 'plan-2');
  assert.equal(state.plans.length, 1);
  assert.throws(() => GreetingPlans.removePlan(state, state.plans[0].id), /至少保留一套/);
});

test('正式发送校验启用消息内容并按固定三段顺序返回', () => {
  const plan = GreetingPlans.normalizePlan({
    id: 'plan-1',
    name: 'AI 产品经理',
    aiOpeningEnabled: true,
    aiInstruction: '真实自然',
    fixedMessageEnabled: true,
    fixedMessage: '个人网站和 Agent',
    resumeImageEnabled: true,
    resumeImage: 'data:image/png;base64,AAAA'
  });
  assert.deepEqual(GreetingPlans.enabledSteps(plan), ['aiOpening', 'fixedMessage', 'resumeImage']);
  assert.doesNotThrow(() => GreetingPlans.validateForSend(plan));
  assert.throws(() => GreetingPlans.validateForSend(Object.assign({}, plan, { fixedMessage: '' })), /固定补充消息/);
});

test('方案内容变化会改变指纹', () => {
  const first = GreetingPlans.normalizePlan({ id: 'p', name: '方案', fixedMessage: 'A' });
  const second = Object.assign({}, first, { fixedMessage: 'B' });
  assert.notEqual(GreetingPlans.fingerprint(first), GreetingPlans.fingerprint(second));
});
