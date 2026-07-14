const test = require('node:test');
const assert = require('node:assert/strict');

const LLMClient = require('../src/llm-client.js');

const MESSAGES = [{ role: 'user', content: '你好' }];

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body)
  };
}

test('MiMo 使用官方 endpoint、api-key、max_completion_tokens 和 JSON 模式', () => {
  const request = LLMClient.buildRequest({
    provider: 'xiaomi',
    apiKey: 'mimo-secret',
    model: 'mimo-v2.5'
  }, MESSAGES, { maxTokens: 120, temperature: 0, jsonMode: true });

  assert.equal(request.url, 'https://api.xiaomimimo.com/v1/chat/completions');
  assert.equal(request.init.headers['api-key'], 'mimo-secret');
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(request.init.body.max_completion_tokens, 120);
  assert.equal(request.init.body.max_tokens, undefined);
  assert.equal(request.init.body.temperature, 0);
  assert.deepEqual(request.init.body.response_format, { type: 'json_object' });
});

test('DeepSeek 保持 Bearer 和 max_tokens 且不强开 JSON 模式', () => {
  const request = LLMClient.buildRequest({
    provider: 'deepseek',
    apiKey: 'ds-secret',
    model: 'deepseek-chat'
  }, MESSAGES, { maxTokens: 80, jsonMode: true });

  assert.equal(request.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(request.init.headers.Authorization, 'Bearer ds-secret');
  assert.equal(request.init.headers['api-key'], undefined);
  assert.equal(request.init.body.max_tokens, 80);
  assert.equal(request.init.body.max_completion_tokens, undefined);
  assert.equal(request.init.body.response_format, undefined);
});

test('LongCat 使用官方 endpoint、Bearer 和 max_tokens', () => {
  const preset = LLMClient.getProviderPreset('longcat');
  const request = LLMClient.buildRequest({
    provider: 'longcat',
    apiKey: 'longcat-test-key'
  }, MESSAGES, { maxTokens: 16, temperature: 0, jsonMode: true });

  assert.deepEqual(preset, {
    id: 'longcat',
    name: 'LongCat',
    baseUrl: 'https://api.longcat.chat/openai/v1',
    model: 'LongCat-2.0',
    authType: 'bearer',
    tokenParameter: 'max_tokens',
    jsonMode: false,
    thinking: 'disabled'
  });
  assert.equal(request.url, 'https://api.longcat.chat/openai/v1/chat/completions');
  assert.equal(request.init.headers.Authorization, 'Bearer longcat-test-key');
  assert.equal(request.init.headers['api-key'], undefined);
  assert.equal(request.init.body.model, 'LongCat-2.0');
  assert.equal(request.init.body.max_tokens, 16);
  assert.equal(request.init.body.response_format, undefined);
  assert.deepEqual(request.init.body.thinking, { type: 'disabled' });
});

test('自定义接口接受根地址或完整 chat completions 地址', () => {
  const rootRequest = LLMClient.buildRequest({
    provider: 'custom',
    apiKey: 'custom-secret',
    baseUrl: 'https://models.example.com/v1/',
    model: 'small-model',
    authType: 'bearer'
  }, MESSAGES);
  const fullRequest = LLMClient.buildRequest({
    provider: 'custom',
    apiKey: 'custom-secret',
    baseUrl: 'https://models.example.com/v1/chat/completions',
    model: 'small-model',
    authType: 'api-key'
  }, MESSAGES);

  assert.equal(rootRequest.url, 'https://models.example.com/v1/chat/completions');
  assert.equal(rootRequest.init.headers.Authorization, 'Bearer custom-secret');
  assert.equal(fullRequest.url, 'https://models.example.com/v1/chat/completions');
  assert.equal(fullRequest.init.headers['api-key'], 'custom-secret');
});

test('自定义接口拒绝 HTTP、缺失模型和未知鉴权方式', () => {
  assert.throws(() => LLMClient.validateConfig({
    provider: 'custom', apiKey: 'key', baseUrl: 'http://models.example.com/v1', model: 'm', authType: 'bearer'
  }), /必须使用 HTTPS/);
  assert.throws(() => LLMClient.validateConfig({
    provider: 'custom', apiKey: 'key', baseUrl: 'https://models.example.com/v1', model: '', authType: 'bearer'
  }), /模型名称/);
  assert.throws(() => LLMClient.validateConfig({
    provider: 'custom', apiKey: 'key', baseUrl: 'https://models.example.com/v1', model: 'm', authType: 'query'
  }), /鉴权方式/);
});

test('旧 dsKey 迁移到 DeepSeek，新安装默认 MiMo，已有新配置不改写', () => {
  assert.deepEqual(LLMClient.migrateStoredConfig({ dsKey: 'legacy' }), {
    llmProvider: 'deepseek',
    llmApiKey: 'legacy',
    llmBaseUrl: 'https://api.deepseek.com/v1',
    llmModel: 'deepseek-chat',
    llmAuthType: 'bearer'
  });
  assert.deepEqual(LLMClient.migrateStoredConfig({}), {
    llmProvider: 'xiaomi',
    llmApiKey: '',
    llmBaseUrl: 'https://api.xiaomimimo.com/v1',
    llmModel: 'mimo-v2.5',
    llmAuthType: 'api-key'
  });
  assert.deepEqual(LLMClient.migrateStoredConfig({ llmProvider: 'custom', dsKey: 'legacy' }), {});
});

test('call 序列化请求并返回 choices 文本', async () => {
  let captured;
  const content = await LLMClient.call({
    provider: 'xiaomi', apiKey: 'mimo-secret', model: 'mimo-v2.5'
  }, MESSAGES, {
    maxTokens: 16,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return response(200, { choices: [{ message: { content: 'OK' } }] });
    }
  });

  assert.equal(content, 'OK');
  assert.equal(captured.url, 'https://api.xiaomimimo.com/v1/chat/completions');
  assert.equal(JSON.parse(captured.init.body).model, 'mimo-v2.5');
  assert.ok(captured.init.signal);
});

