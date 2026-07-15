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

  const EMPLOYMENT_TYPE_OPTIONS = Object.freeze([
    Object.freeze({ value: 'full_time', label: '全职' }),
    Object.freeze({ value: 'internship', label: '实习' }),
    Object.freeze({ value: 'part_time', label: '兼职' })
  ]);

  const EDUCATION_OPTIONS = Object.freeze([
    Object.freeze({ value: 'any', label: '学历不限' }),
    Object.freeze({ value: 'junior_college', label: '大专' }),
    Object.freeze({ value: 'bachelor', label: '本科' }),
    Object.freeze({ value: 'master', label: '硕士' }),
    Object.freeze({ value: 'doctorate', label: '博士' })
  ]);

  const DEFAULT_CONFIG = Object.freeze({
    experienceEnabled: true,
    experienceValues: Object.freeze(['under_one', 'one_to_three']),
    companySizeEnabled: true,
    companySizeValues: Object.freeze([
      'hundred_to_499', 'five_hundred_to_999', 'thousand_to_9999', 'ten_thousand_plus'
    ]),
    employmentTypeEnabled: true,
    employmentTypeValues: Object.freeze(['full_time']),
    educationEnabled: true,
    educationValues: Object.freeze(['any', 'junior_college', 'bachelor', 'master']),
    salaryEnabled: false,
    salaryMinK: 15,
    salaryMaxK: 30,
    districtEnabled: false,
    districtValues: Object.freeze([]),
    publishedTimeEnabled: true,
    publishedWithinDays: 7,
    mustWordsEnabled: false,
    mustWords: Object.freeze([]),
    mustWordsMode: 'any',
    excludeWordsEnabled: false,
    excludeWords: Object.freeze([]),
    excludeWordsScope: 'title',
    companyBlacklistEnabled: false,
    companyBlacklist: Object.freeze([])
  });

  const ADVANCED_FIELDS = [
    'employmentTypeEnabled', 'employmentTypeValues', 'educationEnabled', 'educationValues',
    'salaryEnabled', 'salaryMinK', 'salaryMaxK', 'districtEnabled', 'districtValues',
    'publishedTimeEnabled', 'publishedWithinDays', 'mustWordsEnabled', 'mustWords',
    'mustWordsMode', 'excludeWordsEnabled', 'excludeWords', 'excludeWordsScope',
    'companyBlacklistEnabled', 'companyBlacklist'
  ];

  function valuesOf(options) { return options.map(option => option.value); }
  function labelsOf(options) {
    const labels = {};
    options.forEach(option => { labels[option.value] = option.label; });
    return labels;
  }

  const EXPERIENCE_VALUES = valuesOf(EXPERIENCE_OPTIONS);
  const COMPANY_SIZE_VALUES = valuesOf(COMPANY_SIZE_OPTIONS);
  const EMPLOYMENT_TYPE_VALUES = valuesOf(EMPLOYMENT_TYPE_OPTIONS);
  const EDUCATION_VALUES = valuesOf(EDUCATION_OPTIONS);
  const EXPERIENCE_LABELS = labelsOf(EXPERIENCE_OPTIONS);
  const COMPANY_SIZE_LABELS = labelsOf(COMPANY_SIZE_OPTIONS);
  const EMPLOYMENT_TYPE_LABELS = labelsOf(EMPLOYMENT_TYPE_OPTIONS);
  const EDUCATION_LABELS = labelsOf(EDUCATION_OPTIONS);

  function getDefaultConfig() {
    return {
      experienceEnabled: DEFAULT_CONFIG.experienceEnabled,
      experienceValues: DEFAULT_CONFIG.experienceValues.slice(),
      companySizeEnabled: DEFAULT_CONFIG.companySizeEnabled,
      companySizeValues: DEFAULT_CONFIG.companySizeValues.slice(),
      city: '',
      employmentTypeEnabled: DEFAULT_CONFIG.employmentTypeEnabled,
      employmentTypeValues: DEFAULT_CONFIG.employmentTypeValues.slice(),
      educationEnabled: DEFAULT_CONFIG.educationEnabled,
      educationValues: DEFAULT_CONFIG.educationValues.slice(),
      salaryEnabled: DEFAULT_CONFIG.salaryEnabled,
      salaryMinK: DEFAULT_CONFIG.salaryMinK,
      salaryMaxK: DEFAULT_CONFIG.salaryMaxK,
      districtEnabled: DEFAULT_CONFIG.districtEnabled,
      districtValues: DEFAULT_CONFIG.districtValues.slice(),
      publishedTimeEnabled: DEFAULT_CONFIG.publishedTimeEnabled,
      publishedWithinDays: DEFAULT_CONFIG.publishedWithinDays,
      mustWordsEnabled: DEFAULT_CONFIG.mustWordsEnabled,
      mustWords: DEFAULT_CONFIG.mustWords.slice(),
      mustWordsMode: DEFAULT_CONFIG.mustWordsMode,
      excludeWordsEnabled: DEFAULT_CONFIG.excludeWordsEnabled,
      excludeWords: DEFAULT_CONFIG.excludeWords.slice(),
      excludeWordsScope: DEFAULT_CONFIG.excludeWordsScope,
      companyBlacklistEnabled: DEFAULT_CONFIG.companyBlacklistEnabled,
      companyBlacklist: DEFAULT_CONFIG.companyBlacklist.slice()
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

  function splitTerms(values) {
    const source = Array.isArray(values) ? values : String(values || '').split(/[\n,，、;；]+/);
    const seen = {};
    return source.map(value => String(value || '').trim()).filter(value => {
      const key = value.toLowerCase();
      if (!value || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function hasOwn(source, key) {
    return Object.prototype.hasOwnProperty.call(source, key);
  }

  function enabledValue(source, key, fallback) {
    return hasOwn(source, key) ? source[key] !== false : fallback;
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeConfig(config) {
    const source = config || {};
    const defaults = getDefaultConfig();
    const legacy = Object.keys(source).length > 0 && !ADVANCED_FIELDS.some(field => hasOwn(source, field));
    const normalized = {
      experienceEnabled: enabledValue(source, 'experienceEnabled', defaults.experienceEnabled),
      experienceValues: uniqueValid(
        Array.isArray(source.experienceValues) ? source.experienceValues : defaults.experienceValues,
        EXPERIENCE_VALUES
      ),
      companySizeEnabled: enabledValue(source, 'companySizeEnabled', defaults.companySizeEnabled),
      companySizeValues: uniqueValid(
        Array.isArray(source.companySizeValues) ? source.companySizeValues : defaults.companySizeValues,
        COMPANY_SIZE_VALUES
      ),
      city: String(source.city || '').trim(),
      employmentTypeEnabled: enabledValue(source, 'employmentTypeEnabled', legacy ? false : defaults.employmentTypeEnabled),
      employmentTypeValues: uniqueValid(
        Array.isArray(source.employmentTypeValues) ? source.employmentTypeValues : defaults.employmentTypeValues,
        EMPLOYMENT_TYPE_VALUES
      ),
      educationEnabled: enabledValue(source, 'educationEnabled', legacy ? false : defaults.educationEnabled),
      educationValues: uniqueValid(
        Array.isArray(source.educationValues) ? source.educationValues : defaults.educationValues,
        EDUCATION_VALUES
      ),
      salaryEnabled: enabledValue(source, 'salaryEnabled', false),
      salaryMinK: finiteNumber(source.salaryMinK, defaults.salaryMinK),
      salaryMaxK: finiteNumber(source.salaryMaxK, defaults.salaryMaxK),
      districtEnabled: enabledValue(source, 'districtEnabled', false),
      districtValues: splitTerms(source.districtValues),
      publishedTimeEnabled: enabledValue(source, 'publishedTimeEnabled', legacy ? false : defaults.publishedTimeEnabled),
      publishedWithinDays: Math.max(0, finiteNumber(source.publishedWithinDays, defaults.publishedWithinDays)),
      mustWordsEnabled: enabledValue(source, 'mustWordsEnabled', false),
      mustWords: splitTerms(source.mustWords),
      mustWordsMode: source.mustWordsMode === 'all' ? 'all' : 'any',
      excludeWordsEnabled: enabledValue(source, 'excludeWordsEnabled', false),
      excludeWords: splitTerms(source.excludeWords),
      excludeWordsScope: source.excludeWordsScope === 'title_jd' ? 'title_jd' : 'title',
      companyBlacklistEnabled: enabledValue(source, 'companyBlacklistEnabled', false),
      companyBlacklist: splitTerms(source.companyBlacklist)
    };
    if (normalized.experienceEnabled && !normalized.experienceValues.length) {
      throw new Error('工作经验至少选择一个档位');
    }
    if (normalized.companySizeEnabled && !normalized.companySizeValues.length) {
      throw new Error('公司规模至少选择一个档位');
    }
    if (normalized.employmentTypeEnabled && !normalized.employmentTypeValues.length) {
      throw new Error('岗位类型至少选择一个选项');
    }
    if (normalized.educationEnabled && !normalized.educationValues.length) {
      throw new Error('学历要求至少选择一个选项');
    }
    if (normalized.salaryEnabled && (normalized.salaryMinK < 0 || normalized.salaryMaxK < normalized.salaryMinK)) {
      throw new Error('薪资范围填写不正确');
    }
    if (normalized.districtEnabled && !normalized.districtValues.length) {
      throw new Error('行政区筛选启用时至少填写一个行政区');
    }
    if (normalized.mustWordsEnabled && !normalized.mustWords.length) {
      throw new Error('必须包含词启用时至少填写一个关键词');
    }
    if (normalized.excludeWordsEnabled && !normalized.excludeWords.length) {
      throw new Error('排除关键词启用时至少填写一个关键词');
    }
    if (normalized.companyBlacklistEnabled && !normalized.companyBlacklist.length) {
      throw new Error('公司黑名单启用时至少填写一家公司');
    }
    return normalized;
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, '')
      .replace(/[－—–~～至到]/g, '-')
      .toLowerCase();
  }

  function normalizeCompany(value) {
    return normalizeText(value).replace(/[()（）【】\[\]·•|｜,，.。_-]/g, '');
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

  function employmentTypeFrom(text) {
    if (/职位类型[:：]?全职|岗位类型[:：]?全职|全职岗位|全职/.test(text)) return 'full_time';
    if (/职位类型[:：]?兼职|岗位类型[:：]?兼职|兼职岗位/.test(text)) return 'part_time';
    if (/职位类型[:：]?实习|岗位类型[:：]?实习|实习生|实习岗位/.test(text)) return 'internship';
    if (text === '全职') return 'full_time';
    if (text === '兼职') return 'part_time';
    if (text === '实习') return 'internship';
    return '';
  }

  function educationFrom(text) {
    const candidates = [
      { value: 'any', pattern: /学历不限|不限学历/ },
      { value: 'junior_college', pattern: /大专|专科/ },
      { value: 'bachelor', pattern: /本科/ },
      { value: 'master', pattern: /硕士|研究生/ },
      { value: 'doctorate', pattern: /博士/ }
    ].map(candidate => Object.assign({}, candidate, { index: text.search(candidate.pattern) }))
      .filter(candidate => candidate.index >= 0)
      .sort((left, right) => left.index - right.index);
    return candidates.length ? candidates[0].value : '';
  }

  function salaryRangeFrom(text) {
    const normalized = normalizeText(text);
    let match = normalized.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(k|千)(?:\/月)?/i);
    let multiplier = 1;
    if (!match) {
      match = normalized.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*万(?:\/月)?/);
      multiplier = 10;
    }
    if (!match) return null;
    const monthsMatch = normalized.match(/[·x×*]?([1-2]\d)薪/);
    return {
      minK: Number(match[1]) * multiplier,
      maxK: Number(match[2]) * multiplier,
      months: monthsMatch ? Number(monthsMatch[1]) : 12
    };
  }

  function locationFrom(text) {
    const source = String(text || '').replace(/\s+/g, '');
    const pair = source.match(/([\u4e00-\u9fa5]{2,10})[·•-]([\u4e00-\u9fa5]{1,8}(?:区|县|市))/);
    if (pair) return { city: pair[1], district: pair[2] };
    const district = source.match(/([\u4e00-\u9fa5]{1,8}(?:区|县))/);
    const city = source.match(/(深圳|广州|北京|上海|杭州|成都|武汉|南京|苏州|东莞|珠海|佛山|长沙|西安|厦门|重庆|天津)/);
    return { city: city ? city[1] : '', district: district ? district[1] : '' };
  }

  function publishedDaysAgoFrom(text) {
    const source = String(text || '').replace(/\s+/g, '');
    if (/刚刚发布|今日发布|今天发布|\d+小时前发布|发布于\d+小时前/.test(source)) return 0;
    const match = source.match(/(?:发布于)?(\d+)天前(?:发布)?/);
    return match ? Number(match[1]) : null;
  }

  function extractFacts(texts) {
    const values = Array.isArray(texts) ? texts : [texts];
    let experience = '';
    let companySize = '';
    let employmentType = '';
    let education = '';
    let salaryRange = null;
    let city = '';
    let district = '';
    let publishedDaysAgo = null;
    values.forEach(value => {
      const text = normalizeText(value);
      if (!experience) experience = experienceFrom(text);
      if (!companySize) companySize = companySizeFrom(text);
      if (!employmentType) employmentType = employmentTypeFrom(text);
      if (!education) education = educationFrom(text);
      if (!salaryRange) salaryRange = salaryRangeFrom(value);
      const location = locationFrom(value);
      if (!city && location.city) city = location.city;
      if (!district && location.district) district = location.district;
      if (publishedDaysAgo === null) publishedDaysAgo = publishedDaysAgoFrom(value);
    });
    return {
      experience: experience,
      companySize: companySize,
      employmentType: employmentType,
      education: education,
      salaryRange: salaryRange,
      city: city,
      district: district,
      publishedDaysAgo: publishedDaysAgo
    };
  }

  function labelFor(kind, value) {
    const maps = {
      experience: EXPERIENCE_LABELS,
      companySize: COMPANY_SIZE_LABELS,
      employmentType: EMPLOYMENT_TYPE_LABELS,
      education: EDUCATION_LABELS
    };
    return (maps[kind] && maps[kind][value]) || '未知';
  }

  function includesTerm(text, term) {
    return normalizeText(text).indexOf(normalizeText(term)) >= 0;
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

    if (normalized.employmentTypeEnabled) {
      if (!source.employmentType) missing.push('岗位类型信息缺失');
      else if (normalized.employmentTypeValues.indexOf(source.employmentType) < 0) {
        failures.push('岗位类型“' + labelFor('employmentType', source.employmentType) + '”不在所选范围');
      } else passes.push('岗位类型：' + labelFor('employmentType', source.employmentType));
    }

    if (normalized.educationEnabled) {
      if (!source.education) missing.push('学历要求信息缺失');
      else if (normalized.educationValues.indexOf(source.education) < 0) {
        failures.push('学历要求“' + labelFor('education', source.education) + '”不在所选范围');
      } else passes.push('学历要求：' + labelFor('education', source.education));
    }

    if (normalized.salaryEnabled) {
      const salary = source.salaryRange;
      if (!salary || !Number.isFinite(Number(salary.minK)) || !Number.isFinite(Number(salary.maxK))) {
        missing.push('薪资信息缺失');
      } else if (Number(salary.maxK) < normalized.salaryMinK || Number(salary.minK) > normalized.salaryMaxK) {
        failures.push('月薪范围“' + salary.minK + '–' + salary.maxK + 'K”与所选范围无交集');
      } else passes.push('月薪范围：' + salary.minK + '–' + salary.maxK + 'K');
    }

    if (normalized.districtEnabled) {
      if (!source.district) missing.push('行政区信息缺失');
      else if (normalized.districtValues.indexOf(source.district) < 0) {
        failures.push('行政区“' + source.district + '”不在所选范围');
      } else passes.push('行政区：' + source.district);
    }

    if (normalized.city) {
      if (!source.city) missing.push('城市信息缺失');
      else if (normalizeText(source.city) !== normalizeText(normalized.city)) {
        failures.push('城市“' + source.city + '”与目标城市“' + normalized.city + '”不一致');
      } else passes.push('城市：' + source.city);
    }

    if (normalized.publishedTimeEnabled) {
      const missingPublished = source.publishedDaysAgo === null
        || source.publishedDaysAgo === undefined || source.publishedDaysAgo === '';
      if (missingPublished) missing.push('发布时间信息缺失');
      else if (Number(source.publishedDaysAgo) > normalized.publishedWithinDays) {
        failures.push('岗位发布已超过 ' + normalized.publishedWithinDays + ' 天');
      } else passes.push('发布时间：' + (Number(source.publishedDaysAgo) === 0 ? '当天' : source.publishedDaysAgo + ' 天前'));
    }

    const fullText = [source.name, source.jd].filter(Boolean).join('\n');
    if (normalized.mustWordsEnabled) {
      if (!fullText.trim()) missing.push('岗位文本信息缺失');
      else {
        const hits = normalized.mustWords.filter(term => includesTerm(fullText, term));
        const matched = normalized.mustWordsMode === 'all'
          ? hits.length === normalized.mustWords.length : hits.length > 0;
        if (!matched) failures.push('必须包含词未满足（' + normalized.mustWords.join('、') + '）');
        else passes.push('必须词命中：' + hits.join('、'));
      }
    }

    if (normalized.excludeWordsEnabled) {
      const excludeText = normalized.excludeWordsScope === 'title_jd'
        ? fullText : String(source.name || '');
      if (!excludeText.trim()) missing.push('排除词检查所需岗位文本缺失');
      else {
        const hits = normalized.excludeWords.filter(term => includesTerm(excludeText, term));
        if (hits.length) failures.push('命中排除关键词：' + hits.join('、'));
      }
    }

    if (normalized.companyBlacklistEnabled) {
      if (!source.company) missing.push('公司名称信息缺失');
      else {
        const companyKey = normalizeCompany(source.company);
        const blocked = normalized.companyBlacklist.find(company => normalizeCompany(company) === companyKey);
        if (blocked) failures.push('公司位于黑名单：' + blocked);
      }
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
    EMPLOYMENT_TYPE_OPTIONS: EMPLOYMENT_TYPE_OPTIONS,
    EDUCATION_OPTIONS: EDUCATION_OPTIONS,
    getDefaultConfig: getDefaultConfig,
    normalizeConfig: normalizeConfig,
    splitTerms: splitTerms,
    normalizeCompany: normalizeCompany,
    extractFacts: extractFacts,
    labelFor: labelFor,
    evaluate: evaluate,
    confirmPending: confirmPending
  };
});
