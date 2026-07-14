(function initJobDetail(root, factory) {
  const dependency = root.JobFilters || (typeof require === 'function' ? require('./job-filters.js') : null);
  const api = factory(dependency);
  root.JobDetail = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createJobDetail(JobFilters) {
  'use strict';

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeIdentity(value) {
    return cleanText(value).replace(/[\s·•|｜【】()[\]（）,，.。-]/g, '').toLowerCase();
  }

  function canonicalizeDetailUrl(value, baseUrl) {
    try {
      const url = new URL(String(value || ''), baseUrl || 'https://www.zhipin.com/');
      if (url.protocol !== 'https:' || !/(^|\.)zhipin\.com$/i.test(url.hostname)) return '';
      if (!/\/job_detail\/[^/?#]+\.html$/i.test(url.pathname)) return '';
      url.protocol = 'https:';
      url.hash = '';
      url.search = '';
      return url.toString();
    } catch (error) {
      return '';
    }
  }

  function extractJobId(value) {
    const url = canonicalizeDetailUrl(value);
    const match = url.match(/\/job_detail\/([^/?#]+)\.html$/i);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function uniqueTexts(values) {
    const seen = {};
    return (Array.isArray(values) ? values : []).map(cleanText).filter(value => {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function normalizeCollectedJob(input) {
    const source = input || {};
    const detailUrl = canonicalizeDetailUrl(source.detailUrl || source.link || '', source.pageUrl);
    const stableId = extractJobId(detailUrl);
    const rawFacts = uniqueTexts([].concat(source.rawFacts || [], source.tags || []));
    const facts = JobFilters ? JobFilters.extractFacts(rawFacts) : { experience: '', companySize: '' };
    const name = cleanText(source.name) || '未知岗位';
    const company = cleanText(source.company);
    const salary = cleanText(source.salary);
    const fallbackId = cleanText(source.id) || [name, company, salary].join('|');

    return Object.assign({}, source, {
      id: stableId || fallbackId,
      detailUrl: detailUrl,
      link: detailUrl || cleanText(source.link),
      name: name,
      company: company,
      salary: salary,
      tags: uniqueTexts(source.tags || []),
      rawFacts: rawFacts,
      experience: source.experience || facts.experience || '',
      companySize: source.companySize || facts.companySize || '',
      collectedAt: Number(source.collectedAt) || Date.now()
    });
  }

  function verifyIdentity(sourceJob, currentJob) {
    const source = sourceJob || {};
    const current = currentJob || {};
    const sourceId = extractJobId(source.detailUrl || source.link) || cleanText(source.id);
    const currentId = extractJobId(current.detailUrl || current.link) || cleanText(current.id);

    if (sourceId && currentId) {
      if (sourceId === currentId) return { ok: true, reasons: [] };
      return { ok: false, reasons: ['岗位 ID 已变化'] };
    }

    const reasons = [];
    if (!normalizeIdentity(source.name) || !normalizeIdentity(current.name)) reasons.push('岗位名称缺失');
    else if (normalizeIdentity(source.name) !== normalizeIdentity(current.name)) reasons.push('岗位名称已变化');
    if (!normalizeIdentity(source.company) || !normalizeIdentity(current.company)) reasons.push('公司名称缺失');
    else if (normalizeIdentity(source.company) !== normalizeIdentity(current.company)) reasons.push('公司名称已变化');
    return { ok: reasons.length === 0, reasons: reasons };
  }

  function mergeDetail(sourceJob, detail) {
    const source = normalizeCollectedJob(sourceJob || {});
    const current = detail || {};
    const rawFacts = uniqueTexts([].concat(source.rawFacts || [], current.rawFacts || [], current.tags || []));
    const facts = JobFilters ? JobFilters.extractFacts(rawFacts.concat([current.jd || ''])) : { experience: '', companySize: '' };
    return Object.assign({}, source, {
      id: source.id,
      detailUrl: source.detailUrl || canonicalizeDetailUrl(current.detailUrl || current.link),
      link: source.detailUrl || canonicalizeDetailUrl(current.detailUrl || current.link) || source.link,
      name: cleanText(current.name) || source.name,
      company: cleanText(current.company) || source.company,
      salary: cleanText(current.salary) || source.salary,
      tags: uniqueTexts([].concat(source.tags || [], current.tags || [])),
      rawFacts: rawFacts,
      experience: current.experience || facts.experience || source.experience,
      companySize: current.companySize || facts.companySize || source.companySize,
      jd: cleanText(current.jd) || cleanText(source.jd),
      available: current.available !== false,
      detailReadAt: Number(current.detailReadAt) || Date.now()
    });
  }

  return {
    cleanText: cleanText,
    normalizeIdentity: normalizeIdentity,
    canonicalizeDetailUrl: canonicalizeDetailUrl,
    extractJobId: extractJobId,
    normalizeCollectedJob: normalizeCollectedJob,
    verifyIdentity: verifyIdentity,
    mergeDetail: mergeDetail
  };
});
