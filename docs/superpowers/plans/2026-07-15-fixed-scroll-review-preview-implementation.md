# 岗位审核与投递预演固定滚动窗口实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框语法跟踪进度。

**目标：** 将岗位审核和投递预演改为约 60vh 的固定窗口，固定顶部与底部控制区，仅滚动中间列表，并在重渲染时稳定维护滚动位置。

**架构：** 新增一个无 DOM 框架依赖的滚动位置模块，负责读取、重置和按内容高度约束 scrollTop。侧边栏 HTML 将两个区域明确拆成顶部控制区、滚动列表和底部操作区；CSS 使用纵向 Flex 与 clamp 高度形成固定窗口；sidepanel.js 在列表重渲染前后调用滚动模块。

**技术栈：** Chrome Extension Manifest V3、原生 HTML/CSS/JavaScript、Node.js 内置 test runner。

---

## 文件结构

- 创建：JobCopilot · AI/src/list-scroll-state.js
  - 提供滚动位置读取、重置、上限约束和写回，不包含业务状态。
- 创建：JobCopilot · AI/tests/list-scroll-state.test.js
  - 单测负值、超出范围、内容缩短和显式重置。
- 修改：JobCopilot · AI/src/sidepanel.html
  - 为审核与预演增加统一固定窗口结构、滚动区可访问属性，并加载滚动模块。
- 修改：JobCopilot · AI/src/sidepanel.css
  - 定义 360px–720px、目标 60vh 的窗口和内部滚动样式。
- 修改：JobCopilot · AI/src/sidepanel.js
  - 重渲染前捕获 scrollTop，下一帧恢复；分类切换明确回到顶部。
- 修改：JobCopilot · AI/tests/extension-integration.test.js
  - 锁定 DOM 结构、CSS 契约、脚本加载顺序和滚动调用路径。
- 修改：JobCopilot · AI/manifest.json
  - 将扩展版本从 1.8.1 升为 1.8.2。
- 修改：README.md
  - 将版本徽章同步为 1.8.2。

### 任务 1：建立可单测的滚动位置模块

**文件：**
- 创建：JobCopilot · AI/tests/list-scroll-state.test.js
- 创建：JobCopilot · AI/src/list-scroll-state.js

- [ ] **步骤 1：编写失败的滚动位置单元测试**

创建测试文件：

~~~javascript
const test = require('node:test');
const assert = require('node:assert/strict');

const ListScrollState = require('../src/list-scroll-state.js');

test('保留当前滚动位置，显式重置时回到顶部', () => {
  const element = { scrollTop: 180, scrollHeight: 1000, clientHeight: 400 };

  assert.equal(ListScrollState.capture(element), 180);
  assert.equal(ListScrollState.target(element, false), 180);
  assert.equal(ListScrollState.target(element, true), 0);
});

test('恢复位置时限制在当前内容的有效范围内', () => {
  const element = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };

  assert.equal(ListScrollState.apply(element, 900), 600);
  assert.equal(element.scrollTop, 600);
  assert.equal(ListScrollState.apply(element, -20), 0);
  assert.equal(element.scrollTop, 0);
});

test('内容缩短或元素缺失时返回安全位置', () => {
  const element = { scrollTop: 500, scrollHeight: 250, clientHeight: 400 };

  assert.equal(ListScrollState.apply(element, 500), 0);
  assert.equal(ListScrollState.capture(null), 0);
  assert.equal(ListScrollState.apply(null, 100), 0);
});
~~~

- [ ] **步骤 2：运行测试并确认因模块缺失而失败**

运行：

~~~bash
cd 'JobCopilot · AI'
node --test tests/list-scroll-state.test.js
~~~

预期：FAIL，错误包含 Cannot find module '../src/list-scroll-state.js'。

- [ ] **步骤 3：实现最小滚动位置模块**

创建 JobCopilot · AI/src/list-scroll-state.js：

