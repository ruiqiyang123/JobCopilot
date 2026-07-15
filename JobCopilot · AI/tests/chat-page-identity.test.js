const test = require('node:test');
const assert = require('node:assert/strict');

const ChatPageIdentity = require('../src/chat-page-identity.js');

test('从岗位详情链接和查询参数提取稳定岗位 ID', () => {
  assert.equal(
    ChatPageIdentity.idFromUrl('https://www.zhipin.com/job_detail/abc123.html'),
    'abc123'
  );
  assert.equal(
    ChatPageIdentity.idFromUrl('https://www.zhipin.com/web/geek/chat?jobId=job-2'),
    'job-2'
  );
});

test('页面稳定岗位 ID 必须精确匹配', () => {
  assert.equal(ChatPageIdentity.match('job-1', { status: 'confirmed', jobId: 'job-1' }).ok, true);
  assert.equal(ChatPageIdentity.match('job-1', { status: 'confirmed', jobId: 'job-2' }).code, 'job_mismatch');
  assert.equal(ChatPageIdentity.match('job-1', { status: 'unknown', jobId: '' }).code, 'missing_job_id');
  assert.equal(ChatPageIdentity.match('job-1', { status: 'ambiguous', ids: ['job-1', 'job-2'] }).code, 'ambiguous_job_id');
});

function fakeDocument(hrefs, dataIds) {
  const links = (hrefs || []).map(href => ({
    getAttribute(name) { return name === 'href' ? href : ''; }, href: href
  }));
  const data = (dataIds || []).map(id => ({
    getAttribute(name) { return name === 'data-job-id' ? id : ''; }
  }));
  const scope = {
    querySelectorAll(selector) {
      return selector.indexOf('data-job') >= 0 ? data : links;
    }
  };
  return {
    documentElement: {},
    querySelectorAll(selector) {
      return selector === '[data-current-conversation]' ? [scope] : [];
    }
  };
}

test('只接受当前会话区域内唯一的稳定岗位 ID', () => {
  const confirmed = ChatPageIdentity.extract(fakeDocument([
    'https://www.zhipin.com/job_detail/job-1.html'
  ]));
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.jobId, 'job-1');

  const ambiguous = ChatPageIdentity.extract(fakeDocument([
    'https://www.zhipin.com/job_detail/job-1.html',
    'https://www.zhipin.com/job_detail/job-2.html'
  ]));
  assert.equal(ambiguous.status, 'ambiguous');
});
