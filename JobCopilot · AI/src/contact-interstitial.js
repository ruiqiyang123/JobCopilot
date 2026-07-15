(function initContactInterstitial(root, factory) {
  const api = factory();
  root.ContactInterstitial = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createContactInterstitial() {
  'use strict';

  const DIALOG_SELECTOR = [
    '[role="dialog"]', '.dialog-container', '.dialog-wrap', '.dialog-box',
    '.modal-container', '.modal-wrap', '.modal-box', '.boss-dialog',
    '[class*="subscribe-dialog"]', '[class*="dialog"]', '[class*="modal"]'
  ].join(',');
  const CLOSE_SELECTOR = [
    'button[aria-label*="关闭"]', '[role="button"][aria-label*="关闭"]',
    'button[title*="关闭"]', '[role="button"][title*="关闭"]',
    '.dialog-close', '.modal-close', '.boss-dialog__close',
    '[class*="dialog-close"]', '[class*="modal-close"]', '[class*="close"]'
  ].join(',');
  const TITLE_SELECTOR = 'h1, h2, h3, h4, strong, div, span';

  function text(node) {
    return String((node && (node.innerText || node.textContent)) || '').replace(/\s+/g, ' ').trim();
  }

  function isSubscriptionText(value) {
    const content = String(value || '').replace(/\s+/g, ' ').trim();
    return content.indexOf('订阅回复消息') >= 0
      && (content.indexOf('使用微信扫码订阅') >= 0
        || content.indexOf('在微信上实时收到') >= 0);
  }

  function all(root, selector) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    return Array.from(root.querySelectorAll(selector) || []);
  }

  function findSubscriptionDialog(root, isVisible) {
    const visible = typeof isVisible === 'function' ? isVisible : () => true;
    const candidates = all(root, DIALOG_SELECTOR);
    let matches = candidates.filter(node => visible(node) && isSubscriptionText(text(node)));
    if (!matches.length) {
      all(root, TITLE_SELECTOR).forEach(node => {
        if (text(node) !== '订阅回复消息') return;
        let parent = node.parentElement;
        for (let depth = 0; parent && depth < 8; depth++) {
          if (isSubscriptionText(text(parent)) && candidates.indexOf(parent) < 0) candidates.push(parent);
          parent = parent.parentElement;
        }
      });
      matches = candidates.filter(node => visible(node) && isSubscriptionText(text(node)));
    }
    matches.sort((left, right) => {
      const leftClose = findCloseButton(left, visible).count === 1 ? 0 : 1;
      const rightClose = findCloseButton(right, visible).count === 1 ? 0 : 1;
      return leftClose - rightClose || text(left).length - text(right).length;
    });
    return matches[0] || null;
  }

  function attribute(node, name) {
    if (!node || typeof node.getAttribute !== 'function') return '';
    return String(node.getAttribute(name) || '');
  }

  function classText(node) {
    if (!node) return '';
    if (typeof node.className === 'string') return node.className;
    return attribute(node, 'class');
  }

  function closeEvidence(node) {
    const value = [
      attribute(node, 'aria-label'), attribute(node, 'title'),
      classText(node), text(node)
    ].join(' ').toLowerCase();
    return /关闭|close|(^|\s)[×✕x](\s|$)/i.test(value);
  }

  function clickable(node, dialog) {
    if (!node) return null;
    if (typeof node.matches === 'function' && node.matches('button, a, [role="button"]')) return node;
    if (typeof node.closest === 'function') {
      const parent = node.closest('button, a, [role="button"]');
      if (parent && (!dialog || typeof dialog.contains !== 'function' || dialog.contains(parent))) return parent;
    }
    return node;
  }

  function findCloseButton(dialog, isVisible) {
    const visible = typeof isVisible === 'function' ? isVisible : () => true;
    const values = [];
    all(dialog, CLOSE_SELECTOR).forEach(node => {
      const candidate = clickable(node, dialog);
      if (!candidate || !visible(candidate) || !closeEvidence(candidate)) return;
      if (values.indexOf(candidate) < 0) values.push(candidate);
    });
    return {
      button: values.length === 1 ? values[0] : null,
      count: values.length,
      error: values.length === 1 ? '' : 'BOSS 订阅回复弹窗阻止沟通，请关闭后重试'
    };
  }

  function inspect(root, isVisible) {
    const dialog = findSubscriptionDialog(root, isVisible);
    if (!dialog) return { found: false, dialog: null, closeButton: null, error: '' };
    const close = findCloseButton(dialog, isVisible);
    return {
      found: true,
      dialog: dialog,
      closeButton: close.button,
      error: close.error
    };
  }

  return {
    DIALOG_SELECTOR: DIALOG_SELECTOR,
    CLOSE_SELECTOR: CLOSE_SELECTOR,
    TITLE_SELECTOR: TITLE_SELECTOR,
    isSubscriptionText: isSubscriptionText,
    findSubscriptionDialog: findSubscriptionDialog,
    findCloseButton: findCloseButton,
    inspect: inspect
  };
});
