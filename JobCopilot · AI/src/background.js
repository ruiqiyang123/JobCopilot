// ===== BOSS自动投递 Service Worker：编排 收集→筛选→审核→投递 + 可配置 LLM =====
importScripts('/src/selectors.js', '/src/job-filters.js', '/src/workflow-safety.js', '/src/llm-client.js');

const CFG_KEYS = [
  'llmProvider', 'llmApiKey', 'llmBaseUrl', 'llmModel', 'llmAuthType', 'dsKey',
  'resumeText', 'resumeImage', 'city', 'keyword', 'count', 'jobFilterConfig'
];

let state = {
  phase: 'idle', paused: false, aborted: false,
  jobs: [], screened: [], greetings: {}, results: [], processed: {},
  previews: {}, lastBatch: null
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); } catch (e) {}

// ── 小工具 ──
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => sleep(a + Math.random() * (b - a));
function log(text, level) { chrome.runtime.sendMessage({ type: 'LOG', text: text, level: level || 'info' }).catch(() => {}); }
function pushPhase() { chrome.runtime.sendMessage({ type: 'PHASE', phase: state.phase }).catch(() => {}); }
function progress(cur, total, label) { chrome.runtime.sendMessage({ type: 'PROGRESS', cur: cur, total: total, label: label || '' }).catch(() => {}); }
async function waitIfPaused() { while (state.paused && !state.aborted) await sleep(400); }
async function getCfg() {
  const stored = await chrome.storage.local.get(CFG_KEYS);
  const migrated = LLMClient.migrateStoredConfig(stored);
  if (Object.keys(migrated).length) await chrome.storage.local.set(migrated);
  return Object.assign({}, stored, migrated);
}
function resumeFull(cfg) { return (cfg.resumeText || '').trim(); }
function jobInfo(j) {
  return '岗位：' + (j.name || '')
    + '\n技能标签：' + ((j.tags || []).join('、'))
    + '\n薪资：' + (j.salary || '')
    + '\n公司：' + (j.company || '')
    + '\n工作经验：' + JobFilters.labelFor('experience', j.experience)
    + '\n公司规模：' + JobFilters.labelFor('companySize', j.companySize);
}
function findJob(id) { for (var i = 0; i < state.jobs.length; i++) if (state.jobs[i].id === id) return state.jobs[i]; return null; }
function hardFilterJob(job, cfg) {
  return Object.assign({}, job, JobFilters.evaluate(job, cfg.jobFilterConfig));
}
function blockedScreenResult(job) {
  const prefix = job.filterStatus === 'pending' ? '待人工确认：' : '硬筛选排除：';
  return Object.assign({}, job, { match: false, reason: prefix + (job.filterReasons || []).join('；') });
}

// ── 可配置模型 ──
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

// 筛选：只判断是否值得投（用岗位标签快速判断，不生成招呼语）
async function screenJob(cfg, job) {
  const sys = '你是资深求职助手。请完全依据下面提供的【求职者简历】，判断某个岗位是否值得该求职者投递。\n【判断标准·适中】保留(match=true)：岗位方向与求职者简历的专业/技能/经历相关，且求职者的经验年限、学历、级别够得着该岗位（不超纲）。剔除(match=false)：方向与简历明显无关；岗位要求的经验/学历/硬技能明显超出简历；岗位级别明显高于求职者当前水平。请依据简历本身判断，不要套用任何固定行业或级别。\n【输出】只输出一个JSON对象，不要markdown：{"match":true或false,"reason":"一句话理由"}';
  const user = '求职者简历：\n' + resumeFull(cfg) + '\n\n待判断岗位：\n' + jobInfo(job) + '\n\n严格输出JSON。';
  const raw = await callLLM(cfg, [{ role: 'system', content: sys }, { role: 'user', content: user }], {
    maxTokens: 200,
    temperature: 0.5,
    jsonMode: true
  });
  let p = null;
  try { p = JSON.parse(raw); } catch (e) { const m = raw && raw.match(/\{[\s\S]*\}/); if (m) { try { p = JSON.parse(m[0]); } catch (e2) {} } }
  if (!p) return { match: false, reason: 'AI解析失败' };
  return { match: p.match === true, reason: p.reason || '' };
}

