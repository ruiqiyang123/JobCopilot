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
    const locationText = textOf(card, SELECTORS.jobs.jobLocation);
    const rawLocationFacts = tags.concat(locationText ? [locationText] : []);
    const locationFacts = JobFilters.extractLocationFacts(rawLocationFacts);
    const rawFacts = tags.concat([JobDetail.cleanText(card.innerText || '')]);
    const facts = JobFilters.extractFacts(rawFacts);
    return JobDetail.normalizeCollectedJob({
      name: textOf(card, SELECTORS.jobs.jobName),
      salary: textOf(card, SELECTORS.jobs.jobSalary),
      company: textOf(card, SELECTORS.jobs.company),
      tags: tags,
      rawFacts: rawFacts,
      rawLocationFacts: rawLocationFacts,
      link: link,
      pageUrl: window.location.href,
      experience: facts.experience,
      companySize: facts.companySize,
      city: locationFacts.city,
      district: locationFacts.district,
      citySource: locationFacts.citySource,
      locationParseVersion: locationFacts.locationParseVersion,
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
    const detailUrl = JobDetail.canonicalizeDetailUrl(window.location.href);
    if (!detailUrl) return { success: false, error: '当前页面不是有效的岗位详情页' };
    if (pageUnavailable()) return { success: false, error: '岗位已下线', unavailable: true };

    const jd = detailText();
    const rawFacts = [
      jd,
      textOf(document, '.job-banner, .job-primary, .job-detail-header'),
      textOf(document, '.company-info, .company-sider, .sider-company')
    ].filter(Boolean);
    const rawLocationFacts = [textOf(document, SELECTORS.jobs.detailLocation)].filter(Boolean);
    const locationFacts = JobFilters.extractLocationFacts(rawLocationFacts);
    const facts = JobFilters.extractFacts(rawFacts);
    const currentJob = JobDetail.normalizeCollectedJob({
      id: JobDetail.extractJobId(detailUrl),
      detailUrl: detailUrl,
      name: textOf(document, SELECTORS.jobs.detailName),
      salary: textOf(document, SELECTORS.jobs.detailSalary),
      company: textOf(document, SELECTORS.jobs.detailCompany),
      rawFacts: rawFacts,
      rawLocationFacts: rawLocationFacts,
      experience: facts.experience,
      companySize: facts.companySize,
      city: locationFacts.city,
      district: locationFacts.district,
      citySource: locationFacts.citySource,
      locationParseVersion: locationFacts.locationParseVersion
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

  function findChatButton() {
    let button = document.querySelector(SELECTORS.jobs.immediateChatBtn);
    if (visible(button)) return button;
    button = null;
    const elements = document.querySelectorAll('a, button, span');
    for (const element of elements) {
      const text = (element.textContent || '').trim();
      if ((text === '立即沟通' || text === '继续沟通') && visible(element)) {
        button = element;
        break;
      }
    }
    return button;
  }

  function waitForChatButton(timeout) {
    return new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(() => {
        const button = findChatButton();
        if (button) { clearInterval(timer); resolve(button); }
        else if (Date.now() - started > timeout) { clearInterval(timer); resolve(null); }
      }, 200);
    });
  }

  function subscriptionDialog() {
    if (typeof ContactInterstitial === 'undefined') return null;
    return ContactInterstitial.findSubscriptionDialog(document, visible);
  }

  function waitForContactSignal(allowContinue, timeout) {
    return new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(() => {
        const dialog = subscriptionDialog();
        if (dialog) {
          clearInterval(timer);
          resolve({ type: 'subscription', dialog: dialog });
          return;
        }
        if (allowContinue) {
          const elements = document.querySelectorAll('a, button, span');
          for (const element of elements) {
            if ((element.textContent || '').trim() === '继续沟通' && visible(element)) {
              clearInterval(timer);
              resolve({ type: 'continue', element: element });
              return;
            }
          }
        }
        if (Date.now() - started > timeout) { clearInterval(timer); resolve(null); }
      }, 200);
    });
  }

  function waitForDialogGone(dialog, timeout) {
    return new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(() => {
        const stillTarget = dialog && typeof ContactInterstitial !== 'undefined'
          && ContactInterstitial.isSubscriptionText(dialog.textContent || '');
        if (!dialog || !dialog.isConnected || !visible(dialog) || !stillTarget) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - started > timeout) {
          clearInterval(timer);
          resolve(false);
        }
      }, 150);
    });
  }

  async function dismissSubscriptionDialog(dialog) {
    if (typeof ContactInterstitial === 'undefined') {
      return { success: false, error: 'BOSS 订阅回复弹窗阻止沟通，请关闭后重试' };
    }
    const result = ContactInterstitial.findCloseButton(dialog, visible);
    if (!result.button) return { success: false, error: result.error };
    result.button.click();
    const gone = await waitForDialogGone(dialog, 2500);
    if (!gone) return { success: false, error: 'BOSS 订阅回复弹窗阻止沟通，请关闭后重试' };
    return { success: true };
  }

  async function openJD(job) {
    if (JobDetail.canonicalizeDetailUrl(window.location.href)) {
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
    let button = await waitForChatButton(5000);
    if (!button && !JobDetail.canonicalizeDetailUrl(window.location.href)) {
      const card = findCardByJob(job);
      if (card) { card.click(); await sleep(1200); button = await waitForChatButton(4000); }
    }
    if (!button) return { success: false, error: '未找到立即沟通按钮' };

    let dismissed = false;
    let usedContinue = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const clickedContinue = (button.textContent || '').trim() === '继续沟通';
      button.click();
      const signal = await waitForContactSignal(!clickedContinue, clickedContinue ? 1800 : 4000);
      let dialog = signal && signal.type === 'subscription' ? signal.dialog : null;

      if (signal && signal.type === 'continue') {
        usedContinue = true;
        signal.element.click();
        const afterContinue = await waitForContactSignal(false, 1800);
        dialog = afterContinue && afterContinue.type === 'subscription' ? afterContinue.dialog : null;
      }

      if (!dialog) return { success: true, navigated: usedContinue || clickedContinue };
      if (dismissed) {
        return { success: false, error: 'BOSS 订阅回复弹窗重复出现，已停止批次' };
      }
      const closed = await dismissSubscriptionDialog(dialog);
      if (!closed.success) return closed;
      dismissed = true;
      button = await waitForChatButton(4000);
      if (!button) return { success: false, error: '关闭订阅回复弹窗后未找到沟通按钮' };
    }
    return { success: false, error: 'BOSS 订阅回复弹窗重复出现，已停止批次' };
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
