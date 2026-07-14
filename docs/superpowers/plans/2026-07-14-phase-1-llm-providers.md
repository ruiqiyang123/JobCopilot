# 第一阶段多模型接入实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 JobCopilot 从写死 DeepSeek 改为支持 Xiaomi MiMo、DeepSeek 和自定义 HTTPS OpenAI 兼容接口的通用模型接入层。

**架构：** 新增一个可在 Manifest V3 Service Worker 和 Node 测试中复用的 `LLMClient`，集中管理供应商预设、配置迁移、请求构造、超时和脱敏错误。`background.js` 只负责业务编排，侧边栏负责配置、按需域名授权和连接测试，现有 BOSS 自动化流程不做行为修改。

**技术栈：** Chrome Extension Manifest V3、原生 JavaScript、Chrome Storage/Permissions API、Node.js `node:test`。

---

## 文件结构

- 创建：`JobCopilot · AI/src/llm-client.js`，供应商无关的模型客户端与配置迁移纯函数。
- 创建：`JobCopilot · AI/tests/llm-client.test.js`，模型客户端单元测试。
- 创建：`JobCopilot · AI/tests/extension-integration.test.js`，Manifest、后台和侧边栏接线静态测试。
- 修改：`JobCopilot · AI/src/background.js`，接入 `LLMClient` 和 `TEST_LLM` 消息。
- 修改：`JobCopilot · AI/src/sidepanel.html`，增加模型服务商配置和测试连接 UI。
- 修改：`JobCopilot · AI/src/sidepanel.js`，增加配置迁移、表单验证、运行时域名授权和连接测试。
- 修改：`JobCopilot · AI/src/sidepanel.css`，增加模型配置状态样式。
- 修改：`JobCopilot · AI/manifest.json`，增加 MiMo 固定权限和自定义 HTTPS 可选权限。
- 修改：`README.md`，更新多模型配置与隐私说明。
- 修改：`JobCopilot · AI/README.md`，同步扩展目录文档。

### 任务 1：用测试锁定模型客户端行为

**文件：**
- 创建：`JobCopilot · AI/tests/llm-client.test.js`
- 创建：`JobCopilot · AI/src/llm-client.js`

- [ ] **步骤 1：编写失败的供应商、请求和迁移测试**

测试必须直接断言以下接口和行为：

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const LLMClient = require('../src/llm-client.js');

test('MiMo 使用官方 endpoint、api-key 和 max_completion_tokens', () => {
  const request = LLMClient.buildRequest({
    provider: 'xiaomi',
    apiKey: 'mimo-secret',
    model: 'mimo-v2.5'
  }, [{ role: 'user', content: 'hi' }], { maxTokens: 120, jsonMode: true });

  assert.equal(request.url, 'https://api.xiaomimimo.com/v1/chat/completions');
  assert.equal(request.init.headers['api-key'], 'mimo-secret');
  assert.equal(request.init.body.max_completion_tokens, 120);
  assert.deepEqual(request.init.body.response_format, { type: 'json_object' });
});

