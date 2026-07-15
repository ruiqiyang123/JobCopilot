const test = require('node:test');
const assert = require('node:assert/strict');

const JobFilters = require('../src/job-filters.js');

test('默认经验为 1 年以内和 1-3 年，公司规模为 100 人以上', () => {
  const config = JobFilters.getDefaultConfig();
  assert.deepEqual({
    experienceEnabled: config.experienceEnabled,
    experienceValues: config.experienceValues,
    companySizeEnabled: config.companySizeEnabled,
    companySizeValues: config.companySizeValues
  }, {
    experienceEnabled: true,
    experienceValues: ['under_one', 'one_to_three'],
    companySizeEnabled: true,
    companySizeValues: ['hundred_to_499', 'five_hundred_to_999', 'thousand_to_9999', 'ten_thousand_plus']
  });
});

test('筛选可关闭；启用时至少选择一个档位', () => {
  const disabled = JobFilters.normalizeConfig({
    experienceEnabled: false,
    experienceValues: [],
    companySizeEnabled: false,
    companySizeValues: []
  });
  assert.deepEqual(disabled.experienceValues, []);
  assert.deepEqual(disabled.companySizeValues, []);

  assert.throws(() => JobFilters.normalizeConfig({
    experienceEnabled: true,
    experienceValues: [],
    companySizeEnabled: false,
    companySizeValues: []
  }), /工作经验至少选择一个档位/);
  assert.throws(() => JobFilters.normalizeConfig({
    experienceEnabled: false,
    experienceValues: [],
    companySizeEnabled: true,
    companySizeValues: []
  }), /公司规模至少选择一个档位/);
});

test('解析 BOSS 常见经验和公司规模文案', () => {
  assert.deepEqual(JobFilters.extractFacts(['本科', '1-3年', '100-499人']).experience, 'one_to_three');
  assert.deepEqual(JobFilters.extractFacts(['本科', '1-3年', '100-499人']).companySize, 'hundred_to_499');
  assert.deepEqual({
    experience: JobFilters.extractFacts(['在校/应届', '10000人以上']).experience,
    companySize: JobFilters.extractFacts(['在校/应届', '10000人以上']).companySize
  }, {
    experience: 'graduate',
    companySize: 'ten_thousand_plus'
  });
  assert.deepEqual({
    experience: JobFilters.extractFacts(['经验不限', '20至99人']).experience,
    companySize: JobFilters.extractFacts(['经验不限', '20至99人']).companySize
  }, {
    experience: 'any',
    companySize: 'twenty_to_99'
  });
  assert.deepEqual({
    experience: JobFilters.extractFacts(['10年以上', '500—999人']).experience,
    companySize: JobFilters.extractFacts(['10年以上', '500—999人']).companySize
  }, {
    experience: 'ten_plus',
    companySize: 'five_hundred_to_999'
  });
});

test('明确符合为 pass，明确不符合为 fail', () => {
  const legacyConfig = {
    experienceEnabled: true,
    experienceValues: ['under_one', 'one_to_three'],
    companySizeEnabled: true,
    companySizeValues: ['hundred_to_499', 'five_hundred_to_999', 'thousand_to_9999', 'ten_thousand_plus']
  };
  const pass = JobFilters.evaluate({
    experience: 'one_to_three',
    companySize: 'hundred_to_499'
  }, legacyConfig);
  assert.equal(pass.filterStatus, 'pass');
  assert.deepEqual(pass.filterReasons, ['工作经验：1–3 年', '公司规模：100–499 人']);

  const fail = JobFilters.evaluate({
    experience: 'three_to_five',
    companySize: 'twenty_to_99'
  }, legacyConfig);
  assert.equal(fail.filterStatus, 'fail');
  assert.match(fail.filterReasons.join('；'), /3–5 年.*不在所选范围/);
  assert.match(fail.filterReasons.join('；'), /20–99 人.*不在所选范围/);
});

test('缺少启用维度的信息为 pending，人工确认后才能通过', () => {
  const job = { id: 'job-1', experience: '', companySize: 'hundred_to_499' };
  const pending = JobFilters.evaluate(job);
  assert.equal(pending.filterStatus, 'pending');
  assert.match(pending.filterReasons.join('；'), /工作经验信息缺失/);

  const confirmed = JobFilters.confirmPending(job);
  assert.equal(confirmed.manualOverride, true);
  assert.equal(confirmed.filterStatus, 'pass');
  assert.match(confirmed.filterReasons.join('；'), /人工确认/);
});

test('人工确认不能覆盖明确不匹配', () => {
  const job = {
    id: 'job-2',
    experience: 'three_to_five',
    companySize: 'hundred_to_499',
    manualOverride: true
  };
  const result = JobFilters.evaluate(job);
  assert.equal(result.filterStatus, 'fail');
  assert.throws(() => JobFilters.confirmPending(job), /只有信息不完整的岗位可以人工确认/);
});

test('推荐默认包含可配置的岗位类型、学历、薪资、行政区和时间条件', () => {
  const config = JobFilters.getDefaultConfig();
  assert.deepEqual(config.employmentTypeValues, ['full_time']);
  assert.deepEqual(config.educationValues, ['any', 'junior_college', 'bachelor', 'master']);
  assert.equal(config.salaryEnabled, false);
  assert.equal(config.districtEnabled, false);
  assert.equal(config.publishedTimeEnabled, true);
  assert.equal(config.publishedWithinDays, 7);
  assert.equal(config.mustWordsEnabled, false);
  assert.equal(config.excludeWordsEnabled, false);
  assert.equal(config.companyBlacklistEnabled, false);
});

