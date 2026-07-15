// ===== JobCopilot Service Worker：收集 → 完整 JD 筛选 → 人工批准 → 三段式投递 =====
importScripts(
  '/src/selectors.js', '/src/job-filters.js', '/src/job-detail.js',
  '/src/greeting-plans.js', '/src/review-workflow.js', '/src/batch-lifecycle.js', '/src/search-strategy.js',
  '/src/workflow-safety.js',
  '/src/job-tracker.js', '/src/chat-navigation.js', '/src/contact-retry.js',
  '/src/storage-utils.js', '/src/llm-client.js'
);

const CFG_KEYS = [
  'llmProvider', 'llmApiKey', 'llmBaseUrl', 'llmModel', 'llmAuthType', 'dsKey',
  'resumeText', 'resumeImage', 'city', 'keyword', 'count', 'jobFilterConfig',
  'searchMatchMode', 'keywordExpansionEnabled', 'greetingPlansState'
];

let state = {
  phase: 'idle', paused: false, aborted: false,
  jobs: [], screened: [], results: [], processed: {},
  previews: {}, lastBatch: null, trackerRecords: [],
  greetingPlansState: null
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); } catch (error) {}

// ── 通用工具 ──
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const rand = (a, b) => sleep(a + Math.random() * (b - a));
function log(text, level) { chrome.runtime.sendMessage({ type: 'LOG', text: text, level: level || 'info' }).catch(() => {}); }
function pushPhase() { chrome.runtime.sendMessage({ type: 'PHASE', phase: state.phase }).catch(() => {}); }
function progress(cur, total, label) { chrome.runtime.sendMessage({ type: 'PROGRESS', cur: cur, total: total, label: label || '' }).catch(() => {}); }
async function waitIfPaused() { while (state.paused && !state.aborted) await sleep(400); }
function resumeFull(cfg) { return String(cfg.resumeText || '').trim(); }
function findJob(id) { return state.jobs.find(job => job.id === id) || null; }
function findScreened(id) { return state.screened.find(job => job.id === id) || null; }

async function storageSet(values) {
  try { await chrome.storage.local.set(values); }
  catch (error) { throw StorageUtils.toUserError(error); }
}

async function getCfg() {
  const stored = await chrome.storage.local.get(CFG_KEYS);
  const migrated = LLMClient.migrateStoredConfig(stored);
  if (Object.keys(migrated).length) await storageSet(migrated);
  const config = Object.assign({}, stored, migrated);
  config.greetingPlansState = GreetingPlans.normalizeState(config.greetingPlansState, {
    resumeImage: config.resumeImage || ''
  });
  state.greetingPlansState = config.greetingPlansState;
  return config;
}

function selectedGreetingPlan(cfg) {
  const source = (cfg && cfg.greetingPlansState) || state.greetingPlansState;
  return GreetingPlans.selectedPlan(source);
}

function jobInfo(job) {
  return '岗位：' + (job.name || '')
    + '\n公司：' + (job.company || '')
    + '\n薪资：' + (job.salary || '')
    + '\n工作经验：' + JobFilters.labelFor('experience', job.experience)
    + '\n公司规模：' + JobFilters.labelFor('companySize', job.companySize)
    + '\n岗位类型：' + JobFilters.labelFor('employmentType', job.employmentType)
    + '\n学历要求：' + JobFilters.labelFor('education', job.education)
    + '\n工作地点：' + [job.city, job.district].filter(Boolean).join('·')
    + '\n发布时间：' + (job.publishedDaysAgo === 0 ? '当天' : (job.publishedDaysAgo ? job.publishedDaysAgo + ' 天前' : '未知'))
    + '\n完整 JD：\n' + String(job.jd || '').slice(0, 8000);
}

function hardFilterJob(job, cfg) {
  return Object.assign({}, job, JobFilters.evaluate(job, cfg.jobFilterConfig));
}

function blockedScreenResult(job) {
  const prefix = job.filterStatus === 'pending' ? '待人工补充：' : '硬筛选排除：';
  return ReviewWorkflow.normalizeJob(Object.assign({}, job, {
    match: false,
    reason: prefix + (job.filterReasons || []).join('；')
  }));
}

// ── 岗位进度 ──
async function hydrateTrackerRecords() {
  if (state.trackerRecords.length) return state.trackerRecords;
  const saved = await chrome.storage.local.get('jobTrackerRecords');
  state.trackerRecords = saved.jobTrackerRecords || [];
  return state.trackerRecords;
}

async function persistTrackerRecords() {
  await storageSet({ jobTrackerRecords: state.trackerRecords });
  chrome.runtime.sendMessage({
    type: 'TRACKER_UPDATED',
    records: state.trackerRecords,
    summary: JobTracker.summarize(state.trackerRecords)
  }).catch(() => {});
}

async function trackCollectedJobs(jobs) {
  await hydrateTrackerRecords();
  (jobs || []).forEach(job => {
    state.trackerRecords = JobTracker.upsertCollected(state.trackerRecords, job, Date.now());
  });
  await persistTrackerRecords();
}

async function updateTrackerStatus(jobId, status) {
  await hydrateTrackerRecords();
  state.trackerRecords = JobTracker.setStatus(state.trackerRecords, jobId, status, Date.now());
  await persistTrackerRecords();
  return { records: state.trackerRecords, summary: JobTracker.summarize(state.trackerRecords) };
}

async function markTrackerContacted(job) {
  await hydrateTrackerRecords();
  state.trackerRecords = JobTracker.upsertCollected(state.trackerRecords, job, Date.now());
  state.trackerRecords = JobTracker.setStatus(state.trackerRecords, job.id, 'contacted', Date.now());
  await persistTrackerRecords();
}

// ── 模型 ──
function llmConfigFrom(cfg) {
  return {
    provider: cfg.llmProvider,
    apiKey: cfg.llmApiKey,
    baseUrl: cfg.llmBaseUrl,
    model: cfg.llmModel,
    authType: cfg.llmAuthType
  };
}

function providerNameFrom(cfg) {
  try { return LLMClient.normalizeConfig(llmConfigFrom(cfg)).providerName; }
  catch (error) { return 'AI'; }
}

async function callLLM(cfg, messages, options) {
  return LLMClient.call(llmConfigFrom(cfg), messages, options);
}

