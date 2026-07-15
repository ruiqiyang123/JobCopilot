const test = require('node:test');
const assert = require('node:assert/strict');

const ImageReceipt = require('../src/image-receipt.js');

function image(overrides) {
  return Object.assign({
    complete: true,
    naturalWidth: 900,
    naturalHeight: 1200,
    className: 'message-image',
    id: '',
    alt: '简历',
    offsetParent: {},
    getBoundingClientRect: () => ({ width: 180, height: 240 })
  }, overrides || {});
}

test('只有上传后新增且加载完成的本人消息图片才算回执', () => {
  const oldImage = image();
  const newImage = image();
  const before = new Set([oldImage]);
  assert.equal(ImageReceipt.findConfirmed([oldImage], before), null);
  assert.equal(ImageReceipt.findConfirmed([oldImage, newImage], before), newImage);
});

test('文字气泡增加、头像和未加载图片都不能冒充图片回执', () => {
  const before = new Set();
  const avatar = image({ className: 'avatar', naturalWidth: 200, naturalHeight: 200 });
  const pending = image({ complete: false, naturalWidth: 0, naturalHeight: 0 });
  assert.equal(ImageReceipt.findConfirmed([], before), null);
  assert.equal(ImageReceipt.findConfirmed([avatar, pending], before), null);
});