test('旧版筛选配置迁移时新增条件默认关闭', () => {
  const migrated = JobFilters.normalizeConfig({
    experienceEnabled: true,
    experienceValues: ['one_to_three'],
    companySizeEnabled: true,
    companySizeValues: ['hundred_to_499']
  });
  assert.equal(migrated.employmentTypeEnabled, false);
  assert.equal(migrated.educationEnabled, false);
  assert.equal(migrated.publishedTimeEnabled, false);
  assert.equal(migrated.salaryEnabled, false);
});

test('解析岗位类型、学历、薪资、行政区和发布时间', () => {
  const facts = JobFilters.extractFacts([
    '深圳·南山区 15-25K·14薪 1-3年 本科 全职',
    '职位发布于 3 天前'
  ]);
  assert.equal(facts.employmentType, 'full_time');
  assert.equal(facts.education, 'bachelor');
  assert.deepEqual(facts.salaryRange, { minK: 15, maxK: 25, months: 14 });
  assert.equal(facts.city, '深圳');
  assert.equal(facts.district, '南山区');
  assert.equal(facts.publishedDaysAgo, 3);

  assert.deepEqual(JobFilters.extractFacts('20-30K/月 硕士 实习生 今日发布 深圳·福田区').salaryRange, {
    minK: 20, maxK: 30, months: 12
  });
  assert.equal(JobFilters.extractFacts('刚刚发布').publishedDaysAgo, 0);
  assert.equal(JobFilters.extractFacts('本科及以上，硕士优先').education, 'bachelor');
});

test('薪资使用岗位月薪范围求交集，不折算薪数', () => {
  const config = Object.assign(JobFilters.getDefaultConfig(), {
    employmentTypeEnabled: false,
    educationEnabled: false,
    publishedTimeEnabled: false,
    salaryEnabled: true,
    salaryMinK: 18,
    salaryMaxK: 30
  });
  assert.equal(JobFilters.evaluate({
    experience: 'one_to_three', companySize: 'hundred_to_499',
    salaryRange: { minK: 15, maxK: 20, months: 14 }
  }, config).filterStatus, 'pass');
  assert.equal(JobFilters.evaluate({
    experience: 'one_to_three', companySize: 'hundred_to_499',
    salaryRange: { minK: 10, maxK: 15, months: 16 }
  }, config).filterStatus, 'fail');
});

test('组合筛选支持行政区、发布时间、必须词、排除词和公司黑名单', () => {
  const config = Object.assign(JobFilters.getDefaultConfig(), {
    city: '深圳',
    districtEnabled: true,
    districtValues: ['南山区', '福田区'],
    salaryEnabled: false,
    mustWordsEnabled: true,
    mustWords: ['Agent', 'RAG'],
    mustWordsMode: 'any',
    excludeWordsEnabled: true,
    excludeWords: ['销售', '外包'],
    excludeWordsScope: 'title_jd',
    companyBlacklistEnabled: true,
    companyBlacklist: ['不喜欢科技有限公司']
  });
  const base = {
    name: 'AI Agent 产品经理', company: '理想科技有限公司',
    experience: 'one_to_three', companySize: 'hundred_to_499',
    employmentType: 'full_time', education: 'bachelor', city: '深圳', district: '南山区',
    publishedDaysAgo: 2, jd: '负责 RAG 知识库与 Agent 产品设计'
  };
  assert.equal(JobFilters.evaluate(base, config).filterStatus, 'pass');
  assert.equal(JobFilters.evaluate(Object.assign({}, base, { city: '广州' }), config).filterStatus, 'fail');
  assert.equal(JobFilters.evaluate(Object.assign({}, base, { district: '宝安区' }), config).filterStatus, 'fail');
  assert.equal(JobFilters.evaluate(Object.assign({}, base, { publishedDaysAgo: 12 }), config).filterStatus, 'fail');
  assert.equal(JobFilters.evaluate(Object.assign({}, base, { jd: '负责传统 ERP 产品销售' }), config).filterStatus, 'fail');
  assert.equal(JobFilters.evaluate(Object.assign({}, base, { company: ' 不喜欢科技（有限公司） ' }), config).filterStatus, 'fail');
});

test('启用的高级维度信息缺失进入待确认，明确失败仍优先排除', () => {
  const config = Object.assign(JobFilters.getDefaultConfig(), {
    districtEnabled: true,
    districtValues: ['南山区'],
    salaryEnabled: true,
    salaryMinK: 15,
    salaryMaxK: 30
  });
  const missing = JobFilters.evaluate({
    experience: 'one_to_three', companySize: 'hundred_to_499',
    employmentType: '', education: '', district: '', publishedDaysAgo: null,
    salaryRange: null
  }, config);
  assert.equal(missing.filterStatus, 'pending');
  assert.match(missing.filterReasons.join('；'), /岗位类型信息缺失/);
  assert.match(missing.filterReasons.join('；'), /学历要求信息缺失/);
  assert.match(missing.filterReasons.join('；'), /薪资信息缺失/);

  const failed = JobFilters.evaluate({
    experience: 'three_to_five', companySize: 'hundred_to_499'
  }, config);
  assert.equal(failed.filterStatus, 'fail');
});