async function screenJob(cfg, job) {
  const system = '你是资深求职助手。请完全依据求职者简历和岗位完整 JD 判断是否值得投递。'
    + '保留：方向、技能和经历相关，经验年限、学历和级别够得着。'
    + '剔除：方向明显无关，硬要求明显超出简历，或岗位级别明显过高。'
    + '只输出 JSON：{"match":true或false,"reason":"一句具体理由"}。';
  const user = '求职者简历：\n' + resumeFull(cfg) + '\n\n待判断岗位：\n' + jobInfo(job) + '\n\n严格输出 JSON。';
  const raw = await callLLM(cfg, [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { maxTokens: 240, temperature: 0.3, jsonMode: true });
  let parsed = null;
  try { parsed = JSON.parse(raw); }
  catch (error) {
    const match = raw && raw.match(/\{[\s\S]*\}/);
    if (match) { try { parsed = JSON.parse(match[0]); } catch (ignored) {} }
  }
  if (!parsed) return { match: false, reason: 'AI 返回格式无法解析' };
  return { match: parsed.match === true, reason: String(parsed.reason || '').trim() };
}

async function generateAiOpening(cfg, plan, job, jd) {
  const system = '你是求职者本人，正在 BOSS 直聘给 HR 发送第一条个性化开场。'
    + '内容会原样发送，禁止注释、标题、字数说明或虚构经历。\n'
    + '用户规则：' + plan.aiInstruction;
  const user = '我的简历：\n' + resumeFull(cfg)
    + '\n\n目标岗位：' + (job.name || '') + (job.company ? '（' + job.company + '）' : '')
    + '\n完整 JD：\n' + String(jd || job.jd || '').slice(0, 8000)
    + '\n\n直接输出一段适合 BOSS 聊天的开场文字。';
  const raw = await callLLM(cfg, [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { maxTokens: 420, temperature: 0.45 });
  return String(raw || '').trim();
}

async function testLLMConnection(config) {
  const normalized = LLMClient.validateConfig(config);
  const startedAt = Date.now();
  const reply = await LLMClient.call(normalized, [
    { role: 'user', content: '连接测试：请只回复 OK' }
  ], { maxTokens: 16, temperature: 0 });
  return {
    provider: normalized.providerName,
    model: normalized.model,
    elapsedMs: Date.now() - startedAt,
    reply: String(reply || '').trim().slice(0, 40)
  };
}

// ── 标签页与内容脚本 ──
function waitTabComplete(tabId, timeoutMs) {
  const timeout = Number(timeoutMs) || 20000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => finish(new Error('页面加载超时，请检查网络或重新登录 BOSS')), timeout);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else setTimeout(resolve, 1000);
    }
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        finish();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError) return finish(new Error(chrome.runtime.lastError.message));
      if (tab && tab.status === 'complete') finish();
    });
  });
}

function sendToTab(tabId, message, timeoutMs) {
  const timeout = Number(timeoutMs) || 12000;
  return new Promise(resolve => {
    let settled = false;
    const timeoutId = setTimeout(() => finish({
      success: false,
      error: '页面脚本响应超时，请刷新扩展后重试'
    }), timeout);
    function finish(response) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(response);
    }
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) finish({ success: false, error: chrome.runtime.lastError.message });
      else finish(response || { success: false, error: '页面脚本没有响应' });
    });
  });
}

async function ensureInjected(tabId, file) {
  const files = file === 'src/content-chat.js'
    ? ['src/selectors.js', 'src/message-bundle.js', 'src/content-chat.js']
    : [
      'src/selectors.js', 'src/job-filters.js', 'src/job-detail.js',
      'src/contact-interstitial.js', 'src/content-search.js'
    ];
  try {
    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: files });
    return true;
  } catch (error) { return false; }
}

function resolveCity(cfg) {
  const firstCity = String(cfg.city || '').split(/[\/、,，\s]+/)[0].replace(/[市省]$/, '') || '';
  const code = (typeof CITY_MAP !== 'undefined' && CITY_MAP[firstCity]) || '100010000';
  return { name: firstCity, code: code, found: code !== '100010000' || firstCity === '全国' };
}

function buildSearchUrl(cfg, keyword) {
  const city = resolveCity(cfg);
  return 'https://www.zhipin.com/web/geek/jobs?' + new URLSearchParams({
    query: keyword || cfg.keyword || '', city: city.code
  }).toString();
}

async function getSearchTab(cfg, keyword) {
  const url = buildSearchUrl(cfg, keyword);
  const tabs = await chrome.tabs.query({ url: '*://*.zhipin.com/web/geek/jobs*' });
  let tab = tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url: url, active: true });
  else tab = await chrome.tabs.update(tab.id, { url: url, active: true });
  await waitTabComplete(tab.id);
  await sleep(1200);
  return tab;
}

async function createDetailTab(detailUrl, active) {
  const url = JobDetail.canonicalizeDetailUrl(detailUrl);
  if (!url) throw new Error('岗位详情链接缺失或无效');
  const tab = await chrome.tabs.create({ url: url, active: active === true });
  try {
    await waitTabComplete(tab.id);
    await ensureInjected(tab.id, 'src/content-search.js');
    return tab;
  } catch (error) {
    await removeTab(tab.id);
    throw error;
  }
}

async function removeTab(tabId) {
  if (!tabId) return;
  try { await chrome.tabs.remove(tabId); } catch (error) {}
}

async function removeTabs(tabIds) {
  const unique = Array.from(new Set((tabIds || []).filter(Boolean)));
  for (const tabId of unique) await removeTab(tabId);
}

async function readDetailFromTab(tabId, job) {
  const detail = await sendToTab(tabId, { type: 'READ_DETAIL' });
  if (!detail || !detail.success || !detail.currentJob) {
    throw new Error((detail && detail.error) || '无法读取岗位详情');
  }
  const identity = JobDetail.verifyIdentity(job, detail.currentJob);
  if (!identity.ok) throw new Error('身份校验失败：' + identity.reasons.join('；'));
  return detail;
}

