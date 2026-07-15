const test = require('node:test');
const assert = require('node:assert/strict');

const DetailReadiness = require('../src/detail-readiness.js');

test('完整 JD 出现即视为详情页业务就绪', () => {
  assert.equal(DetailReadiness.classify({
    success: true, jd: '岗位职责与任职要求', currentJob: { id: 'job-1' }
  }), 'ready');
});

test('区分登录、风控、下架和持续加载', () => {
  assert.equal(DetailReadiness.classify({ error: '请先登录后查看' }), 'login_required');
  assert.equal(DetailReadiness.classify({ error: '访问异常，请完成人机验证' }), 'risk_control');
  assert.equal(DetailReadiness.classify({ unavailable: true }), 'job_unavailable');
  assert.equal(DetailReadiness.classify({ success: true, jd: '' }), 'detail_loading');
});

test('只有瞬时详情错误允许重试，登录和风控属于全局阻断', () => {
  assert.equal(DetailReadiness.shouldRetry('detail_timeout'), true);
  assert.equal(DetailReadiness.shouldRetry('script_unavailable'), true);
  assert.equal(DetailReadiness.shouldRetry('job_unavailable'), false);
  assert.equal(DetailReadiness.isGlobal('login_required'), true);
  assert.equal(DetailReadiness.isGlobal('risk_control'), true);
  assert.equal(DetailReadiness.isGlobal('detail_timeout'), false);
});

test('详情错误保留机器码、全局阻断和重试属性', () => {
  const timeout = DetailReadiness.error('detail_timeout');
  assert.equal(timeout.code, 'detail_timeout');
  assert.equal(timeout.retryable, true);
  assert.equal(timeout.globalBlock, false);
  const login = DetailReadiness.error('login_required');
  assert.equal(login.globalBlock, true);
  assert.match(login.message, /登录已失效/);
});
