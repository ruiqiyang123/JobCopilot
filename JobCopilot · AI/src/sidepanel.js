// ===== JobCopilot 侧边栏：配置 → 审核 → 预演确认 → 正式投递 =====
const $ = id => document.getElementById(id);
const BASIC_CFG_FIELDS = ['resumeText', 'keyword', 'city', 'count'];
const LLM_STORAGE_FIELDS = ['llmProvider', 'llmApiKey', 'llmBaseUrl', 'llmModel', 'llmAuthType'];
const LOAD_FIELDS = BASIC_CFG_FIELDS.concat(LLM_STORAGE_FIELDS, [
  'resumeImage', 'dsKey', 'jobFilterConfig', 'greetingPlansState'
]);

let currentScreened = [];
let currentPreviews = {};
let currentLastBatch = null;
let greetingPlansState = GreetingPlans.normalizeState();
let trackerRecords = [];
let currentReviewTab = 'pending_review';
let editingResumeImage = '';
let currentPreviewRun = null;
const confirmingPreviewIds = new Set();
const regeneratingPreviewIds = new Set();
const previewActionErrors = {};
const previewDraftTimers = {};

function esc(value) {
  return String(value || '').replace(/[&<>"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[character]));
}

function safeJobLink(value) {
  return JobDetail.canonicalizeDetailUrl(value || '');
}

function runtimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response || { ok: false, error: '扩展后台无响应' });
    });
  });
}

document.querySelectorAll('.card-h[data-toggle]').forEach(header => {
  header.addEventListener('click', () => {
    const body = $(header.dataset.toggle);
    body.classList.toggle('hidden');
  });
});

