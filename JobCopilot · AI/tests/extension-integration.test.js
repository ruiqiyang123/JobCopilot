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

  assert.equal(manifest.version, '1.8.2');
  assert.match(read('../README.md'), /version-1\.8\.2-/);
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
  assert.match(sidepanelHtml, /id="employmentTypeFilterEnabled"/);
  assert.match(sidepanelHtml, /id="educationFilterEnabled"/);
  assert.match(sidepanelHtml, /id="salaryFilterEnabled"/);
  assert.match(sidepanelHtml, /id="districtFilterEnabled"/);
  assert.match(sidepanelHtml, /id="publishedTimeFilterEnabled"/);
  assert.match(sidepanelHtml, /id="mustWordsFilterEnabled"/);
  assert.match(sidepanelHtml, /id="excludeWordsFilterEnabled"/);
  assert.match(sidepanelHtml, /id="companyBlacklistEnabled"/);
  assert.ok(sidepanelHtml.indexOf('job-filters.js') < sidepanelHtml.indexOf('sidepanel.js'));
  assert.match(sidepanelJs, /jobFilterConfig/);
  assert.match(sidepanelJs, /employmentTypeValues/);
  assert.match(sidepanelJs, /educationValues/);
  assert.match(sidepanelJs, /salaryMinK/);
  assert.match(sidepanelJs, /publishedWithinDays/);
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
  assert.match(background, /function normalizeDetailResult/);
  assert.match(background, /完整 JD 缺失/);
  assert.match(background, /JobFilters\.applySearchCity\(Object\.assign\(\{\}, detail\.currentJob/);

  const deliverySectionStart = background.indexOf('// ── 正式三段式投递', previewStart);
  const deliverEnd = background.indexOf('async function finishDeliverWithError', deliverStart);
  const deliverySection = background.slice(deliverySectionStart, deliverEnd);
  const deliverBody = background.slice(deliverStart, deliverEnd);
  assert.match(background, /GO_CHAT/);
  assert.match(deliverySection, /establishChatPage/);
  assert.match(deliverBody, /SEND_BUNDLE/);
  assert.match(deliverySection, /ReviewWorkflow\.isPreviewReady/);
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
  assert.match(background, /importScripts\([^)]*contact-retry\.js/);
  const establishStart = background.indexOf('async function establishChatPage');
  const establishEnd = background.indexOf('// ── 持久化与迁移 ──', establishStart);
  const establishBody = background.slice(establishStart, establishEnd);
  assert.ok(establishStart >= 0 && establishEnd > establishStart, '缺少聊天页交接函数');
  assert.ok(
    establishBody.indexOf('ChatNavigation.observe') < establishBody.indexOf("type: 'GO_CHAT'"),
    '观察器必须在 GO_CHAT 之前启动'
  );
  assert.match(establishBody, /ChatNavigation\.coordinate/);
  assert.match(establishBody, /ChatNavigation\.matchChatIdentity/);
  assert.match(establishBody, /resolvePageJobId/);
  assert.match(establishBody, /readChatPageIdentity/);
  assert.match(establishBody, /timeoutMs: 30000/);
  assert.match(establishBody, /missingJobIdGraceMs: 12000/);
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
  assert.match(navigation, /missingJobIdGraceMs/);
  assert.match(navigation, /missingJobIdTabs/);
});

