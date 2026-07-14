// ===== 侧边栏交互 =====
const $ = (id) => document.getElementById(id);
const BASIC_CFG_FIELDS = ['resumeText', 'keyword', 'city', 'count'];
const LLM_STORAGE_FIELDS = ['llmProvider', 'llmApiKey', 'llmBaseUrl', 'llmModel', 'llmAuthType'];
const LOAD_FIELDS = BASIC_CFG_FIELDS.concat(LLM_STORAGE_FIELDS, ['resumeImage', 'dsKey', 'jobFilterConfig']);
let currentScreened = [];
let currentPreviews = {};
let currentLastBatch = null;
let trackerRecords = [];

// 折叠
document.querySelectorAll('.card-h[data-toggle]').forEach(h => {
  h.addEventListener('click', () => {
    const body = $(h.dataset.toggle);
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  });
});

function applyProviderUI(forceDefaults) {
  const provider = $('llmProvider').value;
  const preset = LLMClient.getProviderPreset(provider);
  const custom = provider === 'custom';
  $('llmBaseUrl').readOnly = !custom;
  $('llmAuthRow').style.display = custom ? 'block' : 'none';

  if (preset) {
    $('llmBaseUrl').value = preset.baseUrl;
    $('llmAuthType').value = preset.authType;
    if (forceDefaults || !$('llmModel').value.trim()) $('llmModel').value = preset.model;
    const placeholders = {
      xiaomi: 'sk- 开头的 MiMo API Key',
      deepseek: 'DeepSeek API Key',
      longcat: 'LongCat API Key'
    };
    $('llmApiKey').placeholder = placeholders[provider] || '服务商 API Key';
  } else if (forceDefaults) {
    $('llmBaseUrl').value = '';
    $('llmModel').value = '';
    $('llmAuthType').value = 'bearer';
    $('llmApiKey').placeholder = '自定义服务 API Key';
  }
}

function renderFilterOptions(containerId, kind, options) {
  $(containerId).innerHTML = options.map(option =>
    '<label class="filter-option"><input type="checkbox" data-filter-kind="' + kind
      + '" value="' + esc(option.value) + '"> ' + esc(option.label) + '</label>'
  ).join('');
}

function setFilterValues(kind, values) {
  const selected = Array.isArray(values) ? values : [];
  document.querySelectorAll('[data-filter-kind="' + kind + '"]').forEach(input => {
    input.checked = selected.indexOf(input.value) >= 0;
  });
}

function syncFilterEnabled(kind) {
  const enabledId = kind === 'experience' ? 'experienceFilterEnabled' : 'companySizeFilterEnabled';
  const optionsId = kind === 'experience' ? 'experienceFilterOptions' : 'companySizeFilterOptions';
  const enabled = $(enabledId).checked;
  $(optionsId).classList.toggle('disabled', !enabled);
  document.querySelectorAll('[data-filter-kind="' + kind + '"]').forEach(input => { input.disabled = !enabled; });
}

function applyJobFilterConfig(config) {
  let normalized;
  try { normalized = JobFilters.normalizeConfig(config); }
  catch (error) { normalized = JobFilters.getDefaultConfig(); }
  $('experienceFilterEnabled').checked = normalized.experienceEnabled;
  $('companySizeFilterEnabled').checked = normalized.companySizeEnabled;
  setFilterValues('experience', normalized.experienceValues);
  setFilterValues('companySize', normalized.companySizeValues);
  syncFilterEnabled('experience');
  syncFilterEnabled('companySize');
}

function checkedFilterValues(kind) {
  return Array.from(document.querySelectorAll('[data-filter-kind="' + kind + '"]:checked'))
    .map(input => input.value);
}

function readJobFilterForm() {
  return JobFilters.normalizeConfig({
    experienceEnabled: $('experienceFilterEnabled').checked,
    experienceValues: checkedFilterValues('experience'),
    companySizeEnabled: $('companySizeFilterEnabled').checked,
    companySizeValues: checkedFilterValues('companySize')
  });
}

renderFilterOptions('experienceFilterOptions', 'experience', JobFilters.EXPERIENCE_OPTIONS);
renderFilterOptions('companySizeFilterOptions', 'companySize', JobFilters.COMPANY_SIZE_OPTIONS);

