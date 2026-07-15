const test = require('node:test');
const assert = require('node:assert/strict');

const MatchScoring = require('../src/match-scoring.js');

function validScore(score) {
  return {
    score,
    dimensions: {
      roleDirection: { score: 27, max: 30, evidence: 'JD 要求 AI 产品，简历目标为 AI 产品经理' },
      experience: { score: 11, max: 15, evidence: 'JD 要求 1-3 年，简历有约 1 年正式经验' },
      productFundamentals: { score: 17, max: 20, evidence: '简历包含 PRD、原型和研发协作' },
      aiExperience: { score: 18, max: 20, evidence: '简历包含 Agent、RAG 与评测项目' },
      education: { score: 5, max: 5, evidence: '简历为计算机硕士' },
      domain: { score: score - 78, max: 10, evidence: '具有工具型与智能硬件产品经历' }
    },
    strengths: ['AI Agent 项目证据完整'],
    risks: ['正式工作年限位于要求下限'],
    reason: '方向和核心能力匹配，年限需要重点确认。'
  };
}

test('校验六维评分并由后台计算推荐结论', () => {
  const result = MatchScoring.validate(validScore(82), 'balanced');
  assert.equal(result.score, 82);
  assert.equal(result.decision, 'recommended');
  assert.equal(result.match, true);
  assert.equal(result.dimensions.aiExperience.max, 20);
});

test('精准、平衡和宽松模式使用不同推荐阈值', () => {
  assert.equal(MatchScoring.decisionFor(78, 'precise'), 'needs_info');
  assert.equal(MatchScoring.decisionFor(78, 'balanced'), 'recommended');
  assert.equal(MatchScoring.decisionFor(68, 'loose'), 'needs_info');
  assert.equal(MatchScoring.decisionFor(52, 'loose'), 'excluded');
});

test('拒绝缺失维度、分项越界、总分不等于分项和与空证据', () => {
  const missing = validScore(82);
  delete missing.dimensions.education;
  assert.throws(() => MatchScoring.validate(missing), /缺少评分维度/);

  const overflow = validScore(82);
  overflow.dimensions.aiExperience.score = 21;
  assert.throws(() => MatchScoring.validate(overflow), /AI 经历.*范围/);

  const wrongTotal = validScore(81);
  wrongTotal.score = 82;
  assert.throws(() => MatchScoring.validate(wrongTotal), /总分必须等于六个分项之和/);

  const emptyEvidence = validScore(82);
  emptyEvidence.dimensions.roleDirection.evidence = '';
  assert.throws(() => MatchScoring.validate(emptyEvidence), /岗位方向.*证据/);
});

test('从带代码围栏或说明文字的模型返回中提取 JSON', () => {
  const raw = '结果如下：\n```json\n' + JSON.stringify(validScore(82)) + '\n```';
  assert.equal(MatchScoring.parse(raw).score, 82);
  assert.throws(() => MatchScoring.parse('not json'), /JSON/);
});

test('排序按审核分类、综合分和发布时间依次处理', () => {
  const sorted = MatchScoring.sortJobs([
    { id: 'low', reviewStatus: 'pending_review', matchScore: 76, publishedDaysAgo: 1 },
    { id: 'approved', reviewStatus: 'approved', matchScore: 99, publishedDaysAgo: 0 },
    { id: 'newer', reviewStatus: 'pending_review', matchScore: 82, publishedDaysAgo: 0 },
    { id: 'older', reviewStatus: 'pending_review', matchScore: 82, publishedDaysAgo: 5 }
  ]);
  assert.deepEqual(sorted.map(job => job.id), ['newer', 'older', 'low', 'approved']);
});

test('无效模型结果可转换成待确认岗位且不伪造分数', () => {
  const fallback = MatchScoring.pendingResult('模型返回格式无法解析');
  assert.equal(fallback.matchDecision, 'needs_info');
  assert.equal(fallback.match, false);
  assert.equal(fallback.matchScore, null);
  assert.match(fallback.reason, /格式无法解析/);
});

test('快速 AI 筛选接受短 JSON、代码块和中文决策', () => {
  const recommended = MatchScoring.validateQuick({
    decision: 'recommended', reason: 'JD 与 AI Agent 产品经历匹配。'
  });
  assert.equal(recommended.decision, 'recommended');
  assert.equal(recommended.match, true);

  const fenced = MatchScoring.validateQuick('```json\n{"decision":"待确认","reason":"年限需要确认"}\n```');
  assert.equal(fenced.decision, 'needs_info');
  assert.equal(fenced.match, false);
  assert.throws(() => MatchScoring.validateQuick('{"decision":"maybe","reason":"x"}'), /决策/);
});

test('快速 AI 结果使用独立字段且失败时不默认排除', () => {
  const result = MatchScoring.toQuickJobResult({
    decision: 'excluded', reason: '岗位主要为销售。', match: false
  });
  assert.equal(result.quickDecision, 'excluded');
  assert.equal(result.matchDecision, 'excluded');
  assert.equal(result.aiScreeningStatus, 'succeeded');

  const failed = MatchScoring.quickPendingResult('模型超时');
  assert.equal(failed.quickDecision, 'needs_info');
  assert.equal(failed.matchDecision, 'needs_info');
  assert.equal(failed.aiScreeningStatus, 'failed');
  assert.match(failed.aiScreeningError, /超时/);
});
