const test = require('node:test');
const assert = require('node:assert/strict');

const SearchStrategy = require('../src/search-strategy.js');

test('解析多种分隔符并按大小写和空白去重', () => {
  assert.deepEqual(
    SearchStrategy.parseKeywords('AI 产品经理，AI Agent 产品经理\n ai  产品经理；大模型产品经理'),
    ['AI 产品经理', 'AI Agent 产品经理', '大模型产品经理']
  );
});

test('精准模式只使用用户关键词', () => {
  const terms = SearchStrategy.resolveTerms({
    keyword: 'AI 产品经理、智能体产品经理',
    matchMode: 'precise',
    keywordExpansionEnabled: true
  });
  assert.deepEqual(terms, ['AI 产品经理', '智能体产品经理']);
});

test('平衡模式扩展 AI 产品同义词且保留用户顺序', () => {
  const terms = SearchStrategy.resolveTerms({
    keyword: 'AI 产品经理',
    matchMode: 'balanced',
    keywordExpansionEnabled: true
  });
  assert.equal(terms[0], 'AI 产品经理');
  assert.ok(terms.includes('AI Agent 产品经理'));
  assert.ok(terms.includes('智能体产品经理'));
  assert.ok(terms.includes('大模型产品经理'));
  assert.equal(new Set(terms.map(term => term.toLowerCase())).size, terms.length);
});

test('宽松模式增加相邻产品方向，关闭扩展时不增加', () => {
  const loose = SearchStrategy.resolveTerms({
    keyword: 'AI 产品经理', matchMode: 'loose', keywordExpansionEnabled: true
  });
  assert.ok(loose.includes('智能硬件产品经理'));
  assert.ok(loose.includes('AI 语音产品经理'));

  const disabled = SearchStrategy.resolveTerms({
    keyword: 'AI 产品经理', matchMode: 'loose', keywordExpansionEnabled: false
  });
  assert.deepEqual(disabled, ['AI 产品经理']);
});

test('非 AI 关键词不会被自动扩展为 AI 岗位组', () => {
  assert.deepEqual(SearchStrategy.resolveTerms({
    keyword: '增长产品经理', matchMode: 'balanced', keywordExpansionEnabled: true
  }), ['增长产品经理']);
});

test('跨关键词按稳定岗位 ID 去重并记录所有命中搜索词', () => {
  let jobs = SearchStrategy.mergeJobs([], [
    { id: 'a', name: 'AI 产品经理' },
    { id: 'b', name: '大模型产品经理' }
  ], 'AI 产品经理', 20);
  jobs = SearchStrategy.mergeJobs(jobs, [
    { id: 'a', name: 'AI Agent 产品经理' },
    { id: 'c', name: '智能体产品经理' }
  ], '智能体产品经理', 20);

  assert.deepEqual(jobs.map(job => job.id), ['a', 'b', 'c']);
  assert.deepEqual(jobs[0].matchedSearchTerms, ['AI 产品经理', '智能体产品经理']);
  assert.equal(jobs[0].name, 'AI 产品经理');
});

test('轮次目标每次增加五个且不超过唯一岗位上限', () => {
  assert.equal(SearchStrategy.roundTarget(1, 20), 5);
  assert.equal(SearchStrategy.roundTarget(2, 20), 10);
  assert.equal(SearchStrategy.roundTarget(5, 20), 20);
  assert.equal(SearchStrategy.roundTarget(0, 20), 5);
});

test('无关键词和未知模式会返回可操作错误', () => {
  assert.throws(() => SearchStrategy.normalizeConfig({ keyword: '' }), /至少填写一个岗位关键词/);
  assert.throws(() => SearchStrategy.normalizeConfig({ keyword: 'AI 产品经理', matchMode: 'unknown' }), /搜索模式/);
});
