const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyItem } = require('../src/main/classifier');

test('分类：国内对战平台快捷方式识别为游戏', () => {
  assert.equal(classifyItem({ name: '5E对战平台.lnk', ext: '.lnk', targetPath: 'D:\\5EPlay\\5EPLAY.exe' }), 'game');
  assert.equal(classifyItem({ name: '对战平台.lnk', ext: '.lnk', targetPath: 'C:\\Games\\对战平台\\launcher.exe' }), 'game');
});
