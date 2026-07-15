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
  const nextSection = background.indexOf('// ── 标签页与内容脚本', testConnectionStart);
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

test('人工批准、预演确认与正式投递使用独立路径和三重安全门', () => {
  const background = read('src/background.js');
  const sidepanelHtml = read('src/sidepanel.html');
  const sidepanelJs = read('src/sidepanel.js');
  const contentSearch = read('src/content-search.js');
  const contentChat = read('src/content-chat.js');

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
  assert.doesNotMatch(previewBody, /GO_CHAT|SEND_BUNDLE|goChat/);
  assert.match(previewBody, /generateAiOpening/);
  const previewPrepareStart = background.indexOf('async function preparePreviewRun');
  assert.match(background.slice(previewPrepareStart, deliverStart), /reviewStatus === 'approved'/);
  assert.match(previewBody, /ReviewWorkflow\.createPreview/);
  assert.match(previewBody, /verifyEligibility/);

  const deliverEnd = background.indexOf('async function finishDeliverWithError', deliverStart);
  const deliverBody = background.slice(deliverStart, deliverEnd);
  assert.match(background, /GO_CHAT/);
  assert.match(deliverBody, /establishChatPage/);
  assert.match(deliverBody, /SEND_BUNDLE/);
  assert.match(deliverBody, /ReviewWorkflow\.isPreviewReady/);
  assert.match(deliverBody, /break/);

  assert.doesNotMatch(sidepanelHtml, /id="runMode"/);
  assert.match(sidepanelHtml, /id="btnPreview"/);
  assert.match(sidepanelHtml, /id="btnDeliver"/);
  assert.match(sidepanelHtml, /id="greetingPlanSelect"/);
  assert.match(sidepanelJs, /window\.confirm/);
  assert.match(sidepanelJs, /START_PREVIEW/);
  assert.match(sidepanelJs, /SET_REVIEW_DECISION/);
  assert.match(sidepanelJs, /CONFIRM_PREVIEW/);
  assert.match(contentSearch, /currentJob/);
  assert.match(contentChat, /MessageBundle\.run/);
});

test('正式投递先观察匹配聊天页，再发送三段消息', () => {
  const background = read('src/background.js');
  const navigation = read('src/chat-navigation.js');

  assert.match(background, /importScripts\([^)]*chat-navigation\.js/);
  const establishStart = background.indexOf('async function establishChatPage');
  const establishEnd = background.indexOf('// ── 持久化与迁移 ──', establishStart);
  const establishBody = background.slice(establishStart, establishEnd);
  assert.ok(establishStart >= 0 && establishEnd > establishStart, '缺少聊天页交接函数');
  assert.ok(
    establishBody.indexOf('ChatNavigation.observe') < establishBody.indexOf("type: 'GO_CHAT'"),
    '观察器必须在 GO_CHAT 之前启动'
  );
  assert.match(establishBody, /ChatNavigation\.coordinate/);
  assert.match(establishBody, /ChatNavigation\.matchChatUrl/);
  assert.match(establishBody, /timeoutMs: 30000/);
  assert.match(establishBody, /isCancelled: \(\) => state\.aborted/);

  const deliverStart = background.indexOf('async function runDeliver');
  const deliverEnd = background.indexOf('async function finishDeliverWithError', deliverStart);
  const deliverBody = background.slice(deliverStart, deliverEnd);
  assert.ok(
    deliverBody.indexOf('establishChatPage') < deliverBody.indexOf("type: 'SEND_BUNDLE'"),
    '匹配聊天页必须先于 SEND_BUNDLE'
  );
  assert.match(deliverBody, /sendToTab\(chatPage\.tab\.id/);
  assert.match(deliverBody, /\}, 45000\);/);
  assert.match(deliverBody, /removeTabs\(Array\.from\(temporaryTabIds\)\)/);
  assert.match(navigation, /message \(\?:channel\|port\)/);
});

