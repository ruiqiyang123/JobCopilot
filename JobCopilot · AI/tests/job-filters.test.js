const test = require('node:test');
const assert = require('node:assert/strict');

const JobFilters = require('../src/job-filters.js');

test('默认经验为 1 年以内和 1-3 年，公司规模为 100 人以上', () => {
  assert.deepEqual(JobFilters.getDefaultConfig(), {
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
  assert.deepEqual(JobFilters.extractFacts(['本科', '1-3年', '100-499人']), {
    experience: 'one_to_three',
    companySize: 'hundred_to_499'
  });
  assert.deepEqual(JobFilters.extractFacts(['在校/应届', '10000人以上']), {
    experience: 'graduate',
    companySize: 'ten_thousand_plus'
  });
  assert.deepEqual(JobFilters.extractFacts(['经验不限', '20至99人']), {
    experience: 'any',
    companySize: 'twenty_to_99'
  });
  assert.deepEqual(JobFilters.extractFacts(['10年以上', '500—999人']), {
    experience: 'ten_plus',
    companySize: 'five_hundred_to_999'
  });
});

test('明确符合为 pass，明确不符合为 fail', () => {
  const pass = JobFilters.evaluate({
    experience: 'one_to_three',
    companySize: 'hundred_to_499'
  });
  assert.equal(pass.filterStatus, 'pass');
  assert.deepEqual(pass.filterReasons, ['工作经验：1–3 年', '公司规模：100–499 人']);

  const fail = JobFilters.evaluate({
    experience: 'three_to_five',
    companySize: 'twenty_to_99'
  });
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