async function readJobDetail(job, cfg) {
  if (job.detailUrl) {
    let tab = null;
    try {
      tab = await createDetailTab(job.detailUrl, false);
      return await readDetailFromTab(tab.id, job);
    } finally {
      if (tab) await removeTab(tab.id);
    }
  }

  const searchTab = await getSearchTab(cfg);
  await ensureInjected(searchTab.id, 'src/content-search.js');
  const detail = await sendToTab(searchTab.id, { type: 'OPEN_JD', job: job });
  if (!detail || !detail.success || !detail.currentJob) {
    throw new Error((detail && detail.error) || '详情链接缺失，搜索页也未找到岗位');
  }
  return detail;
}

async function openJobForDelivery(job, cfg) {
  if (job.detailUrl) {
    const tab = await createDetailTab(job.detailUrl, false);
    const detail = await readDetailFromTab(tab.id, job);
    return { tab: tab, detail: detail, temporary: true };
  }
  const tab = await getSearchTab(cfg);
  await ensureInjected(tab.id, 'src/content-search.js');
  const detail = await sendToTab(tab.id, { type: 'OPEN_JD', job: job });
  if (!detail || !detail.success || !detail.currentJob) {
    throw new Error((detail && detail.error) || '无法读取岗位详情');
  }
  return { tab: tab, detail: detail, temporary: false };
}

async function establishChatPage(opened, job, temporaryTabIds) {
  const before = await chrome.tabs.query({});
  const observer = ChatNavigation.observe(chrome.tabs, {
    sourceTabId: opened.tab.id,
    expectedJobId: job.id,
    existingTabIds: before.map(tab => tab.id),
    timeoutMs: 30000,
    missingJobIdGraceMs: 12000,
    pollIntervalMs: 250,
    isCancelled: () => state.aborted
  });
  try {
    log('正在点击沟通并等待对应岗位聊天页', 'info');
    const command = sendToTab(opened.tab.id, { type: 'GO_CHAT', job: job }, 15000);
    const destination = await ChatNavigation.coordinate(command, observer, () => {
      log('详情页跳转中，已忽略瞬时消息通道关闭', 'info');
    });
    if (!destination || !destination.tab || !destination.tab.id) {
      throw new Error('未找到对应岗位聊天页');
    }
    if (destination.created) temporaryTabIds.add(destination.tab.id);
    let chatTab = await chrome.tabs.get(destination.tab.id);
    let identity = ChatNavigation.matchChatUrl(chatTab.url || destination.tab.url || '', job.id);
    if (!identity.ok) throw new Error(identity.reason);
    await waitTabComplete(chatTab.id, 20000);
    chatTab = await chrome.tabs.get(chatTab.id);
    identity = ChatNavigation.matchChatUrl(chatTab.url || '', job.id);
    if (!identity.ok) throw new Error(identity.reason);
    log('已进入对应岗位聊天页', 'success');
    return { tab: chatTab, created: destination.created, relation: destination.relation };
  } catch (error) {
    if (error && error.created && error.tabId) temporaryTabIds.add(error.tabId);
    observer.cancel();
    throw error;
  }
}

// ── 持久化与迁移 ──
async function persistReviewState() {
  state.previews = ReviewWorkflow.stripEmbeddedImages(state.previews);
  await storageSet({
    sw_jobs: state.jobs,
    sw_screened: state.screened,
    sw_previews: state.previews,
    lastBatch: state.lastBatch,
    greetingPlansState: state.greetingPlansState,
    processed: state.processed
  });
}

function broadcastDeliveryState() {
  chrome.runtime.sendMessage({
    type: 'DELIVERY_STATE_UPDATED',
    screened: state.screened,
    lastBatch: state.lastBatch
  }).catch(() => {});
}

function migrateDeliveryState() {
  state.jobs = BatchLifecycle.migrate(state.jobs, state.processed, state.lastBatch);
  state.screened = BatchLifecycle.migrate(state.screened, state.processed, state.lastBatch);
}

function markDeliverySucceeded(jobId, at) {
  state.jobs = BatchLifecycle.markSucceeded(state.jobs, jobId, at);
  state.screened = BatchLifecycle.markSucceeded(state.screened, jobId, at);
}

function markDeliveryFailed(jobId, error, step) {
  state.jobs = BatchLifecycle.markFailed(state.jobs, jobId, error, step);
  state.screened = BatchLifecycle.markFailed(state.screened, jobId, error, step);
}

function markDeliveryNotRun(jobIds) {
  state.jobs = BatchLifecycle.markNotRun(state.jobs, jobIds);
  state.screened = BatchLifecycle.markNotRun(state.screened, jobIds);
}

async function hydrateReviewState() {
  const saved = await chrome.storage.local.get([
    'sw_jobs', 'sw_screened', 'sw_previews', 'lastBatch', 'greetingPlansState',
    'resumeImage', 'processed'
  ]);
  if (!state.jobs.length) state.jobs = ReviewWorkflow.normalizeJobs(saved.sw_jobs || []);
  if (!state.screened.length) state.screened = ReviewWorkflow.normalizeJobs(saved.sw_screened || state.jobs);
  if (!Object.keys(state.previews).length) state.previews = ReviewWorkflow.migratePreviews(saved.sw_previews || {});
  if (!state.lastBatch) state.lastBatch = saved.lastBatch || null;
  if (!state.greetingPlansState) {
    state.greetingPlansState = GreetingPlans.normalizeState(saved.greetingPlansState, {
      resumeImage: saved.resumeImage || ''
    });
  }
  if (saved.processed) state.processed = saved.processed;
  migrateDeliveryState();
  await persistReviewState();
  if (saved.resumeImage) await chrome.storage.local.remove('resumeImage');
}

function syncJob(job) {
  const normalized = ReviewWorkflow.normalizeJob(job);
  const jobIndex = state.jobs.findIndex(item => item.id === normalized.id);
  if (jobIndex >= 0) state.jobs[jobIndex] = normalized;
  else state.jobs.push(normalized);
  const screenedIndex = state.screened.findIndex(item => item.id === normalized.id);
  if (screenedIndex >= 0) state.screened[screenedIndex] = normalized;
  else state.screened.push(normalized);
  return normalized;
}

// ── 收集与完整 JD 筛选 ──
async function hydrateOneJob(job, cfg) {
  try {
    const detail = await readJobDetail(job, cfg);
    return JobDetail.mergeDetail(job, Object.assign({}, detail.currentJob, {
      jd: detail.jd || '', available: detail.available !== false, detailReadAt: detail.detailReadAt
    }));
  } catch (error) {
    return Object.assign({}, job, { detailError: error.message || '详情读取失败' });
  }
}

