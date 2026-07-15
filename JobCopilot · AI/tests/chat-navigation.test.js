const test = require('node:test');
const assert = require('node:assert/strict');

const ChatNavigation = require('../src/chat-navigation.js');

const JOB_ID = '9f3e136d059bb84a0nF83967FlRQ';
const DETAIL_URL = 'https://www.zhipin.com/job_detail/' + JOB_ID + '.html';
const CHAT_URL = 'https://www.zhipin.com/web/geek/chat?id=conversation&jobId=' + JOB_ID + '&securityId=secret';

class FakeEvent {
  constructor() { this.listeners = new Set(); }
  addListener(listener) { this.listeners.add(listener); }
  removeListener(listener) { this.listeners.delete(listener); }
  emit(...args) { Array.from(this.listeners).forEach(listener => listener(...args)); }
  get size() { return this.listeners.size; }
}

class FakeTabs {
  constructor(tabs) {
    this.values = (tabs || []).map(tab => Object.assign({}, tab));
    this.onUpdated = new FakeEvent();
    this.onCreated = new FakeEvent();
  }

  async query() { return this.values.map(tab => Object.assign({}, tab)); }

  add(tab) {
    const value = Object.assign({}, tab);
    this.values.push(value);
    this.onCreated.emit(Object.assign({}, value));
  }

  update(tabId, changeInfo) {
    const tab = this.values.find(item => item.id === tabId);
    if (!tab) throw new Error('未找到测试标签页');
    Object.assign(tab, changeInfo || {});
    this.onUpdated.emit(tabId, Object.assign({}, changeInfo), Object.assign({}, tab));
  }
}

function observe(tabs, overrides) {
  return ChatNavigation.observe(tabs, Object.assign({
    sourceTabId: 1,
    expectedJobId: JOB_ID,
    existingTabIds: [1],
    timeoutMs: 120,
    pollIntervalMs: 5
  }, overrides || {}));
}

test('解析合法 BOSS 聊天 URL 并严格匹配岗位 ID', () => {
  const parsed = ChatNavigation.parseChatUrl(CHAT_URL);
  assert.equal(parsed.isChat, true);
  assert.equal(parsed.jobId, JOB_ID);
  assert.equal(ChatNavigation.matchChatUrl(CHAT_URL, JOB_ID).ok, true);
  assert.equal(ChatNavigation.matchChatUrl(CHAT_URL, 'other-job').ok, false);
});

test('拒绝非 HTTPS、非 BOSS、非聊天路径和缺少 jobId 的 URL', () => {
  assert.equal(ChatNavigation.parseChatUrl('http://www.zhipin.com/web/geek/chat?jobId=' + JOB_ID).isChat, false);
  assert.equal(ChatNavigation.parseChatUrl('https://example.com/web/geek/chat?jobId=' + JOB_ID).isChat, false);
  assert.equal(ChatNavigation.parseChatUrl(DETAIL_URL).isChat, false);
  const missing = ChatNavigation.matchChatUrl('https://www.zhipin.com/web/geek/chat?id=conversation', JOB_ID);
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /缺少岗位 ID/);
});

test('只将页面导航造成的消息通道关闭和页面脚本超时视为可等待', () => {
  assert.equal(ChatNavigation.shouldAwaitNavigation(
    'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'
  ), true);
  assert.equal(ChatNavigation.shouldAwaitNavigation('The message port closed before a response was received.'), true);
  assert.equal(ChatNavigation.shouldAwaitNavigation('页面脚本响应超时，请刷新扩展后重试'), true);
  assert.equal(ChatNavigation.shouldAwaitNavigation('未找到立即沟通按钮'), false);
  assert.equal(ChatNavigation.shouldAwaitNavigation('Could not establish connection. Receiving end does not exist.'), false);
});

test('观察原详情标签页进入对应岗位聊天页', async () => {
  const tabs = new FakeTabs([{ id: 1, url: DETAIL_URL, status: 'complete' }]);
  const observer = observe(tabs);
  tabs.update(1, { url: CHAT_URL, status: 'loading' });
  const result = await observer.promise;
  assert.equal(result.tab.id, 1);
  assert.equal(result.created, false);
  assert.equal(result.relation, 'source');
  assert.equal(tabs.onUpdated.size, 0);
  assert.equal(tabs.onCreated.size, 0);
});

test('观察由原详情页打开的新聊天标签页', async () => {
  const tabs = new FakeTabs([{ id: 1, url: DETAIL_URL, status: 'complete' }]);
  const observer = observe(tabs);
  tabs.add({ id: 2, openerTabId: 1, url: 'about:blank', status: 'loading' });
  tabs.update(2, { url: CHAT_URL, status: 'loading' });
  const result = await observer.promise;
  assert.equal(result.tab.id, 2);
  assert.equal(result.created, true);
  assert.equal(result.relation, 'child');
});

