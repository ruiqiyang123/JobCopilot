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