// 投递时：结合该岗位的【完整JD】+ 简历，现场生成专属招呼语
async function genGreetingFromJD(cfg, job, jd) {
  const sys = '你是求职者本人，在BOSS直聘给HR发招呼语。回复会原样发给HR，严禁任何注释、说明、括号备注、字数统计或引导语。\n【格式】1.开头前15字必须是"熟悉XXX、XXX"(填该JD要求且你简历具备的核心技能1-2个)。2.紧接"做过XXX"说明简历里与该岗位相关的具体项目/经历。3.全文80-120字，真诚自然。';
  const jdText = (jd && jd.trim()) ? jd.trim() : ('技能标签：' + (job.tags || []).join('、'));
  const user = '我的简历：\n' + resumeFull(cfg) + '\n\n目标岗位：' + (job.name || '') + (job.company ? ('（' + job.company + '）') : '') + '\n该岗位JD：\n' + jdText + '\n\n请按格式生成一段招呼语，开头必须"熟悉…"，直接输出招呼语本身，不要任何多余内容。';
  const raw = await callLLM(cfg, [{ role: 'system', content: sys }, { role: 'user', content: user }], {
    maxTokens: 300,
    temperature: 0.5
  });
  return (raw || '').trim();
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

// ── tab 注入 + 发消息 ──
async function ensureInjected(tabId, file) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['src/selectors.js', 'src/job-filters.js', file]
    });
  } catch (e) {}
}
function sendToTab(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
      else resolve(resp || { success: false, error: 'no response' });
    });
  });
}
function waitTabComplete(tabId) {
  return new Promise((resolve) => {
    function lis(id, info) { if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(lis); setTimeout(resolve, 1200); } }
    chrome.tabs.onUpdated.addListener(lis);
    chrome.tabs.get(tabId, (t) => { if (t && t.status === 'complete') { chrome.tabs.onUpdated.removeListener(lis); setTimeout(resolve, 1200); } });
  });
}
function resolveCity(cfg) {
  const firstCity = (cfg.city || '').split(/[\/、,，\s]+/)[0].replace(/[市省]$/, '') || '';
  const code = (typeof CITY_MAP !== 'undefined' && CITY_MAP[firstCity]) || '100010000';
  return { name: firstCity, code: code, found: code !== '100010000' || firstCity === '全国' };
}
function buildSearchUrl(cfg) {
  const c = resolveCity(cfg);
  const params = new URLSearchParams({ query: cfg.keyword || '', city: c.code });
  // 行业/规模：BOSS 代码不确定，暂不加入（错误代码会导致搜不到任何岗位）
  return 'https://www.zhipin.com/web/geek/jobs?' + params.toString();
}
async function ensureTab(url) {
  let tabs = await chrome.tabs.query({ url: '*://*.zhipin.com/*' });
  let tab = tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url: url });
  else await chrome.tabs.update(tab.id, { url: url });
  await waitTabComplete(tab.id);
  await sleep(2000);
  return tab;
}
async function getSearchTab(cfg) { return ensureTab(buildSearchUrl(cfg)); }
function curUrl(tabId) { return new Promise(res => chrome.tabs.get(tabId, t => res((t && t.url) || ''))); }

