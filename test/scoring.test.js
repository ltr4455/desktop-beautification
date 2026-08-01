'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeScore, rankItems, DAY } = require('../src/main/usage');

const NOW = Date.parse('2026-07-31T00:00:00Z');

test('评分：打开次数越多分数越高', () => {
  const base = (opens) => computeScore(opens, NOW - 1000, NOW - 86400000 * 10, NOW);
  assert.ok(base(10) > base(2));
  assert.ok(base(2) > base(0));
  assert.ok(base(0) >= 0);
});

test('评分：最近打开优于很久以前', () => {
  const recent = computeScore(3, NOW - 1000, NOW - 86400000 * 5, NOW);
  const old = computeScore(3, NOW - 86400000 * 60, NOW - 86400000 * 5, NOW);
  assert.ok(recent > old);
});

test('评分：近期任务会超过很久未用的历史高频项目', () => {
  const currentTask = computeScore(1, NOW - 5 * 60 * 1000, 0, NOW, [NOW - 5 * 60 * 1000]);
  const oldFavorite = computeScore(100, NOW - 90 * DAY, 0, NOW, []);
  assert.ok(currentTask > oldFavorite);
});

test('评分：跨多天持续使用优于同日集中打开', () => {
  const steadyHistory = Array.from({ length: 7 }, (_, i) => NOW - i * DAY);
  const burstHistory = Array.from({ length: 7 }, (_, i) => NOW - i * 60 * 1000);
  const steady = computeScore(7, NOW, 0, NOW, steadyHistory);
  const burst = computeScore(7, NOW, 0, NOW, burstHistory);
  assert.ok(steady > burst);
});

test('评分：写入时间不再影响（只按本软件打开次数与最近使用）', () => {
  const fresh = computeScore(0, 0, NOW - 1000, NOW);
  const stale = computeScore(0, 0, NOW - 86400000 * 90, NOW);
  assert.equal(fresh, stale);
  const opened = computeScore(5, NOW - 1000, NOW - 86400000 * 90, NOW);
  assert.ok(opened > stale);
});

test('评分范围与稳定性', () => {
  for (let i = 0; i < 100; i++) {
    const s = computeScore(i % 20, NOW - i * DAY, NOW - i * DAY, NOW);
    assert.ok(Number.isFinite(s) && s >= 0 && s <= 1.5, `score=${s}`);
  }
});

test('rankItems：排序、TopN、排除隐藏', () => {
  const items = [
    { path: 'C:\\a', name: 'a', hidden: false },
    { path: 'C:\\b', name: 'b', hidden: false },
    { path: 'C:\\c', name: 'c', hidden: true },
  ];
  const usage = {
    items: {
      'C:\\a': { opens: 0, lastOpened: 0 },
      'C:\\b': { opens: 100, lastOpened: Date.now() },
    },
  };
  const top = rankItems(items, usage, { topN: 2 });
  assert.equal(top.length, 2);
  assert.equal(top[0].item.path, 'C:\\b');
  assert.ok(top.every((t) => t.item.path !== 'C:\\c'));
  const top1 = rankItems(items, usage, { topN: 1 });
  assert.equal(top1.length, 1);
});
