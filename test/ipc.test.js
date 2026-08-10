'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildData, normalizeExternalUrl } = require('../src/main/ipc');

test('外部链接：保留自定义协议并为普通域名补 http', () => {
  assert.equal(normalizeExternalUrl('steam://run/730'), 'steam://run/730');
  assert.equal(normalizeExternalUrl('https://example.com'), 'https://example.com');
  assert.equal(normalizeExternalUrl('example.com'), 'http://example.com');
  assert.equal(normalizeExternalUrl('  '), '');
});

test('推荐：隐藏条目不占用 Top N 名额', () => {
  const items = [
    { path: 'C:\\A.exe', name: 'A', category: 'app', isDir: false, ext: '.exe', mtimeMs: 1 },
    { path: 'C:\\B.exe', name: 'B', category: 'app', isDir: false, ext: '.exe', mtimeMs: 1 },
    { path: 'C:\\C.exe', name: 'C', category: 'app', isDir: false, ext: '.exe', mtimeMs: 1 },
  ];
  const ctx = {
    getSettings: () => ({
      settings: { recommendCount: 2 },
      manualItems: {}, containers: {}, pinned: [], hiddenItems: { 'C:\\A.exe': true },
    }),
    scanner: { items, dirs: [] },
    usage: { data: { version: 2, items: {} } },
    state: { iconsHidden: false, nativeAvailable: true, nativeError: null },
  };

  const data = buildData(ctx);
  assert.deepEqual(data.recommended.map((item) => item.path), ['C:\\B.exe', 'C:\\C.exe']);
});