// ── 模型与基础配置 ──
function applyProviderUI(forceDefaults) {
  const provider = $('llmProvider').value;
  const preset = LLMClient.getProviderPreset(provider);
  const custom = provider === 'custom';
  $('llmBaseUrl').readOnly = !custom;
  $('llmAuthRow').classList.toggle('hidden', !custom);
  if (preset) {
    $('llmBaseUrl').value = preset.baseUrl;
    $('llmAuthType').value = preset.authType;
    if (forceDefaults || !$('llmModel').value.trim()) $('llmModel').value = preset.model;
    const placeholders = {
      xiaomi: 'MiMo API Key', deepseek: 'DeepSeek API Key', longcat: 'LongCat API Key'
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
  const normalized = LLMClient.validateConfig(readLLMForm());
  const granted = await ensureCustomHostPermission(normalized);
  if (!granted) throw new Error('未授权访问该模型接口域名');
  const data = llmStorageFrom(normalized);
  data.jobFilterConfig = readJobFilterForm();
  BASIC_CFG_FIELDS.forEach(field => { data[field] = $(field).value.trim(); });
  await chrome.storage.local.set(data);
  const invalidated = await runtimeMessage({
    type: 'INVALIDATE_PREVIEWS', reason: '基础配置已变化，需要重新预演'
  });
  if (invalidated.ok && invalidated.result) currentPreviews = invalidated.result.previews || currentPreviews;
  return normalized;
}

function showSaved(id) {
  const element = $(id);
  element.classList.remove('hidden');
  setTimeout(() => element.classList.add('hidden'), 1500);
}

function setLLMTestStatus(text, status) {
  $('llmTestStatus').textContent = text || '';
  $('llmTestStatus').className = 'test-status' + (status ? ' ' + status : '');
}

async function loadConfig() {
  const stored = await chrome.storage.local.get(LOAD_FIELDS);
  const migrated = LLMClient.migrateStoredConfig(stored);
  if (Object.keys(migrated).length) await chrome.storage.local.set(migrated);
  const data = Object.assign({}, stored, migrated);
  BASIC_CFG_FIELDS.forEach(field => {
    if (data[field] !== undefined) $(field).value = data[field];
  });
  $('llmProvider').value = data.llmProvider || 'xiaomi';
  $('llmApiKey').value = data.llmApiKey || '';
  $('llmBaseUrl').value = data.llmBaseUrl || '';
  $('llmModel').value = data.llmModel || '';
  $('llmAuthType').value = data.llmAuthType || 'bearer';
  applyProviderUI(false);
  applyJobFilterConfig(data.jobFilterConfig);
  greetingPlansState = GreetingPlans.normalizeState(data.greetingPlansState, {
    resumeImage: data.resumeImage || ''
  });
  renderPlanPicker();
}

$('llmProvider').addEventListener('change', () => {
  $('llmApiKey').value = '';
  applyProviderUI(true);
  setLLMTestStatus('', '');
});
$('experienceFilterEnabled').addEventListener('change', () => syncFilterEnabled('experience'));
$('companySizeFilterEnabled').addEventListener('change', () => syncFilterEnabled('companySize'));
$('saveCfg').addEventListener('click', async () => {
  try { await persistCurrentConfig(); showSaved('saved'); }
  catch (error) { addLog(error.message, 'error'); }
});
$('testLlm').addEventListener('click', async () => {
  $('testLlm').disabled = true;
  setLLMTestStatus('连接中…', '');
  try {
    const config = LLMClient.validateConfig(readLLMForm());
    if (!(await ensureCustomHostPermission(config))) throw new Error('未授权访问该模型接口域名');
    const response = await runtimeMessage({ type: 'TEST_LLM', config: config });
    if (!response.ok) throw new Error(response.error || '连接失败');
    const result = response.result;
    setLLMTestStatus('✓ ' + result.provider + ' / ' + result.model + ' · ' + result.elapsedMs + 'ms', 'success');
  } catch (error) { setLLMTestStatus('✗ ' + error.message, 'error'); }
  finally { $('testLlm').disabled = false; }
});

// ── 招呼方案 ──
function selectedPlan() { return GreetingPlans.selectedPlan(greetingPlansState); }

function renderPlanPicker() {
  greetingPlansState = GreetingPlans.normalizeState(greetingPlansState);
  $('greetingPlanSelect').innerHTML = greetingPlansState.plans.map(plan =>
    '<option value="' + esc(plan.id) + '"' + (plan.id === greetingPlansState.selectedPlanId ? ' selected' : '')
      + '>' + esc(plan.name) + '</option>'
  ).join('');
  applyPlanForm(selectedPlan());
}

function applyPlanForm(plan) {
  const normalized = GreetingPlans.normalizePlan(plan);
  $('planName').value = normalized.name;
  $('aiOpeningEnabled').checked = normalized.aiOpeningEnabled;
  $('aiInstruction').value = normalized.aiInstruction;
  $('fixedMessageEnabled').checked = normalized.fixedMessageEnabled;
  $('fixedMessage').value = normalized.fixedMessage;
  $('resumeImageEnabled').checked = normalized.resumeImageEnabled;
  editingResumeImage = normalized.resumeImage;
  renderPlanImage();
  syncPlanFields();
}

function syncPlanFields() {
  $('aiInstruction').disabled = !$('aiOpeningEnabled').checked;
  $('fixedMessage').disabled = !$('fixedMessageEnabled').checked;
  $('planResumeImage').disabled = !$('resumeImageEnabled').checked;
}

function renderPlanImage() {
  $('planImgPrev').innerHTML = editingResumeImage
    ? '<img src="' + editingResumeImage + '" alt="当前简历图片">'
    : '<div class="job-meta">尚未上传简历图片</div>';
}

function readPlanForm() {
  const current = selectedPlan();
  return GreetingPlans.normalizePlan({
    id: current.id,
    name: $('planName').value.trim(),
    aiOpeningEnabled: $('aiOpeningEnabled').checked,
    aiInstruction: $('aiInstruction').value.trim(),
    fixedMessageEnabled: $('fixedMessageEnabled').checked,
    fixedMessage: $('fixedMessage').value.trim(),
    resumeImageEnabled: $('resumeImageEnabled').checked,
    resumeImage: editingResumeImage,
    createdAt: current.createdAt,
    updatedAt: Date.now()
  });
}

async function persistGreetingPlans() {
  const response = await runtimeMessage({ type: 'SAVE_GREETING_PLANS', state: greetingPlansState });
  if (!response.ok) throw new Error(response.error || '招呼方案保存失败');
  greetingPlansState = response.result.state || response.result;
  currentPreviews = response.result.previews || currentPreviews;
  await chrome.storage.local.set({ greetingPlansState: greetingPlansState });
  renderPlanPicker();
  renderPreviews();
}

$('greetingPlanSelect').addEventListener('change', async event => {
  try {
    greetingPlansState = GreetingPlans.selectPlan(greetingPlansState, event.target.value);
    await persistGreetingPlans();
  } catch (error) { addLog(error.message, 'error'); }
});
$('aiOpeningEnabled').addEventListener('change', syncPlanFields);
$('fixedMessageEnabled').addEventListener('change', syncPlanFields);
$('resumeImageEnabled').addEventListener('change', syncPlanFields);
$('planResumeImage').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = result => { editingResumeImage = result.target.result; renderPlanImage(); };
  reader.readAsDataURL(file);
});
$('savePlan').addEventListener('click', async () => {
  try {
    greetingPlansState = GreetingPlans.upsertPlan(greetingPlansState, readPlanForm());
    await persistGreetingPlans();
    showSaved('planSaved');
  } catch (error) { addLog(error.message, 'error'); }
});
$('newPlan').addEventListener('click', async () => {
  try {
    const plan = GreetingPlans.normalizePlan({ name: '新招呼方案' });
    greetingPlansState = GreetingPlans.upsertPlan(greetingPlansState, plan);
    greetingPlansState = GreetingPlans.selectPlan(greetingPlansState, plan.id);
    await persistGreetingPlans();
  } catch (error) { addLog(error.message, 'error'); }
});
$('deletePlan').addEventListener('click', async () => {
  const plan = selectedPlan();
  if (!window.confirm('删除招呼方案“' + plan.name + '”？相关预演将需要重新生成。')) return;
  try {
    greetingPlansState = GreetingPlans.removePlan(greetingPlansState, plan.id);
    await persistGreetingPlans();
  } catch (error) { addLog(error.message, 'error'); }
});