async function hydrateJobDetails(jobs, cfg) {
  const result = [];
  const concurrency = 2;
  for (let index = 0; index < jobs.length; index += concurrency) {
    if (state.aborted) break;
    await waitIfPaused();
    const batch = jobs.slice(index, index + concurrency);
    const hydrated = await Promise.all(batch.map(job => hydrateOneJob(job, cfg)));
    result.push.apply(result, hydrated);
    progress(result.length, jobs.length, '读取详情');
  }
  return result;
}

async function collectAcrossSearchTerms(cfg, limit) {
  const terms = SearchStrategy.resolveTerms({
    keyword: cfg.keyword,
    matchMode: cfg.searchMatchMode,
    keywordExpansionEnabled: cfg.keywordExpansionEnabled
  });
  let collected = [];
  let rawCards = 0;
  const maximum = Math.max(1, Number(limit) || 20);
  const maxRounds = Math.max(1, Math.ceil(maximum / 5));

  log('搜索范围：' + terms.length + ' 个关键词，唯一岗位上限 ' + maximum);
  for (let round = 1; round <= maxRounds && collected.length < maximum; round++) {
    let roundAdded = 0;
    for (let index = 0; index < terms.length && collected.length < maximum; index++) {
      if (state.aborted) break;
      await waitIfPaused();
      const term = terms[index];
      const remainingTerms = Math.max(1, terms.length - index);
      const quota = Math.min(5, Math.max(1, Math.ceil((maximum - collected.length) / remainingTerms)));
      try {
        log('搜索岗位：' + term + '（第 ' + round + ' 轮）');
        const tab = await getSearchTab(cfg, term);
        await ensureInjected(tab.id, 'src/content-search.js');
        const target = SearchStrategy.roundTarget(round, maximum);
        const response = await sendToTab(tab.id, { type: 'SCRAPE', count: target });
        if (!response || !response.success) {
          throw new Error((response && response.error) || '岗位收集失败');
        }
        const jobs = (response.jobs || []).map(JobDetail.normalizeCollectedJob);
        rawCards += jobs.length;
        const known = new Set(collected.map(job => job.id));
        const duplicates = jobs.filter(job => known.has(job.id));
        const fresh = jobs.filter(job => !known.has(job.id)).slice(0, quota);
        const before = collected.length;
        collected = SearchStrategy.mergeJobs(collected, duplicates.concat(fresh), term, maximum);
        roundAdded += collected.length - before;
        progress(collected.length, maximum, '跨词收集');
      } catch (error) {
        throw new Error('搜索词“' + term + '”失败：' + error.message);
      }
    }
    if (state.aborted || collected.length >= maximum) break;
    if (roundAdded === 0) {
      log('全部关键词本轮没有新增岗位，已停止继续翻页', 'warn');
      break;
    }
  }
  log('跨词收集完成：原始卡片 ' + rawCards + '，去重后 ' + collected.length, 'success');
  return { jobs: collected, terms: terms, rawCards: rawCards };
}

async function runCollect() {
  state.aborted = false;
  state.paused = false;
  state.jobs = [];
  state.screened = [];
  state.previews = {};
  state.lastBatch = null;
  state.results = [];
  state.phase = 'collecting';
  pushPhase();

  const cfg = await getCfg();
  if (!cfg.llmApiKey) return stopWithConfigError('请先填写 AI 模型 API Key');
  if (!String(cfg.keyword || '').trim()) return stopWithConfigError('请先填写岗位关键词');
  if (!resumeFull(cfg)) return stopWithConfigError('请先填写简历文字');
  try { JobFilters.normalizeConfig(cfg.jobFilterConfig); }
  catch (error) { return stopWithConfigError(error.message); }

  const city = resolveCity(cfg);
  log('准备搜索：' + cfg.keyword + ' | 城市：' + (city.found ? city.name : '全国'));
  if (cfg.city && !city.found) log('城市“' + cfg.city + '”未识别，已按全国搜索', 'warn');

  try {
    const count = parseInt(cfg.count, 10) || 20;
    const collection = await collectAcrossSearchTerms(cfg, count);
    const collected = collection.jobs;
    log('收集到 ' + collected.length + ' 个岗位，开始读取完整详情', 'success');
    if (!collected.length) throw new Error('没有收集到岗位');

    state.phase = 'screening';
    pushPhase();
    const hydrated = await hydrateJobDetails(collected, cfg);
    state.jobs = hydrated.map(job => hardFilterJob(job, cfg));
    await trackCollectedJobs(state.jobs);

    const blocked = state.jobs.filter(job => job.filterStatus !== 'pass').map(blockedScreenResult);
    const eligible = state.jobs.filter(job => job.filterStatus === 'pass');
    state.screened = blocked.slice();
    log('硬筛选：通过 ' + eligible.length + '，排除 '
      + blocked.filter(job => job.filterStatus === 'fail').length + '，待补充 '
      + blocked.filter(job => job.filterStatus === 'pending').length);
    log('AI 使用完整 JD 筛选中（' + providerNameFrom(cfg) + '）…');

    let completed = blocked.length;
    progress(completed, state.jobs.length, 'AI 筛选');
    const concurrency = 3;
    for (let index = 0; index < eligible.length; index += concurrency) {
      if (state.aborted) break;
      await waitIfPaused();
      const batch = eligible.slice(index, index + concurrency);
      const screenedBatch = await Promise.all(batch.map(async job => {
        try {
          const result = await screenJob(cfg, job);
          return ReviewWorkflow.normalizeJob(Object.assign({}, job, result));
        } catch (error) {
          return ReviewWorkflow.normalizeJob(Object.assign({}, job, {
            match: false, reason: 'AI 筛选异常：' + error.message
          }));
        }
      }));
      state.screened.push.apply(state.screened, screenedBatch);
      completed += screenedBatch.length;
      progress(completed, state.jobs.length, 'AI 筛选');
    }

    state.screened.forEach(screened => {
      const index = state.jobs.findIndex(job => job.id === screened.id);
      if (index >= 0) state.jobs[index] = screened;
    });
    const matched = state.screened.filter(job => job.reviewStatus === 'pending_review').length;
    log('筛选完成：推荐 ' + matched + ' / ' + state.screened.length, 'success');
    await persistReviewState();
    state.phase = 'review';
    pushPhase();
    chrome.runtime.sendMessage({ type: 'SCREENED', screened: state.screened }).catch(() => {});
  } catch (error) {
    log('收集失败：' + error.message, 'error');
    state.phase = 'idle';
    pushPhase();
  }
}

