(function initSearchStrategy(root, factory) {
  const api = factory();
  root.SearchStrategy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createSearchStrategy() {
  'use strict';

  const MATCH_MODES = Object.freeze(['precise', 'balanced', 'loose']);
  const BALANCED_TERMS = Object.freeze([
    'AI 产品经理', '人工智能产品经理', 'AI Agent 产品经理', '智能体产品经理',
    '大模型产品经理', 'LLM 产品经理', 'AI 应用产品经理', 'AIGC 产品经理',
    'AI 平台产品经理', 'AI 工具产品经理'
  ]);
  const LOOSE_TERMS = Object.freeze([
    '智能硬件产品经理', 'AI 语音产品经理', 'AI 效率工具产品经理'
  ]);

  function displayTerm(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function termKey(value) {
    return displayTerm(value).toLowerCase();
  }

  function uniqueTerms(values) {
    const seen = new Set();
    const result = [];
    (values || []).forEach(value => {
      const term = displayTerm(value);
      const key = termKey(term);
      if (!term || seen.has(key)) return;
      seen.add(key);
      result.push(term);
    });
    return result;
  }

  function parseKeywords(value) {
    if (Array.isArray(value)) return uniqueTerms(value);
    return uniqueTerms(String(value || '').split(/[\n,，、;；]+/));
  }

  function normalizeConfig(config) {
    const source = config || {};
    const keywords = parseKeywords(source.keywords || source.keyword);
    if (!keywords.length) throw new Error('至少填写一个岗位关键词');
    const matchMode = source.matchMode || source.searchMatchMode || 'balanced';
    if (MATCH_MODES.indexOf(matchMode) < 0) throw new Error('不支持的搜索模式');
    return {
      keywords: keywords,
      matchMode: matchMode,
      keywordExpansionEnabled: source.keywordExpansionEnabled !== false
    };
  }

  function isAiProductSearch(keywords) {
    return keywords.some(term => /(?:\bai\b|aigc|llm|agent|人工智能|大模型|智能体)/i.test(term));
  }

  function resolveTerms(config) {
    const normalized = normalizeConfig(config);
    let terms = normalized.keywords.slice();
    if (!normalized.keywordExpansionEnabled || normalized.matchMode === 'precise') return terms;
    if (!isAiProductSearch(terms)) return terms;
    terms = terms.concat(BALANCED_TERMS);
    if (normalized.matchMode === 'loose') terms = terms.concat(LOOSE_TERMS);
    return uniqueTerms(terms);
  }

  function mergeJobs(existing, incoming, searchTerm, limit) {
    const maximum = Math.max(1, Number(limit) || Number.MAX_SAFE_INTEGER);
    const result = (Array.isArray(existing) ? existing : []).map(job => Object.assign({}, job, {
      matchedSearchTerms: uniqueTerms(job.matchedSearchTerms || [])
    }));
    const byId = new Map();
    result.forEach((job, index) => {
      const id = String(job.id || '');
      if (id) byId.set(id, index);
    });
    (Array.isArray(incoming) ? incoming : []).forEach(job => {
      const id = String((job && job.id) || '');
      if (!id) return;
      const found = byId.get(id);
      if (found !== undefined) {
        result[found].matchedSearchTerms = uniqueTerms(
          result[found].matchedSearchTerms.concat([searchTerm])
        );
        return;
      }
      if (result.length >= maximum) return;
      const next = Object.assign({}, job, {
        matchedSearchTerms: uniqueTerms([].concat(job.matchedSearchTerms || [], [searchTerm]))
      });
      byId.set(id, result.length);
      result.push(next);
    });
    return result;
  }

  function roundTarget(round, limit) {
    const index = Math.max(1, Number(round) || 1);
    const maximum = Math.max(1, Number(limit) || 1);
    return Math.min(maximum, index * 5);
  }

  return {
    MATCH_MODES: MATCH_MODES,
    BALANCED_TERMS: BALANCED_TERMS,
    LOOSE_TERMS: LOOSE_TERMS,
    parseKeywords: parseKeywords,
    normalizeConfig: normalizeConfig,
    resolveTerms: resolveTerms,
    mergeJobs: mergeJobs,
    roundTarget: roundTarget
  };
});
