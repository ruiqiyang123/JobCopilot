# JobCopilot 四阶段改造实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 在当前独立 worktree 中逐任务实现。步骤使用复选框跟踪进度；本线程受约束不得自行调度子代理。

**目标：** 依次交付 LongCat、可配置硬筛选、默认完整预演与安全投递、本地岗位进度管理。

**架构：** 保留 Manifest V3 侧边栏和 Service Worker 编排；把供应商、岗位筛选、安全校验和进度状态分别放在可由浏览器与 Node 测试加载的纯模块中。内容脚本只负责读取页面和执行明确消息，后台负责状态机与安全门，侧边栏负责配置、审核和看板。

**技术栈：** Chrome Manifest V3、原生 JavaScript、`chrome.storage.local`、Node `node:test`、GitHub Draft PR。

---

## 文件职责

- `JobCopilot · AI/src/llm-client.js`：模型供应商预设与请求。
- `JobCopilot · AI/src/job-filters.js`：筛选档位、文本标准化、配置校验和硬筛选纯函数。
- `JobCopilot · AI/src/workflow-safety.js`：岗位身份校验和预演/正式运行安全门纯函数。
- `JobCopilot · AI/src/job-tracker.js`：进度记录去重、状态变更和历史纯函数。
- `JobCopilot · AI/src/background.js`：收集、筛选、预演、正式投递和进度持久化编排。
- `JobCopilot · AI/src/content-search.js`：岗位卡片/详情读取和可验证页面快照。
- `JobCopilot · AI/src/sidepanel.*`：可配置筛选、运行模式、审核预览和进度看板。
- `JobCopilot · AI/tests/*.test.js`：纯模块和集成契约测试。

### 任务 1：固化规格与基线

- [x] 保存已批准设计与本实现计划。
- [x] 运行 `node --test 'JobCopilot · AI/tests/'*.test.js`，结果 14/14 通过。
- [x] 完成占位词检查和仓库真实密钥模式扫描。
- [x] 提交文档：`git commit -m 'plan four-stage JobCopilot hardening'`。

### 任务 2：内置 LongCat

- [x] 先在 `tests/llm-client.test.js` 和 `tests/extension-integration.test.js` 添加失败测试，断言 `longcat` 预设、Bearer、`max_tokens`、正确 endpoint、侧边栏选项和 Manifest 权限。
- [x] 运行定向测试并确认因缺少 `longcat` 失败。
- [x] 在 `llm-client.js` 增加：

```javascript
longcat: {
  id: 'longcat', name: 'LongCat',
  baseUrl: 'https://api.longcat.chat/openai/v1', model: 'LongCat-2.0',
  authType: 'bearer', tokenParameter: 'max_tokens', jsonMode: false,
  thinking: 'disabled'
}
```

- [x] 更新侧边栏选项、占位提示、Manifest 固定权限和 README。
- [x] 运行全量测试、JS 语法检查、JSON 校验和密钥扫描。
- [x] 勾选第一阶段并提交、推送当前 Draft PR 分支。

### 任务 3：可配置岗位硬筛选

- [x] 创建 `tests/job-filters.test.js`，覆盖七档经验、六档公司规模、默认配置、开关、空选择、pass/fail/pending 和 pending 人工确认。
- [x] 运行定向测试，确认因模块不存在失败。
- [x] 创建 `job-filters.js`，导出：

```javascript
getDefaultConfig()
normalizeConfig(config)
extractFacts(texts)
evaluate(job, config)
confirmPending(job, config)
```

- [x] 在内容脚本采集 `experience`、`companySize`，在后台 AI 调用前执行 `evaluate`。
- [x] 在侧边栏增加两个可关闭的分类多选组，保存单一 `jobFilterConfig` 对象；启用且空选时阻止保存。
- [x] 审核列表分为通过、待人工确认、排除；人工确认消息只允许 pending 岗位进入 AI 筛选。
- [x] 更新 Manifest/脚本加载顺序、集成测试和 README。
- [x] 运行全量测试、语法/JSON/密钥检查，勾选第二阶段并提交、推送。

### 任务 4：完整预演与投递安全

- [x] 创建 `tests/workflow-safety.test.js`，覆盖身份匹配、缺失字段、明确不匹配、人工确认、预演资格、正式运行资格和已投岗位阻止。
- [x] 创建 `workflow-safety.js`，导出：

```javascript
verifyIdentity(expected, actual)
verifyEligibility(job, currentJob, filterConfig, processed)
canDeliver(jobId, previews, processed)
```

- [x] 内容脚本的详情读取返回当前岗位快照与完整 JD；建立沟通仍保持独立消息。
- [x] 后台增加 `previews` 和 `lastBatch` 持久状态，以及 `START_PREVIEW` 路径；该路径不得发送 `GO_CHAT` 或 `SEND_ACTIVE`。
- [x] 侧边栏增加不持久化的 `preview/live` 选择，默认 preview；展示预演招呼语和校验结果。
- [x] 正式运行只接受 ready preview，并通过一次原生批次确认；发送前重新读取详情和调用 `verifyEligibility`。
- [x] 任一失败写入 lastBatch 后 `break`，剩余项记录为未执行，不自动重试。
- [x] 扩展集成测试静态断言预演无沟通消息、正式运行有双重安全门且失败即停。
- [x] 运行全量检查，勾选第三阶段并提交、推送。

### 任务 5：本地岗位进度管理

- [x] 创建 `tests/job-tracker.test.js`，覆盖 ID 去重、重复收集不降级、发送成功变为已沟通、五个手动状态、历史和非法状态拒绝。
- [x] 创建 `job-tracker.js`，导出：

```javascript
upsertCollected(records, job, at)
setStatus(records, jobId, status, at)
summarize(records)
```

- [x] 后台在收集后 upsert；正式发送成功后设为 contacted；增加 `GET_TRACKER` 和 `UPDATE_TRACKER_STATUS` 消息。
- [x] 侧边栏增加进度看板、状态计数、筛选和手动状态下拉框，不提供 BOSS 历史扫描。
- [x] 持久化键使用 `jobTrackerRecords`，记录基础信息、状态、`updatedAt` 和 `history`。
- [x] 运行全量检查，勾选第四阶段并提交、推送。

### 任务 6：最终回归与分支收尾

- [ ] 运行全部 Node 测试，预期 0 失败。
- [ ] 对全部 JS 运行 `node --check`，对 Manifest 运行 JSON 解析检查。
- [ ] 使用 `git grep` 扫描用户提供的密钥前缀/完整值和常见硬编码凭证模式，预期无匹配。
- [ ] 确认 `git status` 干净、远端分支已同步、Draft PR 包含全部阶段提交。
- [ ] 更新本计划所有完成项并提交最终进度。