// ── 流程：收集 + 筛选 ──
async function runCollect() {
  state.aborted = false; state.paused = false;
  state.jobs = []; state.screened = []; state.greetings = {}; state.results = [];
  state.previews = {}; state.lastBatch = null;
  state.phase = 'collecting'; pushPhase();
  const cfg = await getCfg();
  if (!cfg.llmApiKey) { log('请先填写 AI 模型 API Key', 'error'); state.phase = 'idle'; pushPhase(); return; }
  if (!cfg.keyword) { log('请先填写岗位关键词', 'error'); state.phase = 'idle'; pushPhase(); return; }
  if (!(cfg.resumeText || '').trim()) { log('请先在设置里填写"简历文字"（AI筛选和招呼语都需要它）', 'error'); state.phase = 'idle'; pushPhase(); return; }

  const _c = resolveCity(cfg);
  log('打开搜索页：' + cfg.keyword + ' | 城市：' + (_c.found ? _c.name : '全国'));
  if (cfg.city && !_c.found) log('城市"' + cfg.city + '"未识别，已按全国搜索', 'warn');
  const tab = await getSearchTab(cfg);
  const count = parseInt(cfg.count) || 20;

  log('收集岗位中（目标 ' + count + ' 个）...');
  await ensureInjected(tab.id, 'src/content-search.js');
  const r = await sendToTab(tab.id, { type: 'SCRAPE', count: count });
  if (!r || !r.success) { log('收集失败：' + (r && r.error), 'error'); state.phase = 'idle'; pushPhase(); return; }
  try {
    JobFilters.normalizeConfig(cfg.jobFilterConfig);
  } catch (error) {
    log(error.message, 'error'); state.phase = 'idle'; pushPhase(); return;
  }
  state.jobs = (r.jobs || []).map(job => hardFilterJob(job, cfg));
  log('收集到 ' + state.jobs.length + ' 个岗位', 'success');
  if (!state.jobs.length) { state.phase = 'idle'; pushPhase(); return; }

  // 硬筛选先于 AI：不匹配和信息不完整的岗位不会消耗模型额度
  state.phase = 'screening'; pushPhase();
  const eligibleJobs = state.jobs.filter(job => job.filterStatus === 'pass');
  const blockedJobs = state.jobs.filter(job => job.filterStatus !== 'pass');
  state.screened = blockedJobs.map(blockedScreenResult);
  log('硬筛选：通过 ' + eligibleJobs.length + '，排除 '
    + blockedJobs.filter(job => job.filterStatus === 'fail').length + '，待确认 '
    + blockedJobs.filter(job => job.filterStatus === 'pending').length);
  log('AI 筛选中（' + providerNameFrom(cfg) + '）...');
  let done = blockedJobs.length; const total = state.jobs.length;
  progress(done, total, '筛选');
  const CONC = 3;
  for (let i = 0; i < eligibleJobs.length; i += CONC) {
    if (state.aborted) break; await waitIfPaused();
    const batch = eligibleJobs.slice(i, i + CONC);
    await Promise.all(batch.map(async (job) => {
      let res;
      try { res = await screenJob(cfg, job); }
      catch (e) { res = { match: false, reason: '筛选异常:' + e.message }; }
      state.screened.push(Object.assign({}, job, { match: res.match, reason: res.reason }));
      done++; progress(done, total, '筛选');
    }));
  }
  const matched = state.screened.filter(j => j.match).length;
  log('筛选完成：匹配 ' + matched + ' / ' + total, 'success');
  // 存盘：SW 可能在审核期间被浏览器回收，投递时需从存储读回
  await chrome.storage.local.set({
    sw_jobs: state.jobs,
    sw_greetings: state.greetings,
    sw_screened: state.screened,
    sw_previews: {},
    lastBatch: null
  });
  state.phase = 'review'; pushPhase();
  chrome.runtime.sendMessage({ type: 'SCREENED', screened: state.screened }).catch(() => {});
}

async function confirmFilterPending(jobId) {
  if (!state.jobs.length || !state.screened.length) {
    const saved = await chrome.storage.local.get(['sw_jobs', 'sw_screened']);
    state.jobs = saved.sw_jobs || [];
    state.screened = saved.sw_screened || [];
  }
  const cfg = await getCfg();
  const index = state.jobs.findIndex(job => job.id === jobId);
  if (index < 0) throw new Error('找不到待确认岗位');

  const confirmed = JobFilters.confirmPending(state.jobs[index], cfg.jobFilterConfig);
  let aiResult;
  try { aiResult = await screenJob(cfg, confirmed); }
  catch (error) { aiResult = { match: false, reason: '筛选异常:' + error.message }; }

  state.jobs[index] = confirmed;
  const screenedJob = Object.assign({}, confirmed, {
    match: aiResult.match,
    reason: (confirmed.filterReasons || []).join('；') + '；AI：' + aiResult.reason
  });
  const screenedIndex = state.screened.findIndex(job => job.id === jobId);
  if (screenedIndex >= 0) state.screened[screenedIndex] = screenedJob;
  else state.screened.push(screenedJob);

  await chrome.storage.local.set({ sw_jobs: state.jobs, sw_screened: state.screened });
  chrome.runtime.sendMessage({ type: 'SCREENED', screened: state.screened }).catch(() => {});
  return { screened: state.screened, job: screenedJob };
}