test('聊天页缺少岗位 ID 时只在发送前重新打开并完整复核一次', () => {
  const background = read('src/background.js');
  const helperStart = background.indexOf('async function openVerifiedChatPage');
  const deliverStart = background.indexOf('async function runDeliver', helperStart);
  const deliverEnd = background.indexOf('async function finishDeliverWithError', deliverStart);
  const helperBody = background.slice(helperStart, deliverStart);
  const deliverBody = background.slice(deliverStart, deliverEnd);

  assert.ok(helperStart >= 0 && deliverStart > helperStart, '缺少可重入的发送前建联函数');
  assert.ok(helperBody.indexOf('openJobForDelivery') < helperBody.indexOf('verifyEligibility'));
  assert.ok(helperBody.indexOf('verifyEligibility') < helperBody.indexOf('isPreviewReady'));
  assert.ok(helperBody.indexOf('isPreviewReady') < helperBody.indexOf('establishChatPage'));
  assert.match(deliverBody, /ContactRetry\.MAX_ATTEMPTS/);
  assert.match(deliverBody, /ContactRetry\.shouldRetry/);
  assert.match(deliverBody, /聊天身份加载失败，正在自动重试 1\/1/);
  assert.ok(
    deliverBody.indexOf('openVerifiedChatPage') < deliverBody.indexOf("type: 'SEND_BUNDLE'"),
    '发送必须在建联重试循环完成后才开始'
  );
  assert.equal((deliverBody.match(/executedIds\.push/g) || []).length, 1);
  assert.equal((deliverBody.match(/type: 'SEND_BUNDLE'/g) || []).length, 1);
  assert.match(deliverBody, /removeTabs\(Array\.from\(temporaryTabIds\)\)/);
});

test('岗位页只关闭已识别的订阅回复弹窗并限制为一次重试', () => {
  const background = read('src/background.js');
  const contentSearch = read('src/content-search.js');
  const interstitial = read('src/contact-interstitial.js');
  const manifest = JSON.parse(read('manifest.json'));
  const searchScripts = manifest.content_scripts[0].js;

  assert.ok(searchScripts.includes('src/contact-interstitial.js'));
  assert.ok(
    searchScripts.indexOf('src/contact-interstitial.js') < searchScripts.indexOf('src/content-search.js'),
    '订阅弹窗规则必须在岗位页脚本前加载'
  );
  assert.match(background, /'src\/contact-interstitial\.js', 'src\/content-search\.js'/);
  assert.match(interstitial, /订阅回复消息/);
  assert.match(interstitial, /使用微信扫码订阅/);
  assert.match(contentSearch, /dismissSubscriptionDialog/);
  assert.match(contentSearch, /BOSS 订阅回复弹窗重复出现，已停止批次/);
  assert.match(contentSearch, /attempt < 2/);
});

test('预演只保存图片指纹并从已校验方案读取发送图片', () => {
  const background = read('src/background.js');
  const reviewWorkflow = read('src/review-workflow.js');
  const sidepanelHtml = read('src/sidepanel.html');

  const createStart = reviewWorkflow.indexOf('function createPreview');
  const confirmStart = reviewWorkflow.indexOf('function confirmPreview', createStart);
  const createBody = reviewWorkflow.slice(createStart, confirmStart);
  assert.match(createBody, /resumeImageFingerprint/);
  assert.doesNotMatch(createBody, /\n\s*resumeImage:/);
  assert.match(reviewWorkflow, /delete next\.resumeImage/);
  assert.match(reviewWorkflow, /stripEmbeddedImages/);

  const deliverStart = background.indexOf('async function runDeliver');
  const deliverEnd = background.indexOf('async function finishDeliverWithError', deliverStart);
  const deliverBody = background.slice(deliverStart, deliverEnd);
  assert.match(deliverBody, /image: plan\.resumeImageEnabled \? plan\.resumeImage : ''/);
  assert.doesNotMatch(deliverBody, /preview\.resumeImage/);
  assert.match(background, /StorageUtils\.toUserError/);
  assert.ok(sidepanelHtml.indexOf('storage-utils.js') < sidepanelHtml.indexOf('sidepanel.js'));
});