// ── 运行控制 ──
function setRunning(running) {
  $('btnCollect').disabled = running;
  $('btnPause').disabled = !running;
  $('btnStop').disabled = !running;
  if (!running) $('btnPause').textContent = '暂停';
}

$('btnCollect').addEventListener('click', async () => {
  try { await persistCurrentConfig(); }
  catch (error) { return addLog(error.message, 'error'); }
  if (!$('keyword').value.trim()) return addLog('请先填写岗位关键词', 'error');
  currentScreened = [];
  currentPreviews = {};
  currentLastBatch = null;
  currentPreviewRun = null;
  currentReviewTab = 'pending_review';
  renderReview();
  renderPreviews();
  setRunning(true);
  chrome.runtime.sendMessage({ type: 'START_COLLECT' });
});
$('btnPause').addEventListener('click', () => {
  if ($('btnPause').textContent === '暂停') {
    $('btnPause').textContent = '继续';
    chrome.runtime.sendMessage({ type: 'PAUSE' });
  } else {
    $('btnPause').textContent = '暂停';
    chrome.runtime.sendMessage({ type: 'RESUME' });
  }
});
$('btnStop').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP' });
  if (PreviewRunState.isRunning(currentPreviewRun)) {
    currentPreviewRun = PreviewRunState.finish(currentPreviewRun, 'stopped');
    renderPreviews();
  }
  setRunning(false);
});
$('btnReset').addEventListener('click', () => {
  if (!window.confirm('重置当前筛选、审核和预演批次？岗位进度与已投记录会保留。')) return;
  chrome.runtime.sendMessage({ type: 'RESET' });
  currentScreened = [];
  currentPreviews = {};
  currentLastBatch = null;
  currentPreviewRun = null;
  renderReview();
  renderPreviews();
  setRunning(false);
});

// ── 审核队列 ──
function normalizedJobs() { return currentScreened.map(ReviewWorkflow.normalizeJob); }

function reviewCounts() {
  const counts = { pending_review: 0, needs_info: 0, approved: 0, rejected: 0, filtered_out: 0 };
  normalizedJobs().forEach(job => { counts[job.reviewStatus] = (counts[job.reviewStatus] || 0) + 1; });
  return counts;
}

function jobFactsText(job) {
  return [
    job.company || '公司未知', job.salary || '薪资未知',
    '经验：' + JobFilters.labelFor('experience', job.experience),
    '规模：' + JobFilters.labelFor('companySize', job.companySize)
  ].join(' · ');
}

function reasonClass(job) {
  if (job.reviewStatus === 'needs_info') return 'pending';
  if (job.reviewStatus === 'filtered_out' || job.reviewStatus === 'rejected') return 'skip';
  return 'match';
}