async function hydrateReviewState() {
  const saved = await chrome.storage.local.get([
    'sw_jobs', 'sw_screened', 'sw_greetings', 'sw_previews', 'lastBatch'
  ]);
  if (!state.jobs.length) state.jobs = saved.sw_jobs || [];
  if (!state.screened.length) state.screened = saved.sw_screened || [];
  if (!Object.keys(state.greetings).length) state.greetings = saved.sw_greetings || {};
  if (!Object.keys(state.previews).length) state.previews = saved.sw_previews || {};
  if (!state.lastBatch) state.lastBatch = saved.lastBatch || null;
}

async function runPreview(jobIds) {
  state.aborted = false; state.paused = false; state.results = [];
  state.phase = 'previewing'; pushPhase();
  await hydrateReviewState();
  const cfg = await getCfg();
  const ids = (jobIds || []).filter(id => {
    const screened = state.screened.find(item => item.id === id);
    return screened && screened.filterStatus === 'pass' && screened.match && !state.processed[id];
  });
  state.lastBatch = {
    mode: 'preview', status: 'running', startedAt: Date.now(),
    requestedIds: ids.slice(), succeeded: [], failed: [], notRun: []
  };
  if (!ids.length) {
    state.lastBatch.status = 'failed';
    state.lastBatch.failed.push({ id: '', error: '没有可预演的岗位' });
    await chrome.storage.local.set({ lastBatch: state.lastBatch });
    log('没有可预演的岗位', 'warn'); state.phase = 'review'; pushPhase(); return;
  }

  const searchUrl = buildSearchUrl(cfg);
  progress(0, ids.length, '预演');
  for (let index = 0; index < ids.length; index++) {
    if (state.aborted) {
      state.lastBatch.status = 'stopped';
      state.lastBatch.notRun = ids.slice(index);
      break;
    }
    await waitIfPaused();
    const job = findJob(ids[index]);
    try {
      if (!job) throw new Error('找不到岗位数据');
      log('[' + (index + 1) + '/' + ids.length + '] 预演 ' + job.name + ' - ' + (job.company || ''));
      const tab = await ensureTab(searchUrl);
      await ensureInjected(tab.id, 'src/content-search.js');
      const detail = await sendToTab(tab.id, { type: 'OPEN_JD', job: job });
      if (!detail || !detail.success || !detail.currentJob) {
        throw new Error((detail && detail.error) || '无法读取当前岗位详情');
      }
      const verified = WorkflowSafety.verifyEligibility(
        job, detail.currentJob, cfg.jobFilterConfig, state.processed
      );
      if (!verified.ok) throw new Error(verified.reasons.join('；'));
      const greeting = await genGreetingFromJD(cfg, verified.job, detail.jd || '');
      if (!greeting) throw new Error('招呼语生成失败');

      state.previews[job.id] = {
        status: 'ready',
        greeting: greeting,
        jd: String(detail.jd || '').slice(0, 1800),
        verifiedAt: Date.now(),
        currentJob: verified.job,
        error: ''
      };
      state.lastBatch.succeeded.push(job.id);
      progress(index + 1, ids.length, '预演');
      await chrome.storage.local.set({ sw_previews: state.previews, lastBatch: state.lastBatch });
    } catch (error) {
      const message = error && error.message ? error.message : '预演失败';
      if (job) state.previews[job.id] = { status: 'failed', greeting: '', error: message, verifiedAt: Date.now() };
      state.lastBatch.status = 'failed';
      state.lastBatch.failed.push({ id: job ? job.id : ids[index], error: message });
      state.lastBatch.notRun = ids.slice(index + 1);
      log('预演失败，已停止批次：' + message, 'error');
      break;
    }
  }
  if (state.lastBatch.status === 'running') state.lastBatch.status = 'completed';
  state.lastBatch.finishedAt = Date.now();
  await chrome.storage.local.set({ sw_previews: state.previews, lastBatch: state.lastBatch });
  state.phase = 'review'; pushPhase();
  chrome.runtime.sendMessage({
    type: 'PREVIEWED', previews: state.previews, lastBatch: state.lastBatch
  }).catch(() => {});
}

