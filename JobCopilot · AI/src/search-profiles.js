(function initSearchProfiles(root, factory) {
  const api = factory();
  root.SearchProfiles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createSearchProfiles() {
  'use strict';

  function clone(value) { return JSON.parse(JSON.stringify(value === undefined ? null : value)); }
  function id() { return 'profile-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }

  function normalizeProfile(profile, fallback) {
    const source = Object.assign({}, fallback || {}, profile || {});
    return {
      id: String(source.id || id()),
      name: String(source.name || '未命名筛选方案').trim() || '未命名筛选方案',
      keyword: String(source.keyword || ''),
      city: String(source.city || ''),
      count: String(source.count || '20'),
      searchMatchMode: ['precise', 'balanced', 'loose'].indexOf(source.searchMatchMode) >= 0
        ? source.searchMatchMode : 'balanced',
      keywordExpansionEnabled: source.keywordExpansionEnabled !== false,
      jobFilterConfig: clone(source.jobFilterConfig || {}),
      createdAt: Number(source.createdAt) || Date.now(),
      updatedAt: Number(source.updatedAt) || Date.now()
    };
  }

  function createProfile(config, name) {
    return normalizeProfile(Object.assign({}, config || {}, {
      id: id(), name: name || '新筛选方案', createdAt: Date.now(), updatedAt: Date.now()
    }));
  }

  function normalizeState(state, legacy) {
    const source = state || {};
    let profiles = Array.isArray(source.profiles)
      ? source.profiles.map(profile => normalizeProfile(profile)) : [];
    if (!profiles.length) profiles = [createProfile(legacy || {}, '默认导入方案')];
    const selected = profiles.some(profile => profile.id === source.selectedProfileId)
      ? source.selectedProfileId : profiles[0].id;
    return { selectedProfileId: selected, profiles: profiles };
  }

  function selectedProfile(state) {
    const normalized = normalizeState(state);
    const profile = normalized.profiles.find(item => item.id === normalized.selectedProfileId) || normalized.profiles[0];
    return clone(profile);
  }

  function selectProfile(state, profileId) {
    const normalized = normalizeState(state);
    if (!normalized.profiles.some(profile => profile.id === profileId)) throw new Error('找不到筛选方案');
    normalized.selectedProfileId = profileId;
    return normalized;
  }

  function upsertProfile(state, profile) {
    const normalized = normalizeState(state);
    const next = normalizeProfile(profile);
    const index = normalized.profiles.findIndex(item => item.id === next.id);
    if (index >= 0) normalized.profiles[index] = next;
    else normalized.profiles.push(next);
    normalized.selectedProfileId = next.id;
    return normalized;
  }

  function removeProfile(state, profileId) {
    const normalized = normalizeState(state);
    if (normalized.profiles.length <= 1) throw new Error('至少保留一个筛选方案');
    const next = normalized.profiles.filter(profile => profile.id !== profileId);
    if (next.length === normalized.profiles.length) throw new Error('找不到筛选方案');
    normalized.profiles = next;
    if (normalized.selectedProfileId === profileId) normalized.selectedProfileId = next[0].id;
    return normalized;
  }

  return {
    normalizeProfile: normalizeProfile,
    createProfile: createProfile,
    normalizeState: normalizeState,
    selectedProfile: selectedProfile,
    selectProfile: selectProfile,
    upsertProfile: upsertProfile,
    removeProfile: removeProfile
  };
});