test('接受点击后新建且 jobId 精确匹配的 noopener 标签页', async () => {
  const tabs = new FakeTabs([{ id: 1, url: DETAIL_URL, status: 'complete' }]);
  const observer = observe(tabs);
  tabs.add({ id: 3, url: CHAT_URL, status: 'loading' });
  const result = await observer.promise;
  assert.equal(result.tab.id, 3);
  assert.equal(result.created, true);
  assert.equal(result.relation, 'new');
});

test('忽略用户同时打开的无关聊天标签', async () => {
  const tabs = new FakeTabs([{ id: 1, url: DETAIL_URL, status: 'complete' }]);
  const observer = observe(tabs);
  tabs.add({ id: 4, url: 'https://www.zhipin.com/web/geek/chat?jobId=unrelated', status: 'complete' });
  tabs.update(1, { url: CHAT_URL, status: 'loading' });
  const result = await observer.promise;
  assert.equal(result.tab.id, 1);
});

test('原标签或其子标签进入错误岗位时立即阻止', async () => {
  const sourceTabs = new FakeTabs([{ id: 1, url: DETAIL_URL, status: 'complete' }]);
  const sourceObserver = observe(sourceTabs);
  sourceTabs.update(1, { url: 'https://www.zhipin.com/web/geek/chat?jobId=wrong', status: 'loading' });
  await assert.rejects(sourceObserver.promise, /岗位身份不一致/);

  const childTabs = new FakeTabs([{ id: 1, url: DETAIL_URL, status: 'complete' }]);
  const childObserver = observe(childTabs);
  childTabs.add({
    id: 2, openerTabId: 1,
    url: 'https://www.zhipin.com/web/geek/chat?jobId=wrong', status: 'loading'
  });
  await assert.rejects(childObserver.promise, error => {
    assert.match(error.message, /岗位身份不一致/);
    assert.equal(error.tabId, 2);
    assert.equal(error.created, true);
    assert.equal(error.relation, 'child');
    return true;
  });
});

test('超时和主动取消都会清理事件监听', async () => {
  const timeoutTabs = new FakeTabs([{ id: 1, url: DETAIL_URL, status: 'complete' }]);
  const timeoutObserver = observe(timeoutTabs, { timeoutMs: 25, pollIntervalMs: 5 });
  await assert.rejects(timeoutObserver.promise, /未进入对应岗位聊天页/);
  assert.equal(timeoutTabs.onUpdated.size, 0);
  assert.equal(timeoutTabs.onCreated.size, 0);

  const cancelTabs = new FakeTabs([{ id: 1, url: DETAIL_URL, status: 'complete' }]);
  const cancelObserver = observe(cancelTabs);
  cancelObserver.cancel();
  const cancelled = await cancelObserver.promise;
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelTabs.onUpdated.size, 0);
  assert.equal(cancelTabs.onCreated.size, 0);
});

test('批次中止会在下一次观察时停止并清理监听', async () => {
  let aborted = false;
  const tabs = new FakeTabs([{ id: 1, url: DETAIL_URL, status: 'complete' }]);
  const observer = observe(tabs, {
    pollIntervalMs: 5,
    isCancelled: () => aborted
  });
  aborted = true;
  await assert.rejects(observer.promise, /批次已停止/);
  assert.equal(tabs.onUpdated.size, 0);
  assert.equal(tabs.onCreated.size, 0);
});

test('消息通道关闭但观察到聊天页时继续', async () => {
  let awaitingReason = '';
  const destination = { tab: { id: 1, url: CHAT_URL }, created: false, relation: 'source' };
  const observer = {
    promise: new Promise(resolve => setTimeout(() => resolve(destination), 5)),
    cancel() {}
  };
  const result = await ChatNavigation.coordinate(Promise.resolve({
    success: false,
    error: 'The message port closed before a response was received.'
  }), observer, reason => { awaitingReason = reason; });
  assert.equal(result.tab.id, 1);
  assert.equal(awaitingReason, 'The message port closed before a response was received.');
});

test('已找到聊天页时不等待已销毁的内容脚本回执', async () => {
  const destination = { tab: { id: 2, url: CHAT_URL }, created: true, relation: 'child' };
  const observer = { promise: Promise.resolve(destination), cancel() {} };
  const neverResponds = new Promise(() => {});
  const result = await ChatNavigation.coordinate(neverResponds, observer);
  assert.equal(result.tab.id, 2);
});

test('未找到沟通按钮等明确错误会取消观察并立即失败', async () => {
  let cancelled = false;
  const observer = { promise: new Promise(() => {}), cancel() { cancelled = true; } };
  await assert.rejects(ChatNavigation.coordinate(Promise.resolve({
    success: false,
    error: '未找到立即沟通按钮'
  }), observer), /建立沟通失败：未找到立即沟通按钮/);
  assert.equal(cancelled, true);
});