// ── 流程：投递（单个闭环：建联→进聊天页→发图片+招呼语→回搜索页→下一个）──
async function runDeliver(jobIds) {
  state.aborted = false; state.paused = false; state.results = [];
  state.phase = 'delivering'; pushPhase();
  await hydrateReviewState();
  const cfg = await getCfg();
  if (!cfg.resumeImage) log('未上传简历图片，将只发招呼语', 'warn');

  const ids = (jobIds || []).slice();
  state.lastBatch = {
    mode: 'live', status: 'running', startedAt: Date.now(),
    requestedIds: ids.slice(), succeeded: [], failed: [], notRun: []
  };
  const blocked = ids.find(id => !WorkflowSafety.canDeliver(id, state.previews, state.processed).ok);
  if (blocked) {
    const gate = WorkflowSafety.canDeliver(blocked, state.previews, state.processed);
    const blockedJob = findJob(blocked) || { id: blocked, name: '未知岗位' };
    recordFail(blockedJob, gate.reason);
    state.lastBatch.status = 'failed';
    state.lastBatch.failed.push({ id: blocked, error: gate.reason });
    state.lastBatch.notRun = ids.filter(id => id !== blocked);
    log('正式投递已阻止：' + gate.reason, 'error');
    await finishDeliver();
    return;
  }
  if (!ids.length) {
    state.lastBatch.status = 'failed';
    state.lastBatch.failed.push({ id: '', error: '没有可投递的岗位' });
    log('没有可投递的岗位', 'warn');
    await finishDeliver();
    return;
  }
  const searchUrl = buildSearchUrl(cfg);

  for (let k = 0; k < ids.length; k++) {
    if (state.aborted) {
      state.lastBatch.status = 'stopped';
      state.lastBatch.notRun = ids.slice(k);
      break;
    }
    await waitIfPaused();
    const job = findJob(ids[k]);
    try {
      if (!job) throw new Error('找不到岗位数据');
      const preview = state.previews[job.id];
      log('[' + (k + 1) + '/' + ids.length + '] 正式投递 ' + job.name + ' - ' + (job.company || ''));

      const tab = await ensureTab(searchUrl);
      await ensureInjected(tab.id, 'src/content-search.js');
      const detail = await sendToTab(tab.id, { type: 'OPEN_JD', job: job });
      if (!detail || !detail.success || !detail.currentJob) {
        throw new Error((detail && detail.error) || '无法读取当前岗位详情');
      }
      const verified = WorkflowSafety.verifyEligibility(
        job, detail.currentJob, cfg.jobFilterConfig, state.processed
      );
      if (!verified.ok) throw new Error(verified.reasons.join('；'));

      const chat = await sendToTab(tab.id, { type: 'GO_CHAT', job: job });
      if (!chat || !chat.success) throw new Error((chat && chat.error) || '建立沟通失败');
      await waitTabComplete(tab.id); await sleep(2500);
      const url = await curUrl(tab.id);
      if (url.indexOf('/web/geek/chat') < 0) throw new Error('未跳转聊天页');

      await ensureInjected(tab.id, 'src/content-chat.js');
      const sent = await sendToTab(tab.id, {
        type: 'SEND_ACTIVE', image: cfg.resumeImage || '', greeting: preview.greeting
      });
      if (!sent || !sent.success) throw new Error((sent && sent.error) || '发送失败');

      recordOk(job);
      state.lastBatch.succeeded.push(job.id);
      state.processed[job.id] = 1;
      await chrome.storage.local.set({ processed: state.processed, lastBatch: state.lastBatch });
      log('  ✓ 投递成功', 'success');
      progress(k + 1, ids.length, '投递');
      await rand(2500, 4500);
    } catch (error) {
      const message = error && error.message ? error.message : '投递失败';
      recordFail(job || { id: ids[k], name: '未知岗位' }, message);
      state.lastBatch.status = 'failed';
      state.lastBatch.failed.push({ id: ids[k], error: message });
      state.lastBatch.notRun = ids.slice(k + 1);
      log('投递失败，已停止批次：' + message, 'error');
      break;
    }
  }
  await finishDeliver();
}
function recordOk(job) { state.results.push({ id: job.id, name: job.name, ok: true }); }
function recordFail(job, msg) { state.results.push({ id: job.id, name: job.name, ok: false, msg: msg }); }
async function finishDeliver() {
  if (state.lastBatch) {
    if (state.lastBatch.status === 'running') state.lastBatch.status = 'completed';
    state.lastBatch.finishedAt = Date.now();
    await chrome.storage.local.set({ lastBatch: state.lastBatch });
  }
  const ok = state.results.filter(r => r.ok).length;
  const fail = state.results.length - ok;
  state.phase = 'done'; pushPhase();
  log('投递结束：成功 ' + ok + ' | 失败 ' + fail, fail ? 'error' : 'success');
  chrome.runtime.sendMessage({ type: 'DONE', ok: ok, fail: fail, lastBatch: state.lastBatch }).catch(() => {});
}