function stopWithConfigError(message) {
  log(message, 'error');
  state.phase = 'idle';
  pushPhase();
}

async function confirmFilterPending(jobId) {
  await hydrateReviewState();
  const cfg = await getCfg();
  const job = findJob(jobId);
  if (!job) throw new Error('找不到待补充岗位');
  const confirmed = JobFilters.confirmPending(job, cfg.jobFilterConfig);
  const aiResult = await screenJob(cfg, confirmed);
  const updated = syncJob(ReviewWorkflow.normalizeJob(Object.assign({}, confirmed, aiResult, {
    reviewStatus: aiResult.match ? 'pending_review' : 'filtered_out',
    reviewUpdatedAt: Date.now(),
    reason: (confirmed.filterReasons || []).join('；') + '；AI：' + aiResult.reason
  })));
  await persistReviewState();
  chrome.runtime.sendMessage({ type: 'SCREENED', screened: state.screened }).catch(() => {});
  return { screened: state.screened, job: updated };
}

async function setReviewDecision(jobId, decision) {
  await hydrateReviewState();
  const job = findScreened(jobId) || findJob(jobId);
  if (!job) throw new Error('找不到岗位');
  const updated = syncJob(ReviewWorkflow.setDecision(job, decision, Date.now()));
  if (decision !== 'approved' && state.previews[jobId]) {
    state.previews[jobId] = Object.assign({}, state.previews[jobId], {
      status: 'expired', error: '岗位已取消批准'
    });
  }
  await persistReviewState();
  chrome.runtime.sendMessage({ type: 'SCREENED', screened: state.screened }).catch(() => {});
  return { job: updated, screened: state.screened, previews: state.previews };
}

// ── 招呼方案 ──
async function saveGreetingPlans(nextState) {
  await hydrateReviewState();
  const normalized = GreetingPlans.normalizeState(nextState);
  state.greetingPlansState = normalized;
  invalidatePreviews('招呼方案已变化，需要重新预演');
  await storageSet({
    greetingPlansState: normalized,
    sw_previews: state.previews
  });
  return { state: normalized, previews: state.previews };
}

function invalidatePreviews(reason) {
  Object.keys(state.previews || {}).forEach(jobId => {
    const preview = state.previews[jobId];
    if (preview && preview.status !== 'failed') {
      state.previews[jobId] = Object.assign({}, preview, {
        status: 'expired', error: reason || '配置已变化，需要重新预演'
      });
    }
  });
}

async function invalidateStoredPreviews(reason) {
  await hydrateReviewState();
  invalidatePreviews(reason);
  await persistReviewState();
  return { previews: state.previews };
}

// ── 预演与冻结 ──
function previewInputs(job, cfg, plan, jd) {
  return {
    job: job,
    jd: jd || job.jd || '',
    resumeText: resumeFull(cfg),
    jobFilterConfig: cfg.jobFilterConfig || {},
    plan: plan
  };
}

function createPreviewRunId() {
  return 'preview-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function pushPreviewProgress(prepared, jobId, stage, completed, error, preview) {
  chrome.runtime.sendMessage({
    type: 'PREVIEW_PROGRESS',
    runId: prepared.runId,
    jobId: jobId,
    stage: stage,
    completed: completed,
    total: prepared.ids.length,
    error: error || '',
    preview: preview || null
  }).catch(() => {});
}

async function preparePreviewRun(jobIds) {
  await hydrateReviewState();
  const cfg = await getCfg();
  const plan = GreetingPlans.validateForSend(selectedGreetingPlan(cfg));
  const requested = Array.from(new Set((Array.isArray(jobIds) && jobIds.length
    ? jobIds
    : state.screened.filter(job => job.reviewStatus === 'approved').map(job => job.id))
    .map(id => String(id || '').trim()).filter(Boolean)));
  const ids = requested.filter(id => {
    const job = findScreened(id);
    return job && job.reviewStatus === 'approved' && !state.processed[id];
  });
  if (!ids.length) throw new Error('没有已批准的岗位可预演');
  return {
    runId: createPreviewRunId(),
    cfg: cfg,
    plan: plan,
    requested: requested,
    ids: ids
  };
}