function renderReviewCard(job) {
  const link = safeJobLink(job.detailUrl || job.link);
  const title = link
    ? '<a href="' + esc(link) + '" target="_blank" rel="noreferrer">' + esc(job.name) + '</a>'
    : esc(job.name);
  let actions = '';
  if (link) actions += '<a class="icon-btn" href="' + esc(link) + '" target="_blank" rel="noreferrer">查看完整岗位</a>';
  if (job.reviewStatus === 'needs_info') {
    actions += '<button data-action="confirm-filter" data-id="' + esc(job.id) + '">确认信息符合</button>';
    actions += '<button class="reject" data-action="reject" data-id="' + esc(job.id) + '">不投递</button>';
  } else if (job.reviewStatus === 'pending_review' || job.reviewStatus === 'rejected') {
    if (job.filterStatus === 'pass' && job.match === true) {
      actions += '<button class="approve" data-action="approve" data-id="' + esc(job.id) + '">批准投递</button>';
    }
    if (job.reviewStatus !== 'rejected') {
      actions += '<button class="reject" data-action="reject" data-id="' + esc(job.id) + '">不投递</button>';
    }
  } else if (job.reviewStatus === 'approved') {
    actions += '<button class="reject" data-action="reject" data-id="' + esc(job.id) + '">取消批准</button>';
  }
  const reason = job.reason || (job.filterReasons || []).join('；') || '等待审核';
  const jd = String(job.jd || '').trim();
  const detailError = job.detailError ? '<div class="job-reason pending">详情读取：' + esc(job.detailError) + '</div>' : '';
  return '<article class="job-item"><div class="job-head"><div class="job-title">' + title + '</div>'
    + '<span class="preview-status">' + esc(reviewStatusLabel(job.reviewStatus)) + '</span></div>'
    + '<div class="job-meta">' + esc(jobFactsText(job)) + '</div>'
    + '<div class="job-reason ' + reasonClass(job) + '">' + esc(reason) + '</div>'
    + detailError
    + (jd ? '<div class="jd-summary">' + esc(jd) + '</div>' : '')
    + '<div class="job-actions">' + actions + '</div></article>';
}

function reviewStatusLabel(status) {
  return ({
    pending_review: '待审核', needs_info: '待补充', approved: '已批准',
    rejected: '不投递', filtered_out: '已排除'
  })[status] || status;
}

function renderReview() {
  const counts = reviewCounts();
  document.querySelectorAll('[data-review-tab]').forEach(button => {
    const status = button.dataset.reviewTab;
    button.classList.toggle('active', status === currentReviewTab);
    const count = button.querySelector('span');
    if (count) count.textContent = counts[status] || 0;
  });
  $('reviewCount').textContent = normalizedJobs().length + ' 个岗位';
  const visible = normalizedJobs().filter(job => job.reviewStatus === currentReviewTab);
  $('reviewList').innerHTML = visible.map(renderReviewCard).join('')
    || '<div class="empty">当前分类没有岗位</div>';
  $('approvedSummary').textContent = '已批准 ' + counts.approved + ' 个';
  renderPreviewButton(counts.approved);
  renderPreviews();
}

$('reviewTabs').addEventListener('click', event => {
  const button = event.target.closest('[data-review-tab]');
  if (!button) return;
  currentReviewTab = button.dataset.reviewTab;
  renderReview();
});

$('reviewList').addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  button.disabled = true;
  const jobId = button.dataset.id;
  try {
    let response;
    if (button.dataset.action === 'confirm-filter') {
      response = await runtimeMessage({ type: 'CONFIRM_FILTER_PENDING', jobId: jobId });
    } else {
      response = await runtimeMessage({
        type: 'SET_REVIEW_DECISION', jobId: jobId,
        decision: button.dataset.action === 'approve' ? 'approved' : 'rejected'
      });
    }
    if (!response.ok) throw new Error(response.error || '审核操作失败');
    currentScreened = response.result.screened || currentScreened;
    currentPreviews = response.result.previews || currentPreviews;
    renderReview();
  } catch (error) {
    addLog(error.message, 'error');
    button.disabled = false;
  }
});

// ── 预演与正式投递 ──
function renderPreviewButton(approvedCount) {
  const running = PreviewRunState.isRunning(currentPreviewRun);
  $('btnPreview').disabled = approvedCount === 0 || running;
  $('btnPreview').textContent = running
    ? '预演中 ' + currentPreviewRun.completed + '/' + currentPreviewRun.total
    : '预演已批准岗位';
}

function renderPreviewRunError() {
  const error = currentPreviewRun && currentPreviewRun.status === 'failed'
    ? currentPreviewRun.error : '';
  $('previewRunError').textContent = error || '';
  $('previewRunError').classList.toggle('hidden', !error);
}