test('图片使用专属回执且未确认时不阻塞已成功的文字招呼', () => {
  const background = read('src/background.js');
  const contentChat = read('src/content-chat.js');
  const messageBundle = read('src/message-bundle.js');
  const sendImageStart = contentChat.indexOf('async function sendImage');
  const sendImageEnd = contentChat.indexOf('function inputText', sendImageStart);
  const sendImageBody = contentChat.slice(sendImageStart, sendImageEnd);

  assert.match(sendImageBody, /ImageReceipt\.capture/);
  assert.match(sendImageBody, /ImageReceipt\.findConfirmed/);
  assert.doesNotMatch(sendImageBody, /after > before/);
  assert.match(messageBundle, /step\.key === 'resumeImage' && hasText/);
  assert.match(background, /简历图片未确认，已继续下一岗位/);
  assert.doesNotMatch(background, /三段式投递成功/);
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

  assert.match(background, /openDetailWithRetry\(job, cfg, false\)/);
  assert.match(background, /READ_DETAIL_STATUS/);
  assert.match(background, /waitForDetailReady/);
  assert.match(background, /const timeouts = \[20000, 35000\]/);
  assert.match(background, /JobDetail\.mergeDetail/);
  assert.match(background, /AI 使用完整 JD 快速筛选中/);
  assert.match(contentSearch, /parseDetailPage/);
  assert.match(contentSearch, /readDetailStatus/);
  assert.match(contentSearch, /JobDetail\.canonicalizeDetailUrl/);
  assert.ok(manifest.content_scripts[0].matches.includes('*://*.zhipin.com/job_detail/*'));
  assert.ok(manifest.content_scripts[0].js.includes('src/job-detail.js'));
  assert.ok(manifest.content_scripts[0].js.includes('src/detail-readiness.js'));
});

test('预演和正式投递对发送前瞬时失败有限重试并继续后续岗位', () => {
  const background = read('src/background.js');
  const sidepanelHtml = read('src/sidepanel.html');
  const sidepanelJs = read('src/sidepanel.js');

  assert.match(background, /generateAiOpeningWithRetry/);
  assert.match(background, /ModelRetry\.MAX_ATTEMPTS/);
  assert.match(background, /岗位详情加载较慢，自动重试 1\/1/);
  assert.match(background, /当前岗位预演失败，已继续下一岗位/);
  assert.match(background, /当前岗位发送前失败，已跳过并继续/);
  assert.match(background, /BatchLifecycle\.shouldStopAfterFailure/);
  assert.match(background, /recoverInterruptedLiveBatch/);
  assert.match(background, /上次发送过程被中断，结果不明确/);
  assert.ok(
    background.indexOf("currentStep = 'send_bundle'") < background.indexOf("type: 'SEND_BUNDLE'"),
    '发送开始标记必须先于 SEND_BUNDLE'
  );
  assert.match(sidepanelHtml, /id="btnRetryPreviewFailures"/);
  assert.match(sidepanelHtml, /id="btnRetryDeliveryFailures"/);
  assert.match(sidepanelJs, /BatchLifecycle\.retryableFailedIds/);
});