async function runPreview(prepared) {
  state.aborted = false;
  state.paused = false;
  state.results = [];
  state.phase = 'previewing';
  pushPhase();
  const cfg = prepared.cfg;
  const plan = prepared.plan;
  const requested = prepared.requested;
  const ids = prepared.ids;

  state.lastBatch = {
    mode: 'preview', status: 'running', startedAt: Date.now(),
    runId: prepared.runId,
    greetingPlanId: plan.id, requestedIds: requested, executedIds: ids.slice(),
    succeeded: [], failed: [], notRun: []
  };

  progress(0, ids.length, '预演');
  ids.forEach(id => pushPreviewProgress(prepared, id, 'queued', 0));
  for (let index = 0; index < ids.length; index++) {
    if (state.aborted) {
      state.lastBatch.status = 'stopped';
      state.lastBatch.notRun = ids.slice(index);
      state.lastBatch.notRun.forEach(id => {
        pushPreviewProgress(prepared, id, 'not_run', state.lastBatch.succeeded.length);
      });
      break;
    }
    await waitIfPaused();
    const original = findJob(ids[index]);
    try {
      if (!original) throw new Error('找不到岗位数据');
      log('[' + (index + 1) + '/' + ids.length + '] 预演 ' + original.name + ' - ' + (original.company || ''));
      pushPreviewProgress(prepared, original.id, 'reading_detail', state.lastBatch.succeeded.length);
      const detail = await readJobDetail(original, cfg);
      const current = JobDetail.mergeDetail(original, Object.assign({}, detail.currentJob, { jd: detail.jd || '' }));
      pushPreviewProgress(prepared, original.id, 'verifying', state.lastBatch.succeeded.length);
      const verified = WorkflowSafety.verifyEligibility(original, current, cfg.jobFilterConfig, state.processed);
      if (!verified.ok) throw new Error(verified.reasons.join('；'));
      verified.job.reviewStatus = original.reviewStatus;
      if (plan.aiOpeningEnabled) {
        pushPreviewProgress(prepared, original.id, 'generating_opening', state.lastBatch.succeeded.length);
      }
      const aiOpening = plan.aiOpeningEnabled ? await generateAiOpening(cfg, plan, verified.job, detail.jd || '') : '';
      if (plan.aiOpeningEnabled && !aiOpening) throw new Error('AI 个性化开场生成失败');
      const preview = ReviewWorkflow.createPreview(
        previewInputs(verified.job, cfg, plan, detail.jd || ''),
        { aiOpening: aiOpening, fixedMessage: plan.fixedMessage },
        Date.now()
      );
      state.previews[original.id] = preview;
      state.lastBatch.succeeded.push(original.id);
      progress(index + 1, ids.length, '预演');
      await persistReviewState();
      pushPreviewProgress(prepared, original.id, 'draft', state.lastBatch.succeeded.length, '', preview);
    } catch (error) {
      const message = error && error.message ? error.message : '预演失败';
      state.previews[ids[index]] = {
        jobId: ids[index], status: 'failed', aiOpening: '', fixedMessage: '',
        inputFingerprint: '', error: message, createdAt: Date.now()
      };
      state.lastBatch.status = 'failed';
      state.lastBatch.failed.push({ id: ids[index], error: message });
      state.lastBatch.notRun = ids.slice(index + 1);
      pushPreviewProgress(
        prepared, ids[index], 'failed', state.lastBatch.succeeded.length,
        message, state.previews[ids[index]]
      );
      state.lastBatch.notRun.forEach(id => {
        pushPreviewProgress(prepared, id, 'not_run', state.lastBatch.succeeded.length);
      });
      log('预演失败，已停止批次：' + message, 'error');
      break;
    }
  }
  if (state.lastBatch.status === 'running') state.lastBatch.status = 'completed';
  state.lastBatch.finishedAt = Date.now();
  await persistReviewState();
  state.phase = 'review';
  pushPhase();
  chrome.runtime.sendMessage({
    type: 'PREVIEWED', runId: prepared.runId, previews: state.previews,
    lastBatch: state.lastBatch, screened: state.screened
  }).catch(() => {});
}

async function handlePreviewRunError(error, prepared) {
  const message = (error && error.message) || '预演失败';
  const succeeded = state.lastBatch && Array.isArray(state.lastBatch.succeeded)
    ? state.lastBatch.succeeded.slice() : [];
  const failedIds = state.lastBatch && Array.isArray(state.lastBatch.failed)
    ? state.lastBatch.failed.map(item => item.id) : [];
  const notRun = prepared.ids.filter(id => succeeded.indexOf(id) < 0 && failedIds.indexOf(id) < 0);
  state.lastBatch = Object.assign({
    mode: 'preview', runId: prepared.runId, startedAt: Date.now(),
    greetingPlanId: prepared.plan.id, requestedIds: prepared.requested,
    executedIds: prepared.ids.slice(), succeeded: succeeded, failed: []
  }, state.lastBatch || {}, {
    status: 'failed', notRun: notRun, finishedAt: Date.now()
  });
  if (!state.lastBatch.failed.length) state.lastBatch.failed.push({ id: '', error: message });
  notRun.forEach(id => pushPreviewProgress(prepared, id, 'not_run', succeeded.length));
  await persistReviewState().catch(() => {});
  log('预演失败：' + message, 'error');
  state.phase = 'review';
  pushPhase();
  chrome.runtime.sendMessage({
    type: 'PREVIEWED', runId: prepared.runId, previews: state.previews,
    lastBatch: state.lastBatch, screened: state.screened, error: message
  }).catch(() => {});
}

async function confirmPreview(jobId, aiOpening) {
  await hydrateReviewState();
  const preview = state.previews[jobId];
  const job = findScreened(jobId);
  if (!preview || !job) throw new Error('找不到岗位预演');
  if (job.reviewStatus !== 'approved') throw new Error('只有已批准岗位可以确认预演');
  state.previews[jobId] = ReviewWorkflow.confirmPreview(preview, aiOpening, Date.now());
  await persistReviewState();
  return { preview: state.previews[jobId], previews: state.previews };
}

async function updatePreviewDraft(jobId, aiOpening, editedAt) {
  await hydrateReviewState();
  const preview = state.previews[jobId];
  const job = findScreened(jobId);
  if (!preview || !job) throw new Error('找不到岗位预演');
  if (job.reviewStatus !== 'approved') throw new Error('只有已批准岗位可以编辑预演');
  const editTime = Number(editedAt) || Date.now();
  if (preview.confirmedAt && preview.confirmedAt >= editTime) {
    return { preview: preview, previews: state.previews };
  }
  state.previews[jobId] = Object.assign({}, preview, {
    aiOpening: String(aiOpening || ''),
    status: 'draft',
    confirmedAt: 0,
    editedAt: editTime,
    error: ''
  });
  await persistReviewState();
  return { preview: state.previews[jobId], previews: state.previews };
}

async function regeneratePreviewOpening(jobId) {
  await hydrateReviewState();
  const preview = state.previews[jobId];
  const job = findScreened(jobId);
  if (!preview || !job) throw new Error('找不到岗位预演');
  if (job.reviewStatus !== 'approved') throw new Error('只有已批准岗位可以重新生成开场');
  if ((preview.enabledSteps || []).indexOf('aiOpening') < 0) {
    throw new Error('当前招呼方案未启用 AI 开场');
  }
  const cfg = await getCfg();
  const plan = GreetingPlans.validateForSend(selectedGreetingPlan(cfg));
  if (plan.id !== preview.greetingPlanId) throw new Error('招呼方案已变化，请重新预演');
  const jd = String(preview.jd || job.jd || '').trim();
  if (!jd) throw new Error('预演缺少完整 JD，无法重新生成');

  const aiOpening = await generateAiOpening(cfg, plan, job, jd);
  const regenerated = ReviewWorkflow.regeneratePreview(
    preview,
    previewInputs(job, cfg, plan, jd),
    aiOpening,
    Date.now()
  );
  state.previews[jobId] = regenerated;
  await persistReviewState();
  log('已重新生成 ' + job.name + ' 的 AI 开场，请再次确认', 'success');
  return { preview: regenerated, previews: state.previews };
}

