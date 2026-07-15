# JobCopilot 当前批次生命周期实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 成功投递岗位立即离开当前审核批次，失败和未执行岗位继续保留，并提供批次完成摘要与“一键开始下一批”。

**架构：** 新建无浏览器依赖的 `batch-lifecycle.js`，统一定义投递状态迁移、活动岗位过滤和批次摘要。Service Worker 负责在每个投递结果后更新、持久化并广播状态；侧边栏只渲染活动岗位，并使用最近批次生成完成摘要。历史仍由现有 `processed` 和岗位进度看板保存，不新增重复的历史数据源。

**技术栈：** Chrome Extension Manifest V3、原生 JavaScript、`chrome.storage.local`、Node.js 内置测试运行器。

---

关联规格：`docs/superpowers/specs/2026-07-15-search-filter-ranking-design.md` 第 5 节。

## 文件职责

- 创建 `JobCopilot · AI/src/batch-lifecycle.js`：纯状态规则、旧数据迁移、活动岗位过滤和批次摘要。
- 创建 `JobCopilot · AI/tests/batch-lifecycle.test.js`：覆盖成功、失败、未执行、迁移和摘要。
- 修改 `JobCopilot · AI/src/background.js`：接入状态规则，逐岗位持久化并向侧边栏广播。
- 修改 `JobCopilot · AI/src/sidepanel.html`：加载规则模块并增加批次完成摘要操作区。
- 修改 `JobCopilot · AI/src/sidepanel.js`：只渲染活动岗位，响应投递状态更新并实现开始下一批。
- 修改 `JobCopilot · AI/src/sidepanel.css`：完成摘要、状态数量和按钮样式。
- 修改 `JobCopilot · AI/tests/extension-integration.test.js`：验证加载顺序、成功移出和保留数据边界。
- 修改 `JobCopilot · AI/manifest.json` 与 `JobCopilot · AI/README.md`：版本和使用说明。

### 任务 1：建立可测试的批次状态边界

**文件：**
- 创建：`JobCopilot · AI/src/batch-lifecycle.js`
- 创建：`JobCopilot · AI/tests/batch-lifecycle.test.js`

- [x] **步骤 1：编写失败的状态规则测试**

测试必须明确：

```js
assert.equal(BatchLifecycle.markSucceeded(jobs, 'a', 1000)[0].deliveryStatus, 'succeeded');
assert.deepEqual(BatchLifecycle.activeJobs(succeeded).map(job => job.id), ['b']);
assert.equal(BatchLifecycle.markFailed(jobs, 'a', '聊天页缺少岗位 ID', 'contact')[0].deliveryStatus, 'failed');
assert.equal(BatchLifecycle.markNotRun(jobs, ['b'])[1].deliveryStatus, 'not_run');
assert.equal(BatchLifecycle.migrate(jobs, { a: 1 }, null)[0].deliveryStatus, 'succeeded');
assert.deepEqual(BatchLifecycle.summarize(lastBatch), { succeeded: 1, failed: 1, notRun: 1, total: 3 });
```

- [x] **步骤 2：运行测试验证失败**

运行：`node --test tests/batch-lifecycle.test.js`

预期：FAIL，提示找不到 `../src/batch-lifecycle.js`。

- [x] **步骤 3：实现最小纯规则模块**

公开接口固定为：

```js
BatchLifecycle.DELIVERY_STATUSES
BatchLifecycle.normalizeJob(job)
BatchLifecycle.normalizeJobs(jobs)
BatchLifecycle.migrate(jobs, processed, lastBatch)
BatchLifecycle.markSucceeded(jobs, jobId, at)
BatchLifecycle.markFailed(jobs, jobId, error, step)
BatchLifecycle.markNotRun(jobs, jobIds)
BatchLifecycle.activeJobs(jobs)
BatchLifecycle.summarize(lastBatch)
BatchLifecycle.hasUnresolved(jobs)
```

成功状态优先级最高；旧 `processed[jobId]` 或 `lastBatch.succeeded` 必须迁移为成功，不能被后续 `failed/not_run` 覆盖。

- [x] **步骤 4：运行单元测试验证通过**

运行：`node --test tests/batch-lifecycle.test.js`

预期：全部 PASS。

- [x] **步骤 5：提交纯规则模块**

```bash
git add 'JobCopilot · AI/src/batch-lifecycle.js' 'JobCopilot · AI/tests/batch-lifecycle.test.js'
git commit -m "feat: add active batch lifecycle rules"
```

### 任务 2：Service Worker 持久化逐岗位投递结果

**文件：**
- 修改：`JobCopilot · AI/src/background.js`
- 修改：`JobCopilot · AI/tests/extension-integration.test.js`

- [x] **步骤 1：增加失败的集成断言**

断言以下不变量：

```js
assert.match(background, /BatchLifecycle\.markSucceeded/);
assert.match(background, /BatchLifecycle\.markFailed/);
assert.match(background, /BatchLifecycle\.markNotRun/);
assert.match(background, /type: 'DELIVERY_STATE_UPDATED'/);
assert.ok(background.indexOf('BatchLifecycle.markSucceeded') < background.indexOf('markTrackerContacted'));
```

同时验证 `currentStateSnapshot()` 返回迁移后的 `screened`，`RESET` 不删除 `processed`、`jobTrackerRecords`、模型或招呼方案配置。

- [x] **步骤 2：运行集成测试验证失败**

运行：`node --test tests/extension-integration.test.js`

预期：FAIL，提示缺少批次生命周期接入。