async function loadConfig() {
  const stored = await chrome.storage.local.get(LOAD_FIELDS);
  const migrated = LLMClient.migrateStoredConfig(stored);
  if (Object.keys(migrated).length) await chrome.storage.local.set(migrated);
  const data = Object.assign({}, stored, migrated);

  BASIC_CFG_FIELDS.forEach(field => {
    if (data[field] !== undefined && $(field)) $(field).value = data[field];
  });
  $('llmProvider').value = data.llmProvider || 'xiaomi';
  $('llmApiKey').value = data.llmApiKey || '';
  $('llmBaseUrl').value = data.llmBaseUrl || '';
  $('llmModel').value = data.llmModel || '';
  $('llmAuthType').value = data.llmAuthType || 'bearer';
  applyProviderUI(false);
  applyJobFilterConfig(data.jobFilterConfig);
  if (data.resumeImage) showImg(data.resumeImage);
}

function showImg(dataUrl) { $('imgPrev').innerHTML = '<img src="' + dataUrl + '">'; }

$('resumeImg').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => { showImg(ev.target.result); chrome.storage.local.set({ resumeImage: ev.target.result }); };
  reader.readAsDataURL(file);
});

function readLLMForm() {
  return {
    provider: $('llmProvider').value,
    apiKey: $('llmApiKey').value.trim(),
    baseUrl: $('llmBaseUrl').value.trim(),
    model: $('llmModel').value.trim(),
    authType: $('llmAuthType').value
  };
}

function permissionContains(origin) {
  return new Promise((resolve, reject) => {
    chrome.permissions.contains({ origins: [origin] }, granted => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(granted);
    });
  });
}

function permissionRequest(origin) {
  return new Promise((resolve, reject) => {
    chrome.permissions.request({ origins: [origin] }, granted => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(granted);
    });
  });
}

async function ensureCustomHostPermission(config) {
  if (config.provider !== 'custom') return true;
  const normalized = LLMClient.validateConfig(config);
  const origin = new URL(normalized.baseUrl).origin + '/*';
  const granted = await permissionRequest(origin);
  if (!granted) return false;
  return permissionContains(origin);
}

function llmStorageFrom(config) {
  const normalized = LLMClient.validateConfig(config);
  return {
    llmProvider: normalized.provider,
    llmApiKey: normalized.apiKey,
    llmBaseUrl: normalized.baseUrl,
    llmModel: normalized.model,
    llmAuthType: normalized.authType
  };
}

async function persistCurrentConfig() {
  const config = readLLMForm();
  const normalized = LLMClient.validateConfig(config);
  const granted = await ensureCustomHostPermission(normalized);
  if (!granted) throw new Error('未授权访问该模型接口域名');

  const data = llmStorageFrom(normalized);
  data.jobFilterConfig = readJobFilterForm();
  BASIC_CFG_FIELDS.forEach(field => {
    data[field] = $(field).value.trim ? $(field).value.trim() : $(field).value;
  });
  await chrome.storage.local.set(data);
  return normalized;
}

function showSaved() {
  const saved = $('saved');
  saved.style.display = 'inline';
  setTimeout(() => { saved.style.display = 'none'; }, 1500);
}

function setLLMTestStatus(text, state) {
  const status = $('llmTestStatus');
  status.textContent = text || '';
  status.className = 'test-status' + (state ? ' ' + state : '');
}

function runtimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response || { ok: false, error: '扩展后台无响应' });
    });
  });
}

async function restoreState() {
  const response = await runtimeMessage({ type: 'GET_STATE' });
  if (!response.ok) throw new Error(response.error || '状态读取失败');
  const result = response.result || {};
  currentScreened = result.screened || [];
  currentPreviews = result.previews || {};
  currentLastBatch = result.lastBatch || null;
  if (currentScreened.length) renderReview(currentScreened);
}

async function refreshTracker() {
  const response = await runtimeMessage({ type: 'GET_TRACKER' });
  if (!response.ok) throw new Error(response.error || '进度读取失败');
  trackerRecords = response.result.records || [];
  renderTracker();
}