// ── 正式三段式投递 ──
async function openVerifiedChatPage(job, cfg, plan, temporaryTabIds) {
  state.lastBatch.currentStep = 'detail';
  const opened = await openJobForDelivery(job, cfg);
  if (opened.temporary) temporaryTabIds.add(opened.tab.id);

  const current = JobDetail.mergeDetail(job, Object.assign({}, opened.detail.currentJob, {
    jd: opened.detail.jd || ''
  }));
  const verified = WorkflowSafety.verifyEligibility(job, current, cfg.jobFilterConfig, state.processed);
  if (!verified.ok) throw new Error('发送前校验失败：' + verified.reasons.join('；'));
  verified.job.reviewStatus = job.reviewStatus;
  const previewGate = ReviewWorkflow.isPreviewReady(
    state.previews[job.id],
    previewInputs(verified.job, cfg, plan, opened.detail.jd || '')
  );
  if (!previewGate.ok) throw new Error(previewGate.reason);

  state.lastBatch.currentStep = 'contact';
  return establishChatPage(opened, job, temporaryTabIds);
}

async function runDeliver(jobIds) {
  state.aborted = false;
  state.paused = false;
  state.results = [];
  state.phase = 'delivering';
  pushPhase();
  await hydrateReviewState();
  const cfg = await getCfg();
  const plan = GreetingPlans.validateForSend(selectedGreetingPlan(cfg));
  const ids = Array.isArray(jobIds) ? jobIds.slice() : [];
  state.lastBatch = {
    mode: 'live', status: 'running', startedAt: Date.now(),
    greetingPlanId: plan.id, requestedIds: ids.slice(), executedIds: [],
    currentJobId: '', currentStep: '', succeeded: [], failed: [], notRun: []
  };
  if (!ids.length) return finishDeliverWithError('', '没有可投递的岗位', []);

  for (const id of ids) {
    const job = findScreened(id);
    const gate = WorkflowSafety.canDeliver(job, state.previews[id], state.processed);
    if (!gate.ok) return finishDeliverWithError(id, gate.reason, ids.filter(item => item !== id));
  }

  for (let index = 0; index < ids.length; index++) {
    if (state.aborted) {
      state.lastBatch.status = 'stopped';
      state.lastBatch.notRun = ids.slice(index);
      break;
    }
    await waitIfPaused();
    const job = findScreened(ids[index]);
    const temporaryTabIds = new Set();
    try {
      if (!job) throw new Error('找不到岗位数据');
      state.lastBatch.currentJobId = job.id;
      state.lastBatch.executedIds.push(job.id);
      log('[' + (index + 1) + '/' + ids.length + '] 正式投递 ' + job.name + ' - ' + (job.company || ''));

      let chatPage = null;
      for (let attempt = 0; attempt < ContactRetry.MAX_ATTEMPTS; attempt++) {
        try {
          chatPage = await openVerifiedChatPage(job, cfg, plan, temporaryTabIds);
          break;
        } catch (error) {
          const retry = ContactRetry.shouldRetry(error, {
            attempt: attempt,
            sendStarted: false,
            aborted: state.aborted,
            paused: state.paused
          });
          if (!retry) throw error;
          log('聊天身份加载失败，正在自动重试 1/1', 'warn');
        }
      }
      if (!chatPage) throw new Error('未找到对应岗位聊天页');

      const injected = await ensureInjected(chatPage.tab.id, 'src/content-chat.js');
      if (!injected) throw new Error('聊天页脚本注入失败');
      state.lastBatch.currentStep = 'send_bundle';
      const preview = state.previews[job.id];
      const sent = await sendToTab(chatPage.tab.id, {
        type: 'SEND_BUNDLE',
        aiOpening: plan.aiOpeningEnabled ? preview.aiOpening : '',
        fixedMessage: plan.fixedMessageEnabled ? preview.fixedMessage : '',
        image: plan.resumeImageEnabled ? plan.resumeImage : ''
      }, 45000);
      if (!sent || !sent.success) {
        const stage = sent && sent.stage ? sent.stage : '发送';
        throw new Error(stage + '失败：' + ((sent && sent.error) || '未知错误'));
      }

      state.results.push({ id: job.id, name: job.name, ok: true });
      state.lastBatch.succeeded.push(job.id);
      markDeliverySucceeded(job.id, Date.now());
      state.processed[job.id] = 1;
      await persistReviewState();
      broadcastDeliveryState();
      try { await markTrackerContacted(job); }
      catch (error) { log('岗位已发送，但进度记录更新失败：' + error.message, 'warn'); }
      log('✓ 三段式投递成功', 'success');
      progress(index + 1, ids.length, '投递');
      await rand(2500, 4500);
    } catch (error) {
      const message = error && error.message ? error.message : '投递失败';
      if (state.aborted || (error && error.code === 'cancelled')) {
        state.lastBatch.status = 'stopped';
        state.lastBatch.notRun = ids.slice(index);
        markDeliveryNotRun(state.lastBatch.notRun);
        log('投递已停止', 'warn');
      } else {
        state.results.push({ id: ids[index], name: job ? job.name : '未知岗位', ok: false, msg: message });
        state.lastBatch.status = 'failed';
        state.lastBatch.failed.push({ id: ids[index], step: state.lastBatch.currentStep, error: message });
        state.lastBatch.notRun = ids.slice(index + 1);
        markDeliveryFailed(ids[index], message, state.lastBatch.currentStep);
        markDeliveryNotRun(state.lastBatch.notRun);
        log('投递失败，已停止批次：' + message, 'error');
      }
      await persistReviewState();
      broadcastDeliveryState();
      break;
    } finally {
      await removeTabs(Array.from(temporaryTabIds));
    }
  }
  await finishDeliver();
}

async function finishDeliverWithError(jobId, message, notRun) {
  state.lastBatch.status = 'failed';
  state.lastBatch.failed.push({ id: jobId, error: message });
  state.lastBatch.notRun = notRun || [];
  markDeliveryFailed(jobId, message, state.lastBatch.currentStep);
  markDeliveryNotRun(state.lastBatch.notRun);
  await persistReviewState();
  broadcastDeliveryState();
  log('正式投递已阻止：' + message, 'error');
  await finishDeliver();
}