$('btnPreview').addEventListener('click', async () => {
  const ids = normalizedJobs().filter(job => job.reviewStatus === 'approved').map(job => job.id);
  if (!ids.length) return addLog('请先批准至少一个岗位', 'error');
  currentPreviewRun = PreviewRunState.start(ids, '');
  renderPreviews();
  try {
    GreetingPlans.validateForSend(selectedPlan());
    setRunning(true);
    addLog('开始预演 ' + ids.length + ' 个已批准岗位', 'info');
    const response = await runtimeMessage({ type: 'START_PREVIEW', jobIds: ids });
    if (!response.ok) throw new Error(response.error || '预演启动失败');
    currentPreviewRun = PreviewRunState.attach(
      currentPreviewRun,
      response.result && response.result.runId,
      response.result && response.result.jobIds
    );
    renderPreviews();
  } catch (error) {
    currentPreviewRun = PreviewRunState.failStart(currentPreviewRun, error.message);
    setRunning(false);
    renderPreviews();
    addLog(error.message, 'error');
  }
});

function renderRunningPreviewItem(job, runJob) {
  const label = PreviewRunState.STAGE_LABELS[runJob.stage] || '等待预演';
  const className = runJob.stage === 'failed'
    ? 'failed' : (runJob.stage === 'not_run' ? 'not-run' : 'running');
  const detail = runJob.stage === 'failed' && runJob.error
    ? '<div class="job-reason skip">' + esc(runJob.error) + '</div>' : '';
  return '<article class="preview-item"><div class="job-head"><div class="job-title">'
    + esc(job.name) + '</div><span class="preview-status ' + className + '">' + esc(label) + '</span></div>'
    + detail + '</article>';
}

function renderPreviewItem(job, preview) {
  const runJob = PreviewRunState.jobState(currentPreviewRun, job.id);
  if (runJob && runJob.stage !== 'draft') return renderRunningPreviewItem(job, runJob);
  if (!preview) {
    return '<article class="preview-item"><div class="job-title">' + esc(job.name) + '</div>'
      + '<div class="preview-status">等待预演</div></article>';
  }
  if (preview.status === 'failed' || preview.status === 'expired') {
    return '<article class="preview-item"><div class="job-title">' + esc(job.name) + '</div>'
      + '<div class="preview-status failed">' + esc(preview.error || '预演失败') + '</div></article>';
  }
  const aiEnabled = (preview.enabledSteps || []).indexOf('aiOpening') >= 0;
  const fixedEnabled = (preview.enabledSteps || []).indexOf('fixedMessage') >= 0;
  const imageEnabled = (preview.enabledSteps || []).indexOf('resumeImage') >= 0;
  const confirmed = preview.status === 'confirmed';
  const confirming = confirmingPreviewIds.has(job.id);
  const regenerating = regeneratingPreviewIds.has(job.id);
  const confirmDisabled = confirmed || confirming || regenerating || (aiEnabled && !String(preview.aiOpening || '').trim());
  const confirmText = confirmed ? '✓ 已确认' : (confirming ? '确认中…' : '确认此岗位预演');
  const actionError = previewActionErrors[job.id]
    ? '<div class="job-reason skip">' + esc(previewActionErrors[job.id]) + '</div>' : '';
  const confirmButton = '<button class="confirm' + (confirmed ? ' confirmed' : '') + '" data-confirm-preview="'
    + esc(job.id) + '"' + (confirmDisabled ? ' disabled' : '') + '>' + confirmText + '</button>';
  const regenerateButton = aiEnabled
    ? '<button class="regenerate" data-regenerate-preview="' + esc(job.id) + '"'
      + ((confirming || regenerating) ? ' disabled' : '') + '>'
      + (regenerating ? '生成中…' : '重新生成 AI 开场') + '</button>'
    : '';
  return '<article class="preview-item"><div class="job-head"><div class="job-title">' + esc(job.name) + '</div>'
    + '<span class="preview-status ' + (confirmed ? 'confirmed' : (regenerating ? 'running' : ''))
    + '" data-preview-status="' + esc(job.id) + '">'
    + (confirmed ? '✓ 已确认' : (regenerating ? '重新生成中…' : '待确认')) + '</span></div>'
    + (aiEnabled ? '<label>AI 个性化开场</label><textarea rows="6" data-preview-opening="' + esc(job.id) + '"'
      + (regenerating ? ' disabled' : '') + '>'
      + esc(preview.aiOpening) + '</textarea>' : '')
    + (fixedEnabled ? '<div class="preview-part"><strong>固定补充消息</strong>' + esc(preview.fixedMessage) + '</div>' : '')
    + (imageEnabled ? '<div class="preview-part"><strong>简历图片</strong>已绑定当前招呼方案图片</div>' : '')
    + actionError
    + '<div class="preview-actions">' + confirmButton + regenerateButton + '</div>'
    + '</article>';
}

