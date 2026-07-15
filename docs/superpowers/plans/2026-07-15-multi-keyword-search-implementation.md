# JobCopilot 多关键词扩展搜索实现计划

> **面向 AI 代理的工作者：** 使用 superpowers:executing-plans 在当前功能分支逐任务执行，步骤使用复选框跟踪。

**目标：** 将单次关键词搜索升级为可配置的精准、平衡和宽松多关键词搜索，并按稳定岗位 ID 跨搜索去重。

**架构：** 新建纯规则模块 `search-strategy.js` 负责关键词解析、内置同义词扩展、匹配模式和跨搜索结果合并；后台按每轮每个关键词最多新增 5 个岗位的方式轮询 BOSS 搜索页，直到达到唯一岗位上限或整轮停滞。侧边栏保存搜索模式和扩展开关，命名方案管理留在最终“方案优先 UI”阶段。

**技术栈：** Manifest V3、原生 JavaScript、Chrome Tabs、Node.js 内置测试运行器。

---

### 任务 1：搜索策略纯规则

**文件：**
- 创建：`JobCopilot · AI/src/search-strategy.js`
- 创建：`JobCopilot · AI/tests/search-strategy.test.js`

- [x] 先编写并运行失败测试，覆盖中文/英文逗号和换行解析、精准/平衡/宽松模式、大小写去重、跨关键词岗位去重和 `matchedSearchTerms` 合并。
- [x] 实现 `parseKeywords`、`normalizeConfig`、`resolveTerms`、`mergeJobs`、`roundTarget`。
- [x] 运行 `node --test tests/search-strategy.test.js`，预期全部通过。
- [x] 提交 `feat: add multi-keyword search strategy`。

### 任务 2：后台公平轮询收集

**文件：**
- 修改：`JobCopilot · AI/src/background.js`
- 修改：`JobCopilot · AI/tests/extension-integration.test.js`

- [ ] 先增加失败集成断言：后台加载 `search-strategy.js`，使用 `resolveTerms`、`mergeJobs` 和 `roundTarget`，搜索 URL 接受当前关键词。
- [ ] 实现 `collectAcrossSearchTerms(cfg, limit)`：每轮依次搜索所有词，每词每轮最多扩大 5 个结果；按稳定 ID 去重；整轮无新增时停止；任一关键词搜索失败立即抛错并记录该词。
- [ ] 日志显示搜索词数、原始卡片数、唯一岗位数和停滞原因。
- [ ] 运行策略与集成测试，预期全部通过。
- [ ] 提交 `feat: collect unique jobs across search terms`。

### 任务 3：侧边栏配置、迁移和回归

**文件：**
- 修改：`JobCopilot · AI/src/sidepanel.html`
- 修改：`JobCopilot · AI/src/sidepanel.js`
- 修改：`JobCopilot · AI/manifest.json`
- 修改：`README.md`
- 修改：`JobCopilot · AI/README.md`

- [ ] 先增加失败集成断言，验证搜索模式、扩展开关、唯一岗位上限文案及脚本加载顺序。
- [ ] 增加精准/平衡/宽松模式和自动扩展开关；旧 `keyword`、`count` 自动沿用，默认平衡模式并开启扩展。
- [ ] 将“收集岗位数量”改名为“唯一岗位收集上限”，关键词输入支持逗号、顿号、分号和换行。
- [ ] 版本升至 `1.3.0`，同步 README。
- [ ] 运行全部测试、语法、Manifest、差异和密钥扫描。
- [ ] 更新勾选、提交并推送现有 PR；不访问 BOSS，不执行真实投递。
