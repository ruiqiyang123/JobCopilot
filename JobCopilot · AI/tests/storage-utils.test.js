const test = require('node:test');
const assert = require('node:assert/strict');

const StorageUtils = require('../src/storage-utils.js');

test('识别 Chromium 和 Chrome Storage 的配额错误', () => {
  assert.equal(StorageUtils.isQuotaError(new Error('Resource::kQuotaBytes quota exceeded')), true);
  assert.equal(StorageUtils.isQuotaError(new Error('QUOTA_BYTES quota exceeded')), true);
  assert.equal(StorageUtils.isQuotaError(new Error('network timeout')), false);
});

test('配额错误转换成中文提示并保留其他错误', () => {
  const converted = StorageUtils.toUserError(new Error('Resource::kQuotaBytes quota exceeded'));
  assert.equal(converted.message, StorageUtils.QUOTA_MESSAGE);
  assert.equal(converted.code, 'storage_quota_exceeded');

  const original = new Error('普通存储错误');
  assert.equal(StorageUtils.toUserError(original), original);
});