test('DeepSeek 保持 Bearer 和 max_tokens', () => {
  const request = LLMClient.buildRequest({
    provider: 'deepseek',
    apiKey: 'ds-secret',
    model: 'deepseek-chat'
  }, [{ role: 'user', content: 'hi' }], { maxTokens: 80, jsonMode: true });

  assert.equal(request.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(request.init.headers.Authorization, 'Bearer ds-secret');
  assert.equal(request.init.body.max_tokens, 80);
  assert.equal(request.init.body.response_format, undefined);
});

test('旧 dsKey 迁移到 DeepSeek，新安装默认 MiMo', () => {
  assert.deepEqual(LLMClient.migrateStoredConfig({ dsKey: 'legacy' }), {
    llmProvider: 'deepseek',
    llmApiKey: 'legacy',
    llmBaseUrl: 'https://api.deepseek.com/v1',
    llmModel: 'deepseek-chat',
    llmAuthType: 'bearer'
  });
  assert.equal(LLMClient.migrateStoredConfig({}).llmProvider, 'xiaomi');
});
```

补充覆盖：自定义 HTTPS URL 规范化、拒绝 HTTP、响应解析、401/429/5xx、超时和错误脱敏。

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
node --test 'JobCopilot · AI/tests/llm-client.test.js'
```

预期：FAIL，错误为无法找到 `../src/llm-client.js`。

- [ ] **步骤 3：实现最小 `LLMClient`**

使用全局对象兼容 Service Worker，并为 Node 导出：

```javascript
(function initLLMClient(root, factory) {
  const api = factory();
  root.LLMClient = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createLLMClient() {
  const PROVIDERS = {
    xiaomi: {
      id: 'xiaomi', name: 'Xiaomi MiMo',
      baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5',
      authType: 'api-key', tokenParameter: 'max_completion_tokens', jsonMode: true
    },
    deepseek: {
      id: 'deepseek', name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
      authType: 'bearer', tokenParameter: 'max_tokens', jsonMode: false
    }
  };

  function getProviderPreset(id) { return PROVIDERS[id] ? { ...PROVIDERS[id] } : null; }

  function normalizeConfig(config) {
    const source = config || {};
    const provider = source.provider || 'xiaomi';
    const preset = getProviderPreset(provider);
    if (!preset && provider !== 'custom') throw new Error('不支持的 AI 服务商');
    return {
      provider,
      providerName: preset ? preset.name : '自定义模型',
      apiKey: String(source.apiKey || '').trim(),
      baseUrl: String(source.baseUrl || (preset && preset.baseUrl) || '').trim(),
      model: String(source.model || (preset && preset.model) || '').trim(),
      authType: preset ? preset.authType : (source.authType || 'bearer'),
      tokenParameter: preset ? preset.tokenParameter : 'max_tokens',
      jsonMode: Boolean(preset && preset.jsonMode)
    };
  }

  function validateConfig(config) {
    const normalized = normalizeConfig(config);
    if (!normalized.apiKey) throw new Error('请填写 API Key');
    if (!normalized.baseUrl) throw new Error('请填写 API 地址');
    if (!normalized.model) throw new Error('请填写模型名称');
    if (!['bearer', 'api-key'].includes(normalized.authType)) throw new Error('不支持的鉴权方式');
    let url;
    try { url = new URL(normalized.baseUrl); } catch (error) { throw new Error('API 地址格式不正确'); }
    if (url.protocol !== 'https:') throw new Error('API 地址必须使用 HTTPS');
    return normalized;
  }

  function getChatEndpoint(baseUrl) {
    const trimmed = String(baseUrl || '').replace(/\/+$/, '');
    return trimmed.endsWith('/chat/completions') ? trimmed : trimmed + '/chat/completions';
  }

  function buildRequest(config, messages, options) {
    const normalized = validateConfig(config);
    const settings = options || {};
    const headers = { 'Content-Type': 'application/json' };
    if (normalized.authType === 'api-key') headers['api-key'] = normalized.apiKey;
    else headers.Authorization = 'Bearer ' + normalized.apiKey;
    const body = {
      model: normalized.model,
      messages,
      temperature: Number.isFinite(settings.temperature) ? settings.temperature : 0.5
    };
    body[normalized.tokenParameter] = settings.maxTokens || 500;
    if (settings.jsonMode && normalized.jsonMode) body.response_format = { type: 'json_object' };
    return { url: getChatEndpoint(normalized.baseUrl), init: { method: 'POST', headers, body } };
  }

  function migrateStoredConfig(stored) {
    const source = stored || {};
    if (source.llmProvider) return {};
    const preset = source.dsKey ? PROVIDERS.deepseek : PROVIDERS.xiaomi;
    return {
      llmProvider: preset.id,
      llmApiKey: source.dsKey || '',
      llmBaseUrl: preset.baseUrl,
      llmModel: preset.model,
      llmAuthType: preset.authType
    };
  }

  function redact(text, apiKey) {
    const value = String(text || '');
    return apiKey ? value.split(apiKey).join('***') : value;
  }

  async function call(config, messages, options) {
    const settings = options || {};
    const normalized = validateConfig(config);
    const request = buildRequest(normalized, messages, settings);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs || 30000);
    const fetchImpl = settings.fetchImpl || globalThis.fetch;
    try {
      const response = await fetchImpl(request.url, {
        ...request.init,
        body: JSON.stringify(request.init.body),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error('API Key 或接口权限错误');
        if (response.status === 429) throw new Error('模型请求受限或额度不足');
        if (response.status >= 500) throw new Error('模型服务暂时不可用');
        throw new Error('模型请求失败（HTTP ' + response.status + '）：' + redact(text.slice(0, 200), normalized.apiKey));
      }
      let data;
      try { data = JSON.parse(text); } catch (error) { throw new Error('模型返回了无法解析的数据'); }
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (typeof content !== 'string') throw new Error('模型响应缺少文本内容');
      return content;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('模型请求超时');
      throw new Error(redact(error && error.message ? error.message : '模型连接失败', normalized.apiKey));
    } finally {
      clearTimeout(timer);
    }
  }

  return { getProviderPreset, normalizeConfig, validateConfig, getChatEndpoint, buildRequest, migrateStoredConfig, call };
});
```

`buildRequest` 返回的 `init.body` 保持为对象以便测试；`call` 在 `fetch` 前将其 `JSON.stringify`。错误体最多读取 200 字符，并用当前 API Key 替换为 `***`。

- [ ] **步骤 4：运行模型客户端测试确认通过**

运行：

```bash
node --test 'JobCopilot · AI/tests/llm-client.test.js'
```

预期：全部 PASS，无真实网络请求。

- [ ] **步骤 5：提交模型客户端**

```bash
git add 'JobCopilot · AI/src/llm-client.js' 'JobCopilot · AI/tests/llm-client.test.js'
git commit -m 'add configurable LLM client'
```

### 任务 2：把后台业务迁移到通用客户端

**文件：**
- 创建：`JobCopilot · AI/tests/extension-integration.test.js`
- 修改：`JobCopilot · AI/src/background.js`

- [ ] **步骤 1：编写失败的后台接线测试**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');

test('后台加载通用客户端并移除 DeepSeek 专属调用', () => {
  assert.match(background, /llm-client\.js/);
  assert.match(background, /LLMClient\.call/);
  assert.match(background, /TEST_LLM/);
  assert.doesNotMatch(background, /callDS|DS_ENDPOINT|DS_MODEL/);
});
```

- [ ] **步骤 2：运行后台接线测试确认失败**

运行：

```bash
node --test 'JobCopilot · AI/tests/extension-integration.test.js'
```

预期：FAIL，后台仍包含 `callDS` 且没有 `TEST_LLM`。

- [ ] **步骤 3：实现配置迁移与 `callLLM`**

后台需要采用以下稳定接口：

```javascript
importScripts('/src/selectors.js', '/src/llm-client.js');

const CFG_KEYS = [
  'llmProvider', 'llmApiKey', 'llmBaseUrl', 'llmModel', 'llmAuthType', 'dsKey',
  'resumeText', 'resumeImage', 'city', 'keyword', 'count'
];

async function getCfg() {
  const stored = await chrome.storage.local.get(CFG_KEYS);
  const migrated = LLMClient.migrateStoredConfig(stored);
  if (Object.keys(migrated).length) await chrome.storage.local.set(migrated);
  return Object.assign({}, stored, migrated);
}

function llmConfigFrom(cfg) {
  return {
    provider: cfg.llmProvider,
    apiKey: cfg.llmApiKey,
    baseUrl: cfg.llmBaseUrl,
    model: cfg.llmModel,
    authType: cfg.llmAuthType
  };
}

async function callLLM(cfg, messages, options) {
  return LLMClient.call(llmConfigFrom(cfg), messages, options);
}
```

`screenJob` 传入 `{ maxTokens: 200, temperature: 0.5, jsonMode: true }`；招呼语传入 `{ maxTokens: 300, temperature: 0.5 }`。`runCollect` 检查 `llmApiKey` 并显示当前供应商名称。

- [ ] **步骤 4：增加无 BOSS 副作用的测试连接消息**

```javascript
async function testLLMConnection(config) {
  const startedAt = Date.now();
  await LLMClient.call(config, [
    { role: 'user', content: '连接测试：请只回复 OK' }
  ], { maxTokens: 16, temperature: 0 });
  const normalized = LLMClient.normalizeConfig(config);
  return { provider: normalized.providerName, model: normalized.model, elapsedMs: Date.now() - startedAt };
}
```

在消息监听器中异步处理 `TEST_LLM`，调用 `sendResponse` 并返回 `true`；该路径不得调用 `ensureTab`、`runCollect` 或 `runDeliver`。

- [ ] **步骤 5：运行测试和语法检查**

```bash
node --test 'JobCopilot · AI/tests/extension-integration.test.js'
node --check 'JobCopilot · AI/src/background.js'
```

预期：PASS。

- [ ] **步骤 6：提交后台接入**

```bash
git add 'JobCopilot · AI/src/background.js' 'JobCopilot · AI/tests/extension-integration.test.js'
git commit -m 'route background AI calls through provider client'
```

### 任务 3：实现侧边栏模型配置和运行时授权

**文件：**
- 修改：`JobCopilot · AI/src/sidepanel.html`
- 修改：`JobCopilot · AI/src/sidepanel.js`
- 修改：`JobCopilot · AI/src/sidepanel.css`
- 修改：`JobCopilot · AI/tests/extension-integration.test.js`

- [ ] **步骤 1：扩展失败的侧边栏接线测试**

测试读取 HTML 与 JS 并断言：

```javascript
test('侧边栏提供模型配置和测试连接', () => {
  assert.match(sidepanelHtml, /id="llmProvider"/);
  assert.match(sidepanelHtml, /id="llmApiKey"/);
  assert.match(sidepanelHtml, /id="llmBaseUrl"/);
  assert.match(sidepanelHtml, /id="llmModel"/);
  assert.match(sidepanelHtml, /id="testLlm"/);
  assert.ok(sidepanelHtml.indexOf('llm-client.js') < sidepanelHtml.indexOf('sidepanel.js'));
  assert.match(sidepanelJs, /chrome\.permissions\.request/);
  assert.match(sidepanelJs, /TEST_LLM/);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
node --test 'JobCopilot · AI/tests/extension-integration.test.js'
```

预期：FAIL，缺少模型字段和测试连接。

- [ ] **步骤 3：更新侧边栏 HTML 与样式**

配置区使用以下字段：

```html
<label>AI 服务商</label>
<select id="llmProvider">
  <option value="xiaomi">Xiaomi MiMo</option>
  <option value="deepseek">DeepSeek</option>
  <option value="custom">自定义 OpenAI 兼容接口</option>
</select>
<label>API Key</label>
<input type="password" id="llmApiKey" autocomplete="off">
<label>API 地址</label>
<input type="text" id="llmBaseUrl">
<label>模型名称</label>
<input type="text" id="llmModel">
<div id="llmAuthRow">
  <label>鉴权方式</label>
  <select id="llmAuthType"><option value="bearer">Bearer</option><option value="api-key">api-key</option></select>
</div>
<button type="button" class="btn-secondary" id="testLlm">测试连接</button>
<span id="llmTestStatus" class="test-status" aria-live="polite"></span>
```

在 `sidepanel.js` 前加载 `llm-client.js`。增加禁用、测试中、成功和失败状态样式。

- [ ] **步骤 4：实现配置表单、迁移和权限申请**

侧边栏必须实现：

```javascript
function readLLMForm() {
  return {
    provider: $('llmProvider').value,
    apiKey: $('llmApiKey').value.trim(),
    baseUrl: $('llmBaseUrl').value.trim(),
    model: $('llmModel').value.trim(),
    authType: $('llmAuthType').value
  };
}

async function ensureCustomHostPermission(config) {
  if (config.provider !== 'custom') return true;
  LLMClient.validateConfig(config);
  const origin = new URL(config.baseUrl).origin + '/*';
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}
```

加载时使用 `migrateStoredConfig`；切换内置供应商时填入预设并锁定 API 地址，切换自定义时允许编辑地址和鉴权方式。保存、测试和开始收集都先验证当前表单；错误通过 `addLog` 或 `llmTestStatus` 展示，不显示 Key。

- [ ] **步骤 5：实现测试连接交互**

测试按钮流程：读取表单 → 验证 → 按需授权 → 发送 `TEST_LLM` → 显示服务商、模型和耗时。按钮请求期间禁用，结束后恢复。

- [ ] **步骤 6：运行接线测试与语法检查**

```bash
node --test 'JobCopilot · AI/tests/extension-integration.test.js'
node --check 'JobCopilot · AI/src/sidepanel.js'
```

预期：PASS。

- [ ] **步骤 7：提交侧边栏功能**

```bash
git add 'JobCopilot · AI/src/sidepanel.html' 'JobCopilot · AI/src/sidepanel.js' 'JobCopilot · AI/src/sidepanel.css' 'JobCopilot · AI/tests/extension-integration.test.js'
git commit -m 'add provider settings and connection test'
```

### 任务 4：收紧 Manifest 权限并验证配置

**文件：**
- 修改：`JobCopilot · AI/manifest.json`
- 修改：`JobCopilot · AI/tests/extension-integration.test.js`

- [ ] **步骤 1：编写失败的权限测试**

```javascript
test('Manifest 固定授权 MiMo，并把其他 HTTPS 域名设为可选', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.ok(manifest.host_permissions.includes('https://api.xiaomimimo.com/*'));
  assert.ok(manifest.host_permissions.includes('https://api.deepseek.com/*'));
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
  assert.ok(!manifest.host_permissions.includes('<all_urls>'));
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
node --test 'JobCopilot · AI/tests/extension-integration.test.js'
```

预期：FAIL，Manifest 尚未声明 MiMo 和可选权限。

- [ ] **步骤 3：修改 Manifest**

固定权限：

```json
"host_permissions": [
  "*://*.zhipin.com/*",
  "https://api.deepseek.com/*",
  "https://api.xiaomimimo.com/*"
],
"optional_host_permissions": ["https://*/*"]
```

- [ ] **步骤 4：运行测试和 JSON 解析检查**

```bash
node --test 'JobCopilot · AI/tests/extension-integration.test.js'
node -e "JSON.parse(require('node:fs').readFileSync('JobCopilot · AI/manifest.json', 'utf8')); console.log('manifest ok')"
```

预期：测试 PASS，并输出 `manifest ok`。

- [ ] **步骤 5：提交权限变更**

```bash
git add 'JobCopilot · AI/manifest.json' 'JobCopilot · AI/tests/extension-integration.test.js'
git commit -m 'allow MiMo and optional custom model hosts'
```

### 任务 5：更新文档并完成全量验证

**文件：**
- 修改：`README.md`
- 修改：`JobCopilot · AI/README.md`

- [ ] **步骤 1：更新两份 README**

文档明确写出：

- 支持 Xiaomi MiMo、DeepSeek 和自定义 HTTPS OpenAI 兼容接口。
- MiMo 默认模型 `mimo-v2.5`，Base URL 为 `https://api.xiaomimimo.com/v1`。
- API Key 从插件侧边栏填写，只保存在浏览器本地扩展存储，不写入代码。
- 岗位筛选和招呼语生成会将简历文字发送给用户选择的模型供应商。
- 加载解压缩扩展时应选择包含 `manifest.json` 的 `JobCopilot · AI` 目录。
- 当前 fork 克隆地址使用 `https://github.com/ruiqiyang123/JobCopilot.git`。

- [ ] **步骤 2：运行全量自动测试**

```bash
node --test 'JobCopilot · AI/tests/llm-client.test.js' 'JobCopilot · AI/tests/extension-integration.test.js'
```

预期：全部 PASS，不发起真实网络请求。

- [ ] **步骤 3：运行全量静态检查**

```bash
node --check 'JobCopilot · AI/src/llm-client.js'
node --check 'JobCopilot · AI/src/background.js'
node --check 'JobCopilot · AI/src/sidepanel.js'
git diff --check
rg -n 'callDS|DS_ENDPOINT|DS_MODEL|请先填 DeepSeek API Key|AI 筛选中（DeepSeek）' 'JobCopilot · AI/src'
```

预期：前三条无输出且退出 0；`git diff --check` 无输出；最后一条无匹配且退出 1。

- [ ] **步骤 4：检查变更范围和敏感信息**

```bash
git status -sb
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- 'JobCopilot · AI/src' 'JobCopilot · AI/manifest.json' README.md 'JobCopilot · AI/README.md'
rg -n 'sk-[A-Za-z0-9_-]{8,}|tp-[A-Za-z0-9_-]{8,}' . --glob '!docs/superpowers/**'
```

预期：只有第一阶段文件；密钥搜索无匹配。

- [ ] **步骤 5：提交文档**

```bash
git add README.md 'JobCopilot · AI/README.md'
git commit -m 'document configurable AI providers'
```

- [ ] **步骤 6：推送并创建 Draft PR**

```bash
git push -u origin agent/phase-1-llm-providers
gh pr create --draft --base main --head agent/phase-1-llm-providers --title 'Add Xiaomi MiMo and configurable LLM providers' --body 'Adds Xiaomi MiMo, preserves DeepSeek, and supports user-authorized custom HTTPS OpenAI-compatible endpoints. Includes configuration migration, connection testing, unit tests, static checks, and documentation. No real BOSS delivery was performed.'
```

PR 正文必须总结模型适配、权限策略、迁移行为、测试结果，以及“未进行任何真实 BOSS 投递”。未经用户确认，不把 Draft PR 标记为 Ready，也不合并。
