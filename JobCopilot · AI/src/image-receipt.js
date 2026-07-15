(function initImageReceipt(root, factory) {
  const api = factory();
  root.ImageReceipt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function createImageReceipt() {
  'use strict';

  function marker(image) {
    return [image && image.className, image && image.id, image && image.alt]
      .map(value => typeof value === 'string' ? value : '').join(' ').toLowerCase();
  }

  function isConfirmedImage(image) {
    if (!image || image.complete !== true) return false;
    if (/(?:avatar|head|portrait|logo|icon|emoji|face)/i.test(marker(image))) return false;
    if (Number(image.naturalWidth) < 80 || Number(image.naturalHeight) < 80) return false;
    if (typeof image.getBoundingClientRect === 'function') {
      const rect = image.getBoundingClientRect();
      if (!rect || Number(rect.width) <= 0 || Number(rect.height) <= 0) return false;
    } else if (image.offsetParent === null) return false;
    return true;
  }

  function collect(root, messageSelector) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const images = [];
    Array.from(root.querySelectorAll(messageSelector || '.item-myself')).forEach(message => {
      if (!message || typeof message.querySelectorAll !== 'function') return;
      Array.from(message.querySelectorAll('img')).forEach(image => images.push(image));
    });
    return images;
  }

  function capture(root, messageSelector) {
    return new Set(collect(root, messageSelector));
  }

  function findConfirmed(images, before) {
    const previous = before instanceof Set ? before : new Set(before || []);
    return (Array.isArray(images) ? images : []).find(image => {
      return !previous.has(image) && isConfirmedImage(image);
    }) || null;
  }

  return {
    isConfirmedImage: isConfirmedImage,
    collect: collect,
    capture: capture,
    findConfirmed: findConfirmed
  };
});
