'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePath, resolveDesktopDirs, isUnderAnyDirs, formatSize } = require('../src/main/paths');

test('normalizePath：反斜杠规范化与去尾', () => {
  assert.equal(normalizePath('C:/Users/x/Desktop/'), 'C:\\Users\\x\\Desktop');
  assert.equal(normalizePath('C:\\'), 'C:\\');
  assert.equal(normalizePath(''), '');
});

test('resolveDesktopDirs：优先级与去重（OneDrive 重定向场景）', () => {
  const dirs = resolveDesktopDirs({
    shellDesktop: 'C:\\Users\\x\\OneDrive\\Desktop',
    oneDriveDesktop: 'C:\\Users\\x\\OneDrive\\Desktop',
    publicDesktop: 'C:\\Users\\Public\\Desktop',
    userHome: 'C:\\Users\\x',
  });
  assert.equal(dirs.length, 2);
  assert.equal(dirs[0].path, 'C:\\Users\\x\\OneDrive\\Desktop');
  assert.equal(dirs[0].source, 'shell');
  assert.equal(dirs[1].path, 'C:\\Users\\Public\\Desktop');
});

test('resolveDesktopDirs：无注册表时回退 home Desktop', () => {
  const dirs = resolveDesktopDirs({
    shellDesktop: '',
    oneDriveDesktop: '',
    publicDesktop: '',
    userHome: 'C:\\Users\\x',
  });
  assert.equal(dirs.length, 1);
  assert.equal(dirs[0].path, 'C:\\Users\\x\\Desktop');
});

test('isUnderAnyDirs', () => {
  const dirs = [{ path: 'C:\\Users\\x\\Desktop' }];
  assert.ok(isUnderAnyDirs('C:\\Users\\x\\Desktop\\a.lnk', dirs));
  assert.ok(!isUnderAnyDirs('C:\\Users\\x\\Documents\\a.lnk', dirs));
});

test('formatSize', () => {
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(2048), '2.0 KB');
  assert.equal(formatSize(5 * 1024 * 1024), '5.0 MB');
});
