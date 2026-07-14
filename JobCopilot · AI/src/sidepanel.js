// ===== 侧边栏交互 =====
const $ = (id) => document.getElementById(id);
const BASIC_CFG_FIELDS = ['resumeText', 'keyword', 'city', 'count'];
const LLM_STORAGE_FIELDS = ['llmProvider', 'llmApiKey', 'llmBaseUrl', 'llmModel', 'llmAuthType'];
const LOAD_FIELDS = BASIC_CFG_FIELDS.concat(LLM_STORAGE_FIELDS, ['resumeImage', 'dsKey']);

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
    $('llmApiKey').placeholder = provider === 'xiaomi' ? 'sk- 开头的 MiMo API Key' : 'DeepSeek API Key';
  } else if (forceDefaults) {
    $('llmBaseUrl').value = '';
    $('llmModel').value = '';
    $('llmAuthType').value = 'bearer';
    $('llmApiKey').placeholder = '自定义服务 API Key';
  }
}

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
  if (await permissionContains(origin)) return true;
  return permissionRequest(origin);
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

$('llmProvider').addEventListener('change', () => {
  $('llmApiKey').value = '';
  applyProviderUI(true);
  setLLMTestStatus('', '');
});

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
  $('reviewCard').style.display = 'none';
  setRunning(true);
  chrome.runtime.sendMessage({ type: 'START_COLLECT' });
});

loadConfig().catch(error => addLog('配置载入失败：' + error.message, 'error'));

$('btnDeliver').addEventListener('click', () => {
  const ids = Array.from(document.querySelectorAll('.job-item input:checked')).map(c => c.dataset.id);
  if (!ids.length) return addLog('请至少勾选一个岗位', 'error');
  setRunning(true);
  addLog('开始投递 ' + ids.length + ' 个岗位', 'info');
  chrome.runtime.sendMessage({ type: 'START_DELIVER', jobIds: ids });
});

$('btnPause').addEventListener('click', () => {
  if ($('btnPause').textContent === '暂停') { $('btnPause').textContent = '继续'; chrome.runtime.sendMessage({ type: 'PAUSE' }); }
  else { $('btnPause').textContent = '暂停'; chrome.runtime.sendMessage({ type: 'RESUME' }); }
});
$('btnStop').addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'STOP' }); setRunning(false); });
$('btnReset').addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'RESET' }); $('reviewCard').style.display = 'none'; setRunning(false); });
$('clearLog').addEventListener('click', () => { $('log').innerHTML = ''; });

$('selAll').addEventListener('change', (e) => {
  document.querySelectorAll('.job-item:not(.skip) input').forEach(c => c.checked = e.target.checked);
});

function setRunning(running) {
  $('btnCollect').disabled = running;
  $('btnPause').disabled = !running;
  $('btnStop').disabled = !running;
  if (!running) $('btnPause').textContent = '暂停';
}

// 渲染审核列表
function renderReview(screened) {
  const matched = screened.filter(j => j.match);
  const skipped = screened.filter(j => !j.match);
  $('reviewCount').textContent = '匹配 ' + matched.length + ' / ' + screened.length;
  let html = '';
  matched.forEach(j => {
    html += '<div class="job-item"><input type="checkbox" checked data-id="' + esc(j.id) + '">'
      + '<div class="job-main"><div class="job-title">' + esc(j.name) + '</div>'
      + '<div class="job-sub">' + esc(j.company) + ' · ' + esc(j.salary) + '</div>'
      + '<div class="job-reason m">✓ ' + esc(j.reason) + '</div></div></div>';
  });
  skipped.forEach(j => {
    html += '<div class="job-item skip"><input type="checkbox" disabled data-id="' + esc(j.id) + '">'
      + '<div class="job-main"><div class="job-title">' + esc(j.name) + '</div>'
      + '<div class="job-sub">' + esc(j.company) + ' · ' + esc(j.salary) + '</div>'
      + '<div class="job-reason s">✗ ' + esc(j.reason) + '</div></div></div>';
  });
  $('reviewList').innerHTML = html || '<div class="job-sub">无岗位</div>';
  $('reviewCard').style.display = 'block';
}
function esc(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// 消息接收
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LOG') addLog(msg.text, msg.level);
  if (msg.type === 'PROGRESS') $('progText').textContent = (msg.label ? msg.label + ' ' : '') + msg.cur + '/' + msg.total;
  if (msg.type === 'PHASE') {
    const map = { idle: '未开始', collecting: '收集中', screening: 'AI筛选中', review: '待审核', delivering: '投递中', done: '已完成' };
    $('phaseText').textContent = map[msg.phase] || msg.phase;
    if (msg.phase === 'review' || msg.phase === 'done' || msg.phase === 'idle') setRunning(false);
  }
  if (msg.type === 'SCREENED') renderReview(msg.screened);
  if (msg.type === 'DONE') { setRunning(false); $('progText').textContent = ''; }
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