function safeJobLink(link) {
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' || !/(^|\.)zhipin\.com$/.test(url.hostname)) return '';
    return url.toString();
  } catch (error) { return ''; }
}

function trackerStatusOptions(current) {
  return JobTracker.STATUS_OPTIONS.map(option =>
    '<option value="' + esc(option.value) + '"' + (option.value === current ? ' selected' : '')
      + '>' + esc(option.label) + '</option>'
  ).join('');
}

function renderTracker() {
  const filter = $('trackerFilter').value;
  const summary = JobTracker.summarize(trackerRecords);
  $('trackerSummary').textContent = '总 ' + summary.total + ' · 已沟通 ' + summary.contacted
    + ' · 面试 ' + summary.interview + ' · Offer ' + summary.offer;
  const visible = trackerRecords.slice()
    .filter(record => filter === 'all' || record.status === filter)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  $('trackerList').innerHTML = visible.map(record => {
    const link = safeJobLink(record.link);
    const title = link
      ? '<a class="tracker-link" href="' + esc(link) + '" target="_blank" rel="noreferrer">' + esc(record.name) + '</a>'
      : esc(record.name);
    const updated = record.updatedAt ? new Date(record.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '';
    return '<div class="tracker-item"><div class="tracker-head"><div class="tracker-title">' + title + '</div>'
      + '<select class="tracker-status" data-tracker-id="' + esc(record.id) + '">'
      + trackerStatusOptions(record.status) + '</select></div>'
      + '<div class="tracker-meta">' + esc(record.company || '公司未知') + ' · ' + esc(record.salary || '薪资未知')
      + (updated ? ' · 更新 ' + esc(updated) : '') + '</div></div>';
  }).join('') || '<div class="job-sub">暂无插件处理过的岗位</div>';
}

function updateRunModeUI() {
  const live = $('runMode').value === 'live';
  $('runModeHint').textContent = live
    ? '正式模式只允许投递已经预演成功的岗位；点击后还会进行一次批次确认和发送前复检。'
    : '默认安全模式：读取完整 JD、二次校验并生成招呼语，不会建立沟通。';
  $('runModeHint').classList.toggle('live', live);
  $('btnDeliver').textContent = live ? '正式投递选中岗位' : '预演选中岗位';
  if (currentScreened.length) renderReview(currentScreened);
}

$('llmProvider').addEventListener('change', () => {
  $('llmApiKey').value = '';
  applyProviderUI(true);
  setLLMTestStatus('', '');
});

$('experienceFilterEnabled').addEventListener('change', () => syncFilterEnabled('experience'));
$('companySizeFilterEnabled').addEventListener('change', () => syncFilterEnabled('companySize'));
$('runMode').addEventListener('change', updateRunModeUI);
$('trackerFilter').addEventListener('change', renderTracker);
$('trackerList').addEventListener('change', async (event) => {
  const select = event.target.closest('[data-tracker-id]');
  if (!select) return;
  select.disabled = true;
  try {
    const response = await runtimeMessage({
      type: 'UPDATE_TRACKER_STATUS', jobId: select.dataset.trackerId, status: select.value
    });
    if (!response.ok) throw new Error(response.error || '进度更新失败');
    trackerRecords = response.result.records || [];
    renderTracker();
    addLog('岗位进度已更新', 'success');
  } catch (error) {
    addLog(error.message, 'error');
    await refreshTracker().catch(() => {});
  }
});
updateRunModeUI();

$('saveCfg').addEventListener('click', async () => {
  try {
    await persistCurrentConfig();
    showSaved();
  } catch (error) {
    addLog(error.message, 'error');
  }
});

$('testLlm').addEventListener('click', async () => {
  const button = $('testLlm');
  button.disabled = true;
  setLLMTestStatus('连接中…', 'testing');
  try {
    const config = LLMClient.validateConfig(readLLMForm());
    const granted = await ensureCustomHostPermission(config);
    if (!granted) throw new Error('未授权访问该模型接口域名');
    const response = await runtimeMessage({ type: 'TEST_LLM', config: config });
    if (!response.ok) throw new Error(response.error || '连接失败');
    const result = response.result;
    setLLMTestStatus('✓ ' + result.provider + ' / ' + result.model + ' · ' + result.elapsedMs + 'ms', 'success');
  } catch (error) {
    setLLMTestStatus('✗ ' + error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

// 运行控制
$('btnCollect').addEventListener('click', async () => {
  try {
    await persistCurrentConfig();
  } catch (error) {
    return addLog(error.message, 'error');
  }
  if (!$('keyword').value.trim()) return addLog('请先填岗位关键词', 'error');
  $('runMode').value = 'preview';
  currentScreened = []; currentPreviews = {}; currentLastBatch = null;
  updateRunModeUI();
  $('reviewCard').style.display = 'none';
  setRunning(true);
  chrome.runtime.sendMessage({ type: 'START_COLLECT' });
});

loadConfig().then(async () => {
  await restoreState();
  await refreshTracker();
}).catch(error => addLog('配置或状态载入失败：' + error.message, 'error'));

$('btnDeliver').addEventListener('click', async () => {
  const ids = Array.from(document.querySelectorAll('.job-item input[type=checkbox]:checked:not(:disabled)'))
    .map(c => c.dataset.id);
  if (!ids.length) return addLog('请至少勾选一个岗位', 'error');
  const live = $('runMode').value === 'live';
  if (live) {
    const names = ids.map(id => {
      const job = currentScreened.find(item => item.id === id);
      return job ? job.name + ' - ' + (job.company || '公司未知') : id;
    });
    const confirmed = window.confirm(
      '即将正式投递 ' + ids.length + ' 个岗位：\n\n' + names.join('\n')
        + '\n\n发送前会再次校验；任一失败将立即停止。确认继续？'
    );
    if (!confirmed) return addLog('已取消正式投递', 'warn');
  }
  setRunning(true);
  addLog((live ? '开始正式投递 ' : '开始完整预演 ') + ids.length + ' 个岗位', 'info');
  chrome.runtime.sendMessage({ type: live ? 'START_DELIVER' : 'START_PREVIEW', jobIds: ids });
});

$('btnPause').addEventListener('click', () => {
  if ($('btnPause').textContent === '暂停') { $('btnPause').textContent = '继续'; chrome.runtime.sendMessage({ type: 'PAUSE' }); }
  else { $('btnPause').textContent = '暂停'; chrome.runtime.sendMessage({ type: 'RESUME' }); }
});
$('btnStop').addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'STOP' }); setRunning(false); });
$('btnReset').addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'RESET' }); $('reviewCard').style.display = 'none'; setRunning(false); });
$('clearLog').addEventListener('click', () => { $('log').innerHTML = ''; });