async function currentStateSnapshot() {
  await hydrateReviewState();
  return {
    phase: state.phase,
    screened: state.screened,
    previews: state.previews,
    lastBatch: state.lastBatch
  };
}

// ── 消息入口 ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_COLLECT') { runCollect(); sendResponse({ ok: true }); return; }
  if (msg.type === 'START_PREVIEW') { runPreview(msg.jobIds); sendResponse({ ok: true }); return; }
  if (msg.type === 'START_DELIVER') { runDeliver(msg.jobIds); sendResponse({ ok: true }); return; }
  if (msg.type === 'TEST_LLM') {
    testLLMConnection(msg.config || {})
      .then(result => sendResponse({ ok: true, result: result }))
      .catch(error => sendResponse({ ok: false, error: error && error.message ? error.message : '模型连接失败' }));
    return true;
  }
  if (msg.type === 'CONFIRM_FILTER_PENDING') {
    confirmFilterPending(msg.jobId)
      .then(result => sendResponse({ ok: true, result: result }))
      .catch(error => sendResponse({ ok: false, error: error && error.message ? error.message : '人工确认失败' }));
    return true;
  }
  if (msg.type === 'PAUSE') { state.paused = true; log('已暂停', 'warn'); sendResponse({ ok: true }); return; }
  if (msg.type === 'RESUME') { state.paused = false; log('继续', 'info'); sendResponse({ ok: true }); return; }
  if (msg.type === 'STOP') { state.aborted = true; state.paused = false; log('已停止', 'warn'); state.phase = 'idle'; pushPhase(); sendResponse({ ok: true }); return; }
  if (msg.type === 'RESET') {
    state.jobs = []; state.screened = []; state.greetings = {}; state.results = [];
    state.previews = {}; state.lastBatch = null; state.phase = 'idle';
    chrome.storage.local.remove(['sw_jobs', 'sw_screened', 'sw_greetings', 'sw_previews', 'lastBatch']);
    pushPhase(); log('已重置当前批次（保留已投记录）', 'warn'); sendResponse({ ok: true }); return;
  }
  if (msg.type === 'GET_STATE') {
    currentStateSnapshot()
      .then(result => sendResponse({ ok: true, result: result }))
      .catch(error => sendResponse({ ok: false, error: error && error.message ? error.message : '状态读取失败' }));
    return true;
  }
});

chrome.storage.local.get('processed').then(r => { if (r.processed) state.processed = r.processed; });