test('岗位页位置事实变量不会遮蔽浏览器 location', () => {
  const contentSearch = read('src/content-search.js');
  assert.doesNotMatch(contentSearch, /const location = JobFilters\.extractLocationFacts/);
  assert.match(contentSearch, /const locationFacts = JobFilters\.extractLocationFacts/);
  assert.match(contentSearch, /JobDetail\.canonicalizeDetailUrl\(window\.location\.href\)/);
  assert.match(contentSearch, /pageUrl: window\.location\.href/);
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
  assert.ok(chatScripts.indexOf('src/image-receipt.js') < chatScripts.indexOf('src/content-chat.js'));
  assert.equal(fs.existsSync(path.join(extensionRoot, 'src/image-receipt.js')), true);
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

test('后台逐岗位持久化投递结果并保留历史与配置', () => {
  const background = read('src/background.js');

  assert.match(background, /importScripts\([^)]*batch-lifecycle\.js/);
  assert.match(background, /BatchLifecycle\.migrate/);
  assert.match(background, /BatchLifecycle\.markSucceeded/);
  assert.match(background, /BatchLifecycle\.markFailed/);
  assert.match(background, /BatchLifecycle\.markNotRun/);
  assert.match(background, /type: 'DELIVERY_STATE_UPDATED'/);
  const deliverStart = background.indexOf('async function runDeliver');
  const deliverEnd = background.indexOf('async function finishDeliverWithError', deliverStart);
  const deliverBody = background.slice(deliverStart, deliverEnd);
  assert.ok(
    deliverBody.indexOf('markDeliverySucceeded') < deliverBody.indexOf('markTrackerContacted(job)'),
    '成功状态必须先于岗位进度写入，避免重复投递'
  );

  const snapshotStart = background.indexOf('async function currentStateSnapshot');
  const snapshotEnd = background.indexOf('function handleAsyncRunError', snapshotStart);
  assert.match(background.slice(snapshotStart, snapshotEnd), /screened: state\.screened/);

  const resetStart = background.indexOf("if (message.type === 'RESET')");
  const resetEnd = background.indexOf("if (message.type === 'GET_STATE')", resetStart);
  const resetBody = background.slice(resetStart, resetEnd);
  const resetHelperStart = background.indexOf('async function resetCurrentBatch');
  const resetHelperEnd = background.indexOf('// ── 消息入口 ──', resetHelperStart);
  const resetHelper = background.slice(resetHelperStart, resetHelperEnd);
  assert.ok(resetHelperStart >= 0, '缺少可等待的当前批次清理函数');
  assert.match(resetHelper, /sw_jobs/);
  assert.match(resetHelper, /sw_screened/);
  assert.match(resetHelper, /sw_previews/);
  assert.doesNotMatch(resetHelper, /remove\([^)]*processed/);
  assert.doesNotMatch(resetHelper, /remove\([^)]*jobTrackerRecords/);
  assert.doesNotMatch(resetHelper, /remove\([^)]*greetingPlansState/);
  assert.match(resetHelper, /await chrome\.storage\.local\.remove/);
  assert.match(resetBody, /resetCurrentBatch\(\)/);
  assert.match(resetBody, /return true/);
});

test('侧边栏只操作活动岗位并提供批次完成与下一批入口', () => {
  const sidepanelHtml = read('src/sidepanel.html');
  const sidepanelJs = read('src/sidepanel.js');

  assert.ok(
    sidepanelHtml.indexOf('batch-lifecycle.js') < sidepanelHtml.indexOf('sidepanel.js'),
    '批次规则必须在侧边栏主脚本前加载'
  );
  assert.match(sidepanelHtml, /id="batchCompletion"/);
  assert.match(sidepanelHtml, /id="batchCompletionSummary"/);
  assert.match(sidepanelHtml, /id="btnContinueBatch"/);
  assert.match(sidepanelHtml, /id="btnNextBatch"/);
  assert.match(sidepanelHtml, /id="btnViewTracker"/);
  assert.match(sidepanelJs, /BatchLifecycle\.activeJobs/);
  assert.match(sidepanelJs, /DELIVERY_STATE_UPDATED/);
  assert.match(sidepanelJs, /BatchLifecycle\.summarize/);
  assert.match(sidepanelJs, /开始下一批/);
  assert.match(sidepanelJs, /type: 'RESET'/);
});

test('后台按多关键词公平轮询并在读取详情前跨搜索去重', () => {
  const background = read('src/background.js');

  assert.match(background, /importScripts\([^)]*search-strategy\.js/);
  assert.match(background, /SearchStrategy\.resolveTerms/);
  assert.match(background, /SearchStrategy\.roundTarget/);
  assert.match(background, /SearchStrategy\.mergeJobs/);
  assert.match(background, /async function collectAcrossSearchTerms/);
  assert.match(background, /buildSearchUrl\(cfg, keyword\)/);
  assert.match(background, /getSearchTab\(cfg, keyword\)/);

  const collectStart = background.indexOf('async function runCollect');
  const collectEnd = background.indexOf('function stopWithConfigError', collectStart);
  const collectBody = background.slice(collectStart, collectEnd);
  assert.match(collectBody, /collectAcrossSearchTerms\(cfg, count\)/);
  assert.ok(
    collectBody.indexOf('collectAcrossSearchTerms') < collectBody.indexOf('hydrateJobDetails'),
    '必须先完成跨关键词去重，再读取岗位详情'
  );
});

test('侧边栏可配置多关键词匹配模式和唯一岗位上限', () => {
  const sidepanelHtml = read('src/sidepanel.html');
  const sidepanelJs = read('src/sidepanel.js');

  assert.match(sidepanelHtml, /id="searchMatchMode"/);
  assert.match(sidepanelHtml, /value="precise"/);
  assert.match(sidepanelHtml, /value="balanced"/);
  assert.match(sidepanelHtml, /value="loose"/);
  assert.match(sidepanelHtml, /id="keywordExpansionEnabled"/);
  assert.match(sidepanelHtml, /id="keywordSearchSummary"/);
  assert.match(sidepanelHtml, /唯一岗位收集上限/);
  assert.ok(
    sidepanelHtml.indexOf('search-strategy.js') < sidepanelHtml.indexOf('sidepanel.js'),
    '搜索策略必须在侧边栏主脚本前加载'
  );
  assert.match(sidepanelJs, /searchMatchMode/);
  assert.match(sidepanelJs, /keywordExpansionEnabled/);
  assert.match(sidepanelJs, /SearchStrategy\.resolveTerms/);
});

test('AI 自动筛选使用短结果，六维详细评分改为按需生成', () => {
  const background = read('src/background.js');
  const sidepanelHtml = read('src/sidepanel.html');
  const sidepanelJs = read('src/sidepanel.js');

  assert.match(background, /importScripts\([^)]*match-scoring\.js/);
  assert.match(background, /MatchScoring\.validate/);
  assert.match(background, /MatchScoring\.validateQuick/);
  assert.match(background, /GENERATE_DETAILED_SCORE/);
  assert.match(background, /RETRY_QUICK_SCREENING/);
  assert.match(background, /MatchScoring\.toJobResult/);
  assert.match(background, /MatchScoring\.quickPendingResult/);
  assert.match(background, /OVERRIDE_SCORE/);
  assert.ok(
    sidepanelHtml.indexOf('match-scoring.js') < sidepanelHtml.indexOf('sidepanel.js'),
    '评分规则必须在侧边栏主脚本前加载'
  );
  assert.match(sidepanelJs, /MatchScoring\.sortJobs/);
  assert.match(sidepanelJs, /matchScore/);
  assert.match(sidepanelJs, /matchDimensions/);
  assert.match(sidepanelJs, /data-action="override-score"/);
  assert.match(sidepanelJs, /data-action="detailed-score"/);
});

test('待补充岗位可批量人工覆盖，推荐队列统一批量批准', () => {
  const background = read('src/background.js');
  const sidepanelHtml = read('src/sidepanel.html');
  const sidepanelJs = read('src/sidepanel.js');

  assert.match(background, /BATCH_CONFIRM_CANDIDATES/);
  assert.match(background, /BATCH_APPROVE/);
  assert.match(background, /ReviewWorkflow\.confirmManyCandidates/);
  assert.match(background, /ReviewWorkflow\.approveMany/);
  assert.match(sidepanelHtml, /id="bulkCandidateActions"/);
  assert.match(sidepanelHtml, /id="selectAllCandidates"/);
  assert.match(sidepanelHtml, /id="btnBulkConfirmCandidates"/);
  assert.match(sidepanelHtml, /id="bulkReviewActions"/);
  assert.match(sidepanelHtml, /id="selectAllRecommended"/);
  assert.match(sidepanelHtml, /id="btnBulkApprove"/);
  assert.match(sidepanelJs, /BATCH_CONFIRM_CANDIDATES/);
  assert.match(sidepanelJs, /BATCH_APPROVE/);
  assert.match(sidepanelJs, /ReviewWorkflow\.isManualConfirmable/);
  assert.match(sidepanelJs, /ReviewWorkflow\.isBulkApprovable/);
});

test('待确认预演支持默认全选批量确认并保留最终投递弹窗', () => {
  const background = read('src/background.js');
  const sidepanelHtml = read('src/sidepanel.html');
  const sidepanelJs = read('src/sidepanel.js');

  assert.match(background, /BATCH_CONFIRM_PREVIEWS/);
  assert.match(background, /ReviewWorkflow\.confirmManyPreviews/);
  assert.match(background, /regeneratingPreviewTasks/);
  assert.match(sidepanelHtml, /id="bulkPreviewActions"/);
  assert.match(sidepanelHtml, /id="selectAllPreviews"/);
  assert.match(sidepanelHtml, /id="btnBulkConfirmPreviews"/);
  assert.match(sidepanelJs, /BATCH_CONFIRM_PREVIEWS/);
  assert.match(sidepanelJs, /openingsByJobId/);
  assert.match(sidepanelJs, /一键确认预演/);

  const batchStart = background.indexOf('async function batchConfirmPreviews');
  const batchEnd = background.indexOf('async function updatePreviewDraft', batchStart);
  assert.ok(batchStart >= 0 && batchEnd > batchStart, '缺少独立的批量预演确认函数');
  assert.doesNotMatch(background.slice(batchStart, batchEnd), /runDeliver|START_DELIVER|SEND_BUNDLE/);

  const deliveryStart = sidepanelJs.indexOf('function startDelivery');
  const deliveryEnd = sidepanelJs.indexOf('// ── 岗位进度', deliveryStart);
  assert.match(sidepanelJs.slice(deliveryStart, deliveryEnd), /window\.confirm/);
  assert.match(sidepanelJs.slice(deliveryStart, deliveryEnd), /START_DELIVER/);
});

test('侧边栏提供可命名筛选方案、旧配置迁移和条件摘要', () => {
  const html = read('src/sidepanel.html');
  const js = read('src/sidepanel.js');

  assert.match(html, /id="searchProfileSelect"/);
  assert.match(html, /id="searchProfileName"/);
  assert.match(html, /id="newSearchProfile"/);
  assert.match(html, /id="deleteSearchProfile"/);
  assert.match(html, /id="filterConditionSummary"/);
  assert.ok(html.indexOf('search-profiles.js') < html.indexOf('sidepanel.js'));
  assert.match(js, /SearchProfiles\.normalizeState/);
  assert.match(js, /SearchProfiles\.upsertProfile/);
  assert.match(js, /searchProfilesState/);
});

test('岗位审核与投递预演使用固定窗口且只滚动列表', () => {
  const html = read('src/sidepanel.html');
  const css = read('src/sidepanel.css');

  assert.match(html, /class="card fixed-list-card" id="reviewCard"/);
  assert.match(html, /class="card fixed-list-card" id="previewCard"/);
  assert.match(html, /id="reviewList" class="fixed-list-scroll" tabindex="0"/);
  assert.match(html, /id="previewList" class="fixed-list-scroll" tabindex="0"/);
  assert.match(html, /class="sticky-action fixed-list-footer"/);
  assert.match(html, /class="fixed-list-footer preview-footer"/);
  assert.ok(html.indexOf('list-scroll-state.js') < html.indexOf('sidepanel.js'));

  assert.match(css, /\.fixed-list-card\s*\{[^}]*height:\s*clamp\(360px,\s*60vh,\s*720px\)/s);
  assert.match(css, /\.fixed-list-scroll\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.fixed-list-scroll\s*\{[^}]*overscroll-behavior:\s*contain/s);
  assert.match(css, /\.fixed-list-scroll\s*\{[^}]*scrollbar-gutter:\s*stable/s);
});

test('列表重渲染保留滚动位置且分类切换回到顶部', () => {
  const js = read('src/sidepanel.js');

  assert.match(js, /function renderScrollableList\(listId, html, reset\)/);
  assert.match(js, /ListScrollState\.target\(list, reset\)/);
  assert.match(js, /requestAnimationFrame\(\(\) => ListScrollState\.apply\(list, target\)\)/);
  assert.match(js, /function renderReview\(options\)/);
  assert.match(js, /renderScrollableList\(\s*'reviewList',[\s\S]*resetScroll/);
  assert.match(js, /renderReview\(\{ resetScroll: true \}\)/);
  assert.match(js, /renderScrollableList\(\s*'previewList',[\s\S]*false/);
});
