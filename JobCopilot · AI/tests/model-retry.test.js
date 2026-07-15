const test = require('node:test');
const assert = require('node:assert/strict');

const ModelRetry = require('../src/model-retry.js');

test('模型超时和瞬时服务错误只在第一次失败后重试', () => {
  assert.equal(ModelRetry.MAX_ATTEMPTS, 2);
  assert.equal(ModelRetry.shouldRetry(new Error('模型请求超时'), 0), true);
  assert.equal(ModelRetry.shouldRetry(new Error('模型服务暂时不可用'), 0), true);
  assert.equal(ModelRetry.shouldRetry(new Error('模型请求超时'), 1), false);
});

test('鉴权、额度和响应格式错误不重试', () => {
  assert.equal(ModelRetry.shouldRetry(new Error('API Key 或接口权限错误'), 0), false);
  assert.equal(ModelRetry.shouldRetry(new Error('模型请求受限或额度不足'), 0), false);
  assert.equal(ModelRetry.shouldRetry(new Error('模型返回了无法解析的数据'), 0), false);
});
