const test = require('node:test');
const assert = require('node:assert/strict');

const JobDetail = require('../src/job-detail.js');

test('规范化 BOSS 岗位详情链接并提取稳定岗位 ID', () => {
  const url = JobDetail.canonicalizeDetailUrl(
    'https://www.zhipin.com/job_detail/abc123.html?ka=search_list_jname_1#detail'
  );
  assert.equal(url, 'https://www.zhipin.com/job_detail/abc123.html');
  assert.equal(JobDetail.extractJobId(url), 'abc123');
});

test('拒绝非 BOSS、非 HTTPS 和非岗位详情链接', () => {
  assert.equal(JobDetail.canonicalizeDetailUrl('http://www.zhipin.com/job_detail/abc.html'), '');
  assert.equal(JobDetail.canonicalizeDetailUrl('https://example.com/job_detail/abc.html'), '');
  assert.equal(JobDetail.canonicalizeDetailUrl('https://www.zhipin.com/web/geek/jobs'), '');
});

test('收集岗位优先使用详情 URL 的稳定 ID 并保留原始字段', () => {
  const job = JobDetail.normalizeCollectedJob({
    id: 'AI产品经理|20-30K',
    name: ' AI 产品经理 ',
    company: ' 示例科技 ',
    salary: '20-30K',
    link: 'https://www.zhipin.com/job_detail/stable-id.html?lid=1',
    rawFacts: ['1-3年', '100-499人']
  });
  assert.equal(job.id, 'stable-id');
  assert.equal(job.detailUrl, 'https://www.zhipin.com/job_detail/stable-id.html');
  assert.equal(job.name, 'AI 产品经理');
  assert.equal(job.company, '示例科技');
  assert.equal(job.experience, 'one_to_three');
  assert.equal(job.companySize, 'hundred_to_499');
});

test('稳定 ID 相同即可确认身份；无 ID 时要求岗位名和公司严格一致', () => {
  assert.equal(JobDetail.verifyIdentity(
    { id: 'same', name: 'AI 产品经理', company: '示例科技' },
    { id: 'same', name: '产品经理', company: '示例科技有限公司' }
  ).ok, true);

  assert.equal(JobDetail.verifyIdentity(
    { id: '', name: 'AI 产品经理', company: '示例科技' },
    { id: '', name: 'AI产品经理', company: '示例科技' }
  ).ok, true);

  assert.match(JobDetail.verifyIdentity(
    { id: '', name: 'AI 产品经理', company: '示例科技' },
    { id: '', name: 'AI 产品经理', company: '另一家公司' }
  ).reasons.join('；'), /公司名称/);
});

test('详情字段补全卡片缺失信息但不覆盖稳定身份', () => {
  const merged = JobDetail.mergeDetail({
    id: 'job-1',
    detailUrl: 'https://www.zhipin.com/job_detail/job-1.html',
    name: 'AI 产品经理',
    company: '',
    experience: 'one_to_three',
    companySize: ''
  }, {
    id: 'job-1',
    name: 'AI 产品经理',
    company: '示例科技',
    experience: 'one_to_three',
    companySize: 'hundred_to_499',
    jd: '负责 AI Agent 产品规划。'
  });

  assert.equal(merged.id, 'job-1');
  assert.equal(merged.company, '示例科技');
  assert.equal(merged.companySize, 'hundred_to_499');
  assert.match(merged.jd, /AI Agent/);
});

test('岗位详情合并新增硬筛选事实且不丢失卡片信息', () => {
  const merged = JobDetail.mergeDetail({
    detailUrl: 'https://www.zhipin.com/job_detail/job-advanced.html',
    name: 'AI 产品经理',
    company: '示例科技',
    salary: '15-25K·14薪',
    rawFacts: ['深圳·南山区', '1-3年', '100-499人', '全职'],
    rawLocationFacts: ['深圳·南山区']
  }, {
    jd: '本科，职位发布于 2 天前，负责 RAG 与 Agent 产品。',
    rawFacts: ['本科', '2天前发布']
  });

  assert.equal(merged.employmentType, 'full_time');
  assert.equal(merged.education, 'bachelor');
  assert.equal(merged.educationRequirement, 'bachelor');
  assert.deepEqual(merged.salaryRange, { minK: 15, maxK: 25, months: 14 });
  assert.equal(merged.salaryMinK, 15);
  assert.equal(merged.salaryMaxK, 25);
  assert.equal(merged.salaryMonths, 14);
  assert.equal(merged.city, '深圳');
  assert.equal(merged.district, '南山区');
  assert.equal(merged.publishedDaysAgo, 2);
});

test('岗位规范化只从独立位置事实读取城市，不扫描岗位名和 JD', () => {
  const job = JobDetail.normalizeCollectedJob({
    name: '深圳互联网证券产品经理',
    company: '示例科技',
    rawFacts: ['活动资讯社区', '1-3年'],
    rawLocationFacts: []
  });
  assert.equal(job.city, '');
  assert.equal(job.district, '');

  const located = JobDetail.normalizeCollectedJob({
    name: 'AI 产品经理',
    rawFacts: ['1-3年'],
    rawLocationFacts: ['工作地址深圳南山区']
  });
  assert.equal(located.city, '深圳');
  assert.equal(located.district, '南山区');
  assert.equal(located.citySource, 'page');
});
