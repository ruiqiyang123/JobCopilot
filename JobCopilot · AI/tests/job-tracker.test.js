const test = require('node:test');
const assert = require('node:assert/strict');

const JobTracker = require('../src/job-tracker.js');

const JOB = {
  id: 'job-1',
  name: 'AI 产品经理',
  company: '示例科技',
  salary: '15-25K',
  link: 'https://www.zhipin.com/job_detail/job-1.html'
};

test('首次收集创建已收集记录并保存基础信息和历史', () => {
  const records = JobTracker.upsertCollected([], JOB, 1000);
  assert.deepEqual(records, [{
    id: 'job-1',
    name: 'AI 产品经理',
    company: '示例科技',
    salary: '15-25K',
    link: 'https://www.zhipin.com/job_detail/job-1.html',
    status: 'collected',
    updatedAt: 1000,
    history: [{ status: 'collected', at: 1000 }]
  }]);
});

test('重复收集按 ID 去重并且不会把状态降回已收集', () => {
  let records = JobTracker.upsertCollected([], JOB, 1000);
  records = JobTracker.setStatus(records, 'job-1', 'contacted', 2000);
  records = JobTracker.upsertCollected(records, Object.assign({}, JOB, { salary: '18-28K' }), 3000);

  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'contacted');
  assert.equal(records[0].salary, '18-28K');
  assert.equal(records[0].updatedAt, 2000);
  assert.equal(records[0].history.length, 2);
});

test('支持已沟通、已回复、面试、淘汰和 Offer 状态及历史', () => {
  let records = JobTracker.upsertCollected([], JOB, 1000);
  const transitions = ['contacted', 'replied', 'interview', 'rejected', 'offer'];
  transitions.forEach((status, index) => {
    records = JobTracker.setStatus(records, 'job-1', status, 2000 + index);
  });

  assert.equal(records[0].status, 'offer');
  assert.equal(records[0].updatedAt, 2004);
  assert.deepEqual(records[0].history.map(item => item.status), ['collected'].concat(transitions));
});

test('重复设置相同状态不追加历史，非法状态和未知岗位会拒绝', () => {
  let records = JobTracker.upsertCollected([], JOB, 1000);
  records = JobTracker.setStatus(records, 'job-1', 'contacted', 2000);
  const unchanged = JobTracker.setStatus(records, 'job-1', 'contacted', 3000);
  assert.deepEqual(unchanged, records);

  assert.throws(() => JobTracker.setStatus(records, 'job-1', 'unknown', 4000), /不支持的岗位状态/);
  assert.throws(() => JobTracker.setStatus(records, 'missing', 'replied', 4000), /找不到岗位记录/);
});

test('按状态汇总岗位数量', () => {
  let records = JobTracker.upsertCollected([], JOB, 1000);
  records = JobTracker.upsertCollected(records, Object.assign({}, JOB, { id: 'job-2' }), 1001);
  records = JobTracker.setStatus(records, 'job-1', 'contacted', 2000);
  assert.deepEqual(JobTracker.summarize(records), {
    total: 2,
    collected: 1,
    contacted: 1,
    replied: 0,
    interview: 0,
    rejected: 0,
    offer: 0
  });
});

