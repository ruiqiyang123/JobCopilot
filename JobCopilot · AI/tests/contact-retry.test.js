const test = require('node:test');
const assert = require('node:assert/strict');

const ContactRetry = require('../src/contact-retry.js');

function error(code) {
  const value = new Error(code);
  value.code = code;
  return value;
}

test('只允许第一次发送前缺少岗位 ID 时重试', () => {
  assert.equal(ContactRetry.MAX_ATTEMPTS, 2);
  assert.equal(ContactRetry.shouldRetry(error('missing_job_id'), {
    attempt: 0, sendStarted: false, aborted: false, paused: false
  }), true);
});

test('第二次缺少岗位 ID 或批次暂停中止时不再重试', () => {
  assert.equal(ContactRetry.shouldRetry(error('missing_job_id'), { attempt: 1 }), false);
  assert.equal(ContactRetry.shouldRetry(error('missing_job_id'), { attempt: 0, paused: true }), false);
  assert.equal(ContactRetry.shouldRetry(error('missing_job_id'), { attempt: 0, aborted: true }), false);
});

test('岗位不一致和其他建联错误不自动重试', () => {
  assert.equal(ContactRetry.shouldRetry(error('job_mismatch'), { attempt: 0 }), false);
  assert.equal(ContactRetry.shouldRetry(error('chat_timeout'), { attempt: 0 }), false);
  assert.equal(ContactRetry.shouldRetry(error('command_failed'), { attempt: 0 }), false);
});

test('任何消息已经开始发送后都不自动重试', () => {
  assert.equal(ContactRetry.shouldRetry(error('missing_job_id'), {
    attempt: 0, sendStarted: true
  }), false);
});
