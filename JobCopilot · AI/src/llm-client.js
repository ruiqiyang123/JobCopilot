(function initLLMClient(root, factory) {
  const api = factory();
  root.LLMClient = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createLLMClient() {
  'use strict';

  const PROVIDERS = Object.freeze({
    xiaomi: Object.freeze({
      id: 'xiaomi',
      name: 'Xiaomi MiMo',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2.5',
      authType: 'api-key',
      tokenParameter: 'max_completion_tokens',
      jsonMode: true
    }),
    deepseek: Object.freeze({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      authType: 'bearer',
      tokenParameter: 'max_tokens',
      jsonMode: false
    }),
    longcat: Object.freeze({
      id: 'longcat',
      name: 'LongCat',
      baseUrl: 'https://api.longcat.chat/openai/v1',
      model: 'LongCat-2.0',
      authType: 'bearer',
      tokenParameter: 'max_tokens',
      jsonMode: false,
      thinking: 'disabled'
    })
  });

  function getProviderPreset(id) {
    return PROVIDERS[id] ? Object.assign({}, PROVIDERS[id]) : null;
  }

  function normalizeConfig(config) {
    const source = config || {};
    const provider = source.provider || 'xiaomi';
    const preset = getProviderPreset(provider);
    if (!preset && provider !== 'custom') throw new Error('不支持的 AI 服务商');

    return {
      provider: provider,
      providerName: preset ? preset.name : '自定义模型',
      apiKey: String(source.apiKey || '').trim(),
      baseUrl: String(source.baseUrl || (preset && preset.baseUrl) || '').trim(),
      model: String(source.model || (preset && preset.model) || '').trim(),
      authType: preset ? preset.authType : (source.authType || 'bearer'),
      tokenParameter: preset ? preset.tokenParameter : 'max_tokens',
      jsonMode: Boolean(preset && preset.jsonMode),
      thinking: preset && preset.thinking ? preset.thinking : ''
    };
  }

  function validateConfig(config) {
    const normalized = normalizeConfig(config);
    if (!normalized.apiKey) throw new Error('请填写 API Key');
    if (!normalized.baseUrl) throw new Error('请填写 API 地址');
    if (!normalized.model) throw new Error('请填写模型名称');
    if (normalized.authType !== 'bearer' && normalized.authType !== 'api-key') {
      throw new Error('不支持的鉴权方式');
    }

    let url;
    try {
      url = new URL(normalized.baseUrl);
    } catch (error) {
      throw new Error('API 地址格式不正确');
    }
    if (url.protocol !== 'https:') throw new Error('API 地址必须使用 HTTPS');
    return normalized;
  }

  function getChatEndpoint(baseUrl) {
    const url = new URL(String(baseUrl || '').trim());
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/chat/completions') ? path : path + '/chat/completions';
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  function buildRequest(config, messages, options) {
    const normalized = validateConfig(config);
    const settings = options || {};
    if (!Array.isArray(messages) || !messages.length) throw new Error('模型消息不能为空');

    const headers = { 'Content-Type': 'application/json' };
    if (normalized.authType === 'api-key') headers['api-key'] = normalized.apiKey;
    else headers.Authorization = 'Bearer ' + normalized.apiKey;

    const body = {
      model: normalized.model,
      messages: messages,
      temperature: Number.isFinite(settings.temperature) ? settings.temperature : 0.5
    };
    body[normalized.tokenParameter] = Number.isFinite(settings.maxTokens) && settings.maxTokens > 0
      ? settings.maxTokens
      : 500;
    if (settings.jsonMode && normalized.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    if (normalized.thinking) body.thinking = { type: normalized.thinking };

    return {
      url: getChatEndpoint(normalized.baseUrl),
      init: { method: 'POST', headers: headers, body: body }
    };
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

  function httpError(status, responseText, apiKey) {
    if (status === 401 || status === 403) return new Error('API Key 或接口权限错误');
    if (status === 429) return new Error('模型请求受限或额度不足');
    if (status >= 500) return new Error('模型服务暂时不可用');
    const detail = redact(String(responseText || '').slice(0, 200), apiKey);
    return new Error('模型请求失败（HTTP ' + status + '）' + (detail ? '：' + detail : ''));
  }

  async function call(config, messages, options) {
    const settings = options || {};
    const normalized = validateConfig(config);
    const request = buildRequest(normalized, messages, settings);
    const fetchImpl = settings.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持网络请求');

    const controller = new AbortController();
    const timeoutMs = Number.isFinite(settings.timeoutMs) && settings.timeoutMs > 0
      ? settings.timeoutMs
      : 30000;
    const timer = setTimeout(function abortRequest() { controller.abort(); }, timeoutMs);

    try {
      const response = await fetchImpl(request.url, {
        method: request.init.method,
        headers: request.init.headers,
        body: JSON.stringify(request.init.body),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw httpError(response.status, text, normalized.apiKey);

      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error('模型返回了无法解析的数据');
      }
      const content = data && data.choices && data.choices[0]
        && data.choices[0].message && data.choices[0].message.content;
      if (typeof content !== 'string') throw new Error('模型响应缺少文本内容');
      return content;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('模型请求超时');
      const message = error && error.message ? error.message : '模型连接失败';
      throw new Error(redact(message, normalized.apiKey));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    getProviderPreset: getProviderPreset,
    normalizeConfig: normalizeConfig,
    validateConfig: validateConfig,
    getChatEndpoint: getChatEndpoint,
    buildRequest: buildRequest,
    migrateStoredConfig: migrateStoredConfig,
    call: call
  };
});
