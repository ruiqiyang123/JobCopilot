(function initMatchScoring(root, factory) {
  const api = factory();
  root.MatchScoring = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createMatchScoring() {
  'use strict';

  const DIMENSIONS = Object.freeze([
    Object.freeze({ key: 'roleDirection', label: '岗位方向', max: 30 }),
    Object.freeze({ key: 'experience', label: '工作年限', max: 15 }),
    Object.freeze({ key: 'productFundamentals', label: '产品基本功', max: 20 }),
    Object.freeze({ key: 'aiExperience', label: 'AI 经历', max: 20 }),
    Object.freeze({ key: 'education', label: '学历背景', max: 5 }),
    Object.freeze({ key: 'domain', label: '行业/领域经验', max: 10 })
  ]);

  const RECOMMEND_THRESHOLDS = Object.freeze({ precise: 80, balanced: 75, loose: 70 });
  const REVIEW_PRIORITY = Object.freeze({
    pending_review: 0, needs_info: 1, approved: 2, rejected: 3, filtered_out: 4
  });

  function parse(raw) {
    if (raw && typeof raw === 'object') return raw;
    const text = String(raw || '').trim();
    if (!text) throw new Error('AI 返回 JSON 为空');
    try { return JSON.parse(text); }
    catch (error) {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try { return JSON.parse(text.slice(start, end + 1)); }
        catch (ignored) {}
      }
    }
    throw new Error('AI 返回内容不是有效 JSON');
  }

  function stringList(value, field) {
    if (!Array.isArray(value)) throw new Error(field + '必须是数组');
    return value.map(item => String(item || '').trim()).filter(Boolean);
  }

  function decisionFor(score, mode) {
    const value = Number(score);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('综合分必须在 0–100 之间');
    const threshold = RECOMMEND_THRESHOLDS[mode] || RECOMMEND_THRESHOLDS.balanced;
    if (value >= threshold) return 'recommended';
    if (value >= 55) return 'needs_info';
    return 'excluded';
  }

  function validate(raw, mode) {
    const parsed = parse(raw);
    if (!parsed.dimensions || typeof parsed.dimensions !== 'object') throw new Error('缺少评分维度');
    const dimensions = {};
    let total = 0;
    DIMENSIONS.forEach(definition => {
      const item = parsed.dimensions[definition.key];
      if (!item || typeof item !== 'object') throw new Error('缺少评分维度：' + definition.label);
      const score = Number(item.score);
      const maximum = Number(item.max);
      if (!Number.isFinite(score) || score < 0 || score > definition.max || maximum !== definition.max) {
        throw new Error(definition.label + '分数超出范围 0–' + definition.max);
      }
      const evidence = String(item.evidence || '').trim();
      if (!evidence) throw new Error(definition.label + '缺少评分证据');
      dimensions[definition.key] = { score: score, max: definition.max, evidence: evidence };
      total += score;
    });
    const score = Number(parsed.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('综合分必须在 0–100 之间');
    if (Math.abs(score - total) > 0.0001) throw new Error('总分必须等于六个分项之和');
    const reason = String(parsed.reason || '').trim();
    if (!reason) throw new Error('缺少综合评分理由');
    const decision = decisionFor(score, mode);
    return {
      score: score,
      dimensions: dimensions,
      strengths: stringList(parsed.strengths, '主要优势'),
      risks: stringList(parsed.risks, '风险'),
      reason: reason,
      decision: decision,
      match: decision === 'recommended'
    };
  }

  function toJobResult(result) {
    const source = result || {};
    return {
      match: source.match === true,
      matchScore: Number(source.score),
      matchDecision: source.decision,
      matchDimensions: source.dimensions,
      matchStrengths: source.strengths || [],
      matchRisks: source.risks || [],
      reason: source.reason || ''
    };
  }

  function pendingResult(error) {
    return {
      match: false,
      matchScore: null,
      matchDecision: 'needs_info',
      matchDimensions: null,
      matchStrengths: [],
      matchRisks: [String(error || 'AI 评分结果需要人工确认')],
      reason: 'AI 评分待确认：' + String(error || '模型结果不完整')
    };
  }

  function sortJobs(jobs) {
    return (Array.isArray(jobs) ? jobs : []).slice().sort((left, right) => {
      const leftPriority = REVIEW_PRIORITY[left.reviewStatus] === undefined ? 9 : REVIEW_PRIORITY[left.reviewStatus];
      const rightPriority = REVIEW_PRIORITY[right.reviewStatus] === undefined ? 9 : REVIEW_PRIORITY[right.reviewStatus];
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      const leftScore = Number.isFinite(Number(left.matchScore)) ? Number(left.matchScore) : -1;
      const rightScore = Number.isFinite(Number(right.matchScore)) ? Number(right.matchScore) : -1;
      if (leftScore !== rightScore) return rightScore - leftScore;
      const leftAge = left.publishedDaysAgo === null || left.publishedDaysAgo === undefined
        ? Number.MAX_SAFE_INTEGER : Number(left.publishedDaysAgo);
      const rightAge = right.publishedDaysAgo === null || right.publishedDaysAgo === undefined
        ? Number.MAX_SAFE_INTEGER : Number(right.publishedDaysAgo);
      return leftAge - rightAge;
    });
  }

  return {
    DIMENSIONS: DIMENSIONS,
    RECOMMEND_THRESHOLDS: RECOMMEND_THRESHOLDS,
    parse: parse,
    decisionFor: decisionFor,
    validate: validate,
    toJobResult: toJobResult,
    pendingResult: pendingResult,
    sortJobs: sortJobs
  };
});