function confirmedApprovedJobs() {
  return normalizedJobs().filter(job => job.reviewStatus === 'approved'
    && currentPreviews[job.id] && currentPreviews[job.id].status === 'confirmed');
}

function renderDeliveryControls(ready) {
  $('previewSummary').textContent = ready.length + ' 个已确认';
  $('btnDeliver').disabled = ready.length === 0;
  $('btnDeliver').textContent = ready.length ? '正式投递 ' + ready.length + ' 个已批准岗位' : '暂无可正式投递岗位';
  $('deliverDisabledReason').textContent = ready.length
    ? '将严格按预演内容发送，任一步失败立即停止'
    : '需要先批准岗位并确认预演';
  $('deliverDisabledReason').classList.toggle('disabled-reason', ready.length === 0);
}

function renderPreviews() {
  if (!$('previewList')) return;
  const approved = normalizedJobs().filter(job => job.reviewStatus === 'approved');
  $('previewList').innerHTML = approved.length
    ? approved.map(job => renderPreviewItem(job, currentPreviews[job.id])).join('')
    : '<div class="empty">批准岗位后点击“预演已批准岗位”</div>';
  const ready = confirmedApprovedJobs();
  renderPreviewButton(approved.length);
  renderPreviewRunError();
  renderDeliveryControls(ready);
}

$('previewList').addEventListener('input', event => {
  const textarea = event.target.closest('[data-preview-opening]');
  if (!textarea) return;
  const jobId = textarea.dataset.previewOpening;
  if (currentPreviews[jobId]) {
    const wasConfirmed = currentPreviews[jobId].status === 'confirmed';
    const editedAt = Date.now();
    currentPreviews[jobId] = Object.assign({}, currentPreviews[jobId], {
      status: 'draft', aiOpening: textarea.value, confirmedAt: 0
    });
    previewActionErrors[jobId] = '';
    const status = document.querySelector('[data-preview-status="' + CSS.escape(jobId) + '"]');
    if (status) { status.textContent = '内容已修改，需重新确认'; status.className = 'preview-status failed'; }
    const confirmButton = document.querySelector('[data-confirm-preview="' + CSS.escape(jobId) + '"]');
    if (confirmButton) {
      confirmButton.textContent = '确认此岗位预演';
      confirmButton.className = 'confirm';
      confirmButton.disabled = !textarea.value.trim();
    }
    renderDeliveryControls(confirmedApprovedJobs());
    if (wasConfirmed) {
      runtimeMessage({
        type: 'UPDATE_PREVIEW_DRAFT', jobId: jobId, aiOpening: textarea.value, editedAt: editedAt
      }).then(response => {
        if (!response.ok) throw new Error(response.error || '预演草稿保存失败');
      }).catch(error => addLog(error.message, 'error'));
    }
    clearTimeout(previewDraftTimers[jobId]);
    previewDraftTimers[jobId] = setTimeout(() => {
      runtimeMessage({
        type: 'UPDATE_PREVIEW_DRAFT', jobId: jobId, aiOpening: textarea.value, editedAt: editedAt
      }).then(response => {
        if (!response.ok) throw new Error(response.error || '预演草稿保存失败');
      }).catch(error => {
        previewActionErrors[jobId] = error.message;
        addLog(error.message, 'error');
      });
    }, 400);
  }
});

