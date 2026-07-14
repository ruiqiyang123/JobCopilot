const test = require('node:test');
const assert = require('node:assert/strict');

const MessageBundle = require('../src/message-bundle.js');

const BUNDLE = {
  aiOpening: 'AI 开场',
  fixedMessage: '固定消息',
  image: 'data:image/png;base64,AAAA'
};

test('三段消息严格按 AI 开场、固定消息、简历图片执行', async () => {
  const calls = [];
  const result = await MessageBundle.run(BUNDLE, {
    aiOpening: async value => { calls.push(['aiOpening', value]); return { ok: true }; },
    fixedMessage: async value => { calls.push(['fixedMessage', value]); return { ok: true }; },
    resumeImage: async value => { calls.push(['resumeImage', value]); return { ok: true }; }
  });
  assert.equal(result.success, true);
  assert.deepEqual(calls.map(call => call[0]), ['aiOpening', 'fixedMessage', 'resumeImage']);
});

test('任一步失败立即停止且不执行后续消息', async () => {
  for (const failedStep of ['aiOpening', 'fixedMessage', 'resumeImage']) {
    const calls = [];
    const handlers = {
      aiOpening: async () => { calls.push('aiOpening'); return { ok: failedStep !== 'aiOpening', error: '失败' }; },
      fixedMessage: async () => { calls.push('fixedMessage'); return { ok: failedStep !== 'fixedMessage', error: '失败' }; },
      resumeImage: async () => { calls.push('resumeImage'); return { ok: failedStep !== 'resumeImage', error: '失败' }; }
    };
    const result = await MessageBundle.run(BUNDLE, handlers);
    assert.equal(result.success, false);
    assert.equal(result.step, failedStep);
    assert.equal(calls[calls.length - 1], failedStep);
    assert.deepEqual(calls, ['aiOpening', 'fixedMessage', 'resumeImage'].slice(0, calls.length));
  }
});

test('未启用的空消息会跳过但至少需要一段内容', async () => {
  const calls = [];
  const result = await MessageBundle.run({ aiOpening: '仅开场' }, {
    aiOpening: async () => { calls.push('aiOpening'); return { ok: true }; },
    fixedMessage: async () => { calls.push('fixedMessage'); return { ok: true }; },
    resumeImage: async () => { calls.push('resumeImage'); return { ok: true }; }
  });
  assert.equal(result.success, true);
  assert.deepEqual(calls, ['aiOpening']);
  await assert.rejects(() => MessageBundle.run({}, {}), /没有可发送内容/);
});
