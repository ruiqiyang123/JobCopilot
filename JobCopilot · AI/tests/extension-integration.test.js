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
  assert.ok(sidepanelHtml.indexOf('llm-client.js') < sidepanelHtml.indexOf('sidepanel.js'));

  assert.match(sidepanelJs, /LLMClient\.migrateStoredConfig/);
  assert.match(sidepanelJs, /chrome\.permissions\.request/);
  assert.match(sidepanelJs, /chrome\.permissions\.contains/);
  assert.match(sidepanelJs, /TEST_LLM/);
  assert.doesNotMatch(sidepanelJs, /const CFG_FIELDS = \['dsKey'/);
});