$('previewList').addEventListener('click', async event => {
  const regenerateButton = event.target.closest('[data-regenerate-preview]');
  if (regenerateButton) {
    const jobId = regenerateButton.dataset.regeneratePreview;
    if (!window.confirm('将覆盖当前 AI 开场，并产生一次模型调用。确认重新生成？')) return;
    clearTimeout(previewDraftTimers[jobId]);
    regeneratingPreviewIds.add(jobId);
    previewActionErrors[jobId] = '';
    renderPreviews();
    try {
      const response = await runtimeMessage({ type: 'REGENERATE_PREVIEW', jobId: jobId });
      if (!response.ok) throw new Error(response.error || 'AI 开场重新生成失败');
      currentPreviews = response.result.previews || currentPreviews;
    } catch (error) {
      previewActionErrors[jobId] = error.message;
      addLog(error.message, 'error');
    } finally {
      regeneratingPreviewIds.delete(jobId);
      renderPreviews();
    }
    return;
  }
  const button = event.target.closest('[data-confirm-preview]');
  if (!button) return;
  const jobId = button.dataset.confirmPreview;
  const textarea = document.querySelector('[data-preview-opening="' + CSS.escape(jobId) + '"]');
  clearTimeout(previewDraftTimers[jobId]);
  confirmingPreviewIds.add(jobId);
  previewActionErrors[jobId] = '';
  renderPreviews();
  try {
    const response = await runtimeMessage({
      type: 'CONFIRM_PREVIEW', jobId: jobId,
      aiOpening: textarea ? textarea.value : (currentPreviews[jobId] && currentPreviews[jobId].aiOpening)
    });
    if (!response.ok) throw new Error(response.error || '预演确认失败');
    currentPreviews = response.result.previews || currentPreviews;
  } catch (error) {
    previewActionErrors[jobId] = error.message;
    addLog(error.message, 'error');
  } finally {
    confirmingPreviewIds.delete(jobId);
    renderPreviews();
  }
});

$('btnDeliver').addEventListener('click', () => {
  const jobs = confirmedApprovedJobs();
  if (!jobs.length) return addLog('没有已批准且已确认预演的岗位', 'error');
  const names = jobs.map(job => job.name + ' - ' + (job.company || '公司未知'));
  const confirmed = window.confirm(
    '即将使用“' + selectedPlan().name + '”正式投递 ' + jobs.length + ' 个岗位：\n\n'
      + names.join('\n') + '\n\n将依次发送 AI 开场、固定消息和简历图片。任一步失败会停止整批。确认继续？'
  );
  if (!confirmed) return;
  setRunning(true);
  addLog('开始正式投递 ' + jobs.length + ' 个已批准岗位', 'warn');
  chrome.runtime.sendMessage({ type: 'START_DELIVER', jobIds: jobs.map(job => job.id) });
});

// ── 岗位进度 ──
function trackerStatusOptions(current) {
  return JobTracker.STATUS_OPTIONS.map(option =>
    '<option value="' + esc(option.value) + '"' + (option.value === current ? ' selected' : '') + '>'
      + esc(option.label) + '</option>'
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
    return '<div class="tracker-item"><div class="tracker-head"><div class="tracker-title">' + title + '</div>'
      + '<select class="tracker-status" data-tracker-id="' + esc(record.id) + '">'
      + trackerStatusOptions(record.status) + '</select></div><div class="tracker-meta">'
      + esc(record.company || '公司未知') + ' · ' + esc(record.salary || '薪资未知') + '</div></div>';
  }).join('') || '<div class="empty">暂无插件处理过的岗位</div>';
}

async function refreshTracker() {
  const response = await runtimeMessage({ type: 'GET_TRACKER' });
  if (!response.ok) throw new Error(response.error || '进度读取失败');
  trackerRecords = response.result.records || [];
  renderTracker();
}

$('trackerFilter').addEventListener('change', renderTracker);
$('trackerList').addEventListener('change', async event => {
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
  } catch (error) {
    addLog(error.message, 'error');
    await refreshTracker().catch(() => {});
  }
});

// ── 恢复与消息 ──
function restorePreviewRun(lastBatch, phase) {
  if (!lastBatch || lastBatch.mode !== 'preview') return null;
  const ids = (lastBatch.executedIds || lastBatch.requestedIds || []).slice();
  if (!ids.length) return null;
  let restored = PreviewRunState.start(ids, lastBatch.runId || '');
  const succeeded = Array.isArray(lastBatch.succeeded) ? lastBatch.succeeded : [];
  succeeded.forEach((id, index) => {
    restored = PreviewRunState.applyProgress(restored, {
      runId: restored.runId, jobId: id, stage: 'draft',
      completed: index + 1, total: ids.length
    });
  });
  const failed = Array.isArray(lastBatch.failed) ? lastBatch.failed : [];
  failed.forEach(item => {
    if (!item.id) return;
    restored = PreviewRunState.applyProgress(restored, {
      runId: restored.runId, jobId: item.id, stage: 'failed',
      completed: succeeded.length, total: ids.length, error: item.error || '预演失败'
    });
  });
  const explicitNotRun = Array.isArray(lastBatch.notRun) ? lastBatch.notRun : [];
  const interrupted = lastBatch.status === 'running' && phase !== 'previewing';
  const notRun = interrupted
    ? ids.filter(id => succeeded.indexOf(id) < 0 && !failed.some(item => item.id === id))
    : explicitNotRun;
  notRun.forEach(id => {
    restored = PreviewRunState.applyProgress(restored, {
      runId: restored.runId, jobId: id, stage: 'not_run',
      completed: succeeded.length, total: ids.length
    });
  });
  if (lastBatch.status === 'running' && !interrupted) return restored;
  const status = interrupted ? 'failed' : lastBatch.status;
  const error = interrupted
    ? '上次预演未正常完成，请重新预演'
    : ((failed[0] && failed[0].error) || '');
  return PreviewRunState.finish(restored, status, error);
}

