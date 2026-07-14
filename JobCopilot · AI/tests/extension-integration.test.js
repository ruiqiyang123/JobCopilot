const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(extensionRoot, relativePath), 'utf8');
}

test('后台加载通用客户端并移除 DeepSeek 专属调用', () => {
  const background = read('src/background.js');

  assert.match(background, /importScripts\([^)]*llm-client\.js/);
  assert.match(background, /LLMClient\.call/);
  assert.match(background, /TEST_LLM/);
  assert.doesNotMatch(background, /callDS|DS_ENDPOINT|DS_MODEL/);
  assert.doesNotMatch(background, /请先填写 DeepSeek API Key|AI 筛选中（DeepSeek）/);
});

test('测试连接路径不调用 BOSS 收集或投递流程', () => {
  const background = read('src/background.js');
  const testConnectionStart = background.indexOf('async function testLLMConnection');
  const nextSection = background.indexOf('// ── tab 注入', testConnectionStart);
  const testConnectionBody = background.slice(testConnectionStart, nextSection);

  assert.ok(testConnectionStart >= 0, '缺少 testLLMConnection');
  assert.doesNotMatch(testConnectionBody, /ensureTab|runCollect|runDeliver|sendToTab/);
});

test('侧边栏提供模型配置、迁移、域名授权和测试连接', () => {
  const sidepanelHtml = read('src/sidepanel.html');
  const sidepanelJs = read('src/sidepanel.js');

  assert.match(sidepanelHtml, /id="llmProvider"/);
  assert.match(sidepanelHtml, /id="llmApiKey"/);
  assert.match(sidepanelHtml, /id="llmBaseUrl"/);
  assert.match(sidepanelHtml, /id="llmModel"/);
  assert.match(sidepanelHtml, /id="llmAuthType"/);
  assert.match(sidepanelHtml, /id="testLlm"/);
  assert.match(sidepanelHtml, /id="llmTestStatus"/);
  assert.match(sidepanelHtml, /value="longcat"[^>]*>LongCat/);
  assert.ok(sidepanelHtml.indexOf('llm-client.js') < sidepanelHtml.indexOf('sidepanel.js'));

  assert.match(sidepanelJs, /LLMClient\.migrateStoredConfig/);
  assert.match(sidepanelJs, /chrome\.permissions\.request/);
  assert.match(sidepanelJs, /chrome\.permissions\.contains/);
  assert.match(sidepanelJs, /TEST_LLM/);
  assert.doesNotMatch(sidepanelJs, /const CFG_FIELDS = \['dsKey'/);

  const permissionStart = sidepanelJs.indexOf('async function ensureCustomHostPermission');
  const permissionEnd = sidepanelJs.indexOf('function llmStorageFrom', permissionStart);
  const permissionBody = sidepanelJs.slice(permissionStart, permissionEnd);
  assert.ok(
    permissionBody.indexOf('permissionRequest(origin)') < permissionBody.indexOf('permissionContains(origin)'),
    'permissions.request 必须先在用户手势中触发，再检查授权结果'
  );
});

test('Manifest 固定授权内置服务商，并把其他 HTTPS 域名设为可选', () => {
  const manifest = JSON.parse(read('manifest.json'));

  assert.ok(manifest.host_permissions.includes('https://api.xiaomimimo.com/*'));
  assert.ok(manifest.host_permissions.includes('https://api.deepseek.com/*'));
  assert.ok(manifest.host_permissions.includes('https://api.longcat.chat/*'));
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
  assert.ok(!manifest.host_permissions.includes('<all_urls>'));
});

test('岗位硬筛选在 AI 筛选前执行，并提供可配置 UI 和人工确认入口', () => {
  const background = read('src/background.js');
  const sidepanelHtml = read('src/sidepanel.html');
  const sidepanelJs = read('src/sidepanel.js');
  const manifest = JSON.parse(read('manifest.json'));

  assert.match(background, /importScripts\([^)]*job-filters\.js/);
  assert.match(background, /JobFilters\.evaluate/);
  assert.match(background, /CONFIRM_FILTER_PENDING/);
  assert.ok(
    background.indexOf('JobFilters.evaluate') < background.indexOf('screenJob(cfg, job)'),
    '硬筛选必须发生在 AI screenJob 之前'
  );
  assert.match(sidepanelHtml, /id="experienceFilterEnabled"/);
  assert.match(sidepanelHtml, /id="experienceFilterOptions"/);
  assert.match(sidepanelHtml, /id="companySizeFilterEnabled"/);
  assert.match(sidepanelHtml, /id="companySizeFilterOptions"/);
  assert.ok(sidepanelHtml.indexOf('job-filters.js') < sidepanelHtml.indexOf('sidepanel.js'));
  assert.match(sidepanelJs, /jobFilterConfig/);
  assert.match(sidepanelJs, /CONFIRM_FILTER_PENDING/);
  assert.deepEqual(
    manifest.content_scripts[0].js.slice(0, 2),
    ['src/selectors.js', 'src/job-filters.js']
  );
});

test('模拟运行与正式投递使用独立路径和双重安全门', () => {
  const background = read('src/background.js');
  const sidepanelHtml = read('src/sidepanel.html');
  const sidepanelJs = read('src/sidepanel.js');
  const contentSearch = read('src/content-search.js');

  assert.match(background, /importScripts\([^)]*workflow-safety\.js/);
  assert.match(background, /START_PREVIEW/);
  assert.match(background, /WorkflowSafety\.canDeliver/);
  assert.match(background, /WorkflowSafety\.verifyEligibility/);
  assert.match(background, /sw_previews/);
  assert.match(background, /lastBatch/);

  const previewStart = background.indexOf('async function runPreview');
  const deliverStart = background.indexOf('async function runDeliver', previewStart);
  const previewBody = background.slice(previewStart, deliverStart);
  assert.ok(previewStart >= 0 && deliverStart > previewStart, '缺少独立的 runPreview');
  assert.doesNotMatch(previewBody, /GO_CHAT|SEND_ACTIVE|goChat/);
  assert.match(previewBody, /genGreetingFromJD/);
  assert.match(previewBody, /verifyEligibility/);

  const deliverEnd = background.indexOf('function recordOk', deliverStart);
  const deliverBody = background.slice(deliverStart, deliverEnd);
  assert.match(deliverBody, /GO_CHAT/);
  assert.match(deliverBody, /SEND_ACTIVE/);
  assert.match(deliverBody, /break/);

  assert.match(sidepanelHtml, /id="runMode"/);
  assert.match(sidepanelHtml, /option value="preview" selected/);
  assert.match(sidepanelHtml, /option value="live"/);
  assert.match(sidepanelJs, /window\.confirm/);
  assert.match(sidepanelJs, /START_PREVIEW/);
  assert.match(contentSearch, /currentJob/);
});