~~~javascript
(function initListScrollState(root, factory) {
  const api = factory();
  root.ListScrollState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createListScrollState() {
  'use strict';

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function clamp(scrollTop, scrollHeight, clientHeight) {
    const maximum = Math.max(0, finite(scrollHeight) - finite(clientHeight));
    return Math.min(maximum, Math.max(0, finite(scrollTop)));
  }

  function capture(element) {
    return element ? Math.max(0, finite(element.scrollTop)) : 0;
  }

  function target(element, reset) {
    return reset ? 0 : capture(element);
  }

  function apply(element, scrollTop) {
    if (!element) return 0;
    const next = clamp(scrollTop, element.scrollHeight, element.clientHeight);
    element.scrollTop = next;
    return next;
  }

  return {
    clamp: clamp,
    capture: capture,
    target: target,
    apply: apply
  };
});
~~~

- [ ] **步骤 4：运行滚动位置单元测试**

运行：

~~~bash
cd 'JobCopilot · AI'
node --test tests/list-scroll-state.test.js
~~~

预期：3 项测试全部 PASS。

- [ ] **步骤 5：提交滚动位置模块**

~~~bash
git add 'JobCopilot · AI/src/list-scroll-state.js' 'JobCopilot · AI/tests/list-scroll-state.test.js'
git commit -m 'test: add fixed list scroll state'
~~~

### 任务 2：建立固定窗口 DOM 与 CSS 边界

**文件：**
- 修改：JobCopilot · AI/tests/extension-integration.test.js
- 修改：JobCopilot · AI/src/sidepanel.html:172-222
- 修改：JobCopilot · AI/src/sidepanel.css:82-151

- [ ] **步骤 1：编写失败的固定窗口集成测试**

在 extension-integration.test.js 末尾新增：

~~~javascript
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
~~~

- [ ] **步骤 2：运行定向测试并确认失败**

运行：

~~~bash
cd 'JobCopilot · AI'
node --test --test-name-pattern='岗位审核与投递预演使用固定窗口' tests/extension-integration.test.js
~~~

预期：FAIL，首先报告 reviewCard 缺少 fixed-list-card。

- [ ] **步骤 3：重组岗位审核 HTML**

将 reviewCard 完整替换为以下结构：

~~~html
<section class="card fixed-list-card" id="reviewCard">
  <div class="card-title"><span>④ 岗位审核</span><span id="reviewCount">0 个岗位</span></div>
  <div class="review-tabs" id="reviewTabs">
    <button data-review-tab="pending_review" class="active">推荐 <span>0</span></button>
    <button data-review-tab="needs_info">待补充 <span>0</span></button>
    <button data-review-tab="approved">已批准 <span>0</span></button>
    <button data-review-tab="rejected">不投递 <span>0</span></button>
    <button data-review-tab="filtered_out">已排除 <span>0</span></button>
  </div>
  <div class="card-b review-body fixed-list-body">
    <div class="fixed-list-controls">
      <div id="bulkCandidateActions" class="bulk-review-actions hidden">
        <label><input type="checkbox" id="selectAllCandidates"> 全选待补充岗位</label>
        <button type="button" id="btnBulkConfirmCandidates" class="approve">一键确认符合（0）</button>
      </div>
      <div id="bulkReviewActions" class="bulk-review-actions hidden">
        <label><input type="checkbox" id="selectAllRecommended"> 全选推荐岗位</label>
        <button type="button" id="btnBulkApprove" class="approve">一键批准推荐岗位（0）</button>
      </div>
    </div>
    <div id="reviewList" class="fixed-list-scroll" tabindex="0" aria-label="岗位审核列表">
      <div class="empty">还没有筛选结果</div>
    </div>
    <div class="sticky-action fixed-list-footer">
      <span id="approvedSummary">已批准 0 个</span>
      <button class="btn-go compact" id="btnPreview" disabled>预演已批准岗位</button>
    </div>
  </div>
</section>
~~~

- [ ] **步骤 4：重组投递预演 HTML**

将 previewCard 完整替换为以下结构：

~~~html
<section class="card fixed-list-card" id="previewCard">
  <div class="card-title"><span>⑤ 投递预演</span><span id="previewSummary">0 个已确认</span></div>
  <div class="card-b fixed-list-body">
    <div class="fixed-list-controls">
      <div class="safety-note">预演只生成最终内容；确认后才可进入正式投递。</div>
      <div id="previewRunError" class="preview-run-error hidden" role="alert" aria-live="assertive"></div>
      <button type="button" class="btn-secondary hidden" id="btnRetryPreviewFailures">仅重试预演失败岗位</button>
      <div id="bulkPreviewActions" class="bulk-review-actions bulk-preview-actions hidden">
        <label><input type="checkbox" id="selectAllPreviews"> 全选待确认预演</label>
        <button type="button" id="btnBulkConfirmPreviews" class="approve">一键确认预演（0）</button>
      </div>
    </div>
    <div id="previewList" class="fixed-list-scroll" tabindex="0" aria-label="投递预演列表">
      <div class="empty">批准岗位后点击“预演已批准岗位”</div>
    </div>
    <div class="fixed-list-footer preview-footer">
      <button class="btn-live" id="btnDeliver" disabled>暂无可正式投递岗位</button>
      <div id="deliverDisabledReason" class="disabled-reason">需要先批准岗位并确认预演</div>
      <div id="batchCompletion" class="batch-completion hidden" role="status" aria-live="polite">
        <strong id="batchCompletionTitle">本批投递已结束</strong>
        <div id="batchCompletionSummary" class="batch-summary">成功 0 · 失败 0 · 未执行 0</div>
        <div class="batch-actions">
          <button type="button" class="btn-secondary hidden" id="btnRetryDeliveryFailures">仅重试发送前失败岗位</button>
          <button type="button" class="btn-secondary" id="btnContinueBatch">处理剩余岗位</button>
          <button type="button" class="btn-go compact" id="btnNextBatch">开始下一批</button>
          <button type="button" class="btn-secondary" id="btnViewTracker">查看岗位进度</button>
        </div>
      </div>
    </div>
  </div>
</section>
~~~

- [ ] **步骤 5：在 sidepanel.js 前加载滚动模块**

在 sidepanel.html 底部增加：

~~~html
<script src="list-scroll-state.js"></script>
<script src="sidepanel.js"></script>
~~~

确保只保留一个 sidepanel.js 标签，并且 list-scroll-state.js 紧邻它之前。

- [ ] **步骤 6：添加固定窗口 CSS**

在 sidepanel.css 的审核/预演样式区域加入：

~~~css
.fixed-list-card {
  height: clamp(360px, 60vh, 720px);
  display: flex;
  flex-direction: column;
}
.fixed-list-card > .card-title,
.fixed-list-card > .review-tabs { flex: 0 0 auto; }
.fixed-list-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-bottom: 0;
}
.fixed-list-controls,
.fixed-list-footer { flex: 0 0 auto; }
.fixed-list-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding-right: 4px;
  border-top: 1px solid transparent;
  border-bottom: 1px solid var(--line);
}
.fixed-list-scroll:focus-visible {
  outline: 2px solid #78b8d5;
  outline-offset: -2px;
}
.fixed-list-footer {
  background: rgba(255, 255, 255, .98);
}
.sticky-action {
  position: static;
  margin-top: 0;
}
.preview-footer { padding-top: 9px; }
~~~