$('selAll').addEventListener('change', (e) => {
  document.querySelectorAll('.job-item:not(.skip):not(.pending) input[type=checkbox]')
    .forEach(c => { c.checked = e.target.checked; });
});

$('reviewList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="confirm-filter"]');
  if (!button) return;
  button.disabled = true;
  button.textContent = '确认中…';
  try {
    const response = await runtimeMessage({ type: 'CONFIRM_FILTER_PENDING', jobId: button.dataset.id });
    if (!response.ok) throw new Error(response.error || '人工确认失败');
    renderReview(response.result.screened || []);
    addLog('已人工确认岗位信息，完成 AI 筛选', 'success');
  } catch (error) {
    addLog(error.message, 'error');
    button.disabled = false;
    button.textContent = '确认符合并进行 AI 筛选';
  }
});

function setRunning(running) {
  $('btnCollect').disabled = running;
  $('btnPause').disabled = !running;
  $('btnStop').disabled = !running;
  if (!running) $('btnPause').textContent = '暂停';
}

// 渲染审核列表
function renderReview(screened) {
  currentScreened = screened || [];
  const live = $('runMode').value === 'live';
  const matched = screened.filter(j => j.filterStatus === 'pass' && j.match);
  const pending = screened.filter(j => j.filterStatus === 'pending');
  const skipped = screened.filter(j => j.filterStatus === 'fail' || (j.filterStatus === 'pass' && !j.match));
  $('reviewCount').textContent = '匹配 ' + matched.length + ' · 待确认 ' + pending.length + ' / ' + screened.length;
  let html = '';
  matched.forEach(j => {
    const preview = currentPreviews[j.id];
    const ready = preview && preview.status === 'ready';
    const disabled = live && !ready;
    html += '<div class="job-item' + (disabled ? ' skip' : '') + '"><input type="checkbox" '
      + (disabled ? 'disabled ' : 'checked ') + 'data-id="' + esc(j.id) + '">'
      + '<div class="job-main"><div class="job-title">' + esc(j.name) + '</div>'
      + '<div class="job-sub">' + esc(jobFactsText(j)) + '</div>'
      + '<div class="job-reason m">✓ ' + esc((j.filterReasons || []).join('；'))
      + (j.reason ? '；AI：' + esc(j.reason) : '') + '</div>'
      + previewHtml(preview, live) + '</div></div>';
  });
  pending.forEach(j => {
    html += '<div class="job-item pending"><div class="job-main"><div class="job-title">' + esc(j.name) + '</div>'
      + '<div class="job-sub">' + esc(jobFactsText(j)) + '</div>'
      + '<div class="job-reason p">⚠ ' + esc((j.filterReasons || []).join('；')) + '</div>'
      + '<button type="button" class="btn-confirm-filter" data-action="confirm-filter" data-id="' + esc(j.id)
      + '">确认符合并进行 AI 筛选</button></div></div>';
  });
  skipped.forEach(j => {
    html += '<div class="job-item skip"><input type="checkbox" disabled data-id="' + esc(j.id) + '">'
      + '<div class="job-main"><div class="job-title">' + esc(j.name) + '</div>'
      + '<div class="job-sub">' + esc(jobFactsText(j)) + '</div>'
      + '<div class="job-reason s">✗ ' + esc(j.reason) + '</div></div></div>';
  });
  $('reviewList').innerHTML = html || '<div class="job-sub">无岗位</div>';
  $('reviewCard').style.display = 'block';
}
function previewHtml(preview, live) {
  if (preview && preview.status === 'ready') {
    return '<div class="preview-text"><strong>预演招呼语：</strong>' + esc(preview.greeting) + '</div>';
  }
  if (preview && preview.status === 'failed') {
    return '<div class="preview-text failed">预演失败：' + esc(preview.error || '未知错误') + '</div>';
  }
  return live ? '<div class="preview-text failed">需先完成模拟运行</div>' : '';
}
function jobFactsText(job) {
  return [
    job.company || '公司未知',
    job.salary || '薪资未知',
    '经验：' + JobFilters.labelFor('experience', job.experience),
    '规模：' + JobFilters.labelFor('companySize', job.companySize)
  ].join(' · ');
}
function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// 消息接收
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LOG') addLog(msg.text, msg.level);
  if (msg.type === 'PROGRESS') $('progText').textContent = (msg.label ? msg.label + ' ' : '') + msg.cur + '/' + msg.total;
  if (msg.type === 'PHASE') {
    const map = {
      idle: '未开始', collecting: '收集中', screening: 'AI筛选中',
      previewing: '完整预演中', review: '待审核', delivering: '正式投递中', done: '已完成'
    };
    $('phaseText').textContent = map[msg.phase] || msg.phase;
    if (msg.phase === 'review' || msg.phase === 'done' || msg.phase === 'idle') setRunning(false);
  }
  if (msg.type === 'SCREENED') renderReview(msg.screened);
  if (msg.type === 'TRACKER_UPDATED') {
    trackerRecords = msg.records || [];
    renderTracker();
  }
  if (msg.type === 'PREVIEWED') {
    currentPreviews = msg.previews || {};
    currentLastBatch = msg.lastBatch || null;
    renderReview(currentScreened);
    setRunning(false);
    $('progText').textContent = '';
  }
  if (msg.type === 'DONE') {
    currentLastBatch = msg.lastBatch || null;
    $('runMode').value = 'preview';
    updateRunModeUI();
    setRunning(false);
    $('progText').textContent = '';
  }
});

function addLog(text, level) {
  level = level || 'info';
  const now = new Date();
  const t = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  const el = document.createElement('div');
  el.className = 'log-item ' + level;
  el.innerHTML = '<span class="log-time">[' + t + ']</span>' + esc(text);
  $('log').appendChild(el);
  $('log').scrollTop = $('log').scrollHeight;
}
