const test = require('node:test');
const assert = require('node:assert/strict');

const SearchProfiles = require('../src/search-profiles.js');

const LEGACY = {
  keyword: 'AI 产品经理', city: '深圳', count: '20',
  searchMatchMode: 'balanced', keywordExpansionEnabled: true,
  jobFilterConfig: { experienceEnabled: true, experienceValues: ['one_to_three'] }
};

test('旧配置迁移为一个默认导入方案且不丢失条件', () => {
  const state = SearchProfiles.normalizeState(undefined, LEGACY);
  assert.equal(state.profiles.length, 1);
  assert.equal(state.profiles[0].name, '默认导入方案');
  assert.equal(state.profiles[0].keyword, 'AI 产品经理');
  assert.deepEqual(state.profiles[0].jobFilterConfig.experienceValues, ['one_to_three']);
});

test('筛选方案可新增、更新、切换和删除但至少保留一个', () => {
  let state = SearchProfiles.normalizeState(undefined, LEGACY);
  const created = SearchProfiles.createProfile(LEGACY, '深圳 AI 产品');
  state = SearchProfiles.upsertProfile(state, created);
  state = SearchProfiles.selectProfile(state, created.id);
  assert.equal(SearchProfiles.selectedProfile(state).name, '深圳 AI 产品');

  state = SearchProfiles.upsertProfile(state, Object.assign({}, created, { count: '30' }));
  assert.equal(SearchProfiles.selectedProfile(state).count, '30');
  state = SearchProfiles.removeProfile(state, created.id);
  assert.equal(state.profiles.length, 1);
  assert.throws(() => SearchProfiles.removeProfile(state, state.selectedProfileId), /至少保留一个/);
});

test('方案返回深拷贝，修改表单不会污染已保存配置', () => {
  const state = SearchProfiles.normalizeState(undefined, LEGACY);
  const selected = SearchProfiles.selectedProfile(state);
  selected.jobFilterConfig.experienceValues.push('three_to_five');
  assert.deepEqual(state.profiles[0].jobFilterConfig.experienceValues, ['one_to_three']);
});