async function finishDeliver() {
  if (state.lastBatch) {
    if (state.lastBatch.status === 'running') state.lastBatch.status = 'completed';
    state.lastBatch.currentJobId = '';
    state.lastBatch.currentStep = '';
    state.lastBatch.finishedAt = Date.now();
    await persistReviewState();
  }
  const success = state.results.filter(result => result.ok).length;
  const failed = state.results.filter(result => !result.ok).length;
  state.phase = 'done';
  pushPhase();
  log('投递结束：成功 ' + success + ' | 失败 ' + failed, failed ? 'error' : 'success');
  chrome.runtime.sendMessage({
    type: 'DONE', ok: success, fail: failed, lastBatch: state.lastBatch,
    screened: state.screened
  }).catch(() => {});
}

async function currentStateSnapshot() {
  await hydrateReviewState();
  return {
    phase: state.phase,
    jobs: state.jobs,
    screened: state.screened,
    previews: state.previews,
    lastBatch: state.lastBatch,
    greetingPlansState: state.greetingPlansState
  };
}

function handleAsyncRunError(error, fallbackPhase, label) {
  log((label || '任务') + '失败：' + ((error && error.message) || '未知错误'), 'error');
  state.phase = fallbackPhase || 'idle';
  pushPhase();
}

async function resetCurrentBatch() {
  state.jobs = [];
  state.screened = [];
  state.results = [];
  state.previews = {};
  state.lastBatch = null;
  state.phase = 'idle';
  await chrome.storage.local.remove(['sw_jobs', 'sw_screened', 'sw_previews', 'lastBatch']);
  pushPhase();
  log('已重置当前批次（保留配置、岗位进度和已投记录）', 'warn');
}

// ── 消息入口 ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_COLLECT') {
    runCollect().catch(error => handleAsyncRunError(error, 'idle', '收集'));
    sendResponse({ ok: true }); return;
  }
  if (message.type === 'START_PREVIEW') {
    preparePreviewRun(message.jobIds)
      .then(prepared => {
        sendResponse({
          ok: true,
          result: { runId: prepared.runId, jobIds: prepared.ids, total: prepared.ids.length }
        });
        runPreview(prepared).catch(error => handlePreviewRunError(error, prepared));
      })
      .catch(error => sendResponse({ ok: false, error: error.message || '预演启动失败' }));
    return true;
  }
  if (message.type === 'START_DELIVER') {
    runDeliver(message.jobIds).catch(error => handleAsyncRunError(error, 'review', '正式投递'));
    sendResponse({ ok: true }); return;
  }
  if (message.type === 'TEST_LLM') {
    testLLMConnection(message.config || {})
      .then(result => sendResponse({ ok: true, result: result }))
      .catch(error => sendResponse({ ok: false, error: error.message || '模型连接失败' }));
    return true;
  }
  if (message.type === 'CONFIRM_FILTER_PENDING') {
    confirmFilterPending(message.jobId)
      .then(result => sendResponse({ ok: true, result: result }))
      .catch(error => sendResponse({ ok: false, error: error.message || '人工确认失败' }));
    return true;
  }
  if (message.type === 'SET_REVIEW_DECISION') {
    setReviewDecision(message.jobId, message.decision)
      .then(result => sendResponse({ ok: true, result: result }))
      .catch(error => sendResponse({ ok: false, error: error.message || '审核状态更新失败' }));
    return true;
  }
  if (message.type === 'SAVE_GREETING_PLANS') {
    saveGreetingPlans(message.state)
      .then(result => sendResponse({ ok: true, result: result }))
      .catch(error => sendResponse({ ok: false, error: error.message || '招呼方案保存失败' }));
    return true;
  }
  if (message.type === 'INVALIDATE_PREVIEWS') {
    invalidateStoredPreviews(message.reason)
      .then(result => sendResponse({ ok: true, result: result }))
      .catch(error => sendResponse({ ok: false, error: error.message || '预演失效处理失败' }));
    return true;
  }
  if (message.type === 'CONFIRM_PREVIEW') {
    confirmPreview(message.jobId, message.aiOpening)
      .then(result => sendResponse({ ok: true, result: result }))
      .catch(error => sendResponse({ ok: false, error: error.message || '预演确认失败' }));
    return true;
  }
  if (message.type === 'UPDATE_PREVIEW_DRAFT') {
    updatePreviewDraft(message.jobId, message.aiOpening, message.editedAt)
      .then(result => sendResponse({ ok: true, result: result }))
      .catch(error => sendResponse({ ok: false, error: error.message || '预演草稿保存失败' }));
    return true;
  }
  if (message.type === 'REGENERATE_PREVIEW') {
    regeneratePreviewOpening(message.jobId)
      .then(result => sendResponse({ ok: true, result: result }))
      .catch(error => sendResponse({ ok: false, error: error.message || 'AI 开场重新生成失败' }));
    return true;
  }
  if (message.type === 'GET_TRACKER') {
    hydrateTrackerRecords()
      .then(records => sendResponse({
        ok: true,
        result: { records: records, summary: JobTracker.summarize(records) }
      }))
      .catch(error => sendResponse({ ok: false, error: error.message || '进度读取失败' }));
    return true;
  }
  if (message.type === 'UPDATE_TRACKER_STATUS') {
    updateTrackerStatus(message.jobId, message.status)
      .then(result => sendResponse({ ok: true, result: result }))
      .catch(error => sendResponse({ ok: false, error: error.message || '进度更新失败' }));
    return true;
  }
  if (message.type === 'PAUSE') { state.paused = true; log('已暂停', 'warn'); sendResponse({ ok: true }); return; }
  if (message.type === 'RESUME') { state.paused = false; log('继续', 'info'); sendResponse({ ok: true }); return; }
  if (message.type === 'STOP') {
    state.aborted = true;
    state.paused = false;
    state.phase = 'idle';
    log('已停止', 'warn');
    pushPhase();
    sendResponse({ ok: true });
    return;
  }
  if (message.type === 'RESET') {
    resetCurrentBatch()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message || '当前批次清理失败' }));
    return true;
  }
  if (message.type === 'GET_STATE') {
    currentStateSnapshot()
      .then(result => sendResponse({ ok: true, result: result }))
      .catch(error => sendResponse({ ok: false, error: error.message || '状态读取失败' }));
    return true;
  }
});

chrome.storage.local.get('processed').then(result => {
  if (result.processed) state.processed = result.processed;
});