test('预演按钮等待启动确认并在岗位卡片内显示实时进度与失败', () => {
  const background = read('src/background.js');
  const sidepanelHtml = read('src/sidepanel.html');
  const sidepanelJs = read('src/sidepanel.js');

  assert.match(sidepanelHtml, /preview-run-state\.js/);
  assert.match(sidepanelHtml, /id="previewRunError"/);
  assert.match(sidepanelJs, /await runtimeMessage\(\{ type: 'START_PREVIEW'/);
  assert.match(sidepanelJs, /PREVIEW_PROGRESS/);
  assert.match(sidepanelJs, /PreviewRunState\.applyProgress/);
  assert.match(sidepanelJs, /PreviewRunState\.failStart/);
  assert.match(background, /preparePreviewRun/);
  assert.match(background, /PREVIEW_PROGRESS/);
  assert.match(background, /reading_detail/);
  assert.match(background, /generating_opening/);
  assert.match(background, /not_run/);
  assert.match(background, /页面加载超时/);
  assert.match(background, /页面脚本响应超时/);
});

test('单岗位重新生成不访问 BOSS，确认按钮具有明确状态', () => {
  const background = read('src/background.js');
  const sidepanelJs = read('src/sidepanel.js');
  const sidepanelCss = read('src/sidepanel.css');

  const regenerateStart = background.indexOf('async function regeneratePreviewOpening');
  const deliverStart = background.indexOf('// ── 正式三段式投递', regenerateStart);
  const regenerateBody = background.slice(regenerateStart, deliverStart);
  assert.ok(regenerateStart >= 0 && deliverStart > regenerateStart, '缺少单岗位重新生成函数');
  assert.match(regenerateBody, /generateAiOpening/);
  assert.match(regenerateBody, /ReviewWorkflow\.regeneratePreview/);
  assert.doesNotMatch(regenerateBody, /readJobDetail|openJobForDelivery|GO_CHAT|SEND_BUNDLE/);
  assert.ok(
    regenerateBody.indexOf('generateAiOpening') < regenerateBody.indexOf('state.previews[jobId] = regenerated'),
    '模型失败前不能覆盖旧预演'
  );
  assert.match(background, /REGENERATE_PREVIEW/);
  assert.match(background, /UPDATE_PREVIEW_DRAFT/);
  assert.match(background, /preview\.confirmedAt >= editTime/);
  assert.match(sidepanelJs, /data-regenerate-preview/);
  assert.match(sidepanelJs, /生成中…/);
  assert.match(sidepanelJs, /✓ 已确认/);
  assert.match(sidepanelJs, /renderDeliveryControls\(confirmedApprovedJobs\(\)\)/);
  assert.match(sidepanelCss, /\.preview-actions \.confirm\.confirmed/);
});

test('稳定详情链接优先于搜索页卡片，并在详情页补全字段', () => {
  const background = read('src/background.js');
  const contentSearch = read('src/content-search.js');
  const manifest = JSON.parse(read('manifest.json'));

  assert.match(background, /createDetailTab\(job\.detailUrl, false\)/);
  assert.match(background, /READ_DETAIL/);
  assert.match(background, /JobDetail\.mergeDetail/);
  assert.match(background, /AI 使用完整 JD 筛选中/);
  assert.match(contentSearch, /parseDetailPage/);
  assert.match(contentSearch, /JobDetail\.canonicalizeDetailUrl/);
  assert.ok(manifest.content_scripts[0].matches.includes('*://*.zhipin.com/job_detail/*'));
  assert.ok(manifest.content_scripts[0].js.includes('src/job-detail.js'));
});

test('招呼方案和审核状态脚本在侧边栏与后台按依赖顺序加载', () => {
  const background = read('src/background.js');
  const sidepanelHtml = read('src/sidepanel.html');

  assert.match(background, /importScripts\([^)]*greeting-plans\.js[^)]*review-workflow\.js/);
  assert.ok(sidepanelHtml.indexOf('greeting-plans.js') < sidepanelHtml.indexOf('review-workflow.js'));
  assert.ok(sidepanelHtml.indexOf('review-workflow.js') < sidepanelHtml.indexOf('sidepanel.js'));
});

test('侧边栏代码引用的静态控件全部存在，Manifest 脚本文件完整', () => {
  const sidepanelHtml = read('src/sidepanel.html');
  const sidepanelJs = read('src/sidepanel.js');
  const manifest = JSON.parse(read('manifest.json'));
  const ids = Array.from(sidepanelJs.matchAll(/\$\('([^']+)'\)/g)).map(match => match[1]);
  Array.from(new Set(ids)).forEach(id => {
    assert.match(sidepanelHtml, new RegExp('id="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"'), '缺少控件：' + id);
  });

  manifest.content_scripts.forEach(entry => entry.js.forEach(file => {
    assert.equal(fs.existsSync(path.join(extensionRoot, file)), true, 'Manifest 缺少脚本：' + file);
  }));
  const chatScripts = manifest.content_scripts[1].js;
  assert.ok(chatScripts.indexOf('src/message-bundle.js') < chatScripts.indexOf('src/content-chat.js'));
  assert.equal(fs.existsSync(path.join(extensionRoot, 'src/chat-navigation.js')), true);
});

test('进度看板只管理插件岗位并持久化手动状态', () => {
  const background = read('src/background.js');
  const sidepanelHtml = read('src/sidepanel.html');
  const sidepanelJs = read('src/sidepanel.js');

  assert.match(background, /importScripts\([^)]*job-tracker\.js/);
  assert.match(background, /jobTrackerRecords/);
  assert.match(background, /JobTracker\.upsertCollected/);
  assert.match(background, /JobTracker\.setStatus/);
  assert.match(background, /GET_TRACKER/);
  assert.match(background, /UPDATE_TRACKER_STATUS/);
  assert.match(sidepanelHtml, /id="trackerCard"/);
  assert.match(sidepanelHtml, /id="trackerFilter"/);
  assert.match(sidepanelHtml, /id="trackerSummary"/);
  assert.match(sidepanelHtml, /id="trackerList"/);
  assert.ok(sidepanelHtml.indexOf('job-tracker.js') < sidepanelHtml.indexOf('sidepanel.js'));
  assert.match(sidepanelJs, /GET_TRACKER/);
  assert.match(sidepanelJs, /UPDATE_TRACKER_STATUS/);
  assert.doesNotMatch(background, /扫描.*BOSS.*历史|IMPORT_BOSS_HISTORY/);
});