test('call 将常见 HTTP 状态映射为可操作错误', async () => {
  const config = { provider: 'xiaomi', apiKey: 'mimo-secret', model: 'mimo-v2.5' };
  await assert.rejects(LLMClient.call(config, MESSAGES, {
    fetchImpl: async () => response(401, 'unauthorized')
  }), /API Key 或接口权限错误/);
  await assert.rejects(LLMClient.call(config, MESSAGES, {
    fetchImpl: async () => response(429, 'rate limited')
  }), /请求受限或额度不足/);
  await assert.rejects(LLMClient.call(config, MESSAGES, {
    fetchImpl: async () => response(503, 'down')
  }), /模型服务暂时不可用/);
});

test('call 的错误信息会脱敏 API Key', async () => {
  const secret = 'mimo-super-secret';
  await assert.rejects(LLMClient.call({
    provider: 'xiaomi', apiKey: secret, model: 'mimo-v2.5'
  }, MESSAGES, {
    fetchImpl: async () => response(400, 'bad request for ' + secret)
  }), (error) => {
    assert.match(error.message, /\*\*\*/);
    assert.doesNotMatch(error.message, new RegExp(secret));
    return true;
  });
});

test('call 拒绝非 JSON 和缺少文本内容的成功响应', async () => {
  const config = { provider: 'xiaomi', apiKey: 'key', model: 'mimo-v2.5' };
  await assert.rejects(LLMClient.call(config, MESSAGES, {
    fetchImpl: async () => response(200, 'not json')
  }), /无法解析/);
  await assert.rejects(LLMClient.call(config, MESSAGES, {
    fetchImpl: async () => response(200, { choices: [] })
  }), /缺少文本内容/);
});

test('call 在超时后中止请求', async () => {
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

  await assert.rejects(LLMClient.call({
    provider: 'xiaomi', apiKey: 'key', model: 'mimo-v2.5'
  }, MESSAGES, { fetchImpl, timeoutMs: 5 }), /模型请求超时/);
});
