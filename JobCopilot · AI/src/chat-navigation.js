(function initChatNavigation(root, factory) {
  const api = factory();
  root.ChatNavigation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createChatNavigation() {
  'use strict';

  function cleanJobId(value) {
    return String(value || '').trim();
  }

  function parseChatUrl(value) {
    let url;
    try { url = new URL(String(value || '')); }
    catch (error) { return { isChat: false, jobId: '', reason: '聊天页 URL 无效' }; }
    const host = String(url.hostname || '').toLowerCase();
    const bossHost = host === 'zhipin.com' || host.endsWith('.zhipin.com');
    const path = String(url.pathname || '').replace(/\/+$/, '');
    if (url.protocol !== 'https:' || !bossHost || path !== '/web/geek/chat') {
      return { isChat: false, jobId: '', reason: '当前页面不是 BOSS 聊天页' };
    }
    return {
      isChat: true,
      jobId: cleanJobId(url.searchParams.get('jobId')),
      reason: ''
    };
  }

  function matchChatUrl(value, expectedJobId) {
    const parsed = parseChatUrl(value);
    const expected = cleanJobId(expectedJobId);
    if (!parsed.isChat) return { ok: false, isChat: false, jobId: '', reason: parsed.reason };
    if (!parsed.jobId) {
      return { ok: false, isChat: true, jobId: '', reason: '聊天页缺少岗位 ID，已停止发送' };
    }
    if (!expected || parsed.jobId !== expected) {
      return {
        ok: false,
        isChat: true,
        jobId: parsed.jobId,
        reason: '聊天页岗位身份不一致，已停止发送'
      };
    }
    return { ok: true, isChat: true, jobId: parsed.jobId, reason: '' };
  }

  function shouldAwaitNavigation(error) {
    const text = String(error || '');
    return /message (?:channel|port).*closed|port.*closed.*response|message channel is closed/i.test(text)
      || text.indexOf('页面脚本响应超时') >= 0;
  }

  function navigationError(code, message, details) {
    const error = new Error(message);
    error.code = code;
    if (details && typeof details === 'object') Object.assign(error, details);
    return error;
  }

  function observe(tabsApi, options) {
    const config = options || {};
    if (!tabsApi || !tabsApi.onUpdated || !tabsApi.onCreated || typeof tabsApi.query !== 'function') {
      throw new Error('聊天页观察器缺少 Tabs API');
    }
    const sourceTabId = config.sourceTabId;
    const expectedJobId = cleanJobId(config.expectedJobId);
    if (sourceTabId === undefined || sourceTabId === null || !expectedJobId) {
      throw new Error('聊天页观察器缺少岗位身份');
    }
    const existingTabIds = new Set((config.existingTabIds || []).map(value => String(value)));
    existingTabIds.add(String(sourceTabId));
    const timeoutMs = Math.max(1, Number(config.timeoutMs) || 30000);
    const pollIntervalMs = Math.max(5, Number(config.pollIntervalMs) || 250);
    let settled = false;
    let scanning = false;
    let timeoutId = null;
    let pollId = null;
    let resolvePromise;
    let rejectPromise;

    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    function cleanup() {
      if (timeoutId) clearTimeout(timeoutId);
      if (pollId) clearInterval(pollId);
      timeoutId = null;
      pollId = null;
      tabsApi.onUpdated.removeListener(onUpdated);
      tabsApi.onCreated.removeListener(onCreated);
    }

    function succeed(result) {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(result);
    }

    function fail(code, message, details) {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(navigationError(code, message, details));
    }

    function relationFor(tab) {
      if (!tab || tab.id === undefined || tab.id === null) return '';
      if (String(tab.id) === String(sourceTabId)) return 'source';
      if (String(tab.openerTabId) === String(sourceTabId)) return 'child';
      if (!existingTabIds.has(String(tab.id))) return 'new';
      return '';
    }

    function inspect(tab) {
      if (settled || !tab) return;
      const parsed = parseChatUrl(tab.url || '');
      if (!parsed.isChat) return;
      const relation = relationFor(tab);
      if (!relation) return;
      const directlyRelated = relation === 'source' || relation === 'child';
      const failureDetails = {
        tabId: tab.id,
        created: String(tab.id) !== String(sourceTabId) && !existingTabIds.has(String(tab.id)),
        relation: relation
      };
      if (!parsed.jobId) {
        if (directlyRelated) {
          fail('missing_job_id', '聊天页缺少岗位 ID，已停止发送', failureDetails);
        }
        return;
      }
      if (parsed.jobId !== expectedJobId) {
        if (directlyRelated) {
          fail('job_mismatch', '聊天页岗位身份不一致，已停止发送', failureDetails);
        }
        return;
      }
      succeed({
        tab: Object.assign({}, tab),
        relation: relation,
        created: String(tab.id) !== String(sourceTabId) && !existingTabIds.has(String(tab.id)),
        jobId: parsed.jobId
      });
    }

    function onUpdated(tabId, changeInfo, tab) {
      const candidate = Object.assign({}, tab || {}, { id: tabId });
      if (changeInfo && changeInfo.url) candidate.url = changeInfo.url;
      inspect(candidate);
    }

    function onCreated(tab) {
      inspect(tab);
    }

    async function scan() {
      if (settled || scanning) return;
      if (typeof config.isCancelled === 'function' && config.isCancelled()) {
        fail('cancelled', '投递批次已停止');
        return;
      }
      scanning = true;
      try {
        const tabs = await tabsApi.query({});
        (tabs || []).forEach(inspect);
      } catch (error) {
        fail('tabs_query_failed', '聊天页观察失败：' + ((error && error.message) || '无法读取标签页'));
      } finally {
        scanning = false;
      }
    }

    tabsApi.onUpdated.addListener(onUpdated);
    tabsApi.onCreated.addListener(onCreated);
    pollId = setInterval(scan, pollIntervalMs);
    timeoutId = setTimeout(() => {
      const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
      fail('chat_timeout', '点击沟通后 ' + seconds + ' 秒内未进入对应岗位聊天页');
    }, timeoutMs);
    scan();

    return {
      promise: promise,
      cancel: function cancel() {
        if (settled) return;
        settled = true;
        cleanup();
        resolvePromise({ cancelled: true });
      }
    };
  }

  async function coordinate(commandPromise, observer, onAwaitingNavigation) {
    if (!observer || !observer.promise || typeof observer.cancel !== 'function') {
      throw new Error('聊天页观察器无效');
    }
    const navigationOutcome = observer.promise.then(
      value => ({ type: 'navigation', value: value }),
      error => ({ type: 'navigation_error', error: error })
    );
    const commandOutcome = Promise.resolve(commandPromise).then(
      value => ({ type: 'command', value: value }),
      error => ({
        type: 'command',
        value: { success: false, error: (error && error.message) || '点击沟通命令失败' }
      })
    );
    const first = await Promise.race([navigationOutcome, commandOutcome]);
    if (first.type === 'navigation_error') throw first.error;
    if (first.type === 'navigation') {
      if (first.value && first.value.cancelled) throw navigationError('cancelled', '投递批次已停止');
      return first.value;
    }

    const response = first.value || { success: false, error: '页面脚本没有响应' };
    if (!response.success && !shouldAwaitNavigation(response.error)) {
      observer.cancel();
      throw navigationError('command_failed', '建立沟通失败：' + (response.error || '未知错误'));
    }
    if (!response.success && typeof onAwaitingNavigation === 'function') {
      onAwaitingNavigation(response.error || '');
    }
    const destination = await observer.promise;
    if (destination && destination.cancelled) throw navigationError('cancelled', '投递批次已停止');
    return destination;
  }

  return {
    parseChatUrl: parseChatUrl,
    matchChatUrl: matchChatUrl,
    shouldAwaitNavigation: shouldAwaitNavigation,
    observe: observe,
    coordinate: coordinate
  };
});
