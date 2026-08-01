'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyItem, isSkippableName, CATEGORIES, categoryMeta } = require('../src/main/classifier');

test('分类：文件夹', () => {
  assert.equal(classifyItem({ name: '项目资料', isDir: true }), 'folder');
});

test('分类：图片/文档/媒体/压缩包/应用扩展名', () => {
  assert.equal(classifyItem({ name: 'photo.png' }), 'image');
  assert.equal(classifyItem({ name: 'design.ai' }), 'image');
  assert.equal(classifyItem({ name: '报告.docx' }), 'doc');
  assert.equal(classifyItem({ name: 'main.ts' }), 'doc');
  assert.equal(classifyItem({ name: 'song.mp3' }), 'media');
  assert.equal(classifyItem({ name: 'playlist.m3u8' }), 'media');
  assert.equal(classifyItem({ name: 'movie.mkv' }), 'media');
  assert.equal(classifyItem({ name: 'backup.zip' }), 'archive');
  assert.equal(classifyItem({ name: 'disk.vhdx' }), 'archive');
  assert.equal(classifyItem({ name: 'installer.exe' }), 'app');
  assert.equal(classifyItem({ name: 'install.msixbundle' }), 'app');
});

test('分类：网页链接 .url', () => {
  assert.equal(classifyItem({ name: 'bilibili.url', ext: '.url' }), 'link');
});

test('分类：.lnk 指向应用/游戏/网页', () => {
  assert.equal(classifyItem({ name: 'Chrome.lnk', ext: '.lnk', targetPath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }), 'app');
  assert.equal(classifyItem({ name: '帕鲁.lnk', ext: '.lnk', targetPath: 'D:\\Steam\\steamapps\\common\\Palworld\\Palworld.exe' }), 'game');
  assert.equal(classifyItem({ name: 'Epic.lnk', ext: '.lnk', targetPath: 'C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe' }), 'app');
  assert.equal(classifyItem({ name: 'site.lnk', ext: '.lnk', targetPath: 'https://www.example.com' }), 'link');
  assert.equal(classifyItem({ name: 'dir.lnk', ext: '.lnk', targetPath: 'C:\\Users\\x\\Desktop\\资料' }), 'app');
});

test('分类：其他', () => {
  assert.equal(classifyItem({ name: '奇怪的.xyz' }), 'other');
});

test('跳过隐藏/系统/临时文件', () => {
  assert.ok(isSkippableName('desktop.ini'));
  assert.ok(isSkippableName('Thumbs.db'));
  assert.ok(isSkippableName('~$报告.docx'));
  assert.ok(isSkippableName('.gitignore'));
  assert.ok(isSkippableName('a.tmp'));
  assert.ok(!isSkippableName('我的文档.docx'));
  assert.ok(!isSkippableName('README.md'));
});

test('类别元数据完整', () => {
  assert.equal(CATEGORIES.length, 9);
  assert.equal(categoryMeta('game').label, '游戏');
  assert.equal(categoryMeta('not-exist').id, 'other');
});
