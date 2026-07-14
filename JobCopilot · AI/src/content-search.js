// ===== BOSS 岗位页 content script：收集、详情读取和建立联系 =====
(function () {
  if (window.__bossToudiSearch) return;
  window.__bossToudiSearch = true;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function visible(element) {
    return element && (element.offsetParent !== null || getComputedStyle(element).position === 'fixed');
  }

  function firstElement(root, selectors) {
    const scope = root || document;
    const values = String(selectors || '').split(',').map(value => value.trim()).filter(Boolean);
    for (const selector of values) {
      const element = scope.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function textOf(root, selectors) {
    const element = firstElement(root, selectors);
    return element ? JobDetail.cleanText(element.textContent || '') : '';
  }

  function getCards() {
    const seen = new Set();
    return Array.from(document.querySelectorAll(SELECTORS.jobs.jobCard)).filter(card => {
      if (seen.has(card)) return false;
      seen.add(card);
      return !!firstElement(card, SELECTORS.jobs.jobName);
    });
  }

  function parseCard(card) {
    const linkElement = card.querySelector('a[href*="/job_detail/"]') || card.querySelector('a[ka][href]');
    const link = linkElement ? linkElement.href : '';
    const tags = Array.from(card.querySelectorAll(SELECTORS.jobs.tagList))
      .map(node => JobDetail.cleanText(node.textContent || '')).filter(Boolean);
    const rawFacts = tags.concat([JobDetail.cleanText(card.innerText || '')]);
    const facts = JobFilters.extractFacts(rawFacts);
    return JobDetail.normalizeCollectedJob({
      name: textOf(card, SELECTORS.jobs.jobName),
      salary: textOf(card, SELECTORS.jobs.jobSalary),
      company: textOf(card, SELECTORS.jobs.company),
      tags: tags,
      rawFacts: rawFacts,
      link: link,
      pageUrl: location.href,
      experience: facts.experience,
      companySize: facts.companySize,
      manualOverride: false
    });
  }

  async function scrape(count) {
    const seen = {};
    const jobs = [];
    let stall = 0;
    for (let loop = 0; loop < 40 && jobs.length < count && stall < 4; loop++) {
      const cards = getCards();
      let added = 0;
      for (const card of cards) {
        const job = parseCard(card);
        if (job.id && !seen[job.id]) {
          seen[job.id] = true;
          jobs.push(job);
          added++;
          if (jobs.length >= count) break;
        }
      }
      if (added === 0) stall++; else stall = 0;
      if (jobs.length >= count) break;
      window.scrollTo(0, document.body.scrollHeight);
      const container = document.querySelector('.job-list-container, .job-list-box, [class*="job-list"]');
      if (container) container.scrollTop = container.scrollHeight;
      await sleep(1200);
    }
    return jobs.slice(0, count);
  }

  function findCardByJob(job) {
    const cards = getCards();
    for (const card of cards) {
      const current = parseCard(card);
      if (JobDetail.verifyIdentity(job, current).ok) return card;
    }
    return null;
  }

  function detailText() {
    const nodes = Array.from(document.querySelectorAll(SELECTORS.jobs.detailBody));
    const values = nodes.map(node => (node.innerText || node.textContent || '').trim()).filter(Boolean);
    return values.filter((value, index) => values.indexOf(value) === index).join('\n').slice(0, 12000);
  }

  function pageUnavailable() {
    const text = (document.body && document.body.innerText) || '';
    return /职位已下线|停止招聘|职位不存在|页面不存在|该职位不存在/.test(text);
  }

  function parseDetailPage() {
    const detailUrl = JobDetail.canonicalizeDetailUrl(location.href);
    if (!detailUrl) return { success: false, error: '当前页面不是有效的岗位详情页' };
    if (pageUnavailable()) return { success: false, error: '岗位已下线', unavailable: true };

    const jd = detailText();
    const rawFacts = [
      jd,
      textOf(document, '.job-banner, .job-primary, .job-detail-header'),
      textOf(document, '.company-info, .company-sider, .sider-company')
    ].filter(Boolean);
    const facts = JobFilters.extractFacts(rawFacts);
    const currentJob = JobDetail.normalizeCollectedJob({
      id: JobDetail.extractJobId(detailUrl),
      detailUrl: detailUrl,
      name: textOf(document, SELECTORS.jobs.detailName),
      salary: textOf(document, SELECTORS.jobs.detailSalary),
      company: textOf(document, SELECTORS.jobs.detailCompany),
      rawFacts: rawFacts,
      experience: facts.experience,
      companySize: facts.companySize
    });
    return {
      success: true,
      available: true,
      jd: jd,
      currentJob: currentJob,
      detailReadAt: Date.now()
    };
  }

  function waitFor(selector, timeout) {
    return new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(() => {
        const element = document.querySelector(selector);
        if (visible(element)) { clearInterval(timer); resolve(element); }
        else if (Date.now() - started > timeout) { clearInterval(timer); resolve(null); }
      }, 200);
    });
  }

  function waitForText(texts, timeout) {
    return new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(() => {
        const elements = document.querySelectorAll('a, button, span, div');
        for (const element of elements) {
          const text = (element.textContent || '').trim();
          if (texts.indexOf(text) >= 0 && visible(element)) {
            clearInterval(timer);
            resolve(element);
            return;
          }
        }
        if (Date.now() - started > timeout) { clearInterval(timer); resolve(null); }
      }, 200);
    });
  }

  async function openJD(job) {
    if (JobDetail.canonicalizeDetailUrl(location.href)) {
      const result = parseDetailPage();
      if (!result.success) return result;
      const identity = JobDetail.verifyIdentity(job, result.currentJob);
      if (!identity.ok) return { success: false, error: '身份校验失败：' + identity.reasons.join('；') };
      return result;
    }

    const card = findCardByJob(job);
    if (!card) return { success: false, error: '搜索页未找到岗位卡片，建议使用岗位详情链接重试' };
    card.scrollIntoView({ block: 'center' });
    await sleep(400);
    card.click();
    await sleep(1600);
    const jd = detailText();
    const currentJob = parseCard(card);
    const facts = JobFilters.extractFacts([jd, card.innerText || '']);
    if (facts.experience) currentJob.experience = facts.experience;
    if (facts.companySize) currentJob.companySize = facts.companySize;
    return { success: true, available: true, jd: jd, currentJob: currentJob, detailReadAt: Date.now() };
  }

  async function goChat(job) {
    let button = await waitFor(SELECTORS.jobs.immediateChatBtn, 5000);
    if (!button) {
      const elements = document.querySelectorAll('a, button, span');
      for (const element of elements) {
        const text = (element.textContent || '').trim();
        if (text === '立即沟通' || text === '继续沟通') { button = element; break; }
      }
    }
    if (!button && !JobDetail.canonicalizeDetailUrl(location.href)) {
      const card = findCardByJob(job);
      if (card) { card.click(); await sleep(1200); button = await waitFor(SELECTORS.jobs.immediateChatBtn, 4000); }
    }
    if (!button) return { success: false, error: '未找到立即沟通按钮' };
    button.click();
    await sleep(1500);
    const continueButton = await waitForText(['继续沟通'], 4000);
    if (continueButton) { continueButton.click(); return { success: true, navigated: true }; }
    return { success: true, navigated: false };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SCRAPE') {
      scrape(message.count || 20).then(jobs => sendResponse({ success: true, jobs: jobs }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }
    if (message.type === 'READ_DETAIL') {
      Promise.resolve(parseDetailPage()).then(sendResponse)
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }
    if (message.type === 'OPEN_JD') {
      openJD(message.job).then(sendResponse)
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }
    if (message.type === 'GO_CHAT' || message.type === 'INITIATE' || message.type === 'CREATE_CONV') {
      goChat(message.job).then(sendResponse)
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }
  });
})();
