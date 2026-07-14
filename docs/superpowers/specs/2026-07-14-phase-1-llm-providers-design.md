# 第一阶段：通用模型接入与 Xiaomi MiMo 支持

日期：2026-07-14
状态：已由用户批准，待规格文件复核

## 背景

JobCopilot 当前在 `background.js` 中写死 DeepSeek 的 API 地址、模型名、鉴权方式和配置字段。侧边栏同样只提供 `dsKey` 输入框。这导致模型无法切换，也使岗位筛选和招呼语生成与单一供应商耦合。

第一阶段只解决模型接入问题。它不修改 BOSS 搜索、岗位硬筛选、自动投递校验或求职进度管理。这些能力分别留在后续阶段完成。

## 目标

1. 新安装默认支持 Xiaomi MiMo，默认模型为 `mimo-v2.5`。
2. 保留 DeepSeek，已有 `dsKey` 用户可以无损迁移。
3. 支持自定义 HTTPS OpenAI Chat Completions 兼容接口。
4. 为模型配置增加独立的“测试连接”能力，测试不访问 BOSS、不发送简历或招呼语。
5. 岗位筛选和招呼语生成统一调用供应商无关的 `callLLM` 接口。
6. API Key 不进入源码、Git 提交、普通日志或错误信息。

## 非目标

- 不增加工作经验、公司规模或行业筛选。
- 不修改岗位收集或自动投递流程。
- 不修复投递对象二次校验问题。
- 不增加模拟投递、失败即停或每日数量限制。
- 不实现求职状态看板。
- 不支持 Anthropic Messages 等非 OpenAI Chat Completions 协议。
- 不支持任意 HTTP 地址；自定义远程服务仅允许 HTTPS。

## 方案比较

### 方案 A：直接把 DeepSeek 替换成 MiMo

修改量最小，但未来再次换模型仍需改代码，并会破坏 DeepSeek 兼容性。不采用。

### 方案 B：内置 MiMo 与 DeepSeek，共享通用客户端

改动可控，权限清晰，也能满足当前需求。但不能真正支持用户自定义其他模型。

### 方案 C：通用客户端 + 两个内置供应商 + 受限自定义接口

在方案 B 上增加自定义 HTTPS OpenAI 兼容接口。自定义域名仅在用户点击保存或测试时请求对应主机权限，不授予永久全站访问权限。

采用方案 C。它满足当前 MiMo 需求，同时保留后续扩展能力，并避免通过 `host_permissions` 永久申请所有网站权限。

## 架构

### `src/llm-client.js`

新增纯模型客户端，职责为：

- 定义内置供应商元数据。
- 规范化 Base URL 和 `/chat/completions` 路径。
- 根据供应商生成请求头和 Token 参数。
- 发起带超时的 `fetch` 请求。
- 解析 `choices[0].message.content`。
- 将 HTTP、网络、超时和响应结构错误转换为不泄露密钥的中文错误。

公开接口：

```javascript
LLMClient.getProviderPreset(providerId)
LLMClient.normalizeConfig(config)
LLMClient.validateConfig(config)
LLMClient.call(config, messages, options)
```

脚本需要同时满足两种运行方式：

- 通过 `importScripts('/src/llm-client.js')` 在 Manifest V3 Service Worker 中运行。
- 通过 Node 测试环境导出纯函数，便于在不启动 Chrome 的情况下验证请求构造。

### `src/background.js`

- 在 `selectors.js` 之后加载 `llm-client.js`。
- 将 `callDS` 替换为 `callLLM`。
- `screenJob` 与 `genGreetingFromJD` 继续保留现有提示词和业务行为。
- 筛选时对支持 JSON 模式的供应商传入 `response_format: {"type":"json_object"}`。
- 日志从“DeepSeek”改为当前供应商显示名称或中性的“AI”。
- 增加 `TEST_LLM` 消息处理器，接收侧边栏当前配置并发起最小测试请求。

### 侧边栏

配置区增加：

- AI 服务商：Xiaomi MiMo、DeepSeek、自定义。
- API Key。
- API 地址。
- 模型名称。
- 鉴权方式：Bearer 或 `api-key`；仅在自定义模式显示。
- “测试连接”按钮和结果区域。

内置供应商的 API 地址和鉴权方式由预设管理，界面只读；自定义模式可编辑。测试使用当前表单值，不触发 BOSS 页面操作，也不自动开始岗位收集。

## 供应商预设

### Xiaomi MiMo

```text
provider: xiaomi
baseUrl: https://api.xiaomimimo.com/v1
model: mimo-v2.5
authType: api-key
tokenParameter: max_completion_tokens
jsonMode: true
```

请求头：

```text
Content-Type: application/json
api-key: <用户密钥>
```

### DeepSeek

```text
provider: deepseek
baseUrl: https://api.deepseek.com/v1
model: deepseek-chat
authType: bearer
tokenParameter: max_tokens
jsonMode: false
```

请求头：

```text
Content-Type: application/json
Authorization: Bearer <用户密钥>
```

第一阶段不改变 DeepSeek 已有请求语义，避免引入兼容性回归。

### 自定义

- 仅接受 `https://` Base URL。
- Base URL 可以是 `/v1` 根地址或完整 `/chat/completions` 地址，客户端负责规范化。
- 用户必须填写模型名。
- 鉴权方式只能选择 Bearer 或 `api-key`。
- 默认不启用 JSON 模式，以兼容能力未知的第三方服务。

