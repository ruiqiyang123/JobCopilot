const test = require('node:test');
const assert = require('node:assert/strict');

const ContactInterstitial = require('../src/contact-interstitial.js');

function node(text, options) {
  const config = options || {};
  const attributes = Object.assign({}, config.attributes || {});
  const value = {
    textContent: text || '',
    innerText: text || '',
    className: config.className || '',
    visible: config.visible !== false,
    getAttribute(name) { return attributes[name] || ''; },
    querySelectorAll() { return config.children || []; },
    matches() { return config.clickable === true; },
    closest() { return null; },
    contains(candidate) { return (config.children || []).indexOf(candidate) >= 0; }
  };
  return value;
}

function root(dialogs) {
  return { querySelectorAll() { return dialogs || []; } };
}

const visible = value => value.visible !== false;

test('只识别同时包含标题和微信订阅说明的弹窗', () => {
  assert.equal(ContactInterstitial.isSubscriptionText(
    '订阅回复消息 在微信上实时收到他的回复 使用微信扫码订阅'
  ), true);
  assert.equal(ContactInterstitial.isSubscriptionText('订阅回复消息'), false);
  assert.equal(ContactInterstitial.isSubscriptionText('登录后继续沟通'), false);

  const login = node('请登录后继续沟通');
  const subscription = node('订阅回复消息 在微信上实时收到他的回复 使用微信扫码订阅');
  assert.equal(ContactInterstitial.findSubscriptionDialog(root([login, subscription]), visible), subscription);
});

test('嵌套容器同时匹配时优先选择包含唯一关闭控件的目标弹窗', () => {
  const close = node('', { className: 'dialog-close', clickable: true });
  const inner = node('订阅回复消息 在微信上实时收到他的回复 使用微信扫码订阅');
  const outer = node('其他页面内容 订阅回复消息 在微信上实时收到他的回复 使用微信扫码订阅 更多内容', {
    children: [inner, close]
  });
  assert.equal(ContactInterstitial.findSubscriptionDialog(root([outer, inner]), visible), outer);
});

test('只接受目标弹窗内部唯一且有关闭语义的控件', () => {
  const close = node('', { className: 'dialog-close', clickable: true });
  const dialog = node('订阅回复消息 在微信上实时收到他的回复', { children: [close] });
  const result = ContactInterstitial.inspect(root([dialog]), visible);
  assert.equal(result.found, true);
  assert.equal(result.closeButton, close);
  assert.equal(result.error, '');
});

test('关闭控件缺失或不唯一时拒绝猜测点击', () => {
  const first = node('关闭', { className: 'dialog-close', clickable: true });
  const second = node('×', { className: 'modal-close', clickable: true });
  const missing = node('订阅回复消息 使用微信扫码订阅', { children: [] });
  const ambiguous = node('订阅回复消息 使用微信扫码订阅', { children: [first, second] });

  assert.equal(ContactInterstitial.inspect(root([missing]), visible).closeButton, null);
  const result = ContactInterstitial.inspect(root([ambiguous]), visible);
  assert.equal(result.closeButton, null);
  assert.match(result.error, /阻止沟通/);
});

test('不可见的目标弹窗和关闭控件不会被使用', () => {
  const close = node('', { className: 'dialog-close', clickable: true, visible: false });
  const dialog = node('订阅回复消息 使用微信扫码订阅', { children: [close] });
  assert.equal(ContactInterstitial.inspect(root([dialog]), visible).closeButton, null);
  dialog.visible = false;
  assert.equal(ContactInterstitial.inspect(root([dialog]), visible).found, false);
});

test('未知弹窗类名时可从精确标题向上找到订阅容器', () => {
  const close = node('', { className: 'icon-close', clickable: true });
  const dialog = node('订阅回复消息 在微信上实时收到他的回复 使用微信扫码订阅', {
    children: [close]
  });
  const title = node('订阅回复消息');
  title.parentElement = dialog;
  const document = {
    querySelectorAll(selector) {
      if (selector === ContactInterstitial.DIALOG_SELECTOR) return [];
      if (selector === ContactInterstitial.TITLE_SELECTOR) return [title];
      return [];
    }
  };
  assert.equal(ContactInterstitial.findSubscriptionDialog(document, visible), dialog);
});
