# JobCopilot 人工批准队列与三段式投递实现计划

日期：2026-07-14

关联规格：`docs/superpowers/specs/2026-07-14-jobcopilot-approved-batch-greeting-design.md`

## 实施原则

- 先写失败测试，再实现最小代码使其通过。
- 每个阶段保持模拟运行不会触发 BOSS 沟通或发送。
- 正式投递必须经过人工批准、确认预演和发送前安全门。
- 保留现有模型、筛选、岗位进度和去重数据。
- 不在源码、测试、日志或提交中写入 API Key。

## 任务 1：稳定岗位身份与详情解析

涉及文件：

- 新增 `JobCopilot · AI/src/job-detail.js`
- 修改 `JobCopilot · AI/src/selectors.js`
- 修改 `JobCopilot · AI/src/content-search.js`
- 修改 `JobCopilot · AI/manifest.json`
- 新增 `JobCopilot · AI/tests/job-detail.test.js`

步骤：

1. 为 URL 规范化、稳定岗位 ID、严格身份匹配编写测试。
2. 为去标识化岗位卡片和详情 HTML 的公司、经验、规模解析编写测试。
3. 实现独立 `JobDetail` 模块。
4. 让搜索页收集结果保存 `detailUrl`、`rawFacts` 和稳定 ID。
5. 增加详情页内容脚本消息：读取完整 JD、岗位身份、公司、经验和规模。
6. 保留搜索页增量滚动查找作为缺失详情链接时的后备路径。

## 任务 2：审核状态、招呼方案与预演冻结

涉及文件：

- 新增 `JobCopilot · AI/src/review-workflow.js`
- 新增 `JobCopilot · AI/src/greeting-plans.js`
- 修改 `JobCopilot · AI/src/job-tracker.js`
- 新增 `JobCopilot · AI/tests/review-workflow.test.js`
- 新增 `JobCopilot · AI/tests/greeting-plans.test.js`
- 修改 `JobCopilot · AI/tests/job-tracker.test.js`

步骤：

1. 定义并测试审核状态与合法转换。
2. 定义并测试招呼方案校验、默认值、增删改和选中方案。
3. 定义预演快照、指纹、确认和过期规则。
4. 将审核状态与求职进度拆成不同字段。
5. 为旧配置、旧预演和旧岗位记录增加无损迁移。

## 任务 3：完整 JD 筛选与稳定详情读取

涉及文件：

- 修改 `JobCopilot · AI/src/background.js`
- 修改 `JobCopilot · AI/src/content-search.js`
- 修改 `JobCopilot · AI/tests/extension-integration.test.js`

步骤：

1. 增加后台临时详情标签页生命周期管理。
2. 收集后对卡片字段缺失岗位优先读取详情并补全。
3. 对硬筛选通过岗位读取完整 JD，再调用 AI 筛选。
4. 将详情读取错误、岗位下线和身份不一致转成明确状态。
5. 确保预演不再依赖重新加载后的当前可见岗位卡片。

## 任务 4：三段式预演与正式发送

涉及文件：

- 修改 `JobCopilot · AI/src/background.js`
- 修改 `JobCopilot · AI/src/content-chat.js`
- 修改 `JobCopilot · AI/src/workflow-safety.js`
- 修改 `JobCopilot · AI/tests/workflow-safety.test.js`
- 修改 `JobCopilot · AI/tests/extension-integration.test.js`

步骤：

1. 预演只接受已批准岗位。
2. 按岗位生成 AI 开场，组合固定消息和简历图片指纹。
3. 支持编辑 AI 开场并确认冻结预演。
4. 正式投递只读取确认且未过期的快照，不重新调用模型。
5. 聊天页按“AI 开场 → 固定消息 → 简历图片”顺序发送。
6. 每一步确认送达；任一步失败立即返回明确阶段错误。
7. 后台立即停止批次，并记录成功、失败和未执行岗位。

## 任务 5：侧边栏审核和招呼方案界面

涉及文件：

- 修改 `JobCopilot · AI/src/sidepanel.html`
- 修改 `JobCopilot · AI/src/sidepanel.css`
- 修改 `JobCopilot · AI/src/sidepanel.js`
- 修改 `JobCopilot · AI/tests/extension-integration.test.js`

步骤：

1. 移除模拟/正式模式下拉框和重复勾选流程。
2. 增加招呼方案选择、新建、编辑和删除界面。
3. 增加推荐、待补充、已批准、不投递和已排除审核标签。
4. 岗位卡增加查看详情、批准投递和不投递按钮。
5. 增加已批准队列的预演区，展示三段内容并允许编辑 AI 开场。
6. 增加单独的正式投递按钮和禁用原因。
7. 日志默认折叠，发生错误自动展开。

## 任务 6：自动测试和 Mock 集成验收

涉及文件：

- 修改 `JobCopilot · AI/tests/*.test.js`
- 按需新增 `JobCopilot · AI/tests/fixtures/*.html`

步骤：

1. 运行全部 Node 测试。
2. 覆盖稳定详情、字段补全、状态恢复和预演失效。
3. 覆盖完整的 Mock 收集、详情、批准、预演和三段发送流程。
4. 分别模拟三段发送失败，验证立即停止和未执行记录。
5. 检查模拟运行代码路径不含建立沟通或发送消息。

## 任务 7：文档、提交和本地复测准备

涉及文件：

- 修改 `JobCopilot · AI/README.md`
- 修改根目录 `README.md`
- 修改 `JobCopilot · AI/manifest.json` 版本号（如需要）

步骤：

1. 更新安装、审核队列、招呼方案和三段式发送说明。
2. 运行测试、语法检查、`git diff --check` 和 API Key 扫描。
3. 提交实现，推送分支并更新 PR。
4. 让用户在 `chrome://extensions` 点击扩展刷新按钮。
5. 先执行真实 BOSS 页面模拟运行；真实发送仍需对具体岗位单独确认。