- [x] **步骤 3：接入加载、迁移和状态广播**

修改后台以满足：

```js
state.screened = BatchLifecycle.migrate(state.screened, state.processed, state.lastBatch);
state.screened = BatchLifecycle.markSucceeded(state.screened, job.id, Date.now());
state.screened = BatchLifecycle.markFailed(state.screened, job.id, message, state.lastBatch.currentStep);
state.screened = BatchLifecycle.markNotRun(state.screened, state.lastBatch.notRun);
```

每次更新后调用 `persistReviewState()`，再发送：

```js
chrome.runtime.sendMessage({
  type: 'DELIVERY_STATE_UPDATED',
  screened: state.screened,
  lastBatch: state.lastBatch
}).catch(() => {});
```

成功状态必须先于岗位进度写入，确保岗位进度存储偶发失败时也不会重复发送。

- [x] **步骤 4：运行相关测试验证通过**

运行：`node --test tests/batch-lifecycle.test.js tests/extension-integration.test.js`

预期：全部 PASS。

- [x] **步骤 5：提交后台编排**

```bash
git add 'JobCopilot · AI/src/background.js' 'JobCopilot · AI/tests/extension-integration.test.js'
git commit -m "feat: persist per-job delivery outcomes"
```

### 任务 3：侧边栏活动队列和完成摘要

**文件：**
- 修改：`JobCopilot · AI/src/sidepanel.html`
- 修改：`JobCopilot · AI/src/sidepanel.js`
- 修改：`JobCopilot · AI/src/sidepanel.css`
- 修改：`JobCopilot · AI/tests/extension-integration.test.js`

- [ ] **步骤 1：增加失败的界面集成断言**

验证：

```js
assert.ok(sidepanelHtml.indexOf('batch-lifecycle.js') < sidepanelHtml.indexOf('sidepanel.js'));
assert.match(sidepanelHtml, /id="batchCompletion"/);
assert.match(sidepanelHtml, /id="btnNextBatch"/);
assert.match(sidepanelJs, /BatchLifecycle\.activeJobs/);
assert.match(sidepanelJs, /DELIVERY_STATE_UPDATED/);
assert.match(sidepanelJs, /开始下一批/);
```

- [ ] **步骤 2：运行集成测试验证失败**

运行：`node --test tests/extension-integration.test.js`

预期：FAIL，提示缺少活动队列或完成摘要。

- [ ] **步骤 3：只渲染当前待处理岗位**

`normalizedJobs()` 保留完整迁移数据；新增 `activeJobs()` 并让审核数量、页签、批准名单、预演启动和投递候选统一使用活动岗位。成功岗位不得出现在任何当前操作入口。

- [ ] **步骤 4：实现批次完成摘要和下一批动作**

摘要读取 `BatchLifecycle.summarize(currentLastBatch)`，展示成功、失败、未执行。`btnNextBatch` 在有未解决岗位时只弹出一次确认，随后发送现有 `RESET`，清空当前 UI 并滚动到收集区；岗位进度和 `processed` 继续保留。

- [ ] **步骤 5：处理实时更新和重新打开恢复**

`DELIVERY_STATE_UPDATED` 和 `DONE` 都更新 `currentScreened/currentLastBatch` 并重绘。`restoreState()` 使用后台迁移后的岗位，因此旧成功岗位重新打开后也不会出现。

- [ ] **步骤 6：运行相关测试验证通过**

运行：`node --test tests/batch-lifecycle.test.js tests/review-workflow.test.js tests/extension-integration.test.js`

预期：全部 PASS。

- [ ] **步骤 7：提交侧边栏体验**

```bash
git add 'JobCopilot · AI/src/sidepanel.html' 'JobCopilot · AI/src/sidepanel.js' 'JobCopilot · AI/src/sidepanel.css' 'JobCopilot · AI/tests/extension-integration.test.js'
git commit -m "feat: finish and clear active delivery batches"
```

### 任务 4：文档、版本与完整回归

**文件：**
- 修改：`JobCopilot · AI/manifest.json`
- 修改：`JobCopilot · AI/README.md`
- 修改：`docs/superpowers/plans/2026-07-15-active-batch-lifecycle-implementation.md`

- [ ] **步骤 1：更新版本和用户说明**

将扩展版本从 `1.1.5` 升为 `1.2.0`。README 明确：成功岗位自动移入岗位进度；失败和未执行保留；“开始下一批”只清理当前工作区。

- [ ] **步骤 2：运行完整测试**

运行：`node --test tests/*.test.js`

预期：全部 PASS。

- [ ] **步骤 3：运行静态和敏感信息检查**

```bash
node --check src/batch-lifecycle.js
node --check src/background.js
node --check src/sidepanel.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
git diff --check
git grep -nE 'tp-[A-Za-z0-9]{20,}|ak_[A-Za-z0-9]{20,}' -- . ':!docs/superpowers/plans/*'
```

预期：语法和 Manifest 检查成功，差异检查无输出，密钥检查无输出。

- [ ] **步骤 4：更新计划勾选并提交**

```bash
git add 'JobCopilot · AI/manifest.json' 'JobCopilot · AI/README.md' 'docs/superpowers/plans/2026-07-15-active-batch-lifecycle-implementation.md'
git commit -m "docs: complete active batch lifecycle plan"
```

- [ ] **步骤 5：检查最终分支状态**

运行：`git status --short && git log -6 --oneline`

预期：工作区干净，最近提交依次覆盖规则、后台、界面和文档；不执行真实 BOSS 投递。