## 配置与迁移

新配置字段：

```text
llmProvider
llmApiKey
llmBaseUrl
llmModel
llmAuthType
```

迁移规则：

1. 已存在 `llmProvider` 时不做迁移。
2. 不存在 `llmProvider`、但存在 `dsKey` 时，设置为 DeepSeek 并复制密钥到 `llmApiKey`。
3. 两者都不存在时，设置为 Xiaomi MiMo，并写入 MiMo 默认地址、模型和鉴权方式。
4. 第一阶段保留旧 `dsKey`，不主动删除，以便回滚；运行时只读取新字段。
5. 简历、城市、关键词、数量和已处理岗位记录保持不变。

## 浏览器权限

`manifest.json` 保留现有 BOSS 与 DeepSeek 权限，并增加：

```json
"https://api.xiaomimimo.com/*"
```

自定义服务使用 `optional_host_permissions` 声明 HTTPS 可选权限。保存或测试自定义地址时，从 URL 提取 origin，并通过 `chrome.permissions.request` 只请求该 origin。用户拒绝时不保存为可运行配置，并显示明确提示。

## 数据流

### 保存配置

1. 用户选择服务商。
2. 侧边栏应用预设或显示自定义字段。
3. 侧边栏验证必填项和 HTTPS URL。
4. 自定义地址按需申请主机权限。
5. 配置写入 `chrome.storage.local`。

### 测试连接

1. 用户点击“测试连接”。
2. 侧边栏验证当前表单，不需要先保存。
3. 自定义地址按需申请主机权限。
4. 侧边栏发送 `TEST_LLM` 消息。
5. Service Worker 使用 `callLLM` 发送最小请求，要求模型只回复 `OK`。
6. 界面显示服务商、模型、成功或脱敏错误；不显示 API Key 或完整原始响应。

### 岗位筛选与招呼语

1. 原有业务读取统一模型配置。
2. `screenJob` 或 `genGreetingFromJD` 构造原有消息。
3. `callLLM` 根据供应商构造请求。
4. 返回文本继续交由现有业务解析。

## 错误处理

- API Key、Base URL 或模型缺失：阻止请求并提示具体字段。
- 自定义 URL 不是 HTTPS：阻止保存和请求。
- 权限被拒绝：提示用户未授权该接口域名。
- 30 秒超时：中止请求并提示连接超时。
- 401/403：提示密钥或权限错误。
- 429：提示限流或额度不足，不自动重试。
- 5xx：提示供应商服务异常，不自动重试。
- 非 JSON HTTP 响应或缺少 `choices[0].message.content`：返回统一响应格式错误。
- 所有错误在进入日志前执行 API Key 脱敏。

第一阶段不进行自动重试，避免重复计费或在供应商故障时放大请求。

## 测试计划

### 自动测试

使用 Node 内置测试能力和 mock `fetch`，覆盖：

- MiMo URL、`api-key` 请求头和 `max_completion_tokens`。
- DeepSeek URL、Bearer 请求头和 `max_tokens`。
- 自定义 Base URL 规范化。
- JSON 模式仅在支持时附加。
- 成功响应解析。
- 缺少配置、401、429、5xx、超时和异常响应。
- 错误消息不包含 API Key。
- `dsKey` 迁移规则通过独立纯函数测试。

### 静态验证

- `manifest.json` 可解析。
- 所有 JavaScript 文件通过 `node --check`。
- 搜索确认运行路径不再依赖 `callDS` 或硬编码 `dsKey`。

### 浏览器手工验证

- 加载解压缩扩展无错误。
- 新安装默认显示 Xiaomi MiMo 与 `mimo-v2.5`。
- 配置保存、重开侧边栏后仍存在。
- “测试连接”不会打开或操作 BOSS 页面。
- 没有真实 API Key 时仅做请求构造测试；真实密钥由用户自行在插件中填写。
- 第一阶段验收不点击“立即沟通”，不发送简历或招呼语。

## 文档更新

根 README 和扩展 README 更新：

- AI 能力从 DeepSeek 专属改为多供应商。
- 增加 MiMo、DeepSeek 和自定义接口配置说明。
- 说明 API Key 保存在浏览器本地扩展存储中。
- 说明简历文字会发送到用户选择的模型供应商。
- 修正克隆地址为当前 fork 或使用中性安装说明。

## 验收标准

1. Xiaomi MiMo 可以通过测试连接，并能用于岗位筛选与招呼语生成调用。
2. MiMo 岗位筛选请求使用 JSON 模式，结果可被现有解析逻辑处理。
3. DeepSeek 仍可选择，原有请求格式保持不变。
4. 自定义 HTTPS OpenAI 兼容接口可配置，并只请求对应 origin 的运行时权限。
5. 旧 `dsKey` 自动迁移且其他本地数据不丢失。
6. API Key 不出现在源码、提交、日志或错误信息中。
7. 自动测试与静态检查通过。
8. 本阶段测试不执行任何真实 BOSS 投递动作。

## 交付方式

- 工作分支：`agent/phase-1-llm-providers`
- 规格文档单独提交。
- 实现和测试完成后提交到同一分支。
- 推送到 `ruiqiyang123/JobCopilot` 并创建面向 `main` 的 Draft PR。
- 未经用户后续确认，不合并 Draft PR。
