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
    const rawLocationFacts = uniqueTexts([].concat(source.rawLocationFacts || []));
    const name = cleanText(source.name) || '未知岗位';
    const company = cleanText(source.company);
    const salary = cleanText(source.salary);
    const facts = JobFilters
      ? JobFilters.extractFacts(rawFacts.concat([name, salary]))
      : { experience: '', companySize: '' };
    const location = JobFilters
      ? JobFilters.extractLocationFacts(rawLocationFacts)
      : { city: '', district: '', citySource: '', locationParseVersion: 0 };
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
      rawLocationFacts: rawLocationFacts,
      experience: source.experience || facts.experience || '',
      companySize: source.companySize || facts.companySize || '',
      employmentType: source.employmentType || facts.employmentType || '',
      education: source.education || facts.education || '',
      educationRequirement: source.educationRequirement || source.education || facts.education || '',
      salaryRange: source.salaryRange || facts.salaryRange || null,
      salaryMinK: source.salaryMinK || (source.salaryRange && source.salaryRange.minK)
        || (facts.salaryRange && facts.salaryRange.minK) || null,
      salaryMaxK: source.salaryMaxK || (source.salaryRange && source.salaryRange.maxK)
        || (facts.salaryRange && facts.salaryRange.maxK) || null,
      salaryMonths: source.salaryMonths || (source.salaryRange && source.salaryRange.months)
        || (facts.salaryRange && facts.salaryRange.months) || null,
      city: source.city || location.city || '',
      district: source.district || location.district || '',
      citySource: source.citySource || location.citySource || '',
      locationParseVersion: Number(source.locationParseVersion)
        || location.locationParseVersion || 0,
      publishedDaysAgo: source.publishedDaysAgo === 0 || source.publishedDaysAgo
        ? Number(source.publishedDaysAgo) : facts.publishedDaysAgo,
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
    const rawLocationFacts = uniqueTexts([].concat(
      source.rawLocationFacts || [], current.rawLocationFacts || []
    ));
    const facts = JobFilters ? JobFilters.extractFacts(rawFacts.concat([
      current.name || source.name, current.salary || source.salary, current.jd || ''
    ])) : { experience: '', companySize: '' };
    const location = JobFilters ? JobFilters.extractLocationFacts(rawLocationFacts)
      : { city: '', district: '', citySource: '', locationParseVersion: 0 };
    return Object.assign({}, source, {
      id: source.id,
      detailUrl: source.detailUrl || canonicalizeDetailUrl(current.detailUrl || current.link),
      link: source.detailUrl || canonicalizeDetailUrl(current.detailUrl || current.link) || source.link,
      name: cleanText(current.name) || source.name,
      company: cleanText(current.company) || source.company,
      salary: cleanText(current.salary) || source.salary,
      tags: uniqueTexts([].concat(source.tags || [], current.tags || [])),
      rawFacts: rawFacts,
      rawLocationFacts: rawLocationFacts,
      experience: current.experience || facts.experience || source.experience,
      companySize: current.companySize || facts.companySize || source.companySize,
      employmentType: current.employmentType || facts.employmentType || source.employmentType || '',
      education: current.education || facts.education || source.education || '',
      educationRequirement: current.educationRequirement || current.education || facts.education
        || source.educationRequirement || source.education || '',
      salaryRange: current.salaryRange || facts.salaryRange || source.salaryRange || null,
      salaryMinK: current.salaryMinK || (current.salaryRange && current.salaryRange.minK)
        || (facts.salaryRange && facts.salaryRange.minK) || source.salaryMinK || null,
      salaryMaxK: current.salaryMaxK || (current.salaryRange && current.salaryRange.maxK)
        || (facts.salaryRange && facts.salaryRange.maxK) || source.salaryMaxK || null,
      salaryMonths: current.salaryMonths || (current.salaryRange && current.salaryRange.months)
        || (facts.salaryRange && facts.salaryRange.months) || source.salaryMonths || null,
      city: current.city || location.city || source.city || '',
      district: current.district || location.district || source.district || '',
      citySource: current.citySource || location.citySource || source.citySource || '',
      locationParseVersion: Number(current.locationParseVersion)
        || location.locationParseVersion || Number(source.locationParseVersion) || 0,
      publishedDaysAgo: current.publishedDaysAgo === 0 || current.publishedDaysAgo
        ? Number(current.publishedDaysAgo)
        : (facts.publishedDaysAgo === 0 || facts.publishedDaysAgo
          ? Number(facts.publishedDaysAgo) : source.publishedDaysAgo),
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
