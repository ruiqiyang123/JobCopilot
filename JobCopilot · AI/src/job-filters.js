(function initJobFilters(root, factory) {
  const api = factory();
  root.JobFilters = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createJobFilters() {
  'use strict';

  const EXPERIENCE_OPTIONS = Object.freeze([
    Object.freeze({ value: 'any', label: '经验不限' }),
    Object.freeze({ value: 'graduate', label: '应届/在校' }),
    Object.freeze({ value: 'under_one', label: '1 年以内' }),
    Object.freeze({ value: 'one_to_three', label: '1–3 年' }),
    Object.freeze({ value: 'three_to_five', label: '3–5 年' }),
    Object.freeze({ value: 'five_to_ten', label: '5–10 年' }),
    Object.freeze({ value: 'ten_plus', label: '10 年以上' })
  ]);

  const COMPANY_SIZE_OPTIONS = Object.freeze([
    Object.freeze({ value: 'zero_to_twenty', label: '0–20 人' }),
    Object.freeze({ value: 'twenty_to_99', label: '20–99 人' }),
    Object.freeze({ value: 'hundred_to_499', label: '100–499 人' }),
    Object.freeze({ value: 'five_hundred_to_999', label: '500–999 人' }),
    Object.freeze({ value: 'thousand_to_9999', label: '1000–9999 人' }),
    Object.freeze({ value: 'ten_thousand_plus', label: '10000 人以上' })
  ]);

  const DEFAULT_CONFIG = Object.freeze({
    experienceEnabled: true,
    experienceValues: Object.freeze(['under_one', 'one_to_three']),
    companySizeEnabled: true,
    companySizeValues: Object.freeze([
      'hundred_to_499', 'five_hundred_to_999', 'thousand_to_9999', 'ten_thousand_plus'
    ])
  });

  function valuesOf(options) { return options.map(option => option.value); }
  function labelsOf(options) {
    const labels = {};
    options.forEach(option => { labels[option.value] = option.label; });
    return labels;
  }

  const EXPERIENCE_VALUES = valuesOf(EXPERIENCE_OPTIONS);
  const COMPANY_SIZE_VALUES = valuesOf(COMPANY_SIZE_OPTIONS);
  const EXPERIENCE_LABELS = labelsOf(EXPERIENCE_OPTIONS);
  const COMPANY_SIZE_LABELS = labelsOf(COMPANY_SIZE_OPTIONS);

  function getDefaultConfig() {
    return {
      experienceEnabled: DEFAULT_CONFIG.experienceEnabled,
      experienceValues: DEFAULT_CONFIG.experienceValues.slice(),
      companySizeEnabled: DEFAULT_CONFIG.companySizeEnabled,
      companySizeValues: DEFAULT_CONFIG.companySizeValues.slice()
    };
  }

  function uniqueValid(values, allowed) {
    const seen = {};
    return (Array.isArray(values) ? values : []).filter(value => {
      if (allowed.indexOf(value) < 0 || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function normalizeConfig(config) {
    const source = config || {};
    const defaults = getDefaultConfig();
    const normalized = {
      experienceEnabled: source.experienceEnabled !== false,
      experienceValues: uniqueValid(
        Array.isArray(source.experienceValues) ? source.experienceValues : defaults.experienceValues,
        EXPERIENCE_VALUES
      ),
      companySizeEnabled: source.companySizeEnabled !== false,
      companySizeValues: uniqueValid(
        Array.isArray(source.companySizeValues) ? source.companySizeValues : defaults.companySizeValues,
        COMPANY_SIZE_VALUES
      )
    };
    if (normalized.experienceEnabled && !normalized.experienceValues.length) {
      throw new Error('工作经验至少选择一个档位');
    }
    if (normalized.companySizeEnabled && !normalized.companySizeValues.length) {
      throw new Error('公司规模至少选择一个档位');
    }
    return normalized;
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, '')
      .replace(/[－—–~～至到]/g, '-')
      .toLowerCase();
  }

  function experienceFrom(text) {
    if (/经验不限|不限经验/.test(text)) return 'any';
    if (/应届|在校/.test(text)) return 'graduate';
    if (/1年以内|一年以内|不足1年|1年以下/.test(text)) return 'under_one';
    if (/10年(?:以上|及以上)|10\+年/.test(text)) return 'ten_plus';
    if (/5-10年/.test(text)) return 'five_to_ten';
    if (/3-5年/.test(text)) return 'three_to_five';
    if (/1-3年/.test(text)) return 'one_to_three';
    return '';
  }

  function companySizeFrom(text) {
    if (/10000人(?:以上|及以上)|10000\+人/.test(text)) return 'ten_thousand_plus';
    if (/1000-9999人/.test(text)) return 'thousand_to_9999';
    if (/500-999人/.test(text)) return 'five_hundred_to_999';
    if (/100-499人/.test(text)) return 'hundred_to_499';
    if (/20-99人/.test(text)) return 'twenty_to_99';
    if (/0-20人/.test(text)) return 'zero_to_twenty';
    return '';
  }

  function extractFacts(texts) {
    const values = Array.isArray(texts) ? texts : [texts];
    let experience = '';
    let companySize = '';
    values.forEach(value => {
      const text = normalizeText(value);
      if (!experience) experience = experienceFrom(text);
      if (!companySize) companySize = companySizeFrom(text);
    });
    return { experience: experience, companySize: companySize };
  }

  function labelFor(kind, value) {
    return kind === 'experience'
      ? (EXPERIENCE_LABELS[value] || '未知')
      : (COMPANY_SIZE_LABELS[value] || '未知');
  }

  function evaluate(job, config) {
    const source = job || {};
    const normalized = normalizeConfig(config);
    const passes = [];
    const failures = [];
    const missing = [];

    if (normalized.experienceEnabled) {
      if (!source.experience) missing.push('工作经验信息缺失');
      else if (normalized.experienceValues.indexOf(source.experience) < 0) {
        failures.push('工作经验“' + labelFor('experience', source.experience) + '”不在所选范围');
      } else passes.push('工作经验：' + labelFor('experience', source.experience));
    }

    if (normalized.companySizeEnabled) {
      if (!source.companySize) missing.push('公司规模信息缺失');
      else if (normalized.companySizeValues.indexOf(source.companySize) < 0) {
        failures.push('公司规模“' + labelFor('companySize', source.companySize) + '”不在所选范围');
      } else passes.push('公司规模：' + labelFor('companySize', source.companySize));
    }

    if (failures.length) return { filterStatus: 'fail', filterReasons: failures };
    if (missing.length && source.manualOverride === true) {
      return {
        filterStatus: 'pass',
        filterReasons: passes.concat(['信息缺失，已人工确认符合：' + missing.join('、')])
      };
    }
    if (missing.length) return { filterStatus: 'pending', filterReasons: passes.concat(missing) };
    return {
      filterStatus: 'pass',
      filterReasons: passes.length ? passes : ['未启用岗位硬筛选']
    };
  }

  function confirmPending(job, config) {
    const source = Object.assign({}, job || {}, { manualOverride: false });
    const current = evaluate(source, config);
    if (current.filterStatus !== 'pending') throw new Error('只有信息不完整的岗位可以人工确认');
    const confirmed = Object.assign({}, source, { manualOverride: true });
    return Object.assign(confirmed, evaluate(confirmed, config));
  }

  return {
    EXPERIENCE_OPTIONS: EXPERIENCE_OPTIONS,
    COMPANY_SIZE_OPTIONS: COMPANY_SIZE_OPTIONS,
    getDefaultConfig: getDefaultConfig,
    normalizeConfig: normalizeConfig,
    extractFacts: extractFacts,
    labelFor: labelFor,
    evaluate: evaluate,
    confirmPending: confirmPending
  };
});