- [ ] **步骤 7：运行固定窗口集成测试**

运行：

~~~bash
cd 'JobCopilot · AI'
node --test --test-name-pattern='岗位审核与投递预演使用固定窗口' tests/extension-integration.test.js
~~~

预期：PASS。

- [ ] **步骤 8：提交结构和样式**

~~~bash
git add 'JobCopilot · AI/src/sidepanel.html' 'JobCopilot · AI/src/sidepanel.css' 'JobCopilot · AI/tests/extension-integration.test.js'
git commit -m 'feat: add fixed review and preview windows'
~~~

### 任务 3：重渲染时保留位置，分类切换时回到顶部

**文件：**
- 修改：JobCopilot · AI/tests/extension-integration.test.js
- 修改：JobCopilot · AI/src/sidepanel.js:788-866
- 修改：JobCopilot · AI/src/sidepanel.js:1157-1169

- [ ] **步骤 1：编写失败的滚动交互集成测试**

在 extension-integration.test.js 新增：

~~~javascript
test('列表重渲染保留滚动位置且分类切换回到顶部', () => {
  const js = read('src/sidepanel.js');

  assert.match(js, /function renderScrollableList\(listId, html, reset\)/);
  assert.match(js, /ListScrollState\.target\(list, reset\)/);
  assert.match(js, /requestAnimationFrame\(\(\) => ListScrollState\.apply\(list, target\)\)/);
  assert.match(js, /function renderReview\(options\)/);
  assert.match(js, /renderScrollableList\('reviewList',[\s\S]*resetScroll/);
  assert.match(js, /renderReview\(\{ resetScroll: true \}\)/);
  assert.match(js, /renderScrollableList\('previewList',[\s\S]*false/);
});
~~~

- [ ] **步骤 2：运行定向测试并确认失败**

运行：

~~~bash
cd 'JobCopilot · AI'
node --test --test-name-pattern='列表重渲染保留滚动位置' tests/extension-integration.test.js
~~~

预期：FAIL，报告缺少 renderScrollableList。

- [ ] **步骤 3：添加统一列表渲染辅助函数**

在 sidepanel.js 的 runtimeMessage 后增加：

~~~javascript
function renderScrollableList(listId, html, reset) {
  const list = $(listId);
  const target = ListScrollState.target(list, reset);
  list.innerHTML = html;
  window.requestAnimationFrame(() => ListScrollState.apply(list, target));
}
~~~

- [ ] **步骤 4：让岗位审核渲染使用辅助函数**

将 renderReview 完整改为：

~~~javascript
function renderReview(options) {
  const resetScroll = Boolean(options && options.resetScroll);
  const counts = reviewCounts();
  document.querySelectorAll('[data-review-tab]').forEach(button => {
    const status = button.dataset.reviewTab;
    button.classList.toggle('active', status === currentReviewTab);
    const count = button.querySelector('span');
    if (count) count.textContent = counts[status] || 0;
  });
  $('reviewCount').textContent = activeJobs().length + ' 个待处理岗位';
  const visible = MatchScoring.sortJobs(activeJobs()).filter(
    job => job.reviewStatus === currentReviewTab
  );
  renderScrollableList(
    'reviewList',
    visible.map(renderReviewCard).join('') || '<div class="empty">当前分类没有岗位</div>',
    resetScroll
  );
  renderBulkReviewActions();
  $('approvedSummary').textContent = '已批准 ' + counts.approved + ' 个';
  renderPreviewButton(counts.approved);
  renderPreviews();
}
~~~

- [ ] **步骤 5：分类点击时显式请求重置**

将分类点击处理器最后一行改为：

~~~javascript
currentReviewTab = button.dataset.reviewTab;
renderReview({ resetScroll: true });
~~~

其他 renderReview 调用继续不传参数，从而保留同一分类的当前位置。

- [ ] **步骤 6：让预演渲染保留位置**

将 renderPreviews 中的 previewList.innerHTML 赋值替换为：

~~~javascript
renderScrollableList(
  'previewList',
  approved.length
    ? approved.map(job => renderPreviewItem(job, currentPreviews[job.id])).join('')
    : '<div class="empty">批准岗位后点击“预演已批准岗位”</div>',
  false
);
~~~

后续 ready 计算、错误、批量操作、投递控制和摘要渲染保持不变。

- [ ] **步骤 7：运行滚动模块与集成测试**

运行：

~~~bash
cd 'JobCopilot · AI'
node --test tests/list-scroll-state.test.js tests/extension-integration.test.js
~~~

预期：滚动模块 3 项和全部扩展集成测试 PASS。

- [ ] **步骤 8：提交滚动交互**

~~~bash
git add 'JobCopilot · AI/src/sidepanel.js' 'JobCopilot · AI/tests/extension-integration.test.js'
git commit -m 'feat: preserve fixed list scroll positions'
~~~

### 任务 4：同步版本为 1.8.2

**文件：**
- 修改：JobCopilot · AI/tests/extension-integration.test.js
- 修改：JobCopilot · AI/manifest.json:4
- 修改：README.md:9

- [ ] **步骤 1：先锁定 1.8.2 版本测试**

在 extension-integration.test.js 的 Manifest 测试中加入：

~~~javascript
assert.equal(manifest.version, '1.8.2');
assert.match(read('../README.md'), /version-1\.8\.2-/);
~~~

- [ ] **步骤 2：运行版本测试并确认失败**

运行：

~~~bash
cd 'JobCopilot · AI'
node --test --test-name-pattern='Manifest 固定授权' tests/extension-integration.test.js
~~~

预期：FAIL，实际版本为 1.8.1。

- [ ] **步骤 3：更新扩展和 README 版本**

将 manifest.json 改为：

~~~json
"version": "1.8.2"
~~~

将 README.md 徽章改为：

~~~markdown
![Version](https://img.shields.io/badge/version-1.8.2-5b5bd6.svg)
~~~

- [ ] **步骤 4：运行版本测试**

运行：

~~~bash
cd 'JobCopilot · AI'
node --test --test-name-pattern='Manifest 固定授权' tests/extension-integration.test.js
~~~

预期：PASS。

- [ ] **步骤 5：提交版本更新**

~~~bash
git add 'JobCopilot · AI/manifest.json' README.md 'JobCopilot · AI/tests/extension-integration.test.js'
git commit -m 'chore: bump extension version to 1.8.2'
~~~

### 任务 5：完整验证与视觉验收

**文件：**
- 验证前述所有修改，不新增文件。

- [ ] **步骤 1：运行完整测试**

~~~bash
cd 'JobCopilot · AI'
node --test tests/*.test.js
~~~

预期：全部测试 PASS，失败数为 0。

- [ ] **步骤 2：检查所有源文件语法**

~~~bash
cd 'JobCopilot · AI'
find src -name '*.js' -print0 | xargs -0 -n1 node --check
~~~

预期：退出码 0，无输出。

- [ ] **步骤 3：验证 Manifest 与差异格式**

~~~bash
cd 'JobCopilot · AI'
node -e "const m=JSON.parse(require('fs').readFileSync('manifest.json','utf8')); if(m.version!=='1.8.2') process.exit(1); console.log(m.version)"
cd ..
git diff --check
~~~

预期：输出 1.8.2，git diff --check 无输出。

- [ ] **步骤 4：在浏览器中验证 60 个岗位场景**

重新加载未打包扩展并打开侧边栏，使用至少 60 个筛选结果验证：

1. 岗位审核和投递预演窗口高度随视口变化，且都不超过 720px。
2. 滚轮到列表边界时不继续带动外层侧边栏。
3. 顶部分类、批量操作和底部主按钮始终可见。
4. 在列表中部勾选、批准、确认或重新生成后，位置不跳到顶部。
5. 切换任意审核分类后，新分类从顶部显示。
6. 预演文本框仍可编辑，正式投递仍显示最终确认弹窗。

预期：六项全部满足。

- [ ] **步骤 5：检查最终提交范围**

~~~bash
git status -sb
git log --oneline --decorate -6
git diff origin/codex/bulk-confirm-recommendation-fix-pr...HEAD --stat
~~~

预期：工作区干净；差异只包含规格、计划、滚动模块、侧边栏 HTML/CSS/JS、测试和 1.8.2 版本元数据。