async function restoreState() {
  const response = await runtimeMessage({ type: 'GET_STATE' });
  if (!response.ok) throw new Error(response.error || '状态读取失败');
  const result = response.result || {};
  currentScreened = result.screened || [];
  currentPreviews = result.previews || {};
  currentLastBatch = result.lastBatch || null;
  currentPreviewRun = restorePreviewRun(currentLastBatch, result.phase);
  if (result.greetingPlansState) {
    greetingPlansState = GreetingPlans.normalizeState(result.greetingPlansState);
    renderPlanPicker();
  }
  renderReview();
  renderPreviews();
}

chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'LOG') addLog(message.text, message.level);
  if (message.type === 'PROGRESS') {
    $('progText').textContent = (message.label ? message.label + ' ' : '') + message.cur + '/' + message.total;
  }
  if (message.type === 'PHASE') {
    const labels = {
      idle: '未开始', collecting: '收集中', screening: '读取详情与 AI 筛选中',
      previewing: '生成预演中', review: '待人工审核', delivering: '正式投递中', done: '已完成'
    };
    $('phaseText').textContent = labels[message.phase] || message.phase;
    if (['review', 'done', 'idle'].indexOf(message.phase) >= 0) setRunning(false);
  }
  if (message.type === 'SCREENED') {
    currentScreened = message.screened || [];
    renderReview();
  }
  if (message.type === 'PREVIEW_PROGRESS') {
    if (!currentPreviewRun) {
      const ids = normalizedJobs().filter(job => job.reviewStatus === 'approved').map(job => job.id);
      currentPreviewRun = PreviewRunState.start(ids, message.runId || '');
    }
    currentPreviewRun = PreviewRunState.applyProgress(currentPreviewRun, message);
    if (message.preview && message.jobId) currentPreviews[message.jobId] = message.preview;
    renderPreviews();
  }
  if (message.type === 'PREVIEWED') {
    if (currentPreviewRun && currentPreviewRun.runId && message.runId
        && currentPreviewRun.runId !== message.runId) return;
    currentPreviews = message.previews || {};
    currentLastBatch = message.lastBatch || null;
    const batchStatus = (currentLastBatch && currentLastBatch.status) || (message.error ? 'failed' : 'completed');
    const batchError = message.error || (currentLastBatch && currentLastBatch.failed
      && currentLastBatch.failed[0] && currentLastBatch.failed[0].error) || '';
    if (currentPreviewRun) {
      currentPreviewRun = PreviewRunState.finish(currentPreviewRun, batchStatus, batchError);
    }
    if (message.screened) currentScreened = message.screened;
    renderReview();
    renderPreviews();
    setRunning(false);
    $('progText').textContent = '';
  }
  if (message.type === 'TRACKER_UPDATED') {
    trackerRecords = message.records || [];
    renderTracker();
  }
  if (message.type === 'DONE') {
    currentLastBatch = message.lastBatch || null;
    setRunning(false);
    $('progText').textContent = '';
    refreshTracker().catch(() => {});
  }
});

function addLog(text, level) {
  level = level || 'info';
  const now = new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(value => String(value).padStart(2, '0')).join(':');
  const element = document.createElement('div');
  element.className = 'log-item ' + level;
  element.innerHTML = '<span class="log-time">[' + time + ']</span>' + esc(text);
  $('log').appendChild(element);
  $('log').scrollTop = $('log').scrollHeight;
  if (level === 'error') $('logDetails').open = true;
}

$('clearLog').addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  $('log').innerHTML = '';
});

loadConfig().then(async () => {
  await restoreState();
  await refreshTracker();
}).catch(error => addLog('配置或状态载入失败：' + error.message, 'error'));
